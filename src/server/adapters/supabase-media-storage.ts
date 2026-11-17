import type { MediaStorage } from "@/domain/profile/ports";
import { MEDIA_BUCKET } from "@/domain/profile/profile-image";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/**
 * Storage API under the session of the caller: policies `carnet_media_*` decide (ADR 0011: never `service_role`).
 * Only the HTTP status is logged: the message of Storage can carry the object name.
 */
export function makeSupabaseMediaStorage(server: CarnetClient): MediaStorage {
  const bucket = () => server.storage.from(MEDIA_BUCKET);

  return {
    async upload({ objectName, bytes, contentType }) {
      const { error } = await bucket().upload(objectName, bytes, { contentType, upsert: false });
      if (error !== null) {
        logInfrastructureError("storage.upload", error.status?.toString());
        return err("unexpected");
      }
      return ok(undefined);
    },
    async remove(objectName) {
      const { error } = await bucket().remove([objectName]);
      if (error !== null) {
        logInfrastructureError("storage.remove", error.status?.toString());
        return err("unexpected");
      }
      return ok(undefined);
    },
  };
}

