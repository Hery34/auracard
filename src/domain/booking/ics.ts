export type BookingIcsInput = {
  bookingId: string;
  start: Temporal.Instant;
  end: Temporal.Instant;
  title: string;
  ownerName: string;
  /** Address of an in_person type; null (phone, video) → no LOCATION line. */
  location: string | null;
  now: Temporal.Instant;
};

const MAX_LINE_OCTETS = 75;
const encoder = new TextEncoder();

/**
 * RFC 5545 calendar with one VEVENT, times in UTC; the UID is stable so that a second download replaces the same
 * event. Nothing about the visitor and no token.
 */
export function bookingIcs({ bookingId, start, end, title, ownerName, location, now }: BookingIcsInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//carnet//booking//FR",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${bookingId}@carnet`,
    `DTSTAMP:${utcDateTime(now)}`,
    `DTSTART:${utcDateTime(start)}`,
    `DTEND:${utcDateTime(end)}`,
    `SUMMARY:${escapeText(`${title} — ${ownerName}`)}`,
    ...(location === null ? [] : [`LOCATION:${escapeText(location)}`]),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** "YYYYMMDDTHHMMSSZ". */
function utcDateTime(instant: Temporal.Instant): string {
  return instant.toString({ smallestUnit: "second" }).replace(/[-:]/g, "");
}

/** RFC 5545 §3.3.11: backslash, semicolon, comma, line breaks. */
function escapeText(text: string): string {
  return text.replace(/[\\;,]/g, (character) => `\\${character}`).replace(/\r\n|\r|\n/g, "\\n");
}

/** RFC 5545 §3.1: at most 75 octets per line, continuations start with one space; never splits a code point. */
function fold(line: string): string {
  const chunks: string[] = [];
  let chunk = "";
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    const limit = chunks.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (octets + size > limit) {
      chunks.push(chunk);
      chunk = "";
      octets = 0;
    }
    chunk += character;
    octets += size;
  }
  chunks.push(chunk);
  return chunks.join("\r\n ");
}
