import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeCachedPublicProfileReader } from "@/server/repositories/cached-public-profile-reader";

import { makeCallLog } from "../../../tests/builders/call-log";
import { aPublicProfile, fakePublicProfileReader } from "../../../tests/builders/fake-public-profile-reader";
import { aSlug } from "../../../tests/builders/slug";

type Options = { tags: string[] };

const cache = vi.hoisted(() => ({
  calls: [] as { keyParts: string[]; options: Options }[],
  stored: new Map<string, unknown>(),
  profileCacheTag: vi.fn(),
}));

// 0019, decision 7: the real profileCacheTag, observed — the decorator must use it rather than its own string.
vi.mock("@/server/cache-tags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/cache-tags")>();
  cache.profileCacheTag.mockImplementation(actual.profileCacheTag);
  return { profileCacheTag: cache.profileCacheTag };
});

// Minimal stand-in of unstable_cache: one entry per key, a thrown error is not stored.
vi.mock("next/cache", () => ({
  unstable_cache:
    (callback: () => Promise<unknown>, keyParts: string[], options: Options) => async () => {
      cache.calls.push({ keyParts, options });
      const key = keyParts.join("/");
      if (!cache.stored.has(key)) {
        cache.stored.set(key, await callback());
      }
      return cache.stored.get(key);
    },
}));

beforeEach(() => {
  cache.calls.length = 0;
  cache.stored.clear();
  cache.profileCacheTag.mockClear();
});

describe("makeCachedPublicProfileReader", () => {
  it("caches the read under the tag profile:<slug>, keyed by the slug", async () => {
    const log = makeCallLog();
    const profile = aPublicProfile();
    const reader = makeCachedPublicProfileReader(fakePublicProfileReader({ log, results: [ok(profile)] }));

    expect(await reader.getBySlug(aSlug(profile.slug))).toStrictEqual(ok(profile));
    expect(await reader.getBySlug(aSlug(profile.slug))).toStrictEqual(ok(profile));

    expect(cache.calls.map((call) => call.options.tags)).toStrictEqual([
      ["profile:elodie-durand-merel"],
      ["profile:elodie-durand-merel"],
    ]);
    expect(cache.calls[0]?.keyParts).toContain("elodie-durand-merel");
    expect(log.inputsOf("publicProfiles", "getBySlug")).toStrictEqual(["elodie-durand-merel"]);
  });

  it("0019 decision 7: the tag is profileCacheTag(slug) of src/server/cache-tags, the one the profile actions expire", async () => {
    const reader = makeCachedPublicProfileReader(fakePublicProfileReader());

    await reader.getBySlug(aSlug("elodie-durand-merel"));

    expect(cache.profileCacheTag).toHaveBeenCalledWith("elodie-durand-merel");
    expect(cache.calls[0]?.options.tags).toStrictEqual([cache.profileCacheTag.mock.results[0]?.value]);
  });

  it("an unpublished profile (null) is cached like a published one", async () => {
    const log = makeCallLog();
    const reader = makeCachedPublicProfileReader(fakePublicProfileReader({ log, results: [ok(null)] }));

    expect(await reader.getBySlug(aSlug("jean-martin"))).toStrictEqual(ok(null));
    expect(await reader.getBySlug(aSlug("jean-martin"))).toStrictEqual(ok(null));

    expect(log.inputsOf("publicProfiles", "getBySlug")).toStrictEqual(["jean-martin"]);
  });

  it("two slugs → distinct keys and tags, no collision: each one is read once and keeps its own answer", async () => {
    const log = makeCallLog();
    const profile = aPublicProfile();
    const reader = makeCachedPublicProfileReader(fakePublicProfileReader({ log, results: [ok(profile), ok(null)] }));

    expect(await reader.getBySlug(aSlug(profile.slug))).toStrictEqual(ok(profile));
    expect(await reader.getBySlug(aSlug("jean-martin"))).toStrictEqual(ok(null));
    expect(await reader.getBySlug(aSlug(profile.slug))).toStrictEqual(ok(profile));
    expect(await reader.getBySlug(aSlug("jean-martin"))).toStrictEqual(ok(null));

    expect(log.inputsOf("publicProfiles", "getBySlug")).toStrictEqual(["elodie-durand-merel", "jean-martin"]);
    const [first, second] = cache.calls;
    expect(first?.options.tags).toStrictEqual(["profile:elodie-durand-merel"]);
    expect(second?.options.tags).toStrictEqual(["profile:jean-martin"]);
    expect(first?.keyParts.join("/")).not.toBe(second?.keyParts.join("/"));
  });

  it("a failed read → err('unexpected') and is never stored: the next request reads again", async () => {
    const log = makeCallLog();
    const profile = aPublicProfile();
    const reader = makeCachedPublicProfileReader(
      fakePublicProfileReader({ log, results: [err("unexpected"), ok(profile)] }),
    );

    expect(await reader.getBySlug(aSlug(profile.slug))).toStrictEqual(err("unexpected"));
    expect(await reader.getBySlug(aSlug(profile.slug))).toStrictEqual(ok(profile));
    expect(log.inputsOf("publicProfiles", "getBySlug")).toHaveLength(2);
  });
});
