/**
 * Contract frozen by test-engineer (0017, decisions 1, 2 and 7; ADR 0012: module without directive, shared with 0020).
 *
 * // src/domain/profile/profile.ts — pure TypeScript
 * export const PROFILE_TEXT_MAX_LENGTH = { displayName: 80, jobTitle: 80, company: 80, bio: 500, contactEmail: 254 } as const;
 * export type ProfileUpdate = {                    // full update (docs/rules/idempotence.md), slug never part of it
 *   displayName: string; jobTitle: string | null; company: string | null; bio: string | null;
 *   contactEmail: string | null; phone: Phone | null; websiteUrl: HttpsUrl | null;
 *   isPublished: boolean; isIndexable: boolean;
 * };
 *
 * // src/server/actions/profile-schemas.ts
 * export { PROFILE_TEXT_MAX_LENGTH, PHONE_MAX_LENGTH, HTTPS_URL_MAX_LENGTH, LINK_LABEL_MAX_LENGTH, MAX_LINKS, LINK_PLATFORMS };
 * // Input: the text fields of the form (string | undefined). Output: ProfileUpdate.
 * //   displayName: same rule as registration (trim, 1–80, no \p{Cc} nor \p{Cf});
 * //   jobTitle, company: trim, blank → null, ≤ 80, no \p{Cc} nor \p{Cf};
 * //   bio: trim, blank → null, ≤ 500; decision 10: the forbidden code points of the link label (U+0000–U+001F,
 * //   U+007F–U+009F, U+00AD, U+061C, U+180E, U+200B, U+200E, U+200F, U+2028–U+202E, U+2060–U+2064, U+2066–U+2069, U+FEFF)
 * //   except \n and \r; U+200C and U+200D allowed;
 * //   contactEmail: trim, blank → null, e-mail, ≤ 254; phone: trim, blank → null, parsePhone;
 * //   websiteUrl: trim, blank → null, parseHttpsUrl (stored href); isPublished, isIndexable: "on" → true, absent → false, anything else refused;
 * //   unknown keys (slug, id, owner_id…) stripped.
 * export const updateProfileSchema: z.ZodType<ProfileUpdate, Record<string, string | undefined>>;
 * // Input: { links: unknown } (the action JSON-parses the `links` form field). Output: { links: Link[] }.
 * //   at most MAX_LINKS elements; each { id?: uuid | null, platform, url (trimmed), label? } checked by parseLink;
 * //   id null → absent; decision 10: id normalized to lower case, ids distinct after normalization (case-insensitive
 * //   duplicates refused by the schema, before the database); unknown keys (position, profile_id…) stripped.
 * export const replaceLinksSchema: z.ZodType<{ links: Link[] }, { links: unknown }>;
 */
import { describe, expect, it } from "vitest";

import type { Link } from "@/domain/profile/link";
import type { ProfileUpdate } from "@/domain/profile/profile";
import {
  HTTPS_URL_MAX_LENGTH,
  LINK_LABEL_MAX_LENGTH,
  LINK_PLATFORMS,
  MAX_LINKS,
  PHONE_MAX_LENGTH,
  PROFILE_TEXT_MAX_LENGTH,
  replaceLinksSchema,
  updateProfileSchema,
} from "@/server/actions/profile-schemas";

import { LINK_IDS } from "../../../tests/builders/links";

const validProfileForm = {
  displayName: "  Élodie Durand-Mérel  ",
  jobTitle: " Architecte d'intérieur ",
  company: "Atelier Mérel",
  bio: "Aménagement de bureaux.\nLyon et alentours.",
  contactEmail: " contact@atelier-merel.example ",
  phone: " +33 6 12 34 56 78 ",
  websiteUrl: " HTTPS://Atelier-Merel.example ",
  isPublished: "on",
  isIndexable: "on",
};

function parsedProfile(form: Record<string, string | undefined>): ProfileUpdate {
  const parsed = updateProfileSchema.safeParse(form);
  if (!parsed.success) {
    throw new Error(`expected a valid form: ${JSON.stringify(parsed.error.issues.map((issue) => issue.path))}`);
  }
  return parsed.data;
}

function refusesProfile(form: Record<string, string | undefined>): boolean {
  return !updateProfileSchema.safeParse(form).success;
}

function parsedLinks(links: unknown): Link[] {
  const parsed = replaceLinksSchema.safeParse({ links });
  if (!parsed.success) {
    throw new Error(`expected a valid list: ${JSON.stringify(parsed.error.issues.map((issue) => issue.path))}`);
  }
  return parsed.data.links;
}

function refusesLinks(links: unknown): boolean {
  return !replaceLinksSchema.safeParse({ links }).success;
}

describe("profile-schemas: shared bounds", () => {
  it("exports the bounds of carnet.profiles and carnet.links reused by the 0020 editor", () => {
    expect({
      PROFILE_TEXT_MAX_LENGTH,
      PHONE_MAX_LENGTH,
      HTTPS_URL_MAX_LENGTH,
      LINK_LABEL_MAX_LENGTH,
      MAX_LINKS,
    }).toStrictEqual({
      PROFILE_TEXT_MAX_LENGTH: { displayName: 80, jobTitle: 80, company: 80, bio: 500, contactEmail: 254 },
      PHONE_MAX_LENGTH: 32,
      HTTPS_URL_MAX_LENGTH: 2048,
      LINK_LABEL_MAX_LENGTH: 40,
      MAX_LINKS: 12,
    });
    expect(LINK_PLATFORMS).toHaveLength(10);
  });
});

describe("updateProfileSchema", () => {
  it("criterion 1 (valid input): trims, normalizes the website to new URL(x).href and maps the switches to booleans", () => {
    expect(parsedProfile(validProfileForm)).toStrictEqual({
      displayName: "Élodie Durand-Mérel",
      jobTitle: "Architecte d'intérieur",
      company: "Atelier Mérel",
      bio: "Aménagement de bureaux.\nLyon et alentours.",
      contactEmail: "contact@atelier-merel.example",
      phone: "+33 6 12 34 56 78",
      websiteUrl: "https://atelier-merel.example/",
      isPublished: true,
      isIndexable: true,
    });
  });

  it("full update: a form with the display name only gives null fields and both switches off", () => {
    expect(parsedProfile({ displayName: "Élodie" })).toStrictEqual({
      displayName: "Élodie",
      jobTitle: null,
      company: null,
      bio: null,
      contactEmail: null,
      phone: null,
      websiteUrl: null,
      isPublished: false,
      isIndexable: false,
    });
  });

  it("turns blank optional fields into null (clearing a field)", () => {
    const update = parsedProfile({
      displayName: "Élodie",
      jobTitle: "   ",
      company: "",
      bio: " \n ",
      contactEmail: " ",
      phone: "",
      websiteUrl: "  ",
    });

    expect(update).toMatchObject({
      jobTitle: null,
      company: null,
      bio: null,
      contactEmail: null,
      phone: null,
      websiteUrl: null,
    });
  });

  it("decision 1: the slug is never part of the update (unknown keys stripped)", () => {
    const update = parsedProfile({ ...validProfileForm, slug: "another-slug", id: LINK_IDS[0], owner_id: LINK_IDS[1] });

    expect(Object.keys(update).sort()).toStrictEqual([
      "bio",
      "company",
      "contactEmail",
      "displayName",
      "isIndexable",
      "isPublished",
      "jobTitle",
      "phone",
      "websiteUrl",
    ]);
  });

  it.each([
    ["displayName", 80],
    ["jobTitle", 80],
    ["company", 80],
    ["bio", 500],
  ] as const)("decision 2: %s accepts %d characters and refuses one more", (field, max) => {
    expect(refusesProfile({ ...validProfileForm, [field]: "n".repeat(max) })).toBe(false);
    expect(refusesProfile({ ...validProfileForm, [field]: "n".repeat(max + 1) })).toBe(true);
  });

  it("decision 2: contactEmail accepts 254 characters and refuses 255", () => {
    const domain = "@example.test";
    const local254 = "a".repeat(254 - domain.length);

    expect(refusesProfile({ ...validProfileForm, contactEmail: `${local254}${domain}` })).toBe(false);
    expect(refusesProfile({ ...validProfileForm, contactEmail: `${local254}a${domain}` })).toBe(true);
  });

  it("decision 2: phone accepts 32 characters and refuses 33", () => {
    expect(refusesProfile({ ...validProfileForm, phone: `+${"1".repeat(31)}` })).toBe(false);
    expect(refusesProfile({ ...validProfileForm, phone: "1".repeat(33) })).toBe(true);
  });

  it("decision 2: websiteUrl accepts 2048 characters and refuses 2049", () => {
    const prefix = "https://example.com/";

    expect(refusesProfile({ ...validProfileForm, websiteUrl: prefix + "a".repeat(2048 - prefix.length) })).toBe(false);
    expect(refusesProfile({ ...validProfileForm, websiteUrl: prefix + "a".repeat(2049 - prefix.length) })).toBe(true);
  });

  it.each([
    ["a missing display name", { ...validProfileForm, displayName: undefined }],
    ["an empty display name", { ...validProfileForm, displayName: "" }],
    ["a blank display name", { ...validProfileForm, displayName: "   " }],
    ["a display name with a control character", { ...validProfileForm, displayName: "Élodie\u0007" }],
    ["a display name with a right-to-left override", { ...validProfileForm, displayName: "Élodie\u202E" }],
    ["a display name with a zero-width space", { ...validProfileForm, displayName: "Élo\u200Bdie" }],
    ["a job title with a line feed", { ...validProfileForm, jobTitle: "Archi\ntecte" }],
    ["a job title with a right-to-left override", { ...validProfileForm, jobTitle: "Archi\u202Etecte" }],
    ["a company with a control character", { ...validProfileForm, company: "Atelier\u0000" }],
    ["a company with a first-strong isolate (U+2068)", { ...validProfileForm, company: "Atelier\u2068" }],
    ["a bio with a bell character", { ...validProfileForm, bio: "Bonjour\u0007" }],
    ["a bio with a right-to-left override", { ...validProfileForm, bio: "Bonjour\u202E" }],
    ["a bio with a left-to-right isolate (U+2066)", { ...validProfileForm, bio: "Bonjour\u2066" }],
    ["a malformed public e-mail", { ...validProfileForm, contactEmail: "not-an-email" }],
    ["a phone number with letters", { ...validProfileForm, phone: "06 12 ab" }],
    ["an http website", { ...validProfileForm, websiteUrl: "http://atelier-merel.example/" }],
    ["a javascript: website", { ...validProfileForm, websiteUrl: "javascript:alert(1)" }],
    ["a website with credentials", { ...validProfileForm, websiteUrl: "https://user@atelier-merel.example/" }],
    ["a website without a dot in the host", { ...validProfileForm, websiteUrl: "https://localhost/" }],
    ["a website with an inner space", { ...validProfileForm, websiteUrl: "https://atelier-merel.example/a b" }],
    ["isPublished with a value other than 'on'", { ...validProfileForm, isPublished: "yes" }],
    ["isIndexable with a value other than 'on'", { ...validProfileForm, isIndexable: "false" }],
  ])("criterion 1 (invalid input): refuses %s", (_label, form) => {
    expect(refusesProfile(form)).toBe(true);
  });

  it.each([
    ["displayName", "U+2028", "\u2028"],
    ["displayName", "U+2029", "\u2029"],
    ["jobTitle", "U+2028", "\u2028"],
    ["jobTitle", "U+2029", "\u2029"],
    ["company", "U+2028", "\u2028"],
    ["company", "U+2029", "\u2029"],
  ])("0022 decision 9: refuses %s with the separator %s (profiles_text_charset_check)", (field, _codePoint, character) => {
    const parsed = updateProfileSchema.safeParse({ ...validProfileForm, [field]: `Atelier${character}Lyon` });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path[0])).toContain(field);
  });

  it("accepts line breaks in the bio (\\n and \\r\\n)", () => {
    expect(parsedProfile({ ...validProfileForm, bio: "Ligne 1\r\nLigne 2\nLigne 3" }).bio).toBe(
      "Ligne 1\r\nLigne 2\nLigne 3",
    );
  });

  it("decision 10: accepts a lone \\r in the bio", () => {
    expect(parsedProfile({ ...validProfileForm, bio: "Ligne 1\rLigne 2" }).bio).toBe("Ligne 1\rLigne 2");
  });

  it("decision 10: accepts U+200C and U+200D in the bio (allowed in the label too)", () => {
    const bio = "Bonjour \u{1F469}\u200D\u{1F4BB} mi\u200Cxed";

    expect(parsedProfile({ ...validProfileForm, bio }).bio).toBe(bio);
  });

  it.each([
    "\u0085",
    "\u00AD",
    "\u061C",
    "\u180E",
    "\u200B",
    "\u200E",
    "\u200F",
    "\u2028",
    "\u2029",
    "\u202A",
    "\u202E",
    "\u2060",
    "\u2064",
    "\u2066",
    "\u2069",
    "\uFEFF",
  ])("decision 10: refuses a bio with the label-forbidden code point %j", (character) => {
    expect(refusesProfile({ ...validProfileForm, bio: `Bonjour${character}Lyon` })).toBe(true);
  });
});

describe("replaceLinksSchema", () => {
  it("decision 7: keeps the id of every existing link, normalizes URLs, trims labels and keeps the order", () => {
    const links = parsedLinks([
      { id: LINK_IDS[1], platform: "github", url: " https://GitHub.com/elodie ", label: "  Code  " },
      { platform: "website", url: "https://atelier-merel.example", label: "" },
      { id: LINK_IDS[0], platform: "linkedin", url: "https://www.linkedin.com/in/elodie", label: null },
    ]);

    expect(links).toStrictEqual([
      { id: LINK_IDS[1], platform: "github", url: "https://github.com/elodie", label: "Code" },
      { platform: "website", url: "https://atelier-merel.example/", label: null },
      { id: LINK_IDS[0], platform: "linkedin", url: "https://www.linkedin.com/in/elodie", label: null },
    ]);
  });

  it("decision 10: an id in upper case is normalized to lower case", () => {
    const [link] = parsedLinks([
      { id: LINK_IDS[0].toUpperCase(), platform: "github", url: "https://github.com/elodie" },
    ]);

    expect(link?.id).toBe(LINK_IDS[0]);
  });

  it("decision 10: two ids equal up to case → duplicate_id error from the schema (before the database)", () => {
    const parsed = replaceLinksSchema.safeParse({
      links: [
        { id: LINK_IDS[0], platform: "github", url: "https://github.com/elodie" },
        { id: LINK_IDS[0].toUpperCase(), platform: "website", url: "https://atelier-merel.example/" },
      ],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain("duplicate_id");
  });

  it("an id null means a new link (no id key, as replace_links reads it)", () => {
    const [link] = parsedLinks([{ id: null, platform: "github", url: "https://github.com/elodie" }]);

    expect(link).toStrictEqual({ platform: "github", url: "https://github.com/elodie", label: null });
  });

  it("strips the keys replace_links ignores (position, profile_id, created_at)", () => {
    const [link] = parsedLinks([
      { platform: "github", url: "https://github.com/elodie", position: 7, profile_id: LINK_IDS[2], created_at: "x" },
    ]);

    expect(link).toStrictEqual({ platform: "github", url: "https://github.com/elodie", label: null });
  });

  it("accepts an empty list (every link removed) and exactly 12 links", () => {
    const twelve = Array.from({ length: 12 }, (_, index) => ({
      platform: "website",
      url: `https://site-${index}.example/`,
    }));

    expect(parsedLinks([])).toStrictEqual([]);
    expect(parsedLinks(twelve)).toHaveLength(12);
  });

  it.each([
    [
      "13 links",
      Array.from({ length: 13 }, (_, index) => ({ platform: "website", url: `https://s${index}.example/` })),
    ],
    ["a list that is not an array", { platform: "github", url: "https://github.com/elodie" }],
    ["a missing list", undefined],
    ["an element that is not an object", ["https://github.com/elodie"]],
    ["a malformed id", [{ id: "not-a-uuid", platform: "github", url: "https://github.com/elodie" }]],
    [
      "the same id twice",
      [
        { id: LINK_IDS[0], platform: "github", url: "https://github.com/elodie" },
        { id: LINK_IDS[0], platform: "website", url: "https://atelier-merel.example/" },
      ],
    ],
    ["an unknown platform", [{ platform: "mastodon", url: "https://mastodon.example/@elodie" }]],
    ["a host inconsistent with the platform", [{ platform: "linkedin", url: "https://evil.example/linkedin.com" }]],
    ["an http URL", [{ platform: "website", url: "http://atelier-merel.example/" }]],
    ["a javascript: URL", [{ platform: "website", url: "javascript:alert(1)" }]],
    ["a URL with credentials", [{ platform: "website", url: "https://user@atelier-merel.example/" }]],
    ["a URL of 2049 characters", [{ platform: "website", url: `https://example.com/${"a".repeat(2029)}` }]],
    ["a label of 41 characters", [{ platform: "website", url: "https://a.example/", label: "l".repeat(41) }]],
    ["a label with a right-to-left override", [{ platform: "website", url: "https://a.example/", label: "a\u202Eb" }]],
    ["a label with a zero-width space", [{ platform: "website", url: "https://a.example/", label: "a\u200Bb" }]],
    ["a URL that is not a string", [{ platform: "website", url: 42 }]],
  ])("criterion 1 (invalid input): refuses %s", (_label, links) => {
    expect(refusesLinks(links)).toBe(true);
  });

  it("0016 audit reservation: a label made of Unicode spaces only becomes null (trim() before links_label_blank_check)", () => {
    const [link] = parsedLinks([{ platform: "website", url: "https://a.example/", label: "  　" }]);

    expect(link?.label).toBeNull();
  });
});
