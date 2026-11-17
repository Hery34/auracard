import type { ProfileReader } from "@/domain/profile/ports";
import { ok, type Result } from "@/domain/shared/result";

import { makeCallLog, scriptedResults, type CallLog } from "./call-log";
import { PROFILE_ID } from "./fake-registrar";

/**
 * Shape fixed by the 0017 contract (decision 9, extends 0008): every editable field of `carnet.profiles` as stored,
 * plus `id` and `slug`; 0021: the public URLs of the three images (built by the reader). A type mismatch here means
 * the port drifted.
 */
export type OwnProfile = {
  id: string;
  slug: string;
  displayName: string;
  jobTitle: string | null;
  company: string | null;
  bio: string | null;
  contactEmail: string | null;
  phone: string | null;
  websiteUrl: string | null;
  isPublished: boolean;
  isIndexable: boolean;
  avatarUrl: string | null;
  bannerUrl: string | null;
  logoUrl: string | null;
};

export type OwnProfileResult = Result<OwnProfile | null, "unexpected">;

/** Defaults to the profile as `register_member` creates it: display name and slug only, unpublished, no image. */
export function anOwnProfile(overrides: Partial<OwnProfile> = {}): OwnProfile {
  return {
    id: PROFILE_ID,
    slug: "elodie-durand-merel",
    displayName: "Élodie Durand-Mérel",
    jobTitle: null,
    company: null,
    bio: null,
    contactEmail: null,
    phone: null,
    websiteUrl: null,
    isPublished: false,
    isIndexable: false,
    avatarUrl: null,
    bannerUrl: null,
    logoUrl: null,
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
