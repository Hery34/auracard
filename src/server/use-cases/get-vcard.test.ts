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
 * // 0021, decision 6 (contract frozen by test-engineer) — new dependency:
 * //   avatars: MediaFetcher;   // src/domain/profile/ports.ts
 * //   export interface MediaFetcher {
 * //     // Bytes of a public object of `carnet-media`, read from the configured Supabase origin only; null when the URL
 * //     // is refused, or the object is unavailable, slower than 3 s or larger than 1 MiB. Never throws.
 * //     fetch(url: string): Promise<Uint8Array | null>;
 * //   }
 * // Published profile with avatarUrl → avatars.fetch(avatarUrl) after the read; the type comes from the bytes
 * // (detectImageFormat), never from a header: recognized → serializeVCard(…, { profileUrl, photo: { format, bytes } });
 * // null or unrecognized bytes → no PHOTO, the rest of the vCard unchanged. No avatarUrl, unpublished or invalid
 * // slug → no fetch.
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
import { fakeMediaFetcher, type FakeMediaFetcherOptions } from "../../../tests/builders/fake-media-fetcher";
import {
  aPublicProfile,
  fakePublicProfileReader,
  type FakePublicProfileReaderOptions,
} from "../../../tests/builders/fake-public-profile-reader";
import { imageBytes, textBytes } from "../../../tests/builders/images";

const ORIGIN = "https://carnet.example";

function fakeProfileUrl(log: CallLog): (slug: Slug) => string {
  return (slug) => {
    log.record("profileUrl", "of", slug);
    return `${ORIGIN}/p/${slug}`;
  };
}

function harness(overrides: Omit<FakePublicProfileReaderOptions, "log"> & { media?: Omit<FakeMediaFetcherOptions, "log"> } = {}) {
  const log = makeCallLog();
  const { media, ...reader } = overrides;
  const getVCard = makeGetVCard({
    publicProfiles: fakePublicProfileReader({ log, ...reader }),
    profileUrl: fakeProfileUrl(log),
    avatars: fakeMediaFetcher({ log, ...media }),
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

  describe("0021 decision 6: PHOTO of the avatar", () => {
    const AVATAR_URL =
      "https://supabase.carnet.example/storage/v1/object/public/carnet-media/c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f/avatar-1a2b3c4d-0000-4000-8000-000000000001.jpg";

    function contentOf(result: Awaited<ReturnType<ReturnType<typeof makeGetVCard>>>): string {
      return result.ok ? (result.value?.content ?? "") : "";
    }

    it.each(["jpeg", "png", "webp"] as const)(
      "criterion 3: avatar bytes in %s → the vCard carries them as PHOTO, read after the profile",
      async (format) => {
        const profile = aPublicProfile({ avatarUrl: AVATAR_URL });
        const bytes = imageBytes(format, 512);
        const { log, getVCard } = harness({ results: [ok(profile)], media: { bytes } });

        expect(await getVCard("elodie-durand-merel")).toStrictEqual(
          ok({
            fileName: "elodie-durand-merel.vcf",
            content: serializeVCard(profile, {
              profileUrl: `${ORIGIN}/p/elodie-durand-merel`,
              photo: { format, bytes },
            }),
          }),
        );
        expect(log.inputsOf("media", "fetch")).toStrictEqual([AVATAR_URL]);
        expect(log.sequence().indexOf("publicProfiles.getBySlug")).toBeLessThan(log.sequence().indexOf("media.fetch"));
      },
    );

    it("the type comes from the bytes: a .jpg URL serving PNG bytes → TYPE=PNG", async () => {
      const { getVCard } = harness({
        results: [ok(aPublicProfile({ avatarUrl: AVATAR_URL }))],
        media: { bytes: imageBytes("png") },
      });

      expect(contentOf(await getVCard("elodie-durand-merel"))).toContain("PHOTO;ENCODING=b;TYPE=PNG:");
    });

    it("avatar unavailable (fetcher null: refused origin, error, timeout or too big) → no PHOTO, the rest of the vCard as without avatar", async () => {
      const profile = aPublicProfile({ avatarUrl: AVATAR_URL });
      const { getVCard } = harness({ results: [ok(profile)], media: { bytes: null } });

      expect(await getVCard("elodie-durand-merel")).toStrictEqual(
        ok({
          fileName: "elodie-durand-merel.vcf",
          content: serializeVCard(profile, { profileUrl: `${ORIGIN}/p/elodie-durand-merel` }),
        }),
      );
    });

    it("bytes that are not an image (HTML error page) → no PHOTO", async () => {
      const { getVCard } = harness({
        results: [ok(aPublicProfile({ avatarUrl: AVATAR_URL }))],
        media: { bytes: textBytes("<html><body>Bad gateway</body></html>") },
      });

      expect(contentOf(await getVCard("elodie-durand-merel"))).not.toMatch(/^PHOTO/m);
    });

    it("no avatar → nothing fetched, no PHOTO", async () => {
      const { log, getVCard } = harness({ results: [ok(aPublicProfile({ avatarUrl: null }))], media: { bytes: imageBytes("jpeg") } });

      expect(contentOf(await getVCard("elodie-durand-merel"))).not.toMatch(/^PHOTO/m);
      expect(log.inputsOf("media", "fetch")).toStrictEqual([]);
    });

    it("unpublished profile or invalid slug → nothing fetched", async () => {
      const { log, getVCard } = harness({ results: [ok(null)], media: { bytes: imageBytes("jpeg") } });

      await getVCard("elodie-durand-merel");
      await getVCard("../admin");

      expect(log.inputsOf("media", "fetch")).toStrictEqual([]);
    });
  });
});
