import type { AvailabilityRepository } from "@/domain/booking/ports";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type RemoveAvailabilityExceptionError = "unauthenticated" | "not_found" | "rate_limited" | "unexpected";

export type RemoveAvailabilityException = (id: string) => Promise<Result<void, RemoveAvailabilityExceptionError>>;

/** Already removed or someone else's: success (no oracle). */
export function makeRemoveAvailabilityException(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  availability: AvailabilityRepository;
}): RemoveAvailabilityException {
  return async (id) => {
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    return deps.availability.removeException(authorized.value.profileId, id);
  };
}
