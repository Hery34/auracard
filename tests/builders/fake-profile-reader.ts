import type { ProfileReader } from "@/domain/profile/ports";
import { ok, type Result } from "@/domain/shared/result";

import { makeCallLog, scriptedResults, type CallLog } from "./call-log";
import { PROFILE_ID } from "./fake-registrar";

/** Shape fixed by the 0008 contract (`ProfileReader.getOwn`): a type mismatch here means the port drifted. */
export type OwnProfile = { id: string; slug: string; displayName: string; isPublished: boolean };

export type OwnProfileResult = Result<OwnProfile | null, "unexpected">;

export function anOwnProfile(overrides: Partial<OwnProfile> = {}): OwnProfile {
  return {
    id: PROFILE_ID,
    slug: "elodie-durand-merel",
    displayName: "Élodie Durand-Mérel",
    isPublished: false,
    ...overrides,
  };
}

export type FakeProfileReaderOptions = {
  log?: CallLog;
  /** Answers in call order; the last one repeats. Defaults to `anOwnProfile()`. */
  results?: readonly OwnProfileResult[];
};

export function fakeProfileReader(options: FakeProfileReaderOptions = {}): ProfileReader {
  const log = options.log ?? makeCallLog();
  const nextResult = scriptedResults<OwnProfileResult>(options.results, ok(anOwnProfile()));

  return {
    async getOwn() {
      log.record("profiles", "getOwn", undefined);
      return nextResult();
    },
  };
}
