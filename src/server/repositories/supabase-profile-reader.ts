import type { ProfileReader } from "@/domain/profile/ports";
import { publicMediaUrl } from "@/domain/profile/profile-image";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

const OWN_PROFILE_COLUMNS =
  "id, slug, display_name, job_title, company, bio, contact_email, phone, website_url, is_published, is_indexable, avatar_url, banner_url, logo_url";

/**
 * `carnet.profiles` under the session of the server client: RLS `profiles_select_own` leaves at most the caller's row.
 * Images: stored object names → public URLs on `mediaOrigin`.
 */
export function makeSupabaseProfileReader(server: CarnetClient, mediaOrigin: string): ProfileReader {
  return {
    async getOwn() {
      const { data, error } = await server.from("profiles").select(OWN_PROFILE_COLUMNS).maybeSingle();
      if (error !== null) {
        logInfrastructureError("profiles.select_own", error.code);
        return err("unexpected");
      }
      if (data === null) {
        return ok(null);
      }
      return ok({
        id: data.id,
        slug: data.slug,
        displayName: data.display_name,
        jobTitle: data.job_title,
        company: data.company,
        bio: data.bio,
        contactEmail: data.contact_email,
        phone: data.phone,
        websiteUrl: data.website_url,
        isPublished: data.is_published,
        isIndexable: data.is_indexable,
        avatarUrl: publicMediaUrl(mediaOrigin, data.avatar_url),
        bannerUrl: publicMediaUrl(mediaOrigin, data.banner_url),
        logoUrl: publicMediaUrl(mediaOrigin, data.logo_url),
      });
    },
  };
}
