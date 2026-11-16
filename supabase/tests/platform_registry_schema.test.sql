-- Fiche 0003 — registre platform : structure, fonction, RLS déclarative, privilèges, propreté de public.
-- Critères couverts : 2 (déclaratif), 3, 10 (déclaratif), 11, 13.
-- Les comportements (contraintes, cascades, trigger, is_project_member, RLS en situation)
-- sont dans platform_registry_access.test.sql.
-- Tout s'exécute dans une transaction annulée : rien ne persiste (critère 14).
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(82);

-- ---------------------------------------------------------------------------
-- Critère 2 — schéma et tables
-- ---------------------------------------------------------------------------
select has_schema('platform', 'critère 2 : le schéma platform existe');
select has_table('platform', 'projects', 'critère 2 : la table platform.projects existe');
select has_table('platform', 'project_members', 'critère 2 : la table platform.project_members existe');

-- platform.projects
select col_type_is('platform', 'projects', 'id', 'uuid', 'critère 2 : projects.id est uuid');
select col_not_null('platform', 'projects', 'id', 'critère 2 : projects.id est not null');
select col_default_is('platform', 'projects', 'id', 'gen_random_uuid()', 'critère 2 : projects.id a pour défaut gen_random_uuid()');
select col_is_pk('platform', 'projects', 'id', 'critère 2 : projects.id est la clé primaire');

select col_type_is('platform', 'projects', 'slug', 'text', 'critère 2 : projects.slug est text');
select col_not_null('platform', 'projects', 'slug', 'critère 2 : projects.slug est not null');
select col_is_unique('platform', 'projects', 'slug', 'critère 2 : projects.slug porte une contrainte unique');

select col_type_is('platform', 'projects', 'name', 'text', 'critère 2 : projects.name est text');
select col_not_null('platform', 'projects', 'name', 'critère 2 : projects.name est not null');

select col_type_is('platform', 'projects', 'db_schema', 'text', 'critère 2 : projects.db_schema est text');
select col_not_null('platform', 'projects', 'db_schema', 'critère 2 : projects.db_schema est not null');
select col_is_unique('platform', 'projects', 'db_schema', 'critère 2 : projects.db_schema porte une contrainte unique');

select col_type_is('platform', 'projects', 'status', 'text', 'critère 2 : projects.status est text');
select col_not_null('platform', 'projects', 'status', 'critère 2 : projects.status est not null');
select col_default_is('platform', 'projects', 'status', 'active', 'critère 2 : projects.status a pour défaut ''active''');
select col_has_check('platform', 'projects', 'status', 'critère 2 : projects.status porte une contrainte check');

select col_type_is('platform', 'projects', 'created_at', 'timestamp with time zone', 'critère 2 : projects.created_at est timestamptz');
select col_not_null('platform', 'projects', 'created_at', 'critère 2 : projects.created_at est not null');
select col_default_is('platform', 'projects', 'created_at', 'now()', 'critère 2 : projects.created_at a pour défaut now()');

select col_type_is('platform', 'projects', 'updated_at', 'timestamp with time zone', 'critère 2 : projects.updated_at est timestamptz');
select col_not_null('platform', 'projects', 'updated_at', 'critère 2 : projects.updated_at est not null');
select col_default_is('platform', 'projects', 'updated_at', 'now()', 'critère 2 : projects.updated_at a pour défaut now()');

select ok(
  exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'platform'
       and c.relname = 'projects'
       and not t.tgisinternal
       and t.tgenabled <> 'D'
       and t.tgtype & 1 = 1    -- for each row
       and t.tgtype & 2 = 2    -- before
       and t.tgtype & 16 = 16  -- update
  ),
  'critère 2 : un trigger before update for each row maintient projects.updated_at'
);

-- platform.project_members
select col_type_is('platform', 'project_members', 'project_id', 'uuid', 'critère 2 : project_members.project_id est uuid');
select col_not_null('platform', 'project_members', 'project_id', 'critère 2 : project_members.project_id est not null');
select fk_ok('platform', 'project_members', 'project_id', 'platform', 'projects', 'id', 'critère 2 : project_members.project_id référence platform.projects(id)');

select col_type_is('platform', 'project_members', 'user_id', 'uuid', 'critère 2 : project_members.user_id est uuid');
select col_not_null('platform', 'project_members', 'user_id', 'critère 2 : project_members.user_id est not null');
select fk_ok('platform', 'project_members', 'user_id', 'auth', 'users', 'id', 'critère 2 : project_members.user_id référence auth.users(id)');

select col_type_is('platform', 'project_members', 'role', 'text', 'critère 2 : project_members.role est text');
select col_not_null('platform', 'project_members', 'role', 'critère 2 : project_members.role est not null');
select col_default_is('platform', 'project_members', 'role', 'user', 'critère 2 : project_members.role a pour défaut ''user''');
select col_has_check('platform', 'project_members', 'role', 'critère 2 : project_members.role porte une contrainte check');

select col_type_is('platform', 'project_members', 'created_at', 'timestamp with time zone', 'critère 2 : project_members.created_at est timestamptz');
select col_not_null('platform', 'project_members', 'created_at', 'critère 2 : project_members.created_at est not null');
select col_default_is('platform', 'project_members', 'created_at', 'now()', 'critère 2 : project_members.created_at a pour défaut now()');

select col_is_pk('platform', 'project_members', array['project_id', 'user_id'], 'critère 2 : project_members a pour clé primaire (project_id, user_id)');
select is_indexed('platform', 'project_members', 'user_id', 'critère 2 : project_members.user_id est indexé');

-- ---------------------------------------------------------------------------
-- Critère 3 — fonction platform.is_project_member(text)
-- ---------------------------------------------------------------------------
select has_function('platform', 'is_project_member', array['text'], 'critère 3 : platform.is_project_member(text) existe');
select function_returns('platform', 'is_project_member', array['text'], 'boolean', 'critère 3 : is_project_member renvoie boolean');
select function_lang_is('platform', 'is_project_member', array['text'], 'sql', 'critère 3 : is_project_member est en language sql');
select is_definer('platform', 'is_project_member', array['text'], 'critère 3 : is_project_member est security definer');
select ok(
  (select r.rolbypassrls or r.rolsuper
     from pg_proc p
     join pg_roles r on r.oid = p.proowner
    where p.oid = 'platform.is_project_member(text)'::regprocedure),
  'critère 3 : le propriétaire de is_project_member (security definer) contourne la RLS'
);
select volatility_is('platform', 'is_project_member', array['text'], 'stable', 'critère 3 : is_project_member est stable');

select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname = 'is_project_member'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 3 : is_project_member fixe set search_path = '''' (proconfig)'
);

select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname = 'is_project_member'
       and pg_get_functiondef(p.oid) ~* '\(\s*select\s+auth\.uid\(\)'
  ),
  'critère 3 : auth.uid() est enveloppé dans (select …)'
);

select function_privs_are('platform', 'is_project_member', array['text'], 'authenticated', array['EXECUTE'], 'critère 3 : execute accordé à authenticated');
select function_privs_are('platform', 'is_project_member', array['text'], 'service_role', array['EXECUTE'], 'critère 3 : execute accordé à service_role');
select function_privs_are('platform', 'is_project_member', array['text'], 'anon', '{}'::name[], 'critère 3 : execute révoqué pour anon');
select function_privs_are('platform', 'is_project_member', array['text'], 'public', '{}'::name[], 'critère 3 : execute révoqué pour public');

-- ---------------------------------------------------------------------------
-- Critère 10 — RLS déclarative
-- ---------------------------------------------------------------------------
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'platform' and c.relname = 'projects'),
  'critère 10 : row level security activée sur platform.projects'
);
select ok(
  (select c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'platform' and c.relname = 'projects'),
  'critère 10 : row level security forcée sur platform.projects'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'platform' and c.relname = 'project_members'),
  'critère 10 : row level security activée sur platform.project_members'
);
select ok(
  (select c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'platform' and c.relname = 'project_members'),
  'critère 10 : row level security forcée sur platform.project_members'
);

select policies_are('platform', 'project_members', array['project_members_select_own'], 'critère 10 : project_members a exactement la politique project_members_select_own');
select policies_are('platform', 'projects', '{}'::name[], 'critère 10 : projects n''a aucune politique');
select policy_roles_are('platform', 'project_members', 'project_members_select_own', array['authenticated'], 'critère 10 : project_members_select_own s''applique au seul rôle authenticated');
select policy_cmd_is('platform', 'project_members', 'project_members_select_own', 'SELECT', 'critère 10 : project_members_select_own est une politique select (pas de for all)');

-- ---------------------------------------------------------------------------
-- Critère 11 — privilèges
-- ---------------------------------------------------------------------------
select schema_privs_are('platform', 'anon', '{}'::name[], 'critère 11 : anon n''a aucun privilège sur le schéma platform');
select schema_privs_are('platform', 'public', '{}'::name[], 'critère 11 : public n''a aucun privilège sur le schéma platform');
select schema_privs_are('platform', 'authenticated', array['USAGE'], 'critère 11 : authenticated a usage sur le schéma platform');
select schema_privs_are('platform', 'service_role', array['USAGE'], 'critère 11 : service_role a usage sur le schéma platform');

select table_privs_are('platform', 'project_members', 'authenticated', array['SELECT'], 'critère 11 : authenticated a seulement select sur project_members');
select table_privs_are('platform', 'projects', 'authenticated', '{}'::name[], 'critère 11 : authenticated n''a aucun privilège sur projects');
select table_privs_are('platform', 'project_members', 'anon', '{}'::name[], 'critère 11 : anon n''a aucun privilège sur project_members');
select table_privs_are('platform', 'projects', 'anon', '{}'::name[], 'critère 11 : anon n''a aucun privilège sur projects');
select table_privs_are('platform', 'project_members', 'public', '{}'::name[], 'critère 11 : public n''a aucun privilège sur project_members');
select table_privs_are('platform', 'projects', 'public', '{}'::name[], 'critère 11 : public n''a aucun privilège sur projects');
select table_privs_are(
  'platform', 'project_members', 'service_role',
  array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
  'critère 11 : service_role a tous les privilèges sur project_members'
);
select table_privs_are(
  'platform', 'projects', 'service_role',
  array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
  'critère 11 : service_role a tous les privilèges sur projects'
);

-- Privilèges par défaut : une table créée après la migration dans platform (annulée par le rollback)
-- doit automatiquement donner tous les privilèges à service_role.
select lives_ok(
  $$create table platform.default_privs_probe (id integer)$$,
  'critère 11 : une table témoin peut être créée dans platform par postgres'
);
select table_privs_are(
  'platform', 'default_privs_probe', 'service_role',
  array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
  'critère 11 : alter default privileges donne tous les privilèges à service_role sur une nouvelle table de platform'
);
select table_privs_are('platform', 'default_privs_probe', 'anon', '{}'::name[], 'critère 11 : anon n''a aucun privilège par défaut sur une nouvelle table de platform');
select table_privs_are('platform', 'default_privs_probe', 'authenticated', '{}'::name[], 'critère 11 : authenticated n''a aucun privilège par défaut sur une nouvelle table de platform');
select table_privs_are('platform', 'default_privs_probe', 'public', '{}'::name[], 'critère 11 : public n''a aucun privilège par défaut sur une nouvelle table de platform');

-- Invariant du schéma : chaque fonction de platform est suivie d'un revoke execute … from public
-- et de grants nominatifs. Une proacl nulle signifie ACL par défaut, donc execute pour public (grantee 0).
select is_empty(
  $$select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and (
         p.proacl is null
         or exists (
           select 1
             from aclexplode(p.proacl) a
            where a.grantee = 0
              and a.privilege_type = 'EXECUTE'
         )
       )$$,
  'critère 11 : aucune fonction de platform n''est exécutable par public'
);

-- La fonction de trigger n'est pas exécutable par public.
select function_privs_are('platform', 'set_updated_at', '{}'::name[], 'public', '{}'::name[], 'critère 11 : execute révoqué pour public sur platform.set_updated_at()');

-- ---------------------------------------------------------------------------
-- Critère 13 — rien dans public
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
  0::bigint,
  'critère 13 : aucune relation (table, vue, séquence, index) dans public'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
  0::bigint,
  'critère 13 : aucune fonction dans public'
);

select * from finish();
rollback;
