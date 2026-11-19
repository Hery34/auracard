import type { AvailabilityRule } from "@/domain/booking/availability";
import { err, ok, type Result } from "@/domain/shared/result";

import { timeRange, type TimeRange } from "./time-range";
import { type TimeZone, wallClockToInstant } from "./time-zone";

export type SlotEventType = { readonly durationMin: number; readonly bufferMin: number; readonly minNoticeMin: number };

export type SlotQuery = {
  readonly timeZone: TimeZone;
  readonly eventType: SlotEventType;
  readonly rules: readonly AvailabilityRule[];
  readonly extra: readonly TimeRange[];
  /** Confirmed bookings [start, end + their buffer) and busy exceptions. */
  readonly busy: readonly TimeRange[];
  readonly now: Temporal.Instant;
  /** Requested [from, to), at most MAX_SLOT_QUERY_HOURS. */
  readonly range: TimeRange;
};

export type Slot = TimeRange;

export const MAX_SLOT_QUERY_HOURS = 1488;
export const BOOKING_HORIZON_HOURS = 1440;
/** Distinct aligned starts counted before the filters; a legitimate profile stays below (17 856 at most). */
export const MAX_SLOT_CANDIDATES = 20_000;

/** Epoch nanoseconds. A rule window only offers the starts whose local date is the day it was read on. */
type Window = { readonly start: bigint; readonly end: bigint; readonly day?: Temporal.PlainDate };

type Bounds = { readonly from: bigint; readonly to: bigint; readonly step: bigint };

const NS_PER_MINUTE = BigInt(60_000_000_000);
const NS_PER_HOUR = BigInt(60) * NS_PER_MINUTE;

/**
 * Display-side mirror of carnet.assert_bookable_slot (the authority): starts in the requested range, aligned on the
 * duration in real time from the start of a single window, within notice and horizon, and whose
 * [start, end + buffer) overlaps no busy range. More than MAX_SLOT_CANDIDATES candidates → `too_many_slots`.
 */
export function computeSlots(query: SlotQuery): Result<readonly Slot[], "invalid_range" | "too_many_slots"> {
  if (!isValidRange(query.range)) {
    return err("invalid_range");
  }
  const bounds: Bounds = {
    from: query.range.start.epochNanoseconds,
    to: query.range.end.epochNanoseconds,
    step: BigInt(query.eventType.durationMin) * NS_PER_MINUTE,
  };
  const candidates = collectCandidates([...ruleWindows(query), ...extraWindows(query.extra, bounds)], bounds, query.timeZone);
  if (candidates === null) {
    return err("too_many_slots");
  }
  const starts = [...candidates].filter(([, onItsDay]) => onItsDay).map(([start]) => start);
  return ok(freeStarts(starts.sort(compareBigInt), query, bounds.step).map((start) => toSlot(start, bounds.step)));
}

function isValidRange({ start, end }: TimeRange): boolean {
  return timeRange(start, end) !== null && Temporal.Instant.compare(end, start.add({ hours: MAX_SLOT_QUERY_HOURS })) <= 0;
}

function ruleWindows({ rules, timeZone, range }: SlotQuery): Window[] {
  const windows: Window[] = [];
  const last = localDate(range.end, timeZone);
  for (let day = localDate(range.start, timeZone); Temporal.PlainDate.compare(day, last) <= 0; day = day.add({ days: 1 })) {
    for (const rule of rules.filter((r) => r.weekday === day.dayOfWeek)) {
      const start = wallClockToInstant(day, rule.start, timeZone).epochNanoseconds;
      const end = wallClockToInstant(day, rule.end, timeZone).epochNanoseconds;
      if (start < end) {
        windows.push({ start, end, day });
      }
    }
  }
  return windows;
}

/**
 * Extras clipped to the requested range (first aligned start at or after `from`, no start at or after `to`), then
 * merged per alignment class: two overlapping windows sharing their alignment offer exactly the starts of their union.
 */
function extraWindows(extra: readonly TimeRange[], { from, to, step }: Bounds): Window[] {
  const byClass = new Map<bigint, Window[]>();
  for (const range of extra) {
    const origin = range.start.epochNanoseconds;
    const start = origin < from ? origin + ceilDiv(from - origin, step) * step : origin;
    const end = minBigInt(range.end.epochNanoseconds, to + step);
    if (end - start >= step) {
      const offset = ((start % step) + step) % step;
      byClass.set(offset, [...(byClass.get(offset) ?? []), { start, end }]);
    }
  }
  return [...byClass.values()].flatMap(mergeOverlapping);
}

function mergeOverlapping(windows: readonly Window[]): Window[] {
  const merged: Window[] = [];
  for (const window of windows.toSorted((a, b) => compareBigInt(a.start, b.start))) {
    const previous = merged.at(-1);
    if (previous !== undefined && window.start <= previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: maxBigInt(previous.end, window.end) };
    } else {
      merged.push(window);
    }
  }
  return merged;
}

/** Distinct starts → whether one of their windows is on the start's local day; null beyond MAX_SLOT_CANDIDATES. */
function collectCandidates(
  windows: readonly Window[],
  { from, to, step }: Bounds,
  timeZone: TimeZone,
): Map<bigint, boolean> | null {
  const candidates = new Map<bigint, boolean>();
  for (const window of windows) {
    let start = window.start < from ? window.start + ceilDiv(from - window.start, step) * step : window.start;
    for (; start < to && start + step <= window.end; start += step) {
      if (candidates.get(start) === true) {
        continue;
      }
      candidates.set(start, window.day === undefined || localDate(toInstant(start), timeZone).equals(window.day));
      if (candidates.size > MAX_SLOT_CANDIDATES) {
        return null;
      }
    }
  }
  return candidates;
}

/**
 * Sorted starts within notice and horizon whose [start, start + duration + buffer) overlaps no busy range. Busy ranges
 * are sorted once and walked with the starts (O(N + B) after the sorts): the furthest end among the ranges starting
 * before the occupied end decides, which covers nested and overlapping ranges.
 */
function freeStarts(sortedStarts: readonly bigint[], { eventType, busy, now }: SlotQuery, step: bigint): bigint[] {
  const nowNs = now.epochNanoseconds;
  const earliest = nowNs + BigInt(eventType.minNoticeMin) * NS_PER_MINUTE;
  const latest = nowNs + BigInt(BOOKING_HORIZON_HOURS) * NS_PER_HOUR;
  const occupiedLength = step + BigInt(eventType.bufferMin) * NS_PER_MINUTE;
  const ranges = busy
    .map((range) => ({ start: range.start.epochNanoseconds, end: range.end.epochNanoseconds }))
    .sort((a, b) => compareBigInt(a.start, b.start));
  const free: bigint[] = [];
  let next = 0;
  let furthestEnd: bigint | null = null;
  for (const start of sortedStarts) {
    if (start < earliest || start > latest) {
      continue;
    }
    const occupiedEnd = start + occupiedLength;
    for (let range = ranges[next]; range !== undefined && range.start < occupiedEnd; range = ranges[++next]) {
      furthestEnd = furthestEnd === null ? range.end : maxBigInt(furthestEnd, range.end);
    }
    if (furthestEnd === null || furthestEnd <= start) {
      free.push(start);
    }
  }
  return free;
}

function toSlot(start: bigint, step: bigint): Slot {
  return { start: toInstant(start), end: toInstant(start + step) };
}

function toInstant(epochNanoseconds: bigint): Temporal.Instant {
  return Temporal.Instant.fromEpochNanoseconds(epochNanoseconds);
}

function localDate(instant: Temporal.Instant, timeZone: TimeZone): Temporal.PlainDate {
  return instant.toZonedDateTimeISO(timeZone).toPlainDate();
}

function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - BigInt(1)) / b;
}
