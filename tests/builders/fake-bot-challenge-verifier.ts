import type { BotChallengeVerifier } from "@/domain/shared/ports/bot-challenge-verifier";
import { err, ok } from "@/domain/shared/result";

import { makeCallLog, type CallLog } from "./call-log";

export type FakeBotChallengeVerifierOptions = {
  log?: CallLog;
  /** `passed` (default), `failed` (token refused by the provider) or `unavailable` (provider unreachable). */
  outcome?: "passed" | "failed" | "unavailable";
  /** The cData the token was issued for (0032, decision 14): any other `expectedCData` is refused. Default: any. */
  passingCData?: readonly string[];
  /** Like Cloudflare (0032, decision 14): a token already verified is refused on any later call. Default: false. */
  singleUseTokens?: boolean;
};

/** Implementation of the port for the unit tests (ADR 0008): the provider is never called. */
export function fakeBotChallengeVerifier(options: FakeBotChallengeVerifierOptions = {}): BotChallengeVerifier {
  const log = options.log ?? makeCallLog();
  const outcome = options.outcome ?? "passed";
  const spent = new Set<string>();

  return {
    async verify(input) {
      log.record("challenge", "verify", input);
      if (outcome === "unavailable") {
        return err("unavailable");
      }
      const boundElsewhere = options.passingCData !== undefined && !options.passingCData.includes(input.expectedCData);
      const replayed = options.singleUseTokens === true && spent.has(input.token);
      spent.add(input.token);
      return ok({ passed: outcome === "passed" && !boundElsewhere && !replayed });
    },
  };
}
