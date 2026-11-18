# 0036 — Schéma du module de rendez-vous

- Statut : done
- Agent : db-architect ; test-engineer (pgTAP)
- Phase : 5
- ADR liées : 0002, 0004, 0005, 0006, 0011, 0016 ; fiches 0005, 0028, 0031

## Objectif
La base porte les types de rendez-vous, les disponibilités, les exceptions et les réservations d'un profil, garantit l'absence de chevauchement et l'idempotence, et alimente l'outbox et les statistiques.

## Périmètre de fichiers
- Autorisé : `supabase/migrations/`, `supabase/tests/`, `src/server/infrastructure/supabase/database.types.ts` (régénération).
- Interdit : tout le reste.

## Décisions (ADR 0016 ; conception de l'orchestrateur soumise à Hery le 18/11/2026)
1. **`profiles.time_zone`** (`text`, IANA validé par `pg_timezone_names`, défaut `Europe/Paris`), modifiable par le propriétaire (droit `update` par colonne ajouté).
2. **`event_types`** : `profile_id`, `title` (texte simple borné), `duration_min` (5–480), `buffer_min` (0–240), `min_notice_min` (0–43 200, défaut 120), `location_kind` (`in_person` / `phone` / `video`), `location_text` (borné, facultatif), `is_active`, `position`. Au plus 10 types par profil.
3. **`availability_rules`** : `profile_id`, `weekday` (1–7, ISO), `start_time`, `end_time` (`start < end`), sans fuseau (celui du profil) ; pas de chevauchement de plages le même jour (contrainte ou contrôle).
4. **`availability_exceptions`** : `profile_id`, `range` (`tstzrange`, non vide, borné), `kind` (`busy` / `extra`).
5. **`bookings`** : `profile_id`, `event_type_id`, `range` (`tstzrange`), `status` (`confirmed` / `cancelled`), visiteur (`visitor_name`, `visitor_email`, `visitor_phone` facultatif, `message` facultatif), `consent_at` (heure serveur), `cancel_token_hash` (SHA-256), `idempotency_key` (unique par profil), `cancelled_at`, `cancelled_by` (`visitor` / `owner`), `rescheduled_from` (référence facultative), `created_at`. **Contrainte d'exclusion** `btree_gist` : pas de chevauchement des `range` confirmées d'un même profil (`create extension if not exists btree_gist with schema extensions`).
6. **RLS** : le propriétaire lit et gère ses `event_types`, `availability_*` ; il lit ses `bookings` (aucune écriture directe). Lecture publique des créneaux et des types actifs d'un profil publié **uniquement par fonctions** (`get_public_booking_page(slug)` : types actifs, fuseau ; `get_public_busy_ranges(slug, from, to)` : réservations confirmées et exceptions `busy` sans aucune donnée visiteur ; règles et exceptions `extra`), bornées (≤ 62 jours), renvoyant une seule valeur `jsonb` (règle « Limite de lignes PostgREST »).
7. **Écritures sensibles par fonctions `service_role`** (avenant ADR 0011) :
   - `book_slot(p_slug, p_event_type_id, p_start, visiteur…, p_idempotency_key, p_device_class)` : profil publié, type actif, durée imposée par le type, créneau dans l'horizon (60 j) et après le délai minimal, conforme aux disponibilités (règles du fuseau du profil, exceptions), insertion + `outbox` `booking.confirmed` + `analytics_events` `booking_confirmed` dans **la même transaction** ; rejeu même clé → même réservation ; chevauchement → erreur dédiée (`23P01` traduite) ; renvoie l'`id` et le jeton d'annulation en clair (une seule fois).
   - `cancel_booking_by_token(p_token)` et `reschedule_booking_by_token(p_token, p_start, p_idempotency_key)` : jeton comparé par hachage, délai minimal respecté, idempotents, outbox `booking.cancelled` / `booking.rescheduled` (l'ancienne réservation passe `cancelled`, la nouvelle porte `rescheduled_from`).
   - `cancel_own_booking(p_booking_id)` (client utilisateur, propriétaire, à tout moment) : outbox `booking.cancelled` (`cancelled_by = owner`).
8. **Rappels** : `pg_cron` toutes les 15 min écrit `booking.reminder` dans l'outbox pour les réservations confirmées qui commencent dans 24 h ± 15 min, créées plus de 24 h avant leur début, une seule fois par réservation (marqueur `reminder_queued_at`).
9. **Outbox** : types `booking.confirmed`, `booking.cancelled`, `booking.rescheduled`, `booking.reminder` ajoutés à la contrainte ; charge utile suffisante pour n8n (0041) sans relecture d'autres tables par n8n hors fonctions prévues. Le jeton d'annulation en clair n'apparaît que dans la charge utile des messages destinés au visiteur ; la purge de l'outbox (0031) l'efface.
10. **Statistiques** : métriques `booking_viewed`, `booking_started`, `booking_confirmed` ajoutées (`is_valid_analytics_metric`, agrégation 0028).
11. **Conservation** : purge `pg_cron` des réservations 12 mois après la fin du rendez-vous.
12. *Hery (18/11/2026)* : jeton d'annulation aléatoire, seul son hachage dans `bookings`, clair uniquement dans la charge utile outbox du message visiteur (effacée par la purge 0031) ; règles de créneaux en double — TypeScript pour l'affichage (0037), SQL autorité dans `book_slot` / `reschedule_booking_by_token` — testées sur des cas communs (mêmes jeux DST, tampon, délai, horizon).
14. *Hery (18/11/2026), après les tests* :
    - **Plusieurs jetons valides** : table `booking_tokens` (hachage SHA-256 unique, `booking_id`, `created_at`) remplace `bookings.cancel_token_hash` ; chaque message visiteur (`booking.confirmed`, `booking.rescheduled`, `booking.reminder`) porte un jeton neuf dans sa charge utile ; tous restent valides tant que la réservation est confirmée et à venir ; purgés avec la réservation.
    - **Lieu public** : `location_text` exposé par `get_public_booking_page` uniquement pour `location_kind = 'in_person'` ; pour `phone` et `video`, communiqué seulement dans les messages au visiteur.
15. *Orchestrateur (tactique, après les tests)* :
    - `claim_outbox` (0031) restreinte à `lead.created` (sinon le workflow des leads réclamerait les événements `booking.*`) ; nouvelle fonction `claim_booking_outbox(p_limit)` (`service_role`) renvoyant ce qu'il faut à n8n (type, réservation, type de RDV, lieu, fuseau du profil, propriétaire, visiteur, jeton de la charge utile), avec `complete_outbox` / `fail_outbox` inchangées.
    - Verrou transactionnel par profil (`pg_advisory_xact_lock`) dans `book_slot_at` et `reschedule_booking_by_token_at`, pour que le tampon soit garanti en concurrence (la contrainte d'exclusion ne couvre que `range`).
    - `get_booking_by_token(p_token)` (`service_role`) pour la page d'annulation et de report (0040) : réservation, type, lieu, fuseau, prénom du propriétaire, et si l'annulation ou le report sont encore possibles ; jeton inconnu ou réservation passée → null (sans oracle).
    - Début de créneau aligné sur le pas (durée du type) depuis le début de la règle ou de l'exception `extra`, sinon CN002 ; horizon = `now() + interval '60 days'` ; tampon autorisé au-delà de la fin d'une règle, jamais dans une exception `busy`.
    - Report refusé (CN002) si le type a été désactivé ; l'annulation reste possible.
    - Un type ayant des réservations n'est pas supprimable (`no action`) : l'interface 0038 propose de le désactiver.
    - Concurrence réelle (deux transactions) : test d'intégration à écrire en 0039.
16. *Orchestrateur, après la migration (18/11/2026)* : horizon `p_now + interval '1440 hours'` (60 × 24 h, indépendant du fuseau de session, identique au calcul TypeScript de 0037) ; correctif `location_text` nul intégré à la migration `20261118180000` (aucune migration de correctif tant que rien n'est déployé ; `db reset` local par Hery) ; report refusé si le profil n'est plus publié (P0002, comme `book_slot`), annulation toujours possible ; report avec une clé d'idempotence déjà prise par une autre réservation du profil → 22023 (plus d'erreur 23505 brute) ; droits `execute` d'`authenticated` sur `is_valid_plain_text` et `is_valid_time_zone` (fonctions pures, nécessaires aux contraintes sous RLS) à confirmer par l'audit ; la liste des réservations du propriétaire (0042) devra passer par une lecture paginée ou une fonction jsonb.
17. *Hery (18/11/2026), après revue et audit* : avenant ADR 0011 validé (usages `service_role` de la phase 5) ; jeton en clair retiré de `outbox.payload` dès le traitement (`complete_outbox`, `fail_outbox` au passage à `dead`, événements écartés de `claim_booking_outbox`) ; plafonds en base : ≤ 50 `availability_rules` par profil, plage ≥ 5 min, heures à la minute (sans secondes) ; ≤ 200 `availability_exceptions` dont la fin est à venir, bornes à la minute ; erreur 23514 explicite.
18. *Orchestrateur (tactique), corrections de revue et d'audit* :
    - `get_booking_by_token` : `can_reschedule` exige aussi le profil publié.
    - `cancel_own_booking` : rendez-vous déjà commencé → sans effet (aucun événement outbox) ; « à tout moment » = sans délai minimal ; `if v_status is distinct from 'confirmed' then return` (pas d'événement orphelin).
    - `claim_booking_outbox` : `previous_booking_start` et `previous_booking_end` pour `booking.rescheduled` ; un `booking.reminder` dont le rendez-vous a commencé passe `processed` sans être renvoyé.
    - `get_public_busy_ranges` : fenêtre refusée (22023) si `p_from < now() - 1 day` ou `p_to > now() + 1440 h + 1 day` (minimisation : pas d'historique public).
    - Droits `update` par colonne (champs métier seulement) sur `event_types`, `availability_rules`, `availability_exceptions`.
    - DRY : `carnet.hash_booking_token(text)` (immutable) et `carnet.lock_profile_bookings(uuid)` ; insertion commune « réservation + exclusion → CN001 + jeton » factorisée entre `book_slot_at` et `reschedule_booking_by_token_at` si lisible ; règle du délai minimal en un seul endroit si possible.
    - `p_message` vide → null (comme le téléphone).
    - Non retenu : schéma non exposé pour les fonctions de validation, limite Kong sur `/rpc/` (instance), clé de verrou (préfixe suffisant).
19. *Orchestrateur* : limites de débit applicatives (5/h par adresse, 20/23 h par profil après Turnstile) dans la fiche 0039, pas en base.

## Critères d'acceptation
1. Deux réservations confirmées qui se chevauchent pour un même profil sont impossibles, y compris en concurrence.
2. Rejouer `book_slot` avec la même clé renvoie la même réservation, sans doublon ni second événement outbox.
3. Un créneau hors disponibilités, dans une exception `busy`, avant le délai minimal ou au-delà de 60 jours est refusé.
4. Aucune donnée visiteur n'est lisible publiquement ; un autre propriétaire ou un compte d'un autre projet ne lit rien.
5. Heures d'été et d'hiver (Europe/Paris, et un fuseau sans DST) : règles converties correctement.
6. Migrations rejouables ; `supabase test db` vert.

## Règles applicables
`docs/rules/supabase.md`, `docs/rules/idempotence.md`, `docs/rules/security.md`, `docs/rules/testing.md`

## Hors périmètre
Calcul des créneaux affichés (0037, TypeScript), interfaces (0038–0042), e-mails (0041).

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `supabase test db` vert, rejeu des migrations sans erreur
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (18/11/2026) : 6 fichiers pgTAP (schema 255, access 114, book_slot 119, token 103, jobs 81, leads_outbox 247), contrat en tête de `carnet_bookings_schema.test.sql` ; DST Europe/Paris et fuseau sans DST ; personas autre membre, autre projet, anon.
- implémentation (db-architect, 18/11/2026) : migrations `20261118180000_create_booking_schema.sql`, `…190000_create_booking_functions.sql`, `…200000_create_booking_jobs.sql` ; `btree_gist`, 5 tables, RLS forcée, plafonds par triggers sous verrou, fonctions publiques jsonb, `book_slot` / report / annulation / lecture par jeton, `claim_booking_outbox`, `claim_outbox` restreinte aux leads, rappels et purge `pg_cron`. Hery : `db reset` + rejeu psql + `supabase test db` PASS (2944), jobids cron stables.
- reviewer (18/11/2026) : 1er passage à corriger (non bloquant) → point 18 ; 2e passage OK.
- security-auditor (18/11/2026) : 1er passage 4 MOYEN → avenant ADR 0011, points 17 et 18 ; 2e passage OK ; 3 FAIBLE reportés en 0038 (exceptions terminées, tests sous `authenticated`) et 0039 (concurrence des plafonds).
