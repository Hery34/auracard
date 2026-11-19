/**
 * Contract frozen by test-engineer (0039 point 8: « la séquence jeton → robot → limite par adresse → Turnstile lié au
 * slug est extraite dans src/server/use-cases/shared/ (backend) et utilisée par capture-lead et book-slot
 * (CHALLENGE_TOKEN_MAX_LENGTH unique) »). Only the ports are fakes: rate limiter, bot challenge verifier (ADR 0008).
 *
 * // src/server/use-cases/shared/guard-public-submission.ts (backend)
 * /** Longer than any Turnstile token; the only definition in src/. *\/
 * export const CHALLENGE_TOKEN_MAX_LENGTH = 2048;
 * export type PublicSubmissionPolicy = { addressScope: RateLimitScope; challengeAction: string };
 * export type PublicSubmissionGuardInput = { slug: string; challengeToken: string | undefined;
 *   userAgent: string | null; clientAddress: string };
 * export type PublicSubmissionGuardError = "not_found" | "challenge_failed" | "challenge_unavailable" | "rate_limited"
 *   | "unexpected";
 * export function guardPublicSubmission(
 *   deps: { rateLimiter: RateLimiter; challenge: BotChallengeVerifier },
 *   policy: PublicSubmissionPolicy,
 *   input: PublicSubmissionGuardInput,
 * ): Promise<Result<{ deviceClass: DeviceClass }, PublicSubmissionGuardError>>;
 * // Imposed order, the first refusal stops:
 * //   1. no port called: slug not SLUG_PATTERN → not_found; token absent, empty or longer than
 * //      CHALLENGE_TOKEN_MAX_LENGTH → challenge_failed;
 * //   2. classifyUserAgent: bot (or no user-agent) → challenge_failed, no port called;
 * //   3. enforceRateLimits(rateLimiter, [{ scope: policy.addressScope, subject: clientAddress }]) → rate_limited |
 * //      unexpected (Turnstile not called);
 * //   4. challenge.verify({ token, expectedAction: policy.challengeAction, expectedCData: slug }) (token bound to the
 * //      profile): { passed: false } → challenge_failed; err("unavailable") → challenge_unavailable;
 * //   5. ok({ deviceClass }) (mobile | desktop), for the write that follows.
 * // makeCaptureLead (then lead-profile, then capture_lead) and makeBookSlot (then book_slot) call it; their own tests
 * // (capture-lead.test.ts, book-slot.test.ts) keep their behaviour.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BOOKING_CHALLENGE_ACTION } from "@/domain/booking/booking";
import { LEAD_CHALLENGE_ACTION } from "@/domain/lead/lead";
import { err, ok } from "@/domain/shared/result";
import {
  CHALLENGE_TOKEN_MAX_LENGTH,
  guardPublicSubmission,
  type PublicSubmissionGuardInput,
  type PublicSubmissionPolicy,
} from "@/server/use-cases/shared/guard-public-submission";

import { BOT_USER_AGENTS, DESKTOP_USER_AGENT, IPHONE_USER_AGENT } from "../../../../tests/builders/analytics";
import { makeCallLog } from "../../../../tests/builders/call-log";
import {
  fakeBotChallengeVerifier,
  type FakeBotChallengeVerifierOptions,
} from "../../../../tests/builders/fake-bot-challenge-verifier";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../../tests/builders/fake-rate-limiter";
import { CHALLENGE_TOKEN, LEAD_SLUG, OTHER_LEAD_SLUG, VISITOR_ADDRESS } from "../../../../tests/builders/lead";

const LEAD_POLICY: PublicSubmissionPolicy = { addressScope: "lead", challengeAction: LEAD_CHALLENGE_ACTION };
const BOOKING_POLICY: PublicSubmissionPolicy = { addressScope: "booking", challengeAction: BOOKING_CHALLENGE_ACTION };
const SRC_DIR = fileURLToPath(new URL("../../..", import.meta.url));

type HarnessOptions = {
  limiter?: Omit<FakeRateLimiterOptions, "log">;
  challenge?: Omit<FakeBotChallengeVerifierOptions, "log">;
};

function harness(options: HarnessOptions = {}) {
  const log = makeCallLog();
  const deps = {
    rateLimiter: fakeRateLimiter({ log, ...options.limiter }),
    challenge: fakeBotChallengeVerifier({ log, ...options.challenge }),
  };
  return {
    log,
    guard: (overrides: Partial<PublicSubmissionGuardInput> = {}, policy: PublicSubmissionPolicy = LEAD_POLICY) =>
      guardPublicSubmission(deps, policy, {
        slug: LEAD_SLUG,
        challengeToken: CHALLENGE_TOKEN,
        userAgent: IPHONE_USER_AGENT,
        clientAddress: VISITOR_ADDRESS,
        ...overrides,
      }),
  };
}

describe("guardPublicSubmission (0039 point 8)", () => {
  it("passes: address counter of the policy → Turnstile bound to the slug → ok({ deviceClass })", async () => {
    const { log, guard } = harness();

    expect(await guard()).toStrictEqual(ok({ deviceClass: "mobile" }));

    expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "challenge.verify"]);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([
      { scope: "lead", subject: VISITOR_ADDRESS, limit: 5, windowSeconds: 3600 },
    ]);
    expect(log.inputsOf("challenge", "verify")).toStrictEqual([
      { token: CHALLENGE_TOKEN, expectedAction: LEAD_CHALLENGE_ACTION, expectedCData: LEAD_SLUG },
    ]);
  });

  it("the policy chooses the address scope and the Turnstile action (booking)", async () => {
    const { log, guard } = harness();

    await guard({ slug: OTHER_LEAD_SLUG }, BOOKING_POLICY);

    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([
      { scope: "booking", subject: VISITOR_ADDRESS, limit: 5, windowSeconds: 3600 },
    ]);
    expect(log.inputsOf("challenge", "verify")).toStrictEqual([
      { token: CHALLENGE_TOKEN, expectedAction: BOOKING_CHALLENGE_ACTION, expectedCData: OTHER_LEAD_SLUG },
    ]);
  });

  it("the device class of classifyUserAgent is returned (desktop → desktop)", async () => {
    expect(await harness().guard({ userAgent: DESKTOP_USER_AGENT })).toStrictEqual(ok({ deviceClass: "desktop" }));
  });

  describe("step 1 — slug and token, no port called", () => {
    it.each([
      ["path traversal", "../admin"],
      ["upper case", "Elodie-Durand"],
      ["empty", ""],
    ])("malformed slug (%s) → not_found", async (_label, slug) => {
      const { log, guard } = harness();

      expect(await guard({ slug })).toStrictEqual(err("not_found"));
      expect(log.sequence()).toStrictEqual([]);
    });

    it.each([
      ["absent", undefined],
      ["empty", ""],
      ["longer than CHALLENGE_TOKEN_MAX_LENGTH", "t".repeat(2049)],
    ])("token %s → challenge_failed", async (_label, challengeToken) => {
      const { log, guard } = harness();

      expect(await guard({ challengeToken })).toStrictEqual(err("challenge_failed"));
      expect(log.sequence()).toStrictEqual([]);
    });

    it("bound included: a token of exactly CHALLENGE_TOKEN_MAX_LENGTH characters reaches Turnstile", async () => {
      const { log, guard } = harness();

      expect((await guard({ challengeToken: "t".repeat(2048) })).ok).toBe(true);
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "challenge.verify"]);
    });

    it("the slug is checked first: malformed slug and no token → not_found", async () => {
      expect(await harness().guard({ slug: "../admin", challengeToken: undefined })).toStrictEqual(err("not_found"));
    });
  });

  describe("step 2 — robots refused before any port", () => {
    it.each(BOT_USER_AGENTS)("%s → challenge_failed, no counter, no Turnstile", async (_label, userAgent) => {
      const { log, guard } = harness();

      expect(await guard({ userAgent })).toStrictEqual(err("challenge_failed"));
      expect(log.sequence()).toStrictEqual([]);
    });

    it("no user-agent → refused like a robot", async () => {
      const { log, guard } = harness();

      expect(await guard({ userAgent: null })).toStrictEqual(err("challenge_failed"));
      expect(log.sequence()).toStrictEqual([]);
    });
  });

  describe("step 3 — address limit before Turnstile", () => {
    it("exhausted → rate_limited, Turnstile not called", async () => {
      const { log, guard } = harness({ limiter: { deny: ["lead"] } });

      expect(await guard()).toStrictEqual(err("rate_limited"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
    });

    it("failing limiter → unexpected, the door closes", async () => {
      const { log, guard } = harness({ limiter: { failing: true } });

      expect(await guard()).toStrictEqual(err("unexpected"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
    });
  });

  describe("step 4 — Turnstile bound to the slug (ADR 0008)", () => {
    it("token refused → challenge_failed", async () => {
      expect(await harness({ challenge: { outcome: "failed" } }).guard()).toStrictEqual(err("challenge_failed"));
    });

    it("the same token sent to another profile, refused by the provider → challenge_failed", async () => {
      const { guard } = harness({ challenge: { passingCData: [LEAD_SLUG] } });

      expect(await guard({ slug: OTHER_LEAD_SLUG })).toStrictEqual(err("challenge_failed"));
    });

    it("a token replayed → challenge_failed on the second call", async () => {
      const { guard } = harness({ challenge: { singleUseTokens: true } });

      expect((await guard()).ok).toBe(true);
      expect(await guard()).toStrictEqual(err("challenge_failed"));
    });

    it("Cloudflare unavailable → challenge_unavailable", async () => {
      expect(await harness({ challenge: { outcome: "unavailable" } }).guard()).toStrictEqual(err("challenge_unavailable"));
    });
  });

  describe("one guard for every public form (DRY)", () => {
    it("CHALLENGE_TOKEN_MAX_LENGTH is 2048", () => {
      expect(CHALLENGE_TOKEN_MAX_LENGTH).toBe(2048);
    });

    it("CHALLENGE_TOKEN_MAX_LENGTH is defined once in src/, by the guard", () => {
      const definers = (readdirSync(SRC_DIR, { recursive: true }) as string[])
        .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
        .filter((file) => /(const|let|var)\s+CHALLENGE_TOKEN_MAX_LENGTH\b/.test(readFileSync(`${SRC_DIR}/${file}`, "utf8")));

      expect(definers).toStrictEqual(["server/use-cases/shared/guard-public-submission.ts"]);
    });

    it.each([["server/use-cases/capture-lead.ts"], ["server/booking/use-cases/book-slot.ts"]])(
      "%s uses the guard and repeats none of its checks",
      (file) => {
        const source = readFileSync(`${SRC_DIR}/${file}`, "utf8");

        expect(source).toContain("@/server/use-cases/shared/guard-public-submission");
        expect(source).not.toMatch(/classifyUserAgent|SLUG_PATTERN|\.verify\(/);
      },
    );
  });
});
