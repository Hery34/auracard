-- Fiche 0004 — schéma carnet : création, enregistrement au registre platform, fonction carnet.is_member().
-- Critères couverts : 1, 2, 3, 4, 5, 7. Le critère 6 (PostgREST, Accept-Profile) n'est pas testable en pgTAP :
-- il est vérifié par l'orchestrateur avec curl.
-- Personas (UUID fixes, plage 0…04xx propre à cette fiche) :
--   A 0…040a  membre (owner) de carnet          — critère 4 (true, puis false une fois carnet archivé)
--   B 0…040b  authentifié sans appartenance     — critère 4
--   C 0…040c  membre de other (autre projet)    — critère 4
--   anon      rôle anon / claims sans sub       — critères 3 et 4
-- La ligne `carnet` de platform.projects est posée par la migration : le test la lit, ne la réinsère pas.
-- Les fixtures sont créées par postgres (bypassrls) dans la transaction et annulées par le rollback final (critère 7).
-- La bascule de carnet en `archived` modifie la ligne du registre : elle est placée en dernier et annulée par le rollback.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- ---------------------------------------------------------------------------
-- Critère 1 — le schéma carnet existe, rien dans public
-- ---------------------------------------------------------------------------
select has_schema('carnet', 'critère 1 : le schéma carnet existe');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
  0::bigint,
  'critère 1 : aucune relation (table, vue, séquence, index) dans public'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
  0::bigint,
  'critère 1 : aucune fonction dans public'
);

-- ---------------------------------------------------------------------------
-- Critère 2 — enregistrement au registre (lu en tant que postgres, bypassrls)
-- La double application de la migration est prouvée par db-architect (migration repair + migration up).
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from platform.projects where slug = 'carnet'),
  1::bigint,
  'critère 2 : platform.projects contient exactement une ligne de slug carnet'
);
select results_eq(
  $$select slug, db_schema, status from platform.projects where slug = 'carnet'$$,
  $$values ('carnet'::text, 'carnet'::text, 'active'::text)$$,
  'critère 2 : la ligne carnet a db_schema = carnet et status = active'
);

-- ---------------------------------------------------------------------------
-- Critère 3 — fonction carnet.is_member() : déclaratif
-- ---------------------------------------------------------------------------
select has_function('carnet', 'is_member', '{}'::name[], 'critère 3 : carnet.is_member() existe');
select function_returns('carnet', 'is_member', '{}'::name[], 'boolean', 'critère 3 : is_member renvoie boolean');
select function_lang_is('carnet', 'is_member', '{}'::name[], 'sql', 'critère 3 : is_member est en language sql');
select volatility_is('carnet', 'is_member', '{}'::name[], 'stable', 'critère 3 : is_member est stable');
select isnt_definer('carnet', 'is_member', '{}'::name[], 'critère 3 : is_member est security invoker (pas de nouvelle surface definer)');

select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'is_member'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 3 : is_member fixe set search_path = '''' (proconfig)'
);

-- Décision de conception 2 : is_member délègue à platform.is_project_member (nom qualifié, pas de logique dupliquée).
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'is_member'
       and pg_get_functiondef(p.oid) ~* 'platform\.is_project_member\('
  ),
  'critère 3 (décision 2) : is_member appelle platform.is_project_member par son nom qualifié'
);

select function_privs_are('carnet', 'is_member', '{}'::name[], 'authenticated', array['EXECUTE'], 'critère 3 : execute accordé à authenticated');
select function_privs_are('carnet', 'is_member', '{}'::name[], 'service_role', array['EXECUTE'], 'critère 3 : execute accordé à service_role');
select function_privs_are('carnet', 'is_member', '{}'::name[], 'anon', '{}'::name[], 'critère 3 : execute révoqué pour anon');
select function_privs_are('carnet', 'is_member', '{}'::name[], 'public', '{}'::name[], 'critère 3 : execute révoqué pour public');

-- Invariant du schéma : chaque fonction de carnet est suivie d'un revoke execute … from public
-- et de grants nominatifs. Une proacl nulle signifie ACL par défaut, donc execute pour public (grantee 0).
select is_empty(
  $$select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and (
         p.proacl is null
         or exists (
           select 1
             from aclexplode(p.proacl) a
            where a.grantee = 0
              and a.privilege_type = 'EXECUTE'
         )
       )$$,
  'critère 3 : aucune fonction de carnet n''est exécutable par public'
);

-- ---------------------------------------------------------------------------
-- Critère 5 — privilèges du schéma
-- ---------------------------------------------------------------------------
select schema_privs_are('carnet', 'anon', array['USAGE'], 'critère 5 : anon a usage sur le schéma carnet');
select schema_privs_are('carnet', 'authenticated', array['USAGE'], 'critère 5 : authenticated a usage sur le schéma carnet');
select schema_privs_are('carnet', 'service_role', array['USAGE'], 'critère 5 : service_role a usage sur le schéma carnet');
select schema_privs_are('carnet', 'public', '{}'::name[], 'critère 5 : public n''a aucun privilège sur le schéma carnet');

-- Décision 3 : aucun alter default privileges dans carnet. Une table témoin créée après la migration (annulée par le rollback)
-- ne doit donner aucun privilège implicite aux rôles API ; chaque table recevra ses grants explicites dans sa fiche.
select lives_ok(
  $$create table carnet.default_privs_probe (id integer)$$,
  'critère 5 : une table témoin peut être créée dans carnet par postgres'
);
select table_privs_are('carnet', 'default_privs_probe', 'anon', '{}'::name[], 'critère 5 : anon n''a aucun privilège par défaut sur une nouvelle table de carnet');
select table_privs_are('carnet', 'default_privs_probe', 'authenticated', '{}'::name[], 'critère 5 : authenticated n''a aucun privilège par défaut sur une nouvelle table de carnet');
select table_privs_are('carnet', 'default_privs_probe', 'public', '{}'::name[], 'critère 5 : public n''a aucun privilège par défaut sur une nouvelle table de carnet');

-- Aucune entrée de pg_default_acl (schéma carnet ou globale) n'accorde quoi que ce soit à anon, authenticated ou public.
select is_empty(
  $$select d.defaclrole::regrole::text as for_role,
           coalesce(n.nspname, '<global>') as in_schema,
           d.defaclobjtype as objtype,
           coalesce(r.rolname, 'public') as grantee,
           a.privilege_type
      from pg_default_acl d
      left join pg_namespace n on n.oid = d.defaclnamespace
      cross join lateral aclexplode(d.defaclacl) a
      left join pg_roles r on r.oid = a.grantee
     where (n.nspname = 'carnet' or d.defaclnamespace = 0)
       and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))$$,
  'critère 5 : aucun privilège par défaut (carnet ou global) pour anon, authenticated ou public'
);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres) — la ligne carnet du registre vient de la migration : on lit son id.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000040a', 'a-carnet-0004@test.local'),
  ('00000000-0000-4000-8000-00000000040b', 'b-no-member-0004@test.local'),
  ('00000000-0000-4000-8000-00000000040c', 'c-other-0004@test.local');

insert into platform.projects (id, slug, name, db_schema)
  values ('00000000-0000-4000-8000-000000000402', 'other', 'Other', 'other');

insert into platform.project_members (project_id, user_id, role)
  select id, '00000000-0000-4000-8000-00000000040a', 'owner' from platform.projects where slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  values ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-00000000040c', 'user');

-- ---------------------------------------------------------------------------
-- Critère 3 — en situation : le rôle anon ne peut pas appeler is_member (usage sur le schéma, execute révoqué)
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select carnet.is_member()$$,
  '42501', null, 'critère 3 : le rôle anon ne peut pas appeler carnet.is_member()'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 4 — carnet.is_member() en situation
-- ---------------------------------------------------------------------------
-- A : membre de carnet (active)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000040a","role":"authenticated"}';
select is(carnet.is_member(), true, 'critère 4 : un membre de carnet obtient true');
reset role;

-- B : authentifié sans appartenance
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000040b","role":"authenticated"}';
select is(carnet.is_member(), false, 'critère 4 : un compte authentifié sans appartenance obtient false');
reset role;

-- C : membre d'un autre projet de l'instance
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000040c","role":"authenticated"}';
select is(carnet.is_member(), false, 'critère 4 : un membre d''un autre projet de l''instance obtient false');
reset role;

-- auth.uid() nul : claims sans sub, dans un contexte autorisé à appeler la fonction (postgres).
set local request.jwt.claims = '{"role":"anon"}';
select is(carnet.is_member(), false, 'critère 4 : auth.uid() nul (claims sans sub) donne false');

-- carnet passé en archived (dernier test : modifie la ligne du registre, annulée par le rollback)
update platform.projects set status = 'archived' where slug = 'carnet';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000040a","role":"authenticated"}';
select is(carnet.is_member(), false, 'critère 4 : un membre de carnet obtient false une fois le projet archived');
reset role;

select * from finish();
rollback;
