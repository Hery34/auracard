/**
 * Contract frozen by test-engineer (0039, decisions 1 and 2; model: lead-form-view of 0032, decision 14): what the
 * booking form does after an answer of bookSlotAction.
 *
 * // src/ui/features/booking/booking-form-view.ts (frontend)
 * // A new idempotency key (crypto.randomUUID(), in the browser) after any refusal without write — every error but
 * // `unexpected`, where a write is not excluded (the same key keeps the replay idempotent).
 * export function needsNewIdempotencyKey(state: BookSlotState): boolean;
 * // A new Turnstile token after any refusal but invalid_input (a token is accepted once by Cloudflare).
 * export function needsNewChallenge(state: BookSlotState): boolean;
 * // Decision 2: slot taken between display and submission (or no longer offered) → explicit message and the list of
 * // slots read again (listSlotsAction), the choice cleared.
 * export function needsSlotRefresh(state: BookSlotState): boolean;
 *
 * 0039, decision 7: the idempotency key is bound to the choice (type + slot).
 * export type BookingSelection = { eventTypeId: string; start: string };
 * export type IdempotencyBinding = { key: string; selection: BookingSelection | null };
 * // Pure. Returns `previous` unchanged (same key) when the selection is equal by value to `previous.selection` and
 * // `needsNewIdempotencyKey(state)` is false; otherwise `{ key: newKey(), selection }`. `newKey` is called only when
 * // a new key is returned (exactly once). A changed selection always wins, even after `unexpected` (the key of a
 * // possibly written booking never covers another slot). Called on a transition (new action state or new choice).
 * export function idempotencyKeyFor(
 *   previous: IdempotencyBinding,
 *   selection: BookingSelection | null,
 *   state: BookSlotState,
 *   newKey: () => string,
 * ): IdempotencyBinding;
 */
import { describe, expect, it, vi } from "vitest";

import type { BookSlotActionError, BookSlotState } from "@/server/booking/public-actions";
import {
  idempotencyKeyFor,
  needsNewChallenge,
  needsNewIdempotencyKey,
  needsSlotRefresh,
  type BookingSelection,
  type IdempotencyBinding,
} from "@/ui/features/booking/booking-form-view";

import {
  BOOKING_IDEMPOTENCY_KEY,
  BOOKING_IDS,
  OTHER_BOOKING_IDEMPOTENCY_KEY,
  OTHER_SLOT_START,
  PUBLIC_EVENT_TYPE_IDS,
  SLOT_START,
} from "../../../../tests/builders/booking";

const ERRORS: readonly BookSlotActionError[] = [
  "invalid_input",
  "not_found",
  "challenge_failed",
  "challenge_unavailable",
  "rate_limited",
  "slot_taken",
  "slot_unavailable",
  "unexpected",
];

const QUIET: readonly BookSlotState[] = [{ status: "idle" }, { status: "booked", bookingId: BOOKING_IDS[0] }];

describe("needsNewIdempotencyKey (decision 1)", () => {
  it.each(ERRORS.filter((error) => error !== "unexpected"))("%s → a new key (nothing was written)", (error) => {
    expect(needsNewIdempotencyKey({ status: "error", error })).toBe(true);
  });

  it("unexpected → the same key (a write is not excluded: the replay stays idempotent)", () => {
    expect(needsNewIdempotencyKey({ status: "error", error: "unexpected" })).toBe(false);
  });

  it.each(QUIET)("%j → the same key", (state) => {
    expect(needsNewIdempotencyKey(state)).toBe(false);
  });
});

describe("needsNewChallenge (decision 1)", () => {
  it.each(ERRORS.filter((error) => error !== "invalid_input"))("%s → a new token", (error) => {
    expect(needsNewChallenge({ status: "error", error })).toBe(true);
  });

  it("invalid_input caught before Cloudflare → the same token", () => {
    expect(needsNewChallenge({ status: "error", error: "invalid_input", fields: ["name"] })).toBe(false);
  });
});

describe("needsSlotRefresh (decision 2)", () => {
  it.each(["slot_taken", "slot_unavailable"] as const)("%s → the slots are read again", (error) => {
    expect(needsSlotRefresh({ status: "error", error })).toBe(true);
  });

  it.each(ERRORS.filter((error) => error !== "slot_taken" && error !== "slot_unavailable"))("%s → the list is kept", (error) => {
    expect(needsSlotRefresh({ status: "error", error })).toBe(false);
  });

  it.each(QUIET)("%j → the list is kept", (state) => {
    expect(needsSlotRefresh(state)).toBe(false);
  });
});

describe("idempotencyKeyFor (decision 7: key bound to the choice)", () => {
  const CHOICE: BookingSelection = { eventTypeId: PUBLIC_EVENT_TYPE_IDS.video, start: SLOT_START };
  const BOUND: IdempotencyBinding = { key: BOOKING_IDEMPOTENCY_KEY, selection: CHOICE };
  const UNEXPECTED: BookSlotState = { status: "error", error: "unexpected" };

  function newKey() {
    return vi.fn(() => OTHER_BOOKING_IDEMPOTENCY_KEY);
  }

  it.each([
    ["another slot", { eventTypeId: PUBLIC_EVENT_TYPE_IDS.video, start: OTHER_SLOT_START }],
    ["another type", { eventTypeId: PUBLIC_EVENT_TYPE_IDS.phone, start: SLOT_START }],
    ["no choice", null],
  ] as const)("selection changed (%s) → a new key bound to the new selection", (_label, selection) => {
    const generate = newKey();

    expect(idempotencyKeyFor(BOUND, selection, { status: "idle" }, generate)).toStrictEqual({
      key: OTHER_BOOKING_IDEMPOTENCY_KEY,
      selection,
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("first choice (no selection bound yet) → a new key bound to it", () => {
    const generate = newKey();

    expect(idempotencyKeyFor({ key: BOOKING_IDEMPOTENCY_KEY, selection: null }, CHOICE, { status: "idle" }, generate)).toStrictEqual({
      key: OTHER_BOOKING_IDEMPOTENCY_KEY,
      selection: CHOICE,
    });
  });

  it("same choice after unexpected → the same key (the replay stays idempotent)", () => {
    const generate = newKey();

    expect(idempotencyKeyFor(BOUND, CHOICE, UNEXPECTED, generate)).toStrictEqual(BOUND);
    expect(generate).not.toHaveBeenCalled();
  });

  it("same choice compared by value (a new object with the same type and slot) → the same key", () => {
    const generate = newKey();

    expect(idempotencyKeyFor(BOUND, { ...CHOICE }, UNEXPECTED, generate)).toStrictEqual(BOUND);
    expect(generate).not.toHaveBeenCalled();
  });

  it("another slot after unexpected → a new key (never a summary of another slot)", () => {
    const selection = { eventTypeId: PUBLIC_EVENT_TYPE_IDS.video, start: OTHER_SLOT_START };

    expect(idempotencyKeyFor(BOUND, selection, UNEXPECTED, newKey())).toStrictEqual({
      key: OTHER_BOOKING_IDEMPOTENCY_KEY,
      selection,
    });
  });

  it.each([
    "challenge_failed",
    "challenge_unavailable",
    "rate_limited",
    "slot_taken",
    "slot_unavailable",
    "invalid_input",
    "not_found",
  ] as const)("same choice after %s → a new key (nothing was written)", (error) => {
    const generate = newKey();

    expect(idempotencyKeyFor(BOUND, CHOICE, { status: "error", error }, generate)).toStrictEqual({
      key: OTHER_BOOKING_IDEMPOTENCY_KEY,
      selection: CHOICE,
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each(QUIET)("same choice, %j → the same key", (state) => {
    const generate = newKey();

    expect(idempotencyKeyFor(BOUND, CHOICE, state, generate)).toStrictEqual(BOUND);
    expect(generate).not.toHaveBeenCalled();
  });
});
