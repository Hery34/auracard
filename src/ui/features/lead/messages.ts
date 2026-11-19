import { LEAD_TEXT_MAX_LENGTH, type LeadInvalidField } from "@/domain/lead/lead";
import type { CaptureLeadActionError, DeleteLeadActionError } from "@/server/actions/lead";

const UNEXPECTED = "Une erreur est survenue, réessayez.";

export const OPEN_LEAD_FORM_LABEL = "Laisser mes coordonnées";
export const LEAD_SENT_MESSAGE = "Message envoyé. Merci, vos coordonnées ont bien été transmises.";

/** Announced by `role="alert"` next to the form. */
export const CAPTURE_LEAD_ERROR_MESSAGES: Readonly<Record<CaptureLeadActionError, string>> = {
  invalid_input: "Vérifiez les champs signalés.",
  not_found: "Ce profil n’accepte pas de messages.",
  challenge_failed: "La vérification anti-robot a échoué. Patientez quelques secondes, puis renvoyez le formulaire.",
  challenge_unavailable: "La vérification anti-robot est momentanément indisponible, réessayez dans quelques minutes.",
  rate_limited: "Trop de messages envoyés en peu de temps, réessayez plus tard.",
  unexpected: UNEXPECTED,
};

/** Announced next to each field (`aria-describedby`); the typed value is never echoed. */
export const LEAD_FIELD_ERROR_MESSAGES: Readonly<Record<LeadInvalidField, string>> = {
  name: `Indiquez votre nom, ${LEAD_TEXT_MAX_LENGTH.name} caractères au plus, sans caractère invisible.`,
  email: `Saisissez une adresse e-mail valide (${LEAD_TEXT_MAX_LENGTH.email} caractères au plus).`,
  message: `Écrivez un message de ${LEAD_TEXT_MAX_LENGTH.message} caractères au plus, sans caractère invisible.`,
  consent: "Cochez la case pour accepter la transmission de vos coordonnées.",
  idempotencyKey: "Le formulaire a expiré : rechargez la page, puis renvoyez-le.",
};

export function leadPrivacyNotice(ownerName: string): string {
  return (
    `Vos nom, adresse e-mail et message servent uniquement à transmettre vos coordonnées à ${ownerName}, ` +
    `seul destinataire. Ils sont conservés 12 mois au plus, puis supprimés. ` +
    `La vérification anti-robot est assurée par Cloudflare ; l’e-mail qui prévient ${ownerName} est envoyé par Infomaniak. ` +
    `Vous pouvez demander l’accès à vos coordonnées, leur effacement ou vous opposer à leur traitement auprès de ${ownerName}. ` +
    `Cloudflare peut traiter des données techniques hors de l’Union européenne. ` +
    `Base légale : votre consentement, que vous pouvez retirer à tout moment auprès de ${ownerName}. ` +
    `Vous pouvez introduire une réclamation auprès de la CNIL.`
  );
}

export function leadConsentLabel(ownerName: string): string {
  return `J’accepte que mes coordonnées et mon message soient transmis à ${ownerName}.`;
}

export const NO_LEADS_MESSAGE = "Aucun message pour le moment.";
export const OLDER_LEADS_LABEL = "Messages plus anciens";
export const DELETE_LEAD_CONFIRMATION_MESSAGE = "Le message sera supprimé définitivement.";

export const DELETE_LEAD_ERROR_MESSAGES: Readonly<Record<DeleteLeadActionError, string>> = {
  invalid_input: UNEXPECTED,
  not_found: "Ce message a déjà été supprimé.",
  rate_limited: "Trop de suppressions en peu de temps, réessayez dans quelques minutes.",
  unexpected: UNEXPECTED,
};
