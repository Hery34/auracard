import type { LinkPlatform } from "../../../src/domain/profile/link";
import { adminClient, type CarnetClient } from "../../integration/setup/clients";
import ensureSupabaseEnv from "../../integration/setup/supabase-env";
import { newAccount } from "./accounts";
import { createMember } from "../helpers/admin";

/** Editable fields of `carnet.profiles`, as the owner's editor (0020) will write them. */
export type ProfileFields = {
  display_name: string;
  job_title: string | null;
  company: string | null;
  bio: string | null;
  contact_email: string | null;
  phone: string | null;
  website_url: string | null;
  is_published: boolean;
  is_indexable: boolean;
};

export type LinkFixture = { platform: LinkPlatform; url: string; label: string | null };

export type ProfileFixture = { userId: string; profileId: string; slug: string; email: string };

/** National significant numbers (without the trunk 0): the anti-scraping checks look for these digits. */
export const PHONE_DIGITS = "641279358";
export const WHATSAPP_DIGITS = "758316942";

/** Complete published profile, without avatar (initials expected: « ED »). */
export const FULL_PROFILE: ProfileFields = {
  display_name: "Élodie Durand-Merel",
  job_title: "Architecte et décoratrice",
  company: "Atelier Merel",
  bio: "Je conçois des intérieurs sobres et lumineux pour les particuliers et les commerces de proximité.",
  contact_email: "elodie.contact@example.test",
  phone: "+33 6 41 27 93 58",
  website_url: "https://elodie-durand.example/",
  is_published: true,
  is_indexable: false,
};

export const FULL_PROFILE_INITIALS = "ED";

/** The ten platforms of 0016, in display order (positions 0 to 9), URLs in the normalised `new URL(x).href` form. */
export const ALL_PLATFORM_LINKS: readonly LinkFixture[] = [
  { platform: "linkedin", url: "https://www.linkedin.com/in/elodie-durand-merel", label: null },
  { platform: "github", url: "https://github.com/elodie-dm", label: null },
  { platform: "instagram", url: "https://www.instagram.com/elodie.dm/", label: "Mes photos" },
  { platform: "x", url: "https://x.com/elodie_dm", label: null },
  { platform: "facebook", url: "https://www.facebook.com/elodie.dm", label: null },
  { platform: "youtube", url: "https://www.youtube.com/@elodiedm", label: null },
  { platform: "tiktok", url: "https://www.tiktok.com/@elodiedm", label: null },
  { platform: "website", url: "https://blog.elodie-durand.example/", label: "Mon blog" },
  { platform: "document", url: "https://docs.elodie-durand.example/plaquette.pdf", label: "Plaquette" },
  { platform: "whatsapp", url: `https://wa.me/33${WHATSAPP_DIGITS}`, label: null },
];

let client: CarnetClient | undefined;

function admin(): CarnetClient {
  if (client === undefined) {
    ensureSupabaseEnv();
    client = adminClient();
  }
  return client;
}

/**
 * New member (through `register_member`), whose profile then receives `fields` and `links` through the
 * `service_role` client: no write under `authenticated` (0022). The slug is the account's.
 */
export async function createProfile(
  fields: Partial<ProfileFields> = {},
  links: readonly LinkFixture[] = [],
): Promise<ProfileFixture> {
  const account = newAccount();
  const userId = await createMember(account);
  const { data, error } = await admin()
    .from("profiles")
    .update({ ...FULL_PROFILE, ...fields })
    .eq("owner_id", userId)
    .select("id, slug")
    .single();
  if (error !== null) {
    throw error;
  }
  if (links.length > 0) {
    const rows = links.map((link, position) => ({ profile_id: data.id, position, ...link }));
    const { error: linksError } = await admin().from("links").insert(rows);
    if (linksError !== null) {
      throw linksError;
    }
  }
  return { userId, profileId: data.id, slug: data.slug, email: account.email };
}

/** Direct write by the `service_role` client: bypasses the Server Actions, hence any `updateTag`. */
export async function updateProfileBehindTheCache(slug: string, fields: Partial<ProfileFields>): Promise<void> {
  const { error } = await admin().from("profiles").update(fields).eq("slug", slug);
  if (error !== null) {
    throw error;
  }
}
