/**
 * Contract frozen by test-engineer (0025, decision 2; criterion 1).
 *
 * // src/app/(public)/q/[code]/route.ts — dynamic GET handler, no rate limit, no side effect.
 * export async function GET(request: Request, context: { params: Promise<{ code: string }> }): Promise<Response>;
 * // createPublicContainer().resolveQrCode(code):
 * //   ok(slug) → 307, Location exactly "/p/{slug}" (relative, decision 13);  ok(null) → 404, the same French HTML page as /t (« Cette carte n'est pas
 * //   active. »), identical whatever the cause; err("unexpected") → 500, no body.
 * // Every answer: Cache-Control: private, no-store; X-Robots-Tag: noindex, nofollow; no Set-Cookie.
 *
 * Amended by test-engineer (0029, decisions 3 and 8; criteria 1, 3 and 4): ok(slug) → Location /p/{slug}?s=qr and
 * after() receives createPublicContainer().recordServerEvent({ slug, type: "qr_scan" }, request.headers), never
 * awaited before the response; its failure changes nothing. No recording for ok(null) nor 500.
 *
 * Amended by test-engineer (0029, point 10): the qr_scan is recorded only when `Sec-Fetch-Dest` is absent or
 * "document"; any other destination (image, script, iframe, empty…) → the same 307, after() given nothing to record.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeResolveQrCode } from "@/server/use-cases/resolve-qr-code";

import { makeCallLog, type CallLog } from "../../../../../tests/builders/call-log";
import { makeDeferredWork, settlesBeforeTimeout, type AfterTask, type DeferredWork } from "../../../../../tests/builders/deferred-work";
import { fakeQrCodeResolver, type QrResolutionResult } from "../../../../../tests/builders/fake-nfc-tag-resolver";
import { MALFORMED_QR_CODES, QR_CODE } from "../../../../../tests/builders/nfc";

const mocks = vi.hoisted(() => ({
  results: [] as QrResolutionResult[],
  log: undefined as CallLog | undefined,
  recordServerEvent: vi.fn(),
  after: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));

vi.mock("@/server/container", () => ({
  createPublicContainer: () => ({
    resolveQrCode: makeResolveQrCode({ codes: fakeQrCodeResolver({ log: mocks.log, results: mocks.results }) }),
    recordServerEvent: mocks.recordServerEvent,
  }),
}));

const ORIGIN = "http://localhost:3000";
const SLUG = "elodie-durand-merel";
const NOT_ACTIVE = /Cette carte n['’]est pas active\./;

let route: typeof import("./route");
let deferred: DeferredWork;

beforeEach(async () => {
  deferred = makeDeferredWork();
  mocks.after.mockReset().mockImplementation((task: AfterTask) => deferred.after(task));
  mocks.recordServerEvent.mockReset().mockResolvedValue(ok("recorded"));
  mocks.log = makeCallLog();
  mocks.results = [ok(null)];
  route = await import("./route");
});

async function get(code: string): Promise<Response> {
  return route.GET(new Request(`${ORIGIN}/q/${encodeURIComponent(code)}`), { params: Promise.resolve({ code }) });
}

function expectNoStoreNoIndex(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(response.headers.get("set-cookie")).toBeNull();
}

describe("GET /q/{code}", () => {
  it("criterion 1: QR code of a published profile → 307 to /p/{slug}?s=qr (0029, decision 3)", async () => {
    mocks.results = [ok(SLUG)];

    const response = await get(QR_CODE);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`/p/${SLUG}?s=qr`);
    expectNoStoreNoIndex(response);
    expect(mocks.log?.inputsOf("qrCodes", "resolve")).toStrictEqual([QR_CODE]);
  });

  it("criterion 1: unknown code or unpublished profile → 404 French HTML page", async () => {
    const response = await get(QR_CODE);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/^text\/html;\s*charset=utf-8$/i);
    expect(await response.text()).toMatch(NOT_ACTIVE);
    expectNoStoreNoIndex(response);
  });

  it.each(MALFORMED_QR_CODES)("criterion 1: code with %s → 404 without any database request", async (_label, code) => {
    mocks.results = [ok(SLUG)];

    const response = await get(code);

    expect(response.status).toBe(404);
    expectNoStoreNoIndex(response);
    expect(mocks.log?.sequence()).toStrictEqual([]);
  });

  it("criterion 1: malformed and unknown codes give byte-identical 404 pages", async () => {
    const unknown = await (await get(QR_CODE)).text();
    const malformed = await (await get("X4Y5Z6W7")).text();

    expect(malformed).toBe(unknown);
  });

  it("database failure → 500 without body, same headers", async () => {
    mocks.results = [err("unexpected")];

    const response = await get(QR_CODE);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expectNoStoreNoIndex(response);
  });

  it.each(["http://0.0.0.0:3000", "http://carnet.example", "https://evil.example"])(
    "decision 13: request URL on %s, Host evil.example → Location exactly /p/{slug}?s=qr",
    async (origin) => {
      mocks.results = [ok(SLUG)];
      const request = new Request(`${origin}/q/${QR_CODE}`, { headers: { host: "evil.example" } });

      const response = await route.GET(request, { params: Promise.resolve({ code: QR_CODE }) });

      expect(response.headers.get("location")).toBe(`/p/${SLUG}?s=qr`);
    },
  );
});

describe("GET /q/{code} — qr_scan (0029)", () => {
  const CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36";

  function scanRequest(headers: Record<string, string> = {}): Request {
    return new Request(`${ORIGIN}/q/${QR_CODE}`, { headers: { "user-agent": CHROME, ...headers } });
  }

  it("decision 3 / criterion 1: published profile → after() records qr_scan for the slug with the request headers", async () => {
    mocks.results = [ok(SLUG)];

    const response = await route.GET(scanRequest(), { params: Promise.resolve({ code: QR_CODE }) });
    await deferred.flush();

    expect(response.status).toBe(307);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    const [event, headers] = mocks.recordServerEvent.mock.calls[0] as [unknown, Headers];
    expect(event).toStrictEqual({ slug: SLUG, type: "qr_scan" });
    expect(headers.get("user-agent")).toBe(CHROME);
    expect(mocks.recordServerEvent).toHaveBeenCalledTimes(1);
  });

  it("decision 3: the redirection never waits for the recording", async () => {
    mocks.results = [ok(SLUG)];
    mocks.recordServerEvent.mockImplementation(() => new Promise(() => undefined));

    const response = await settlesBeforeTimeout(route.GET(scanRequest(), { params: Promise.resolve({ code: QR_CODE }) }));

    expect(response).not.toBe("pending");
    expect((response as Response).status).toBe(307);
  });

  it.each([
    ["err('unexpected')", () => Promise.resolve(err("unexpected"))],
    ["a rejected promise", () => Promise.reject(new Error("database down"))],
  ])("criterion 4: the recording answers %s → the same 307 to /p/{slug}?s=qr", async (_label, behaviour) => {
    mocks.results = [ok(SLUG)];
    mocks.recordServerEvent.mockImplementation(behaviour);

    const response = await route.GET(scanRequest(), { params: Promise.resolve({ code: QR_CODE }) });
    await deferred.flush();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`/p/${SLUG}?s=qr`);
    expectNoStoreNoIndex(response);
  });

  it.each([
    ["unknown code", ok(null)],
    ["database failure", err("unexpected" as const)],
  ])("decision 3: %s → no event recorded", async (_label, result) => {
    mocks.results = [result];

    await route.GET(scanRequest(), { params: Promise.resolve({ code: QR_CODE }) });
    await deferred.flush();

    expect(mocks.recordServerEvent).not.toHaveBeenCalled();
  });
  it.each(["image", "script", "iframe", "embed", "object", "empty"])(
    "point 10: Sec-Fetch-Dest: %s (embedded in a third-party page) → the same 307, no qr_scan recorded",
    async (destination) => {
      mocks.results = [ok(SLUG)];

      const response = await route.GET(scanRequest({ "sec-fetch-dest": destination }), { params: Promise.resolve({ code: QR_CODE }) });
      await deferred.flush();

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`/p/${SLUG}?s=qr`);
      expectNoStoreNoIndex(response);
      expect(mocks.recordServerEvent).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["Sec-Fetch-Dest: document (a scan opened by the phone)", { "sec-fetch-dest": "document" }],
    ["no Sec-Fetch-Dest (non-regression)", {}],
  ])("point 10: %s → the same 307, qr_scan recorded", async (_label, headers: Record<string, string>) => {
    mocks.results = [ok(SLUG)];

    const response = await route.GET(scanRequest(headers), { params: Promise.resolve({ code: QR_CODE }) });
    await deferred.flush();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`/p/${SLUG}?s=qr`);
    expect(mocks.recordServerEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordServerEvent.mock.calls[0]?.[0]).toStrictEqual({ slug: SLUG, type: "qr_scan" });
  });
});
