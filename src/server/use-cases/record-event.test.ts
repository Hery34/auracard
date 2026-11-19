/**
 * Contract frozen by test-engineer (0029, decisions 2 to 9; criteria 2, 3, 4 and 6). Only the ports are fakes.
 *
 * // src/domain/analytics/ports.ts
 * // The database resolves the slug (record_public_event, 0034): unknown or unpublished → nothing written, silently.
 * export interface EventRecorder { record(event: AnalyticsEvent): Promise<Result<void, "unexpected">>; }
 * // AnalyticsEvent = { id, slug, type, source, linkId, deviceClass }
 *
 * // src/domain/shared/rate-limits.ts: "beacon" = { limit: 300, windowSeconds: 3600 }, "scan" = { limit: 60, windowSeconds: 3600 }.
 *
 * // src/server/use-cases/record-event.ts
 * export type RecordOutcome = "recorded" | "ignored";
 * export type BeaconInput = { slug: string; id: string; type: string; source: string; linkId: string | null;
 *   userAgent: string | null; clientAddress: string };
 * export type RecordBeaconEvent = (input: BeaconInput) => Promise<Result<RecordOutcome, "unexpected">>;
 * export function makeRecordBeaconEvent(deps: { rateLimiter: RateLimiter; events: EventRecorder }): RecordBeaconEvent;
 * //   1. classifyUserAgent: bot → ok("ignored"), no port called;
 * //   2. rate limit "beacon" on clientAddress (300/h), counted whatever the id: refused → ok("ignored"),
 * //      limiter failure → err("unexpected"); nothing written in both cases;
 * //   3. parseBeaconEvent + slug format (SLUG_PATTERN): invalid → ok("ignored"), nothing written;
 * //   4. events.record({ id, slug, type, source, linkId, deviceClass }) → ok("recorded") | err("unexpected").
 * export type ServerEventInput = { slug: string; type: ServerEventType; userAgent: string | null; clientAddress: string };
 * export type RecordServerEvent = (input: ServerEventInput) => Promise<Result<RecordOutcome, "unexpected">>;
 * export function makeRecordServerEvent(deps: { ids: IdGenerator; rateLimiter: RateLimiter; events: EventRecorder }): RecordServerEvent;
 * //   1. bot → ok("ignored"), no port called;
 * //   2. rate limit "scan" on clientAddress (60/h): refused OR limiter failure → ok("ignored") (never an error: the
 * //      redirection and the vCard are never blocked), nothing written;
 * //   3. malformed slug → ok("ignored");
 * //   4. events.record with a fresh id from `ids`, source = sourceOfServerEvent(type), linkId null.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeRecordBeaconEvent, makeRecordServerEvent } from "@/server/use-cases/record-event";

import {
  BEACON_CLIENT_ADDRESS,
  BOT_USER_AGENTS,
  DESKTOP_USER_AGENT,
  EVENT_ID,
  LINK_ID,
  OTHER_EVENT_ID,
  PROFILE_SLUG,
  aBeaconInput,
  aServerEventInput,
} from "../../../tests/builders/analytics";
import { makeCallLog } from "../../../tests/builders/call-log";
import { fakeEventRecorder, type FakeEventRecorderOptions } from "../../../tests/builders/fake-event-recorder";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../tests/builders/fake-rate-limiter";
import { FIXED_UUIDS, fixedIds } from "../../../tests/builders/fixed-ids";

type HarnessOptions = {
  limiter?: Omit<FakeRateLimiterOptions, "log">;
  events?: Omit<FakeEventRecorderOptions, "log">;
};

function beaconHarness(options: HarnessOptions = {}) {
  const log = makeCallLog();
  const recordBeaconEvent = makeRecordBeaconEvent({
    rateLimiter: fakeRateLimiter({ log, ...options.limiter }),
    events: fakeEventRecorder({ log, ...options.events }),
  });
  return { log, recordBeaconEvent };
}

function serverHarness(options: HarnessOptions = {}) {
  const log = makeCallLog();
  const recordServerEvent = makeRecordServerEvent({
    ids: fixedIds(),
    rateLimiter: fakeRateLimiter({ log, ...options.limiter }),
    events: fakeEventRecorder({ log, ...options.events }),
  });
  return { log, recordServerEvent };
}

const BEACON_CONSUMPTION = { scope: "beacon", subject: BEACON_CLIENT_ADDRESS, limit: 300, windowSeconds: 3600 };
const SCAN_CONSUMPTION = { scope: "scan", subject: BEACON_CLIENT_ADDRESS, limit: 60, windowSeconds: 3600 };

describe("recordBeaconEvent", () => {
  it("decisions 6 and 9: rate limit beacon (300/h) on the address, then one write by slug", async () => {
    const { log, recordBeaconEvent } = beaconHarness();

    expect(await recordBeaconEvent(aBeaconInput())).toStrictEqual(ok("recorded"));

    expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "events.record"]);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([BEACON_CONSUMPTION]);
    expect(log.inputsOf("events", "record")).toStrictEqual([
      { id: EVENT_ID, slug: PROFILE_SLUG, type: "profile_view", source: "direct", linkId: null, deviceClass: "mobile" },
    ]);
  });

  it("criterion 1: a profile_view after an NFC scan keeps the source nfc", async () => {
    const { log, recordBeaconEvent } = beaconHarness();

    await recordBeaconEvent(aBeaconInput({ source: "nfc" }));

    expect(log.inputsOf("events", "record")).toMatchObject([{ type: "profile_view", source: "nfc" }]);
  });

  it("decisions 5 and 9: link_click carries its link; contact_click none; desktop visitor → desktop", async () => {
    const { log, recordBeaconEvent } = beaconHarness();

    await recordBeaconEvent(aBeaconInput({ type: "link_click", linkId: LINK_ID, source: "qr" }));
    await recordBeaconEvent(aBeaconInput({ id: OTHER_EVENT_ID, type: "contact_click", userAgent: DESKTOP_USER_AGENT }));

    expect(log.inputsOf("events", "record")).toStrictEqual([
      { id: EVENT_ID, slug: PROFILE_SLUG, type: "link_click", source: "qr", linkId: LINK_ID, deviceClass: "mobile" },
      { id: OTHER_EVENT_ID, slug: PROFILE_SLUG, type: "contact_click", source: "direct", linkId: null, deviceClass: "desktop" },
    ]);
  });

  it.each(["booking_viewed", "booking_started"])(
    "0039 decision 4: %s (opening of /p/{slug}/rdv, choice of a slot) is recorded like a view",
    async (type) => {
      const { log, recordBeaconEvent } = beaconHarness();

      expect(await recordBeaconEvent(aBeaconInput({ type }))).toStrictEqual(ok("recorded"));
      expect(log.inputsOf("events", "record")).toStrictEqual([
        { id: EVENT_ID, slug: PROFILE_SLUG, type, source: "direct", linkId: null, deviceClass: "mobile" },
      ]);
    },
  );

  it.each(BOT_USER_AGENTS)("criterion 3: %s → ignored, no counter, no write", async (_label, userAgent) => {
    const { log, recordBeaconEvent } = beaconHarness();

    expect(await recordBeaconEvent(aBeaconInput({ userAgent }))).toStrictEqual(ok("ignored"));
    expect(log.sequence()).toStrictEqual([]);
  });

  it("criterion 3: no user-agent → ignored, nothing called", async () => {
    const { log, recordBeaconEvent } = beaconHarness();

    expect(await recordBeaconEvent(aBeaconInput({ userAgent: null }))).toStrictEqual(ok("ignored"));
    expect(log.sequence()).toStrictEqual([]);
  });

  it("criterion 6: counter exhausted → ignored silently, nothing written", async () => {
    const { log, recordBeaconEvent } = beaconHarness({ limiter: { deny: ["beacon"] } });

    expect(await recordBeaconEvent(aBeaconInput())).toStrictEqual(ok("ignored"));
    expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
  });

  it("criterion 6: failing limiter → err('unexpected') and nothing written (the door closes)", async () => {
    const { log, recordBeaconEvent } = beaconHarness({ limiter: { failing: true } });

    expect(await recordBeaconEvent(aBeaconInput())).toStrictEqual(err("unexpected"));
    expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
  });

  it("decision 8: a replay of the same id consumes the counter again (deduplication does not protect against inflation)", async () => {
    const { log, recordBeaconEvent } = beaconHarness();

    await recordBeaconEvent(aBeaconInput());
    await recordBeaconEvent(aBeaconInput());

    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([BEACON_CONSUMPTION, BEACON_CONSUMPTION]);
  });

  it("criterion 2 / idempotence: executed twice, the same id reaches the recorder both times (no new id generated)", async () => {
    const { log, recordBeaconEvent } = beaconHarness();

    expect(await recordBeaconEvent(aBeaconInput())).toStrictEqual(ok("recorded"));
    expect(await recordBeaconEvent(aBeaconInput())).toStrictEqual(ok("recorded"));

    expect(log.inputsOf("events", "record").map((event) => (event as { id: string }).id)).toStrictEqual([EVENT_ID, EVENT_ID]);
  });

  it("decision 8: the id is passed to the recorder in lower case", async () => {
    const { log, recordBeaconEvent } = beaconHarness();

    await recordBeaconEvent(aBeaconInput({ id: EVENT_ID.toUpperCase() }));

    expect(log.inputsOf("events", "record")).toMatchObject([{ id: EVENT_ID }]);
  });

  it.each([
    ["an id that is not a uuid v4", { id: "3f2b8c1d-6e4a-1f7b-9c2d-1a0b9e8d7c6f" }],
    ["a server-only type (nfc_scan)", { type: "nfc_scan" }],
    ["a server-only type (vcard_download)", { type: "vcard_download" }],
    ["lead_submitted (written by capture_lead only)", { type: "lead_submitted" }],
    ["booking_confirmed (0039: written by book_slot only)", { type: "booking_confirmed" }],
    ["an unknown source", { source: "email" }],
    ["link_click without link", { type: "link_click" }],
    ["profile_view with a link", { linkId: LINK_ID }],
  ] as const)("decision 8: %s → ignored after the counter, nothing written", async (_label, overrides) => {
    const { log, recordBeaconEvent } = beaconHarness();

    expect(await recordBeaconEvent(aBeaconInput(overrides))).toStrictEqual(ok("ignored"));
    expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
  });

  it.each([
    ["path traversal", "../admin"],
    ["upper case", "Elodie-Durand"],
    ["too long", "a".repeat(41)],
    ["empty", ""],
  ])("a malformed slug (%s) → ignored, never sent to the database", async (_label, slug) => {
    const { log, recordBeaconEvent } = beaconHarness();

    expect(await recordBeaconEvent(aBeaconInput({ slug }))).toStrictEqual(ok("ignored"));
    expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
  });

  it("failing recorder → err('unexpected')", async () => {
    const { recordBeaconEvent } = beaconHarness({ events: { failing: true } });

    expect(await recordBeaconEvent(aBeaconInput())).toStrictEqual(err("unexpected"));
  });

  it("decision 1: nothing identifying reaches the recorder (no address, no user-agent)", async () => {
    const { log, recordBeaconEvent } = beaconHarness();

    await recordBeaconEvent(aBeaconInput());

    const written = JSON.stringify(log.inputsOf("events", "record"));
    expect(written).not.toContain(BEACON_CLIENT_ADDRESS);
    expect(written).not.toContain("iPhone");
  });
});

describe("recordServerEvent", () => {
  it.each([
    ["nfc_scan", "nfc"],
    ["qr_scan", "qr"],
    ["vcard_download", "direct"],
  ] as const)("decisions 3, 4 and 9: %s → scan counter (60/h), id generated on the server, source %s", async (type, source) => {
    const { log, recordServerEvent } = serverHarness();

    expect(await recordServerEvent(aServerEventInput({ type, userAgent: DESKTOP_USER_AGENT }))).toStrictEqual(ok("recorded"));

    expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "events.record"]);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([SCAN_CONSUMPTION]);
    expect(log.inputsOf("events", "record")).toStrictEqual([
      { id: FIXED_UUIDS[0], slug: PROFILE_SLUG, type, source, linkId: null, deviceClass: "desktop" },
    ]);
  });

  it("idempotence: two scans are two events (two ids), never a counter incremented", async () => {
    const { log, recordServerEvent } = serverHarness();

    await recordServerEvent(aServerEventInput());
    await recordServerEvent(aServerEventInput());

    expect(log.inputsOf("events", "record").map((event) => (event as { id: string }).id)).toStrictEqual([
      FIXED_UUIDS[0],
      FIXED_UUIDS[1],
    ]);
  });

  it.each(BOT_USER_AGENTS)("criterion 3: scan by %s → ignored, nothing called", async (_label, userAgent) => {
    const { log, recordServerEvent } = serverHarness();

    expect(await recordServerEvent(aServerEventInput({ userAgent }))).toStrictEqual(ok("ignored"));
    expect(log.sequence()).toStrictEqual([]);
  });

  it("criterion 3: scan without user-agent → ignored", async () => {
    const { log, recordServerEvent } = serverHarness();

    expect(await recordServerEvent(aServerEventInput({ type: "qr_scan", userAgent: null }))).toStrictEqual(ok("ignored"));
    expect(log.sequence()).toStrictEqual([]);
  });

  it("decision 9 / criterion 6: scan counter exhausted → ignored silently, nothing written", async () => {
    const { log, recordServerEvent } = serverHarness({ limiter: { deny: ["scan"] } });

    expect(await recordServerEvent(aServerEventInput())).toStrictEqual(ok("ignored"));
    expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
  });

  it("decision 9: failing limiter → ignored (not an error: redirection and vCard never blocked), nothing written", async () => {
    const { log, recordServerEvent } = serverHarness({ limiter: { failing: true } });

    expect(await recordServerEvent(aServerEventInput())).toStrictEqual(ok("ignored"));
    expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
  });

  it("malformed slug (vCard path parameter) → ignored, nothing written", async () => {
    const { log, recordServerEvent } = serverHarness();

    expect(await recordServerEvent(aServerEventInput({ slug: "../admin", type: "vcard_download" }))).toStrictEqual(ok("ignored"));
    expect(log.inputsOf("events", "record")).toStrictEqual([]);
  });

  it("criterion 4: failing recorder → err('unexpected') (the route ignores it)", async () => {
    const { recordServerEvent } = serverHarness({ events: { failing: true } });

    expect(await recordServerEvent(aServerEventInput())).toStrictEqual(err("unexpected"));
  });

  it("decision 1: nothing identifying reaches the recorder", async () => {
    const { log, recordServerEvent } = serverHarness();

    await recordServerEvent(aServerEventInput());

    const written = JSON.stringify(log.inputsOf("events", "record"));
    expect(written).not.toContain(BEACON_CLIENT_ADDRESS);
    expect(written).not.toContain("iPhone");
  });
});
