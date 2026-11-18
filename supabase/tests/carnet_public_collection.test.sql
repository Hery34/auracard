-- Fiche 0034 — collecte publique des statistiques : carnet.record_public_event (par slug) et carnet.get_public_links (id).
-- Critères couverts : 1 (enregistrement par slug, rejeu sans doublon), 2 (slug inconnu ou nul, profil non publié, lien
-- d'un autre profil ou inexistant : rien d'écrit, même réponse), 3 (anon, authenticated du projet et d'un autre projet :
-- 42501), 4 (get_public_links renvoie id ; rien pour un profil non publié ou inexistant), 5 en partie (une seule
-- surcharge de chaque fonction, droits exacts après application ; le rejeu complet de la migration reste prouvé par
-- db-architect et Hery).
-- Contrat figé pour db-architect :
--   carnet.record_public_event(p_id uuid, p_slug text, p_type text, p_source text, p_link_id uuid, p_device_class text)
--     returns void : volatile, security definer, set search_path = '', propriétaire bypassrls ; execute à service_role
--     seul (ni public, ni anon, ni authenticated). Une seule surcharge, rien dans le schéma public.
--     22023 avant toute lecture du profil (même code que le slug soit publié, non publié ou inconnu) : p_id nul,
--     type / source / device_class nul ou hors liste (fonctions carnet.is_valid_analytics_*), link_click sans
--     link_id, link_id sur un autre type.
--     Slug d'un profil publié : insertion dans carnet.analytics_events (profile_id résolu, occurred_at = now()),
--     on conflict (id) do nothing. Slug inconnu, nul, profil non publié, link_id inexistant ou d'un autre profil :
--     rien n'est écrit, aucune erreur, même réponse. La définition s'appuie sur carnet.record_event ou sur les
--     fonctions carnet.is_valid_analytics_* (pas de liste de valeurs recopiée).
--   carnet.assert_valid_analytics_event(uuid, text, text, uuid, text) (contrôle 22023 factorisé) : aucun execute pour anon,
--     authenticated, service_role, public ; une seule surcharge, dans carnet ; parallel safe.
--   carnet.get_public_links(p_slug text) returns table(id uuid, platform text, url text, label text, position smallint) :
--     id en première colonne ; propriétés et droits inchangés (stable, security definer, search_path = '', execute à
--     anon, authenticated, service_role, révoqué pour public ; s'appuie sur carnet.public_profiles). Toujours pas de
--     profile_id.
-- Tests existants ajustés (fiche 0034, décision 2) :
--   carnet_links_schema.test.sql : test de signature de get_public_links (proargnames / proargmodes / proallargtypes).
--   carnet_links_access.test.sql : results_eq « colonnes platform, url, label, position » (select * → colonnes nommées)
--     et « get_public_links n'expose pas id » (42703 → lives_ok, id exposé).
-- Personas (UUID fixes, plage 0…34xx propre à ce fichier) :
--   A 0…340a membre carnet, profil 0…3410 publié (ada-0034), liens 0…3420 (position 1) et 0…3421 (position 0)
--   B 0…340b membre carnet, profil 0…3411 publié (bea-0034), lien 0…3422
--   U 0…340c membre carnet, profil 0…3412 non publié (uma-0034), lien 0…3423
--   X 0…340d membre du projet other_0034 seul, sans profil
-- Les lectures sur des objets encore absents passent par lives_ok ou pg_temp.num/pg_temp.txt (null si l'objet ou la
-- colonne n'existe pas), pour que l'absence d'implémentation produise des échecs et non un abandon du script.
-- Tout est annulé par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(77);

create function pg_temp.num(p_sql text) returns bigint
language plpgsql as $$
declare
  v bigint;
begin
  execute p_sql into v;
  return v;
exception when undefined_table or undefined_function or undefined_column or invalid_schema_name then
  return null;
end
$$;

create function pg_temp.txt(p_sql text) returns text
language plpgsql as $$
declare
  v text;
begin
  execute p_sql into v;
  return v;
exception when undefined_table or undefined_function or undefined_column or invalid_schema_name then
  return null;
end
$$;

create temp table rec_results (label text primary key, result text);
grant select, insert on rec_results to service_role;
create temp table reads (label text primary key, v text);
grant select, insert on reads to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000340a', 'a-carnet-0034@test.local'),
  ('00000000-0000-4000-8000-00000000340b', 'b-carnet-0034@test.local'),
  ('00000000-0000-4000-8000-00000000340c', 'u-carnet-0034@test.local'),
  ('00000000-0000-4000-8000-00000000340d', 'x-other-0034@test.local');

insert into platform.projects (id, slug, name, db_schema, status) values
  ('00000000-0000-4000-8000-000000003402', 'other_0034', 'Other 0034', 'other_0034', 'active');

insert into platform.project_members (project_id, user_id, role)
  select p.id, u.id, 'user'
    from platform.projects p
   cross join (values ('00000000-0000-4000-8000-00000000340a'::uuid), ('00000000-0000-4000-8000-00000000340b'::uuid),
                      ('00000000-0000-4000-8000-00000000340c'::uuid)) as u (id)
   where p.slug = 'carnet';
insert into platform.project_members (project_id, user_id, role) values
  ('00000000-0000-4000-8000-000000003402', '00000000-0000-4000-8000-00000000340d', 'user');

insert into carnet.profiles (id, owner_id, slug, display_name, is_published) values
  ('00000000-0000-4000-8000-000000003410', '00000000-0000-4000-8000-00000000340a', 'ada-0034', 'Ada', true),
  ('00000000-0000-4000-8000-000000003411', '00000000-0000-4000-8000-00000000340b', 'bea-0034', 'Bea', true),
  ('00000000-0000-4000-8000-000000003412', '00000000-0000-4000-8000-00000000340c', 'uma-0034', 'Uma', false);

insert into carnet.links (id, profile_id, platform, url, label, position) values
  ('00000000-0000-4000-8000-000000003420', '00000000-0000-4000-8000-000000003410', 'github', 'https://github.com/ada-0034', null, 1),
  ('00000000-0000-4000-8000-000000003421', '00000000-0000-4000-8000-000000003410', 'website', 'https://ada.example.test', 'Site', 0),
  ('00000000-0000-4000-8000-000000003422', '00000000-0000-4000-8000-000000003411', 'github', 'https://github.com/bea-0034', null, 0),
  ('00000000-0000-4000-8000-000000003423', '00000000-0000-4000-8000-000000003412', 'github', 'https://github.com/uma-0034', null, 0);

-- ---------------------------------------------------------------------------
-- Décision 1 — carnet.record_public_event : propriétés
-- ---------------------------------------------------------------------------
select has_function('carnet', 'record_public_event', array['uuid', 'text', 'text', 'text', 'uuid', 'text'],
  'décision 1 : carnet.record_public_event(uuid, text, text, text, uuid, text) existe');
select function_returns('carnet', 'record_public_event', array['uuid', 'text', 'text', 'text', 'uuid', 'text'], 'void',
  'décision 1 : record_public_event renvoie void (même réponse qu''un événement soit enregistré ou ignoré)');
select is_definer('carnet', 'record_public_event', array['uuid', 'text', 'text', 'text', 'uuid', 'text'],
  'décision 1 : record_public_event est security definer');
select volatility_is('carnet', 'record_public_event', array['uuid', 'text', 'text', 'text', 'uuid', 'text'], 'volatile',
  'décision 1 : record_public_event est volatile (elle écrit)');
select ok(
  exists (select 1 from pg_proc p
           where p.oid = to_regprocedure('carnet.record_public_event(uuid, text, text, text, uuid, text)')
             and p.proconfig @> array['search_path=""']
             and p.proargnames = array['p_id', 'p_slug', 'p_type', 'p_source', 'p_link_id', 'p_device_class']),
  'décision 1 : record_public_event fixe search_path = '''' et nomme ses paramètres p_id, p_slug, p_type, p_source, p_link_id, p_device_class'
);
select ok(
  exists (select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
           where p.oid = to_regprocedure('carnet.record_public_event(uuid, text, text, text, uuid, text)') and r.rolbypassrls),
  'décision 1 : le propriétaire de record_public_event contourne la RLS (postgres)'
);
select ok(
  exists (select 1 from pg_proc p
           where p.oid = to_regprocedure('carnet.record_public_event(uuid, text, text, text, uuid, text)')
             and pg_get_functiondef(p.oid) ~* 'carnet\.(record_event|is_valid_analytics_)'),
  'décision 1 : record_public_event réutilise record_event ou les fonctions is_valid_analytics_* (aucune liste recopiée)'
);
select function_privs_are('carnet', 'assert_valid_analytics_event', array['uuid', 'text', 'text', 'uuid', 'text'], 'anon', '{}'::name[],
  'décision 1 : execute refusé à anon sur assert_valid_analytics_event (contrôle interne)');
select function_privs_are('carnet', 'assert_valid_analytics_event', array['uuid', 'text', 'text', 'uuid', 'text'], 'authenticated', '{}'::name[],
  'décision 1 : execute refusé à authenticated sur assert_valid_analytics_event (contrôle interne)');
select function_privs_are('carnet', 'assert_valid_analytics_event', array['uuid', 'text', 'text', 'uuid', 'text'], 'service_role', '{}'::name[],
  'décision 1 : execute refusé à service_role sur assert_valid_analytics_event (appelée seulement par les fonctions security definer)');
select function_privs_are('carnet', 'assert_valid_analytics_event', array['uuid', 'text', 'text', 'uuid', 'text'], 'public', '{}'::name[],
  'décision 1 : execute révoqué pour public sur assert_valid_analytics_event');
select ok(
  (select count(*) = 1
          and bool_and(p.oid = to_regprocedure('carnet.assert_valid_analytics_event(uuid, text, text, uuid, text)'))
     from pg_proc p
    where p.proname = 'assert_valid_analytics_event'),
  'critère 5 : une seule fonction assert_valid_analytics_event(uuid, text, text, uuid, text) sur l''instance, dans carnet (rien dans public)'
);
select ok(
  exists (select 1 from pg_proc p
           where p.oid = to_regprocedure('carnet.assert_valid_analytics_event(uuid, text, text, uuid, text)')
             and p.proparallel = 's'),
  'décision 1 : assert_valid_analytics_event est parallel safe (proparallel = s)'
);
select is(
  (select count(*) from pg_proc where proname = 'record_public_event'),
  1::bigint,
  'critère 5 : une seule fonction record_public_event sur l''instance (aucune surcharge, rien dans public)'
);

-- ---------------------------------------------------------------------------
-- Critère 3 — droits : service_role seul (avenant ADR 0011)
-- ---------------------------------------------------------------------------
select function_privs_are('carnet', 'record_public_event', array['uuid', 'text', 'text', 'text', 'uuid', 'text'], 'service_role', array['EXECUTE'],
  'critère 3 : execute accordé à service_role sur record_public_event');
select function_privs_are('carnet', 'record_public_event', array['uuid', 'text', 'text', 'text', 'uuid', 'text'], 'authenticated', '{}'::name[],
  'critère 3 : execute refusé à authenticated sur record_public_event');
select function_privs_are('carnet', 'record_public_event', array['uuid', 'text', 'text', 'text', 'uuid', 'text'], 'anon', '{}'::name[],
  'critère 3 : execute refusé à anon sur record_public_event');
select function_privs_are('carnet', 'record_public_event', array['uuid', 'text', 'text', 'text', 'uuid', 'text'], 'public', '{}'::name[],
  'critère 3 : execute révoqué pour public sur record_public_event');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034b1', 'ada-0034', 'profile_view', 'direct', null, 'mobile')$$,
  '42501', null, 'critère 3 : anon ne peut pas exécuter record_public_event (42501)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000340a","role":"authenticated"}';
select throws_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034b2', 'ada-0034', 'profile_view', 'direct', null, 'mobile')$$,
  '42501', null, 'critère 3 : authenticated ne peut pas exécuter record_public_event, même sur son propre profil (42501)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000340b","role":"authenticated"}';
select throws_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034b3', 'ada-0034', 'profile_view', 'direct', null, 'mobile')$$,
  '42501', null, 'critère 3 : un autre membre du projet ne peut pas exécuter record_public_event (42501)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000340d","role":"authenticated"}';
select throws_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034b4', 'ada-0034', 'profile_view', 'direct', null, 'mobile')$$,
  '42501', null, 'critère 3 : un membre d''un autre projet de l''instance ne peut pas exécuter record_public_event (42501)'
);
reset role;

select is(
  (select count(*) from carnet.analytics_events where id::text like '00000000-0000-4000-8000-0000000034b%'),
  0::bigint,
  'critère 3 : aucun appel refusé n''a laissé d''événement'
);

-- ---------------------------------------------------------------------------
-- Critère 1 — enregistrement par slug d'un profil publié, rejeu sans doublon (service_role)
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into rec_results select 'first', carnet.record_public_event('00000000-0000-4000-8000-0000000034e1',
      'ada-0034', 'nfc_scan', 'nfc', null, 'mobile')::text$$,
  'critère 1 : service_role enregistre un nfc_scan par le slug d''un profil publié'
);
select lives_ok(
  $$insert into rec_results select 'replay', carnet.record_public_event('00000000-0000-4000-8000-0000000034e1',
      'ada-0034', 'nfc_scan', 'nfc', null, 'mobile')::text$$,
  'critère 1 : le même événement rejoué (même id) ne lève aucune erreur'
);
select lives_ok(
  $$insert into rec_results select 'replay_other', carnet.record_public_event('00000000-0000-4000-8000-0000000034e1',
      'bea-0034', 'qr_scan', 'qr', null, 'desktop')::text$$,
  'critère 1 : un rejeu du même id avec un autre slug et un autre contenu ne lève aucune erreur'
);
select lives_ok(
  $$insert into rec_results select 'own_link', carnet.record_public_event('00000000-0000-4000-8000-0000000034e2',
      'ada-0034', 'link_click', 'qr', '00000000-0000-4000-8000-000000003420', 'desktop')::text$$,
  'critère 1 : service_role enregistre un link_click sur un lien du profil désigné par le slug'
);
select lives_ok(
  $$insert into rec_results select 'own_link_replay', carnet.record_public_event('00000000-0000-4000-8000-0000000034e2',
      'ada-0034', 'link_click', 'qr', '00000000-0000-4000-8000-000000003420', 'desktop')::text$$,
  'critère 1 : le link_click rejoué (même id) ne lève aucune erreur'
);
select lives_ok(
  $$insert into rec_results select 'other_profile', carnet.record_public_event('00000000-0000-4000-8000-0000000034e3',
      'bea-0034', 'profile_view', 'direct', null, 'mobile')::text$$,
  'critère 1 : service_role enregistre un profile_view sur un autre profil publié'
);
reset role;

select is(
  (select count(*) from carnet.analytics_events where id = '00000000-0000-4000-8000-0000000034e1'),
  1::bigint,
  'critère 1 : un événement envoyé trois fois avec le même id n''existe qu''une fois'
);
select is(
  (select profile_id || '/' || type || '/' || source || '/' || device_class || '/' || coalesce(link_id::text, '<null>')
     from carnet.analytics_events where id = '00000000-0000-4000-8000-0000000034e1'),
  '00000000-0000-4000-8000-000000003410/nfc_scan/nfc/mobile/<null>',
  'critère 1 : le slug est résolu en profile_id et le premier enregistrement est conservé tel quel (on conflict do nothing)'
);
select is(
  (select (occurred_at = now())::text from carnet.analytics_events where id = '00000000-0000-4000-8000-0000000034e1'),
  'true',
  'critère 1 : occurred_at est l''horodatage serveur (now() de la transaction)'
);
select is(
  (select count(*) from carnet.analytics_events where id = '00000000-0000-4000-8000-0000000034e2'),
  1::bigint,
  'critère 1 : le link_click rejoué n''existe qu''une fois'
);
select is(
  (select profile_id || '/' || link_id || '/' || source from carnet.analytics_events
    where id = '00000000-0000-4000-8000-0000000034e2'),
  '00000000-0000-4000-8000-000000003410/00000000-0000-4000-8000-000000003420/qr',
  'critère 1 : le link_click est enregistré avec son profil, son link_id et sa source'
);
select is(
  (select profile_id::text from carnet.analytics_events where id = '00000000-0000-4000-8000-0000000034e3'),
  '00000000-0000-4000-8000-000000003411',
  'critère 1 : chaque slug est résolu vers son propre profil'
);

-- ---------------------------------------------------------------------------
-- Critère 2 — slug inconnu, profil non publié, lien d'un autre profil : rien d'écrit, même réponse
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into rec_results select 'unknown_slug', carnet.record_public_event('00000000-0000-4000-8000-0000000034f1',
      'inconnu-0034', 'profile_view', 'direct', null, 'mobile')::text$$,
  'critère 2 : un slug inconnu ne lève aucune erreur (pas d''oracle)'
);
select lives_ok(
  $$insert into rec_results select 'null_slug', carnet.record_public_event('00000000-0000-4000-8000-0000000034f2',
      null, 'profile_view', 'direct', null, 'mobile')::text$$,
  'critère 2 : un slug nul ne lève aucune erreur'
);
select lives_ok(
  $$insert into rec_results select 'unpublished', carnet.record_public_event('00000000-0000-4000-8000-0000000034f3',
      'uma-0034', 'profile_view', 'direct', null, 'mobile')::text$$,
  'critère 2 : le slug d''un profil non publié ne lève aucune erreur'
);
select lives_ok(
  $$insert into rec_results select 'unpublished_link', carnet.record_public_event('00000000-0000-4000-8000-0000000034f4',
      'uma-0034', 'link_click', 'direct', '00000000-0000-4000-8000-000000003423', 'mobile')::text$$,
  'critère 2 : un link_click sur le lien d''un profil non publié ne lève aucune erreur'
);
select lives_ok(
  $$insert into rec_results select 'foreign_link', carnet.record_public_event('00000000-0000-4000-8000-0000000034f5',
      'ada-0034', 'link_click', 'direct', '00000000-0000-4000-8000-000000003422', 'mobile')::text$$,
  'critère 2 : un link_click avec le lien d''un autre profil ne lève aucune erreur'
);
select lives_ok(
  $$insert into rec_results select 'unknown_link', carnet.record_public_event('00000000-0000-4000-8000-0000000034f6',
      'ada-0034', 'link_click', 'direct', '00000000-0000-4000-8000-0000000034fe', 'mobile')::text$$,
  'critère 2 : un link_click avec un lien inexistant ne lève aucune erreur'
);
select lives_ok(
  $$insert into rec_results select 'unknown_slug_replay', carnet.record_public_event('00000000-0000-4000-8000-0000000034f1',
      'inconnu-0034', 'profile_view', 'direct', null, 'mobile')::text$$,
  'critère 2 : le rejeu d''un événement ignoré ne lève aucune erreur'
);
reset role;

select is(
  (select count(*) from carnet.analytics_events where id::text like '00000000-0000-4000-8000-0000000034f%'),
  0::bigint,
  'critère 2 : aucun événement écrit pour un slug inconnu ou nul, un profil non publié, un lien étranger ou inexistant'
);
select is(
  (select count(*) from carnet.analytics_events where profile_id = '00000000-0000-4000-8000-000000003412'),
  0::bigint,
  'critère 2 : le profil non publié n''a aucun événement'
);
select is(
  (select count(*) from carnet.analytics_events
    where profile_id in ('00000000-0000-4000-8000-000000003410', '00000000-0000-4000-8000-000000003411')),
  3::bigint,
  'critère 2 : seuls les trois événements valides existent pour les profils publiés (aucun effet de bord)'
);
select ok(
  (select count(*) = 13 and count(distinct coalesce(result, '<null>')) = 1 from rec_results),
  'critère 2 : la fonction répond pareil (enregistré, rejoué, slug inconnu ou nul, profil non publié, lien étranger ou inexistant)'
);

-- ---------------------------------------------------------------------------
-- Décision 1 — 22023 identiques à record_event, levés avant toute lecture du profil (aucun oracle)
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034d1', 'ada-0034', 'page_view', 'direct', null, 'mobile')$$,
  '22023', null, 'décision 1 : type hors liste → 22023'
);
select throws_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034d2', 'ada-0034', 'profile_view', 'email', null, 'mobile')$$,
  '22023', null, 'décision 1 : source hors liste → 22023'
);
select throws_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034d3', 'ada-0034', 'profile_view', 'direct', null, 'bot')$$,
  '22023', null, 'décision 1 : device_class hors liste (bot) → 22023'
);
select throws_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034d4', 'ada-0034', null, 'direct', null, 'mobile')$$,
  '22023', null, 'décision 1 : type nul → 22023'
);
select throws_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034d5', 'ada-0034', 'profile_view', null, null, 'mobile')$$,
  '22023', null, 'décision 1 : source nulle → 22023'
);
select throws_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034d6', 'ada-0034', 'profile_view', 'direct', null, null)$$,
  '22023', null, 'décision 1 : device_class nul → 22023'
);
select throws_ok(
  $$select carnet.record_public_event(null, 'ada-0034', 'profile_view', 'direct', null, 'mobile')$$,
  '22023', null, 'décision 1 : id nul → 22023 (l''id est fourni par l''émetteur)'
);
select throws_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034d7', 'ada-0034', 'link_click', 'direct', null, 'mobile')$$,
  '22023', null, 'décision 1 : link_click sans link_id → 22023'
);
select throws_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034d8', 'ada-0034', 'profile_view', 'direct', '00000000-0000-4000-8000-000000003420', 'mobile')$$,
  '22023', null, 'décision 1 : link_id sur un autre type que link_click → 22023'
);
select throws_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034d9', 'uma-0034', 'page_view', 'direct', null, 'mobile')$$,
  '22023', null, 'décision 1 : type hors liste sur un profil non publié → 22023 aussi (validation avant toute lecture)'
);
select throws_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034da', 'inconnu-0034', 'page_view', 'direct', null, 'mobile')$$,
  '22023', null, 'décision 1 : type hors liste sur un slug inconnu → 22023 aussi (validation avant toute lecture)'
);
select throws_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034db', null, 'link_click', 'direct', null, 'mobile')$$,
  '22023', null, 'décision 1 : link_click sans link_id sur un slug nul → 22023 aussi (validation avant toute lecture)'
);
reset role;
select is(
  (select count(*) from carnet.analytics_events where id::text like '00000000-0000-4000-8000-0000000034d%'),
  0::bigint,
  'décision 1 : aucun appel rejeté en 22023 n''a laissé d''événement'
);

-- ---------------------------------------------------------------------------
-- Critère 4 — get_public_links renvoie l'id de chaque lien d'un profil publié
-- ---------------------------------------------------------------------------
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'get_public_links'
       and p.proretset
       and p.proargnames = array['p_slug', 'id', 'platform', 'url', 'label', 'position']
       and p.proargmodes = array['i', 't', 't', 't', 't', 't']::"char"[]
       and p.proallargtypes = array['text'::regtype, 'uuid'::regtype, 'text'::regtype, 'text'::regtype, 'text'::regtype, 'smallint'::regtype]::oid[]
  ),
  'critère 4 : get_public_links(p_slug text) returns table(id uuid, platform text, url text, label text, position smallint)'
);
select is(
  (select count(*) from pg_proc where proname = 'get_public_links'),
  1::bigint,
  'critère 5 : une seule fonction get_public_links sur l''instance (ancienne signature remplacée, aucune surcharge)'
);
select is_definer('carnet', 'get_public_links', array['text'], 'critère 4 : get_public_links reste security definer');
select function_privs_are('carnet', 'get_public_links', array['text'], 'anon', array['EXECUTE'],
  'critère 4 : execute toujours accordé à anon sur get_public_links');
select function_privs_are('carnet', 'get_public_links', array['text'], 'authenticated', array['EXECUTE'],
  'critère 4 : execute toujours accordé à authenticated sur get_public_links');
select function_privs_are('carnet', 'get_public_links', array['text'], 'service_role', array['EXECUTE'],
  'critère 4 : execute toujours accordé à service_role sur get_public_links');
select function_privs_are('carnet', 'get_public_links', array['text'], 'public', '{}'::name[],
  'critère 4 : execute toujours révoqué pour public sur get_public_links');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
insert into reads values
  ('ada', pg_temp.txt($$select string_agg(id::text || '@' || position, ',' order by position) from carnet.get_public_links('ada-0034')$$)),
  ('ada_cols', pg_temp.txt($$select string_agg(id::text || '/' || platform || '/' || url || '/' || coalesce(label, '<null>'), ',' order by position) from carnet.get_public_links('ada-0034')$$)),
  ('uma', pg_temp.txt($$select count(id)::text from carnet.get_public_links('uma-0034')$$)),
  ('unknown', pg_temp.txt($$select count(id)::text from carnet.get_public_links('inconnu-0034')$$));
select throws_ok(
  $$select profile_id from carnet.get_public_links('ada-0034')$$,
  '42703', null, 'critère 4 : get_public_links n''expose toujours pas profile_id'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000340d","role":"authenticated"}';
insert into reads values
  ('ada_other_project', pg_temp.txt($$select string_agg(id::text, ',' order by position) from carnet.get_public_links('ada-0034')$$));
reset role;

select is(
  (select v from reads where label = 'ada'),
  '00000000-0000-4000-8000-000000003421@0,00000000-0000-4000-8000-000000003420@1',
  'critère 4 : anon obtient l''id de chaque lien du profil publié, trié par position'
);
select is(
  (select v from reads where label = 'ada_cols'),
  '00000000-0000-4000-8000-000000003421/website/https://ada.example.test/Site,'
  '00000000-0000-4000-8000-000000003420/github/https://github.com/ada-0034/<null>',
  'critère 4 : chaque id est celui du lien de la ligne (platform, url, label correspondants)'
);
select is(
  (select v from reads where label = 'uma'),
  '0',
  'critère 4 : get_public_links ne renvoie rien pour un profil non publié (même s''il a des liens)'
);
select is(
  (select v from reads where label = 'unknown'),
  '0',
  'critère 4 : get_public_links ne renvoie rien pour un slug inconnu'
);
select is(
  (select v from reads where label = 'ada_other_project'),
  '00000000-0000-4000-8000-000000003421,00000000-0000-4000-8000-000000003420',
  'critère 4 : un membre d''un autre projet obtient les mêmes id publics (lecture publique, comme anon)'
);

-- Le circuit complet : un id renvoyé par get_public_links est accepté par record_public_event.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034c1', 'ada-0034', 'link_click', 'nfc',
      (select l.id from carnet.get_public_links('ada-0034') l where l.position = 0), 'mobile')$$,
  'critère 4 : l''id d''un lien public est utilisable comme p_link_id de record_public_event'
);
reset role;
select is(
  (select link_id::text from carnet.analytics_events where id = '00000000-0000-4000-8000-0000000034c1'),
  '00000000-0000-4000-8000-000000003421',
  'critère 4 : le clic est rattaché au lien renvoyé par get_public_links'
);

-- Dépublication : plus aucun id, plus aucune écriture.
update carnet.profiles set is_published = false where id = '00000000-0000-4000-8000-000000003410';
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
insert into reads values
  ('ada_unpublished', pg_temp.txt($$select count(id)::text from carnet.get_public_links('ada-0034')$$));
reset role;
select is(
  (select v from reads where label = 'ada_unpublished'),
  '0',
  'critère 4 : après dépublication, get_public_links ne renvoie plus aucun id'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0000000034c2', 'ada-0034', 'profile_view', 'direct', null, 'mobile')$$,
  'critère 2 : après dépublication, record_public_event ne lève aucune erreur'
);
reset role;
select is(
  (select count(*) from carnet.analytics_events where id = '00000000-0000-4000-8000-0000000034c2'),
  0::bigint,
  'critère 2 : après dépublication, record_public_event n''écrit plus rien'
);

select * from finish();
rollback;
