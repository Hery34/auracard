/**
 * Contract frozen by test-engineer (0019, decision 7: the cache tag is defined once).
 *
 * // src/server/cache-tags.ts
 * export function profileCacheTag(slug: string): string;
 * // `profile:<slug>`: the tag under which the public profile read is cached (cached-public-profile-reader) and the
 * // one the profile Server Actions expire with `updateTag` (actions/profile). No other module builds this string.
 */
import { describe, expect, it } from "vitest";

import { profileCacheTag } from "@/server/cache-tags";

describe("profileCacheTag", () => {
  it("decision 7: profile:<slug>", () => {
    expect(profileCacheTag("elodie-durand-merel")).toBe("profile:elodie-durand-merel");
  });

  it("two slugs → two distinct tags", () => {
    expect(profileCacheTag("jean-martin")).not.toBe(profileCacheTag("elodie-durand-merel"));
  });
});
