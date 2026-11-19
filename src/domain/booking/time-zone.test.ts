/**
 * Contract frozen by test-engineer (0037, decisions 3 and 5; notes inherited from 0036). Native Temporal (Node 26),
 * no dependency.
 *
 * // src/domain/booking/time-zone.ts
 * export type TimeZone = string & { readonly __brand: "TimeZone" };
 * // An IANA identifier known to Temporal, written exactly in its canonical case (carnet.is_valid_time_zone requires
 * // the exact pg_timezone_names name); null otherwise (empty, unknown, wrong case, UTC offset such as "+01:00").
 * export function parseTimeZone(value: string): TimeZone | null;
 * // 0037 point 7: the end of a local day, as written in rules ("24:00"); reused by availability.ts, slots.ts and
 * // src/ui/features/booking/weekly-rules.ts (no other "24:00" literal).
 * export const END_OF_DAY = "24:00";
 * // Local date + "HH:MM" (AvailabilityRule of availability.ts; END_OF_DAY = 00:00 of the next day) → instant, exactly as
 * // `(date + time) at time zone zone` in PostgreSQL (DetermineTimeZoneOffset):
 * //   - nonexistent time (spring forward): read with the offset in force BEFORE the transition (02:30 → 03:30 CEST);
 * //   - ambiguous time (fall back): read with the offset in force AFTER the transition (second occurrence, CET).
 * //   That is Temporal `disambiguation: "later"` in both cases — not "compatible" (first occurrence on fall back).
 * export function wallClockToInstant(date: Temporal.PlainDate, time: string, zone: TimeZone): Temporal.Instant;
 */
import { describe, expect, it } from "vitest";

import { END_OF_DAY, parseTimeZone, wallClockToInstant } from "@/domain/booking/time-zone";

import { zone } from "../../../tests/builders/booking-slots";

describe("parseTimeZone", () => {
  it.each(["Europe/Paris", "Asia/Tokyo", "Asia/Kolkata", "America/New_York", "UTC"])("accepts %s", (id) => {
    expect(parseTimeZone(id)).toBe(id);
  });

  it.each([
    ["empty", ""],
    ["unknown", "Mars/Olympus"],
    ["wrong case (not the exact pg_timezone_names name)", "europe/paris"],
    ["UTC offset", "+01:00"],
    ["padded", " Europe/Paris"],
  ])("rejects %s", (_label, value) => {
    expect(parseTimeZone(value)).toBeNull();
  });
});

describe("wallClockToInstant — same conversion as PostgreSQL `timestamp at time zone`", () => {
  it.each([
    ["Europe/Paris winter (CET)", "2027-03-03", "09:00", "Europe/Paris", "2027-03-03T08:00:00Z"],
    ["Europe/Paris summer (CEST)", "2027-04-30", "09:00", "Europe/Paris", "2027-04-30T07:00:00Z"],
    ["Asia/Tokyo, no DST", "2027-03-29", "09:00", "Asia/Tokyo", "2027-03-29T00:00:00Z"],
    ["Asia/Kolkata, non-integer offset", "2027-03-08", "09:00", "Asia/Kolkata", "2027-03-08T03:30:00Z"],
    ["Asia/Kolkata midnight is the previous UTC day", "2027-03-08", "00:00", "Asia/Kolkata", "2027-03-07T18:30:00Z"],
    ["night range of PA, 28 March 01:00 CET", "2027-03-28", "01:00", "Europe/Paris", "2027-03-28T00:00:00Z"],
    ["night range of PA, 28 March 04:00 CEST", "2027-03-28", "04:00", "Europe/Paris", "2027-03-28T02:00:00Z"],
    ["night range of PA, 31 October 01:00 CEST", "2027-10-31", "01:00", "Europe/Paris", "2027-10-30T23:00:00Z"],
    ["night range of PA, 31 October 04:00 CET", "2027-10-31", "04:00", "Europe/Paris", "2027-10-31T03:00:00Z"],
  ])("%s", (_label, date, time, id, expected) => {
    expect(wallClockToInstant(Temporal.PlainDate.from(date), time, zone(id)).toString()).toBe(expected);
  });

  it.each([
    ["Europe/Paris 28 March 02:30 → 02:30 CET = 03:30 CEST", "2027-03-28", "02:30", "Europe/Paris", "2027-03-28T01:30:00Z"],
    ["Europe/Paris 28 March 02:00 → 02:00 CET = 03:00 CEST", "2027-03-28", "02:00", "Europe/Paris", "2027-03-28T01:00:00Z"],
    ["America/New_York 14 March 02:30 → 02:30 EST = 03:30 EDT", "2027-03-14", "02:30", "America/New_York", "2027-03-14T07:30:00Z"],
    ["Australia/Lord_Howe 4 October 2026 02:15 (30-minute shift)", "2026-10-04", "02:15", "Australia/Lord_Howe", "2026-10-03T15:45:00Z"],
  ])("decision 3 — nonexistent time read with the offset before the transition: %s", (_label, date, time, id, expected) => {
    expect(wallClockToInstant(Temporal.PlainDate.from(date), time, zone(id)).toString()).toBe(expected);
  });

  it.each([
    ["Europe/Paris 31 October 02:30 → 02:30 CET (second occurrence)", "2027-10-31", "02:30", "Europe/Paris", "2027-10-31T01:30:00Z"],
    ["Europe/Paris 31 October 02:00 → 02:00 CET (second occurrence)", "2027-10-31", "02:00", "Europe/Paris", "2027-10-31T01:00:00Z"],
    ["America/New_York 7 November 01:30 → 01:30 EST", "2027-11-07", "01:30", "America/New_York", "2027-11-07T06:30:00Z"],
    ["Australia/Lord_Howe 4 April 2027 01:45 (30-minute shift)", "2027-04-04", "01:45", "Australia/Lord_Howe", "2027-04-03T15:15:00Z"],
  ])("0036 note — ambiguous time read with the offset after the transition, as PostgreSQL: %s", (_label, date, time, id, expected) => {
    expect(wallClockToInstant(Temporal.PlainDate.from(date), time, zone(id)).toString()).toBe(expected);
  });

  it.each([
    ["Europe/Paris, Saturday 6 March (CET)", "2027-03-06", "Europe/Paris", "2027-03-06T23:00:00Z"],
    ["Europe/Paris, Saturday 30 October (CEST, midnight before the fall back)", "2027-10-30", "Europe/Paris", "2027-10-30T22:00:00Z"],
    ["Europe/Paris, Sunday 31 October (CET after the fall back)", "2027-10-31", "Europe/Paris", "2027-10-31T23:00:00Z"],
    ["Asia/Kolkata", "2027-03-08", "Asia/Kolkata", "2027-03-08T18:30:00Z"],
  ])("0036 note — a rule may end at 24:00 (00:00 of the next local day): %s", (_label, date, id, expected) => {
    expect(wallClockToInstant(Temporal.PlainDate.from(date), "24:00", zone(id)).toString()).toBe(expected);
  });

  it("0037 point 7: END_OF_DAY is the domain constant \"24:00\", read as 00:00 of the next local day", () => {
    expect(END_OF_DAY).toBe("24:00");
    expect(wallClockToInstant(Temporal.PlainDate.from("2027-03-06"), END_OF_DAY, zone("Europe/Paris")).toString()).toBe(
      "2027-03-06T23:00:00Z",
    );
  });
});
