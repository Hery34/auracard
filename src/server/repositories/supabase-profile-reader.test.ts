/**
 * Contract frozen by test-engineer (0021, decisions 5 and 6: the editor preview shows the stored images).
 *
 * // src/domain/profile/ports.ts — OwnProfile gains, after isIndexable:
 * //   avatarUrl: string | null; bannerUrl: string | null; logoUrl: string | null;   // public URLs, built by the reader
 *
 * // src/server/repositories/supabase-profile-reader.ts
 * export function makeSupabaseProfileReader(server: CarnetClient, mediaOrigin: string): ProfileReader;
 * // select of carnet.profiles under RLS, now with avatar_url, banner_url, logo_url; each object name →
 * // publicMediaUrl(mediaOrigin, name); null or refused by the pattern → null. Other fields unchanged (0017).
 *
 * 0032 (decision 1, « Recevoir des messages »): OwnProfile gains `acceptsLeads: boolean` (after isIndexable), read from
 * accepts_leads.
 */
import { describe, expect, it } from "vitest";

import { ok } from "@/domain/shared/result";
import { makeSupabaseProfileReader } from "@/server/repositories/supabase-profile-reader";

import { fakeCarnetQueryClient } from "../../../tests/builders/fake-carnet-query-client";
import { anOwnProfile } from "../../../tests/builders/fake-profile-reader";
import { PROFILE_ID } from "../../../tests/builders/fake-registrar";

const MEDIA_ORIGIN = "https://supabase.carnet.example";
const MEDIA_PREFIX = `${MEDIA_ORIGIN}/storage/v1/object/public/carnet-media/`;
const AVATAR = `${PROFILE_ID}/avatar-1a2b3c4d-0000-4000-8000-000000000001.jpg`;
const BANNER = `${PROFILE_ID}/banner-5e6f7a8b-0000-4000-8000-000000000002.webp`;
const LOGO = `${PROFILE_ID}/logo-9c0d1e2f-0000-4000-8000-000000000003.png`;

function ownRow(images: { avatar_url: string | null; banner_url: string | null; logo_url: string | null }) {
  return {
    id: PROFILE_ID,
    slug: "elodie-durand-merel",
    display_name: "Élodie Durand-Mérel",
    job_title: null,
    company: null,
    bio: null,
    contact_email: null,
    phone: null,
    website_url: null,
    is_published: false,
    is_indexable: false,
    accepts_leads: true,
    ...images,
  };
}

function readerReturning(images: Parameters<typeof ownRow>[0]) {
  const fake = fakeCarnetQueryClient({ tables: { profiles: { data: ownRow(images), error: null } } });
  return { ...fake, reader: makeSupabaseProfileReader(fake.client, MEDIA_ORIGIN) };
}

describe("makeSupabaseProfileReader — images (0021)", () => {
  it("selects avatar_url, banner_url and logo_url with the editable fields", async () => {
    const { calls, reader } = readerReturning({ avatar_url: null, banner_url: null, logo_url: null });

    await reader.getOwn();

    const select = calls.find((call) => call.kind === "select");
    const columns = select?.kind === "select" ? select.columns.split(",").map((column) => column.trim()) : [];
    expect(columns).toEqual(expect.arrayContaining(["avatar_url", "banner_url", "logo_url"]));
  });

  it("decision 5: the object names become public URLs of carnet-media (preview of the editor)", async () => {
    const { reader } = readerReturning({ avatar_url: AVATAR, banner_url: BANNER, logo_url: LOGO });

    expect(await reader.getOwn()).toStrictEqual(
      ok(
        anOwnProfile({
          avatarUrl: `${MEDIA_PREFIX}${AVATAR}`,
          bannerUrl: `${MEDIA_PREFIX}${BANNER}`,
          logoUrl: `${MEDIA_PREFIX}${LOGO}`,
        }),
      ),
    );
  });

  it("no image → null URLs; a value outside the pattern → null", async () => {
    const { reader } = readerReturning({ avatar_url: null, banner_url: "https://cdn.example/b.jpg", logo_url: null });

    expect(await reader.getOwn()).toStrictEqual(ok(anOwnProfile()));
  });
});

describe("makeSupabaseProfileReader — accepts_leads (0032)", () => {
  it("decision 1: selects accepts_leads and maps it to acceptsLeads", async () => {
    const fake = fakeCarnetQueryClient({
      tables: { profiles: { data: { ...ownRow({ avatar_url: null, banner_url: null, logo_url: null }), accepts_leads: false }, error: null } },
    });

    const result = await makeSupabaseProfileReader(fake.client, MEDIA_ORIGIN).getOwn();

    expect(result).toStrictEqual(ok(anOwnProfile({ acceptsLeads: false })));
    const select = fake.calls.find((call) => call.kind === "select");
    const columns = select?.kind === "select" ? select.columns.split(",").map((column) => column.trim()) : [];
    expect(columns).toContain("accepts_leads");
  });
});
