import type { PublicBookingPage, PublicBookingReader, PublicBusyRanges } from "@/domain/booking/ports";
import { err, ok } from "@/domain/shared/result";

import { aPublicBookingPage, BOOKING_SLUG } from "./booking";
import { makeCallLog, type CallLog } from "./call-log";

export type FakePublicBookingReaderOptions = {
  log?: CallLog;
  /** Published profiles; any other slug reads `null` (SQL null of the public functions). Default: [BOOKING_SLUG]. */
  published?: readonly string[];
  /** Page of every published slug. Default: `aPublicBookingPage()`. */
  page?: PublicBookingPage;
  /** Occupations of every published slug, returned whatever the requested range. Default: none. */
  busyRanges?: PublicBusyRanges;
  /** `page` fails with `err("unexpected")`. */
  failingPage?: boolean;
  /** `busyRanges` fails with `err("unexpected")`. */
  failingBusyRanges?: boolean;
  /** `busyRanges` reads `null`, as when the profile is unpublished between the two reads. */
  unpublishedBeforeBusyRanges?: boolean;
};

/** Stand-in of the public reads of 0036 (anonymous client): records every call with its arguments. */
export function fakePublicBookingReader(options: FakePublicBookingReaderOptions = {}): PublicBookingReader {
  const log = options.log ?? makeCallLog();
  const published = options.published ?? [BOOKING_SLUG];
  const page = options.page ?? aPublicBookingPage();
  const busyRanges = options.busyRanges ?? { busy: [], extra: [] };

  return {
    async page(slug) {
      log.record("pages", "page", slug);
      if (options.failingPage === true) {
        return err("unexpected");
      }
      return ok(published.includes(slug) ? page : null);
    },
    async busyRanges(slug, range) {
      log.record("pages", "busyRanges", { slug, range });
      if (options.failingBusyRanges === true) {
        return err("unexpected");
      }
      if (options.unpublishedBeforeBusyRanges === true || !published.includes(slug)) {
        return ok(null);
      }
      return ok(busyRanges);
    },
  };
}
