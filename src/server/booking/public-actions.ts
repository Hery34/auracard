"use server";

import { headers } from "next/headers";

import type { BookingInvalidField } from "@/domain/booking/booking";
import { textFields } from "@/server/actions/form-fields";
import { parseBookingSubmission, slotsQuerySchema } from "@/server/booking/public-schemas";
import type { BookSlotError } from "@/server/booking/use-cases/book-slot";
import type { ListPublicSlotsError } from "@/server/booking/use-cases/list-public-slots";
import { createPublicContainer } from "@/server/container";

export type BookSlotActionError = "invalid_input" | Exclude<BookSlotError, "phone_required" | "invalid_input">;

export type BookSlotState =
  | { status: "idle" }
  | { status: "error"; error: BookSlotActionError; fields?: BookingInvalidField[] }
  | { status: "booked"; bookingId: string };

export type ListSlotsActionResult =
  | { status: "ok"; slots: { start: string; end: string }[] }
  | { status: "error"; error: "invalid_input" | ListPublicSlotsError };

const BOOKING_FIELDS = [
  "slug",
  "eventTypeId",
  "start",
  "name",
  "email",
  "phone",
  "message",
  "consent",
  "idempotencyKey",
  "cf-turnstile-response",
] as const;

/**
 * Public booking form: the only validation of the submission (field errors); the use case then checks the slug, the
 * robots, the rate limits, Turnstile, and `book_slot` the slot. No submitted value is ever echoed in the state.
 */
export async function bookSlotAction(_previous: BookSlotState, formData: FormData): Promise<BookSlotState> {
  const fields = textFields(formData, BOOKING_FIELDS);
  const parsed = parseBookingSubmission({
    eventTypeId: fields.eventTypeId,
    start: fields.start,
    name: fields.name,
    email: fields.email,
    phone: fields.phone,
    message: fields.message,
    consent: fields.consent,
    idempotencyKey: fields.idempotencyKey,
  });
  if (!parsed.ok) {
    return { status: "error", error: "invalid_input", fields: parsed.error };
  }
  const { bookSlot } = createPublicContainer();
  const result = await bookSlot(
    { ...parsed.value, slug: fields.slug ?? "", challengeToken: fields["cf-turnstile-response"] },
    await headers(),
  );
  if (result.ok) {
    return { status: "booked", bookingId: result.value.bookingId };
  }
  if (result.error === "phone_required") {
    return { status: "error", error: "invalid_input", fields: ["phone"] };
  }
  return { status: "error", error: result.error };
}

/** One local week [from, to) of a type's slots (the browser's local midnights); a read, by POST, rate limited. */
export async function listSlotsAction(input: {
  slug: string;
  eventTypeId: string;
  from: string;
  to: string;
}): Promise<ListSlotsActionResult> {
  const parsed = slotsQuerySchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid_input" };
  }
  const { listPublicSlots } = createPublicContainer();
  const result = await listPublicSlots(parsed.data, await headers());
  if (!result.ok) {
    return { status: "error", error: result.error };
  }
  return {
    status: "ok",
    slots: result.value.map((slot) => ({ start: slot.start.toString(), end: slot.end.toString() })),
  };
}
