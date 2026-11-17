import type { NfcResolution } from "@/domain/nfc/nfc-tag";
import type { NfcTagResolver, QrCodeResolver } from "@/domain/nfc/ports";
import { ok, type Result } from "@/domain/shared/result";

import { makeCallLog, scriptedResults, type CallLog } from "./call-log";

export type NfcResolutionResult = Result<NfcResolution, "unexpected">;
export type QrResolutionResult = Result<string | null, "unexpected">;

export type FakeNfcTagResolverOptions = {
  log?: CallLog | undefined;
  /** Answers in call order; the last one repeats. Defaults to `not_found`. */
  results?: readonly NfcResolutionResult[] | undefined;
};

export function fakeNfcTagResolver(options: FakeNfcTagResolverOptions = {}): NfcTagResolver {
  const log = options.log ?? makeCallLog();
  const nextResult = scriptedResults<NfcResolutionResult>(options.results, ok({ state: "not_found" }));

  return {
    async resolve(uid) {
      log.record("nfcTags", "resolve", uid);
      return nextResult();
    },
  };
}

export type FakeQrCodeResolverOptions = {
  log?: CallLog | undefined;
  /** Slug of the published profile or `null`; answers in call order, the last one repeats. Defaults to `null`. */
  results?: readonly QrResolutionResult[] | undefined;
};

export function fakeQrCodeResolver(options: FakeQrCodeResolverOptions = {}): QrCodeResolver {
  const log = options.log ?? makeCallLog();
  const nextResult = scriptedResults<QrResolutionResult>(options.results, ok(null));

  return {
    async resolve(code) {
      log.record("qrCodes", "resolve", code);
      return nextResult();
    },
  };
}
