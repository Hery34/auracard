import type { PublicProfile } from "@/domain/profile/profile";
import type { PublicProfileReader } from "@/domain/profile/ports";
import { ok, type Result } from "@/domain/shared/result";

import { makeCallLog, scriptedResults, type CallLog } from "./call-log";

export function aPublicProfile(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    slug: "elodie-durand-merel",
    displayName: "Élodie Durand-Mérel",
    jobTitle: "Architecte d'intérieur",
    company: "Atelier Mérel",
    bio: null,
    avatarUrl: null,
    bannerUrl: null,
    logoUrl: null,
    contactEmail: null,
    phone: null,
    websiteUrl: "https://atelier-merel.example/",
    isIndexable: false,
    links: [
      {
        id: "6a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
        platform: "linkedin",
        url: "https://www.linkedin.com/in/elodie-durand-merel",
        label: null,
        position: 0,
      },
      {
        id: "7b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e",
        platform: "website",
        url: "https://atelier-merel.example/",
        label: "Mon atelier",
        position: 1,
      },
    ],
    ...overrides,
  };
}

export type PublicProfileResult = Result<PublicProfile | null, "unexpected">;

export type FakePublicProfileReaderOptions = {
  log?: CallLog;
  /** Answers in call order; the last one repeats. Defaults to `aPublicProfile()`. */
  results?: readonly PublicProfileResult[];
};

export function fakePublicProfileReader(options: FakePublicProfileReaderOptions = {}): PublicProfileReader {
  const log = options.log ?? makeCallLog();
  const nextResult = scriptedResults<PublicProfileResult>(options.results, ok(aPublicProfile()));

  return {
    async getBySlug(slug) {
      log.record("publicProfiles", "getBySlug", slug);
      return nextResult();
    },
  };
}
