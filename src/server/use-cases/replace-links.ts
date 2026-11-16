import type { Link, SavedLink } from "@/domain/profile/link";
import type { LinkRepository, ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, ok, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type ReplaceLinksError = "unauthenticated" | "not_found" | "rate_limited" | "invalid_input" | "unexpected";

export type ReplaceLinks = (
  links: readonly Link[],
) => Promise<Result<{ profileId: string; slug: string; links: SavedLink[] }, ReplaceLinksError>>;

/** Full ordered list of the caller's links (`carnet.replace_links`, replayable); the stored ids go back to the editor. */
export function makeReplaceLinks(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  links: LinkRepository;
}): ReplaceLinks {
  return async (links) => {
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error);
    }
    const { profileId, slug } = authorized.value;
    const saved = await deps.links.replace(profileId, links);
    if (!saved.ok) {
      return err(saved.error);
    }
    return ok({ profileId, slug, links: saved.value });
  };
}
