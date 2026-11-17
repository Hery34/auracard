-- Fiche 0023 — suppression de compte (RGPD) : carnet.delete_own_account() et carnet.is_orphan_account(p_user_id).
-- Critères couverts : 1 (données carnet effacées, puces en stock), 2 (orphelin ou non), 3 (rejeu sans effet),
-- 5 (seul l'appelant, jamais un autre compte), décision 4 (autres projets jamais touchés).
-- Contrat figé pour db-architect :
--   carnet.delete_own_account() returns text : volatile, security definer, set search_path = '', propriétaire bypassrls ;
--     execute à authenticated seulement (révoqué à public, anon, service_role). Appelant = auth.uid(), aucun paramètre.
--     Supprime : la ligne carnet.profiles dont owner_id = auth.uid() (liens et QR par cascade, puces remises en stock
--     par le trigger profiles_release_nfc_tags de 0024), même si l'appelant n'est plus membre de carnet ; les lignes
--     carnet.rate_limits dont la clé a la forme `<portée>:<uuid de l'appelant>` (clés en clair : `nfc-activate:<uuid>`,
--     0024) ; la ligne platform.project_members du projet `carnet` seulement. Les clés empreintes HMAC
--     (`<portée>:<64 hex>`, ex. `profile-write`) ne contiennent pas l'uuid : elles restent, purgées sous 24 h (fiche 0010).
--     Ne touche ni auth.users, ni storage.objects (dossier vidé par l'API Storage à l'étape 1), ni aucun autre compte,
--     ni aucune autre appartenance. Sans profil ni appartenance (rejeu, compte d'un autre projet) : succès sans effet.
--     Renvoie le slug du profil supprimé (y compris sans appartenance carnet, pour expirer le cache public), null
--     quand aucun profil n'a été supprimé (rejeu, membre sans profil, compte d'un autre projet).
--     Sans `sub` dans les claims : rien n'est supprimé (erreur ou non, au choix).
--   carnet.is_orphan_account(p_user_id uuid) returns boolean : stable, security definer, set search_path = '' ;
--     execute à service_role seulement. true ssi aucune ligne platform.project_members pour ce compte, quel que soit
--     le projet (archivé compris) ; compte inconnu → true (deleteUser répondra 404, traité comme un succès).
-- Personas (UUID fixes, plage 0…23xx propre à ce fichier) :
--   A  0…230a  membre (user) de carnet seul, profil 0…2310 publié (ada-0023), 2 liens, QR, puces 1 assigned + 1 disabled,
--              rate_limits `nfc-activate:<A>`, `scope-0023:<A>` et une empreinte `profile-write:<hex>`, un objet
--              carnet-media/<0…2310>/avatar-….jpg
--   M  0…230b  membre de carnet ET de other_0023, profil 0…2311 (max-0023)
--   B  0…230c  membre de carnet, profil 0…2312 publié (bea-0023), 1 lien, QR, 1 puce assigned, `nfc-activate:<B>`
--   C  0…230d  membre de other_0023 seul, aucun profil
--   N  0…230e  membre de carnet sans profil
--   O  0…2309  membre de other_0023 seul, mais propriétaire du profil 0…2313 (oto-0023, ancienne appartenance perdue)
--   R  0…2308  membre du projet archivé archived_0023 seul
--   Z  0…2307  compte de l'instance sans aucune appartenance
-- Fixtures créées par postgres (bypassrls) dans la transaction, annulées par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(73);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000230a', 'a-carnet-0023@test.local'),
  ('00000000-0000-4000-8000-00000000230b', 'm-multi-0023@test.local'),
  ('00000000-0000-4000-8000-00000000230c', 'b-carnet-0023@test.local'),
  ('00000000-0000-4000-8000-00000000230d', 'c-other-0023@test.local'),
  ('00000000-0000-4000-8000-00000000230e', 'n-carnet-0023@test.local'),
  ('00000000-0000-4000-8000-000000002309', 'o-former-0023@test.local'),
  ('00000000-0000-4000-8000-000000002308', 'r-archived-0023@test.local'),
  ('00000000-0000-4000-8000-000000002307', 'z-none-0023@test.local');

insert into platform.projects (id, slug, name, db_schema, status) values
  ('00000000-0000-4000-8000-000000002302', 'other_0023', 'Other 0023', 'other_0023', 'active'),
  ('00000000-0000-4000-8000-000000002303', 'archived_0023', 'Archived 0023', 'archived_0023', 'archived');

insert into platform.project_members (project_id, user_id, role)
  select p.id, u.id, 'user'
    from platform.projects p
   cross join (values ('00000000-0000-4000-8000-00000000230a'::uuid), ('00000000-0000-4000-8000-00000000230b'::uuid),
                      ('00000000-0000-4000-8000-00000000230c'::uuid), ('00000000-0000-4000-8000-00000000230e'::uuid)) as u (id)
   where p.slug = 'carnet';
insert into platform.project_members (project_id, user_id, role) values
  ('00000000-0000-4000-8000-000000002302', '00000000-0000-4000-8000-00000000230b', 'user'),
  ('00000000-0000-4000-8000-000000002302', '00000000-0000-4000-8000-00000000230d', 'user'),
  ('00000000-0000-4000-8000-000000002302', '00000000-0000-4000-8000-000000002309', 'user'),
  ('00000000-0000-4000-8000-000000002303', '00000000-0000-4000-8000-000000002308', 'user');

insert into carnet.profiles (id, owner_id, slug, display_name, is_published) values
  ('00000000-0000-4000-8000-000000002310', '00000000-0000-4000-8000-00000000230a', 'ada-0023', 'Ada', true),
  ('00000000-0000-4000-8000-000000002311', '00000000-0000-4000-8000-00000000230b', 'max-0023', 'Max', true),
  ('00000000-0000-4000-8000-000000002312', '00000000-0000-4000-8000-00000000230c', 'bea-0023', 'Bea', true),
  ('00000000-0000-4000-8000-000000002313', '00000000-0000-4000-8000-000000002309', 'oto-0023', 'Oto', true);

insert into carnet.links (profile_id, platform, url, label, position) values
  ('00000000-0000-4000-8000-000000002310', 'github', 'https://github.com/ada-0023', null, 0),
  ('00000000-0000-4000-8000-000000002310', 'website', 'https://ada.example.test', 'Site', 1),
  ('00000000-0000-4000-8000-000000002312', 'github', 'https://github.com/bea-0023', null, 0);

insert into carnet.qr_codes (profile_id, code) values
  ('00000000-0000-4000-8000-000000002310', 'ada02300'),
  ('00000000-0000-4000-8000-000000002312', 'bea02300');

insert into carnet.nfc_tags (uid, profile_id, status, activation_code_hash, batch_id, activated_at) values
  ('ada023000001', '00000000-0000-4000-8000-000000002310', 'assigned', 'x', '00000000-0000-4000-8000-0000000023b1', now()),
  ('ada023000002', '00000000-0000-4000-8000-000000002310', 'disabled', 'x', '00000000-0000-4000-8000-0000000023b1', now()),
  ('bea023000001', '00000000-0000-4000-8000-000000002312', 'assigned', 'x', '00000000-0000-4000-8000-0000000023b1', now());

insert into carnet.rate_limits (key, window_start, count) values
  ('nfc-activate:00000000-0000-4000-8000-00000000230a', now(), 3),
  ('scope-0023:00000000-0000-4000-8000-00000000230a', now(), 1),
  ('profile-write:' || repeat('a', 64), now(), 2),
  ('nfc-activate:00000000-0000-4000-8000-00000000230c', now(), 4);

insert into storage.objects (bucket_id, name) values
  ('carnet-media', '00000000-0000-4000-8000-000000002310/avatar-00000000-0000-4000-8000-0000000023c1.jpg');

-- ---------------------------------------------------------------------------
-- Structure — carnet.delete_own_account()
-- ---------------------------------------------------------------------------
select has_function('carnet', 'delete_own_account', array[]::name[], 'décision 2 : carnet.delete_own_account() existe, sans paramètre');
select function_returns('carnet', 'delete_own_account', array[]::name[], 'text', 'décision 2 : delete_own_account renvoie text (slug du profil supprimé)');
select is_definer('carnet', 'delete_own_account', array[]::name[], 'décision 2 : delete_own_account est security definer');
select volatility_is('carnet', 'delete_own_account', array[]::name[], 'volatile', 'décision 2 : delete_own_account est volatile (elle écrit)');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.delete_own_account()')
             and p.proconfig @> array['search_path=""']),
  'décision 2 : delete_own_account fixe set search_path = '''''
);
select ok(
  exists (select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
           where p.oid = to_regprocedure('carnet.delete_own_account()') and r.rolbypassrls),
  'décision 2 : le propriétaire de delete_own_account contourne la RLS (postgres)'
);
select function_privs_are('carnet', 'delete_own_account', array[]::name[], 'authenticated', array['EXECUTE'], 'critère 5 : execute accordé à authenticated sur delete_own_account');
select function_privs_are('carnet', 'delete_own_account', array[]::name[], 'anon', '{}'::name[], 'critère 5 : execute refusé à anon sur delete_own_account');
select function_privs_are('carnet', 'delete_own_account', array[]::name[], 'service_role', '{}'::name[], 'critère 5 : execute refusé à service_role sur delete_own_account (appelant = auth.uid())');
select function_privs_are('carnet', 'delete_own_account', array[]::name[], 'public', '{}'::name[], 'critère 5 : execute révoqué pour public sur delete_own_account');

-- ---------------------------------------------------------------------------
-- Structure — carnet.is_orphan_account(uuid)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'is_orphan_account', array['uuid'], 'ADR 0011 : carnet.is_orphan_account(uuid) existe');
select function_returns('carnet', 'is_orphan_account', array['uuid'], 'boolean', 'ADR 0011 : is_orphan_account renvoie boolean');
select is_definer('carnet', 'is_orphan_account', array['uuid'], 'ADR 0011 : is_orphan_account est security definer (lit platform.project_members)');
select volatility_is('carnet', 'is_orphan_account', array['uuid'], 'stable', 'ADR 0011 : is_orphan_account est stable');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.is_orphan_account(uuid)')
             and p.proconfig @> array['search_path=""']
             and p.proargnames = array['p_user_id']),
  'ADR 0011 : is_orphan_account fixe set search_path = '''' et nomme son paramètre p_user_id'
);
select function_privs_are('carnet', 'is_orphan_account', array['uuid'], 'service_role', array['EXECUTE'], 'ADR 0011 : execute accordé à service_role sur is_orphan_account');
select function_privs_are('carnet', 'is_orphan_account', array['uuid'], 'authenticated', '{}'::name[], 'ADR 0011 : execute refusé à authenticated sur is_orphan_account');
select function_privs_are('carnet', 'is_orphan_account', array['uuid'], 'anon', '{}'::name[], 'ADR 0011 : execute refusé à anon sur is_orphan_account');
select function_privs_are('carnet', 'is_orphan_account', array['uuid'], 'public', '{}'::name[], 'ADR 0011 : execute révoqué pour public sur is_orphan_account');

-- ---------------------------------------------------------------------------
-- Critère 5 — refus d'exécution
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select carnet.delete_own_account()$$, '42501', null, 'critère 5 : anon ne peut pas appeler delete_own_account (42501)');
select throws_ok(
  $$select carnet.is_orphan_account('00000000-0000-4000-8000-000000002307')$$,
  '42501', null, 'ADR 0011 : anon ne peut pas appeler is_orphan_account (42501)'
);
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select carnet.delete_own_account()$$, '42501', null, 'critère 5 : service_role ne peut pas appeler delete_own_account (42501)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000230a","role":"authenticated"}';
select throws_ok(
  $$select carnet.is_orphan_account('00000000-0000-4000-8000-00000000230a')$$,
  '42501', null, 'ADR 0011 : authenticated ne peut pas appeler is_orphan_account, même pour son propre compte (42501)'
);
reset role;

-- Claims authenticated sans sub : auth.uid() nul, rien ne doit disparaître (erreur tolérée).
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
do $$
begin
  perform carnet.delete_own_account();
exception when others then
  null;
end
$$;
reset role;
select is(
  (select count(*) from carnet.profiles where id::text like '00000000-0000-4000-8000-00000000231%')
    + (select count(*) from platform.project_members where user_id::text like '00000000-0000-4000-8000-0000000023%')
    + (select count(*) from carnet.rate_limits where key like '%-0000000023%'),
  4::bigint + 8::bigint + 3::bigint,
  'critère 5 : sans sub dans les claims, aucun profil, appartenance ni compteur supprimé'
);

-- ---------------------------------------------------------------------------
-- Critère 2 — is_orphan_account avant toute suppression
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(carnet.is_orphan_account('00000000-0000-4000-8000-00000000230a'), false, 'critère 2 : A membre de carnet → non orphelin');
select is(carnet.is_orphan_account('00000000-0000-4000-8000-00000000230b'), false, 'critère 2 : M membre de deux projets → non orphelin');
select is(carnet.is_orphan_account('00000000-0000-4000-8000-00000000230d'), false, 'critère 2 : C membre d''un autre projet seulement → non orphelin');
select is(carnet.is_orphan_account('00000000-0000-4000-8000-000000002308'), false, 'critère 2 : R membre d''un projet archivé → non orphelin (toute appartenance compte)');
select is(carnet.is_orphan_account('00000000-0000-4000-8000-000000002307'), true, 'critère 2 : Z sans aucune appartenance → orphelin');
select is(carnet.is_orphan_account('00000000-0000-4000-8000-0000000023ff'), true, 'critère 2 : compte inconnu → orphelin (deleteUser répondra 404, succès)');
reset role;

-- ---------------------------------------------------------------------------
-- Critère 1 — A supprime son compte
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000230a","role":"authenticated"}';
select is((select carnet.delete_own_account()::text), 'ada-0023', 'critère 1 : A appelle delete_own_account sans erreur et reçoit le slug de son profil');
reset role;

select is((select count(*) from carnet.profiles where id = '00000000-0000-4000-8000-000000002310'), 0::bigint, 'critère 1 : le profil de A est supprimé');
select is((select count(*) from carnet.profiles where owner_id = '00000000-0000-4000-8000-00000000230a'), 0::bigint, 'critère 1 : plus aucun profil appartenant à A');
select is((select count(*) from carnet.links where profile_id = '00000000-0000-4000-8000-000000002310'), 0::bigint, 'critère 1 : les liens de A sont supprimés (cascade)');
select is((select count(*) from carnet.qr_codes where profile_id = '00000000-0000-4000-8000-000000002310'), 0::bigint, 'critère 1 : le QR de A est supprimé (cascade)');
select is(
  (select count(*) from carnet.nfc_tags
    where uid in ('ada023000001', 'ada023000002') and status = 'stock' and profile_id is null and activated_at is null),
  2::bigint,
  'critère 1 : les deux puces de A (assigned et disabled) sont en stock, sans profil ni date d''activation'
);
select is(
  (select count(*) from carnet.rate_limits where key = 'nfc-activate:00000000-0000-4000-8000-00000000230a'),
  0::bigint,
  'critère 1 : le compteur nfc-activate:<A> est supprimé'
);
select is(
  (select count(*) from carnet.rate_limits where key = 'scope-0023:00000000-0000-4000-8000-00000000230a'),
  0::bigint,
  'critère 1 : tout compteur de la forme <portée>:<uuid de A> est supprimé'
);
select is(
  (select count(*) from carnet.rate_limits where key = 'profile-write:' || repeat('a', 64)),
  1::bigint,
  'critère 1 (limite) : une clé empreinte HMAC, non attribuable en base, reste (purgée sous 24 h, fiche 0010)'
);
select is(
  (select count(*) from platform.project_members where user_id = '00000000-0000-4000-8000-00000000230a'),
  0::bigint,
  'critère 1 : l''appartenance de A à carnet est supprimée'
);
select is(
  (select count(*) from auth.users where id = '00000000-0000-4000-8000-00000000230a'),
  1::bigint,
  'décision 2 : delete_own_account ne touche pas auth.users (étape 3, adaptateur admin)'
);
select is(
  (select count(*) from storage.objects
    where bucket_id = 'carnet-media' and name like '00000000-0000-4000-8000-000000002310/%'),
  1::bigint,
  'décision 2 : delete_own_account ne touche pas storage.objects (dossier vidé par l''API Storage, étape 1)'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(carnet.is_orphan_account('00000000-0000-4000-8000-00000000230a'), true, 'critère 2 : après suppression, A (carnet seul) est orphelin');
reset role;

-- B n'est pas touché
select is((select count(*) from carnet.profiles where id = '00000000-0000-4000-8000-000000002312'), 1::bigint, 'critère 5 : le profil de B est intact');
select is((select count(*) from carnet.links where profile_id = '00000000-0000-4000-8000-000000002312'), 1::bigint, 'critère 5 : le lien de B est intact');
select is((select count(*) from carnet.qr_codes where profile_id = '00000000-0000-4000-8000-000000002312'), 1::bigint, 'critère 5 : le QR de B est intact');
select is(
  (select status || ':' || profile_id::text from carnet.nfc_tags where uid = 'bea023000001'),
  'assigned:00000000-0000-4000-8000-000000002312',
  'critère 5 : la puce de B reste affectée à B'
);
select is(
  (select count from carnet.rate_limits where key = 'nfc-activate:00000000-0000-4000-8000-00000000230c'),
  4,
  'critère 5 : le compteur nfc-activate:<B> est intact'
);
select is(
  (select count(*) from platform.project_members where user_id = '00000000-0000-4000-8000-00000000230c'),
  1::bigint,
  'critère 5 : l''appartenance de B est intacte'
);

-- ---------------------------------------------------------------------------
-- Critère 3 — rejeu par A : succès, aucun effet
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('test0023.snapshot', (
  select concat_ws('|',
    (select count(*) from carnet.profiles),
    (select count(*) from carnet.links),
    (select count(*) from carnet.qr_codes),
    (select string_agg(uid || ':' || status || ':' || coalesce(profile_id::text, '-'), ',' order by uid) from carnet.nfc_tags where batch_id = '00000000-0000-4000-8000-0000000023b1'),
    (select count(*) from carnet.rate_limits),
    (select count(*) from platform.project_members),
    (select count(*) from auth.users where id::text like '00000000-0000-4000-8000-0000000023%'))
  ), true);
end
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000230a","role":"authenticated"}';
select is((select carnet.delete_own_account()::text), null::text, 'critère 3 : rejeu par A (sans profil ni appartenance) → succès, null (plus de slug)');
reset role;

select is(
  concat_ws('|',
    (select count(*) from carnet.profiles),
    (select count(*) from carnet.links),
    (select count(*) from carnet.qr_codes),
    (select string_agg(uid || ':' || status || ':' || coalesce(profile_id::text, '-'), ',' order by uid) from carnet.nfc_tags where batch_id = '00000000-0000-4000-8000-0000000023b1'),
    (select count(*) from carnet.rate_limits),
    (select count(*) from platform.project_members),
    (select count(*) from auth.users where id::text like '00000000-0000-4000-8000-0000000023%')),
  current_setting('test0023.snapshot'),
  'critère 3 : le rejeu ne change rien (profils, liens, QR, puces, compteurs, appartenances, comptes)'
);

-- ---------------------------------------------------------------------------
-- Critère 2 / décision 4 — M, membre de deux projets
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000230b","role":"authenticated"}';
select is((select carnet.delete_own_account()::text), 'max-0023', 'critère 2 : M appelle delete_own_account sans erreur et reçoit le slug de son profil');
reset role;

select is((select count(*) from carnet.profiles where id = '00000000-0000-4000-8000-000000002311'), 0::bigint, 'critère 2 : le profil carnet de M est supprimé');
select is(
  (select count(*) from platform.project_members pm join platform.projects p on p.id = pm.project_id
    where pm.user_id = '00000000-0000-4000-8000-00000000230b' and p.slug = 'carnet'),
  0::bigint,
  'critère 2 : l''appartenance de M à carnet est supprimée'
);
select is(
  (select count(*) from platform.project_members
    where user_id = '00000000-0000-4000-8000-00000000230b' and project_id = '00000000-0000-4000-8000-000000002302'),
  1::bigint,
  'décision 4 : l''appartenance de M à other_0023 est conservée'
);
select is((select count(*) from auth.users where id = '00000000-0000-4000-8000-00000000230b'), 1::bigint, 'décision 4 : le compte auth.users de M est conservé');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(carnet.is_orphan_account('00000000-0000-4000-8000-00000000230b'), false, 'critère 2 : après suppression, M (autre projet) n''est pas orphelin');
reset role;

-- ---------------------------------------------------------------------------
-- N — membre sans profil
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000230e","role":"authenticated"}';
select is((select carnet.delete_own_account()::text), null::text, 'critère 3 : N (membre sans profil) appelle delete_own_account sans erreur, null');
reset role;
select is(
  (select count(*) from platform.project_members where user_id = '00000000-0000-4000-8000-00000000230e'),
  0::bigint,
  'critère 1 : l''appartenance de N à carnet est supprimée même sans profil'
);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(carnet.is_orphan_account('00000000-0000-4000-8000-00000000230e'), true, 'critère 2 : N (carnet seul) est orphelin après suppression');
reset role;

-- ---------------------------------------------------------------------------
-- C — compte d'un autre projet, rien dans carnet : succès sans effet
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000230d","role":"authenticated"}';
select is((select carnet.delete_own_account()::text), null::text, 'décision 2 : C (autre projet, rien dans carnet) → succès sans effet, null');
reset role;
select is(
  (select count(*) from platform.project_members
    where user_id = '00000000-0000-4000-8000-00000000230d' and project_id = '00000000-0000-4000-8000-000000002302'),
  1::bigint,
  'décision 4 : l''appartenance de C à other_0023 est intacte'
);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(carnet.is_orphan_account('00000000-0000-4000-8000-00000000230d'), false, 'décision 4 : C reste non orphelin');
reset role;

-- ---------------------------------------------------------------------------
-- O — profil carnet restant sans appartenance carnet (ancienne appartenance perdue)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002309","role":"authenticated"}';
select is((select carnet.delete_own_account()::text), 'oto-0023', 'critère 1 : O (profil sans appartenance carnet) appelle delete_own_account sans erreur et reçoit son slug (cache à expirer)');
reset role;
select is((select count(*) from carnet.profiles where id = '00000000-0000-4000-8000-000000002313'), 0::bigint, 'critère 1 : le profil de O est supprimé même sans appartenance carnet (RGPD)');
select is(
  (select count(*) from platform.project_members where user_id = '00000000-0000-4000-8000-000000002309'),
  1::bigint,
  'décision 4 : l''appartenance de O à other_0023 est intacte'
);

-- ---------------------------------------------------------------------------
-- Bilan : seuls les comptes appelants ont perdu leurs données carnet
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(slug order by slug) from carnet.profiles where slug like '%-0023'),
  array['bea-0023']::text[],
  'critère 5 : seul le profil de B subsiste parmi les fixtures'
);
select is(
  (select count(*) from platform.project_members where user_id::text like '00000000-0000-4000-8000-0000000023%'),
  5::bigint,
  'décision 4 : restent B (carnet), M, C, O (other_0023) et R (archived_0023)'
);
select is(
  (select count(*) from auth.users where id::text like '00000000-0000-4000-8000-0000000023%'),
  8::bigint,
  'décision 2 : aucun compte auth.users supprimé par le SQL'
);
select is(
  (select count(*) from carnet.rate_limits where key like '%:00000000-0000-4000-8000-0000000023%'),
  1::bigint,
  'critère 5 : seul le compteur en clair de B subsiste'
);
select is(
  (select count(*) from carnet.nfc_tags where batch_id = '00000000-0000-4000-8000-0000000023b1' and status = 'stock'),
  2::bigint,
  'critère 1 : exactement les deux puces de A sont revenues en stock'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(carnet.is_orphan_account('00000000-0000-4000-8000-00000000230c'), false, 'critère 2 : B, toujours membre de carnet, n''est pas orphelin');
select is(carnet.is_orphan_account('00000000-0000-4000-8000-000000002308'), false, 'critère 2 : R (projet archivé) reste non orphelin');
reset role;

select * from finish();
rollback;
