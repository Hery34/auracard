import { randomUUID } from "node:crypto";

import { adminClient, type CarnetClient } from "../../integration/setup/clients";
import ensureSupabaseEnv from "../../integration/setup/supabase-env";

let client: CarnetClient | undefined;

/** `service_role` client of the local stack (same guard as `admin.ts`): fixtures and reads behind the application. */
function admin(): CarnetClient {
  if (client === undefined) {
    ensureSupabaseEnv();
    client = adminClient();
  }
  return client;
}

/** SITE_URL handed to `pnpm start` by `playwright.config.ts` (same rule): the QR encodes `${SITE_URL}/q/{code}`. */
export function e2eSiteUrl(): string {
  if (process.env.SITE_URL) {
    return new URL(process.env.SITE_URL).origin;
  }
  return process.env.E2E_BASE_URL ? new URL(process.env.E2E_BASE_URL).origin : "https://localhost:3000";
}

/** Style stored for the profile, `null` while no QR exists. */
export async function qrStyleOf(profileId: string): Promise<unknown> {
  const { data, error } = await admin().from("qr_codes").select("style").eq("profile_id", profileId).maybeSingle();
  if (error !== null) {
    throw error;
  }
  return data?.style ?? null;
}

/** Fixture: a logo object name on the profile (format of 0021; the file itself is not needed in lot A). */
export async function giveLogo(profileId: string): Promise<void> {
  const { error } = await admin()
    .from("profiles")
    .update({ logo_url: `${profileId}/logo-${randomUUID()}.png` })
    .eq("id", profileId);
  if (error !== null) {
    throw error;
  }
}
