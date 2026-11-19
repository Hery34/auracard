/**
 * Contract frozen by test-engineer (0039, decision 2: « Créneaux affichés dans le fuseau du navigateur, fuseau du
 * propriétaire indiqué s'il diffère »; criterion 4: DST; docs/rules/testing.md: changes of time and different zones
 * between owner and visitor).
 *
 * // src/ui/features/booking/slot-days.ts (frontend) — pure, the zone is passed (the browser's, from
 * // Intl.DateTimeFormat().resolvedOptions().timeZone), never read inside.
 * export type SlotChoice = { start: string; end: string; time: string };   // time: "HH:MM" in `timeZone` (24 h)
 * export type SlotDay = { date: string; slots: SlotChoice[] };             // date: local "YYYY-MM-DD" in `timeZone`
 * // Slots of listSlotsAction (UTC texts, sorted) grouped by local day of `timeZone`, days and slots in time order.
 * // When two slots of one day show the same "HH:MM" (fall back), each `time` is completed by its UTC offset so that
 * // the two radios keep distinct names (both still start with "HH:MM").
 * export function groupSlotsByDay(slots: readonly { start: string; end: string }[], timeZone: string): SlotDay[];
 * // Decision 2: the owner's zone is mentioned only when it differs from the browser's (exact IANA identifiers).
 * export function ownerTimeZoneShown(ownerTimeZone: string, browserTimeZone: string): boolean;
 */
import { describe, expect, it } from "vitest";

import { groupSlotsByDay, ownerTimeZoneShown } from "@/ui/features/booking/slot-days";

function slot(start: string, minutes = 30): { start: string; end: string } {
  return { start, end: Temporal.Instant.from(start).add({ minutes }).toString() };
}

function shape(days: ReturnType<typeof groupSlotsByDay>): [string, string[]][] {
  return days.map((day) => [day.date, day.slots.map((choice) => choice.time)]);
}

describe("groupSlotsByDay (decision 2)", () => {
  it("same zone as the owner: local days and times of Paris", () => {
    const days = groupSlotsByDay([slot("2027-03-02T08:00:00Z"), slot("2027-03-02T08:30:00Z"), slot("2027-03-03T13:00:00Z")], "Europe/Paris");

    expect(shape(days)).toStrictEqual([
      ["2027-03-02", ["09:00", "09:30"]],
      ["2027-03-03", ["14:00"]],
    ]);
    expect(days[0]?.slots[0]).toStrictEqual({ start: "2027-03-02T08:00:00Z", end: "2027-03-02T08:30:00Z", time: "09:00" });
  });

  it("visitor in another zone: the owner's Tokyo morning is the previous evening in Los Angeles", () => {
    const days = groupSlotsByDay([slot("2027-03-01T00:00:00Z"), slot("2027-03-01T00:30:00Z"), slot("2027-03-01T08:00:00Z")], "America/Los_Angeles");

    expect(shape(days)).toStrictEqual([
      ["2027-02-28", ["16:00", "16:30"]],
      ["2027-03-01", ["00:00"]],
    ]);
  });

  it("non-integer offset (Asia/Kolkata, UTC+05:30)", () => {
    expect(shape(groupSlotsByDay([slot("2027-03-02T08:00:00Z")], "Asia/Kolkata"))).toStrictEqual([["2027-03-02", ["13:30"]]]);
  });

  it("criterion 4: Paris spring forward (28 March 2027) — 01:30 then 03:30, no 02:xx", () => {
    const days = groupSlotsByDay([slot("2027-03-28T00:30:00Z"), slot("2027-03-28T01:00:00Z"), slot("2027-03-28T01:30:00Z")], "Europe/Paris");

    expect(shape(days)).toStrictEqual([["2027-03-28", ["01:30", "03:00", "03:30"]]]);
  });

  it("criterion 4: New York changes on 14 March 2027 while Paris has not: the owner's 09:00 (08:00Z) shows 03:00 then 04:00", () => {
    const days = groupSlotsByDay([slot("2027-03-12T08:00:00Z"), slot("2027-03-15T08:00:00Z")], "America/New_York");

    expect(shape(days)).toStrictEqual([
      ["2027-03-12", ["03:00"]],
      ["2027-03-15", ["04:00"]],
    ]);
  });

  it("criterion 4: Paris fall back (31 October 2027) — the two 02:30 stay distinct, both start with 02:30", () => {
    const days = groupSlotsByDay([slot("2027-10-31T00:30:00Z"), slot("2027-10-31T01:30:00Z")], "Europe/Paris");

    expect(days).toHaveLength(1);
    const [first, second] = days[0]?.slots ?? [];
    expect(first?.time.startsWith("02:30")).toBe(true);
    expect(second?.time.startsWith("02:30")).toBe(true);
    expect(first?.time).not.toBe(second?.time);
  });

  it("an hour shown once keeps its plain HH:MM even on a change day", () => {
    const days = groupSlotsByDay([slot("2027-10-31T00:00:00Z"), slot("2027-10-31T09:00:00Z")], "Europe/Paris");

    expect(shape(days)).toStrictEqual([["2027-10-31", ["02:00", "10:00"]]]);
  });

  it("no slot → no day", () => {
    expect(groupSlotsByDay([], "Europe/Paris")).toStrictEqual([]);
  });
});

describe("ownerTimeZoneShown (decision 2)", () => {
  it("different zones → shown", () => {
    expect(ownerTimeZoneShown("Asia/Tokyo", "Europe/Paris")).toBe(true);
  });

  it("same zone → not shown", () => {
    expect(ownerTimeZoneShown("Europe/Paris", "Europe/Paris")).toBe(false);
  });
});
