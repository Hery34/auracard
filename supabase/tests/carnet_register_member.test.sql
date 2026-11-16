-- Fiche 0006 — fonction carnet.register_member(p_user_id uuid, p_display_name text, p_slug text) returns uuid :
-- appartenance platform.project_members (carnet, user) + profil initial, en une transaction idempotente, réservée à service_role.
-- Critères couverts : 1 (déclaratif + 42501 en situation), 2 (création), 3 (rejeu), 4 (membre d'un autre projet),
-- 5 (slug pris → 23505, rien d'écrit), 6 (check → 23514, rien d'écrit), 7 (projet archivé → exception, rien d'écrit),
-- 8 partiellement (rejouabilité : rollback final ; la double application de la migration est prouvée par db-architect) ;
-- cas fermés par l'audit (question 5) : p_user_id inconnu → 23503, p_user_id null → 23502, p_slug null → 23502, rien d'écrit.
-- Les erreurs de contrainte sont vérifiées par SQLSTATE seul (pas de message : indépendance de la locale, cohérence avec 0005) ;
-- chaque cas est construit pour qu'une seule contrainte puisse jouer (voir les commentaires des critères 5 et 6).
-- L'invariant « aucune fonction de carnet exécutable par public » est couvert globalement par carnet_schema.test.sql
-- (même base) ; ici on vérifie nominativement les privilèges de register_member.
-- Personas (UUID fixes, plage 0…06xx propre à cette fiche) :
--   N 0…060a  compte sans appartenance : inscription nominale, rejeux (critères 2, 3), puis appelant authenticated refusé (critère 1)
--   O 0…060b  membre de other_0006 (projet 0…0602) : rejoint carnet (critère 4) ; son slug sert au rejeu de N (critère 3, suite)
--   P 0…060c  compte sans appartenance, slug déjà pris par N (critère 5)
--   Q 0…060d  compte sans appartenance, slug invalide ou nom trop long (critère 6)
--   R 0…060e  compte sans appartenance, carnet archivé (critère 7)
--   S 0…06fe  compte sans appartenance, p_slug null (cas fermé)
--   X 0…06ff  identifiant absent d'auth.users, jamais inséré (cas fermé)
--   anon      rôle anon, claims sans sub (critère 1)
-- Les appels nominaux se font sous `set local role service_role` (postgres en est membre) avec des claims sans sub,
-- comme le client admin.ts (ADR 0010). Ils passent par lives_ok (savepoint pgTAP : une fonction absente ne fait pas
-- avorter la transaction) et leur valeur de retour est conservée dans une table temporaire (register_member_results)
-- pour être comparée aux lignes écrites et entre rejeux.
-- La bascule de carnet en `archived` modifie la ligne du registre : elle est placée en dernier et annulée par le rollback.
-- Les fixtures sont créées par postgres (bypassrls) dans la transaction et annulées par le rollback final (critère 8).
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(52);

-- ---------------------------------------------------------------------------
-- Critère 1 — déclaratif (décisions 1 et 5)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'register_member', array['uuid', 'text', 'text'], 'critère 1 : carnet.register_member(uuid, text, text) existe');
select function_returns('carnet', 'register_member', array['uuid', 'text', 'text'], 'uuid', 'critère 1 : register_member renvoie uuid');
select function_lang_is('carnet', 'register_member', array['uuid', 'text', 'text'], 'plpgsql', 'critère 1 : register_member est en language plpgsql');
select is_definer('carnet', 'register_member', array['uuid', 'text', 'text'], 'critère 1 : register_member est security definer');
select volatility_is('carnet', 'register_member', array['uuid', 'text', 'text'], 'volatile', 'critère 1 : register_member est volatile');
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'register_member'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 1 : register_member fixe set search_path = '''' (proconfig)'
);
select ok(
  coalesce((
    select bool_and(r.rolbypassrls or r.rolsuper)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
     where n.nspname = 'carnet' and p.proname = 'register_member'
  ), false),
  'critère 1 : le propriétaire de register_member (security definer) contourne la RLS'
);
-- ADR 0010 §2 et §4 : l'identité vient du paramètre p_user_id, jamais du JWT ; sous service_role auth.uid() est nul
-- et is_member()/can_* valent toujours false : la fonction ne doit s'appuyer sur aucun d'eux.
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'register_member'
       and pg_get_functiondef(p.oid) !~* '(auth\.uid\(|carnet\.is_member\(|carnet\.can_|platform\.is_project_member\()'
  ),
  'critère 1 (ADR 0010) : register_member n''appelle ni auth.uid() ni is_member()/is_project_member()/can_* (identité = paramètre)'
);

select function_privs_are('carnet', 'register_member', array['uuid', 'text', 'text'], 'service_role', array['EXECUTE'], 'critère 1 : execute accordé à service_role sur register_member');
select function_privs_are('carnet', 'register_member', array['uuid', 'text', 'text'], 'anon', '{}'::name[], 'critère 1 : execute révoqué pour anon sur register_member');
select function_privs_are('carnet', 'register_member', array['uuid', 'text', 'text'], 'authenticated', '{}'::name[], 'critère 1 : execute révoqué pour authenticated sur register_member');
select function_privs_are('carnet', 'register_member', array['uuid', 'text', 'text'], 'public', '{}'::name[], 'critère 1 : execute révoqué pour public sur register_member');

-- ---------------------------------------------------------------------------
-- Fixtures (postgres) — la ligne carnet du registre vient de la migration 0004 : on lit son id.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000060a', 'n-new-0006@test.local'),
  ('00000000-0000-4000-8000-00000000060b', 'o-other-0006@test.local'),
  ('00000000-0000-4000-8000-00000000060c', 'p-slug-taken-0006@test.local'),
  ('00000000-0000-4000-8000-00000000060d', 'q-invalid-0006@test.local'),
  ('00000000-0000-4000-8000-00000000060e', 'r-archived-0006@test.local'),
  ('00000000-0000-4000-8000-0000000006fe', 's-null-slug-0006@test.local');

insert into platform.projects (id, slug, name, db_schema)
  values ('00000000-0000-4000-8000-000000000602', 'other_0006', 'Other 0006', 'other_0006');

insert into platform.project_members (project_id, user_id, role)
  values ('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-00000000060b', 'user');

-- Valeurs renvoyées par les appels (table créée par postgres, lisible et inscriptible par service_role).
create temp table register_member_results (label text primary key, profile_id uuid);
grant select, insert on register_member_results to service_role;

-- ---------------------------------------------------------------------------
-- Critère 2 — N : compte sans appartenance, appel sous service_role
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into register_member_results (label, profile_id)
    select 'n_first', carnet.register_member('00000000-0000-4000-8000-00000000060a', 'Nina Six', 'nina-0006')$$,
  'critère 2 : service_role appelle register_member pour un compte sans appartenance'
);
reset role;

select isnt(
  (select profile_id from register_member_results where label = 'n_first'),
  null,
  'critère 2 : register_member renvoie un uuid non nul'
);
select results_eq(
  $$select p.slug, pm.role
      from platform.project_members pm
      join platform.projects p on p.id = pm.project_id
     where pm.user_id = '00000000-0000-4000-8000-00000000060a'$$,
  $$values ('carnet'::text, 'user'::text)$$,
  'critère 2 : N a exactement une appartenance, au projet carnet, avec le rôle user'
);
select results_eq(
  $$select owner_id, display_name, slug, is_published, is_indexable
      from carnet.profiles
     where owner_id = '00000000-0000-4000-8000-00000000060a'$$,
  $$values ('00000000-0000-4000-8000-00000000060a'::uuid, 'Nina Six'::text, 'nina-0006'::text, false, false)$$,
  'critère 2 (décision 3) : N a exactement un profil (display_name, slug), non publié et non indexable'
);
select ok(
  exists (
    select 1
      from carnet.profiles p
      join register_member_results r on r.profile_id = p.id
     where p.owner_id = '00000000-0000-4000-8000-00000000060a'
       and r.label = 'n_first'
  ),
  'critère 2 : la valeur renvoyée est l''id du profil créé'
);

-- ---------------------------------------------------------------------------
-- Critère 1 — en situation : ni un membre authentifié (N, pour lui-même) ni anon ne peuvent appeler la fonction
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000060a","role":"authenticated"}';
select throws_ok(
  $$select carnet.register_member('00000000-0000-4000-8000-00000000060a', 'Nina Six', 'nina-0006')$$,
  '42501', null, 'critère 1 : le rôle authenticated (même membre, pour son propre compte) ne peut pas appeler register_member'
);
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select carnet.register_member('00000000-0000-4000-8000-00000000060a', 'Nina Six', 'nina-0006')$$,
  '42501', null, 'critère 1 : le rôle anon ne peut pas appeler register_member'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 3 — N : rejeu avec les mêmes arguments, puis avec des arguments différents (décision 4)
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into register_member_results (label, profile_id)
    select 'n_replay_same', carnet.register_member('00000000-0000-4000-8000-00000000060a', 'Nina Six', 'nina-0006')$$,
  'critère 3 : rejouée avec les mêmes arguments, register_member ne lève pas d''erreur'
);
select lives_ok(
  $$insert into register_member_results (label, profile_id)
    select 'n_replay_other', carnet.register_member('00000000-0000-4000-8000-00000000060a', 'Autre Nom', 'autre-0006')$$,
  'critère 3 : rejouée avec d''autres arguments, register_member ne lève pas d''erreur'
);
reset role;

select is(
  (select count(*)
     from register_member_results r
    where r.label in ('n_first', 'n_replay_same', 'n_replay_other')
      and r.profile_id = (select id from carnet.profiles where owner_id = '00000000-0000-4000-8000-00000000060a')),
  3::bigint,
  'critère 3 : les deux rejeux renvoient le même id que le premier appel (l''id du profil de N)'
);
select is(
  (select count(*) from platform.project_members where user_id = '00000000-0000-4000-8000-00000000060a'),
  1::bigint,
  'critère 3 : N n''a toujours qu''une appartenance après deux rejeux'
);
select is(
  (select count(*) from carnet.profiles where owner_id = '00000000-0000-4000-8000-00000000060a'),
  1::bigint,
  'critère 3 : N n''a toujours qu''un profil après deux rejeux'
);
select results_eq(
  $$select display_name, slug
      from carnet.profiles
     where owner_id = '00000000-0000-4000-8000-00000000060a'$$,
  $$values ('Nina Six'::text, 'nina-0006'::text)$$,
  'critère 3 (décision 4) : le profil de N conserve display_name et slug d''origine (arguments du rejeu ignorés)'
);

-- ---------------------------------------------------------------------------
-- Critère 4 — O : déjà membre d'un autre projet de l'instance
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into register_member_results (label, profile_id)
    select 'o_first', carnet.register_member('00000000-0000-4000-8000-00000000060b', 'Oscar Six', 'oscar-0006')$$,
  'critère 4 : service_role appelle register_member pour un membre d''un autre projet'
);
reset role;

select results_eq(
  $$select p.slug, pm.role
      from platform.project_members pm
      join platform.projects p on p.id = pm.project_id
     where pm.user_id = '00000000-0000-4000-8000-00000000060b'
     order by p.slug$$,
  $$values ('carnet'::text, 'user'::text), ('other_0006'::text, 'user'::text)$$,
  'critère 4 : O a exactement deux appartenances : carnet (ajoutée) et other_0006 (conservée)'
);
select results_eq(
  $$select owner_id, display_name, slug, is_published
      from carnet.profiles
     where owner_id = '00000000-0000-4000-8000-00000000060b'$$,
  $$values ('00000000-0000-4000-8000-00000000060b'::uuid, 'Oscar Six'::text, 'oscar-0006'::text, false)$$,
  'critère 4 : O a exactement un profil, non publié'
);
select ok(
  exists (
    select 1
      from carnet.profiles p
      join register_member_results r on r.profile_id = p.id
     where p.owner_id = '00000000-0000-4000-8000-00000000060b'
       and r.label = 'o_first'
  ),
  'critère 4 : la valeur renvoyée pour O est l''id de son profil'
);

-- ---------------------------------------------------------------------------
-- Critère 3 (suite, décision 4) — N rejouée avec le slug de O : cas réel (rejeu après qu'un autre compte a pris le slug
-- proposé). L'arbitre owner_id est évalué avant profiles_slug_key : aucune erreur, même id, profils de N et O inchangés.
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into register_member_results (label, profile_id)
    select 'n_replay_o_slug', carnet.register_member('00000000-0000-4000-8000-00000000060a', 'Nina Six', 'oscar-0006')$$,
  'critère 3 (décision 4) : N rejouée avec le slug de O ne lève pas d''erreur (owner_id arbitré avant profiles_slug_key)'
);
reset role;

select ok(
  exists (
    select 1
      from carnet.profiles p
      join register_member_results r on r.profile_id = p.id
     where p.owner_id = '00000000-0000-4000-8000-00000000060a'
       and r.label = 'n_replay_o_slug'
  ),
  'critère 3 (décision 4) : N rejouée avec le slug de O renvoie l''id du profil de N'
);
select results_eq(
  $$select owner_id, display_name, slug
      from carnet.profiles
     where slug in ('nina-0006', 'oscar-0006')
     order by slug$$,
  $$values ('00000000-0000-4000-8000-00000000060a'::uuid, 'Nina Six'::text, 'nina-0006'::text),
           ('00000000-0000-4000-8000-00000000060b'::uuid, 'Oscar Six'::text, 'oscar-0006'::text)$$,
  'critère 3 (décision 4) : les profils de N et O sont inchangés après le rejeu de N avec le slug de O'
);

-- ---------------------------------------------------------------------------
-- Critère 5 — P : slug déjà pris par N → 23505 profiles_slug_key, rien d'écrit (décision 2)
-- throws_ok s'exécute sous savepoint : l'état d'avant l'appel est restauré de toute façon ; on vérifie quand même
-- qu'aucune appartenance ni profil n'existe pour P (la fonction entière doit être annulée, pas seulement le second insert).
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
-- P n'a pas de profil (owner_id neuf) : profiles_owner_id_key ne peut pas jouer ; seule profiles_slug_key peut lever 23505.
select throws_ok(
  $$select carnet.register_member('00000000-0000-4000-8000-00000000060c', 'Paula Six', 'nina-0006')$$,
  '23505', null,
  'critère 5 : un slug déjà pris par un autre compte lève 23505 (profiles_slug_key), telle quelle'
);
reset role;

select is(
  (select count(*) from platform.project_members where user_id = '00000000-0000-4000-8000-00000000060c'),
  0::bigint,
  'critère 5 : aucune appartenance n''a été créée pour P (transaction atomique)'
);
select is(
  (select count(*) from carnet.profiles where owner_id = '00000000-0000-4000-8000-00000000060c'),
  0::bigint,
  'critère 5 : aucun profil n''a été créé pour P'
);

-- ---------------------------------------------------------------------------
-- Critère 6 — Q : slug invalide (`ab`, `Abc`) ou nom trop long → 23514, rien d'écrit (décision 2)
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
-- Nom valide (« Quentin Six ») et owner neuf : seule profiles_slug_format_check peut lever 23514
-- pour `ab` (moins de 3 caractères) et `Abc` (majuscule).
select throws_ok(
  $$select carnet.register_member('00000000-0000-4000-8000-00000000060d', 'Quentin Six', 'ab')$$,
  '23514', null,
  'critère 6 : un slug trop court (ab) lève 23514 (profiles_slug_format_check)'
);
select throws_ok(
  $$select carnet.register_member('00000000-0000-4000-8000-00000000060d', 'Quentin Six', 'Abc')$$,
  '23514', null,
  'critère 6 : un slug avec majuscule (Abc) lève 23514 (profiles_slug_format_check)'
);
-- Slug valide et libre (quentin-0006) et owner neuf : seule profiles_display_name_length_check (81 > 80) peut lever 23514.
select throws_ok(
  $$select carnet.register_member('00000000-0000-4000-8000-00000000060d', repeat('q', 81), 'quentin-0006')$$,
  '23514', null,
  'critère 6 : un display_name de 81 caractères lève 23514 (profiles_display_name_length_check)'
);
reset role;

select is(
  (select count(*) from platform.project_members where user_id = '00000000-0000-4000-8000-00000000060d'),
  0::bigint,
  'critère 6 : aucune appartenance n''a été créée pour Q'
);
select is(
  (select count(*) from carnet.profiles where owner_id = '00000000-0000-4000-8000-00000000060d'),
  0::bigint,
  'critère 6 : aucun profil n''a été créé pour Q'
);

-- ---------------------------------------------------------------------------
-- Cas fermés (audit, question 5) — arguments invalides : les contraintes des tables remontent telles quelles, rien d'écrit.
--   p_user_id absent d'auth.users (X, jamais inséré) → 23503 (project_members_user_id_fkey) ;
--   p_user_id null → 23502 (project_members.user_id not null) ;
--   p_slug null (S, compte neuf) → 23502 (profiles.slug not null) après l'insert d'appartenance : la fonction entière est annulée.
-- Placés avant l'archivage de carnet (critère 7), sinon tous lèveraient l'exception « projet non actif ».
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select carnet.register_member('00000000-0000-4000-8000-0000000006ff', 'Inconnu Six', 'inconnu-0006')$$,
  '23503', null, 'cas fermé : un p_user_id absent d''auth.users lève 23503 (clé étrangère de project_members)'
);
select throws_ok(
  $$select carnet.register_member(null, 'Nul Six', 'nul-0006')$$,
  '23502', null, 'cas fermé : un p_user_id null lève 23502 (project_members.user_id not null)'
);
select throws_ok(
  $$select carnet.register_member('00000000-0000-4000-8000-0000000006fe', 'Sam Six', null)$$,
  '23502', null, 'cas fermé : un p_slug null lève 23502 (profiles.slug not null)'
);
reset role;

select is(
  (select count(*) from platform.project_members where user_id = '00000000-0000-4000-8000-0000000006ff'),
  0::bigint,
  'cas fermé : aucune appartenance n''a été créée pour l''identifiant inconnu'
);
select is(
  (select count(*) from carnet.profiles where owner_id = '00000000-0000-4000-8000-0000000006ff'),
  0::bigint,
  'cas fermé : aucun profil n''a été créé pour l''identifiant inconnu'
);
select is(
  (select count(*) from platform.project_members where user_id = '00000000-0000-4000-8000-0000000006fe'),
  0::bigint,
  'cas fermé : aucune appartenance n''a été créée pour S (p_slug null : l''appartenance insérée avant le profil est annulée)'
);
select is(
  (select count(*) from carnet.profiles where owner_id = '00000000-0000-4000-8000-0000000006fe'),
  0::bigint,
  'cas fermé : aucun profil n''a été créé pour S'
);

-- ---------------------------------------------------------------------------
-- Critère 7 — R : projet carnet archivé → exception, rien d'écrit
-- (modifie la ligne du registre, annulée par le rollback ; les appartenances existantes de N et O ne sont pas touchées)
-- ---------------------------------------------------------------------------
update platform.projects set status = 'archived' where slug = 'carnet';

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select carnet.register_member('00000000-0000-4000-8000-00000000060e', 'Rita Six', 'rita-0006')$$,
  'P0001', null, 'critère 7 : register_member lève une exception (raise exception, P0001) quand carnet n''est pas active'
);
reset role;

select is(
  (select count(*) from platform.project_members where user_id = '00000000-0000-4000-8000-00000000060e'),
  0::bigint,
  'critère 7 : aucune appartenance n''a été créée pour R'
);
select is(
  (select count(*) from carnet.profiles where owner_id = '00000000-0000-4000-8000-00000000060e'),
  0::bigint,
  'critère 7 : aucun profil n''a été créé pour R'
);

-- ---------------------------------------------------------------------------
-- État final (critères 2 à 7 et cas fermés) — parmi les comptes de la fiche, seuls N et O sont membres de carnet et ont
-- un profil : les « 0 ligne » de P, Q, R, S et X ci-dessus sont vrais avant implémentation ; ce bloc ne l'est pas.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select pm.user_id
      from platform.project_members pm
      join platform.projects p on p.id = pm.project_id
     where p.slug = 'carnet'
       and pm.user_id in ('00000000-0000-4000-8000-00000000060a', '00000000-0000-4000-8000-00000000060b',
                          '00000000-0000-4000-8000-00000000060c', '00000000-0000-4000-8000-00000000060d',
                          '00000000-0000-4000-8000-00000000060e', '00000000-0000-4000-8000-0000000006fe',
                          '00000000-0000-4000-8000-0000000006ff')
     order by pm.user_id$$,
  $$values ('00000000-0000-4000-8000-00000000060a'::uuid), ('00000000-0000-4000-8000-00000000060b'::uuid)$$,
  'état final : parmi N, O, P, Q, R, S et X, seuls N et O sont membres de carnet'
);
select results_eq(
  $$select owner_id
      from carnet.profiles
     where owner_id in ('00000000-0000-4000-8000-00000000060a', '00000000-0000-4000-8000-00000000060b',
                        '00000000-0000-4000-8000-00000000060c', '00000000-0000-4000-8000-00000000060d',
                        '00000000-0000-4000-8000-00000000060e', '00000000-0000-4000-8000-0000000006fe',
                        '00000000-0000-4000-8000-0000000006ff')
     order by owner_id$$,
  $$values ('00000000-0000-4000-8000-00000000060a'::uuid), ('00000000-0000-4000-8000-00000000060b'::uuid)$$,
  'état final : parmi N, O, P, Q, R, S et X, seuls N et O ont un profil'
);

select * from finish();
rollback;
