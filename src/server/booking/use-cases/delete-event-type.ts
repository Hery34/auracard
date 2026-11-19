import type { EventTypeRepository } from "@/domain/booking/ports";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type DeleteEventTypeError = "unauthenticated" | "not_found" | "rate_limited" | "has_bookings" | "unexpected";

export type DeleteEventType = (id: string) => Promise<Result<void, DeleteEventTypeError>>;

/** Already deleted or someone else's: success (no oracle). A type with bookings → `has_bookings` (to be deactivated instead). */
export function makeDeleteEventType(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  eventTypes: EventTypeRepository;
}): DeleteEventType {
  return async (id) => {
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    return deps.eventTypes.remove(authorized.value.profileId, id);
  };
}
