import type { MembershipReader, ProfileRegistrar } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { IdGenerator } from "@/domain/shared/ports/id-generator";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, ok, type Result } from "@/domain/shared/result";
import { makeEnsureMembership } from "@/server/use-cases/ensure-membership";
import { enforceRateLimits } from "@/server/use-cases/shared/enforce-rate-limits";

export type SignInUseCaseError =
  | "rate_limited"
  | "invalid_credentials"
  | "email_not_confirmed"
  | "display_name_required"
  | "slug_unavailable"
  | "registration_closed"
  | "unexpected";

export type SignInInput = { email: string; password: string; displayName?: string | undefined; clientAddress: string };

export type SignIn = (input: SignInInput) => Promise<Result<{ userId: string; joined: boolean }, SignInUseCaseError>>;

/**
 * Rate limits (address, then account) → GoTrue sign-in → membership ensured for the signed-in account.
 * A gateway refusal (`invalid_credentials`, `email_not_confirmed`, `rate_limited`) ends the flow before any lookup.
 */
export function makeSignIn(deps: {
  auth: AuthGateway;
  membership: MembershipReader;
  registrar: ProfileRegistrar;
  ids: IdGenerator;
  rateLimiter: RateLimiter;
}): SignIn {
  const ensureMembership = makeEnsureMembership(deps);

  return async (input) => {
    const limited = await enforceRateLimits(deps.rateLimiter, [
      { scope: "login", subject: input.clientAddress },
      { scope: "login-account", subject: normalizeEmail(input.email) },
    ]);
    if (!limited.ok) {
      return err(limited.error);
    }
    const signedIn = await deps.auth.signIn({ email: input.email, password: input.password });
    if (!signedIn.ok) {
      return err(signedIn.error);
    }
    const membership = await ensureMembership({ userId: signedIn.value.userId, displayName: input.displayName });
    if (!membership.ok) {
      return err(membership.error);
    }
    return ok({ userId: signedIn.value.userId, joined: membership.value.joined });
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
