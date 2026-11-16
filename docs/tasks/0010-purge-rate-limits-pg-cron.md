# 0010 — Purge planifiée de `rate_limits` (`pg_cron`)

- Statut : done (16/11/2026)
- Validé par Hery (16/11/2026) : la migration de `carnet` peut activer `pg_cron` (`create extension if not exists`). Durée : `interval '23 hours'` avec passage horaire, pour tenir strictement « 24 heures au plus » (choix de l'orchestrateur, point 3).
- Agent : db-architect ; test-engineer (pgTAP)
- Phase : 1 (dette du lot inscription) — **préalable obligatoire à la mise en production** (audits 0009, 0007, 0008)
- ADR liées : 0002, 0011

## Objectif
Les empreintes d'adresse IP de `carnet.rate_limits` sont supprimées automatiquement au plus 24 heures après le début de leur fenêtre, comme l'annonce la mention RGPD des formulaires (0008).

## Périmètre de fichiers
- Autorisé (db-architect) : `supabase/migrations/2026111…_schedule_rate_limits_purge.sql`, `supabase/config.toml` (seulement si l'extension doit y être déclarée pour la pile locale).
- Autorisé (test-engineer) : `supabase/tests/carnet_rate_limits_purge_job.test.sql`.
- Interdit : tout le reste ; aucune modification de `carnet.purge_rate_limits` (livrée en 0009) ni du schéma `platform`.

## Décisions de conception (à valider par Hery)
1. **Extension `pg_cron`** : `create extension if not exists pg_cron` est **à l'échelle de l'instance** (schéma `cron`, base `postgres`), partagée avec les autres projets. Arrêt obligatoire §2 : Hery confirme que l'extension peut être activée par une migration de `carnet`, ou qu'elle l'est déjà sur l'instance (à vérifier sur la production avant tout déploiement ; dans ce cas la migration se contente de `if not exists`).
2. **Tâche** : nom préfixé par le projet, `carnet-purge-rate-limits`, pour éviter toute collision avec les autres projets de l'instance. Horaire `0 * * * *` (toutes les heures, à la minute 0). Commande : `select carnet.purge_rate_limits(interval '24 hours')`.
3. **Durée** : 24 h (décision de Hery, 16/11/2026), supérieure à la plus longue fenêtre de limitation (1 h, `LONGEST_RATE_LIMIT_WINDOW_SECONDS`) : la purge ne remet jamais à zéro un compteur en cours. Conservation effective : 24 h + 1 h au plus entre deux passages, annoncée « 24 heures au plus » → à confirmer par Hery ou à passer à `interval '23 hours'` pour tenir strictement la promesse.
4. **Idempotence** : `cron.schedule(job_name, schedule, command)` met à jour la tâche du même nom ; la migration rejouée ne crée pas de doublon (test).
5. **Journal `cron.job_run_details`** : grossit à chaque exécution pour toute l'instance (24 lignes par jour pour cette tâche). Sa purge est une opération d'instance, hors périmètre : à noter pour l'ADR plateforme.

## Critères d'acceptation
1. Après migration, `cron.job` contient exactement une tâche `carnet-purge-rate-limits`, horaire `0 * * * *`, commande appelant `carnet.purge_rate_limits` avec l'intervalle validé, base `postgres`.
2. Migration appliquée deux fois : toujours une seule tâche, paramètres inchangés.
3. L'exécution manuelle de la commande supprime les lignes plus anciennes que l'intervalle et conserve les autres (déjà couvert en 0009 : un test de fumée suffit).
4. Aucune tâche d'un autre projet n'est créée, modifiée ou supprimée ; la migration ne fait pas de `cron.unschedule` sur un autre nom.
5. `authenticated` et `anon` n'ont aucun accès au schéma `cron`.

## Règles applicables
`docs/rules/supabase.md`, `docs/rules/security.md` (RGPD : durées appliquées par `pg_cron`), `docs/rules/idempotence.md`, `docs/rules/testing.md`.

## Hors périmètre
- Purge de `cron.job_run_details` (instance). Index sur `window_start` (seulement si le volume le justifie). Purge des comptes non confirmés (ADR plateforme). Autres durées de conservation (événements, leads, rendez-vous : phases 4 et 5).

## Définition de terminé
- [x] Extension `pg_cron` validée par Hery (point 1) et durée exacte confirmée (point 3)
- [x] Tests pgTAP écrits par test-engineer, échouant avant implémentation
- [x] `supabase test db` vert sur base reconstruite ; double application prouvée
- [x] `pnpm check` vert
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Aucune déviation d'architecture (sinon ADR validée par Hery)
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (16/11/2026) : `carnet_rate_limits_purge_job.test.sql`, plan 17 (extension ; une seule tâche `carnet-purge-rate-limits`, aucune autre tâche appelant `purge_rate_limits` ; horaire, commande normalisée, base, active, `username = postgres` ; `anon`/`authenticated` sans `usage` sur `cron` et 42501 sur `cron.job` ; fumée : ligne de 23 h 01 supprimée, 22 h 59 conservée, commande lue dans `cron.job`). Échec vérifié : 15/17 rouges pour la bonne raison, 532 existants verts ; mutants 24 h, doublon et grant discriminés.
- implémentation (db-architect, 16/11/2026) : `20261116090000_schedule_rate_limits_purge.sql` : `create extension if not exists pg_cron`, `cron.schedule('carnet-purge-rate-limits', '0 * * * *', $$select carnet.purge_rate_limits(interval '23 hours')$$)`, aucun grant, aucun `unschedule`. Vérification exécutée par Hery (`db reset` et `psql` refusés aux agents par le système de permissions) : `supabase db reset` + `supabase test db` → 549/549 ; rejeu par `psql -f` → `extension already exists, skipping`, `cron.schedule` renvoie le même `jobid` 1, une seule ligne, paramètres inchangés ; `has_schema_privilege('anon'|'authenticated', 'cron', 'USAGE')` = `f`/`f` (script supautils sans effet sur ces rôles).
- reviewer (16/11/2026) : **OK**, aucune remarque bloquante ni à corriger. Critères 1 à 5 remplis (2 par preuve manuelle, convention 0007/0009). Suggestions : précondition d'instance dans l'en-tête de migration ; rejeu de `cron.schedule` en pgTAP (facultatif) ; nettoyage des lignes étrangères inutile dans le test.
- security-auditor (16/11/2026) : **OK**, rien de bloquant. `search_path` vide, commande statique qualifiée, `cron` non exposé, `anon`/`authenticated` sans droit. Moyen (hors fiche) : arrêt silencieux de la purge possible (worker arrêté, tâche supprimée par un autre projet sous `postgres`) → supervision `cron.job_run_details` et règle « un projet ne touche que ses tâches `<projet>-*` » dans l'ADR plateforme. Faibles : la durée court depuis la dernière fenêtre (`consume_rate_limit` réinitialise `window_start`) → formulation de la mention à trancher par Hery ; retard de quelques secondes au passage horaire (accepté) ; `postgres` non superutilisateur sur les images récentes. Veille : GHSA-j8p5-79jf-g575 (< 1.6.5), dernière version 1.6.8.
- vérification orchestrateur (16/11/2026) : `supabase test db` 549/549, `pnpm check` 289/289, intégration 26/26, E2E 66/66 (avec 0012).
- **À vérifier sur l'instance de production avant tout `db push`** (lecture seule) : `pg_cron` dans `shared_preload_libraries` et `extversion` ≥ 1.6.5 (idéalement 1.6.8 ; `if not exists` ne met pas à jour une version installée par un autre projet) ; `show cron.database_name` = `postgres` ; rôle qui applique les migrations = `postgres` ; purge de `cron.job_run_details` réglée au niveau de l'instance.
