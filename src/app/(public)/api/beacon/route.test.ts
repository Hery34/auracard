/**
 * Contract frozen by test-engineer (0029, decisions 1, 5 and 6; criteria 2, 3 and 6).
 *
 * // src/app/(public)/api/beacon/route.ts — URL /api/beacon, POST only.
 * export async function POST(request: Request): Promise<Response>;
 * // Body read as text whatever the Content-Type (navigator.sendBeacon sends text/plain), at most 1024 bytes;
 * // then JSON validated by a strict Zod schema:
 * //   { slug: string (≤ 40), id: string (≤ 36), type: "profile_view" | "link_click" | "contact_click",
 * //     source: "nfc" | "qr" | "direct", link_id?: string (≤ 36) }   — no other key.
 * // Valid → createPublicContainer().recordBeaconEvent({ slug, id, type, source, linkId: link_id ?? null },
 * //   request.headers) (awaited or handed to after(), both accepted). Anything else → no call.
 * // Every answer, whatever happens (invalid, oversized, robot, rate limited, unknown slug, failure, exception):
 * //   204, empty body, Cache-Control: private, no-store, no Set-Cookie.
 *
 * // src/server/container.ts
 * export type BeaconEvent = { slug: string; id: string; type: string; source: string; linkId: string | null };
 * export type RecordBeaconFromRequest = (event: BeaconEvent, headers: Headers) => Promise<Result<RecordOutcome, "unexpected">>;
 * // PublicContainer gains recordBeaconEvent: RecordBeaconFromRequest (user-agent and address read from the headers).
 *
 * Amended by test-engineer (0029, point 10 — third-party inflation):
 * // The route reads the public origin from `siteUrl` (exported by src/server/container.ts, origin of SITE_URL).
 * // `Origin` present and different from siteUrl, or `Sec-Fetch-Site` present and different from "same-origin"
 * //   → the same 204 private, no-store; recordBeaconEvent never called (no rate limit consumed).
 * // Both headers absent → handled as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";

import { EVENT_ID, LINK_ID, PROFILE_SLUG, THIRD_PARTY_ORIGIN, aBeaconBody, type BeaconBody } from "../../../../../tests/builders/analytics";
import { makeDeferredWork, type AfterTask, type DeferredWork } from "../../../../../tests/builders/deferred-work";

const mocks = vi.hoisted(() => ({ recordBeaconEvent: vi.fn(), after: vi.fn() }));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));

vi.mock("@/server/container", () => ({
  siteUrl: "https://carnet.example",
  createPublicContainer: () => ({ recordBeaconEvent: mocks.recordBeaconEvent }),
}));

/** Request URL as seen behind the proxy: deliberately not the public origin, so that only `siteUrl` can be trusted. */
const ORIGIN = "http://localhost:3000";
const SITE_ORIGIN = "https://carnet.example";
const MAX_BYTES = 1024;

let route: typeof import("./route");
let deferred: DeferredWork;

beforeEach(async () => {
  deferred = makeDeferredWork();
  mocks.after.mockReset().mockImplementation((task: AfterTask) => deferred.after(task));
  mocks.recordBeaconEvent.mockReset().mockResolvedValue(ok("recorded"));
  route = await import("./route");
});

function beaconRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/beacon`, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8", "user-agent": "Mozilla/5.0 (iPhone)", ...headers },
    body,
  });
}

/** Posts, then runs the deferred work (if any) so that every call made by the route is visible. */
async function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  const response = await route.POST(beaconRequest(body, headers));
  await deferred.flush();
  return response;
}

async function expectSilent204(response: Response): Promise<void> {
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
}

function json(body: Partial<BeaconBody> & Record<string, unknown>): string {
  return JSON.stringify(body);
}

describe("POST /api/beacon", () => {
  it("decision 6: valid profile_view → recordBeaconEvent(event, request headers), 204 no-store", async () => {
    const response = await post(json(aBeaconBody({ source: "nfc" })), { "x-forwarded-for": "203.0.113.5" });

    await expectSilent204(response);
    expect(mocks.recordBeaconEvent).toHaveBeenCalledTimes(1);
    const [event, headers] = mocks.recordBeaconEvent.mock.calls[0] as [unknown, Headers];
    expect(event).toStrictEqual({ slug: PROFILE_SLUG, id: EVENT_ID, type: "profile_view", source: "nfc", linkId: null });
    expect(headers.get("user-agent")).toBe("Mozilla/5.0 (iPhone)");
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.5");
  });

  it("decision 5: link_click maps link_id to linkId", async () => {
    await expectSilent204(await post(json(aBeaconBody({ type: "link_click", link_id: LINK_ID }))));

    expect(mocks.recordBeaconEvent.mock.calls[0]?.[0]).toStrictEqual({
      slug: PROFILE_SLUG,
      id: EVENT_ID,
      type: "link_click",
      source: "direct",
      linkId: LINK_ID,
    });
  });

  it("decision 5: contact_click is accepted", async () => {
    await expectSilent204(await post(json(aBeaconBody({ type: "contact_click" }))));

    expect(mocks.recordBeaconEvent).toHaveBeenCalledTimes(1);
  });

  it.each(["booking_viewed", "booking_started"])("0039 decision 4: %s is accepted (opening of /p/{slug}/rdv, choice of a slot)", async (type) => {
    await expectSilent204(await post(json(aBeaconBody({ type }))));

    expect(mocks.recordBeaconEvent.mock.calls[0]?.[0]).toStrictEqual({
      slug: PROFILE_SLUG,
      id: EVENT_ID,
      type,
      source: "direct",
      linkId: null,
    });
  });

  it("sendBeacon bodies are accepted whatever the Content-Type (text/plain, application/json, none)", async () => {
    await post(json(aBeaconBody()), { "content-type": "text/plain;charset=UTF-8" });
    await post(json(aBeaconBody()), { "content-type": "application/json" });
    await post(json(aBeaconBody()), { "content-type": "" });

    expect(mocks.recordBeaconEvent).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["not JSON", "slug=elodie"],
    ["empty body", ""],
    ["JSON array", JSON.stringify([aBeaconBody()])],
    ["JSON null", "null"],
    ["missing id", json({ slug: PROFILE_SLUG, type: "profile_view", source: "direct" })],
    ["missing slug", json({ id: EVENT_ID, type: "profile_view", source: "direct" })],
    ["missing source", json({ slug: PROFILE_SLUG, id: EVENT_ID, type: "profile_view" })],
    ["unknown key (strict schema)", json({ ...aBeaconBody(), profile_id: "c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f" })],
    ["camelCase linkId instead of link_id", json({ ...aBeaconBody({ type: "link_click" }), linkId: LINK_ID })],
    ["server-only type nfc_scan", json(aBeaconBody({ type: "nfc_scan" }))],
    ["server-only type vcard_download", json(aBeaconBody({ type: "vcard_download" }))],
    ["0039 decision 4: booking_confirmed (written by book_slot only)", json(aBeaconBody({ type: "booking_confirmed" }))],
    ["lead_submitted (written by capture_lead only)", json(aBeaconBody({ type: "lead_submitted" }))],
    ["unknown type", json(aBeaconBody({ type: "page_view" }))],
    ["unknown source", json(aBeaconBody({ source: "email" }))],
    ["number as id", JSON.stringify({ ...aBeaconBody(), id: 42 })],
    ["slug longer than 40", json(aBeaconBody({ slug: "a".repeat(41) }))],
    ["id longer than 36", json(aBeaconBody({ id: `${EVENT_ID}0` }))],
    ["link_id longer than 36", json(aBeaconBody({ type: "link_click", link_id: `${LINK_ID}0` }))],
  ])("decision 6: %s → 204, nothing recorded", async (_label, body) => {
    await expectSilent204(await post(body));

    expect(mocks.recordBeaconEvent).not.toHaveBeenCalled();
  });

  it(`decision 6: a valid event padded beyond ${MAX_BYTES} bytes → 204, nothing recorded (size bounded before parsing)`, async () => {
    const body = json(aBeaconBody()) + " ".repeat(MAX_BYTES);

    await expectSilent204(await post(body));

    expect(mocks.recordBeaconEvent).not.toHaveBeenCalled();
  });

  it(`a valid event just under ${MAX_BYTES} bytes is accepted`, async () => {
    const base = json(aBeaconBody());
    const body = base + " ".repeat(MAX_BYTES - base.length);

    await expectSilent204(await post(body));

    expect(mocks.recordBeaconEvent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["ignored (robot, rate limited, unknown slug)", () => Promise.resolve(ok("ignored"))],
    ["err('unexpected')", () => Promise.resolve(err("unexpected"))],
    ["a rejected promise", () => Promise.reject(new Error("database down"))],
    [
      "a synchronous exception",
      () => {
        throw new Error("container failure");
      },
    ],
  ])("decision 6 / criteria 3 and 6: the recording answers %s → still 204 (no oracle)", async (_label, behaviour) => {
    mocks.recordBeaconEvent.mockImplementation(behaviour);

    await expectSilent204(await post(json(aBeaconBody())));
  });

  it("criterion 2: the same request posted twice → two identical calls with the same id, two 204", async () => {
    const body = json(aBeaconBody());

    await expectSilent204(await post(body));
    await expectSilent204(await post(body));

    expect(mocks.recordBeaconEvent.mock.calls.map(([event]) => event)).toStrictEqual([
      { slug: PROFILE_SLUG, id: EVENT_ID, type: "profile_view", source: "direct", linkId: null },
      { slug: PROFILE_SLUG, id: EVENT_ID, type: "profile_view", source: "direct", linkId: null },
    ]);
  });

  it("known and unknown slugs get byte-identical answers", async () => {
    mocks.recordBeaconEvent.mockResolvedValueOnce(ok("recorded")).mockResolvedValueOnce(ok("ignored"));

    const known = await post(json(aBeaconBody()));
    const unknown = await post(json(aBeaconBody({ slug: "inconnu-0000" })));

    expect([unknown.status, await unknown.text(), [...unknown.headers]]).toStrictEqual([
      known.status,
      await known.text(),
      [...known.headers],
    ]);
  });
});

describe("POST /api/beacon — third-party pages (0029, point 10)", () => {
  it.each([
    ["a third-party Origin", { origin: THIRD_PARTY_ORIGIN }],
    ["Origin: null (sandboxed iframe, data: URL)", { origin: "null" }],
    ["the request URL origin, which is not SITE_URL", { origin: ORIGIN }],
    ["the site origin over http", { origin: "http://carnet.example" }],
    ["a look-alike host prefixed by the site origin", { origin: `${SITE_ORIGIN}.evil.example` }],
    ["the site origin with another port", { origin: `${SITE_ORIGIN}:8443` }],
    ["Sec-Fetch-Site: cross-site", { "sec-fetch-site": "cross-site" }],
    ["Sec-Fetch-Site: same-site (a sibling subdomain)", { "sec-fetch-site": "same-site" }],
    ["Sec-Fetch-Site: none (typed or bookmarked)", { "sec-fetch-site": "none" }],
    ["the site Origin but Sec-Fetch-Site: cross-site", { origin: SITE_ORIGIN, "sec-fetch-site": "cross-site" }],
    ["Sec-Fetch-Site: same-origin but a third-party Origin", { origin: THIRD_PARTY_ORIGIN, "sec-fetch-site": "same-origin" }],
  ])("point 10: a valid event with %s → the same 204 private, no-store, use case never called", async (_label, headers) => {
    await expectSilent204(await post(json(aBeaconBody()), headers));

    expect(mocks.recordBeaconEvent).not.toHaveBeenCalled();
  });

  it("point 10: a third-party request and a recorded one get byte-identical answers (no oracle)", async () => {
    const recorded = await post(json(aBeaconBody()), { origin: SITE_ORIGIN, "sec-fetch-site": "same-origin" });
    const ignored = await post(json(aBeaconBody()), { origin: THIRD_PARTY_ORIGIN, "sec-fetch-site": "cross-site" });

    expect([ignored.status, await ignored.text(), [...ignored.headers]]).toStrictEqual([
      recorded.status,
      await recorded.text(),
      [...recorded.headers],
    ]);
    expect(mocks.recordBeaconEvent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Origin equal to the site origin", { origin: SITE_ORIGIN }],
    ["Sec-Fetch-Site: same-origin", { "sec-fetch-site": "same-origin" }],
    ["both (what a browser sends from /p/{slug})", { origin: SITE_ORIGIN, "sec-fetch-site": "same-origin" }],
    ["neither header (non-regression)", {}],
  ])("point 10: a valid event with %s → recorded", async (_label, headers) => {
    await expectSilent204(await post(json(aBeaconBody()), headers));

    expect(mocks.recordBeaconEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordBeaconEvent.mock.calls[0]?.[0]).toStrictEqual({
      slug: PROFILE_SLUG,
      id: EVENT_ID,
      type: "profile_view",
      source: "direct",
      linkId: null,
    });
  });
});
