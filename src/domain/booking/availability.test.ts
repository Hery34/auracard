/**
 * Contract frozen by test-engineer (0038, decision 1 and notes of 0036; carnet.availability_rules and
 * carnet.availability_exceptions, 0036 decisions 3, 4 and point 17).
 *
 * // src/domain/booking/availability.ts — pure TypeScript; time zone conversions by Temporal (Node 26, 0037 decision 5).
 * export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;    // ISO: 1 = Monday … 7 = Sunday
 * export type Weekday = (typeof WEEKDAYS)[number];
 * export const MAX_AVAILABILITY_RULES = 50;                  // trigger availability_rules_limit
 * export const MIN_RULE_MINUTES = 5;                         // availability_rules_min_length_check
 * export const MAX_UPCOMING_EXCEPTIONS = 200;                // trigger availability_exceptions_limit
 * export const EXCEPTION_KINDS = ["busy", "extra"] as const;
 * export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];
 *
 * // Local times of the profile's time zone, "HH:MM" (00:00–23:59); an end may be END_OF_DAY ("24:00", exported by
 * // src/domain/booking/time-zone.ts, 0037 point 7). Also the rule type of the slot calculation (slots.ts).
 * export type AvailabilityRule = { weekday: Weekday; start: string; end: string };
 * export type RuleIssueReason = "invalid_weekday" | "invalid_time" | "invalid_order" | "too_short" | "overlap";
 * export type RuleIssue = { index: number; reason: RuleIssueReason };
 * // The full weekly list (replacement). More than 50 rules → "too_many" (nothing else checked). Otherwise one issue
 * // per faulty rule, by ascending index, first reason in the order above; the overlap check only runs between rules
 * // that are otherwise valid, and flags every rule of an overlapping pair (same weekday, [start, end) intersecting;
 * // adjacent plages allowed). Success: the rules sorted by weekday then start.
 * export function parseAvailabilityRules(
 *   rules: readonly { weekday: number; start: string; end: string }[],
 * ): Result<AvailabilityRule[], "too_many" | RuleIssue[]>;
 *
 * // An exception as stored: instants in ISO 8601 UTC with milliseconds (`Date.prototype.toISOString`), [startsAt, endsAt).
 * export type AvailabilityException = { id: string; kind: ExceptionKind; startsAt: string; endsAt: string };
 * export type NewExceptionRange = Omit<AvailabilityException, "id">;
 * export type ExceptionError = "invalid_kind" | "invalid_start" | "invalid_end" | "invalid_range" | "already_ended";
 * // `start` and `end`: `datetime-local` values "YYYY-MM-DDTHH:MM" (real calendar date, no seconds) read in `timeZone`;
 * // nonexistent local time (spring forward) and ambiguous one (fall back) read exactly as PostgreSQL
 * // `timestamp at time zone` (0037: wallClockToInstant of src/domain/booking/time-zone.ts, disambiguation "later" —
 * // 02:30 → 03:30 CEST in March, second occurrence (CET) in October), reuse it. First error in the order above;
 * // end ≤ start → invalid_range; end ≤ now → already_ended (an ongoing exception is accepted).
 * // 0038 point 6: the zone is a TimeZone value object (parsed at the repository boundary); no throw any more.
 * export function parseAvailabilityException(
 *   input: { kind: string; start: string; end: string }, timeZone: TimeZone, now: Date,
 * ): Result<NewExceptionRange, ExceptionError>;
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  EXCEPTION_KINDS,
  MAX_AVAILABILITY_RULES,
  MAX_UPCOMING_EXCEPTIONS,
  MIN_RULE_MINUTES,
  WEEKDAYS,
  parseAvailabilityException,
  parseAvailabilityRules,
} from "@/domain/booking/availability";
import { END_OF_DAY, type TimeZone } from "@/domain/booking/time-zone";
import { err, ok } from "@/domain/shared/result";

import { SETTINGS_NOW, aRule, aWorkingWeek } from "../../../tests/builders/booking-settings";
import { zone } from "../../../tests/builders/booking-slots";

const NOW = new Date(SETTINGS_NOW);
const PARIS = zone("Europe/Paris");

function exception(overrides: Partial<{ kind: string; start: string; end: string }> = {}) {
  return { kind: "busy", start: "2026-12-24T14:00", end: "2026-12-27T00:00", ...overrides };
}

describe("availability bounds (0036 decisions 3, 4 and point 17)", () => {
  it("same bounds as the database", () => {
    expect(WEEKDAYS).toStrictEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(MAX_AVAILABILITY_RULES).toBe(50);
    expect(MIN_RULE_MINUTES).toBe(5);
    expect(MAX_UPCOMING_EXCEPTIONS).toBe(200);
    expect(EXCEPTION_KINDS).toStrictEqual(["busy", "extra"]);
  });
});

describe("parseAvailabilityRules — criterion 1 (weekly rules)", () => {
  it("a working week is accepted as is", () => {
    expect(parseAvailabilityRules(aWorkingWeek())).toStrictEqual(ok(aWorkingWeek()));
  });

  it("an empty list is accepted (no availability: every rule removed)", () => {
    expect(parseAvailabilityRules([])).toStrictEqual(ok([]));
  });

  it("the result is sorted by weekday then start (identical reading whatever the input order)", () => {
    const shuffled = [...aWorkingWeek()].reverse();

    expect(parseAvailabilityRules(shuffled)).toStrictEqual(ok(aWorkingWeek()));
  });

  it.each([0, 8, -1, 1.5, Number.NaN])("weekday %d → invalid_weekday (ISO 1 to 7)", (weekday) => {
    expect(parseAvailabilityRules([aRule({ weekday: weekday as 1 })])).toStrictEqual(
      err([{ index: 0, reason: "invalid_weekday" }]),
    );
  });

  it("Sunday is 7 (ISO), accepted", () => {
    expect(parseAvailabilityRules([aRule({ weekday: 7 })])).toStrictEqual(ok([aRule({ weekday: 7 })]));
  });

  it.each([
    ["an hour without leading zero", { start: "9:00" }],
    ["minutes 60", { start: "09:60" }],
    ["hour 25", { end: "25:00" }],
    ["seconds (minute precision only)", { start: "09:00:00" }],
    ["seconds on the end", { end: "12:00:30" }],
    ["24:00 as a start", { start: "24:00", end: "24:00" }],
    ["24:01 as an end", { end: "24:01" }],
    ["an empty value", { start: "" }],
    ["a non-time text", { end: "midi" }],
  ])("%s → invalid_time", (_label, times) => {
    expect(parseAvailabilityRules([aRule(times)])).toStrictEqual(err([{ index: 0, reason: "invalid_time" }]));
  });

  it("a rule may end at 24:00 (end of the local day, 0037 note)", () => {
    expect(parseAvailabilityRules([aRule({ start: "20:00", end: "24:00" })])).toStrictEqual(
      ok([aRule({ start: "20:00", end: "24:00" })]),
    );
  });

  it("0037 point 7: the end of day accepted is the END_OF_DAY constant of the domain", () => {
    expect(END_OF_DAY).toBe("24:00");
    expect(parseAvailabilityRules([aRule({ start: "20:00", end: END_OF_DAY })])).toStrictEqual(
      ok([aRule({ start: "20:00", end: END_OF_DAY })]),
    );
  });

  it.each([
    ["start = end", { start: "10:00", end: "10:00" }],
    ["start after end", { start: "14:00", end: "09:00" }],
  ])("%s → invalid_order", (_label, times) => {
    expect(parseAvailabilityRules([aRule(times)])).toStrictEqual(err([{ index: 0, reason: "invalid_order" }]));
  });

  it("a plage of 4 minutes → too_short; exactly 5 minutes is accepted", () => {
    expect(parseAvailabilityRules([aRule({ start: "09:00", end: "09:04" })])).toStrictEqual(
      err([{ index: 0, reason: "too_short" }]),
    );
    expect(parseAvailabilityRules([aRule({ start: "09:00", end: "09:05" })])).toStrictEqual(
      ok([aRule({ start: "09:00", end: "09:05" })]),
    );
  });

  it("two overlapping plages the same day → both flagged overlap", () => {
    const rules = [aRule({ start: "09:00", end: "12:00" }), aRule({ weekday: 2 }), aRule({ start: "11:30", end: "13:00" })];

    expect(parseAvailabilityRules(rules)).toStrictEqual(
      err([
        { index: 0, reason: "overlap" },
        { index: 2, reason: "overlap" },
      ]),
    );
  });

  it("a plage contained in another and an exact duplicate overlap too", () => {
    expect(parseAvailabilityRules([aRule({ start: "09:00", end: "18:00" }), aRule({ start: "10:00", end: "11:00" })])).toStrictEqual(
      err([
        { index: 0, reason: "overlap" },
        { index: 1, reason: "overlap" },
      ]),
    );
    expect(parseAvailabilityRules([aRule(), aRule()])).toStrictEqual(
      err([
        { index: 0, reason: "overlap" },
        { index: 1, reason: "overlap" },
      ]),
    );
  });

  it("adjacent plages ([) bounds) and the same hours on another day do not overlap", () => {
    const rules = [aRule({ start: "09:00", end: "12:00" }), aRule({ start: "12:00", end: "13:00" }), aRule({ weekday: 3 })];

    expect(parseAvailabilityRules(rules)).toStrictEqual(
      ok([aRule({ start: "09:00", end: "12:00" }), aRule({ start: "12:00", end: "13:00" }), aRule({ weekday: 3 })]),
    );
  });

  it("an invalid rule is not compared for overlap; issues come by ascending index", () => {
    const rules = [aRule({ start: "10:00", end: "09:00" }), aRule({ start: "09:00", end: "12:00" }), aRule({ weekday: 9 as 1 })];

    expect(parseAvailabilityRules(rules)).toStrictEqual(
      err([
        { index: 0, reason: "invalid_order" },
        { index: 2, reason: "invalid_weekday" },
      ]),
    );
  });

  it("50 rules are accepted; 51 → too_many (trigger availability_rules_limit)", () => {
    const fifty = Array.from({ length: 50 }, (_, index) => {
      const weekday = ((index % 7) + 1) as 1;
      const hour = String(Math.floor(index / 7)).padStart(2, "0");
      return aRule({ weekday, start: `${hour}:00`, end: `${hour}:30` });
    });
    const fiftyOne = [...fifty, aRule({ weekday: 7, start: "23:00", end: "23:30" })];

    expect(parseAvailabilityRules(fifty).ok).toBe(true);
    expect(parseAvailabilityRules(fiftyOne)).toStrictEqual(err("too_many"));
  });
});

describe("parseAvailabilityException — criterion 1 (absences and one-off openings)", () => {
  it("0038 point 6: the zone parameter is a TimeZone value object", () => {
    expectTypeOf(parseAvailabilityException).parameter(1).toEqualTypeOf<TimeZone>();
  });

  it("0038 point 6: a raw string is refused by the compiler (the repository parses the stored zone)", () => {
    // @ts-expect-error 0038 point 6 — a plain string is not a TimeZone
    const result = parseAvailabilityException(exception(), "Europe/Paris", NOW);

    expect(result.ok).toBe(true);
  });

  it("an absence in Paris (CET, UTC+1) → instants in UTC", () => {
    expect(parseAvailabilityException(exception(), PARIS, NOW)).toStrictEqual(
      ok({ kind: "busy", startsAt: "2026-12-24T13:00:00.000Z", endsAt: "2026-12-26T23:00:00.000Z" }),
    );
  });

  it("a one-off opening in summer (CEST, UTC+2)", () => {
    expect(
      parseAvailabilityException(exception({ kind: "extra", start: "2027-07-03T09:00", end: "2027-07-03T12:30" }), PARIS, NOW),
    ).toStrictEqual(ok({ kind: "extra", startsAt: "2027-07-03T07:00:00.000Z", endsAt: "2027-07-03T10:30:00.000Z" }));
  });

  it("the profile's time zone is the one used (America/New_York, Asia/Tokyo)", () => {
    const local = exception({ start: "2026-12-24T14:00", end: "2026-12-24T18:00" });

    expect(parseAvailabilityException(local, zone("America/New_York"), NOW)).toStrictEqual(
      ok({ kind: "busy", startsAt: "2026-12-24T19:00:00.000Z", endsAt: "2026-12-24T23:00:00.000Z" }),
    );
    expect(parseAvailabilityException(local, zone("Asia/Tokyo"), NOW)).toStrictEqual(
      ok({ kind: "busy", startsAt: "2026-12-24T05:00:00.000Z", endsAt: "2026-12-24T09:00:00.000Z" }),
    );
  });

  it("DST, last Sunday of March: 02:30 does not exist in Paris → read with the offset before the change (03:30 CEST)", () => {
    expect(
      parseAvailabilityException(exception({ start: "2027-03-28T02:30", end: "2027-03-28T05:00" }), PARIS, NOW),
    ).toStrictEqual(ok({ kind: "busy", startsAt: "2027-03-28T01:30:00.000Z", endsAt: "2027-03-28T03:00:00.000Z" }));
  });

  it("DST, last Sunday of October: 02:30 occurs twice in Paris → second occurrence (CET, UTC+1), as PostgreSQL and 0037", () => {
    expect(
      parseAvailabilityException(exception({ start: "2027-10-31T02:30", end: "2027-10-31T05:00" }), PARIS, NOW),
    ).toStrictEqual(ok({ kind: "busy", startsAt: "2027-10-31T01:30:00.000Z", endsAt: "2027-10-31T04:00:00.000Z" }));
  });

  it("an exception across the October change keeps its real duration (one hour longer on the wall clock)", () => {
    const result = parseAvailabilityException(exception({ start: "2027-10-30T12:00", end: "2027-10-31T12:00" }), PARIS, NOW);

    expect(result).toStrictEqual(ok({ kind: "busy", startsAt: "2027-10-30T10:00:00.000Z", endsAt: "2027-10-31T11:00:00.000Z" }));
  });

  it("an unknown kind → invalid_kind (checked first)", () => {
    expect(parseAvailabilityException(exception({ kind: "holiday", start: "garbage" }), PARIS, NOW)).toStrictEqual(
      err("invalid_kind"),
    );
  });

  it.each([
    ["empty", ""],
    ["with seconds", "2026-12-24T14:00:00"],
    ["with a space", "2026-12-24 14:00"],
    ["with an offset", "2026-12-24T14:00+01:00"],
    ["an impossible date (30 February)", "2027-02-30T10:00"],
    ["an impossible time", "2026-12-24T24:00"],
  ])("a start %s → invalid_start", (_label, start) => {
    expect(parseAvailabilityException(exception({ start }), PARIS, NOW)).toStrictEqual(err("invalid_start"));
  });

  it("a malformed end → invalid_end", () => {
    expect(parseAvailabilityException(exception({ end: "2026-12-27" }), PARIS, NOW)).toStrictEqual(err("invalid_end"));
  });

  it.each([
    ["end = start", "2026-12-24T14:00"],
    ["end before start", "2026-12-24T13:59"],
  ])("%s → invalid_range (non-empty [) range)", (_label, end) => {
    expect(parseAvailabilityException(exception({ end }), PARIS, NOW)).toStrictEqual(err("invalid_range"));
  });

  it("an end equal to now (11:00 in Paris) → already_ended; one minute later is accepted", () => {
    expect(
      parseAvailabilityException(exception({ start: "2026-11-18T09:00", end: "2026-11-18T11:00" }), PARIS, NOW),
    ).toStrictEqual(err("already_ended"));
    expect(
      parseAvailabilityException(exception({ start: "2026-11-18T09:00", end: "2026-11-18T11:01" }), PARIS, NOW),
    ).toStrictEqual(ok({ kind: "busy", startsAt: "2026-11-18T08:00:00.000Z", endsAt: "2026-11-18T10:01:00.000Z" }));
  });

  it("an exception entirely in the past → already_ended", () => {
    expect(
      parseAvailabilityException(exception({ start: "2026-11-10T09:00", end: "2026-11-12T18:00" }), PARIS, NOW),
    ).toStrictEqual(err("already_ended"));
  });
});
