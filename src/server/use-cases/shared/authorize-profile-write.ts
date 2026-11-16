import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, ok, type Result } from "@/domain/shared/result";
import { enforceRateLimits } from "@/server/use-cases/shared/enforce-rate-limits";

export type AuthorizeProfileWriteError = "unauthenticated" | "not_found" | "rate_limited" | "unexpected";

/**
 * Session verified with GoTrue → `profile-write` counter of the account → the caller's own profile. The target is
 * never an id sent by the client; an account without a carnet profile (another project) is `not_found`.
 */
export async function authorizeProfileWrite(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
}): Promise<Result<{ profileId: string; slug: string }, AuthorizeProfileWriteError>> {
  const user = await deps.auth.currentUser();
  if (!user.ok) {
    return err("unexpected");
  }
  if (user.value === null) {
    return err("unauthenticated");
  }
  const limited = await enforceRateLimits(deps.rateLimiter, [{ scope: "profile-write", subject: user.value.userId }]);
  if (!limited.ok) {
    return err(limited.error);
  }
  const own = await deps.profiles.getOwn();
  if (!own.ok) {
    return err("unexpected");
  }
  if (own.value === null) {
    return err("not_found");
  }
  return ok({ profileId: own.value.id, slug: own.value.slug });
}
