/**
 * Contract frozen by test-engineer (0025, decisions 1 and 3; criterion 1 and 2).
 *
 * // src/app/(public)/t/[uid]/route.ts — dynamic GET handler, no rate limit, no side effect.
 * export async function GET(request: Request, context: { params: Promise<{ uid: string }> }): Promise<Response>;
 * // createPublicContainer().resolveNfcTag(uid) (cookie-less anonymous client; createContainer never used):
 * //   ok({ state: "active", slug }) → 307, Location /p/{slug} (relative only, decision 13);
 * //   ok({ state: "activation" })   → 307, Location /activer/{uid};
 * //   ok({ state: "not_found" })    → 404, small French HTML page « Cette carte n'est pas active. » (lang="fr"),
 * //                                   the same bytes whatever the cause (unknown, disabled, unpublished, malformed);
 * //   err("unexpected")             → 500, no body.
 * // Every answer: Cache-Control: private, no-store; X-Robots-Tag: noindex, nofollow; no Set-Cookie.
 *
 * // src/server/container.ts — PublicContainer gains resolveNfcTag: ResolveNfcTag and resolveQrCode: ResolveQrCode.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeResolveNfcTag } from "@/server/use-cases/resolve-nfc-tag";

import { makeCallLog, type CallLog } from "../../../../../tests/builders/call-log";
import { fakeNfcTagResolver, type NfcResolutionResult } from "../../../../../tests/builders/fake-nfc-tag-resolver";
import { MALFORMED_TAG_UIDS, TAG_UID } from "../../../../../tests/builders/nfc";

const mocks = vi.hoisted(() => ({
  results: [] as NfcResolutionResult[],
  log: undefined as CallLog | undefined,
}));

vi.mock("@/server/container", () => ({
  createPublicContainer: () => ({
    resolveNfcTag: makeResolveNfcTag({ tags: fakeNfcTagResolver({ log: mocks.log, results: mocks.results }) }),
  }),
}));

const ORIGIN = "http://localhost:3000";
const SLUG = "elodie-durand-merel";
const NOT_ACTIVE = /Cette carte n['’]est pas active\./;

let route: typeof import("./route");

beforeEach(async () => {
  mocks.log = makeCallLog();
  mocks.results = [ok({ state: "not_found" })];
  route = await import("./route");
});

async function get(uid: string): Promise<Response> {
  return route.GET(new Request(`${ORIGIN}/t/${encodeURIComponent(uid)}`), { params: Promise.resolve({ uid }) });
}

/** Decision 13: the Location header is the relative path itself. */
function locationPath(response: Response): string {
  return response.headers.get("location") ?? "";
}

function expectNoStoreNoIndex(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(response.headers.get("set-cookie")).toBeNull();
}

describe("GET /t/{uid}", () => {
  it("criterion 1: tag assigned to a published profile → 307 to /p/{slug}", async () => {
    mocks.results = [ok({ state: "active", slug: SLUG })];

    const response = await get(TAG_UID);

    expect(response.status).toBe(307);
    expect(locationPath(response)).toBe(`/p/${SLUG}`);
    expectNoStoreNoIndex(response);
    expect(mocks.log?.inputsOf("nfcTags", "resolve")).toStrictEqual([TAG_UID]);
  });

  it("criterion 2: tag in stock → 307 to /activer/{uid}", async () => {
    mocks.results = [ok({ state: "activation" })];

    const response = await get(TAG_UID);

    expect(response.status).toBe(307);
    expect(locationPath(response)).toBe(`/activer/${TAG_UID}`);
    expectNoStoreNoIndex(response);
  });

  it("criterion 1: unknown, disabled or unpublished (not_found) → 404 French HTML page « Cette carte n'est pas active. »", async () => {
    const response = await get(TAG_UID);

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toMatch(/^text\/html;\s*charset=utf-8$/i);
    const body = await response.text();
    expect(body).toMatch(NOT_ACTIVE);
    expect(body).toMatch(/<html[^>]*\blang="fr"/);
    expect(body).not.toContain(TAG_UID);
    expectNoStoreNoIndex(response);
  });

  it.each(MALFORMED_TAG_UIDS)("criterion 1: uid with %s → 404 without any database request", async (_label, uid) => {
    mocks.results = [ok({ state: "active", slug: SLUG })];

    const response = await get(uid);

    expect(response.status).toBe(404);
    expect(await response.text()).toMatch(NOT_ACTIVE);
    expectNoStoreNoIndex(response);
    expect(mocks.log?.sequence()).toStrictEqual([]);
  });

  it("criterion 1: the 404 of a malformed uid and of a not_found tag are byte-identical (no oracle)", async () => {
    const notFound = await (await get(TAG_UID)).text();
    const malformed = await (await get("7K2M9P4Q8R3S")).text();
    const other = await (await get("a1b2c3d4e5f6")).text();

    expect(malformed).toBe(notFound);
    expect(other).toBe(notFound);
  });

  it("database failure → 500 without body, same headers", async () => {
    mocks.results = [err("unexpected")];

    const response = await get(TAG_UID);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expectNoStoreNoIndex(response);
  });

  it.each([
    ["an internal bind address", "http://0.0.0.0:3000"],
    ["a plain http origin behind the TLS proxy", "http://carnet.example"],
    ["another host", "https://evil.example"],
  ])("decision 13: request URL on %s → Location exactly relative, for both redirections", async (_label, origin) => {
    for (const [resolution, expected] of [
      [{ state: "active", slug: SLUG }, `/p/${SLUG}`],
      [{ state: "activation" }, `/activer/${TAG_UID}`],
    ] as const) {
      mocks.results = [ok(resolution)];

      const response = await route.GET(new Request(`${origin}/t/${TAG_UID}`), { params: Promise.resolve({ uid: TAG_UID }) });

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(expected);
    }
  });

  it("decision 13: a Host header evil.example never reaches the Location", async () => {
    mocks.results = [ok({ state: "active", slug: SLUG })];
    const request = new Request(`https://carnet.example/t/${TAG_UID}`, {
      headers: { host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" },
    });

    const response = await route.GET(request, { params: Promise.resolve({ uid: TAG_UID }) });

    expect(response.headers.get("location")).toBe(`/p/${SLUG}`);
  });
});
