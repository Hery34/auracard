/**
 * Contract frozen by test-engineer (0026, decisions 1, 2, 5 and 7; criteria 1, 3, 5 and 7).
 *
 * // src/server/use-cases/get-own-qr-code.ts
 * export type OwnQr = { code: string; url: string; style: QrStyle; logoUrl: string | null };
 * export type GetOwnQrCodeError = "unauthenticated" | "no_profile" | "unexpected";
 * export type GetOwnQrCode = () => Promise<Result<OwnQr, GetOwnQrCodeError>>;
 * export function makeGetOwnQrCode(deps: {
 *   auth: AuthGateway; profiles: ProfileReader; qrCodes: QrCodeRepository; siteUrl: string;
 * }): GetOwnQrCode;
 * // Order: auth.currentUser (err → unexpected, null → unauthenticated) → profiles.getOwn (err → unexpected,
 * //   null → no_profile: account of another project) → qrCodes.ensureOwn (created on first display, idempotent;
 * //   no_profile → no_profile, unexpected → unexpected).
 * // url = qrCodeUrl(siteUrl, code); logoUrl = the profile's logoUrl (0021) — null disables the logo option.
 * // No rate limit: ensure_qr_code writes at most once per profile.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeGetOwnQrCode } from "@/server/use-cases/get-own-qr-code";

import { makeCallLog } from "../../../tests/builders/call-log";
import { fakeAuthGateway, GATEWAY_USER_EMAIL, GATEWAY_USER_ID, type FakeAuthGatewayOptions } from "../../../tests/builders/fake-auth-gateway";
import { anOwnProfile, fakeProfileReader, type FakeProfileReaderOptions } from "../../../tests/builders/fake-profile-reader";
import { fakeQrCodeRepository, type FakeQrCodeRepositoryOptions } from "../../../tests/builders/fake-qr-code-repository";
import { anOwnQrCode, BRANDED_QR_STYLE, LOGO_URL, QR_CODE, QR_CODE_URL, QR_SITE_URL, aQrStyle } from "../../../tests/builders/qr";

const AUTHENTICATED = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });

function harness(
  overrides: { auth?: FakeAuthGatewayOptions; profiles?: FakeProfileReaderOptions; qrCodes?: FakeQrCodeRepositoryOptions } = {},
) {
  const log = makeCallLog();
  const getOwnQrCode = makeGetOwnQrCode({
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    profiles: fakeProfileReader({ log, ...overrides.profiles }),
    qrCodes: fakeQrCodeRepository({ log, ...overrides.qrCodes }),
    siteUrl: QR_SITE_URL,
  });
  return { log, getOwnQrCode };
}

describe("getOwnQrCode", () => {
  it("criterion 1: session → own profile → ensure_qr_code → { code, url: ${SITE_URL}/q/{code}, style, logoUrl }", async () => {
    const { log, getOwnQrCode } = harness();

    expect(await getOwnQrCode()).toStrictEqual(ok({ code: QR_CODE, url: QR_CODE_URL, style: aQrStyle(), logoUrl: null }));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "profiles.getOwn", "qrCodes.ensureOwn"]);
  });

  it("criterion 1: opened twice → the same code and URL (ensure_qr_code is idempotent)", async () => {
    const { log, getOwnQrCode } = harness();

    const first = await getOwnQrCode();
    const second = await getOwnQrCode();

    expect(second).toStrictEqual(first);
    expect(log.sequence().filter((name) => name === "qrCodes.ensureOwn")).toHaveLength(2);
  });

  it("the saved style is returned as stored", async () => {
    const { getOwnQrCode } = harness({ qrCodes: { ensureResults: [ok(anOwnQrCode({ style: BRANDED_QR_STYLE }))] } });

    const result = await getOwnQrCode();

    expect(result.ok && result.value.style).toStrictEqual(BRANDED_QR_STYLE);
  });

  it("criterion 3: the profile's logo URL is handed to the page (option enabled)", async () => {
    const { getOwnQrCode } = harness({ profiles: { results: [ok(anOwnProfile({ logoUrl: LOGO_URL }))] } });

    const result = await getOwnQrCode();

    expect(result.ok && result.value.logoUrl).toBe(LOGO_URL);
  });

  it("criterion 3: no logo_url → logoUrl null (option disabled)", async () => {
    const { getOwnQrCode } = harness();

    const result = await getOwnQrCode();

    expect(result.ok && result.value.logoUrl).toBeNull();
  });

  it("criterion 5: no session → err('unauthenticated'), nothing read nor created", async () => {
    const { log, getOwnQrCode } = harness({ auth: { currentUser: ok(null) } });

    expect(await getOwnQrCode()).toStrictEqual(err("unauthenticated"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("GoTrue unreachable → err('unexpected'), nothing read nor created", async () => {
    const { log, getOwnQrCode } = harness({ auth: { currentUser: err("unexpected") } });

    expect(await getOwnQrCode()).toStrictEqual(err("unexpected"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("criterion 7: account of another project (no carnet profile) → err('no_profile'), no QR created", async () => {
    const { log, getOwnQrCode } = harness({ profiles: { results: [ok(null)] } });

    expect(await getOwnQrCode()).toStrictEqual(err("no_profile"));
    expect(log.inputsOf("qrCodes", "ensureOwn")).toStrictEqual([]);
  });

  it("criterion 7: the database refuses the caller (42501 → no_profile) → err('no_profile')", async () => {
    const { getOwnQrCode } = harness({ qrCodes: { ensureResults: [err("no_profile")] } });

    expect(await getOwnQrCode()).toStrictEqual(err("no_profile"));
  });

  it("profile read failure → err('unexpected'), no QR created", async () => {
    const { log, getOwnQrCode } = harness({ profiles: { results: [err("unexpected")] } });

    expect(await getOwnQrCode()).toStrictEqual(err("unexpected"));
    expect(log.inputsOf("qrCodes", "ensureOwn")).toStrictEqual([]);
  });

  it("ensure_qr_code failure → err('unexpected')", async () => {
    const { getOwnQrCode } = harness({ qrCodes: { ensureResults: [err("unexpected")] } });

    expect(await getOwnQrCode()).toStrictEqual(err("unexpected"));
  });
});
