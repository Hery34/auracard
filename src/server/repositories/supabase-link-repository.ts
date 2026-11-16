import { isLinkPlatform, type SavedLink } from "@/domain/profile/link";
import type { LinkRepository, ProfileWriteError } from "@/domain/profile/ports";
import { err, ok, type Result } from "@/domain/shared/result";
import { logInfrastructureError } from "@/server/infrastructure/logger";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";

/** SQLSTATEs raised by `carnet.replace_links` (0016, decision 8). */
const REPLACE_ERRORS: ReadonlyMap<string, ProfileWriteError> = new Map([
  ["42501", "not_found"],
  ["22023", "invalid_input"],
  ["23514", "invalid_input"],
]);

type LinkRow = { id: string; platform: string; url: string; label: string | null; position: number };

/** `carnet.links` under the session of the server client (RLS `links_*_own`, `replace_links` security invoker). */
export function makeSupabaseLinkRepository(server: CarnetClient): LinkRepository {
  return {
    async replace(profileId, links) {
      const { data, error } = await server.rpc("replace_links", {
        p_profile_id: profileId,
        p_links: links.map(({ id, platform, url, label }) =>
          id === undefined ? { platform, url, label } : { id, platform, url, label },
        ),
      });
      if (error !== null) {
        const mapped = REPLACE_ERRORS.get(error.code);
        if (mapped !== undefined) {
          return err(mapped);
        }
        logInfrastructureError("replace_links", error.code);
        return err("unexpected");
      }
      return toSavedLinks("replace_links", data);
    },

    async listOwn(profileId) {
      const { data, error } = await server
        .from("links")
        .select("id, platform, url, label, position")
        .eq("profile_id", profileId)
        .order("position");
      if (error !== null) {
        logInfrastructureError("links.select_own", error.code);
        return err("unexpected");
      }
      return toSavedLinks("links.select_own", data);
    },
  };
}

/** `links_platform_check` guarantees the platform; a row outside the list means the schema drifted. */
function toSavedLinks(source: string, rows: readonly LinkRow[]): Result<SavedLink[], "unexpected"> {
  const saved: SavedLink[] = [];
  for (const { id, platform, url, label, position } of rows) {
    if (!isLinkPlatform(platform)) {
      logInfrastructureError(source, "unknown_platform");
      return err("unexpected");
    }
    saved.push({ id, platform, url, label, position });
  }
  return ok(saved);
}
