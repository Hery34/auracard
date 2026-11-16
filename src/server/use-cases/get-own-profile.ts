import type { SavedLink } from "@/domain/profile/link";
import type { LinkRepository, OwnProfile, ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import { err, ok, type Result } from "@/domain/shared/result";

export type GetOwnProfileError = "unauthenticated" | "unexpected";

export type GetOwnProfile = () => Promise<
  Result<{ profile: OwnProfile | null; links: SavedLink[] }, GetOwnProfileError>
>;

/**
 * Session verified with GoTrue first, profile read second, its links third. An authenticated account without a
 * profile (cookie of an account of another project) is `ok({ profile: null, links: [] })`: the page decides what to show.
 */
export function makeGetOwnProfile(deps: {
  auth: AuthGateway;
  profiles: ProfileReader;
  links: LinkRepository;
}): GetOwnProfile {
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
    if (profile.value === null) {
      return ok({ profile: null, links: [] });
    }
    const links = await deps.links.listOwn(profile.value.id);
    if (!links.ok) {
      return err("unexpected");
    }
    return ok({ profile: profile.value, links: links.value });
  };
}
