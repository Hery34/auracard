import {
  parseAvailabilityException,
  type AvailabilityException,
  type ExceptionError,
} from "@/domain/booking/availability";
import type { AvailabilityRepository, ExceptionWriteError } from "@/domain/booking/ports";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { Clock } from "@/domain/shared/ports/clock";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type AddAvailabilityExceptionError =
  | ExceptionError
  | "unauthenticated"
  | "not_found"
  | "rate_limited"
  | ExceptionWriteError;

export type AddAvailabilityException = (input: {
  id: string;
  kind: string;
  start: string;
  end: string;
}) => Promise<Result<AvailabilityException, AddAvailabilityExceptionError>>;

/**
 * `start` and `end`: `datetime-local` values read in the profile's stored time zone. Idempotent by the
 * client-generated id.
 */
export function makeAddAvailabilityException(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  availability: AvailabilityRepository;
  clock: Clock;
}): AddAvailabilityException {
  return async ({ id, ...input }) => {
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    const { profileId } = authorized.value;
    const timeZone = await deps.availability.getTimeZone(profileId);
    if (!timeZone.ok) {
      return err(timeZone.error);
    }
    const range = parseAvailabilityException(input, timeZone.value, deps.clock.now());
    if (!range.ok) {
      return err(range.error);
    }
    return deps.availability.addException(profileId, { id, ...range.value });
  };
}
