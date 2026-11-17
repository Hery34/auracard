/**
 * Contract frozen by test-engineer (0025, decisions 5, 6 and 8): French texts of /activer/{uid} and « Mes puces ».
 * Typographic or straight apostrophes are both accepted.
 *
 * // src/ui/features/nfc/messages.ts
 * export const SIGN_IN_TO_ACTIVATE_MESSAGE: string;   // « Connectez-vous pour activer cette carte »
 * // Announced by role="alert" next to the form; invalid_input (tampered hidden uid) reads like invalid (no oracle).
 * export const ACTIVATION_ERROR_MESSAGES: Readonly<Record<ActivateNfcTagActionError, string>>;
 * export const NO_TAGS_MESSAGE: string;               // « Aucune carte. Approchez votre carte d'un téléphone pour l'activer. »
 * export const RELEASE_CONFIRMATION_MESSAGE: string;  // « La carte pourra être activée de nouveau avec son code. »
 * export const TAG_ACTION_ERROR_MESSAGES: Readonly<Record<NfcTagActionError, string>>;
 */
import { describe, expect, it } from "vitest";

import {
  ACTIVATION_ERROR_MESSAGES,
  NO_TAGS_MESSAGE,
  RELEASE_CONFIRMATION_MESSAGE,
  SIGN_IN_TO_ACTIVATE_MESSAGE,
  TAG_ACTION_ERROR_MESSAGES,
} from "@/ui/features/nfc/messages";

const GENERIC_ERROR = "Une erreur est survenue, réessayez.";

describe("activation messages (decisions 5 and 6)", () => {
  it("covers exactly the errors of activateNfcTagAction", () => {
    expect(Object.keys(ACTIVATION_ERROR_MESSAGES).sort()).toStrictEqual([
      "invalid",
      "invalid_input",
      "no_profile",
      "rate_limited",
      "unexpected",
    ]);
  });

  it("criterion 3: invalid → « Code incorrect ou carte indisponible. »", () => {
    expect(ACTIVATION_ERROR_MESSAGES.invalid).toBe("Code incorrect ou carte indisponible.");
  });

  it("criterion 3: invalid_input reads exactly like invalid (one single message for every refusal)", () => {
    expect(ACTIVATION_ERROR_MESSAGES.invalid_input).toBe(ACTIVATION_ERROR_MESSAGES.invalid);
  });

  it("criterion 3: rate_limited → « Trop d'essais. Réessayez dans une heure. »", () => {
    expect(ACTIVATION_ERROR_MESSAGES.rate_limited).toMatch(/^Trop d['’]essais\. Réessayez dans une heure\.$/);
  });

  it("no_profile speaks of the profile (the page adds a link to the editor)", () => {
    expect(ACTIVATION_ERROR_MESSAGES.no_profile).toMatch(/profil/i);
    expect(ACTIVATION_ERROR_MESSAGES.no_profile).not.toBe(ACTIVATION_ERROR_MESSAGES.invalid);
  });

  it("unexpected → the generic message of the application", () => {
    expect(ACTIVATION_ERROR_MESSAGES.unexpected).toBe(GENERIC_ERROR);
  });

  it("decision 5: without session « Connectez-vous pour activer cette carte »", () => {
    expect(SIGN_IN_TO_ACTIVATE_MESSAGE).toMatch(/^Connectez-vous pour activer cette carte\.?$/);
  });
});

describe("« Mes puces » messages (decision 8)", () => {
  it("empty state: « Aucune carte. Approchez votre carte d'un téléphone pour l'activer. »", () => {
    expect(NO_TAGS_MESSAGE).toMatch(/^Aucune carte\. Approchez votre carte d['’]un téléphone pour l['’]activer\.$/);
  });

  it("release confirmation: « La carte pourra être activée de nouveau avec son code. »", () => {
    expect(RELEASE_CONFIRMATION_MESSAGE).toBe("La carte pourra être activée de nouveau avec son code.");
  });

  it("covers exactly the errors of the tag actions, each one a French sentence", () => {
    expect(Object.keys(TAG_ACTION_ERROR_MESSAGES).sort()).toStrictEqual(["invalid_input", "not_found", "rate_limited", "unexpected"]);
    for (const message of Object.values(TAG_ACTION_ERROR_MESSAGES)) {
      expect(message).toMatch(/^[A-ZÀ-Ý].*\.$/);
    }
    expect(TAG_ACTION_ERROR_MESSAGES.unexpected).toBe(GENERIC_ERROR);
  });
});
