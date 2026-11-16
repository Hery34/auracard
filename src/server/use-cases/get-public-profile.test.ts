/**
 * Contract frozen by test-engineer (0017, decision 6).
 *
 * // src/domain/profile/profile.ts — additions
 * export type PublicLink = { platform: LinkPlatform; url: string; label: string | null; position: number };
 * export type PublicProfile = {
 *   slug: string; displayName: string; jobTitle: string | null; company: string | null; bio: string | null;
 *   avatarUrl: string | null; bannerUrl: string | null; contactEmail: string | null; phone: string | null;
 *   websiteUrl: string | null; isIndexable: boolean; links: PublicLink[];   // links sorted by position
 * };
 *
 * // src/domain/profile/ports.ts — addition
 * export interface PublicProfileReader {
 *   // carnet.get_public_profile + carnet.get_public_links through a client WITHOUT cookies (anon key, static rendering).
 *   // Not published or unknown → ok(null).
 *   getBySlug(slug: Slug): Promise<Result<PublicProfile | null, "unexpected">>;
 * }
 *
 * // src/server/use-cases/get-public-profile.ts
 * export type GetPublicProfile = (slug: string) => Promise<Result<PublicProfile | null, "unexpected">>;
 * export function makeGetPublicProfile(deps: { publicProfiles: PublicProfileReader }): GetPublicProfile;
 * // No session involved (no AuthGateway dependency). A text that parseSlug refuses (invalid or reserved) → ok(null)
 * // without any read: same answer as an unpublished profile (no enumeration, 0018 decision 2).
 *
 * // src/server/container.ts — addition
 * export function createPublicContainer(): { getPublicProfile: GetPublicProfile }; // no cookies, usable in static rendering
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeGetPublicProfile } from "@/server/use-cases/get-public-profile";

import { makeCallLog } from "../../../tests/builders/call-log";
import {
  aPublicProfile,
  fakePublicProfileReader,
  type FakePublicProfileReaderOptions,
} from "../../../tests/builders/fake-public-profile-reader";

function harness(overrides: FakePublicProfileReaderOptions = {}) {
  const log = makeCallLog();
  const getPublicProfile = makeGetPublicProfile({ publicProfiles: fakePublicProfileReader({ log, ...overrides }) });

  return { log, getPublicProfile };
}

describe("getPublicProfile", () => {
  it("criterion 1 (success): a published profile → ok(profile with its links), read by its slug", async () => {
    const profile = aPublicProfile();
    const { log, getPublicProfile } = harness({ results: [ok(profile)] });

    expect(await getPublicProfile("elodie-durand-merel")).toStrictEqual(ok(profile));
    expect(log.inputsOf("publicProfiles", "getBySlug")).toStrictEqual(["elodie-durand-merel"]);
  });

  it("criterion 2: an unpublished or unknown profile (reader null) → ok(null)", async () => {
    const { getPublicProfile } = harness({ results: [ok(null)] });

    expect(await getPublicProfile("elodie-durand-merel")).toStrictEqual(ok(null));
  });

  it.each([
    ["an empty text", ""],
    ["uppercase letters", "Elodie-Durand"],
    ["41 characters", "a".repeat(41)],
    ["a path traversal", "../admin"],
    ["a percent-encoded text", "%2e%2e"],
    ["a reserved slug", "tableau-de-bord"],
  ])("criterion 1 (invalid input): %s → ok(null) without any read", async (_label, slug) => {
    const { log, getPublicProfile } = harness();

    expect(await getPublicProfile(slug)).toStrictEqual(ok(null));
    expect(log.sequence()).toStrictEqual([]);
  });

  it("criterion 1 (repository failure): reader 'unexpected' → err('unexpected')", async () => {
    const { getPublicProfile } = harness({ results: [err("unexpected")] });

    expect(await getPublicProfile("elodie-durand-merel")).toStrictEqual(err("unexpected"));
  });

  it("replayed: two reads give the same result, one reader call each (no state kept)", async () => {
    const { log, getPublicProfile } = harness();

    const first = await getPublicProfile("elodie-durand-merel");
    const second = await getPublicProfile("elodie-durand-merel");

    expect(second).toStrictEqual(first);
    expect(log.sequence()).toStrictEqual(["publicProfiles.getBySlug", "publicProfiles.getBySlug"]);
  });
});
