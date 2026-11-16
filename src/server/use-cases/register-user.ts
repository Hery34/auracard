import type { ProfileRegistrar } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { IdGenerator } from "@/domain/shared/ports/id-generator";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, ok, type Result } from "@/domain/shared/result";
import { enforceRateLimits } from "@/server/use-cases/shared/enforce-rate-limits";
import { registerProfile } from "@/server/use-cases/shared/register-profile";

export type RegisterUserError =
  | "rate_limited"
  | "email_taken"
  | "weak_password"
  | "slug_unavailable"
  | "registration_closed"
  | "unexpected";

export type RegisterUserInput = { email: string; password: string; displayName: string; clientAddress: string };

/** `profileId` is absent when the e-mail still has to be confirmed: no profile exists yet. */
export type RegisterUser = (
  input: RegisterUserInput,
) => Promise<Result<{ profileId?: string; needsEmailConfirmation: boolean }, RegisterUserError>>;

/**
 * Rate limit (address) → GoTrue sign-up → membership and profile, only when GoTrue opened a session.
 * Idempotent by construction: GoTrue refuses a taken e-mail and `register_member` is idempotent per
 * account. GoTrue's own refusals (`rate_limited`, `registration_closed`) are propagated as they are.
 */
export function makeRegisterUser(deps: {
  auth: AuthGateway;
  registrar: ProfileRegistrar;
  ids: IdGenerator;
  rateLimiter: RateLimiter;
}): RegisterUser {
  return async (input) => {
    const limited = await enforceRateLimits(deps.rateLimiter, [{ scope: "signup", subject: input.clientAddress }]);
    if (!limited.ok) {
      return err(limited.error);
    }
    const signedUp = await deps.auth.signUp({ email: input.email, password: input.password });
    if (!signedUp.ok) {
      return err(signedUp.error);
    }
    // Without a session the caller is not authenticated (GoTrue answers a sign-up on an existing unconfirmed
    // account without proving anything): membership happens on the first confirmed sign-in (ensure-membership).
    if (!signedUp.value.sessionCreated) {
      return ok({ needsEmailConfirmation: true });
    }
    const registered = await registerProfile(deps, { userId: signedUp.value.userId, displayName: input.displayName });
    if (!registered.ok) {
      return err(registered.error);
    }
    return ok({ profileId: registered.value.profileId, needsEmailConfirmation: false });
  };
}
