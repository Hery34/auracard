-- Fiche 0003 — registre platform : comportements.
-- Critères couverts : 2 (contraintes, cascades, trigger), 4 à 9 (is_project_member), 10 (RLS en situation).
-- Personas (UUID fixes) :
--   A 0…0a  membre (owner) de alpha (projet fixture) — critères 4, 9, 10
--   A2 0…0f membre (user) de alpha (projet fixture)  — critère 10 (autre utilisateur du même projet)
--   B 0…0b  authentifié sans appartenance     — critères 5, 10
--   C 0…0c  membre de other (autre projet)    — critères 6, 10
--   D 0…0d  membre de archived_one            — critère 8 (le projet est archivé en cours de test)
--   anon    rôle anon, claims sans sub        — critères 7, 10
-- Les fixtures sont créées par postgres (bypassrls) dans la transaction et annulées par le rollback final (critère 14).
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(37);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'a-alpha@test.local'),
  ('00000000-0000-4000-8000-00000000000b', 'b-no-member@test.local'),
  ('00000000-0000-4000-8000-00000000000c', 'c-other@test.local'),
  ('00000000-0000-4000-8000-00000000000d', 'd-archived@test.local'),
  ('00000000-0000-4000-8000-00000000000f', 'a2-alpha@test.local');

insert into platform.projects (id, slug, name, db_schema, status) values
  ('00000000-0000-4000-8000-000000000001', 'alpha', 'Alpha', 'alpha', 'active'),
  ('00000000-0000-4000-8000-000000000002', 'other', 'Other', 'other', 'active'),
  ('00000000-0000-4000-8000-000000000003', 'archived_one', 'Archived one', 'archived_one', 'active');

insert into platform.project_members (project_id, user_id, role) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'owner'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000c', 'user'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000d', 'user'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000f', 'user');

-- ---------------------------------------------------------------------------
-- Critère 2 — contraintes (en tant que postgres)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into platform.projects (slug, name, db_schema) values ('alpha', 'Doublon', 'alpha_dup')$$,
  '23505', null, 'critère 2 : projects.slug est unique'
);
select throws_ok(
  $$insert into platform.projects (slug, name, db_schema) values ('alpha_dup', 'Doublon', 'alpha')$$,
  '23505', null, 'critère 2 : projects.db_schema est unique'
);
select throws_ok(
  $$insert into platform.projects (slug, name, db_schema, status) values ('paused_one', 'Paused', 'paused_one', 'paused')$$,
  '23514', null, 'critère 2 : projects.status refuse une valeur hors (active, archived)'
);
select throws_ok(
  $$insert into platform.projects (slug, name, db_schema) values ('Bad-Slug', 'Bad', 'bad_slug')$$,
  '23514', null, 'critère 2 : projects.slug refuse une valeur hors ^[a-z][a-z0-9_]*$'
);
select throws_ok(
  $$insert into platform.projects (slug, name, db_schema) values ('bad_schema', 'Bad', '1bad_schema')$$,
  '23514', null, 'critère 2 : projects.db_schema refuse une valeur hors ^[a-z][a-z0-9_]*$'
);
select throws_ok(
  $$insert into platform.project_members (project_id, user_id, role)
    values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000b', 'superuser')$$,
  '23514', null, 'critère 2 : project_members.role refuse une valeur hors (owner, admin, user)'
);

-- Critère 2 — on delete cascade depuis projects
insert into platform.projects (id, slug, name, db_schema)
  values ('00000000-0000-4000-8000-000000000004', 'doomed', 'Doomed', 'doomed');
insert into platform.project_members (project_id, user_id)
  values ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-00000000000b');
select lives_ok(
  $$delete from platform.projects where id = '00000000-0000-4000-8000-000000000004'$$,
  'critère 2 : supprimer un projet ayant des membres ne viole pas la clé étrangère (on delete cascade)'
);
select is(
  (select count(*) from platform.project_members where project_id = '00000000-0000-4000-8000-000000000004'),
  0::bigint,
  'critère 2 : supprimer un projet supprime ses appartenances'
);

-- Critère 2 — on delete cascade depuis auth.users
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000e', 'e-doomed@test.local');
insert into platform.project_members (project_id, user_id)
  values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000e');
select lives_ok(
  $$delete from auth.users where id = '00000000-0000-4000-8000-00000000000e'$$,
  'critère 2 : supprimer un compte auth.users ayant des appartenances ne viole pas la clé étrangère (on delete cascade)'
);
select is(
  (select count(*) from platform.project_members where user_id = '00000000-0000-4000-8000-00000000000e'),
  0::bigint,
  'critère 2 : supprimer un compte auth.users supprime ses appartenances'
);

-- Critère 2 — trigger updated_at (now() est figé dans la transaction : on part d'une valeur passée explicite)
insert into platform.projects (id, slug, name, db_schema, updated_at)
  values ('00000000-0000-4000-8000-000000000005', 'stamped', 'Stamped', 'stamped', '2000-01-01');
update platform.projects set name = 'Stamped again' where id = '00000000-0000-4000-8000-000000000005';
select is(
  (select updated_at from platform.projects where id = '00000000-0000-4000-8000-000000000005'),
  now(),
  'critère 2 : le trigger met projects.updated_at à now() lors d''un update'
);

-- ---------------------------------------------------------------------------
-- Critères 4 à 9 — platform.is_project_member
-- ---------------------------------------------------------------------------
-- A : membre de alpha (projet fixture, active)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is(platform.is_project_member('alpha'), true, 'critère 4 : un membre d''un projet active obtient true pour ce projet');
select is(platform.is_project_member('unknown_project'), false, 'critère 9 : un slug inconnu donne false');
select ok(platform.is_project_member('unknown_project') is not null, 'critère 9 : un slug inconnu ne donne jamais null');
reset role;

-- B : authentifié sans appartenance
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is(platform.is_project_member('alpha'), false, 'critère 5 : un compte authentifié sans appartenance obtient false');
reset role;

-- C : membre d'un autre projet de l'instance
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}';
select is(platform.is_project_member('alpha'), false, 'critère 6 : un membre d''un autre projet obtient false pour alpha (projet fixture)');
select is(platform.is_project_member('other'), true, 'critère 6 : un membre d''un autre projet obtient true pour son propre projet');
reset role;

-- Anonyme.
-- 7a : auth.uid() nul (JWT sans sub, ex. service_role) dans un contexte autorisé à appeler la fonction :
--      false, jamais null ni erreur.
set local request.jwt.claims = '{"role":"anon"}';
select is(platform.is_project_member('alpha'), false, 'critère 7 : auth.uid() nul (visiteur anonyme) donne false');
-- 7b : le rôle anon lui-même ne peut pas appeler la fonction (execute révoqué, pas d'usage sur le schéma).
set local role anon;
select throws_ok(
  $$select platform.is_project_member('alpha')$$,
  '42501', null, 'critères 3 et 7 : le rôle anon ne peut pas appeler is_project_member'
);
reset role;

-- D : membre d'un projet que l'on passe en archived pendant le test
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated"}';
select is(platform.is_project_member('archived_one'), true, 'critère 8 (précondition) : le membre obtient true tant que le projet est active');
reset role;
update platform.projects set status = 'archived' where slug = 'archived_one';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated"}';
select is(platform.is_project_member('archived_one'), false, 'critère 8 : un projet passé en archived donne false à ses membres, sans toucher aux appartenances');
reset role;

-- ---------------------------------------------------------------------------
-- Critère 10 — RLS en situation
-- ---------------------------------------------------------------------------
-- A : lit sa ligne, rien d'autre, n'écrit nulle part
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select results_eq(
  $$select user_id from platform.project_members$$,
  $$values ('00000000-0000-4000-8000-00000000000a'::uuid)$$,
  'critère 10 : un compte authentifié ne voit que ses propres appartenances'
);
select is(
  (select count(*) from platform.project_members where user_id = '00000000-0000-4000-8000-00000000000c'),
  0::bigint,
  'critère 10 : un compte authentifié ne lit pas les appartenances d''un autre compte'
);
select is(
  (select count(*) from platform.project_members where user_id = '00000000-0000-4000-8000-00000000000f'),
  0::bigint,
  'critère 10 : un compte authentifié ne lit pas l''appartenance d''un autre membre du même projet'
);
select throws_ok(
  $$insert into platform.project_members (project_id, user_id)
    values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a')$$,
  '42501', null, 'critère 10 : un compte authentifié ne peut pas insérer dans project_members'
);
select throws_ok(
  $$update platform.project_members set role = 'owner' where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'critère 10 : un compte authentifié ne peut pas modifier project_members'
);
select throws_ok(
  $$delete from platform.project_members where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'critère 10 : un compte authentifié ne peut pas supprimer dans project_members'
);
select throws_ok(
  $$select * from platform.projects$$,
  '42501', null, 'critère 10 : un compte authentifié ne lit rien dans projects'
);
select throws_ok(
  $$insert into platform.projects (slug, name, db_schema) values ('intruder', 'Intruder', 'intruder')$$,
  '42501', null, 'critère 10 : un compte authentifié ne peut pas insérer dans projects'
);
select throws_ok(
  $$update platform.projects set name = 'Intruder' where slug = 'alpha'$$,
  '42501', null, 'critère 10 : un compte authentifié ne peut pas modifier projects'
);
select throws_ok(
  $$delete from platform.projects where slug = 'alpha'$$,
  '42501', null, 'critère 10 : un compte authentifié ne peut pas supprimer dans projects'
);
reset role;

-- A2 : autre utilisateur du même projet que A
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000f","role":"authenticated"}';
select results_eq(
  $$select user_id from platform.project_members$$,
  $$values ('00000000-0000-4000-8000-00000000000f'::uuid)$$,
  'critère 10 : un autre membre du même projet ne voit que sa propre appartenance'
);
select is(
  (select count(*) from platform.project_members where user_id = '00000000-0000-4000-8000-00000000000a'),
  0::bigint,
  'critère 10 : un autre membre du même projet ne lit pas l''appartenance de A'
);
reset role;

-- B : authentifié sans appartenance
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is_empty(
  $$select * from platform.project_members$$,
  'critère 10 : un compte sans appartenance ne voit aucune ligne de project_members'
);
reset role;

-- C : membre d'un autre projet de l'instance
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}';
select results_eq(
  $$select user_id from platform.project_members$$,
  $$values ('00000000-0000-4000-8000-00000000000c'::uuid)$$,
  'critère 10 : un membre d''un autre projet ne voit que sa propre appartenance, pas celles d''alpha (projet fixture)'
);
reset role;

-- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select * from platform.project_members$$,
  '42501', null, 'critère 10 : anon ne lit rien dans project_members'
);
select throws_ok(
  $$select * from platform.projects$$,
  '42501', null, 'critère 10 : anon ne lit rien dans projects'
);
reset role;

select * from finish();
rollback;
