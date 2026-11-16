"use server";

import { updateTag } from "next/cache";
import type { z } from "zod";

import type { SavedLink } from "@/domain/profile/link";
import { replaceLinksSchema, updateProfileSchema } from "@/server/actions/profile-schemas";
import { createContainer } from "@/server/container";
import type { ReplaceLinksError } from "@/server/use-cases/replace-links";
import type { UpdateProfileError } from "@/server/use-cases/update-profile";

export type ProfileActionError = "invalid_input" | UpdateProfileError | ReplaceLinksError;

type ErrorState = { status: "error"; error: ProfileActionError; fields?: Record<string, string> };

export type UpdateProfileState = { status: "idle" } | ErrorState | { status: "saved" };

export type ReplaceLinksState = { status: "idle" } | ErrorState | { status: "saved"; links: SavedLink[] };

const PROFILE_FIELDS = [
  "displayName",
  "jobTitle",
  "company",
  "bio",
  "contactEmail",
  "phone",
  "websiteUrl",
  "isPublished",
  "isIndexable",
] as const;

/** The session, the rate limit and the ownership of the profile are checked by the use case. */
export async function updateProfileAction(
  _previous: UpdateProfileState,
  formData: FormData,
): Promise<UpdateProfileState> {
  const parsed = updateProfileSchema.safeParse(textFields(formData, PROFILE_FIELDS));
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }
  const { updateProfile } = await createContainer();
  const result = await updateProfile(parsed.data);
  if (!result.ok) {
    return { status: "error", error: result.error };
  }
  invalidateProfile(result.value.slug);
  return { status: "saved" };
}

/** Field `links`: JSON array, the full ordered list; every existing link carries its `id`. */
export async function replaceLinksAction(_previous: ReplaceLinksState, formData: FormData): Promise<ReplaceLinksState> {
  const parsed = replaceLinksSchema.safeParse({ links: jsonField(formData, "links") });
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }
  const { replaceLinks } = await createContainer();
  const result = await replaceLinks(parsed.data.links);
  if (!result.ok) {
    return { status: "error", error: result.error };
  }
  invalidateProfile(result.value.slug);
  return { status: "saved", links: result.value.links };
}

/** Public page, vCard and "not found" page share the tag `profile:<slug>` (`docs/rules/nextjs.md`); read-your-own-writes. */
function invalidateProfile(slug: string): void {
  updateTag(`profile:${slug}`);
}

function textFields(formData: FormData, names: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(
    names.map((name) => {
      const value = formData.get(name);
      return [name, typeof value === "string" ? value : undefined];
    }),
  );
}

/** Unparsable or absent → `undefined`, refused by the schema. */
function jsonField(formData: FormData, name: string): unknown {
  const value = formData.get(name);
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/** Paths and messages only: the messages are error codes or Zod's own texts, never the submitted value. */
function invalidInput(error: z.ZodError): ErrorState {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    fields[issue.path.map(String).join(".")] ??= issue.message;
  }
  return { status: "error", error: "invalid_input", fields };
}
