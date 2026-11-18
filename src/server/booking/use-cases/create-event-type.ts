import { firstFreePosition, type EventType, type EventTypeDraft } from "@/domain/booking/event-type";
import type { EventTypeRepository } from "@/domain/booking/ports";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, ok, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type CreateEventTypeError =
  | "unauthenticated"
  | "not_found"
  | "rate_limited"
  | "limit_reached"
  | "conflict"
  | "invalid_input"
  | "unexpected";

export type CreateEventType = (command: EventTypeDraft & { id: string }) => Promise<Result<EventType, CreateEventTypeError>>;

/**
 * At most 10 types, at the lowest free position. Idempotent by the client-generated id: a replay (already listed, or
 * created concurrently) returns the stored type; another type taking the position is a `conflict`, never retried.
 */
export function makeCreateEventType(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  eventTypes: EventTypeRepository;
}): CreateEventType {
  return async (command) => {
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    const { profileId } = authorized.value;
    const { id, ...draft } = command;
    const current = await deps.eventTypes.listOwn(profileId);
    if (!current.ok) {
      return err("unexpected");
    }
    const existing = current.value.find((eventType) => eventType.id === id);
    if (existing !== undefined) {
      return ok(existing);
    }
    const position = firstFreePosition(current.value.map((eventType) => eventType.position));
    if (position === null) {
      return err("limit_reached");
    }
    const created = await deps.eventTypes.create(profileId, { ...draft, id, position });
    if (created.ok || created.error !== "conflict") {
      return created;
    }
    const after = await deps.eventTypes.listOwn(profileId);
    const replayed = after.ok ? after.value.find((eventType) => eventType.id === id) : undefined;
    return replayed === undefined ? err("conflict") : ok(replayed);
  };
}
