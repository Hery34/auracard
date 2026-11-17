import { isLinkPlatform } from "@/domain/profile/link";
import type { PublicProfileReader } from "@/domain/profile/ports";
import type { PublicLink } from "@/domain/profile/profile";
import { publicMediaUrl } from "@/domain/profile/profile-image";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/**
 * `carnet.get_public_profile` + `carnet.get_public_links` (security definer, published profiles only) through the
 * cookie-less anonymous client. `theme` is not part of the public profile. Images: stored object names → public URLs
 * on `mediaOrigin`.
 */
export function makeSupabasePublicProfileReader(client: CarnetClient, mediaOrigin: string): PublicProfileReader {
  return {
    async getBySlug(slug) {
      const [profile, links] = await Promise.all([
        client.rpc("get_public_profile", { p_slug: slug }).maybeSingle(),
        client.rpc("get_public_links", { p_slug: slug }),
      ]);
      if (profile.error !== null) {
        logInfrastructureError("get_public_profile", profile.error.code);
        return err("unexpected");
      }
      if (links.error !== null) {
        logInfrastructureError("get_public_links", links.error.code);
        return err("unexpected");
      }
      if (profile.data === null) {
        return ok(null);
      }
      const publicLinks: PublicLink[] = [];
      for (const { platform, url, label, position } of links.data) {
        if (!isLinkPlatform(platform)) {
          logInfrastructureError("get_public_links", "unknown_platform");
          return err("unexpected");
        }
        publicLinks.push({ platform, url, label: label ?? null, position });
      }
      const row = profile.data;
      return ok({
        slug,
        displayName: row.display_name ?? "",
        jobTitle: row.job_title,
        company: row.company,
        bio: row.bio,
        avatarUrl: publicMediaUrl(mediaOrigin, row.avatar_url),
        bannerUrl: publicMediaUrl(mediaOrigin, row.banner_url),
        logoUrl: publicMediaUrl(mediaOrigin, row.logo_url),
        contactEmail: row.contact_email,
        phone: row.phone,
        websiteUrl: row.website_url,
        isIndexable: row.is_indexable === true,
        links: publicLinks,
      });
    },
  };
}
