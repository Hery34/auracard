import type { ProfileWriter } from "@/domain/profile/ports";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

const CHECK_VIOLATION = "23514";

/** Full update of `carnet.profiles` under the session: RLS `profiles_update_own` hides any row but the caller's. */
export function makeSupabaseProfileWriter(server: CarnetClient): ProfileWriter {
  return {
    async update(profileId, update) {
      const { data, error } = await server
        .from("profiles")
        .update({
          display_name: update.displayName,
          job_title: update.jobTitle,
          company: update.company,
          bio: update.bio,
          contact_email: update.contactEmail,
          phone: update.phone,
          website_url: update.websiteUrl,
          is_published: update.isPublished,
          is_indexable: update.isIndexable,
          accepts_leads: update.acceptsLeads,
        })
        .eq("id", profileId)
        .select("id");
      if (error !== null) {
        if (error.code === CHECK_VIOLATION) {
          return err("invalid_input");
        }
        logInfrastructureError("profiles.update_own", error.code);
        return err("unexpected");
      }
      return data.length === 0 ? err("not_found") : ok(undefined);
    },
  };
}
