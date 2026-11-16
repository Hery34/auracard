import { z } from "zod";

import { HTTPS_URL_MAX_LENGTH, parseHttpsUrl, type HttpsUrl } from "@/domain/profile/https-url";
import {
  FORBIDDEN_LABEL_CHARACTERS,
  LINK_LABEL_MAX_LENGTH,
  LINK_PLATFORMS,
  MAX_LINKS,
  parseLink,
} from "@/domain/profile/link";
import { parsePhone, PHONE_MAX_LENGTH } from "@/domain/profile/phone";
import { PROFILE_TEXT_MAX_LENGTH } from "@/domain/profile/profile";
import { ok, type Result } from "@/domain/shared/result";
import { registerSchema } from "@/server/actions/auth-schemas";
import { SINGLE_LINE_TEXT } from "@/server/actions/single-line-text";

export { HTTPS_URL_MAX_LENGTH, LINK_LABEL_MAX_LENGTH, LINK_PLATFORMS, MAX_LINKS, PHONE_MAX_LENGTH, PROFILE_TEXT_MAX_LENGTH };

/** Same rule as registration. */
const displayNameSchema = registerSchema.shape.displayName;

/** Trimmed; absent or blank → `null` (clearing a field). */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => {
    if (value === undefined) {
      return null;
    }
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }, schema.nullable());
}

/** A domain parser as a Zod step; the issue carries the error code only, never the value. */
function parsedWith<T>(parse: (text: string) => Result<T, string>) {
  return z.string().transform((text, context) => unwrap(parse(text), context));
}

function unwrap<T>(result: Result<T, string>, context: z.RefinementCtx): T {
  if (!result.ok) {
    context.addIssue({ code: "custom", message: result.error });
    return z.NEVER;
  }
  return result.value;
}

function parseWebsiteUrl(text: string): Result<HttpsUrl, "invalid_url"> {
  const url = parseHttpsUrl(text);
  return url.ok ? ok(url.value.value) : url;
}

/** Checkbox: `"on"` when checked, absent otherwise. */
const switchSchema = z.literal("on").optional().transform((value) => value === "on");

const singleLine = (max: number) => z.string().max(max).regex(SINGLE_LINE_TEXT);

/** Full update of the editable fields; unknown keys (slug, id, owner_id…) stripped. */
export const updateProfileSchema = z.object({
  displayName: displayNameSchema,
  jobTitle: optional(singleLine(PROFILE_TEXT_MAX_LENGTH.jobTitle)),
  company: optional(singleLine(PROFILE_TEXT_MAX_LENGTH.company)),
  bio: optional(
    z
      .string()
      .max(PROFILE_TEXT_MAX_LENGTH.bio)
      .refine((text) => !FORBIDDEN_LABEL_CHARACTERS.test(text.replace(/[\n\r]/g, ""))),
  ),
  contactEmail: optional(z.email().max(PROFILE_TEXT_MAX_LENGTH.contactEmail)),
  phone: optional(parsedWith(parsePhone)),
  websiteUrl: optional(parsedWith(parseWebsiteUrl)),
  isPublished: switchSchema,
  isIndexable: switchSchema,
});

const linkSchema = z
  .object({
    id: z
      .uuid()
      .transform((id) => id.toLowerCase())
      .nullish(),
    platform: z.string(),
    url: z.string().trim(),
    label: z.string().nullish(),
  })
  .transform(({ id, platform, url, label = null }, context) =>
    unwrap(parseLink(id == null ? { platform, url, label } : { id, platform, url, label }), context),
  );

/** The full ordered list (at most MAX_LINKS, distinct ids); unknown keys (position, profile_id…) stripped. */
export const replaceLinksSchema = z.object({
  links: z
    .array(linkSchema)
    .max(MAX_LINKS)
    .refine((links) => {
      const ids = links.flatMap((link) => (link.id === undefined ? [] : [link.id]));
      return new Set(ids).size === ids.length;
    }, "duplicate_id"),
});
