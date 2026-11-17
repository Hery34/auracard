-- Fiche 0005 — table carnet.profiles : structure, fonctions d'autorisation, politiques (déclaratif),
-- privilèges, vue carnet.public_profiles et fonction d'accès unitaire get_public_profile (déclaratif), invariants du schéma,
-- contraintes en comportement.
-- Critères couverts : 1, 2, 3 (déclaratif + invariants), 5 (déclaratif), 6 (rollback final).
-- Les comportements par persona et la vue en situation sont dans carnet_profiles_access.test.sql.
-- Non dupliqués ici (couverts par carnet_schema.test.sql, même base) : « rien dans public »,
-- « aucune fonction de carnet exécutable par public », sonde default_privs_probe.
-- Fixtures (postgres, bypassrls, plage 0…05xx propre à cette fiche). UUID utilisés par ce fichier (0…0502 appartient au fichier access) :
--   comptes auth.users : 0…0501 owner des inserts refusés (slug, theme) ; 0…0503 compte supprimé (cascade) ;
--     0…0504 / 0…0505 / 0…0508 owners des slugs acceptés « a-b », 40 caractères, « abc » ; 0…0506 owner des inserts de longueur refusés ;
--     0…0507 owner du test de trigger ; 0…0509 owner de l'insert « toutes longueurs max » ; 0…050e owner de l'insert theme accepté
--   profils : 0…0520 (trigger), 0…0521 (cascade)
-- Tout s'exécute dans une transaction annulée : rien ne persiste (critère 6).
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(164);

-- ---------------------------------------------------------------------------
-- Critère 1 — table et colonnes (décision 1)
-- ---------------------------------------------------------------------------
select has_table('carnet', 'profiles', 'critère 1 : la table carnet.profiles existe');
select columns_are(
  'carnet', 'profiles',
  array['id', 'owner_id', 'slug', 'display_name', 'job_title', 'company', 'bio', 'avatar_url', 'banner_url',
        'theme', 'contact_email', 'phone', 'website_url', 'is_published', 'is_indexable', 'created_at', 'updated_at',
        'logo_url'],
  'critère 1 (amendé 0021 : logo_url) : profiles a exactement les colonnes de la décision 1'
);

select col_type_is('carnet', 'profiles', 'id', 'uuid', 'critère 1 : profiles.id est uuid');
select col_not_null('carnet', 'profiles', 'id', 'critère 1 : profiles.id est not null');
select col_default_is('carnet', 'profiles', 'id', 'gen_random_uuid()', 'critère 1 : profiles.id a pour défaut gen_random_uuid()');
select col_is_pk('carnet', 'profiles', 'id', 'critère 1 : profiles.id est la clé primaire');

select col_type_is('carnet', 'profiles', 'owner_id', 'uuid', 'critère 1 : profiles.owner_id est uuid');
select col_not_null('carnet', 'profiles', 'owner_id', 'critère 1 : profiles.owner_id est not null');
select fk_ok('carnet', 'profiles', 'owner_id', 'auth', 'users', 'id', 'critère 1 : profiles.owner_id référence auth.users(id)');

select col_type_is('carnet', 'profiles', 'slug', 'text', 'critère 1 : profiles.slug est text');
select col_not_null('carnet', 'profiles', 'slug', 'critère 1 : profiles.slug est not null');
select col_is_unique('carnet', 'profiles', 'slug', 'critère 1 : profiles.slug porte une contrainte unique');

select col_type_is('carnet', 'profiles', 'display_name', 'text', 'critère 1 : profiles.display_name est text');
select col_not_null('carnet', 'profiles', 'display_name', 'critère 1 : profiles.display_name est not null');

select col_type_is('carnet', 'profiles', 'job_title', 'text', 'critère 1 : profiles.job_title est text');
select col_is_null('carnet', 'profiles', 'job_title', 'critère 1 : profiles.job_title est nullable');

select col_type_is('carnet', 'profiles', 'company', 'text', 'critère 1 : profiles.company est text');
select col_is_null('carnet', 'profiles', 'company', 'critère 1 : profiles.company est nullable');

select col_type_is('carnet', 'profiles', 'bio', 'text', 'critère 1 : profiles.bio est text');
select col_is_null('carnet', 'profiles', 'bio', 'critère 1 : profiles.bio est nullable');

select col_type_is('carnet', 'profiles', 'avatar_url', 'text', 'critère 1 : profiles.avatar_url est text');
select col_is_null('carnet', 'profiles', 'avatar_url', 'critère 1 : profiles.avatar_url est nullable');

select col_type_is('carnet', 'profiles', 'banner_url', 'text', 'critère 1 : profiles.banner_url est text');
select col_is_null('carnet', 'profiles', 'banner_url', 'critère 1 : profiles.banner_url est nullable');

select col_type_is('carnet', 'profiles', 'theme', 'jsonb', 'critère 1 : profiles.theme est jsonb');
select col_not_null('carnet', 'profiles', 'theme', 'critère 1 : profiles.theme est not null');
select col_default_is('carnet', 'profiles', 'theme', '{}'::jsonb, 'critère 1 : profiles.theme a pour défaut ''{}''::jsonb');

select col_type_is('carnet', 'profiles', 'contact_email', 'text', 'critère 1 : profiles.contact_email est text');
select col_is_null('carnet', 'profiles', 'contact_email', 'critère 1 : profiles.contact_email est nullable');

select col_type_is('carnet', 'profiles', 'phone', 'text', 'critère 1 : profiles.phone est text');
select col_is_null('carnet', 'profiles', 'phone', 'critère 1 : profiles.phone est nullable');

select col_type_is('carnet', 'profiles', 'website_url', 'text', 'critère 1 : profiles.website_url est text');
select col_is_null('carnet', 'profiles', 'website_url', 'critère 1 : profiles.website_url est nullable');

select col_type_is('carnet', 'profiles', 'is_published', 'boolean', 'critère 1 : profiles.is_published est boolean');
select col_not_null('carnet', 'profiles', 'is_published', 'critère 1 : profiles.is_published est not null');
select col_default_is('carnet', 'profiles', 'is_published', false, 'critère 1 : profiles.is_published a pour défaut false');

select col_type_is('carnet', 'profiles', 'is_indexable', 'boolean', 'critère 1 : profiles.is_indexable est boolean');
select col_not_null('carnet', 'profiles', 'is_indexable', 'critère 1 : profiles.is_indexable est not null');
select col_default_is('carnet', 'profiles', 'is_indexable', false, 'critère 1 : profiles.is_indexable a pour défaut false (noindex par défaut, security.md)');

select col_type_is('carnet', 'profiles', 'created_at', 'timestamp with time zone', 'critère 1 : profiles.created_at est timestamptz');
select col_not_null('carnet', 'profiles', 'created_at', 'critère 1 : profiles.created_at est not null');
select col_default_is('carnet', 'profiles', 'created_at', 'now()', 'critère 1 : profiles.created_at a pour défaut now()');

select col_type_is('carnet', 'profiles', 'updated_at', 'timestamp with time zone', 'critère 1 : profiles.updated_at est timestamptz');
select col_not_null('carnet', 'profiles', 'updated_at', 'critère 1 : profiles.updated_at est not null');
select col_default_is('carnet', 'profiles', 'updated_at', 'now()', 'critère 1 : profiles.updated_at a pour défaut now()');

-- Contraintes nommées (décisions 2 et 3 : profiles_owner_id_key est nommée pour être levée par une migration future).
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet' and c.relname = 'profiles'
       and k.conname = 'profiles_pkey' and k.contype = 'p'
  ),
  'critère 1 : la clé primaire se nomme profiles_pkey'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
     where n.nspname = 'carnet' and c.relname = 'profiles'
       and k.conname = 'profiles_slug_key' and k.contype = 'u'
       and array_length(k.conkey, 1) = 1 and a.attname = 'slug'
  ),
  'critère 1 : la contrainte unique sur slug se nomme profiles_slug_key'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
     where n.nspname = 'carnet' and c.relname = 'profiles'
       and k.conname = 'profiles_owner_id_key' and k.contype = 'u'
       and array_length(k.conkey, 1) = 1 and a.attname = 'owner_id'
  ),
  'critère 1 (décision 2) : la contrainte unique sur owner_id se nomme profiles_owner_id_key (un profil par utilisateur au MVP)'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet' and c.relname = 'profiles'
       and k.conname = 'profiles_slug_format_check' and k.contype = 'c'
  ),
  'critère 1 (décision 3) : la contrainte check de format du slug se nomme profiles_slug_format_check'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
     where n.nspname = 'carnet' and c.relname = 'profiles'
       and k.conname = 'profiles_theme_check' and k.contype = 'c'
       and a.attname = 'theme'
  ),
  'critère 1 : la contrainte check sur theme se nomme profiles_theme_check'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet' and c.relname = 'profiles'
       and k.contype = 'f'
       and k.confrelid = 'auth.users'::regclass
       and k.confdeltype = 'c'
  ),
  'critère 1 : la clé étrangère owner_id → auth.users est on delete cascade'
);

-- Index (décision 8)
select is_indexed('carnet', 'profiles', 'slug', 'critère 1 : profiles.slug est indexé');
select is_indexed('carnet', 'profiles', 'owner_id', 'critère 1 : profiles.owner_id est indexé');

-- RLS enable + force
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'carnet' and c.relname = 'profiles'),
  'critère 1 : row level security activée sur carnet.profiles'
);
select ok(
  (select c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'carnet' and c.relname = 'profiles'),
  'critère 1 : row level security forcée sur carnet.profiles'
);

-- Trigger updated_at : fonction propre à carnet (décision 1), pas de couplage avec platform.set_updated_at.
select has_function('carnet', 'set_updated_at', '{}'::name[], 'critère 1 : carnet.set_updated_at() existe');
select function_returns('carnet', 'set_updated_at', '{}'::name[], 'trigger', 'critère 1 : carnet.set_updated_at() renvoie trigger');
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'set_updated_at'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 1 : carnet.set_updated_at() fixe set search_path = '''' (proconfig)'
);
select ok(
  exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc f on f.oid = t.tgfoid
      join pg_namespace fn on fn.oid = f.pronamespace
     where n.nspname = 'carnet'
       and c.relname = 'profiles'
       and not t.tgisinternal
       and t.tgenabled <> 'D'
       and t.tgtype & 1 = 1    -- for each row
       and t.tgtype & 2 = 2    -- before
       and t.tgtype & 16 = 16  -- update
       and fn.nspname = 'carnet'
       and f.proname = 'set_updated_at'
  ),
  'critère 1 : un trigger before update for each row appelle carnet.set_updated_at() sur profiles'
);

-- ---------------------------------------------------------------------------
-- Critère 2 — fonctions d'autorisation (décision 5)
-- ---------------------------------------------------------------------------
-- can_edit_profile(uuid) : security definer, propriétaire bypassrls
select has_function('carnet', 'can_edit_profile', array['uuid'], 'critère 2 : carnet.can_edit_profile(uuid) existe');
select function_returns('carnet', 'can_edit_profile', array['uuid'], 'boolean', 'critère 2 : can_edit_profile renvoie boolean');
select is_definer('carnet', 'can_edit_profile', array['uuid'], 'critère 2 : can_edit_profile est security definer');
select volatility_is('carnet', 'can_edit_profile', array['uuid'], 'stable', 'critère 2 : can_edit_profile est stable');
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'can_edit_profile'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 2 : can_edit_profile fixe set search_path = '''' (proconfig)'
);
select ok(
  coalesce((
    select bool_and(r.rolbypassrls or r.rolsuper)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
     where n.nspname = 'carnet' and p.proname = 'can_edit_profile'
  ), false),
  'critère 2 : le propriétaire de can_edit_profile (security definer) contourne la RLS'
);
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'can_edit_profile'
       and pg_get_functiondef(p.oid) ~* 'carnet\.is_member\('
  ),
  'critère 2 (décision 5) : can_edit_profile exige carnet.is_member() (nom qualifié)'
);
select function_privs_are('carnet', 'can_edit_profile', array['uuid'], 'authenticated', array['EXECUTE'], 'critère 2 : execute accordé à authenticated sur can_edit_profile');
select function_privs_are('carnet', 'can_edit_profile', array['uuid'], 'service_role', array['EXECUTE'], 'critère 2 : execute accordé à service_role sur can_edit_profile');
select function_privs_are('carnet', 'can_edit_profile', array['uuid'], 'anon', '{}'::name[], 'critère 2 : execute révoqué pour anon sur can_edit_profile');
select function_privs_are('carnet', 'can_edit_profile', array['uuid'], 'public', '{}'::name[], 'critère 2 : execute révoqué pour public sur can_edit_profile');

-- can_read_profile_private(uuid) : security definer, propriétaire bypassrls
select has_function('carnet', 'can_read_profile_private', array['uuid'], 'critère 2 : carnet.can_read_profile_private(uuid) existe');
select function_returns('carnet', 'can_read_profile_private', array['uuid'], 'boolean', 'critère 2 : can_read_profile_private renvoie boolean');
select is_definer('carnet', 'can_read_profile_private', array['uuid'], 'critère 2 : can_read_profile_private est security definer');
select volatility_is('carnet', 'can_read_profile_private', array['uuid'], 'stable', 'critère 2 : can_read_profile_private est stable');
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'can_read_profile_private'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 2 : can_read_profile_private fixe set search_path = '''' (proconfig)'
);
select ok(
  coalesce((
    select bool_and(r.rolbypassrls or r.rolsuper)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
     where n.nspname = 'carnet' and p.proname = 'can_read_profile_private'
  ), false),
  'critère 2 : le propriétaire de can_read_profile_private (security definer) contourne la RLS'
);
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'can_read_profile_private'
       and pg_get_functiondef(p.oid) ~* 'carnet\.is_member\('
  ),
  'critère 2 (décision 5) : can_read_profile_private exige carnet.is_member() (nom qualifié)'
);
select function_privs_are('carnet', 'can_read_profile_private', array['uuid'], 'authenticated', array['EXECUTE'], 'critère 2 : execute accordé à authenticated sur can_read_profile_private');
select function_privs_are('carnet', 'can_read_profile_private', array['uuid'], 'service_role', array['EXECUTE'], 'critère 2 : execute accordé à service_role sur can_read_profile_private');
select function_privs_are('carnet', 'can_read_profile_private', array['uuid'], 'anon', '{}'::name[], 'critère 2 : execute révoqué pour anon sur can_read_profile_private');
select function_privs_are('carnet', 'can_read_profile_private', array['uuid'], 'public', '{}'::name[], 'critère 2 : execute révoqué pour public sur can_read_profile_private');

-- can_create_profile(uuid) : security invoker (ne lit pas profiles : pas de nouvelle surface definer)
select has_function('carnet', 'can_create_profile', array['uuid'], 'critère 2 : carnet.can_create_profile(uuid) existe');
select function_returns('carnet', 'can_create_profile', array['uuid'], 'boolean', 'critère 2 : can_create_profile renvoie boolean');
select isnt_definer('carnet', 'can_create_profile', array['uuid'], 'critère 2 : can_create_profile est security invoker');
select volatility_is('carnet', 'can_create_profile', array['uuid'], 'stable', 'critère 2 : can_create_profile est stable');
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'can_create_profile'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 2 : can_create_profile fixe set search_path = '''' (proconfig)'
);
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'can_create_profile'
       and pg_get_functiondef(p.oid) ~* 'carnet\.is_member\('
  ),
  'critère 2 (décision 5) : can_create_profile exige carnet.is_member() (nom qualifié)'
);
select function_privs_are('carnet', 'can_create_profile', array['uuid'], 'authenticated', array['EXECUTE'], 'critère 2 : execute accordé à authenticated sur can_create_profile');
select function_privs_are('carnet', 'can_create_profile', array['uuid'], 'service_role', array['EXECUTE'], 'critère 2 : execute accordé à service_role sur can_create_profile');
select function_privs_are('carnet', 'can_create_profile', array['uuid'], 'anon', '{}'::name[], 'critère 2 : execute révoqué pour anon sur can_create_profile');
select function_privs_are('carnet', 'can_create_profile', array['uuid'], 'public', '{}'::name[], 'critère 2 : execute révoqué pour public sur can_create_profile');

-- ---------------------------------------------------------------------------
-- Critère 3 — politiques RLS (décision 6) : déclaratif
-- ---------------------------------------------------------------------------
select policies_are(
  'carnet', 'profiles',
  array['profiles_select_own', 'profiles_update_own'],
  'critère 3 (amendé 0022, décisions 6 et 8) : profiles a exactement deux politiques, profiles_insert_own et profiles_delete_own supprimées'
);
select policy_roles_are('carnet', 'profiles', 'profiles_select_own', array['authenticated'], 'critère 3 : profiles_select_own s''applique au seul rôle authenticated');
select policy_roles_are('carnet', 'profiles', 'profiles_update_own', array['authenticated'], 'critère 3 : profiles_update_own s''applique au seul rôle authenticated');
select policy_cmd_is('carnet', 'profiles', 'profiles_select_own', 'SELECT', 'critère 3 : profiles_select_own est une politique select');
select policy_cmd_is('carnet', 'profiles', 'profiles_update_own', 'UPDATE', 'critère 3 : profiles_update_own est une politique update');

-- Chaque politique passe par une fonction d'autorisation enveloppée dans (select …) (ADR 0004, supabase.md).
select ok(
  exists (
    select 1
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet' and c.relname = 'profiles' and p.polname = 'profiles_select_own'
       and pg_get_expr(p.polqual, p.polrelid) ~* '\(\s*select\s+carnet\.can_read_profile_private\('
  ),
  'critère 3 : profiles_select_own utilise (select carnet.can_read_profile_private(…))'
);
select ok(
  not exists (
    select 1
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet' and c.relname = 'profiles' and p.polcmd in ('a', '*')
  ),
  'critère 3 (amendé 0022, décision 6) : aucune politique insert (ni all) sur profiles : la création passe par register_member'
);
select ok(
  exists (
    select 1
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet' and c.relname = 'profiles' and p.polname = 'profiles_update_own'
       and pg_get_expr(p.polqual, p.polrelid) ~* '\(\s*select\s+carnet\.can_edit_profile\('
  ),
  'critère 3 : profiles_update_own utilise (select carnet.can_edit_profile(…)) en using'
);
select ok(
  exists (
    select 1
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet' and c.relname = 'profiles' and p.polname = 'profiles_update_own'
       and pg_get_expr(p.polwithcheck, p.polrelid) ~* '\(\s*select\s+carnet\.can_create_profile\('
  ),
  'critère 3 : profiles_update_own vérifie (select carnet.can_create_profile(…)) en with check (empêche de céder un profil)'
);

-- Invariants sur tout le schéma carnet (vrais par vacuité aujourd'hui, ils protègent chaque table à venir).
select is_empty(
  $$select c.relname || '.' || p.polname
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet'
       and 0 = any (p.polroles)$$,
  'critère 3 : toute politique de carnet a un polroles explicite (jamais to public)'
);
select is_empty(
  $$select c.relname || '.' || p.polname
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet'
       and (
         0 = any (p.polroles)
         or (select oid from pg_roles where rolname = 'anon') = any (p.polroles)
       )
       and (
         coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
       ) ~* '\m(is_member|can_)'$$,
  'critère 3 : aucune politique anon ou public de carnet ne référence is_member ni une fonction can_* (anon n''a pas execute)'
);
select is_empty(
  $$select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet'
       and c.relkind in ('r', 'p')
       and not (c.relrowsecurity and c.relforcerowsecurity)$$,
  'critère 3 : toute table de carnet a la RLS activée et forcée'
);

-- Invariants complémentaires (revue 0005) : toute fonction de carnet fixe search_path ; aucune vue de carnet ne lit platform ;
-- toute vue lisible par anon est security_barrier (valeur booléenne lue dans reloptions, tolère true/on).
select is_empty(
  $$select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and not (coalesce(p.proconfig, '{}') @> array['search_path=""'])$$,
  'invariant : toute fonction de carnet fixe set search_path = '''' (proconfig)'
);
select is_empty(
  $$select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet'
       and c.relkind = 'v'
       and pg_get_viewdef(c.oid) ~* 'platform\.'$$,
  'invariant : aucune vue de carnet ne référence le schéma platform'
);
select is_empty(
  $$select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet'
       and c.relkind = 'v'
       and has_table_privilege('anon', c.oid, 'SELECT')
       and not exists (
         select 1
           from pg_options_to_table(c.reloptions) o
          where o.option_name = 'security_barrier'
            and o.option_value::boolean
       )$$,
  'invariant : toute vue de carnet lisible par anon est security_barrier'
);
select is_empty(
  $$select c.relname || '.' || p.polname
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet'
       and (
         (p.polqual is not null
          and pg_get_expr(p.polqual, p.polrelid) !~* '\(\s*select\s+carnet\.is_member\(\s*\)(\s+as\s+\w+)?\s*\)')
         or
         (p.polwithcheck is not null
          and pg_get_expr(p.polwithcheck, p.polrelid) !~* '\(\s*select\s+carnet\.is_member\(\s*\)(\s+as\s+\w+)?\s*\)')
       )$$,
  'invariant : toute politique de carnet court-circuite par (select carnet.is_member())'
);
select is_empty(
  $$select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'carnet'
       and c.relkind in ('r', 'p', 'v', 'm')
       and has_table_privilege('anon', c.oid, 'SELECT')$$,
  'invariant (décision 8 amendée) : aucune relation de carnet lisible par anon, anon n''a que des execute nominatifs'
);

-- ---------------------------------------------------------------------------
-- Critère 5 — vue carnet.public_profiles (décision 7, amendement B) et carnet.get_public_profile(text) : déclaratif ;
-- privilèges (décision 8 amendée : aucun privilège sur la vue pour anon, authenticated, public)
-- ---------------------------------------------------------------------------
select has_view('carnet', 'public_profiles', 'critère 5 : la vue carnet.public_profiles existe');
select columns_are(
  'carnet', 'public_profiles',
  array['slug', 'display_name', 'job_title', 'company', 'bio', 'avatar_url', 'banner_url', 'theme',
        'contact_email', 'phone', 'website_url', 'is_indexable', 'logo_url'],
  'critère 5 (amendé 0021, décision 9 : logo_url) : public_profiles expose exactement les colonnes publiques de la décision 7 (ni id, ni owner_id, ni horodatages)'
);
select ok(
  exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral pg_options_to_table(c.reloptions) o
     where n.nspname = 'carnet' and c.relname = 'public_profiles' and c.relkind = 'v'
       and o.option_name = 'security_barrier'
       and o.option_value::boolean
  ),
  'critère 5 : public_profiles est security_barrier'
);
select ok(
  not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral pg_options_to_table(c.reloptions) o
     where n.nspname = 'carnet' and c.relname = 'public_profiles'
       and o.option_name = 'security_invoker'
       and o.option_value::boolean
  ),
  'critère 5 (décision 7) : public_profiles n''est pas security_invoker (vue classique, droits du propriétaire)'
);
select ok(
  coalesce((
    select bool_and(r.rolbypassrls or r.rolsuper)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_roles r on r.oid = c.relowner
     where n.nspname = 'carnet' and c.relname = 'public_profiles'
  ), false),
  'critère 5 (décision 7) : le propriétaire de public_profiles contourne la RLS (seule porte publique, voulue)'
);

select table_privs_are('carnet', 'public_profiles', 'anon', '{}'::name[], 'critère 5 (amendement B) : anon n''a aucun privilège sur public_profiles');
select table_privs_are('carnet', 'public_profiles', 'authenticated', '{}'::name[], 'critère 5 (amendement B) : authenticated n''a aucun privilège sur public_profiles');
select table_privs_are('carnet', 'public_profiles', 'public', '{}'::name[], 'critère 5 : public n''a aucun privilège sur public_profiles');

-- Accès unitaire public (amendement B) : carnet.get_public_profile(p_slug text) returns setof carnet.public_profiles
select has_function('carnet', 'get_public_profile', array['text'], 'critère 5 (amendement B) : carnet.get_public_profile(text) existe');
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_class v on v.reltype = p.prorettype
      join pg_namespace vn on vn.oid = v.relnamespace
     where n.nspname = 'carnet' and p.proname = 'get_public_profile'
       and p.proretset
       and vn.nspname = 'carnet' and v.relname = 'public_profiles'
  ),
  'critère 5 (amendement B) : get_public_profile renvoie setof carnet.public_profiles'
);
select function_lang_is('carnet', 'get_public_profile', array['text'], 'sql', 'critère 5 (amendement B) : get_public_profile est en language sql');
select is_definer('carnet', 'get_public_profile', array['text'], 'critère 5 (amendement B) : get_public_profile est security definer');
select volatility_is('carnet', 'get_public_profile', array['text'], 'stable', 'critère 5 (amendement B) : get_public_profile est stable');
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'get_public_profile'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 5 (amendement B) : get_public_profile fixe set search_path = '''' (proconfig)'
);
select ok(
  coalesce((
    select bool_and(r.rolbypassrls or r.rolsuper)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
     where n.nspname = 'carnet' and p.proname = 'get_public_profile'
  ), false),
  'critère 5 (amendement B) : le propriétaire de get_public_profile (security definer) contourne la RLS'
);
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'get_public_profile'
       and p.prorows = 1
  ),
  'critère 5 (décision 7 amendée) : get_public_profile déclare rows 1'
);
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'get_public_profile'
       and pg_get_functiondef(p.oid) ~* 'from\s+carnet\.public_profiles'
  ),
  'critère 5 (décision 7 amendée) : get_public_profile lit carnet.public_profiles (colonnes et filtre is_published de la vue)'
);
select function_privs_are('carnet', 'get_public_profile', array['text'], 'anon', array['EXECUTE'], 'critère 5 (amendement B) : execute accordé à anon sur get_public_profile');
select function_privs_are('carnet', 'get_public_profile', array['text'], 'authenticated', array['EXECUTE'], 'critère 5 (amendement B) : execute accordé à authenticated sur get_public_profile');
select function_privs_are('carnet', 'get_public_profile', array['text'], 'service_role', array['EXECUTE'], 'critère 5 (amendement B) : execute accordé à service_role sur get_public_profile');
select function_privs_are('carnet', 'get_public_profile', array['text'], 'public', '{}'::name[], 'critère 5 (amendement B) : execute révoqué pour public sur get_public_profile');

select table_privs_are('carnet', 'profiles', 'anon', '{}'::name[], 'critère 5 (décision 8) : anon n''a aucun privilège sur la table profiles');
select table_privs_are('carnet', 'profiles', 'authenticated', array['SELECT'], 'critère 5 (décision 8, amendé 0022 décisions 6 et 8) : authenticated n''a que select au niveau table sur profiles (filtré par RLS) ; ni insert, ni delete, ni update de table (update par colonne, voir carnet_profiles_writes)');
select table_privs_are(
  'carnet', 'profiles', 'service_role',
  array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
  'critère 5 (décision 8) : service_role a tous les privilèges sur profiles'
);
select table_privs_are('carnet', 'profiles', 'public', '{}'::name[], 'critère 5 (décision 8) : public n''a aucun privilège sur profiles');

select is_empty(
  $$select pubname, tablename from pg_publication_tables where schemaname = 'carnet'$$,
  'décision 8 : aucune table de carnet publiée dans Realtime'
);

-- ---------------------------------------------------------------------------
-- Critère 1 — contraintes en comportement (postgres, bypassrls)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000501', 's1-slug-0005@test.local'),
  ('00000000-0000-4000-8000-000000000503', 's3-doomed-0005@test.local'),
  ('00000000-0000-4000-8000-000000000504', 's4-slug-0005@test.local'),
  ('00000000-0000-4000-8000-000000000505', 's5-slug-0005@test.local'),
  ('00000000-0000-4000-8000-000000000506', 's6-length-0005@test.local'),
  ('00000000-0000-4000-8000-000000000507', 's7-stamped-0005@test.local'),
  ('00000000-0000-4000-8000-000000000508', 's8-slug-0005@test.local'),
  ('00000000-0000-4000-8000-000000000509', 's9-length-0005@test.local'),
  ('00000000-0000-4000-8000-00000000050e', 'se-theme-0005@test.local');

-- Décision 3 (corrigée par l'orchestrateur) : slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$', 3 à 40 caractères strict
-- (les inserts refusés ne laissent aucune ligne : même owner).
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name) values ('00000000-0000-4000-8000-000000000501', 'a', 'X')$$,
  '23514', null, 'critère 1 (décision 3) : un slug d''un caractère est refusé'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name) values ('00000000-0000-4000-8000-000000000501', 'ab', 'X')$$,
  '23514', null, 'critère 1 (décision 3) : un slug de 2 caractères est refusé'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name) values ('00000000-0000-4000-8000-000000000501', '-abc', 'X')$$,
  '23514', null, 'critère 1 (décision 3) : un slug commençant par un tiret est refusé'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name) values ('00000000-0000-4000-8000-000000000501', 'Abc', 'X')$$,
  '23514', null, 'critère 1 (décision 3) : un slug avec une majuscule est refusé'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name) values ('00000000-0000-4000-8000-000000000501', 'a_b', 'X')$$,
  '23514', null, 'critère 1 (décision 3) : un slug avec un tiret bas est refusé'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name) values ('00000000-0000-4000-8000-000000000501', repeat('a', 41), 'X')$$,
  '23514', null, 'critère 1 (décision 3) : un slug de 41 caractères est refusé'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name) values ('00000000-0000-4000-8000-000000000501', 'abc-', 'X')$$,
  '23514', null, 'critère 1 (décision 3) : un slug finissant par un tiret est refusé'
);
select lives_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name) values ('00000000-0000-4000-8000-000000000508', 'abc', 'X')$$,
  'critère 1 (décision 3) : un slug de 3 caractères est accepté'
);
select lives_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name) values ('00000000-0000-4000-8000-000000000504', 'a-b', 'X')$$,
  'critère 1 (décision 3) : un slug avec un tiret interne est accepté'
);
select lives_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name) values ('00000000-0000-4000-8000-000000000505', repeat('a', 40), 'X')$$,
  'critère 1 (décision 3) : un slug de 40 caractères est accepté'
);

-- Décision 4 : longueurs maximales (test par comportement, le nom des contraintes n'est pas imposé).
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name) values ('00000000-0000-4000-8000-000000000506', 'len-0005', repeat('a', 81))$$,
  '23514', null, 'critère 1 (décision 4) : display_name de 81 caractères est refusé'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, job_title) values ('00000000-0000-4000-8000-000000000506', 'len-0005', 'X', repeat('a', 81))$$,
  '23514', null, 'critère 1 (décision 4) : job_title de 81 caractères est refusé'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, company) values ('00000000-0000-4000-8000-000000000506', 'len-0005', 'X', repeat('a', 81))$$,
  '23514', null, 'critère 1 (décision 4) : company de 81 caractères est refusé'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, bio) values ('00000000-0000-4000-8000-000000000506', 'len-0005', 'X', repeat('a', 501))$$,
  '23514', null, 'critère 1 (décision 4) : bio de 501 caractères est refusée'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, contact_email) values ('00000000-0000-4000-8000-000000000506', 'len-0005', 'X', repeat('a', 255))$$,
  '23514', null, 'critère 1 (décision 4) : contact_email de 255 caractères est refusé'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, phone) values ('00000000-0000-4000-8000-000000000506', 'len-0005', 'X', repeat('1', 33))$$,
  '23514', null, 'critère 1 (décision 4) : phone de 33 caractères est refusé'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, website_url) values ('00000000-0000-4000-8000-000000000506', 'len-0005', 'X', 'https://a.test/' || repeat('a', 2034))$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_website_url_length_check"',
  'critère 1 (décision 4) : website_url https de 2049 caractères est refusée par la seule contrainte de longueur'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, avatar_url) values ('00000000-0000-4000-8000-000000000506', 'len-0005', 'X', repeat('a', 2049))$$,
  '23514', null, 'critère 1 (décision 4) : avatar_url de 2049 caractères est refusée'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, banner_url) values ('00000000-0000-4000-8000-000000000506', 'len-0005', 'X', repeat('a', 2049))$$,
  '23514', null, 'critère 1 (décision 4) : banner_url de 2049 caractères est refusée'
);
select lives_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, job_title, company, bio, contact_email, phone, website_url)
    values ('00000000-0000-4000-8000-000000000509', 'len-max-0005',
            repeat('a', 80), repeat('a', 80), repeat('a', 80), repeat('a', 500), repeat('a', 254), repeat('1', 32),
            'https://a.test/' || repeat('a', 2033))$$,
  'critère 1 (décision 4, amendé 0021 : avatar_url et banner_url sont des noms d''objet au format fixe, profiles_media_names_check) : toutes les colonnes de texte libre exactement à leur longueur maximale sont acceptées (bornes incluses)'
);

-- Contrainte profiles_theme_check : theme est un objet JSON de 4096 octets au plus.
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, theme) values ('00000000-0000-4000-8000-000000000501', 'theme-0005', 'X', '[]'::jsonb)$$,
  '23514', null, 'critère 1 : theme refuse un tableau JSON'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, theme) values ('00000000-0000-4000-8000-000000000501', 'theme-0005', 'X', '"x"'::jsonb)$$,
  '23514', null, 'critère 1 : theme refuse un scalaire JSON'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, theme) values ('00000000-0000-4000-8000-000000000501', 'theme-0005', 'X', jsonb_build_object('k', repeat('x', 5000)))$$,
  '23514', null, 'critère 1 : theme refuse un objet de plus de 4096 octets'
);
select lives_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, theme) values ('00000000-0000-4000-8000-00000000050e', 'theme-0005', 'X', '{"primary":"#112233","font":"inter"}'::jsonb)$$,
  'critère 1 : theme accepte un objet JSON de taille raisonnable'
);

-- FK owner_id → auth.users on delete cascade (comportement)
select lives_ok(
  $$insert into carnet.profiles (id, owner_id, slug, display_name)
    values ('00000000-0000-4000-8000-000000000521', '00000000-0000-4000-8000-000000000503', 'doomed-0005', 'Doomed')$$,
  'critère 1 (précondition) : un profil est créé pour le compte à supprimer'
);
select lives_ok(
  $$delete from auth.users where id = '00000000-0000-4000-8000-000000000503'$$,
  'critère 1 : supprimer un compte auth.users ayant un profil ne viole pas la clé étrangère (on delete cascade)'
);
select is(
  (select count(*) from carnet.profiles where owner_id = '00000000-0000-4000-8000-000000000503'),
  0::bigint,
  'critère 1 : supprimer un compte auth.users supprime son profil'
);

-- Trigger updated_at (now() est figé dans la transaction : on part d'une valeur passée explicite)
select lives_ok(
  $$insert into carnet.profiles (id, owner_id, slug, display_name, updated_at)
    values ('00000000-0000-4000-8000-000000000520', '00000000-0000-4000-8000-000000000507', 'stamped-0005', 'Stamped', '2000-01-01')$$,
  'critère 1 (précondition) : un profil est créé avec updated_at dans le passé'
);
select lives_ok(
  $$update carnet.profiles set display_name = 'Stamped again' where id = '00000000-0000-4000-8000-000000000520'$$,
  'critère 1 (précondition) : le profil est mis à jour'
);
select is(
  (select updated_at from carnet.profiles where id = '00000000-0000-4000-8000-000000000520'),
  now(),
  'critère 1 : le trigger met profiles.updated_at à now() lors d''un update'
);

select * from finish();
rollback;
