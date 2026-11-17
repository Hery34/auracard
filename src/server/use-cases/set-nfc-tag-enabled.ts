import type { NfcTagRepository } from "@/domain/nfc/ports";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, ok, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type SetNfcTagEnabledError = "unauthenticated" | "not_found" | "rate_limited" | "unexpected";

export type SetNfcTagEnabled = (input: { tagId: string; enabled: boolean }) => Promise<Result<void, SetNfcTagEnabledError>>;

/** Disables or enables one of the caller's tags; replayable (already in the target state → success). */
export function makeSetNfcTagEnabled(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  tags: NfcTagRepository;
}): SetNfcTagEnabled {
  return async ({ tagId, enabled }) => {
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    const found = await deps.tags.setEnabled(tagId, enabled);
    if (!found.ok) {
      return err(found.error === "not_member" ? "not_found" : "unexpected");
    }
    return found.value ? ok(undefined) : err("not_found");
  };
}
