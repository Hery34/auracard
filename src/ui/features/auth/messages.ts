import type { ActionState } from "@/server/actions/auth";
import { DISPLAY_NAME_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/actions/auth-limits";

type FailedState = Extract<ActionState, { status: "error" }>;
export type ActionError = FailedState["error"];

/** Form-level summary, announced by `role="alert"`; field-level details come from `fieldErrorsOf`. */
export const FORM_ERROR_MESSAGES: Readonly<Record<ActionError, string>> = {
  invalid_input: "Vérifiez les champs signalés.",
  rate_limited: "Trop de tentatives, réessayez dans quelques minutes.",
  email_taken: "Un compte existe déjà avec cette adresse.",
  weak_password: `Mot de passe trop faible (${PASSWORD_MIN_LENGTH} caractères au moins).`,
  slug_unavailable: "Impossible de générer une adresse de profil, réessayez avec un autre nom.",
  registration_closed: "Les inscriptions sont fermées pour le moment.",
  invalid_credentials: "Adresse ou mot de passe incorrect.",
  email_not_confirmed: "Confirmez votre adresse e-mail avant de vous connecter.",
  display_name_required: "Une dernière étape pour rejoindre AuraCard : complétez le champ signalé.",
  unexpected: "Une erreur est survenue, réessayez.",
};

const DISPLAY_NAME_REQUIRED = "Indiquez le nom à afficher sur votre profil.";

type FieldMessages = Readonly<Record<string, string>>;

/** Messages per field name; the submitted value is never echoed. */
export const REGISTER_FIELD_MESSAGES: FieldMessages = {
  email: "Saisissez une adresse e-mail valide.",
  password: `Le mot de passe doit compter entre ${PASSWORD_MIN_LENGTH} et ${PASSWORD_MAX_LENGTH} caractères.`,
  displayName: `Indiquez un nom de 1 à ${DISPLAY_NAME_MAX_LENGTH} caractères, sans caractère invisible.`,
};

export const SIGN_IN_FIELD_MESSAGES: FieldMessages = {
  ...REGISTER_FIELD_MESSAGES,
  password: `Saisissez votre mot de passe (${PASSWORD_MAX_LENGTH} caractères au plus).`,
};

export function formErrorOf(state: ActionState): ActionError | null {
  return state.status === "error" ? state.error : null;
}

export function fieldErrorsOf(state: ActionState, messages: FieldMessages): Readonly<Record<string, string>> {
  if (state.status !== "error") {
    return {};
  }
  if (state.error === "display_name_required") {
    return { displayName: DISPLAY_NAME_REQUIRED };
  }
  if (state.error !== "invalid_input") {
    return {};
  }
  return Object.fromEntries(
    Object.keys(state.fields ?? {}).map((name) => [name, messages[name] ?? FORM_ERROR_MESSAGES.invalid_input]),
  );
}
