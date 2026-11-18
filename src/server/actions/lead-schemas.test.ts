/**
 * Contract frozen by test-engineer (0032, decisions 2, 3, 9 and 14; bounds of 0031). Moved from src/domain/lead/
 * (decision 14: Zod out of the domain, architecture.md §3, ADR 0012 §2), on the model of profile-schemas.ts.
 *
 * // src/server/actions/lead-schemas.ts — module without directive (imported by the action and by the tests)
 * // Text fields of the form as `textFields` reads them (absent → undefined).
 * export type LeadDraft = { name: string | undefined; email: string | undefined; message: string | undefined;
 *   consent: string | undefined; idempotencyKey: string | undefined };
 * // Strict Zod schema (z.object(...) with z.email(), .min/.max); unknown keys stripped; LeadSubmission of the domain.
 * export const leadSubmissionSchema: z.ZodType<LeadSubmission, LeadDraft>;
 * // ok(submission) or err(every invalid field, in LEAD_INVALID_FIELDS order). Never echoes a value.
 * //   name: trimmed, 1–100, none of FORBIDDEN_LABEL_CHARACTERS (0022 list = carnet.is_valid_plain_text, no line break);
 * //   email: trimmed, z.email(), ≤ 254;
 * //   message: multilineText(LEAD_TEXT_MAX_LENGTH.message) (src/server/actions/multiline-text.ts, shared with the
 * //     bio: \r\n and lone \r → \n, trimmed, none of FORBIDDEN_LABEL_CHARACTERS except \n), then at least 1 character;
 * //   consent: exactly "on" (checkbox ticked) — consent_at is set by the database only after this check (decision 9);
 * //   idempotencyKey: uuid, lower-cased.
 * export function parseLeadSubmission(draft: LeadDraft): Result<LeadSubmission, LeadInvalidField[]>;
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { leadSubmissionSchema, parseLeadSubmission, type LeadDraft } from "@/server/actions/lead-schemas";

import { aLeadDraft, aLeadSubmission, IDEMPOTENCY_KEY } from "../../../tests/builders/lead";

const DOMAIN_DIR = fileURLToPath(new URL("../../domain", import.meta.url));

/** Invisible code points are built at run time: the repository never holds them literally (0031 review). */
function cp(codePoint: number): string {
  return String.fromCodePoint(codePoint);
}

function invalidFields(draft: LeadDraft) {
  const result = parseLeadSubmission(draft);
  return result.ok ? [] : result.error;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file))
    .map((file) => path.join(directory, file));
}

describe("decision 14: Zod out of the domain", () => {
  it("no file of src/domain imports zod (the lead schema lives in src/server/actions/lead-schemas.ts)", () => {
    const offenders = sourceFiles(DOMAIN_DIR).filter((file) => /from\s+["']zod(\/[^"']*)?["']/.test(readFileSync(file, "utf8")));

    expect(offenders.map((file) => path.relative(DOMAIN_DIR, file))).toStrictEqual([]);
  });

  it("leadSubmissionSchema is a Zod schema exported by the actions layer", () => {
    expect(leadSubmissionSchema.safeParse(aLeadDraft())).toStrictEqual({ success: true, data: aLeadSubmission() });
  });
});

describe("parseLeadSubmission", () => {
  it("criterion 1: a valid draft → the submission, trimmed, consent dropped (consent_at is the server's)", () => {
    expect(
      parseLeadSubmission(
        aLeadDraft({ name: "  Jean Visiteur ", email: " jean.visiteur@example.test ", message: "  Bonjour.\r\nÀ bientôt.\r " }),
      ),
    ).toStrictEqual({
      ok: true,
      value: {
        name: "Jean Visiteur",
        email: "jean.visiteur@example.test",
        message: "Bonjour.\nÀ bientôt.",
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    });
  });

  it("the idempotency key is lower-cased (one lead whatever the case sent)", () => {
    const result = parseLeadSubmission(aLeadDraft({ idempotencyKey: IDEMPOTENCY_KEY.toUpperCase() }));

    expect(result.ok && result.value.idempotencyKey).toBe(IDEMPOTENCY_KEY);
  });

  it("unknown keys (profile_id, consent_at…) are stripped", () => {
    const draft = { ...aLeadDraft(), profile_id: "x", consent_at: "2020-01-01" } as LeadDraft;
    const result = parseLeadSubmission(draft);

    expect(result.ok && Object.keys(result.value).sort()).toStrictEqual(["email", "idempotencyKey", "message", "name"]);
  });

  it("decision 9: consent not ticked (absent) → refused on the consent field", () => {
    expect(invalidFields(aLeadDraft({ consent: undefined }))).toStrictEqual(["consent"]);
  });

  it.each([["", "empty"], ["off", "off"], ["true", "true"], ["ON", "upper case"]])(
    "decision 9: consent %j (%s) → refused",
    (consent) => {
      expect(invalidFields(aLeadDraft({ consent }))).toStrictEqual(["consent"]);
    },
  );

  it.each([
    ["name", 100],
    ["message", 2000],
  ] as const)("decision 9: %s accepts %d characters and refuses one more", (field, max) => {
    expect(invalidFields(aLeadDraft({ [field]: "n".repeat(max) }))).toStrictEqual([]);
    expect(invalidFields(aLeadDraft({ [field]: "n".repeat(max + 1) }))).toStrictEqual([field]);
  });

  it("decision 9: the bounds apply after trimming", () => {
    expect(invalidFields(aLeadDraft({ name: `  ${"n".repeat(100)}  ` }))).toStrictEqual([]);
  });

  it("decision 9: e-mail accepts 254 characters and refuses 255", () => {
    const domain = "@example.test";
    const local = "a".repeat(254 - domain.length);

    expect(invalidFields(aLeadDraft({ email: `${local}${domain}` }))).toStrictEqual([]);
    expect(invalidFields(aLeadDraft({ email: `${local}a${domain}` }))).toStrictEqual(["email"]);
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["blank", "   "],
  ])("decision 9: minimal length — name %s → refused", (_label, name) => {
    expect(invalidFields(aLeadDraft({ name }))).toStrictEqual(["name"]);
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["blank lines only", " \r\n \n "],
  ])("decision 9: minimal length — message %s → refused", (_label, message) => {
    expect(invalidFields(aLeadDraft({ message }))).toStrictEqual(["message"]);
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["without @", "jean.example.test"],
    ["without domain", "jean@"],
    ["without dot in the domain (z.email)", "jean@example"],
    ["two @", "jean@@example.test"],
    ["an inner space", "jean visiteur@example.test"],
    ["a comma (second recipient)", "jean@example.test,autre@example.test"],
    ["angle brackets", "<jean@example.test>"],
    ["a line feed (header injection)", "jean@example.test\nBcc: autre@example.test"],
  ])("decision 9: e-mail %s → refused (z.email)", (_label, email) => {
    expect(invalidFields(aLeadDraft({ email }))).toStrictEqual(["email"]);
  });

  it.each([
    ["a line feed", "Jean\nVisiteur"],
    ["a carriage return", "Jean\rVisiteur"],
    ["a control character (U+0007)", `Je${cp(0x07)}an`],
    ["a right-to-left override (U+202E)", `Je${cp(0x202e)}an`],
    ["a zero-width space (U+200B)", `Je${cp(0x200b)}an`],
    ["an inner byte order mark (U+FEFF)", `Je${cp(0xfeff)}an`],
  ])("0031 charset: name with %s -> refused", (_label, name) => {
    expect(invalidFields(aLeadDraft({ name }))).toStrictEqual(["name"]);
  });

  it.each([
    ["a bell character (U+0007)", `Bon${cp(0x07)}jour`],
    ["a tab", "Bonjour\ta vous"],
    ["a right-to-left override (U+202E)", `Bon${cp(0x202e)}jour`],
    ["a line separator (U+2028)", `Bon${cp(0x2028)}jour`],
    ["a left-to-right isolate (U+2066)", `Bon${cp(0x2066)}jour`],
  ])("0031 charset: message with %s -> refused", (_label, message) => {
    expect(invalidFields(aLeadDraft({ message }))).toStrictEqual(["message"]);
  });

  it("the message keeps its line breaks and its HTML as plain text (rendered literally, decision 11)", () => {
    const message = "Ligne 1\nLigne 2\n<b>gras</b> & <script>alert(1)</script>";
    const result = parseLeadSubmission(aLeadDraft({ message }));

    expect(result.ok && result.value.message).toBe(message);
  });

  it.each([
    ["absent", undefined],
    ["not a uuid", "abc"],
    ["a uuid with an extra character", `${IDEMPOTENCY_KEY}0`],
  ])("decision 2: idempotency key %s → refused", (_label, idempotencyKey) => {
    expect(invalidFields(aLeadDraft({ idempotencyKey }))).toStrictEqual(["idempotencyKey"]);
  });

  it("every invalid field is reported, in form order, without any value", () => {
    const result = parseLeadSubmission({ name: "", email: "x", message: "", consent: undefined, idempotencyKey: "SENTINEL" });

    expect(result).toStrictEqual({ ok: false, error: ["name", "email", "message", "consent", "idempotencyKey"] });
    expect(JSON.stringify(result)).not.toContain("SENTINEL");
  });
});
