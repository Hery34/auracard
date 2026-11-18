import { eventsOf, type EventRow } from "../../integration/setup/analytics";
import { adminClient, type CarnetClient } from "../../integration/setup/clients";
import ensureSupabaseEnv from "../../integration/setup/supabase-env";

export type { EventRow };

let client: CarnetClient | undefined;

/** `service_role` client of the local stack (same guard as `admin.ts`): the events are read behind the application. */
function admin(): CarnetClient {
  if (client === undefined) {
    ensureSupabaseEnv();
    client = adminClient();
  }
  return client;
}

/** Raw events of the profile, oldest first. */
export async function profileEvents(profileId: string): Promise<EventRow[]> {
  return eventsOf(admin(), profileId);
}

/** Id of the link at `position` (fixtures of `createProfile`, positions 0…n). */
export async function linkIdAt(profileId: string, position: number): Promise<string> {
  const { data, error } = await admin()
    .from("links")
    .select("id")
    .eq("profile_id", profileId)
    .eq("position", position)
    .single();
  if (error !== null) {
    throw error;
  }
  return data.id;
}

/** Init script: tel:/mailto:/WhatsApp navigations and window.open are cancelled after the page's own handlers ran. */
export const CONTACT_NAVIGATION_GUARD = `
  window.open = function () { return null; };
  window.addEventListener("click", function (event) {
    var anchor = event.target instanceof Element ? event.target.closest("a") : null;
    var href = anchor ? anchor.getAttribute("href") || "" : "";
    if (/^(tel|mailto):/i.test(href) || /wa\\.me|whatsapp\\.com/i.test(href)) event.preventDefault();
  });
`;
