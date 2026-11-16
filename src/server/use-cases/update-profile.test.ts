/**
 * Contract frozen by test-engineer (0017, decisions 1, 3, 5 and 8).
 *
 * // src/domain/shared/rate-limits.ts — new scope
 * export type RateLimitScope = "signup" | "login" | "login-account" | "profile-write";
 * // RATE_LIMITS["profile-write"] = { limit: 60, windowSeconds: 3600 }  (subject: the account id, shared by every profile write)
 *
 * // src/domain/profile/ports.ts — additions
 * export type ProfileWriteError = "not_found" | "invalid_input" | "unexpected";
 * export interface ProfileWriter {
 *   // Full update of `profileId` under the session (RLS). No row updated (not the caller's, RLS) → not_found;
 *   // 23514 (CHECK of carnet.profiles) → invalid_input; anything else → unexpected.
 *   update(profileId: string, update: ProfileUpdate): Promise<Result<void, ProfileWriteError>>;
 * }
 *
 * // src/server/use-cases/update-profile.ts
 * export type UpdateProfileError = "unauthenticated" | "not_found" | "rate_limited" | "invalid_input" | "unexpected";
 * export type UpdateProfile = (update: ProfileUpdate) => Promise<Result<{ profileId: string; slug: string }, UpdateProfileError>>;
 * export function makeUpdateProfile(deps: {
 *   auth: AuthGateway; rateLimiter: RateLimiter; profiles: ProfileReader; writer: ProfileWriter;
 * }): UpdateProfile;
 * // Order: auth.currentUser (authenticate, GoTrue getUser) → rateLimiter.consume("profile-write", userId)
 * //        → profiles.getOwn (authorize: the profile of the account, never an id sent by the client)
 * //        → writer.update(own.id, update) → ok({ profileId: own.id, slug: own.slug })
 * //        (decision 10: the action calls updateTag("profile:<slug>"); the slug is the one read by getOwn, never sent by the
 * //        client; profileId is kept for the integration tests and the logs).
 * // currentUser null → unauthenticated; no own profile (account of another project) → not_found;
 * // limiter refusal → rate_limited, limiter failure → unexpected (fail closed).
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeUpdateProfile } from "@/server/use-cases/update-profile";

import { makeCallLog } from "../../../tests/builders/call-log";
import {
  fakeAuthGateway,
  GATEWAY_USER_EMAIL,
  GATEWAY_USER_ID,
  type FakeAuthGatewayOptions,
} from "../../../tests/builders/fake-auth-gateway";
import {
  anOwnProfile,
  fakeProfileReader,
  type FakeProfileReaderOptions,
} from "../../../tests/builders/fake-profile-reader";
import { fakeProfileWriter, type FakeProfileWriterOptions } from "../../../tests/builders/fake-profile-writer";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../tests/builders/fake-rate-limiter";
import { PROFILE_ID } from "../../../tests/builders/fake-registrar";
import { aProfileUpdate } from "../../../tests/builders/profile-update";

const OWN_SLUG = anOwnProfile().slug;
const AUTHENTICATED = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });
const PROFILE_WRITE_CONSUME = { scope: "profile-write", subject: GATEWAY_USER_ID, limit: 60, windowSeconds: 3600 };

function harness(
  overrides: {
    auth?: FakeAuthGatewayOptions;
    limiter?: FakeRateLimiterOptions;
    profiles?: FakeProfileReaderOptions;
    writer?: FakeProfileWriterOptions;
  } = {},
) {
  const log = makeCallLog();
  const updateProfile = makeUpdateProfile({
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    rateLimiter: fakeRateLimiter({ log, ...overrides.limiter }),
    profiles: fakeProfileReader({ log, ...overrides.profiles }),
    writer: fakeProfileWriter({ log, ...overrides.writer }),
  });

  return { log, updateProfile };
}

describe("updateProfile", () => {
  it("criterion 1 (success): authenticate → rate limit → own profile → full update of that profile → ok({ profileId, slug })", async () => {
    const update = aProfileUpdate();
    const { log, updateProfile } = harness();

    expect(await updateProfile(update)).toStrictEqual(ok({ profileId: PROFILE_ID, slug: OWN_SLUG }));
    expect(log.sequence()).toStrictEqual([
      "auth.currentUser",
      "rateLimiter.consume",
      "profiles.getOwn",
      "writer.update",
    ]);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([PROFILE_WRITE_CONSUME]);
    expect(log.inputsOf("writer", "update")).toStrictEqual([{ profileId: PROFILE_ID, update }]);
  });

  it("criterion 1 (unauthenticated): no session → err('unauthenticated'), nothing consumed, read nor written", async () => {
    const { log, updateProfile } = harness({ auth: { currentUser: ok(null) } });

    expect(await updateProfile(aProfileUpdate())).toStrictEqual(err("unauthenticated"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("GoTrue unreachable (currentUser 'unexpected') → err('unexpected'), nothing written", async () => {
    const { log, updateProfile } = harness({ auth: { currentUser: err("unexpected") } });

    expect(await updateProfile(aProfileUpdate())).toStrictEqual(err("unexpected"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("criterion 1 (another account's profile): an account without a carnet profile (another project) → err('not_found'), nothing written", async () => {
    const { log, updateProfile } = harness({ profiles: { results: [ok(null)] } });

    expect(await updateProfile(aProfileUpdate())).toStrictEqual(err("not_found"));
    expect(log.inputsOf("writer", "update")).toStrictEqual([]);
  });

  it("criterion 1 (another account's profile): the row is not editable under RLS (writer 'not_found') → err('not_found')", async () => {
    const { updateProfile } = harness({ writer: { results: [err("not_found")] } });

    expect(await updateProfile(aProfileUpdate())).toStrictEqual(err("not_found"));
  });

  it("criterion 1 (invalid input): a CHECK constraint of carnet.profiles refuses the row (writer 'invalid_input') → err('invalid_input')", async () => {
    const { updateProfile } = harness({ writer: { results: [err("invalid_input")] } });

    expect(await updateProfile(aProfileUpdate())).toStrictEqual(err("invalid_input"));
  });

  it("criterion 1 (repository failure): writer 'unexpected' → err('unexpected')", async () => {
    const { updateProfile } = harness({ writer: { results: [err("unexpected")] } });

    expect(await updateProfile(aProfileUpdate())).toStrictEqual(err("unexpected"));
  });

  it("criterion 1 (repository failure): reader 'unexpected' → err('unexpected'), nothing written", async () => {
    const { log, updateProfile } = harness({ profiles: { results: [err("unexpected")] } });

    expect(await updateProfile(aProfileUpdate())).toStrictEqual(err("unexpected"));
    expect(log.inputsOf("writer", "update")).toStrictEqual([]);
  });

  it("decision 8: the 61st write of the hour (profile-write exhausted) → err('rate_limited') before any read or write", async () => {
    const { log, updateProfile } = harness({ limiter: { deny: ["profile-write"] } });

    expect(await updateProfile(aProfileUpdate())).toStrictEqual(err("rate_limited"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "rateLimiter.consume"]);
  });

  it("decision 8: rate limiter unavailable → err('unexpected') (fail closed), nothing written", async () => {
    const { log, updateProfile } = harness({ limiter: { failing: true } });

    expect(await updateProfile(aProfileUpdate())).toStrictEqual(err("unexpected"));
    expect(log.inputsOf("writer", "update")).toStrictEqual([]);
  });

  it("decision 10: returns the slug read by getOwn (the action tags profile:<slug>), not a value from the update", async () => {
    const { updateProfile } = harness({ profiles: { results: [ok(anOwnProfile({ slug: "atelier-merel" }))] } });

    expect(await updateProfile(aProfileUpdate())).toStrictEqual(ok({ profileId: PROFILE_ID, slug: "atelier-merel" }));
  });

  it("replayed: the same update twice sends the same full update twice (no relative change) and gives the same result", async () => {
    const update = aProfileUpdate({ isPublished: false, bio: null });
    const { log, updateProfile } = harness();

    const first = await updateProfile(update);
    const second = await updateProfile(update);

    expect(second).toStrictEqual(first);
    expect(log.inputsOf("writer", "update")).toStrictEqual([
      { profileId: PROFILE_ID, update },
      { profileId: PROFILE_ID, update },
    ]);
  });
});
