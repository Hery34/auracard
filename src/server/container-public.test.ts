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
 *
 * 0021 (decisions 5 and 6): the public reader receives the Supabase origin (`makeSupabasePublicProfileReader(client,
 * env.NEXT_PUBLIC_SUPABASE_URL)`); the vCard reads the avatar through `makeMediaFetcher({ supabaseUrl:
 * env.NEXT_PUBLIC_SUPABASE_URL, fetch: globalThis.fetch, timeoutMs: MEDIA_FETCH_TIMEOUT_MS, maxBytes: MEDIA_FETCH_MAX_BYTES })`.
 *
 * 0025 (decisions 1 to 4): PublicContainer gains `resolveNfcTag: ResolveNfcTag` and `resolveQrCode: ResolveQrCode`,
 * built on `makeSupabaseNfcTagResolver(createPublicSupabaseClient())` and `makeSupabaseQrCodeResolver(<same>)`:
 * cookie-less anonymous client, never the service_role client, no rate limiter, no cache (every scan is read live).
 *
 * 0029 (decisions 3, 4, 6, 7, 9): PublicContainer gains `recordBeaconEvent: RecordBeaconFromRequest` and
 * `recordServerEvent: RecordServerEventFromRequest`, built on demand (like downloadVCard): the service_role client
 * feeds `makeSupabaseEventRecorder(admin)` and `makeSupabaseRateLimiter(admin, RATE_LIMIT_SECRET)` (beacon 300/h,
 * scan 60/h). The user-agent is `headers.get("user-agent")`, the address `requestClientAddress(headers)`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { ok } from "@/domain/shared/result";

import { stubValidEnv, VALID_ENV } from "../../tests/builders/env";
import { makeCallLog } from "../../tests/builders/call-log";
import { fakeMediaFetcher } from "../../tests/builders/fake-media-fetcher";
import { fakeNfcTagResolver, fakeQrCodeResolver } from "../../tests/builders/fake-nfc-tag-resolver";
import { QR_CODE, TAG_UID } from "../../tests/builders/nfc";
import { aPublicProfile, fakePublicProfileReader } from "../../tests/builders/fake-public-profile-reader";
import { imageBytes } from "../../tests/builders/images";
import { fakeRateLimiter } from "../../tests/builders/fake-rate-limiter";
import { EVENT_ID, IPHONE_USER_AGENT, PREVIEW_BOT_USER_AGENT } from "../../tests/builders/analytics";
import { fakeEventRecorder } from "../../tests/builders/fake-event-recorder";

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
  makeMediaFetcher: vi.fn(),
  makeSupabaseNfcTagResolver: vi.fn(),
  makeSupabaseQrCodeResolver: vi.fn(),
  makeSupabaseEventRecorder: vi.fn(),
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

vi.mock("@/server/repositories/supabase-nfc-tag-resolver", () => ({
  makeSupabaseNfcTagResolver: mocks.makeSupabaseNfcTagResolver,
}));
vi.mock("@/server/repositories/supabase-qr-code-resolver", () => ({
  makeSupabaseQrCodeResolver: mocks.makeSupabaseQrCodeResolver,
}));

vi.mock("@/server/repositories/supabase-event-recorder", () => ({
  makeSupabaseEventRecorder: mocks.makeSupabaseEventRecorder,
}));

vi.mock("@/server/adapters/media-fetcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/adapters/media-fetcher")>();
  return { ...actual, makeMediaFetcher: mocks.makeMediaFetcher };
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
  mocks.makeMediaFetcher.mockReset().mockImplementation(() => fakeMediaFetcher({ log, bytes: imageBytes("jpeg") }));
  mocks.makeSupabaseNfcTagResolver
    .mockReset()
    .mockImplementation(() => fakeNfcTagResolver({ log, results: [ok({ state: "active", slug: SLUG })] }));
  mocks.makeSupabaseQrCodeResolver.mockReset().mockImplementation(() => fakeQrCodeResolver({ log, results: [ok(SLUG)] }));
  mocks.makeSupabaseEventRecorder.mockReset().mockImplementation(() => fakeEventRecorder({ log }));
});

describe("createPublicContainer — wiring", () => {
  it("decision 7, 0025, 0029, 0032: exposes getPublicProfile, downloadVCard, resolveNfcTag, resolveQrCode, recordBeaconEvent, recordServerEvent and captureLead only", () => {
    expect(Object.keys(createPublicContainer()).sort()).toStrictEqual([
      "captureLead",
      "downloadVCard",
      "getPublicProfile",
      "recordBeaconEvent",
      "recordServerEvent",
      "resolveNfcTag",
      "resolveQrCode",
    ]);
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
    expect(mocks.makeSupabasePublicProfileReader).toHaveBeenCalledWith(mocks.publicClient, VALID_ENV.NEXT_PUBLIC_SUPABASE_URL);
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

  it("0021 decision 5: the public reader builds the image URLs from NEXT_PUBLIC_SUPABASE_URL", () => {
    createPublicContainer();

    expect(mocks.makeSupabasePublicProfileReader).toHaveBeenCalledWith(mocks.publicClient, VALID_ENV.NEXT_PUBLIC_SUPABASE_URL);
  });

  it("0021 decision 6: the vCard reads the avatar through the media fetcher bound to the Supabase origin, 3 s and 1 MiB", async () => {
    const avatarUrl = `${VALID_ENV.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/carnet-media/c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f/avatar-1a2b3c4d-0000-4000-8000-000000000001.jpg`;
    mocks.makeSupabasePublicProfileReader.mockImplementation(() =>
      fakePublicProfileReader({ log, results: [ok(aPublicProfile({ slug: SLUG, avatarUrl }))] }),
    );

    const vcard = await createPublicContainer().downloadVCard(SLUG, requestHeaders());

    expect(mocks.makeMediaFetcher).toHaveBeenCalledWith({
      supabaseUrl: VALID_ENV.NEXT_PUBLIC_SUPABASE_URL,
      fetch: expect.any(Function),
      timeoutMs: 3000,
      maxBytes: 1024 * 1024,
    });
    expect(log.inputsOf("media", "fetch")).toStrictEqual([avatarUrl]);
    expect(vcard.ok && vcard.value?.content).toContain("PHOTO;ENCODING=b;TYPE=JPEG:");
  });
});

describe("createPublicContainer — NFC and QR resolution (0025)", () => {
  it("resolveNfcTag reads through the cookie-less anonymous client: no service_role, no limiter, no cache, no headers", async () => {
    const result = await createPublicContainer().resolveNfcTag(TAG_UID);

    expect(result).toStrictEqual(ok({ state: "active", slug: SLUG }));
    expect(mocks.makeSupabaseNfcTagResolver).toHaveBeenCalledWith(mocks.publicClient);
    expect(log.inputsOf("nfcTags", "resolve")).toStrictEqual([TAG_UID]);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.makeSupabaseRateLimiter).not.toHaveBeenCalled();
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.cacheCalls).toStrictEqual([]);
    expect(mocks.headers).not.toHaveBeenCalled();
  });

  it("resolveQrCode reads through the same cookie-less anonymous client: no service_role, no limiter, no cache", async () => {
    const result = await createPublicContainer().resolveQrCode(QR_CODE);

    expect(result).toStrictEqual(ok(SLUG));
    expect(mocks.makeSupabaseQrCodeResolver).toHaveBeenCalledWith(mocks.publicClient);
    expect(log.inputsOf("qrCodes", "resolve")).toStrictEqual([QR_CODE]);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.makeSupabaseRateLimiter).not.toHaveBeenCalled();
    expect(mocks.cacheCalls).toStrictEqual([]);
  });

  it("each scan is read live: resolving the same uid twice reads the database twice", async () => {
    const container = createPublicContainer();

    await container.resolveNfcTag(TAG_UID);
    await container.resolveNfcTag(TAG_UID);

    expect(log.inputsOf("nfcTags", "resolve")).toStrictEqual([TAG_UID, TAG_UID]);
  });

  it("a malformed uid never reaches the resolver", async () => {
    expect(await createPublicContainer().resolveNfcTag("../admin")).toStrictEqual(ok({ state: "not_found" }));
    expect(log.inputsOf("nfcTags", "resolve")).toStrictEqual([]);
  });
});

describe("createPublicContainer — statistics (0029)", () => {
  const BEACON = { slug: SLUG, id: EVENT_ID, type: "profile_view", source: "nfc", linkId: null };

  function visitorHeaders(userAgent: string = IPHONE_USER_AGENT): Headers {
    return new Headers({ "x-forwarded-for": CLIENT_ADDRESS, "user-agent": userAgent });
  }

  it("decision 7: no service_role client nor recorder before a recording (static rendering of the page untouched)", async () => {
    const container = createPublicContainer();
    await container.getPublicProfile(SLUG);
    await container.resolveNfcTag(TAG_UID);

    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.makeSupabaseEventRecorder).not.toHaveBeenCalled();
  });

  it("decisions 6 and 7: recordBeaconEvent limits on the address of the headers (beacon, 300/h), then writes through the service_role recorder", async () => {
    const result = await createPublicContainer().recordBeaconEvent(BEACON, visitorHeaders());

    expect(result).toStrictEqual(ok("recorded"));
    expect(mocks.makeSupabaseEventRecorder).toHaveBeenCalledWith(mocks.adminClient);
    expect(mocks.makeSupabaseRateLimiter).toHaveBeenCalledWith(mocks.adminClient, VALID_ENV.RATE_LIMIT_SECRET);
    expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "events.record"]);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([
      { scope: "beacon", subject: CLIENT_ADDRESS, limit: 300, windowSeconds: 3600 },
    ]);
    expect(log.inputsOf("events", "record")).toStrictEqual([
      { id: EVENT_ID, slug: SLUG, type: "profile_view", source: "nfc", linkId: null, deviceClass: "mobile" },
    ]);
  });

  it("criterion 3: recordBeaconEvent with a link-preview user-agent → ignored, nothing consumed nor written", async () => {
    const result = await createPublicContainer().recordBeaconEvent(BEACON, visitorHeaders(PREVIEW_BOT_USER_AGENT));

    expect(result).toStrictEqual(ok("ignored"));
    expect(log.sequence()).toStrictEqual([]);
  });

  it("decisions 3, 7 and 9: recordServerEvent limits on the address of the headers (scan, 60/h), then writes nfc_scan through the service_role recorder", async () => {
    const result = await createPublicContainer().recordServerEvent({ slug: SLUG, type: "nfc_scan" }, visitorHeaders());

    expect(result).toStrictEqual(ok("recorded"));
    expect(mocks.makeSupabaseEventRecorder).toHaveBeenCalledWith(mocks.adminClient);
    expect(mocks.makeSupabaseRateLimiter).toHaveBeenCalledWith(mocks.adminClient, VALID_ENV.RATE_LIMIT_SECRET);
    expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "events.record"]);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([
      { scope: "scan", subject: CLIENT_ADDRESS, limit: 60, windowSeconds: 3600 },
    ]);
    expect(log.inputsOf("events", "record")).toMatchObject([
      { slug: SLUG, type: "nfc_scan", source: "nfc", linkId: null, deviceClass: "mobile" },
    ]);
  });

  it("decision 7: the container never loads next/headers for a recording", async () => {
    await createPublicContainer().recordBeaconEvent(BEACON, visitorHeaders());
    await createPublicContainer().recordServerEvent({ slug: SLUG, type: "qr_scan" }, visitorHeaders());

    expect(mocks.nextHeadersLoaded).toBe(false);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });
});
