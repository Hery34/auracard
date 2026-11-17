/**
 * Contract frozen by test-engineer (0023, decisions 2 to 4; ADR 0011 amendment of 17/11/2026).
 *
 * // src/server/use-cases/delete-account.ts
 * export type DeleteAccountError = "unauthenticated" | "rate_limited" | "unexpected";
 * export type DeleteAccount = () => Promise<Result<void, DeleteAccountError>>;
 * export function makeDeleteAccount(deps: {
 *   auth: AuthGateway; rateLimiter: RateLimiter; profiles: ProfileReader;
 *   mediaFolder: MediaFolderCleaner; carnetAccount: CarnetAccountEraser;
 *   instanceAccounts: InstanceAccountRemover; profileCache: PublicProfileCache;
 * }): DeleteAccount;
 * // No input: the account is the one of the session, never an id sent by the client. The confirmation is checked by
 * // the action (isAccountDeletionConfirmed) before the container is built.
 * // Order, each step stopping the chain on failure (err("unexpected"), later steps not called):
 * //   auth.currentUser (null → unauthenticated; err → unexpected)
 * //   → rateLimiter.consume({ scope: "profile-write", subject: userId, limit: 60, windowSeconds: 3600 })
 * //     (refused → rate_limited; err → unexpected)
 * //   → profiles.getOwn (err → unexpected)
 * //   → when a profile exists: mediaFolder.empty(profile.id) — BEFORE the SQL step: the Storage policies need the
 * //     membership and the profile
 * //   → carnetAccount.erase() (always, even without profile: removes a leftover membership); answers the slug of the
 * //     profile it deleted (string | null)
 * //   → when a profile was read: profileCache.expire(profile.slug) — right after the SQL step and EVEN WHEN erase()
 * //     failed (the transaction may be committed while the answer is lost: the replay would read no slug any more)
 * //   → erase() failed → err("unexpected") (only now)
 * //   → when erase() answered a slug not expired yet (profile read as null under RLS, e.g. no carnet membership):
 * //     profileCache.expire(thatSlug). Each distinct slug is expired ONCE per run (same slug read and erased → one call).
 * //   → instanceAccounts.isOrphan(userId) → when true: instanceAccounts.remove(userId)
 * //   → ok(undefined).
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeDeleteAccount } from "@/server/use-cases/delete-account";

import {
  fakeCarnetAccountEraser,
  fakeInstanceAccountRemover,
  fakeMediaFolderCleaner,
  fakePublicProfileCache,
  type FakeCarnetAccountEraserOptions,
  type FakeInstanceAccountRemoverOptions,
  type FakeMediaFolderCleanerOptions,
} from "../../../tests/builders/account";
import { makeCallLog } from "../../../tests/builders/call-log";
import { fakeAuthGateway, GATEWAY_USER_EMAIL, GATEWAY_USER_ID, type FakeAuthGatewayOptions } from "../../../tests/builders/fake-auth-gateway";
import { anOwnProfile, fakeProfileReader, type FakeProfileReaderOptions } from "../../../tests/builders/fake-profile-reader";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../tests/builders/fake-rate-limiter";
import { PROFILE_ID } from "../../../tests/builders/fake-registrar";

const AUTHENTICATED = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });
const PROFILE_WRITE_CONSUME = { scope: "profile-write", subject: GATEWAY_USER_ID, limit: 60, windowSeconds: 3600 };
const SLUG = anOwnProfile().slug;

const FULL_SEQUENCE = [
  "auth.currentUser",
  "rateLimiter.consume",
  "profiles.getOwn",
  "mediaFolder.empty",
  "carnetAccount.erase",
  "profileCache.expire",
  "instanceAccounts.isOrphan",
  "instanceAccounts.remove",
];

function harness(
  overrides: {
    auth?: FakeAuthGatewayOptions;
    limiter?: FakeRateLimiterOptions;
    profiles?: FakeProfileReaderOptions;
    mediaFolder?: FakeMediaFolderCleanerOptions;
    carnetAccount?: FakeCarnetAccountEraserOptions;
    instanceAccounts?: FakeInstanceAccountRemoverOptions;
  } = {},
) {
  const log = makeCallLog();
  const deleteAccount = makeDeleteAccount({
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    rateLimiter: fakeRateLimiter({ log, ...overrides.limiter }),
    profiles: fakeProfileReader({ log, ...overrides.profiles }),
    mediaFolder: fakeMediaFolderCleaner({ log, ...overrides.mediaFolder }),
    carnetAccount: fakeCarnetAccountEraser({ log, ...overrides.carnetAccount }),
    instanceAccounts: fakeInstanceAccountRemover({ log, ...overrides.instanceAccounts }),
    profileCache: fakePublicProfileCache({ log }),
  });
  return { log, deleteAccount };
}

describe("deleteAccount", () => {
  describe("criteria 1 and 2: full deletion", () => {
    it("decision 2: Storage → SQL → cache → orphan check → admin delete, in this order, for the session's account only", async () => {
      const { log, deleteAccount } = harness({ carnetAccount: { results: [ok(SLUG)] } });

      expect(await deleteAccount()).toStrictEqual(ok(undefined));
      expect(log.sequence()).toStrictEqual(FULL_SEQUENCE);
      expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([PROFILE_WRITE_CONSUME]);
      expect(log.inputsOf("mediaFolder", "empty")).toStrictEqual([PROFILE_ID]);
      expect(log.inputsOf("profileCache", "expire")).toStrictEqual([SLUG]);
      expect(log.inputsOf("instanceAccounts", "isOrphan")).toStrictEqual([GATEWAY_USER_ID]);
      expect(log.inputsOf("instanceAccounts", "remove")).toStrictEqual([GATEWAY_USER_ID]);
    });

    it("criterion 2: account still member of another project (not orphan) → ok, auth.users never deleted", async () => {
      const { log, deleteAccount } = harness({ instanceAccounts: { isOrphanResults: [ok(false)] } });

      expect(await deleteAccount()).toStrictEqual(ok(undefined));
      expect(log.sequence()).toStrictEqual(FULL_SEQUENCE.slice(0, -1));
      expect(log.inputsOf("instanceAccounts", "remove")).toStrictEqual([]);
    });
  });

  describe("criterion 3: replay after a cut at each step", () => {
    it("executed twice in a row → ok twice; the second run finds no profile and only re-checks the account", async () => {
      const { log, deleteAccount } = harness({
        profiles: { results: [ok(anOwnProfile()), ok(null)] },
        carnetAccount: { results: [ok(SLUG), ok(null)] },
        instanceAccounts: { isOrphanResults: [ok(true)] },
      });

      const first = await deleteAccount();
      const second = await deleteAccount();

      expect(first).toStrictEqual(ok(undefined));
      expect(second).toStrictEqual(first);
      expect(log.inputsOf("mediaFolder", "empty")).toStrictEqual([PROFILE_ID]);
      expect(log.inputsOf("profileCache", "expire")).toStrictEqual([SLUG]);
      expect(log.inputsOf("carnetAccount", "erase")).toHaveLength(2);
    });

    it("cut during Storage → err('unexpected'), SQL not called; the replay completes everything", async () => {
      const { log, deleteAccount } = harness({ mediaFolder: { results: [err("unexpected"), ok(undefined)] } });

      expect(await deleteAccount()).toStrictEqual(err("unexpected"));
      expect(log.sequence()).toStrictEqual(FULL_SEQUENCE.slice(0, 4));

      expect(await deleteAccount()).toStrictEqual(ok(undefined));
      expect(log.sequence().slice(4)).toStrictEqual(FULL_SEQUENCE);
    });

    it("cut during the SQL step (rolled back) → the slug read is expired anyway, then err('unexpected'), nothing after; the replay completes", async () => {
      const { log, deleteAccount } = harness({ carnetAccount: { results: [err("unexpected"), ok(SLUG)] } });

      expect(await deleteAccount()).toStrictEqual(err("unexpected"));
      expect(log.sequence()).toStrictEqual(FULL_SEQUENCE.slice(0, 6));
      expect(log.inputsOf("profileCache", "expire")).toStrictEqual([SLUG]);

      expect(await deleteAccount()).toStrictEqual(ok(undefined));
      expect(log.sequence().slice(6)).toStrictEqual(FULL_SEQUENCE);
      expect(log.inputsOf("profileCache", "expire")).toStrictEqual([SLUG, SLUG]);
    });

    it("SQL committed but the answer is lost → the slug read is expired before err('unexpected'); the replay (no profile left) completes without slug", async () => {
      const { log, deleteAccount } = harness({
        profiles: { results: [ok(anOwnProfile()), ok(null)] },
        carnetAccount: { results: [err("unexpected"), ok(null)] },
      });

      expect(await deleteAccount()).toStrictEqual(err("unexpected"));
      expect(log.sequence()).toStrictEqual(FULL_SEQUENCE.slice(0, 6));
      expect(log.inputsOf("profileCache", "expire")).toStrictEqual([SLUG]);

      expect(await deleteAccount()).toStrictEqual(ok(undefined));
      expect(log.sequence().slice(6)).toStrictEqual([
        "auth.currentUser",
        "rateLimiter.consume",
        "profiles.getOwn",
        "carnetAccount.erase",
        "instanceAccounts.isOrphan",
        "instanceAccounts.remove",
      ]);
      expect(log.inputsOf("profileCache", "expire")).toStrictEqual([SLUG]);
    });

    it("cut during the orphan check (profile already gone) → the cache was expired before; the replay without profile completes", async () => {
      const { log, deleteAccount } = harness({
        profiles: { results: [ok(anOwnProfile()), ok(null)] },
        carnetAccount: { results: [ok(SLUG), ok(null)] },
        instanceAccounts: { isOrphanResults: [err("unexpected"), ok(true)] },
      });

      expect(await deleteAccount()).toStrictEqual(err("unexpected"));
      expect(log.sequence()).toStrictEqual(FULL_SEQUENCE.slice(0, 7));
      expect(log.inputsOf("profileCache", "expire")).toStrictEqual([SLUG]);

      expect(await deleteAccount()).toStrictEqual(ok(undefined));
      expect(log.sequence().slice(7)).toStrictEqual([
        "auth.currentUser",
        "rateLimiter.consume",
        "profiles.getOwn",
        "carnetAccount.erase",
        "instanceAccounts.isOrphan",
        "instanceAccounts.remove",
      ]);
    });

    it("cut during the admin delete → err('unexpected'); the replay deletes the account", async () => {
      const { log, deleteAccount } = harness({
        profiles: { results: [ok(anOwnProfile()), ok(null)] },
        instanceAccounts: { removeResults: [err("unexpected"), ok(undefined)] },
      });

      expect(await deleteAccount()).toStrictEqual(err("unexpected"));
      expect(await deleteAccount()).toStrictEqual(ok(undefined));
      expect(log.inputsOf("instanceAccounts", "remove")).toStrictEqual([GATEWAY_USER_ID, GATEWAY_USER_ID]);
    });

    it("profile without carnet membership (getOwn → null under RLS) → the slug answered by erase() is expired", async () => {
      const { log, deleteAccount } = harness({ profiles: { results: [ok(null)] }, carnetAccount: { results: [ok("membre-sans-adhesion")] } });

      expect(await deleteAccount()).toStrictEqual(ok(undefined));
      expect(log.sequence()).toStrictEqual([
        "auth.currentUser",
        "rateLimiter.consume",
        "profiles.getOwn",
        "carnetAccount.erase",
        "profileCache.expire",
        "instanceAccounts.isOrphan",
        "instanceAccounts.remove",
      ]);
      expect(log.inputsOf("profileCache", "expire")).toStrictEqual(["membre-sans-adhesion"]);
    });

    it("profile without carnet membership and erase() fails → err('unexpected'), nothing to expire, nothing after", async () => {
      const { log, deleteAccount } = harness({ profiles: { results: [ok(null)] }, carnetAccount: { results: [err("unexpected")] } });

      expect(await deleteAccount()).toStrictEqual(err("unexpected"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser", "rateLimiter.consume", "profiles.getOwn", "carnetAccount.erase"]);
    });

    it("slug read and slug erased identical → expired once only", async () => {
      const { log, deleteAccount } = harness({ carnetAccount: { results: [ok(SLUG)] } });

      await deleteAccount();

      expect(log.inputsOf("profileCache", "expire")).toStrictEqual([SLUG]);
    });

    it("slug read and slug erased different (renamed meanwhile) → both expired, the read one first", async () => {
      const { log, deleteAccount } = harness({ carnetAccount: { results: [ok("nouveau-slug")] } });

      expect(await deleteAccount()).toStrictEqual(ok(undefined));
      expect(log.inputsOf("profileCache", "expire")).toStrictEqual([SLUG, "nouveau-slug"]);
      expect(log.sequence().slice(4, 7)).toStrictEqual(["carnetAccount.erase", "profileCache.expire", "profileCache.expire"]);
    });

    it("no profile at all (membership leftover or account of another project) → no Storage call, no cache expiry, SQL still called", async () => {
      const { log, deleteAccount } = harness({ profiles: { results: [ok(null)] }, instanceAccounts: { isOrphanResults: [ok(false)] } });

      expect(await deleteAccount()).toStrictEqual(ok(undefined));
      expect(log.sequence()).toStrictEqual([
        "auth.currentUser",
        "rateLimiter.consume",
        "profiles.getOwn",
        "carnetAccount.erase",
        "instanceAccounts.isOrphan",
      ]);
    });
  });

  describe("criterion 5: authorization", () => {
    it("no session → err('unauthenticated'), nothing deleted", async () => {
      const { log, deleteAccount } = harness({ auth: { currentUser: ok(null) } });

      expect(await deleteAccount()).toStrictEqual(err("unauthenticated"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
    });

    it("GoTrue unreachable → err('unexpected'), nothing deleted", async () => {
      const { log, deleteAccount } = harness({ auth: { currentUser: err("unexpected") } });

      expect(await deleteAccount()).toStrictEqual(err("unexpected"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
    });

    it("decision 3: profile-write exhausted → err('rate_limited'), nothing deleted", async () => {
      const { log, deleteAccount } = harness({ limiter: { deny: ["profile-write"] } });

      expect(await deleteAccount()).toStrictEqual(err("rate_limited"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser", "rateLimiter.consume"]);
    });

    it("rate limiter unavailable → err('unexpected'), nothing deleted (closed door)", async () => {
      const { log, deleteAccount } = harness({ limiter: { failing: true } });

      expect(await deleteAccount()).toStrictEqual(err("unexpected"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser", "rateLimiter.consume"]);
    });

    it("profile read fails → err('unexpected'), nothing deleted", async () => {
      const { log, deleteAccount } = harness({ profiles: { results: [err("unexpected")] } });

      expect(await deleteAccount()).toStrictEqual(err("unexpected"));
      expect(log.sequence()).toStrictEqual(["auth.currentUser", "rateLimiter.consume", "profiles.getOwn"]);
    });

    it("the account handed to the orphan check and the admin delete is the session's, never another one", async () => {
      const other = "0f0e0d0c-0000-4000-8000-00000000000b";
      const { log, deleteAccount } = harness({ auth: { currentUser: ok({ userId: other, email: "other@example.test" }) } });

      await deleteAccount();

      expect(log.inputsOf("instanceAccounts", "isOrphan")).toStrictEqual([other]);
      expect(log.inputsOf("instanceAccounts", "remove")).toStrictEqual([other]);
    });
  });
});
