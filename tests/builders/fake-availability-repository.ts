import type { AvailabilityException, AvailabilityRule } from "@/domain/booking/availability";
import type { AvailabilityRepository, ExceptionWriteError, RulesWriteError } from "@/domain/booking/ports";
import type { TimeZone } from "@/domain/booking/time-zone";
import { ok, type Result } from "@/domain/shared/result";

import { zone } from "./booking-slots";
import { makeCallLog, scriptedResults, type CallLog } from "./call-log";

type TimeZoneResult = Result<TimeZone, "not_found" | "unexpected">;
type SetTimeZoneResult = Result<void, "not_found" | "invalid_input" | "unexpected">;
type RulesResult = Result<AvailabilityRule[], "unexpected">;
type ReplaceResult = Result<AvailabilityRule[], RulesWriteError>;
type ExceptionsResult = Result<AvailabilityException[], "unexpected">;
type AddResult = Result<AvailabilityException, ExceptionWriteError>;
type RemoveResult = Result<void, "unexpected">;

export type FakeAvailabilityRepositoryOptions = {
  log?: CallLog;
  /** Defaults to `ok(zone("Europe/Paris"))` (the default of `carnet.profiles.time_zone`). */
  timeZone?: readonly TimeZoneResult[];
  setTimeZone?: readonly SetTimeZoneResult[];
  rules?: readonly RulesResult[];
  /** Defaults to the replacement list echoed back. */
  replaceRules?: readonly ReplaceResult[];
  exceptions?: readonly ExceptionsResult[];
  /** Defaults to the added exception echoed back. */
  addException?: readonly AddResult[];
  removeException?: readonly RemoveResult[];
};

/** Records every call as `availability.<method>` with its arguments. */
export function fakeAvailabilityRepository(options: FakeAvailabilityRepositoryOptions = {}): AvailabilityRepository {
  const log = options.log ?? makeCallLog();
  const nextTimeZone = scriptedResults<TimeZoneResult>(options.timeZone, ok(zone("Europe/Paris")));
  const nextSetTimeZone = scriptedResults<SetTimeZoneResult>(options.setTimeZone, ok(undefined));
  const nextRules = scriptedResults<RulesResult>(options.rules, ok([]));
  const nextReplace = options.replaceRules === undefined ? null : scriptedResults<ReplaceResult>(options.replaceRules, ok([]));
  const nextExceptions = scriptedResults<ExceptionsResult>(options.exceptions, ok([]));
  const nextAdd = options.addException === undefined ? null : scriptedResults<AddResult>(options.addException, ok(null as never));
  const nextRemove = scriptedResults<RemoveResult>(options.removeException, ok(undefined));

  return {
    async getTimeZone(profileId) {
      log.record("availability", "getTimeZone", { profileId });
      return nextTimeZone();
    },
    async setTimeZone(profileId, timeZone) {
      log.record("availability", "setTimeZone", { profileId, timeZone });
      return nextSetTimeZone();
    },
    async listRules(profileId) {
      log.record("availability", "listRules", { profileId });
      return nextRules();
    },
    async replaceRules(profileId, rules) {
      log.record("availability", "replaceRules", { profileId, rules });
      return nextReplace === null ? ok([...rules]) : nextReplace();
    },
    async listUpcomingExceptions(profileId, now) {
      log.record("availability", "listUpcomingExceptions", { profileId, now: now.toISOString() });
      return nextExceptions();
    },
    async addException(profileId, exception) {
      log.record("availability", "addException", { profileId, exception });
      return nextAdd === null ? ok(exception) : nextAdd();
    },
    async removeException(profileId, id) {
      log.record("availability", "removeException", { profileId, id });
      return nextRemove();
    },
  };
}
