import type { LinkPlatform, SavedLink } from "@/domain/profile/link";
import type { OwnProfile } from "@/domain/profile/ports";
import type { PublicProfile } from "@/domain/profile/profile";

export const TEXT_FIELDS = ["displayName", "jobTitle", "company", "bio", "contactEmail", "phone", "websiteUrl"] as const;

export type TextFieldName = (typeof TEXT_FIELDS)[number];

/** Form values as typed: empty string for an empty field. */
export type EditorFields = Record<TextFieldName, string> & { isPublished: boolean; isIndexable: boolean };

/** `key` identifies the row in React; `id` is the stored link's, `null` until the first save. */
export type EditorLink = { key: string; id: string | null; platform: LinkPlatform; url: string; label: string };

export function toEditorFields(profile: OwnProfile): EditorFields {
  return {
    displayName: profile.displayName,
    jobTitle: profile.jobTitle ?? "",
    company: profile.company ?? "",
    bio: profile.bio ?? "",
    contactEmail: profile.contactEmail ?? "",
    phone: profile.phone ?? "",
    websiteUrl: profile.websiteUrl ?? "",
    isPublished: profile.isPublished,
    isIndexable: profile.isIndexable,
  };
}

export function toEditorLinks(links: readonly SavedLink[]): EditorLink[] {
  return [...links]
    .sort((first, second) => first.position - second.position)
    .map((link) => ({ key: link.id, id: link.id, platform: link.platform, url: link.url, label: link.label ?? "" }));
}

/** The unsaved form as the public page would show it: same trimming as the server, no avatar yet (0021). */
export function toPreviewProfile(slug: string, fields: EditorFields, links: readonly EditorLink[]): PublicProfile {
  return {
    slug,
    displayName: fields.displayName.trim(),
    jobTitle: blankToNull(fields.jobTitle),
    company: blankToNull(fields.company),
    bio: blankToNull(fields.bio),
    avatarUrl: null,
    bannerUrl: null,
    contactEmail: blankToNull(fields.contactEmail),
    phone: blankToNull(fields.phone),
    websiteUrl: blankToNull(fields.websiteUrl),
    isIndexable: fields.isIndexable,
    links: links.map((link, position) => ({
      platform: link.platform,
      url: link.url.trim(),
      label: blankToNull(link.label),
      position,
    })),
  };
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
