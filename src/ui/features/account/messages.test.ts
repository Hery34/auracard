/**
 * Contract frozen by test-engineer (0023, decision 1 and criterion 6): French texts of /tableau-de-bord/compte and of
 * the home page after deletion. Typographic or straight apostrophes are both accepted.
 *
 * // src/ui/features/account/messages.ts
 * export const ACCOUNT_DELETED_MESSAGE: string;   // « Votre compte a été supprimé. » (home page, `?compte=supprime`)
 * export const DELETE_ACCOUNT_ERROR_MESSAGES: Readonly<Record<DeleteAccountActionError, string>>;
 * // Announced by role="alert" next to the form.
 */
import { describe, expect, it } from "vitest";

import { ACCOUNT_DELETED_MESSAGE, DELETE_ACCOUNT_ERROR_MESSAGES } from "@/ui/features/account/messages";

const GENERIC_ERROR = "Une erreur est survenue, réessayez.";

describe("account messages (0023)", () => {
  it("criterion 6: the home page says « Votre compte a été supprimé. »", () => {
    expect(ACCOUNT_DELETED_MESSAGE).toBe("Votre compte a été supprimé.");
  });

  it("covers exactly the errors of deleteAccountAction", () => {
    expect(Object.keys(DELETE_ACCOUNT_ERROR_MESSAGES).sort()).toStrictEqual(["invalid_confirmation", "rate_limited", "unexpected"]);
  });

  it("criterion 4: invalid_confirmation → « Saisissez exactement SUPPRIMER pour confirmer. »", () => {
    expect(DELETE_ACCOUNT_ERROR_MESSAGES.invalid_confirmation).toBe("Saisissez exactement SUPPRIMER pour confirmer.");
  });

  it("rate_limited speaks of too many attempts", () => {
    expect(DELETE_ACCOUNT_ERROR_MESSAGES.rate_limited).toMatch(/^Trop de tentatives/);
  });

  it("unexpected → the generic message of the application", () => {
    expect(DELETE_ACCOUNT_ERROR_MESSAGES.unexpected).toBe(GENERIC_ERROR);
  });
});
