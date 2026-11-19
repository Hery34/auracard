import { FORBIDDEN_LABEL_CHARACTERS } from "@/domain/profile/link";
import { err, ok, type Result } from "@/domain/shared/result";

export const LOCATION_KINDS = ["in_person", "phone", "video"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/** Positions 0 to 9 (`event_types_position_check`). */
export const MAX_EVENT_TYPES = 10;
export const EVENT_TYPE_TITLE_MAX_LENGTH = 80;
export const LOCATION_TEXT_MAX_LENGTH = 500;
export const EVENT_TYPE_BOUNDS = {
  durationMin: { min: 5, max: 480 },
  bufferMin: { min: 0, max: 240 },
  minNoticeMin: { min: 0, max: 43200 },
} as const;
/** ADR 0016 §6, default of `event_types.min_notice_min`. */
export const DEFAULT_MIN_NOTICE_MIN = 120;

export const EVENT_TYPE_FIELDS = ["title", "durationMin", "bufferMin", "minNoticeMin", "locationKind", "locationText"] as const;
export type EventTypeField = (typeof EVENT_TYPE_FIELDS)[number];

export type EventTypeDraft = {
  title: string;
  durationMin: number;
  bufferMin: number;
  minNoticeMin: number;
  locationKind: LocationKind;
  locationText: string | null;
};

export type EventType = EventTypeDraft & { id: string; isActive: boolean; position: number };

/** Numbers already converted (NaN possible), strings untrimmed. */
export type EventTypeInput = {
  title: string;
  durationMin: number;
  bufferMin: number;
  minNoticeMin: number;
  locationKind: string;
  locationText: string | null;
};

type BoundedField = keyof typeof EVENT_TYPE_BOUNDS;

const BOUNDED_FIELDS: readonly BoundedField[] = ["durationMin", "bufferMin", "minNoticeMin"];

export function isLocationKind(value: string): value is LocationKind {
  return (LOCATION_KINDS as readonly string[]).includes(value);
}

/** Single line, as `carnet.is_valid_plain_text(…, false)`; length in code points, as `char_length`. */
function isPlainLine(text: string, maxLength: number): boolean {
  return [...text].length <= maxLength && !FORBIDDEN_LABEL_CHARACTERS.test(text);
}

/**
 * Every invalid field, in `EVENT_TYPE_FIELDS` order, never a value. Location by mode (ADR 0016 §3): an address for
 * `in_person`, a fixed visio link for `video`, optional for `phone`; a blank text becomes `null`.
 */
export function parseEventTypeDraft(input: EventTypeInput): Result<EventTypeDraft, EventTypeField[]> {
  const invalid = new Set<EventTypeField>();

  const title = input.title.trim();
  if (title === "" || !isPlainLine(title, EVENT_TYPE_TITLE_MAX_LENGTH)) {
    invalid.add("title");
  }
  for (const field of BOUNDED_FIELDS) {
    const value = input[field];
    const { min, max } = EVENT_TYPE_BOUNDS[field];
    if (!Number.isInteger(value) || value < min || value > max) {
      invalid.add(field);
    }
  }
  const locationKind = isLocationKind(input.locationKind) ? input.locationKind : null;
  if (locationKind === null) {
    invalid.add("locationKind");
  }
  const trimmed = input.locationText?.trim() ?? "";
  const locationText = trimmed === "" ? null : trimmed;
  const locationRequired = locationKind !== null && locationKind !== "phone";
  const locationValid =
    locationText === null ? !locationRequired : isPlainLine(locationText, LOCATION_TEXT_MAX_LENGTH);
  if (!locationValid) {
    invalid.add("locationText");
  }

  if (invalid.size > 0 || locationKind === null) {
    return err(EVENT_TYPE_FIELDS.filter((field) => invalid.has(field)));
  }
  return ok({
    title,
    durationMin: input.durationMin,
    bufferMin: input.bufferMin,
    minNoticeMin: input.minNoticeMin,
    locationKind,
    locationText,
  });
}

/** Lowest position in 0…9 not taken; `null` when the ten are taken. */
export function firstFreePosition(positions: readonly number[]): number | null {
  const taken = new Set(positions);
  for (let position = 0; position < MAX_EVENT_TYPES; position += 1) {
    if (!taken.has(position)) {
      return position;
    }
  }
  return null;
}

/** `ordered` holds exactly the ids of `current`, each once. */
export function isPermutationOf(current: readonly string[], ordered: readonly string[]): boolean {
  const known = new Set(current);
  return ordered.length === known.size && new Set(ordered).size === ordered.length && ordered.every((id) => known.has(id));
}
