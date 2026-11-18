import { randomUUID } from "node:crypto";

import type { CarnetClient } from "./clients";

/** Page size of the reads behind the application, under PostgREST max_rows (100 locally and on the shared instance). */
const READ_PAGE = 100;

/** `datetime-local` value ("YYYY-MM-DDTHH:MM") `days` days after `from`, at `time`, in `timeZone`. */
export function localInDays(from: Date, days: number, time: string, timeZone = "Europe/Paris"): string {
  const date = Temporal.Instant.fromEpochMilliseconds(from.getTime()).toZonedDateTimeISO(timeZone).toPlainDate().add({ days });
  return `${date.toString()}T${time}`;
}

/** Instant `minutes` minutes after `from`, truncated to the minute (bounds of availability_exceptions). */
export function minutesAfter(from: Date, minutes: number): Date {
  const truncated = Math.floor(from.getTime() / 60_000) * 60_000;
  return new Date(truncated + minutes * 60_000);
}

/** Fixture: `count` busy exceptions of 30 minutes, one per hour from `firstStart`, written behind the application. */
export async function insertUpcomingExceptions(
  admin: CarnetClient,
  profileId: string,
  firstStart: Date,
  count: number,
): Promise<string[]> {
  const rows = Array.from({ length: count }, (_, index) => {
    const start = new Date(firstStart.getTime() + index * 3_600_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    return { id: randomUUID(), profile_id: profileId, kind: "busy", range: `[${start.toISOString()},${end.toISOString()})` };
  });
  for (let offset = 0; offset < rows.length; offset += READ_PAGE) {
    const { error } = await admin.from("availability_exceptions").insert(rows.slice(offset, offset + READ_PAGE));
    if (error !== null) {
      throw error;
    }
  }
  return rows.map((row) => row.id);
}

/** Fixture: a confirmed booking of `eventTypeId`, written behind the application (service_role). */
export async function insertBooking(admin: CarnetClient, profileId: string, eventTypeId: string, start: Date): Promise<string> {
  const end = new Date(start.getTime() + 30 * 60_000);
  const { data, error } = await admin
    .from("bookings")
    .insert({
      profile_id: profileId,
      event_type_id: eventTypeId,
      range: `[${start.toISOString()},${end.toISOString()})`,
      visitor_name: "Jean Visiteur",
      visitor_email: "jean.visiteur@example.test",
      consent_at: new Date().toISOString(),
      idempotency_key: randomUUID(),
    })
    .select("id")
    .single();
  if (error !== null) {
    throw error;
  }
  return data.id;
}

export type StoredEventType = {
  id: string;
  title: string;
  duration_min: number;
  buffer_min: number;
  min_notice_min: number;
  location_kind: string;
  location_text: string | null;
  is_active: boolean;
  position: number;
};

/** Event types of a profile, read behind the application, by position (at most 10). */
export async function eventTypesOf(admin: CarnetClient, profileId: string): Promise<StoredEventType[]> {
  const { data, error } = await admin
    .from("event_types")
    .select("id, title, duration_min, buffer_min, min_notice_min, location_kind, location_text, is_active, position")
    .eq("profile_id", profileId)
    .order("position");
  if (error !== null) {
    throw error;
  }
  return data;
}

/** Rules of a profile, read behind the application, as `HH:MM:SS` text, by weekday then start (at most 50). */
export async function rulesOf(
  admin: CarnetClient,
  profileId: string,
): Promise<{ weekday: number; start_time: string; end_time: string }[]> {
  const { data, error } = await admin
    .from("availability_rules")
    .select("weekday, start_time, end_time")
    .eq("profile_id", profileId)
    .order("weekday")
    .order("start_time");
  if (error !== null) {
    throw error;
  }
  return data;
}

/** Exceptions of a profile, read behind the application: kind and instants of the stored `[)` range (ISO, UTC). */
export async function exceptionsOf(
  admin: CarnetClient,
  profileId: string,
): Promise<{ id: string; kind: string; startsAt: string; endsAt: string }[]> {
  const result: { id: string; kind: string; startsAt: string; endsAt: string }[] = [];
  for (let offset = 0; ; offset += READ_PAGE) {
    const { data, error } = await admin
      .from("availability_exceptions")
      .select("id, kind, range")
      .eq("profile_id", profileId)
      .order("id")
      .range(offset, offset + READ_PAGE - 1);
    if (error !== null) {
      throw error;
    }
    for (const row of data) {
      const match = /^\["?([^",]+)"?,"?([^",]+)"?\)$/.exec(String(row.range));
      if (match === null) {
        throw new Error(`unexpected range text: ${String(row.range)}`);
      }
      result.push({
        id: row.id,
        kind: row.kind,
        startsAt: new Date(match[1] ?? "").toISOString(),
        endsAt: new Date(match[2] ?? "").toISOString(),
      });
    }
    if (data.length < READ_PAGE) {
      return result;
    }
  }
}

export async function timeZoneOf(admin: CarnetClient, profileId: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("time_zone").eq("id", profileId).single();
  if (error !== null) {
    throw error;
  }
  return data.time_zone;
}

export async function bookingStatusOf(admin: CarnetClient, bookingId: string): Promise<string | null> {
  const { data, error } = await admin.from("bookings").select("status").eq("id", bookingId).maybeSingle();
  if (error !== null) {
    throw error;
  }
  return data?.status ?? null;
}
