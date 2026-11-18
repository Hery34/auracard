/**
 * Contract frozen by test-engineer (0032, decision 10: keyset pagination by (created_at, id), passed in `?avant=`).
 *
 * // src/domain/lead/lead-cursor.ts — pure TypeScript (no Node.js Buffer: domain purity rule)
 * export type LeadCursor = { createdAt: string; id: string };
 * // Opaque, URL-safe text ([A-Za-z0-9_-] only, usable in `?avant=` without encoding): neither the id nor the
 * // timestamp appear in clear. createdAt is the timestamptz text of PostgREST, kept to the microsecond (a Date would
 * // lose the microseconds and skip or repeat leads between pages).
 * export function encodeLeadCursor(cursor: LeadCursor): string;
 * // null for anything that is not a cursor produced by encodeLeadCursor from a valid (createdAt, id): absent, empty,
 * // garbage, longer than a cursor can be, createdAt not an ISO 8601 timestamp with offset (or an impossible date),
 * // id not a uuid. A valid cursor gives the id in lower case. The page then shows the first page (decision 10).
 * // The value reaches a PostgREST filter: nothing outside the two formats may pass (no `,`, `(`, `)`, `.`-operators).
 * export function decodeLeadCursor(value: string | null | undefined): LeadCursor | null;
 */
import { describe, expect, it } from "vitest";

import { decodeLeadCursor, encodeLeadCursor } from "@/domain/lead/lead-cursor";

import { aLeadCursor, LEAD_IDS } from "../../../tests/builders/lead";

const URL_SAFE = /^[A-Za-z0-9_-]+$/;

function base64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("encodeLeadCursor / decodeLeadCursor", () => {
  it("decision 10: round trip, microseconds and offset kept exactly", () => {
    const cursor = aLeadCursor({ createdAt: "2026-11-18T10:15:30.123456+00:00" });

    expect(decodeLeadCursor(encodeLeadCursor(cursor))).toStrictEqual(cursor);
  });

  it.each([
    ["without fraction", "2026-11-18T10:15:30+00:00"],
    ["milliseconds, Z", "2026-03-29T01:59:59.999Z"],
    ["another offset", "2026-10-25T02:30:00.5+02:00"],
  ])("round trip of a timestamp %s", (_label, createdAt) => {
    const cursor = aLeadCursor({ createdAt });

    expect(decodeLeadCursor(encodeLeadCursor(cursor))).toStrictEqual(cursor);
  });

  it("decision 10: opaque and URL-safe — neither the id nor the timestamp in clear", () => {
    const cursor = aLeadCursor();
    const text = encodeLeadCursor(cursor);

    expect(text).toMatch(URL_SAFE);
    expect(text).not.toContain(cursor.id);
    expect(text).not.toContain("2026-11-18");
    expect(encodeURIComponent(text)).toBe(text);
  });

  it("two different cursors give two different values (same timestamp, different id)", () => {
    const first = encodeLeadCursor(aLeadCursor({ id: LEAD_IDS[0] }));
    const second = encodeLeadCursor(aLeadCursor({ id: LEAD_IDS[1] }));

    expect(first).not.toBe(second);
  });

  it("an upper-case id is given back in lower case", () => {
    const decoded = decodeLeadCursor(encodeLeadCursor(aLeadCursor({ id: LEAD_IDS[0].toUpperCase() })));

    expect(decoded?.id).toBe(LEAD_IDS[0]);
  });

  it.each([
    ["absent (undefined)", undefined],
    ["absent (null)", null],
    ["empty", ""],
    ["garbage", "pas-un-curseur"],
    ["characters outside base64url", "%%%"],
    ["a raw timestamp", "2026-11-18T10:15:30.123456+00:00"],
    ["a raw uuid", LEAD_IDS[0]],
    ["base64url of plain text", base64Url("hello world")],
    ["base64url of an unrelated JSON", base64Url(JSON.stringify({ createdAt: "x", id: "y" }))],
    ["far too long", "A".repeat(10_000)],
  ])("decision 10: %s → null (first page)", (_label, value) => {
    expect(decodeLeadCursor(value)).toBeNull();
  });

  it.each([
    ["not a timestamp", "hier"],
    ["a date without time", "2026-11-18"],
    ["a timestamp without offset", "2026-11-18T10:15:30.123456"],
    ["an impossible date", "2026-13-45T25:61:00+00:00"],
    ["more than microseconds", "2026-11-18T10:15:30.1234567+00:00"],
    ["a PostgREST filter injected after the timestamp", "2026-11-18T10:15:30+00:00,id.gt.0"],
    ["a closing parenthesis", "2026-11-18T10:15:30+00:00)"],
  ])("decision 10: a cursor whose timestamp is %s → null", (_label, createdAt) => {
    expect(decodeLeadCursor(encodeLeadCursor(aLeadCursor({ createdAt })))).toBeNull();
  });

  it.each([
    ["not a uuid", "abc"],
    ["a uuid followed by a filter", `${LEAD_IDS[0]},created_at.gt.2000-01-01`],
    ["empty", ""],
  ])("decision 10: a cursor whose id is %s → null", (_label, id) => {
    expect(decodeLeadCursor(encodeLeadCursor(aLeadCursor({ id })))).toBeNull();
  });
});
