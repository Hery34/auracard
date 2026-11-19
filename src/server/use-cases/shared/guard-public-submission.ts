import type { DeviceClass } from "@/domain/analytics/analytics-event";
import { classifyUserAgent } from "@/domain/analytics/user-agent";
import { SLUG_PATTERN } from "@/domain/profile/slug";
import type { BotChallengeVerifier } from "@/domain/shared/ports/bot-challenge-verifier";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import type { RateLimitScope } from "@/domain/shared/rate-limits";
import { err, ok, type Result } from "@/domain/shared/result";
import { enforceRateLimits } from "@/server/use-cases/shared/enforce-rate-limits";

/** Longer than any Turnstile token; the only definition in src/. */
export const CHALLENGE_TOKEN_MAX_LENGTH = 2048;

export type PublicSubmissionPolicy = { addressScope: RateLimitScope; challengeAction: string };

export type PublicSubmissionGuardInput = {
  slug: string;
  challengeToken: string | undefined;
  userAgent: string | null;
  clientAddress: string;
};

export type PublicSubmissionGuardError =
  | "not_found"
  | "challenge_failed"
  | "challenge_unavailable"
  | "rate_limited"
  | "unexpected";

/**
 * Slug and token checked → robots refused → address counter of the policy → Turnstile bound to the slug.
 * The first refusal stops; nothing is written.
 */
export async function guardPublicSubmission(
  deps: { rateLimiter: RateLimiter; challenge: BotChallengeVerifier },
  policy: PublicSubmissionPolicy,
  { slug, challengeToken, userAgent, clientAddress }: PublicSubmissionGuardInput,
): Promise<Result<{ deviceClass: DeviceClass }, PublicSubmissionGuardError>> {
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
  const addressLimited = await enforceRateLimits(deps.rateLimiter, [
    { scope: policy.addressScope, subject: clientAddress },
  ]);
  if (!addressLimited.ok) {
    return err(addressLimited.error);
  }
  const verified = await deps.challenge.verify({
    token: challengeToken,
    expectedAction: policy.challengeAction,
    expectedCData: slug,
  });
  if (!verified.ok) {
    return err("challenge_unavailable");
  }
  if (!verified.value.passed) {
    return err("challenge_failed");
  }
  return ok({ deviceClass });
}
