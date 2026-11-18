import type { EventRecorder } from "@/domain/analytics/ports";
import { err, ok } from "@/domain/shared/result";

import { makeCallLog, type CallLog } from "./call-log";

export type FakeEventRecorderOptions = { log?: CallLog; failing?: boolean };

/** Logs `events.record` with the event; `failing` answers `err("unexpected")` (database unavailable). */
export function fakeEventRecorder(options: FakeEventRecorderOptions = {}): EventRecorder {
  const log = options.log ?? makeCallLog();
  return {
    async record(event) {
      log.record("events", "record", event);
      return options.failing === true ? err("unexpected") : ok(undefined);
    },
  };
}
