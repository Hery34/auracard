import { HTTPS_URL_MAX_LENGTH } from "@/domain/profile/https-url";
import { LINK_LABEL_MAX_LENGTH, MAX_LINKS } from "@/domain/profile/link";
import { PROFILE_TEXT_MAX_LENGTH } from "@/domain/profile/profile";
import type { ProfileActionError } from "@/server/actions/profile";
import type { TextFieldName } from "@/ui/features/profile-editor/editor-state";

export const SAVED_MESSAGE = "Modifications enregistrées.";
export const PUBLIC_NUMBER_NOTICE = "Ce numéro sera visible publiquement sur votre profil.";
export const PROFILE_KEPT_MESSAGE = "Vos informations ont été enregistrées, mais pas vos liens.";

/** Form-level summary, announced by `role="alert"`; `unauthenticated` sends to the sign-in page instead. */
export const FORM_ERROR_MESSAGES: Readonly<Record<Exclude<ProfileActionError, "unauthenticated">, string>> = {
  invalid_input: "Vérifiez les champs signalés.",
  rate_limited: "Trop de modifications en peu de temps, réessayez dans quelques minutes.",
  not_found: "Une erreur est survenue, réessayez.",
  unexpected: "Une erreur est survenue, réessayez.",
};

const HTTPS_URL_MESSAGE = `Saisissez une adresse complète commençant par https:// (${HTTPS_URL_MAX_LENGTH} caractères au plus).`;

/** Messages per field; the submitted value is never echoed. */
const PROFILE_FIELD_MESSAGES: Readonly<Record<TextFieldName, string>> = {
  displayName: `Indiquez un nom de 1 à ${PROFILE_TEXT_MAX_LENGTH.displayName} caractères, sans caractère invisible.`,
  jobTitle: `Poste sur une seule ligne, ${PROFILE_TEXT_MAX_LENGTH.jobTitle} caractères au plus.`,
  company: `Entreprise sur une seule ligne, ${PROFILE_TEXT_MAX_LENGTH.company} caractères au plus.`,
  bio: `Bio de ${PROFILE_TEXT_MAX_LENGTH.bio} caractères au plus, sans caractère invisible.`,
  contactEmail: "Saisissez une adresse e-mail valide.",
  phone: "Saisissez un numéro de téléphone valide : chiffres, espaces, « + » initial, points, tirets ou parenthèses.",
  websiteUrl: HTTPS_URL_MESSAGE,
};

export type LinkFieldName = "platform" | "url" | "label";

const LINK_FIELD_MESSAGES: Readonly<Record<LinkFieldName, string>> = {
  platform: "Choisissez une plateforme dans la liste.",
  url: HTTPS_URL_MESSAGE,
  label: `Libellé de ${LINK_LABEL_MAX_LENGTH} caractères au plus, sans caractère invisible.`,
};

const HOST_MISMATCH_MESSAGE = "L’adresse doit commencer par https:// et appartenir à la plateforme choisie.";
const LINK_LIST_MESSAGE = `${MAX_LINKS} liens au plus, chacun une seule fois.`;

/** Field the server's error code points to (`parseLink` codes); anything else lands on the URL. */
const LINK_ERROR_FIELDS: Readonly<Record<string, LinkFieldName>> = {
  invalid_platform: "platform",
  invalid_url: "url",
  host_mismatch: "url",
  invalid_label: "label",
};

export type FieldErrors = {
  profile: Partial<Record<TextFieldName, string>>;
  /** By link `key`. */
  links: Partial<Record<string, Partial<Record<LinkFieldName, string>>>>;
  list: string | null;
};

export const NO_FIELD_ERRORS: FieldErrors = { profile: {}, links: {}, list: null };

const LINK_PATH = /^links\.(\d+)(?:\.(platform|url|label))?/;

/**
 * French messages from the action's `fields` (path → error code or Zod text). `sentLinkKeys`: keys of the links sent,
 * in order, to attach `links.{position}` errors to their row.
 */
export function toFieldErrors(fields: Readonly<Record<string, string>> | undefined, sentLinkKeys: readonly string[]): FieldErrors {
  const errors: FieldErrors = { profile: {}, links: {}, list: null };
  for (const [path, code] of Object.entries(fields ?? {})) {
    if (isTextField(path)) {
      errors.profile[path] = PROFILE_FIELD_MESSAGES[path];
      continue;
    }
    const link = LINK_PATH.exec(path);
    if (link === null) {
      if (path.startsWith("links")) {
        errors.list = LINK_LIST_MESSAGE;
      }
      continue;
    }
    const key = sentLinkKeys[Number(link[1])];
    if (key === undefined) {
      errors.list = LINK_LIST_MESSAGE;
      continue;
    }
    const field = (link[2] as LinkFieldName | undefined) ?? LINK_ERROR_FIELDS[code] ?? "url";
    errors.links[key] = {
      ...errors.links[key],
      [field]: code === "host_mismatch" ? HOST_MISMATCH_MESSAGE : LINK_FIELD_MESSAGES[field],
    };
  }
  return errors;
}

function isTextField(path: string): path is TextFieldName {
  return Object.hasOwn(PROFILE_FIELD_MESSAGES, path);
}
