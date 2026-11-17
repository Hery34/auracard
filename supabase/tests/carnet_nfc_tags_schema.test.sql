-- Fiche 0024 — carnet.nfc_tags : structure, contraintes en comportement, RLS (déclaratif), privilèges par rôle et par
-- colonne, propriétés des six fonctions NFC (security definer, search_path, volatilité, signatures, grants).
-- Décisions couvertes : 1, 2, 5, 6, 8 (déclaratif). Critères : 1 à 5 et 7 (déclaratif) ; les comportements par persona
-- sont dans carnet_nfc_tags_access.test.sql.
-- Contrat figé pour db-architect (interprétations les plus strictes, voir rapport 0024) :
--   uid ~ '^[0-9a-hjkmnp-tv-z]{12}$' ; status text, valeurs stock / assigned / disabled ; status = 'stock' <=> profile_id null
--   profile_id -> carnet.profiles(id) on delete set null ; index commençant par profile_id ; trigger nfc_tags_set_updated_at
--   une seule politique : nfc_tags_select_own (select, authenticated), commençant par (select carnet.is_member())
--   authenticated : aucun privilège de table ; select par colonne sur toutes les colonnes sauf activation_code_hash
--   execute : resolve_nfc_tag (anon, authenticated, service_role) ; activate_nfc_tag, set_nfc_tag_enabled,
--   release_nfc_tag (authenticated seul) ; provision_nfc_tags (service_role seul) ; jamais public
--   toutes security definer, set search_path = '', propriétaire bypassrls ; resolve_nfc_tag stable, les autres volatile
-- Fixtures (postgres, bypassrls, plage 0…24c*/0…24d* propre à ce fichier) : compte 0…24c1, profil 0…24d1.
-- Ajouts après audit et revue (décisions 9 et 10) : coût bcrypt gen_salt('bf', 8) dans activate_nfc_tag et
-- provision_nfc_tags ; consume_rate_limit (clé nfc-activate:) appelé avant toute lecture de nfc_tags / profiles et tout
-- bcrypt ; nullité du code testée avant la lecture de nfc_tags ; profil vérifié par can_edit_profile (owner_id autorisé pour l'index) ;
-- execute refusé à public, anon, authenticated sur random_crockford et release_profile_nfc_tags ; trigger
-- profiles_release_nfc_tags (before delete). Contrôles de source : un commentaire placé dans le corps peut les fausser.
-- Tout s'exécute dans une transaction annulée : rien ne persiste.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(128);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000024c1', 'schema-nfc-0024@test.local');
insert into carnet.profiles (id, owner_id, slug, display_name) values
  ('00000000-0000-4000-8000-0000000024d1', '00000000-0000-4000-8000-0000000024c1', 'schema-nfc-0024', 'Schema');

-- ---------------------------------------------------------------------------
-- Décision 1 — table et colonnes
-- ---------------------------------------------------------------------------
select has_table('carnet', 'nfc_tags', 'décision 1 : la table carnet.nfc_tags existe');
select columns_are(
  'carnet', 'nfc_tags',
  array['id', 'uid', 'profile_id', 'status', 'activation_code_hash', 'batch_id', 'activated_at', 'created_at', 'updated_at'],
  'décision 1 : nfc_tags a exactement les colonnes de la décision 1'
);
select col_type_is('carnet', 'nfc_tags', 'id', 'uuid', 'décision 1 : nfc_tags.id est uuid');
select col_is_pk('carnet', 'nfc_tags', 'id', 'décision 1 : nfc_tags.id est la clé primaire');
select col_type_is('carnet', 'nfc_tags', 'uid', 'text', 'décision 1 : nfc_tags.uid est text');
select col_not_null('carnet', 'nfc_tags', 'uid', 'décision 1 : nfc_tags.uid est not null');
select col_type_is('carnet', 'nfc_tags', 'profile_id', 'uuid', 'décision 1 : nfc_tags.profile_id est uuid');
select col_is_null('carnet', 'nfc_tags', 'profile_id', 'décision 1 : nfc_tags.profile_id est nullable (puce en stock)');
select fk_ok('carnet', 'nfc_tags', 'profile_id', 'carnet', 'profiles', 'id', 'décision 1 : nfc_tags.profile_id référence carnet.profiles(id)');
select col_type_is('carnet', 'nfc_tags', 'status', 'text', 'décision 1 : nfc_tags.status est text');
select col_not_null('carnet', 'nfc_tags', 'status', 'décision 1 : nfc_tags.status est not null');
select col_type_is('carnet', 'nfc_tags', 'activation_code_hash', 'text', 'décision 2 : nfc_tags.activation_code_hash est text');
select col_not_null('carnet', 'nfc_tags', 'activation_code_hash', 'décision 2 : nfc_tags.activation_code_hash est not null');
select col_type_is('carnet', 'nfc_tags', 'batch_id', 'uuid', 'décision 1 : nfc_tags.batch_id est uuid');
select col_not_null('carnet', 'nfc_tags', 'batch_id', 'décision 1 : nfc_tags.batch_id est not null');
select col_type_is('carnet', 'nfc_tags', 'activated_at', 'timestamp with time zone', 'décision 1 : nfc_tags.activated_at est timestamptz');
select col_is_null('carnet', 'nfc_tags', 'activated_at', 'décision 1 : nfc_tags.activated_at est nullable');
select col_type_is('carnet', 'nfc_tags', 'created_at', 'timestamp with time zone', 'décision 1 : nfc_tags.created_at est timestamptz');
select col_not_null('carnet', 'nfc_tags', 'created_at', 'décision 1 : nfc_tags.created_at est not null');
select col_default_is('carnet', 'nfc_tags', 'created_at', 'now()', 'décision 1 : nfc_tags.created_at a pour défaut now()');
select col_type_is('carnet', 'nfc_tags', 'updated_at', 'timestamp with time zone', 'décision 1 : nfc_tags.updated_at est timestamptz');
select col_not_null('carnet', 'nfc_tags', 'updated_at', 'décision 1 : nfc_tags.updated_at est not null');
select col_default_is('carnet', 'nfc_tags', 'updated_at', 'now()', 'décision 1 : nfc_tags.updated_at a pour défaut now()');

select ok(
  exists (
    select 1
      from pg_constraint k
     where k.conrelid = to_regclass('carnet.nfc_tags')
       and k.contype = 'f'
       and k.confrelid = to_regclass('carnet.profiles')
       and k.confdeltype = 'n'
  ),
  'décision 1 et 7 : la clé étrangère profile_id est on delete set null'
);
select ok(
  exists (
    select 1
      from pg_index i
     where i.indrelid = to_regclass('carnet.nfc_tags')
       and i.indisunique
       and i.indnatts = 1
       and i.indpred is null
       and i.indkey[0] = (select attnum from pg_attribute where attrelid = to_regclass('carnet.nfc_tags') and attname = 'uid')
  ),
  'décision 1 : un index unique (non partiel) porte sur uid seul'
);
select ok(
  exists (
    select 1
      from pg_index i
     where i.indrelid = to_regclass('carnet.nfc_tags')
       and i.indkey[0] = (select attnum from pg_attribute where attrelid = to_regclass('carnet.nfc_tags') and attname = 'profile_id')
  ),
  'décision 1 (supabase.md, performance) : un index commence par profile_id (clé étrangère et politique RLS)'
);

-- Trigger updated_at
select ok(
  exists (
    select 1
      from pg_trigger t
      join pg_proc f on f.oid = t.tgfoid
      join pg_namespace fn on fn.oid = f.pronamespace
     where t.tgrelid = to_regclass('carnet.nfc_tags')
       and t.tgname = 'nfc_tags_set_updated_at'
       and not t.tgisinternal
       and t.tgenabled <> 'D'
       and t.tgtype & 1 = 1
       and t.tgtype & 2 = 2
       and t.tgtype & 16 = 16
       and fn.nspname = 'carnet'
       and f.proname = 'set_updated_at'
  ),
  'décision 1 : le trigger nfc_tags_set_updated_at (before update for each row) appelle carnet.set_updated_at()'
);

-- ---------------------------------------------------------------------------
-- Décision 1 — contraintes en comportement (postgres, chemin le plus permissif)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into carnet.nfc_tags (id, uid, status, activation_code_hash, batch_id)
    values ('00000000-0000-4000-8000-0000000024e1', '0123456789ab', 'stock', 'h', '00000000-0000-4000-8000-0000000024f1')$$,
  'décision 1 : une puce en stock (profile_id nul) avec un uid de 12 caractères de l''alphabet est acceptée'
);
select throws_ok(
  $$insert into carnet.nfc_tags (id, uid, status, activation_code_hash, batch_id)
    values ('00000000-0000-4000-8000-0000000024e2', '0123456789ab', 'stock', 'h', '00000000-0000-4000-8000-0000000024f1')$$,
  '23505', null, 'décision 1 : uid en double refusé (23505)'
);
select throws_ok(
  $$insert into carnet.nfc_tags (id, uid, status, activation_code_hash, batch_id)
    values ('00000000-0000-4000-8000-0000000024e2', 'ABCDEFGHJKMN', 'stock', 'h', '00000000-0000-4000-8000-0000000024f1')$$,
  '23514', null, 'décision 1 : uid en majuscules refusé (23514)'
);
select throws_ok(
  $$insert into carnet.nfc_tags (id, uid, status, activation_code_hash, batch_id)
    values ('00000000-0000-4000-8000-0000000024e2', '0123456789a', 'stock', 'h', '00000000-0000-4000-8000-0000000024f1')$$,
  '23514', null, 'décision 1 : uid de 11 caractères refusé (23514)'
);
select throws_ok(
  $$insert into carnet.nfc_tags (id, uid, status, activation_code_hash, batch_id)
    values ('00000000-0000-4000-8000-0000000024e2', '0123456789abc', 'stock', 'h', '00000000-0000-4000-8000-0000000024f1')$$,
  '23514', null, 'décision 1 : uid de 13 caractères refusé (23514)'
);
select throws_ok(
  $$insert into carnet.nfc_tags (id, uid, status, activation_code_hash, batch_id)
    values ('00000000-0000-4000-8000-0000000024e2', '0123456789ai', 'stock', 'h', '00000000-0000-4000-8000-0000000024f1')$$,
  '23514', null, 'décision 1 : uid contenant « i » (hors alphabet Crockford) refusé (23514)'
);
select throws_ok(
  $$insert into carnet.nfc_tags (id, uid, status, activation_code_hash, batch_id)
    values ('00000000-0000-4000-8000-0000000024e2', '0123456789al', 'stock', 'h', '00000000-0000-4000-8000-0000000024f1')$$,
  '23514', null, 'décision 1 : uid contenant « l » refusé (23514)'
);
select throws_ok(
  $$insert into carnet.nfc_tags (id, uid, status, activation_code_hash, batch_id)
    values ('00000000-0000-4000-8000-0000000024e2', '0123456789ao', 'stock', 'h', '00000000-0000-4000-8000-0000000024f1')$$,
  '23514', null, 'décision 1 : uid contenant « o » refusé (23514)'
);
select throws_ok(
  $$insert into carnet.nfc_tags (id, uid, status, activation_code_hash, batch_id)
    values ('00000000-0000-4000-8000-0000000024e2', '0123456789au', 'stock', 'h', '00000000-0000-4000-8000-0000000024f1')$$,
  '23514', null, 'décision 1 : uid contenant « u » refusé (23514)'
);
select throws_ok(
  $$insert into carnet.nfc_tags (id, uid, status, activation_code_hash, batch_id)
    values ('00000000-0000-4000-8000-0000000024e2', E'0123456789a\n', 'stock', 'h', '00000000-0000-4000-8000-0000000024f1')$$,
  '23514', null, 'décision 1 : uid terminé par un saut de ligne refusé (23514)'
);
select throws_ok(
  $$insert into carnet.nfc_tags (id, uid, status, activation_code_hash, batch_id)
    values ('00000000-0000-4000-8000-0000000024e2', 'vwxyz0123456', 'lost', 'h', '00000000-0000-4000-8000-0000000024f1')$$,
  '23514', null, 'décision 1 : status hors de stock / assigned / disabled refusé (23514)'
);
select throws_ok(
  $$insert into carnet.nfc_tags (id, uid, profile_id, status, activation_code_hash, batch_id)
    values ('00000000-0000-4000-8000-0000000024e2', 'vwxyz0123456', '00000000-0000-4000-8000-0000000024d1', 'stock', 'h', '00000000-0000-4000-8000-0000000024f1')$$,
  '23514', null, 'décision 1 : status stock avec un profile_id refusé (23514)'
);
select throws_ok(
  $$insert into carnet.nfc_tags (id, uid, status, activation_code_hash, batch_id, activated_at)
    values ('00000000-0000-4000-8000-0000000024e2', 'vwxyz0123456', 'assigned', 'h', '00000000-0000-4000-8000-0000000024f1', now())$$,
  '23514', null, 'décision 1 : status assigned sans profile_id refusé (23514)'
);
select throws_ok(
  $$insert into carnet.nfc_tags (id, uid, status, activation_code_hash, batch_id, activated_at)
    values ('00000000-0000-4000-8000-0000000024e2', 'vwxyz0123456', 'disabled', 'h', '00000000-0000-4000-8000-0000000024f1', now())$$,
  '23514', null, 'décision 1 : status disabled sans profile_id refusé (23514)'
);
select lives_ok(
  $$insert into carnet.nfc_tags (id, uid, profile_id, status, activation_code_hash, batch_id, activated_at)
    values ('00000000-0000-4000-8000-0000000024e3', 'vwxyz0123456', '00000000-0000-4000-8000-0000000024d1', 'assigned', 'h', '00000000-0000-4000-8000-0000000024f1', now())$$,
  'décision 1 : status assigned avec un profile_id accepté'
);
select lives_ok(
  $$insert into carnet.nfc_tags (id, uid, profile_id, status, activation_code_hash, batch_id, activated_at)
    values ('00000000-0000-4000-8000-0000000024e4', 'hjkmnpqrstvw', '00000000-0000-4000-8000-0000000024d1', 'disabled', 'h', '00000000-0000-4000-8000-0000000024f1', now())$$,
  'décision 1 : status disabled avec un profile_id accepté'
);
select throws_ok(
  $$update carnet.nfc_tags set profile_id = null where id = '00000000-0000-4000-8000-0000000024e3'$$,
  '23514', null, 'décision 1 : retirer profile_id d''une puce assigned sans la remettre en stock est refusé (23514)'
);
select throws_ok(
  $$insert into carnet.nfc_tags (id, uid, status, batch_id)
    values ('00000000-0000-4000-8000-0000000024e5', 'xyz012345678', 'stock', '00000000-0000-4000-8000-0000000024f1')$$,
  '23502', null, 'décision 2 : une puce sans activation_code_hash est refusée (23502)'
);

update carnet.nfc_tags set updated_at = '2020-01-01 00:00:00+00', created_at = '2020-01-01 00:00:00+00'
 where id = '00000000-0000-4000-8000-0000000024e1';
update carnet.nfc_tags set batch_id = '00000000-0000-4000-8000-0000000024f2' where id = '00000000-0000-4000-8000-0000000024e1';
select ok(
  (select updated_at > '2020-01-02 00:00:00+00' and created_at = '2020-01-01 00:00:00+00'
     from carnet.nfc_tags where id = '00000000-0000-4000-8000-0000000024e1'),
  'décision 1 : updated_at est posé par le trigger à chaque update, created_at inchangé'
);

-- ---------------------------------------------------------------------------
-- Décision 5 — RLS (déclaratif)
-- ---------------------------------------------------------------------------
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = to_regclass('carnet.nfc_tags')),
  'décision 5 : row level security activée sur carnet.nfc_tags'
);
select ok(
  (select c.relforcerowsecurity from pg_class c where c.oid = to_regclass('carnet.nfc_tags')),
  'décision 5 : row level security forcée sur carnet.nfc_tags'
);
select policies_are('carnet', 'nfc_tags', array['nfc_tags_select_own'],
  'décision 5 : nfc_tags a une seule politique (lecture), aucune politique d''écriture');
select policy_roles_are('carnet', 'nfc_tags', 'nfc_tags_select_own', array['authenticated'],
  'décision 5 : nfc_tags_select_own s''applique au seul rôle authenticated');
select policy_cmd_is('carnet', 'nfc_tags', 'nfc_tags_select_own', 'SELECT',
  'décision 5 : nfc_tags_select_own est une politique select');
select ok(
  exists (
    select 1
      from pg_policy p
     where p.polrelid = to_regclass('carnet.nfc_tags')
       and p.polname = 'nfc_tags_select_own'
       and pg_get_expr(p.polqual, p.polrelid) ~* '^\(*\s*select\s+carnet\.is_member\(\s*\)'
       and pg_get_expr(p.polqual, p.polrelid) ~* '\(\s*select\s+carnet\.can_edit_profile\(\s*(nfc_tags\.)?profile_id\s*\)'
  ),
  'décision 5 (ADR 0004) : nfc_tags_select_own commence par (select carnet.is_member()) et appelle (select carnet.can_edit_profile(profile_id))'
);

-- ---------------------------------------------------------------------------
-- Décision 5 — privilèges par rôle et par colonne
-- ---------------------------------------------------------------------------
select table_privs_are('carnet', 'nfc_tags', 'anon', '{}'::name[], 'décision 5 : anon n''a aucun privilège sur nfc_tags');
select table_privs_are('carnet', 'nfc_tags', 'public', '{}'::name[], 'décision 5 : public n''a aucun privilège sur nfc_tags');
select table_privs_are('carnet', 'nfc_tags', 'authenticated', '{}'::name[],
  'décision 5 : authenticated n''a aucun privilège de table sur nfc_tags (lecture par colonne seulement)');
select ok(
  not has_any_column_privilege('anon', 'carnet.nfc_tags', 'SELECT'),
  'décision 5 : anon n''a select sur aucune colonne de nfc_tags'
);
select is(
  (select array_agg(a.attname::text order by a.attname)
     from pg_attribute a
    where a.attrelid = 'carnet.nfc_tags'::regclass
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'carnet.nfc_tags', a.attname, 'SELECT')),
  array['activated_at', 'batch_id', 'created_at', 'id', 'profile_id', 'status', 'uid', 'updated_at'],
  'décision 5 : authenticated lit exactement les colonnes de nfc_tags sauf activation_code_hash'
);
select ok(
  not has_column_privilege('authenticated', 'carnet.nfc_tags', 'activation_code_hash', 'SELECT'),
  'décision 5 : activation_code_hash n''est pas lisible par authenticated'
);
select ok(
  not has_any_column_privilege('authenticated', 'carnet.nfc_tags', 'INSERT'),
  'décision 5 : authenticated n''a insert sur aucune colonne de nfc_tags'
);
select ok(
  not has_any_column_privilege('authenticated', 'carnet.nfc_tags', 'UPDATE'),
  'décision 5 : authenticated n''a update sur aucune colonne de nfc_tags'
);
select ok(
  not has_any_column_privilege('authenticated', 'carnet.nfc_tags', 'REFERENCES'),
  'décision 5 : authenticated n''a references sur aucune colonne de nfc_tags'
);
select is_empty(
  $$select 1 from pg_publication_tables where schemaname = 'carnet' and tablename = 'nfc_tags'$$,
  'décision 5 : carnet.nfc_tags n''est pas publiée dans Realtime'
);

-- ---------------------------------------------------------------------------
-- Décision 6 — carnet.resolve_nfc_tag(text)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'resolve_nfc_tag', array['text'], 'décision 6 : carnet.resolve_nfc_tag(text) existe');
select is_definer('carnet', 'resolve_nfc_tag', array['text'], 'décision 6 : resolve_nfc_tag est security definer');
select volatility_is('carnet', 'resolve_nfc_tag', array['text'], 'stable', 'décision 6 : resolve_nfc_tag est stable');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.resolve_nfc_tag(text)')
             and p.proconfig @> array['search_path=""']),
  'décision 6 : resolve_nfc_tag fixe set search_path = '''''
);
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.resolve_nfc_tag(text)')
             and p.proargnames = array['p_uid', 'state', 'slug']
             and p.proargmodes::text[] in (array['i', 'o', 'o'], array['i', 't', 't'])
             and p.proallargtypes = array['text'::regtype, 'text'::regtype, 'text'::regtype]::oid[]),
  'décision 6 : resolve_nfc_tag(p_uid text) renvoie (state text, slug text)'
);
select function_privs_are('carnet', 'resolve_nfc_tag', array['text'], 'anon', array['EXECUTE'], 'décision 6 : execute accordé à anon sur resolve_nfc_tag');
select function_privs_are('carnet', 'resolve_nfc_tag', array['text'], 'authenticated', array['EXECUTE'], 'décision 6 : execute accordé à authenticated sur resolve_nfc_tag');
select function_privs_are('carnet', 'resolve_nfc_tag', array['text'], 'service_role', array['EXECUTE'], 'décision 6 : execute accordé à service_role sur resolve_nfc_tag');
select function_privs_are('carnet', 'resolve_nfc_tag', array['text'], 'public', '{}'::name[], 'décision 6 : execute révoqué pour public sur resolve_nfc_tag');

-- ---------------------------------------------------------------------------
-- Décision 6 — carnet.activate_nfc_tag(text, text)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'activate_nfc_tag', array['text', 'text'], 'décision 6 : carnet.activate_nfc_tag(text, text) existe');
select function_returns('carnet', 'activate_nfc_tag', array['text', 'text'], 'text', 'décision 6 : activate_nfc_tag renvoie text');
select is_definer('carnet', 'activate_nfc_tag', array['text', 'text'], 'décision 6 : activate_nfc_tag est security definer');
select volatility_is('carnet', 'activate_nfc_tag', array['text', 'text'], 'volatile', 'décision 6 : activate_nfc_tag est volatile (elle écrit)');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.activate_nfc_tag(text,text)')
             and p.proconfig @> array['search_path=""']),
  'décision 6 : activate_nfc_tag fixe set search_path = '''''
);
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.activate_nfc_tag(text,text)')
             and p.proargnames = array['p_uid', 'p_code']),
  'décision 6 : les paramètres de activate_nfc_tag se nomment p_uid et p_code'
);
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.activate_nfc_tag(text,text)')
             and pg_get_functiondef(p.oid) ~* 'carnet\.nfc_tags.*for\s+update'),
  'décision 6 : activate_nfc_tag verrouille la ligne de la puce (select … from carnet.nfc_tags … for update)'
);
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.activate_nfc_tag(text,text)')
             and pg_get_functiondef(p.oid) ~* '\mcrypt\('),
  'décision 2 : activate_nfc_tag compare le code par crypt() (pgcrypto, nom qualifié)'
);
select function_privs_are('carnet', 'activate_nfc_tag', array['text', 'text'], 'authenticated', array['EXECUTE'], 'décision 6 : execute accordé à authenticated sur activate_nfc_tag');
select function_privs_are('carnet', 'activate_nfc_tag', array['text', 'text'], 'anon', '{}'::name[], 'décision 6 : execute refusé à anon sur activate_nfc_tag');
select function_privs_are('carnet', 'activate_nfc_tag', array['text', 'text'], 'service_role', '{}'::name[], 'décision 6 : execute refusé à service_role sur activate_nfc_tag (authenticated seul)');
select function_privs_are('carnet', 'activate_nfc_tag', array['text', 'text'], 'public', '{}'::name[], 'décision 6 : execute révoqué pour public sur activate_nfc_tag');

-- ---------------------------------------------------------------------------
-- Décision 6 — carnet.set_nfc_tag_enabled(uuid, boolean)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'set_nfc_tag_enabled', array['uuid', 'boolean'], 'décision 6 : carnet.set_nfc_tag_enabled(uuid, boolean) existe');
select function_returns('carnet', 'set_nfc_tag_enabled', array['uuid', 'boolean'], 'boolean', 'décision 6 : set_nfc_tag_enabled renvoie boolean');
select is_definer('carnet', 'set_nfc_tag_enabled', array['uuid', 'boolean'], 'décision 6 : set_nfc_tag_enabled est security definer');
select volatility_is('carnet', 'set_nfc_tag_enabled', array['uuid', 'boolean'], 'volatile', 'décision 6 : set_nfc_tag_enabled est volatile');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.set_nfc_tag_enabled(uuid,boolean)')
             and p.proconfig @> array['search_path=""']
             and p.proargnames = array['p_tag_id', 'p_enabled']),
  'décision 6 : set_nfc_tag_enabled fixe set search_path = '''' et nomme ses paramètres p_tag_id, p_enabled'
);
select function_privs_are('carnet', 'set_nfc_tag_enabled', array['uuid', 'boolean'], 'authenticated', array['EXECUTE'], 'décision 6 : execute accordé à authenticated sur set_nfc_tag_enabled');
select function_privs_are('carnet', 'set_nfc_tag_enabled', array['uuid', 'boolean'], 'anon', '{}'::name[], 'décision 6 : execute refusé à anon sur set_nfc_tag_enabled');
select function_privs_are('carnet', 'set_nfc_tag_enabled', array['uuid', 'boolean'], 'service_role', '{}'::name[], 'décision 6 : execute refusé à service_role sur set_nfc_tag_enabled');
select function_privs_are('carnet', 'set_nfc_tag_enabled', array['uuid', 'boolean'], 'public', '{}'::name[], 'décision 6 : execute révoqué pour public sur set_nfc_tag_enabled');

-- ---------------------------------------------------------------------------
-- Décision 6 — carnet.release_nfc_tag(uuid)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'release_nfc_tag', array['uuid'], 'décision 6 : carnet.release_nfc_tag(uuid) existe');
select function_returns('carnet', 'release_nfc_tag', array['uuid'], 'boolean', 'décision 6 : release_nfc_tag renvoie boolean');
select is_definer('carnet', 'release_nfc_tag', array['uuid'], 'décision 6 : release_nfc_tag est security definer');
select volatility_is('carnet', 'release_nfc_tag', array['uuid'], 'volatile', 'décision 6 : release_nfc_tag est volatile');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.release_nfc_tag(uuid)')
             and p.proconfig @> array['search_path=""']
             and p.proargnames = array['p_tag_id']),
  'décision 6 : release_nfc_tag fixe set search_path = '''' et nomme son paramètre p_tag_id'
);
select function_privs_are('carnet', 'release_nfc_tag', array['uuid'], 'authenticated', array['EXECUTE'], 'décision 6 : execute accordé à authenticated sur release_nfc_tag');
select function_privs_are('carnet', 'release_nfc_tag', array['uuid'], 'anon', '{}'::name[], 'décision 6 : execute refusé à anon sur release_nfc_tag');
select function_privs_are('carnet', 'release_nfc_tag', array['uuid'], 'service_role', '{}'::name[], 'décision 6 : execute refusé à service_role sur release_nfc_tag');
select function_privs_are('carnet', 'release_nfc_tag', array['uuid'], 'public', '{}'::name[], 'décision 6 : execute révoqué pour public sur release_nfc_tag');

-- ---------------------------------------------------------------------------
-- Décision 6 — carnet.provision_nfc_tags(uuid, integer)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'provision_nfc_tags', array['uuid', 'integer'], 'décision 6 : carnet.provision_nfc_tags(uuid, integer) existe');
select is_definer('carnet', 'provision_nfc_tags', array['uuid', 'integer'], 'décision 6 : provision_nfc_tags est security definer');
select volatility_is('carnet', 'provision_nfc_tags', array['uuid', 'integer'], 'volatile', 'décision 6 : provision_nfc_tags est volatile');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.provision_nfc_tags(uuid,integer)')
             and p.proconfig @> array['search_path=""']),
  'décision 6 : provision_nfc_tags fixe set search_path = '''''
);
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.provision_nfc_tags(uuid,integer)')
             and p.proretset
             and p.proargnames = array['p_batch_id', 'p_count', 'uid', 'activation_code']
             and p.proargmodes = array['i', 'i', 't', 't']::"char"[]
             and p.proallargtypes = array['uuid'::regtype, 'integer'::regtype, 'text'::regtype, 'text'::regtype]::oid[]),
  'décision 6 : provision_nfc_tags(p_batch_id uuid, p_count integer) returns table(uid text, activation_code text)'
);
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.provision_nfc_tags(uuid,integer)')
             and pg_get_functiondef(p.oid) ~* '\mcrypt\(.*\mgen_salt\(\s*''bf''\s*,\s*8\s*\)'
             and pg_get_functiondef(p.oid) !~* '\mgen_salt\(\s*''bf''\s*\)'),
  'décision 2 et 9 : provision_nfc_tags hache le code par crypt(…, gen_salt(''bf'', 8)), coût explicite, jamais gen_salt(''bf'') seul'
);
select function_privs_are('carnet', 'provision_nfc_tags', array['uuid', 'integer'], 'service_role', array['EXECUTE'], 'critère 1 : execute accordé à service_role sur provision_nfc_tags');
select function_privs_are('carnet', 'provision_nfc_tags', array['uuid', 'integer'], 'authenticated', '{}'::name[], 'critère 1 : execute refusé à authenticated sur provision_nfc_tags');
select function_privs_are('carnet', 'provision_nfc_tags', array['uuid', 'integer'], 'anon', '{}'::name[], 'critère 1 : execute refusé à anon sur provision_nfc_tags');
select function_privs_are('carnet', 'provision_nfc_tags', array['uuid', 'integer'], 'public', '{}'::name[], 'critère 1 : execute révoqué pour public sur provision_nfc_tags');

-- ---------------------------------------------------------------------------
-- Décisions 9 et 10 (après audit et revue) — activate_nfc_tag : source
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.activate_nfc_tag(text,text)')
             and pg_get_functiondef(p.oid) ~* '\mgen_salt\(\s*''bf''\s*,\s*8\s*\)'
             and pg_get_functiondef(p.oid) !~* '\mgen_salt\(\s*''bf''\s*\)'),
  'décision 9 : activate_nfc_tag utilise gen_salt(''bf'', 8) (même coût que provision_nfc_tags), jamais gen_salt(''bf'') seul'
);
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.activate_nfc_tag(text,text)')
             and pg_get_functiondef(p.oid) ~* 'carnet\.consume_rate_limit\('
             and pg_get_functiondef(p.oid) ~* 'nfc-activate:'),
  'décision 9 : activate_nfc_tag appelle carnet.consume_rate_limit avec une clé nfc-activate:<auth.uid()>'
);
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.activate_nfc_tag(text,text)')
             and pg_get_functiondef(p.oid) ~* 'carnet\.consume_rate_limit\('
             and pg_get_functiondef(p.oid) !~* '(carnet\.nfc_tags|carnet\.profiles|can_edit_profile\(|\mcrypt\().*carnet\.consume_rate_limit\('),
  'décision 9 : consume_rate_limit est appelé avant toute lecture de nfc_tags ou de profiles et avant tout bcrypt (ordre dans la source)'
);
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.activate_nfc_tag(text,text)')
             and pg_get_functiondef(p.oid) ~* '(p_code|v_code)\s+is\s+null.*carnet\.nfc_tags'
             and pg_get_functiondef(p.oid) !~* 'carnet\.nfc_tags.*(p_code|v_code)\s+is\s+null'),
  'décision 9 : activate_nfc_tag teste la nullité du code avant toute mention de carnet.nfc_tags, jamais après (ordre dans la source)'
);
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.activate_nfc_tag(text,text)')
             and pg_get_functiondef(p.oid) ~* 'carnet\.can_edit_profile\('),
  'décision 10 : activate_nfc_tag vérifie le profil de l''appelant par carnet.can_edit_profile (filtre owner_id indexé autorisé)'
);

-- ---------------------------------------------------------------------------
-- Décision 10 — fonctions internes : execute refusé ; trigger de remise en stock
-- ---------------------------------------------------------------------------
select function_privs_are('carnet', 'random_crockford', array['integer'], 'public', '{}'::name[], 'décision 10 : execute refusé à public sur random_crockford');
select function_privs_are('carnet', 'random_crockford', array['integer'], 'anon', '{}'::name[], 'décision 10 : execute refusé à anon sur random_crockford');
select function_privs_are('carnet', 'random_crockford', array['integer'], 'authenticated', '{}'::name[], 'décision 10 : execute refusé à authenticated sur random_crockford');
select function_privs_are('carnet', 'release_profile_nfc_tags', '{}'::name[], 'public', '{}'::name[], 'décision 10 : execute refusé à public sur release_profile_nfc_tags');
select function_privs_are('carnet', 'release_profile_nfc_tags', '{}'::name[], 'anon', '{}'::name[], 'décision 10 : execute refusé à anon sur release_profile_nfc_tags');
select function_privs_are('carnet', 'release_profile_nfc_tags', '{}'::name[], 'authenticated', '{}'::name[], 'décision 10 : execute refusé à authenticated sur release_profile_nfc_tags');
select ok(
  exists (
    select 1
      from pg_trigger t
      join pg_proc f on f.oid = t.tgfoid
      join pg_namespace fn on fn.oid = f.pronamespace
     where t.tgrelid = to_regclass('carnet.profiles')
       and t.tgname = 'profiles_release_nfc_tags'
       and not t.tgisinternal and t.tgenabled <> 'D'
       and t.tgtype & 1 = 1    -- for each row
       and t.tgtype & 2 = 2    -- before
       and t.tgtype & 8 = 8    -- delete
       and fn.nspname = 'carnet' and f.proname = 'release_profile_nfc_tags'
  ),
  'décision 7 et 10 : le trigger profiles_release_nfc_tags (before delete for each row) sur carnet.profiles appelle carnet.release_profile_nfc_tags()'
);

-- ---------------------------------------------------------------------------
-- Décision 6 — propriétaire des fonctions security definer : contourne la RLS
-- ---------------------------------------------------------------------------
select is(
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_roles r on r.oid = p.proowner
    where n.nspname = 'carnet'
      and p.proname in ('resolve_nfc_tag', 'activate_nfc_tag', 'set_nfc_tag_enabled', 'release_nfc_tag', 'provision_nfc_tags')
      and (r.rolbypassrls or r.rolsuper)),
  5::bigint,
  'décision 6 : les cinq fonctions NFC existent une seule fois chacune et leur propriétaire contourne la RLS'
);
select is_empty(
  $$select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('resolve_nfc_tag', 'activate_nfc_tag', 'set_nfc_tag_enabled', 'release_nfc_tag', 'provision_nfc_tags')$$,
  'supabase.md : aucune fonction NFC dans le schéma public'
);

-- ---------------------------------------------------------------------------
-- Décision 7 — suppression d'un profil : remise en stock (contrôle direct, postgres)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$delete from carnet.profiles where id = '00000000-0000-4000-8000-0000000024d1'$$,
  'décision 7 : la suppression d''un profil portant une puce assigned et une puce disabled réussit (aucune violation du check stock <=> profile_id nul)'
);
select results_eq(
  $$select id, status, profile_id from carnet.nfc_tags
     where id in ('00000000-0000-4000-8000-0000000024e3', '00000000-0000-4000-8000-0000000024e4') order by id$$,
  $$values ('00000000-0000-4000-8000-0000000024e3'::uuid, 'stock'::text, null::uuid),
           ('00000000-0000-4000-8000-0000000024e4'::uuid, 'stock'::text, null::uuid)$$,
  'décision 7 : après suppression du profil, ses puces (assigned et disabled) sont en stock, profile_id nul'
);
select is(
  (select activation_code_hash from carnet.nfc_tags where id = '00000000-0000-4000-8000-0000000024e3'),
  'h',
  'décision 7 : la remise en stock conserve activation_code_hash (le code imprimé reste valable)'
);

select * from finish();
rollback;
