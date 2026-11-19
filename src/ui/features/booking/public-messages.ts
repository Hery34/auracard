import { BOOKING_TEXT_MAX_LENGTH, type BookingInvalidField } from "@/domain/booking/booking";
import type { BookSlotActionError, ListSlotsActionResult } from "@/server/booking/public-actions";

type ListSlotsActionError = Extract<ListSlotsActionResult, { status: "error" }>["error"];

const UNEXPECTED = "Une erreur est survenue, réessayez.";

export const BOOK_LINK_LABEL = "Prendre rendez-vous";
export const BOOKING_SUBMIT_LABEL = "Confirmer le rendez-vous";
export const BOOKING_CONFIRMED_MESSAGE = "Rendez-vous confirmé.";
export const CANCELLATION_REMINDER =
  "Un e-mail de confirmation vous est envoyé : il contient le lien pour annuler le rendez-vous si besoin.";
export const ADD_TO_CALENDAR_LABEL = "Ajouter à mon agenda";
export const NO_SLOT_THIS_WEEK = "Aucun créneau disponible cette semaine.";
export const LOADING_SLOTS = "Chargement des créneaux…";
export const BROWSER_TIME_ZONE_NOTICE = "Horaires affichés dans votre fuseau horaire";

export function ownerTimeZoneNotice(ownerName: string, timeZone: string): string {
  return `Le fuseau horaire de ${ownerName} est ${timeZone}.`;
}

/** Announced by `role="alert"`; never a submitted value. */
export const BOOK_SLOT_ERROR_MESSAGES: Readonly<Record<BookSlotActionError, string>> = {
  invalid_input: "Vérifiez les champs signalés.",
  not_found: "Ce rendez-vous n’est plus proposé. Rechargez la page.",
  challenge_failed: "La vérification anti-robot a échoué. Patientez quelques secondes, puis confirmez à nouveau.",
  challenge_unavailable: "La vérification anti-robot est momentanément indisponible, réessayez dans quelques minutes.",
  rate_limited: "Trop de réservations en peu de temps, réessayez plus tard.",
  slot_taken: "Ce créneau a déjà été pris. Choisissez un autre créneau.",
  slot_unavailable: "Ce créneau n’est plus disponible. Choisissez un autre créneau.",
  unexpected: UNEXPECTED,
};

/** Errors of the slot list, announced by `role="alert"`. */
export const LIST_SLOTS_ERROR_MESSAGES: Readonly<Record<ListSlotsActionError, string>> = {
  invalid_input: UNEXPECTED,
  invalid_range: "Cette semaine ne peut pas être affichée.",
  not_found: "Ce rendez-vous n’est plus proposé. Rechargez la page.",
  rate_limited: "Trop de demandes en peu de temps, réessayez plus tard.",
  too_many_slots: "Trop de créneaux à afficher pour cette semaine. Contactez directement la personne.",
  unexpected: UNEXPECTED,
};

/** Announced next to each field (`aria-describedby`); the typed value is never echoed. */
export const BOOKING_FIELD_ERROR_MESSAGES: Readonly<Record<BookingInvalidField, string>> = {
  eventTypeId: "Choisissez un type de rendez-vous.",
  start: "Choisissez un créneau.",
  name: `Indiquez votre nom, ${BOOKING_TEXT_MAX_LENGTH.name} caractères au plus, sans caractère invisible.`,
  email: `Saisissez une adresse e-mail valide (${BOOKING_TEXT_MAX_LENGTH.email} caractères au plus).`,
  phone: `Saisissez un numéro de téléphone valide (${BOOKING_TEXT_MAX_LENGTH.phone} caractères au plus) : il est nécessaire pour ce rendez-vous.`,
  message: `Écrivez un message de ${BOOKING_TEXT_MAX_LENGTH.message} caractères au plus, sans caractère invisible.`,
  consent: "Cochez la case pour accepter la transmission de vos coordonnées.",
  idempotencyKey: "Le formulaire a expiré : rechargez la page, puis confirmez à nouveau.",
};

export function bookingPrivacyNotice(ownerName: string): string {
  return (
    `Vos nom, adresse e-mail, téléphone et message servent uniquement à organiser ce rendez-vous avec ${ownerName}, ` +
    `seul destinataire. Ils sont conservés jusqu’à 12 mois après la date du rendez-vous, puis supprimés. ` +
    `La vérification anti-robot est assurée par Cloudflare ; les e-mails de confirmation sont envoyés par Infomaniak. ` +
    `Vous pouvez demander l’accès à vos coordonnées, leur effacement ou vous opposer à leur traitement auprès de ${ownerName}. ` +
    `Cloudflare peut traiter des données techniques hors de l’Union européenne. ` +
    `Base légale : votre consentement, que vous pouvez retirer à tout moment auprès de ${ownerName}. ` +
    `Vous pouvez introduire une réclamation auprès de la CNIL.`
  );
}

export function bookingConsentLabel(ownerName: string): string {
  return `J’accepte que mes coordonnées et mon message soient transmis à ${ownerName} pour ce rendez-vous.`;
}
