import { parseHttpsUrl } from "@/domain/profile/https-url";
import type { MediaFetcher, PublicProfileReader } from "@/domain/profile/ports";
import type { PublicProfile } from "@/domain/profile/profile";
import { detectImageFormat } from "@/domain/profile/profile-image";
import { parseSlug, type Slug } from "@/domain/profile/slug";
import { serializeVCard, type VCardPhoto } from "@/domain/profile/vcard";
import { ok, type Result } from "@/domain/shared/result";

export type VCardFile = { fileName: string; content: string };

export type GetVCard = (slug: string) => Promise<Result<VCardFile | null, "unexpected">>;

/**
 * No session. An invalid or reserved slug answers like an unpublished profile, without any read.
 * `profileUrl` is built from the configured origin, never from the request (the profile read is cached).
 * `websiteUrl` is checked again: the row may have been written directly through PostgREST.
 * The avatar is read on every download; its type comes from its bytes. Unavailable → no PHOTO.
 */
export function makeGetVCard(deps: {
  publicProfiles: PublicProfileReader;
  profileUrl: (slug: Slug) => string;
  avatars: MediaFetcher;
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
      content: serializeVCard(safeProfile, {
        profileUrl: deps.profileUrl(slug.value),
        photo: await avatarPhoto(deps.avatars, profile.value),
      }),
    });
  };
}

async function avatarPhoto(avatars: MediaFetcher, profile: PublicProfile): Promise<VCardPhoto | null> {
  if (profile.avatarUrl === null) {
    return null;
  }
  const bytes = await avatars.fetch(profile.avatarUrl);
  if (bytes === null) {
    return null;
  }
  const format = detectImageFormat(bytes);
  return format === null ? null : { format, bytes };
}
