import type { DeviceClass } from "@/domain/analytics/analytics-event";
import type { AvailabilityException, AvailabilityRule } from "@/domain/booking/availability";
import type { BookingSubmission } from "@/domain/booking/booking";
import type { EventType, EventTypeDraft, LocationKind } from "@/domain/booking/event-type";
import type { TimeRange } from "@/domain/booking/time-range";
import type { TimeZone } from "@/domain/booking/time-zone";
import type { Result } from "@/domain/shared/result";

export type NewEventType = EventTypeDraft & { id: string; position: number };

export type EventTypeWriteError = "not_found" | "conflict" | "invalid_input" | "unexpected";

/** The owner's event types, under the session (RLS): another account's profile reads `[]` and writes nothing. */
export interface EventTypeRepository {
  /** By position, inactive included (at most 10). */
  listOwn(profileId: string): Promise<Result<EventType[], "unexpected">>;
  /** Client-generated `id` (idempotency key); id or position taken → `conflict`. */
  create(profileId: string, eventType: NewEventType): Promise<Result<EventType, EventTypeWriteError>>;
  update(
    profileId: string,
    id: string,
    draft: EventTypeDraft,
  ): Promise<Result<EventType, "not_found" | "invalid_input" | "unexpected">>;
  setActive(profileId: string, id: string, isActive: boolean): Promise<Result<EventType, "not_found" | "unexpected">>;
  /** Positions 0…n−1 in the given order, in one statement; returns the types by position. */
  reorder(
    profileId: string,
    ids: readonly string[],
  ): Promise<Result<EventType[], "not_found" | "invalid_input" | "unexpected">>;
  /** Absent or someone else's: success, nothing done. A type with bookings → `has_bookings`. */
  remove(profileId: string, id: string): Promise<Result<void, "has_bookings" | "unexpected">>;
}

export type RulesWriteError = "not_found" | "overlap" | "limit_reached" | "invalid_input" | "unexpected";

export type ExceptionWriteError = "not_found" | "limit_reached" | "invalid_input" | "unexpected";

/** Time zone, weekly rules and exceptions of the owner, under the session (RLS). */
export interface AvailabilityRepository {
  /** The stored zone parsed at the boundary: a value `parseTimeZone` refuses → `unexpected`. */
  getTimeZone(profileId: string): Promise<Result<TimeZone, "not_found" | "unexpected">>;
  setTimeZone(profileId: string, timeZone: string): Promise<Result<void, "not_found" | "invalid_input" | "unexpected">>;
  /** By weekday then start. */
  listRules(profileId: string): Promise<Result<AvailabilityRule[], "unexpected">>;
  /** The whole list in one transaction: a refusal keeps the previous rules. Returns the stored rules, sorted. */
  replaceRules(
    profileId: string,
    rules: readonly AvailabilityRule[],
  ): Promise<Result<AvailabilityRule[], RulesWriteError>>;
  /** Every exception ending after `now`, by start then id. */
  listUpcomingExceptions(profileId: string, now: Date): Promise<Result<AvailabilityException[], "unexpected">>;
  /** Client-generated `id` (idempotency key): a replay of the caller's own id returns the stored row. */
  addException(
    profileId: string,
    exception: AvailabilityException,
  ): Promise<Result<AvailabilityException, ExceptionWriteError>>;
  /** Absent or someone else's: success, nothing done. */
  removeException(profileId: string, id: string): Promise<Result<void, "unexpected">>;
}

/** An active type as the public page shows it; `locationText` is the address of an in_person type, otherwise null. */
export type PublicEventType = {
  id: string;
  title: string;
  durationMin: number;
  bufferMin: number;
  minNoticeMin: number;
  locationKind: LocationKind;
  locationText: string | null;
  position: number;
};

/** Active types by position, weekly rules "HH:MM" in the profile's time zone. */
export type PublicBookingPage = { timeZone: TimeZone; eventTypes: PublicEventType[]; rules: AvailabilityRule[] };

/** Confirmed bookings with their buffer and busy exceptions; one-off openings. */
export type PublicBusyRanges = { busy: TimeRange[]; extra: TimeRange[] };

/** `carnet.get_public_booking_page` / `get_public_busy_ranges` (0036), anonymous client, never service_role. */
export interface PublicBookingReader {
  /** null: unknown or unpublished profile. */
  page(slug: string): Promise<Result<PublicBookingPage | null, "unexpected">>;
  /** null: unknown or unpublished profile. */
  busyRanges(slug: string, range: TimeRange): Promise<Result<PublicBusyRanges | null, "unexpected">>;
}

export type BookSlotCommand = BookingSubmission & { slug: string; deviceClass: DeviceClass };

export type SlotBookerError =
  | "not_found"
  | "slot_taken"
  | "slot_unavailable"
  | "phone_required"
  | "invalid_input"
  | "profile_quota"
  | "unexpected";

/** `carnet.book_slot` (service_role, ADR 0011): a replay of (slug, key) gives the same id and writes nothing more. */
export interface SlotBooker {
  book(command: BookSlotCommand): Promise<Result<{ bookingId: string }, SlotBookerError>>;
}
