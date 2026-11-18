/**
 * Contract frozen by test-engineer (0029, decisions 2, 5, 6 and 8; lists of 0028).
 *
 * // src/domain/analytics/analytics-event.ts
 * export const ANALYTICS_EVENT_TYPES: readonly ["profile_view", "nfc_scan", "qr_scan", "vcard_download", "link_click",
 *   "contact_click", "lead_submitted"];                         export type AnalyticsEventType
 * export const ANALYTICS_SOURCES: readonly ["nfc", "qr", "direct"];        export type AnalyticsSource
 * export const DEVICE_CLASSES: readonly ["mobile", "desktop"];            export type DeviceClass
 * export const BEACON_EVENT_TYPES: readonly ["profile_view", "link_click", "contact_click"]; export type BeaconEventType
 * export const SERVER_EVENT_TYPES: readonly ["nfc_scan", "qr_scan", "vcard_download"];      export type ServerEventType
 * export type AnalyticsEvent = { id: string; slug: string; type: AnalyticsEventType; source: AnalyticsSource;
 *   linkId: string | null; deviceClass: DeviceClass };   // slug resolved by record_public_event (0034, decision 9)
 * export function isUuidV4(value: string): boolean;              // canonical 8-4-4-4-12, version 4, variant 8|9|a|b, any case
 * export function sourceFromQuery(value: string | null): AnalyticsSource;   // "nfc" | "qr" exactly, else "direct"
 * export function sourceOfServerEvent(type: ServerEventType): AnalyticsSource; // nfc_scan→nfc, qr_scan→qr, vcard_download→direct
 * export type BeaconEventDraft = { id: string; type: string; source: string; linkId: string | null };
 * export type ValidBeaconEvent = { id: string; type: BeaconEventType; source: AnalyticsSource; linkId: string | null };
 * export function parseBeaconEvent(draft: BeaconEventDraft): Result<ValidBeaconEvent, "invalid_event">;
 * //   id: uuid v4 (returned in lower case); type: beacon types only; source: list; linkId: required (any canonical
 * //   uuid, returned in lower case) for link_click, forbidden otherwise.
 */
import { describe, expect, it } from "vitest";

import {
  ANALYTICS_EVENT_TYPES,
  ANALYTICS_SOURCES,
  BEACON_EVENT_TYPES,
  DEVICE_CLASSES,
  SERVER_EVENT_TYPES,
  isUuidV4,
  parseBeaconEvent,
  sourceFromQuery,
  sourceOfServerEvent,
} from "@/domain/analytics/analytics-event";
import { err, ok } from "@/domain/shared/result";

import { EVENT_ID, LINK_ID } from "../../../tests/builders/analytics";

const DRAFT = { id: EVENT_ID, type: "profile_view", source: "direct", linkId: null };

describe("value lists (same as the checks of 0028)", () => {
  it("seven event types, three sources, two device classes", () => {
    expect([...ANALYTICS_EVENT_TYPES]).toStrictEqual([
      "profile_view",
      "nfc_scan",
      "qr_scan",
      "vcard_download",
      "link_click",
      "contact_click",
      "lead_submitted",
    ]);
    expect([...ANALYTICS_SOURCES]).toStrictEqual(["nfc", "qr", "direct"]);
    expect([...DEVICE_CLASSES]).toStrictEqual(["mobile", "desktop"]);
  });

  it("decision 5: the page sends profile_view, link_click and contact_click only", () => {
    expect([...BEACON_EVENT_TYPES]).toStrictEqual(["profile_view", "link_click", "contact_click"]);
  });

  it("decisions 3 and 4: the server writes nfc_scan, qr_scan and vcard_download only", () => {
    expect([...SERVER_EVENT_TYPES]).toStrictEqual(["nfc_scan", "qr_scan", "vcard_download"]);
  });
});

describe("isUuidV4", () => {
  it.each([EVENT_ID, EVENT_ID.toUpperCase(), "00000000-0000-4000-8000-000000000000", "ffffffff-ffff-4fff-bfff-ffffffffffff"])(
    "decision 8: %s is a uuid v4",
    (value) => {
      expect(isUuidV4(value)).toBe(true);
    },
  );

  it.each([
    ["version 1", "3f2b8c1d-6e4a-1f7b-9c2d-1a0b9e8d7c6f"],
    ["version 7", "0193a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b"],
    ["variant c", "3f2b8c1d-6e4a-4f7b-cc2d-1a0b9e8d7c6f"],
    ["nil uuid", "00000000-0000-0000-0000-000000000000"],
    ["without hyphens", "3f2b8c1d6e4a4f7b9c2d1a0b9e8d7c6f"],
    ["braces", `{${EVENT_ID}}`],
    ["trailing space", `${EVENT_ID} `],
    ["trailing newline", `${EVENT_ID}\n`],
    ["one character short", EVENT_ID.slice(0, -1)],
    ["non-hex character", "3f2b8c1d-6e4a-4f7b-9c2d-1a0b9e8d7c6g"],
    ["empty", ""],
  ])("decision 8: %s is refused", (_label, value) => {
    expect(isUuidV4(value)).toBe(false);
  });
});

describe("sourceFromQuery", () => {
  it("decision 5: ?s=nfc → nfc, ?s=qr → qr", () => {
    expect(sourceFromQuery("nfc")).toBe("nfc");
    expect(sourceFromQuery("qr")).toBe("qr");
  });

  it.each([null, "", "direct", "NFC", "nfc ", "email", "qr&s=nfc"])("decision 5: %j → direct", (value) => {
    expect(sourceFromQuery(value)).toBe("direct");
  });
});

describe("sourceOfServerEvent", () => {
  it("decisions 3 and 4: nfc_scan → nfc, qr_scan → qr, vcard_download → direct", () => {
    expect(sourceOfServerEvent("nfc_scan")).toBe("nfc");
    expect(sourceOfServerEvent("qr_scan")).toBe("qr");
    expect(sourceOfServerEvent("vcard_download")).toBe("direct");
  });
});

describe("parseBeaconEvent", () => {
  it("a profile_view of a direct visit is valid", () => {
    expect(parseBeaconEvent(DRAFT)).toStrictEqual(ok({ id: EVENT_ID, type: "profile_view", source: "direct", linkId: null }));
  });

  it.each(["nfc", "qr", "direct"])("source %s is accepted", (source) => {
    expect(parseBeaconEvent({ ...DRAFT, source }).ok).toBe(true);
  });

  it("contact_click without link is valid", () => {
    expect(parseBeaconEvent({ ...DRAFT, type: "contact_click" })).toStrictEqual(
      ok({ id: EVENT_ID, type: "contact_click", source: "direct", linkId: null }),
    );
  });

  it("link_click carries its link", () => {
    expect(parseBeaconEvent({ ...DRAFT, type: "link_click", linkId: LINK_ID })).toStrictEqual(
      ok({ id: EVENT_ID, type: "link_click", source: "direct", linkId: LINK_ID }),
    );
  });

  it("decision 8: an id in upper case is accepted and returned in lower case (one row per event)", () => {
    expect(parseBeaconEvent({ ...DRAFT, id: EVENT_ID.toUpperCase() })).toStrictEqual(
      ok({ id: EVENT_ID, type: "profile_view", source: "direct", linkId: null }),
    );
  });

  it("decision 8: an id that is not a uuid v4 is refused", () => {
    expect(parseBeaconEvent({ ...DRAFT, id: "3f2b8c1d-6e4a-1f7b-9c2d-1a0b9e8d7c6f" })).toStrictEqual(err("invalid_event"));
    expect(parseBeaconEvent({ ...DRAFT, id: "1" })).toStrictEqual(err("invalid_event"));
  });

  it.each(["nfc_scan", "qr_scan", "vcard_download", "lead_submitted"])(
    "decisions 3, 4 and 6: the page cannot send %s (written by the server only)",
    (type) => {
      expect(parseBeaconEvent({ ...DRAFT, type })).toStrictEqual(err("invalid_event"));
    },
  );

  it.each(["", "PROFILE_VIEW", "page_view"])("unknown type %j is refused", (type) => {
    expect(parseBeaconEvent({ ...DRAFT, type })).toStrictEqual(err("invalid_event"));
  });

  it.each(["", "email", "NFC"])("unknown source %j is refused", (source) => {
    expect(parseBeaconEvent({ ...DRAFT, source })).toStrictEqual(err("invalid_event"));
  });

  it("link_click without link is refused", () => {
    expect(parseBeaconEvent({ ...DRAFT, type: "link_click" })).toStrictEqual(err("invalid_event"));
  });

  it.each(["profile_view", "contact_click"])("%s with a link is refused", (type) => {
    expect(parseBeaconEvent({ ...DRAFT, type, linkId: LINK_ID })).toStrictEqual(err("invalid_event"));
  });

  it("a link that is not a uuid is refused", () => {
    expect(parseBeaconEvent({ ...DRAFT, type: "link_click", linkId: "position-3" })).toStrictEqual(err("invalid_event"));
  });
});
