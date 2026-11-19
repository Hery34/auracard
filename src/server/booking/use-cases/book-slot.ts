import { BOOKING_CHALLENGE_ACTION, type BookingSubmission } from "@/domain/booking/booking";
import type { SlotBooker } from "@/domain/booking/ports";
import type { BotChallengeVerifier } from "@/domain/shared/ports/bot-challenge-verifier";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, type Result } from "@/domain/shared/result";
import { guardPublicSubmission } from "@/server/use-cases/shared/guard-public-submission";

export type BookSlotInput = BookingSubmission & {
  slug: string;
  challengeToken: string | undefined;
  userAgent: string | null;
  clientAddress: string;
};

export type BookSlotError =
  | "not_found"
  | "challenge_failed"
  | "challenge_unavailable"
  | "rate_limited"
  | "slot_taken"
  | "slot_unavailable"
  | "phone_required"
  | "invalid_input"
  | "unexpected";

export type BookSlot = (input: BookSlotInput) => Promise<Result<{ bookingId: string }, BookSlotError>>;

/**
 * The submission is already validated by the action. Shared public guard (`booking` address counter, Turnstile bound
 * to the slug) → `book_slot`, which confirms at once (ADR 0016 §1) and enforces the profile quota on successful
 * bookings (CN005 → `rate_limited`). Nothing is written on any refusal; a replay with the same key gives the booking
 * already stored.
 */
export function makeBookSlot(deps: {
  rateLimiter: RateLimiter;
  challenge: BotChallengeVerifier;
  bookings: SlotBooker;
}): BookSlot {
  return async ({ slug, challengeToken, userAgent, clientAddress, ...submission }) => {
    const guarded = await guardPublicSubmission(
      deps,
      { addressScope: "booking", challengeAction: BOOKING_CHALLENGE_ACTION },
      { slug, challengeToken, userAgent, clientAddress },
    );
    if (!guarded.ok) {
      return err(guarded.error);
    }
    const booked = await deps.bookings.book({ ...submission, slug, deviceClass: guarded.value.deviceClass });
    if (booked.ok) {
      return booked;
    }
    return err(booked.error === "profile_quota" ? "rate_limited" : booked.error);
  };
}
