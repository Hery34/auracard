import { z } from "zod";

import {
  BOOKING_INVALID_FIELDS,
  BOOKING_TEXT_MAX_LENGTH,
  INSTANT_TEXT_MAX_LENGTH,
  parseInstant,
  type BookingInvalidField,
  type BookingSubmission,
} from "@/domain/booking/booking";
import { FORBIDDEN_LABEL_CHARACTERS } from "@/domain/profile/link";
import { parsePhone } from "@/domain/profile/phone";
import { SLUG_MAX_LENGTH } from "@/domain/profile/slug";
import { err, ok, type Result } from "@/domain/shared/result";
import { multilineText } from "@/server/actions/multiline-text";
import { bookingIdSchema } from "@/server/booking/action-schemas";

/** Text fields of the booking form; an absent field is `undefined`. */
export type BookingDraft = {
  eventTypeId: string | undefined;
  start: string | undefined;
  name: string | undefined;
  email: string | undefined;
  phone: string | undefined;
  message: string | undefined;
  consent: string | undefined;
  idempotencyKey: string | undefined;
};

/** Canonical UTC text of an instant with an explicit offset. */
const instantSchema = z.string().transform((text, context) => {
  const instant = parseInstant(text);
  if (instant === null) {
    context.addIssue({ code: "custom", message: "invalid instant" });
    return z.NEVER;
  }
  return instant.toString();
});

/** Blank or absent → null; whether the type requires a phone is decided by `book_slot`. */
const phoneSchema = z
  .union([z.string(), z.undefined()])
  .transform((text) => text?.trim() ?? "")
  .refine((text) => text === "" || parsePhone(text).ok)
  .transform((text) => (text === "" ? null : text));

/**
 * Unknown keys stripped; the consent is checked, then dropped (not a parameter of `book_slot`). Bounds of
 * `carnet.bookings` (0036).
 */
export const bookingSubmissionSchema: z.ZodType<BookingSubmission, BookingDraft> = z
  .object({
    eventTypeId: bookingIdSchema,
    start: instantSchema,
    name: z
      .string()
      .trim()
      .min(1)
      .max(BOOKING_TEXT_MAX_LENGTH.name)
      .refine((text) => !FORBIDDEN_LABEL_CHARACTERS.test(text)),
    email: z.string().trim().pipe(z.email().max(BOOKING_TEXT_MAX_LENGTH.email)),
    phone: phoneSchema,
    message: z
      .union([z.string(), z.undefined()])
      .transform((text) => text ?? "")
      .pipe(multilineText(BOOKING_TEXT_MAX_LENGTH.message))
      .transform((text) => (text === "" ? null : text)),
    consent: z.literal("on"),
    idempotencyKey: bookingIdSchema,
  })
  .transform(({ eventTypeId, start, name, email, phone, message, idempotencyKey }) => ({
    eventTypeId,
    start,
    name,
    email,
    phone,
    message,
    idempotencyKey,
  }));

/** Every invalid field in form order; never echoes a value. */
export function parseBookingSubmission(draft: BookingDraft): Result<BookingSubmission, BookingInvalidField[]> {
  const parsed = bookingSubmissionSchema.safeParse(draft);
  if (parsed.success) {
    return ok(parsed.data);
  }
  const invalid = new Set(parsed.error.issues.map((issue) => issue.path[0]));
  return err(BOOKING_INVALID_FIELDS.filter((field) => invalid.has(field)));
}

export type SlotsQuery = { slug: string; eventTypeId: string; from: string; to: string };

/** Input of `listSlotsAction`; the instants themselves are checked by the use case (`invalid_range`). */
export const slotsQuerySchema: z.ZodType<SlotsQuery, unknown> = z.strictObject({
  slug: z.string().max(SLUG_MAX_LENGTH),
  eventTypeId: bookingIdSchema,
  from: z.string().max(INSTANT_TEXT_MAX_LENGTH),
  to: z.string().max(INSTANT_TEXT_MAX_LENGTH),
});
