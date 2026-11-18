import type { LeadCapturer } from "@/domain/lead/ports";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/** Raised by `capture_lead` for an unknown, unpublished or refusing profile. */
const NO_DATA_FOUND = "P0002";

/** `carnet.capture_lead` (ADR 0011, service_role): lead and outbox event in one transaction, idempotent by key. */
export function makeSupabaseLeadCapturer(admin: CarnetClient): LeadCapturer {
  return {
    async capture({ slug, name, email, message, idempotencyKey, deviceClass }) {
      const { data, error } = await admin.rpc("capture_lead", {
        p_slug: slug,
        p_name: name,
        p_email: email,
        p_message: message,
        p_idempotency_key: idempotencyKey,
        p_device_class: deviceClass,
      });
      if (error !== null) {
        if (error.code === NO_DATA_FOUND) {
          return err("not_found");
        }
        logInfrastructureError("capture_lead", error.code);
        return err("unexpected");
      }
      return ok({ leadId: data });
    },
  };
}
