/**
 * Contract frozen by test-engineer (0032, decision 14; 0020 decision 11; 0017 decision 10): the « multiline text » rule,
 * factored out and shared by the bio of the profile and the message of the contact form.
 *
 * // src/server/actions/multiline-text.ts — next to single-line-text.ts
 * // \r\n and lone \r → \n, then trimmed; at most `maxLength` characters counted after normalization;
 * // none of FORBIDDEN_LABEL_CHARACTERS (src/domain/profile/link.ts) except \n — U+200C and U+200D allowed.
 * // No minimal length: the caller adds it (the lead message requires 1 character, the bio may be blank → null).
 * export function multilineText(maxLength: number): z.ZodType<string, string>;
 * // Used by updateProfileSchema (bio, PROFILE_TEXT_MAX_LENGTH.bio) and leadSubmissionSchema (message,
 * // LEAD_TEXT_MAX_LENGTH.message).
 */
import { describe, expect, it } from "vitest";

import { parseLeadSubmission } from "@/server/actions/lead-schemas";
import { multilineText } from "@/server/actions/multiline-text";
import { updateProfileSchema } from "@/server/actions/profile-schemas";

import { aLeadDraft } from "../../../tests/builders/lead";

/** Invisible code points are built at run time: the repository never holds them literally (0031 review). */
function cp(codePoint: number): string {
  return String.fromCodePoint(codePoint);
}

const FORBIDDEN = [
  ["a tab", "\t"],
  ["a bell character (U+0007)", cp(0x07)],
  ["DEL (U+007F)", cp(0x7f)],
  ["NEL (U+0085)", cp(0x85)],
  ["a soft hyphen (U+00AD)", cp(0xad)],
  ["an Arabic letter mark (U+061C)", cp(0x61c)],
  ["a zero-width space (U+200B)", cp(0x200b)],
  ["a line separator (U+2028)", cp(0x2028)],
  ["a paragraph separator (U+2029)", cp(0x2029)],
  ["a right-to-left override (U+202E)", cp(0x202e)],
  ["a word joiner (U+2060)", cp(0x2060)],
  ["a left-to-right isolate (U+2066)", cp(0x2066)],
  ["an inner byte order mark (U+FEFF)", cp(0xfeff)],
] as const;

function accepted(schema: ReturnType<typeof multilineText>, text: string): string | null {
  const parsed = schema.safeParse(text);
  return parsed.success ? parsed.data : null;
}

describe("multilineText (decision 14: one rule for the bio and the message)", () => {
  const rule = multilineText(20);

  it("\\r\\n and lone \\r → \\n; \\n kept", () => {
    expect(accepted(multilineText(100), "Ligne 1\r\nLigne 2\rLigne 3\nFin")).toBe("Ligne 1\nLigne 2\nLigne 3\nFin");
  });

  it("trimmed after normalization", () => {
    expect(accepted(rule, " \r\n Bonjour \r ")).toBe("Bonjour");
  });

  it("the bound is counted after normalization: 20 characters sent with \\r\\n accepted, 21 refused", () => {
    const twenty = `${"a".repeat(9)}\r\n${"b".repeat(10)}`;
    const twentyOne = `${"a".repeat(10)}\r\n${"b".repeat(10)}`;

    expect(accepted(rule, twenty)).toBe(`${"a".repeat(9)}\n${"b".repeat(10)}`);
    expect(accepted(rule, twentyOne)).toBeNull();
  });

  it("no minimal length of its own (an empty text is the caller's business)", () => {
    expect(accepted(rule, "")).toBe("");
  });

  it("U+200C and U+200D allowed (emoji sequences, as in the link label)", () => {
    const text = `mi${cp(0x200c)}x ${cp(0x1f469)}${cp(0x200d)}${cp(0x1f4bb)}`;

    expect(accepted(multilineText(100), text)).toBe(text);
  });

  it.each(FORBIDDEN)("refuses %s", (_label, character) => {
    expect(accepted(rule, `Bon${character}jour`)).toBeNull();
  });
});

describe("the bio and the lead message apply the same rule (no regression of profile-schemas)", () => {
  const bio = updateProfileSchema.shape.bio;

  function bioVerdict(text: string): string | null {
    const parsed = bio.safeParse(text);
    return parsed.success ? parsed.data : "refused";
  }

  function messageVerdict(text: string): string | null {
    const parsed = parseLeadSubmission(aLeadDraft({ message: text }));
    return parsed.ok ? parsed.value.message : "refused";
  }

  const cases: ReadonlyArray<readonly [label: string, text: string, expected: string]> = [
    ["CRLF line breaks", "Ligne 1\r\nLigne 2", "Ligne 1\nLigne 2"],
    ["lone CR line breaks", "Ligne 1\rLigne 2\r\rLigne 4", "Ligne 1\nLigne 2\n\nLigne 4"],
    ["surrounding blanks", "  Bonjour \r\n", "Bonjour"],
    ["HTML kept as plain text", "<b>gras</b> & <i>x</i>", "<b>gras</b> & <i>x</i>"],
    ...FORBIDDEN.map(([label, character]) => [label, `Bon${character}jour`, "refused"] as const),
  ];

  it.each(cases)("%s → same verdict for the bio and the message", (_label, text, expected) => {
    expect(bioVerdict(text)).toBe(expected);
    expect(messageVerdict(text)).toBe(expected);
  });
});
