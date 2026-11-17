import type { ProfileImageWriteError, ProfileImageWriter } from "@/domain/profile/ports";
import type { ProfileImageKind } from "@/domain/profile/profile-image";
import { err, ok } from "@/domain/shared/result";

import { makeCallLog, type CallLog } from "./call-log";

export type FakeProfileImageWriterOptions = {
  log?: CallLog;
  /** Object names stored in `avatar_url`, `banner_url`, `logo_url` before the test (absent → null). */
  current?: Partial<Record<ProfileImageKind, string | null>>;
  /** When set, every call fails with this error and nothing changes (as `set_profile_image` raising). */
  failWith?: ProfileImageWriteError;
};

export type FakeProfileImageWriter = ProfileImageWriter & {
  /** Current reference of each kind, as `carnet.profiles` would hold it. */
  readonly current: Readonly<Record<ProfileImageKind, string | null>>;
};

/** Stateful stand-in of `carnet.set_profile_image`: stores the new name, returns the previous one. Records `{ kind, objectName }`. */
export function fakeProfileImageWriter(options: FakeProfileImageWriterOptions = {}): FakeProfileImageWriter {
  const log = options.log ?? makeCallLog();
  const current: Record<ProfileImageKind, string | null> = {
    avatar: null,
    banner: null,
    logo: null,
    ...options.current,
  };

  return {
    current,
    async set(kind, objectName) {
      log.record("images", "set", { kind, objectName });
      if (options.failWith !== undefined) {
        return err(options.failWith);
      }
      const previous = current[kind];
      current[kind] = objectName;
      return ok({ previous });
    },
  };
}
