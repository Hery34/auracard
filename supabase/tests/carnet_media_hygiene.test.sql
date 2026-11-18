-- Fiche 0027 / ADR 0014, 0011 (avenants du 17/11/2026) — hygiène du bucket carnet-media : liste des objets orphelins
-- pour la purge n8n, plafond de 6 objets par dossier de profil dans la politique carnet_media_insert_own.
-- Critères couverts : 1 (orphelin ancien listé ; référencé, récent ou d'un autre bucket non listé), 2 (anon et
-- authenticated n'exécutent pas list_orphan_media), 3 (7ᵉ envoi refusé, remplacement à 4 accepté), 5 (partie SQL :
-- appel rejouable, même résultat). Critères 4 et 5 (workflow, API Storage) :
-- tests/integration/media-hygiene.test.ts et tests/integration/n8n-media-purge-workflow.test.ts.
-- Contrat (noms exacts attendus de la migration) :
--   carnet.list_orphan_media(p_older_than interval) returns table (name text), security definer, search_path '' ;
--     execute pour service_role seulement (révoqué pour public, anon, authenticated) ;
--     renvoie, sans doublon, le nom de chaque objet de carnet-media dont created_at < now() - p_older_than et
--     qu'aucune ligne de carnet.profiles ne référence (avatar_url, banner_url, logo_url), dossiers des profils
--     supprimés compris ; aucun objet d'un autre bucket.
--     Rapport 3 (audit) : p_older_than null ou < interval '1 hour' → 22023 (null, 0, négatif, 59 minutes) ;
--     '1 hour' accepté.
--   carnet.count_profile_media(p_profile_id uuid) returns integer (rapport 3) : execute pour authenticated seulement
--     (révoqué pour public, anon, service_role) ; nombre d'objets de carnet-media du dossier si l'appelant peut
--     modifier le profil (carnet.can_edit_profile), null sinon (autre membre, compte d'un autre projet).
--   carnet.set_profile_image (0021, rapport 3) : refuse en 22023 (comme ses autres refus d'objet) un objet de
--     carnet-media créé depuis plus d'une heure ; accepte un objet récent. Exception de rejeu : un objet déjà
--     enregistré pour ce type, même créé depuis plus d'une heure, est réaffecté sans erreur et sans changement
--     (renvoie ce même nom).
--   Politique carnet_media_insert_own : en plus des conditions de 0021, refuse (42501, with check) un nouvel objet
--     quand le dossier du profil contient déjà 6 objets de carnet-media (comptage security definer, nom libre) ;
--     les objets d'autres buckets ne comptent pas ; le plafond est par dossier.
-- Note pour l'implémentation : le test 0021 insère 5 objets en une instruction dans un dossier qui en contient déjà 5
--   (carnet_media_storage.test.sql) ; il doit rester vert (comptage sur l'état au début de l'instruction).
-- Personas (UUID fixes, plage 0…27xx propre à cette fiche) :
--   A  0…2701  membre (user) de carnet, profil PA 0…2711 : objets référencés, orphelins anciens et récents
--   B  0…2702  membre (user) de carnet, profil PB 0…2712 : un orphelin ancien
--   C  0…2703  membre (user) de carnet, profil PC 0…2713 : dossier plein (6 objets)
--   E  0…2704  membre (user) de carnet, profil PE 0…2714 : 3 objets (avatar, bannière, logo) + 6 dans un autre bucket
--   D  0…2705  membre (user) de carnet, profil PD 0…2715 supprimé pendant le test (son dossier reste)
--   X  0…2706  membre de other_0027 (projet 0…2707), sans profil carnet
--   0…2719     dossier d'un profil qui n'existe plus (aucune ligne)
-- Bucket de test other-0027 (privé), créé sous postgres : simule le bucket d'un autre projet de l'instance.
-- Fixtures créées par postgres (bypassrls), created_at fixé explicitement ; tout est annulé par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(61);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000002701', 'a-carnet-0027@test.local'),
  ('00000000-0000-4000-8000-000000002702', 'b-carnet-0027@test.local'),
  ('00000000-0000-4000-8000-000000002703', 'c-carnet-0027@test.local'),
  ('00000000-0000-4000-8000-000000002704', 'e-carnet-0027@test.local'),
  ('00000000-0000-4000-8000-000000002705', 'd-carnet-0027@test.local'),
  ('00000000-0000-4000-8000-000000002706', 'x-other-0027@test.local');

insert into platform.projects (id, slug, name, db_schema)
  values ('00000000-0000-4000-8000-000000002707', 'other_0027', 'Other 0027', 'other_0027');

insert into platform.project_members (project_id, user_id, role)
  select id, u.user_id, 'user'
    from platform.projects,
         (values ('00000000-0000-4000-8000-000000002701'::uuid),
                 ('00000000-0000-4000-8000-000000002702'::uuid),
                 ('00000000-0000-4000-8000-000000002703'::uuid),
                 ('00000000-0000-4000-8000-000000002704'::uuid),
                 ('00000000-0000-4000-8000-000000002705'::uuid)) as u (user_id)
   where slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  values ('00000000-0000-4000-8000-000000002707', '00000000-0000-4000-8000-000000002706', 'user');

insert into carnet.profiles (id, owner_id, slug, display_name) values
  ('00000000-0000-4000-8000-000000002711', '00000000-0000-4000-8000-000000002701', 'anna-0027', 'Anna'),
  ('00000000-0000-4000-8000-000000002712', '00000000-0000-4000-8000-000000002702', 'bruno-0027', 'Bruno'),
  ('00000000-0000-4000-8000-000000002713', '00000000-0000-4000-8000-000000002703', 'chloe-0027', 'Chloé'),
  ('00000000-0000-4000-8000-000000002714', '00000000-0000-4000-8000-000000002704', 'emile-0027', 'Émile'),
  ('00000000-0000-4000-8000-000000002715', '00000000-0000-4000-8000-000000002705', 'dora-0027', 'Dora');

insert into storage.buckets (id, name, public) values ('other-0027', 'other-0027', false);

-- Purge : objets de carnet-media (ancien = 2 jours, intermédiaire = 3 heures, récent = 30 minutes)
insert into storage.objects (bucket_id, name, created_at) values
  ('carnet-media', '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002731.jpg', now() - interval '2 days'),
  ('carnet-media', '00000000-0000-4000-8000-000000002711/banner-00000000-0000-4000-8000-000000002732.png', now() - interval '2 days'),
  ('carnet-media', '00000000-0000-4000-8000-000000002711/logo-00000000-0000-4000-8000-000000002733.webp', now() - interval '2 days'),
  ('carnet-media', '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002734.jpg', now() - interval '2 days'),
  ('carnet-media', '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002735.jpg', now() - interval '30 minutes'),
  ('carnet-media', '00000000-0000-4000-8000-00000000271a/avatar-00000000-0000-4000-8000-00000000273a.jpg', now() - interval '3 hours'),
  ('carnet-media', '00000000-0000-4000-8000-000000002712/avatar-00000000-0000-4000-8000-000000002738.jpg', now() - interval '2 days'),
  ('carnet-media', '00000000-0000-4000-8000-000000002715/avatar-00000000-0000-4000-8000-000000002739.jpg', now() - interval '2 days'),
  ('carnet-media', '00000000-0000-4000-8000-000000002719/avatar-00000000-0000-4000-8000-000000002736.jpg', now() - interval '2 days'),
  ('carnet-media', 'misc-0027/old.jpg', now() - interval '2 days');

-- set_profile_image (rapport 3) : objets de PA au type cohérent, l'un créé il y a 61 minutes, l'autre il y a 5 minutes
insert into storage.objects (bucket_id, name, created_at, metadata) values
  ('carnet-media', '00000000-0000-4000-8000-000000002711/banner-00000000-0000-4000-8000-00000000273b.jpg',
   now() - interval '61 minutes', '{"mimetype":"image/jpeg"}'),
  ('carnet-media', '00000000-0000-4000-8000-000000002711/banner-00000000-0000-4000-8000-00000000273c.jpg',
   now() - interval '5 minutes', '{"mimetype":"image/jpeg"}');

-- Autre bucket : un nom propre à ce bucket, et le même nom qu'un orphelin de carnet-media (doublon potentiel)
insert into storage.objects (bucket_id, name, created_at) values
  ('other-0027', '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002737.jpg', now() - interval '2 days'),
  ('other-0027', '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002734.jpg', now() - interval '2 days');

update carnet.profiles
   set avatar_url = '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002731.jpg',
       banner_url = '00000000-0000-4000-8000-000000002711/banner-00000000-0000-4000-8000-000000002732.png',
       logo_url   = '00000000-0000-4000-8000-000000002711/logo-00000000-0000-4000-8000-000000002733.webp'
 where id = '00000000-0000-4000-8000-000000002711';
update carnet.profiles
   set avatar_url = '00000000-0000-4000-8000-000000002715/avatar-00000000-0000-4000-8000-000000002739.jpg'
 where id = '00000000-0000-4000-8000-000000002715';

-- Profil PD supprimé : son dossier reste dans le bucket
delete from carnet.profiles where id = '00000000-0000-4000-8000-000000002715';

-- Plafond : PC plein (6 objets récents), PE avec 3 objets dans carnet-media et 6 dans l'autre bucket
insert into storage.objects (bucket_id, name) values
  ('carnet-media', '00000000-0000-4000-8000-000000002713/avatar-00000000-0000-4000-8000-000000002741.jpg'),
  ('carnet-media', '00000000-0000-4000-8000-000000002713/avatar-00000000-0000-4000-8000-000000002742.jpg'),
  ('carnet-media', '00000000-0000-4000-8000-000000002713/banner-00000000-0000-4000-8000-000000002743.jpg'),
  ('carnet-media', '00000000-0000-4000-8000-000000002713/banner-00000000-0000-4000-8000-000000002744.jpg'),
  ('carnet-media', '00000000-0000-4000-8000-000000002713/logo-00000000-0000-4000-8000-000000002745.jpg'),
  ('carnet-media', '00000000-0000-4000-8000-000000002713/logo-00000000-0000-4000-8000-000000002746.jpg'),
  ('carnet-media', '00000000-0000-4000-8000-000000002714/avatar-00000000-0000-4000-8000-000000002751.jpg'),
  ('carnet-media', '00000000-0000-4000-8000-000000002714/banner-00000000-0000-4000-8000-000000002752.jpg'),
  ('carnet-media', '00000000-0000-4000-8000-000000002714/logo-00000000-0000-4000-8000-000000002753.jpg'),
  ('other-0027',   '00000000-0000-4000-8000-000000002714/avatar-00000000-0000-4000-8000-000000002761.jpg'),
  ('other-0027',   '00000000-0000-4000-8000-000000002714/avatar-00000000-0000-4000-8000-000000002762.jpg'),
  ('other-0027',   '00000000-0000-4000-8000-000000002714/avatar-00000000-0000-4000-8000-000000002763.jpg'),
  ('other-0027',   '00000000-0000-4000-8000-000000002714/avatar-00000000-0000-4000-8000-000000002764.jpg'),
  ('other-0027',   '00000000-0000-4000-8000-000000002714/avatar-00000000-0000-4000-8000-000000002765.jpg'),
  ('other-0027',   '00000000-0000-4000-8000-000000002714/avatar-00000000-0000-4000-8000-000000002766.jpg');

-- ---------------------------------------------------------------------------
-- carnet.list_orphan_media : déclaratif
-- ---------------------------------------------------------------------------
select has_function('carnet', 'list_orphan_media', array['interval'],
  'critère 1 : carnet.list_orphan_media(interval) existe');
select is(
  (select pg_catalog.pg_get_function_result(p.oid) from pg_catalog.pg_proc p
    where p.pronamespace = 'carnet'::regnamespace and p.proname = 'list_orphan_media'),
  'TABLE(name text)',
  'critère 1 : list_orphan_media renvoie table (name text)'
);
select is(
  (select pg_catalog.pg_get_function_arguments(p.oid) from pg_catalog.pg_proc p
    where p.pronamespace = 'carnet'::regnamespace and p.proname = 'list_orphan_media'),
  'p_older_than interval',
  'critère 1 : list_orphan_media a un unique paramètre p_older_than interval'
);
select is_definer('carnet', 'list_orphan_media', array['interval'], 'critère 2 : list_orphan_media est security definer');
select ok(
  exists (
    select 1 from pg_catalog.pg_proc p
     where p.pronamespace = 'carnet'::regnamespace
       and p.proname = 'list_orphan_media'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 2 : list_orphan_media fixe set search_path = '''' (proconfig)'
);
select function_privs_are('carnet', 'list_orphan_media', array['interval'], 'public', '{}'::name[],
  'critère 2 : execute révoqué pour public sur list_orphan_media');
select function_privs_are('carnet', 'list_orphan_media', array['interval'], 'anon', '{}'::name[],
  'critère 2 : execute révoqué pour anon sur list_orphan_media');
select function_privs_are('carnet', 'list_orphan_media', array['interval'], 'authenticated', '{}'::name[],
  'critère 2 : execute révoqué pour authenticated sur list_orphan_media');
select function_privs_are('carnet', 'list_orphan_media', array['interval'], 'service_role', array['EXECUTE']::name[],
  'critère 2 : execute accordé à service_role sur list_orphan_media');

-- ---------------------------------------------------------------------------
-- carnet.list_orphan_media : anon et authenticated refusés (critère 2)
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select name from carnet.list_orphan_media('24 hours')$$, '42501', null,
  'critère 2 : anon ne peut pas exécuter list_orphan_media (42501)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002701","role":"authenticated"}';
select throws_ok($$select name from carnet.list_orphan_media('24 hours')$$, '42501', null,
  'critère 2 : un membre de carnet (authenticated) ne peut pas exécuter list_orphan_media (42501)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002706","role":"authenticated"}';
select throws_ok($$select name from carnet.list_orphan_media('24 hours')$$, '42501', null,
  'critère 2 : un membre d''un autre projet (authenticated) ne peut pas exécuter list_orphan_media (42501)');
reset role;

-- ---------------------------------------------------------------------------
-- carnet.count_profile_media (rapport 3)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'count_profile_media', array['uuid'], 'rapport 3 : carnet.count_profile_media(uuid) existe');
select function_returns('carnet', 'count_profile_media', array['uuid'], 'integer',
  'rapport 3 : count_profile_media renvoie integer');
select function_privs_are('carnet', 'count_profile_media', array['uuid'], 'authenticated', array['EXECUTE']::name[],
  'rapport 3 : execute accordé à authenticated sur count_profile_media');
select function_privs_are('carnet', 'count_profile_media', array['uuid'], 'service_role', '{}'::name[],
  'rapport 3 : execute refusé à service_role sur count_profile_media');
select function_privs_are('carnet', 'count_profile_media', array['uuid'], 'anon', '{}'::name[],
  'rapport 3 : execute refusé à anon sur count_profile_media');
select function_privs_are('carnet', 'count_profile_media', array['uuid'], 'public', '{}'::name[],
  'rapport 3 : execute refusé à public sur count_profile_media');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002703","role":"authenticated"}';
select is(carnet.count_profile_media('00000000-0000-4000-8000-000000002713'), 6,
  'rapport 3 : le propriétaire obtient le nombre réel d''objets de son dossier (6)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002701","role":"authenticated"}';
select is(carnet.count_profile_media('00000000-0000-4000-8000-000000002713'), null::integer,
  'rapport 3 : un autre membre de carnet obtient null pour le dossier d''un profil qu''il ne modifie pas');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002706","role":"authenticated"}';
select is(carnet.count_profile_media('00000000-0000-4000-8000-000000002713'), null::integer,
  'rapport 3 : un compte d''un autre projet obtient null');
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select carnet.count_profile_media('00000000-0000-4000-8000-000000002713')$$, '42501', null,
  'rapport 3 : anon ne peut pas exécuter count_profile_media (42501)');
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select carnet.count_profile_media('00000000-0000-4000-8000-000000002713')$$, '42501', null,
  'rapport 3 : service_role ne peut pas exécuter count_profile_media (42501)');
reset role;

-- ---------------------------------------------------------------------------
-- Plafond de 6 objets par dossier (critère 3)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002703","role":"authenticated"}';
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002713/avatar-00000000-0000-4000-8000-000000002747.jpg')$$,
  '42501', null,
  'critère 3 : le 7ᵉ envoi dans un dossier qui contient 6 objets est refusé (42501)'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002713/logo-00000000-0000-4000-8000-000000002748.png')$$,
  '42501', null,
  'critère 3 : le plafond vaut pour tous les types d''image (logo refusé aussi)'
);
set local storage.allow_delete_query = 'true';
with deleted as (
  delete from storage.objects
   where bucket_id = 'carnet-media'
     and name = '00000000-0000-4000-8000-000000002713/avatar-00000000-0000-4000-8000-000000002741.jpg'
  returning 1
)
select is(count(*), 1::bigint, 'critère 3 : le propriétaire supprime un objet de son dossier plein (1 ligne)') from deleted;
reset storage.allow_delete_query;
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002713/avatar-00000000-0000-4000-8000-000000002749.jpg')$$,
  'critère 3 : une fois le dossier revenu à 5 objets, un envoi est de nouveau accepté'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002704","role":"authenticated"}';
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002714/avatar-00000000-0000-4000-8000-000000002754.jpg')$$,
  'critère 3 : le remplacement normal (4ᵉ objet : avatar, bannière, logo et nouvel avatar) est accepté, '
  || 'alors qu''un autre dossier est plein et que 6 objets du même dossier existent dans un autre bucket'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002714/banner-00000000-0000-4000-8000-000000002755.jpg')$$,
  'critère 3 : 5ᵉ objet du dossier accepté'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002714/logo-00000000-0000-4000-8000-000000002756.jpg')$$,
  'critère 3 : 6ᵉ objet du dossier accepté'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('carnet-media', '00000000-0000-4000-8000-000000002714/avatar-00000000-0000-4000-8000-000000002757.jpg')$$,
  '42501', null,
  'critère 3 : 7ᵉ objet du dossier refusé (les envois du propriétaire comptent)'
);
reset role;

select is(
  (select count(*) from storage.objects
    where bucket_id = 'carnet-media' and name like '00000000-0000-4000-8000-000000002714/%'),
  6::bigint,
  'critère 3 : le dossier de PE contient exactement 6 objets après le refus'
);

-- ---------------------------------------------------------------------------
-- carnet.list_orphan_media : comportement sous service_role (critère 1)
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select lives_ok($$select name from carnet.list_orphan_media('24 hours')$$,
  'critère 2 : service_role exécute list_orphan_media');
select ok(
  '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002734.jpg'
    in (select name from carnet.list_orphan_media('24 hours')),
  'critère 1 : un objet non référencé plus vieux que le délai est listé'
);
select ok(
  '00000000-0000-4000-8000-000000002712/avatar-00000000-0000-4000-8000-000000002738.jpg'
    in (select name from carnet.list_orphan_media('24 hours')),
  'critère 1 : l''orphelin ancien d''un autre profil est listé aussi (purge globale du bucket)'
);
select ok(
  '00000000-0000-4000-8000-000000002715/avatar-00000000-0000-4000-8000-000000002739.jpg'
    in (select name from carnet.list_orphan_media('24 hours')),
  'critère 1 : l''objet d''un profil supprimé (référence disparue avec la ligne) est listé'
);
select ok(
  '00000000-0000-4000-8000-000000002719/avatar-00000000-0000-4000-8000-000000002736.jpg'
    in (select name from carnet.list_orphan_media('24 hours')),
  'critère 1 : un objet ancien dans le dossier d''un profil inexistant est listé'
);
select ok(
  'misc-0027/old.jpg' in (select name from carnet.list_orphan_media('24 hours')),
  'critère 1 : un objet ancien non référencé au nom hors format (déposé hors de l''application) est listé'
);
select ok(
  '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002731.jpg'
    not in (select name from carnet.list_orphan_media('24 hours')),
  'critère 1 : un objet ancien référencé par avatar_url n''est pas listé'
);
select ok(
  '00000000-0000-4000-8000-000000002711/banner-00000000-0000-4000-8000-000000002732.png'
    not in (select name from carnet.list_orphan_media('24 hours')),
  'critère 1 : un objet ancien référencé par banner_url n''est pas listé'
);
select ok(
  '00000000-0000-4000-8000-000000002711/logo-00000000-0000-4000-8000-000000002733.webp'
    not in (select name from carnet.list_orphan_media('24 hours')),
  'critère 1 : un objet ancien référencé par logo_url n''est pas listé'
);
select ok(
  '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002735.jpg'
    not in (select name from carnet.list_orphan_media('24 hours')),
  'critère 1 : un objet non référencé plus récent que le délai n''est pas listé'
);
select ok(
  '00000000-0000-4000-8000-00000000271a/avatar-00000000-0000-4000-8000-00000000273a.jpg'
    not in (select name from carnet.list_orphan_media('24 hours')),
  'critère 1 : un objet orphelin de 3 heures n''est pas listé avec 24 hours'
);
select ok(
  '00000000-0000-4000-8000-00000000271a/avatar-00000000-0000-4000-8000-00000000273a.jpg'
    in (select name from carnet.list_orphan_media('2 hours')),
  'critère 1 : le délai est celui passé en paramètre (l''objet de 3 heures est listé avec 2 hours)'
);
select ok(
  '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002735.jpg'
    not in (select name from carnet.list_orphan_media('1 hour')),
  'critère 1 : un objet de 30 minutes n''est pas listé avec le délai minimal (1 hour)'
);
select throws_ok($$select name from carnet.list_orphan_media('0 seconds')$$, '22023', null,
  'rapport 3 : délai nul refusé (22023)');
select throws_ok($$select name from carnet.list_orphan_media('-1 hour')$$, '22023', null,
  'rapport 3 : délai négatif refusé (22023)');
select throws_ok($$select name from carnet.list_orphan_media('59 minutes')$$, '22023', null,
  'rapport 3 : délai de 59 minutes refusé (22023)');
select throws_ok($$select name from carnet.list_orphan_media(null)$$, '22023', null,
  'revue : délai null refusé (22023)');
select lives_ok($$select name from carnet.list_orphan_media('1 hour')$$,
  'rapport 3 : délai de 1 hour accepté (minimum)');
select ok(
  '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002737.jpg'
    not in (select name from carnet.list_orphan_media('24 hours')),
  'critère 1 : un objet ancien d''un autre bucket n''est jamais listé'
);
select is_empty(
  $$select l.name from carnet.list_orphan_media('24 hours') l
     where not exists (select 1 from storage.objects o where o.bucket_id = 'carnet-media' and o.name = l.name)$$,
  'critère 1 : chaque nom listé désigne un objet de carnet-media'
);
select is_empty(
  $$select name from carnet.list_orphan_media('24 hours') group by name having count(*) > 1$$,
  'critère 1 : aucun nom listé deux fois (même nom présent dans un autre bucket)'
);
select set_eq(
  $$select name from carnet.list_orphan_media('24 hours')$$,
  $$select name from carnet.list_orphan_media('24 hours')$$,
  'critère 5 : deux appels successifs renvoient le même ensemble (lecture seule, rejouable)'
);
reset role;

select is(
  (select count(*) from storage.objects
    where name in ('00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002734.jpg',
                   '00000000-0000-4000-8000-000000002719/avatar-00000000-0000-4000-8000-000000002736.jpg')),
  3::bigint,
  'critère 5 : après appels, les orphelins sont toujours présents (la fonction liste, n8n supprime par l''API)'
);

-- ---------------------------------------------------------------------------
-- carnet.set_profile_image : objet trop ancien refusé (rapport 3)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002701","role":"authenticated"}';
select throws_ok(
  $$select carnet.set_profile_image('banner', '00000000-0000-4000-8000-000000002711/banner-00000000-0000-4000-8000-00000000273b.jpg')$$,
  '22023', null,
  'rapport 3 : set_profile_image refuse un objet de son dossier créé il y a plus d''une heure (22023)'
);
select is(
  carnet.set_profile_image('banner', '00000000-0000-4000-8000-000000002711/banner-00000000-0000-4000-8000-00000000273c.jpg'),
  '00000000-0000-4000-8000-000000002711/banner-00000000-0000-4000-8000-000000002732.png',
  'rapport 3 : set_profile_image accepte un objet récent du même type (renvoie l''ancienne bannière)'
);
reset role;
select is(
  (select banner_url from carnet.profiles where id = '00000000-0000-4000-8000-000000002711'),
  '00000000-0000-4000-8000-000000002711/banner-00000000-0000-4000-8000-00000000273c.jpg',
  'rapport 3 : la bannière référence l''objet récent, jamais l''objet trop ancien'
);

-- Rejeu : objet de 2 jours déjà référencé comme avatar de PA (type cohérent pour isoler la règle d'âge)
update storage.objects set metadata = '{"mimetype":"image/jpeg"}'::jsonb
 where bucket_id = 'carnet-media'
   and name = '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002731.jpg';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002701","role":"authenticated"}';
select lives_ok(
  $$select carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002731.jpg')$$,
  'revue : rejeu de set_profile_image avec l''objet déjà enregistré, créé il y a plus d''une heure, sans erreur'
);
select is(
  carnet.set_profile_image('avatar', '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002731.jpg'),
  '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002731.jpg',
  'revue : le rejeu renvoie le même nom (ancienne valeur = nouvelle valeur)'
);
reset role;
select is(
  (select avatar_url from carnet.profiles where id = '00000000-0000-4000-8000-000000002711'),
  '00000000-0000-4000-8000-000000002711/avatar-00000000-0000-4000-8000-000000002731.jpg',
  'revue : après rejeu, avatar_url est inchangé'
);

select * from finish();
rollback;
