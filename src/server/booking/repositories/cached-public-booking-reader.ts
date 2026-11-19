import { unstable_cache } from "next/cache";

import type { PublicBookingReader } from "@/domain/booking/ports";
import { err, ok } from "@/domain/shared/result";
import { profileCacheTag } from "@/server/cache-tags";

/** Thrown inside the cache scope so that a failed read is never stored. */
class ReadFailure extends Error {}

/**
 * Decorator: the public booking page (or its absence) is cached under the tag `profile:<slug>`, expired by the
 * profile and booking settings actions. Occupations are never cached (read live by the slot list).
 */
export function makeCachedPublicBookingReader(inner: PublicBookingReader): PublicBookingReader {
  return {
    async page(slug) {
      const read = unstable_cache(
        async () => {
          const result = await inner.page(slug);
          if (!result.ok) {
            throw new ReadFailure();
          }
          return result.value;
        },
        ["public-booking-page", slug],
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
    busyRanges: (slug, range) => inner.busyRanges(slug, range),
  };
}
