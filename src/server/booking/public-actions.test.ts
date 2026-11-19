/**
 * Contract frozen by test-engineer (0039, decisions 1 to 3; criteria 1, 2 and 4; ADR 0012). Model: captureLeadAction
 * (0032). The container is replaced (port of the composition root); nothing of the domain is mocked.
 *
 * // src/server/booking/public-actions.ts — "use server" (scheduling).
 * export type BookSlotActionError = "invalid_input" | Exclude<BookSlotError, "phone_required" | "invalid_input">;
 * export type BookSlotState =
 *   | { status: "idle" }
 *   | { status: "error"; error: BookSlotActionError; fields?: BookingInvalidField[] }
 *   | { status: "booked"; bookingId: string };
 * // Fields: slug (hidden), eventTypeId, start (ISO instant of the chosen slot), name, email, phone, message, consent
 * // (checkbox "on"), idempotencyKey (hidden, generated at mount, new after any refusal without write),
 * // cf-turnstile-response. parseBookingSubmission refuses → { error: "invalid_input", fields } before any container.
 * // Otherwise createPublicContainer().bookSlot({ ...submission, slug, challengeToken }, await headers()):
 * //   ok → { status: "booked", bookingId }; phone_required → { error: "invalid_input", fields: ["phone"] };
 * //   invalid_input (23514 / 23502) → { error: "invalid_input" } (no field known); any other error as is.
 * // No submitted value (name, e-mail, phone, message, token) in any state.
 * export async function bookSlotAction(previous: BookSlotState, formData: FormData): Promise<BookSlotState>;
 *
 * export type ListSlotsActionResult =
 *   | { status: "ok"; slots: { start: string; end: string }[] }     // canonical UTC texts, sorted
 *   | { status: "error"; error: "invalid_input" | ListPublicSlotsError };
 * // Point 8: input checked by slotsQuerySchema (src/server/booking/public-schemas.ts; strict object: slug ≤ 40,
 * // eventTypeId uuid → lower case, from ≤ 64 and to ≤ 64 characters) → else invalid_input before any container.
 * // Then createPublicContainer().listPublicSlots({ slug, eventTypeId, from, to }, await headers()) — the use case
 * // checks the instants (to − from ≤ 169 h).
 * export async function listSlotsAction(input: { slug: string; eventTypeId: string; from: string; to: string }): Promise<ListSlotsActionResult>;
 *
 * // src/server/container.ts — PublicContainer gains (built on demand like captureLead):
 * //   getPublicBookingPage: GetPublicBookingPage (anonymous client; cached under profileCacheTag(slug));
 * //   listPublicSlots: (input: Omit<ListPublicSlotsInput, "clientAddress">, headers: Headers) => …  (rate limiter on
 * //     the service_role client, reader on the anonymous client, real clock);
 * //   bookSlot: (input: Omit<BookSlotInput, "userAgent" | "clientAddress">, headers: Headers) => … (rate limiter,
 * //     Turnstile verifier and makeSupabaseSlotBooker on the service_role client).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import type { BookSlotActionError, BookSlotState, ListSlotsActionResult } from "@/server/booking/public-actions";

import { IPHONE_USER_AGENT } from "../../../tests/builders/analytics";
import {
  aBookingDraft,
  BOOKING_IDEMPOTENCY_KEY,
  BOOKING_IDS,
  BOOKING_SLUG,
  CHALLENGE_TOKEN,
  PUBLIC_EVENT_TYPE_IDS,
  SLOT_START,
} from "../../../tests/builders/booking";
import { range } from "../../../tests/builders/booking-slots";
import { stubValidEnv } from "../../../tests/builders/env";

const mocks = vi.hoisted(() => ({
  createContainer: vi.fn(),
  createPublicContainer: vi.fn(),
  bookSlot: vi.fn(),
  listPublicSlots: vi.fn(),
}));

vi.mock("@/server/container", () => ({
  createContainer: mocks.createContainer,
  createPublicContainer: mocks.createPublicContainer,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": IPHONE_USER_AGENT }),
  cookies: async () => ({ getAll: () => [], get: () => undefined, has: () => false, set: vi.fn(), delete: vi.fn() }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }));

const idle: BookSlotState = { status: "idle" };
const FROM = "2027-03-01T23:00:00Z";
const TO = "2027-03-08T23:00:00Z";

function form(fields: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) {
      data.set(name, value);
    }
  }
  return data;
}

function bookingForm(overrides: Record<string, string | undefined> = {}): FormData {
  return form({ slug: BOOKING_SLUG, ...aBookingDraft(), "cf-turnstile-response": CHALLENGE_TOKEN, ...overrides });
}

let actions: typeof import("@/server/booking/public-actions");

beforeAll(async () => {
  stubValidEnv();
  actions = await import("@/server/booking/public-actions");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createPublicContainer.mockImplementation(() => ({ bookSlot: mocks.bookSlot, listPublicSlots: mocks.listPublicSlots }));
  mocks.bookSlot.mockResolvedValue(ok({ bookingId: BOOKING_IDS[0] }));
  mocks.listPublicSlots.mockResolvedValue(
    ok([range("2027-03-02T08:00:00Z", "2027-03-02T08:30:00Z"), range("2027-03-02T08:30:00Z", "2027-03-02T09:00:00Z")]),
  );
});

describe("bookSlotAction (decision 1)", () => {
  it("BookSlotActionError = invalid_input + the errors of the use case shown to the visitor", () => {
    expectTypeOf<BookSlotActionError>().toEqualTypeOf<
      | "invalid_input"
      | "not_found"
      | "challenge_failed"
      | "challenge_unavailable"
      | "rate_limited"
      | "slot_taken"
      | "slot_unavailable"
      | "unexpected"
    >();
  });

  it("criterion 1: passes the validated submission, the slug, the token and the request headers → booked", async () => {
    expect(await actions.bookSlotAction(idle, bookingForm())).toStrictEqual({ status: "booked", bookingId: BOOKING_IDS[0] });

    expect(mocks.bookSlot).toHaveBeenCalledTimes(1);
    const [input, headers] = mocks.bookSlot.mock.calls[0] as [Record<string, unknown>, Headers];
    expect(input).toStrictEqual({
      slug: BOOKING_SLUG,
      eventTypeId: PUBLIC_EVENT_TYPE_IDS.video,
      start: SLOT_START,
      name: "Jean Visiteur",
      email: "jean.visiteur@example.test",
      phone: null,
      message: null,
      idempotencyKey: BOOKING_IDEMPOTENCY_KEY,
      challengeToken: CHALLENGE_TOKEN,
    });
    expect(headers.get("user-agent")).toBe(IPHONE_USER_AGENT);
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");
  });

  it("decision 3: consent not ticked → invalid_input on consent, before any container", async () => {
    expect(await actions.bookSlotAction(idle, bookingForm({ consent: undefined }))).toStrictEqual({
      status: "error",
      error: "invalid_input",
      fields: ["consent"],
    });
    expect(mocks.createPublicContainer).not.toHaveBeenCalled();
  });

  it("criterion 4: every invalid field named (announced next to the field), no value echoed", async () => {
    const state = await actions.bookSlotAction(idle, bookingForm({ name: "", email: "SENTINEL-EMAIL", phone: "SENTINEL-PHONE" }));

    expect(state).toStrictEqual({ status: "error", error: "invalid_input", fields: ["name", "email", "phone"] });
    expect(JSON.stringify(state)).not.toContain("SENTINEL");
    expect(mocks.createPublicContainer).not.toHaveBeenCalled();
  });

  it("decision 3: phone type without phone (phone_required) → invalid_input on the phone field", async () => {
    mocks.bookSlot.mockResolvedValue(err("phone_required"));

    expect(await actions.bookSlotAction(idle, bookingForm({ eventTypeId: PUBLIC_EVENT_TYPE_IDS.phone }))).toStrictEqual({
      status: "error",
      error: "invalid_input",
      fields: ["phone"],
    });
  });

  it("note inherited from 0036: 23514 / 23502 on a visitor field (invalid_input) → invalid_input without field", async () => {
    mocks.bookSlot.mockResolvedValue(err("invalid_input"));

    expect(await actions.bookSlotAction(idle, bookingForm())).toStrictEqual({ status: "error", error: "invalid_input" });
  });

  it.each([
    ["slot_taken"],
    ["slot_unavailable"],
    ["challenge_failed"],
    ["challenge_unavailable"],
    ["rate_limited"],
    ["not_found"],
    ["unexpected"],
  ] as const)("criterion 2: use case error %s → { status: 'error', error } as is", async (error) => {
    mocks.bookSlot.mockResolvedValue(err(error));

    expect(await actions.bookSlotAction(idle, bookingForm())).toStrictEqual({ status: "error", error });
  });

  it("a missing Turnstile token is passed as absent (the use case refuses it)", async () => {
    mocks.bookSlot.mockResolvedValue(err("challenge_failed"));

    await actions.bookSlotAction(idle, bookingForm({ "cf-turnstile-response": undefined }));

    const [input] = mocks.bookSlot.mock.calls[0] as [Record<string, unknown>];
    expect(input.challengeToken).toBeUndefined();
  });

  it("criterion 1 / idempotence: the same form submitted twice reaches the use case twice with the same key", async () => {
    await actions.bookSlotAction(idle, bookingForm());
    await actions.bookSlotAction(idle, bookingForm());

    const keys = mocks.bookSlot.mock.calls.map(([input]) => (input as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toStrictEqual([BOOKING_IDEMPOTENCY_KEY, BOOKING_IDEMPOTENCY_KEY]);
  });

  it("no submitted value in the returned state, whatever the outcome", async () => {
    mocks.bookSlot.mockResolvedValue(err("slot_taken"));
    const sentinel = bookingForm({ name: "SENTINEL-NAME", email: "sentinel@example.test", phone: "+33 6 99 99 99 99", message: "SENTINEL-MESSAGE" });

    const state = JSON.stringify(await actions.bookSlotAction(idle, sentinel));

    for (const value of ["SENTINEL", "sentinel@example.test", "99 99", CHALLENGE_TOKEN]) {
      expect(state).not.toContain(value);
    }
  });
});

describe("listSlotsAction (decision 2)", () => {
  it("point 8: passes slug, type, start and end of the local week with the request headers → the slots as UTC texts", async () => {
    const result: ListSlotsActionResult = await actions.listSlotsAction({ slug: BOOKING_SLUG, eventTypeId: PUBLIC_EVENT_TYPE_IDS.video, from: FROM, to: TO });

    expect(result).toStrictEqual({
      status: "ok",
      slots: [
        { start: "2027-03-02T08:00:00Z", end: "2027-03-02T08:30:00Z" },
        { start: "2027-03-02T08:30:00Z", end: "2027-03-02T09:00:00Z" },
      ],
    });
    const [input, headers] = mocks.listPublicSlots.mock.calls[0] as [Record<string, unknown>, Headers];
    expect(input).toStrictEqual({ slug: BOOKING_SLUG, eventTypeId: PUBLIC_EVENT_TYPE_IDS.video, from: FROM, to: TO });
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");
  });

  it("point 8: the week of the autumn change (169 h, 31 October 2027 in Paris) reaches the use case as sent", async () => {
    await actions.listSlotsAction({ slug: BOOKING_SLUG, eventTypeId: PUBLIC_EVENT_TYPE_IDS.video, from: "2027-10-30T22:00:00Z", to: "2027-11-06T23:00:00Z" });

    const [input] = mocks.listPublicSlots.mock.calls[0] as [Record<string, unknown>];
    expect(input).toMatchObject({ from: "2027-10-30T22:00:00Z", to: "2027-11-06T23:00:00Z" });
  });

  it("point 8 (layers): the event type id is validated here and passed in lower case", async () => {
    await actions.listSlotsAction({ slug: BOOKING_SLUG, eventTypeId: PUBLIC_EVENT_TYPE_IDS.video.toUpperCase(), from: FROM, to: TO });

    const [input] = mocks.listPublicSlots.mock.calls[0] as [Record<string, unknown>];
    expect(input.eventTypeId).toBe(PUBLIC_EVENT_TYPE_IDS.video);
  });

  it.each([
    ["a slug longer than 40 characters", { slug: "a".repeat(41), eventTypeId: PUBLIC_EVENT_TYPE_IDS.video, from: FROM, to: TO }],
    ["a type that is not a uuid", { slug: BOOKING_SLUG, eventTypeId: "video", from: FROM, to: TO }],
    ["a huge from", { slug: BOOKING_SLUG, eventTypeId: PUBLIC_EVENT_TYPE_IDS.video, from: "9".repeat(65), to: TO }],
    ["a huge to", { slug: BOOKING_SLUG, eventTypeId: PUBLIC_EVENT_TYPE_IDS.video, from: FROM, to: "9".repeat(65) }],
    ["no to (point 8)", { slug: BOOKING_SLUG, eventTypeId: PUBLIC_EVENT_TYPE_IDS.video, from: FROM }],
    ["an unknown key", { slug: BOOKING_SLUG, eventTypeId: PUBLIC_EVENT_TYPE_IDS.video, from: FROM, to: TO, until: TO }],
    ["not an object", "elodie"],
  ])("%s → invalid_input before any container", async (_label, input) => {
    expect(await actions.listSlotsAction(input as never)).toStrictEqual({ status: "error", error: "invalid_input" });
    expect(mocks.createPublicContainer).not.toHaveBeenCalled();
  });

  it.each([["not_found"], ["invalid_range"], ["rate_limited"], ["too_many_slots"], ["unexpected"]] as const)(
    "use case error %s → { status: 'error', error } as is",
    async (error) => {
      mocks.listPublicSlots.mockResolvedValue(err(error));

      expect(await actions.listSlotsAction({ slug: BOOKING_SLUG, eventTypeId: PUBLIC_EVENT_TYPE_IDS.video, from: FROM, to: TO })).toStrictEqual({
        status: "error",
        error,
      });
    },
  );
});
