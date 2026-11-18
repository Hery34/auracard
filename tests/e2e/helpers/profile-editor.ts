import { expect, type Page } from "@playwright/test";

import type { LinkPlatform } from "../../../src/domain/profile/link";
import { adminClient, type CarnetClient } from "../../integration/setup/clients";
import ensureSupabaseEnv from "../../integration/setup/supabase-env";
import { PASSWORD, newClientAddress } from "./accounts";
import type { LinkFixture, ProfileFields } from "./public-profile";

/** A row of `carnet.links`, as `replace_links` stores it. */
export type StoredLink = { id: string; platform: LinkPlatform; url: string; label: string | null; position: number };

let client: CarnetClient | undefined;

/** `service_role` client of the local stack (same guard as `admin.ts`): reads and fixtures only, never under `authenticated`. */
function admin(): CarnetClient {
  if (client === undefined) {
    ensureSupabaseEnv();
    client = adminClient();
  }
  return client;
}

/** Links of a profile ordered by position, read behind the application. */
export async function linksOf(profileId: string): Promise<StoredLink[]> {
  const { data, error } = await admin()
    .from("links")
    .select("id, platform, url, label, position")
    .eq("profile_id", profileId)
    .order("position");
  if (error !== null) {
    throw error;
  }
  return data as StoredLink[];
}

/** Editable fields of a profile, read behind the application. */
export async function profileFieldsOf(profileId: string): Promise<ProfileFields> {
  const { data, error } = await admin()
    .from("profiles")
    .select("display_name, job_title, company, bio, contact_email, phone, website_url, is_published, is_indexable, accepts_leads")
    .eq("id", profileId)
    .single();
  if (error !== null) {
    throw error;
  }
  return data;
}

/** `count` distinct `website` links (positions 0 to count − 1), URLs already in their normalised `href` form. */
export function websiteLinks(count: number): LinkFixture[] {
  return Array.from({ length: count }, (_, index) => ({
    platform: "website" as const,
    url: `https://site-${String(index + 1).padStart(2, "0")}.e2e-editeur.example/`,
    label: null,
  }));
}

/**
 * Signs the member in through the form, from a fresh client address: the per-address `login` budget (10 per 15 min)
 * would not survive one sign-in per test on the shared worker address. Every later request of the page carries it.
 */
export async function signInAs(page: Page, email: string): Promise<void> {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": newClientAddress() });
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
}
