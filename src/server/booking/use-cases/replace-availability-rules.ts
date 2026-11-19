import type { AvailabilityRule } from "@/domain/booking/availability";
import type { AvailabilityRepository, RulesWriteError } from "@/domain/booking/ports";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type ReplaceAvailabilityRulesError = "unauthenticated" | "not_found" | "rate_limited" | RulesWriteError;

export type ReplaceAvailabilityRules = (
  rules: readonly AvailabilityRule[],
) => Promise<Result<AvailabilityRule[], ReplaceAvailabilityRulesError>>;

/** Replaces the whole weekly list (already parsed by `parseAvailabilityRules`), in one transaction. Replayable. */
export function makeReplaceAvailabilityRules(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  availability: AvailabilityRepository;
}): ReplaceAvailabilityRules {
  return async (rules) => {
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    return deps.availability.replaceRules(authorized.value.profileId, rules);
  };
}
