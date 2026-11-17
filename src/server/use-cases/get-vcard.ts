import { parseHttpsUrl } from "@/domain/profile/https-url";
import type { PublicProfileReader } from "@/domain/profile/ports";
import { parseSlug, type Slug } from "@/domain/profile/slug";
import { serializeVCard } from "@/domain/profile/vcard";
import { ok, type Result } from "@/domain/shared/result";

export type VCardFile = { fileName: string; content: string };

export type GetVCard = (slug: string) => Promise<Result<VCardFile | null, "unexpected">>;

/**
 * No session. An invalid or reserved slug answers like an unpublished profile, without any read.
 * `profileUrl` is built from the configured origin, never from the request (the profile read is cached).
 * `websiteUrl` is checked again: the row may have been written directly through PostgREST.
 */
export function makeGetVCard(deps: {
  publicProfiles: PublicProfileReader;
  profileUrl: (slug: Slug) => string;
}): GetVCard {
  return async (text) => {
    const slug = parseSlug(text);
    if (!slug.ok) {
      return ok(null);
    }
    const profile = await deps.publicProfiles.getBySlug(slug.value);
    if (!profile.ok) {
      return profile;
    }
    if (profile.value === null) {
      return ok(null);
    }
    const websiteUrl = profile.value.websiteUrl;
    const safeProfile = {
      ...profile.value,
      websiteUrl: websiteUrl !== null && parseHttpsUrl(websiteUrl).ok ? websiteUrl : null,
    };
    return ok({
      fileName: `${slug.value}.vcf`,
      content: serializeVCard(safeProfile, { profileUrl: deps.profileUrl(slug.value) }),
    });
  };
}
