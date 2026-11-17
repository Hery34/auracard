import type { PublicProfile } from "@/domain/profile/profile";

const CRLF = "\r\n";
/** RFC 2425 §5.8.1, CRLF excluded; a continuation line spends one of them on its leading space. */
const MAX_LINE_OCTETS = 75;
const CONTINUATION = " ";

const TEXT_CONTROL_CHARACTERS = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const URI_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

type Encode = (value: string) => string;

/** vCard 3.0 (RFC 2426): UTF-8, CRLF, text escaping, folding at 75 octets on whole code points. */
export function serializeVCard(profile: PublicProfile, options: { profileUrl: string }): string {
  const name = text(profile.displayName);
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${name};;;;`,
    `FN:${name}`,
    property("ORG", profile.company, text),
    property("TITLE", profile.jobTitle, text),
    property("EMAIL;TYPE=INTERNET", profile.contactEmail, text),
    property("TEL;TYPE=CELL", profile.phone, text),
    property("URL", profile.websiteUrl, uri),
    property("URL", options.profileUrl, uri),
    property("NOTE", profile.bio, text),
    "END:VCARD",
  ];
  return lines
    .filter((line): line is string => line !== null)
    .map((line) => fold(line) + CRLF)
    .join("");
}

function property(name: string, value: string | null, encode: Encode): string | null {
  return value === null || value === "" ? null : `${name}:${encode(value)}`;
}

function text(value: string): string {
  return value
    .replace(TEXT_CONTROL_CHARACTERS, "")
    .replace(/[\\,;]/g, (character) => `\\${character}`)
    .replace(/\r\n|\r|\n/g, "\\n");
}

function uri(value: string): string {
  return value.replace(URI_CONTROL_CHARACTERS, "");
}

function fold(line: string): string {
  const physicalLines: string[] = [];
  let current = "";
  let octets = 0;
  for (const codePoint of line) {
    const size = utf8Octets(codePoint);
    if (octets + size > MAX_LINE_OCTETS) {
      physicalLines.push(current);
      current = CONTINUATION;
      octets = CONTINUATION.length;
    }
    current += codePoint;
    octets += size;
  }
  physicalLines.push(current);
  return physicalLines.join(CRLF);
}

function utf8Octets(codePoint: string): number {
  const value = codePoint.codePointAt(0) ?? 0;
  if (value < 0x80) return 1;
  if (value < 0x800) return 2;
  if (value < 0x10000) return 3;
  return 4;
}
