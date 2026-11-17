import type { MediaFetcher } from "@/domain/profile/ports";

import { makeCallLog, type CallLog } from "./call-log";

export type FakeMediaFetcherOptions = {
  log?: CallLog;
  /** Bytes answered for any URL; `null` = refused, unavailable, too slow or too big. Defaults to `null`. */
  bytes?: Uint8Array | null;
};

/** Records the requested URL. */
export function fakeMediaFetcher(options: FakeMediaFetcherOptions = {}): MediaFetcher {
  const log = options.log ?? makeCallLog();
  const bytes = options.bytes ?? null;

  return {
    async fetch(url) {
      log.record("media", "fetch", url);
      return bytes;
    },
  };
}
