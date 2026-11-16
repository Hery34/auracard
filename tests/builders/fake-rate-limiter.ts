import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import type { RateLimitScope } from "@/domain/shared/rate-limits";
import { err, ok } from "@/domain/shared/result";

import { makeCallLog, type CallLog } from "./call-log";

export type FakeRateLimiterOptions = {
  log?: CallLog;
  /** Scopes whose counter is exhausted: `consume` answers `allowed: false` for them. */
  deny?: readonly RateLimitScope[];
  /** When true, every call fails with `err("unexpected")` (storage unavailable). */
  failing?: boolean;
};

export function fakeRateLimiter(options: FakeRateLimiterOptions = {}): RateLimiter {
  const log = options.log ?? makeCallLog();
  const deny = options.deny ?? [];

  return {
    async consume(input) {
      log.record("rateLimiter", "consume", input);
      if (options.failing === true) {
        return err("unexpected");
      }
      return ok({ allowed: !deny.includes(input.scope) });
    },
  };
}
