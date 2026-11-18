# 0028 — Schéma des statistiques

- Statut : done
- Agent : db-architect ; test-engineer (pgTAP)
- Phase : 4
- ADR liées : 0002, 0004, 0006, 0011 ; règles `idempotence.md` (événements), `security.md` (RGPD)

## Objectif
Chaque interaction avec un profil publié (scan, vue, vCard, clic) est enregistrée une seule fois, agrégée par jour et lisible par le seul propriétaire ; les événements bruts disparaissent après 90 jours.

## Périmètre de fichiers
- db-architect : nouvelle(s) migration(s) dans `supabase/migrations/`.
- test-engineer : `supabase/tests/`.
- Interdit : tout le reste.

## Décisions (validées par Hery, 18/11/2026, sauf mention)
1. **`carnet.analytics_events`** : `id uuid` primaire **fourni par l'émetteur**, `profile_id` (FK `profiles`, `on delete cascade`), `type` (`profile_view`, `nfc_scan`, `qr_scan`, `vcard_download`, `link_click`, `contact_click`, `lead_submitted`), `source` (`nfc`, `qr`, `direct`), `link_id` (FK `links`, `on delete set null`, obligatoire pour `link_click` à l'insertion, interdit sinon), `device_class` (`mobile`, `desktop`), `occurred_at` (horodatage serveur). **Ni IP, ni empreinte, ni user-agent, ni pays, ni identifiant de visiteur.** Les robots ne sont pas stockés (filtrés en amont, fiche 0029).
2. **`carnet.record_event(p_id, p_profile_id, p_type, p_source, p_link_id, p_device_class)`** : `security definer`, `search_path = ''` ; `insert … on conflict (id) do nothing` ; n'enregistre rien (sans erreur, sans oracle) si le profil n'est pas publié ou si `link_id` n'appartient pas au profil ; `22023` sur valeur hors liste.
3. **Exécution réservée à `service_role`** (avenant ADR 0011 validé par Hery, 18/11/2026). Une fonction ouverte à `anon` permettrait de gonfler les statistiques de n'importe quel profil en contournant le filtrage des robots et la limitation de débit de la route.
4. **`carnet.analytics_daily`** : `profile_id` (cascade), `day date` (jour civil **Europe/Paris**), `metric` (= `type` d'événement), `link_id` (nullable, **sans clé étrangère** — Hery, 18/11/2026 : avec `set null` + `nulls not distinct`, supprimer un second lien cliqué le même jour violait l'unicité ; l'uuid d'un lien supprimé est conservé et affiché « Lien supprimé »), `source` (nullable), `value integer` ; unicité (`profile_id`, `day`, `metric`, `link_id`, `source`) en `nulls not distinct`. Recalcul complet d'une journée par `insert … on conflict … do update` (relançable sans double comptage).
5. **`pg_cron`** : tâche toutes les 15 minutes qui recalcule aujourd'hui et hier ; tâche quotidienne qui supprime les événements bruts de plus de 90 jours. Agrégats conservés tant que le profil existe.
6. **Lecture** : RLS sur les deux tables. `analytics_events` : aucun accès `anon`/`authenticated`. `analytics_daily` : `select` pour le propriétaire seul (`carnet.can_edit_profile`), aucune écriture. Mêmes conventions de droits par colonne que 0022.
7. **Suppression de compte** : cascade depuis `profiles` ; vérifier que `delete_own_account()` (0023) emporte tout.

## Critères d'acceptation
1. Un événement inséré deux fois avec le même `id` n'existe qu'une fois.
2. Un événement pour un profil non publié, ou un `link_id` d'un autre profil, n'est pas enregistré ; la fonction répond pareil.
3. `anon` et `authenticated` ne peuvent ni exécuter `record_event` ni lire `analytics_events`.
4. Le propriétaire lit ses agrégats, un autre membre de `carnet` et un compte d'un autre projet de l'instance ne lisent rien.
5. Relancer l'agrégation d'un jour donne les mêmes valeurs ; un événement à 23 h 30 UTC en été compte pour le lendemain (Europe/Paris).
6. La purge supprime les événements de plus de 90 jours et pas les agrégats.
7. Migration rejouable ; tâches `pg_cron` non dupliquées au rejeu (même `jobid`).

## Règles applicables
`docs/rules/supabase.md`, `docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`

## Hors périmètre
Visiteurs uniques, pays, référent, statistiques en temps réel au-delà de 15 minutes.

## Définition de terminé
- [x] Avenant ADR 0011 validé par Hery
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `supabase test db` vert, migration rejouée (Hery)
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (18/11/2026) : `supabase/tests/carnet_analytics.test.sql`, 224 pgTAP, 219 en échec avant implémentation. Contrat : `record_event(...) returns void` (22023 avant tout contrôle du profil), `aggregate_analytics_day(p_day date)`, `purge_analytics_events(p_older_than interval) returns integer`, unicité `analytics_daily_bucket_key`, politique `analytics_daily_select_own`, tâches `carnet-aggregate-analytics` (*/15) et `carnet-purge-analytics-events` (quotidienne, 90 jours). Arbitrages acceptés : `source`/`device_class` non nuls dans les événements ; 22023 pour `link_click` sans lien ou lien sur un autre type ; droits `service_role` sur les tables non imposés ; réagréger une journée purgée ne change rien. Décision 4 corrigée (pas de FK sur `analytics_daily.link_id`), tests à ajuster.
- implémentation : …
- reviewer (18/11/2026) : à corriger, non bloquant — listes de valeurs (types, sources, `device_class`) dupliquées entre les `check` et `record_event` → fonctions `immutable` `carnet.is_valid_analytics_*` sur le modèle de `is_valid_qr_style`. Suggestions retenues : commentaire sur la garde de fenêtre, `pg_catalog.now()` partout, limite « un bucket vidé dans la fenêtre garde sa valeur » écrite dans l'en-tête. Bornes Europe/Paris et fenêtre J−89 vérifiées à la lecture. Corrections planifiées **après** l'implémentation de 0031 (même base locale), suivies d'un seul `db reset`.
- security-auditor (18/11/2026) : **OK**. Remarques faibles : tester l'absence d'`execute` de `service_role` sur `aggregate_analytics_day` et `purge_analytics_events` (à ajouter) ; `grant all` de `service_role` sur `analytics_events` conforme à l'avenant 0011 du 17/11 (adaptateur limité à `rpc('record_event')`) ; points reportés en 0029.
- Vérification Hery (18/11/2026) : `supabase db reset` + `supabase test db` → `carnet_analytics` vert ; seuls échecs : fiche 0031 (attendus). Rejeu `psql` de la migration : à faire.
- Clôture (18/11/2026) : Hery — `supabase db reset` + `supabase test db` 20/20 fichiers, 2122 tests (`carnet_analytics` 232) ; rejeu `psql` de la migration sans erreur, `jobid` inchangés (2, 3).
