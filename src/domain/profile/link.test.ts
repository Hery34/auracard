/**
 * Contract frozen by test-engineer (0017, decision 7; 0016 decisions 2, 3 and 8).
 *
 * // src/domain/profile/link.ts — pure TypeScript
 * export const LINK_PLATFORMS = ["linkedin", "x", "instagram", "facebook", "github", "youtube", "tiktok", "whatsapp", "website", "document"] as const;
 * export type LinkPlatform = (typeof LINK_PLATFORMS)[number];
 * export const MAX_LINKS = 12;
 * export const LINK_LABEL_MAX_LENGTH = 40;
 * // Hosts allowed per platform; `null` = any host (website, document). Exact match or suffix ".<domain>", never `includes`.
 * export const PLATFORM_HOSTS: Readonly<Record<LinkPlatform, readonly string[] | null>>;
 * export type LinkError = "invalid_platform" | "invalid_url" | "host_mismatch" | "invalid_label";
 * // A link sent by the editor; `id` present = existing link kept in place (its click statistics, phase 4), absent = creation.
 * export type Link = { id?: string; platform: LinkPlatform; url: HttpsUrl; label: string | null };
 * // A link as stored by carnet.replace_links.
 * export type SavedLink = { id: string; platform: LinkPlatform; url: string; label: string | null; position: number };
 * // JavaScript trim() (Unicode spaces included); empty → null; 1 to 40 characters; none of the code points of
 * // links_label_charset_check (U+0000–U+001F, U+007F–U+009F, U+00AD, U+061C, U+180E, U+200B, U+200E, U+200F,
 * // U+2028–U+202E, U+2060–U+2064, U+2066–U+2069, U+FEFF); U+200C and U+200D allowed.
 * export function parseLinkLabel(text: string | null | undefined): Result<string | null, "invalid_label">;
 * // Checks in order: platform, URL (parseHttpsUrl), host for the platform, label. `id` copied when present.
 * export function parseLink(input: { id?: string; platform: string; url: string; label?: string | null }): Result<Link, LinkError>;
 */
import { describe, expect, it } from "vitest";

import {
  LINK_LABEL_MAX_LENGTH,
  LINK_PLATFORMS,
  MAX_LINKS,
  parseLink,
  parseLinkLabel,
  PLATFORM_HOSTS,
} from "@/domain/profile/link";
import { err, ok } from "@/domain/shared/result";

import { LINK_IDS } from "../../../tests/builders/links";

describe("Link", () => {
  describe("constants", () => {
    it("LINK_PLATFORMS is the closed list of links_platform_check, in that order", () => {
      expect(LINK_PLATFORMS).toStrictEqual([
        "linkedin",
        "x",
        "instagram",
        "facebook",
        "github",
        "youtube",
        "tiktok",
        "whatsapp",
        "website",
        "document",
      ]);
    });

    it("MAX_LINKS is 12 (positions 0 to 11) and LINK_LABEL_MAX_LENGTH is 40", () => {
      expect({ MAX_LINKS, LINK_LABEL_MAX_LENGTH }).toStrictEqual({ MAX_LINKS: 12, LINK_LABEL_MAX_LENGTH: 40 });
    });

    it("PLATFORM_HOSTS: one entry per platform, website and document free", () => {
      expect(PLATFORM_HOSTS).toStrictEqual({
        linkedin: ["linkedin.com"],
        x: ["x.com", "twitter.com"],
        instagram: ["instagram.com"],
        facebook: ["facebook.com"],
        github: ["github.com"],
        youtube: ["youtube.com", "youtu.be"],
        tiktok: ["tiktok.com"],
        whatsapp: ["wa.me", "api.whatsapp.com"],
        website: null,
        document: null,
      });
    });
  });

  describe("parseLink: host consistent with the platform (exact host or suffix '.<domain>')", () => {
    it.each([
      ["linkedin", "https://linkedin.com/in/elodie", "https://linkedin.com/in/elodie"],
      ["linkedin", "https://www.LinkedIn.com/in/elodie", "https://www.linkedin.com/in/elodie"],
      ["linkedin", "https://fr.linkedin.com/in/elodie", "https://fr.linkedin.com/in/elodie"],
      ["x", "https://x.com/elodie", "https://x.com/elodie"],
      ["x", "https://twitter.com/elodie", "https://twitter.com/elodie"],
      ["x", "https://mobile.twitter.com/elodie", "https://mobile.twitter.com/elodie"],
      ["instagram", "https://www.instagram.com/elodie/", "https://www.instagram.com/elodie/"],
      ["facebook", "https://www.facebook.com/elodie", "https://www.facebook.com/elodie"],
      ["github", "https://github.com/elodie", "https://github.com/elodie"],
      ["youtube", "https://www.youtube.com/@elodie", "https://www.youtube.com/@elodie"],
      ["youtube", "https://youtu.be/abc123", "https://youtu.be/abc123"],
      ["tiktok", "https://www.tiktok.com/@elodie", "https://www.tiktok.com/@elodie"],
      ["whatsapp", "https://wa.me/33612345678", "https://wa.me/33612345678"],
      [
        "whatsapp",
        "https://api.whatsapp.com/send?phone=33612345678",
        "https://api.whatsapp.com/send?phone=33612345678",
      ],
      ["website", "https://atelier-merel.example", "https://atelier-merel.example/"],
      ["document", "https://cdn.example.org/brochure.pdf", "https://cdn.example.org/brochure.pdf"],
    ])("%s accepts %j, stored as %j", (platform, url, stored) => {
      expect(parseLink({ platform, url })).toStrictEqual(ok({ platform, url: stored, label: null }));
    });

    it.each([
      ["linkedin", "https://evillinkedin.com/in/elodie", "a host merely ending with the domain"],
      ["linkedin", "https://linkedin.com.evil.example/in/elodie", "the domain as a prefix of another host"],
      ["linkedin", "https://evil.example/linkedin.com", "the domain in the path"],
      ["linkedin", "https://evil.example/?u=https://linkedin.com", "the domain in the query"],
      ["linkedin", "https://evil.example/#linkedin.com", "the domain in the fragment"],
      ["linkedin", "https://twitter.com/elodie", "the host of another platform"],
      ["x", "https://xx.com/elodie", "a host merely ending with x.com"],
      ["x", "https://x.com.evil.example/elodie", "x.com as a prefix"],
      ["youtube", "https://youtube.evil.example/watch", "the brand as a label of another domain"],
      ["whatsapp", "https://whatsapp.com/send", "whatsapp.com without the api. host"],
      ["whatsapp", "https://evilwa.me/33612345678", "a host merely ending with wa.me"],
      ["facebook", "https://facebook.com.evil.example/", "facebook.com as a prefix"],
    ])("%s refuses %j (%s) with host_mismatch", (platform, url) => {
      expect(parseLink({ platform, url })).toStrictEqual(err("host_mismatch"));
    });

    it.each(["mastodon", "", "LinkedIn", "website "])("refuses the platform %j with invalid_platform", (platform) => {
      expect(parseLink({ platform, url: "https://example.com/" })).toStrictEqual(err("invalid_platform"));
    });

    it.each([
      ["http:", "http://linkedin.com/in/elodie"],
      ["javascript:", "javascript:alert(1)"],
      ["credentials", "https://user@linkedin.com/in/elodie"],
      ["an inner space", "https://linkedin.com/in/elodie durand"],
      ["decision 10: a host ending with a dot", "https://linkedin.com./in/elodie"],
    ])("refuses a URL with %s with invalid_url (checked before the host)", (_label, url) => {
      expect(parseLink({ platform: "linkedin", url })).toStrictEqual(err("invalid_url"));
    });
  });

  describe("parseLink: id and label", () => {
    it("copies the id of an existing link (kept in place by replace_links, 0016 decision 8)", () => {
      const result = parseLink({
        id: LINK_IDS[1],
        platform: "github",
        url: "https://github.com/elodie",
        label: "Code",
      });

      expect(result).toStrictEqual(
        ok({ id: LINK_IDS[1], platform: "github", url: "https://github.com/elodie", label: "Code" }),
      );
    });

    it("has no id key for a new link", () => {
      const result = parseLink({ platform: "github", url: "https://github.com/elodie" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect("id" in result.value).toBe(false);
      }
    });

    it("trims the label and turns a blank label into null", () => {
      expect(parseLink({ platform: "website", url: "https://a.example/", label: "  Mon atelier  " })).toStrictEqual(
        ok({ platform: "website", url: "https://a.example/", label: "Mon atelier" }),
      );
      expect(parseLink({ platform: "website", url: "https://a.example/", label: "   " })).toStrictEqual(
        ok({ platform: "website", url: "https://a.example/", label: null }),
      );
    });

    it("refuses a label of 41 characters with invalid_label", () => {
      expect(parseLink({ platform: "website", url: "https://a.example/", label: "l".repeat(41) })).toStrictEqual(
        err("invalid_label"),
      );
    });
  });

  describe("parseLinkLabel", () => {
    it.each([null, undefined, "", "   ", "\u00a0\u00a0", "\u3000", "\t \n"])("%j → ok(null)", (text) => {
      expect(parseLinkLabel(text)).toStrictEqual(ok(null));
    });

    it.each([
      ["  Mon atelier  ", "Mon atelier"],
      ["\u00a0Brochure 2026\u00a0", "Brochure 2026"],
      ["Élodie · Lyon", "Élodie · Lyon"],
      ["👩\u200d💻 Code", "👩\u200d💻 Code"],
      ["a\u200cb", "a\u200cb"],
    ])("%j → ok(%j) (trim, U+200C/U+200D allowed)", (text, label) => {
      expect(parseLinkLabel(text)).toStrictEqual(ok(label));
    });

    it("accepts 40 characters after trim and refuses 41", () => {
      expect(parseLinkLabel(` ${"é".repeat(40)} `)).toStrictEqual(ok("é".repeat(40)));
      expect(parseLinkLabel("é".repeat(41))).toStrictEqual(err("invalid_label"));
    });

    const FORBIDDEN_CODE_POINTS = [
      0x0000, 0x0001, 0x0009, 0x001f, 0x007f, 0x0085, 0x009f, 0x00ad, 0x061c, 0x180e, 0x200b, 0x200e, 0x200f, 0x2028,
      0x2029, 0x202a, 0x202e, 0x2060, 0x2064, 0x2066, 0x2069, 0xfeff,
    ];

    it.each(
      FORBIDDEN_CODE_POINTS.map((codePoint) => [codePoint.toString(16).toUpperCase().padStart(4, "0"), codePoint]),
    )("refuses a label containing U+%s (links_label_charset_check) with invalid_label", (_hex, codePoint) => {
      expect(parseLinkLabel(`a${String.fromCodePoint(codePoint)}b`)).toStrictEqual(err("invalid_label"));
    });
  });
});
