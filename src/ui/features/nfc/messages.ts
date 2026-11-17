import type { ActivateNfcTagActionError, NfcTagActionError } from "@/server/actions/nfc";

const UNEXPECTED = "Une erreur est survenue, réessayez.";
const INVALID_CODE = "Code incorrect ou carte indisponible.";

export const SIGN_IN_TO_ACTIVATE_MESSAGE = "Connectez-vous pour activer cette carte.";
export const CONFIRM_EMAIL_THEN_TAP_AGAIN = "Après la confirmation de votre adresse e-mail, approchez de nouveau la carte de votre téléphone.";
export const ACTIVATION_CODE_HINT = "Format XXXXX-XXXXX, majuscules et tiret facultatifs.";

/** Announced by `role="alert"` next to the form; `invalid_input` reads like `invalid` (no oracle). */
export const ACTIVATION_ERROR_MESSAGES: Readonly<Record<ActivateNfcTagActionError, string>> = {
  invalid: INVALID_CODE,
  invalid_input: INVALID_CODE,
  rate_limited: "Trop d’essais. Réessayez dans une heure.",
  no_profile: "Créez d’abord votre profil pour y associer cette carte.",
  unexpected: UNEXPECTED,
};

export const NO_TAGS_MESSAGE = "Aucune carte. Approchez votre carte d’un téléphone pour l’activer.";
export const RELEASE_CONFIRMATION_MESSAGE = "La carte pourra être activée de nouveau avec son code.";

export const TAG_ACTION_ERROR_MESSAGES: Readonly<Record<NfcTagActionError, string>> = {
  invalid_input: UNEXPECTED,
  not_found: "Cette carte ne fait plus partie de votre compte.",
  rate_limited: "Trop de modifications en peu de temps, réessayez dans quelques minutes.",
  unexpected: UNEXPECTED,
};
