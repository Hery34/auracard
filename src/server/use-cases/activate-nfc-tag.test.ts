/**
 * Contract frozen by test-engineer (0025, decisions 4 and 6; 0024 decisions 6 and 9).
 * Ports: AuthGateway, MembershipReader, RateLimiter, NfcTagRepository (see src/domain/nfc/nfc-tag.test.ts).
 *
 * // src/domain/shared/rate-limits.ts — RateLimitScope gains "nfc-activate": { limit: 30, windowSeconds: 3600 } (address).
 *
 * // src/server/use-cases/activate-nfc-tag.ts
 * export type ActivateNfcTagInput = { uid: string; code: string; clientAddress: string };
 * export type ActivateNfcTagError = "unauthenticated" | "no_profile" | "rate_limited" | "invalid" | "unexpected";
 * export type ActivateNfcTag = (input: ActivateNfcTagInput) =>
 *   Promise<Result<"activated" | "already_yours", ActivateNfcTagError>>;
 * export function makeActivateNfcTag(deps: {
 *   auth: AuthGateway; membership: MembershipReader; rateLimiter: RateLimiter; tags: NfcTagRepository;
 * }): ActivateNfcTag;
 *
 * // Order: auth.currentUser (null → unauthenticated; failure → unexpected)
 * //   → membership.isMember (false → no_profile: an account of another project; failure → unexpected)
 * //   → rateLimiter.consume("nfc-activate", clientAddress) (refused → rate_limited; failure → unexpected)
 * //   → uid not isNfcTagUid or normalizeActivationCode(code) === null → invalid, without calling the repository
 * //   → tags.activate(uid, normalized code)
 * //   → activated | already_yours → ok(outcome); invalid | no_profile | rate_limited (per-account counter of the
 * //     database) → err(outcome); repository not_member → no_profile; repository unexpected → unexpected.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeActivateNfcTag } from "@/server/use-cases/activate-nfc-tag";

import { makeCallLog } from "../../../tests/builders/call-log";
import {
  fakeAuthGateway,
  GATEWAY_USER_EMAIL,
  GATEWAY_USER_ID,
  type FakeAuthGatewayOptions,
} from "../../../tests/builders/fake-auth-gateway";
import { fakeMembershipReader, type FakeMembershipReaderOptions } from "../../../tests/builders/fake-membership-reader";
import { fakeNfcTagRepository, type FakeNfcTagRepositoryOptions } from "../../../tests/builders/fake-nfc-tag-repository";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../tests/builders/fake-rate-limiter";
import {
  ACTIVATION_CODE,
  CLIENT_ADDRESS,
  MALFORMED_TAG_UIDS,
  NORMALIZED_ACTIVATION_CODE,
  TAG_UID,
} from "../../../tests/builders/nfc";

const AUTHENTICATED = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });
const NFC_ACTIVATE_CONSUME = { scope: "nfc-activate", subject: CLIENT_ADDRESS, limit: 30, windowSeconds: 3600 };
const INPUT = { uid: TAG_UID, code: ACTIVATION_CODE, clientAddress: CLIENT_ADDRESS };

function harness(
  overrides: {
    auth?: FakeAuthGatewayOptions;
    membership?: FakeMembershipReaderOptions;
    limiter?: FakeRateLimiterOptions;
    tags?: FakeNfcTagRepositoryOptions;
  } = {},
) {
  const log = makeCallLog();
  const activateNfcTag = makeActivateNfcTag({
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    membership: fakeMembershipReader({ log, results: [ok(true)], ...overrides.membership }),
    rateLimiter: fakeRateLimiter({ log, ...overrides.limiter }),
    tags: fakeNfcTagRepository({ log, ...overrides.tags }),
  });
  return { log, activateNfcTag };
}

describe("activateNfcTag", () => {
  it("criterion 2: session → membership → nfc-activate counter of the address (30/h) → activate_nfc_tag(uid, normalized code) → ok('activated')", async () => {
    const { log, activateNfcTag } = harness();

    expect(await activateNfcTag(INPUT)).toStrictEqual(ok("activated"));
    expect(log.sequence()).toStrictEqual([
      "auth.currentUser",
      "membership.isMember",
      "rateLimiter.consume",
      "nfcTags.activate",
    ]);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([NFC_ACTIVATE_CONSUME]);
    expect(log.inputsOf("nfcTags", "activate")).toStrictEqual([{ uid: TAG_UID, code: NORMALIZED_ACTIVATION_CODE }]);
  });

  it.each([
    ["lower case", "abcde-fgh23"],
    ["without hyphen", "ABCDEFGH23"],
    ["mixed case without hyphen, surrounding spaces", "  aBcDeFgH23 "],
  ])("criterion 2: code typed in %s → the same normalized code reaches the database", async (_label, code) => {
    const { log, activateNfcTag } = harness();

    expect(await activateNfcTag({ ...INPUT, code })).toStrictEqual(ok("activated"));
    expect(log.inputsOf("nfcTags", "activate")).toStrictEqual([{ uid: TAG_UID, code: NORMALIZED_ACTIVATION_CODE }]);
  });

  it("criterion 2: already on the caller's profile → ok('already_yours') (same success as the first time)", async () => {
    const { activateNfcTag } = harness({ tags: { activateResults: [ok("already_yours")] } });

    expect(await activateNfcTag(INPUT)).toStrictEqual(ok("already_yours"));
  });

  it("criterion 2 (replay): executed twice → activated then already_yours, both successes, two attempts counted", async () => {
    const { log, activateNfcTag } = harness({ tags: { activateResults: [ok("activated"), ok("already_yours")] } });

    const first = await activateNfcTag(INPUT);
    const second = await activateNfcTag(INPUT);

    expect(first).toStrictEqual(ok("activated"));
    expect(second).toStrictEqual(ok("already_yours"));
    expect(log.inputsOf("nfcTags", "activate")).toHaveLength(2);
    expect(log.inputsOf("rateLimiter", "consume")).toHaveLength(2);
  });

  it("criterion 3: wrong code, unknown tag, someone else's or disabled tag (database answer invalid) → err('invalid')", async () => {
    const { activateNfcTag } = harness({ tags: { activateResults: [ok("invalid")] } });

    expect(await activateNfcTag(INPUT)).toStrictEqual(err("invalid"));
  });

  it("criterion 3: 11th attempt of the account in the hour (database answer rate_limited) → err('rate_limited')", async () => {
    const { activateNfcTag } = harness({ tags: { activateResults: [ok("rate_limited")] } });

    expect(await activateNfcTag(INPUT)).toStrictEqual(err("rate_limited"));
  });

  it("criterion 3: 31st attempt from the address (nfc-activate refused) → err('rate_limited') without calling the database function", async () => {
    const { log, activateNfcTag } = harness({ limiter: { deny: ["nfc-activate"] } });

    expect(await activateNfcTag(INPUT)).toStrictEqual(err("rate_limited"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "membership.isMember", "rateLimiter.consume"]);
  });

  it("failing limiter → err('unexpected') without calling the database function (the door closes)", async () => {
    const { log, activateNfcTag } = harness({ limiter: { failing: true } });

    expect(await activateNfcTag(INPUT)).toStrictEqual(err("unexpected"));
    expect(log.inputsOf("nfcTags", "activate")).toStrictEqual([]);
  });

  it("member without profile (database answer no_profile) → err('no_profile')", async () => {
    const { activateNfcTag } = harness({ tags: { activateResults: [ok("no_profile")] } });

    expect(await activateNfcTag(INPUT)).toStrictEqual(err("no_profile"));
  });

  it("account of another project (not a member) → err('no_profile') before any counter and any database call", async () => {
    const { log, activateNfcTag } = harness({ membership: { results: [ok(false)] } });

    expect(await activateNfcTag(INPUT)).toStrictEqual(err("no_profile"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "membership.isMember"]);
  });

  it("the database refuses the caller as a non-member (42501 → not_member) → err('no_profile')", async () => {
    const { activateNfcTag } = harness({ tags: { activateResults: [err("not_member")] } });

    expect(await activateNfcTag(INPUT)).toStrictEqual(err("no_profile"));
  });

  it("membership unreadable → err('unexpected'), nothing consumed", async () => {
    const { log, activateNfcTag } = harness({ membership: { results: [err("unexpected")] } });

    expect(await activateNfcTag(INPUT)).toStrictEqual(err("unexpected"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "membership.isMember"]);
  });

  it("no session → err('unauthenticated'), nothing else called", async () => {
    const { log, activateNfcTag } = harness({ auth: { currentUser: ok(null) } });

    expect(await activateNfcTag(INPUT)).toStrictEqual(err("unauthenticated"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("GoTrue unreachable → err('unexpected'), nothing else called", async () => {
    const { log, activateNfcTag } = harness({ auth: { currentUser: err("unexpected") } });

    expect(await activateNfcTag(INPUT)).toStrictEqual(err("unexpected"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("repository failure → err('unexpected')", async () => {
    const { activateNfcTag } = harness({ tags: { activateResults: [err("unexpected")] } });

    expect(await activateNfcTag(INPUT)).toStrictEqual(err("unexpected"));
  });

  it.each(MALFORMED_TAG_UIDS)(
    "uid with %s → err('invalid') after the address counter, without calling the database function",
    async (_label, uid) => {
      const { log, activateNfcTag } = harness();

      expect(await activateNfcTag({ ...INPUT, uid })).toStrictEqual(err("invalid"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser", "membership.isMember", "rateLimiter.consume"]);
    },
  );

  it.each([
    ["empty", ""],
    ["9 characters", "ABCDE-FGH2"],
    ["a letter outside the alphabet", "ABCDE-FGHO3"],
    ["an SQL fragment", "' or 1=1 --"],
  ])("malformed code (%s) → err('invalid') after the address counter, without calling the database function", async (_label, code) => {
    const { log, activateNfcTag } = harness();

    expect(await activateNfcTag({ ...INPUT, code })).toStrictEqual(err("invalid"));
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([NFC_ACTIVATE_CONSUME]);
    expect(log.inputsOf("nfcTags", "activate")).toStrictEqual([]);
  });
});
