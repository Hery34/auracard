import type { RateLimitScope } from "@/domain/shared/rate-limits";
import type { Result } from "@/domain/shared/result";

export type RateLimitConsumption = {
  scope: RateLimitScope;
  subject: string;
  limit: number;
  windowSeconds: number;
};

export interface RateLimiter {
  /** Consumes one unit of the counter `scope`/`subject`; refusals are counted too. */
  consume(input: RateLimitConsumption): Promise<Result<{ allowed: boolean }, "unexpected">>;
}
