import type { LeadRepository } from "@/domain/lead/ports";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/**
 * `carnet.leads` under the session (RLS `leads_select_own`, `leads_delete_own`). Keyset pagination on
 * (created_at, id); the cursor values are validated by `decodeLeadCursor` before reaching the filter.
 */
export function makeSupabaseLeadRepository(server: CarnetClient): LeadRepository {
  return {
    async listOwn(profileId, { before, limit }) {
      let query = server.from("leads").select("id, name, email, message, created_at").eq("profile_id", profileId);
      if (before !== null) {
        const at = `"${before.createdAt}"`;
        query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${before.id})`);
      }
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (error !== null) {
        logInfrastructureError("leads.select_own", error.code);
        return err("unexpected");
      }
      return ok(data.map(({ id, name, email, message, created_at }) => ({ id, name, email, message, createdAt: created_at })));
    },
    async deleteOwn(profileId, leadId) {
      const { error } = await server.from("leads").delete().eq("id", leadId).eq("profile_id", profileId);
      if (error !== null) {
        logInfrastructureError("leads.delete_own", error.code);
        return err("unexpected");
      }
      return ok(undefined);
    },
  };
}
