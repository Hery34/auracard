import { parseHttpsUrl, type HttpsUrl } from "@/domain/profile/https-url";
import { err, ok, type Result } from "@/domain/shared/result";

/** `links_platform_check`. */
export const LINK_PLATFORMS = [
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
] as const;

export type LinkPlatform = (typeof LINK_PLATFORMS)[number];

/** Positions 0 to 11 (`links_position_range_check`). */
export const MAX_LINKS = 12;

/** `links_label_length_check`, in code points as `char_length`. */
export const LINK_LABEL_MAX_LENGTH = 40;

/** Domains allowed per platform, the host matching exactly or as a subdomain; `null` = any host. */
export const PLATFORM_HOSTS: Readonly<Record<LinkPlatform, readonly string[] | null>> = {
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
};

export type LinkError = "invalid_platform" | "invalid_url" | "host_mismatch" | "invalid_label";

/** A link sent by the editor: `id` present = existing link kept in place, absent = creation. */
export type Link = { id?: string; platform: LinkPlatform; url: HttpsUrl; label: string | null };

/** A link as stored by `carnet.replace_links`. */
export type SavedLink = { id: string; platform: LinkPlatform; url: string; label: string | null; position: number };

/** Code points of `links_label_charset_check` (U+200C and U+200D allowed); the bio reuses them, line breaks aside. */
export const FORBIDDEN_LABEL_CHARACTERS =
  /[\p{Cc}\u00AD\u061C\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u;

export function isLinkPlatform(text: string): text is LinkPlatform {
  return (LINK_PLATFORMS as readonly string[]).includes(text);
}

/** JavaScript `trim()` (Unicode spaces included); a blank label is `null`. */
export function parseLinkLabel(text: string | null | undefined): Result<string | null, "invalid_label"> {
  const label = (text ?? "").trim();
  if (label === "") {
    return ok(null);
  }
  if ([...label].length > LINK_LABEL_MAX_LENGTH || FORBIDDEN_LABEL_CHARACTERS.test(label)) {
    return err("invalid_label");
  }
  return ok(label);
}

export function parseLink(input: {
  id?: string;
  platform: string;
  url: string;
  label?: string | null;
}): Result<Link, LinkError> {
  const { platform } = input;
  if (!isLinkPlatform(platform)) {
    return err("invalid_platform");
  }
  const url = parseHttpsUrl(input.url);
  if (!url.ok) {
    return err("invalid_url");
  }
  if (!hostMatches(url.value.host, PLATFORM_HOSTS[platform])) {
    return err("host_mismatch");
  }
  const label = parseLinkLabel(input.label);
  if (!label.ok) {
    return err("invalid_label");
  }
  const link = { platform, url: url.value.value, label: label.value };
  return ok(input.id === undefined ? link : { id: input.id, ...link });
}

function hostMatches(host: string, domains: readonly string[] | null): boolean {
  return domains === null || domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
