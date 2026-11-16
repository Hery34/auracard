import { err, ok, type Result } from "@/domain/shared/result";

export type Slug = string & { readonly __brand: "Slug" };

export type SlugError = "invalid_slug" | "reserved_slug";

/** Same rule as the `profiles_slug_format_check` constraint of the database. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const SLUG_MAX_LENGTH = 40;
const SLUG_MIN_LENGTH = 3;
const PADDING = "x";
const RESERVED_SUFFIX = "1";
/** Leaves room for one base character and the hyphen: the result is always a valid slug. */
const SUFFIX_MAX_LENGTH = SLUG_MAX_LENGTH - 2;

/** Route prefixes and names a public profile could otherwise shadow. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
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
]);

export function parseSlug(text: string): Result<Slug, SlugError> {
  if (RESERVED_SLUGS.has(text)) {
    return err("reserved_slug");
  }
  if (!SLUG_PATTERN.test(text)) {
    return err("invalid_slug");
  }
  return ok(text as Slug);
}

/**
 * Deterministic derivation: diacritics stripped, lowercased, runs outside [a-z0-9] collapsed to one
 * hyphen, padded with "x" below 3 characters, cut at 40 without a trailing hyphen, "-1" when reserved.
 */
export function slugFromDisplayName(name: string): Slug {
  const normalized = trimHyphens(
    name
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-"),
  );
  const padded = normalized.length < SLUG_MIN_LENGTH ? `${normalized || PADDING}-${PADDING}` : normalized;
  const base = trimHyphens(padded.slice(0, SLUG_MAX_LENGTH));
  return (RESERVED_SLUGS.has(base) ? appendSuffix(base, RESERVED_SUFFIX) : base) as Slug;
}

/**
 * Appends `-<suffix>` (suffix reduced to [a-z0-9] and bounded), shortening the base so the result stays a
 * valid slug whatever the suffix: 3 to 40 characters, no hyphen at either end. An empty suffix is a no-op.
 */
export function slugWithSuffix(slug: Slug, suffix: string): Slug {
  const normalizedSuffix = suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, SUFFIX_MAX_LENGTH);
  return (normalizedSuffix === "" ? slug : appendSuffix(slug, normalizedSuffix)) as Slug;
}

function appendSuffix(base: string, suffix: string): string {
  const room = SLUG_MAX_LENGTH - suffix.length - 1;
  return `${trimHyphens(base.slice(0, room))}-${suffix}`;
}

function trimHyphens(text: string): string {
  return text.replace(/^-+|-+$/g, "");
}
