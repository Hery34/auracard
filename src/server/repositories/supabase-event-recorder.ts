import type { EventRecorder } from "@/domain/analytics/ports";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/** `carnet.record_public_event` (ADR 0011, service_role; fiche 0034): the slug is resolved by SQL, never the table. */
export function makeSupabaseEventRecorder(admin: CarnetClient): EventRecorder {
  return {
    async record({ id, slug, type, source, linkId, deviceClass }) {
      const { error } = await admin.rpc("record_public_event", {
        p_id: id,
        p_slug: slug,
        p_type: type,
        p_source: source,
        // The generator types every argument without default as non-null; the SQL function accepts null.
        p_link_id: linkId as string,
        p_device_class: deviceClass,
      });
      if (error !== null) {
        logInfrastructureError("record_public_event", error.code);
        return err("unexpected");
      }
      return ok(undefined);
    },
  };
}
