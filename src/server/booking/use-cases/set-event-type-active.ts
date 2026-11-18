import type { EventType } from "@/domain/booking/event-type";
import type { EventTypeRepository } from "@/domain/booking/ports";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type SetEventTypeActiveError = "unauthenticated" | "not_found" | "rate_limited" | "unexpected";

export type SetEventTypeActive = (command: {
  id: string;
  isActive: boolean;
}) => Promise<Result<EventType, SetEventTypeActiveError>>;

/** A deactivated type leaves the public page; its bookings stay (decision 3). Replayable. */
export function makeSetEventTypeActive(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  eventTypes: EventTypeRepository;
}): SetEventTypeActive {
  return async ({ id, isActive }) => {
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    return deps.eventTypes.setActive(authorized.value.profileId, id, isActive);
  };
}
