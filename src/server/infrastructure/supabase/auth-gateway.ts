import { isAuthRetryableFetchError, type AuthError } from "@supabase/supabase-js";

import type { AuthGateway, SignInError, SignUpError } from "@/domain/shared/ports/auth-gateway";
import { err, ok, type Result } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/** GoTrue error codes of `/signup`. Confirmations disabled: a taken e-mail is refused with `user_already_exists`. */
const SIGN_UP_ERRORS: ReadonlyMap<string, SignUpError> = new Map([
  ["user_already_exists", "email_taken"],
  // Same condition on GoTrue's other paths (admin, e-mail change): mapped for safety, not expected on sign-up.
  ["email_exists", "email_taken"],
  ["weak_password", "weak_password"],
  ["over_request_rate_limit", "rate_limited"],
  ["over_email_send_rate_limit", "rate_limited"],
  ["signup_disabled", "registration_closed"],
]);

/** GoTrue error codes of `/token?grant_type=password`; `email_not_confirmed` comes only after a valid password. */
const SIGN_IN_ERRORS: ReadonlyMap<string, SignInError> = new Map([
  ["invalid_credentials", "invalid_credentials"],
  ["email_not_confirmed", "email_not_confirmed"],
  ["over_request_rate_limit", "rate_limited"],
]);

export function makeSupabaseAuthGateway(server: CarnetClient): AuthGateway {
  return {
    async signUp({ email, password }) {
      const { data, error } = await server.auth.signUp({ email, password });
      if (error !== null) {
        const mapped = SIGN_UP_ERRORS.get(error.code ?? "");
        return mapped === undefined ? unexpected("auth.signUp", error) : err(mapped);
      }
      if (data.user === null) {
        return unexpected("auth.signUp", undefined);
      }
      // Confirmations enabled: GoTrue answers an obfuscated user without identities for a taken e-mail.
      if ((data.user.identities ?? []).length === 0) {
        return err("email_taken");
      }
      return ok({ userId: data.user.id, sessionCreated: data.session !== null });
    },

    async signIn({ email, password }) {
      const { data, error } = await server.auth.signInWithPassword({ email, password });
      if (error !== null) {
        const mapped = SIGN_IN_ERRORS.get(error.code ?? "");
        return mapped === undefined ? unexpected("auth.signIn", error) : err(mapped);
      }
      return ok({ userId: data.user.id });
    },

    async signOut() {
      // Local scope only: a global sign-out would end the account's sessions on the other projects of the shared instance (ADR 0002).
      const { error } = await server.auth.signOut({ scope: "local" });
      return error === null ? ok(undefined) : unexpected("auth.signOut", error);
    },

    async currentUser() {
      const { data, error } = await server.auth.getUser();
      if (error !== null) {
        // GoTrue answered (session missing, expired or rejected): no authenticated user.
        return isAuthRetryableFetchError(error) ? unexpected("auth.getUser", error) : ok(null);
      }
      return ok({ userId: data.user.id, email: data.user.email ?? "" });
    },
  };
}

function unexpected(source: string, error: AuthError | undefined): Result<never, "unexpected"> {
  logInfrastructureError(source, error?.code);
  return err("unexpected");
}
