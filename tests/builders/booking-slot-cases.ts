import type { AvailabilityRule } from "@/domain/booking/availability";
import type { SlotEventType } from "@/domain/booking/slots";
import type { TimeRange } from "@/domain/booking/time-range";

import { aSlotEventType, bookingBusy, range, rule, rulesOn, T_MAR, T_OCT } from "./booking-slots";

/**
 * Fiche 0037, décision 4 — table de cas partagée avec supabase/tests/carnet_bookings_book_slot.test.sql.
 *
 * Mêmes profils, types, règles, exceptions et horloges que les fixtures pgTAP (personas A/PA, B/PB, W/PW).
 * `sql` : description du test pgTAP reproduit (lives_ok → bookable, throws_ok CN001/CN002 → non bookable). Les cas
 * propres à la fiche 0037 (profils PK, PE, PD, PF, PJ ; PA7, copie des règles de PA, pour e7) y ont été ajoutés au
 * point 7 de la fiche.
 * `existing` : réservations confirmées présentes à ce moment du scénario pgTAP qui comptent pour le verdict, déjà
 * sous la forme de get_public_busy_ranges ([début, fin + tampon actuel du type)).
 */

export type SlotProfile = {
  readonly timeZone: string;
  readonly rules: readonly AvailabilityRule[];
  readonly extra: readonly TimeRange[];
  /** Exceptions busy du profil. */
  readonly busy: readonly TimeRange[];
};

export type SlotCase = {
  readonly name: string;
  readonly sql: string;
  readonly profile: SlotProfile;
  readonly eventType: SlotEventType;
  readonly now: string;
  readonly start: string;
  readonly existing: readonly TimeRange[];
  readonly bookable: boolean;
};

// ---------------------------------------------------------------------------
// Fixtures de carnet_bookings_book_slot.test.sql
// ---------------------------------------------------------------------------
export const E0 = aSlotEventType({ durationMin: 30, bufferMin: 30, minNoticeMin: 120 });
export const E1 = aSlotEventType({ durationMin: 60, bufferMin: 0, minNoticeMin: 1440 });
export const E3 = aSlotEventType({ durationMin: 30, bufferMin: 0, minNoticeMin: 0 });
export const E7 = aSlotEventType({ durationMin: 45, bufferMin: 0, minNoticeMin: 0 });
export const E4 = aSlotEventType({ durationMin: 60, bufferMin: 0, minNoticeMin: 0 });
export const E6 = aSlotEventType({ durationMin: 30, bufferMin: 0, minNoticeMin: 120 });

/** PA (ana-0036b), Europe/Paris : lun–ven 09–12 et 14–18, dimanche 01–04 et 09–12. */
export const PA: SlotProfile = {
  timeZone: "Europe/Paris",
  rules: [...rulesOn([1, 2, 3, 4, 5], ["09:00", "12:00"], ["14:00", "18:00"]), rule(7, "01:00", "04:00"), rule(7, "09:00", "12:00")],
  extra: [range("2027-03-06T09:00:00Z", "2027-03-06T10:30:00Z")],
  busy: [range("2027-03-05T08:15:00Z", "2027-03-05T08:45:00Z"), range("2027-03-05T14:00:00Z", "2027-03-05T15:00:00Z")],
};

/** PB (ben-0036b), Asia/Tokyo (sans DST) : lundi 06–08 et 09–17. */
export const PB: SlotProfile = {
  timeZone: "Asia/Tokyo",
  rules: [rule(1, "06:00", "08:00"), rule(1, "09:00", "17:00")],
  extra: [],
  busy: [],
};

/** Horloge fixe des cas de PW (pgTAP : date_trunc('minute', now())). */
export const W_NOW = "2027-03-01T12:00:00Z";

/** PW (wil-0036b), sans règle : une exception extra de now − 1 h à now + 8 h. */
export const PW: SlotProfile = {
  timeZone: "Europe/Paris",
  rules: [],
  extra: [range("2027-03-01T11:00:00Z", "2027-03-01T20:00:00Z")],
  busy: [],
};

// ---------------------------------------------------------------------------
// Profils propres à la fiche 0037 (bloc « Fiche 0037, point 7 » du fichier pgTAP)
// ---------------------------------------------------------------------------
/** Asia/Kolkata (UTC+05:30, décalage non entier) : lundi 00–02 et 09–12. */
export const PK: SlotProfile = {
  timeZone: "Asia/Kolkata",
  rules: [rule(1, "00:00", "02:00"), rule(1, "09:00", "12:00")],
  extra: [],
  busy: [],
};

/** Europe/Paris, règle finissant à 24:00 : samedi 22:00–24:00, rien le dimanche. */
export const PE: SlotProfile = {
  timeZone: "Europe/Paris",
  rules: [rule(6, "22:00", "24:00")],
  extra: [],
  busy: [],
};

/** Europe/Paris, début de règle dans le trou (28/03) ou le recouvrement (31/10) : dimanche 02:30–05:00. */
export const PD: SlotProfile = {
  timeZone: "Europe/Paris",
  rules: [rule(7, "02:30", "05:00")],
  extra: [],
  busy: [],
};

/** Europe/Paris, fin de règle dans le trou ou le recouvrement : dimanche 00:00–02:30. */
export const PF: SlotProfile = {
  timeZone: "Europe/Paris",
  rules: [rule(7, "00:00", "02:30")],
  extra: [],
  busy: [],
};

/** Europe/Paris, plages adjacentes : lundi 09:00–10:00 et 10:00–11:30, extra contiguë lundi 8 mars 11:30–12:30. */
export const PJ: SlotProfile = {
  timeZone: "Europe/Paris",
  rules: [rule(1, "09:00", "10:00"), rule(1, "10:00", "11:30")],
  extra: [range("2027-03-08T10:30:00Z", "2027-03-08T11:30:00Z")],
  busy: [],
};

const B1 = bookingBusy("2027-03-03T08:00:00Z", 30, 30);
const B3 = bookingBusy("2027-03-04T10:00:00Z", 60, 0);
const B8 = bookingBusy("2027-03-06T09:00:00Z", 30, 30);
const M4 = bookingBusy("2027-03-28T00:00:00Z", 60, 0);
const O5 = bookingBusy("2027-10-31T00:00:00Z", 60, 0);
const W1 = bookingBusy("2027-03-01T15:00:00Z", 30, 0);

type CaseInput = Omit<SlotCase, "existing" | "sql"> & { existing?: readonly TimeRange[]; sql?: string };

function c(input: CaseInput): SlotCase {
  return { existing: [], sql: input.name, ...input };
}

export const SLOT_CASES: readonly SlotCase[] = [
  // Décision 7 / critère 1 — chevauchement, tampons compris
  c({ name: "décision 7 : réservation e0 mercredi 3 mars 09:00 (Paris, CET) acceptée", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-03T08:00:00Z", bookable: true }),
  c({ name: "critère 1 : même créneau que b1 avec une autre clé → CN001", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-03T08:00:00Z", existing: [B1], bookable: false }),
  c({ name: "critère 1 : début (aligné) pendant le tampon de 30 min de b1 → CN001", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-03T08:30:00Z", existing: [B1], bookable: false }),
  c({ name: "point 15 : 09:45 (Paris) n'est pas aligné sur le pas de 30 min depuis 09:00 → CN002 (et non CN001)", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-03T08:45:00Z", existing: [B1], bookable: false }),
  c({ name: "critère 1 : début exactement à la fin du tampon de b1 (10:00 Paris) accepté", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-03T09:00:00Z", existing: [B1], bookable: true }),
  c({ name: "décision 7 : e1 jeudi 4 mars 11:00–12:00 (Paris) accepté", profile: PA, eventType: E1, now: T_MAR, start: "2027-03-04T10:00:00Z", bookable: true }),
  c({ name: "critère 1 : le tampon du nouveau rendez-vous (09:30–10:30Z) empiète sur b3 → CN001", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-04T09:30:00Z", existing: [B3], bookable: false }),
  c({ name: "critère 1 : tampon du nouveau rendez-vous se terminant au début de b3 accepté", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-04T09:00:00Z", existing: [B3], bookable: true }),

  // Critère 3 — hors disponibilités
  c({ name: "critère 3 : mercredi 12:00 (Paris), entre deux plages → CN002", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-03T11:00:00Z", bookable: false }),
  c({ name: "critère 3 : e7 (45 min) à 17:45 (Paris), aligné depuis 14:00, déborde la plage 14–18 → CN002", profile: PA, eventType: E7, now: T_MAR, start: "2027-03-03T16:45:00Z", bookable: false }),
  c({ name: "point 15 : e7 à 17:15 (Paris) n'est pas un multiple de 45 min depuis 14:00 → CN002", profile: PA, eventType: E7, now: T_MAR, start: "2027-03-03T16:15:00Z", bookable: false }),
  c({ name: "point 15 : e7 à 17:00 (Paris) = 14:00 + 4 × 45 min, fin 17:45, accepté", profile: PA, eventType: E7, now: T_MAR, start: "2027-03-03T16:00:00Z", bookable: true }),
  c({ name: "critère 3 : 08:30 (Paris), avant la plage → CN002", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-03T07:30:00Z", bookable: false }),
  c({ name: "critère 3 : 11:30–12:00 (Paris) accepté, le tampon peut dépasser la fin de la plage", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-03T10:30:00Z", bookable: true }),
  c({ name: "critère 3 : samedi sans règle, hors exception extra → CN002", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-06T08:00:00Z", bookable: false }),
  c({ name: "critère 3 : rendez-vous dans l'exception busy → CN002", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-05T14:00:00Z", bookable: false }),
  c({ name: "critère 3 : rendez-vous aligné (09:00 Paris) à cheval sur le début de l'exception busy 08:15Z → CN002", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-05T08:00:00Z", bookable: false }),
  c({ name: "critère 3 : tampon du rendez-vous dans l'exception busy → CN002", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-05T13:30:00Z", bookable: false }),
  c({ name: "critère 3 : rendez-vous + tampon se terminant au début de l'exception busy accepté", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-05T13:00:00Z", bookable: true }),
  c({ name: "critère 3 : rendez-vous à la fin de l'exception busy accepté", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-05T15:00:00Z", bookable: true }),
  c({ name: "critère 3 : samedi dans l'exception extra accepté", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-06T09:00:00Z", bookable: true }),
  c({ name: "critère 3 : e1 aligné (10:00Z) débordant l'exception extra (fin 11:00Z > 10:30Z) → CN002", profile: PA, eventType: E1, now: T_MAR, start: "2027-03-06T10:00:00Z", existing: [B8], bookable: false }),
  c({ name: "point 15 : 09:45Z n'est pas aligné sur le pas de 30 min depuis le début de l'exception extra → CN002", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-06T09:45:00Z", existing: [B8], bookable: false }),
  c({ name: "critère 3 : rendez-vous se terminant à la fin de l'exception extra (et au bout du tampon de b8) accepté", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-06T10:00:00Z", existing: [B8], bookable: true }),

  // Critère 3 — délai minimal (borne incluse)
  c({ name: "critère 3 : créneau aligné à 119 min de l'horloge pour un délai de 120 → CN002", profile: PA, eventType: E0, now: "2027-03-01T12:01:00Z", start: "2027-03-01T14:00:00Z", bookable: false }),
  c({ name: "critère 3 : exactement 120 min avant le début accepté (borne incluse)", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-01T14:00:00Z", bookable: true }),
  c({ name: "critère 3 : 22 h avant le début pour un délai de 24 h → CN002", profile: PA, eventType: E1, now: T_MAR, start: "2027-03-02T10:00:00Z", bookable: false }),
  c({ name: "critère 3 : 25 h avant le début pour un délai de 24 h accepté", profile: PA, eventType: E1, now: T_MAR, start: "2027-03-02T13:00:00Z", bookable: true }),
  c({ name: "critère 3 : créneau passé (délai 0) → CN002", profile: PA, eventType: E3, now: T_MAR, start: "2027-03-01T08:00:00Z", bookable: false }),

  // Critère 3 et point 15 — horizon now + 1440 h (borne incluse)
  c({ name: "critère 3 : J+59 (jeudi 29 avril 09:00 CEST) accepté", profile: PA, eventType: E0, now: T_MAR, start: "2027-04-29T07:00:00Z", bookable: true }),
  c({ name: "critère 3 : J+60 avant l'heure de l'horloge (vendredi 30 avril 07:00Z) accepté", profile: PA, eventType: E0, now: T_MAR, start: "2027-04-30T07:00:00Z", bookable: true }),
  c({ name: "point 15 : début = p_now + 60 jours exactement (30 avril 12:00Z) accepté (borne incluse)", profile: PA, eventType: E0, now: T_MAR, start: "2027-04-30T12:00:00Z", bookable: true }),
  c({ name: "point 15 : début = p_now + 60 jours 30 min (créneau aligné) → CN002 (borne figée à l'instant, pas au jour)", profile: PA, eventType: E0, now: T_MAR, start: "2027-04-30T12:30:00Z", bookable: false }),
  c({ name: "critère 3 : J+60 après l'heure de l'horloge (30 avril 14:00Z) → CN002", profile: PA, eventType: E0, now: T_MAR, start: "2027-04-30T14:00:00Z", bookable: false }),
  c({ name: "critère 3 : J+63 (lundi 3 mai) → CN002", profile: PA, eventType: E0, now: T_MAR, start: "2027-05-03T07:00:00Z", bookable: false }),
  c({ name: "ADR 0016 §8 : type phone avec téléphone accepté", profile: PA, eventType: E3, now: T_MAR, start: "2027-03-08T08:00:00Z", bookable: true }),
  c({ name: "décision 5 : la même clé sur un autre profil (PB, lundi 09:00 à Tokyo) crée une réservation", profile: PB, eventType: E4, now: T_MAR, start: "2027-03-08T00:00:00Z", bookable: true }),

  // Critère 5 — le fuseau du visiteur est sans effet : la règle se lit dans le fuseau du profil
  c({ name: "critère 5 : session en America/New_York, lundi 8 mars 09:00Z = 10:00 à Paris (04:00 à New York) accepté", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-08T09:00:00Z", bookable: true }),
  c({ name: "critère 5 : session en America/New_York, 07:00Z = 08:00 à Paris refusé (règle lue dans le fuseau du profil)", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-08T07:00:00Z", bookable: false }),
  c({ name: "critère 5 : session en Asia/Tokyo, 01:00Z = 10:00 à Tokyo mais 02:00 à Paris → CN002", profile: PA, eventType: E0, now: T_MAR, start: "2027-03-08T01:00:00Z", bookable: false }),

  // Critère 5 — Europe/Paris, passage à l'heure d'été (dimanche 28 mars 2027)
  c({ name: "critère 5 : dimanche 21 mars 08:00Z = 09:00 CET accepté", profile: PA, eventType: E1, now: T_MAR, start: "2027-03-21T08:00:00Z", bookable: true }),
  c({ name: "critère 5 : dimanche 21 mars 07:00Z = 08:00 CET → CN002", profile: PA, eventType: E1, now: T_MAR, start: "2027-03-21T07:00:00Z", bookable: false }),
  c({ name: "critère 5 : dimanche 28 mars 07:00Z = 09:00 CEST accepté (un décalage fixe +1 le refuserait)", profile: PA, eventType: E1, now: T_MAR, start: "2027-03-28T07:00:00Z", bookable: true }),
  c({ name: "critère 5 : dimanche 28 mars 06:00Z = 08:00 CEST → CN002", profile: PA, eventType: E1, now: T_MAR, start: "2027-03-28T06:00:00Z", bookable: false }),
  c({ name: "critère 5 : dimanche 28 mars 10:00Z = 12:00–13:00 CEST → CN002 (un décalage fixe +1 l'accepterait)", profile: PA, eventType: E1, now: T_MAR, start: "2027-03-28T10:00:00Z", bookable: false }),
  c({ name: "critère 5 : dimanche 28 mars 09:00Z = 11:00–12:00 CEST accepté", profile: PA, eventType: E1, now: T_MAR, start: "2027-03-28T09:00:00Z", bookable: true }),
  c({ name: "critère 5 : 27 mars 23:30Z = dimanche 00:30 CET, avant la plage de nuit → CN002", profile: PA, eventType: E1, now: T_MAR, start: "2027-03-27T23:30:00Z", bookable: false }),
  c({ name: "critère 5 : 28 mars 00:00Z = 01:00 CET → fin 03:00 CEST, dans la plage de nuit, accepté", profile: PA, eventType: E1, now: T_MAR, start: "2027-03-28T00:00:00Z", bookable: true }),
  c({ name: "critère 5 : 28 mars 01:00Z = 03:00–04:00 CEST accepté", profile: PA, eventType: E1, now: T_MAR, start: "2027-03-28T01:00:00Z", existing: [M4], bookable: true }),
  c({ name: "critère 5 : 28 mars 02:00Z = 04:00 CEST, après la plage de nuit → CN002", profile: PA, eventType: E1, now: T_MAR, start: "2027-03-28T02:00:00Z", bookable: false }),

  // Critère 5 — Europe/Paris, retour à l'heure d'hiver (dimanche 31 octobre 2027)
  c({ name: "critère 5 : dimanche 24 octobre 07:00Z = 09:00 CEST accepté", profile: PA, eventType: E1, now: T_OCT, start: "2027-10-24T07:00:00Z", bookable: true }),
  c({ name: "critère 5 : dimanche 31 octobre 08:00Z = 09:00 CET accepté (un décalage fixe +2 le refuserait)", profile: PA, eventType: E1, now: T_OCT, start: "2027-10-31T08:00:00Z", bookable: true }),
  c({ name: "critère 5 : dimanche 31 octobre 07:00Z = 08:00 CET → CN002 (un décalage fixe +2 l'accepterait)", profile: PA, eventType: E1, now: T_OCT, start: "2027-10-31T07:00:00Z", bookable: false }),
  c({ name: "critère 5 : dimanche 31 octobre 10:00Z = 11:00–12:00 CET accepté", profile: PA, eventType: E1, now: T_OCT, start: "2027-10-31T10:00:00Z", bookable: true }),
  c({ name: "critère 5 : samedi 30 octobre 23:00Z = dimanche 01:00 CEST accepté (jour ISO lu dans le fuseau du profil)", profile: PA, eventType: E1, now: T_OCT, start: "2027-10-30T23:00:00Z", bookable: true }),
  c({ name: "critère 5 : 31 octobre 00:00Z = 02:00 CEST accepté", profile: PA, eventType: E1, now: T_OCT, start: "2027-10-31T00:00:00Z", bookable: true }),
  c({ name: "critère 5 : 31 octobre 01:00Z = 02:00 CET (seconde occurrence de 02:00) accepté, sans chevaucher o5", profile: PA, eventType: E1, now: T_OCT, start: "2027-10-31T01:00:00Z", existing: [O5], bookable: true }),
  c({ name: "critère 5 : 31 octobre 02:00Z = 03:00–04:00 CET accepté", profile: PA, eventType: E1, now: T_OCT, start: "2027-10-31T02:00:00Z", bookable: true }),
  c({ name: "critère 5 : 31 octobre 03:00Z = 04:00 CET, après la plage de nuit → CN002", profile: PA, eventType: E1, now: T_OCT, start: "2027-10-31T03:00:00Z", bookable: false }),
  c({ name: "critère 5 : 30 octobre 22:00Z = dimanche 00:00 CEST, avant la plage de nuit → CN002", profile: PA, eventType: E1, now: T_OCT, start: "2027-10-30T22:00:00Z", bookable: false }),

  // Critère 5 — fuseau sans DST (Asia/Tokyo)
  c({ name: "critère 5 : dimanche 28 mars 21:00Z = lundi 06:00 à Tokyo accepté (jour ISO du fuseau du profil)", profile: PB, eventType: E4, now: T_MAR, start: "2027-03-28T21:00:00Z", bookable: true }),
  c({ name: "critère 5 : 28 mars 20:00Z = lundi 05:00 à Tokyo → CN002", profile: PB, eventType: E4, now: T_MAR, start: "2027-03-28T20:00:00Z", bookable: false }),
  c({ name: "critère 5 : lundi 29 mars 21:00Z = mardi 06:00 à Tokyo → CN002", profile: PB, eventType: E4, now: T_MAR, start: "2027-03-29T21:00:00Z", bookable: false }),
  c({ name: "critère 5 : lundi 29 mars 00:00Z = 09:00 à Tokyo accepté (le DST européen de la veille est sans effet)", profile: PB, eventType: E4, now: T_MAR, start: "2027-03-29T00:00:00Z", bookable: true }),
  c({ name: "critère 5 : dimanche 31 octobre 21:00Z = lundi 1er novembre 06:00 à Tokyo accepté", profile: PB, eventType: E4, now: T_OCT, start: "2027-10-31T21:00:00Z", bookable: true }),
  c({ name: "critère 5 : lundi 1er novembre 07:00Z = 16:00–17:00 à Tokyo accepté", profile: PB, eventType: E4, now: T_OCT, start: "2027-11-01T07:00:00Z", bookable: true }),
  c({ name: "critère 5 : lundi 1er novembre 08:00Z = 17:00 à Tokyo → CN002", profile: PB, eventType: E4, now: T_OCT, start: "2027-11-01T08:00:00Z", bookable: false }),

  // Décision 7 — PW (extra autour de l'horloge, sans règle)
  c({ name: "décision 7 : service_role réserve par book_slot (now() + 3 h, dans l'exception extra)", profile: PW, eventType: E6, now: W_NOW, start: "2027-03-01T15:00:00Z", bookable: true }),
  c({ name: "décision 7 : book_slot applique le délai minimal avec now() (now() + 1 h pour 120 min → CN002)", profile: PW, eventType: E6, now: W_NOW, start: "2027-03-01T13:00:00Z", bookable: false }),
  c({ name: "critère 1 : book_slot refuse le même créneau avec une autre clé → CN001", profile: PW, eventType: E6, now: W_NOW, start: "2027-03-01T15:00:00Z", existing: [W1], bookable: false }),
  c({ name: "point 15 : book_slot refuse un début non aligné sur le pas depuis le début de l'extra (minute de now() − 1 h) → CN002", profile: PW, eventType: E6, now: W_NOW, start: "2027-03-01T15:15:00Z", existing: [W1], bookable: false }),

  // Fiche 0037, point 7 — bloc final de carnet_bookings_book_slot.test.sql
  c({ name: "0037 critère 1 : Asia/Kolkata lundi 8 mars 03:30Z = 09:00 IST accepté", profile: PK, eventType: E4, now: T_MAR, start: "2027-03-08T03:30:00Z", bookable: true }),
  c({ name: "0037 critère 1 : Asia/Kolkata 04:00Z = 09:30 IST, non aligné sur le pas de 60 min → refusé", profile: PK, eventType: E4, now: T_MAR, start: "2027-03-08T04:00:00Z", bookable: false }),
  c({ name: "0037 critère 1 : Asia/Kolkata 05:30Z = 11:00–12:00 IST accepté", profile: PK, eventType: E4, now: T_MAR, start: "2027-03-08T05:30:00Z", bookable: true }),
  c({ name: "0037 critère 1 : Asia/Kolkata 06:30Z = 12:00 IST, après la plage → refusé", profile: PK, eventType: E4, now: T_MAR, start: "2027-03-08T06:30:00Z", bookable: false }),
  c({ name: "0037 critère 1 : Asia/Kolkata dimanche 7 mars 18:30Z = lundi 00:00 IST accepté (jour ISO du profil)", profile: PK, eventType: E4, now: T_MAR, start: "2027-03-07T18:30:00Z", bookable: true }),
  c({ name: "0037 critère 1 : Asia/Kolkata 7 mars 20:30Z = lundi 02:00 IST, après la plage → refusé", profile: PK, eventType: E4, now: T_MAR, start: "2027-03-07T20:30:00Z", bookable: false }),
  c({ name: "0037 : règle 22:00–24:00, samedi 6 mars 22:00Z = 23:00–24:00 CET accepté", profile: PE, eventType: E4, now: T_MAR, start: "2027-03-06T22:00:00Z", bookable: true }),
  c({ name: "0037 : règle 22:00–24:00, samedi 6 mars 23:00Z = dimanche 00:00 CET → refusé", profile: PE, eventType: E4, now: T_MAR, start: "2027-03-06T23:00:00Z", bookable: false }),
  c({ name: "0037 : règle 22:00–24:00, samedi 30 octobre 21:00Z = 23:00–24:00 CEST accepté", profile: PE, eventType: E4, now: T_OCT, start: "2027-10-30T21:00:00Z", bookable: true }),
  c({ name: "0037 : règle 22:00–24:00, samedi 30 octobre 22:00Z = dimanche 00:00 CEST → refusé", profile: PE, eventType: E4, now: T_OCT, start: "2027-10-30T22:00:00Z", bookable: false }),
  c({ name: "0037 : e7 (45 min) 28 mars 00:45Z = 01:45 CET → 03:30 CEST accepté (pas en durée réelle)", profile: PA, eventType: E7, now: T_MAR, start: "2027-03-28T00:45:00Z", bookable: true }),
  c({ name: "0037 : e7 28 mars 01:30Z = 03:30 CEST, fin 04:15 CEST au-delà de la plage → refusé", profile: PA, eventType: E7, now: T_MAR, start: "2027-03-28T01:30:00Z", bookable: false }),
  c({ name: "0037 : e7 28 mars 01:00Z = 03:00 CEST (pas compté en heure murale) → refusé", profile: PA, eventType: E7, now: T_MAR, start: "2027-03-28T01:00:00Z", bookable: false }),
  c({ name: "0037 : e7 31 octobre 01:15Z = 02:15 CET (après le recouvrement) accepté", profile: PA, eventType: E7, now: T_OCT, start: "2027-10-31T01:15:00Z", bookable: true }),
  c({ name: "0037 : règle 02:30 dans le trou du 28 mars = 01:30Z (décalage d'avant le saut) : 01:30Z accepté", profile: PD, eventType: E3, now: T_MAR, start: "2027-03-28T01:30:00Z", bookable: true }),
  c({ name: "0037 : règle 02:30 dans le trou du 28 mars : 01:00Z (03:00 CEST) avant le début → refusé", profile: PD, eventType: E3, now: T_MAR, start: "2027-03-28T01:00:00Z", bookable: false }),
  c({ name: "0037 : règle 02:30 ambiguë le 31 octobre = 02:30 CET (01:30Z, comme PostgreSQL) : 00:30Z refusé", profile: PD, eventType: E3, now: T_OCT, start: "2027-10-31T00:30:00Z", bookable: false }),
  c({ name: "0037 : règle 02:30 ambiguë le 31 octobre : 01:30Z accepté", profile: PD, eventType: E3, now: T_OCT, start: "2027-10-31T01:30:00Z", bookable: true }),
  c({ name: "0037 : fin de règle 02:30 dans le trou du 28 mars = 01:30Z : 01:00Z accepté", profile: PF, eventType: E3, now: T_MAR, start: "2027-03-28T01:00:00Z", bookable: true }),
  c({ name: "0037 : fin de règle 02:30 dans le trou du 28 mars : 01:30Z → refusé", profile: PF, eventType: E3, now: T_MAR, start: "2027-03-28T01:30:00Z", bookable: false }),
  c({ name: "0037 : fin de règle 02:30 ambiguë le 31 octobre = 01:30Z (comme PostgreSQL) : 01:00Z accepté", profile: PF, eventType: E3, now: T_OCT, start: "2027-10-31T01:00:00Z", bookable: true }),
  c({ name: "0037 : fin de règle 02:30 ambiguë le 31 octobre : 01:30Z → refusé", profile: PF, eventType: E3, now: T_OCT, start: "2027-10-31T01:30:00Z", bookable: false }),
  c({ name: "0037 critère 2 : plages adjacentes 09–10 et 10–11:30, 45 min : 08:45Z (09:45 CET) à cheval → refusé", profile: PJ, eventType: E7, now: T_MAR, start: "2027-03-08T08:45:00Z", bookable: false }),
  c({ name: "0037 critère 2 : plages adjacentes : 09:00Z (10:00 CET, début de la seconde plage) accepté", profile: PJ, eventType: E7, now: T_MAR, start: "2027-03-08T09:00:00Z", bookable: true }),
  c({ name: "0037 critère 2 : plages adjacentes : 09:30Z aligné seulement si l'on fusionnait les plages → refusé", profile: PJ, eventType: E7, now: T_MAR, start: "2027-03-08T09:30:00Z", bookable: false }),
  c({ name: "0037 critère 2 : plages adjacentes : 09:45Z (10:45–11:30 CET) accepté", profile: PJ, eventType: E7, now: T_MAR, start: "2027-03-08T09:45:00Z", bookable: true }),
  c({ name: "0037 critère 2 : extra contiguë à la règle : 10:15Z à cheval sur la règle et l'extra → refusé", profile: PJ, eventType: E7, now: T_MAR, start: "2027-03-08T10:15:00Z", bookable: false }),
  c({ name: "0037 critère 2 : extra contiguë à la règle : 10:30Z (début de l'extra) accepté", profile: PJ, eventType: E7, now: T_MAR, start: "2027-03-08T10:30:00Z", bookable: true }),
];
