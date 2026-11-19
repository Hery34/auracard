import type { EventType, EventTypeDraft } from "@/domain/booking/event-type";
import type { EventTypeRepository } from "@/domain/booking/ports";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type UpdateEventTypeError = "unauthenticated" | "not_found" | "rate_limited" | "invalid_input" | "unexpected";

export type UpdateEventType = (command: EventTypeDraft & { id: string }) => Promise<Result<EventType, UpdateEventTypeError>>;

/** Full update of the business fields of one of the caller's types (replayable). */
export function makeUpdateEventType(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  eventTypes: EventTypeRepository;
}): UpdateEventType {
  return async (command) => {
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    const { id, ...draft } = command;
    return deps.eventTypes.update(authorized.value.profileId, id, draft);
  };
}
