/**
 * Contract frozen by test-engineer (0026, decisions 2 to 5 and 7; lot A). Pure TypeScript, no dependency: nothing is
 * imported outside src/domain (no `uqr`, no Next.js, no Supabase, no Zod; the ESLint domain rule covers the first ones).
 *
 * // src/domain/qr/contrast.ts — WCAG 2.x, colours in the `#rrggbb` lower-case form only.
 * // sRGB channel c = v / 255 → c ≤ 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4;
 * // L = 0.2126 R + 0.7152 G + 0.0722 B (0 for black, 1 for white).
 * export function relativeLuminance(color: string): number;
 * // (lighter + 0.05) / (darker + 0.05), symmetric, between 1 and 21, never rounded.
 * export function contrastRatio(first: string, second: string): number;
 *
 * // src/domain/qr/qr-style.ts
 * export type QrStyle = { fg: string; bg: string; logo: boolean };         // jsonb `style` of carnet.qr_codes
 * export const DEFAULT_QR_STYLE: QrStyle;                                    // { fg: "#000000", bg: "#ffffff", logo: false }
 * export const QR_COLOR_PATTERN: RegExp;                                     // /^#[0-9a-f]{6}$/ (as carnet.is_valid_qr_style)
 * export function isQrColor(value: unknown): value is string;
 * export const QR_MIN_CONTRAST = 4.5;
 * export type QrColorError = "invalid_color" | "not_darker" | "low_contrast";
 * // First rule broken, in this order: a colour outside QR_COLOR_PATTERN → invalid_color; relativeLuminance(fg) not
 * // strictly lower than relativeLuminance(bg) → not_darker (equal colours included); contrastRatio < 4.5 → low_contrast;
 * // else null. Used by the page (live check) and by the save use case (before any port call).
 * export function checkQrColors(fg: string, bg: string): QrColorError | null;
 * export type QrErrorCorrectionLevel = "M" | "H";
 * export function qrErrorCorrectionLevel(withLogo: boolean): QrErrorCorrectionLevel;   // H with logo, M without
 * export const QR_LOGO_MAX_RATIO = 0.2;
 * // Side of the logo for a QR of side `qrSide` (same unit): Math.floor(qrSide * QR_LOGO_MAX_RATIO), never more than 20 %.
 * export function qrLogoSide(qrSide: number): number;
 *
 * // src/domain/qr/qr-url.ts
 * // Decision 2: `${siteUrl}/q/${code}`; siteUrl is the origin of env.SITE_URL (no trailing slash).
 * export function qrCodeUrl(siteUrl: string, code: string): string;
 *
 * // src/domain/qr/ports.ts — under the session of the caller (functions of 0024).
 * export type OwnQrCode = { code: string; style: QrStyle };
 * export interface QrCodeRepository {
 *   // carnet.ensure_qr_code(): created on first call, then always the same row. 42501 → no_profile.
 *   ensureOwn(): Promise<Result<OwnQrCode, "no_profile" | "unexpected">>;
 *   // carnet.set_qr_style(p_style): 42501 → no_profile, 22023 → invalid; unchanged style → no write.
 *   setStyle(style: QrStyle): Promise<Result<OwnQrCode, "no_profile" | "invalid" | "unexpected">>;
 * }
 */
import { describe, expect, it } from "vitest";

import {
  checkQrColors,
  DEFAULT_QR_STYLE,
  isQrColor,
  QR_COLOR_PATTERN,
  QR_LOGO_MAX_RATIO,
  QR_MIN_CONTRAST,
  qrErrorCorrectionLevel,
  qrLogoSide,
} from "@/domain/qr/qr-style";

import {
  ACCEPTED_QR_COLOR_PAIRS,
  BRANDED_QR_STYLE,
  MALFORMED_QR_COLORS,
  REFUSED_QR_COLOR_PAIRS,
} from "../../../tests/builders/qr";

describe("QR colours (criterion 2, decision 4)", () => {
  it("the default style of carnet.qr_codes is black on white without logo, and passes the rule", () => {
    expect(DEFAULT_QR_STYLE).toStrictEqual({ fg: "#000000", bg: "#ffffff", logo: false });
    expect(checkQrColors(DEFAULT_QR_STYLE.fg, DEFAULT_QR_STYLE.bg)).toBeNull();
  });

  it("the minimum contrast is 4.5:1", () => {
    expect(QR_MIN_CONTRAST).toBe(4.5);
  });

  it.each(ACCEPTED_QR_COLOR_PAIRS)("criterion 2: %s → accepted (null)", (_label, fg, bg) => {
    expect(checkQrColors(fg, bg)).toBeNull();
  });

  it.each(REFUSED_QR_COLOR_PAIRS)("criterion 2: %s → %s", (_label, fg, bg, error) => {
    expect(checkQrColors(fg, bg)).toBe(error);
  });

  it("criterion 2: inverting an accepted pair is refused (light modules on a dark background)", () => {
    for (const [, fg, bg] of ACCEPTED_QR_COLOR_PAIRS) {
      expect(checkQrColors(bg, fg)).toBe("not_darker");
    }
  });

  it.each(MALFORMED_QR_COLORS)("a modules colour with %s → invalid_color", (_label, color) => {
    expect(checkQrColors(color, "#ffffff")).toBe("invalid_color");
  });

  it.each(MALFORMED_QR_COLORS)("a background colour with %s → invalid_color", (_label, color) => {
    expect(checkQrColors("#000000", color)).toBe("invalid_color");
  });

  it("the branded builder style passes the rule", () => {
    expect(checkQrColors(BRANDED_QR_STYLE.fg, BRANDED_QR_STYLE.bg)).toBeNull();
  });
});

describe("isQrColor and QR_COLOR_PATTERN (format of carnet.is_valid_qr_style)", () => {
  it("is ^#[0-9a-f]{6}$", () => {
    expect(QR_COLOR_PATTERN.source).toBe("^#[0-9a-f]{6}$");
    expect(QR_COLOR_PATTERN.flags).toBe("");
  });

  it.each(["#000000", "#ffffff", "#1a2b4c", "#abcdef"])("%s → true", (color) => {
    expect(isQrColor(color)).toBe(true);
  });

  it.each(MALFORMED_QR_COLORS)("%s → false", (_label, color) => {
    expect(isQrColor(color)).toBe(false);
  });

  it.each([[null], [undefined], [0x000000], [{ fg: "#000000" }]])("%j → false", (value) => {
    expect(isQrColor(value)).toBe(false);
  });
});

describe("error correction level (criterion 3, decision 5)", () => {
  it("criterion 3: with the logo → H", () => {
    expect(qrErrorCorrectionLevel(true)).toBe("H");
  });

  it("without logo → M", () => {
    expect(qrErrorCorrectionLevel(false)).toBe("M");
  });
});

describe("logo size (criterion 3, decision 5)", () => {
  it("the ratio is 20 % of the side", () => {
    expect(QR_LOGO_MAX_RATIO).toBe(0.2);
  });

  it.each([
    [1024, 204],
    [1000, 200],
    [250, 50],
    [100, 20],
    [33, 6],
    [4, 0],
  ])("criterion 3: QR of side %i → logo of side %i", (qrSide, logoSide) => {
    expect(qrLogoSide(qrSide)).toBe(logoSide);
  });

  it("criterion 3: never more than 20 % of the side, never a whole unit less", () => {
    for (let qrSide = 1; qrSide <= 2048; qrSide += 1) {
      const logoSide = qrLogoSide(qrSide);
      expect(Number.isInteger(logoSide)).toBe(true);
      expect(logoSide).toBeLessThanOrEqual(qrSide * 0.2);
      expect(logoSide).toBeGreaterThan(qrSide * 0.2 - 1);
    }
  });
});
