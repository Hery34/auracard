import type { OwnQrCode } from "@/domain/qr/ports";
import type { QrStyle } from "@/domain/qr/qr-style";

import { QR_CODE } from "./nfc";

export { QR_CODE };

/** Public origin as `env.SITE_URL` hands it (no trailing slash). */
export const QR_SITE_URL = "https://carnet.example";
export const QR_CODE_URL = `${QR_SITE_URL}/q/${QR_CODE}`;

/** Logo of the profile as the reader builds it (0021): a public URL of `carnet-media`. */
export const LOGO_URL =
  "http://127.0.0.1:54321/storage/v1/object/public/carnet-media/9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f/logo-0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.png";

/** Default style of `carnet.qr_codes` (0024): black modules, white background, no logo. */
export function aQrStyle(overrides: Partial<QrStyle> = {}): QrStyle {
  return { fg: "#000000", bg: "#ffffff", logo: false, ...overrides };
}

/** A valid branded style: navy modules on cream (contrast ≈ 13:1), with the logo. */
export const BRANDED_QR_STYLE: QrStyle = { fg: "#1a2b4c", bg: "#fdf6e3", logo: true };

export function anOwnQrCode(overrides: Partial<OwnQrCode> = {}): OwnQrCode {
  return { code: QR_CODE, style: aQrStyle(), ...overrides };
}

/** Contrast with white just under 4.5:1 (4.49984…, would round to 4.5) and just over (4.50032…): no rounding. */
export const JUST_UNDER_MIN_CONTRAST_FG = "#e31976";
export const JUST_OVER_MIN_CONTRAST_FG = "#ab6076";

/** Colours refused by the format `^#[0-9a-f]{6}$` of `carnet.is_valid_qr_style`. */
export const MALFORMED_QR_COLORS: ReadonlyArray<readonly [label: string, color: string]> = [
  ["upper case", "#FFFFFF"],
  ["mixed case", "#1A2b4c"],
  ["short form", "#fff"],
  ["without #", "000000"],
  ["7 hex digits", "#0000000"],
  ["with alpha", "#000000ff"],
  ["a non-hex digit", "#00000g"],
  ["a CSS name", "black"],
  ["an rgb() colour", "rgb(0, 0, 0)"],
  ["a leading space", " #000000"],
  ["a trailing newline", "#000000\n"],
  ["empty", ""],
];

/** Colour pairs refused by decision 4, with the first rule broken (format, then darker modules, then contrast). */
export const REFUSED_QR_COLOR_PAIRS: ReadonlyArray<
  readonly [label: string, fg: string, bg: string, error: "invalid_color" | "not_darker" | "low_contrast"]
> = [
  ["upper-case modules", "#FFFFFF", "#000000", "invalid_color"],
  ["upper-case background", "#000000", "#FFFFFF", "invalid_color"],
  ["identical colours", "#336699", "#336699", "not_darker"],
  ["inverted (white modules on black)", "#ffffff", "#000000", "not_darker"],
  ["light modules on a slightly darker background (both rules broken)", "#777777", "#555555", "not_darker"],
  ["dark on dark (contrast ≈ 1.66:1)", "#000000", "#333333", "low_contrast"],
  ["grey #777777 on white (≈ 4.48:1)", "#777777", "#ffffff", "low_contrast"],
  ["4.4998:1 (no rounding)", JUST_UNDER_MIN_CONTRAST_FG, "#ffffff", "low_contrast"],
];

/** Colour pairs accepted by decision 4. */
export const ACCEPTED_QR_COLOR_PAIRS: ReadonlyArray<readonly [label: string, fg: string, bg: string]> = [
  ["black on white (21:1)", "#000000", "#ffffff"],
  ["grey #767676 on white (≈ 4.54:1)", "#767676", "#ffffff"],
  ["4.5003:1", JUST_OVER_MIN_CONTRAST_FG, "#ffffff"],
  ["navy on cream", BRANDED_QR_STYLE.fg, BRANDED_QR_STYLE.bg],
  ["pure blue on white (≈ 8.59:1)", "#0000ff", "#ffffff"],
];
