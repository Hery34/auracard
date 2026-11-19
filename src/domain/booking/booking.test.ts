/**
 * Contract frozen by test-engineer (0039, decisions 1 to 3; notes inherited from 0036 and 0037; ADR 0008, 0016).
 *
 * // src/domain/booking/booking.ts — pure, no Next.js / Supabase / Node.js.
 * // The Turnstile widget's `action` on the booking form; its `cData` is the slug (token bound to the profile, as 0032).
 * export const BOOKING_CHALLENGE_ACTION = "booking";
 * // Bounds of carnet.bookings (0036): visitor_name 1–100, visitor_email ≤ 254, visitor_phone ≤ 32, message ≤ 2000.
 * export const BOOKING_TEXT_MAX_LENGTH: { name: 100; email: 254; phone: 32; message: 2000 };
 * export const BOOKING_INVALID_FIELDS: readonly ["eventTypeId", "start", "name", "email", "phone", "message",
 *   "consent", "idempotencyKey"];   export type BookingInvalidField;
 * // A validated submission (src/server/booking/public-schemas.ts): ids in lower case, `start` = canonical
 * // Temporal.Instant text in UTC ("2027-03-03T08:00:00Z"), blank phone / message → null.
 * export type BookingSubmission = { eventTypeId: string; start: string; name: string; email: string;
 *   phone: string | null; message: string | null; idempotencyKey: string };
 * // A public slot list is read one local week at a time (audit 0037/0038: short period per request); 0039 point 8:
 * // the longest local week, the one of the autumn change (7 × 24 + 1 hours), bounds `to − from`.
 * export const SLOT_READ_WINDOW_HOURS = 169;
 * // Note inherited from 0037: the occupations are read up to `to + MAX_OCCUPIED_MINUTES` (longest duration 480 +
 * // longest buffer 240), otherwise a slot at the end of the range could be offered then refused (CN001).
 * export const MAX_OCCUPIED_MINUTES = 720;
 */
import { describe, expect, it } from "vitest";

import {
  BOOKING_CHALLENGE_ACTION,
  BOOKING_INVALID_FIELDS,
  BOOKING_TEXT_MAX_LENGTH,
  MAX_OCCUPIED_MINUTES,
  SLOT_READ_WINDOW_HOURS,
} from "@/domain/booking/booking";
import { EVENT_TYPE_BOUNDS } from "@/domain/booking/event-type";
import { LEAD_CHALLENGE_ACTION } from "@/domain/lead/lead";

describe("booking constants (0039)", () => {
  it("decision 1: the widget action is « booking », distinct from the contact form's", () => {
    expect(BOOKING_CHALLENGE_ACTION).toBe("booking");
    expect(BOOKING_CHALLENGE_ACTION).not.toBe(LEAD_CHALLENGE_ACTION);
  });

  it("bounds of carnet.bookings (0036): name 100, e-mail 254, phone 32, message 2000", () => {
    expect(BOOKING_TEXT_MAX_LENGTH).toStrictEqual({ name: 100, email: 254, phone: 32, message: 2000 });
  });

  it("criterion 4: the invalid fields, in form order", () => {
    expect([...BOOKING_INVALID_FIELDS]).toStrictEqual([
      "eventTypeId",
      "start",
      "name",
      "email",
      "phone",
      "message",
      "consent",
      "idempotencyKey",
    ]);
  });

  it("audit 0037/0038, point 8: one local week per slot read, at most 169 h (week of the autumn DST change)", () => {
    expect(SLOT_READ_WINDOW_HOURS).toBe(169);
  });

  it("note inherited from 0037: occupations read up to to + 720 min = longest duration + longest buffer", () => {
    expect(MAX_OCCUPIED_MINUTES).toBe(720);
    expect(MAX_OCCUPIED_MINUTES).toBe(EVENT_TYPE_BOUNDS.durationMin.max + EVENT_TYPE_BOUNDS.bufferMin.max);
  });
});
