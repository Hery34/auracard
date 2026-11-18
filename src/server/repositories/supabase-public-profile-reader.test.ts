/**
 * Contract frozen by test-engineer (0021, decisions 5, 6 and 9).
 *
 * // src/domain/profile/profile.ts — PublicProfile gains `logoUrl: string | null` (after bannerUrl).
 * // avatarUrl, bannerUrl, logoUrl: public URLs built by the reader, never the stored value.
 *
 * // src/server/repositories/supabase-public-profile-reader.ts
 * export function makeSupabasePublicProfileReader(client: CarnetClient, mediaOrigin: string): PublicProfileReader;
 * // mediaOrigin = env.NEXT_PUBLIC_SUPABASE_URL (container). avatar_url, banner_url, logo_url hold object names of
 * // `carnet-media`: each one → publicMediaUrl(mediaOrigin, name); null, or a value refused by the pattern (URL stored
 * // before 0021, traversal…) → null. The rest of the mapping is unchanged (0017).
 *
 * 0029 (decision 9) / 0034 (decision 2): get_public_links also returns `id`; PublicLink gains `id: string` (first key).
 *
 * 0032 (decision 1): PublicProfile gains `acceptsLeads: boolean` (after isIndexable), from the accepts_leads column of
 * get_public_profile (0031, decision 10); anything but true (null) → false: no form shown.
 */
import { describe, expect, it } from "vitest";

import { ok } from "@/domain/shared/result";
import { makeSupabasePublicProfileReader } from "@/server/repositories/supabase-public-profile-reader";

import { fakeCarnetQueryClient } from "../../../tests/builders/fake-carnet-query-client";
import { PROFILE_ID } from "../../../tests/builders/fake-registrar";
import { aSlug } from "../../../tests/builders/slug";

const MEDIA_ORIGIN = "https://supabase.carnet.example";
const MEDIA_PREFIX = `${MEDIA_ORIGIN}/storage/v1/object/public/carnet-media/`;
const AVATAR = `${PROFILE_ID}/avatar-1a2b3c4d-0000-4000-8000-000000000001.jpg`;
const BANNER = `${PROFILE_ID}/banner-5e6f7a8b-0000-4000-8000-000000000002.webp`;
const LOGO = `${PROFILE_ID}/logo-9c0d1e2f-0000-4000-8000-000000000003.png`;

function profileRow(images: { avatar_url: string | null; banner_url: string | null; logo_url: string | null }) {
  return {
    slug: "elodie-durand-merel",
    display_name: "Élodie Durand-Mérel",
    job_title: "Architecte d'intérieur",
    company: "Atelier Mérel",
    bio: null,
    theme: "system",
    contact_email: null,
    phone: null,
    website_url: null,
    is_indexable: false,
    accepts_leads: true,
    ...images,
  };
}

function readerReturning(images: Parameters<typeof profileRow>[0], mediaOrigin = MEDIA_ORIGIN) {
  const { client } = fakeCarnetQueryClient({
    rpc: {
      get_public_profile: { data: profileRow(images), error: null },
      get_public_links: { data: [], error: null },
    },
  });
  return makeSupabasePublicProfileReader(client, mediaOrigin);
}

describe("makeSupabasePublicProfileReader — images (0021)", () => {
  it("decision 5: the object names of avatar, banner and logo become public URLs of carnet-media on the configured origin", async () => {
    const result = await readerReturning({ avatar_url: AVATAR, banner_url: BANNER, logo_url: LOGO }).getBySlug(
      aSlug("elodie-durand-merel"),
    );

    expect(result).toStrictEqual(
      ok({
        slug: "elodie-durand-merel",
        displayName: "Élodie Durand-Mérel",
        jobTitle: "Architecte d'intérieur",
        company: "Atelier Mérel",
        bio: null,
        avatarUrl: `${MEDIA_PREFIX}${AVATAR}`,
        bannerUrl: `${MEDIA_PREFIX}${BANNER}`,
        logoUrl: `${MEDIA_PREFIX}${LOGO}`,
        contactEmail: null,
        phone: null,
        websiteUrl: null,
        isIndexable: false,
        acceptsLeads: true,
        links: [],
      }),
    );
  });

  it("no image → the three URLs are null", async () => {
    const result = await readerReturning({ avatar_url: null, banner_url: null, logo_url: null }).getBySlug(
      aSlug("elodie-durand-merel"),
    );

    expect(result.ok && result.value).toMatchObject({ avatarUrl: null, bannerUrl: null, logoUrl: null });
  });

  it("the local stack origin is used as configured", async () => {
    const result = await readerReturning({ avatar_url: AVATAR, banner_url: null, logo_url: null }, "http://127.0.0.1:54321").getBySlug(
      aSlug("elodie-durand-merel"),
    );

    expect(result.ok && result.value?.avatarUrl).toBe(
      `http://127.0.0.1:54321/storage/v1/object/public/carnet-media/${AVATAR}`,
    );
  });

  it("decision 5: a stored value outside the object name pattern (URL stored before 0021, traversal) → null, never passed through", async () => {
    const result = await readerReturning({
      avatar_url: "https://tracker.example/pixel.png",
      banner_url: `${PROFILE_ID}/../../auth/v1/admin/users`,
      logo_url: "javascript:alert(1)",
    }).getBySlug(aSlug("elodie-durand-merel"));

    expect(result.ok && result.value).toMatchObject({ avatarUrl: null, bannerUrl: null, logoUrl: null });
  });
});

describe("makeSupabasePublicProfileReader — link ids (0029, decision 9; 0034, decision 2)", () => {
  const LINKEDIN_ID = "6a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
  const WHATSAPP_ID = "7b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e";

  it("each public link carries the id returned by get_public_links (target of link_click)", async () => {
    const { client } = fakeCarnetQueryClient({
      rpc: {
        get_public_profile: { data: profileRow({ avatar_url: null, banner_url: null, logo_url: null }), error: null },
        get_public_links: {
          data: [
            { id: LINKEDIN_ID, platform: "linkedin", url: "https://www.linkedin.com/in/elodie", label: null, position: 0 },
            { id: WHATSAPP_ID, platform: "whatsapp", url: "https://wa.me/33612345678", label: "Écrivez-moi", position: 1 },
          ],
          error: null,
        },
      },
    });

    const result = await makeSupabasePublicProfileReader(client, MEDIA_ORIGIN).getBySlug(aSlug("elodie-durand-merel"));

    expect(result.ok && result.value?.links).toStrictEqual([
      { id: LINKEDIN_ID, platform: "linkedin", url: "https://www.linkedin.com/in/elodie", label: null, position: 0 },
      { id: WHATSAPP_ID, platform: "whatsapp", url: "https://wa.me/33612345678", label: "Écrivez-moi", position: 1 },
    ]);
  });
});

describe("makeSupabasePublicProfileReader — accepts_leads (0032)", () => {
  it.each([
    [true, true],
    [false, false],
    [null, false],
  ])("decision 1: accepts_leads %s → acceptsLeads %s (the public page shows the form only when true)", async (stored, expected) => {
    const { client } = fakeCarnetQueryClient({
      rpc: {
        get_public_profile: { data: { ...profileRow({ avatar_url: null, banner_url: null, logo_url: null }), accepts_leads: stored }, error: null },
        get_public_links: { data: [], error: null },
      },
    });

    const result = await makeSupabasePublicProfileReader(client, MEDIA_ORIGIN).getBySlug(aSlug("elodie-durand-merel"));

    expect(result.ok && result.value?.acceptsLeads).toBe(expected);
  });
});
