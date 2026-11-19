import { randomUUID } from "node:crypto";

import { anonClient, type CarnetClient } from "./clients";
import { PASSWORD } from "./fixtures";

/** Fiche 0039 — fixtures and reads of the public booking, behind the application (service_role). */

export type TypeFixture = {
  title?: string;
  duration_min?: number;
  buffer_min?: number;
  min_notice_min?: number;
  location_kind?: "in_person" | "phone" | "video";
  location_text?: string | null;
  is_active?: boolean;
};

export type RuleFixture = { weekday: number; start_time: string; end_time: string };

/** Every day 00:00–24:00 in the profile's zone: any start aligned on the duration from local midnight is offered. */
export const ALL_DAY_RULES: readonly RuleFixture[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  start_time: "00:00",
  end_time: "24:00",
}));

/** Fixture: event types (positions 0…n in order) of a profile; returns their ids. */
export async function insertEventTypes(admin: CarnetClient, profileId: string, types: readonly TypeFixture[]): Promise<string[]> {
  const rows = types.map((type, position) => ({
    id: randomUUID(),
    profile_id: profileId,
    title: type.title ?? `Type ${position}`,
    duration_min: type.duration_min ?? 30,
    buffer_min: type.buffer_min ?? 0,
    min_notice_min: type.min_notice_min ?? 0,
    location_kind: type.location_kind ?? "video",
    location_text: type.location_text === undefined ? (type.location_kind === "phone" ? null : "https://visio.example.test/it") : type.location_text,
    is_active: type.is_active ?? true,
    position,
  }));
  const { error } = await admin.from("event_types").insert(rows);
  if (error !== null) {
    throw error;
  }
  return rows.map((row) => row.id);
}

/** Fixture: weekly rules of a profile. */
export async function insertRules(admin: CarnetClient, profileId: string, rules: readonly RuleFixture[]): Promise<void> {
  const { error } = await admin.from("availability_rules").insert(rules.map((rule) => ({ profile_id: profileId, ...rule })));
  if (error !== null) {
    throw error;
  }
}

/** The `position`-th rule of 5 minutes (weekday × hour): two positions never overlap. */
export function ruleAt(position: number): RuleFixture {
  const hour = String(Math.floor(position / 7)).padStart(2, "0");
  return { weekday: (position % 7) + 1, start_time: `${hour}:00`, end_time: `${hour}:05` };
}

/** `count` distinct rules from `offset` (see `ruleAt`). */
export function distinctRules(count: number, offset = 0): RuleFixture[] {
  return Array.from({ length: count }, (_, index) => ruleAt(index + offset));
}

export type BookingRow = {
  id: string;
  event_type_id: string;
  /** tstzrange text as PostgREST prints it. */
  range: unknown;
  status: string;
  visitor_name: string;
  visitor_email: string;
  visitor_phone: string | null;
  message: string | null;
  idempotency_key: string;
};

/** Bookings of a profile (at most a few dozen in these tests), by creation. */
export async function bookingsOf(admin: CarnetClient, profileId: string): Promise<BookingRow[]> {
  const { data, error } = await admin
    .from("bookings")
    .select("id, event_type_id, range, status, visitor_name, visitor_email, visitor_phone, message, idempotency_key")
    .eq("profile_id", profileId)
    .order("created_at");
  if (error !== null) {
    throw error;
  }
  return data;
}

export async function countRows(admin: CarnetClient, table: "availability_rules" | "availability_exceptions", profileId: string): Promise<number> {
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true }).eq("profile_id", profileId);
  if (error !== null) {
    throw error;
  }
  return count ?? 0;
}

/** A second signed-in client of the same account: two concurrent requests of the owner (two tabs). */
export async function anotherSession(email: string): Promise<CarnetClient> {
  const session = anonClient();
  const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
  if (error !== null) {
    throw error;
  }
  return session;
}

/** First instant at least `hours` hours after `from`, on a whole UTC hour (aligned for 30- and 60-minute types). */
export function wholeHourAfter(from: Date, hours: number): Date {
  const hour = 3_600_000;
  return new Date(Math.ceil((from.getTime() + hours * hour) / hour) * hour);
}

export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * 60_000);
}

/** Canonical UTC text of an instant, as the action hands `start` to the use case. */
export function instantText(at: Date): string {
  return Temporal.Instant.fromEpochMilliseconds(at.getTime()).toString();
}
