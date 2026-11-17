/**
 * 0026 (lot A) — criteria 1, 2, 5 and 7 against the local Supabase stack (functions ensure_qr_code and set_qr_style of
 * 0024, migration 20261117120000). Real use cases, real adapters, real sessions.
 *
 * Adapter under test (contract frozen in its unit test):
 * // makeSupabaseQrCodeRepository(server) — server client under the session.
 * Use cases: makeGetOwnQrCode({ auth, profiles, qrCodes, siteUrl }), makeSaveQrStyle({ auth, rateLimiter, profiles, qrCodes }).
 */
import { afterEach, describe, expect, it } from "vitest";

import { QR_CODE_PATTERN } from "@/domain/nfc/nfc-tag";
import { err, ok } from "@/domain/shared/result";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";
import { makeSupabaseProfileReader } from "@/server/repositories/supabase-profile-reader";
import { makeSupabaseQrCodeRepository } from "@/server/repositories/supabase-qr-code-repository";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";
import { makeGetOwnQrCode } from "@/server/use-cases/get-own-qr-code";
import { makeSaveQrStyle } from "@/server/use-cases/save-qr-style";

import { aQrStyle, BRANDED_QR_STYLE, QR_SITE_URL } from "../builders/qr";
import { deleteUsersByEmail } from "./setup/cleanup";
import { adminClient, anonClient, type CarnetClient } from "./setup/clients";
import { RUN_SECRET } from "./setup/fixtures";
import { createMember, createOutsider } from "./setup/members";
import { countQrRows, qrRowOf, qrRowsOf } from "./setup/qr";

function mediaOrigin(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (value === undefined) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL missing (globalSetup)");
  }
  return value;
}

describe("QR code of the owner against the local Supabase stack", () => {
  const admin = adminClient();
  const emails: string[] = [];

  function track(email: string): string {
    emails.push(email);
    return email;
  }

  function casesOn(session: CarnetClient) {
    const auth = makeSupabaseAuthGateway(session);
    const profiles = makeSupabaseProfileReader(session, mediaOrigin());
    const qrCodes = makeSupabaseQrCodeRepository(session);
    return {
      qrCodes,
      getOwnQrCode: makeGetOwnQrCode({ auth, profiles, qrCodes, siteUrl: QR_SITE_URL }),
      saveQrStyle: makeSaveQrStyle({ auth, rateLimiter: makeSupabaseRateLimiter(admin, RUN_SECRET), profiles, qrCodes }),
    };
  }

  afterEach(async () => {
    const { survivingProfileIds } = await deleteUsersByEmail(admin, emails.splice(0));

    expect(survivingProfileIds).toStrictEqual([]);
  });

  describe("criterion 1: the QR of the owner", () => {
    it("first display creates the QR: ${SITE_URL}/q/{code}, default style, no logo", async () => {
      const member = await createMember(admin, track);
      expect(await qrRowsOf(admin, member.profileId)).toStrictEqual([]);

      const result = await casesOn(member.session).getOwnQrCode();

      if (!result.ok) throw new Error(`getOwnQrCode failed: ${result.error}`);
      expect(result.value.code).toMatch(QR_CODE_PATTERN);
      expect(result.value.url).toBe(`${QR_SITE_URL}/q/${result.value.code}`);
      expect(result.value.style).toStrictEqual(aQrStyle());
      expect(result.value.logoUrl).toBeNull();
      expect((await qrRowOf(admin, member.profileId)).code).toBe(result.value.code);
    });

    it("idempotence: opened twice → the same code, one row, nothing rewritten", async () => {
      const member = await createMember(admin, track);
      const cases = casesOn(member.session);

      const first = await cases.getOwnQrCode();
      const before = await qrRowOf(admin, member.profileId);
      const second = await cases.getOwnQrCode();

      expect(second).toStrictEqual(first);
      expect(await qrRowsOf(admin, member.profileId)).toStrictEqual([before]);
    });

    it("the code is independent of the slug: changing the slug keeps the code", async () => {
      const member = await createMember(admin, track);
      const cases = casesOn(member.session);
      const first = await cases.getOwnQrCode();
      const { error } = await admin.from("profiles").update({ slug: `${member.slug}-bis` }).eq("id", member.profileId);
      expect(error).toBeNull();

      expect(await cases.getOwnQrCode()).toStrictEqual(first);
    });

    it("two members get two different codes", async () => {
      const first = await createMember(admin, track);
      const second = await createMember(admin, track);

      const a = await casesOn(first.session).getOwnQrCode();
      const b = await casesOn(second.session).getOwnQrCode();

      expect(a.ok && b.ok && a.value.code !== b.value.code).toBe(true);
    });
  });

  describe("decision 7: saving the style", () => {
    it("a valid style is stored and shown at the next display", async () => {
      const member = await createMember(admin, track);
      const cases = casesOn(member.session);

      expect(await cases.saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(ok(undefined));

      expect((await qrRowOf(admin, member.profileId)).style).toStrictEqual(BRANDED_QR_STYLE);
      const shown = await cases.getOwnQrCode();
      expect(shown.ok && shown.value.style).toStrictEqual(BRANDED_QR_STYLE);
    });

    it("saving before the first display creates the QR with the style (set_qr_style ensures the row)", async () => {
      const member = await createMember(admin, track);

      expect(await casesOn(member.session).saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(ok(undefined));

      expect((await qrRowOf(admin, member.profileId)).style).toStrictEqual(BRANDED_QR_STYLE);
    });

    it("idempotence: the same style saved twice → success twice, nothing written the second time (updated_at unchanged)", async () => {
      const member = await createMember(admin, track);
      const cases = casesOn(member.session);
      expect(await cases.saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(ok(undefined));
      const before = await qrRowOf(admin, member.profileId);

      expect(await cases.saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(ok(undefined));

      expect(await qrRowOf(admin, member.profileId)).toStrictEqual(before);
    });

    it("criterion 2: light modules on a dark background, or a contrast under 4.5:1 → refused, nothing written", async () => {
      const member = await createMember(admin, track);
      const cases = casesOn(member.session);
      await cases.getOwnQrCode();
      const before = await qrRowOf(admin, member.profileId);

      expect(await cases.saveQrStyle(aQrStyle({ fg: "#ffffff", bg: "#000000" }))).toStrictEqual(err("not_darker"));
      expect(await cases.saveQrStyle(aQrStyle({ fg: "#777777", bg: "#ffffff" }))).toStrictEqual(err("low_contrast"));

      expect(await qrRowOf(admin, member.profileId)).toStrictEqual(before);
    });

    it("decision 7: the database refuses a malformed style on its own (22023 → invalid), past the domain", async () => {
      const member = await createMember(admin, track);
      const { qrCodes } = casesOn(member.session);
      await qrCodes.ensureOwn();
      const before = await qrRowOf(admin, member.profileId);

      expect(await qrCodes.setStyle(aQrStyle({ fg: "#FFFFFF" }))).toStrictEqual(err("invalid"));

      expect(await qrRowOf(admin, member.profileId)).toStrictEqual(before);
    });

    it("another member's save never touches someone else's QR", async () => {
      const owner = await createMember(admin, track);
      const other = await createMember(admin, track);
      await casesOn(owner.session).getOwnQrCode();
      const before = await qrRowOf(admin, owner.profileId);

      expect(await casesOn(other.session).saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(ok(undefined));

      expect(await qrRowOf(admin, owner.profileId)).toStrictEqual(before);
      expect((await qrRowOf(admin, other.profileId)).style).toStrictEqual(BRANDED_QR_STYLE);
    });
  });

  describe("criteria 5 and 7: authorization", () => {
    it("criterion 7: an account of another project → no_profile for the display and the save, no QR created", async () => {
      const outsider = await createOutsider(admin, track);
      const cases = casesOn(outsider.session);
      const rowsBefore = await countQrRows(admin);

      expect(await cases.getOwnQrCode()).toStrictEqual(err("no_profile"));
      expect(await cases.saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(err("no_profile"));
      expect(await cases.qrCodes.ensureOwn()).toStrictEqual(err("no_profile"));
      expect(await cases.qrCodes.setStyle(BRANDED_QR_STYLE)).toStrictEqual(err("no_profile"));

      expect(await countQrRows(admin)).toBe(rowsBefore);
    });

    it("criterion 7: an account of another project reads no QR row (RLS)", async () => {
      const member = await createMember(admin, track);
      await casesOn(member.session).getOwnQrCode();
      const outsider = await createOutsider(admin, track);

      const { data, error } = await outsider.session.from("qr_codes").select("code");

      expect(error).toBeNull();
      expect(data).toStrictEqual([]);
    });

    it("criterion 5: without session → unauthenticated for the display and the save, nothing created", async () => {
      const cases = casesOn(anonClient());
      const rowsBefore = await countQrRows(admin);

      expect(await cases.getOwnQrCode()).toStrictEqual(err("unauthenticated"));
      expect(await cases.saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(err("unauthenticated"));

      expect(await countQrRows(admin)).toBe(rowsBefore);
    });
  });
});
