import type { Result } from "@/domain/shared/result";

/** Folder `carnet-media/<profileId>/` under the session of the caller; already empty is a success. */
export interface MediaFolderCleaner {
  empty(profileId: string): Promise<Result<void, "unexpected">>;
}

/**
 * `carnet.delete_own_account()` under the session; nothing left to delete is a success. Answers the slug of the
 * deleted profile, `null` when none.
 */
export interface CarnetAccountEraser {
  erase(): Promise<Result<string | null, "unexpected">>;
}

/** Instance-wide account (`auth.users`), `service_role` only (ADR 0011). */
export interface InstanceAccountRemover {
  /** `true` when the account belongs to no project of the instance any more. */
  isOrphan(userId: string): Promise<Result<boolean, "unexpected">>;
  /** Hard delete; an account already absent is a success. */
  remove(userId: string): Promise<Result<void, "unexpected">>;
}

/** Cached public read of `/p/{slug}`. */
export interface PublicProfileCache {
  expire(slug: string): void;
}
