-- Fiche 0038, décision 4 (Hery, 18/11/2026) — fonctions écrites par db-architect, sur le modèle de
-- carnet.replace_links (0016) : security invoker, execute accordé à authenticated seul, RLS du propriétaire.
--   carnet.replace_availability_rules(p_profile_id uuid, p_rules jsonb) returns setof carnet.availability_rules
--     Décision 1 : remplace toute la liste des règles en une transaction (un refus laisse les règles précédentes).
--     p_rules : tableau JSON d'objets { weekday: nombre, start_time: texte, end_time: texte } ('24:00' accepté en fin) ;
--     sinon 22023. Profil non modifiable par l'appelant → 42501, y compris avec une liste vide (jamais un succès muet).
--     Contraintes de la table : 23514 (bornes, minutes), CN004 (plafond de 50, fiche 0038 point 6), 23P01
--     (chevauchement).
--     Renvoie les règles du profil triées par weekday puis start_time.
--   carnet.reorder_event_types(p_profile_id uuid, p_order uuid[]) returns setof carnet.event_types
--     Note de 0036 : positions 0…n−1 dans l'ordre donné, en une seule instruction (contrainte unique deferrable) ;
--     p_order doit être exactement l'ensemble des types du profil (ni manquant, ni en trop, ni doublon, ni null) → 22023 ;
--     profil non modifiable → 42501. Renvoie les types du profil triés par position.
-- Personas (plage 0038b, propre à ce fichier) :
--   A 0…a membre carnet, profil PA 0…10 : types t0 (pos 0), t1 (pos 1), t2 (pos 3) ; règles lundi 09–12 et 14–18
--   B 0…b membre carnet, profil PB 0…11 : type u0, une règle
--   C 0…d membre du projet other_0038b seul
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(30);

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

-- Règles d'un profil lues par postgres : « weekday start-end » triées.
create function pg_temp.rules_of(p_profile_id uuid) returns text
language sql as $$
  select coalesce(string_agg(format('%s %s-%s', weekday, to_char(start_time, 'HH24:MI'), to_char(end_time, 'HH24:MI')),
                             ', ' order by weekday, start_time), '')
    from carnet.availability_rules where profile_id = p_profile_id
$$;

-- Types d'un profil lus par postgres : « id:position » triés par position.
create function pg_temp.positions_of(p_profile_id uuid) returns text
language sql as $$
  select coalesce(string_agg(format('%s:%s', right(id::text, 2), position), ', ' order by position), '')
    from carnet.event_types where profile_id = p_profile_id
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0038b000000a', 'a-carnet-0038b@test.local'),
  ('00000000-0000-4000-8000-0038b000000b', 'b-carnet-0038b@test.local'),
  ('00000000-0000-4000-8000-0038b000000d', 'c-other-0038b@test.local');

insert into platform.projects (id, slug, name, db_schema)
  values ('00000000-0000-4000-8000-0038b0000002', 'other_0038b', 'Other 0038b', 'other_0038b');

insert into platform.project_members (project_id, user_id, role)
  select p.id, u.id, 'user'
    from platform.projects p
   cross join (values ('00000000-0000-4000-8000-0038b000000a'::uuid), ('00000000-0000-4000-8000-0038b000000b'::uuid)) as u (id)
   where p.slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  values ('00000000-0000-4000-8000-0038b0000002', '00000000-0000-4000-8000-0038b000000d', 'user');

insert into carnet.profiles (id, owner_id, slug, display_name) values
  ('00000000-0000-4000-8000-0038b0000010', '00000000-0000-4000-8000-0038b000000a', 'ana-0038b', 'Ana'),
  ('00000000-0000-4000-8000-0038b0000011', '00000000-0000-4000-8000-0038b000000b', 'ben-0038b', 'Ben');

insert into carnet.event_types (id, profile_id, title, duration_min, location_kind, location_text, position) values
  ('00000000-0000-4000-8000-0038b00000e0', '00000000-0000-4000-8000-0038b0000010', 'T0', 30, 'video', 'https://v.example.test/a', 0),
  ('00000000-0000-4000-8000-0038b00000e1', '00000000-0000-4000-8000-0038b0000010', 'T1', 30, 'video', 'https://v.example.test/a', 1),
  ('00000000-0000-4000-8000-0038b00000e2', '00000000-0000-4000-8000-0038b0000010', 'T2', 30, 'video', 'https://v.example.test/a', 3),
  ('00000000-0000-4000-8000-0038b00000f0', '00000000-0000-4000-8000-0038b0000011', 'U0', 30, 'video', 'https://v.example.test/b', 0);

insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
  ('00000000-0000-4000-8000-0038b0000010', 1, '09:00', '12:00'),
  ('00000000-0000-4000-8000-0038b0000010', 1, '14:00', '18:00'),
  ('00000000-0000-4000-8000-0038b0000011', 2, '10:00', '11:00');

-- ---------------------------------------------------------------------------
-- Structure et droits
-- ---------------------------------------------------------------------------
select has_function('carnet', 'replace_availability_rules', array['uuid', 'jsonb'],
  'décision 1 : carnet.replace_availability_rules(uuid, jsonb) existe');
select has_function('carnet', 'reorder_event_types', array['uuid', 'uuid[]'],
  'note de 0036 : carnet.reorder_event_types(uuid, uuid[]) existe');
select is(
  pg_temp.txt($$select string_agg(format('%s:%s', p.proname, p.prosecdef::text), ',' order by p.proname)
                  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'carnet' and p.proname in ('replace_availability_rules', 'reorder_event_types')$$),
  'reorder_event_types:false,replace_availability_rules:false',
  'les deux fonctions sont security invoker (RLS de l''appelant)'
);
select is(
  pg_temp.txt($$select string_agg(format('%s(%s)', p.proname, array_to_string(p.proargnames, ',')), ' ' order by p.proname)
                  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'carnet' and p.proname in ('replace_availability_rules', 'reorder_event_types')$$),
  'reorder_event_types(p_profile_id,p_order) replace_availability_rules(p_profile_id,p_rules)',
  'décision 4 : noms des paramètres (appel rpc par nom) p_profile_id/p_order et p_profile_id/p_rules'
);
select is(
  pg_temp.txt($$select format('%s/%s/%s',
      has_function_privilege('authenticated', 'carnet.replace_availability_rules(uuid, jsonb)', 'execute')::text,
      has_function_privilege('anon', 'carnet.replace_availability_rules(uuid, jsonb)', 'execute')::text,
      has_function_privilege('service_role', 'carnet.replace_availability_rules(uuid, jsonb)', 'execute')::text)$$),
  'true/false/false',
  'replace_availability_rules : execute pour authenticated seul (jamais anon ni service_role, ADR 0011)'
);
select is(
  pg_temp.txt($$select format('%s/%s/%s',
      has_function_privilege('authenticated', 'carnet.reorder_event_types(uuid, uuid[])', 'execute')::text,
      has_function_privilege('anon', 'carnet.reorder_event_types(uuid, uuid[])', 'execute')::text,
      has_function_privilege('service_role', 'carnet.reorder_event_types(uuid, uuid[])', 'execute')::text)$$),
  'true/false/false',
  'reorder_event_types : execute pour authenticated seul'
);

-- ---------------------------------------------------------------------------
-- A, propriétaire de PA
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0038b000000a","role":"authenticated"}';

select is(
  pg_temp.txt($$select string_agg(format('%s %s-%s', weekday, to_char(start_time, 'HH24:MI'), to_char(end_time, 'HH24:MI')), ', ')
                  from carnet.replace_availability_rules('00000000-0000-4000-8000-0038b0000010',
                       '[{"weekday": 3, "start_time": "14:00", "end_time": "18:00"},
                         {"weekday": 1, "start_time": "09:30", "end_time": "12:00"},
                         {"weekday": 6, "start_time": "20:00", "end_time": "24:00"}]'::jsonb)$$),
  '1 09:30-12:00, 3 14:00-18:00, 6 20:00-24:00',
  'décision 1 : la liste remplace les règles et revient triée par weekday puis start_time (24:00 accepté en fin)'
);
select is(pg_temp.rules_of('00000000-0000-4000-8000-0038b0000010'), '1 09:30-12:00, 3 14:00-18:00, 6 20:00-24:00',
  'décision 1 : la table contient exactement la nouvelle liste (anciennes règles supprimées)');
select is(
  pg_temp.txt($$select count(*)::text from carnet.replace_availability_rules('00000000-0000-4000-8000-0038b0000010',
                       '[{"weekday": 3, "start_time": "14:00", "end_time": "18:00"},
                         {"weekday": 1, "start_time": "09:30", "end_time": "12:00"},
                         {"weekday": 6, "start_time": "20:00", "end_time": "24:00"}]'::jsonb)$$),
  '3',
  'idempotence : la même liste rejouée donne les mêmes 3 règles'
);
select is(pg_temp.rules_of('00000000-0000-4000-8000-0038b0000010'), '1 09:30-12:00, 3 14:00-18:00, 6 20:00-24:00',
  'idempotence : aucun doublon après le rejeu');

select throws_ok(
  $$select * from carnet.replace_availability_rules('00000000-0000-4000-8000-0038b0000010',
      '[{"weekday": 1, "start_time": "09:00", "end_time": "12:00"}, {"weekday": 1, "start_time": "11:00", "end_time": "13:00"}]'::jsonb)$$,
  '23P01', null, 'note de 0036 : deux règles qui se chevauchent → 23P01'
);
select throws_ok(
  $$select * from carnet.replace_availability_rules('00000000-0000-4000-8000-0038b0000010',
      (select jsonb_agg(jsonb_build_object('weekday', (g % 7) + 1, 'start_time', to_char(make_time(g / 7, 0, 0), 'HH24:MI'),
                                           'end_time', to_char(make_time(g / 7, 30, 0), 'HH24:MI')))
         from generate_series(0, 50) g))$$,
  'CN004', null, 'fiche 0038 point 6 : 51 règles → CN004 (trigger de plafond)'
);
select throws_ok(
  $$select * from carnet.replace_availability_rules('00000000-0000-4000-8000-0038b0000010',
      '[{"weekday": 1, "start_time": "09:00", "end_time": "09:04"}]'::jsonb)$$,
  '23514', null, 'point 17 : une plage de 4 minutes → 23514'
);
select is(pg_temp.rules_of('00000000-0000-4000-8000-0038b0000010'), '1 09:30-12:00, 3 14:00-18:00, 6 20:00-24:00',
  'décision 1 : après les refus, les règles précédentes sont intactes');

select throws_ok(
  $$select * from carnet.replace_availability_rules('00000000-0000-4000-8000-0038b0000010', '{"weekday": 1}'::jsonb)$$,
  '22023', null, 'p_rules qui n''est pas un tableau → 22023'
);
select throws_ok(
  $$select * from carnet.replace_availability_rules('00000000-0000-4000-8000-0038b0000010',
      '[{"weekday": "1", "start_time": "09:00", "end_time": "12:00"}]'::jsonb)$$,
  '22023', null, 'weekday qui n''est pas un nombre JSON → 22023'
);
select throws_ok(
  $$select * from carnet.replace_availability_rules('00000000-0000-4000-8000-0038b0000010',
      '[{"weekday": 1, "start_time": "09:00"}]'::jsonb)$$,
  '22023', null, 'élément sans end_time → 22023'
);

select is(
  pg_temp.txt($$select string_agg(format('%s:%s', right(id::text, 2), position), ', ' order by position)
                  from carnet.reorder_event_types('00000000-0000-4000-8000-0038b0000010',
                       array['00000000-0000-4000-8000-0038b00000e2', '00000000-0000-4000-8000-0038b00000e0',
                             '00000000-0000-4000-8000-0038b00000e1']::uuid[])$$),
  'e2:0, e0:1, e1:2',
  'note de 0036 : positions 0…n−1 dans l''ordre donné, trou comblé, en une instruction'
);
select is(
  pg_temp.txt($$select string_agg(format('%s:%s', right(id::text, 2), position), ', ' order by position)
                  from carnet.reorder_event_types('00000000-0000-4000-8000-0038b0000010',
                       array['00000000-0000-4000-8000-0038b00000e0', '00000000-0000-4000-8000-0038b00000e2',
                             '00000000-0000-4000-8000-0038b00000e1']::uuid[])$$),
  'e0:0, e2:1, e1:2',
  'note de 0036 : permutation de positions occupées (0 ↔ 1) sans 23505'
);
select is(
  pg_temp.txt($$select string_agg(format('%s:%s', right(id::text, 2), position), ', ' order by position)
                  from carnet.reorder_event_types('00000000-0000-4000-8000-0038b0000010',
                       array['00000000-0000-4000-8000-0038b00000e0', '00000000-0000-4000-8000-0038b00000e2',
                             '00000000-0000-4000-8000-0038b00000e1']::uuid[])$$),
  'e0:0, e2:1, e1:2',
  'idempotence : le même ordre rejoué donne le même résultat'
);
select throws_ok(
  $$select * from carnet.reorder_event_types('00000000-0000-4000-8000-0038b0000010',
      array['00000000-0000-4000-8000-0038b00000e0', '00000000-0000-4000-8000-0038b00000e1']::uuid[])$$,
  '22023', null, 'un type manquant → 22023'
);
select throws_ok(
  $$select * from carnet.reorder_event_types('00000000-0000-4000-8000-0038b0000010',
      array['00000000-0000-4000-8000-0038b00000e0', '00000000-0000-4000-8000-0038b00000e1',
            '00000000-0000-4000-8000-0038b00000e2', '00000000-0000-4000-8000-0038b00000f0']::uuid[])$$,
  '22023', null, 'le type d''un autre profil en plus → 22023'
);
select throws_ok(
  $$select * from carnet.reorder_event_types('00000000-0000-4000-8000-0038b0000010',
      array['00000000-0000-4000-8000-0038b00000e0', '00000000-0000-4000-8000-0038b00000e0',
            '00000000-0000-4000-8000-0038b00000e1']::uuid[])$$,
  '22023', null, 'un doublon → 22023'
);
select throws_ok(
  $$select * from carnet.reorder_event_types('00000000-0000-4000-8000-0038b0000010', null)$$,
  '22023', null, 'p_order null → 22023'
);
select is(pg_temp.positions_of('00000000-0000-4000-8000-0038b0000010'), 'e0:0, e2:1, e1:2',
  'après les refus, les positions sont intactes');

select throws_ok(
  $$select * from carnet.replace_availability_rules('00000000-0000-4000-8000-0038b0000011', '[]'::jsonb)$$,
  '42501', null, 'critère 2 : A vide les règles de PB → 42501 (jamais un succès muet)'
);
select throws_ok(
  $$select * from carnet.reorder_event_types('00000000-0000-4000-8000-0038b0000011',
      array['00000000-0000-4000-8000-0038b00000f0']::uuid[])$$,
  '42501', null, 'critère 2 : A réordonne les types de PB → 42501'
);
reset role;

-- Compte d'un autre projet et anon
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0038b000000d","role":"authenticated"}';
select throws_ok(
  $$select * from carnet.replace_availability_rules('00000000-0000-4000-8000-0038b0000010', '[]'::jsonb)$$,
  '42501', null, 'critère 2 : un compte d''un autre projet vide les règles de PA → 42501'
);
reset role;

set local role anon;
select throws_ok(
  $$select * from carnet.reorder_event_types('00000000-0000-4000-8000-0038b0000010',
      array['00000000-0000-4000-8000-0038b00000e0']::uuid[])$$,
  '42501', null, 'anon : execute refusé → 42501'
);
reset role;

select is(pg_temp.rules_of('00000000-0000-4000-8000-0038b0000011'), '2 10:00-11:00', 'critère 2 : les règles de PB sont intactes');

select * from finish();
rollback;
