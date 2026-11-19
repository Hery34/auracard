import type { PublicEventType } from "@/domain/booking/ports";
import { bookingIcs } from "@/domain/booking/ics";
import { dayLabel, type SlotChoice } from "@/ui/features/booking/slot-days";

export type BookingConfirmation = {
  title: string;
  day: string;
  time: string;
  /** Address of an in_person type, otherwise null. */
  location: string | null;
  /** `data:` link of the .ics; null when the browser has no `Temporal` (the link is then not offered). */
  icsHref: string | null;
};

export const ICS_FILE_NAME = "rendez-vous.ics";

/** Decision 5: recap in the browser's zone and the calendar file, built once, right after `booked`. */
export function toBookingConfirmation(input: {
  bookingId: string;
  slot: SlotChoice;
  eventType: PublicEventType;
  ownerName: string;
  timeZone: string;
}): BookingConfirmation {
  const { bookingId, slot, eventType, ownerName, timeZone } = input;
  const location = eventType.locationKind === "in_person" ? eventType.locationText : null;
  return {
    title: eventType.title,
    day: dayLabel(slot.start, timeZone),
    time: slot.time,
    location,
    icsHref: typeof Temporal === "undefined" ? null : icsHref(bookingId, slot, eventType.title, ownerName, location),
  };
}

function icsHref(bookingId: string, slot: SlotChoice, title: string, ownerName: string, location: string | null): string {
  const ics = bookingIcs({
    bookingId,
    start: Temporal.Instant.from(slot.start),
    end: Temporal.Instant.from(slot.end),
    title,
    ownerName,
    location,
    now: Temporal.Now.instant(),
  });
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}
