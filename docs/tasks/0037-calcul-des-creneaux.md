# 0037 — Calcul des créneaux

- Statut : done
- Agent : scheduling ; test-engineer
- Phase : 5
- ADR liées : 0005, 0016 ; fiche 0036

## Objectif
Une fonction pure du domaine calcule les créneaux réservables d'un type de rendez-vous à partir des disponibilités, des exceptions et des occupations, dans le fuseau du profil, et les restitue en instants UTC.

## Périmètre de fichiers
- scheduling : `src/domain/booking/` (créneaux, value objects `TimeZone`, `TimeRange`), port `Clock` existant.
- test-engineer : tests unitaires (dont propriétés).
- Interdit : tout le reste.

## Décisions (ADR 0016)
1. Entrées : type (durée, tampon, délai minimal), règles hebdomadaires (fuseau du profil), exceptions `busy` / `extra`, occupations (réservations confirmées + leur tampon), maintenant (horloge injectée), plage demandée (≤ 62 jours).
2. Pas = durée du type ; créneaux alignés sur le début de chaque plage de disponibilité ; tampon après chaque rendez-vous (un créneau dont la fin + tampon chevauche une occupation est exclu) ; délai minimal ; horizon 60 jours.
3. Fuseaux : conversions par l'API `Intl` / `Temporal` si disponible dans la version Node retenue (sinon alternative sans dépendance, à soumettre) ; ~~heure inexistante : créneau omis ; heure ambiguë : première occurrence~~ (amendé au point 6).
4. Même règle que la base (0036) : la fonction SQL de réservation reste l'autorité ; ce calcul ne sert qu'à l'affichage. Les deux sont testés sur les mêmes cas.

6. *Orchestrateur (18/11/2026), vérifié sur PostgreSQL local* : la conversion suit `timestamp at time zone` (autorité SQL) — heure inexistante → décalage d'avant le saut (`2027-03-28 02:30` Paris → `01:30Z`), heure ambiguë → **seconde occurrence** (`2027-10-31 02:30` Paris → `01:30Z`), soit `Temporal` `disambiguation: "later"` ; aucun créneau n'est omis, la borne de règle glisse.
5. *Orchestrateur (18/11/2026)* : Node 26 (`.node-version`, `engines`) fournit `Temporal` en natif → conversions de fuseau par `Temporal` (`ZonedDateTime`, `disambiguation: "compatible"` à confronter au comportement PostgreSQL de `timestamp at time zone`), aucune dépendance.
7. *Orchestrateur, après revue et audit (18/11/2026)* :
   - **Coût borné (audit MOYEN)** : fenêtres `extra` découpées à la plage demandée et débuts dédoublonnés avant l'alignement ; arrêt au-delà d'un plafond de candidats (contrat à fixer par les tests) ; test de performance du cas extrême (200 `extra` de 62 jours qui se chevauchent, type de 5 min) sous un budget de temps.
   - **Un seul jeu de types** : `slots.ts` consomme `Weekday` et `AvailabilityRule` de `availability.ts` (plus de `IsoWeekday` / `SlotRule`) ; constante `END_OF_DAY` (« 24:00 ») exportée par le domaine et réutilisée (`availability.ts`, `time-zone.ts`, `ui/features/booking/weekly-rules.ts`).
   - **29 cas partagés sans pendant SQL** (`sql: null` dans `tests/builders/booking-slot-cases.ts`) : périmètre étendu à `supabase/tests/` pour test-engineer, ajoutés à `carnet_bookings_book_slot.test.sql`.

## Notes héritées de 0036 (revue, 18/11/2026)
- Délai minimal : `start >= now + min_notice` (borne incluse) ; horizon : `start <= now + 1440 h` (borne incluse, rien sur la fin).
- Jour local = celui de `start` dans le fuseau du profil ; une règle peut finir à `24:00`.
- Pas compté en **durée réelle** (epoch) depuis l'instant de début de la règle ou de l'exception `extra`, pas en heure murale (créneaux de 45 min un jour de DST : heures non rondes après le saut).
- Chaque créneau tient entièrement dans **une** fenêtre (ne pas fusionner des règles contiguës).
- Tampon : peut dépasser la fin de la règle, jamais entrer dans une `busy` ; contrôle `[s, e + tampon_existant)` contre `[début, fin + tampon_nouveau)` ; le tampon des réservations existantes est le tampon **actuel** du type.
- Heure de règle dans un trou ou un recouvrement DST : reproduire la conversion PostgreSQL (`timestamp at time zone`) et la tester sur les mêmes cas que `carnet_bookings_book_slot.test.sql`.

## Critères d'acceptation
1. Cas DST Europe/Paris (mars et octobre), fuseau sans DST, fuseau à décalage non entier (ex. `Asia/Kolkata`).
2. Tampon, délai minimal, horizon, exceptions `busy` et `extra`, plages adjacentes.
3. Fonction pure, déterministe, sans dépendance à Next.js ni Supabase.

## Règles applicables
`docs/rules/solid-dry.md`, `docs/rules/testing.md`

## Hors périmètre
Lecture des données (0039), interface (0039).

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `pnpm check` vert
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (18/11/2026) : `slots.test.ts`, `time-zone.test.ts`, `time-range.test.ts` ; table de cas partagée `tests/builders/booking-slot-cases.ts` (99 cas, tous reproduits en pgTAP : 28 ajoutés à `carnet_bookings_book_slot.test.sql`, aucune divergence TS/SQL) ; 120 requêtes aléatoires comparées à une transcription de `assert_bookable_slot` ; cas extrême de coût sous 1 s.
- implémentation (18/11/2026) : scheduling : `time-zone.ts` (`parseTimeZone`, `wallClockToInstant` `disambiguation: "later"` vérifié sur PostgreSQL, `END_OF_DAY`), `time-range.ts`, `slots.ts` (`computeSlots`, nanosecondes `bigint`, `extra` découpées et fusionnées par classe d'alignement, `MAX_SLOT_CANDIDATES = 20 000` → `too_many_slots`) ; `Temporal` natif, aucune dépendance.
- reviewer (18/11/2026) : 1er passage BLOQUANT (commun avec 0038) → point 7 ; 2e passage OK ; suggestion : préciser que 17 856 est un maximum par classe d'alignement.
- security-auditor (18/11/2026) : 1er passage MOYEN (coût) → point 7 ; 2e passage OK ; FAIBLE `busy.some` O(N × B) reporté en 0039. Vérif orchestrateur : check 3221, pgTAP 3053, intégration 268, build, E2E 448/448.
