import type { MembershipReader } from "@/domain/profile/ports";
import { ok, type Result } from "@/domain/shared/result";

import { makeCallLog, scriptedResults, type CallLog } from "./call-log";

export type MembershipResult = Result<boolean, "unexpected">;

export type FakeMembershipReaderOptions = {
  log?: CallLog;
  /** Answers in call order; the last one repeats. Defaults to "not a member". */
  results?: readonly MembershipResult[];
};

export function fakeMembershipReader(options: FakeMembershipReaderOptions = {}): MembershipReader {
  const log = options.log ?? makeCallLog();
  const nextResult = scriptedResults<MembershipResult>(options.results, ok(false));

  return {
    async isMember() {
      log.record("membership", "isMember", undefined);
      return nextResult();
    },
  };
}
