-- Fiche 0021 / ADR 0014 — images du profil dans Supabase Storage : colonne logo_url, bucket carnet-media, politiques
-- sur storage.objects limitées au bucket, fonctions carnet.media_profile_id et carnet.set_profile_image.
-- Critère couvert : 1 (téléversement, remplacement et suppression par le propriétaire ; aucun autre compte, projet ou
-- anon ne peut écrire dans le dossier). Le critère 2 (type réel, taille, EXIF) est vérifié côté serveur (Vitest) ; la
-- double application de la migration (rejouable) est prouvée par db-architect.
-- Contrat (noms exacts attendus de la migration) :
--   carnet.profiles.logo_url text null, contrainte profiles_logo_url_length_check (≤ 2048), pas de privilège
--     insert/update de colonne pour authenticated (comme avatar_url et banner_url, 0022)
--   bucket carnet-media : public, file_size_limit 2097152, allowed_mime_types {image/jpeg,image/png,image/webp}
--   carnet.media_profile_id(text) returns uuid, immutable, search_path '' : premier segment du chemin s'il est un UUID
--     valide, sinon null (jamais d'erreur)
--     (décision 10 : UUID en minuscules seulement)
--   carnet.is_valid_media_name(text) returns boolean, immutable, search_path '' (décision 10) :
--     ^<uuid minuscule>/(avatar|banner|logo)-<uuid minuscule>\.(jpg|png|webp)$, false (jamais null ni erreur) sinon
--   politiques storage.objects carnet_media_select_own / _insert_own / _update_own / _delete_own, to authenticated,
--     (select carnet.is_member()) en tête, puis bucket_id = 'carnet-media', puis
--     (select carnet.can_edit_profile(carnet.media_profile_id(name))) ; with check d'insert et d'update avec
--     carnet.is_valid_media_name(name)
--   carnet.set_profile_image(p_kind text, p_object_name text) returns text, security definer, search_path '',
--     execute pour authenticated seulement ; 22023 (kind ou nom invalide, objet absent, metadata->>'mimetype'
--     incohérent avec l'extension), 42501 (sans profil carnet) ; passe par carnet.can_edit_profile ; renvoie l'ancien
--     nom d'objet ; ne supprime pas l'ancien objet (la Server Action le fait par l'API Storage) ; pas d'update si la
--     valeur ne change pas (updated_at stable au rejeu)
--   contrainte profiles_media_names_check (décision 10) : avatar_url, banner_url, logo_url nuls ou noms valides dont
--     le dossier est l'id du profil et le kind celui de la colonne
-- Écritures dans storage.objects : sous postgres pour les fixtures, sous authenticated / anon avec request.jwt.claims
-- simulé pour les comportements (c'est ce que fait storage-api, qui exécute les requêtes sous le rôle du JWT).
-- Le trigger de protection de storage-api refuse les delete SQL directs hors de l'API : on positionne
-- storage.allow_delete_query comme le fait l'API, pour éprouver la politique de delete elle-même.
-- Personas (UUID fixes, plage 0…21xx propre à cette fiche) :
--   O  0…210a  membre (user) de carnet, propriétaire du profil P1 0…2110 (slug olga-0021)
--   M  0…210b  membre (user) de carnet, propriétaire du profil P2 0…2111 (slug marc-0021)
--   N  0…210c  compte sans appartenance, profil orphelin PN 0…2112 (slug nina-0021)
--   X  0…210d  membre de other_0021 (projet 0…2102), profil orphelin PX 0…2113 (slug xavier-0021)
--   I  0…210e  membre (user) de carnet sans profil
--   U  0…210f  membre (user) de carnet, propriétaire du profil PU 0…21af (id avec lettres : cas des majuscules)
--   anon      rôle anon, claims sans sub
-- Bucket de test other-0021 (privé), créé sous postgres : simule le bucket d'un autre projet de l'instance.
-- Fixtures créées par postgres (bypassrls) dans la transaction, annulées par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(154);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000210a', 'o-carnet-0021@test.local'),
  ('00000000-0000-4000-8000-00000000210b', 'm-carnet-0021@test.local'),
  ('00000000-0000-4000-8000-00000000210c', 'n-no-member-0021@test.local'),
  ('00000000-0000-4000-8000-00000000210d', 'x-other-0021@test.local'),
  ('00000000-0000-4000-8000-00000000210e', 'i-no-profile-0021@test.local'),
  ('00000000-0000-4000-8000-00000000210f', 'u-carnet-0021@test.local');

insert into platform.projects (id, slug, name, db_schema)
  values ('00000000-0000-4000-8000-000000002102', 'other_0021', 'Other 0021', 'other_0021');

insert into platform.project_members (project_id, user_id, role)
  select id, u.user_id, 'user'
    from platform.projects,
         (values ('00000000-0000-4000-8000-00000000210a'::uuid),
                 ('00000000-0000-4000-8000-00000000210b'::uuid),
                 ('00000000-0000-4000-8000-00000000210e'::uuid),
                 ('00000000-0000-4000-8000-00000000210f'::uuid)) as u (user_id)
   where slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  values ('00000000-0000-4000-8000-000000002102', '00000000-0000-4000-8000-00000000210d', 'user');

insert into carnet.profiles (id, owner_id, slug, display_name) values
  ('00000000-0000-4000-8000-000000002110', '00000000-0000-4000-8000-00000000210a', 'olga-0021', 'Olga'),
  ('00000000-0000-4000-8000-000000002111', '00000000-0000-4000-8000-00000000210b', 'marc-0021', 'Marc'),
  ('00000000-0000-4000-8000-000000002112', '00000000-0000-4000-8000-00000000210c', 'nina-0021', 'Nina'),
  ('00000000-0000-4000-8000-000000002113', '00000000-0000-4000-8000-00000000210d', 'xavier-0021', 'Xavier'),
  ('00000000-0000-4000-8000-0000000021af', '00000000-0000-4000-8000-00000000210f', 'ursula-0021', 'Ursula');

insert into storage.buckets (id, name, public) values ('other-0021', 'other-0021', false);

insert into storage.objects (bucket_id, name) values
  ('other-0021', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021c1.jpg');

-- ---------------------------------------------------------------------------
-- Colonne logo_url
-- ---------------------------------------------------------------------------
select has_column('carnet', 'profiles', 'logo_url', 'critère 1 : carnet.profiles a une colonne logo_url');
select col_type_is('carnet', 'profiles', 'logo_url', 'text', 'critère 1 : logo_url est de type text');
select col_is_null('carnet', 'profiles', 'logo_url', 'critère 1 : logo_url est nullable');
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'profiles_logo_url_length_check'
       and conrelid = 'carnet.profiles'::regclass
       and contype = 'c'
       and convalidated
  ),
  'critère 1 : contrainte check profiles_logo_url_length_check présente et validée sur carnet.profiles'
);
select throws_ok(
  $$update carnet.profiles set logo_url = repeat('a', 2049) where id = '00000000-0000-4000-8000-000000002110'$$,
  '23514', null,
  'critère 1 : logo_url de 2049 caractères refusé (profiles_logo_url_length_check)'
);

-- Contrainte profiles_media_names_check (décision 10), éprouvée sous postgres (aucun privilège de colonne en jeu)
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'profiles_media_names_check'
       and conrelid = 'carnet.profiles'::regclass
       and contype = 'c'
       and convalidated
  ),
  'critère 1 (décision 10) : contrainte check profiles_media_names_check présente et validée sur carnet.profiles'
);
select throws_ok(
  $$update carnet.profiles
       set avatar_url = '00000000-0000-4000-8000-000000002111/avatar-00000000-0000-4000-8000-0000000021b1.jpg'
     where id = '00000000-0000-4000-8000-000000002110'$$,
  '23514', null,
  'critère 1 (décision 10) : avatar_url désignant le dossier d''un autre profil refusé (23514)'
);
select throws_ok(
  $$update carnet.profiles
       set banner_url = '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a1.jpg'
     where id = '00000000-0000-4000-8000-000000002110'$$,
  '23514', null,
  'critère 1 (décision 10) : banner_url contenant un nom avatar-… refusé (kind de la colonne, 23514)'
);
select throws_ok(
  $$update carnet.profiles set avatar_url = 'https://cdn.example.test/a.png' where id = '00000000-0000-4000-8000-000000002110'$$,
  '23514', null,
  'critère 1 (décision 10) : avatar_url contenant une URL https refusé (nom d''objet seulement, 23514)'
);
select throws_ok(
  $$update carnet.profiles set logo_url = 'https://cdn.example.test/l.png' where id = '00000000-0000-4000-8000-000000002110'$$,
  '23514', null,
  'critère 1 (décision 10) : logo_url contenant une URL https refusé (23514)'
);
select lives_ok(
  $$update carnet.profiles
       set avatar_url = '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a1.jpg',
           banner_url = '00000000-0000-4000-8000-000000002110/banner-00000000-0000-4000-8000-0000000021a3.png',
           logo_url   = '00000000-0000-4000-8000-000000002110/logo-00000000-0000-4000-8000-0000000021a4.webp'
     where id = '00000000-0000-4000-8000-000000002110'$$,
  'critère 1 (décision 10) : noms valides du dossier du profil, kind conforme à chaque colonne, acceptés'
);
update carnet.profiles set avatar_url = null, banner_url = null, logo_url = null
 where id = '00000000-0000-4000-8000-000000002110';

select is(has_column_privilege('authenticated', 'carnet.profiles', 'logo_url', 'UPDATE'), false,
  'critère 1 : authenticated n''a pas le privilège update sur logo_url');
select is(has_column_privilege('authenticated', 'carnet.profiles', 'logo_url', 'INSERT'), false,
  'critère 1 : authenticated n''a pas le privilège insert sur logo_url');
select is(has_column_privilege('authenticated', 'carnet.profiles', 'avatar_url', 'UPDATE'), false,
  'critère 1 : authenticated n''a toujours pas le privilège update sur avatar_url');
select is(has_column_privilege('authenticated', 'carnet.profiles', 'banner_url', 'UPDATE'), false,
  'critère 1 : authenticated n''a toujours pas le privilège update sur banner_url');

-- ---------------------------------------------------------------------------
-- Bucket carnet-media
-- ---------------------------------------------------------------------------
select results_eq(
  $$select name, public, file_size_limit,
           (select array_agg(m order by m) from unnest(allowed_mime_types) as m)
      from storage.buckets where id = 'carnet-media'$$,
  $$values ('carnet-media'::text, true, 2097152::bigint, array['image/jpeg', 'image/png', 'image/webp']::text[])$$,
  'critère 1 : bucket carnet-media public, 2 Mo, image/jpeg|png|webp'
);

-- ---------------------------------------------------------------------------
-- carnet.media_profile_id
-- ---------------------------------------------------------------------------
select has_function('carnet', 'media_profile_id', array['text'], 'critère 1 : carnet.media_profile_id(text) existe');
select function_returns('carnet', 'media_profile_id', array['text'], 'uuid', 'critère 1 : media_profile_id renvoie uuid');
select volatility_is('carnet', 'media_profile_id', array['text'], 'immutable', 'critère 1 : media_profile_id est immutable');
select ok(
  exists (
    select 1 from pg_catalog.pg_proc p
     where p.pronamespace = 'carnet'::regnamespace
       and p.proname = 'media_profile_id'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 1 : media_profile_id fixe set search_path = '''' (proconfig)'
);
select is(
  carnet.media_profile_id('00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a1.jpg'),
  '00000000-0000-4000-8000-000000002110'::uuid,
  'critère 1 : media_profile_id renvoie le premier segment UUID du chemin'
);
select is(carnet.media_profile_id('not-a-uuid/avatar-x.jpg'), null::uuid,
  'critère 1 : media_profile_id renvoie null si le premier segment n''est pas un UUID');
select is(carnet.media_profile_id('00000000-0000-4000-8000-00000000211/avatar-x.jpg'), null::uuid,
  'critère 1 : media_profile_id renvoie null pour un UUID tronqué (aucune erreur de conversion)');
select is(carnet.media_profile_id('zzzzzzzz-0000-4000-8000-000000002110/avatar-x.jpg'), null::uuid,
  'critère 1 : media_profile_id renvoie null pour un segment au format UUID mais non hexadécimal');
select is(carnet.media_profile_id('../00000000-0000-4000-8000-000000002110/avatar-x.jpg'), null::uuid,
  'critère 1 : media_profile_id ne cherche pas l''UUID au-delà du premier segment');
select is(carnet.media_profile_id('avatar-x.jpg'), null::uuid,
  'critère 1 : media_profile_id renvoie null pour un nom à la racine');
select is(carnet.media_profile_id(''), null::uuid, 'critère 1 : media_profile_id renvoie null pour une chaîne vide');
select is(carnet.media_profile_id(null), null::uuid, 'critère 1 : media_profile_id renvoie null pour null');
select is(carnet.media_profile_id('00000000-0000-4000-8000-0000000021AF/avatar-00000000-0000-4000-8000-0000000021ab.jpg'), null::uuid,
  'critère 1 (décision 10) : media_profile_id renvoie null pour un dossier en majuscules');
select is(carnet.media_profile_id('00000000-0000-4000-8000-0000000021af/avatar-00000000-0000-4000-8000-0000000021ab.jpg'),
  '00000000-0000-4000-8000-0000000021af'::uuid,
  'critère 1 (décision 10) : media_profile_id accepte un dossier en minuscules contenant des lettres');
select function_privs_are('carnet', 'media_profile_id', array['text'], 'anon', '{}'::name[],
  'critère 1 : execute révoqué pour anon sur media_profile_id');
select function_privs_are('carnet', 'media_profile_id', array['text'], 'public', '{}'::name[],
  'critère 1 : execute révoqué pour public sur media_profile_id');

-- ---------------------------------------------------------------------------
-- carnet.is_valid_media_name (décision 10)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'is_valid_media_name', array['text'], 'critère 1 (décision 10) : carnet.is_valid_media_name(text) existe');
select function_returns('carnet', 'is_valid_media_name', array['text'], 'boolean', 'critère 1 (décision 10) : is_valid_media_name renvoie boolean');
select volatility_is('carnet', 'is_valid_media_name', array['text'], 'immutable', 'critère 1 (décision 10) : is_valid_media_name est immutable');
select ok(
  exists (
    select 1 from pg_catalog.pg_proc p
     where p.pronamespace = 'carnet'::regnamespace
       and p.proname = 'is_valid_media_name'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 1 (décision 10) : is_valid_media_name fixe set search_path = '''' (proconfig)'
);
select is(carnet.is_valid_media_name('00000000-0000-4000-8000-0000000021af/avatar-00000000-0000-4000-8000-0000000021ab.jpg'), true,
  'critère 1 (décision 10) : is_valid_media_name accepte <uuid>/avatar-<uuid>.jpg en minuscules');
select is(carnet.is_valid_media_name('00000000-0000-4000-8000-0000000021af/banner-00000000-0000-4000-8000-0000000021ab.png'), true,
  'critère 1 (décision 10) : is_valid_media_name accepte <uuid>/banner-<uuid>.png');
select is(carnet.is_valid_media_name('00000000-0000-4000-8000-0000000021af/logo-00000000-0000-4000-8000-0000000021ab.webp'), true,
  'critère 1 (décision 10) : is_valid_media_name accepte <uuid>/logo-<uuid>.webp');
select is(carnet.is_valid_media_name('00000000-0000-4000-8000-0000000021AF/avatar-00000000-0000-4000-8000-0000000021ab.jpg'), false,
  'critère 1 (décision 10) : is_valid_media_name refuse un dossier en majuscules');
select is(carnet.is_valid_media_name('00000000-0000-4000-8000-0000000021af/avatar-00000000-0000-4000-8000-0000000021AB.jpg'), false,
  'critère 1 (décision 10) : is_valid_media_name refuse un UUID de fichier en majuscules');
select is(carnet.is_valid_media_name('00000000-0000-4000-8000-0000000021af/../00000000-0000-4000-8000-000000002111/avatar-00000000-0000-4000-8000-0000000021ab.jpg'), false,
  'critère 1 (décision 10) : is_valid_media_name refuse un chemin contenant ..');
select is(carnet.is_valid_media_name('00000000-0000-4000-8000-0000000021af/sub/avatar-00000000-0000-4000-8000-0000000021ab.jpg'), false,
  'critère 1 (décision 10) : is_valid_media_name refuse un sous-dossier');
select is(carnet.is_valid_media_name('00000000-0000-4000-8000-0000000021af/avatar.jpg'), false,
  'critère 1 (décision 10) : is_valid_media_name refuse <id>/avatar.jpg (UUID de fichier manquant)');
select is(carnet.is_valid_media_name('00000000-0000-4000-8000-0000000021af/photo-00000000-0000-4000-8000-0000000021ab.jpg'), false,
  'critère 1 (décision 10) : is_valid_media_name refuse un kind hors avatar|banner|logo');
select is(carnet.is_valid_media_name('00000000-0000-4000-8000-0000000021af/avatar-00000000-0000-4000-8000-0000000021ab.gif'), false,
  'critère 1 (décision 10) : is_valid_media_name refuse l''extension .gif');
select is(carnet.is_valid_media_name('00000000-0000-4000-8000-0000000021af/avatar-00000000-0000-4000-8000-0000000021ab.jpeg'), false,
  'critère 1 (décision 10) : is_valid_media_name refuse l''extension .jpeg');
select is(carnet.is_valid_media_name('00000000-0000-4000-8000-0000000021af/avatar-00000000-0000-4000-8000-0000000021ab.jpg' || chr(10)), false,
  'critère 1 (décision 10) : is_valid_media_name refuse un saut de ligne final (motif ancré)');
select is(carnet.is_valid_media_name(''), false, 'critère 1 (décision 10) : is_valid_media_name refuse la chaîne vide');
select is(carnet.is_valid_media_name(null), false, 'critère 1 (décision 10) : is_valid_media_name renvoie false (pas null) pour null');

-- ---------------------------------------------------------------------------
-- Politiques storage.objects (déclaratif)
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(policyname || ':' || cmd || ':' || permissive || ':' || array_to_string(roles, ','), ' ' order by policyname)
     from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'carnet%'),
  'carnet_media_delete_own:DELETE:PERMISSIVE:authenticated carnet_media_insert_own:INSERT:PERMISSIVE:authenticated '
  || 'carnet_media_select_own:SELECT:PERMISSIVE:authenticated carnet_media_update_own:UPDATE:PERMISSIVE:authenticated',
  'critère 1 : exactement quatre politiques carnet_media_* sur storage.objects, permissives, to authenticated'
);
select is_empty(
  $$select policyname from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname like 'carnet%'
       and ((qual is null and with_check is null)
            or (qual is not null and qual not like '%bucket_id = ''carnet-media''::text%')
            or (with_check is not null and with_check not like '%bucket_id = ''carnet-media''::text%'))$$,
  'critère 1 : chaque expression (using et with check) des politiques carnet_media_* est limitée au bucket carnet-media'
);
select is_empty(
  $$select policyname from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname like 'carnet%'
       and coalesce(qual, '') !~ 'carnet\.can_edit_profile\(carnet\.media_profile_id\((objects\.)?name\)\)'
       and coalesce(with_check, '') !~ 'carnet\.can_edit_profile\(carnet\.media_profile_id\((objects\.)?name\)\)'$$,
  'critère 1 : chaque politique carnet_media_* passe par carnet.can_edit_profile(carnet.media_profile_id(name))'
);
select is_empty(
  $$select policyname from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname like 'carnet%'
       and ((qual is not null
             and qual !~ '^\(\( SELECT carnet\.is_member\(\) AS is_member\) AND \(bucket_id = ''carnet-media''::text\) AND ')
            or (with_check is not null
             and with_check !~ '^\(\( SELECT carnet\.is_member\(\) AS is_member\) AND \(bucket_id = ''carnet-media''::text\) AND '))$$,
  'critère 1 (décision 10) : chaque expression des politiques carnet_media_* commence par (select carnet.is_member()) puis le bucket'
);
select is_empty(
  $$select policyname from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname in ('carnet_media_insert_own', 'carnet_media_update_own')
       and coalesce(with_check, '') !~ 'carnet\.is_valid_media_name\((objects\.)?name\)'$$,
  'critère 1 (décision 10) : le with check des politiques d''insertion et de modification appelle carnet.is_valid_media_name(name)'
);
select is_empty(
  $$select policyname from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename in ('objects', 'buckets')
       and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(carnet-media|carnet\.)'
       and (roles && array['anon', 'public']::name[] or policyname not like 'carnet%')$$,
  'critère 1 : aucune politique anon ou public ni hors préfixe carnet_ ne concerne carnet-media ou carnet.*'
);
select is_empty(
  $$select policyname from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'buckets' and policyname like 'carnet%'$$,
  'critère 1 : aucune politique carnet sur storage.buckets (pas de liste des buckets)'
);

-- ---------------------------------------------------------------------------
-- Fixtures dépendant du bucket (postgres) : objet de M, objets aux noms invalides pour set_profile_image
-- ---------------------------------------------------------------------------
insert into storage.objects (bucket_id, name) values
  ('carnet-media', '00000000-0000-4000-8000-000000002111/avatar-00000000-0000-4000-8000-0000000021b1.jpg'),
  ('carnet-media', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021d2.gif'),
  ('carnet-media', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021d3.jpeg'),
  ('carnet-media', '00000000-0000-4000-8000-000000002110/avatar-not-a-uuid.jpg'),
  ('carnet-media', '00000000-0000-4000-8000-000000002110/sub/avatar-00000000-0000-4000-8000-0000000021d4.jpg'),
  ('carnet-media', '00000000-0000-4000-8000-000000002110/photo-00000000-0000-4000-8000-0000000021d5.jpg'),
  ('carnet-media', '00000000-0000-4000-8000-000000002112/avatar-00000000-0000-4000-8000-0000000021e1.jpg'),
  ('carnet-media', '00000000-0000-4000-8000-000000002113/avatar-00000000-0000-4000-8000-0000000021e2.jpg');

-- ---------------------------------------------------------------------------
-- Comportement storage.objects — O : propriétaire
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000210a","role":"authenticated"}';

select lives_ok(
  $$insert into storage.objects (bucket_id, name) values
      ('carnet-media', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a1.jpg'),
      ('carnet-media', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a2.webp'),
      ('carnet-media', '00000000-0000-4000-8000-000000002110/banner-00000000-0000-4000-8000-0000000021a3.png'),
      ('carnet-media', '00000000-0000-4000-8000-000000002110/logo-00000000-0000-4000-8000-0000000021a4.jpg'),
      ('carnet-media', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a9.jpg')$$,
  'critère 1 : le propriétaire téléverse dans le dossier de son profil'
);
select results_eq(
  $$select count(*) from storage.objects
     where bucket_id = 'carnet-media' and name like '00000000-0000-4000-8000-000000002110/%'$$,
  $$values (10::bigint)$$,
  'critère 1 : le propriétaire lit les objets de son dossier'
);
select is_empty(
  $$select name from storage.objects
     where bucket_id = 'carnet-media' and name not like '00000000-0000-4000-8000-000000002110/%'$$,
  'critère 1 : le propriétaire ne lit aucun objet hors de son dossier dans carnet-media'
);
with updated as (
  update storage.objects set metadata = '{"mimetype":"image/jpeg"}'::jsonb
   where bucket_id = 'carnet-media'
     and name = '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a9.jpg'
  returning 1
)
select is(count(*), 1::bigint, 'critère 1 : le propriétaire met à jour un objet de son dossier (1 ligne)') from updated;
select throws_ok(
  $$update storage.objects
       set name = '00000000-0000-4000-8000-000000002111/avatar-00000000-0000-4000-8000-0000000021f1.jpg'
     where bucket_id = 'carnet-media'
       and name = '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a9.jpg'$$,
  '42501', null,
  'critère 1 : le propriétaire ne déplace pas un objet vers le dossier d''un autre profil (with check)'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002111/avatar-00000000-0000-4000-8000-0000000021f2.jpg')$$,
  '42501', null,
  'critère 1 : le propriétaire ne téléverse pas dans le dossier d''un autre profil'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('carnet-media', 'not-a-uuid/avatar-x.jpg')$$,
  '42501', null,
  'critère 1 : téléversement refusé si le premier segment n''est pas un UUID'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('carnet-media', 'avatar-00000000-0000-4000-8000-0000000021f3.jpg')$$,
  '42501', null,
  'critère 1 : téléversement refusé à la racine du bucket'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('carnet-media', '00000000-0000-4000-8000-000000002110/avatar.jpg')$$,
  '42501', null,
  'critère 1 (décision 10) : le propriétaire ne téléverse pas <son dossier>/avatar.jpg (nom mal formé)'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('carnet-media', '00000000-0000-4000-8000-000000002110/sub/x.jpg')$$,
  '42501', null,
  'critère 1 (décision 10) : le propriétaire ne téléverse pas dans un sous-dossier de son dossier'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002110/../00000000-0000-4000-8000-000000002111/avatar-00000000-0000-4000-8000-0000000021f0.jpg')$$,
  '42501', null,
  'critère 1 (décision 10) : le propriétaire ne téléverse pas un chemin <son dossier>/../<autre profil>/…'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021f0.gif')$$,
  '42501', null,
  'critère 1 (décision 10) : le propriétaire ne téléverse pas un nom en .gif dans son dossier'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021AB.jpg')$$,
  '42501', null,
  'critère 1 (décision 10) : le propriétaire ne téléverse pas un nom dont l''UUID de fichier est en majuscules'
);
select throws_ok(
  $$update storage.objects set name = '00000000-0000-4000-8000-000000002110/avatar.jpg'
     where bucket_id = 'carnet-media'
       and name = '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a9.jpg'$$,
  '42501', null,
  'critère 1 (décision 10) : le propriétaire ne renomme pas son objet en un nom mal formé (with check)'
);
select throws_ok(
  $$update storage.objects set bucket_id = 'other-0021'
     where bucket_id = 'carnet-media'
       and name = '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a9.jpg'$$,
  '42501', null,
  'critère 1 : le propriétaire ne déplace pas son objet vers le bucket d''un autre projet (with check)'
);
with updated as (
  update storage.objects set metadata = '{"x":1}'::jsonb
   where bucket_id = 'carnet-media'
     and name = '00000000-0000-4000-8000-000000002111/avatar-00000000-0000-4000-8000-0000000021b1.jpg'
  returning 1
)
select is(count(*), 0::bigint, 'critère 1 : le propriétaire ne modifie pas l''objet d''un autre profil (0 ligne)') from updated;

set local storage.allow_delete_query = 'true';
with deleted as (
  delete from storage.objects
   where bucket_id = 'carnet-media'
     and name = '00000000-0000-4000-8000-000000002111/avatar-00000000-0000-4000-8000-0000000021b1.jpg'
  returning 1
)
select is(count(*), 0::bigint, 'critère 1 : le propriétaire ne supprime pas l''objet d''un autre profil (0 ligne)') from deleted;
with deleted as (
  delete from storage.objects
   where bucket_id = 'carnet-media'
     and name = '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a9.jpg'
  returning 1
)
select is(count(*), 1::bigint, 'critère 1 : le propriétaire supprime un objet de son dossier (1 ligne)') from deleted;

-- Autre bucket : nos politiques ne donnent rien, même pour un nom dans le dossier du profil de O.
select is_empty(
  $$select name from storage.objects where bucket_id = 'other-0021'$$,
  'critère 1 : le propriétaire ne lit rien dans le bucket d''un autre projet, même sous le dossier de son profil'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('other-0021', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021f4.jpg')$$,
  '42501', null,
  'critère 1 : le propriétaire n''écrit pas dans le bucket d''un autre projet, même sous le dossier de son profil'
);
with updated as (
  update storage.objects set metadata = '{"x":1}'::jsonb where bucket_id = 'other-0021' returning 1
)
select is(count(*), 0::bigint, 'critère 1 : le propriétaire ne modifie rien dans le bucket d''un autre projet') from updated;
with deleted as (
  delete from storage.objects where bucket_id = 'other-0021' returning 1
)
select is(count(*), 0::bigint, 'critère 1 : le propriétaire ne supprime rien dans le bucket d''un autre projet') from deleted;
reset storage.allow_delete_query;
reset role;

select results_eq(
  $$select name, metadata from storage.objects where bucket_id = 'other-0021'$$,
  $$values ('00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021c1.jpg'::text, null::jsonb)$$,
  'critère 1 : l''objet du bucket d''un autre projet est intact'
);
select results_eq(
  $$select metadata from storage.objects
     where bucket_id = 'carnet-media'
       and name = '00000000-0000-4000-8000-000000002111/avatar-00000000-0000-4000-8000-0000000021b1.jpg'$$,
  $$values (null::jsonb)$$,
  'critère 1 : l''objet de M est intact après les tentatives de O'
);

-- ---------------------------------------------------------------------------
-- Comportement storage.objects — U : dossier en majuscules (décision 10)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000210f","role":"authenticated"}';
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-0000000021AF/avatar-00000000-0000-4000-8000-0000000021ab.jpg')$$,
  '42501', null,
  'critère 1 (décision 10) : le propriétaire ne téléverse pas dans son dossier écrit en majuscules'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-0000000021af/avatar-00000000-0000-4000-8000-0000000021ab.jpg')$$,
  'critère 1 (décision 10) : le même nom en minuscules est accepté (contrôle)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Comportement storage.objects — personas sans droit sur le dossier de P1
-- ---------------------------------------------------------------------------

-- M
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000210b","role":"authenticated"}';
set local storage.allow_delete_query = 'true';
select is_empty(
  $$select name from storage.objects where name like '00000000-0000-4000-8000-000000002110/%'$$,
  'critère 1 : un autre membre carnet ne lit pas le dossier du propriétaire'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021f5.jpg')$$,
  '42501', null, 'critère 1 : un autre membre carnet n''écrit pas dans le dossier du propriétaire'
);
with updated as (
  update storage.objects set metadata = '{"x":1}'::jsonb
   where name like '00000000-0000-4000-8000-000000002110/%' returning 1
)
select is(count(*), 0::bigint, 'critère 1 : un autre membre carnet ne modifie pas le dossier du propriétaire') from updated;
with deleted as (
  delete from storage.objects where name like '00000000-0000-4000-8000-000000002110/%' returning 1
)
select is(count(*), 0::bigint, 'critère 1 : un autre membre carnet ne supprime rien dans le dossier du propriétaire') from deleted;
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002111/logo-00000000-0000-4000-8000-0000000021b2.jpg')$$,
  'critère 1 : un autre membre carnet téléverse dans son propre dossier (la politique dépend du dossier, pas du rôle)'
);
reset storage.allow_delete_query;
reset role;

-- N
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000210c","role":"authenticated"}';
set local storage.allow_delete_query = 'true';
select is_empty(
  $$select name from storage.objects where bucket_id = 'carnet-media'$$,
  'critère 1 : un compte sans appartenance ne lit rien dans carnet-media, pas même le dossier de son profil orphelin'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021f6.jpg')$$,
  '42501', null, 'critère 1 : un compte sans appartenance n''écrit pas dans le dossier du propriétaire'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002112/avatar-00000000-0000-4000-8000-0000000021f7.jpg')$$,
  '42501', null, 'critère 1 : un compte sans appartenance n''écrit pas dans le dossier de son profil orphelin'
);
with updated as (
  update storage.objects set metadata = '{"x":1}'::jsonb where bucket_id = 'carnet-media' returning 1
)
select is(count(*), 0::bigint, 'critère 1 : un compte sans appartenance ne modifie rien dans carnet-media') from updated;
with deleted as (
  delete from storage.objects where bucket_id = 'carnet-media' returning 1
)
select is(count(*), 0::bigint, 'critère 1 : un compte sans appartenance ne supprime rien dans carnet-media') from deleted;
reset storage.allow_delete_query;
reset role;

-- X
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000210d","role":"authenticated"}';
set local storage.allow_delete_query = 'true';
select is_empty(
  $$select name from storage.objects where bucket_id = 'carnet-media'$$,
  'critère 1 : un membre d''un autre projet ne lit rien dans carnet-media, pas même le dossier de son profil orphelin'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021f8.jpg')$$,
  '42501', null, 'critère 1 : un membre d''un autre projet n''écrit pas dans le dossier du propriétaire'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002113/avatar-00000000-0000-4000-8000-0000000021f9.jpg')$$,
  '42501', null, 'critère 1 : un membre d''un autre projet n''écrit pas dans le dossier de son profil orphelin'
);
with updated as (
  update storage.objects set metadata = '{"x":1}'::jsonb where bucket_id = 'carnet-media' returning 1
)
select is(count(*), 0::bigint, 'critère 1 : un membre d''un autre projet ne modifie rien dans carnet-media') from updated;
with deleted as (
  delete from storage.objects where bucket_id = 'carnet-media' returning 1
)
select is(count(*), 0::bigint, 'critère 1 : un membre d''un autre projet ne supprime rien dans carnet-media') from deleted;
reset storage.allow_delete_query;
reset role;

-- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local storage.allow_delete_query = 'true';
select is_empty(
  $$select name from storage.objects where bucket_id = 'carnet-media'$$,
  'critère 1 : anon ne liste rien dans carnet-media (lecture publique par l''URL de l''API seulement)'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021fa.jpg')$$,
  '42501', null, 'critère 1 : anon n''écrit pas dans le dossier du propriétaire'
);
with updated as (
  update storage.objects set metadata = '{"x":1}'::jsonb where bucket_id = 'carnet-media' returning 1
)
select is(count(*), 0::bigint, 'critère 1 : anon ne modifie rien dans carnet-media') from updated;
with deleted as (
  delete from storage.objects where bucket_id = 'carnet-media' returning 1
)
select is(count(*), 0::bigint, 'critère 1 : anon ne supprime rien dans carnet-media') from deleted;
reset storage.allow_delete_query;
reset role;

select results_eq(
  $$select count(*) from storage.objects
     where bucket_id = 'carnet-media' and name like '00000000-0000-4000-8000-000000002110/%' and metadata is null$$,
  $$values (9::bigint)$$,
  'critère 1 : le dossier du propriétaire est intact après les tentatives des autres personas (9 objets, aucun modifié)'
);

-- ---------------------------------------------------------------------------
-- carnet.set_profile_image (déclaratif)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'set_profile_image', array['text', 'text'], 'critère 1 : carnet.set_profile_image(text, text) existe');
select function_returns('carnet', 'set_profile_image', array['text', 'text'], 'text', 'critère 1 : set_profile_image renvoie text');
select is_definer('carnet', 'set_profile_image', array['text', 'text'], 'critère 1 : set_profile_image est security definer');
select ok(
  exists (
    select 1 from pg_catalog.pg_proc p
     where p.pronamespace = 'carnet'::regnamespace
       and p.proname = 'set_profile_image'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 1 : set_profile_image fixe set search_path = '''' (proconfig)'
);
select function_privs_are('carnet', 'set_profile_image', array['text', 'text'], 'authenticated', array['EXECUTE'], 'critère 1 : execute accordé à authenticated sur set_profile_image');
select function_privs_are('carnet', 'set_profile_image', array['text', 'text'], 'anon', '{}'::name[], 'critère 1 : execute révoqué pour anon sur set_profile_image');
select function_privs_are('carnet', 'set_profile_image', array['text', 'text'], 'service_role', '{}'::name[], 'critère 1 : execute non accordé à service_role sur set_profile_image');
select function_privs_are('carnet', 'set_profile_image', array['text', 'text'], 'public', '{}'::name[], 'critère 1 : execute révoqué pour public sur set_profile_image');
select ok(
  exists (
    select 1 from pg_catalog.pg_proc p
     where p.pronamespace = 'carnet'::regnamespace
       and p.proname = 'set_profile_image'
       and p.prosrc ~ 'carnet\.can_edit_profile\('
  ),
  'critère 1 (décision 10) : set_profile_image passe par carnet.can_edit_profile (fonction d''autorisation unique)'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_proc p
     where p.pronamespace = 'carnet'::regnamespace
       and p.proname = 'set_profile_image'
       and p.prosrc ~ 'carnet\.is_valid_media_name\('
  ),
  'critère 1 (décision 10) : set_profile_image valide le nom par carnet.is_valid_media_name'
);

-- Fixtures (postgres) : type MIME enregistré par storage-api dans metadata. Objets valides cohérents, plus deux objets
-- de P1 dont le type ne correspond pas à l'extension (png déclaré pour un .jpg) ou est absent.
update storage.objects o set metadata = jsonb_build_object('mimetype', v.mimetype)
  from (values ('00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a1.jpg', 'image/jpeg'),
               ('00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a2.webp', 'image/webp'),
               ('00000000-0000-4000-8000-000000002110/banner-00000000-0000-4000-8000-0000000021a3.png', 'image/png'),
               ('00000000-0000-4000-8000-000000002110/logo-00000000-0000-4000-8000-0000000021a4.jpg', 'image/jpeg'),
               ('00000000-0000-4000-8000-000000002111/logo-00000000-0000-4000-8000-0000000021b2.jpg', 'image/jpeg'))
       as v (name, mimetype)
 where o.bucket_id = 'carnet-media' and o.name = v.name;
insert into storage.objects (bucket_id, name, metadata) values
  ('carnet-media', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a5.jpg', '{"mimetype":"image/png"}'),
  ('carnet-media', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a6.png', null);

-- ---------------------------------------------------------------------------
-- carnet.set_profile_image — O : propriétaire
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000210a","role":"authenticated"}';

select throws_ok(
  $$select carnet.set_profile_image('photo', '00000000-0000-4000-8000-000000002110/photo-00000000-0000-4000-8000-0000000021d5.jpg')$$,
  '22023', null, 'critère 1 : set_profile_image refuse un kind hors avatar|banner|logo (22023)'
);
select throws_ok(
  $$select carnet.set_profile_image(null, '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a1.jpg')$$,
  '22023', null, 'critère 1 : set_profile_image refuse un kind null (22023)'
);
select throws_ok(
  $$select carnet.set_profile_image('AVATAR', null)$$,
  '22023', null, 'critère 1 : set_profile_image refuse un kind en majuscules (22023)'
);
select throws_ok(
  $$select carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002111/avatar-00000000-0000-4000-8000-0000000021b1.jpg')$$,
  '22023', null, 'critère 1 : set_profile_image refuse un objet du dossier d''un autre profil (22023)'
);
select throws_ok(
  $$select carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002110/banner-00000000-0000-4000-8000-0000000021a3.png')$$,
  '22023', null, 'critère 1 : set_profile_image refuse un objet dont le préfixe ne correspond pas au kind (22023)'
);
select throws_ok(
  $$select carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021d2.gif')$$,
  '22023', null, 'critère 1 : set_profile_image refuse l''extension .gif (22023)'
);
select throws_ok(
  $$select carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021d3.jpeg')$$,
  '22023', null, 'critère 1 : set_profile_image refuse l''extension .jpeg (seules jpg|png|webp) (22023)'
);
select throws_ok(
  $$select carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002110/avatar-not-a-uuid.jpg')$$,
  '22023', null, 'critère 1 : set_profile_image refuse un nom sans UUID après le kind (22023)'
);
select throws_ok(
  $$select carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002110/sub/avatar-00000000-0000-4000-8000-0000000021d4.jpg')$$,
  '22023', null, 'critère 1 : set_profile_image refuse un sous-dossier (22023)'
);
select throws_ok(
  $$select carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021ee.jpg')$$,
  '22023', null, 'critère 1 : set_profile_image refuse un nom valide sans objet dans storage.objects (22023)'
);
select throws_ok(
  $$select carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021c1.jpg')$$,
  '22023', null, 'critère 1 : set_profile_image refuse un objet présent seulement dans un autre bucket (22023)'
);
select throws_ok(
  $$select carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a1.jpg' || chr(10))$$,
  '22023', null, 'critère 1 : set_profile_image refuse un nom suivi d''un saut de ligne (motif ancré) (22023)'
);
select throws_ok(
  $$select carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a5.jpg')$$,
  '22023', null, 'critère 2 (décision 10) : set_profile_image refuse un objet .jpg dont metadata->>''mimetype'' est image/png (22023)'
);
select throws_ok(
  $$select carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a6.png')$$,
  '22023', null, 'critère 2 (décision 10) : set_profile_image refuse un objet sans type MIME enregistré (22023)'
);
select results_eq(
  $$select avatar_url, banner_url, logo_url from carnet.profiles where id = '00000000-0000-4000-8000-000000002110'$$,
  $$values (null::text, null::text, null::text)$$,
  'critère 1 : aucun refus de set_profile_image ne modifie le profil'
);

select is(
  carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a1.jpg'),
  null::text,
  'critère 1 : premier avatar enregistré, set_profile_image renvoie l''ancien nom (null)'
);
select results_eq(
  $$select avatar_url from carnet.profiles where id = '00000000-0000-4000-8000-000000002110'$$,
  $$values ('00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a1.jpg'::text)$$,
  'critère 1 : avatar_url contient le nom de l''objet dans le bucket'
);

-- now() est figé dans la transaction : updated_at est d'abord fixé dans le passé par postgres (trigger désactivé)
reset role;
alter table carnet.profiles disable trigger profiles_set_updated_at;
update carnet.profiles set updated_at = '2000-01-01' where id = '00000000-0000-4000-8000-000000002110';
alter table carnet.profiles enable trigger profiles_set_updated_at;
set local role authenticated;
select is(

  carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a1.jpg'),
  '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a1.jpg',
  'critère 1 (idempotence) : rejouer le même appel renvoie le nom courant'
);
select results_eq(
  $$select avatar_url, banner_url, logo_url from carnet.profiles where id = '00000000-0000-4000-8000-000000002110'$$,
  $$values ('00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a1.jpg'::text, null::text, null::text)$$,
  'critère 1 (idempotence) : rejouer le même appel laisse le même état'
);
select results_eq(
  $$select updated_at from carnet.profiles where id = '00000000-0000-4000-8000-000000002110'$$,
  $$values ('2000-01-01'::timestamptz)$$,
  'critère 1 (idempotence, décision 10) : rejouer le même appel ne réécrit pas la ligne (updated_at inchangé)'
);
select is(
  carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a2.webp'),
  '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a1.jpg',
  'critère 1 : remplacement de l''avatar (webp), set_profile_image renvoie l''ancien nom'
);
select is(
  carnet.set_profile_image('banner', '00000000-0000-4000-8000-000000002110/banner-00000000-0000-4000-8000-0000000021a3.png'),
  null::text,
  'critère 1 : bannière (png) enregistrée, ancien nom null'
);
select is(
  carnet.set_profile_image('logo', '00000000-0000-4000-8000-000000002110/logo-00000000-0000-4000-8000-0000000021a4.jpg'),
  null::text,
  'critère 1 : logo (jpg) enregistré, ancien nom null'
);
select results_eq(
  $$select avatar_url, banner_url, logo_url from carnet.profiles where id = '00000000-0000-4000-8000-000000002110'$$,
  $$values ('00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a2.webp'::text,
            '00000000-0000-4000-8000-000000002110/banner-00000000-0000-4000-8000-0000000021a3.png'::text,
            '00000000-0000-4000-8000-000000002110/logo-00000000-0000-4000-8000-0000000021a4.jpg'::text)$$,
  'critère 1 : chaque kind met à jour sa seule colonne (avatar_url, banner_url, logo_url)'
);
select results_eq(
  $$select count(*) from storage.objects
     where bucket_id = 'carnet-media'
       and name = '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a1.jpg'$$,
  $$values (1::bigint)$$,
  'critère 1 : set_profile_image ne supprime pas l''ancien objet (la Server Action le supprime par l''API Storage)'
);
select is(
  carnet.set_profile_image('avatar', null),
  '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a2.webp',
  'critère 1 : suppression de l''avatar (null), set_profile_image renvoie l''ancien nom'
);
select is(carnet.set_profile_image('avatar', null), null::text,
  'critère 1 (idempotence) : rejouer la suppression renvoie null');
select results_eq(
  $$select avatar_url, banner_url, logo_url from carnet.profiles where id = '00000000-0000-4000-8000-000000002110'$$,
  $$values (null::text,
            '00000000-0000-4000-8000-000000002110/banner-00000000-0000-4000-8000-0000000021a3.png'::text,
            '00000000-0000-4000-8000-000000002110/logo-00000000-0000-4000-8000-0000000021a4.jpg'::text)$$,
  'critère 1 (idempotence) : après deux suppressions, avatar_url est null et les autres colonnes sont intactes'
);
select throws_ok(
  $$update carnet.profiles set logo_url = null where id = '00000000-0000-4000-8000-000000002110'$$,
  '42501', null, 'critère 1 : le propriétaire ne modifie pas logo_url directement (42501, privilège de colonne)'
);
select throws_ok(
  $$update carnet.profiles set avatar_url = '00000000-0000-4000-8000-000000002110/avatar-00000000-0000-4000-8000-0000000021a1.jpg'
     where id = '00000000-0000-4000-8000-000000002110'$$,
  '42501', null, 'critère 1 : le propriétaire ne modifie pas avatar_url directement (42501, privilège de colonne)'
);
select throws_ok(
  $$update carnet.profiles set banner_url = '00000000-0000-4000-8000-000000002110/banner-00000000-0000-4000-8000-0000000021a3.png'
     where id = '00000000-0000-4000-8000-000000002110'$$,
  '42501', null, 'critère 1 : le propriétaire ne modifie pas banner_url directement (42501, privilège de colonne)'
);
reset role;

-- ---------------------------------------------------------------------------
-- carnet.set_profile_image — autres personas
-- ---------------------------------------------------------------------------
-- M : ne peut pas cibler le profil de O (le profil visé est toujours celui de l'appelant)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000210b","role":"authenticated"}';
select throws_ok(
  $$select carnet.set_profile_image('banner', '00000000-0000-4000-8000-000000002110/banner-00000000-0000-4000-8000-0000000021a3.png')$$,
  '22023', null, 'critère 1 : un autre membre carnet ne peut pas référencer un objet du dossier du propriétaire (22023)'
);
select is(
  carnet.set_profile_image('logo', '00000000-0000-4000-8000-000000002111/logo-00000000-0000-4000-8000-0000000021b2.jpg'),
  null::text,
  'critère 1 : un autre membre carnet enregistre une image de son propre dossier sur son propre profil'
);
reset role;

-- N : sans appartenance (profil orphelin)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000210c","role":"authenticated"}';
select throws_ok(
  $$select carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002112/avatar-00000000-0000-4000-8000-0000000021e1.jpg')$$,
  '42501', null, 'critère 1 : un compte sans appartenance carnet est refusé (42501), même pour son profil orphelin'
);
reset role;

-- X : membre d'un autre projet (profil orphelin)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000210d","role":"authenticated"}';
select throws_ok(
  $$select carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002113/avatar-00000000-0000-4000-8000-0000000021e2.jpg')$$,
  '42501', null, 'critère 1 : un membre d''un autre projet est refusé (42501), même pour son profil orphelin'
);
reset role;

-- I : membre carnet sans profil
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000210e","role":"authenticated"}';
select throws_ok(
  $$select carnet.set_profile_image('avatar', null)$$,
  '42501', null, 'critère 1 : un membre carnet sans profil est refusé (42501)'
);
reset role;

-- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select carnet.set_profile_image('avatar', null)$$,
  '42501', null, 'critère 1 : anon ne peut pas appeler set_profile_image (42501)'
);
reset role;

select results_eq(
  $$select id, avatar_url, banner_url, logo_url from carnet.profiles
     where id in ('00000000-0000-4000-8000-000000002110', '00000000-0000-4000-8000-000000002111',
                  '00000000-0000-4000-8000-000000002112', '00000000-0000-4000-8000-000000002113')
     order by id$$,
  $$values ('00000000-0000-4000-8000-000000002110'::uuid, null::text,
            '00000000-0000-4000-8000-000000002110/banner-00000000-0000-4000-8000-0000000021a3.png'::text,
            '00000000-0000-4000-8000-000000002110/logo-00000000-0000-4000-8000-0000000021a4.jpg'::text),
           ('00000000-0000-4000-8000-000000002111'::uuid, null::text, null::text,
            '00000000-0000-4000-8000-000000002111/logo-00000000-0000-4000-8000-0000000021b2.jpg'::text),
           ('00000000-0000-4000-8000-000000002112'::uuid, null::text, null::text, null::text),
           ('00000000-0000-4000-8000-000000002113'::uuid, null::text, null::text, null::text)$$,
  'critère 1 : état final des profils — seuls O et M ont modifié leur propre profil'
);

-- ---------------------------------------------------------------------------
-- Décision 9 : logo_url exposé dans carnet.public_profiles (dernière colonne) et par carnet.get_public_profile
-- ---------------------------------------------------------------------------
select is(
  (select a.attname::text
     from pg_catalog.pg_attribute a
    where a.attrelid = 'carnet.public_profiles'::regclass and a.attnum > 0 and not a.attisdropped
    order by a.attnum offset 12 limit 1),
  'logo_url',
  'critère 3 (décision 9) : logo_url est la 13e colonne de carnet.public_profiles, après les 12 colonnes existantes inchangées (0031 ajoute accepts_leads après elle)'
);
update carnet.profiles set is_published = true where id = '00000000-0000-4000-8000-000000002111';

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select results_eq(
  $$select slug, logo_url from carnet.get_public_profile('marc-0021')$$,
  $$values ('marc-0021'::text, '00000000-0000-4000-8000-000000002111/logo-00000000-0000-4000-8000-0000000021b2.jpg'::text)$$,
  'critère 3 (décision 9) : get_public_profile d''un profil publié renvoie logo_url (anon)'
);
select is_empty(
  $$select * from carnet.get_public_profile('olga-0021')$$,
  'critère 3 (décision 9) : get_public_profile d''un profil non publié ne renvoie rien, même avec un logo (anon)'
);
reset role;

select * from finish();
rollback;
