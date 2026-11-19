import type { BookingInvalidField } from "@/domain/booking/booking";
import type { BookSlotState } from "@/server/booking/public-actions";
import { BOOK_SLOT_ERROR_MESSAGES, BOOKING_FIELD_ERROR_MESSAGES } from "@/ui/features/booking/public-messages";

export type BookingSelection = { eventTypeId: string; start: string };
export type IdempotencyBinding = { key: string; selection: BookingSelection | null };

/** Fields with a visible control; the others (type, slot, key) join the form-level alert. */
const VISIBLE_FIELDS: readonly BookingInvalidField[] = ["name", "email", "phone", "message", "consent"];

export type BookingFormView = {
  /** Form-level message, `role="alert"`; `null` when there is none. */
  alert: string | null;
  fieldErrors: Partial<Record<BookingInvalidField, string>>;
};

export function toBookingFormView(state: BookSlotState): BookingFormView {
  if (state.status !== "error") {
    return { alert: null, fieldErrors: {} };
  }
  const fields = state.fields ?? [];
  const visible = fields.filter((field) => VISIBLE_FIELDS.includes(field));
  const hidden = fields.filter((field) => !VISIBLE_FIELDS.includes(field));
  return {
    alert: [BOOK_SLOT_ERROR_MESSAGES[state.error], ...hidden.map((field) => BOOKING_FIELD_ERROR_MESSAGES[field])].join(" "),
    fieldErrors: Object.fromEntries(visible.map((field) => [field, BOOKING_FIELD_ERROR_MESSAGES[field]])),
  };
}

/** Every refusal but `unexpected` excludes a write; after `unexpected` the same key keeps the replay idempotent. */
export function needsNewIdempotencyKey(state: BookSlotState): boolean {
  return state.status === "error" && state.error !== "unexpected";
}

/** A refused or unchecked token cannot be sent again; field errors are caught before Cloudflare is called. */
export function needsNewChallenge(state: BookSlotState): boolean {
  return state.status === "error" && state.error !== "invalid_input";
}

/** Decision 2: the slot was taken or is no longer offered → the list is read again and the choice cleared. */
export function needsSlotRefresh(state: BookSlotState): boolean {
  return state.status === "error" && (state.error === "slot_taken" || state.error === "slot_unavailable");
}

function sameSelection(a: BookingSelection | null, b: BookingSelection | null): boolean {
  return a === null || b === null ? a === b : a.eventTypeId === b.eventTypeId && a.start === b.start;
}

/** Decision 7: the key is bound to the choice; a changed choice always gets a new key, even after `unexpected`. */
export function idempotencyKeyFor(
  previous: IdempotencyBinding,
  selection: BookingSelection | null,
  state: BookSlotState,
  newKey: () => string,
): IdempotencyBinding {
  if (sameSelection(previous.selection, selection) && !needsNewIdempotencyKey(state)) {
    return previous;
  }
  return { key: newKey(), selection };
}
