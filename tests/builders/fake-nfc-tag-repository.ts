import type { ActivationOutcome, OwnNfcTag } from "@/domain/nfc/nfc-tag";
import type { NfcTagRepository, NfcTagRepositoryError } from "@/domain/nfc/ports";
import { ok, type Result } from "@/domain/shared/result";

import { makeCallLog, scriptedResults, type CallLog } from "./call-log";

export type ActivateResult = Result<ActivationOutcome, NfcTagRepositoryError>;
export type ListOwnResult = Result<OwnNfcTag[], "unexpected">;
export type FoundResult = Result<boolean, NfcTagRepositoryError>;

export type FakeNfcTagRepositoryOptions = {
  log?: CallLog;
  /** Answers in call order; the last one repeats. Defaults to `activated`. */
  activateResults?: readonly ActivateResult[];
  /** Defaults to `[]`. */
  listResults?: readonly ListOwnResult[];
  /** `true`: the caller's tag was found. Defaults to `true`. */
  setEnabledResults?: readonly FoundResult[];
  /** `true`: released now; `false`: absent, someone else's, or already in stock. Defaults to `true`. */
  releaseResults?: readonly FoundResult[];
};

/** Logs `nfcTags.activate` { uid, code }, `nfcTags.listOwn`, `nfcTags.setEnabled` { tagId, enabled }, `nfcTags.release` tagId. */
export function fakeNfcTagRepository(options: FakeNfcTagRepositoryOptions = {}): NfcTagRepository {
  const log = options.log ?? makeCallLog();
  const nextActivate = scriptedResults<ActivateResult>(options.activateResults, ok("activated"));
  const nextList = scriptedResults<ListOwnResult>(options.listResults, ok([]));
  const nextSetEnabled = scriptedResults<FoundResult>(options.setEnabledResults, ok(true));
  const nextRelease = scriptedResults<FoundResult>(options.releaseResults, ok(true));

  return {
    async activate(uid, code) {
      log.record("nfcTags", "activate", { uid, code });
      return nextActivate();
    },
    async listOwn() {
      log.record("nfcTags", "listOwn", undefined);
      return nextList();
    },
    async setEnabled(tagId, enabled) {
      log.record("nfcTags", "setEnabled", { tagId, enabled });
      return nextSetEnabled();
    },
    async release(tagId) {
      log.record("nfcTags", "release", tagId);
      return nextRelease();
    },
  };
}
