/**
 * Contract frozen by test-engineer (0037, decisions 1 to 5, notes inherited from 0036, ADR 0016 §6).
 * The SQL function carnet.assert_bookable_slot stays the authority (decision 4): computeSlots offers exactly the
 * starts it would accept, on the same cases (tests/builders/booking-slot-cases.ts).
 *
 * // src/domain/booking/slots.ts — pure, deterministic, no Next.js / Supabase / Node.js, never reads the real clock.
 * // 0037 point 7 — one set of types: the rules are AvailabilityRule (Weekday) of src/domain/booking/availability.ts,
 * // local "HH:MM" of the profile time zone, end may be END_OF_DAY ("24:00", exported by time-zone.ts); the adapter
 * // (0039) drops the ":00" seconds of the jsonb `time` text. IsoWeekday and SlotRule no longer exist.
 * // From get_public_booking_page.event_types[i] (duration_min, buffer_min, min_notice_min).
 * export type SlotEventType = { readonly durationMin: number; readonly bufferMin: number; readonly minNoticeMin: number };
 * export type SlotQuery = {
 *   readonly timeZone: TimeZone;               // profile time zone (get_public_booking_page.time_zone)
 *   readonly eventType: SlotEventType;
 *   readonly rules: readonly AvailabilityRule[];
 *   readonly extra: readonly TimeRange[];      // get_public_busy_ranges.extra
 *   readonly busy: readonly TimeRange[];       // get_public_busy_ranges.busy: bookings [start, end + their buffer)
 *                                              // and busy exceptions, as returned (buffer already added)
 *   readonly now: Temporal.Instant;            // injected clock (Clock.now() of the caller)
 *   readonly range: TimeRange;                 // requested [from, to), at most 62 days of 24 h
 * };
 * export type Slot = TimeRange;                // [start, start + durationMin)
 * export const MAX_SLOT_QUERY_HOURS = 1488;    // 62 days
 * export const BOOKING_HORIZON_HOURS = 1440;   // 60 days, as `p_now + interval '1440 hours'`
 * // ok: slots whose start lies in [from, to), sorted by start, without duplicates; a start is offered iff
 * //   - start >= now + minNoticeMin (inclusive) and start <= now + 1440 h (inclusive);
 * //   - some window W contains [start, start + duration) with (start − W.start) a multiple of the duration in real
 * //     time (epoch), W being either a rule of the local ISO weekday of `start` in timeZone, from
 * //     wallClockToInstant(localDate(start), start) to wallClockToInstant(localDate(start), end), or an
 * //     extra range; windows are never merged;
 * //   - [start, start + duration + bufferMin) overlaps no busy range (contiguity allowed).
 * // err("invalid_range"): to <= from, or to − from > 62 days.
 * //
 * // 0037 point 7 — bounded cost (audit MEDIUM). Extra windows are clipped to the requested range and their starts
 * // deduplicated before the alignment; the work never grows with the number of overlapping extras.
 * export const MAX_SLOT_CANDIDATES = 20_000;
 * // A candidate is a distinct start in [from, to) aligned on the start of a window and whose [start, start + duration)
 * // fits in that window, counted BEFORE the notice, horizon, local-day and busy filters. Above MAX_SLOT_CANDIDATES,
 * // the computation stops: err("too_many_slots") (never a truncated list, which the page could not tell from a full
 * // one). A legitimate profile stays below it: 24 h rules every day with a 5-minute type over 62 days give at most
 * // 17 856 candidates. Exactly MAX_SLOT_CANDIDATES is accepted.
 * export function computeSlots(query: SlotQuery): Result<readonly Slot[], "invalid_range" | "too_many_slots">;
 */
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { AvailabilityRule, Weekday } from "@/domain/booking/availability";
import type * as Slots from "@/domain/booking/slots";
import {
  BOOKING_HORIZON_HOURS,
  computeSlots,
  MAX_SLOT_CANDIDATES,
  MAX_SLOT_QUERY_HOURS,
  type SlotQuery,
} from "@/domain/booking/slots";
import type { TimeRange } from "@/domain/booking/time-range";
import { END_OF_DAY } from "@/domain/booking/time-zone";

import { E0, E1, E4, E7, PA, PB, PK, SLOT_CASES, type SlotCase } from "../../../tests/builders/booking-slot-cases";
import {
  aSlotEventType,
  aSlotQuery,
  bookingBusy,
  everyMinutes,
  instant,
  overlappingExtras,
  range,
  rule,
  rulesOn,
  starts,
  T_MAR,
  T_OCT,
  zone,
} from "../../../tests/builders/booking-slots";

function slotsOf(query: SlotQuery): readonly TimeRange[] {
  const result = computeSlots(query);
  if (!result.ok) {
    throw new Error(`computeSlots refused the query: ${result.error}`);
  }
  return result.value;
}

function queryForCase(c: SlotCase): SlotQuery {
  const start = instant(c.start);
  return aSlotQuery({
    timeZone: zone(c.profile.timeZone),
    eventType: c.eventType,
    rules: c.profile.rules,
    extra: c.profile.extra,
    busy: [...c.profile.busy, ...c.existing],
    now: instant(c.now),
    range: { start: start.subtract({ hours: 6 }), end: start.add({ hours: 6 }) },
  });
}

describe("computeSlots — same verdicts as carnet.assert_bookable_slot (shared cases)", () => {
  it.each(SLOT_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const offered = slotsOf(queryForCase(c)).find((slot) => slot.start.equals(instant(c.start)));

    expect(offered !== undefined).toBe(c.bookable);
    if (offered !== undefined) {
      expect(offered.end.toString()).toBe(instant(c.start).add({ minutes: c.eventType.durationMin }).toString());
    }
  });
});

describe("computeSlots — full days", () => {
  it("decision 2: PA e0 Wednesday 3 March (CET), step = duration from the start of each range", () => {
    const slots = slotsOf(
      aSlotQuery({ eventType: E0, rules: PA.rules, range: range("2027-03-03T00:00:00Z", "2027-03-04T00:00:00Z") }),
    );

    expect(starts(slots)).toStrictEqual([
      "2027-03-03T08:00:00Z",
      "2027-03-03T08:30:00Z",
      "2027-03-03T09:00:00Z",
      "2027-03-03T09:30:00Z",
      "2027-03-03T10:00:00Z",
      "2027-03-03T10:30:00Z",
      "2027-03-03T13:00:00Z",
      "2027-03-03T13:30:00Z",
      "2027-03-03T14:00:00Z",
      "2027-03-03T14:30:00Z",
      "2027-03-03T15:00:00Z",
      "2027-03-03T15:30:00Z",
      "2027-03-03T16:00:00Z",
      "2027-03-03T16:30:00Z",
    ]);
    expect(slots.map((slot) => slot.end.toString())[0]).toBe("2027-03-03T08:30:00Z");
  });

  it("criterion 2 (buffer): an existing booking [start, end + its buffer) removes the slots whose end + buffer reach it", () => {
    const slots = slotsOf(
      aSlotQuery({
        eventType: E0,
        rules: PA.rules,
        busy: [bookingBusy("2027-03-03T09:00:00Z", 30, 30)],
        range: range("2027-03-03T07:00:00Z", "2027-03-03T11:00:00Z"),
      }),
    );

    expect(starts(slots)).toStrictEqual(["2027-03-03T08:00:00Z", "2027-03-03T10:00:00Z", "2027-03-03T10:30:00Z"]);
  });

  it("criterion 1: Europe/Paris spring forward (28 March 2027), e1 — night range of 3 local hours lasts 2 real hours", () => {
    const slots = slotsOf(
      aSlotQuery({ eventType: E1, rules: PA.rules, range: range("2027-03-27T23:00:00Z", "2027-03-28T22:00:00Z") }),
    );

    expect(starts(slots)).toStrictEqual([
      "2027-03-28T00:00:00Z",
      "2027-03-28T01:00:00Z",
      "2027-03-28T07:00:00Z",
      "2027-03-28T08:00:00Z",
      "2027-03-28T09:00:00Z",
    ]);
  });

  it("criterion 1: Europe/Paris fall back (31 October 2027), e1 — four one-hour slots in a local range of 3 h", () => {
    const slots = slotsOf(
      aSlotQuery({
        eventType: E1,
        rules: PA.rules,
        now: instant(T_OCT),
        range: range("2027-10-30T22:00:00Z", "2027-10-31T23:00:00Z"),
      }),
    );

    expect(starts(slots)).toStrictEqual([
      "2027-10-30T23:00:00Z",
      "2027-10-31T00:00:00Z",
      "2027-10-31T01:00:00Z",
      "2027-10-31T02:00:00Z",
      "2027-10-31T08:00:00Z",
      "2027-10-31T09:00:00Z",
      "2027-10-31T10:00:00Z",
    ]);
  });

  it("0036 note: 45-minute type on 28 March — real-time step, non-round wall times after the jump", () => {
    const slots = slotsOf(
      aSlotQuery({ eventType: E7, rules: PA.rules, range: range("2027-03-27T23:00:00Z", "2027-03-28T22:00:00Z") }),
    );

    expect(starts(slots)).toStrictEqual([
      "2027-03-28T00:00:00Z",
      "2027-03-28T00:45:00Z",
      "2027-03-28T07:00:00Z",
      "2027-03-28T07:45:00Z",
      "2027-03-28T08:30:00Z",
      "2027-03-28T09:15:00Z",
    ]);
  });

  it("0036 note: 45-minute type on 31 October — five slots in the 4-real-hour night range", () => {
    const slots = slotsOf(
      aSlotQuery({
        eventType: E7,
        rules: PA.rules,
        now: instant(T_OCT),
        range: range("2027-10-30T22:00:00Z", "2027-10-31T23:00:00Z"),
      }),
    );

    expect(starts(slots)).toStrictEqual([
      "2027-10-30T23:00:00Z",
      "2027-10-30T23:45:00Z",
      "2027-10-31T00:30:00Z",
      "2027-10-31T01:15:00Z",
      "2027-10-31T02:00:00Z",
      "2027-10-31T08:00:00Z",
      "2027-10-31T08:45:00Z",
      "2027-10-31T09:30:00Z",
      "2027-10-31T10:15:00Z",
    ]);
  });

  it("criterion 1: time zone without DST (Asia/Tokyo), Monday 29 March after the European jump", () => {
    const slots = slotsOf(
      aSlotQuery({
        timeZone: zone(PB.timeZone),
        eventType: E4,
        rules: PB.rules,
        range: range("2027-03-28T15:00:00Z", "2027-03-29T15:00:00Z"),
      }),
    );

    expect(starts(slots)).toStrictEqual([
      "2027-03-28T21:00:00Z",
      "2027-03-28T22:00:00Z",
      "2027-03-29T00:00:00Z",
      "2027-03-29T01:00:00Z",
      "2027-03-29T02:00:00Z",
      "2027-03-29T03:00:00Z",
      "2027-03-29T04:00:00Z",
      "2027-03-29T05:00:00Z",
      "2027-03-29T06:00:00Z",
      "2027-03-29T07:00:00Z",
    ]);
  });

  it("criterion 1: non-integer offset (Asia/Kolkata, UTC+05:30), local Monday starting on the UTC Sunday", () => {
    const slots = slotsOf(
      aSlotQuery({
        timeZone: zone(PK.timeZone),
        eventType: E4,
        rules: PK.rules,
        range: range("2027-03-07T18:30:00Z", "2027-03-08T18:30:00Z"),
      }),
    );

    expect(starts(slots)).toStrictEqual([
      "2027-03-07T18:30:00Z",
      "2027-03-07T19:30:00Z",
      "2027-03-08T03:30:00Z",
      "2027-03-08T04:30:00Z",
      "2027-03-08T05:30:00Z",
    ]);
  });
});

describe("computeSlots — exceptions and windows", () => {
  it("criterion 2 (extra): an extra overlapping a rule adds its own aligned starts, without duplicates", () => {
    const slots = slotsOf(
      aSlotQuery({
        rules: [rule(1, "09:00", "12:00")],
        extra: [range("2027-03-08T08:15:00Z", "2027-03-08T09:45:00Z"), range("2027-03-08T08:00:00Z", "2027-03-08T09:00:00Z")],
        range: range("2027-03-08T00:00:00Z", "2027-03-09T00:00:00Z"),
      }),
    );

    expect(starts(slots)).toStrictEqual([
      "2027-03-08T08:00:00Z",
      "2027-03-08T08:15:00Z",
      "2027-03-08T08:30:00Z",
      "2027-03-08T08:45:00Z",
      "2027-03-08T09:00:00Z",
      "2027-03-08T09:15:00Z",
      "2027-03-08T09:30:00Z",
      "2027-03-08T10:00:00Z",
      "2027-03-08T10:30:00Z",
    ]);
  });

  it("criterion 2 (extra): an extra starting before the requested range keeps its alignment from its own start", () => {
    const slots = slotsOf(
      aSlotQuery({
        eventType: aSlotEventType({ durationMin: 45 }),
        extra: [range("2027-03-06T09:00:00Z", "2027-03-06T12:00:00Z")],
        range: range("2027-03-06T10:00:00Z", "2027-03-07T00:00:00Z"),
      }),
    );

    expect(starts(slots)).toStrictEqual(["2027-03-06T10:30:00Z", "2027-03-06T11:15:00Z"]);
  });

  it("criterion 2 (busy): a busy exception removes every slot whose [start, end + buffer) overlaps it", () => {
    const slots = slotsOf(
      aSlotQuery({
        eventType: E0,
        rules: PA.rules,
        busy: PA.busy,
        range: range("2027-03-05T07:00:00Z", "2027-03-05T17:00:00Z"),
      }),
    );

    expect(starts(slots)).toStrictEqual([
      "2027-03-05T09:00:00Z",
      "2027-03-05T09:30:00Z",
      "2027-03-05T10:00:00Z",
      "2027-03-05T10:30:00Z",
      "2027-03-05T13:00:00Z",
      "2027-03-05T15:00:00Z",
      "2027-03-05T15:30:00Z",
      "2027-03-05T16:00:00Z",
      "2027-03-05T16:30:00Z",
    ]);
  });

  it("criterion 2 (adjacent ranges): contiguous rules are not merged, each slot fits in one of them", () => {
    const slots = slotsOf(
      aSlotQuery({
        eventType: aSlotEventType({ durationMin: 45 }),
        rules: [rule(1, "09:00", "10:00"), rule(1, "10:00", "11:30")],
        range: range("2027-03-08T00:00:00Z", "2027-03-09T00:00:00Z"),
      }),
    );

    expect(starts(slots)).toStrictEqual(["2027-03-08T08:00:00Z", "2027-03-08T09:00:00Z", "2027-03-08T09:45:00Z"]);
  });

  it("0036 note: a rule ending at 24:00 offers its last slot ending at local midnight", () => {
    const slots = slotsOf(
      aSlotQuery({
        eventType: E4,
        rules: [rule(6, "22:00", END_OF_DAY)],
        range: range("2027-03-06T00:00:00Z", "2027-03-08T00:00:00Z"),
      }),
    );

    expect(slots.map((slot) => [slot.start.toString(), slot.end.toString()])).toStrictEqual([
      ["2027-03-06T21:00:00Z", "2027-03-06T22:00:00Z"],
      ["2027-03-06T22:00:00Z", "2027-03-06T23:00:00Z"],
    ]);
  });

  it("no rule and no extra: no slot", () => {
    expect(slotsOf(aSlotQuery())).toStrictEqual([]);
  });
});

describe("computeSlots — requested range, minimal notice and horizon", () => {
  const weekdays = rulesOn([1, 2, 3, 4, 5], ["09:00", "12:00"]);

  it("decision 1: only the starts in [from, to) — a slot starting before `from` is not returned, `to` is excluded", () => {
    const slots = slotsOf(aSlotQuery({ rules: weekdays, range: range("2027-03-03T08:15:00Z", "2027-03-03T09:30:00Z") }));

    expect(starts(slots)).toStrictEqual(["2027-03-03T08:30:00Z", "2027-03-03T09:00:00Z"]);
  });

  it("decision 2: minimal notice, start >= now + min_notice (inclusive bound)", () => {
    const slots = slotsOf(
      aSlotQuery({
        eventType: aSlotEventType({ minNoticeMin: 120 }),
        rules: weekdays,
        now: instant("2027-03-03T06:30:00Z"),
        range: range("2027-03-03T00:00:00Z", "2027-03-03T10:00:00Z"),
      }),
    );

    expect(starts(slots)[0]).toBe("2027-03-03T08:30:00Z");
  });

  it("decision 2: horizon, start <= now + 1440 h (inclusive bound, nothing on the end)", () => {
    expect(BOOKING_HORIZON_HOURS).toBe(1440);
    const slots = slotsOf(
      aSlotQuery({
        rules: weekdays,
        now: instant("2027-03-01T08:30:00Z"),
        range: range("2027-04-30T00:00:00Z", "2027-05-01T00:00:00Z"),
      }),
    );

    expect(starts(slots)).toStrictEqual(["2027-04-30T07:00:00Z", "2027-04-30T07:30:00Z", "2027-04-30T08:00:00Z", "2027-04-30T08:30:00Z"]);
  });

  it("decision 1: a range of exactly 62 days is accepted", () => {
    expect(MAX_SLOT_QUERY_HOURS).toBe(1488);
    const from = instant(T_MAR);

    expect(computeSlots(aSlotQuery({ rules: weekdays, range: { start: from, end: from.add({ hours: 1488 }) } })).ok).toBe(true);
  });

  it.each([
    ["longer than 62 days", "2027-03-01T12:00:00Z", "2027-05-02T12:01:00Z"],
    ["empty", "2027-03-01T12:00:00Z", "2027-03-01T12:00:00Z"],
    ["reversed", "2027-03-02T12:00:00Z", "2027-03-01T12:00:00Z"],
  ])("decision 1: a requested range %s is refused", (_label, from, to) => {
    expect(computeSlots(aSlotQuery({ rules: weekdays, range: { start: instant(from), end: instant(to) } }))).toStrictEqual({
      ok: false,
      error: "invalid_range",
    });
  });
});

describe("computeSlots — criterion 3: pure and deterministic", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never reads the real clock", () => {
    const fail = () => {
      throw new Error("real clock read");
    };
    vi.spyOn(Date, "now").mockImplementation(fail);
    vi.spyOn(Temporal.Now, "instant").mockImplementation(fail);
    vi.spyOn(Temporal.Now, "zonedDateTimeISO").mockImplementation(fail);
    vi.spyOn(Temporal.Now, "plainDateISO").mockImplementation(fail);
    vi.spyOn(Temporal.Now, "plainDateTimeISO").mockImplementation(fail);

    expect(computeSlots(aSlotQuery({ eventType: E0, rules: PA.rules, extra: PA.extra, busy: PA.busy })).ok).toBe(true);
  });

  it("run twice on the same input: same result, input untouched", () => {
    const query = aSlotQuery({ eventType: E0, rules: PA.rules, extra: PA.extra, busy: PA.busy });
    const snapshot = JSON.stringify(query);

    const first = starts(slotsOf(query));
    const second = starts(slotsOf(query));

    expect(second).toStrictEqual(first);
    expect(first.length).toBeGreaterThan(0);
    expect(JSON.stringify(query)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Properties — computeSlots against a literal transcription of carnet.assert_bookable_slot
// ---------------------------------------------------------------------------
/** `(date + time) at time zone tz` of PostgreSQL: offset before the jump in a gap, after it in an overlap. */
function pgAtTimeZone(date: Temporal.PlainDate, time: string, tz: string): Temporal.Instant {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const local = hour === 24 ? date.add({ days: 1 }).toPlainDateTime() : date.toPlainDateTime({ hour, minute });
  return local.toZonedDateTime(tz, { disambiguation: "later" }).toInstant();
}

function sqlAssertBookable(query: SlotQuery, start: Temporal.Instant): boolean {
  const { durationMin, bufferMin, minNoticeMin } = query.eventType;
  const end = start.add({ minutes: durationMin });
  const occupiedEnd = end.add({ minutes: bufferMin });
  const le = (a: Temporal.Instant, b: Temporal.Instant) => Temporal.Instant.compare(a, b) <= 0;
  const lt = (a: Temporal.Instant, b: Temporal.Instant) => Temporal.Instant.compare(a, b) < 0;

  if (lt(start, query.now.add({ minutes: minNoticeMin })) || lt(query.now.add({ hours: 1440 }), start)) {
    return false;
  }

  const local = start.toZonedDateTimeISO(query.timeZone);
  const day = local.toPlainDate();
  const windows = [
    ...query.rules
      .filter((r) => r.weekday === local.dayOfWeek)
      .map((r) => ({ start: pgAtTimeZone(day, r.start, query.timeZone), end: pgAtTimeZone(day, r.end, query.timeZone) })),
    ...query.extra.filter((x) => le(x.start, start) && le(end, x.end)),
  ];
  const step = durationMin * 60_000;
  const inWindow = windows.some(
    (w) => le(w.start, start) && le(end, w.end) && (start.epochMilliseconds - w.start.epochMilliseconds) % step === 0,
  );
  if (!inWindow) {
    return false;
  }

  return !query.busy.some((b) => lt(b.start, occupiedEnd) && lt(start, b.end));
}

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QUARTER = 15;
const ZONES = ["Europe/Paris", "Asia/Tokyo", "Asia/Kolkata", "America/New_York", "Australia/Lord_Howe", "Asia/Kathmandu"];
/** Midnights UTC a few days before a DST transition of the zones above. */
const PIVOTS = [
  "2027-03-26T00:00:00Z",
  "2027-10-29T00:00:00Z",
  "2027-03-12T00:00:00Z",
  "2027-11-05T00:00:00Z",
  "2027-04-02T00:00:00Z",
  "2026-10-02T00:00:00Z",
];

function quarterText(q: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(q / 4))}:${pad((q % 4) * QUARTER)}`;
}

function randomQuery(random: () => number): SlotQuery {
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(values: readonly T[]): T => values[int(0, values.length - 1)] as T;

  const rules = ([1, 2, 3, 4, 5, 6, 7] as const).flatMap((weekday) => {
    if (random() < 0.35) return [];
    const a = int(0, 90);
    const b = int(a + 1, 96);
    const first = { weekday, start: quarterText(a), end: quarterText(b) };
    if (b >= 95 || random() < 0.5) return [first];
    const c = int(b, 95);
    const d = int(c + 1, 96);
    return [first, { weekday, start: quarterText(c), end: quarterText(d) }];
  });

  const now = instant(pick(PIVOTS)).add({ minutes: QUARTER * int(0, 4 * 24 * 3) });
  const from = random() < 0.2 ? now.add({ hours: 1440 - 24 }) : now.subtract({ hours: 24 }).add({ minutes: QUARTER * int(0, 4 * 48) });
  const to = from.add({ hours: 72 });
  const around = (maxQuarters: number) => {
    const start = from.subtract({ hours: 8 }).add({ minutes: QUARTER * int(0, 4 * 80) });
    return { start, end: start.add({ minutes: QUARTER * int(1, maxQuarters) }) };
  };

  return {
    timeZone: zone(pick(ZONES)),
    eventType: aSlotEventType({
      durationMin: pick([15, 30, 45, 60, 90]),
      bufferMin: pick([0, 15, 30]),
      minNoticeMin: pick([0, 60, 120, 1440]),
    }),
    rules,
    extra: Array.from({ length: int(0, 2) }, () => around(32)),
    busy: Array.from({ length: int(0, 4) }, () => around(16)),
    now,
    range: { start: from, end: to },
  };
}

describe("computeSlots — properties (decision 4: same rule as carnet.assert_bookable_slot)", () => {
  it.each(Array.from({ length: 120 }, (_, i) => [i + 1]))("random query #%i: offered starts = starts accepted by the SQL rule", (seed) => {
    const query = randomQuery(prng(seed));
    const expected: string[] = [];
    for (let at = query.range.start; Temporal.Instant.compare(at, query.range.end) < 0; at = at.add({ minutes: QUARTER })) {
      if (sqlAssertBookable(query, at)) expected.push(at.toString());
    }

    const slots = slotsOf(query);

    expect(starts(slots)).toStrictEqual(expected);
    for (const slot of slots) {
      expect(slot.end.epochMilliseconds - slot.start.epochMilliseconds).toBe(query.eventType.durationMin * 60_000);
    }
  });
});

// ---------------------------------------------------------------------------
// 0037 point 7 — one set of types, bounded cost
// ---------------------------------------------------------------------------
describe("computeSlots — point 7: one set of types (availability.ts)", () => {
  it("SlotQuery.rules is a list of AvailabilityRule (Weekday) of availability.ts", () => {
    expectTypeOf<SlotQuery["rules"]>().toEqualTypeOf<readonly AvailabilityRule[]>();
    expectTypeOf<SlotQuery["rules"][number]["weekday"]>().toEqualTypeOf<Weekday>();
  });

  it("slots.ts no longer exports IsoWeekday nor SlotRule", () => {
    // @ts-expect-error point 7 — IsoWeekday is replaced by Weekday of availability.ts
    expectTypeOf<Slots.IsoWeekday>().not.toBeAny();
    // @ts-expect-error point 7 — SlotRule is replaced by AvailabilityRule of availability.ts
    expectTypeOf<Slots.SlotRule>().not.toBeAny();
  });

  it("END_OF_DAY of the domain ends a rule at local midnight", () => {
    const slots = slotsOf(
      aSlotQuery({ eventType: E4, rules: [rule(6, "23:00", END_OF_DAY)], range: range("2027-03-06T00:00:00Z", "2027-03-08T00:00:00Z") }),
    );

    expect(slots.map((slot) => [slot.start.toString(), slot.end.toString()])).toStrictEqual([
      ["2027-03-06T22:00:00Z", "2027-03-06T23:00:00Z"],
    ]);
  });
});

describe("computeSlots — point 7: bounded cost (audit MEDIUM)", () => {
  /** Generous for CI: the deduplicated work is about 18 000 aligned starts. */
  const BUDGET_MS = 1_000;
  const FROM = "2027-03-01T00:00:00Z";
  /** FROM + 62 days. */
  const TO = "2027-05-02T00:00:00Z";
  /** now + 1440 h, inclusive bound of the horizon. */
  const HORIZON = "2027-04-30T00:00:00Z";
  const FIVE_MINUTES = aSlotEventType({ durationMin: 5 });

  function timed(query: SlotQuery): { result: ReturnType<typeof computeSlots>; elapsedMs: number } {
    const started = performance.now();
    const result = computeSlots(query);
    return { result, elapsedMs: performance.now() - started };
  }

  function extremeQuery(extra: readonly TimeRange[], overrides: Partial<SlotQuery> = {}): SlotQuery {
    return aSlotQuery({ eventType: FIVE_MINUTES, extra, now: instant(FROM), range: range(FROM, TO), ...overrides });
  }

  it("the candidate cap is a constant of the domain", () => {
    expect(MAX_SLOT_CANDIDATES).toBe(20_000);
  });

  it(
    "extreme case: 200 overlapping extras of 62 days shifted by 5 minutes, 5-minute type → under budget, every 5 minutes up to the horizon",
    () => {
      const { result, elapsedMs } = timed(extremeQuery(overlappingExtras(FROM, 200, MAX_SLOT_QUERY_HOURS, 5)));

      expect(result.ok).toBe(true);
      expect(result.ok ? starts(result.value) : []).toStrictEqual(everyMinutes(FROM, HORIZON, 5));
      expect(elapsedMs).toBeLessThan(BUDGET_MS);
    },
    30_000,
  );

  it(
    "deduplicated starts: 200 identical extras of 62 days → under budget, the same slots as a single one, no duplicate",
    () => {
      const single = slotsOf(extremeQuery(overlappingExtras(FROM, 1, MAX_SLOT_QUERY_HOURS, 0)));
      const { result, elapsedMs } = timed(extremeQuery(overlappingExtras(FROM, 200, MAX_SLOT_QUERY_HOURS, 0)));

      expect(result.ok).toBe(true);
      expect(result.ok ? starts(result.value) : []).toStrictEqual(starts(single));
      expect(starts(single)).toStrictEqual(everyMinutes(FROM, HORIZON, 5));
      expect(elapsedMs).toBeLessThan(BUDGET_MS);
    },
    30_000,
  );

  it(
    "legitimate maximum: 24 h rules every day (Paris, spring forward included), 5-minute type, 62 days → not capped, under budget",
    () => {
      const allDay = rulesOn([1, 2, 3, 4, 5, 6, 7], ["00:00", END_OF_DAY]);
      const { result, elapsedMs } = timed(extremeQuery([], { rules: allDay }));

      expect(result.ok).toBe(true);
      expect(result.ok ? starts(result.value) : []).toStrictEqual(everyMinutes(FROM, HORIZON, 5));
      expect(elapsedMs).toBeLessThan(BUDGET_MS);
    },
    30_000,
  );

  it(
    "beyond the cap: 200 overlapping extras shifted by 1 minute (5 alignments, ~89 000 candidates) → err('too_many_slots') under budget",
    () => {
      const { result, elapsedMs } = timed(extremeQuery(overlappingExtras(FROM, 200, MAX_SLOT_QUERY_HOURS, 1)));

      expect(result).toStrictEqual({ ok: false, error: "too_many_slots" });
      expect(elapsedMs).toBeLessThan(BUDGET_MS);
    },
    30_000,
  );

  it(
    "the cap counts candidates before the filters: the same extras entirely busy → still err('too_many_slots')",
    () => {
      const { result, elapsedMs } = timed(
        extremeQuery(overlappingExtras(FROM, 200, MAX_SLOT_QUERY_HOURS, 1), { busy: [range(FROM, "2027-06-01T00:00:00Z")] }),
      );

      expect(result).toStrictEqual({ ok: false, error: "too_many_slots" });
      expect(elapsedMs).toBeLessThan(BUDGET_MS);
    },
    30_000,
  );

  describe("exact bound (two extras on two alignments, one minute apart)", () => {
    const half = MAX_SLOT_CANDIDATES / 2;
    const first = (count: number) => ({ start: instant(FROM), end: instant(FROM).add({ minutes: 5 * count }) });
    const second = (count: number) => {
      const start = instant(FROM).add({ minutes: 1 });
      return { start, end: start.add({ minutes: 5 * count }) };
    };

    it("exactly MAX_SLOT_CANDIDATES candidates → accepted, every one returned", () => {
      const result = computeSlots(extremeQuery([first(half), second(half)]));

      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.length : 0).toBe(MAX_SLOT_CANDIDATES);
    });

    it("MAX_SLOT_CANDIDATES + 1 candidates → err('too_many_slots'), never a truncated list", () => {
      expect(computeSlots(extremeQuery([first(half), second(half + 1)]))).toStrictEqual({
        ok: false,
        error: "too_many_slots",
      });
    });
  });
});
