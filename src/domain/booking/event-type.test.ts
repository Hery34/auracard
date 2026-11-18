/**
 * Contract frozen by test-engineer (0038, decisions 1 and 3; bounds of carnet.event_types, 0036 decision 2).
 *
 * // src/domain/booking/event-type.ts — pure TypeScript, no Zod (architecture.md §3).
 * export const LOCATION_KINDS = ["in_person", "phone", "video"] as const;
 * export type LocationKind = (typeof LOCATION_KINDS)[number];
 * export const MAX_EVENT_TYPES = 10;                          // positions 0 to 9 (event_types_position_check)
 * export const EVENT_TYPE_TITLE_MAX_LENGTH = 80;              // code points, as char_length
 * export const LOCATION_TEXT_MAX_LENGTH = 500;
 * export const EVENT_TYPE_BOUNDS = {
 *   durationMin: { min: 5, max: 480 }, bufferMin: { min: 0, max: 240 }, minNoticeMin: { min: 0, max: 43200 },
 * } as const;
 * export const DEFAULT_MIN_NOTICE_MIN = 120;                  // ADR 0016 §6, column default
 * export const EVENT_TYPE_FIELDS = ["title", "durationMin", "bufferMin", "minNoticeMin", "locationKind", "locationText"] as const;
 * export type EventTypeField = (typeof EVENT_TYPE_FIELDS)[number];
 * export type EventTypeDraft = {
 *   title: string; durationMin: number; bufferMin: number; minNoticeMin: number;
 *   locationKind: LocationKind; locationText: string | null;
 * };
 * export type EventType = EventTypeDraft & { id: string; isActive: boolean; position: number };
 * // What the action hands over: numbers already converted with Number() (NaN possible), strings untrimmed.
 * export type EventTypeInput = {
 *   title: string; durationMin: number; bufferMin: number; minNoticeMin: number; locationKind: string; locationText: string | null;
 * };
 * // Every invalid field, in EVENT_TYPE_FIELDS order; never echoes a value. Title and location text: JavaScript trim(),
 * // FORBIDDEN_LABEL_CHARACTERS of @/domain/profile/link refused (same list as carnet.is_valid_plain_text(…, false):
 * // line breaks refused). Numbers: integers within EVENT_TYPE_BOUNDS. Blank location text → null.
 * // Location by mode (ADR 0016 §3): in_person → address required; video → fixed visio link (text) required;
 * // phone → text optional (the visitor gives a number).
 * export function parseEventTypeDraft(input: EventTypeInput): Result<EventTypeDraft, EventTypeField[]>;
 * // Lowest position in 0…9 not taken by `positions`; null when the ten are taken.
 * export function firstFreePosition(positions: readonly number[]): number | null;
 * // True when `ordered` holds exactly the ids of `current`, each once, in any order.
 * export function isPermutationOf(current: readonly string[], ordered: readonly string[]): boolean;
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MIN_NOTICE_MIN,
  EVENT_TYPE_BOUNDS,
  EVENT_TYPE_FIELDS,
  EVENT_TYPE_TITLE_MAX_LENGTH,
  LOCATION_KINDS,
  LOCATION_TEXT_MAX_LENGTH,
  MAX_EVENT_TYPES,
  firstFreePosition,
  isPermutationOf,
  parseEventTypeDraft,
  type EventTypeDraft,
  type EventTypeInput,
} from "@/domain/booking/event-type";
import { err, ok } from "@/domain/shared/result";

import { EVENT_TYPE_IDS, anEventTypeDraft } from "../../../tests/builders/booking-settings";

function input(overrides: Partial<EventTypeInput> = {}): EventTypeInput {
  return { ...anEventTypeDraft(), ...overrides };
}

describe("event type bounds (0036 decision 2)", () => {
  it("same bounds as carnet.event_types", () => {
    expect(LOCATION_KINDS).toStrictEqual(["in_person", "phone", "video"]);
    expect(MAX_EVENT_TYPES).toBe(10);
    expect(EVENT_TYPE_TITLE_MAX_LENGTH).toBe(80);
    expect(LOCATION_TEXT_MAX_LENGTH).toBe(500);
    expect(EVENT_TYPE_BOUNDS).toStrictEqual({
      durationMin: { min: 5, max: 480 },
      bufferMin: { min: 0, max: 240 },
      minNoticeMin: { min: 0, max: 43200 },
    });
    expect(DEFAULT_MIN_NOTICE_MIN).toBe(120);
    expect(EVENT_TYPE_FIELDS).toStrictEqual(["title", "durationMin", "bufferMin", "minNoticeMin", "locationKind", "locationText"]);
  });
});

describe("parseEventTypeDraft — criterion 1 (creation and modification of the types)", () => {
  it("a valid type is accepted as is", () => {
    expect(parseEventTypeDraft(input())).toStrictEqual(ok(anEventTypeDraft()));
  });

  it("title and location text are trimmed (JavaScript trim, Unicode spaces included)", () => {
    expect(
      parseEventTypeDraft(input({ title: "  Appel découverte  ", locationText: "  https://visio.example.test/elodie " })),
    ).toStrictEqual(ok(anEventTypeDraft()));
  });

  it.each([
    ["an empty title", ""],
    ["a blank title", "   "],
    ["a title of 81 code points", "é".repeat(81)],
    ["a title with a line break", "Appel\ndécouverte"],
    ["a title with an invisible character (U+200B)", "Appel​découverte"],
    ["a title with a bidi override (U+202E)", "Appel‮découverte"],
  ])("refuses %s → ['title']", (_label, title) => {
    expect(parseEventTypeDraft(input({ title }))).toStrictEqual(err(["title"]));
  });

  it("a title of exactly 80 code points (astral characters counted once) is accepted", () => {
    const title = "😀".repeat(80);

    expect(parseEventTypeDraft(input({ title }))).toStrictEqual(ok(anEventTypeDraft({ title })));
  });

  it.each([
    ["durationMin", 5, true],
    ["durationMin", 480, true],
    ["durationMin", 4, false],
    ["durationMin", 481, false],
    ["durationMin", 30.5, false],
    ["durationMin", Number.NaN, false],
    ["bufferMin", 0, true],
    ["bufferMin", 240, true],
    ["bufferMin", -1, false],
    ["bufferMin", 241, false],
    ["minNoticeMin", 0, true],
    ["minNoticeMin", 43200, true],
    ["minNoticeMin", -1, false],
    ["minNoticeMin", 43201, false],
    ["minNoticeMin", Number.POSITIVE_INFINITY, false],
  ] as const)("%s = %d → accepted: %s (integer within the bounds of the database)", (field, value, accepted) => {
    const patch = { [field]: value } as Partial<EventTypeDraft>;
    const result = parseEventTypeDraft(input(patch));

    expect(result).toStrictEqual(accepted ? ok(anEventTypeDraft(patch)) : err([field]));
  });

  it("an unknown location kind is refused → ['locationKind']", () => {
    expect(parseEventTypeDraft(input({ locationKind: "zoom" }))).toStrictEqual(err(["locationKind"]));
  });

  it("ADR 0016 §3: in person → the address is required", () => {
    expect(parseEventTypeDraft(input({ locationKind: "in_person", locationText: null }))).toStrictEqual(err(["locationText"]));
    expect(parseEventTypeDraft(input({ locationKind: "in_person", locationText: "   " }))).toStrictEqual(err(["locationText"]));
    expect(parseEventTypeDraft(input({ locationKind: "in_person", locationText: "12 rue des Lilas, 69003 Lyon" }))).toStrictEqual(
      ok(anEventTypeDraft({ locationKind: "in_person", locationText: "12 rue des Lilas, 69003 Lyon" })),
    );
  });

  it("ADR 0016 §3: video → the fixed visio link is required", () => {
    expect(parseEventTypeDraft(input({ locationKind: "video", locationText: null }))).toStrictEqual(err(["locationText"]));
    expect(parseEventTypeDraft(input({ locationKind: "video", locationText: "" }))).toStrictEqual(err(["locationText"]));
  });

  it("ADR 0016 §3: phone → the text is optional, a blank one becomes null", () => {
    expect(parseEventTypeDraft(input({ locationKind: "phone", locationText: "  " }))).toStrictEqual(
      ok(anEventTypeDraft({ locationKind: "phone", locationText: null })),
    );
    expect(parseEventTypeDraft(input({ locationKind: "phone", locationText: "Je vous appelle" }))).toStrictEqual(
      ok(anEventTypeDraft({ locationKind: "phone", locationText: "Je vous appelle" })),
    );
  });

  it.each([
    ["of 501 code points", "a".repeat(501)],
    ["with a line break (single line in the database)", "12 rue des Lilas\n69003 Lyon"],
    ["with an invisible character (U+2060)", "12 rue⁠des Lilas"],
  ])("a location text %s is refused → ['locationText']", (_label, locationText) => {
    expect(parseEventTypeDraft(input({ locationKind: "in_person", locationText }))).toStrictEqual(err(["locationText"]));
  });

  it("a location text of exactly 500 code points is accepted", () => {
    const locationText = "a".repeat(500);

    expect(parseEventTypeDraft(input({ locationKind: "in_person", locationText }))).toStrictEqual(
      ok(anEventTypeDraft({ locationKind: "in_person", locationText })),
    );
  });

  it("every invalid field is reported, in form order, without any value", () => {
    expect(
      parseEventTypeDraft({
        title: " ",
        durationMin: 0,
        bufferMin: 999,
        minNoticeMin: -5,
        locationKind: "teams",
        locationText: "x".repeat(600),
      }),
    ).toStrictEqual(err(["title", "durationMin", "bufferMin", "minNoticeMin", "locationKind", "locationText"]));
  });
});

describe("firstFreePosition — decision 3 and note of 0036 (positions 0 to 9, look for a free one)", () => {
  it("no type → 0", () => {
    expect(firstFreePosition([])).toBe(0);
  });

  it("returns the lowest free position, gaps left by deletions first", () => {
    expect(firstFreePosition([0, 1, 2])).toBe(3);
    expect(firstFreePosition([0, 2, 3])).toBe(1);
    expect(firstFreePosition([9, 1, 0])).toBe(2);
  });

  it("ten positions taken → null (at most 10 types)", () => {
    expect(firstFreePosition([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeNull();
    expect(firstFreePosition([9, 8, 7, 6, 5, 4, 3, 2, 1, 0])).toBeNull();
  });
});

describe("isPermutationOf — reordering (criterion 1)", () => {
  const current = [EVENT_TYPE_IDS[0], EVENT_TYPE_IDS[1], EVENT_TYPE_IDS[2]];

  it("the same ids in another order → true", () => {
    expect(isPermutationOf(current, [EVENT_TYPE_IDS[2], EVENT_TYPE_IDS[0], EVENT_TYPE_IDS[1]])).toBe(true);
    expect(isPermutationOf(current, current)).toBe(true);
    expect(isPermutationOf([], [])).toBe(true);
  });

  it.each([
    ["a missing id", [EVENT_TYPE_IDS[0], EVENT_TYPE_IDS[1]]],
    ["an extra id", [...current, EVENT_TYPE_IDS[3]]],
    ["an unknown id instead of a known one", [EVENT_TYPE_IDS[0], EVENT_TYPE_IDS[1], EVENT_TYPE_IDS[3]]],
    ["a duplicated id", [EVENT_TYPE_IDS[0], EVENT_TYPE_IDS[0], EVENT_TYPE_IDS[1]]],
  ])("%s → false (stale or forged list)", (_label, ordered) => {
    expect(isPermutationOf(current, ordered)).toBe(false);
  });
});
