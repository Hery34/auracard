/**
 * Contract frozen by test-engineer (0039 point 8, « Semaine DST » ramené de 0040; criterion 4). The slot list follows
 * the browser's exact local week: listSlotsAction receives `from` and `to`, two local midnights seven days apart
 * (167, 168 or 169 h), and the use case reads [from, to).
 *
 * // src/ui/features/booking/slot-week.ts (frontend)
 * export const LAST_WEEK: number;   // 8: the last week still starts inside the 60-day horizon
 * export type WeekRange = { from: string; to: string };   // Date.toISOString() of two local midnights
 * // Week `week` after the local day of `now`: from = local midnight of that day + 7 × week days, to = 7 days later.
 * export function weekRange(now: Date, week: number): WeekRange;
 * // The slots starting before `to` (the server already reads [from, to); defensive filter kept).
 * export function slotsOfWeek<T extends { start: string }>(slots: readonly T[], range: WeekRange): T[];
 * // use-week-slots.ts: listSlotsAction({ slug, eventTypeId, from: range.from, to: range.to }).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SLOT_READ_WINDOW_HOURS } from "@/domain/booking/booking";
import { LAST_WEEK, slotsOfWeek, weekRange } from "@/ui/features/booking/slot-week";

const HOUR_MS = 3_600_000;

function hours(range: { from: string; to: string }): number {
  return (Date.parse(range.to) - Date.parse(range.from)) / HOUR_MS;
}

beforeAll(() => {
  vi.stubEnv("TZ", "Europe/Paris");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("weekRange (point 8: the browser's local week, DST included)", () => {
  it("criterion 4: the week of Sunday 31 October 2027 in Paris runs from local midnight to local midnight (169 h)", () => {
    const range = weekRange(new Date("2027-10-31T08:00:00Z"), 0);

    expect(range).toStrictEqual({ from: "2027-10-30T22:00:00.000Z", to: "2027-11-06T23:00:00.000Z" });
    expect(hours(range)).toBe(169);
    expect(hours(range)).toBeLessThanOrEqual(SLOT_READ_WINDOW_HOURS);
  });

  it("criterion 4: the 23:00–24:00 slots of its seventh day (Saturday 6 November, CET) are requested and kept", () => {
    const range = weekRange(new Date("2027-10-31T08:00:00Z"), 0);
    const slots = [
      { start: "2027-11-06T22:00:00Z", end: "2027-11-06T22:30:00Z" },
      { start: "2027-11-06T22:30:00Z", end: "2027-11-06T23:00:00Z" },
      { start: "2027-11-06T23:00:00Z", end: "2027-11-06T23:30:00Z" },
    ];

    expect(Date.parse(range.to)).toBeGreaterThanOrEqual(Date.parse("2027-11-06T23:00:00Z"));
    expect(slotsOfWeek(slots, range).map((slot) => slot.start)).toStrictEqual(["2027-11-06T22:00:00Z", "2027-11-06T22:30:00Z"]);
  });

  it("the same local day late in the evening (23:30 CET) gives the same week", () => {
    expect(weekRange(new Date("2027-10-31T22:30:00Z"), 0)).toStrictEqual(weekRange(new Date("2027-10-31T08:00:00Z"), 0));
  });

  it("the next week starts where the previous one ends (168 h, no DST change)", () => {
    expect(weekRange(new Date("2027-10-31T08:00:00Z"), 1)).toStrictEqual({
      from: "2027-11-06T23:00:00.000Z",
      to: "2027-11-13T23:00:00.000Z",
    });
  });

  it("criterion 4: the week of Sunday 28 March 2027 in Paris lasts 167 h", () => {
    const range = weekRange(new Date("2027-03-28T10:00:00Z"), 0);

    expect(range).toStrictEqual({ from: "2027-03-27T23:00:00.000Z", to: "2027-04-03T22:00:00.000Z" });
    expect(hours(range)).toBe(167);
  });

  it("every week up to LAST_WEEK (8) stays within SLOT_READ_WINDOW_HOURS and follows the previous one", () => {
    const now = new Date("2027-10-01T10:00:00Z");

    expect(LAST_WEEK).toBe(8);
    for (let week = 0; week <= LAST_WEEK; week += 1) {
      const range = weekRange(now, week);
      expect(hours(range)).toBeLessThanOrEqual(SLOT_READ_WINDOW_HOURS);
      expect(hours(range)).toBeGreaterThanOrEqual(167);
      if (week > 0) {
        expect(range.from).toBe(weekRange(now, week - 1).to);
      }
    }
  });
});
