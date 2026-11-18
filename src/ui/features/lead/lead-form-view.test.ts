/**
 * Contract frozen by test-engineer (0032, decision 14 after the second audit): what the contact form does after an
 * answer of the action.
 *
 * // src/ui/features/lead/lead-form-view.ts
 * // A new Turnstile token after any refusal but invalid_input (a token is accepted once by Cloudflare).
 * export function needsNewChallenge(state: CaptureLeadState): boolean;
 * // A new idempotency key (crypto.randomUUID(), in the browser) after any refusal without write — every error but
 * // `unexpected`, where a write is not excluded (the same key keeps the replay idempotent).
 * export function needsNewIdempotencyKey(state: CaptureLeadState): boolean;
 */
import { describe, expect, it } from "vitest";

import type { CaptureLeadActionError, CaptureLeadState } from "@/server/actions/lead";
import { needsNewChallenge, needsNewIdempotencyKey } from "@/ui/features/lead/lead-form-view";

const ERRORS: readonly CaptureLeadActionError[] = [
  "invalid_input",
  "not_found",
  "challenge_failed",
  "challenge_unavailable",
  "rate_limited",
  "unexpected",
];

const NOT_WRITTEN = ERRORS.filter((error) => error !== "unexpected");

describe("needsNewIdempotencyKey (decision 14)", () => {
  it.each(NOT_WRITTEN)("%s → a new key (nothing was written, the refused key is never sent again)", (error) => {
    expect(needsNewIdempotencyKey({ status: "error", error })).toBe(true);
  });

  it("unexpected → the same key (a write is not excluded: the replay stays idempotent)", () => {
    expect(needsNewIdempotencyKey({ status: "error", error: "unexpected" })).toBe(false);
  });

  it.each<CaptureLeadState>([{ status: "idle" }, { status: "sent" }])("%j → the same key", (state) => {
    expect(needsNewIdempotencyKey(state)).toBe(false);
  });
});

describe("needsNewChallenge (decision 14)", () => {
  it.each(ERRORS.filter((error) => error !== "invalid_input"))("%s → a new token", (error) => {
    expect(needsNewChallenge({ status: "error", error })).toBe(true);
  });

  it("invalid_input → the same token (the challenge was not reached)", () => {
    expect(needsNewChallenge({ status: "error", error: "invalid_input" })).toBe(false);
  });

  it.each<CaptureLeadState>([{ status: "idle" }, { status: "sent" }])("%j → no new token", (state) => {
    expect(needsNewChallenge(state)).toBe(false);
  });
});
