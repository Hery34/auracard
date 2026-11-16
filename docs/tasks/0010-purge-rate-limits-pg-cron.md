# 0010 — Purge planifiée de `rate_limits` (`pg_cron`)

- Statut : todo (en attente de validation de Hery : extension `pg_cron` sur l'instance partagée)
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
- [ ] Extension `pg_cron` validée par Hery (point 1) et durée exacte confirmée (point 3)
- [ ] Tests pgTAP écrits par test-engineer, échouant avant implémentation
- [ ] `supabase test db` vert sur base reconstruite ; double application prouvée
- [ ] `pnpm check` vert
- [ ] reviewer : OK ou remarques non bloquantes traitées
- [ ] security-auditor : OK
- [ ] Aucune déviation d'architecture (sinon ADR validée par Hery)
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer : …
- implémentation : …
- reviewer : …
- security-auditor : …
