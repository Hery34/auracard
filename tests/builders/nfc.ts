import type { OwnNfcTag } from "@/domain/nfc/nfc-tag";

/** Crockford alphabet of 0024 (lower case, without `i l o u`): 12 characters for a tag, 8 for a QR code. */
export const TAG_UID = "7k2m9p4q8r3s";
export const OTHER_TAG_UID = "a1b2c3d4e5f6";
export const QR_CODE = "x4y5z6w7";

/** As printed with the tag (`XXXXX-XXXXX`, upper case) and as the database compares it (lower case, no hyphen). */
export const ACTIVATION_CODE = "ABCDE-FGH23";
export const NORMALIZED_ACTIVATION_CODE = "abcdefgh23";

export const TAG_ID = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
export const OTHER_TAG_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

export const CLIENT_ADDRESS = "203.0.113.42";

/** A tag of the caller as `listOwn` returns it: assigned, activated on 17/11/2026 at 10:00 UTC. */
export function anOwnNfcTag(overrides: Partial<OwnNfcTag> = {}): OwnNfcTag {
  return {
    id: TAG_ID,
    uid: TAG_UID,
    status: "assigned",
    activatedAt: "2026-11-17T10:00:00.000Z",
    ...overrides,
  };
}

/** Uids refused by the format `^[0-9a-hjkmnp-tv-z]{12}$` (decision 1): never sent to the database. */
export const MALFORMED_TAG_UIDS: ReadonlyArray<readonly [label: string, uid: string]> = [
  ["11 characters", "7k2m9p4q8r3"],
  ["13 characters", "7k2m9p4q8r3s5"],
  ["upper case", "7K2M9P4Q8R3S"],
  ["a letter outside the alphabet (i)", "7k2m9p4q8r3i"],
  ["a letter outside the alphabet (l)", "7k2m9p4q8rl3"],
  ["a letter outside the alphabet (o)", "7k2m9p4q8ro3"],
  ["a letter outside the alphabet (u)", "7k2m9p4q8ru3"],
  ["a hyphen", "7k2m9-4q8r3s"],
  ["an encoded slash", "7k2m9p%2F8r3s"],
  ["a dot segment", ".."],
  ["a trailing space", "7k2m9p4q8r3s "],
  ["a trailing newline", "7k2m9p4q8r3s\n"],
  ["empty", ""],
];

/** Codes refused by the format `^[0-9a-hjkmnp-tv-z]{8}$` (decision 2). */
export const MALFORMED_QR_CODES: ReadonlyArray<readonly [label: string, code: string]> = [
  ["7 characters", "x4y5z6w"],
  ["9 characters", "x4y5z6w78"],
  ["upper case", "X4Y5Z6W7"],
  ["a letter outside the alphabet (o)", "x4y5z6wo"],
  ["a tag uid (12 characters)", TAG_UID],
  ["empty", ""],
];

/** Every value an attacker could put in `suivant` (criterion 4): none of them is a return path. */
export const HOSTILE_RETURN_PATHS: ReadonlyArray<readonly [label: string, value: string]> = [
  ["protocol-relative URL", "//evil.example"],
  ["protocol-relative URL with the activation path", `//evil.example/activer/${TAG_UID}`],
  ["backslash host", "/\\evil.example"],
  ["two backslashes", "\\\\evil.example"],
  ["absolute https URL", "https://evil.example"],
  ["absolute URL ending with a valid activation path", `https://evil.example/activer/${TAG_UID}`],
  ["absolute URL of the site itself", `https://carnet.example/activer/${TAG_UID}`],
  ["javascript: URL", "javascript:alert(1)"],
  ["encoded protocol-relative URL", "%2F%2Fevil.example"],
  ["encoded activation path", `%2Factiver%2F${TAG_UID}`],
  ["partially encoded activation path", `/activer%2F${TAG_UID}`],
  ["double-encoded slash", `%252F%252Fevil.example`],
  ["the dashboard", "/tableau-de-bord"],
  ["the profile editor", "/tableau-de-bord/profil"],
  ["the root", "/"],
  ["activation path without uid", "/activer/"],
  ["activation path with an upper-case uid", `/activer/${TAG_UID.toUpperCase()}`],
  ["activation path with 11 characters", `/activer/${TAG_UID.slice(0, 11)}`],
  ["activation path with 13 characters", `/activer/${TAG_UID}a`],
  ["activation path with a letter outside the alphabet", "/activer/7k2m9p4q8r3i"],
  ["activation path with a trailing slash", `/activer/${TAG_UID}/`],
  ["activation path followed by a dot segment", `/activer/${TAG_UID}/../../tableau-de-bord`],
  ["activation path with a query", `/activer/${TAG_UID}?next=//evil.example`],
  ["activation path with a fragment", `/activer/${TAG_UID}#x`],
  ["activation path with a trailing newline", `/activer/${TAG_UID}\n`],
  ["activation path with a leading space", ` /activer/${TAG_UID}`],
  ["activation path with a different case", `/Activer/${TAG_UID}`],
  ["activation path with a double slash", `//activer/${TAG_UID}`],
  ["activation path behind a tab (stripped by URL parsers)", `/\t/evil.example/activer/${TAG_UID}`],
  ["empty", ""],
];
