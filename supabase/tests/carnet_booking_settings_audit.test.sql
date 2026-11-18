-- Fiche 0038 — points reportés de l'audit 0036 (sous `authenticated`) et refus des exceptions terminées.
-- Critère couvert : 2 (un autre compte ne modifie rien) ; plafonds du point 17 de 0036.
-- A. Écrire sur le profil plein d'autrui (10 types, 50 règles, 200 exceptions à venir) : 42501 (RLS, with check),
--    jamais 23514, CN004 ni 23505 — aucun oracle sur l'état du profil d'autrui ; même chose pour un compte d'un autre
--    projet.
-- B. Plafond de 200 exceptions à venir appliqué à un `update` qui ramène une exception terminée dans le futur : CN004
--    (fiche 0038 point 6, SQLSTATE dédié des triggers de plafond ; les autres refus restent 23514).
-- C. Décision 4 (Hery, 18/11/2026) : refus d'une exception terminée (upper(range) <= now()) à l'insertion ET à la
--    modification (sinon : insérer 200 exceptions à venir puis les repousser dans le passé contourne le plafond sans
--    attendre), 23514 ; une exception en cours (début passé, fin à venir) reste acceptée.
--    Les fixtures terminées sont posées triggers utilisateur désactivés (postgres, propriétaire de la table ; la
--    désactivation et la ligne sont annulées par le rollback). La purge quotidienne : carnet_booking_settings_jobs.
-- Personas (plage 0038a, propre à ce fichier) :
--   A 0…a membre carnet, profil PA 0…10 (une exception à venir x1)
--   B 0…b membre carnet, profil PB 0…11 plein : 10 types, 50 règles, 200 exceptions à venir, 1 exception terminée x9
--   C 0…d membre du projet other_0038a seul, profil PC 0…13
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(21);

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

create function pg_temp.rows(p_sql text) returns bigint
language plpgsql as $$
declare
  n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
exception when undefined_table or undefined_function or undefined_column or invalid_schema_name or undefined_object then
  return null;
end
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0038a000000a', 'a-carnet-0038a@test.local'),
  ('00000000-0000-4000-8000-0038a000000b', 'b-carnet-0038a@test.local'),
  ('00000000-0000-4000-8000-0038a000000d', 'c-other-0038a@test.local');

insert into platform.projects (id, slug, name, db_schema)
  values ('00000000-0000-4000-8000-0038a0000002', 'other_0038a', 'Other 0038a', 'other_0038a');

insert into platform.project_members (project_id, user_id, role)
  select p.id, u.id, 'user'
    from platform.projects p
   cross join (values ('00000000-0000-4000-8000-0038a000000a'::uuid), ('00000000-0000-4000-8000-0038a000000b'::uuid)) as u (id)
   where p.slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  values ('00000000-0000-4000-8000-0038a0000002', '00000000-0000-4000-8000-0038a000000d', 'user');

insert into carnet.profiles (id, owner_id, slug, display_name) values
  ('00000000-0000-4000-8000-0038a0000010', '00000000-0000-4000-8000-0038a000000a', 'ana-0038a', 'Ana'),
  ('00000000-0000-4000-8000-0038a0000011', '00000000-0000-4000-8000-0038a000000b', 'ben-0038a', 'Ben'),
  ('00000000-0000-4000-8000-0038a0000013', '00000000-0000-4000-8000-0038a000000d', 'cyd-0038a', 'Cyd');

insert into carnet.event_types (profile_id, title, duration_min, location_kind, location_text, position)
  select '00000000-0000-4000-8000-0038a0000011', 'Type ' || g, 30, 'video', 'https://visio.example.test/ben', g
    from generate_series(0, 9) g;

insert into carnet.availability_rules (profile_id, weekday, start_time, end_time)
  select '00000000-0000-4000-8000-0038a0000011', (g % 7) + 1, make_time(g / 7, 0, 0), make_time(g / 7, 30, 0)
    from generate_series(0, 49) g;

insert into carnet.availability_exceptions (profile_id, range, kind)
  select '00000000-0000-4000-8000-0038a0000011',
         tstzrange(date_trunc('minute', now()) + interval '1 day' + make_interval(hours => g),
                   date_trunc('minute', now()) + interval '1 day' + make_interval(hours => g, mins => 30)), 'busy'
    from generate_series(1, 200) g;

insert into carnet.availability_exceptions (id, profile_id, range, kind) values
  ('00000000-0000-4000-8000-0038a00000a1', '00000000-0000-4000-8000-0038a0000010',
   tstzrange(date_trunc('minute', now()) + interval '10 days', date_trunc('minute', now()) + interval '10 days 2 hours'), 'busy');

alter table carnet.availability_exceptions disable trigger user;
insert into carnet.availability_exceptions (id, profile_id, range, kind) values
  ('00000000-0000-4000-8000-0038a00000a9', '00000000-0000-4000-8000-0038a0000011',
   tstzrange(date_trunc('minute', now()) - interval '3 days', date_trunc('minute', now()) - interval '2 days'), 'busy');
alter table carnet.availability_exceptions enable trigger user;

select is(
  pg_temp.txt($$select format('%s/%s/%s',
      (select count(*) from carnet.event_types where profile_id = '00000000-0000-4000-8000-0038a0000011'),
      (select count(*) from carnet.availability_rules where profile_id = '00000000-0000-4000-8000-0038a0000011'),
      (select count(*) from carnet.availability_exceptions where profile_id = '00000000-0000-4000-8000-0038a0000011' and upper(range) > now()))$$),
  '10/50/200',
  'fixture : PB est plein (10 types, 50 règles, 200 exceptions à venir)'
);

-- ---------------------------------------------------------------------------
-- A. A (autre membre carnet) écrit sur le profil plein de B : 42501, jamais 23514 / 23505
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0038a000000a","role":"authenticated"}';

select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-0038a0000011', 7, '23:00', '23:30')$$,
  '42501', null, 'audit 0036 : A insère une 51e règle sur PB plein → 42501 (RLS), pas 23514'
);
select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-0038a0000011',
       tstzrange(date_trunc('minute', now()) + interval '40 days', date_trunc('minute', now()) + interval '40 days 1 hour'), 'busy')$$,
  '42501', null, 'audit 0036 : A insère une 201e exception à venir sur PB plein → 42501 (RLS), pas 23514'
);
select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-0038a0000011',
       tstzrange(date_trunc('minute', now()) - interval '5 days', date_trunc('minute', now()) - interval '4 days'), 'busy')$$,
  '42501', null, 'audit 0036 : A insère une exception terminée sur PB → 42501 (RLS avant tout autre contrôle)'
);
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-0038a0000011', 1, '00:00', '00:30')$$,
  '42501', null, 'audit 0036 : A insère sur PB une règle qui chevaucherait celle de B → 42501, pas 23P01'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, location_text, position) values
      ('00000000-0000-4000-8000-0038a0000011', 'Intrus', 30, 'video', 'https://intrus.example.test', 0)$$,
  '42501', null, 'audit 0036 : A insère un 11e type sur PB (position 0 prise) → 42501, pas 23505'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, location_text, position) values
      ('00000000-0000-4000-8000-0038a0000011', 'Intrus', 4, 'video', 'https://intrus.example.test', 10)$$,
  '42501', null, 'audit 0036 : A insère sur PB un type hors bornes → 42501, pas 23514'
);
select is(
  pg_temp.rows($$update carnet.availability_exceptions set range = tstzrange(date_trunc('minute', now()) + interval '50 days',
                   date_trunc('minute', now()) + interval '50 days 1 hour')
                  where id = '00000000-0000-4000-8000-0038a00000a9'$$),
  0::bigint,
  'audit 0036 : A ne peut pas ramener dans le futur l''exception terminée de B (0 ligne, aucune erreur)'
);
select is(
  pg_temp.rows($$update carnet.availability_rules set end_time = '00:45'
                  where profile_id = '00000000-0000-4000-8000-0038a0000011'$$),
  0::bigint,
  'audit 0036 : A ne modifie aucune règle de B (0 ligne)'
);
reset role;

-- Compte d'un autre projet (C) : mêmes refus.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0038a000000d","role":"authenticated"}';

select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-0038a0000011', 7, '23:00', '23:30')$$,
  '42501', null, 'audit 0036 : un compte d''un autre projet insère une règle sur PB plein → 42501'
);
select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-0038a0000011',
       tstzrange(date_trunc('minute', now()) + interval '40 days', date_trunc('minute', now()) + interval '40 days 1 hour'), 'extra')$$,
  '42501', null, 'audit 0036 : un compte d''un autre projet insère une exception sur PB plein → 42501'
);
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-0038a0000013', 1, '09:00', '10:00')$$,
  '42501', null, 'audit 0036 : un compte d''un autre projet n''écrit pas même sur son propre profil carnet (is_member) → 42501'
);
reset role;

-- ---------------------------------------------------------------------------
-- B. Le plafond s'applique à un update qui ramène une exception terminée dans le futur (B, propriétaire)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0038a000000b","role":"authenticated"}';

select throws_ok(
  $$update carnet.availability_exceptions
       set range = tstzrange(date_trunc('minute', now()) + interval '50 days', date_trunc('minute', now()) + interval '50 days 1 hour')
     where id = '00000000-0000-4000-8000-0038a00000a9'$$,
  'CN004', null, 'audit 0036 : B ramène son exception terminée dans le futur alors qu''il en a 200 à venir → CN004'
);
select lives_ok(
  $$update carnet.availability_exceptions
       set range = tstzrange(upper(range) + interval '1 day', upper(range) + interval '1 day 30 minutes')
     where id = (select id from carnet.availability_exceptions
                  where profile_id = '00000000-0000-4000-8000-0038a0000011' and upper(range) > now()
                  order by lower(range) limit 1)$$,
  'point 17 : déplacer une exception à venir vers une autre date à venir reste possible au plafond (toujours 200)'
);
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-0038a0000011', 7, '23:00', '23:30')$$,
  'CN004', null, 'fiche 0038 point 6 : sur son propre profil plein, B reçoit CN004 (plafond) pour une 51e règle'
);
reset role;

-- ---------------------------------------------------------------------------
-- C. Décision 4 : refus d'une exception terminée (insertion et modification), A sur son profil PA
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0038a000000a","role":"authenticated"}';

select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-0038a0000010',
       tstzrange(date_trunc('minute', now()) - interval '5 days', date_trunc('minute', now()) - interval '4 days'), 'busy')$$,
  '23514', null, 'décision 4 : insérer une exception entièrement passée → 23514'
);
select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-0038a0000010',
       tstzrange(date_trunc('minute', now()) - interval '1 hour', date_trunc('minute', now())), 'busy')$$,
  '23514', null, 'décision 4 : une exception dont la fin vaut now() (tronqué à la minute) est terminée → 23514'
);
select lives_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-0038a0000010',
       tstzrange(date_trunc('minute', now()) - interval '1 hour', date_trunc('minute', now()) + interval '1 minute'), 'busy')$$,
  'décision 4 : une exception en cours (début passé, fin à venir) est acceptée'
);
select throws_ok(
  $$update carnet.availability_exceptions
       set range = tstzrange(date_trunc('minute', now()) - interval '2 days', date_trunc('minute', now()) - interval '1 day')
     where id = '00000000-0000-4000-8000-0038a00000a1'$$,
  '23514', null, 'décision 4 : repousser une exception à venir dans le passé → 23514 (sinon le plafond se contourne)'
);
select is(
  pg_temp.txt($$select count(*)::text from carnet.availability_exceptions
                 where profile_id = '00000000-0000-4000-8000-0038a0000010' and upper(range) <= now()$$),
  '0',
  'décision 4 : aucune exception terminée n''a été écrite pour PA'
);
reset role;

select is(
  pg_temp.txt($$select count(*)::text from carnet.availability_exceptions
                 where profile_id = '00000000-0000-4000-8000-0038a0000011' and upper(range) > now()$$),
  '200',
  'B a toujours exactement 200 exceptions à venir après les refus'
);

select * from finish();
rollback;
