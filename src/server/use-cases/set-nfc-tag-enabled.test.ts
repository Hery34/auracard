/**
 * Contract frozen by test-engineer (0025, decision 8; 0024 decision 6: set_nfc_tag_enabled is idempotent).
 *
 * // src/server/use-cases/set-nfc-tag-enabled.ts
 * export type SetNfcTagEnabledError = "unauthenticated" | "not_found" | "rate_limited" | "unexpected";
 * export type SetNfcTagEnabled = (input: { tagId: string; enabled: boolean }) =>
 *   Promise<Result<void, SetNfcTagEnabledError>>;
 * export function makeSetNfcTagEnabled(deps: {
 *   auth: AuthGateway; rateLimiter: RateLimiter; profiles: ProfileReader; tags: NfcTagRepository;
 * }): SetNfcTagEnabled;
 * // Order: authorizeProfileWrite (auth.currentUser → rateLimiter.consume("profile-write", userId) → profiles.getOwn)
 * //   → tags.setEnabled(tagId, enabled): true → ok(undefined); false (absent or someone else's) → not_found;
 * //   not_member → not_found; unexpected → unexpected.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSetNfcTagEnabled } from "@/server/use-cases/set-nfc-tag-enabled";

import { makeCallLog } from "../../../tests/builders/call-log";
import { fakeAuthGateway, GATEWAY_USER_EMAIL, GATEWAY_USER_ID, type FakeAuthGatewayOptions } from "../../../tests/builders/fake-auth-gateway";
import { fakeNfcTagRepository, type FakeNfcTagRepositoryOptions } from "../../../tests/builders/fake-nfc-tag-repository";
import { fakeProfileReader, type FakeProfileReaderOptions } from "../../../tests/builders/fake-profile-reader";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../tests/builders/fake-rate-limiter";
import { TAG_ID } from "../../../tests/builders/nfc";

const AUTHENTICATED = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });
const PROFILE_WRITE_CONSUME = { scope: "profile-write", subject: GATEWAY_USER_ID, limit: 60, windowSeconds: 3600 };

function harness(
  overrides: {
    auth?: FakeAuthGatewayOptions;
    limiter?: FakeRateLimiterOptions;
    profiles?: FakeProfileReaderOptions;
    tags?: FakeNfcTagRepositoryOptions;
  } = {},
) {
  const log = makeCallLog();
  const setNfcTagEnabled = makeSetNfcTagEnabled({
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    rateLimiter: fakeRateLimiter({ log, ...overrides.limiter }),
    profiles: fakeProfileReader({ log, ...overrides.profiles }),
    tags: fakeNfcTagRepository({ log, ...overrides.tags }),
  });
  return { log, setNfcTagEnabled };
}

describe("setNfcTagEnabled", () => {
  it.each([false, true])(
    "criterion 5: enabled=%s → session → profile-write → own profile → set_nfc_tag_enabled(tagId, enabled) → ok",
    async (enabled) => {
      const { log, setNfcTagEnabled } = harness();

      expect(await setNfcTagEnabled({ tagId: TAG_ID, enabled })).toStrictEqual(ok(undefined));
      expect(log.sequence()).toStrictEqual([
        "auth.currentUser",
        "rateLimiter.consume",
        "profiles.getOwn",
        "nfcTags.setEnabled",
      ]);
      expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([PROFILE_WRITE_CONSUME]);
      expect(log.inputsOf("nfcTags", "setEnabled")).toStrictEqual([{ tagId: TAG_ID, enabled }]);
    },
  );

  it("idempotence: disabled twice → ok twice (the database answers true when already in the target state)", async () => {
    const { setNfcTagEnabled } = harness({ tags: { setEnabledResults: [ok(true), ok(true)] } });

    expect(await setNfcTagEnabled({ tagId: TAG_ID, enabled: false })).toStrictEqual(ok(undefined));
    expect(await setNfcTagEnabled({ tagId: TAG_ID, enabled: false })).toStrictEqual(ok(undefined));
  });

  it("criterion 5: a tag of another member or unknown (false) → err('not_found')", async () => {
    const { setNfcTagEnabled } = harness({ tags: { setEnabledResults: [ok(false)] } });

    expect(await setNfcTagEnabled({ tagId: TAG_ID, enabled: false })).toStrictEqual(err("not_found"));
  });

  it("the database refuses the caller as a non-member (not_member) → err('not_found')", async () => {
    const { setNfcTagEnabled } = harness({ tags: { setEnabledResults: [err("not_member")] } });

    expect(await setNfcTagEnabled({ tagId: TAG_ID, enabled: true })).toStrictEqual(err("not_found"));
  });

  it("repository failure → err('unexpected')", async () => {
    const { setNfcTagEnabled } = harness({ tags: { setEnabledResults: [err("unexpected")] } });

    expect(await setNfcTagEnabled({ tagId: TAG_ID, enabled: true })).toStrictEqual(err("unexpected"));
  });

  describe("authorization", () => {
    it("no session → err('unauthenticated'), nothing written", async () => {
      const { log, setNfcTagEnabled } = harness({ auth: { currentUser: ok(null) } });

      expect(await setNfcTagEnabled({ tagId: TAG_ID, enabled: false })).toStrictEqual(err("unauthenticated"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
    });

    it("profile-write exhausted → err('rate_limited'), nothing written", async () => {
      const { log, setNfcTagEnabled } = harness({ limiter: { deny: ["profile-write"] } });

      expect(await setNfcTagEnabled({ tagId: TAG_ID, enabled: false })).toStrictEqual(err("rate_limited"));
      expect(log.inputsOf("nfcTags", "setEnabled")).toStrictEqual([]);
    });

    it("account of another project (no carnet profile) → err('not_found'), nothing written", async () => {
      const { log, setNfcTagEnabled } = harness({ profiles: { results: [ok(null)] } });

      expect(await setNfcTagEnabled({ tagId: TAG_ID, enabled: false })).toStrictEqual(err("not_found"));
      expect(log.inputsOf("nfcTags", "setEnabled")).toStrictEqual([]);
    });
  });
});
