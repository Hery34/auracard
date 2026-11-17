/**
 * Contract frozen by test-engineer (0019, decisions 3 and 4).
 *
 * // src/server/use-cases/get-vcard.ts
 * export type VCardFile = { fileName: string; content: string };
 * export type GetVCard = (slug: string) => Promise<Result<VCardFile | null, "unexpected">>;
 * export function makeGetVCard(deps: {
 *   publicProfiles: PublicProfileReader;
 *   // Absolute URL of the public page `/p/{slug}`, built from a configured origin, never from the request
 *   // headers (the response is cached under the tag `profile:<slug>`: a Host header must not end up in it).
 *   profileUrl: (slug: Slug) => string;
 * }): GetVCard;
 * // No session. A text that parseSlug refuses (invalid or reserved) → ok(null) without any read, like an unpublished
 * // or unknown profile (reader null → ok(null)). Published → ok({ fileName: `${slug}.vcf`,
 * // content: serializeVCard(profile, { profileUrl: profileUrl(slug) }) }). Reader failure → err("unexpected").
 *
 * // websiteUrl (untrusted: direct PostgREST writes) is checked again with parseHttpsUrl before serialization
 * // (0019, decision 7): refused → serialized as null (no website URL line); accepted → kept.
 *
 * // src/server/container.ts — 0019, decision 7: `getVCard` is no longer exposed (no use outside the tests):
 * export type PublicContainer = { getPublicProfile: GetPublicProfile; downloadVCard: DownloadVCardFromRequest };
 */
import { describe, expect, it } from "vitest";

import type { Slug } from "@/domain/profile/slug";
import { serializeVCard } from "@/domain/profile/vcard";
import { err, ok } from "@/domain/shared/result";
import { makeGetVCard } from "@/server/use-cases/get-vcard";

import { makeCallLog, type CallLog } from "../../../tests/builders/call-log";
import {
  aPublicProfile,
  fakePublicProfileReader,
  type FakePublicProfileReaderOptions,
} from "../../../tests/builders/fake-public-profile-reader";

const ORIGIN = "https://carnet.example";

function fakeProfileUrl(log: CallLog): (slug: Slug) => string {
  return (slug) => {
    log.record("profileUrl", "of", slug);
    return `${ORIGIN}/p/${slug}`;
  };
}

function harness(overrides: Omit<FakePublicProfileReaderOptions, "log"> = {}) {
  const log = makeCallLog();
  const getVCard = makeGetVCard({
    publicProfiles: fakePublicProfileReader({ log, ...overrides }),
    profileUrl: fakeProfileUrl(log),
  });

  return { log, getVCard };
}

describe("getVCard", () => {
  it("criterion 2 (published): ok({ fileName: '<slug>.vcf', content: the vCard with the public profile URL })", async () => {
    const profile = aPublicProfile({ contactEmail: "elodie@atelier-merel.example", phone: "+33 6 12 34 56 78" });
    const { log, getVCard } = harness({ results: [ok(profile)] });

    expect(await getVCard("elodie-durand-merel")).toStrictEqual(
      ok({
        fileName: "elodie-durand-merel.vcf",
        content: serializeVCard(profile, { profileUrl: `${ORIGIN}/p/elodie-durand-merel` }),
      }),
    );
    expect(log.inputsOf("publicProfiles", "getBySlug")).toStrictEqual(["elodie-durand-merel"]);
    expect(log.inputsOf("profileUrl", "of")).toStrictEqual(["elodie-durand-merel"]);
  });

  it("criterion 2 (unpublished or unknown): reader null → ok(null)", async () => {
    const { getVCard } = harness({ results: [ok(null)] });

    expect(await getVCard("elodie-durand-merel")).toStrictEqual(ok(null));
  });

  it.each([
    ["an empty text", ""],
    ["uppercase letters", "Elodie-Durand"],
    ["41 characters", "a".repeat(41)],
    ["a path traversal", "../admin"],
    ["a percent-encoded text", "%2e%2e"],
    ["a .vcf suffix", "elodie-durand-merel.vcf"],
    ["a reserved slug", "tableau-de-bord"],
    ["the reserved slug v", "v"],
  ])("criterion 2 (invalid input): %s → ok(null) without any read", async (_label, slug) => {
    const { log, getVCard } = harness();

    expect(await getVCard(slug)).toStrictEqual(ok(null));
    expect(log.sequence()).toStrictEqual([]);
  });

  it.each([
    ["an http URL", "http://x.fr"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,<script>alert(1)</script>"],
    ["a protocol-relative URL", "//x.fr/page"],
    ["an https URL with credentials", "https://user:secret@x.fr/"],
  ])("decision 7 (websiteUrl revalidated): %s → absent from the vCard, the public profile URL stays", async (_label, websiteUrl) => {
    const profile = aPublicProfile({ websiteUrl });
    const { getVCard } = harness({ results: [ok(profile)] });

    const result = await getVCard("elodie-durand-merel");

    expect(result).toStrictEqual(
      ok({
        fileName: "elodie-durand-merel.vcf",
        content: serializeVCard({ ...profile, websiteUrl: null }, { profileUrl: `${ORIGIN}/p/elodie-durand-merel` }),
      }),
    );
    const content = result.ok ? (result.value?.content ?? "") : "";
    expect(content).not.toContain(websiteUrl);
    expect(content.split("\r\n").filter((line) => line.startsWith("URL"))).toStrictEqual([
      `URL:${ORIGIN}/p/elodie-durand-merel`,
    ]);
  });

  it("decision 7 (websiteUrl revalidated): a valid https URL stays in the vCard, before the public profile URL", async () => {
    const profile = aPublicProfile({ websiteUrl: "https://atelier-merel.example/" });
    const { getVCard } = harness({ results: [ok(profile)] });

    const result = await getVCard("elodie-durand-merel");

    const content = result.ok ? (result.value?.content ?? "") : "";
    expect(content.split("\r\n").filter((line) => line.startsWith("URL"))).toStrictEqual([
      "URL:https://atelier-merel.example/",
      `URL:${ORIGIN}/p/elodie-durand-merel`,
    ]);
  });

  it("repository failure: reader 'unexpected' → err('unexpected')", async () => {
    const { getVCard } = harness({ results: [err("unexpected")] });

    expect(await getVCard("elodie-durand-merel")).toStrictEqual(err("unexpected"));
  });

  it("replayed: two downloads give the same file, one read each (no state kept)", async () => {
    const { log, getVCard } = harness();

    const first = await getVCard("elodie-durand-merel");
    const second = await getVCard("elodie-durand-merel");

    expect(second).toStrictEqual(first);
    expect(log.inputsOf("publicProfiles", "getBySlug")).toStrictEqual(["elodie-durand-merel", "elodie-durand-merel"]);
  });
});
