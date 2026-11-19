/**
 * Contract frozen by test-engineer (0037). Half-open range of instants, as tstzrange '[)' in carnet.
 *
 * // src/domain/booking/time-range.ts
 * export type TimeRange = { readonly start: Temporal.Instant; readonly end: Temporal.Instant };
 * // null when end <= start (empty range, refused by the carnet constraints).
 * export function timeRange(start: Temporal.Instant, end: Temporal.Instant): TimeRange | null;
 * // PostgreSQL `&&` on '[)' ranges: a.start < b.end and b.start < a.end (contiguity is not an overlap).
 * export function overlaps(a: TimeRange, b: TimeRange): boolean;
 * // PostgreSQL `@>` on '[)' ranges: outer.start <= inner.start and inner.end <= outer.end.
 * export function contains(outer: TimeRange, inner: TimeRange): boolean;
 */
import { describe, expect, it } from "vitest";

import { contains, overlaps, timeRange } from "@/domain/booking/time-range";

import { instant, range } from "../../../tests/builders/booking-slots";

describe("timeRange", () => {
  it("builds [start, end)", () => {
    const built = timeRange(instant("2027-03-05T08:15:00Z"), instant("2027-03-05T08:45:00Z"));

    expect(built?.start.toString()).toBe("2027-03-05T08:15:00Z");
    expect(built?.end.toString()).toBe("2027-03-05T08:45:00Z");
  });

  it.each([
    ["empty", "2027-03-05T08:15:00Z", "2027-03-05T08:15:00Z"],
    ["reversed", "2027-03-05T08:45:00Z", "2027-03-05T08:15:00Z"],
  ])("refuses an %s range", (_label, start, end) => {
    expect(timeRange(instant(start), instant(end))).toBeNull();
  });
});

describe("overlaps (PostgreSQL && on '[)')", () => {
  const busy = range("2027-03-05T08:15:00Z", "2027-03-05T08:45:00Z");

  it.each([
    ["straddles the start", "2027-03-05T08:00:00Z", "2027-03-05T08:30:00Z", true],
    ["straddles the end", "2027-03-05T08:30:00Z", "2027-03-05T09:00:00Z", true],
    ["inside", "2027-03-05T08:20:00Z", "2027-03-05T08:40:00Z", true],
    ["covers", "2027-03-05T08:00:00Z", "2027-03-05T09:00:00Z", true],
    ["contiguous before (ends at its start)", "2027-03-05T07:45:00Z", "2027-03-05T08:15:00Z", false],
    ["contiguous after (starts at its end)", "2027-03-05T08:45:00Z", "2027-03-05T09:15:00Z", false],
    ["disjoint", "2027-03-05T10:00:00Z", "2027-03-05T10:30:00Z", false],
  ])("%s → %s", (_label, start, end, expected) => {
    expect(overlaps(range(start, end), busy)).toBe(expected);
    expect(overlaps(busy, range(start, end))).toBe(expected);
  });
});

describe("contains (PostgreSQL @> on '[)')", () => {
  const extra = range("2027-03-06T09:00:00Z", "2027-03-06T10:30:00Z");

  it.each([
    ["same bounds", "2027-03-06T09:00:00Z", "2027-03-06T10:30:00Z", true],
    ["inside, ending at its end", "2027-03-06T10:00:00Z", "2027-03-06T10:30:00Z", true],
    ["exceeds the end", "2027-03-06T10:00:00Z", "2027-03-06T11:00:00Z", false],
    ["starts before", "2027-03-06T08:30:00Z", "2027-03-06T09:30:00Z", false],
  ])("%s → %s", (_label, start, end, expected) => {
    expect(contains(extra, range(start, end))).toBe(expected);
  });
});
