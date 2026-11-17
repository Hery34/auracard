/**
 * Contract frozen by test-engineer (0025, decisions 1, 2, 5, 6 and 8). Pure TypeScript, no import outside src/domain.
 *
 * // src/domain/nfc/nfc-tag.ts
 * export const NFC_TAG_UID_PATTERN: RegExp;   // /^[0-9a-hjkmnp-tv-z]{12}$/
 * export const QR_CODE_PATTERN: RegExp;       // /^[0-9a-hjkmnp-tv-z]{8}$/
 * export const ACTIVATION_CODE_INPUT_MAX_LENGTH = 32;   // longest text accepted by the action and the field
 * export function isNfcTagUid(value: unknown): value is string;
 * export function isQrCode(value: unknown): value is string;
 * // Case and hyphens are free (decision 5): trim, remove every "-", lower case; then exactly 10 characters of the
 * // alphabet, else null. Internal spaces or any other character → null.
 * export function normalizeActivationCode(input: string): string | null;
 * // Last 4 characters of the uid (decision 8: "identifiant abrégé").
 * export function nfcTagShortId(uid: string): string;
 *
 * export type NfcResolution = { state: "active"; slug: string } | { state: "activation" } | { state: "not_found" };
 * // Answer of `carnet.activate_nfc_tag` (0024, decisions 6 and 9).
 * export type ActivationOutcome = "activated" | "already_yours" | "invalid" | "no_profile" | "rate_limited";
 * // A tag of the caller: stock tags have no owner and are never listed.
 * export type OwnNfcTagStatus = "assigned" | "disabled";
 * export type OwnNfcTag = { id: string; uid: string; status: OwnNfcTagStatus; activatedAt: string | null }; // ISO 8601
 *
 * // src/domain/nfc/ports.ts
 * export type NfcTagRepositoryError = "not_member" | "unexpected";    // 42501 → not_member
 * export interface NfcTagResolver { resolve(uid: string): Promise<Result<NfcResolution, "unexpected">> }  // anon
 * export interface QrCodeResolver { resolve(code: string): Promise<Result<string | null, "unexpected">> } // slug | null
 * // Under the session of the caller.
 * export interface NfcTagRepository {
 *   activate(uid: string, code: string): Promise<Result<ActivationOutcome, NfcTagRepositoryError>>;
 *   listOwn(): Promise<Result<OwnNfcTag[], "unexpected">>;
 *   setEnabled(tagId: string, enabled: boolean): Promise<Result<boolean, NfcTagRepositoryError>>; // found or not
 *   release(tagId: string): Promise<Result<boolean, NfcTagRepositoryError>>;                      // released now or not
 * }
 */
import { describe, expect, it } from "vitest";

import {
  ACTIVATION_CODE_INPUT_MAX_LENGTH,
  isNfcTagUid,
  isQrCode,
  NFC_TAG_UID_PATTERN,
  nfcTagShortId,
  normalizeActivationCode,
  QR_CODE_PATTERN,
} from "@/domain/nfc/nfc-tag";

import { MALFORMED_QR_CODES, MALFORMED_TAG_UIDS, QR_CODE, TAG_UID } from "../../../tests/builders/nfc";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

describe("isNfcTagUid (decision 1)", () => {
  it("accepts 12 characters of the Crockford alphabet in lower case", () => {
    expect(isNfcTagUid(TAG_UID)).toBe(true);
    expect(isNfcTagUid(ALPHABET.slice(0, 12))).toBe(true);
    expect(isNfcTagUid(ALPHABET.slice(-12))).toBe(true);
  });

  it.each(MALFORMED_TAG_UIDS)("refuses %s", (_label, uid) => {
    expect(isNfcTagUid(uid)).toBe(false);
  });

  it.each([null, undefined, 42, ["7k2m9p4q8r3s"], { uid: TAG_UID }])("refuses a non-string value %j", (value) => {
    expect(isNfcTagUid(value)).toBe(false);
  });

  it("NFC_TAG_UID_PATTERN is exactly ^[0-9a-hjkmnp-tv-z]{12}$", () => {
    expect(NFC_TAG_UID_PATTERN.source).toBe("^[0-9a-hjkmnp-tv-z]{12}$");
    expect(NFC_TAG_UID_PATTERN.flags).toBe("");
  });
});

describe("isQrCode (decision 2)", () => {
  it("accepts 8 characters of the Crockford alphabet in lower case", () => {
    expect(isQrCode(QR_CODE)).toBe(true);
  });

  it.each(MALFORMED_QR_CODES)("refuses %s", (_label, code) => {
    expect(isQrCode(code)).toBe(false);
  });

  it.each([null, undefined, 12345678])("refuses a non-string value %j", (value) => {
    expect(isQrCode(value)).toBe(false);
  });

  it("QR_CODE_PATTERN is exactly ^[0-9a-hjkmnp-tv-z]{8}$", () => {
    expect(QR_CODE_PATTERN.source).toBe("^[0-9a-hjkmnp-tv-z]{8}$");
    expect(QR_CODE_PATTERN.flags).toBe("");
  });
});

describe("normalizeActivationCode (decision 5: case and hyphen free)", () => {
  it.each([
    ["as printed", "ABCDE-FGH23"],
    ["lower case", "abcde-fgh23"],
    ["mixed case", "AbCdE-fGh23"],
    ["without hyphen", "ABCDEFGH23"],
    ["lower case without hyphen", "abcdefgh23"],
    ["hyphen elsewhere", "ABC-DEFGH23"],
    ["several hyphens", "AB-CDE-FG-H23"],
    ["surrounding spaces", "  ABCDE-FGH23 \t"],
  ])("%s → the 10 lower-case characters", (_label, input) => {
    expect(normalizeActivationCode(input)).toBe("abcdefgh23");
  });

  it.each([
    ["empty", ""],
    ["only a hyphen", "-"],
    ["9 characters", "ABCDE-FGH2"],
    ["11 characters", "ABCDE-FGH234"],
    ["a letter outside the alphabet (I)", "ABCDE-FGHI3"],
    ["a letter outside the alphabet (L)", "ABCDE-FGHL3"],
    ["a letter outside the alphabet (O)", "ABCDE-FGHO3"],
    ["a letter outside the alphabet (U)", "ABCDE-FGHU3"],
    ["an internal space", "ABCDE FGH23"],
    ["an underscore", "ABCDE_FGH23"],
    ["a quote (SQL)", "ABCDE'FGH23"],
    ["a full-width letter", "ＡBCDE-FGH23"],
  ])("%s → null", (_label, input) => {
    expect(normalizeActivationCode(input)).toBeNull();
  });

  it("ACTIVATION_CODE_INPUT_MAX_LENGTH is 32", () => {
    expect(ACTIVATION_CODE_INPUT_MAX_LENGTH).toBe(32);
  });
});

describe("nfcTagShortId (decision 8)", () => {
  it("is the last 4 characters of the uid", () => {
    expect(nfcTagShortId(TAG_UID)).toBe("8r3s");
    expect(nfcTagShortId("a1b2c3d4e5f6")).toBe("e5f6");
  });
});
