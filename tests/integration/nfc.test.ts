/**
 * 0025 — criteria 1 to 5 against the local Supabase stack (migration 20261117120000 of 0024). Real use cases, real
 * adapters, real sessions; tags created through `provision_nfc_tags` (service_role) as the psql script does.
 *
 * Adapters under test (contract frozen in their unit tests):
 * // makeSupabaseNfcTagResolver(client), makeSupabaseQrCodeResolver(client) — cookie-less anonymous client.
 * // makeSupabaseNfcTagRepository(server) — server client under the session.
 * Use cases: makeResolveNfcTag, makeResolveQrCode, makeActivateNfcTag, makeListOwnNfcTags, makeSetNfcTagEnabled,
 * makeReleaseNfcTag.
 */
import { afterEach, describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";
import { makeSupabaseMembershipReader } from "@/server/repositories/supabase-membership-reader";
import { makeSupabaseNfcTagRepository } from "@/server/repositories/supabase-nfc-tag-repository";
import { makeSupabaseNfcTagResolver } from "@/server/repositories/supabase-nfc-tag-resolver";
import { makeSupabaseProfileReader } from "@/server/repositories/supabase-profile-reader";
import { makeSupabaseQrCodeResolver } from "@/server/repositories/supabase-qr-code-resolver";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";
import { makeActivateNfcTag } from "@/server/use-cases/activate-nfc-tag";
import { makeListOwnNfcTags } from "@/server/use-cases/list-own-nfc-tags";
import { makeReleaseNfcTag } from "@/server/use-cases/release-nfc-tag";
import { makeResolveNfcTag } from "@/server/use-cases/resolve-nfc-tag";
import { makeResolveQrCode } from "@/server/use-cases/resolve-qr-code";
import { makeSetNfcTagEnabled } from "@/server/use-cases/set-nfc-tag-enabled";

import { deleteUsersByEmail } from "./setup/cleanup";
import { adminClient, anonClient, type CarnetClient } from "./setup/clients";
import { RUN_SECRET, uniqueAddress } from "./setup/fixtures";
import { createMember, createOutsider } from "./setup/members";
import { deleteBatches, provisionTags, setPublished, tagRow } from "./setup/nfc";

const PER_ACCOUNT_LIMIT = 10;
const PER_ADDRESS_LIMIT = 30;
/** Well-formed code that no provisioned tag can have (the alphabet has 32 symbols, 10 characters: never generated twice in a test). */
const WRONG_CODE = "00000-00000";

function mediaOrigin(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (value === undefined) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL missing (globalSetup)");
  }
  return value;
}

describe("NFC tags and QR codes against the local Supabase stack", () => {
  const admin = adminClient();
  const emails: string[] = [];
  const batches: string[] = [];

  function track(email: string): string {
    emails.push(email);
    return email;
  }

  function trackBatch(batchId: string): string {
    batches.push(batchId);
    return batchId;
  }

  function casesOn(session: CarnetClient) {
    const auth = makeSupabaseAuthGateway(session);
    const rateLimiter = makeSupabaseRateLimiter(admin, RUN_SECRET);
    const tags = makeSupabaseNfcTagRepository(session);
    const profiles = makeSupabaseProfileReader(session, mediaOrigin());
    return {
      activateNfcTag: makeActivateNfcTag({ auth, membership: makeSupabaseMembershipReader(session), rateLimiter, tags }),
      listOwnNfcTags: makeListOwnNfcTags({ auth, tags }),
      setNfcTagEnabled: makeSetNfcTagEnabled({ auth, rateLimiter, profiles, tags }),
      releaseNfcTag: makeReleaseNfcTag({ auth, rateLimiter, profiles, tags }),
    };
  }

  const resolveNfcTag = makeResolveNfcTag({ tags: makeSupabaseNfcTagResolver(anonClient()) });
  const resolveQrCode = makeResolveQrCode({ codes: makeSupabaseQrCodeResolver(anonClient()) });

  async function publishedMember() {
    const member = await createMember(admin, track);
    await setPublished(admin, member.profileId, true);
    return member;
  }

  /** A published member owning one freshly activated tag. */
  async function ownerOfOneTag() {
    const member = await publishedMember();
    const [tag] = await provisionTags(admin, 1, trackBatch);
    if (tag === undefined) throw new Error("no tag provisioned");
    const activated = await casesOn(member.session).activateNfcTag({
      uid: tag.uid,
      code: tag.activationCode,
      clientAddress: uniqueAddress(),
    });
    expect(activated).toStrictEqual(ok("activated"));
    const { id } = await tagRow(admin, tag.uid);
    return { member, tag, tagId: id };
  }

  afterEach(async () => {
    await deleteBatches(admin, batches.splice(0));
    const { survivingProfileIds } = await deleteUsersByEmail(admin, emails.splice(0));

    expect(survivingProfileIds).toStrictEqual([]);
  });

  describe("criterion 1 and 2: resolution of /t/{uid} and /q/{code}", () => {
    it("a tag in stock → activation; after activation on a published profile → active with its slug", async () => {
      const member = await publishedMember();
      const [tag] = await provisionTags(admin, 1, trackBatch);
      if (tag === undefined) throw new Error("no tag provisioned");

      expect(await resolveNfcTag(tag.uid)).toStrictEqual(ok({ state: "activation" }));

      await casesOn(member.session).activateNfcTag({ uid: tag.uid, code: tag.activationCode, clientAddress: uniqueAddress() });

      expect(await resolveNfcTag(tag.uid)).toStrictEqual(ok({ state: "active", slug: member.slug }));
    });

    it("unknown, disabled and unpublished give the same not_found", async () => {
      const { member, tag, tagId } = await ownerOfOneTag();
      const unknown = await resolveNfcTag("zzzzzzzzzzzz");

      await setPublished(admin, member.profileId, false);
      const unpublished = await resolveNfcTag(tag.uid);
      await setPublished(admin, member.profileId, true);
      expect(await casesOn(member.session).setNfcTagEnabled({ tagId, enabled: false })).toStrictEqual(ok(undefined));
      const disabled = await resolveNfcTag(tag.uid);

      expect(unknown).toStrictEqual(ok({ state: "not_found" }));
      expect(unpublished).toStrictEqual(unknown);
      expect(disabled).toStrictEqual(unknown);
    });

    it("the QR code of a published profile resolves to its slug; unpublished or unknown → null", async () => {
      const member = await publishedMember();
      const { data, error } = await member.session.rpc("ensure_qr_code");
      expect(error).toBeNull();
      const code = data?.code ?? "";

      expect(await resolveQrCode(code)).toStrictEqual(ok(member.slug));

      await setPublished(admin, member.profileId, false);
      expect(await resolveQrCode(code)).toStrictEqual(ok(null));
      expect(await resolveQrCode("zzzzzzzz")).toStrictEqual(ok(null));
    });
  });

  describe("criterion 2: activation", () => {
    it.each([
      ["as printed", (code: string) => code],
      ["in lower case", (code: string) => code.toLowerCase()],
      ["without hyphen", (code: string) => code.replace("-", "")],
      ["in lower case without hyphen", (code: string) => code.replace("-", "").toLowerCase()],
    ])("the right code typed %s → activated, the tag is on the caller's profile", async (_label, typed) => {
      const member = await createMember(admin, track);
      const [tag] = await provisionTags(admin, 1, trackBatch);
      if (tag === undefined) throw new Error("no tag provisioned");

      const result = await casesOn(member.session).activateNfcTag({
        uid: tag.uid,
        code: typed(tag.activationCode),
        clientAddress: uniqueAddress(),
      });

      expect(result).toStrictEqual(ok("activated"));
      const row = await tagRow(admin, tag.uid);
      expect(row.status).toBe("assigned");
      expect(row.profile_id).toBe(member.profileId);
      expect(row.activated_at).not.toBeNull();
    });

    it("replayed → already_yours, nothing written the second time", async () => {
      const member = await createMember(admin, track);
      const [tag] = await provisionTags(admin, 1, trackBatch);
      if (tag === undefined) throw new Error("no tag provisioned");
      const input = { uid: tag.uid, code: tag.activationCode, clientAddress: uniqueAddress() };

      expect(await casesOn(member.session).activateNfcTag(input)).toStrictEqual(ok("activated"));
      const afterFirst = await tagRow(admin, tag.uid);
      expect(await casesOn(member.session).activateNfcTag(input)).toStrictEqual(ok("already_yours"));

      expect(await tagRow(admin, tag.uid)).toStrictEqual(afterFirst);
    });

    it("criterion 3: wrong code, unknown tag, another member's tag, disabled tag → the same invalid", async () => {
      const { member: owner, tag: taken } = await ownerOfOneTag();
      const other = await createMember(admin, track);
      const [stock] = await provisionTags(admin, 1, trackBatch);
      if (stock === undefined) throw new Error("no tag provisioned");
      const activate = (uid: string, code: string) =>
        casesOn(other.session).activateNfcTag({ uid, code, clientAddress: uniqueAddress() });

      expect(await activate(stock.uid, WRONG_CODE)).toStrictEqual(err("invalid"));
      expect(await activate("zzzzzzzzzzzz", stock.activationCode)).toStrictEqual(err("invalid"));
      expect(await activate(taken.uid, taken.activationCode)).toStrictEqual(err("invalid"));

      expect((await tagRow(admin, taken.uid)).profile_id).toBe(owner.profileId);
      expect((await tagRow(admin, stock.uid)).status).toBe("stock");
    });

    it("account of another project → no_profile, the tag stays in stock", async () => {
      const outsider = await createOutsider(admin, track);
      const [tag] = await provisionTags(admin, 1, trackBatch);
      if (tag === undefined) throw new Error("no tag provisioned");

      const result = await casesOn(outsider.session).activateNfcTag({
        uid: tag.uid,
        code: tag.activationCode,
        clientAddress: uniqueAddress(),
      });

      expect(result).toStrictEqual(err("no_profile"));
      expect((await tagRow(admin, tag.uid)).status).toBe("stock");
    });

    it("without session → unauthenticated", async () => {
      const [tag] = await provisionTags(admin, 1, trackBatch);
      if (tag === undefined) throw new Error("no tag provisioned");

      const result = await casesOn(anonClient()).activateNfcTag({
        uid: tag.uid,
        code: tag.activationCode,
        clientAddress: uniqueAddress(),
      });

      expect(result).toStrictEqual(err("unauthenticated"));
    });
  });

  describe("criterion 3: rate limits of the activation", () => {
    it("the 11th attempt of an account in the hour → rate_limited, even with the right code (database counter)", async () => {
      const member = await createMember(admin, track);
      const [tag] = await provisionTags(admin, 1, trackBatch);
      if (tag === undefined) throw new Error("no tag provisioned");
      const address = uniqueAddress();
      const activate = (code: string) => casesOn(member.session).activateNfcTag({ uid: tag.uid, code, clientAddress: address });

      for (let attempt = 1; attempt <= PER_ACCOUNT_LIMIT; attempt += 1) {
        expect(await activate(WRONG_CODE), `attempt ${attempt}`).toStrictEqual(err("invalid"));
      }

      expect(await activate(tag.activationCode)).toStrictEqual(err("rate_limited"));
      expect((await tagRow(admin, tag.uid)).status).toBe("stock");
    });

    it("the 31st attempt from one address → rate_limited, whatever the account; another address still answers", async () => {
      const [tag] = await provisionTags(admin, 1, trackBatch);
      if (tag === undefined) throw new Error("no tag provisioned");
      const address = uniqueAddress();
      const members = [
        await createMember(admin, track),
        await createMember(admin, track),
        await createMember(admin, track),
      ];
      const latecomer = await createMember(admin, track);

      for (const member of members) {
        for (let attempt = 1; attempt <= PER_ACCOUNT_LIMIT; attempt += 1) {
          const result = await casesOn(member.session).activateNfcTag({ uid: tag.uid, code: WRONG_CODE, clientAddress: address });
          expect(result).toStrictEqual(err("invalid"));
        }
      }
      expect(members.length * PER_ACCOUNT_LIMIT).toBe(PER_ADDRESS_LIMIT);

      expect(
        await casesOn(latecomer.session).activateNfcTag({ uid: tag.uid, code: tag.activationCode, clientAddress: address }),
      ).toStrictEqual(err("rate_limited"));
      expect((await tagRow(admin, tag.uid)).status).toBe("stock");

      expect(
        await casesOn(latecomer.session).activateNfcTag({ uid: tag.uid, code: tag.activationCode, clientAddress: uniqueAddress() }),
      ).toStrictEqual(ok("activated"));
    });
  });

  describe("criterion 5: « Mes puces »", () => {
    it("the owner lists their tag (id, uid, status, activation date); another member and an outsider list nothing", async () => {
      const { member, tag, tagId } = await ownerOfOneTag();
      const other = await createMember(admin, track);
      const outsider = await createOutsider(admin, track);

      const own = await casesOn(member.session).listOwnNfcTags();

      expect(own.ok).toBe(true);
      if (!own.ok) return;
      expect(own.value).toHaveLength(1);
      expect(own.value[0]).toMatchObject({ id: tagId, uid: tag.uid, status: "assigned" });
      expect(own.value[0]?.activatedAt).toEqual(expect.any(String));
      expect(JSON.stringify(own.value)).not.toContain("$2");
      expect(await casesOn(other.session).listOwnNfcTags()).toStrictEqual(ok([]));
      expect(await casesOn(outsider.session).listOwnNfcTags()).toStrictEqual(ok([]));
    });

    it("disable → /t resolves not_found and the list shows disabled; enable → active again; both replayable", async () => {
      const { member, tag, tagId } = await ownerOfOneTag();
      const cases = casesOn(member.session);

      expect(await cases.setNfcTagEnabled({ tagId, enabled: false })).toStrictEqual(ok(undefined));
      expect(await cases.setNfcTagEnabled({ tagId, enabled: false })).toStrictEqual(ok(undefined));
      expect(await resolveNfcTag(tag.uid)).toStrictEqual(ok({ state: "not_found" }));
      const listed = await cases.listOwnNfcTags();
      expect(listed.ok && listed.value.map((row) => row.status)).toStrictEqual(["disabled"]);

      expect(await cases.setNfcTagEnabled({ tagId, enabled: true })).toStrictEqual(ok(undefined));
      expect(await cases.setNfcTagEnabled({ tagId, enabled: true })).toStrictEqual(ok(undefined));
      expect(await resolveNfcTag(tag.uid)).toStrictEqual(ok({ state: "active", slug: member.slug }));
    });

    it("release → back in stock (/t → activation), released twice is still a success, then reactivated with the same code", async () => {
      const { member, tag, tagId } = await ownerOfOneTag();
      const cases = casesOn(member.session);

      expect(await cases.releaseNfcTag(tagId)).toStrictEqual(ok(undefined));
      expect(await cases.releaseNfcTag(tagId)).toStrictEqual(ok(undefined));

      const row = await tagRow(admin, tag.uid);
      expect(row.status).toBe("stock");
      expect(row.profile_id).toBeNull();
      expect(await resolveNfcTag(tag.uid)).toStrictEqual(ok({ state: "activation" }));
      expect(await cases.listOwnNfcTags()).toStrictEqual(ok([]));

      expect(
        await cases.activateNfcTag({ uid: tag.uid, code: tag.activationCode, clientAddress: uniqueAddress() }),
      ).toStrictEqual(ok("activated"));
      expect(await resolveNfcTag(tag.uid)).toStrictEqual(ok({ state: "active", slug: member.slug }));
    });

    it("another member can neither disable nor release someone else's tag (nothing changes)", async () => {
      const { member, tag, tagId } = await ownerOfOneTag();
      const other = await createMember(admin, track);
      const before = await tagRow(admin, tag.uid);

      expect(await casesOn(other.session).setNfcTagEnabled({ tagId, enabled: false })).toStrictEqual(err("not_found"));
      await casesOn(other.session).releaseNfcTag(tagId);

      expect(await tagRow(admin, tag.uid)).toStrictEqual(before);
      expect(await resolveNfcTag(tag.uid)).toStrictEqual(ok({ state: "active", slug: member.slug }));
    });

    it("an account of another project can neither disable nor release (not_found), nothing changes", async () => {
      const { tag, tagId } = await ownerOfOneTag();
      const outsider = await createOutsider(admin, track);
      const before = await tagRow(admin, tag.uid);

      expect(await casesOn(outsider.session).setNfcTagEnabled({ tagId, enabled: false })).toStrictEqual(err("not_found"));
      expect(await casesOn(outsider.session).releaseNfcTag(tagId)).toStrictEqual(err("not_found"));

      expect(await tagRow(admin, tag.uid)).toStrictEqual(before);
    });

    it("without session → unauthenticated for the list, the toggle and the release", async () => {
      const { tagId } = await ownerOfOneTag();
      const cases = casesOn(anonClient());

      expect(await cases.listOwnNfcTags()).toStrictEqual(err("unauthenticated"));
      expect(await cases.setNfcTagEnabled({ tagId, enabled: false })).toStrictEqual(err("unauthenticated"));
      expect(await cases.releaseNfcTag(tagId)).toStrictEqual(err("unauthenticated"));
    });
  });
});
