import { unstable_cache } from "next/cache";

import type { PublicProfileReader } from "@/domain/profile/ports";
import { err, ok } from "@/domain/shared/result";
import { profileCacheTag } from "@/server/cache-tags";

/** Thrown inside the cache scope so that a failed read is never stored. */
class ReadFailure extends Error {}

/**
 * Decorator: the published profile (or its absence) is cached under the tag `profile:<slug>`, the one the profile
 * actions expire with `updateTag`. `unstable_cache` rather than `"use cache"`: `cacheComponents` is not enabled.
 */
export function makeCachedPublicProfileReader(inner: PublicProfileReader): PublicProfileReader {
  return {
    async getBySlug(slug) {
      const read = unstable_cache(
        async () => {
          const result = await inner.getBySlug(slug);
          if (!result.ok) {
            throw new ReadFailure();
          }
          return result.value;
        },
        ["public-profile", slug],
        { tags: [profileCacheTag(slug)] },
      );
      try {
        return ok(await read());
      } catch (error) {
        if (error instanceof ReadFailure) {
          return err("unexpected");
        }
        throw error;
      }
    },
  };
}
