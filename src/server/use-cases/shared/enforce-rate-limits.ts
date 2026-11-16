import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { RATE_LIMITS, type RateLimitScope } from "@/domain/shared/rate-limits";
import { err, ok, type Result } from "@/domain/shared/result";

export type RateLimitError = "rate_limited" | "unexpected";

export type Counter = { scope: RateLimitScope; subject: string };

/** Consumes one unit of each counter in order; the first exhausted one refuses. A failing limiter closes the door. */
export async function enforceRateLimits(
  rateLimiter: RateLimiter,
  counters: readonly Counter[],
): Promise<Result<void, RateLimitError>> {
  for (const { scope, subject } of counters) {
    const result = await rateLimiter.consume({ scope, subject, ...RATE_LIMITS[scope] });
    if (!result.ok) {
      return err("unexpected");
    }
    if (!result.value.allowed) {
      return err("rate_limited");
    }
  }
  return ok(undefined);
}
