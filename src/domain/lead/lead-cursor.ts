/** Position of the last lead of a page, keyset order (createdAt desc, id desc). */
export type LeadCursor = { createdAt: string; id: string };

/** Longer than any encoded (timestamp with microseconds and offset, uuid). */
const MAX_ENCODED_LENGTH = 160;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/;

function toBase64Url(text: string): string {
  const binary = Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

function isTimestamp(text: string): boolean {
  const match = TIMESTAMP.exec(text);
  if (match === null) {
    return false;
  }
  const [year, month, day, hours, minutes, seconds, offsetHours, offsetMinutes] = match.slice(1).map((part) => Number(part ?? 0));
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day &&
    hours! < 24 &&
    minutes! < 60 &&
    seconds! < 60 &&
    offsetHours! < 24 &&
    offsetMinutes! < 60
  );
}

/** Opaque, URL-safe text for `?avant=`. */
export function encodeLeadCursor(cursor: LeadCursor): string {
  return toBase64Url(JSON.stringify([cursor.createdAt, cursor.id]));
}

/** `null` for anything that is not a valid cursor (the page then shows the first page). */
export function decodeLeadCursor(value: string | null | undefined): LeadCursor | null {
  if (value == null || value.length > MAX_ENCODED_LENGTH || !BASE64URL.test(value)) {
    return null;
  }
  const text = fromBase64Url(value);
  if (text === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    return null;
  }
  const [createdAt, id] = parsed as unknown[];
  if (typeof createdAt !== "string" || typeof id !== "string" || !isTimestamp(createdAt) || !UUID.test(id)) {
    return null;
  }
  return { createdAt, id: id.toLowerCase() };
}
