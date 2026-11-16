/**
 * Contract frozen by test-engineer (0017, decisions 3, 4, 7 and 8; 0016 decision 8).
 *
 * // src/domain/profile/ports.ts — addition
 * export interface LinkRepository {
 *   // carnet.replace_links(p_profile_id, p_links) under the session: the full ordered list, each element
 *   // { id?, platform, url, label } (id only for an existing link, kept in place). Returns the stored rows ordered by position.
 *   // 42501 (profile not editable) → not_found; 22023 / 23514 → invalid_input; anything else → unexpected.
 *   replace(profileId: string, links: readonly Link[]): Promise<Result<SavedLink[], ProfileWriteError>>;
 * }
 *
 * // src/server/use-cases/replace-links.ts
 * export type ReplaceLinksError = "unauthenticated" | "not_found" | "rate_limited" | "invalid_input" | "unexpected";
 * export type ReplaceLinks = (links: readonly Link[]) => Promise<Result<{ profileId: string; slug: string; links: SavedLink[] }, ReplaceLinksError>>;
 * export function makeReplaceLinks(deps: {
 *   auth: AuthGateway; rateLimiter: RateLimiter; profiles: ProfileReader; links: LinkRepository;
 * }): ReplaceLinks;
 * // Same chain as updateProfile: currentUser → consume("profile-write", userId) → getOwn → links.replace(own.id, links)
 * // → ok({ profileId: own.id, slug: own.slug, links: saved }) (decision 10: the action calls updateTag("profile:<slug>"), slug read by getOwn) (saved links carry the ids the editor must send next time).
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeReplaceLinks } from "@/server/use-cases/replace-links";

import { makeCallLog } from "../../../tests/builders/call-log";
import {
  fakeAuthGateway,
  GATEWAY_USER_EMAIL,
  GATEWAY_USER_ID,
  type FakeAuthGatewayOptions,
} from "../../../tests/builders/fake-auth-gateway";
import { fakeLinkRepository, type FakeLinkRepositoryOptions } from "../../../tests/builders/fake-link-repository";
import {
  anOwnProfile,
  fakeProfileReader,
  type FakeProfileReaderOptions,
} from "../../../tests/builders/fake-profile-reader";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../tests/builders/fake-rate-limiter";
import { PROFILE_ID } from "../../../tests/builders/fake-registrar";
import { aHttpsUrl } from "../../../tests/builders/https-url";
import { aLink, aSavedLink, LINK_IDS } from "../../../tests/builders/links";

const OWN_SLUG = anOwnProfile().slug;
const AUTHENTICATED = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });
const PROFILE_WRITE_CONSUME = { scope: "profile-write", subject: GATEWAY_USER_ID, limit: 60, windowSeconds: 3600 };

const LIST = [
  aLink({ id: LINK_IDS[1], platform: "github", url: aHttpsUrl("https://github.com/elodie"), label: "Code" }),
  aLink({ platform: "website", url: aHttpsUrl("https://atelier-merel.example/") }),
  aLink({ id: LINK_IDS[0] }),
];

const SAVED = [
  aSavedLink({ id: LINK_IDS[1], platform: "github", url: "https://github.com/elodie", label: "Code", position: 0 }),
  aSavedLink({ id: LINK_IDS[2], platform: "website", url: "https://atelier-merel.example/", position: 1 }),
  aSavedLink({ id: LINK_IDS[0], position: 2 }),
];

function harness(
  overrides: {
    auth?: FakeAuthGatewayOptions;
    limiter?: FakeRateLimiterOptions;
    profiles?: FakeProfileReaderOptions;
    links?: FakeLinkRepositoryOptions;
  } = {},
) {
  const log = makeCallLog();
  const replaceLinks = makeReplaceLinks({
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    rateLimiter: fakeRateLimiter({ log, ...overrides.limiter }),
    profiles: fakeProfileReader({ log, ...overrides.profiles }),
    links: fakeLinkRepository({ log, results: [ok(SAVED)], ...overrides.links }),
  });

  return { log, replaceLinks };
}

describe("replaceLinks", () => {
  it("criterion 1 (success): authenticate → rate limit → own profile → replace → ok({ profileId, slug, links }) with the stored rows", async () => {
    const { log, replaceLinks } = harness();

    expect(await replaceLinks(LIST)).toStrictEqual(ok({ profileId: PROFILE_ID, slug: OWN_SLUG, links: SAVED }));
    expect(log.sequence()).toStrictEqual([
      "auth.currentUser",
      "rateLimiter.consume",
      "profiles.getOwn",
      "links.replace",
    ]);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([PROFILE_WRITE_CONSUME]);
  });

  it("decision 7: forwards the full ordered list to the repository, with the id of every existing link (click statistics kept)", async () => {
    const { log, replaceLinks } = harness();

    await replaceLinks(LIST);

    expect(log.inputsOf("links", "replace")).toStrictEqual([{ profileId: PROFILE_ID, links: LIST }]);
  });

  it("decision 4: an empty list is forwarded as is (every link removed)", async () => {
    const { log, replaceLinks } = harness({ links: { results: [ok([])] } });

    expect(await replaceLinks([])).toStrictEqual(ok({ profileId: PROFILE_ID, slug: OWN_SLUG, links: [] }));
    expect(log.inputsOf("links", "replace")).toStrictEqual([{ profileId: PROFILE_ID, links: [] }]);
  });

  it("criterion 1 (unauthenticated): no session → err('unauthenticated'), nothing consumed, read nor written", async () => {
    const { log, replaceLinks } = harness({ auth: { currentUser: ok(null) } });

    expect(await replaceLinks(LIST)).toStrictEqual(err("unauthenticated"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("GoTrue unreachable (currentUser 'unexpected') → err('unexpected'), nothing written", async () => {
    const { log, replaceLinks } = harness({ auth: { currentUser: err("unexpected") } });

    expect(await replaceLinks(LIST)).toStrictEqual(err("unexpected"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("criterion 1 (another account's profile): an account without a carnet profile → err('not_found'), nothing written", async () => {
    const { log, replaceLinks } = harness({ profiles: { results: [ok(null)] } });

    expect(await replaceLinks(LIST)).toStrictEqual(err("not_found"));
    expect(log.inputsOf("links", "replace")).toStrictEqual([]);
  });

  it("criterion 1 (another account's profile): replace_links refuses the profile (42501, repository 'not_found') → err('not_found')", async () => {
    const { replaceLinks } = harness({ links: { results: [err("not_found")] } });

    expect(await replaceLinks(LIST)).toStrictEqual(err("not_found"));
  });

  it("criterion 1 (invalid input): replace_links refuses the list (unknown id 22023, constraint 23514) → err('invalid_input')", async () => {
    const { replaceLinks } = harness({ links: { results: [err("invalid_input")] } });

    expect(await replaceLinks(LIST)).toStrictEqual(err("invalid_input"));
  });

  it("criterion 1 (repository failure): repository 'unexpected' → err('unexpected')", async () => {
    const { replaceLinks } = harness({ links: { results: [err("unexpected")] } });

    expect(await replaceLinks(LIST)).toStrictEqual(err("unexpected"));
  });

  it("criterion 1 (repository failure): reader 'unexpected' → err('unexpected'), nothing written", async () => {
    const { log, replaceLinks } = harness({ profiles: { results: [err("unexpected")] } });

    expect(await replaceLinks(LIST)).toStrictEqual(err("unexpected"));
    expect(log.inputsOf("links", "replace")).toStrictEqual([]);
  });

  it("decision 8: profile-write exhausted → err('rate_limited') before any read or write", async () => {
    const { log, replaceLinks } = harness({ limiter: { deny: ["profile-write"] } });

    expect(await replaceLinks(LIST)).toStrictEqual(err("rate_limited"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "rateLimiter.consume"]);
  });

  it("decision 8: rate limiter unavailable → err('unexpected') (fail closed), nothing written", async () => {
    const { log, replaceLinks } = harness({ limiter: { failing: true } });

    expect(await replaceLinks(LIST)).toStrictEqual(err("unexpected"));
    expect(log.inputsOf("links", "replace")).toStrictEqual([]);
  });

  it("decision 10: returns the slug read by getOwn (the action tags profile:<slug>)", async () => {
    const { replaceLinks } = harness({ profiles: { results: [ok(anOwnProfile({ slug: "atelier-merel" }))] } });

    expect(await replaceLinks(LIST)).toStrictEqual(ok({ profileId: PROFILE_ID, slug: "atelier-merel", links: SAVED }));
  });

  it("replayed: the same list twice is forwarded twice unchanged and gives the same result", async () => {
    const { log, replaceLinks } = harness();

    const first = await replaceLinks(LIST);
    const second = await replaceLinks(LIST);

    expect(second).toStrictEqual(first);
    expect(log.inputsOf("links", "replace")).toStrictEqual([
      { profileId: PROFILE_ID, links: LIST },
      { profileId: PROFILE_ID, links: LIST },
    ]);
  });
});
