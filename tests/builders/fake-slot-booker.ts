import type { SlotBooker } from "@/domain/booking/ports";
import { err, ok } from "@/domain/shared/result";

import { BOOKING_IDS, BOOKING_SLUG, PUBLIC_EVENT_TYPE_IDS } from "./booking";
import { makeCallLog, type CallLog } from "./call-log";

export type FakeSlotBookerOptions = {
  log?: CallLog;
  /** Published profiles; any other slug is `not_found` (P0002 of book_slot). Default: [BOOKING_SLUG]. */
  accepting?: readonly string[];
  /** Active types of those profiles; any other id is `not_found` (P0002). Default: the three public types. */
  activeTypes?: readonly string[];
  /** Types whose mode is `phone`: a null phone is refused (22023). Default: the public phone type. */
  phoneTypes?: readonly string[];
  /** Starts outside the availabilities (CN002). */
  unavailableStarts?: readonly string[];
  /** Starts already booked by someone else (CN001); every booking made through the fake is added. */
  takenStarts?: readonly string[];
  /**
   * 0039 point 8 (CN005, 20 bookings created in 23 h in SQL): number of bookings a profile still accepts; beyond, a
   * new booking is `profile_quota` while a replay of a stored key still succeeds. Default: no quota.
   */
  profileQuota?: number;
  /** When true, every call fails with `err("unexpected")`. */
  failing?: boolean;
};

export type StoredBooking = {
  id: string;
  slug: string;
  eventTypeId: string;
  start: string;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  idempotencyKey: string;
  deviceClass: string;
};

/**
 * Stand-in for `carnet.book_slot`, in its order (carnet_bookings_book_slot.test.sql): unknown or unpublished slug →
 * `not_found`; a replay of (slug, key) returns the booking already stored without any check nor write; profile quota
 * reached → `profile_quota` (carnet_bookings_profile_quota.test.sql); unknown or inactive type → `not_found`; phone type without phone → `phone_required`; outside availabilities →
 * `slot_unavailable`; slot taken → `slot_taken`; otherwise one booking. `stored` is what the database would hold.
 */
export function fakeSlotBooker(options: FakeSlotBookerOptions = {}): SlotBooker & { stored: StoredBooking[] } {
  const log = options.log ?? makeCallLog();
  const accepting = options.accepting ?? [BOOKING_SLUG];
  const activeTypes = options.activeTypes ?? Object.values(PUBLIC_EVENT_TYPE_IDS);
  const phoneTypes = options.phoneTypes ?? [PUBLIC_EVENT_TYPE_IDS.phone];
  const unavailable = new Set(options.unavailableStarts ?? []);
  const taken = new Set(options.takenStarts ?? []);
  const stored: StoredBooking[] = [];

  return {
    stored,
    async book(command) {
      log.record("bookings", "book", command);
      if (options.failing === true) {
        return err("unexpected");
      }
      if (!accepting.includes(command.slug)) {
        return err("not_found");
      }
      const existing = stored.find((booking) => booking.slug === command.slug && booking.idempotencyKey === command.idempotencyKey);
      if (existing !== undefined) {
        return ok({ bookingId: existing.id });
      }
      if (options.profileQuota !== undefined && stored.filter((booking) => booking.slug === command.slug).length >= options.profileQuota) {
        return err("profile_quota");
      }
      if (!activeTypes.includes(command.eventTypeId)) {
        return err("not_found");
      }
      if (phoneTypes.includes(command.eventTypeId) && (command.phone === null || command.phone.trim() === "")) {
        return err("phone_required");
      }
      if (unavailable.has(command.start)) {
        return err("slot_unavailable");
      }
      if (taken.has(command.start)) {
        return err("slot_taken");
      }
      const id = BOOKING_IDS[stored.length];
      if (id === undefined) {
        throw new Error("fakeSlotBooker: out of ids");
      }
      taken.add(command.start);
      const { slug, eventTypeId, start, name, email, phone, message, idempotencyKey, deviceClass } = command;
      stored.push({ id, slug, eventTypeId, start, name, email, phone, message, idempotencyKey, deviceClass });
      return ok({ bookingId: id });
    },
  };
}
