/**
 * Contract frozen by test-engineer (0025, decision 2; criterion 1).
 *
 * // src/app/(public)/q/[code]/route.ts — dynamic GET handler, no rate limit, no side effect.
 * export async function GET(request: Request, context: { params: Promise<{ code: string }> }): Promise<Response>;
 * // createPublicContainer().resolveQrCode(code):
 * //   ok(slug) → 307, Location exactly "/p/{slug}" (relative, decision 13);  ok(null) → 404, the same French HTML page as /t (« Cette carte n'est pas
 * //   active. »), identical whatever the cause; err("unexpected") → 500, no body.
 * // Every answer: Cache-Control: private, no-store; X-Robots-Tag: noindex, nofollow; no Set-Cookie.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeResolveQrCode } from "@/server/use-cases/resolve-qr-code";

import { makeCallLog, type CallLog } from "../../../../../tests/builders/call-log";
import { fakeQrCodeResolver, type QrResolutionResult } from "../../../../../tests/builders/fake-nfc-tag-resolver";
import { MALFORMED_QR_CODES, QR_CODE } from "../../../../../tests/builders/nfc";

const mocks = vi.hoisted(() => ({
  results: [] as QrResolutionResult[],
  log: undefined as CallLog | undefined,
}));

vi.mock("@/server/container", () => ({
  createPublicContainer: () => ({
    resolveQrCode: makeResolveQrCode({ codes: fakeQrCodeResolver({ log: mocks.log, results: mocks.results }) }),
  }),
}));

const ORIGIN = "http://localhost:3000";
const SLUG = "elodie-durand-merel";
const NOT_ACTIVE = /Cette carte n['’]est pas active\./;

let route: typeof import("./route");

beforeEach(async () => {
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
  it("criterion 1: QR code of a published profile → 307 to /p/{slug}", async () => {
    mocks.results = [ok(SLUG)];

    const response = await get(QR_CODE);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`/p/${SLUG}`);
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
    "decision 13: request URL on %s, Host evil.example → Location exactly /p/{slug}",
    async (origin) => {
      mocks.results = [ok(SLUG)];
      const request = new Request(`${origin}/q/${QR_CODE}`, { headers: { host: "evil.example" } });

      const response = await route.GET(request, { params: Promise.resolve({ code: QR_CODE }) });

      expect(response.headers.get("location")).toBe(`/p/${SLUG}`);
    },
  );
});
