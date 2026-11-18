import { classifyUserAgent } from "@/domain/analytics/user-agent";
import { LEAD_CHALLENGE_ACTION, type LeadSubmission } from "@/domain/lead/lead";
import type { LeadCapturer } from "@/domain/lead/ports";
import { SLUG_PATTERN } from "@/domain/profile/slug";
import type { BotChallengeVerifier } from "@/domain/shared/ports/bot-challenge-verifier";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, type Result } from "@/domain/shared/result";
import { enforceRateLimits } from "@/server/use-cases/shared/enforce-rate-limits";

/** Longer than any Turnstile token. */
const CHALLENGE_TOKEN_MAX_LENGTH = 2048;

export type CaptureLeadInput = LeadSubmission & {
  slug: string;
  challengeToken: string | undefined;
  userAgent: string | null;
  clientAddress: string;
};

export type CaptureLeadError =
  | "not_found"
  | "challenge_failed"
  | "challenge_unavailable"
  | "rate_limited"
  | "unexpected";

export type CaptureLead = (input: CaptureLeadInput) => Promise<Result<{ leadId: string }, CaptureLeadError>>;

/**
 * The submission is already validated by the action. Slug and token checked → robots refused → `lead` (address)
 * counter → Turnstile bound to the slug → `lead-profile` (slug) counter → `capture_lead`.
 * Nothing is written on any refusal; a replay with the same key gives the lead already stored.
 */
export function makeCaptureLead(deps: {
  rateLimiter: RateLimiter;
  challenge: BotChallengeVerifier;
  leads: LeadCapturer;
}): CaptureLead {
  return async ({ slug, challengeToken, userAgent, clientAddress, ...submission }) => {
    if (!SLUG_PATTERN.test(slug)) {
      return err("not_found");
    }
    if (challengeToken === undefined || challengeToken === "" || challengeToken.length > CHALLENGE_TOKEN_MAX_LENGTH) {
      return err("challenge_failed");
    }
    const deviceClass = classifyUserAgent(userAgent);
    if (deviceClass === "bot") {
      return err("challenge_failed");
    }
    const addressLimited = await enforceRateLimits(deps.rateLimiter, [{ scope: "lead", subject: clientAddress }]);
    if (!addressLimited.ok) {
      return err(addressLimited.error);
    }
    const verified = await deps.challenge.verify({
      token: challengeToken,
      expectedAction: LEAD_CHALLENGE_ACTION,
      expectedCData: slug,
    });
    if (!verified.ok) {
      return err("challenge_unavailable");
    }
    if (!verified.value.passed) {
      return err("challenge_failed");
    }
    const profileLimited = await enforceRateLimits(deps.rateLimiter, [{ scope: "lead-profile", subject: slug }]);
    if (!profileLimited.ok) {
      return err(profileLimited.error);
    }
    return deps.leads.capture({ ...submission, slug, deviceClass });
  };
}
