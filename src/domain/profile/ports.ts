import type { Link, SavedLink } from "@/domain/profile/link";
import type { ProfileUpdate, PublicProfile } from "@/domain/profile/profile";
import type { Slug } from "@/domain/profile/slug";
import type { Result } from "@/domain/shared/result";

export type RegistrarError = "slug_taken" | "project_inactive" | "unexpected";

export type Registration = { userId: string; displayName: string; slug: Slug };

/** Membership of `carnet` plus the initial profile, in one idempotent operation. */
export interface ProfileRegistrar {
  register(input: Registration): Promise<Result<{ profileId: string }, RegistrarError>>;
}

/** Membership of the account behind the current server session. */
export interface MembershipReader {
  isMember(): Promise<Result<boolean, "unexpected">>;
}

/** Every editable field as stored (`null` when empty), plus `id` and `slug`. */
export type OwnProfile = {
  id: string;
  slug: string;
  displayName: string;
  jobTitle: string | null;
  company: string | null;
  bio: string | null;
  contactEmail: string | null;
  phone: string | null;
  websiteUrl: string | null;
  isPublished: boolean;
  isIndexable: boolean;
};

/** Profile of the account behind the current server session; `null` when that account has none. */
export interface ProfileReader {
  getOwn(): Promise<Result<OwnProfile | null, "unexpected">>;
}

export type ProfileWriteError = "not_found" | "invalid_input" | "unexpected";

/** Writes under the session: a profile the caller cannot edit is `not_found`. */
export interface ProfileWriter {
  update(profileId: string, update: ProfileUpdate): Promise<Result<void, ProfileWriteError>>;
}

export interface LinkRepository {
  /** Replaces the full ordered list (`id` keeps an existing link in place); returns the stored rows by position. */
  replace(profileId: string, links: readonly Link[]): Promise<Result<SavedLink[], ProfileWriteError>>;
  /** Links of `profileId` visible under the session, by position; another account's profile gives `[]`. */
  listOwn(profileId: string): Promise<Result<SavedLink[], "unexpected">>;
}

/** Published profile by slug, without session; not published or unknown → `null`. */
export interface PublicProfileReader {
  getBySlug(slug: Slug): Promise<Result<PublicProfile | null, "unexpected">>;
}
