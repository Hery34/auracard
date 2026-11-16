import type { MembershipReader } from "@/domain/profile/ports";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/** `carnet.is_member()` evaluated under the session carried by the server client. */
export function makeSupabaseMembershipReader(server: CarnetClient): MembershipReader {
  return {
    async isMember() {
      const { data, error } = await server.rpc("is_member");
      if (error !== null) {
        logInfrastructureError("is_member", error.code);
        return err("unexpected");
      }
      return ok(data === true);
    },
  };
}
