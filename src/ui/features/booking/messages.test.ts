/**
 * Contract frozen by test-engineer (0038, decisions 2 and 3, criterion 3): French texts of
 * /tableau-de-bord/rendez-vous/reglages. Typographic or straight apostrophes are both accepted.
 *
 * // src/ui/features/booking/messages.ts — error types from @/server/booking/actions, never from a use case (ADR 0012).
 * export const PHASE_1_CALENDAR_NOTICE: string;   // decision 2, exact text
 * export const BOOKING_SETTINGS_ERROR_MESSAGES: Readonly<Record<BookingSettingsActionError, string>>;
 * // limit_reached depends on the section: types (10), weekly plages (50), upcoming exceptions (200).
 * export const LIMIT_REACHED_MESSAGES: Readonly<{ eventTypes: string; rules: string; exceptions: string }>;
 * export const RULE_ISSUE_MESSAGES: Readonly<Record<RuleIssueReason, string>>;
 * export const WEEKDAY_LABELS: Readonly<Record<Weekday, string>>;          // « Lundi » … « Dimanche »
 * export const LOCATION_KIND_LABELS: Readonly<Record<LocationKind, string>>; // « En personne », « Téléphone », « Visio »
 * export const EXCEPTION_KIND_LABELS: Readonly<Record<ExceptionKind, string>>; // « Absence », « Ouverture ponctuelle »
 * // Field errors announced next to each field (aria-describedby), never the typed value.
 * export const EVENT_TYPE_FIELD_ERROR_MESSAGES: Readonly<Record<EventTypeField, string>>;
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import type { BookingSettingsActionError } from "@/server/booking/actions";
import {
  BOOKING_SETTINGS_ERROR_MESSAGES,
  EVENT_TYPE_FIELD_ERROR_MESSAGES,
  EXCEPTION_KIND_LABELS,
  LIMIT_REACHED_MESSAGES,
  LOCATION_KIND_LABELS,
  PHASE_1_CALENDAR_NOTICE,
  RULE_ISSUE_MESSAGES,
  WEEKDAY_LABELS,
} from "@/ui/features/booking/messages";

const GENERIC_ERROR = "Une erreur est survenue, réessayez.";

describe("decision 2: phase 1 reminder (ADR 0005)", () => {
  it("exact text", () => {
    expect(PHASE_1_CALENDAR_NOTICE).toMatch(
      /^En phase 1, votre agenda \(Google, Outlook\) n['’]est pas lu : tenez vos disponibilités à jour\.$/,
    );
  });
});

describe("errors of the settings actions", () => {
  it("keyed by BookingSettingsActionError of @/server/booking/actions", () => {
    expectTypeOf(BOOKING_SETTINGS_ERROR_MESSAGES).toEqualTypeOf<Readonly<Record<BookingSettingsActionError, string>>>();
    expect(Object.keys(BOOKING_SETTINGS_ERROR_MESSAGES).sort()).toStrictEqual([
      "already_ended",
      "conflict",
      "has_bookings",
      "invalid_input",
      "invalid_range",
      "limit_reached",
      "not_found",
      "overlap",
      "rate_limited",
      "unexpected",
    ]);
  });

  it("note of 0036: a type with bookings → « désactivez-le »", () => {
    expect(BOOKING_SETTINGS_ERROR_MESSAGES.has_bookings).toMatch(/réservation/i);
    expect(BOOKING_SETTINGS_ERROR_MESSAGES.has_bookings).toMatch(/désactivez-le/i);
  });

  it("invalid_input → « Vérifiez les champs signalés. »; unexpected → the generic message", () => {
    expect(BOOKING_SETTINGS_ERROR_MESSAGES.invalid_input).toBe("Vérifiez les champs signalés.");
    expect(BOOKING_SETTINGS_ERROR_MESSAGES.unexpected).toBe(GENERIC_ERROR);
  });

  it("overlap, range, ended, conflict and rate limit have their own explicit message", () => {
    expect(BOOKING_SETTINGS_ERROR_MESSAGES.overlap).toMatch(/chevauch/i);
    expect(BOOKING_SETTINGS_ERROR_MESSAGES.invalid_range).toMatch(/fin/i);
    expect(BOOKING_SETTINGS_ERROR_MESSAGES.already_ended).toMatch(/pass/i);
    expect(BOOKING_SETTINGS_ERROR_MESSAGES.conflict).toMatch(/recharg/i);
    expect(BOOKING_SETTINGS_ERROR_MESSAGES.rate_limited).toMatch(/^Trop de/);
    for (const message of Object.values(BOOKING_SETTINGS_ERROR_MESSAGES)) {
      expect(message.trim()).not.toBe("");
    }
  });

  it("decision 3 and point 17 of 0036: each limit states its number", () => {
    expect(LIMIT_REACHED_MESSAGES.eventTypes).toMatch(/\b10\b/);
    expect(LIMIT_REACHED_MESSAGES.rules).toMatch(/\b50\b/);
    expect(LIMIT_REACHED_MESSAGES.exceptions).toMatch(/\b200\b/);
  });

  it("one message per rule issue", () => {
    expect(Object.keys(RULE_ISSUE_MESSAGES).sort()).toStrictEqual(["invalid_order", "invalid_time", "invalid_weekday", "overlap", "too_short"]);
    expect(RULE_ISSUE_MESSAGES.too_short).toMatch(/5 min/);
    expect(RULE_ISSUE_MESSAGES.overlap).toMatch(/chevauch/i);
  });

  it("one field message per event type field, none empty", () => {
    expect(Object.keys(EVENT_TYPE_FIELD_ERROR_MESSAGES).sort()).toStrictEqual(
      ["bufferMin", "durationMin", "locationKind", "locationText", "minNoticeMin", "title"].sort(),
    );
    expect(EVENT_TYPE_FIELD_ERROR_MESSAGES.title).toMatch(/80/);
    expect(EVENT_TYPE_FIELD_ERROR_MESSAGES.durationMin).toMatch(/5/);
    expect(EVENT_TYPE_FIELD_ERROR_MESSAGES.durationMin).toMatch(/480/);
  });
});

describe("labels", () => {
  it("ISO weekdays, Monday first", () => {
    expect(WEEKDAY_LABELS).toStrictEqual({
      1: "Lundi",
      2: "Mardi",
      3: "Mercredi",
      4: "Jeudi",
      5: "Vendredi",
      6: "Samedi",
      7: "Dimanche",
    });
  });

  it("location kinds and exception kinds", () => {
    expect(LOCATION_KIND_LABELS).toStrictEqual({ in_person: "En personne", phone: "Téléphone", video: "Visio" });
    expect(EXCEPTION_KIND_LABELS).toStrictEqual({ busy: "Absence", extra: "Ouverture ponctuelle" });
  });
});
