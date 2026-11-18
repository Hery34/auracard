/**
 * Contract frozen by test-engineer (0029, decisions 4 and 8; criteria 3 and 4). Behaviour of 0019 unchanged.
 *
 * // src/app/(public)/v/[slug]/route.ts
 * // downloadVCard(slug, request.headers) → ok(file): 200 text/vcard (as before) and after() receives
 * //   createPublicContainer().recordServerEvent({ slug, type: "vcard_download" }, request.headers), never awaited
 * //   before the response; its failure (err, rejection) changes nothing.
 * // ok(null) → 404, err("rate_limited") → 429, err("unexpected") → 500: no recording.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";

import { makeDeferredWork, settlesBeforeTimeout, type AfterTask, type DeferredWork } from "../../../../../tests/builders/deferred-work";

const SLUG = "elodie-durand-merel";
const FILE = { fileName: `${SLUG}.vcf`, content: "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Élodie Durand-Merel\r\nEND:VCARD\r\n" };
const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

const mocks = vi.hoisted(() => ({ downloadVCard: vi.fn(), recordServerEvent: vi.fn(), after: vi.fn() }));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));

vi.mock("@/server/container", () => ({
  createPublicContainer: () => ({ downloadVCard: mocks.downloadVCard, recordServerEvent: mocks.recordServerEvent }),
}));

let route: typeof import("./route");
let deferred: DeferredWork;

beforeEach(async () => {
  deferred = makeDeferredWork();
  mocks.after.mockReset().mockImplementation((task: AfterTask) => deferred.after(task));
  mocks.downloadVCard.mockReset().mockResolvedValue(ok(FILE));
  mocks.recordServerEvent.mockReset().mockResolvedValue(ok("recorded"));
  route = await import("./route");
});

function get(): Promise<Response> {
  const request = new Request(`http://localhost:3000/v/${SLUG}`, {
    headers: { "user-agent": SAFARI, "x-forwarded-for": "203.0.113.5" },
  });
  return route.GET(request, { params: Promise.resolve({ slug: SLUG }) });
}

async function expectVCard(response: Response): Promise<void> {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/vcard; charset=utf-8");
  expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${SLUG}.vcf"`);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.text()).toBe(FILE.content);
}

describe("GET /v/{slug} — vcard_download (0029)", () => {
  it("decision 4: file served → after() records vcard_download for the slug with the request headers", async () => {
    const response = await get();
    await deferred.flush();

    await expectVCard(response);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.recordServerEvent).toHaveBeenCalledTimes(1);
    const [event, headers] = mocks.recordServerEvent.mock.calls[0] as [unknown, Headers];
    expect(event).toStrictEqual({ slug: SLUG, type: "vcard_download" });
    expect(headers.get("user-agent")).toBe(SAFARI);
  });

  it("decision 4: the vCard never waits for the recording", async () => {
    mocks.recordServerEvent.mockImplementation(() => new Promise(() => undefined));

    const response = await settlesBeforeTimeout(get());

    expect(response).not.toBe("pending");
    await expectVCard(response as Response);
  });

  it.each([
    ["err('unexpected')", () => Promise.resolve(err("unexpected"))],
    ["a rejected promise", () => Promise.reject(new Error("database down"))],
  ])("criterion 4: the recording answers %s → the same vCard", async (_label, behaviour) => {
    mocks.recordServerEvent.mockImplementation(behaviour);

    const response = await get();
    await deferred.flush();

    await expectVCard(response);
  });

  it.each([
    ["unknown or unpublished slug (404)", ok(null), 404],
    ["rate limited (429)", err("rate_limited"), 429],
    ["failure (500)", err("unexpected"), 500],
  ])("decision 4: %s → no event recorded", async (_label, result, status) => {
    mocks.downloadVCard.mockResolvedValue(result);

    const response = await get();
    await deferred.flush();

    expect(response.status).toBe(status);
    expect(mocks.recordServerEvent).not.toHaveBeenCalled();
  });

  it("0019 unchanged: downloadVCard receives the slug and the request headers", async () => {
    await get();

    const [slug, headers] = mocks.downloadVCard.mock.calls[0] as [string, Headers];
    expect(slug).toBe(SLUG);
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.5");
  });
});
