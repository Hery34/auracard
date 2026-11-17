import type { OwnQrCode, QrCodeRepository } from "@/domain/qr/ports";
import { ok, type Result } from "@/domain/shared/result";

import { makeCallLog, scriptedResults, type CallLog } from "./call-log";
import { anOwnQrCode } from "./qr";

export type EnsureOwnResult = Result<OwnQrCode, "no_profile" | "unexpected">;
export type SetStyleResult = Result<OwnQrCode, "no_profile" | "invalid" | "unexpected">;

export type FakeQrCodeRepositoryOptions = {
  log?: CallLog;
  /** Answers in call order; the last one repeats. Defaults to `anOwnQrCode()`. */
  ensureResults?: readonly EnsureOwnResult[];
  /** Defaults to `anOwnQrCode()` carrying the submitted style. */
  setStyleResults?: readonly SetStyleResult[];
};

/** Logs `qrCodes.ensureOwn` and `qrCodes.setStyle` { fg, bg, logo }. */
export function fakeQrCodeRepository(options: FakeQrCodeRepositoryOptions = {}): QrCodeRepository {
  const log = options.log ?? makeCallLog();
  const nextEnsure = scriptedResults<EnsureOwnResult>(options.ensureResults, ok(anOwnQrCode()));
  const nextSetStyle =
    options.setStyleResults === undefined ? undefined : scriptedResults<SetStyleResult>(options.setStyleResults, ok(anOwnQrCode()));

  return {
    async ensureOwn() {
      log.record("qrCodes", "ensureOwn", undefined);
      return nextEnsure();
    },
    async setStyle(style) {
      log.record("qrCodes", "setStyle", style);
      return nextSetStyle === undefined ? ok(anOwnQrCode({ style })) : nextSetStyle();
    },
  };
}
