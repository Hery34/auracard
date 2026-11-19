import type { ExceptionKind, RuleIssueReason, Weekday } from "@/domain/booking/availability";
import { MAX_AVAILABILITY_RULES, MAX_UPCOMING_EXCEPTIONS, MIN_RULE_MINUTES } from "@/domain/booking/availability";
import {
  EVENT_TYPE_BOUNDS,
  EVENT_TYPE_TITLE_MAX_LENGTH,
  LOCATION_TEXT_MAX_LENGTH,
  MAX_EVENT_TYPES,
  type EventTypeField,
  type LocationKind,
} from "@/domain/booking/event-type";
import type { BookingSettingsActionError } from "@/server/booking/actions";

/** Decision 2 of 0038 (ADR 0005). */
export const PHASE_1_CALENDAR_NOTICE = "En phase 1, votre agenda (Google, Outlook) n’est pas lu : tenez vos disponibilités à jour.";

export const SAVED_MESSAGE = "Modifications enregistrées.";
export const NO_EVENT_TYPES_MESSAGE = "Aucun type de rendez-vous pour l’instant.";
export const NO_EXCEPTIONS_MESSAGE = "Aucune absence ni ouverture ponctuelle à venir.";
export const MIDNIGHT_END_HINT = "Pour finir à minuit, saisissez 00:00 comme fin.";
export const DELETE_EVENT_TYPE_CONFIRMATION = "Le type disparaît de votre page publique. Cette action ne peut pas être annulée.";

/** Announced by `role="alert"` next to the form; `limit_reached` is worded per section (`LIMIT_REACHED_MESSAGES`). */
export const BOOKING_SETTINGS_ERROR_MESSAGES: Readonly<Record<BookingSettingsActionError, string>> = {
  invalid_input: "Vérifiez les champs signalés.",
  not_found: "Cet élément n’existe plus. Rechargez la page.",
  rate_limited: "Trop de modifications en peu de temps, réessayez dans quelques minutes.",
  limit_reached: "Limite atteinte.",
  has_bookings: "Ce type a des réservations et ne peut pas être supprimé : désactivez-le.",
  overlap: "Des plages se chevauchent.",
  conflict: "Vos réglages ont changé entre-temps. Rechargez la page.",
  invalid_range: "La fin doit être postérieure au début.",
  already_ended: "Cette période est déjà passée.",
  unexpected: "Une erreur est survenue, réessayez.",
};

export const LIMIT_REACHED_MESSAGES: Readonly<{ eventTypes: string; rules: string; exceptions: string }> = {
  eventTypes: `Vous avez atteint la limite de ${MAX_EVENT_TYPES} types de rendez-vous.`,
  rules: `Au plus ${MAX_AVAILABILITY_RULES} plages par semaine.`,
  exceptions: `Au plus ${MAX_UPCOMING_EXCEPTIONS} absences et ouvertures ponctuelles à venir.`,
};

export const RULE_ISSUE_MESSAGES: Readonly<Record<RuleIssueReason, string>> = {
  invalid_weekday: "Jour invalide.",
  invalid_time: "Saisissez une heure de début et une heure de fin.",
  invalid_order: "La fin doit être postérieure au début.",
  too_short: `Une plage dure au moins ${MIN_RULE_MINUTES} min.`,
  overlap: "Cette plage en chevauche une autre du même jour.",
};

export const WEEKDAY_LABELS: Readonly<Record<Weekday, string>> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
  7: "Dimanche",
};

export const LOCATION_KIND_LABELS: Readonly<Record<LocationKind, string>> = {
  in_person: "En personne",
  phone: "Téléphone",
  video: "Visio",
};

export const EXCEPTION_KIND_LABELS: Readonly<Record<ExceptionKind, string>> = {
  busy: "Absence",
  extra: "Ouverture ponctuelle",
};

const { durationMin, bufferMin, minNoticeMin } = EVENT_TYPE_BOUNDS;

export const EVENT_TYPE_FIELD_ERROR_MESSAGES: Readonly<Record<EventTypeField, string>> = {
  title: `Saisissez un titre d’une ligne, de 1 à ${EVENT_TYPE_TITLE_MAX_LENGTH} caractères.`,
  durationMin: `Saisissez une durée entière de ${durationMin.min} à ${durationMin.max} minutes.`,
  bufferMin: `Saisissez un tampon entier de ${bufferMin.min} à ${bufferMin.max} minutes.`,
  minNoticeMin: `Saisissez un délai entier de ${minNoticeMin.min} à ${minNoticeMin.max} minutes.`,
  locationKind: "Choisissez un lieu.",
  locationText: `Adresse ou lien obligatoire en personne et en visio, une ligne d’au plus ${LOCATION_TEXT_MAX_LENGTH} caractères.`,
};

export const TIME_ZONE_FIELD_ERROR_MESSAGE = "Choisissez un fuseau de la liste.";

export const EXCEPTION_FIELD_ERROR_MESSAGES: Readonly<Record<"kind" | "start" | "end", string>> = {
  kind: "Choisissez une nature.",
  start: "Saisissez une date et une heure de début.",
  end: "Saisissez une date et une heure de fin.",
};
