-- Fiche 0038, décision 4 (Hery, 18/11/2026) — purge quotidienne des exceptions de disponibilité terminées depuis plus
-- de 30 jours, en complément du refus d'insérer ou de rendre terminée une exception (23514).
-- Contrat (même modèle que carnet.purge_bookings, 0036) :
--   carnet.purge_availability_exceptions(p_older_than interval) returns integer : supprime, tous profils confondus, les
--     exceptions dont upper(range) < now() − p_older_than ; renvoie le nombre supprimé ; 22023 si p_older_than nul ou
--     ≤ 0 ; exécutable ni par anon, ni par authenticated, ni par service_role (seul postgres / pg_cron l'appelle).
--   pg_cron : 'carnet-purge-availability-exceptions' quotidienne (minute heure * * *)
--     → select carnet.purge_availability_exceptions(interval '30 days') ; base postgres, utilisateur postgres, active,
--     unique ; replanification sous le même nom = même jobid.
-- Fixtures terminées : le refus de la décision 4 est porté par un trigger ; les exceptions passées sont donc insérées
--   par postgres (propriétaire de la table) entre `alter table … disable trigger user` et `enable trigger user`.
--   Seules les contraintes déclaratives (bornes, kind, fk) restent vérifiées ; la désactivation, transactionnelle, est
--   annulée par le rollback final. Toutes les dates sont relatives à now(), figé dans la transaction (aucune heure réelle).
-- Personas (plage 0038c, propre à ce fichier) : A 0…a, profil PA 0…10 ; B 0…b, profil PB 0…11 (membres carnet).
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(23);

create function pg_temp.txt(p_sql text) returns text
language plpgsql as $$
declare
  v text;
begin
  execute p_sql into v;
  return v;
exception when undefined_table or undefined_function or undefined_column or invalid_schema_name or undefined_object then
  return null;
end
$$;

-- Exceptions survivantes du jeu, par libellé (dernier caractère de l'id), triées.
create function pg_temp.survivors() returns text
language sql as $$
  select coalesce(string_agg(right(id::text, 2), ',' order by id), '')
    from carnet.availability_exceptions
   where id::text like '00000000-0000-4000-8000-0038c00000%'
$$;

create temp table reads (label text primary key, n integer);
create temp table cron_job_snapshot (
  jobid bigint, jobname text, schedule text, command text, database text, username text, active boolean
);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0038c000000a', 'a-carnet-0038c@test.local'),
  ('00000000-0000-4000-8000-0038c000000b', 'b-carnet-0038c@test.local');

insert into platform.project_members (project_id, user_id, role)
  select p.id, u.id, 'user'
    from platform.projects p
   cross join (values ('00000000-0000-4000-8000-0038c000000a'::uuid), ('00000000-0000-4000-8000-0038c000000b'::uuid)) as u (id)
   where p.slug = 'carnet';

insert into carnet.profiles (id, owner_id, slug, display_name) values
  ('00000000-0000-4000-8000-0038c0000010', '00000000-0000-4000-8000-0038c000000a', 'ana-0038c', 'Ana'),
  ('00000000-0000-4000-8000-0038c0000011', '00000000-0000-4000-8000-0038c000000b', 'ben-0038c', 'Ben');

-- À venir et en cours : posées triggers actifs (acceptées par la décision 4).
insert into carnet.availability_exceptions (id, profile_id, range, kind) values
  ('00000000-0000-4000-8000-0038c00000f1', '00000000-0000-4000-8000-0038c0000010',
   tstzrange(date_trunc('minute', now()) + interval '2 days', date_trunc('minute', now()) + interval '2 days 1 hour'), 'busy'),
  ('00000000-0000-4000-8000-0038c00000c1', '00000000-0000-4000-8000-0038c0000011',
   tstzrange(date_trunc('minute', now()) - interval '40 days', date_trunc('minute', now()) + interval '1 day'), 'busy');

-- Terminées : triggers utilisateur désactivés le temps de l'insertion.
alter table carnet.availability_exceptions disable trigger user;
insert into carnet.availability_exceptions (id, profile_id, range, kind) values
  -- PA : terminée il y a 29 jours (reste), il y a 31 jours (supprimée)
  ('00000000-0000-4000-8000-0038c00000a1', '00000000-0000-4000-8000-0038c0000010',
   tstzrange(date_trunc('minute', now()) - interval '29 days 2 hours', date_trunc('minute', now()) - interval '29 days'), 'busy'),
  ('00000000-0000-4000-8000-0038c00000a2', '00000000-0000-4000-8000-0038c0000010',
   tstzrange(date_trunc('minute', now()) - interval '31 days 2 hours', date_trunc('minute', now()) - interval '31 days'), 'extra'),
  -- PB : terminée il y a 31 jours et il y a 400 jours (supprimées : la purge vaut pour tous les profils)
  ('00000000-0000-4000-8000-0038c00000b2', '00000000-0000-4000-8000-0038c0000011',
   tstzrange(date_trunc('minute', now()) - interval '31 days 1 hour', date_trunc('minute', now()) - interval '31 days'), 'busy'),
  ('00000000-0000-4000-8000-0038c00000b4', '00000000-0000-4000-8000-0038c0000011',
   tstzrange(date_trunc('minute', now()) - interval '400 days 1 hour', date_trunc('minute', now()) - interval '400 days'), 'extra');
alter table carnet.availability_exceptions enable trigger user;

select is(pg_temp.survivors(), 'a1,a2,b2,b4,c1,f1', 'fixture : 6 exceptions posées (4 terminées, 1 en cours, 1 à venir)');

-- ---------------------------------------------------------------------------
-- Structure et droits
-- ---------------------------------------------------------------------------
select has_function('carnet', 'purge_availability_exceptions', array['interval'],
  'décision 4 : carnet.purge_availability_exceptions(interval) existe');
select is(
  pg_temp.txt($$select format_type(prorettype, null) from pg_proc where oid = 'carnet.purge_availability_exceptions(interval)'::regprocedure$$),
  'integer',
  'décision 4 : purge_availability_exceptions renvoie un integer (nombre supprimé)'
);
select is(
  (select string_agg(r || '=' || has_function_privilege(r, f, 'EXECUTE')::text, ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          (select to_regprocedure('carnet.purge_availability_exceptions(interval)') f) x
    where f is not null),
  'anon=false,authenticated=false,service_role=false',
  'décision 4 : purge_availability_exceptions exécutable ni par anon, ni par authenticated, ni par service_role'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0038c000000a","role":"authenticated"}';
select throws_ok($$select carnet.purge_availability_exceptions(interval '30 days')$$, '42501', null,
  'critère 2 : un membre carnet ne peut pas lancer la purge (42501)');
reset role;
set local role service_role;
select throws_ok($$select carnet.purge_availability_exceptions(interval '30 days')$$, '42501', null,
  'décision 4 : service_role ne peut pas lancer la purge (42501)');
reset role;
set local role anon;
select throws_ok($$select carnet.purge_availability_exceptions(interval '30 days')$$, '42501', null,
  'décision 4 : anon ne peut pas lancer la purge (42501)');
reset role;

select is(pg_temp.survivors(), 'a1,a2,b2,b4,c1,f1', 'les appels refusés n''ont rien supprimé');

-- ---------------------------------------------------------------------------
-- Purge (postgres, comme pg_cron)
-- ---------------------------------------------------------------------------
select throws_ok($$select carnet.purge_availability_exceptions(null)$$, '22023', null, 'décision 4 : intervalle nul → 22023');
select throws_ok($$select carnet.purge_availability_exceptions(interval '0')$$, '22023', null, 'décision 4 : intervalle 0 → 22023');
select throws_ok($$select carnet.purge_availability_exceptions(interval '-1 day')$$, '22023', null, 'décision 4 : intervalle négatif → 22023');

select lives_ok(
  $$insert into reads (label, n) values ('first', carnet.purge_availability_exceptions(interval '30 days'))$$,
  'décision 4 : purge_availability_exceptions(30 jours) s''exécute (postgres)'
);
select ok(
  not exists (select 1 from carnet.availability_exceptions where id = '00000000-0000-4000-8000-0038c00000a2'),
  'décision 4 : une exception terminée il y a 31 jours est supprimée'
);
select ok(
  exists (select 1 from carnet.availability_exceptions where id = '00000000-0000-4000-8000-0038c00000a1'),
  'décision 4 : une exception terminée il y a 29 jours reste'
);
select is(pg_temp.survivors(), 'a1,c1,f1',
  'décision 4 : les exceptions terminées depuis plus de 30 jours de tous les profils sont supprimées ; en cours et à venir intactes');
select ok(
  coalesce((select n >= 3 from reads where label = 'first'), false),
  'décision 4 : la purge renvoie le nombre d''exceptions supprimées (au moins les 3 du jeu)'
);

-- Idempotence : rejouée, la purge ne supprime plus rien du jeu.
select lives_ok(
  $$insert into reads (label, n) values ('second', carnet.purge_availability_exceptions(interval '30 days'))$$,
  'idempotence : la purge rejouée s''exécute'
);
select is(
  (select n from reads where label = 'second'),
  0,
  'idempotence : la purge rejouée renvoie 0'
);
select is(pg_temp.survivors(), 'a1,c1,f1', 'idempotence : aucune autre exception supprimée par le rejeu');

-- ---------------------------------------------------------------------------
-- Tâche pg_cron
-- ---------------------------------------------------------------------------
insert into cron_job_snapshot (jobid, jobname, schedule, command, database, username, active)
  select jobid, jobname, schedule, command, database, username, active
    from cron.job
   where jobname = 'carnet-purge-availability-exceptions' or command ilike '%purge_availability_exceptions%';

select is(
  (select format('%s/%s', count(*) filter (where jobname = 'carnet-purge-availability-exceptions'), count(*)) from cron_job_snapshot),
  '1/1',
  'décision 4 : exactement une tâche carnet-purge-availability-exceptions, aucune autre n''appelle la purge'
);
select ok(
  coalesce((select schedule ~ '^[0-9]{1,2} [0-9]{1,2} \* \* \*$' and database = 'postgres' and username = 'postgres' and active
              from cron_job_snapshot where jobname = 'carnet-purge-availability-exceptions'), false),
  'décision 4 : tâche quotidienne (minute heure * * *), active, base postgres, sous postgres'
);
select is(
  (select regexp_replace(btrim(regexp_replace(command, '\s+', ' ', 'g')), '\s*;$', '')
     from cron_job_snapshot where jobname = 'carnet-purge-availability-exceptions'),
  'select carnet.purge_availability_exceptions(interval ''30 days'')',
  'décision 4 : la commande est select carnet.purge_availability_exceptions(interval ''30 days'')'
);
select ok(
  coalesce((select cron.schedule(jobname, schedule, command) = jobid
              from cron_job_snapshot where jobname = 'carnet-purge-availability-exceptions'), false)
  and (select count(*) from cron.job where jobname = 'carnet-purge-availability-exceptions') = 1,
  'idempotence : replanifier sous le même nom garde le même jobid et une seule tâche'
);

select * from finish();
rollback;
