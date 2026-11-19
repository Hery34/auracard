/**
 * Contract frozen by test-engineer (0039, decisions 2, 3 and 5; criteria 2 and 4; model: src/ui/features/lead/messages.ts).
 *
 * // src/ui/features/booking/public-messages.ts (frontend)
 * // Announced by role="alert"; one message per error of bookSlotAction, never a submitted value.
 * export const BOOK_SLOT_ERROR_MESSAGES: Readonly<Record<BookSlotActionError, string>>;
 * // Announced next to each field (aria-describedby).
 * export const BOOKING_FIELD_ERROR_MESSAGES: Readonly<Record<BookingInvalidField, string>>;
 * // Decision 3 (art. 13, model 0032 decision 14): purpose, recipient (the owner), retention « 12 mois après la date du
 * // rendez-vous », rights, Cloudflare (anti-robot, possibly outside the EU), Infomaniak (e-mails); 0039 point 8: legal
 * // basis and complaint — « Base légale : votre consentement, que vous pouvez retirer à tout moment auprès de <owner>.
 * // Vous pouvez introduire une réclamation auprès de la CNIL. »
 * export function bookingPrivacyNotice(ownerName: string): string;
 * // Name of the mandatory checkbox: starts with « J’accepte », names the owner.
 * export function bookingConsentLabel(ownerName: string): string;
 * // Decision 5: the confirmation reminds that the confirmation e-mail carries the cancellation link.
 * export const BOOKING_CONFIRMED_MESSAGE: string;   // contains « Rendez-vous confirmé »
 * export const CANCELLATION_REMINDER: string;       // contains « e-mail » and « annul »
 */
import { describe, expect, it } from "vitest";

import { BOOKING_INVALID_FIELDS } from "@/domain/booking/booking";
import type { BookSlotActionError } from "@/server/booking/public-actions";
import {
  BOOK_SLOT_ERROR_MESSAGES,
  BOOKING_CONFIRMED_MESSAGE,
  BOOKING_FIELD_ERROR_MESSAGES,
  bookingConsentLabel,
  bookingPrivacyNotice,
  CANCELLATION_REMINDER,
} from "@/ui/features/booking/public-messages";

import { legalBasisPattern } from "../../../../tests/builders/privacy";

const OWNER = "Élodie Durand-Merel";
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

describe("public booking messages", () => {
  it("criterion 2: one non-empty message per error, no other key", () => {
    expect(Object.keys(BOOK_SLOT_ERROR_MESSAGES).sort()).toStrictEqual([...ERRORS].sort());
    for (const error of ERRORS) {
      expect(BOOK_SLOT_ERROR_MESSAGES[error].trim()).not.toBe("");
    }
  });

  it("decision 2: slot taken between display and submission → explicit, invites to choose another one", () => {
    expect(BOOK_SLOT_ERROR_MESSAGES.slot_taken).toMatch(/déjà (été )?pris|n['’]est plus disponible/i);
    expect(BOOK_SLOT_ERROR_MESSAGES.slot_taken).toMatch(/autre créneau/i);
  });

  it("criterion 2: Turnstile refused or unavailable → « anti-robot »; limit → « réessayez plus tard »", () => {
    expect(BOOK_SLOT_ERROR_MESSAGES.challenge_failed).toMatch(/anti-robot/i);
    expect(BOOK_SLOT_ERROR_MESSAGES.challenge_unavailable).toMatch(/anti-robot/i);
    expect(BOOK_SLOT_ERROR_MESSAGES.rate_limited).toMatch(/réessayez plus tard/i);
  });

  it("criterion 4: one message per field", () => {
    expect(Object.keys(BOOKING_FIELD_ERROR_MESSAGES).sort()).toStrictEqual([...BOOKING_INVALID_FIELDS].sort());
    expect(BOOKING_FIELD_ERROR_MESSAGES.phone).toMatch(/téléphone/i);
    expect(BOOKING_FIELD_ERROR_MESSAGES.consent).toMatch(/coch/i);
  });

  it("decision 3: information notice (art. 13) — purpose, owner, 12 months after the appointment, rights, Cloudflare, Infomaniak", () => {
    const notice = bookingPrivacyNotice(OWNER);

    expect(notice).toContain(OWNER);
    expect(notice).toMatch(/12 mois après (la date du )?(votre )?rendez-vous/);
    expect(notice).toMatch(/Vous pouvez demander l['’]accès à vos (données|coordonnées), leur effacement ou vous opposer à leur traitement auprès de /);
    expect(notice).toContain("Cloudflare");
    expect(notice).toMatch(/hors de l['’]Union européenne/);
    expect(notice).toContain("Infomaniak");
  });

  it("point 8: the notice states the legal basis (consent, withdrawable from the owner) and the complaint to the CNIL", () => {
    expect(bookingPrivacyNotice(OWNER)).toMatch(legalBasisPattern(OWNER));
  });

  it("decision 3: the consent label starts with « J’accepte » and names the owner", () => {
    expect(bookingConsentLabel(OWNER)).toMatch(/^J['’]accepte/);
    expect(bookingConsentLabel(OWNER)).toContain(OWNER);
  });

  it("decision 5: confirmation and reminder of the cancellation link sent by e-mail", () => {
    expect(BOOKING_CONFIRMED_MESSAGE).toMatch(/Rendez-vous confirmé/);
    expect(CANCELLATION_REMINDER).toMatch(/e-mail/);
    expect(CANCELLATION_REMINDER).toMatch(/annul/i);
  });
});
