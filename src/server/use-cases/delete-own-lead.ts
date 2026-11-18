import type { LeadRepository } from "@/domain/lead/ports";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type DeleteOwnLeadError = "unauthenticated" | "not_found" | "rate_limited" | "unexpected";

export type DeleteOwnLead = (leadId: string) => Promise<Result<void, DeleteOwnLeadError>>;

/** Deletes one of the caller's leads. Already deleted or someone else's: success, nothing done (no oracle). */
export function makeDeleteOwnLead(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  leads: LeadRepository;
}): DeleteOwnLead {
  return async (leadId) => {
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    return deps.leads.deleteOwn(authorized.value.profileId, leadId);
  };
}
