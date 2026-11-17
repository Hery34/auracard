/**
 * Contract frozen by test-engineer (0018, decision 10: e-mail revalidated at display time).
 *
 * // src/ui/features/profile/safe-email.ts
 * export function safeEmail(value: string | null): string | null;
 * // The stored `contact_email` is untrusted (the database only checks its length and control characters): it is shown
 * // and revealed as `mailto:` only when it has the strict editor format (Zod `z.email()` default pattern, at most 254
 * // characters), returned unchanged (no trimming, no case change); anything else → null (the e-mail is not shown).
 * // Strict format: local part of ASCII letters, digits, `.`, `_`, `'`, `+`, `-` (no leading dot, no `..`, last
 * // character not `.` nor `'`), one `@`, domain of dot-separated labels of ASCII letters, digits and `-` (a label never
 * // starts with `-`), top-level label of at least 2 letters. Hence refused: `?`, `&`, `/`, `:`, `%`, `#`, `=`, `,`,
 * // `;`, `<`, `>`, `"`, `\`, spaces, controls, non-ASCII.
 */
import { describe, expect, it } from "vitest";

import { safeEmail } from "@/ui/features/profile/safe-email";

describe("safeEmail — revalidation of the stored e-mail at display time (0018, decision 10)", () => {
  it.each([
    ["a simple address", "elodie@atelier-merel.example"],
    ["dots and a plus tag", "elodie.durand+carte@atelier-merel.example"],
    ["an apostrophe, an underscore and a dash", "o'neil_jean-paul@example.fr"],
    ["uppercase letters, kept as is", "Elodie.Durand@Atelier-Merel.FR"],
    ["a sub-domain", "contact@mail.atelier-merel.example"],
    ["254 characters", `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(58)}.fr`],
  ])("keeps %s unchanged", (_case, value) => {
    expect(value.length).toBeLessThanOrEqual(254);
    expect(safeEmail(value)).toBe(value);
  });

  it("returns null for a missing value", () => {
    expect(safeEmail(null)).toBeNull();
  });

  it.each([
    ["a query (?bcc=)", "x@y.fr?bcc=a@b.c"],
    ["a query (?subject=)", "x@y.fr?subject=Bonjour"],
    ["an ampersand", "x&bcc=a@y.fr"],
    ["a slash", "x/y@y.fr"],
    ["a slash in the domain", "x@y.fr/path"],
    ["a colon", "mailto:x@y.fr"],
    ["a colon in the domain", "x@y.fr:25"],
    ["a percent sign", "x%3Fbcc@y.fr"],
    ["a hash", "x#y@y.fr"],
    ["an equal sign", "x=y@y.fr"],
    ["a comma (two addresses)", "x@y.fr,a@b.fr"],
    ["a semicolon (two addresses)", "x@y.fr;a@b.fr"],
    ["angle brackets", "<x@y.fr>"],
    ["a markup", "<script>@y.fr"],
    ["a double quote", '"x"@y.fr'],
    ["a backslash", "x\\y@y.fr"],
    ["an inner space", "x y@y.fr"],
    ["a leading space", " x@y.fr"],
    ["a trailing space", "x@y.fr "],
    ["a tab", "x\t@y.fr"],
    ["a line feed", "x@y.fr\nBcc: a@b.c"],
    ["a carriage return", "x@y.fr\r"],
    ["a NUL character", "x\u0000@y.fr"],
    ["a DEL character", "x\u007f@y.fr"],
    ["a right-to-left override", "x‮@y.fr"],
    ["a non-ASCII local part", "élodie@y.fr"],
    ["a non-ASCII domain", "x@café.fr"],
    ["no @", "x.y.fr"],
    ["two @", "x@y@y.fr"],
    ["an empty local part", "@y.fr"],
    ["a domain without a dot", "x@localhost"],
    ["a one-letter top-level label", "x@y.f"],
    ["a numeric top-level label", "x@192.168.1.10"],
    ["a leading dot", ".x@y.fr"],
    ["two consecutive dots", "x..y@y.fr"],
    ["a dot before @", "x.@y.fr"],
    ["a domain label starting with a dash", "x@-y.fr"],
    ["255 characters", `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(59)}.fr`],
    ["an empty string", ""],
  ])("returns null for %s", (_case, value) => {
    expect(safeEmail(value)).toBeNull();
  });
});
