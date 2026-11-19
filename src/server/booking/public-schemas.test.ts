/**
 * Contract frozen by test-engineer (0039, decisions 1 and 3; notes inherited from 0036; ADR 0012 §2: Zod outside the
 * domain, in a module without directive shared with the form).
 *
 * // src/server/booking/public-schemas.ts — no directive.
 * // Text fields of the booking form; an absent field is `undefined`.
 * export type BookingDraft = { eventTypeId: string | undefined; start: string | undefined; name: string | undefined;
 *   email: string | undefined; phone: string | undefined; message: string | undefined; consent: string | undefined;
 *   idempotencyKey: string | undefined };
 * // Every invalid field in BOOKING_INVALID_FIELDS order; never echoes a value.
 * //   eventTypeId: uuid (any case) → lower case;
 * //   start: an instant with an explicit offset or Z (Temporal.Instant.from, at most 64 characters) → its canonical
 * //     UTC text ("2027-03-03T09:00:00+01:00" → "2027-03-03T08:00:00Z"); a local date-time without offset refused;
 * //   name: trimmed, 1–100 code points, no forbidden character (FORBIDDEN_LABEL_CHARACTERS);
 * //   email: trimmed, z.email(), ≤ 254;
 * //   phone: optional — blank → null; otherwise trimmed and parsePhone (≤ 32, digits, spaces, . - ( ), one leading +);
 * //     whether the type requires it is decided by book_slot (22023 → phone_required, see the action);
 * //   message: optional — multilineText(2000) (\r\n → \n, trimmed); blank → null;
 * //   consent: the checkbox, exactly "on" (note inherited from 0036: not a parameter of book_slot, imposed here),
 * //     dropped from the result;
 * //   idempotencyKey: uuid → lower case.
 * export const bookingSubmissionSchema: z.ZodType<BookingSubmission, BookingDraft>;
 * export function parseBookingSubmission(draft: BookingDraft): Result<BookingSubmission, BookingInvalidField[]>;
 *
 * // 0039 point 8 — input of listSlotsAction, moved here from public-actions.ts (the use case list-public-slots no
 * // longer validates the id itself). Strict object: slug ≤ SLUG_MAX_LENGTH (40), eventTypeId uuid → lower case,
 * // from and to ≤ INSTANT_TEXT_MAX_LENGTH (64). The instants themselves (offset, to − from ≤ 169 h, window around
 * // now) are checked by the use case (invalid_range).
 * export type SlotsQuery = { slug: string; eventTypeId: string; from: string; to: string };
 * export const slotsQuerySchema: z.ZodType<SlotsQuery, unknown>;
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { parseBookingSubmission, slotsQuerySchema } from "@/server/booking/public-schemas";

import {
  aBookingDraft,
  aBookingSubmission,
  BOOKING_IDEMPOTENCY_KEY,
  BOOKING_SLUG,
  PUBLIC_EVENT_TYPE_IDS,
  SLOT_START,
} from "../../../tests/builders/booking";

describe("parseBookingSubmission (decisions 1 and 3)", () => {
  it("criterion 1: a valid draft → the submission, consent dropped, blank phone and message → null", () => {
    expect(parseBookingSubmission(aBookingDraft())).toStrictEqual(ok(aBookingSubmission()));
  });

  it("values normalized: trimmed text, \\r\\n → \\n, ids in lower case, start in canonical UTC", () => {
    const parsed = parseBookingSubmission(
      aBookingDraft({
        eventTypeId: PUBLIC_EVENT_TYPE_IDS.phone.toUpperCase(),
        start: "2027-03-03T09:00:00+01:00",
        name: "  Jean Visiteur  ",
        email: " jean.visiteur@example.test ",
        phone: " +33 6 12 34 56 78 ",
        message: " Ligne 1\r\nLigne 2 ",
        idempotencyKey: BOOKING_IDEMPOTENCY_KEY.toUpperCase(),
      }),
    );

    expect(parsed).toStrictEqual(
      ok(
        aBookingSubmission({
          eventTypeId: PUBLIC_EVENT_TYPE_IDS.phone,
          start: SLOT_START,
          phone: "+33 6 12 34 56 78",
          message: "Ligne 1\nLigne 2",
        }),
      ),
    );
  });

  it("note inherited from 0036: consent not ticked → refused here (book_slot has no consent parameter)", () => {
    expect(parseBookingSubmission(aBookingDraft({ consent: undefined }))).toStrictEqual(err(["consent"]));
    expect(parseBookingSubmission(aBookingDraft({ consent: "true" }))).toStrictEqual(err(["consent"]));
  });

  it.each([
    ["absent", undefined],
    ["not a uuid", "video"],
    ["SQL", "1; drop table carnet.bookings"],
  ])("eventTypeId %s → eventTypeId", (_label, eventTypeId) => {
    expect(parseBookingSubmission(aBookingDraft({ eventTypeId }))).toStrictEqual(err(["eventTypeId"]));
  });

  it.each([
    ["absent", undefined],
    ["a local date-time without offset", "2027-03-03T09:00"],
    ["a date only", "2027-03-03"],
    ["not a date", "demain 9h"],
    ["huge", "9".repeat(10_000)],
  ])("start %s → start", (_label, start) => {
    expect(parseBookingSubmission(aBookingDraft({ start }))).toStrictEqual(err(["start"]));
  });

  it.each([
    ["absent", { name: undefined }, ["name"]],
    ["blank", { name: "   " }, ["name"]],
    ["101 characters", { name: "n".repeat(101) }, ["name"]],
    ["a control character", { name: "Jean\u0007" }, ["name"]],
    ["a line break", { name: "Jean\nVisiteur" }, ["name"]],
    ["e-mail absent", { email: undefined }, ["email"]],
    ["e-mail invalid", { email: "pas-une-adresse" }, ["email"]],
    ["e-mail of 255 characters", { email: `${"a".repeat(242)}@example.test` }, ["email"]],
    ["phone with letters", { phone: "06 12 AB 56 78" }, ["phone"]],
    ["phone of 33 characters", { phone: "0".repeat(33) }, ["phone"]],
    ["phone without digit", { phone: "+ ( ) -" }, ["phone"]],
    ["message of 2001 characters", { message: "m".repeat(2001) }, ["message"]],
    ["message with a control character", { message: "Bonjour\u0000" }, ["message"]],
    ["key absent", { idempotencyKey: undefined }, ["idempotencyKey"]],
    ["key not a uuid", { idempotencyKey: "cle" }, ["idempotencyKey"]],
  ] as const)("%s → refused on that field only", (_label, overrides, fields) => {
    expect(parseBookingSubmission(aBookingDraft(overrides))).toStrictEqual(err([...fields]));
  });

  it("phone absent (field not sent) → null, like a blank one", () => {
    expect(parseBookingSubmission(aBookingDraft({ phone: undefined }))).toStrictEqual(ok(aBookingSubmission()));
  });

  it("message absent or blank → null; a multi-line message is kept", () => {
    expect(parseBookingSubmission(aBookingDraft({ message: undefined }))).toStrictEqual(ok(aBookingSubmission()));
    expect(parseBookingSubmission(aBookingDraft({ message: " \r\n " }))).toStrictEqual(ok(aBookingSubmission()));
    expect(parseBookingSubmission(aBookingDraft({ message: "Ligne 1\nLigne 2" }))).toStrictEqual(
      ok(aBookingSubmission({ message: "Ligne 1\nLigne 2" })),
    );
  });

  it("bounds included: name of 100, message of 2000, phone of 32 characters", () => {
    const parsed = parseBookingSubmission(
      aBookingDraft({ name: "n".repeat(100), message: "m".repeat(2000), phone: `+${"1".repeat(31)}` }),
    );

    expect(parsed.ok).toBe(true);
  });

  it("criterion 4: every invalid field, in form order, never a value", () => {
    const result = parseBookingSubmission({
      eventTypeId: "SENTINEL-TYPE",
      start: "SENTINEL-START",
      name: "",
      email: "SENTINEL-EMAIL",
      phone: "SENTINEL-PHONE",
      message: "m".repeat(2001),
      consent: undefined,
      idempotencyKey: "SENTINEL-KEY",
    });

    expect(result).toStrictEqual(
      err(["eventTypeId", "start", "name", "email", "phone", "message", "consent", "idempotencyKey"]),
    );
    expect(JSON.stringify(result)).not.toContain("SENTINEL");
  });
});

describe("slotsQuerySchema (point 8: local week [from, to) of listSlotsAction)", () => {
  const query = {
    slug: BOOKING_SLUG,
    eventTypeId: PUBLIC_EVENT_TYPE_IDS.video,
    from: "2027-10-30T22:00:00Z",
    to: "2027-11-06T23:00:00Z",
  };

  it("the week of 31 October 2027 in Paris (169 h) → kept as sent", () => {
    expect(slotsQuerySchema.safeParse(query)).toMatchObject({ success: true, data: query });
  });

  it("layers: the event type id is validated here, in lower case", () => {
    const parsed = slotsQuerySchema.safeParse({ ...query, eventTypeId: PUBLIC_EVENT_TYPE_IDS.video.toUpperCase() });

    expect(parsed).toMatchObject({ success: true, data: { eventTypeId: PUBLIC_EVENT_TYPE_IDS.video } });
  });

  it.each([
    ["no to", { slug: query.slug, eventTypeId: query.eventTypeId, from: query.from }],
    ["a to longer than 64 characters", { ...query, to: "9".repeat(65) }],
    ["a from longer than 64 characters", { ...query, from: "9".repeat(65) }],
    ["a type that is not a uuid", { ...query, eventTypeId: "video" }],
    ["a slug longer than 40 characters", { ...query, slug: "a".repeat(41) }],
    ["an unknown key", { ...query, until: query.to }],
    ["not an object", "elodie"],
  ])("%s → refused", (_label, input) => {
    expect(slotsQuerySchema.safeParse(input).success).toBe(false);
  });
});
