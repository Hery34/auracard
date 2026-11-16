import type { MembershipReader, ProfileRegistrar } from "@/domain/profile/ports";
import type { IdGenerator } from "@/domain/shared/ports/id-generator";
import { err, ok, type Result } from "@/domain/shared/result";
import { registerProfile, type RegisterProfileError } from "@/server/use-cases/shared/register-profile";

export type EnsureMembershipError = "display_name_required" | RegisterProfileError;

/** `userId` comes from the server session (or the GoTrue answer), never from the client. */
export type EnsureMembershipInput = { userId: string; displayName?: string | undefined };

export type EnsureMembership = (input: EnsureMembershipInput) => Promise<Result<{ joined: boolean }, EnsureMembershipError>>;

/** An account of the instance (ADR 0002) joins `carnet` on first sign-in, with the name it gives. */
export function makeEnsureMembership(deps: {
  membership: MembershipReader;
  registrar: ProfileRegistrar;
  ids: IdGenerator;
}): EnsureMembership {
  return async (input) => {
    const member = await deps.membership.isMember();
    if (!member.ok) {
      return err("unexpected");
    }
    if (member.value) {
      return ok({ joined: false });
    }
    if (input.displayName === undefined) {
      return err("display_name_required");
    }
    const registered = await registerProfile(deps, { userId: input.userId, displayName: input.displayName });
    if (!registered.ok) {
      return err(registered.error);
    }
    return ok({ joined: true });
  };
}
