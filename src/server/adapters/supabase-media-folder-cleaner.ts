import type { MediaFolderCleaner } from "@/domain/account/ports";
import { MEDIA_BUCKET } from "@/domain/profile/profile-image";
import { err, ok } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

const PAGE_SIZE = 100;
const MAX_ROUNDS = 50;

/**
 * Storage API under the session of the caller: policies `carnet_media_*` decide (ADR 0011: never `service_role`).
 * Lists the first page of the folder and removes it until the folder lists empty. A round that removes nothing
 * (objects filtered out by the policies) fails instead of looping. Only the HTTP status is logged.
 */
export function makeSupabaseMediaFolderCleaner(server: CarnetClient): MediaFolderCleaner {
  const bucket = () => server.storage.from(MEDIA_BUCKET);

  return {
    async empty(profileId) {
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const listed = await bucket().list(profileId, { limit: PAGE_SIZE, offset: 0 });
        if (listed.error !== null) {
          logInfrastructureError("storage.list", listed.error.status?.toString());
          return err("unexpected");
        }
        const names = listed.data.filter((entry) => entry.id !== null).map((entry) => `${profileId}/${entry.name}`);
        if (names.length === 0) {
          return ok(undefined);
        }
        const removed = await bucket().remove(names);
        if (removed.error !== null) {
          logInfrastructureError("storage.remove", removed.error.status?.toString());
          return err("unexpected");
        }
        if (removed.data.length === 0) {
          logInfrastructureError("storage.remove", "no_progress");
          return err("unexpected");
        }
      }
      logInfrastructureError("storage.remove", "too_many_rounds");
      return err("unexpected");
    },
  };
}
