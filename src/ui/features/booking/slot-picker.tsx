import { LIST_SLOTS_ERROR_MESSAGES } from "@/ui/features/booking/public-messages";
import type { SlotChoice, SlotDay } from "@/ui/features/booking/slot-days";
import { dayOptions, slotListStatus, slotOptions } from "@/ui/features/booking/slot-options";
import type { WeekSlots } from "@/ui/features/booking/use-week-slots";
import { RadioCardGroup } from "@/ui/primitives/radio-card-group";

type Props = {
  weekSlots: WeekSlots;
  days: readonly SlotDay[];
  day: SlotDay | null;
  slot: SlotChoice | null;
  timeZone: string;
  onDay: (date: string) => void;
  onSlot: (start: string) => void;
};

/** Days of the shown week that have a slot, then the slots of the chosen day, in the browser's zone. */
export function SlotPicker({ weekSlots, days, day, slot, timeZone, onDay, onSlot }: Props) {
  const status = slotListStatus(weekSlots, days.length);
  return (
    <div className="flex flex-col gap-6">
      {weekSlots.error !== null && (
        <p role="alert" className="rounded-md border border-destructive bg-destructive/10 p-3 text-foreground">
          {LIST_SLOTS_ERROR_MESSAGES[weekSlots.error]}
        </p>
      )}
      <p role="status" className={status === null ? "sr-only" : "text-sm text-muted-foreground"}>
        {status ?? ""}
      </p>
      {days.length > 0 && (
        <RadioCardGroup
          legend="Jour"
          name="booking-day"
          options={dayOptions(days, timeZone)}
          value={day?.date ?? null}
          onChange={onDay}
          className="sm:grid-cols-2"
        />
      )}
      {day !== null && (
        <RadioCardGroup
          legend="Créneau"
          name="booking-slot"
          options={slotOptions(day)}
          value={slot?.start ?? null}
          onChange={onSlot}
          className="grid-cols-2 sm:grid-cols-3"
        />
      )}
    </div>
  );
}
