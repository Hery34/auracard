import { insertBooking } from "../../integration/setup/booking-settings";
import { adminClient, type CarnetClient } from "../../integration/setup/clients";
import { bookingsOf, insertEventTypes, insertRules, type BookingRow, type RuleFixture, type TypeFixture } from "../../integration/setup/public-booking";
import ensureSupabaseEnv from "../../integration/setup/supabase-env";

export type { BookingRow, RuleFixture, TypeFixture };

let client: CarnetClient | undefined;

/** `service_role` client of the local stack (same guard as `admin.ts`): fixtures and reads behind the application. */
function admin(): CarnetClient {
  if (client === undefined) {
    ensureSupabaseEnv();
    client = adminClient();
  }
  return client;
}

/** Fixture: event types of a profile (positions 0…n), written behind the application; returns their ids. */
export async function seedEventTypes(profileId: string, types: readonly TypeFixture[]): Promise<string[]> {
  return insertEventTypes(admin(), profileId, types);
}

export async function seedRules(profileId: string, rules: readonly RuleFixture[]): Promise<void> {
  await insertRules(admin(), profileId, rules);
}

export async function setProfileTimeZone(profileId: string, timeZone: string): Promise<void> {
  const { error } = await admin().from("profiles").update({ time_zone: timeZone }).eq("id", profileId);
  if (error !== null) {
    throw error;
  }
}

/** A confirmed 30-minute booking of `eventTypeId` written behind the application (another visitor took the slot). */
export async function takeSlotBehindTheApplication(profileId: string, eventTypeId: string, start: Date): Promise<void> {
  await insertBooking(admin(), profileId, eventTypeId, start);
}

export async function storedBookings(profileId: string): Promise<BookingRow[]> {
  return bookingsOf(admin(), profileId);
}

/** Start instant of a stored booking (`["2026-11-23 08:00:00+00","…")` as PostgREST prints a tstzrange). */
export function bookingStart(row: BookingRow): string {
  const text = String(row.range);
  const match = /^\["?([^",]+)"?,/.exec(text);
  if (match === null) {
    throw new Error(`unexpected range text: ${text}`);
  }
  return Temporal.Instant.from(new Date(match[1] ?? "").toISOString()).toString();
}

/** `date` at `time` in `timeZone` (owner's rule), as an instant. */
export function localInstant(date: Temporal.PlainDate, time: string, timeZone: string): Temporal.Instant {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return date.toPlainDateTime({ hour, minute }).toZonedDateTime(timeZone).toInstant();
}

/** Accessible name of a day choice: `Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" })`. */
export function dayLabel(at: Temporal.Instant, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone }).format(new Date(at.epochMilliseconds));
}

/** Accessible name prefix of a slot choice: "HH:MM", 24 h, in the browser's zone. */
export function timeLabel(at: Temporal.Instant, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(at.epochMilliseconds));
}

/** "YYYYMMDDTHHMMSSZ" of the .ics. */
export function icsUtc(at: Temporal.Instant): string {
  return at.toString().replace(/[-:]/g, "").replace(/\.\d+/, "");
}

/**
 * A zone of the list whose next change of time falls between 2 and 50 days from now (inside the 60-day horizon of
 * book_slot), with the local dates just before and after it; null when none (no change of time anywhere in that
 * window, as between mid-November and early March).
 */
export function upcomingTimeChange(): { timeZone: string; before: Temporal.PlainDate; after: Temporal.PlainDate } | null {
  const now = Temporal.Now.instant();
  const candidates = ["Europe/Paris", "America/New_York", "America/Santiago", "Australia/Sydney", "Pacific/Auckland", "America/Asuncion"];
  for (const timeZone of candidates) {
    const transition = now.toZonedDateTimeISO(timeZone).getTimeZoneTransition("next");
    if (transition === null) {
      continue;
    }
    const days = transition.toInstant().since(now).total("hours") / 24;
    if (days >= 2 && days <= 50) {
      const date = transition.toPlainDate();
      return { timeZone, before: date.subtract({ days: 1 }), after: date.add({ days: 1 }) };
    }
  }
  return null;
}
