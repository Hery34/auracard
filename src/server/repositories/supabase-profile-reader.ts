import type { ProfileReader } from "@/domain/profile/ports";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/** `carnet.profiles` under the session of the server client: RLS `profiles_select_own` leaves at most the caller's row. */
export function makeSupabaseProfileReader(server: CarnetClient): ProfileReader {
  return {
    async getOwn() {
      const { data, error } = await server
        .from("profiles")
        .select("id, slug, display_name, is_published")
        .maybeSingle();
      if (error !== null) {
        logInfrastructureError("profiles.select_own", error.code);
        return err("unexpected");
      }
      if (data === null) {
        return ok(null);
      }
      return ok({ id: data.id, slug: data.slug, displayName: data.display_name, isPublished: data.is_published });
    },
  };
}
