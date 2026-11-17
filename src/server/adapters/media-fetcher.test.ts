/**
 * Contract frozen by test-engineer (0021, decision 6: the avatar of the vCard is read on the server side only from the
 * configured Supabase origin — never an arbitrary URL —, within 3 s and 1 MiB; absent when unavailable).
 *
 * // src/server/adapters/media-fetcher.ts
 * export const MEDIA_FETCH_TIMEOUT_MS = 3000;
 * export const MEDIA_FETCH_MAX_BYTES = 1_048_576;
 * export function makeMediaFetcher(deps: {
 *   supabaseUrl: string;                 // env.NEXT_PUBLIC_SUPABASE_URL
 *   fetch: typeof globalThis.fetch;      // globalThis.fetch in the container
 *   timeoutMs: number;                   // MEDIA_FETCH_TIMEOUT_MS in the container (whole exchange, body included)
 *   maxBytes: number;                    // MEDIA_FETCH_MAX_BYTES in the container
 * }): MediaFetcher;
 * // Accepted URL only: same origin as supabaseUrl (scheme, host, port), path
 * // `/storage/v1/object/public/carnet-media/<name>` with isProfileImageObjectName(name), no query, no fragment, no
 * // credentials. Anything else → null without any request.
 * // Request: GET, `redirect: "error"` (a redirection could leave the origin), aborted after timeoutMs.
 * // Not 2xx, Content-Length over maxBytes, body over maxBytes (counted while reading, whatever the headers say),
 * // timeout, network error → null. Never throws.
 */
import { describe, expect, it, vi } from "vitest";

import {
  makeMediaFetcher,
  MEDIA_FETCH_MAX_BYTES,
  MEDIA_FETCH_TIMEOUT_MS,
} from "@/server/adapters/media-fetcher";

import { PROFILE_ID } from "../../../tests/builders/fake-registrar";
import { imageBytes } from "../../../tests/builders/images";

const SUPABASE_URL = "https://supabase.carnet.example";
const NAME = `${PROFILE_ID}/avatar-1a2b3c4d-0000-4000-8000-000000000001.jpg`;
const AVATAR_URL = `${SUPABASE_URL}/storage/v1/object/public/carnet-media/${NAME}`;
const TEST_TIMEOUT_MS = 80;
const TEST_MAX_BYTES = 4096;

type FetchCall = { url: string; init: RequestInit | undefined };

function fetchAnswering(answer: (init: RequestInit | undefined) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input instanceof Request ? input.url : input), init });
    return answer(init);
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

function fetcher(fetch: typeof globalThis.fetch, overrides: { supabaseUrl?: string; maxBytes?: number } = {}) {
  return makeMediaFetcher({
    supabaseUrl: overrides.supabaseUrl ?? SUPABASE_URL,
    fetch,
    timeoutMs: TEST_TIMEOUT_MS,
    maxBytes: overrides.maxBytes ?? TEST_MAX_BYTES,
  });
}

function imageResponse(bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  return new Response(bytes.slice().buffer as ArrayBuffer, { status: 200, headers: { "content-type": "image/jpeg", ...headers } });
}

/** A body sent in chunks, without Content-Length; `stall` keeps the stream open after the chunks. */
function streamedResponse(chunks: readonly Uint8Array[], options: { stall?: boolean } = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      if (options.stall !== true) {
        controller.close();
      }
    },
  });
  return new Response(body, { status: 200 });
}

/** Never answers until the request is aborted. */
function hangingUntilAborted(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
  });
}

describe("makeMediaFetcher", () => {
  it("decision 6: defaults of the container are 3 s and 1 MiB", () => {
    expect(MEDIA_FETCH_TIMEOUT_MS).toBe(3000);
    expect(MEDIA_FETCH_MAX_BYTES).toBe(1024 * 1024);
  });

  it("criterion 3: a public object of carnet-media on the configured origin → its bytes", async () => {
    const bytes = imageBytes("jpeg", 2048);
    const { calls, fetch } = fetchAnswering(() => imageResponse(bytes));

    const result = await fetcher(fetch).fetch(AVATAR_URL);

    expect(result).not.toBeNull();
    expect([...(result ?? [])]).toStrictEqual([...bytes]);
    expect(calls.map((call) => call.url)).toStrictEqual([AVATAR_URL]);
  });

  it("the request refuses redirections (a redirection could leave the origin) and carries an abort signal", async () => {
    const { calls, fetch } = fetchAnswering(() => imageResponse(imageBytes("jpeg")));

    await fetcher(fetch).fetch(AVATAR_URL);

    expect(calls[0]?.init?.redirect).toBe("error");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.init?.method ?? "GET").toBe("GET");
  });

  it("the local stack origin (http://127.0.0.1:54321) is accepted when it is the configured one", async () => {
    const local = "http://127.0.0.1:54321";
    const { calls, fetch } = fetchAnswering(() => imageResponse(imageBytes("png")));

    const result = await fetcher(fetch, { supabaseUrl: local }).fetch(
      `${local}/storage/v1/object/public/carnet-media/${NAME}`,
    );

    expect(result).not.toBeNull();
    expect(calls).toHaveLength(1);
  });

  describe("decision 6: never an arbitrary URL (no request at all)", () => {
    it.each([
      ["another origin", `https://evil.example/storage/v1/object/public/carnet-media/${NAME}`],
      ["the same host over http", `http://supabase.carnet.example/storage/v1/object/public/carnet-media/${NAME}`],
      ["another port", `https://supabase.carnet.example:8443/storage/v1/object/public/carnet-media/${NAME}`],
      ["a sub-domain", `https://x.supabase.carnet.example/storage/v1/object/public/carnet-media/${NAME}`],
      ["credentials pointing elsewhere", `https://supabase.carnet.example@evil.example/storage/v1/object/public/carnet-media/${NAME}`],
      ["credentials on the right host", `https://user:pw@supabase.carnet.example/storage/v1/object/public/carnet-media/${NAME}`],
      ["another bucket", `${SUPABASE_URL}/storage/v1/object/public/other-project/${NAME}`],
      ["an authenticated object path", `${SUPABASE_URL}/storage/v1/object/authenticated/carnet-media/${NAME}`],
      ["another API of the instance", `${SUPABASE_URL}/auth/v1/admin/users`],
      ["a traversal", `${SUPABASE_URL}/storage/v1/object/public/carnet-media/../../../auth/v1/admin/users`],
      ["an encoded traversal", `${SUPABASE_URL}/storage/v1/object/public/carnet-media/%2e%2e/%2e%2e/rest/v1/profiles`],
      ["a name outside the pattern", `${SUPABASE_URL}/storage/v1/object/public/carnet-media/${PROFILE_ID}/secret.txt`],
      ["a query string", `${AVATAR_URL}?download=1`],
      ["a fragment", `${AVATAR_URL}#x`],
      ["a relative URL", `/storage/v1/object/public/carnet-media/${NAME}`],
      ["a data: URL", "data:image/png;base64,iVBORw0KGgo="],
      ["a file: URL", "file:///etc/passwd"],
      ["not a URL", "not a url"],
    ])("%s → null", async (_label, url) => {
      const { calls, fetch } = fetchAnswering(() => imageResponse(imageBytes("jpeg")));

      expect(await fetcher(fetch).fetch(url)).toBeNull();
      expect(calls).toStrictEqual([]);
    });
  });

  describe("absent when unavailable", () => {
    it.each([404, 400, 500, 503])("status %i → null", async (status) => {
      const { fetch } = fetchAnswering(() => new Response("error", { status }));

      expect(await fetcher(fetch).fetch(AVATAR_URL)).toBeNull();
    });

    it("network error (fetch rejects, redirection refused included) → null, no exception", async () => {
      const { fetch } = fetchAnswering(() => Promise.reject(new TypeError("fetch failed")));

      await expect(fetcher(fetch).fetch(AVATAR_URL)).resolves.toBeNull();
    });

    it("decision 6: no answer within the delay → null after about timeoutMs", async () => {
      const { fetch } = fetchAnswering(hangingUntilAborted);
      const started = performance.now();

      expect(await fetcher(fetch).fetch(AVATAR_URL)).toBeNull();

      const elapsed = performance.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(TEST_TIMEOUT_MS - 10);
      expect(elapsed).toBeLessThan(TEST_TIMEOUT_MS + 1500);
    });

    it("decision 6: headers in time but a body that never ends → null (the delay covers the body)", async () => {
      const { fetch } = fetchAnswering(() => streamedResponse([imageBytes("jpeg", 100)], { stall: true }));
      const started = performance.now();

      expect(await fetcher(fetch).fetch(AVATAR_URL)).toBeNull();
      expect(performance.now() - started).toBeLessThan(TEST_TIMEOUT_MS + 1500);
    });
  });

  describe("decision 6: 1 MiB at most", () => {
    it("Content-Length over maxBytes → null", async () => {
      const { fetch } = fetchAnswering(() =>
        imageResponse(imageBytes("jpeg", 100), { "content-length": String(TEST_MAX_BYTES + 1) }),
      );

      expect(await fetcher(fetch).fetch(AVATAR_URL)).toBeNull();
    });

    it("a body over maxBytes without Content-Length (counted while reading) → null", async () => {
      const chunk = imageBytes("jpeg", 1024);
      const { fetch } = fetchAnswering(() => streamedResponse([chunk, chunk, chunk, chunk, Uint8Array.of(0)]));

      expect(await fetcher(fetch).fetch(AVATAR_URL)).toBeNull();
    });

    it("exactly maxBytes → accepted", async () => {
      const chunk = imageBytes("jpeg", 1024);
      const { fetch } = fetchAnswering(() => streamedResponse([chunk, chunk, chunk, chunk]));

      expect((await fetcher(fetch).fetch(AVATAR_URL))?.length).toBe(TEST_MAX_BYTES);
    });
  });
});
