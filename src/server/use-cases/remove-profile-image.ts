import type { MediaStorage, ProfileImageWriter, ProfileReader } from "@/domain/profile/ports";
import type { ProfileImageKind } from "@/domain/profile/profile-image";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, ok, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type RemoveProfileImageError = "unauthenticated" | "not_found" | "rate_limited" | "unexpected";

export type RemoveProfileImage = (
  kind: ProfileImageKind,
) => Promise<Result<{ profileId: string; slug: string }, RemoveProfileImageError>>;

/** Clears the reference, then removes the previous file; replayable (nothing left to remove the second time). */
export function makeRemoveProfileImage(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  storage: MediaStorage;
  images: ProfileImageWriter;
}): RemoveProfileImage {
  return async (kind) => {
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    const cleared = await deps.images.set(kind, null);
    if (!cleared.ok) {
      return err(cleared.error);
    }
    if (cleared.value.previous !== null) {
      await deps.storage.remove(cleared.value.previous);
    }
    return ok(authorized.value);
  };
}
