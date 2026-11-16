import { parseSlug, type Slug } from "@/domain/profile/slug";

/** Builds a `Slug` from a literal known to be valid; throws otherwise so a typo cannot go unnoticed. */
export function aSlug(text: string): Slug {
  const result = parseSlug(text);
  if (!result.ok) {
    throw new Error(`aSlug: "${text}" is not a valid slug (${result.error})`);
  }
  return result.value;
}
