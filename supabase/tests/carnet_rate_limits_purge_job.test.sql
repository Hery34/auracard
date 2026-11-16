-- Fiche 0010 — purge planifiée de carnet.rate_limits par pg_cron : tâche carnet-purge-rate-limits, horaire 0 * * * *,
-- commande select carnet.purge_rate_limits(interval '23 hours'), base postgres.
-- Critères couverts : 1 (extension, tâche unique, horaire, commande, base, active, propriétaire postgres ; aucune autre tâche
-- n'appelle purge_rate_limits), 3 (fumée : la commande enregistrée, exécutée telle quelle, supprime une fenêtre de plus de 23 h
-- et conserve une fenêtre plus récente), 5 (anon et authenticated sans usage sur le schéma cron ; 42501 en situation).
-- Non couverts ici : critère 2 (double application de la migration, prouvée par db-architect) ; critère 4 (aucune tâche d'un
-- autre projet touchée : relève de la revue de la migration, aucun cron.unschedule hors carnet-*).
-- Avant implémentation, le schéma cron n'existe pas : toute lecture de cron.job passe par lives_ok (savepoint pgTAP) et
-- has_schema_privilege est gardé par to_regnamespace, pour que les échecs soient des assertions et non un abandon du script.
-- La commande est comparée après normalisation des blancs (suites d'espaces réduites, bords et point-virgule final retirés).
-- La fumée tourne sous postgres, comme la tâche (username postgres) ; now() est figé dans la transaction, l'ancienneté des
-- lignes est posée par insert explicite. Tout est annulé par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(17);

-- ---------------------------------------------------------------------------
-- Critère 1 — extension et tâche
-- ---------------------------------------------------------------------------
select has_extension('pg_cron', 'critère 1 : l''extension pg_cron est installée');

create temp table cron_job_snapshot (
  jobname text, schedule text, command text, database text, username text, active boolean
);
select lives_ok(
  $$insert into cron_job_snapshot (jobname, schedule, command, database, username, active)
    select jobname, schedule, command, database, username, active
      from cron.job
     where jobname = 'carnet-purge-rate-limits' or command ilike '%purge_rate_limits%'$$,
  'critère 1 : postgres lit cron.job'
);

select is(
  (select count(*) from cron_job_snapshot where jobname = 'carnet-purge-rate-limits'),
  1::bigint,
  'critère 1 : cron.job contient exactement une tâche carnet-purge-rate-limits'
);
select is(
  (select count(*) from cron_job_snapshot),
  1::bigint,
  'critère 1 : aucune autre tâche n''appelle purge_rate_limits (pas de tâche résiduelle sous un autre nom)'
);
select is(
  (select schedule from cron_job_snapshot where jobname = 'carnet-purge-rate-limits'),
  '0 * * * *',
  'critère 1 : la tâche tourne toutes les heures à la minute 0 (0 * * * *)'
);
select is(
  (select regexp_replace(btrim(regexp_replace(command, '\s+', ' ', 'g')), '\s*;$', '')
     from cron_job_snapshot where jobname = 'carnet-purge-rate-limits'),
  'select carnet.purge_rate_limits(interval ''23 hours'')',
  'critère 1 : la commande est select carnet.purge_rate_limits(interval ''23 hours'')'
);
select is(
  (select database from cron_job_snapshot where jobname = 'carnet-purge-rate-limits'),
  'postgres',
  'critère 1 : la tâche s''exécute dans la base postgres'
);
select is(
  (select active from cron_job_snapshot where jobname = 'carnet-purge-rate-limits'),
  true,
  'critère 1 : la tâche est active'
);
select is(
  (select username from cron_job_snapshot where jobname = 'carnet-purge-rate-limits'),
  'postgres',
  'critère 1 : la tâche s''exécute sous postgres (propriétaire de purge_rate_limits, seul autorisé avec service_role)'
);

-- ---------------------------------------------------------------------------
-- Critère 5 — anon et authenticated n'ont aucun accès au schéma cron
-- ---------------------------------------------------------------------------
select ok(
  case when to_regnamespace('cron') is null then false
       else not has_schema_privilege('anon', 'cron', 'USAGE') end,
  'critère 5 : le schéma cron existe et anon n''y a pas usage'
);
select ok(
  case when to_regnamespace('cron') is null then false
       else not has_schema_privilege('authenticated', 'cron', 'USAGE') end,
  'critère 5 : le schéma cron existe et authenticated n''y a pas usage'
);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select jobname from cron.job$$,
  '42501', null, 'critère 5 : anon ne lit pas cron.job (42501)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000010"}';
select throws_ok(
  $$select jobname from cron.job$$,
  '42501', null, 'critère 5 : authenticated ne lit pas cron.job (42501)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 3 — fumée : la commande enregistrée, exécutée telle quelle par postgres, purge au-delà de 23 h
-- Lignes à 23 h 01 et 22 h 59 : un intervalle de 24 h garderait les deux, un intervalle de 22 h supprimerait les deux.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$delete from carnet.rate_limits where key not like 'test-0010:%'$$,
  'critère 3 : postgres neutralise les lignes étrangères à la fiche (annulé par le rollback)'
);
select lives_ok(
  $$insert into carnet.rate_limits (key, window_start, count) values
      ('test-0010:older-than-23h', now() - interval '23 hours 1 minute', 3),
      ('test-0010:younger-than-23h', now() - interval '22 hours 59 minutes', 1)$$,
  'critère 3 : postgres insère une fenêtre ouverte il y a 23 h 01 et une il y a 22 h 59'
);
select lives_ok(
  $smoke$do $$
    declare
      v_command text;
    begin
      select command into strict v_command from cron_job_snapshot where jobname = 'carnet-purge-rate-limits';
      execute v_command;
    end
  $$$smoke$,
  'critère 3 : la commande de la tâche carnet-purge-rate-limits s''exécute sans erreur sous postgres'
);
select results_eq(
  $$select key from carnet.rate_limits where key like 'test-0010:%' order by key$$,
  $$values ('test-0010:younger-than-23h'::text)$$,
  'critère 3 : la fenêtre de plus de 23 h est supprimée, celle de 22 h 59 est conservée'
);

select * from finish();
rollback;
