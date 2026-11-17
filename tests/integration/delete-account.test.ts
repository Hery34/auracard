/**
 * 0023 — criteria 1, 2, 3 and 5 against the local Supabase stack. Real use case, real adapters, real sessions.
 *
 * Adapters under test (contract frozen in their unit tests):
 * // makeSupabaseMediaFolderCleaner(server), makeSupabaseCarnetAccountEraser(server) — session client.
 * // makeSupabaseInstanceAccountRemover(admin) — service_role client.
 * Use case: makeDeleteAccount (src/server/use-cases/delete-account.test.ts).
 *
 * Not covered here, covered by pgTAP (supabase/tests/carnet_delete_account.test.sql, rolled back): an account member of
 * another project (platform.* is not exposed to PostgREST, and writing in the shared registry outside a rolled-back
 * transaction is not allowed), the rows of carnet.rate_limits (no privilege, not even for service_role).
 */
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseMediaFolderCleaner } from "@/server/adapters/supabase-media-folder-cleaner";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";
import { makeSupabaseCarnetAccountEraser } from "@/server/repositories/supabase-carnet-account-eraser";
import { makeSupabaseInstanceAccountRemover } from "@/server/repositories/supabase-instance-account-remover";
import { makeSupabaseProfileReader } from "@/server/repositories/supabase-profile-reader";
import { makeSupabasePublicProfileReader } from "@/server/repositories/supabase-public-profile-reader";
import { makeSupabaseQrCodeResolver } from "@/server/repositories/supabase-qr-code-resolver";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";
import { makeDeleteAccount } from "@/server/use-cases/delete-account";
import { makeResolveQrCode } from "@/server/use-cases/resolve-qr-code";

import { imageBytes } from "../builders/images";
import { aSlug } from "../builders/slug";
import { deleteUsersByEmail } from "./setup/cleanup";
import { adminClient, anonClient, type CarnetClient } from "./setup/clients";
import { RUN_SECRET } from "./setup/fixtures";
import { createMember, type Member } from "./setup/members";
import { deleteBatches, provisionTags, setPublished, tagRow } from "./setup/nfc";

const BUCKET = "carnet-media";

function mediaOrigin(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (value === undefined) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL missing (globalSetup)");
  }
  return value;
}

describe("account deletion against the local Supabase stack (0023)", () => {
  const admin = adminClient();
  const emails: string[] = [];
  const batches: string[] = [];
  const folders: string[] = [];

  function track(email: string): string {
    emails.push(email);
    return email;
  }

  function trackBatch(batchId: string): string {
    batches.push(batchId);
    return batchId;
  }

  /** Real ports of the use case on one session; the cache expiries are recorded instead of calling next/cache. */
  function portsOn(session: CarnetClient) {
    const expired: string[] = [];
    const ports = {
      auth: makeSupabaseAuthGateway(session),
      rateLimiter: makeSupabaseRateLimiter(admin, RUN_SECRET),
      profiles: makeSupabaseProfileReader(session, mediaOrigin()),
      mediaFolder: makeSupabaseMediaFolderCleaner(session),
      carnetAccount: makeSupabaseCarnetAccountEraser(session),
      instanceAccounts: makeSupabaseInstanceAccountRemover(admin),
      profileCache: { expire: (slug: string) => void expired.push(slug) },
    };
    return { ...ports, expired, deleteAccount: makeDeleteAccount(ports) };
  }

  /** A published member with two links, a QR code, two media objects and one activated tag. */
  async function fullMember(): Promise<{ member: Member; qrCode: string; tagUid: string; objects: string[] }> {
    const member = await createMember(admin, track);
    await setPublished(admin, member.profileId, true);
    folders.push(member.profileId);

    const { error: linksError } = await admin.from("links").insert([
      { profile_id: member.profileId, platform: "github", url: "https://github.com/it-0023", position: 0 },
      { profile_id: member.profileId, platform: "website", url: "https://it-0023.example.test", label: "Site", position: 1 },
    ]);
    if (linksError !== null) throw linksError;

    const { data: qr, error: qrError } = await member.session.rpc("ensure_qr_code");
    if (qrError !== null || qr === null) throw qrError ?? new Error("ensure_qr_code returned nothing");

    const objects = [`${member.profileId}/avatar-${randomUUID()}.jpg`, `${member.profileId}/banner-${randomUUID()}.jpg`];
    for (const name of objects) {
      const { error } = await member.session.storage
        .from(BUCKET)
        .upload(name, imageBytes("jpeg"), { contentType: "image/jpeg", upsert: false });
      if (error !== null) throw error;
    }

    const [tag] = await provisionTags(admin, 1, trackBatch);
    if (tag === undefined) throw new Error("no tag provisioned");
    const { data: activated, error: tagError } = await member.session.rpc("activate_nfc_tag", {
      p_uid: tag.uid,
      p_code: tag.activationCode,
    });
    if (tagError !== null) throw tagError;
    expect(activated).toBe("activated");

    return { member, qrCode: qr.code, tagUid: tag.uid, objects };
  }

  async function objectsIn(profileId: string): Promise<string[]> {
    const { data, error } = await admin.storage.from(BUCKET).list(profileId);
    if (error !== null) throw error;
    return data.map((object) => `${profileId}/${object.name}`).sort();
  }

  async function rowsOf(table: "profiles" | "links" | "qr_codes", column: string, value: string): Promise<number> {
    const { count, error } = await admin.from(table).select("*", { count: "exact", head: true }).eq(column, value);
    if (error !== null || count === null) throw error ?? new Error("count unavailable");
    return count;
  }

  async function accountExists(userId: string): Promise<boolean> {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error !== null) {
      if (error.status === 404) return false;
      throw error;
    }
    return data.user !== null;
  }

  /** Every trace of the member in carnet and in auth.users is gone; its tag is back in stock. */
  async function expectFullyDeleted(subject: { member: Member; qrCode: string; tagUid: string }): Promise<void> {
    const { member, qrCode, tagUid } = subject;
    expect(await rowsOf("profiles", "owner_id", member.userId)).toBe(0);
    expect(await rowsOf("links", "profile_id", member.profileId)).toBe(0);
    expect(await rowsOf("qr_codes", "profile_id", member.profileId)).toBe(0);
    expect(await objectsIn(member.profileId)).toStrictEqual([]);
    const tag = await tagRow(admin, tagUid);
    expect({ status: tag.status, profile_id: tag.profile_id, activated_at: tag.activated_at }).toStrictEqual({
      status: "stock",
      profile_id: null,
      activated_at: null,
    });
    expect(await accountExists(member.userId)).toBe(false);
    const publicProfiles = makeSupabasePublicProfileReader(anonClient(), mediaOrigin());
    expect(await publicProfiles.getBySlug(aSlug(member.slug))).toStrictEqual(ok(null));
    expect(await makeResolveQrCode({ codes: makeSupabaseQrCodeResolver(anonClient()) })(qrCode)).toStrictEqual(ok(null));
  }

  afterEach(async () => {
    for (const profileId of folders.splice(0)) {
      const names = await objectsIn(profileId);
      if (names.length > 0) {
        const { error } = await admin.storage.from(BUCKET).remove(names);
        if (error !== null) throw error;
      }
    }
    await deleteBatches(admin, batches.splice(0));
    const { survivingProfileIds } = await deleteUsersByEmail(admin, emails.splice(0));

    expect(survivingProfileIds).toStrictEqual([]);
  });

  describe("criteria 1 and 2: complete deletion of an account of carnet only", () => {
    it("profile, links, QR, media and auth.users are gone; the tag is in stock; /p/{slug} and /q/{code} resolve to nothing", async () => {
      const subject = await fullMember();
      const { deleteAccount, expired } = portsOn(subject.member.session);

      expect(await deleteAccount()).toStrictEqual(ok(undefined));

      await expectFullyDeleted(subject);
      expect(expired).toStrictEqual([subject.member.slug]);
    });

    it("criterion 5: another member's profile, media, QR and tag are untouched", async () => {
      const deleted = await fullMember();
      const kept = await fullMember();

      expect(await portsOn(deleted.member.session).deleteAccount()).toStrictEqual(ok(undefined));

      expect(await rowsOf("profiles", "id", kept.member.profileId)).toBe(1);
      expect(await rowsOf("links", "profile_id", kept.member.profileId)).toBe(2);
      expect(await rowsOf("qr_codes", "profile_id", kept.member.profileId)).toBe(1);
      expect(await objectsIn(kept.member.profileId)).toStrictEqual([...kept.objects].sort());
      expect((await tagRow(admin, kept.tagUid)).profile_id).toBe(kept.member.profileId);
      expect(await accountExists(kept.member.userId)).toBe(true);
    });
  });

  describe("criterion 3: replay after a cut at each step", () => {
    it("cut after Storage (folder emptied, nothing else) → the replay completes, same final state", async () => {
      const subject = await fullMember();
      const ports = portsOn(subject.member.session);

      expect(await ports.mediaFolder.empty(subject.member.profileId)).toStrictEqual(ok(undefined));
      expect(await ports.deleteAccount()).toStrictEqual(ok(undefined));

      await expectFullyDeleted(subject);
    });

    it("cut after the SQL step (carnet data gone, auth.users left) → the replay deletes the account, no error", async () => {
      const subject = await fullMember();
      const ports = portsOn(subject.member.session);

      expect(await ports.mediaFolder.empty(subject.member.profileId)).toStrictEqual(ok(undefined));
      expect(await ports.carnetAccount.erase()).toStrictEqual(ok(subject.member.slug));
      expect(await accountExists(subject.member.userId)).toBe(true);

      expect(await ports.deleteAccount()).toStrictEqual(ok(undefined));

      await expectFullyDeleted(subject);
    });

    it("cut after the orphan check → the replay checks again and deletes the account", async () => {
      const subject = await fullMember();
      const ports = portsOn(subject.member.session);

      await ports.mediaFolder.empty(subject.member.profileId);
      await ports.carnetAccount.erase();
      expect(await ports.instanceAccounts.isOrphan(subject.member.userId)).toStrictEqual(ok(true));

      expect(await ports.deleteAccount()).toStrictEqual(ok(undefined));

      await expectFullyDeleted(subject);
    });

    it("cut after the admin delete (sign-out never done) → the stale session is unauthenticated, nothing changes", async () => {
      const subject = await fullMember();
      const ports = portsOn(subject.member.session);

      expect(await ports.deleteAccount()).toStrictEqual(ok(undefined));
      expect(await ports.deleteAccount()).toStrictEqual(err("unauthenticated"));

      await expectFullyDeleted(subject);
    });

    it("the SQL step and the admin delete executed twice → ok twice (already gone = success)", async () => {
      const subject = await fullMember();
      const ports = portsOn(subject.member.session);
      await ports.mediaFolder.empty(subject.member.profileId);

      expect(await ports.carnetAccount.erase()).toStrictEqual(ok(subject.member.slug));
      expect(await ports.carnetAccount.erase()).toStrictEqual(ok(null));
      expect(await ports.mediaFolder.empty(subject.member.profileId)).toStrictEqual(ok(undefined));
      expect(await ports.instanceAccounts.remove(subject.member.userId)).toStrictEqual(ok(undefined));
      expect(await ports.instanceAccounts.remove(subject.member.userId)).toStrictEqual(ok(undefined));

      await expectFullyDeleted(subject);
    });
  });

  describe("criterion 5: authorization", () => {
    it("without session → err('unauthenticated'), nothing deleted", async () => {
      const subject = await fullMember();

      expect(await portsOn(anonClient()).deleteAccount()).toStrictEqual(err("unauthenticated"));

      expect(await rowsOf("profiles", "id", subject.member.profileId)).toBe(1);
      expect(await objectsIn(subject.member.profileId)).toStrictEqual([...subject.objects].sort());
      expect(await accountExists(subject.member.userId)).toBe(true);
    });

    it("a session cannot empty another member's folder through the Storage adapter", async () => {
      const victim = await fullMember();
      const intruder = await createMember(admin, track);

      await makeSupabaseMediaFolderCleaner(intruder.session).empty(victim.member.profileId);

      expect(await objectsIn(victim.member.profileId)).toStrictEqual([...victim.objects].sort());
    });
  });
});
