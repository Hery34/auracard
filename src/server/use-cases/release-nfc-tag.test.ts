/**
 * Contract frozen by test-engineer (0025, decision 8; 0024 decision 10: `release` replayed → false treated as success).
 *
 * // src/server/use-cases/release-nfc-tag.ts
 * export type ReleaseNfcTagError = "unauthenticated" | "not_found" | "rate_limited" | "unexpected";
 * export type ReleaseNfcTag = (tagId: string) => Promise<Result<void, ReleaseNfcTagError>>;
 * export function makeReleaseNfcTag(deps: {
 *   auth: AuthGateway; rateLimiter: RateLimiter; profiles: ProfileReader; tags: NfcTagRepository;
 * }): ReleaseNfcTag;
 * // Order: authorizeProfileWrite (auth.currentUser → rateLimiter.consume("profile-write", userId) → profiles.getOwn)
 * //   → tags.release(tagId): true or false → ok(undefined) (false: already released, or not the caller's: nothing
 * //   done, nothing revealed); not_member → not_found; unexpected → unexpected.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeReleaseNfcTag } from "@/server/use-cases/release-nfc-tag";

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
  const releaseNfcTag = makeReleaseNfcTag({
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    rateLimiter: fakeRateLimiter({ log, ...overrides.limiter }),
    profiles: fakeProfileReader({ log, ...overrides.profiles }),
    tags: fakeNfcTagRepository({ log, ...overrides.tags }),
  });
  return { log, releaseNfcTag };
}

describe("releaseNfcTag", () => {
  it("criterion 5: session → profile-write → own profile → release_nfc_tag(tagId) → ok", async () => {
    const { log, releaseNfcTag } = harness();

    expect(await releaseNfcTag(TAG_ID)).toStrictEqual(ok(undefined));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "rateLimiter.consume", "profiles.getOwn", "nfcTags.release"]);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([PROFILE_WRITE_CONSUME]);
    expect(log.inputsOf("nfcTags", "release")).toStrictEqual([TAG_ID]);
  });

  it("idempotence: executed twice (true then false) → ok twice, false at replay treated as success", async () => {
    const { log, releaseNfcTag } = harness({ tags: { releaseResults: [ok(true), ok(false)] } });

    const first = await releaseNfcTag(TAG_ID);
    const second = await releaseNfcTag(TAG_ID);

    expect(first).toStrictEqual(ok(undefined));
    expect(second).toStrictEqual(first);
    expect(log.inputsOf("nfcTags", "release")).toStrictEqual([TAG_ID, TAG_ID]);
  });

  it("the database refuses the caller as a non-member (not_member) → err('not_found')", async () => {
    const { releaseNfcTag } = harness({ tags: { releaseResults: [err("not_member")] } });

    expect(await releaseNfcTag(TAG_ID)).toStrictEqual(err("not_found"));
  });

  it("repository failure → err('unexpected')", async () => {
    const { releaseNfcTag } = harness({ tags: { releaseResults: [err("unexpected")] } });

    expect(await releaseNfcTag(TAG_ID)).toStrictEqual(err("unexpected"));
  });

  describe("authorization", () => {
    it("no session → err('unauthenticated'), nothing written", async () => {
      const { log, releaseNfcTag } = harness({ auth: { currentUser: ok(null) } });

      expect(await releaseNfcTag(TAG_ID)).toStrictEqual(err("unauthenticated"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
    });

    it("profile-write exhausted → err('rate_limited'), nothing written", async () => {
      const { log, releaseNfcTag } = harness({ limiter: { deny: ["profile-write"] } });

      expect(await releaseNfcTag(TAG_ID)).toStrictEqual(err("rate_limited"));
      expect(log.inputsOf("nfcTags", "release")).toStrictEqual([]);
    });

    it("account of another project (no carnet profile) → err('not_found'), nothing written", async () => {
      const { log, releaseNfcTag } = harness({ profiles: { results: [ok(null)] } });

      expect(await releaseNfcTag(TAG_ID)).toStrictEqual(err("not_found"));
      expect(log.inputsOf("nfcTags", "release")).toStrictEqual([]);
    });
  });
});
