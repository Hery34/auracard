import { contrastRatio, relativeLuminance } from "@/domain/qr/contrast";

/** jsonb `style` of `carnet.qr_codes`. */
export type QrStyle = { fg: string; bg: string; logo: boolean };

export const DEFAULT_QR_STYLE: QrStyle = { fg: "#000000", bg: "#ffffff", logo: false };

/** Same format as `carnet.is_valid_qr_style`. */
export const QR_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

export const QR_MIN_CONTRAST = 4.5;

export type QrColorError = "invalid_color" | "not_darker" | "low_contrast";

export type QrErrorCorrectionLevel = "M" | "H";

export const QR_LOGO_MAX_RATIO = 0.2;

export function isQrColor(value: unknown): value is string {
  return typeof value === "string" && QR_COLOR_PATTERN.test(value);
}

/** Dark modules on a light background, contrast ≥ 4.5:1: the first rule broken, or `null`. */
export function checkQrColors(fg: string, bg: string): QrColorError | null {
  if (!isQrColor(fg) || !isQrColor(bg)) {
    return "invalid_color";
  }
  if (relativeLuminance(fg) >= relativeLuminance(bg)) {
    return "not_darker";
  }
  if (contrastRatio(fg, bg) < QR_MIN_CONTRAST) {
    return "low_contrast";
  }
  return null;
}

export function qrErrorCorrectionLevel(withLogo: boolean): QrErrorCorrectionLevel {
  return withLogo ? "H" : "M";
}

export function qrLogoSide(qrSide: number): number {
  return Math.floor(qrSide * QR_LOGO_MAX_RATIO);
}
