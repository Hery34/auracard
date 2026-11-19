/**
 * Contract frozen by test-engineer (0039; notes inherited from 0036; ADR 0011 avenant phase 5: dedicated adapter of
 * carnet.book_slot, injected by container.ts only, added to the `adminAdapters` list of the ESLint rule).
 *
 * // src/server/booking/repositories/supabase-slot-booker.ts — service_role client.
 * export function makeSupabaseSlotBooker(admin: CarnetClient): SlotBooker;
 * // One call: rpc("book_slot", { p_slug, p_event_type_id, p_start, p_visitor_name, p_visitor_email,
 * //   p_visitor_phone, p_message, p_idempotency_key, p_device_class }) — never `from(...)`. Returns table
 * //   (booking_id, cancel_token): awaited directly (array of one row) or through .single() / .maybeSingle().
 * // → ok({ bookingId }). On a replay cancel_token is null: still ok. The cancel token is never returned nor logged
 * //   (it travels to the visitor through the outbox e-mail only, 0041).
 * // SQLSTATE translated by code, never by message: P0002 → not_found; CN001 (23P01 already translated by the base)
 * //   → slot_taken; CN002 → slot_unavailable; 22023 (phone required by a phone type; the other 22023 cases are
 * //   excluded by the validation) → phone_required; 23514 / 23502 (visitor fields refused by the constraints) →
 * //   invalid_input; CN005 (0039 point 8: the profile already has 20 bookings created in the last 23 h; checked by
 * //   book_slot_at after the replay detection) → profile_quota; none of these is logged as an error.
 * // src/domain/booking/ports.ts: SlotBookerError gains "profile_quota". Any other error, no row or a malformed row → unexpected,
 * //   logged by code only (logInfrastructureError("book_slot", code)), never a visitor value.
 */
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { SlotBookerError } from "@/domain/booking/ports";
import { err, ok } from "@/domain/shared/result";
import { makeSupabaseSlotBooker } from "@/server/booking/repositories/supabase-slot-booker";

import {
  aBookingSubmission,
  BOOKING_IDEMPOTENCY_KEY,
  BOOKING_IDS,
  BOOKING_SLUG,
  CANCEL_TOKEN,
  postgrestError,
  PUBLIC_EVENT_TYPE_IDS,
  SLOT_START,
} from "../../../../tests/builders/booking";
import { fakeCarnetQueryClient, type FakeQueryResponse } from "../../../../tests/builders/fake-carnet-query-client";

const COMMAND = {
  ...aBookingSubmission({ phone: "+33 6 12 34 56 78", message: "Ligne 1\nLigne 2" }),
  slug: BOOKING_SLUG,
  deviceClass: "mobile",
} as const;

function booker(response: FakeQueryResponse) {
  const fake = fakeCarnetQueryClient({ rpc: { book_slot: response } });
  return { calls: fake.calls, slotBooker: makeSupabaseSlotBooker(fake.client) };
}

function silenceErrors() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeSupabaseSlotBooker", () => {
  it("0039 point 8: SlotBookerError gains profile_quota (CN005)", () => {
    expectTypeOf<SlotBookerError>().toEqualTypeOf<
      "not_found" | "slot_taken" | "slot_unavailable" | "phone_required" | "invalid_input" | "profile_quota" | "unexpected"
    >();
  });

  it("criterion 1: one rpc('book_slot') with every argument → the booking id", async () => {
    const { calls, slotBooker } = booker({ data: [{ booking_id: BOOKING_IDS[0], cancel_token: CANCEL_TOKEN }], error: null });

    expect(await slotBooker.book(COMMAND)).toStrictEqual(ok({ bookingId: BOOKING_IDS[0] }));

    expect(calls).toStrictEqual([
      {
        kind: "rpc",
        fn: "book_slot",
        args: {
          p_slug: BOOKING_SLUG,
          p_event_type_id: PUBLIC_EVENT_TYPE_IDS.video,
          p_start: SLOT_START,
          p_visitor_name: "Jean Visiteur",
          p_visitor_email: "jean.visiteur@example.test",
          p_visitor_phone: "+33 6 12 34 56 78",
          p_message: "Ligne 1\nLigne 2",
          p_idempotency_key: BOOKING_IDEMPOTENCY_KEY,
          p_device_class: "mobile",
        },
      },
    ]);
  });

  it("null phone and message are sent as null", async () => {
    const { calls, slotBooker } = booker({ data: [{ booking_id: BOOKING_IDS[0], cancel_token: CANCEL_TOKEN }], error: null });

    await slotBooker.book({ ...COMMAND, phone: null, message: null });

    expect(calls[0]).toMatchObject({ args: { p_visitor_phone: null, p_message: null } });
  });

  it("note inherited from 0036: a replay returns cancel_token null → still the booking id", async () => {
    const { slotBooker } = booker({ data: [{ booking_id: BOOKING_IDS[0], cancel_token: null }], error: null });

    expect(await slotBooker.book(COMMAND)).toStrictEqual(ok({ bookingId: BOOKING_IDS[0] }));
  });

  it("the cancel token never leaves the adapter (not in the result)", async () => {
    const { slotBooker } = booker({ data: [{ booking_id: BOOKING_IDS[0], cancel_token: CANCEL_TOKEN }], error: null });

    expect(JSON.stringify(await slotBooker.book(COMMAND))).not.toContain(CANCEL_TOKEN);
  });

  it.each([
    ["P0002 (profile unknown or unpublished, type unknown, inactive or another profile's)", "P0002", "not_found"],
    ["CN001 (slot taken, buffers included; 23P01 translated by the base)", "CN001", "slot_taken"],
    ["CN002 (outside availabilities, not aligned, busy exception, notice, horizon)", "CN002", "slot_unavailable"],
    ["22023 (phone type without phone)", "22023", "phone_required"],
    ["23514 (visitor field refused by a check)", "23514", "invalid_input"],
    ["23502 (visitor field null)", "23502", "invalid_input"],
    ["CN005 (0039 point 8: 20 bookings created for the profile in the last 23 h)", "CN005", "profile_quota"],
  ] as const)("criterion 2: %s → %s, not logged as an error", async (_label, code, expected) => {
    const error = silenceErrors();
    const { slotBooker } = booker({ data: null, error: postgrestError(code, "Jean Visiteur jean.visiteur@example.test") });

    expect(await slotBooker.book(COMMAND)).toStrictEqual(err(expected));
    expect(error).not.toHaveBeenCalled();
  });

  it("translated by SQLSTATE, never by message: CN001 with an unrelated message is still slot_taken", async () => {
    const { slotBooker } = booker({ data: null, error: postgrestError("CN001", "créneau indisponible") });

    expect(await slotBooker.book(COMMAND)).toStrictEqual(err("slot_taken"));
  });

  it("any other error → unexpected, logged by code only (no visitor data, no slug)", async () => {
    const error = silenceErrors();
    const { slotBooker } = booker({
      data: null,
      error: {
        code: "42501",
        message: "permission denied for function book_slot",
        details: "Failing row contains (Jean Visiteur, jean.visiteur@example.test, +33 6 12 34 56 78).",
        hint: null,
      },
    });

    expect(await slotBooker.book(COMMAND)).toStrictEqual(err("unexpected"));

    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ level: "error", source: "book_slot", code: "42501" });
    for (const value of [BOOKING_SLUG, "Jean Visiteur", "jean.visiteur@example.test", "+33 6 12 34 56 78", "permission denied"]) {
      expect(line).not.toContain(value);
    }
  });

  it.each([
    ["no row", []],
    ["null", null],
    ["a row without booking_id", [{ cancel_token: CANCEL_TOKEN }]],
    ["a booking_id that is not a string", [{ booking_id: 42, cancel_token: null }]],
  ])("malformed answer (%s) → unexpected, the token never logged", async (_label, data) => {
    const error = silenceErrors();
    const { slotBooker } = booker({ data, error: null });

    expect(await slotBooker.book(COMMAND)).toStrictEqual(err("unexpected"));
    expect(JSON.stringify(error.mock.calls)).not.toContain(CANCEL_TOKEN);
  });
});
