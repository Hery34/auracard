import { adminClient, type CarnetClient } from "../../integration/setup/clients";
import ensureSupabaseEnv from "../../integration/setup/supabase-env";
import { insertLeads, leadsOf, type LeadFixture, type LeadRow } from "../../integration/setup/leads";

export type { LeadFixture, LeadRow };

let client: CarnetClient | undefined;

/** `service_role` client of the local stack (same guard as `admin.ts`): fixtures and reads behind the application. */
function admin(): CarnetClient {
  if (client === undefined) {
    ensureSupabaseEnv();
    client = adminClient();
  }
  return client;
}

/** Fixture: messages written behind the application, with the dates chosen by the test. Returns their ids in order. */
export async function seedLeads(profileId: string, rows: readonly LeadFixture[]): Promise<string[]> {
  return insertLeads(admin(), profileId, rows);
}

/** Every message of a profile, newest first, read behind the application. */
export async function storedLeads(profileId: string): Promise<LeadRow[]> {
  return leadsOf(admin(), profileId);
}

/** created_at `minutesAgo` minutes before now (the page shows the newest first; the real clock only orders them). */
export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * Second `pnpm start` of the E2E run, identical to the main one except `TURNSTILE_SECRET_KEY`, set to Cloudflare's
 * « always refuses » test secret (`2x0000000000000000000000000000000AA`): the widget (test site key « always passes »)
 * hands a token, and the server refuses it at siteverify (0032, decision 6). Declared by `playwright.config.ts`.
 */
export function refusingOrigin(): string {
  return new URL(process.env.E2E_TURNSTILE_REFUSING_URL ?? "http://localhost:3001").origin;
}
