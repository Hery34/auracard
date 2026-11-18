import type { AvailabilityRule, Weekday } from "@/domain/booking/availability";
import type { SlotEventType, SlotQuery } from "@/domain/booking/slots";
import type { TimeRange } from "@/domain/booking/time-range";
import { parseTimeZone, type TimeZone } from "@/domain/booking/time-zone";

/** Fiche 0037 — builders of the slot calculation (shapes of get_public_booking_page / get_public_busy_ranges). */

export function instant(iso: string): Temporal.Instant {
  return Temporal.Instant.from(iso);
}

/** Half-open [start, end), as the tstzrange '[)' bounds of get_public_busy_ranges. */
export function range(start: string, end: string): TimeRange {
  return { start: instant(start), end: instant(end) };
}

export function zone(id: string): TimeZone {
  const parsed = parseTimeZone(id);
  if (parsed === null) {
    throw new Error(`zone: ${id} is not a valid IANA time zone`);
  }
  return parsed;
}

/** Local "HH:MM" of the profile time zone; end may be END_OF_DAY ("24:00"). */
export function rule(weekday: Weekday, start: string, end: string): AvailabilityRule {
  return { weekday, start, end };
}

/** The same daily ranges on several ISO weekdays (1 = Monday … 7 = Sunday). */
export function rulesOn(weekdays: readonly Weekday[], ...ranges: readonly [string, string][]): AvailabilityRule[] {
  return weekdays.flatMap((weekday) => ranges.map(([start, end]) => rule(weekday, start, end)));
}

export function aSlotEventType(overrides: Partial<SlotEventType> = {}): SlotEventType {
  return { durationMin: 30, bufferMin: 0, minNoticeMin: 0, ...overrides };
}

/** Monday 1 March 2027 12:00Z (T_MAR of carnet_bookings_book_slot.test.sql). */
export const T_MAR = "2027-03-01T12:00:00Z";
/** Friday 1 October 2027 12:00Z (T_OCT of carnet_bookings_book_slot.test.sql). */
export const T_OCT = "2027-10-01T12:00:00Z";

export function aSlotQuery(overrides: Partial<SlotQuery> = {}): SlotQuery {
  return {
    timeZone: zone("Europe/Paris"),
    eventType: aSlotEventType(),
    rules: [],
    extra: [],
    busy: [],
    now: instant(T_MAR),
    range: range("2027-03-01T12:00:00Z", "2027-03-08T12:00:00Z"),
    ...overrides,
  };
}

/** Busy range of an existing confirmed booking, as get_public_busy_ranges returns it: [start, end + buffer). */
export function bookingBusy(start: string, durationMin: number, bufferMin: number): TimeRange {
  const from = instant(start);
  return { start: from, end: from.add({ minutes: durationMin + bufferMin }) };
}

export function starts(slots: readonly TimeRange[]): string[] {
  return slots.map((slot) => slot.start.toString());
}

/**
 * Fiche 0037, point 7 — `count` extra windows of `lengthHours` each, the i-th starting `i × shiftMin` minutes after
 * `from` (all overlapping when count × shiftMin is below the length).
 */
export function overlappingExtras(from: string, count: number, lengthHours: number, shiftMin: number): TimeRange[] {
  const origin = instant(from);
  return Array.from({ length: count }, (_, i) => {
    const start = origin.add({ minutes: i * shiftMin });
    return { start, end: start.add({ hours: lengthHours }) };
  });
}

/** Every `stepMin` minutes from `from` to `last`, both included, as `starts()` prints them. */
export function everyMinutes(from: string, last: string, stepMin: number): string[] {
  const result: string[] = [];
  for (let at = instant(from); Temporal.Instant.compare(at, instant(last)) <= 0; at = at.add({ minutes: stepMin })) {
    result.push(at.toString());
  }
  return result;
}
