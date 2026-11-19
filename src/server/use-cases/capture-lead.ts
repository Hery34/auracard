import { LEAD_CHALLENGE_ACTION, type LeadSubmission } from "@/domain/lead/lead";
import type { LeadCapturer } from "@/domain/lead/ports";
import type { BotChallengeVerifier } from "@/domain/shared/ports/bot-challenge-verifier";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, type Result } from "@/domain/shared/result";
import { enforceRateLimits } from "@/server/use-cases/shared/enforce-rate-limits";
import { guardPublicSubmission, type PublicSubmissionGuardError } from "@/server/use-cases/shared/guard-public-submission";

export type CaptureLeadInput = LeadSubmission & {
  slug: string;
  challengeToken: string | undefined;
  userAgent: string | null;
  clientAddress: string;
};

export type CaptureLeadError = PublicSubmissionGuardError;

export type CaptureLead = (input: CaptureLeadInput) => Promise<Result<{ leadId: string }, CaptureLeadError>>;

/**
 * The submission is already validated by the action. Public submission guard (`lead` address counter, Turnstile
 * bound to the slug) → `lead-profile` (slug) counter → `capture_lead`.
 * Nothing is written on any refusal; a replay with the same key gives the lead already stored.
 */
export function makeCaptureLead(deps: {
  rateLimiter: RateLimiter;
  challenge: BotChallengeVerifier;
  leads: LeadCapturer;
}): CaptureLead {
  return async ({ slug, challengeToken, userAgent, clientAddress, ...submission }) => {
    const guarded = await guardPublicSubmission(
      deps,
      { addressScope: "lead", challengeAction: LEAD_CHALLENGE_ACTION },
      { slug, challengeToken, userAgent, clientAddress },
    );
    if (!guarded.ok) {
      return err(guarded.error);
    }
    const profileLimited = await enforceRateLimits(deps.rateLimiter, [{ scope: "lead-profile", subject: slug }]);
    if (!profileLimited.ok) {
      return err(profileLimited.error);
    }
    return deps.leads.capture({ ...submission, slug, deviceClass: guarded.value.deviceClass });
  };
}
