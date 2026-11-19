import type { WeekSlots } from "@/ui/features/booking/use-week-slots";
import { LOADING_SLOTS, NO_SLOT_THIS_WEEK } from "@/ui/features/booking/public-messages";
import { dayLabel, type SlotDay } from "@/ui/features/booking/slot-days";
import type { RadioCardOption } from "@/ui/primitives/radio-card-group";

/** A day is named after its first slot, in the browser's zone (« lundi 23 novembre »). */
export function dayOptions(days: readonly SlotDay[], timeZone: string): RadioCardOption[] {
  return days.flatMap((day) => (day.slots[0] === undefined ? [] : [{ value: day.date, label: dayLabel(day.slots[0].start, timeZone) }]));
}

export function slotOptions(day: SlotDay): RadioCardOption[] {
  return day.slots.map((choice) => ({ value: choice.start, label: choice.time }));
}

/** Text of the list's `role="status"`: loading, or an empty week; null otherwise. */
export function slotListStatus(weekSlots: WeekSlots, dayCount: number): string | null {
  if (weekSlots.loading) {
    return LOADING_SLOTS;
  }
  return weekSlots.eventTypeId !== null && weekSlots.error === null && dayCount === 0 ? NO_SLOT_THIS_WEEK : null;
}
