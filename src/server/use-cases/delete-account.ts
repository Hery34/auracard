import type {
  CarnetAccountEraser,
  InstanceAccountRemover,
  MediaFolderCleaner,
  PublicProfileCache,
} from "@/domain/account/ports";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, ok, type Result } from "@/domain/shared/result";
import { enforceRateLimits } from "@/server/use-cases/shared/enforce-rate-limits";

export type DeleteAccountError = "unauthenticated" | "rate_limited" | "unexpected";

export type DeleteAccount = () => Promise<Result<void, DeleteAccountError>>;

/**
 * Deletes the session's account (0023): media folder, then carnet rows and membership, then the instance account when
 * no other project holds it. Every step is replayable; a failure stops the chain and the next run completes it. The
 * media go first because the Storage policies need the profile and the membership. The slug read is expired right after
 * the SQL step even when it failed (committed with the answer lost, the replay would read no slug any more), then the
 * slug answered by the SQL step when it differs (profile unreadable under RLS).
 */
export function makeDeleteAccount(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  mediaFolder: MediaFolderCleaner;
  carnetAccount: CarnetAccountEraser;
  instanceAccounts: InstanceAccountRemover;
  profileCache: PublicProfileCache;
}): DeleteAccount {
  return async () => {
    const user = await deps.auth.currentUser();
    if (!user.ok) {
      return err("unexpected");
    }
    if (user.value === null) {
      return err("unauthenticated");
    }
    const { userId } = user.value;
    const limited = await enforceRateLimits(deps.rateLimiter, [{ scope: "profile-write", subject: userId }]);
    if (!limited.ok) {
      return err(limited.error);
    }
    const own = await deps.profiles.getOwn();
    if (!own.ok) {
      return err("unexpected");
    }
    const profile = own.value;
    if (profile !== null) {
      const emptied = await deps.mediaFolder.empty(profile.id);
      if (!emptied.ok) {
        return err("unexpected");
      }
    }
    const erased = await deps.carnetAccount.erase();
    if (profile !== null) {
      deps.profileCache.expire(profile.slug);
    }
    if (!erased.ok) {
      return err("unexpected");
    }
    if (erased.value !== null && erased.value !== profile?.slug) {
      deps.profileCache.expire(erased.value);
    }
    const orphan = await deps.instanceAccounts.isOrphan(userId);
    if (!orphan.ok) {
      return err("unexpected");
    }
    if (orphan.value) {
      const removed = await deps.instanceAccounts.remove(userId);
      if (!removed.ok) {
        return err("unexpected");
      }
    }
    return ok(undefined);
  };
}
