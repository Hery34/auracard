import type { ProfileImageWriter } from "@/domain/profile/ports";
import type { ProfileImageKind } from "@/domain/profile/profile-image";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

const INSUFFICIENT_PRIVILEGE = "42501";

/**
 * `carnet.set_profile_image` as written in SQL (`null` clears the image, `null` when there was none): the generated
 * types declare neither the nullable argument nor the nullable result, so the client is viewed through this signature.
 */
type SetProfileImageClient = {
  rpc(
    fn: "set_profile_image",
    args: { p_kind: ProfileImageKind; p_object_name: string | null },
  ): PromiseLike<{ data: string | null; error: { code: string } | null }>;
};

/** `carnet.set_profile_image` under the session: the caller's own profile only; returns the previous object name. */
export function makeSupabaseProfileImageWriter(server: CarnetClient): ProfileImageWriter {
  const client = server as unknown as SetProfileImageClient;
  return {
    async set(kind, objectName) {
      const { data, error } = await client.rpc("set_profile_image", { p_kind: kind, p_object_name: objectName });
      if (error !== null) {
        if (error.code === INSUFFICIENT_PRIVILEGE) {
          return err("not_found");
        }
        logInfrastructureError("set_profile_image", error.code);
        return err("unexpected");
      }
      return ok({ previous: data });
    },
  };
}
