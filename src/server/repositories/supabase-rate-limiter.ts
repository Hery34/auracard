import { createHmac } from "node:crypto";

import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import type { RateLimitScope } from "@/domain/shared/rate-limits";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/** `<scope>:` + HMAC-SHA256 of `<scope>:<subject>` keyed by the secret: the database never sees an address or an e-mail. */
export function rateLimitKey(secret: string, scope: RateLimitScope, subject: string): string {
  return `${scope}:${createHmac("sha256", secret).update(`${scope}:${subject}`).digest("hex")}`;
}

/** `carnet.consume_rate_limit` (ADR 0011, service_role): fixed-window counter per hashed key. */
export function makeSupabaseRateLimiter(admin: CarnetClient, secret: string): RateLimiter {
  return {
    async consume({ scope, subject, limit, windowSeconds }) {
      const { data, error } = await admin.rpc("consume_rate_limit", {
        p_key: rateLimitKey(secret, scope, subject),
        p_limit: limit,
        p_window: `${windowSeconds} seconds`,
      });
      if (error !== null) {
        logInfrastructureError("consume_rate_limit", error.code);
        return err("unexpected");
      }
      return ok({ allowed: data === true });
    },
  };
}
