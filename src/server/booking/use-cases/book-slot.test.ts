/**
 * Contract frozen by test-engineer (0039, decisions 1 and 4, point 8; criteria 1 and 2; notes inherited from 0036;
 * ADR 0008, 0011 avenant phase 5, 0016). Model: capture-lead (0032, decision 14). Only the ports are fakes: rate limiter, bot
 * challenge verifier (ADR 0008), slot booker (stand-in of carnet.book_slot).
 *
 * // src/domain/booking/ports.ts
 * export type BookSlotCommand = BookingSubmission & { slug: string; deviceClass: DeviceClass };
 * export type SlotBookerError = "not_found" | "slot_taken" | "slot_unavailable" | "phone_required" | "invalid_input"
 *   | "profile_quota" | "unexpected";   // point 8: profile_quota = CN005, 20 bookings created in 23 h
 * export interface SlotBooker {   // carnet.book_slot (service_role, dedicated adapter, ADR 0011 avenant phase 5)
 *   // replay of (slug, key) → the same id, nothing written (the cancel token is null then and never leaves the adapter)
 *   book(command: BookSlotCommand): Promise<Result<{ bookingId: string }, SlotBookerError>>;
 * }
 *
 * // src/domain/shared/rate-limits.ts: "booking" = { limit: 5, windowSeconds: 3600 } (address). Point 8: no
 * //   "booking-profile" scope any more — the profile quota counts successful bookings only, inside book_slot (CN005).
 *
 * // src/server/booking/use-cases/book-slot.ts
 * export type BookSlotInput = BookingSubmission & { slug: string; challengeToken: string | undefined;
 *   userAgent: string | null; clientAddress: string };
 * export type BookSlotError = "not_found" | "challenge_failed" | "challenge_unavailable" | "rate_limited"
 *   | "slot_taken" | "slot_unavailable" | "phone_required" | "invalid_input" | "unexpected";
 * export type BookSlot = (input: BookSlotInput) => Promise<Result<{ bookingId: string }, BookSlotError>>;
 * export function makeBookSlot(deps: { rateLimiter: RateLimiter; challenge: BotChallengeVerifier;
 *   bookings: SlotBooker }): BookSlot;
 * // Decision 1 amended by point 8, imposed order, nothing written on any refusal (the submission is already validated
 * // by the action). Steps 1 to 4 are the shared guard guardPublicSubmission (src/server/use-cases/shared/
 * // guard-public-submission.ts, policy { addressScope: "booking", challengeAction: BOOKING_CHALLENGE_ACTION }):
 * //   1. no port called: slug not SLUG_PATTERN → not_found; token absent, empty or longer than
 * //      CHALLENGE_TOKEN_MAX_LENGTH (2048) → challenge_failed;
 * //   2. classifyUserAgent: bot (or no user-agent) → challenge_failed, no port called;
 * //   3. rateLimiter "booking" on clientAddress → rate_limited | unexpected;
 * //   4. challenge.verify({ token, expectedAction: BOOKING_CHALLENGE_ACTION, expectedCData: slug }): refused →
 * //      challenge_failed; unavailable → challenge_unavailable;
 * //   5. bookings.book({ ...submission, slug, deviceClass }) → ok({ bookingId }); profile_quota → rate_limited;
 * //      any other error as is. Neither the address, the user-agent nor the token reach the booker.
 */
import { describe, expect, it } from "vitest";

import { BOOKING_CHALLENGE_ACTION } from "@/domain/booking/booking";
import { err, ok } from "@/domain/shared/result";
import { makeBookSlot } from "@/server/booking/use-cases/book-slot";

import { BOT_USER_AGENTS, DESKTOP_USER_AGENT } from "../../../../tests/builders/analytics";
import {
  aBookSlotInput,
  BOOKING_IDEMPOTENCY_KEY,
  BOOKING_IDS,
  BOOKING_SLUG,
  BOOKING_VISITOR_ADDRESS,
  CHALLENGE_TOKEN,
  OTHER_BOOKING_IDEMPOTENCY_KEY,
  OTHER_BOOKING_SLUG,
  OTHER_CHALLENGE_TOKEN,
  OTHER_SLOT_START,
  PUBLIC_EVENT_TYPE_IDS,
  SLOT_START,
  UNKNOWN_EVENT_TYPE_ID,
} from "../../../../tests/builders/booking";
import { makeCallLog } from "../../../../tests/builders/call-log";
import {
  fakeBotChallengeVerifier,
  type FakeBotChallengeVerifierOptions,
} from "../../../../tests/builders/fake-bot-challenge-verifier";
import { fakeRateLimiter, type FakeRateLimiterOptions } from "../../../../tests/builders/fake-rate-limiter";
import { fakeSlotBooker, type FakeSlotBookerOptions } from "../../../../tests/builders/fake-slot-booker";

type HarnessOptions = {
  limiter?: Omit<FakeRateLimiterOptions, "log">;
  challenge?: Omit<FakeBotChallengeVerifierOptions, "log">;
  bookings?: Omit<FakeSlotBookerOptions, "log">;
};

function harness(options: HarnessOptions = {}) {
  const log = makeCallLog();
  const bookings = fakeSlotBooker({ log, ...options.bookings });
  const bookSlot = makeBookSlot({
    rateLimiter: fakeRateLimiter({ log, ...options.limiter }),
    challenge: fakeBotChallengeVerifier({ log, ...options.challenge }),
    bookings,
  });
  return { log, bookings, bookSlot };
}

const BOOKING_CONSUMPTION = { scope: "booking", subject: BOOKING_VISITOR_ADDRESS, limit: 5, windowSeconds: 3600 };
const VERIFICATION = { token: CHALLENGE_TOKEN, expectedAction: BOOKING_CHALLENGE_ACTION, expectedCData: BOOKING_SLUG };
const FULL_SEQUENCE = ["rateLimiter.consume", "challenge.verify", "bookings.book"];

describe("bookSlot", () => {
  it("criterion 1 / decision 1, point 8: address limit → Turnstile (action booking, cData slug) → book_slot, no profile counter", async () => {
    const { log, bookings, bookSlot } = harness();

    expect(await bookSlot(aBookSlotInput())).toStrictEqual(ok({ bookingId: BOOKING_IDS[0] }));

    expect(log.sequence()).toStrictEqual(FULL_SEQUENCE);
    expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([BOOKING_CONSUMPTION]);
    expect(log.inputsOf("challenge", "verify")).toStrictEqual([VERIFICATION]);
    expect(log.inputsOf("bookings", "book")).toStrictEqual([
      {
        slug: BOOKING_SLUG,
        eventTypeId: PUBLIC_EVENT_TYPE_IDS.video,
        start: SLOT_START,
        name: "Jean Visiteur",
        email: "jean.visiteur@example.test",
        phone: null,
        message: null,
        idempotencyKey: BOOKING_IDEMPOTENCY_KEY,
        deviceClass: "mobile",
      },
    ]);
    expect(bookings.stored).toHaveLength(1);
  });

  it("decision 4: book_slot writes booking_confirmed with the device class of classifyUserAgent (desktop → desktop)", async () => {
    const { log, bookSlot } = harness();

    await bookSlot(aBookSlotInput({ userAgent: DESKTOP_USER_AGENT }));

    expect(log.inputsOf("bookings", "book")).toMatchObject([{ deviceClass: "desktop" }]);
  });

  it("the token is bound to the profile: another slug → verify expects that slug as cData", async () => {
    const { log, bookSlot } = harness({ bookings: { accepting: [BOOKING_SLUG, OTHER_BOOKING_SLUG] } });

    await bookSlot(aBookSlotInput({ slug: OTHER_BOOKING_SLUG }));

    expect(log.inputsOf("challenge", "verify")).toStrictEqual([{ ...VERIFICATION, expectedCData: OTHER_BOOKING_SLUG }]);
  });

  it("the same token sent to another profile, refused by the provider → challenge_failed, nothing written", async () => {
    const { bookings, bookSlot } = harness({
      challenge: { passingCData: [BOOKING_SLUG] },
      bookings: { accepting: [BOOKING_SLUG, OTHER_BOOKING_SLUG] },
    });

    expect(await bookSlot(aBookSlotInput({ slug: OTHER_BOOKING_SLUG }))).toStrictEqual(err("challenge_failed"));
    expect(bookings.stored).toStrictEqual([]);
  });

  describe("criterion 1 / idempotence: double submission = one booking", () => {
    it("executed twice with the same key (new token, as after « unexpected ») → the same booking, stored once", async () => {
      const { bookings, bookSlot } = harness({ challenge: { singleUseTokens: true } });

      const first = await bookSlot(aBookSlotInput());
      const second = await bookSlot(aBookSlotInput({ challengeToken: OTHER_CHALLENGE_TOKEN }));

      expect(first).toStrictEqual(ok({ bookingId: BOOKING_IDS[0] }));
      expect(second).toStrictEqual(first);
      expect(bookings.stored).toHaveLength(1);
    });

    it("note inherited from 0036: a replay with the same key but another slot → the booking already made (no check)", async () => {
      const { bookings, bookSlot } = harness({ challenge: { singleUseTokens: true } });

      await bookSlot(aBookSlotInput());
      const replay = await bookSlot(aBookSlotInput({ start: OTHER_SLOT_START, challengeToken: OTHER_CHALLENGE_TOKEN }));

      expect(replay).toStrictEqual(ok({ bookingId: BOOKING_IDS[0] }));
      expect(bookings.stored.map((booking) => booking.start)).toStrictEqual([SLOT_START]);
    });

    it("the same token replayed → challenge_failed, nothing more written", async () => {
      const { log, bookings, bookSlot } = harness({ challenge: { singleUseTokens: true } });

      await bookSlot(aBookSlotInput());
      expect(await bookSlot(aBookSlotInput())).toStrictEqual(err("challenge_failed"));

      expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([BOOKING_CONSUMPTION, BOOKING_CONSUMPTION]);
      expect(bookings.stored).toHaveLength(1);
    });

    it("ADR 0011: a replay with a new token consumes the address counter again (attempts are counted)", async () => {
      const { log, bookSlot } = harness({ challenge: { singleUseTokens: true } });

      await bookSlot(aBookSlotInput());
      await bookSlot(aBookSlotInput({ challengeToken: OTHER_CHALLENGE_TOKEN }));

      expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([BOOKING_CONSUMPTION, BOOKING_CONSUMPTION]);
    });

    it("two keys (two forms) on two slots → two bookings", async () => {
      const { bookings, bookSlot } = harness();

      await bookSlot(aBookSlotInput());
      await bookSlot(aBookSlotInput({ idempotencyKey: OTHER_BOOKING_IDEMPOTENCY_KEY, start: OTHER_SLOT_START }));

      expect(bookings.stored.map((booking) => booking.id)).toStrictEqual([BOOKING_IDS[0], BOOKING_IDS[1]]);
    });
  });

  describe("step 1 — what the action does not check: no port called", () => {
    it.each([
      ["absent", undefined],
      ["empty", ""],
      ["longer than 2048 characters", "t".repeat(2049)],
    ])("criterion 2: Turnstile token %s → challenge_failed, no port called", async (_label, challengeToken) => {
      const { log, bookSlot } = harness();

      expect(await bookSlot(aBookSlotInput({ challengeToken }))).toStrictEqual(err("challenge_failed"));
      expect(log.sequence()).toStrictEqual([]);
    });

    it.each([
      ["path traversal", "../admin"],
      ["upper case", "Elodie-Durand"],
      ["empty", ""],
    ])("criterion 3: malformed slug (%s) → not_found, no port called", async (_label, slug) => {
      const { log, bookSlot } = harness();

      expect(await bookSlot(aBookSlotInput({ slug }))).toStrictEqual(err("not_found"));
      expect(log.sequence()).toStrictEqual([]);
    });
  });

  describe("decision 1, step 2 — robots refused before any call", () => {
    it.each(BOT_USER_AGENTS)("%s → challenge_failed, no counter, no Turnstile, no write", async (_label, userAgent) => {
      const { log, bookings, bookSlot } = harness();

      expect(await bookSlot(aBookSlotInput({ userAgent }))).toStrictEqual(err("challenge_failed"));
      expect(log.sequence()).toStrictEqual([]);
      expect(bookings.stored).toStrictEqual([]);
    });

    it("no user-agent → refused like a robot", async () => {
      const { log, bookSlot } = harness();

      expect(await bookSlot(aBookSlotInput({ userAgent: null }))).toStrictEqual(err("challenge_failed"));
      expect(log.sequence()).toStrictEqual([]);
    });
  });

  describe("criterion 2, step 3 — limit booking:<address> 5/h before Turnstile", () => {
    it("exhausted → rate_limited; no Turnstile, nothing written", async () => {
      const { log, bookings, bookSlot } = harness({ limiter: { deny: ["booking"] } });

      expect(await bookSlot(aBookSlotInput())).toStrictEqual(err("rate_limited"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
      expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([BOOKING_CONSUMPTION]);
      expect(bookings.stored).toStrictEqual([]);
    });

    it("failing limiter → unexpected, the door closes (no Turnstile, nothing written)", async () => {
      const { log, bookings, bookSlot } = harness({ limiter: { failing: true } });

      expect(await bookSlot(aBookSlotInput())).toStrictEqual(err("unexpected"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume"]);
      expect(bookings.stored).toStrictEqual([]);
    });
  });

  describe("criterion 2, step 4 — Turnstile before any write (ADR 0008)", () => {
    it("token refused → challenge_failed, nothing written", async () => {
      const { log, bookings, bookSlot } = harness({ challenge: { outcome: "failed" } });

      expect(await bookSlot(aBookSlotInput())).toStrictEqual(err("challenge_failed"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "challenge.verify"]);
      expect(bookings.stored).toStrictEqual([]);
    });

    it("Cloudflare unavailable → challenge_unavailable, nothing written", async () => {
      const { log, bookings, bookSlot } = harness({ challenge: { outcome: "unavailable" } });

      expect(await bookSlot(aBookSlotInput())).toStrictEqual(err("challenge_unavailable"));
      expect(log.sequence()).toStrictEqual(["rateLimiter.consume", "challenge.verify"]);
      expect(bookings.stored).toStrictEqual([]);
    });
  });

  describe("criterion 2, point 8 — profile quota of book_slot (20 bookings created in 23 h, CN005)", () => {
    it("quota reached (profile_quota) → rate_limited after Turnstile, nothing written", async () => {
      const { log, bookings, bookSlot } = harness({ bookings: { profileQuota: 0 } });

      expect(await bookSlot(aBookSlotInput())).toStrictEqual(err("rate_limited"));
      expect(log.sequence()).toStrictEqual(FULL_SEQUENCE);
      expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([BOOKING_CONSUMPTION]);
      expect(bookings.stored).toStrictEqual([]);
    });

    it("idempotence: a replay of a stored key at the quota → the same booking; a new key → rate_limited", async () => {
      const { bookings, bookSlot } = harness({ bookings: { profileQuota: 1 } });

      expect(await bookSlot(aBookSlotInput())).toStrictEqual(ok({ bookingId: BOOKING_IDS[0] }));
      expect(await bookSlot(aBookSlotInput())).toStrictEqual(ok({ bookingId: BOOKING_IDS[0] }));
      expect(
        await bookSlot(aBookSlotInput({ start: OTHER_SLOT_START, idempotencyKey: OTHER_BOOKING_IDEMPOTENCY_KEY })),
      ).toStrictEqual(err("rate_limited"));
      expect(bookings.stored).toHaveLength(1);
    });

    it("a refused attempt (slot_taken) consumes no profile counter: only the address counter is ever consumed", async () => {
      const { log, bookSlot } = harness({ bookings: { takenStarts: [SLOT_START] } });

      await bookSlot(aBookSlotInput());
      await bookSlot(aBookSlotInput({ start: OTHER_SLOT_START, idempotencyKey: OTHER_BOOKING_IDEMPOTENCY_KEY, challengeToken: OTHER_CHALLENGE_TOKEN }));

      expect(log.inputsOf("rateLimiter", "consume")).toStrictEqual([BOOKING_CONSUMPTION, BOOKING_CONSUMPTION]);
    });
  });

  describe("step 5 — book_slot refusals, nothing written", () => {
    it("criterion 2: slot already taken (CN001) → slot_taken", async () => {
      const { log, bookings, bookSlot } = harness({ bookings: { takenStarts: [SLOT_START] } });

      expect(await bookSlot(aBookSlotInput())).toStrictEqual(err("slot_taken"));
      expect(log.sequence()).toStrictEqual(FULL_SEQUENCE);
      expect(bookings.stored).toStrictEqual([]);
    });

    it("criterion 2: outside the availabilities (CN002) → slot_unavailable", async () => {
      const { bookings, bookSlot } = harness({ bookings: { unavailableStarts: [SLOT_START] } });

      expect(await bookSlot(aBookSlotInput())).toStrictEqual(err("slot_unavailable"));
      expect(bookings.stored).toStrictEqual([]);
    });

    it("decision 3: phone type without phone (22023) → phone_required; with a phone → booked", async () => {
      const { bookings, bookSlot } = harness();

      expect(await bookSlot(aBookSlotInput({ eventTypeId: PUBLIC_EVENT_TYPE_IDS.phone }))).toStrictEqual(err("phone_required"));
      expect(bookings.stored).toStrictEqual([]);
      expect(
        await bookSlot(
          aBookSlotInput({ eventTypeId: PUBLIC_EVENT_TYPE_IDS.phone, phone: "+33 6 12 34 56 78", idempotencyKey: OTHER_BOOKING_IDEMPOTENCY_KEY }),
        ),
      ).toStrictEqual(ok({ bookingId: BOOKING_IDS[0] }));
    });

    it("criterion 3: unpublished profile, unknown or inactive type (P0002) → not_found", async () => {
      expect(await harness({ bookings: { accepting: [] } }).bookSlot(aBookSlotInput())).toStrictEqual(err("not_found"));
      expect(await harness().bookSlot(aBookSlotInput({ eventTypeId: UNKNOWN_EVENT_TYPE_ID }))).toStrictEqual(err("not_found"));
    });

    it("failing booker → unexpected", async () => {
      expect(await harness({ bookings: { failing: true } }).bookSlot(aBookSlotInput())).toStrictEqual(err("unexpected"));
    });

    it("minimization: neither the address, the user-agent nor the token reach book_slot", async () => {
      const { log, bookSlot } = harness();

      await bookSlot(aBookSlotInput());

      const written = JSON.stringify(log.inputsOf("bookings", "book"));
      expect(written).not.toContain(BOOKING_VISITOR_ADDRESS);
      expect(written).not.toContain("iPhone");
      expect(written).not.toContain(CHALLENGE_TOKEN);
    });
  });
});
