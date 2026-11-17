import { isNfcTagUid, normalizeActivationCode } from "@/domain/nfc/nfc-tag";
import type { NfcTagRepository } from "@/domain/nfc/ports";
import type { MembershipReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, ok, type Result } from "@/domain/shared/result";
import { enforceRateLimits } from "@/server/use-cases/shared/enforce-rate-limits";

export type ActivateNfcTagInput = { uid: string; code: string; clientAddress: string };

export type ActivateNfcTagError = "unauthenticated" | "no_profile" | "rate_limited" | "invalid" | "unexpected";

export type ActivateNfcTag = (
  input: ActivateNfcTagInput,
) => Promise<Result<"activated" | "already_yours", ActivateNfcTagError>>;

/**
 * Session → membership (an account of another project has no profile) → `nfc-activate` counter of the address →
 * `activate_nfc_tag` (per-account counter, code check, assignment). Replayed: `already_yours`, the same success.
 * A malformed uid or code is `invalid`, the answer of a wrong code, after the address counter.
 */
export function makeActivateNfcTag(deps: {
  auth: AuthGateway;
  membership: MembershipReader;
  rateLimiter: RateLimiter;
  tags: NfcTagRepository;
}): ActivateNfcTag {
  return async ({ uid, code, clientAddress }) => {
    const user = await deps.auth.currentUser();
    if (!user.ok) {
      return err("unexpected");
    }
    if (user.value === null) {
      return err("unauthenticated");
    }
    const member = await deps.membership.isMember();
    if (!member.ok) {
      return err("unexpected");
    }
    if (!member.value) {
      return err("no_profile");
    }
    const limited = await enforceRateLimits(deps.rateLimiter, [{ scope: "nfc-activate", subject: clientAddress }]);
    if (!limited.ok) {
      return err(limited.error);
    }
    const normalized = normalizeActivationCode(code);
    if (!isNfcTagUid(uid) || normalized === null) {
      return err("invalid");
    }
    const activated = await deps.tags.activate(uid, normalized);
    if (!activated.ok) {
      return err(activated.error === "not_member" ? "no_profile" : "unexpected");
    }
    const outcome = activated.value;
    if (outcome === "activated" || outcome === "already_yours") {
      return ok(outcome);
    }
    return err(outcome);
  };
}
