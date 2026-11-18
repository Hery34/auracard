import type { HttpsUrl } from "@/domain/profile/https-url";
import type { LinkPlatform } from "@/domain/profile/link";
import type { Phone } from "@/domain/profile/phone";

/** Length checks of `carnet.profiles`. */
export const PROFILE_TEXT_MAX_LENGTH = {
  displayName: 80,
  jobTitle: 80,
  company: 80,
  bio: 500,
  contactEmail: 254,
} as const;

/** Full update of the editable fields (`docs/rules/idempotence.md`); the slug is never part of it. */
export type ProfileUpdate = {
  displayName: string;
  jobTitle: string | null;
  company: string | null;
  bio: string | null;
  contactEmail: string | null;
  phone: Phone | null;
  websiteUrl: HttpsUrl | null;
  isPublished: boolean;
  isIndexable: boolean;
  acceptsLeads: boolean;
};

export type PublicLink = { id: string; platform: LinkPlatform; url: string; label: string | null; position: number };

/** Published profile as the public page and the vCard show it; links sorted by position. */
export type PublicProfile = {
  slug: string;
  displayName: string;
  jobTitle: string | null;
  company: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  logoUrl: string | null;
  contactEmail: string | null;
  phone: string | null;
  websiteUrl: string | null;
  isIndexable: boolean;
  acceptsLeads: boolean;
  links: PublicLink[];
};
