# 0037 — Calcul des créneaux

- Statut : todo (après 0036)
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
3. Fuseaux : conversions par l'API `Intl` / `Temporal` si disponible dans la version Node retenue (sinon alternative sans dépendance, à soumettre) ; heure inexistante (passage à l'heure d'été) : créneau omis ; heure ambiguë (retour à l'heure d'hiver) : première occurrence.
4. Même règle que la base (0036) : la fonction SQL de réservation reste l'autorité ; ce calcul ne sert qu'à l'affichage. Les deux sont testés sur les mêmes cas.

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
- [ ] Tests écrits par test-engineer, échouant avant implémentation
- [ ] `pnpm check` vert
- [ ] reviewer : OK ou remarques non bloquantes traitées
- [ ] security-auditor : OK
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer : …
- implémentation : …
- reviewer : …
- security-auditor : …
