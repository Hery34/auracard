/**
 * Contract frozen by test-engineer (0019, decisions 1, 2 and 4).
 *
 * // src/domain/profile/vcard.ts — pure TypeScript, no dependency on Next.js or Supabase
 * export function serializeVCard(profile: PublicProfile, options: { profileUrl: string }): string;
 *
 * Output (vCard 3.0, RFC 2426 / RFC 2425):
 * - one content line per property, each ended by CRLF (the last one, `END:VCARD`, too), in this order:
 *     BEGIN:VCARD
 *     VERSION:3.0
 *     N:<display name>;;;;            the whole display name in the family-name field (no reliable split)
 *     FN:<display name>
 *     ORG:<company>                   omitted when null or ""
 *     TITLE:<job title>               omitted when null or ""
 *     EMAIL;TYPE=INTERNET:<e-mail>    omitted when null or ""
 *     TEL;TYPE=CELL:<phone>           omitted when null or ""
 *     URL:<website>                   omitted when null or ""
 *     URL:<options.profileUrl>        always
 *     NOTE:<bio>                      omitted when null or ""
 *     END:VCARD
 * - no PHOTO before 0021, whatever `avatarUrl` holds; links and banner never appear.
 * - text values (N, FN, ORG, TITLE, EMAIL, TEL, NOTE): control characters removed first (U+0000–U+001F except
 *   CR and LF, U+007F–U+009F: tab, vertical tab, form feed, NEL included), then `\` → `\\`, `,` → `\,`,
 *   `;` → `\;`, and each line break (`\r\n`, lone `\r`, lone `\n`) → the two characters `\n`.
 * - URL values (uri type, RFC 2426 §3.6.8): every control character removed, CR and LF included; no text escaping.
 * - folding (RFC 2425 §5.8.1) applied to the escaped line: a line longer than 75 UTF-8 octets (CRLF excluded) is
 *   cut greedily, whole code points only: the first physical line takes as many code points as fit in 75 octets,
 *   each continuation line is a single space followed by as many code points as fit in 74 octets.
 */
import { describe, expect, it } from "vitest";

import type { PublicProfile } from "@/domain/profile/profile";
import { serializeVCard } from "@/domain/profile/vcard";

import { aPublicProfile } from "../../../tests/builders/fake-public-profile-reader";

const PROFILE_URL = "https://carnet.example/p/elodie-durand-merel";
const CRLF = "\r\n";

function vcard(profile: PublicProfile): string {
  return serializeVCard(profile, { profileUrl: PROFILE_URL });
}

function lines(...contentLines: string[]): string {
  return contentLines.map((line) => line + CRLF).join("");
}

function aMinimalProfile(displayName: string): PublicProfile {
  return aPublicProfile({
    displayName,
    jobTitle: null,
    company: null,
    bio: null,
    avatarUrl: null,
    bannerUrl: null,
    contactEmail: null,
    phone: null,
    websiteUrl: null,
    links: [],
  });
}

function aCompleteProfile(): PublicProfile {
  return aPublicProfile({
    displayName: "Élodie Durand-Mérel",
    jobTitle: "Architecte d'intérieur",
    company: "Atelier Mérel",
    bio: "Aménagement d'espaces de travail.",
    avatarUrl: "https://cdn.example/avatar.jpg",
    bannerUrl: "https://cdn.example/banner.jpg",
    contactEmail: "elodie@atelier-merel.example",
    phone: "+33 6 12 34 56 78",
    websiteUrl: "https://atelier-merel.example/",
  });
}

/** First `count` code points (the database counts characters, never half of a surrogate pair). */
function codePoints(text: string, count: number): string {
  return [...text].slice(0, count).join("");
}

function octets(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** Physical lines, CRLF removed; the trailing CRLF of END:VCARD leaves no empty line. */
function physicalLines(content: string): string[] {
  expect(content.endsWith(CRLF)).toBe(true);
  return content.slice(0, -CRLF.length).split(CRLF);
}

/** RFC 2425 §5.8.1: CRLF followed by one space is removed. */
function unfold(content: string): string[] {
  return physicalLines(content.replaceAll(`${CRLF} `, ""));
}

/** Each physical line survives a UTF-8 round trip: no code point (surrogate pair included) is cut. */
function expectWholeCodePoints(content: string): void {
  for (const line of physicalLines(content)) {
    expect(Buffer.from(line, "utf8").toString("utf8")).toBe(line);
  }
}

function expectFoldedWithin75Octets(content: string): void {
  for (const line of physicalLines(content)) {
    expect(octets(line), JSON.stringify(line)).toBeLessThanOrEqual(75);
  }
  expectWholeCodePoints(content);
}

describe("serializeVCard", () => {
  describe("criterion 1: exact output", () => {
    it("complete profile: every property, in the order of the task, URL of the website then of the public profile", () => {
      expect(vcard(aCompleteProfile())).toBe(
        lines(
          "BEGIN:VCARD",
          "VERSION:3.0",
          "N:Élodie Durand-Mérel;;;;",
          "FN:Élodie Durand-Mérel",
          "ORG:Atelier Mérel",
          "TITLE:Architecte d'intérieur",
          "EMAIL;TYPE=INTERNET:elodie@atelier-merel.example",
          "TEL;TYPE=CELL:+33 6 12 34 56 78",
          "URL:https://atelier-merel.example/",
          `URL:${PROFILE_URL}`,
          "NOTE:Aménagement d'espaces de travail.",
          "END:VCARD",
        ),
      );
    });

    it("minimal profile (display name only): N, FN and the public profile URL", () => {
      expect(vcard(aMinimalProfile("Jean Martin"))).toBe(
        lines("BEGIN:VCARD", "VERSION:3.0", "N:Jean Martin;;;;", "FN:Jean Martin", `URL:${PROFILE_URL}`, "END:VCARD"),
      );
    });

    it("empty fields (\"\") are omitted like null ones", () => {
      const profile = aPublicProfile({
        ...aMinimalProfile("Jean Martin"),
        jobTitle: "",
        company: "",
        bio: "",
        contactEmail: "",
        phone: "",
        websiteUrl: "",
      });

      expect(vcard(profile)).toBe(vcard(aMinimalProfile("Jean Martin")));
    });

    it("accented profile: UTF-8 kept as is, no quoted-printable nor CHARSET parameter", () => {
      const profile = aPublicProfile({
        ...aMinimalProfile("Ångström Çelik-Øster"),
        jobTitle: "Ingénieure œnologue",
        company: "Château Lœw",
      });

      expect(vcard(profile)).toBe(
        lines(
          "BEGIN:VCARD",
          "VERSION:3.0",
          "N:Ångström Çelik-Øster;;;;",
          "FN:Ångström Çelik-Øster",
          "ORG:Château Lœw",
          "TITLE:Ingénieure œnologue",
          `URL:${PROFILE_URL}`,
          "END:VCARD",
        ),
      );
    });

    it("emoji: kept as is (surrogate pairs and ZWJ sequences)", () => {
      const profile = aPublicProfile({
        ...aMinimalProfile("Élodie 🌿 Mérel"),
        bio: "Famille 👩‍👩‍👧 et plantes 🪴",
      });

      expect(vcard(profile)).toBe(
        lines(
          "BEGIN:VCARD",
          "VERSION:3.0",
          "N:Élodie 🌿 Mérel;;;;",
          "FN:Élodie 🌿 Mérel",
          `URL:${PROFILE_URL}`,
          "NOTE:Famille 👩‍👩‍👧 et plantes 🪴",
          "END:VCARD",
        ),
      );
    });

    it("characters to escape: \\ , ; in every text value, backslash escaped first", () => {
      const profile = aPublicProfile({
        ...aMinimalProfile("Durand; Martin, \\ Associés"),
        jobTitle: "Gérante, fondatrice; \\n littéral",
        company: "Durand, Martin; Cie",
        bio: "a\\,b",
      });

      expect(vcard(profile)).toBe(
        lines(
          "BEGIN:VCARD",
          "VERSION:3.0",
          "N:Durand\\; Martin\\, \\\\ Associés;;;;",
          "FN:Durand\\; Martin\\, \\\\ Associés",
          "ORG:Durand\\, Martin\\; Cie",
          "TITLE:Gérante\\, fondatrice\\; \\\\n littéral",
          `URL:${PROFILE_URL}`,
          "NOTE:a\\\\\\,b",
          "END:VCARD",
        ),
      );
    });

    it("line breaks: \\r\\n, lone \\r and lone \\n each become the two characters \\n (\\r\\n counts once)", () => {
      const profile = aPublicProfile({
        ...aMinimalProfile("Jean Martin"),
        bio: "Ligne 1\r\nLigne 2\rLigne 3\nLigne 4\n\nLigne 6\r\n",
      });

      expect(vcard(profile)).toBe(
        lines(
          "BEGIN:VCARD",
          "VERSION:3.0",
          "N:Jean Martin;;;;",
          "FN:Jean Martin",
          `URL:${PROFILE_URL}`,
          "NOTE:Ligne 1\\nLigne 2\\nLigne 3\\nLigne 4\\n\\nLigne 6\\n",
          "END:VCARD",
        ),
      );
    });

    it("control characters are removed from text values (tab, VT, FF, ESC, DEL, NEL, C1 included)", () => {
      const profile = aPublicProfile({
        ...aMinimalProfile("Jean\u0000 \u0007Martin\u001b"),
        jobTitle: "Gé\trant\u007f",
        company: "Atelier\u0085 Mérel\u009f",
        contactEmail: "jean\u0001@martin.example",
        phone: "+33\u0008 6 12 34 56 78",
        bio: "Bio\u000b\u000c\u001f fin",
      });

      expect(vcard(profile)).toBe(
        lines(
          "BEGIN:VCARD",
          "VERSION:3.0",
          "N:Jean Martin;;;;",
          "FN:Jean Martin",
          "ORG:Atelier Mérel",
          "TITLE:Gérant",
          "EMAIL;TYPE=INTERNET:jean@martin.example",
          "TEL;TYPE=CELL:+33 6 12 34 56 78",
          `URL:${PROFILE_URL}`,
          "NOTE:Bio fin",
          "END:VCARD",
        ),
      );
    });

    it("URL values: control characters (CR and LF included) removed, no text escaping of , and ;", () => {
      const profile = aPublicProfile({
        ...aMinimalProfile("Jean Martin"),
        websiteUrl: "https://a.example/x\r\ny\u0000z?a=1,2;b",
      });

      expect(vcard(profile)).toBe(
        lines(
          "BEGIN:VCARD",
          "VERSION:3.0",
          "N:Jean Martin;;;;",
          "FN:Jean Martin",
          "URL:https://a.example/xyz?a=1,2;b",
          `URL:${PROFILE_URL}`,
          "END:VCARD",
        ),
      );
    });

    it("no PHOTO before 0021, even with an avatar; links and banner never appear", () => {
      const content = vcard(aCompleteProfile());

      expect(content).not.toMatch(/^PHOTO/m);
      expect(content).not.toContain("avatar.jpg");
      expect(content).not.toContain("banner.jpg");
      expect(content).not.toContain("linkedin");
    });
  });

  describe("CRLF line endings", () => {
    it("every line ends with CRLF, the last one included, and no lone CR or LF remains", () => {
      const content = vcard(
        aPublicProfile({ ...aCompleteProfile(), bio: "a\nb\rc\r\nd ".repeat(30) }),
      );

      expect(content.startsWith(`BEGIN:VCARD${CRLF}`)).toBe(true);
      expect(content.endsWith(`END:VCARD${CRLF}`)).toBe(true);
      expect(content).not.toMatch(/\r(?!\n)/);
      expect(content).not.toMatch(/(?<!\r)\n/);
    });
  });

  describe("criterion 1: folding at 75 octets", () => {
    it("ASCII: 75 octets on the first line, then a space and 74 octets per continuation line", () => {
      const profile = aPublicProfile({ ...aMinimalProfile("Jean Martin"), bio: "x".repeat(200) });

      expect(vcard(profile)).toContain(
        lines(`NOTE:${"x".repeat(70)}`, ` ${"x".repeat(74)}`, ` ${"x".repeat(56)}`, "END:VCARD"),
      );
    });

    it("a line of exactly 75 octets is not folded", () => {
      const profile = aPublicProfile({ ...aMinimalProfile("Jean Martin"), bio: "x".repeat(70) });

      expect(vcard(profile)).toContain(lines(`NOTE:${"x".repeat(70)}`, "END:VCARD"));
    });

    it("two-octet characters: the first line fills exactly 75 octets", () => {
      const profile = aPublicProfile({ ...aMinimalProfile("Jean Martin"), bio: "é".repeat(40) });

      expect(vcard(profile)).toContain(lines(`NOTE:${"é".repeat(35)}`, ` ${"é".repeat(5)}`, "END:VCARD"));
    });

    it("two-octet characters: never cut, the first line stops at 74 octets rather than split an é", () => {
      const profile = aPublicProfile({ ...aMinimalProfile("Jean Martin"), bio: `a${"é".repeat(40)}` });

      expect(vcard(profile)).toContain(lines(`NOTE:a${"é".repeat(34)}`, ` ${"é".repeat(6)}`, "END:VCARD"));
    });

    it("four-octet emoji: never cut (73 octets, then the rest)", () => {
      const profile = aPublicProfile({ ...aMinimalProfile("Jean Martin"), bio: "🌿".repeat(20) });

      expect(vcard(profile)).toContain(lines(`NOTE:${"🌿".repeat(17)}`, ` ${"🌿".repeat(3)}`, "END:VCARD"));
    });

    it("three-octet characters on a continuation line: a space plus 24 × 3 = 73 octets", () => {
      const profile = aPublicProfile({ ...aMinimalProfile("Jean Martin"), bio: "€".repeat(50) });

      expect(vcard(profile)).toContain(
        lines(`NOTE:${"€".repeat(23)}`, ` ${"€".repeat(24)}`, ` ${"€".repeat(3)}`, "END:VCARD"),
      );
    });

    it("folding applies to N and FN too", () => {
      const name = "é".repeat(80);
      const content = vcard(aMinimalProfile(name));

      expect(content).toContain(lines(`FN:${"é".repeat(36)}`, ` ${"é".repeat(37)}`, ` ${"é".repeat(7)}`));
      expect(unfold(content)).toContain(`N:${name};;;;`);
    });

    it("no line over 75 octets and an exact reconstitution, for a profile filled to the limits with accents and emoji", () => {
      const profile = aPublicProfile({
        displayName: codePoints("Élodie 🌿 Durand-Mérel, Ångström; 👩‍👩‍👧 ".repeat(3), 80),
        jobTitle: codePoints("Ingénieure œnologue 🍷, cheffe; ".repeat(3), 80),
        company: codePoints("Château Lœw \\ Associés 🏰 ".repeat(4), 80),
        bio: codePoints("Aménagement d'espaces 🪴, café; \\ ligne\r\nsuite\rfin\n".repeat(10), 500),
        avatarUrl: null,
        bannerUrl: null,
        contactEmail: `${"élodie.durand".repeat(17)}@atelier-merel.example`,
        phone: "+33 (0)6 12 34 56 78 90 12 34 56",
        websiteUrl: `https://atelier-merel.example/${"chemin/".repeat(280)}`,
        links: [],
      });
      const content = vcard(profile);

      expectFoldedWithin75Octets(content);

      const unfolded = unfold(content);
      const escape = (text: string) =>
        text.replace(/[\\,;]/g, (character) => `\\${character}`).replace(/\r\n|\r|\n/g, "\\n");
      expect(unfolded).toStrictEqual([
        "BEGIN:VCARD",
        "VERSION:3.0",
        `N:${escape(profile.displayName)};;;;`,
        `FN:${escape(profile.displayName)}`,
        `ORG:${escape(profile.company ?? "")}`,
        `TITLE:${escape(profile.jobTitle ?? "")}`,
        `EMAIL;TYPE=INTERNET:${profile.contactEmail ?? ""}`,
        `TEL;TYPE=CELL:${profile.phone ?? ""}`,
        `URL:${profile.websiteUrl ?? ""}`,
        `URL:${PROFILE_URL}`,
        `NOTE:${escape(profile.bio ?? "")}`,
        "END:VCARD",
      ]);
    });
  });

  it("pure: the same profile serializes to the same text twice, the input is not mutated", () => {
    const profile = aCompleteProfile();
    const snapshot = structuredClone(profile);

    expect(vcard(profile)).toBe(vcard(profile));
    expect(profile).toStrictEqual(snapshot);
  });
});
