/**
 * Contract frozen by test-engineer (0032, decisions 2, 8, 9, 12 and 14; criteria 1 to 3; ADR 0008, 0011). Only the
 * ports are fakes: rate limiter, bot challenge verifier (ADR 0008: fake implementation in unit tests), lead capturer.
 *
 * // src/domain/shared/ports/bot-challenge-verifier.ts (ADR 0008)
 * export type BotChallengeInput = {
 *   token: string;            // decision 14, after the second audit: no idempotencyKey — a token is verified once
 *   expectedAction: string;   // decision 14: the widget's `action` (LEAD_CHALLENGE_ACTION = "lead", src/domain/lead/lead.ts)
 *   expectedCData: string;    // decision 14: the widget's `cData` (the slug of the profile): token bound to the profile
 * };
 * export interface BotChallengeVerifier {
 *   // passed: the provider accepted the token for this action and this cData; { passed: false }: refused (invalid,
 *   // expired, already used, other action or other cData); err("unavailable"): provider unreachable, timeout,
 *   // malformed answer, misconfiguration. Never throws.
 *   verify(input: BotChallengeInput): Promise<Result<{ passed: boolean }, "unavailable">>;
 * }
 *
 * // src/domain/lead/ports.ts
 * export type CaptureLeadCommand = LeadSubmission & { slug: string; deviceClass: DeviceClass };
 * export interface LeadCapturer {   // carnet.capture_lead (service_role): replay of the key → the same id, nothing written
 *   capture(command: CaptureLeadCommand): Promise<Result<{ leadId: string }, "not_found" | "unexpected">>;
 * }                                 // not_found: unknown, unpublished or refusing profile (P0002, one single answer)
 *
 * // src/domain/shared/rate-limits.ts: "lead" = { limit: 5, windowSeconds: 3600 },
 * //   "lead-profile" = { limit: 50, windowSeconds: 82800 }.
 *
 * // src/server/use-cases/capture-lead.ts
 * // Decision 14: the submission is already validated by the action (src/server/actions/lead-schemas.ts); the use
 * // case does not validate it again and never answers invalid_input.
 * export type CaptureLeadInput = LeadSubmission & { slug: string; challengeToken: string | undefined;
 *   userAgent: string | null; clientAddress: string };
 * export type CaptureLeadError = "not_found" | "challenge_failed" | "challenge_unavailable" | "rate_limited" | "unexpected";
 * export type CaptureLead = (input: CaptureLeadInput) => Promise<Result<{ leadId: string }, CaptureLeadError>>;
 * export function makeCaptureLead(deps: { rateLimiter: RateLimiter; challenge: BotChallengeVerifier;
 *   leads: LeadCapturer }): CaptureLead;
 * // Imposed order (decision 14, amending decision 2), nothing written on any refusal:
 * //   1. validation, no port called: slug not SLUG_PATTERN → not_found; token absent, empty or longer than 2048
 * //      characters → challenge_failed;
 * //   2. classifyUserAgent (0029): bot (or no user-agent) → challenge_failed, no port called (decision 8);
 * //   3. rateLimiter "lead" on clientAddress (the adapter stores the salted fingerprint `lead:<hmac>`) → rate_limited
 * //      | unexpected;
 * //   4. challenge.verify({ token, expectedAction: LEAD_CHALLENGE_ACTION, expectedCData: slug }): { passed: false }
 * //      (including a replayed token) → challenge_failed; unavailable → challenge_unavailable (ADR 0008: refused
 * //      either way);
 * //   5. rateLimiter "lead-profile" on the slug (decision 12), consumed only after a passed challenge → rate_limited
 * //      | unexpected;
 * //   6. leads.capture({ slug, name, email, message, idempotencyKey, deviceClass }) → ok({ leadId }) | not_found |
 * //      unexpected. Neither the address nor the user-agent reach the capturer.
 */
import { describe, expect, it } from "vitest";

import { LEAD_CHALLENGE_ACTION } from "@/domain/lead/lead";
import { err, ok } from "@/domain/shared/result";
import { makeCaptureLead } from "@/server/use-cases/capture-lead";

import { BOT_USER_AGENTS, DESKTOP_USER_AGENT } from "../../../tests/builders/analytics";
import { makeCallLog } from "../../../tests/builders/call-log";
import {
  fakeBotChallengeVerifier,
  type FakeBotChallengeVerifierOptions,
} from "../../../tests/builders/fake-bot-challenge-verifier";
import { fakeLeadCapturer, type FakeLeadCapturerOptions } from "../../../tests/builders/fake-lead-capturer";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../tests/builders/fake-rate-limiter";
import {
  aCaptureLeadInput,
  CHALLENGE_TOKEN,
  IDEMPOTENCY_KEY,
  LEAD_IDS,
  LEAD_SLUG,
  OTHER_CHALLENGE_TOKEN,
  OTHER_IDEMPOTENCY_KEY,
  OTHER_LEAD_SLUG,
  VISITOR_ADDRESS,
} from "../../../tests/builders/lead";

type HarnessOptions = {
  limiter?: Omit<FakeRateLimiterOptions, "log">;
  challenge?: Omit<FakeBotChallengeVerifierOptions, "log">;
  leads?: Omit<FakeLeadCapturerOptions, "log">;
};

function harness(options: HarnessOptions = {}) {
  const log = makeCallLog();
  const leads = fakeLeadCapturer({ log, ...options.leads });
  const captureLead = makeCaptureLead({
    rateLimiter: fakeRateLimiter({ log, ...options.limiter }),
    challenge: fakeBotChallengeVerifier({ log, ...options.challenge }),
    leads,
  });
  return { log, leads, captureLead };
}

const LEAD_CONSUMPTION = { scope: "lead", subject: VISITOR_ADDRESS, limit: 5, windowSeconds: 3600 };
const LEAD_PROFILE_CONSUMPTION = { scope: "lead-profile", subject: LEAD_SLUG, limit: 50, windowSeconds: 82800 };
const VERIFICATION = { token: CHALLENGE_TOKEN, expectedAction: LEAD_CHALLENGE_ACTION, expectedCData: LEAD_SLUG };
const FULL_SEQUENCE = ["rateLimiter.consume", "challenge.verify", "rateLimiter.consume", "leads.capture"];

describe("captureLead", () => {
  it("criterion 1 / decision 14: address limit → Turnstile → profile limit → capture_lead, in this order", async () => {
    const { log, leads, captureLead } = harness();

    expect(await captureLead(aCaptureLeadInput())).toStrictEqual(ok({ leadId: LEAD_IDS[0] }));

    expect(log.sequence()).toStrictEqual(FULL_SEQUENCE);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([LEAD_CONSUMPTION, LEAD_PROFILE_CONSUMPTION]);
    expect(log.inputsOf("challenge", "verify")).toStrictEqual([VERIFICATION]);
    expect(log.inputsOf("leads", "capture")).toStrictEqual([
      {
        slug: LEAD_SLUG,
        name: "Jean Visiteur",
        email: "jean.visiteur@example.test",
        message: "Bonjour,\nje souhaite un devis pour l'aménagement de mon bureau.",
        idempotencyKey: IDEMPOTENCY_KEY,
        deviceClass: "mobile",
      },
    ]);
    expect(leads.stored).toHaveLength(1);
  });

  it("decision 8: the device class comes from classifyUserAgent (desktop visitor → desktop)", async () => {
    const { log, captureLead } = harness();

    await captureLead(aCaptureLeadInput({ userAgent: DESKTOP_USER_AGENT }));

    expect(log.inputsOf("leads", "capture")).toMatchObject([{ deviceClass: "desktop" }]);
  });

  it("decision 14: the submission is already validated — passed to capture_lead as received, no second validation", async () => {
    const { log, captureLead } = harness();
    const submission = { name: "Jean", email: "jean@example.test", message: "Ligne 1\nLigne 2", idempotencyKey: OTHER_IDEMPOTENCY_KEY };

    await captureLead(aCaptureLeadInput(submission));

    expect(log.inputsOf("leads", "capture")).toStrictEqual([{ ...submission, slug: LEAD_SLUG, deviceClass: "mobile" }]);
  });

  it("decision 14: the token is bound to the profile — verify expects LEAD_CHALLENGE_ACTION and the slug as cData, no idempotency key", async () => {
    const { log, captureLead } = harness();

    await captureLead(aCaptureLeadInput({ slug: OTHER_LEAD_SLUG }));

    expect(log.inputsOf("challenge", "verify")).toStrictEqual([{ ...VERIFICATION, expectedCData: OTHER_LEAD_SLUG }]);
  });

  it("decision 14: same token sent to another slug, refused by the provider → challenge_failed, nothing written", async () => {
    const { log, leads, captureLead } = harness({
      challenge: { passingCData: [LEAD_SLUG] },
      leads: { accepting: [LEAD_SLUG, OTHER_LEAD_SLUG] },
    });

    expect(await captureLead(aCaptureLeadInput())).toStrictEqual(ok({ leadId: LEAD_IDS[0] }));
    expect(await captureLead(aCaptureLeadInput({ slug: OTHER_LEAD_SLUG }))).toStrictEqual(err("challenge_failed"));

    expect(leads.stored).toHaveLength(1);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([
      LEAD_CONSUMPTION,
      LEAD_PROFILE_CONSUMPTION,
      LEAD_CONSUMPTION,
    ]);
  });

  it("criterion 1 / idempotence: executed twice with the same key (new token, as after « unexpected ») → the same lead, stored once", async () => {
    const { leads, captureLead } = harness({ challenge: { singleUseTokens: true } });

    const first = await captureLead(aCaptureLeadInput());
    const second = await captureLead(aCaptureLeadInput({ challengeToken: OTHER_CHALLENGE_TOKEN }));

    expect(first).toStrictEqual(ok({ leadId: LEAD_IDS[0] }));
    expect(second).toStrictEqual(first);
    expect(leads.stored).toHaveLength(1);
  });

  it("decision 14: the same token replayed → refused by the verifier → challenge_failed, lead-profile NOT consumed again", async () => {
    const { log, leads, captureLead } = harness({ challenge: { singleUseTokens: true } });

    expect(await captureLead(aCaptureLeadInput())).toStrictEqual(ok({ leadId: LEAD_IDS[0] }));
    expect(await captureLead(aCaptureLeadInput())).toStrictEqual(err("challenge_failed"));

    expect(log.inputsOf("challenge", "verify")).toStrictEqual([VERIFICATION, VERIFICATION]);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([
      LEAD_CONSUMPTION,
      LEAD_PROFILE_CONSUMPTION,
      LEAD_CONSUMPTION,
    ]);
    expect(leads.stored).toHaveLength(1);
  });

  it("ADR 0011: a replay with a new token consumes the counters again (attempts are counted)", async () => {
    const { log, captureLead } = harness({ challenge: { singleUseTokens: true } });

    await captureLead(aCaptureLeadInput());
    await captureLead(aCaptureLeadInput({ challengeToken: OTHER_CHALLENGE_TOKEN }));

    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([
      LEAD_CONSUMPTION,
      LEAD_PROFILE_CONSUMPTION,
      LEAD_CONSUMPTION,
      LEAD_PROFILE_CONSUMPTION,
    ]);
  });

  it("two different keys (two mounted forms) → two leads", async () => {
    const { leads, captureLead } = harness();

    await captureLead(aCaptureLeadInput());
    await captureLead(aCaptureLeadInput({ idempotencyKey: OTHER_IDEMPOTENCY_KEY }));

    expect(leads.stored.map((lead) => lead.id)).toStrictEqual([LEAD_IDS[0], LEAD_IDS[1]]);
  });

  describe("step 1 — validation of what the action does not check: no port called", () => {
    it.each([
      ["absent", undefined],
      ["empty", ""],
      ["longer than 2048 characters", "t".repeat(2049)],
    ])("criterion 2: Turnstile token %s → challenge_failed, no port called", async (_label, challengeToken) => {
      const { log, captureLead } = harness();

      expect(await captureLead(aCaptureLeadInput({ challengeToken }))).toStrictEqual(err("challenge_failed"));
      expect(log.sequence()).toStrictEqual([]);
    });

    it.each([
      ["path traversal", "../admin"],
      ["upper case", "Elodie-Durand"],
      ["empty", ""],
    ])("criterion 3: malformed slug (%s) → not_found, no port called", async (_label, slug) => {
      const { log, captureLead } = harness();

      expect(await captureLead(aCaptureLeadInput({ slug }))).toStrictEqual(err("not_found"));
      expect(log.sequence()).toStrictEqual([]);
    });
  });

  describe("decision 8, step 2 — robots refused before any call", () => {
    it.each(BOT_USER_AGENTS)("%s → challenge_failed, no counter, no Turnstile, no write", async (_label, userAgent) => {
      const { log, leads, captureLead } = harness();

      expect(await captureLead(aCaptureLeadInput({ userAgent }))).toStrictEqual(err("challenge_failed"));
      expect(log.sequence()).toStrictEqual([]);
      expect(leads.stored).toStrictEqual([]);
    });

    it("no user-agent → refused like a robot", async () => {
      const { log, captureLead } = harness();

      expect(await captureLead(aCaptureLeadInput({ userAgent: null }))).toStrictEqual(err("challenge_failed"));
      expect(log.sequence()).toStrictEqual([]);
    });
  });

  describe("criterion 2, step 3 — address limit before Turnstile", () => {
    it("per-address counter exhausted → rate_limited; no Turnstile, profile counter not consumed, nothing written", async () => {
      const { log, leads, captureLead } = harness({ limiter: { deny: ["lead"] } });

      expect(await captureLead(aCaptureLeadInput())).toStrictEqual(err("rate_limited"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
      expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([LEAD_CONSUMPTION]);
      expect(leads.stored).toStrictEqual([]);
    });

    it("failing limiter → unexpected, the door closes (no Turnstile, nothing written)", async () => {
      const { log, leads, captureLead } = harness({ limiter: { failing: true } });

      expect(await captureLead(aCaptureLeadInput())).toStrictEqual(err("unexpected"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
      expect(leads.stored).toStrictEqual([]);
    });
  });

  describe("criterion 2, step 4 — Turnstile before the profile limit and any write (ADR 0008, decision 14)", () => {
    it("token refused → challenge_failed; the lead-profile counter is NOT consumed, nothing written", async () => {
      const { log, leads, captureLead } = harness({ challenge: { outcome: "failed" } });

      expect(await captureLead(aCaptureLeadInput())).toStrictEqual(err("challenge_failed"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "challenge.verify"]);
      expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([LEAD_CONSUMPTION]);
      expect(leads.stored).toStrictEqual([]);
    });

    it("Cloudflare unavailable → challenge_unavailable; the lead-profile counter is NOT consumed, nothing written", async () => {
      const { log, leads, captureLead } = harness({ challenge: { outcome: "unavailable" } });

      expect(await captureLead(aCaptureLeadInput())).toStrictEqual(err("challenge_unavailable"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "challenge.verify"]);
      expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([LEAD_CONSUMPTION]);
      expect(leads.stored).toStrictEqual([]);
    });
  });

  describe("criterion 2, step 5 — profile limit after a passed challenge (decisions 12 and 14)", () => {
    it("per-profile counter exhausted (50 per 23 h) → rate_limited, after Turnstile, nothing written", async () => {
      const { log, leads, captureLead } = harness({ limiter: { deny: ["lead-profile"] } });

      expect(await captureLead(aCaptureLeadInput())).toStrictEqual(err("rate_limited"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "challenge.verify", "rateLimiter.consume"]);
      expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([LEAD_CONSUMPTION, LEAD_PROFILE_CONSUMPTION]);
      expect(leads.stored).toStrictEqual([]);
    });
  });

  describe("step 6 — capture_lead", () => {
    it("criterion 3: unpublished profile or profile refusing messages (P0002) → not_found, nothing written", async () => {
      const { log, leads, captureLead } = harness({ leads: { accepting: [] } });

      expect(await captureLead(aCaptureLeadInput())).toStrictEqual(err("not_found"));
      expect(log.sequence()).toStrictEqual(FULL_SEQUENCE);
      expect(leads.stored).toStrictEqual([]);
    });

    it("failing capture → unexpected", async () => {
      const { captureLead } = harness({ leads: { failing: true } });

      expect(await captureLead(aCaptureLeadInput())).toStrictEqual(err("unexpected"));
    });

    it("minimization: neither the address nor the user-agent nor the token reach capture_lead", async () => {
      const { log, captureLead } = harness();

      await captureLead(aCaptureLeadInput());

      const written = JSON.stringify(log.inputsOf("leads", "capture"));
      expect(written).not.toContain(VISITOR_ADDRESS);
      expect(written).not.toContain("iPhone");
      expect(written).not.toContain(CHALLENGE_TOKEN);
    });
  });
});
