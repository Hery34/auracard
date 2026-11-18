import type { Result } from "@/domain/shared/result";

/** `expectedAction` and `expectedCData` bind the token to the widget that produced it (the slug for the contact form). */
export type BotChallengeInput = { token: string; expectedAction: string; expectedCData: string };

export interface BotChallengeVerifier {
  /**
   * `passed: false` when the provider refuses the token (invalid, expired, spent, other action or cData);
   * `unavailable` when it cannot answer. Never throws.
   */
  verify(input: BotChallengeInput): Promise<Result<{ passed: boolean }, "unavailable">>;
}
