import { BOOKING_HORIZON_HOURS } from "@/domain/booking/slots";

const DAYS_PER_WEEK = 7;
const HOURS_PER_WEEK = DAYS_PER_WEEK * 24;

/** Week 0 starts today; the last one still starts inside the booking horizon. */
export const LAST_WEEK = Math.floor(BOOKING_HORIZON_HOURS / HOURS_PER_WEEK);

/** The browser's local midnight `week` weeks after the local day of `now` (DST handled by `Date`). */
function weekStart(now: Date, week: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + week * DAYS_PER_WEEK);
}

export type WeekRange = { from: string; to: string };

/** Two local midnights seven days apart (167, 168 or 169 h), sent to listSlotsAction. */
export function weekRange(now: Date, week: number): WeekRange {
  return { from: weekStart(now, week).toISOString(), to: weekStart(now, week + 1).toISOString() };
}

export function slotsOfWeek<T extends { start: string }>(slots: readonly T[], range: WeekRange): T[] {
  const to = Date.parse(range.to);
  return slots.filter((slot) => Date.parse(slot.start) < to);
}
