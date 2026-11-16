import type { ProfileRegistrar } from "@/domain/profile/ports";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

const UNIQUE_VIOLATION = "23505";
const RAISE_EXCEPTION = "P0001";

/**
 * `carnet.register_member` (ADR 0011, service_role). By construction of the SQL function, the only
 * unique constraint that can conflict is `profiles_slug_key`: every 23505 is a slug collision and the
 * message is never read. P0001 is the function's own exception (project inactive or unregistered).
 */
export function makeSupabaseProfileRegistrar(admin: CarnetClient): ProfileRegistrar {
  return {
    async register({ userId, displayName, slug }) {
      const { data, error } = await admin.rpc("register_member", {
        p_user_id: userId,
        p_display_name: displayName,
        p_slug: slug,
      });
      if (error !== null) {
        if (error.code === UNIQUE_VIOLATION) {
          return err("slug_taken");
        }
        if (error.code === RAISE_EXCEPTION) {
          return err("project_inactive");
        }
        logInfrastructureError("register_member", error.code);
        return err("unexpected");
      }
      if (typeof data !== "string") {
        logInfrastructureError("register_member", "no_profile_id");
        return err("unexpected");
      }
      return ok({ profileId: data });
    },
  };
}
