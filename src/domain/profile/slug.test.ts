import { describe, expect, it } from "vitest";

import {
  parseSlug,
  RESERVED_SLUGS,
  SLUG_PATTERN,
  slugFromDisplayName,
  slugWithSuffix,
} from "@/domain/profile/slug";
import { err, ok } from "@/domain/shared/result";

import { aSlug } from "../../../tests/builders/slug";

const FORTY = "a".repeat(40);
const FORTY_ONE = "a".repeat(41);

// 60 characters each: "abcde " * 10 cuts cleanly at 40, "abcd " * 12 leaves a dangling hyphen at the cut.
const SIXTY_CLEAN_CUT = "abcde ".repeat(10);
const SIXTY_HYPHEN_AT_CUT = "abcd ".repeat(12);

const SAMPLE_NAMES = [
  "Élodie  Durand-Mérel!",
  "A",
  "ab",
  "",
  "   ",
  "!!!",
  "🙂",
  "Login",
  "Jean-Pierre",
  "___",
  SIXTY_CLEAN_CUT,
  SIXTY_HYPHEN_AT_CUT,
];

describe("Slug", () => {
  describe("SLUG_PATTERN and RESERVED_SLUGS", () => {
    it("SLUG_PATTERN is the database check regex ^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$", () => {
      expect(SLUG_PATTERN.source).toBe("^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$");
      expect(SLUG_PATTERN.flags).toBe("");
    });

    it.each([
      "t",
      "q",
      "v",
      "p",
      "api",
      "login",
      "inscription",
      "connexion",
      "tableau-de-bord",
      "verifier-email",
      "deconnexion",
      "_next",
      "assets",
      "admin",
      "www",
    ])("RESERVED_SLUGS contains the route prefix %j", (reserved) => {
      expect(RESERVED_SLUGS.has(reserved)).toBe(true);
    });
  });

  describe("parseSlug", () => {
    it.each(["abc", "a-b", FORTY])("criterion 3: accepts %j", (text) => {
      expect(parseSlug(text)).toStrictEqual(ok(text));
    });

    it.each(["ab", "-abc", "abc-", "Abc", "a_b", FORTY_ONE, "", "a b", "é-a"])(
      "criterion 3: rejects %j with invalid_slug",
      (text) => {
        expect(parseSlug(text)).toStrictEqual(err("invalid_slug"));
      },
    );

    // Reserved words are checked before the pattern: `_next` can never match the pattern, but
    // "reserved" is the reason that matters for the caller.
    it.each(["login", "tableau-de-bord", "_next"])("rejects the reserved slug %j with reserved_slug", (text) => {
      expect(parseSlug(text)).toStrictEqual(err("reserved_slug"));
    });
  });

  describe("slugFromDisplayName", () => {
    it("criterion 3: strips diacritics, lowercases, replaces non [a-z0-9] runs by one hyphen and trims hyphens", () => {
      expect(slugFromDisplayName("Élodie  Durand-Mérel!")).toBe("elodie-durand-merel");
    });

    it("keeps an already valid name untouched (lowercased)", () => {
      expect(slugFromDisplayName("Jean-Pierre")).toBe("jean-pierre");
    });

    // Padding rule (deterministic, no randomness): an empty normalized base becomes "x";
    // a base shorter than 3 characters is extended with "-x".
    it("criterion 3: pads a one-character name deterministically: 'A' → 'a-x'", () => {
      expect(slugFromDisplayName("A")).toBe("a-x");
      expect(slugFromDisplayName("A")).toBe(slugFromDisplayName("A"));
    });

    it("pads a two-character name: 'ab' → 'ab-x'", () => {
      expect(slugFromDisplayName("ab")).toBe("ab-x");
    });

    it.each(["", "   ", "!!!", "🙂", "___"])("yields 'x-x' when nothing survives normalization (%j)", (name) => {
      expect(slugFromDisplayName(name)).toBe("x-x");
    });

    it("criterion 3: truncates a 60-character name to 40 characters at most", () => {
      expect(SIXTY_CLEAN_CUT).toHaveLength(60);

      const slug = slugFromDisplayName(SIXTY_CLEAN_CUT);

      expect(slug).toBe("abcde-abcde-abcde-abcde-abcde-abcde-abcd");
      expect(slug).toHaveLength(40);
    });

    it("criterion 3: never ends with a hyphen after truncation", () => {
      expect(SIXTY_HYPHEN_AT_CUT).toHaveLength(60);

      const slug = slugFromDisplayName(SIXTY_HYPHEN_AT_CUT);

      expect(slug).toBe("abcd-abcd-abcd-abcd-abcd-abcd-abcd-abcd");
      expect(slug.length).toBeLessThanOrEqual(40);
      expect(slug.endsWith("-")).toBe(false);
    });

    it.each([
      ["Login", "login-1"],
      ["Tableau de bord", "tableau-de-bord-1"],
      ["API", "api-1"],
    ])("suffixes a reserved name with '-1': %j → %j", (name, expected) => {
      expect(slugFromDisplayName(name)).toBe(expected);
    });

    it.each(SAMPLE_NAMES)("always produces a slug accepted by parseSlug (%j)", (name) => {
      const slug = slugFromDisplayName(name);

      expect(parseSlug(slug)).toStrictEqual(ok(slug));
    });
  });

  describe("slugWithSuffix", () => {
    it("appends '-' and the suffix to a short slug", () => {
      expect(slugWithSuffix(aSlug("elodie-durand-merel"), "ab1c")).toBe("elodie-durand-merel-ab1c");
    });

    it("criterion 3: truncates the base so the result stays within 40 characters", () => {
      const slug = slugWithSuffix(aSlug(FORTY), "ab1c");

      expect(slug).toBe(`${"a".repeat(35)}-ab1c`);
      expect(slug).toHaveLength(40);
    });

    it.each([
      ["AB1C", "elodie-ab1c"],
      ["a-b", "elodie-ab"],
    ])("normalizes the suffix to [a-z0-9]: %j → %j", (suffix, expected) => {
      expect(slugWithSuffix(aSlug("elodie"), suffix)).toBe(expected);
    });

    it.each([39, 40, 60])(
      "bounds the suffix: a %d-character suffix still yields a slug of at most 40 characters accepted by parseSlug",
      (length) => {
        const slug = slugWithSuffix(aSlug("elodie"), "a".repeat(length));

        expect(slug.length).toBeLessThanOrEqual(40);
        expect(parseSlug(slug)).toStrictEqual(ok(slug));
      },
    );

    it.each([
      [FORTY, "ab1c"],
      [`${"abcd-".repeat(7)}abcde`, "ab1c"],
      ["abc", "1a2b"],
      ["elodie-durand-merel", "AB-1C"],
    ])("always produces a slug accepted by parseSlug (base %j, suffix %j)", (base, suffix) => {
      const slug = slugWithSuffix(aSlug(base), suffix);

      expect(slug.length).toBeLessThanOrEqual(40);
      expect(parseSlug(slug)).toStrictEqual(ok(slug));
    });
  });
});
