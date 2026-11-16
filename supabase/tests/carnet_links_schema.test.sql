-- Fiche 0016 — table carnet.links : structure, contraintes nommées, trigger, RLS (déclaratif), privilèges,
-- propriétés de carnet.replace_links et carnet.get_public_links, contraintes en comportement, cascade.
-- Critères couverts : 1 (déclaratif), 2 (contraintes en comportement), 3 (déclaratif), 4 (cascade).
-- Décision 8 : contraintes links_url_charset_check, links_url_host_check, links_label_charset_check ; execute de
-- replace_links retiré à service_role ; verrou for update dans replace_links ; get_public_links sans filtre is_published.
-- Décision 8, second audit : url en ASCII imprimable, hôte [A-Za-z0-9.-] (port facultatif), libellé sans points de code
-- invisibles listés (U+200D autorisé), links_label_blank_check, verrou for no key update et 42501 si aucune ligne verrouillée.
-- Les comportements par persona, replace_links et get_public_links en situation sont dans carnet_links_access.test.sql.
-- Fixtures (postgres, bypassrls, plage 0…16xx propre à cette fiche ; 0…1602 et 0…160a–0…160d appartiennent au fichier access) :
--   comptes auth.users : 0…1601 propriétaire du profil 0…1610 (contraintes, trigger) ; 0…1603 propriétaire du profil 0…1611 (cascade)
--   liens : 0…1630 (trigger), 0…1631 (cascade)
-- Tout s'exécute dans une transaction annulée : rien ne persiste.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(156);

-- ---------------------------------------------------------------------------
-- Critère 1 — table et colonnes (décision 1)
-- ---------------------------------------------------------------------------
select has_table('carnet', 'links', 'critère 1 : la table carnet.links existe');
select columns_are(
  'carnet', 'links',
  array['id', 'profile_id', 'platform', 'url', 'label', 'position', 'created_at', 'updated_at'],
  'critère 1 : links a exactement les colonnes de la décision 1'
);

select col_type_is('carnet', 'links', 'id', 'uuid', 'critère 1 : links.id est uuid');
select col_not_null('carnet', 'links', 'id', 'critère 1 : links.id est not null');
select col_default_is('carnet', 'links', 'id', 'gen_random_uuid()', 'critère 1 : links.id a pour défaut gen_random_uuid()');
select col_is_pk('carnet', 'links', 'id', 'critère 1 : links.id est la clé primaire');

select col_type_is('carnet', 'links', 'profile_id', 'uuid', 'critère 1 : links.profile_id est uuid');
select col_not_null('carnet', 'links', 'profile_id', 'critère 1 : links.profile_id est not null');
select fk_ok('carnet', 'links', 'profile_id', 'carnet', 'profiles', 'id', 'critère 1 : links.profile_id référence carnet.profiles(id)');

select col_type_is('carnet', 'links', 'platform', 'text', 'critère 1 : links.platform est text');
select col_not_null('carnet', 'links', 'platform', 'critère 1 : links.platform est not null');

select col_type_is('carnet', 'links', 'url', 'text', 'critère 1 : links.url est text');
select col_not_null('carnet', 'links', 'url', 'critère 1 : links.url est not null');

select col_type_is('carnet', 'links', 'label', 'text', 'critère 1 : links.label est text');
select col_is_null('carnet', 'links', 'label', 'critère 1 : links.label est nullable');

select col_type_is('carnet', 'links', 'position', 'smallint', 'critère 1 : links.position est smallint');
select col_not_null('carnet', 'links', 'position', 'critère 1 : links.position est not null');

select col_type_is('carnet', 'links', 'created_at', 'timestamp with time zone', 'critère 1 : links.created_at est timestamptz');
select col_not_null('carnet', 'links', 'created_at', 'critère 1 : links.created_at est not null');
select col_default_is('carnet', 'links', 'created_at', 'now()', 'critère 1 : links.created_at a pour défaut now()');

select col_type_is('carnet', 'links', 'updated_at', 'timestamp with time zone', 'critère 1 : links.updated_at est timestamptz');
select col_not_null('carnet', 'links', 'updated_at', 'critère 1 : links.updated_at est not null');
select col_default_is('carnet', 'links', 'updated_at', 'now()', 'critère 1 : links.updated_at a pour défaut now()');

-- ---------------------------------------------------------------------------
-- Critère 1 — contraintes nommées (décision 3)
-- ---------------------------------------------------------------------------
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet' and c.relname = 'links'
       and k.conname = 'links_pkey' and k.contype = 'p'
  ),
  'critère 1 : la clé primaire se nomme links_pkey'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet' and c.relname = 'links'
       and k.conname = 'links_profile_id_fkey' and k.contype = 'f'
       and k.confrelid = 'carnet.profiles'::regclass
       and k.confdeltype = 'c'
  ),
  'critère 4 : la clé étrangère links_profile_id_fkey → carnet.profiles est on delete cascade'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet' and c.relname = 'links'
       and k.conname = 'links_profile_id_position_key' and k.contype = 'u'
       and k.conkey = array[
         (select attnum from pg_attribute where attrelid = c.oid and attname = 'profile_id'),
         (select attnum from pg_attribute where attrelid = c.oid and attname = 'position')
       ]::int2[]
  ),
  'critère 1 (décision 3) : la contrainte unique (profile_id, position) se nomme links_profile_id_position_key'
);
select ok(
  coalesce((
    select k.condeferrable
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet' and c.relname = 'links'
       and k.conname = 'links_profile_id_position_key'
  ), false),
  'critère 2 (décision 3) : links_profile_id_position_key est différable (réordonnancement dans une transaction)'
);

select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
     where n.nspname = 'carnet' and c.relname = 'links'
       and k.conname = 'links_platform_check' and k.contype = 'c' and a.attname = 'platform'
  ),
  'critère 1 (décision 2) : la contrainte check sur platform se nomme links_platform_check'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
     where n.nspname = 'carnet' and c.relname = 'links'
       and k.conname = 'links_url_https_check' and k.contype = 'c' and a.attname = 'url'
  ),
  'critère 1 (décision 3) : la contrainte check « https:// » sur url se nomme links_url_https_check'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
     where n.nspname = 'carnet' and c.relname = 'links'
       and k.conname = 'links_url_length_check' and k.contype = 'c' and a.attname = 'url'
  ),
  'critère 1 (décision 3) : la contrainte check de longueur sur url se nomme links_url_length_check'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
     where n.nspname = 'carnet' and c.relname = 'links'
       and k.conname = 'links_label_length_check' and k.contype = 'c' and a.attname = 'label'
  ),
  'critère 1 (décision 3) : la contrainte check de longueur sur label se nomme links_label_length_check'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
     where n.nspname = 'carnet' and c.relname = 'links'
       and k.conname = 'links_position_range_check' and k.contype = 'c' and a.attname = 'position'
  ),
  'critère 1 (décision 3) : la contrainte check de plage sur position se nomme links_position_range_check'
);

select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
     where n.nspname = 'carnet' and c.relname = 'links'
       and k.conname = 'links_url_charset_check' and k.contype = 'c' and a.attname = 'url'
  ),
  'critère 2 (décision 8) : la contrainte check « ASCII imprimable seulement » sur url se nomme links_url_charset_check'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
     where n.nspname = 'carnet' and c.relname = 'links'
       and k.conname = 'links_url_host_check' and k.contype = 'c' and a.attname = 'url'
  ),
  'critère 2 (décision 8) : la contrainte check « hôte [A-Za-z0-9.-] et port facultatif après https:// » sur url se nomme links_url_host_check'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
     where n.nspname = 'carnet' and c.relname = 'links'
       and k.conname = 'links_label_charset_check' and k.contype = 'c' and a.attname = 'label'
  ),
  'critère 2 (décision 8) : la contrainte check « aucun point de code de contrôle ou invisible listé » sur label se nomme links_label_charset_check'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
     where n.nspname = 'carnet' and c.relname = 'links'
       and k.conname = 'links_label_blank_check' and k.contype = 'c' and a.attname = 'label'
  ),
  'critère 2 (décision 8) : la contrainte check « au moins un caractère non blanc » sur label se nomme links_label_blank_check'
);

-- pg_index direct : is_indexed compare pg_get_indexdef, qui cite "position" (mot-clé) et ne reconnaît pas la colonne.
select ok(
  exists (
    select 1
      from pg_index i
     where i.indrelid = to_regclass('carnet.links')
       and i.indkey[0] = (select attnum from pg_attribute where attrelid = to_regclass('carnet.links') and attname = 'profile_id')
  ),
  'critère 1 : un index commence par profile_id (couvre la clé étrangère)'
);

-- RLS enable + force
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'carnet' and c.relname = 'links'),
  'critère 1 : row level security activée sur carnet.links'
);
select ok(
  (select c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'carnet' and c.relname = 'links'),
  'critère 1 : row level security forcée sur carnet.links'
);

-- Trigger updated_at (décision 1)
select ok(
  exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc f on f.oid = t.tgfoid
      join pg_namespace fn on fn.oid = f.pronamespace
     where n.nspname = 'carnet'
       and c.relname = 'links'
       and t.tgname = 'links_set_updated_at'
       and not t.tgisinternal
       and t.tgenabled <> 'D'
       and t.tgtype & 1 = 1    -- for each row
       and t.tgtype & 2 = 2    -- before
       and t.tgtype & 16 = 16  -- update
       and fn.nspname = 'carnet'
       and f.proname = 'set_updated_at'
  ),
  'critère 1 : le trigger links_set_updated_at (before update for each row) appelle carnet.set_updated_at()'
);

-- ---------------------------------------------------------------------------
-- Critère 1 — politiques RLS (décision 4) : déclaratif
-- ---------------------------------------------------------------------------
select policies_are(
  'carnet', 'links',
  array['links_select_own', 'links_insert_own', 'links_update_own', 'links_delete_own'],
  'critère 1 (décision 4) : links a exactement quatre politiques, une par opération'
);
select policy_roles_are('carnet', 'links', 'links_select_own', array['authenticated'], 'critère 1 : links_select_own s''applique au seul rôle authenticated');
select policy_roles_are('carnet', 'links', 'links_insert_own', array['authenticated'], 'critère 1 : links_insert_own s''applique au seul rôle authenticated');
select policy_roles_are('carnet', 'links', 'links_update_own', array['authenticated'], 'critère 1 : links_update_own s''applique au seul rôle authenticated');
select policy_roles_are('carnet', 'links', 'links_delete_own', array['authenticated'], 'critère 1 : links_delete_own s''applique au seul rôle authenticated');
select policy_cmd_is('carnet', 'links', 'links_select_own', 'SELECT', 'critère 1 : links_select_own est une politique select');
select policy_cmd_is('carnet', 'links', 'links_insert_own', 'INSERT', 'critère 1 : links_insert_own est une politique insert');
select policy_cmd_is('carnet', 'links', 'links_update_own', 'UPDATE', 'critère 1 : links_update_own est une politique update');
select policy_cmd_is('carnet', 'links', 'links_delete_own', 'DELETE', 'critère 1 : links_delete_own est une politique delete');

select ok(
  exists (
    select 1
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet' and c.relname = 'links' and p.polname = 'links_select_own'
       and pg_get_expr(p.polqual, p.polrelid) ~* '\(\s*select\s+carnet\.can_edit_profile\(\s*links\.profile_id|\(\s*select\s+carnet\.can_edit_profile\(\s*profile_id'
  ),
  'critère 1 (décision 4) : links_select_own utilise (select carnet.can_edit_profile(profile_id))'
);
select ok(
  exists (
    select 1
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet' and c.relname = 'links' and p.polname = 'links_insert_own'
       and pg_get_expr(p.polwithcheck, p.polrelid) ~* '\(\s*select\s+carnet\.can_edit_profile\('
  ),
  'critère 1 (décision 4) : links_insert_own vérifie (select carnet.can_edit_profile(profile_id)) en with check'
);
select ok(
  exists (
    select 1
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet' and c.relname = 'links' and p.polname = 'links_update_own'
       and pg_get_expr(p.polqual, p.polrelid) ~* '\(\s*select\s+carnet\.can_edit_profile\('
       and pg_get_expr(p.polwithcheck, p.polrelid) ~* '\(\s*select\s+carnet\.can_edit_profile\('
  ),
  'critère 1 (décision 4) : links_update_own utilise can_edit_profile en using et en with check (pas de déplacement vers un autre profil)'
);
select ok(
  exists (
    select 1
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet' and c.relname = 'links' and p.polname = 'links_delete_own'
       and pg_get_expr(p.polqual, p.polrelid) ~* '\(\s*select\s+carnet\.can_edit_profile\('
  ),
  'critère 1 (décision 4) : links_delete_own utilise (select carnet.can_edit_profile(profile_id))'
);

-- ---------------------------------------------------------------------------
-- Critère 1 — privilèges sur la table
-- ---------------------------------------------------------------------------
select table_privs_are('carnet', 'links', 'anon', '{}'::name[], 'critère 1 : anon n''a aucun privilège sur la table links');
select table_privs_are('carnet', 'links', 'authenticated', array['DELETE', 'SELECT'], 'critère 1 (amendé 0022, décision 10) : authenticated a select et delete de table sur links (filtrés par RLS) ; ni insert ni update de table');
select is(
  (select array_agg(a.attname::text order by a.attname)
     from pg_attribute a
    where a.attrelid = 'carnet.links'::regclass
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'carnet.links', a.attname, 'INSERT')),
  array['label', 'platform', 'position', 'profile_id', 'url'],
  '0022 décision 10 : authenticated a insert sur exactement profile_id, platform, url, label, position'
);
select is(
  (select array_agg(a.attname::text order by a.attname)
     from pg_attribute a
    where a.attrelid = 'carnet.links'::regclass
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'carnet.links', a.attname, 'UPDATE')),
  array['label', 'platform', 'position', 'url'],
  '0022 décision 10 : authenticated a update sur exactement platform, url, label, position'
);
select table_privs_are(
  'carnet', 'links', 'service_role',
  array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
  'critère 1 : service_role a tous les privilèges sur links'
);
select table_privs_are('carnet', 'links', 'public', '{}'::name[], 'critère 1 : public n''a aucun privilège sur links');
select is_empty(
  $$select 1 from pg_publication_tables where schemaname = 'carnet' and tablename = 'links'$$,
  'critère 1 : carnet.links n''est pas publiée dans Realtime'
);

-- ---------------------------------------------------------------------------
-- Critère 2 — carnet.replace_links(uuid, jsonb) : propriétés (décision 5)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'replace_links', array['uuid', 'jsonb'], 'critère 2 : carnet.replace_links(uuid, jsonb) existe');
select function_returns('carnet', 'replace_links', array['uuid', 'jsonb'], 'setof carnet.links', 'critère 2 : replace_links renvoie setof carnet.links');
select isnt_definer('carnet', 'replace_links', array['uuid', 'jsonb'], 'critère 2 (décision 5) : replace_links est security invoker (soumise à la RLS)');
select volatility_is('carnet', 'replace_links', array['uuid', 'jsonb'], 'volatile', 'critère 2 : replace_links est volatile (elle écrit)');
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'replace_links'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 2 : replace_links fixe set search_path = '''' (proconfig)'
);
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'replace_links'
       and p.proargnames = array['p_profile_id', 'p_links']
  ),
  'critère 2 : les paramètres de replace_links se nomment p_profile_id et p_links'
);
select function_privs_are('carnet', 'replace_links', array['uuid', 'jsonb'], 'authenticated', array['EXECUTE'], 'critère 2 : execute accordé à authenticated sur replace_links');
select function_privs_are('carnet', 'replace_links', array['uuid', 'jsonb'], 'service_role', '{}'::name[], 'critère 2 (décision 8) : execute refusé à service_role sur replace_links (ADR 0011)');
select function_privs_are('carnet', 'replace_links', array['uuid', 'jsonb'], 'anon', '{}'::name[], 'critère 2 : execute révoqué pour anon sur replace_links');
select function_privs_are('carnet', 'replace_links', array['uuid', 'jsonb'], 'public', '{}'::name[], 'critère 2 : execute révoqué pour public sur replace_links');
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'replace_links'
       and pg_get_functiondef(p.oid) ~* 'carnet\.profiles.*for\s+no\s+key\s+update'
  ),
  'critère 2 (décision 8) : replace_links verrouille la ligne du profil (select … from carnet.profiles … for no key update)'
);
-- Non atteignable en comportement sans changer la RLS (can_edit_profile est vérifiée avant) : contrôle déclaratif.
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'replace_links'
       and pg_get_functiondef(p.oid) ~* 'for\s+no\s+key\s+update.*if\s+not\s+found\s+then\s+raise[^;]*(42501|insufficient_privilege)'
  ),
  'critère 2 (décision 8) : replace_links lève 42501 si aucune ligne du profil n''est verrouillée (if not found après le verrou)'
);

-- ---------------------------------------------------------------------------
-- Critère 3 — carnet.get_public_links(text) : propriétés (décision 6)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'get_public_links', array['text'], 'critère 3 : carnet.get_public_links(text) existe');
select is_definer('carnet', 'get_public_links', array['text'], 'critère 3 (décision 6) : get_public_links est security definer');
select volatility_is('carnet', 'get_public_links', array['text'], 'stable', 'critère 3 (décision 6) : get_public_links est stable');
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'get_public_links'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 3 (décision 6) : get_public_links fixe set search_path = '''' (proconfig)'
);
select ok(
  coalesce((
    select bool_and(r.rolbypassrls or r.rolsuper)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
     where n.nspname = 'carnet' and p.proname = 'get_public_links'
  ), false),
  'critère 3 : le propriétaire de get_public_links (security definer) contourne la RLS'
);
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'get_public_links'
       and p.proretset
       and p.proargnames = array['p_slug', 'platform', 'url', 'label', 'position']
       and p.proargmodes = array['i', 't', 't', 't', 't']::"char"[]
       and p.proallargtypes = array['text'::regtype, 'text'::regtype, 'text'::regtype, 'text'::regtype, 'smallint'::regtype]::oid[]
  ),
  'critère 3 (décision 6) : get_public_links(p_slug text) returns table(platform text, url text, label text, position smallint), sans id ni profile_id'
);
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'get_public_links'
       and pg_get_functiondef(p.oid) ~* 'carnet\.public_profiles'
  ),
  'critère 3 (décision 7) : get_public_links s''appuie sur la vue carnet.public_profiles (même règle de visibilité que get_public_profile)'
);
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'get_public_links'
       and pg_get_functiondef(p.oid) !~* 'is_published'
  ),
  'critère 3 (décision 8) : get_public_links ne filtre pas is_published elle-même (la vue public_profiles porte seule la règle)'
);
select function_privs_are('carnet', 'get_public_links', array['text'], 'anon', array['EXECUTE'], 'critère 3 (décision 6) : execute accordé à anon sur get_public_links');
select function_privs_are('carnet', 'get_public_links', array['text'], 'authenticated', array['EXECUTE'], 'critère 3 (décision 6) : execute accordé à authenticated sur get_public_links');
select function_privs_are('carnet', 'get_public_links', array['text'], 'service_role', array['EXECUTE'], 'critère 3 : execute accordé à service_role sur get_public_links');
select function_privs_are('carnet', 'get_public_links', array['text'], 'public', '{}'::name[], 'critère 3 : execute révoqué pour public sur get_public_links');

-- Invariant : get_public_profile n'est pas modifiée par la fiche (signature conservée).
select function_returns('carnet', 'get_public_profile', array['text'], 'setof carnet.public_profiles', 'hors périmètre : get_public_profile conserve sa signature');

-- ---------------------------------------------------------------------------
-- Critère 2 — contraintes en comportement (postgres, bypassrls)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000001601', 's1-links-0016@test.local'),
  ('00000000-0000-4000-8000-000000001603', 's3-cascade-0016@test.local');
insert into carnet.profiles (id, owner_id, slug, display_name) values
  ('00000000-0000-4000-8000-000000001610', '00000000-0000-4000-8000-000000001601', 'links-s1-0016', 'Links S1'),
  ('00000000-0000-4000-8000-000000001611', '00000000-0000-4000-8000-000000001603', 'links-s3-0016', 'Links S3');

-- Les dix plateformes de la liste fermée sont acceptées (positions 0 à 9).
select lives_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    select '00000000-0000-4000-8000-000000001610', p.platform, 'https://example.test/' || p.platform, (p.n - 1)::smallint
      from unnest(array['linkedin', 'x', 'instagram', 'facebook', 'github', 'youtube', 'tiktok', 'whatsapp', 'website', 'document'])
           with ordinality as p(platform, n)$$,
  'critère 2 (décision 2) : les dix plateformes de la liste fermée sont acceptées'
);
select is(
  (select count(*) from carnet.links where profile_id = '00000000-0000-4000-8000-000000001610'),
  10::bigint,
  'critère 2 (décision 2) : dix liens enregistrés, un par plateforme'
);
delete from carnet.links where profile_id = '00000000-0000-4000-8000-000000001610';

select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'mastodon', 'https://example.test/m', 0)$$,
  '23514', null, 'critère 2 (décision 2) : une plateforme hors liste est refusée'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'LinkedIn', 'https://example.test/l', 0)$$,
  '23514', null, 'critère 2 (décision 2) : la plateforme est sensible à la casse (LinkedIn refusé)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', '', 'https://example.test/e', 0)$$,
  '23514', null, 'critère 2 (décision 2) : une plateforme vide est refusée'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', null, 'https://example.test/n', 0)$$,
  '23502', null, 'critère 2 : une plateforme nulle est refusée'
);

select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'http://example.test', 0)$$,
  '23514', null, 'critère 2 : une url en http:// est refusée'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'javascript:alert(1)', 0)$$,
  '23514', null, 'critère 2 : une url en javascript: est refusée'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', ' https://example.test', 0)$$,
  '23514', null, 'critère 2 : une url qui ne commence pas exactement par https:// est refusée (espace initial)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'HTTPS://exemple.fr', 0)$$,
  '23514', null, 'critère 2 (décision 7) : le schéma d''url est en minuscules, HTTPS://exemple.fr est refusée'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'data:text/html,x', 0)$$,
  '23514', null, 'critère 2 : une url en data: est refusée'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://' || repeat('a', 2041), 0)$$,
  '23514', null, 'critère 2 : une url de 2049 caractères est refusée'
);
select lives_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://' || repeat('a', 2040), 0)$$,
  'critère 2 : une url https:// de 2048 caractères est acceptée'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', null, 1)$$,
  '23502', null, 'critère 2 : une url nulle est refusée'
);

select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', '', 1)$$,
  '23514', null, 'critère 2 : un label vide est refusé'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', repeat('l', 41), 1)$$,
  '23514', null, 'critère 2 : un label de 41 caractères est refusé'
);
select lives_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', repeat('l', 40), 1)$$,
  'critère 2 : un label de 40 caractères est accepté'
);
select lives_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', 'l', 2)$$,
  'critère 2 : un label d''un caractère est accepté'
);
select lives_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'github', 'https://example.test/gh', null, 11)$$,
  'critère 2 : un label nul et la position 11 sont acceptés'
);

select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', -1)$$,
  '23514', null, 'critère 2 : la position -1 est refusée'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', 12)$$,
  '23514', null, 'critère 2 (décision 3) : la position 12 est refusée (au plus 12 liens par profil)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test')$$,
  '23502', null, 'critère 2 : une position absente est refusée'
);

select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', E'https://example.test/a\nb', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_url_charset_check"',
  'critère 2 (décision 8) : une url contenant un saut de ligne (\n) est refusée (links_url_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', E'https://example.test/a\rb', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_url_charset_check"',
  'critère 2 (décision 8) : une url contenant un retour chariot (\r) est refusée (links_url_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', E'https://example.test/a\tb', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_url_charset_check"',
  'critère 2 (décision 8) : une url contenant une tabulation (\t) est refusée (links_url_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test/a b', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_url_charset_check"',
  'critère 2 (décision 8) : une url contenant un espace interne est refusée (links_url_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_url_host_check"',
  'critère 2 (décision 8) : l''url « https:// » seule (hôte vide) est refusée (links_url_host_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https:///x', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_url_host_check"',
  'critère 2 (décision 8) : l''url « https:///x » (hôte vide) est refusée (links_url_host_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', E'Site\u202Eevil', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_label_charset_check"',
  'critère 2 (décision 8) : un label contenant U+202E (RIGHT-TO-LEFT OVERRIDE) est refusé (links_label_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', E'Site\u2066x', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_label_charset_check"',
  'critère 2 (décision 8) : un label contenant U+2066 (LEFT-TO-RIGHT ISOLATE) est refusé (links_label_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', E'Site\u0007', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_label_charset_check"',
  'critère 2 (décision 8) : un label contenant U+0007 (caractère de contrôle BEL) est refusé (links_label_charset_check)'
);
select lives_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'document', 'https://example.test/a/b.pdf?x=1&y=%C3%A9#p2', 'Café · Brochure', 3)$$,
  'critère 2 (décision 8) : une url avec chemin, requête, encodage % et fragment et un label accentué sont acceptés'
);
-- Décision 8, second audit : contraintes indépendantes de la locale.
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', E'https://example.test/a\u00A0b', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_url_charset_check"',
  'critère 2 (décision 8, second audit) : une url contenant U+00A0 (NO-BREAK SPACE) dans le chemin est refusée (links_url_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', E'https://example.test/a\u2028b', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_url_charset_check"',
  'critère 2 (décision 8, second audit) : une url contenant U+2028 (LINE SEPARATOR) dans le chemin est refusée (links_url_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', E'https://example.test/a\u200Bb', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_url_charset_check"',
  'critère 2 (décision 8, second audit) : une url contenant U+200B (ZERO WIDTH SPACE) dans le chemin est refusée (links_url_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', E'https://example.test/a\uFEFFb', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_url_charset_check"',
  'critère 2 (décision 8, second audit) : une url contenant U+FEFF (ZERO WIDTH NO-BREAK SPACE) dans le chemin est refusée (links_url_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', E'https://example.test/a\u0085b', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_url_charset_check"',
  'critère 2 (décision 8, second audit) : une url contenant U+0085 (NEXT LINE) dans le chemin est refusée (links_url_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://exémple.fr', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_url_charset_check"',
  'critère 2 (décision 8, second audit) : une url avec un caractère non ASCII (https://exémple.fr) est refusée (links_url_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://linkedin.com@evil.test', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_url_host_check"',
  'critère 2 (décision 8, second audit) : une url avec information utilisateur (https://linkedin.com@evil.test) est refusée (links_url_host_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://\x', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_url_host_check"',
  'critère 2 (décision 8, second audit) : une url avec une barre oblique inverse dans l''hôte (https://\x) est refusée (links_url_host_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://:443', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_url_host_check"',
  'critère 2 (décision 8, second audit) : une url avec un port sans hôte (https://:443) est refusée (links_url_host_check)'
);
select lives_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://xn--exmple-cva.fr/a?b=1#c', 4)$$,
  'critère 2 (décision 8, second audit) : une url à nom de domaine punycode avec requête et fragment est acceptée'
);
select lives_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://exemple.fr:8443/x', 5)$$,
  'critère 2 (décision 8, second audit) : une url avec un port explicite est acceptée'
);
select lives_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://exemple.fr', 6)$$,
  'critère 2 (décision 8, second audit) : une url réduite à l''hôte est acceptée'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', E'a\u0085b', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_label_charset_check"',
  'critère 2 (décision 8, second audit) : un label contenant U+0085 (NEXT LINE) entre deux lettres est refusé (links_label_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', E'a\u00ADb', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_label_charset_check"',
  'critère 2 (décision 8, second audit) : un label contenant U+00AD (SOFT HYPHEN) entre deux lettres est refusé (links_label_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', E'a\u200Bb', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_label_charset_check"',
  'critère 2 (décision 8, second audit) : un label contenant U+200B (ZERO WIDTH SPACE) entre deux lettres est refusé (links_label_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', E'a\u200Eb', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_label_charset_check"',
  'critère 2 (décision 8, second audit) : un label contenant U+200E (LEFT-TO-RIGHT MARK) entre deux lettres est refusé (links_label_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', E'a\u200Fb', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_label_charset_check"',
  'critère 2 (décision 8, second audit) : un label contenant U+200F (RIGHT-TO-LEFT MARK) entre deux lettres est refusé (links_label_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', E'a\u2028b', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_label_charset_check"',
  'critère 2 (décision 8, second audit) : un label contenant U+2028 (LINE SEPARATOR) entre deux lettres est refusé (links_label_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', E'a\u2060b', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_label_charset_check"',
  'critère 2 (décision 8, second audit) : un label contenant U+2060 (WORD JOINER) entre deux lettres est refusé (links_label_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', E'a\uFEFFb', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_label_charset_check"',
  'critère 2 (décision 8, second audit) : un label contenant U+FEFF (ZERO WIDTH NO-BREAK SPACE) entre deux lettres est refusé (links_label_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', E'a\u061Cb', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_label_charset_check"',
  'critère 2 (décision 8, second audit) : un label contenant U+061C (ARABIC LETTER MARK) entre deux lettres est refusé (links_label_charset_check)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', '   ', 3)$$,
  '23514', 'new row for relation "links" violates check constraint "links_label_blank_check"',
  'critère 2 (décision 8, second audit) : un label fait seulement d''espaces est refusé (links_label_blank_check)'
);
select lives_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', E'Dev \U0001F469\u200D\U0001F4BB', 7)$$,
  'critère 2 (décision 8, second audit) : un label avec un émoji composé par U+200D (ZERO WIDTH JOINER) est accepté'
);
select lives_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001610', 'website', 'https://example.test', 'Éléonore Müller', 8)$$,
  'critère 2 (décision 8, second audit) : un label accentué est accepté'
);
delete from carnet.links where profile_id = '00000000-0000-4000-8000-000000001610' and position between 3 and 8;

-- Unicité (profile_id, position), vérifiée au plus tard à la fin de la transaction.
select throws_ok(
  $q$do $do$
    begin
      insert into carnet.links (profile_id, platform, url, position)
        values ('00000000-0000-4000-8000-000000001610', 'x', 'https://example.test/dup', 0);
      set constraints carnet.links_profile_id_position_key immediate;
    end
  $do$$q$,
  '23505', null, 'critère 2 (décision 3) : deux liens à la même position du même profil sont refusés'
);
-- Différabilité en comportement : un échange de positions en une seule instruction n'est possible que si la
-- contrainte est différable (une contrainte unique non différable est vérifiée ligne à ligne).
select lives_ok(
  $$update carnet.links
       set position = case position when 0 then 1 else 0 end
     where profile_id = '00000000-0000-4000-8000-000000001610' and position in (0, 1)$$,
  'critère 2 (décision 3) : échanger les positions 0 et 1 en une instruction est accepté (contrainte différable)'
);
select lives_ok(
  $$set constraints carnet.links_profile_id_position_key immediate$$,
  'critère 2 : après l''échange, la contrainte d''unicité est satisfaite'
);
select results_eq(
  $$select position, label from carnet.links where profile_id = '00000000-0000-4000-8000-000000001610' order by position$$,
  $$values (0::smallint, repeat('l', 40)), (1::smallint, null::text), (2::smallint, 'l'::text), (11::smallint, null::text)$$,
  'critère 2 : l''échange a bien inversé les liens des positions 0 et 1'
);
select lives_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001611', 'x', 'https://example.test/other', 0)$$,
  'critère 2 : la même position est acceptée sur un autre profil'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-0000000016ff', 'x', 'https://example.test/ghost', 0)$$,
  '23503', null, 'critère 1 : un lien vers un profil inexistant est refusé (clé étrangère)'
);

-- Trigger updated_at (now() est figé dans la transaction : on part d'une valeur passée explicite)
select lives_ok(
  $$insert into carnet.links (id, profile_id, platform, url, position, updated_at)
    values ('00000000-0000-4000-8000-000000001630', '00000000-0000-4000-8000-000000001610', 'tiktok', 'https://example.test/tt', 5, '2000-01-01')$$,
  'critère 1 (précondition) : un lien est créé avec updated_at dans le passé'
);
select lives_ok(
  $$update carnet.links set label = 'TikTok' where id = '00000000-0000-4000-8000-000000001630'$$,
  'critère 1 (précondition) : le lien est mis à jour'
);
select is(
  (select updated_at from carnet.links where id = '00000000-0000-4000-8000-000000001630'),
  now(),
  'critère 1 : le trigger met links.updated_at à now() lors d''un update'
);

-- ---------------------------------------------------------------------------
-- Critère 4 — suppression du profil → liens supprimés (cascade)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into carnet.links (id, profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001631', '00000000-0000-4000-8000-000000001611', 'github', 'https://example.test/gh3', 1)$$,
  'critère 4 (précondition) : un second lien sur le profil voué à la suppression'
);
select lives_ok(
  $$delete from carnet.profiles where id = '00000000-0000-4000-8000-000000001611'$$,
  'critère 4 (précondition) : le profil est supprimé'
);
select is(
  (select count(*) from carnet.links where profile_id = '00000000-0000-4000-8000-000000001611'),
  0::bigint,
  'critère 4 : la suppression du profil supprime ses liens (cascade)'
);
select is(
  (select count(*) from carnet.links where profile_id = '00000000-0000-4000-8000-000000001610'),
  5::bigint,
  'critère 4 : les liens des autres profils sont intacts'
);
-- Cascade transitive : la suppression du compte supprime le profil, puis ses liens.
select lives_ok(
  $$delete from auth.users where id = '00000000-0000-4000-8000-000000001601'$$,
  'critère 4 (précondition) : le compte propriétaire du profil 0…1610 est supprimé'
);
select is(
  (select count(*) from carnet.links where profile_id = '00000000-0000-4000-8000-000000001610'),
  0::bigint,
  'critère 4 : la suppression du compte supprime, par cascade, profil et liens'
);

select * from finish();
rollback;
