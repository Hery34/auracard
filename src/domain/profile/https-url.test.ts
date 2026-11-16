/**
 * Contract frozen by test-engineer (0017, decision 7 — requirements of the 0016 audit).
 *
 * // src/domain/profile/https-url.ts — pure TypeScript
 * export type HttpsUrl = string & { readonly __brand: "HttpsUrl" };
 * export const HTTPS_URL_MAX_LENGTH = 2048;
 * // Decision 10: the analysed host is returned with the value, so that parseLink checks the platform without a second parse.
 * export type ParsedHttpsUrl = { value: HttpsUrl; host: string };   // host = new URL(text).hostname (ASCII, lower case)
 * export function parseHttpsUrl(text: string): Result<ParsedHttpsUrl, "invalid_url">;
 *   // raw text: no whitespace (\s, Unicode spaces included) nor control character (\p{Cc}) anywhere — no trim here
 *   // new URL(text) (no base) must succeed; protocol "https:"; no username nor password;
 *   // hostname contains a dot and matches /^[a-z0-9.-]+$/ (punycode, same alphabet as links_url_host_check);
 *   // decision 10: hostname is not an IPv4 address (new URL normalizes 0x7f.1, 2130706433… to dotted decimal) and does
 *   // not end with a dot (trailing-dot FQDN, e.g. "linkedin.com.");
 *   // parsed with new URL() inside a try (not URL.parse: missing from Safari < 18, the module is shared with the forms);
 *   // value = new URL(text).href (ASCII), at most HTTPS_URL_MAX_LENGTH characters.
 */
import { describe, expect, it } from "vitest";

import { HTTPS_URL_MAX_LENGTH, parseHttpsUrl } from "@/domain/profile/https-url";
import { err, ok } from "@/domain/shared/result";

/** The CHECK constraints of carnet.links (0016, decision 8): the stored form must always satisfy them. */
const DB_URL_CHARSET = /^[!-~]+$/;
const DB_URL_HOST = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#]|$)/;

const PREFIX = "https://example.com/";

describe("HttpsUrl", () => {
  it("HTTPS_URL_MAX_LENGTH is 2048 (links_url_length_check, profiles_website_url_length_check)", () => {
    expect(HTTPS_URL_MAX_LENGTH).toBe(2048);
  });

  describe("parseHttpsUrl accepts and stores the normalized form new URL(x).href", () => {
    it.each([
      ["https://example.com", "https://example.com/"],
      ["HTTPS://Example.COM/Path?q=1#top", "https://example.com/Path?q=1#top"],
      ["https://www.linkedin.com/in/elodie-durand-merel", "https://www.linkedin.com/in/elodie-durand-merel"],
      ["https://exämple.com/", "https://xn--exmple-cua.com/"],
      ["https://example.com/é", "https://example.com/%C3%A9"],
      ["https://example.com:8443/a", "https://example.com:8443/a"],
      ["https://example.com:443/a", "https://example.com/a"],
      ["https://cdn.example.com/brochure.pdf?v=2", "https://cdn.example.com/brochure.pdf?v=2"],
    ])("%j → %j", (text, href) => {
      expect(parseHttpsUrl(text)).toStrictEqual(ok({ value: href, host: new URL(href).hostname }));
    });

    it.each([
      ["HTTPS://Example.COM/Path", "example.com"],
      ["https://exämple.com/", "xn--exmple-cua.com"],
      ["https://www.linkedin.com:8443/in/elodie", "www.linkedin.com"],
    ])("decision 10: exposes the analysed host of %j (%j), lower case ASCII, without port", (text, host) => {
      const result = parseHttpsUrl(text);

      expect(result.ok && result.value.host).toBe(host);
    });

    it.each([
      "https://example.com",
      "HTTPS://Example.COM/Path?q=1#top",
      "https://exämple.com/",
      "https://example.com/é?q=ü#ß",
      "https://example.com:8443/a",
    ])("the stored form of %j satisfies links_url_charset_check and links_url_host_check", (text) => {
      const result = parseHttpsUrl(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.value).toMatch(DB_URL_CHARSET);
        expect(result.value.value).toMatch(DB_URL_HOST);
      }
    });

    it("is idempotent: parsing the stored form again gives the same value", () => {
      const first = parseHttpsUrl("HTTPS://Exämple.COM/é");

      expect(first.ok).toBe(true);
      if (first.ok) {
        expect(parseHttpsUrl(first.value.value)).toStrictEqual(first);
      }
    });
  });

  describe("parseHttpsUrl refuses with invalid_url", () => {
    it.each([
      ["an empty text", ""],
      ["a text that new URL cannot parse", "not a url"],
      ["a host without scheme", "example.com"],
      ["a scheme-relative URL", "//example.com/a"],
      ["http:", "http://example.com/"],
      ["javascript:", "javascript:alert(1)"],
      ["data:", "data:text/html,<script>alert(1)</script>"],
      ["ftp:", "ftp://example.com/file"],
      ["a host without a dot (localhost)", "https://localhost/"],
      ["a host without a dot (intranet)", "https://intranet/path"],
      ["an IPv6 literal host (no dot)", "https://[::1]/"],
      ["a host with an underscore (refused by links_url_host_check)", "https://exa_mple.com/"],
      ["a host with a sub-delimiter (refused by links_url_host_check)", "https://a!b.com/"],
      ["credentials: user@host", "https://user@example.com/"],
      ["credentials: user:password@host", "https://user:secret@example.com/"],
      ["credentials hiding the real host", "https://linkedin.com%2F@evil.example/"],
      ["an inner space (new URL would percent-encode it)", "https://example.com/a b"],
      ["a leading space (new URL would strip it)", " https://example.com/"],
      ["a trailing space (new URL would strip it)", "https://example.com/ "],
      ["a tab (new URL would remove it)", "https://example.com/\tx"],
      ["a line feed inside the host (new URL would remove it)", "https://exa\nmple.com/"],
      ["a NUL character", "https://example.com/\u0000"],
      ["a DEL character", "https://example.com/\u007f"],
      ["a C1 control character", "https://example.com/\u0085"],
      ["a no-break space (Unicode space)", "https://example.com/\u00a0x"],
      ["an ideographic space (Unicode space)", "https://example.com/\u3000x"],
      ["decision 10: an IPv4 loopback host", "https://127.0.0.1"],
      ["decision 10: an IPv4 host in hexadecimal short form (normalized to 127.0.0.1)", "https://0x7f.1"],
      ["decision 10: an IPv4 host as a single integer (normalized to 127.0.0.1)", "https://2130706433"],
      ["decision 10: a public IPv4 host with port and path", "https://1.2.3.4:443/x"],
      ["decision 10: a host ending with a dot", "https://linkedin.com."],
      ["decision 10: a host ending with a dot, with a path", "https://www.linkedin.com./in/elodie"],
    ])("%s (%j)", (_label, text) => {
      expect(parseHttpsUrl(text)).toStrictEqual(err("invalid_url"));
    });
  });

  describe("length of the stored form", () => {
    it("accepts a URL of exactly 2048 characters", () => {
      const text = PREFIX + "a".repeat(HTTPS_URL_MAX_LENGTH - PREFIX.length);

      expect(text).toHaveLength(2048);
      expect(parseHttpsUrl(text)).toStrictEqual(ok({ value: text, host: "example.com" }));
    });

    it("refuses a URL of 2049 characters", () => {
      const text = PREFIX + "a".repeat(HTTPS_URL_MAX_LENGTH - PREFIX.length + 1);

      expect(parseHttpsUrl(text)).toStrictEqual(err("invalid_url"));
    });

    it("refuses a short text whose normalized href exceeds 2048 characters (percent-encoding counts)", () => {
      const text = PREFIX + "é".repeat(400);

      expect(text.length).toBeLessThan(HTTPS_URL_MAX_LENGTH);
      expect(new URL(text).href.length).toBeGreaterThan(HTTPS_URL_MAX_LENGTH);
      expect(parseHttpsUrl(text)).toStrictEqual(err("invalid_url"));
    });
  });
});
