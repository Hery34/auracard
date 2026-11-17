import type { InstanceAccountRemover } from "@/domain/account/ports";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

const USER_NOT_FOUND = "user_not_found";

/**
 * `service_role` client injected by the container (ADR 0011, amendment of 17/11/2026): the instance account is removed
 * only when no project membership is left. Never the message of Postgres or GoTrue in the logs.
 */
export function makeSupabaseInstanceAccountRemover(admin: CarnetClient): InstanceAccountRemover {
  return {
    async isOrphan(userId) {
      const { data, error } = await admin.rpc("is_orphan_account", { p_user_id: userId });
      if (error !== null) {
        logInfrastructureError("is_orphan_account", error.code);
        return err("unexpected");
      }
      if (typeof data !== "boolean") {
        logInfrastructureError("is_orphan_account", "not_boolean");
        return err("unexpected");
      }
      return ok(data);
    },

    async remove(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error === null || error.code === USER_NOT_FOUND || error.status === 404) {
        return ok(undefined);
      }
      logInfrastructureError("auth.admin.deleteUser", error.code ?? error.status?.toString());
      return err("unexpected");
    },
  };
}
