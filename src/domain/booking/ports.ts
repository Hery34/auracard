import type { AvailabilityException, AvailabilityRule } from "@/domain/booking/availability";
import type { EventType, EventTypeDraft } from "@/domain/booking/event-type";
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
