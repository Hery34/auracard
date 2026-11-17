-- Fiche 0024 — carnet.qr_codes : structure, contraintes en comportement (code, style), RLS (déclaratif), privilèges,
-- propriétés de resolve_qr_code, ensure_qr_code, set_qr_style, cascade à la suppression du profil.
-- Décisions couvertes : 3, 4, 5, 6, 7 (déclaratif et contraintes). Comportements par persona : carnet_qr_codes_access.test.sql.
-- Contrat figé pour db-architect (interprétations les plus strictes, voir rapport 0024) :
--   code ~ '^[0-9a-hjkmnp-tv-z]{8}$', unique ; profile_id not null unique -> carnet.profiles(id) on delete cascade
--   style jsonb not null, défaut exact {"fg":"#000000","bg":"#ffffff","logo":false} ; check : objet, clés exactement
--     fg, bg, logo ; fg et bg chaînes ~ '^#[0-9a-f]{6}$' (minuscules) ; logo booléen JSON
--   trigger qr_codes_set_updated_at ; une seule politique qr_codes_select_own (select, authenticated)
--   authenticated : select de table seulement ; anon et public : rien
--   resolve_qr_code(p_code text) returns text, stable, execute anon/authenticated/service_role
--   ensure_qr_code() returns carnet.qr_codes (une ligne, pas setof), set_qr_style(p_style jsonb) returns carnet.qr_codes,
--   volatiles, execute authenticated seul ; ensure_qr_code contient insert … on conflict (profile_id) do nothing
--   toutes security definer, set search_path = '', propriétaire bypassrls
-- Fixtures (postgres, bypassrls, plage 0…24c*/0…24d* propre à ce fichier) : comptes 0…24c2, 0…24c3 ; profils 0…24d2, 0…24d3.
-- Ajouts après revue (décision 10) : ensure_qr_code vérifie le profil par can_edit_profile (owner_id autorisé pour l'index) ; execute
-- refusé à public, anon, authenticated sur is_valid_qr_style.
-- Tout s'exécute dans une transaction annulée : rien ne persiste.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(96);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000024c2', 'schema-qr-0024@test.local'),
  ('00000000-0000-4000-8000-0000000024c3', 'schema-qr2-0024@test.local');
insert into carnet.profiles (id, owner_id, slug, display_name) values
  ('00000000-0000-4000-8000-0000000024d2', '00000000-0000-4000-8000-0000000024c2', 'schema-qr-0024', 'Schema'),
  ('00000000-0000-4000-8000-0000000024d3', '00000000-0000-4000-8000-0000000024c3', 'schema-qr2-0024', 'Schema 2');

-- ---------------------------------------------------------------------------
-- Décision 3 — table et colonnes
-- ---------------------------------------------------------------------------
select has_table('carnet', 'qr_codes', 'décision 3 : la table carnet.qr_codes existe');
select columns_are(
  'carnet', 'qr_codes',
  array['id', 'code', 'profile_id', 'style', 'created_at', 'updated_at'],
  'décision 3 : qr_codes a exactement les colonnes de la décision 3'
);
select col_type_is('carnet', 'qr_codes', 'id', 'uuid', 'décision 3 : qr_codes.id est uuid');
select col_is_pk('carnet', 'qr_codes', 'id', 'décision 3 : qr_codes.id est la clé primaire');
select col_type_is('carnet', 'qr_codes', 'code', 'text', 'décision 3 : qr_codes.code est text');
select col_not_null('carnet', 'qr_codes', 'code', 'décision 3 : qr_codes.code est not null');
select col_type_is('carnet', 'qr_codes', 'profile_id', 'uuid', 'décision 3 : qr_codes.profile_id est uuid');
select col_not_null('carnet', 'qr_codes', 'profile_id', 'décision 3 : qr_codes.profile_id est not null');
select fk_ok('carnet', 'qr_codes', 'profile_id', 'carnet', 'profiles', 'id', 'décision 3 : qr_codes.profile_id référence carnet.profiles(id)');
select col_type_is('carnet', 'qr_codes', 'style', 'jsonb', 'décision 4 : qr_codes.style est jsonb');
select col_not_null('carnet', 'qr_codes', 'style', 'décision 4 : qr_codes.style est not null');
select col_has_default('carnet', 'qr_codes', 'style', 'décision 4 : qr_codes.style a une valeur par défaut (valeur vérifiée en comportement)');
select col_type_is('carnet', 'qr_codes', 'created_at', 'timestamp with time zone', 'décision 3 : qr_codes.created_at est timestamptz');
select col_not_null('carnet', 'qr_codes', 'created_at', 'décision 3 : qr_codes.created_at est not null');
select col_default_is('carnet', 'qr_codes', 'created_at', 'now()', 'décision 3 : qr_codes.created_at a pour défaut now()');
select col_type_is('carnet', 'qr_codes', 'updated_at', 'timestamp with time zone', 'décision 3 : qr_codes.updated_at est timestamptz');
select col_not_null('carnet', 'qr_codes', 'updated_at', 'décision 3 : qr_codes.updated_at est not null');
select col_default_is('carnet', 'qr_codes', 'updated_at', 'now()', 'décision 3 : qr_codes.updated_at a pour défaut now()');

select ok(
  exists (
    select 1
      from pg_constraint k
     where k.conrelid = to_regclass('carnet.qr_codes')
       and k.contype = 'f'
       and k.confrelid = to_regclass('carnet.profiles')
       and k.confdeltype = 'c'
  ),
  'décision 3 et 7 : la clé étrangère profile_id est on delete cascade'
);
select ok(
  exists (
    select 1
      from pg_index i
     where i.indrelid = to_regclass('carnet.qr_codes')
       and i.indisunique and i.indnatts = 1 and i.indpred is null
       and i.indkey[0] = (select attnum from pg_attribute where attrelid = to_regclass('carnet.qr_codes') and attname = 'code')
  ),
  'décision 3 : un index unique (non partiel) porte sur code seul'
);
select ok(
  exists (
    select 1
      from pg_index i
     where i.indrelid = to_regclass('carnet.qr_codes')
       and i.indisunique and i.indnatts = 1 and i.indpred is null
       and i.indkey[0] = (select attnum from pg_attribute where attrelid = to_regclass('carnet.qr_codes') and attname = 'profile_id')
  ),
  'décision 3 : un index unique (non partiel) porte sur profile_id seul (un QR par profil, cible de on conflict)'
);
select ok(
  exists (
    select 1
      from pg_trigger t
      join pg_proc f on f.oid = t.tgfoid
      join pg_namespace fn on fn.oid = f.pronamespace
     where t.tgrelid = to_regclass('carnet.qr_codes')
       and t.tgname = 'qr_codes_set_updated_at'
       and not t.tgisinternal and t.tgenabled <> 'D'
       and t.tgtype & 1 = 1 and t.tgtype & 2 = 2 and t.tgtype & 16 = 16
       and fn.nspname = 'carnet' and f.proname = 'set_updated_at'
  ),
  'décision 3 : le trigger qr_codes_set_updated_at (before update for each row) appelle carnet.set_updated_at()'
);

-- ---------------------------------------------------------------------------
-- Décisions 3 et 4 — contraintes en comportement (postgres)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into carnet.qr_codes (id, code, profile_id)
    values ('00000000-0000-4000-8000-0000000024e6', '0123abcd', '00000000-0000-4000-8000-0000000024d2')$$,
  'décision 3 : un QR avec un code de 8 caractères de l''alphabet est accepté'
);
select is(
  (select style from carnet.qr_codes where id = '00000000-0000-4000-8000-0000000024e6'),
  '{"fg":"#000000","bg":"#ffffff","logo":false}'::jsonb,
  'décision 4 : un QR créé sans style reçoit le style par défaut'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d2')$$,
  '23505', null, 'décision 3 : un second QR pour le même profil est refusé (23505)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id)
    values ('00000000-0000-4000-8000-0000000024e7', '0123abcd', '00000000-0000-4000-8000-0000000024d3')$$,
  '23505', null, 'décision 3 : code en double refusé (23505)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id)
    values ('00000000-0000-4000-8000-0000000024e7', '0123ABCD', '00000000-0000-4000-8000-0000000024d3')$$,
  '23514', null, 'décision 3 : code en majuscules refusé (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id)
    values ('00000000-0000-4000-8000-0000000024e7', '0123abc', '00000000-0000-4000-8000-0000000024d3')$$,
  '23514', null, 'décision 3 : code de 7 caractères refusé (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id)
    values ('00000000-0000-4000-8000-0000000024e7', '0123abcde', '00000000-0000-4000-8000-0000000024d3')$$,
  '23514', null, 'décision 3 : code de 9 caractères refusé (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id)
    values ('00000000-0000-4000-8000-0000000024e7', '0123abco', '00000000-0000-4000-8000-0000000024d3')$$,
  '23514', null, 'décision 3 : code contenant « o » (hors alphabet) refusé (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id)
    values ('00000000-0000-4000-8000-0000000024e7', E'0123abc\n', '00000000-0000-4000-8000-0000000024d3')$$,
  '23514', null, 'décision 3 : code terminé par un saut de ligne refusé (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id, style)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d3', null)$$,
  '23502', null, 'décision 4 : style nul refusé (23502)'
);

-- Style : chaque cas refusé ne viole que la contrainte de style
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id, style)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d3', '{}')$$,
  '23514', null, 'décision 4 : style objet vide refusé (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id, style)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d3',
            '{"fg":"#000000","bg":"#ffffff"}')$$,
  '23514', null, 'décision 4 : style sans la clé logo refusé (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id, style)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d3',
            '{"fg":"#000000","bg":"#ffffff","logo":false,"shape":"dots"}')$$,
  '23514', null, 'décision 4 : style avec une clé inconnue refusé (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id, style)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d3',
            '{"fg":"#FFFFFF","bg":"#000000","logo":false}')$$,
  '23514', null, 'décision 4 : couleur en majuscules refusée (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id, style)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d3',
            '{"fg":"#fff","bg":"#000000","logo":false}')$$,
  '23514', null, 'décision 4 : couleur courte (#fff) refusée (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id, style)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d3',
            '{"fg":"black","bg":"#ffffff","logo":false}')$$,
  '23514', null, 'décision 4 : couleur nommée refusée (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id, style)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d3',
            '{"fg":"#000000","bg":"#gggggg","logo":false}')$$,
  '23514', null, 'décision 4 : couleur non hexadécimale refusée (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id, style)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d3',
            '{"fg":"#000000\n","bg":"#ffffff","logo":false}')$$,
  '23514', null, 'décision 4 : couleur suivie d''un saut de ligne refusée (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id, style)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d3',
            '{"fg":0,"bg":"#ffffff","logo":false}')$$,
  '23514', null, 'décision 4 : couleur non chaîne refusée (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id, style)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d3',
            '{"fg":"#000000","bg":"#ffffff","logo":"true"}')$$,
  '23514', null, 'décision 4 : logo en chaîne refusé (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id, style)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d3',
            '{"fg":"#000000","bg":"#ffffff","logo":null}')$$,
  '23514', null, 'décision 4 : logo null JSON refusé (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id, style)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d3',
            '[{"fg":"#000000","bg":"#ffffff","logo":false}]')$$,
  '23514', null, 'décision 4 : style tableau refusé (23514)'
);
select throws_ok(
  $$insert into carnet.qr_codes (id, code, profile_id, style)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d3', 'null'::jsonb)$$,
  '23514', null, 'décision 4 : style null JSON refusé (23514)'
);
select lives_ok(
  $$insert into carnet.qr_codes (id, code, profile_id, style)
    values ('00000000-0000-4000-8000-0000000024e7', 'vwxyz012', '00000000-0000-4000-8000-0000000024d3',
            '{"logo":true,"bg":"#ffeedd","fg":"#0a1b2c"}')$$,
  'décision 4 : style valide (clés dans un autre ordre, logo vrai) accepté'
);

update carnet.qr_codes set created_at = '2020-01-01 00:00:00+00' where id = '00000000-0000-4000-8000-0000000024e6';
update carnet.qr_codes set style = '{"fg":"#111111","bg":"#ffffff","logo":false}', updated_at = '2020-01-01 00:00:00+00'
 where id = '00000000-0000-4000-8000-0000000024e6';
select ok(
  (select created_at = '2020-01-01 00:00:00+00' and updated_at = now()
     from carnet.qr_codes where id = '00000000-0000-4000-8000-0000000024e6'),
  'décision 3 : updated_at est posé par le trigger (valeur fournie ignorée), created_at inchangé'
);

-- ---------------------------------------------------------------------------
-- Décision 5 — RLS et privilèges
-- ---------------------------------------------------------------------------
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = to_regclass('carnet.qr_codes')),
  'décision 5 : row level security activée sur carnet.qr_codes'
);
select ok(
  (select c.relforcerowsecurity from pg_class c where c.oid = to_regclass('carnet.qr_codes')),
  'décision 5 : row level security forcée sur carnet.qr_codes'
);
select policies_are('carnet', 'qr_codes', array['qr_codes_select_own'],
  'décision 5 : qr_codes a une seule politique (lecture), aucune politique d''écriture');
select policy_roles_are('carnet', 'qr_codes', 'qr_codes_select_own', array['authenticated'],
  'décision 5 : qr_codes_select_own s''applique au seul rôle authenticated');
select policy_cmd_is('carnet', 'qr_codes', 'qr_codes_select_own', 'SELECT',
  'décision 5 : qr_codes_select_own est une politique select');
select ok(
  exists (
    select 1
      from pg_policy p
     where p.polrelid = to_regclass('carnet.qr_codes')
       and p.polname = 'qr_codes_select_own'
       and pg_get_expr(p.polqual, p.polrelid) ~* '^\(*\s*select\s+carnet\.is_member\(\s*\)'
       and pg_get_expr(p.polqual, p.polrelid) ~* '\(\s*select\s+carnet\.can_edit_profile\(\s*(qr_codes\.)?profile_id\s*\)'
  ),
  'décision 5 (ADR 0004) : qr_codes_select_own commence par (select carnet.is_member()) et appelle (select carnet.can_edit_profile(profile_id))'
);
select table_privs_are('carnet', 'qr_codes', 'anon', '{}'::name[], 'décision 5 : anon n''a aucun privilège sur qr_codes');
select table_privs_are('carnet', 'qr_codes', 'public', '{}'::name[], 'décision 5 : public n''a aucun privilège sur qr_codes');
select table_privs_are('carnet', 'qr_codes', 'authenticated', array['SELECT'],
  'décision 5 : authenticated n''a que select sur qr_codes (filtré par RLS), aucun droit d''écriture');
select ok(
  not has_any_column_privilege('authenticated', 'carnet.qr_codes', 'INSERT')
  and not has_any_column_privilege('authenticated', 'carnet.qr_codes', 'UPDATE')
  and not has_any_column_privilege('authenticated', 'carnet.qr_codes', 'REFERENCES'),
  'décision 5 : authenticated n''a insert, update ni references sur aucune colonne de qr_codes'
);
select ok(
  not has_any_column_privilege('anon', 'carnet.qr_codes', 'SELECT'),
  'décision 5 : anon n''a select sur aucune colonne de qr_codes'
);
select is_empty(
  $$select 1 from pg_publication_tables where schemaname = 'carnet' and tablename = 'qr_codes'$$,
  'décision 5 : carnet.qr_codes n''est pas publiée dans Realtime'
);

-- ---------------------------------------------------------------------------
-- Décision 6 — carnet.resolve_qr_code(text)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'resolve_qr_code', array['text'], 'décision 6 : carnet.resolve_qr_code(text) existe');
select function_returns('carnet', 'resolve_qr_code', array['text'], 'text', 'décision 6 : resolve_qr_code renvoie text');
select is_definer('carnet', 'resolve_qr_code', array['text'], 'décision 6 : resolve_qr_code est security definer');
select volatility_is('carnet', 'resolve_qr_code', array['text'], 'stable', 'décision 6 : resolve_qr_code est stable');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.resolve_qr_code(text)')
             and not p.proretset
             and p.proconfig @> array['search_path=""']
             and p.proargnames = array['p_code']),
  'décision 6 : resolve_qr_code(p_code) fixe set search_path = '''' et ne renvoie pas un ensemble'
);
select function_privs_are('carnet', 'resolve_qr_code', array['text'], 'anon', array['EXECUTE'], 'décision 6 : execute accordé à anon sur resolve_qr_code');
select function_privs_are('carnet', 'resolve_qr_code', array['text'], 'authenticated', array['EXECUTE'], 'décision 6 : execute accordé à authenticated sur resolve_qr_code');
select function_privs_are('carnet', 'resolve_qr_code', array['text'], 'service_role', array['EXECUTE'], 'décision 6 : execute accordé à service_role sur resolve_qr_code');
select function_privs_are('carnet', 'resolve_qr_code', array['text'], 'public', '{}'::name[], 'décision 6 : execute révoqué pour public sur resolve_qr_code');

-- ---------------------------------------------------------------------------
-- Décision 6 — carnet.ensure_qr_code()
-- ---------------------------------------------------------------------------
select has_function('carnet', 'ensure_qr_code', '{}'::name[], 'décision 6 : carnet.ensure_qr_code() existe');
select function_returns('carnet', 'ensure_qr_code', '{}'::name[], 'carnet.qr_codes', 'décision 6 : ensure_qr_code renvoie une ligne carnet.qr_codes');
select is_definer('carnet', 'ensure_qr_code', '{}'::name[], 'décision 6 : ensure_qr_code est security definer');
select volatility_is('carnet', 'ensure_qr_code', '{}'::name[], 'volatile', 'décision 6 : ensure_qr_code est volatile');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.ensure_qr_code()')
             and not p.proretset
             and p.proconfig @> array['search_path=""']),
  'décision 6 : ensure_qr_code fixe set search_path = '''' et renvoie une seule ligne (pas setof)'
);
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.ensure_qr_code()')
             and pg_get_functiondef(p.oid) ~* 'insert\s+into\s+carnet\.qr_codes.*on\s+conflict\s*\(\s*profile_id\s*\)\s*do\s+nothing'),
  'décision 6 : ensure_qr_code insère par insert … on conflict (profile_id) do nothing (idempotent sous concurrence)'
);
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.ensure_qr_code()')
             and pg_get_functiondef(p.oid) ~* 'carnet\.can_edit_profile\('),
  'décision 10 : ensure_qr_code vérifie le profil de l''appelant par carnet.can_edit_profile (filtre owner_id indexé autorisé)'
);
select function_privs_are('carnet', 'ensure_qr_code', '{}'::name[], 'authenticated', array['EXECUTE'], 'décision 6 : execute accordé à authenticated sur ensure_qr_code');
select function_privs_are('carnet', 'ensure_qr_code', '{}'::name[], 'anon', '{}'::name[], 'décision 6 : execute refusé à anon sur ensure_qr_code');
select function_privs_are('carnet', 'ensure_qr_code', '{}'::name[], 'service_role', '{}'::name[], 'décision 6 : execute refusé à service_role sur ensure_qr_code');
select function_privs_are('carnet', 'ensure_qr_code', '{}'::name[], 'public', '{}'::name[], 'décision 6 : execute révoqué pour public sur ensure_qr_code');

-- ---------------------------------------------------------------------------
-- Décision 6 — carnet.set_qr_style(jsonb)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'set_qr_style', array['jsonb'], 'décision 6 : carnet.set_qr_style(jsonb) existe');
select function_returns('carnet', 'set_qr_style', array['jsonb'], 'carnet.qr_codes', 'décision 6 : set_qr_style renvoie une ligne carnet.qr_codes');
select is_definer('carnet', 'set_qr_style', array['jsonb'], 'décision 6 : set_qr_style est security definer');
select volatility_is('carnet', 'set_qr_style', array['jsonb'], 'volatile', 'décision 6 : set_qr_style est volatile');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.set_qr_style(jsonb)')
             and not p.proretset
             and p.proconfig @> array['search_path=""']
             and p.proargnames = array['p_style']),
  'décision 6 : set_qr_style(p_style) fixe set search_path = '''' et renvoie une seule ligne'
);
select function_privs_are('carnet', 'set_qr_style', array['jsonb'], 'authenticated', array['EXECUTE'], 'décision 6 : execute accordé à authenticated sur set_qr_style');
select function_privs_are('carnet', 'set_qr_style', array['jsonb'], 'anon', '{}'::name[], 'décision 6 : execute refusé à anon sur set_qr_style');
select function_privs_are('carnet', 'set_qr_style', array['jsonb'], 'service_role', '{}'::name[], 'décision 6 : execute refusé à service_role sur set_qr_style');
select function_privs_are('carnet', 'set_qr_style', array['jsonb'], 'public', '{}'::name[], 'décision 6 : execute révoqué pour public sur set_qr_style');

select is(
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_roles r on r.oid = p.proowner
    where n.nspname = 'carnet'
      and p.proname in ('resolve_qr_code', 'ensure_qr_code', 'set_qr_style')
      and (r.rolbypassrls or r.rolsuper)),
  3::bigint,
  'décision 6 : les trois fonctions QR existent une seule fois chacune et leur propriétaire contourne la RLS'
);
select is_empty(
  $$select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('resolve_qr_code', 'ensure_qr_code', 'set_qr_style')$$,
  'supabase.md : aucune fonction QR dans le schéma public'
);

-- Décision 10 — fonction interne de validation du style : execute refusé aux rôles API non privilégiés
select function_privs_are('carnet', 'is_valid_qr_style', array['jsonb'], 'public', '{}'::name[], 'décision 10 : execute refusé à public sur is_valid_qr_style');
select function_privs_are('carnet', 'is_valid_qr_style', array['jsonb'], 'anon', '{}'::name[], 'décision 10 : execute refusé à anon sur is_valid_qr_style');
select function_privs_are('carnet', 'is_valid_qr_style', array['jsonb'], 'authenticated', '{}'::name[], 'décision 10 : execute refusé à authenticated sur is_valid_qr_style');

-- ---------------------------------------------------------------------------
-- Décision 7 — suppression d'un profil : QR supprimé (contrôle direct, postgres)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$delete from carnet.profiles where id = '00000000-0000-4000-8000-0000000024d2'$$,
  'décision 7 : la suppression d''un profil portant un QR réussit'
);
select is_empty(
  $$select 1 from carnet.qr_codes where profile_id = '00000000-0000-4000-8000-0000000024d2'
       or id = '00000000-0000-4000-8000-0000000024e6'$$,
  'décision 7 : le QR du profil supprimé est supprimé'
);
select is(
  (select count(*) from carnet.qr_codes where id = '00000000-0000-4000-8000-0000000024e7'),
  1::bigint,
  'décision 7 : le QR d''un autre profil n''est pas touché'
);

select * from finish();
rollback;
