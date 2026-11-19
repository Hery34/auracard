import { EVENT_TYPE_BOUNDS } from "@/domain/booking/event-type";

/** The Turnstile widget's `action` on the booking form; its `cData` is the slug (token bound to the profile, 0032). */
export const BOOKING_CHALLENGE_ACTION = "booking";

/** Length checks of `carnet.bookings` (0036). */
export const BOOKING_TEXT_MAX_LENGTH = { name: 100, email: 254, phone: 32, message: 2000 } as const;

export const BOOKING_INVALID_FIELDS = [
  "eventTypeId",
  "start",
  "name",
  "email",
  "phone",
  "message",
  "consent",
  "idempotencyKey",
] as const;
export type BookingInvalidField = (typeof BOOKING_INVALID_FIELDS)[number];

/** Validated booking form: ids in lower case, `start` = canonical UTC instant text, blank phone / message → null. */
export type BookingSubmission = {
  eventTypeId: string;
  start: string;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  idempotencyKey: string;
};

/**
 * A public slot list is read one local week at a time (audit 0037/0038); the longest one, across the autumn change,
 * lasts 7 × 24 + 1 hours.
 */
export const SLOT_READ_WINDOW_HOURS = 169;

/**
 * Longest duration + longest buffer: occupations are read up to the end of the displayed range plus this, otherwise
 * a slot at the end of the range could be offered then refused (note reported from 0037).
 */
export const MAX_OCCUPIED_MINUTES = EVENT_TYPE_BOUNDS.durationMin.max + EVENT_TYPE_BOUNDS.bufferMin.max;

/** Longer than any ISO 8601 instant. */
export const INSTANT_TEXT_MAX_LENGTH = 64;

/** An instant with an explicit offset or Z; a local date-time without offset, or any other text → null. */
export function parseInstant(text: string): Temporal.Instant | null {
  if (text.length > INSTANT_TEXT_MAX_LENGTH) {
    return null;
  }
  try {
    return Temporal.Instant.from(text);
  } catch {
    return null;
  }
}
