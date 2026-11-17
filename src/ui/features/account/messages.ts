import { ACCOUNT_DELETION_CONFIRMATION } from "@/domain/account/account-deletion";
import type { DeleteAccountActionError } from "@/server/actions/account";

export const ACCOUNT_DELETED_MESSAGE = "Votre compte a été supprimé.";

/** Announced by `role="alert"` next to the form; `unauthenticated` sends to the sign-in page instead. */
export const DELETE_ACCOUNT_ERROR_MESSAGES: Readonly<Record<DeleteAccountActionError, string>> = {
  invalid_confirmation: `Saisissez exactement ${ACCOUNT_DELETION_CONFIRMATION} pour confirmer.`,
  rate_limited: "Trop de tentatives en peu de temps, réessayez dans quelques minutes.",
  unexpected: "Une erreur est survenue, réessayez.",
};
