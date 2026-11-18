import type { AvailabilityRepository } from "@/domain/booking/ports";
import { parseSelectableTimeZone } from "@/domain/booking/time-zone-choice";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type SaveTimeZoneError = "unauthenticated" | "not_found" | "rate_limited" | "invalid_input" | "unexpected";

export type SaveTimeZone = (timeZone: string) => Promise<Result<void, SaveTimeZoneError>>;

/** A zone of `selectableTimeZones()` only, checked before anything else. Replayable. */
export function makeSaveTimeZone(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  availability: AvailabilityRepository;
}): SaveTimeZone {
  return async (name) => {
    const timeZone = parseSelectableTimeZone(name);
    if (timeZone === null) {
      return err("invalid_input");
    }
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    return deps.availability.setTimeZone(authorized.value.profileId, timeZone);
  };
}
