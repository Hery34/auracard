import { err, ok, type Result } from "@/domain/shared/result";

export type HttpsUrl = string & { readonly __brand: "HttpsUrl" };

/** The stored `href` and its analysed host (ASCII, lower case, without port). */
export type ParsedHttpsUrl = { value: HttpsUrl; host: string };

/** `links_url_length_check` and `profiles_website_url_length_check`. */
export const HTTPS_URL_MAX_LENGTH = 2048;

/** Refused anywhere in the raw text: `new URL` would silently strip, remove or encode them. */
const FORBIDDEN_CHARACTERS = /[\s\p{Cc}]/u;
/** Punycode alphabet, as `links_url_host_check`. */
const HOSTNAME_PATTERN = /^[a-z0-9.-]+$/;
/** `new URL` normalizes every IPv4 form (hexadecimal, octal, single integer…) to dotted decimal. */
const IPV4_HOSTNAME = /^\d+\.\d+\.\d+\.\d+$/;

/**
 * Absolute `https:` URL with a dotted host name (no IPv4, no trailing dot) and no credentials, stored as its normalized
 * ASCII `href`. `new URL` rather than `URL.parse`: the module is shared with the forms (Safari < 18).
 */
export function parseHttpsUrl(text: string): Result<ParsedHttpsUrl, "invalid_url"> {
  if (FORBIDDEN_CHARACTERS.test(text)) {
    return err("invalid_url");
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return err("invalid_url");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    return err("invalid_url");
  }
  const host = url.hostname;
  if (!host.includes(".") || !HOSTNAME_PATTERN.test(host) || IPV4_HOSTNAME.test(host) || host.endsWith(".")) {
    return err("invalid_url");
  }
  if (url.href.length > HTTPS_URL_MAX_LENGTH) {
    return err("invalid_url");
  }
  return ok({ value: url.href as HttpsUrl, host });
}
