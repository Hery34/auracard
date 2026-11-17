/**
 * Contract frozen by test-engineer (0026, decisions 4, 5 and 7; criteria 2, 5 and 7).
 *
 * // src/server/use-cases/save-qr-style.ts
 * export type SaveQrStyleError =
 *   | QrColorError                       // "invalid_color" | "not_darker" | "low_contrast" (domain, before any call)
 *   | "unauthenticated" | "rate_limited" | "no_profile" | "invalid" | "unexpected";
 * export type SaveQrStyle = (style: QrStyle) => Promise<Result<void, SaveQrStyleError>>;
 * export function makeSaveQrStyle(deps: {
 *   auth: AuthGateway; rateLimiter: RateLimiter; profiles: ProfileReader; qrCodes: QrCodeRepository;
 * }): SaveQrStyle;
 * // Order: checkQrColors(fg, bg) — refused → err(<that rule>) with NO port call at all (no session read, no counter);
 * //   then authorizeProfileWrite (auth.currentUser → rateLimiter.consume("profile-write", userId) → profiles.getOwn;
 * //   not_found → no_profile) → qrCodes.setStyle({ fg, bg, logo }) as given.
 * //   setStyle: ok → ok(undefined); no_profile (42501) → no_profile; invalid (22023) → invalid; unexpected → unexpected.
 * // Replay of an identical style: success again (the database writes nothing the second time).
 * // The logo flag is stored as given; the page only draws the logo when the profile has a logo_url.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSaveQrStyle } from "@/server/use-cases/save-qr-style";

import { makeCallLog } from "../../../tests/builders/call-log";
import { fakeAuthGateway, GATEWAY_USER_EMAIL, GATEWAY_USER_ID, type FakeAuthGatewayOptions } from "../../../tests/builders/fake-auth-gateway";
import { fakeProfileReader, type FakeProfileReaderOptions } from "../../../tests/builders/fake-profile-reader";
import { fakeQrCodeRepository, type FakeQrCodeRepositoryOptions } from "../../../tests/builders/fake-qr-code-repository";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../tests/builders/fake-rate-limiter";
import { anOwnQrCode, aQrStyle, BRANDED_QR_STYLE, REFUSED_QR_COLOR_PAIRS } from "../../../tests/builders/qr";

const AUTHENTICATED = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });
const PROFILE_WRITE_CONSUME = { scope: "profile-write", subject: GATEWAY_USER_ID, limit: 60, windowSeconds: 3600 };

function harness(
  overrides: {
    auth?: FakeAuthGatewayOptions;
    limiter?: FakeRateLimiterOptions;
    profiles?: FakeProfileReaderOptions;
    qrCodes?: FakeQrCodeRepositoryOptions;
  } = {},
) {
  const log = makeCallLog();
  const saveQrStyle = makeSaveQrStyle({
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    rateLimiter: fakeRateLimiter({ log, ...overrides.limiter }),
    profiles: fakeProfileReader({ log, ...overrides.profiles }),
    qrCodes: fakeQrCodeRepository({ log, ...overrides.qrCodes }),
  });
  return { log, saveQrStyle };
}

describe("saveQrStyle", () => {
  it("decision 7: valid style → session → profile-write → own profile → set_qr_style(style) → ok", async () => {
    const { log, saveQrStyle } = harness();

    expect(await saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(ok(undefined));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "rateLimiter.consume", "profiles.getOwn", "qrCodes.setStyle"]);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([PROFILE_WRITE_CONSUME]);
    expect(log.inputsOf("qrCodes", "setStyle")).toStrictEqual([BRANDED_QR_STYLE]);
  });

  it("idempotence: the same style saved twice → ok twice (the database writes nothing the second time)", async () => {
    const stored = ok(anOwnQrCode({ style: BRANDED_QR_STYLE }));
    const { log, saveQrStyle } = harness({ qrCodes: { setStyleResults: [stored, stored] } });

    expect(await saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(ok(undefined));
    expect(await saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(ok(undefined));
    expect(log.inputsOf("qrCodes", "setStyle")).toStrictEqual([BRANDED_QR_STYLE, BRANDED_QR_STYLE]);
  });

  it.each(REFUSED_QR_COLOR_PAIRS)(
    "criterion 2: %s → err('%s') by the domain, before any call (no session read, no counter, nothing written)",
    async (_label, fg, bg, error) => {
      const { log, saveQrStyle } = harness();

      expect(await saveQrStyle(aQrStyle({ fg, bg }))).toStrictEqual(err(error));
      expect(log.sequence()).toStrictEqual([]);
    },
  );

  it("criterion 2: refused even without a session (the colour rule comes first, nothing is called)", async () => {
    const { log, saveQrStyle } = harness({ auth: { currentUser: ok(null) } });

    expect(await saveQrStyle(aQrStyle({ fg: "#ffffff", bg: "#000000" }))).toStrictEqual(err("not_darker"));
    expect(log.sequence()).toStrictEqual([]);
  });

  it("the logo flag reaches set_qr_style as given", async () => {
    const { log, saveQrStyle } = harness();

    await saveQrStyle(aQrStyle({ logo: true }));
    await saveQrStyle(aQrStyle({ logo: false }));

    expect(log.inputsOf("qrCodes", "setStyle")).toStrictEqual([aQrStyle({ logo: true }), aQrStyle({ logo: false })]);
  });

  it("decision 7: the database refuses the style (22023) → err('invalid')", async () => {
    const { saveQrStyle } = harness({ qrCodes: { setStyleResults: [err("invalid")] } });

    expect(await saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(err("invalid"));
  });

  it("criterion 7: the database refuses the caller (42501) → err('no_profile')", async () => {
    const { saveQrStyle } = harness({ qrCodes: { setStyleResults: [err("no_profile")] } });

    expect(await saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(err("no_profile"));
  });

  it("repository failure → err('unexpected')", async () => {
    const { saveQrStyle } = harness({ qrCodes: { setStyleResults: [err("unexpected")] } });

    expect(await saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(err("unexpected"));
  });

  describe("authorization (criteria 5 and 7)", () => {
    it("criterion 5: no session → err('unauthenticated'), nothing written", async () => {
      const { log, saveQrStyle } = harness({ auth: { currentUser: ok(null) } });

      expect(await saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(err("unauthenticated"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
    });

    it("GoTrue unreachable → err('unexpected'), nothing written", async () => {
      const { log, saveQrStyle } = harness({ auth: { currentUser: err("unexpected") } });

      expect(await saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(err("unexpected"));
      expect(log.inputsOf("qrCodes", "setStyle")).toStrictEqual([]);
    });

    it("decision 7: profile-write exhausted → err('rate_limited'), nothing written", async () => {
      const { log, saveQrStyle } = harness({ limiter: { deny: ["profile-write"] } });

      expect(await saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(err("rate_limited"));
      expect(log.inputsOf("qrCodes", "setStyle")).toStrictEqual([]);
    });

    it("counter storage unavailable → err('unexpected'), nothing written", async () => {
      const { log, saveQrStyle } = harness({ limiter: { failing: true } });

      expect(await saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(err("unexpected"));
      expect(log.inputsOf("qrCodes", "setStyle")).toStrictEqual([]);
    });

    it("criterion 7: account of another project (no carnet profile) → err('no_profile'), nothing written", async () => {
      const { log, saveQrStyle } = harness({ profiles: { results: [ok(null)] } });

      expect(await saveQrStyle(BRANDED_QR_STYLE)).toStrictEqual(err("no_profile"));
      expect(log.inputsOf("qrCodes", "setStyle")).toStrictEqual([]);
    });
  });
});
