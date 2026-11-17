import type { CarnetAccountEraser } from "@/domain/account/ports";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/** `carnet.delete_own_account()` under the session of the server client: the caller (`auth.uid()`) only. */
export function makeSupabaseCarnetAccountEraser(server: CarnetClient): CarnetAccountEraser {
  return {
    async erase() {
      const { data, error } = await server.rpc("delete_own_account");
      if (error !== null) {
        logInfrastructureError("delete_own_account", error.code);
        return err("unexpected");
      }
      if (data !== null && typeof data !== "string") {
        logInfrastructureError("delete_own_account", "not_text");
        return err("unexpected");
      }
      return ok(data);
    },
  };
}
