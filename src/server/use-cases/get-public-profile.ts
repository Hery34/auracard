import type { PublicProfileReader } from "@/domain/profile/ports";
import type { PublicProfile } from "@/domain/profile/profile";
import { parseSlug } from "@/domain/profile/slug";
import { ok, type Result } from "@/domain/shared/result";

export type GetPublicProfile = (slug: string) => Promise<Result<PublicProfile | null, "unexpected">>;

/** No session. An invalid or reserved slug answers like an unpublished profile, without any read. */
export function makeGetPublicProfile(deps: { publicProfiles: PublicProfileReader }): GetPublicProfile {
  return async (text) => {
    const slug = parseSlug(text);
    if (!slug.ok) {
      return ok(null);
    }
    return deps.publicProfiles.getBySlug(slug.value);
  };
}
