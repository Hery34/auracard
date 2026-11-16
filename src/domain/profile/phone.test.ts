/**
 * Contract frozen by test-engineer (0017, decision 2: profiles_phone_length_check = 32).
 *
 * // src/domain/profile/phone.ts — pure TypeScript
 * export type Phone = string & { readonly __brand: "Phone" };
 * export const PHONE_MAX_LENGTH = 32;
 * export function parsePhone(text: string): Result<Phone, "invalid_phone">;
 *   // no trim here (the schema trims); 1 to 32 characters; only digits, spaces, ".", "-", "(", ")",
 *   // and one optional "+" in first position; at least one digit. Value returned unchanged.
 */
import { describe, expect, it } from "vitest";

import { parsePhone, PHONE_MAX_LENGTH } from "@/domain/profile/phone";
import { err, ok } from "@/domain/shared/result";

describe("Phone", () => {
  it("PHONE_MAX_LENGTH is 32 (profiles_phone_length_check)", () => {
    expect(PHONE_MAX_LENGTH).toBe(32);
  });

  it.each(["+33 6 12 34 56 78", "06.12.34.56.78", "06-12-34-56-78", "(0)6 12 34 56 78", "+1 (555) 010-9999", "0612345678"])(
    "accepts %j unchanged",
    (text) => {
      expect(parsePhone(text)).toStrictEqual(ok(text));
    },
  );

  it("accepts exactly 32 characters", () => {
    const text = `+${"1".repeat(31)}`;

    expect(parsePhone(text)).toStrictEqual(ok(text));
  });

  it.each([
    ["an empty text", ""],
    ["33 characters", "1".repeat(33)],
    ["letters", "06 12 ab 34 56"],
    ["markup", "+33<script>"],
    ["a plus sign not in first position", "33+612345678"],
    ["two plus signs", "++33612345678"],
    ["no digit at all", "+ ()"],
    ["a line feed", "06 12\n34 56 78"],
    ["a right-to-left override (U+202E)", "06\u202e12345678"],
    ["a no-break space", "06\u00a012345678"],
  ])("refuses %s with invalid_phone", (_label, text) => {
    expect(parsePhone(text)).toStrictEqual(err("invalid_phone"));
  });
});
