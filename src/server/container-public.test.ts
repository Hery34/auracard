/**
 * Wiring of `createPublicContainer` (0018 / 0019): one cached public reader shared by the profile page and the vCard;
 * the `service_role` client and the rate limiter exist only once `downloadVCard` is called.
 * Only the ports (Supabase clients and adapters) and Next.js are replaced; use cases and the cache decorator are real.
 *
 * Contract frozen by test-engineer (0019, decision 7):
 * // src/server/container.ts
 * export type DownloadVCardFromRequest =
 *   (slug: string, headers: Headers) => Promise<Result<VCardFile | null, RateLimitError>>;
 * export type PublicContainer = { getPublicProfile: GetPublicProfile; downloadVCard: DownloadVCardFromRequest };
 * // The route handler passes `request.headers`; the address is computed by `requestClientAddress(headers)`. The
 * // container never imports `next/headers` (nor `cookies()`). `getVCard` is no longer exposed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";

import { stubValidEnv } from "../../tests/builders/env";
import { makeCallLog } from "../../tests/builders/call-log";
import { fakePublicProfileReader } from "../../tests/builders/fake-public-profile-reader";
import { fakeRateLimiter } from "../../tests/builders/fake-rate-limiter";

type CacheOptions = { tags: string[] };

const SLUG = "elodie-durand-merel";
const CLIENT_ADDRESS = "203.0.113.7";
/** What a `next/headers` read would give: never the subject of the rate limit. */
const AMBIENT_ADDRESS = "198.51.100.99";

function requestHeaders(): Headers {
  return new Headers({ "x-forwarded-for": CLIENT_ADDRESS });
}

const mocks = vi.hoisted(() => ({
  cacheCalls: [] as { keyParts: string[]; options: CacheOptions }[],
  stored: new Map<string, unknown>(),
  adminClient: { client: "admin" },
  publicClient: { client: "public" },
  createAdminClient: vi.fn(),
  createPublicSupabaseClient: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  makeSupabasePublicProfileReader: vi.fn(),
  makeSupabaseRateLimiter: vi.fn(),
  makeCachedPublicProfileReader: vi.fn(),
  headers: vi.fn(),
  nextHeadersLoaded: false,
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    (callback: () => Promise<unknown>, keyParts: string[], options: CacheOptions) => async () => {
      mocks.cacheCalls.push({ keyParts, options });
      const key = keyParts.join("/");
      if (!mocks.stored.has(key)) {
        mocks.stored.set(key, await callback());
      }
      return mocks.stored.get(key);
    },
}));

vi.mock("next/headers", () => {
  mocks.nextHeadersLoaded = true;
  return {
    headers: async () => {
      mocks.headers();
      return new Headers({ "x-forwarded-for": AMBIENT_ADDRESS });
    },
    cookies: async () => {
      throw new Error("cookies() read by the public container");
    },
  };
});

vi.mock("@/server/infrastructure/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/server/infrastructure/supabase/public", () => ({
  createPublicSupabaseClient: mocks.createPublicSupabaseClient,
}));
vi.mock("@/server/infrastructure/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/server/repositories/supabase-public-profile-reader", () => ({
  makeSupabasePublicProfileReader: mocks.makeSupabasePublicProfileReader,
}));
vi.mock("@/server/repositories/supabase-rate-limiter", () => ({
  makeSupabaseRateLimiter: mocks.makeSupabaseRateLimiter,
}));
vi.mock("@/server/repositories/cached-public-profile-reader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/cached-public-profile-reader")>();
  mocks.makeCachedPublicProfileReader.mockImplementation(actual.makeCachedPublicProfileReader);
  return { makeCachedPublicProfileReader: mocks.makeCachedPublicProfileReader };
});

let createPublicContainer: typeof import("@/server/container").createPublicContainer;
let log = makeCallLog();

beforeAll(async () => {
  stubValidEnv({ SITE_URL: "https://carnet.example" });
  ({ createPublicContainer } = await import("@/server/container"));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  mocks.cacheCalls.length = 0;
  mocks.stored.clear();
  log = makeCallLog();
  mocks.createAdminClient.mockReset().mockReturnValue(mocks.adminClient);
  mocks.createPublicSupabaseClient.mockReset().mockReturnValue(mocks.publicClient);
  mocks.createServerSupabaseClient.mockReset();
  mocks.headers.mockReset();
  mocks.makeCachedPublicProfileReader.mockClear();
  mocks.makeSupabasePublicProfileReader.mockReset().mockImplementation(() => fakePublicProfileReader({ log }));
  mocks.makeSupabaseRateLimiter
    .mockReset()
    .mockImplementation((): RateLimiter => fakeRateLimiter({ log }));
});

describe("createPublicContainer — wiring", () => {
  it("decision 7: exposes getPublicProfile and downloadVCard only (getVCard retired)", () => {
    expect(Object.keys(createPublicContainer()).sort()).toStrictEqual(["downloadVCard", "getPublicProfile"]);
  });

  it("decision 7: the container never loads next/headers (the route hands the request headers)", async () => {
    const container = createPublicContainer();
    await container.getPublicProfile(SLUG);
    await container.downloadVCard(SLUG, requestHeaders());

    expect(mocks.nextHeadersLoaded).toBe(false);
    expect(mocks.headers).not.toHaveBeenCalled();
  });

  it("getPublicProfile reads through the cached reader with the tag profile:<slug>", async () => {
    const container = createPublicContainer();

    const result = await container.getPublicProfile(SLUG);

    expect(result.ok && result.value?.slug).toBe(SLUG);
    expect(mocks.cacheCalls.map((call) => call.options.tags)).toStrictEqual([[`profile:${SLUG}`]]);
    expect(log.inputsOf("publicProfiles", "getBySlug")).toStrictEqual([SLUG]);
  });

  it("downloadVCard shares the same cached reader as getPublicProfile", async () => {
    const container = createPublicContainer();

    await container.getPublicProfile(SLUG);
    const vcard = await container.downloadVCard(SLUG, requestHeaders());

    expect(vcard.ok && vcard.value?.fileName).toBe(`${SLUG}.vcf`);
    expect(mocks.makeCachedPublicProfileReader).toHaveBeenCalledTimes(1);
    expect(mocks.makeSupabasePublicProfileReader).toHaveBeenCalledTimes(1);
    expect(mocks.makeSupabasePublicProfileReader).toHaveBeenCalledWith(mocks.publicClient);
    expect(mocks.cacheCalls.map((call) => call.options.tags)).toStrictEqual([
      [`profile:${SLUG}`],
      [`profile:${SLUG}`],
    ]);
    expect(log.inputsOf("publicProfiles", "getBySlug")).toStrictEqual([SLUG]);
  });

  it("builds the vCard profile URL from SITE_URL", async () => {
    const vcard = await createPublicContainer().downloadVCard(SLUG, requestHeaders());

    expect(vcard.ok && vcard.value?.content).toContain(`https://carnet.example/p/${SLUG}`);
  });

  it("does not create the service_role client nor the rate limiter before downloadVCard", async () => {
    const container = createPublicContainer();
    await container.getPublicProfile(SLUG);

    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.makeSupabaseRateLimiter).not.toHaveBeenCalled();
    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("decision 7: downloadVCard(slug, headers) creates the service_role client, limits on the address of the given headers, then reads the cached profile", async () => {
    const container = createPublicContainer();

    const vcard = await container.downloadVCard(SLUG, requestHeaders());

    expect(vcard.ok && vcard.value?.fileName).toBe(`${SLUG}.vcf`);
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
    expect(mocks.makeSupabaseRateLimiter).toHaveBeenCalledWith(mocks.adminClient, expect.any(String));
    expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "publicProfiles.getBySlug"]);
    expect(log.inputsOf("rateLimiter", "consume")).toMatchObject([{ scope: "vcard", subject: CLIENT_ADDRESS }]);
    expect(mocks.cacheCalls.map((call) => call.options.tags)).toStrictEqual([[`profile:${SLUG}`]]);
    expect(mocks.makeCachedPublicProfileReader).toHaveBeenCalledTimes(1);
  });

  it("decision 7: two requests, two address headers → two distinct subjects", async () => {
    const container = createPublicContainer();

    await container.downloadVCard(SLUG, new Headers({ "x-forwarded-for": "203.0.113.7" }));
    await container.downloadVCard(SLUG, new Headers({ "x-forwarded-for": "203.0.113.8" }));

    expect(log.inputsOf("rateLimiter", "consume")).toMatchObject([
      { scope: "vcard", subject: "203.0.113.7" },
      { scope: "vcard", subject: "203.0.113.8" },
    ]);
  });
});
