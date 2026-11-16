/**
 * Contract frozen by test-engineer (0008, extended by 0017 decision 9: the editor of 0020 needs the full profile and
 * the stored links with their ids, otherwise the first save recreates every link).
 *
 * // src/domain/profile/ports.ts — changes
 * export type OwnProfile = {
 *   id: string; slug: string; displayName: string;
 *   jobTitle: string | null; company: string | null; bio: string | null;
 *   contactEmail: string | null; phone: string | null; websiteUrl: string | null;   // as stored, null when empty
 *   isPublished: boolean; isIndexable: boolean;
 * };
 * // ProfileReader.getOwn(): signature unchanged, returns the full OwnProfile (every editable column selected under RLS).
 * export interface LinkRepository {
 *   replace(...): ...;                                                       // unchanged
 *   // select of carnet.links where profile_id = $1 under the session (RLS links_select_own), ordered by position.
 *   // Another account's profile id → ok([]) (rows hidden by RLS). Any error → unexpected (SQLSTATE logged only).
 *   listOwn(profileId: string): Promise<Result<SavedLink[], "unexpected">>;
 * }
 *
 * // src/server/use-cases/get-own-profile.ts
 * export type GetOwnProfileError = "unauthenticated" | "unexpected";
 * export type GetOwnProfile = () => Promise<Result<{ profile: OwnProfile | null; links: SavedLink[] }, GetOwnProfileError>>;
 * export function makeGetOwnProfile(deps: { auth: AuthGateway; profiles: ProfileReader; links: LinkRepository }): GetOwnProfile;
 * // Order: auth.currentUser → profiles.getOwn → links.listOwn(own.id). The links returned as the adapter sorts them.
 * // No profile (account of another project) → ok({ profile: null, links: [] }) without listOwn.
 * // `result.value.profile` keeps its meaning: the dashboard (and tests/e2e) stay compatible.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeGetOwnProfile } from "@/server/use-cases/get-own-profile";

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
import { PROFILE_ID } from "../../../tests/builders/fake-registrar";
import { aSavedLink, LINK_IDS } from "../../../tests/builders/links";

const AUTHENTICATED = ok({ userId: GATEWAY_USER_ID, email: GATEWAY_USER_EMAIL });

const FULL_PROFILE = anOwnProfile({
  jobTitle: "Architecte d'intérieur",
  company: "Atelier Mérel",
  bio: "Bureaux et commerces.\nLyon.",
  contactEmail: "contact@atelier-merel.example",
  phone: "+33 6 12 34 56 78",
  websiteUrl: "https://atelier-merel.example/",
  isPublished: true,
  isIndexable: true,
});

const SAVED = [
  aSavedLink({ id: LINK_IDS[1], platform: "github", url: "https://github.com/elodie", label: "Code", position: 0 }),
  aSavedLink({ id: LINK_IDS[0], position: 1 }),
];

function harness(
  overrides: { auth?: FakeAuthGatewayOptions; profiles?: FakeProfileReaderOptions; links?: FakeLinkRepositoryOptions } = {},
) {
  const log = makeCallLog();
  const getOwnProfile = makeGetOwnProfile({
    auth: fakeAuthGateway({ log, currentUser: AUTHENTICATED, ...overrides.auth }),
    profiles: fakeProfileReader({ log, ...overrides.profiles }),
    links: fakeLinkRepository({ log, listResults: [ok(SAVED)], ...overrides.links }),
  });

  return { log, getOwnProfile };
}

describe("getOwnProfile", () => {
  it("criterion 7: no session (currentUser → null) → err('unauthenticated') without any read", async () => {
    const { log, getOwnProfile } = harness({ auth: { currentUser: ok(null) } });

    expect(await getOwnProfile()).toStrictEqual(err("unauthenticated"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("currentUser 'unexpected' (GoTrue unreachable) → err('unexpected') without any read", async () => {
    const { log, getOwnProfile } = harness({ auth: { currentUser: err("unexpected") } });

    expect(await getOwnProfile()).toStrictEqual(err("unexpected"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser"]);
  });

  it("decision 9: authenticated with a profile and links → ok({ profile, links }) with every editable field, isPublished, isIndexable, slug, id and the links with their id and position", async () => {
    const { getOwnProfile } = harness({ profiles: { results: [ok(FULL_PROFILE)] } });

    expect(await getOwnProfile()).toStrictEqual(ok({ profile: FULL_PROFILE, links: SAVED }));
  });

  it("decision 9: session verified first, then the profile, then the links of that profile (its id, never another)", async () => {
    const { log, getOwnProfile } = harness();

    await getOwnProfile();

    expect(log.sequence()).toStrictEqual(["auth.currentUser", "profiles.getOwn", "links.listOwn"]);
    expect(log.inputsOf("links", "listOwn")).toStrictEqual([{ profileId: PROFILE_ID }]);
  });

  it("decision 9: the links are returned in the order of the repository (sorted by position), not reshuffled", async () => {
    const reversedIds = [
      aSavedLink({ id: LINK_IDS[2], platform: "website", url: "https://atelier-merel.example/", position: 0 }),
      aSavedLink({ id: LINK_IDS[1], platform: "github", url: "https://github.com/elodie", position: 1 }),
      aSavedLink({ id: LINK_IDS[0], position: 2 }),
    ];
    const { getOwnProfile } = harness({ links: { listResults: [ok(reversedIds)] } });

    const result = await getOwnProfile();

    expect(result.ok && result.value.links).toStrictEqual(reversedIds);
  });

  it("a profile without links → ok({ profile, links: [] })", async () => {
    const { getOwnProfile } = harness({ links: { listResults: [ok([])] } });

    expect(await getOwnProfile()).toStrictEqual(ok({ profile: anOwnProfile(), links: [] }));
  });

  it("criterion 7 / 8: authenticated without a profile (account of another project) → ok({ profile: null, links: [] }) without listing links", async () => {
    const { log, getOwnProfile } = harness({ profiles: { results: [ok(null)] } });

    expect(await getOwnProfile()).toStrictEqual(ok({ profile: null, links: [] }));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "profiles.getOwn"]);
  });

  it("criterion 7: profile reader 'unexpected' → err('unexpected'), links never listed", async () => {
    const { log, getOwnProfile } = harness({ profiles: { results: [err("unexpected")] } });

    expect(await getOwnProfile()).toStrictEqual(err("unexpected"));
    expect(log.sequence()).toStrictEqual(["auth.currentUser", "profiles.getOwn"]);
  });

  it("decision 9: link repository 'unexpected' → err('unexpected') (no partial profile without its links)", async () => {
    const { getOwnProfile } = harness({ links: { listResults: [err("unexpected")] } });

    expect(await getOwnProfile()).toStrictEqual(err("unexpected"));
  });

  it("replayed: a second call gives the same result and reads again (no state kept)", async () => {
    const { log, getOwnProfile } = harness();

    const first = await getOwnProfile();
    const second = await getOwnProfile();

    expect(first).toStrictEqual(ok({ profile: anOwnProfile(), links: SAVED }));
    expect(second).toStrictEqual(first);
    expect(log.sequence()).toStrictEqual([
      "auth.currentUser",
      "profiles.getOwn",
      "links.listOwn",
      "auth.currentUser",
      "profiles.getOwn",
      "links.listOwn",
    ]);
  });
});
