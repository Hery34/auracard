-- Fiche 0010 — purge planifiée de `carnet.rate_limits` par pg_cron (validée par Hery le 16/11/2026).
-- pg_cron est une extension d'instance (schéma `cron`, base `postgres`) partagée avec les autres projets : `if not exists`
-- la réutilise si elle est déjà active. La tâche porte le préfixe `carnet-` pour éviter toute collision ; la migration ne
-- touche à aucune autre tâche (aucun cron.unschedule) et n'accorde aucun privilège sur `cron`.
-- Conservation : intervalle de 23 h + 1 h au plus entre deux passages horaires = 24 h au plus (mention RGPD, fiche 0008).
-- Rejouable : cron.schedule met à jour la tâche du même nom au lieu d'en créer une seconde.

create extension if not exists pg_cron;

select cron.schedule(
  'carnet-purge-rate-limits',
  '0 * * * *',
  $$select carnet.purge_rate_limits(interval '23 hours')$$
);
