import { adminClient, type CarnetClient } from "../../integration/setup/clients";
import {
  eventTypesOf,
  exceptionsOf,
  insertBooking,
  rulesOf,
  timeZoneOf,
  type StoredEventType,
} from "../../integration/setup/booking-settings";
import ensureSupabaseEnv from "../../integration/setup/supabase-env";

export { localInDays } from "../../integration/setup/booking-settings";
export type { StoredEventType };

let client: CarnetClient | undefined;

/** `service_role` client of the local stack (same guard as `admin.ts`): checks and fixtures behind the application. */
function admin(): CarnetClient {
  if (client === undefined) {
    ensureSupabaseEnv();
    client = adminClient();
  }
  return client;
}

export async function storedEventTypes(profileId: string): Promise<StoredEventType[]> {
  return eventTypesOf(admin(), profileId);
}

export async function storedRules(profileId: string): Promise<{ weekday: number; start_time: string; end_time: string }[]> {
  return rulesOf(admin(), profileId);
}

export async function storedExceptions(profileId: string): Promise<{ id: string; kind: string; startsAt: string; endsAt: string }[]> {
  return exceptionsOf(admin(), profileId);
}

export async function storedTimeZone(profileId: string): Promise<string> {
  return timeZoneOf(admin(), profileId);
}

/** A 30-minute video type and one confirmed booking of it in a week, written behind the application. */
export async function seedTypeWithBooking(profileId: string, title: string): Promise<string> {
  const { data, error } = await admin()
    .from("event_types")
    .insert({ profile_id: profileId, title, duration_min: 30, location_kind: "video", location_text: "https://visio.example.test/e2e", position: 0 })
    .select("id")
    .single();
  if (error !== null) {
    throw error;
  }
  const start = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 7 * 24 * 3_600_000);
  await insertBooking(admin(), profileId, data.id, start);
  return data.id;
}
