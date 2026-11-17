/** Crockford alphabet of 0024 in lower case (without `i l o u`): 12 characters for a tag uid, 8 for a QR code. */
export const NFC_TAG_UID_PATTERN = /^[0-9a-hjkmnp-tv-z]{12}$/;
export const QR_CODE_PATTERN = /^[0-9a-hjkmnp-tv-z]{8}$/;

const ACTIVATION_CODE_PATTERN = /^[0-9a-hjkmnp-tv-z]{10}$/;

/** Longest text accepted for the activation code field (printed form `XXXXX-XXXXX`, case and hyphens free). */
export const ACTIVATION_CODE_INPUT_MAX_LENGTH = 32;

const SHORT_ID_LENGTH = 4;

export type NfcResolution = { state: "active"; slug: string } | { state: "activation" } | { state: "not_found" };

/** Answer of `carnet.activate_nfc_tag`. */
export type ActivationOutcome = "activated" | "already_yours" | "invalid" | "no_profile" | "rate_limited";

/** A tag of the caller: stock tags have no owner and are never listed. */
export type OwnNfcTagStatus = "assigned" | "disabled";

/** `activatedAt`: ISO 8601. */
export type OwnNfcTag = { id: string; uid: string; status: OwnNfcTagStatus; activatedAt: string | null };

export function isNfcTagUid(value: unknown): value is string {
  return typeof value === "string" && NFC_TAG_UID_PATTERN.test(value);
}

export function isQrCode(value: unknown): value is string {
  return typeof value === "string" && QR_CODE_PATTERN.test(value);
}

/** Trimmed, hyphens removed, lower case; `null` unless exactly 10 characters of the alphabet remain. */
export function normalizeActivationCode(input: string): string | null {
  const normalized = input.trim().replaceAll("-", "").toLowerCase();
  return ACTIVATION_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function nfcTagShortId(uid: string): string {
  return uid.slice(-SHORT_ID_LENGTH);
}
