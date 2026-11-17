import type { NfcTagRepository } from "@/domain/nfc/ports";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, ok, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type ReleaseNfcTagError = "unauthenticated" | "not_found" | "rate_limited" | "unexpected";

export type ReleaseNfcTag = (tagId: string) => Promise<Result<void, ReleaseNfcTagError>>;

/**
 * Puts one of the caller's tags back in stock. Nothing released (replay, absent or someone else's tag) is a success
 * too: idempotent, and no oracle on the tags of others.
 */
export function makeReleaseNfcTag(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  tags: NfcTagRepository;
}): ReleaseNfcTag {
  return async (tagId) => {
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    const released = await deps.tags.release(tagId);
    if (!released.ok) {
      return err(released.error === "not_member" ? "not_found" : "unexpected");
    }
    return ok(undefined);
  };
}
