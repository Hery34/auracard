# 0038 — Paramétrage des rendez-vous par le propriétaire

- Statut : done
- Agent : scheduling (cas d'usage, dépôts, Server Actions) ; frontend (pages) ; test-engineer
- Phase : 5
- ADR liées : 0012, 0013, 0016 ; fiches 0020, 0036

## Objectif
Le propriétaire choisit son fuseau, crée ses types de rendez-vous (durée, tampon, délai minimal, lieu) et saisit ses disponibilités hebdomadaires, ses absences et ses ouvertures ponctuelles sur `/tableau-de-bord/rendez-vous/reglages`.

## Périmètre de fichiers
- scheduling : `src/domain/booking/`, `src/server/booking/` (cas d'usage, dépôts Supabase, Server Actions), `container.ts` (câblage).
- frontend : `src/app/(dashboard)/tableau-de-bord/rendez-vous/`, `src/ui/features/booking/`.
- test-engineer : unitaires, intégration, E2E.
- Interdit : tout le reste.

## Décisions (ADR 0016)
1. Écritures par le client utilisateur sous RLS (jamais `service_role`) ; autorisation vérifiée dans chaque Server Action ; mise à jour idempotente (remplacement de la liste des règles, comme les liens en 0016/0020).
2. Rappel visible : « En phase 1, votre agenda (Google, Outlook) n'est pas lu : tenez vos disponibilités à jour. » (ADR 0005).
3. Au plus 10 types ; un type désactivé disparaît de la page publique, ses réservations existantes restent.

4. *Hery (18/11/2026), après les tests* : exception déjà terminée (`upper(range) <= now()`) **refusée** à l'insertion et à la modification (23514), exception en cours acceptée ; purge quotidienne en complément des exceptions terminées depuis plus de 30 jours ; deux fonctions SQL `security invoker`, `execute` pour `authenticated` seul : `carnet.replace_availability_rules(p_profile_id uuid, p_rules jsonb)` (remplacement atomique) et `carnet.reorder_event_types(p_profile_id uuid, p_order uuid[])` (une instruction) — périmètre `supabase/` (db-architect) ajouté à la fiche.
5. *Orchestrateur (tactique)* : liste de fuseaux proposée = `Intl.supportedValuesOf('timeZone')` (noms hérités tels `Asia/Calcutta` inclus, acceptés par PostgreSQL ; un test d'intégration vérifie que chaque nom de la liste passe `is_valid_time_zone`) ; lieu : texte obligatoire pour `in_person` et `video`, facultatif pour `phone`, lien de visio non contraint au https ; création de type idempotente par identifiant généré côté client (pas de colonne `idempotency_key`, conforme à l'esprit de `idempotence.md`) ; heures d'exception converties comme PostgreSQL (`wallClockToInstant` de 0037) ; motif ESLint de frontière étendu à `src/server/booking/repositories/**` (backend).
6. *Après revue (bloquant) et audit (18/11/2026)* :
   - **Idempotence (bloquant)** : l'identifiant des créations (type, exception) est généré **par le Server Component** et passé au formulaire (champ caché `id`) ; après `saved`, `revalidatePath` fournit un nouvel identifiant ; jamais tiré dans le réducteur ; test de double soumission (un seul enregistrement).
   - **Hery (18/11/2026), amende la décision 17 de 0036** : les triggers de plafond (règles et exceptions) lèvent un SQLSTATE dédié **`CN004`** (« plafond atteint »), traduit par code et jamais par le message ; les autres refus restent 23514 (nouvelle migration, db-architect).
   - Côté règles, plus de 50 règles est refusé par l'action avant tout appel (`limit_reached`) ; schéma Zod `rules` borné (`.max(MAX_AVAILABILITY_RULES + 1)`).
   - **Fuseau** : le dépôt parse le fuseau stocké à la frontière (`TimeZone` ou `unexpected` journalisé) ; `parseAvailabilityException` prend un `TimeZone` (plus de `throw`) ; `parseSelectableTimeZone(name): TimeZone | null` combine la liste `Intl` et `parseTimeZone`.
   - ~~Idempotence des types et des exceptions gérée au même endroit (dépôt)~~ (suggestion non retenue : le rejeu des types reste dans le cas d'usage, figé par `event-types.test.ts` ; celui des exceptions dans le dépôt) ; commentaires corrigés (`delete-event-type.ts`, `actions.ts`) ; `DEFAULT_TIME_ZONE` retiré s'il reste inutilisé.
   - Reportés : déplacement de `FORBIDDEN_LABEL_CHARACTERS` dans `src/domain/shared/` (fiche technique ultérieure) ; type marqué `LocalTime` (suggestion).

## Notes héritées de 0036 (revue et audit, 18/11/2026)
- Positions de types 0 à 9 : chercher une position libre ; réordonnancement en une seule instruction (contrainte unique `deferrable initially immediate`).
- Un type ayant des réservations se désactive (FK `no action`, 23503 à traduire).
- Fuseau limité à `Intl.supportedValuesOf('timeZone')` (`pg_timezone_names` accepte des noms que `Intl` refuse).
- Erreurs à traduire : 23514 (bornes, plafonds de 50 règles / 200 exceptions, minutes), 23P01 (règles qui se chevauchent).
- *Reporté de l'audit 0036 (db-architect + test-engineer, dans cette fiche)* : exceptions déjà terminées ni plafonnées ni purgées → refuser l'insertion d'une exception terminée (`upper(range) <= now()`) **ou** les purger (tâche quotidienne existante, au-delà de N jours) ; tests pgTAP sous `authenticated` : écrire sur le profil plein d'autrui → 42501 (jamais 23514), plafond appliqué à un `update` qui ramène une exception passée dans le futur.

## Critères d'acceptation
1. Création, modification, désactivation et réordonnancement des types ; enregistrement des règles et exceptions ; relecture identique.
2. Un autre compte ne lit ni ne modifie rien.
3. Accessible (étiquettes, erreurs annoncées), mobile, contrastes AA.

## Règles applicables
`docs/rules/nextjs.md`, `docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`

## Hors périmètre
Réservation publique (0039), synchronisation d'agenda (phase 7).

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `pnpm check`, intégration, build, E2E verts
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (18/11/2026) : domaine, cas d'usage (10), actions (9), schémas, dépôt ; intégration `booking-settings.test.ts` ; E2E `booking-settings.spec.ts` 14 × 2 (dont double soumission) ; pgTAP `carnet_booking_settings_{audit,functions,jobs}` (42501 sans oracle, plafond sur `update`, refus des exceptions terminées, purge 30 j, `CN004`).
- implémentation (18/11/2026) : db-architect `20261119090000_create_booking_settings.sql` (refus des exceptions terminées, purge `pg_cron`, `replace_availability_rules`, `reorder_event_types`, plafonds en `CN004`) ; scheduling domaine `event-type` / `availability` / `time-zone-choice` / `ports`, `src/server/booking/` (cas d'usage, dépôts sur client de session, actions) ; backend ESLint (dépôts booking interdits à `src/app`/`src/ui`) ; frontend page `/tableau-de-bord/rendez-vous/reglages` (id des créations généré par le Server Component). Hery : `db reset` + rejeu.
- reviewer (18/11/2026) : 1er passage BLOQUANT (id tiré au premier envoi) → point 6 ; 2e passage OK ; suggestions reportées : brouillon de création perdu quand une autre action de la page revalide, `setTimeZone` typé `TimeZone`.
- security-auditor (18/11/2026) : 1er passage OK (FAIBLE borne Zod traité ; lien de visio reporté en 0039/0041) ; 2e passage OK. Vérif orchestrateur : check 3221, pgTAP 3053, intégration 268, build, E2E 448/448.
