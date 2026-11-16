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

export type OwnProfile = { id: string; slug: string; displayName: string; isPublished: boolean };

/** Profile of the account behind the current server session; `null` when that account has none. */
export interface ProfileReader {
  getOwn(): Promise<Result<OwnProfile | null, "unexpected">>;
}
