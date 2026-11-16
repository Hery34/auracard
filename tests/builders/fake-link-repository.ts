import type { SavedLink } from "@/domain/profile/link";
import type { LinkRepository, ProfileWriteError } from "@/domain/profile/ports";
import { ok, type Result } from "@/domain/shared/result";

import { makeCallLog, scriptedResults, type CallLog } from "./call-log";
import { aSavedLink } from "./links";

export type ReplaceResult = Result<SavedLink[], ProfileWriteError>;

export type ListOwnResult = Result<SavedLink[], "unexpected">;

export type FakeLinkRepositoryOptions = {
  log?: CallLog;
  /** Answers of `replace` in call order; the last one repeats. Defaults to one saved link. */
  results?: readonly ReplaceResult[];
  /** Answers of `listOwn` in call order; the last one repeats. Defaults to one saved link. */
  listResults?: readonly ListOwnResult[];
};

/** Records `{ profileId, links }` for each `replace` and `{ profileId }` for each `listOwn`. */
export function fakeLinkRepository(options: FakeLinkRepositoryOptions = {}): LinkRepository {
  const log = options.log ?? makeCallLog();
  const nextResult = scriptedResults<ReplaceResult>(options.results, ok([aSavedLink()]));
  const nextList = scriptedResults<ListOwnResult>(options.listResults, ok([aSavedLink()]));

  return {
    async replace(profileId, links) {
      log.record("links", "replace", { profileId, links });
      return nextResult();
    },
    async listOwn(profileId) {
      log.record("links", "listOwn", { profileId });
      return nextList();
    },
  };
}
