import type { ProfileReader, ProfileWriter } from "@/domain/profile/ports";
import type { ProfileUpdate } from "@/domain/profile/profile";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, ok, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type UpdateProfileError = "unauthenticated" | "not_found" | "rate_limited" | "invalid_input" | "unexpected";

export type UpdateProfile = (update: ProfileUpdate) => Promise<Result<{ profileId: string; slug: string }, UpdateProfileError>>;

/** Full update of the caller's own profile; replayable (same update, same row). */
export function makeUpdateProfile(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  writer: ProfileWriter;
}): UpdateProfile {
  return async (update) => {
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    const { profileId, slug } = authorized.value;
    const written = await deps.writer.update(profileId, update);
    if (!written.ok) {
      return err(written.error);
    }
    return ok({ profileId, slug });
  };
}
