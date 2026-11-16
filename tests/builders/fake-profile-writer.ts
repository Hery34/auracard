import type { ProfileWriteError, ProfileWriter } from "@/domain/profile/ports";
import { ok, type Result } from "@/domain/shared/result";

import { makeCallLog, scriptedResults, type CallLog } from "./call-log";

export type ProfileWriteResult = Result<void, ProfileWriteError>;

export type FakeProfileWriterOptions = {
  log?: CallLog;
  /** Answers in call order; the last one repeats. Defaults to a successful update. */
  results?: readonly ProfileWriteResult[];
};

/** Records `{ profileId, update }` for each call. */
export function fakeProfileWriter(options: FakeProfileWriterOptions = {}): ProfileWriter {
  const log = options.log ?? makeCallLog();
  const nextResult = scriptedResults<ProfileWriteResult>(options.results, ok(undefined));

  return {
    async update(profileId, update) {
      log.record("writer", "update", { profileId, update });
      return nextResult();
    },
  };
}
