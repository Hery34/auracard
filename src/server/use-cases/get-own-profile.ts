import type { OwnProfile, ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import { err, ok, type Result } from "@/domain/shared/result";

export type GetOwnProfileError = "unauthenticated" | "unexpected";

export type GetOwnProfile = () => Promise<Result<{ profile: OwnProfile | null }, GetOwnProfileError>>;

/**
 * Session verified with GoTrue first, profile read second. An authenticated account without a profile
 * (cookie of an account of another project) is `ok({ profile: null })`: the page decides what to show.
 */
export function makeGetOwnProfile(deps: { auth: AuthGateway; profiles: ProfileReader }): GetOwnProfile {
  return async () => {
    const user = await deps.auth.currentUser();
    if (!user.ok) {
      return err("unexpected");
    }
    if (user.value === null) {
      return err("unauthenticated");
    }
    const profile = await deps.profiles.getOwn();
    if (!profile.ok) {
      return err("unexpected");
    }
    return ok({ profile: profile.value });
  };
}
