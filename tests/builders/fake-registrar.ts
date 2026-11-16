import type { ProfileRegistrar, RegistrarError } from "@/domain/profile/ports";
import { ok, type Result } from "@/domain/shared/result";

import { makeCallLog, scriptedResults, type CallLog } from "./call-log";

export const PROFILE_ID = "c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

export type RegisterResult = Result<{ profileId: string }, RegistrarError>;

export type FakeRegistrarOptions = {
  log?: CallLog;
  /** Answers in call order; the last one repeats. Defaults to a successful registration. */
  results?: readonly RegisterResult[];
};

export function fakeRegistrar(options: FakeRegistrarOptions = {}): ProfileRegistrar {
  const log = options.log ?? makeCallLog();
  const nextResult = scriptedResults<RegisterResult>(options.results, ok({ profileId: PROFILE_ID }));

  return {
    async register(input) {
      log.record("registrar", "register", input);
      return nextResult();
    },
  };
}
