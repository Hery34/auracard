import type { SlotBooker, SlotBookerError } from "@/domain/booking/ports";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/** `carnet.book_slot` as written in SQL: phone and message nullable; returns table (booking_id, cancel_token). */
type BookSlotClient = {
  rpc(
    fn: "book_slot",
    args: {
      p_slug: string;
      p_event_type_id: string;
      p_start: string;
      p_visitor_name: string;
      p_visitor_email: string;
      p_visitor_phone: string | null;
      p_message: string | null;
      p_idempotency_key: string;
      p_device_class: string;
    },
  ): PromiseLike<{ data: unknown; error: { code: string } | null }>;
};

/** Refusals of `book_slot`, by SQLSTATE (never by message): expected answers, not logged. */
const REFUSALS: ReadonlyMap<string, SlotBookerError> = new Map([
  ["P0002", "not_found"],
  ["CN001", "slot_taken"],
  ["CN002", "slot_unavailable"],
  // 22023 can only mean "phone required by a phone type": its other causes are excluded by the action's validation.
  ["22023", "phone_required"],
  ["23514", "invalid_input"],
  ["23502", "invalid_input"],
  ["CN005", "profile_quota"],
]);

/** The booking id of the single row; the cancel token is never read (it reaches the visitor through the outbox). */
function bookingIdOf(data: unknown): string | null {
  const row: unknown = Array.isArray(data) ? data[0] : data;
  if (typeof row !== "object" || row === null || !("booking_id" in row)) {
    return null;
  }
  return typeof row.booking_id === "string" ? row.booking_id : null;
}

/** `carnet.book_slot` (ADR 0011, service_role): booking, `booking_confirmed` and outbox event in one transaction. */
export function makeSupabaseSlotBooker(admin: CarnetClient): SlotBooker {
  const client = admin as unknown as BookSlotClient;
  return {
    async book({ slug, eventTypeId, start, name, email, phone, message, idempotencyKey, deviceClass }) {
      const { data, error } = await client.rpc("book_slot", {
        p_slug: slug,
        p_event_type_id: eventTypeId,
        p_start: start,
        p_visitor_name: name,
        p_visitor_email: email,
        p_visitor_phone: phone,
        p_message: message,
        p_idempotency_key: idempotencyKey,
        p_device_class: deviceClass,
      });
      if (error !== null) {
        const refusal = REFUSALS.get(error.code);
        if (refusal !== undefined) {
          return err(refusal);
        }
        logInfrastructureError("book_slot", error.code);
        return err("unexpected");
      }
      const bookingId = bookingIdOf(data);
      if (bookingId === null) {
        logInfrastructureError("book_slot", "malformed_row");
        return err("unexpected");
      }
      return ok({ bookingId });
    },
  };
}
