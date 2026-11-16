-- Fiche 0005 — table carnet.profiles : comportements par persona et accès public par carnet.get_public_profile en situation.
-- Critères couverts : 4 (RLS et fonctions d'autorisation en situation), 5 amendé B (lecture directe de la vue refusée,
-- accès unitaire carnet.get_public_profile en situation), 6 (rollback final).
-- La structure, les propriétés des fonctions, les politiques déclaratives et les privilèges sont dans
-- carnet_profiles_schema.test.sql.
-- Personas (UUID fixes, plage 0…05xx propre à cette fiche) :
--   A   0…050a  membre (owner) de carnet, propriétaire du profil 0…0510 (slug alice-0005)
--   A2  0…050b  membre (user) de carnet, propriétaire du profil 0…0511 (slug bob-0005)
--   B   0…050c  authentifié sans appartenance ; un profil « orphelin » 0…0512 lui est attribué par postgres
--   C   0…050d  membre de other_0005 (projet 0…0502) ; un profil « orphelin » 0…0513 lui est attribué par postgres
--   anon        rôle anon, claims sans sub
-- Les profils orphelins (propriétaire sans appartenance à carnet) prouvent que les fonctions exigent
-- is_member() et ne se contentent pas de owner_id = auth.uid() (décision 5).
-- Les fixtures sont créées par postgres (bypassrls) dans la transaction et annulées par le rollback final (critère 6).
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(50);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres) — la ligne carnet du registre vient de la migration 0004 : on lit son id.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000050a', 'a-carnet-0005@test.local'),
  ('00000000-0000-4000-8000-00000000050b', 'a2-carnet-0005@test.local'),
  ('00000000-0000-4000-8000-00000000050c', 'b-no-member-0005@test.local'),
  ('00000000-0000-4000-8000-00000000050d', 'c-other-0005@test.local');

insert into platform.projects (id, slug, name, db_schema)
  values ('00000000-0000-4000-8000-000000000502', 'other_0005', 'Other 0005', 'other_0005');

insert into platform.project_members (project_id, user_id, role)
  select id, '00000000-0000-4000-8000-00000000050a', 'owner' from platform.projects where slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  select id, '00000000-0000-4000-8000-00000000050b', 'user' from platform.projects where slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  values ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-00000000050d', 'user');

-- ---------------------------------------------------------------------------
-- Critère 4 — A : membre de carnet, propriétaire
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000050a","role":"authenticated"}';

select lives_ok(
  $$insert into carnet.profiles (id, owner_id, slug, display_name, contact_email)
    values ('00000000-0000-4000-8000-000000000510', '00000000-0000-4000-8000-00000000050a', 'alice-0005', 'Alice', 'alice-0005@example.test')$$,
  'critère 4 : un membre crée son profil'
);
select results_eq(
  $$select slug from carnet.profiles$$,
  $$values ('alice-0005'::text)$$,
  'critère 4 : un membre relit son profil'
);
-- Décision 2 : un seul profil par utilisateur ; le slug diffère pour que seule profiles_owner_id_key puisse jouer.
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name)
    values ('00000000-0000-4000-8000-00000000050a', 'alice-bis-0005', 'Alice bis')$$,
  '23505', null,
  'critère 4 (décision 2) : un second profil pour le même propriétaire est refusé par profiles_owner_id_key'
);
with updated as (
  update carnet.profiles set display_name = 'Alice B.' where id = '00000000-0000-4000-8000-000000000510' returning 1
)
select is(count(*), 1::bigint, 'critère 4 : un membre modifie son profil (1 ligne affectée)') from updated;

-- Céder le profil : la ligne est visible par A (using can_edit_profile vrai), donc c'est le with check
-- can_create_profile(owner_id = A2) qui échoue et lève 42501. « 0 ligne » signifierait que le using a filtré
-- la ligne, ce qui n'est pas le cas pour le propriétaire : on attend donc l'erreur, pas un update silencieux.
select throws_ok(
  $$update carnet.profiles set owner_id = '00000000-0000-4000-8000-00000000050b'
     where id = '00000000-0000-4000-8000-000000000510'$$,
  '42501', null, 'critère 4 (décision 6) : un membre ne peut pas céder son profil (update owner_id → 42501 par le with check)'
);

-- Fonctions d'autorisation appelées directement (décision 5)
select is(carnet.can_edit_profile('00000000-0000-4000-8000-000000000510'), true, 'critère 4 (décision 5) : can_edit_profile est vrai pour le propriétaire membre');
select is(carnet.can_read_profile_private('00000000-0000-4000-8000-000000000510'), true, 'critère 4 (décision 5) : can_read_profile_private est vrai pour le propriétaire membre');
select is(carnet.can_create_profile('00000000-0000-4000-8000-00000000050a'), true, 'critère 4 (décision 5) : can_create_profile est vrai pour soi-même quand on est membre');
select is(carnet.can_edit_profile('00000000-0000-4000-8000-0000000005ff'), false, 'critère 4 (décision 5) : can_edit_profile est faux (jamais null) pour un profil inexistant');
select is(carnet.can_create_profile('00000000-0000-4000-8000-00000000050b'), false, 'critère 4 (décision 5) : can_create_profile est faux pour un autre owner_id que soi');
reset role;

-- ---------------------------------------------------------------------------
-- Critère 4 — A2 : membre de carnet, autre utilisateur du même projet
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000050b","role":"authenticated"}';

select is_empty(
  $$select * from carnet.profiles$$,
  'critère 4 : un autre membre du même projet ne voit pas le profil non publié de A'
);
with updated as (
  update carnet.profiles set display_name = 'Hacked' where id = '00000000-0000-4000-8000-000000000510' returning 1
)
select is(count(*), 0::bigint, 'critère 4 : un autre membre ne modifie pas le profil de A (0 ligne affectée)') from updated;
with deleted as (
  delete from carnet.profiles where id = '00000000-0000-4000-8000-000000000510' returning 1
)
select is(count(*), 0::bigint, 'critère 4 : un autre membre ne supprime pas le profil de A (0 ligne affectée)') from deleted;
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name)
    values ('00000000-0000-4000-8000-00000000050a', 'intruder-0005', 'Intruder')$$,
  '42501', null, 'critère 4 : un autre membre ne peut pas insérer un profil au nom de A'
);
select lives_ok(
  $$insert into carnet.profiles (id, owner_id, slug, display_name)
    values ('00000000-0000-4000-8000-000000000511', '00000000-0000-4000-8000-00000000050b', 'bob-0005', 'Bob')$$,
  'critère 4 : un autre membre crée son propre profil'
);
select results_eq(
  $$select slug from carnet.profiles$$,
  $$values ('bob-0005'::text)$$,
  'critère 4 : un autre membre ne voit que son propre profil'
);
select is(carnet.can_edit_profile('00000000-0000-4000-8000-000000000510'), false, 'critère 4 (décision 5) : can_edit_profile est faux pour un autre membre du projet');
select is(carnet.can_read_profile_private('00000000-0000-4000-8000-000000000510'), false, 'critère 4 (décision 5) : can_read_profile_private est faux pour un autre membre du projet');
select is(carnet.can_create_profile('00000000-0000-4000-8000-00000000050a'), false, 'critère 4 (décision 5) : can_create_profile est faux pour le compte d''un autre membre');
reset role;

-- Contrôle postgres : les tentatives de A (céder) et de A2 (modifier) n'ont rien changé.
select results_eq(
  $$select owner_id, display_name from carnet.profiles where id = '00000000-0000-4000-8000-000000000510'$$,
  $$values ('00000000-0000-4000-8000-00000000050a'::uuid, 'Alice B.'::text)$$,
  'critère 4 : le profil de A conserve son propriétaire et le display_name posé par A'
);

-- Profils orphelins : attribués par postgres à des comptes sans appartenance à carnet.
select lives_ok(
  $$insert into carnet.profiles (id, owner_id, slug, display_name)
    values ('00000000-0000-4000-8000-000000000512', '00000000-0000-4000-8000-00000000050c', 'bea-0005', 'Bea')$$,
  'critère 4 (précondition) : postgres attribue un profil à B, compte sans appartenance'
);
select lives_ok(
  $$insert into carnet.profiles (id, owner_id, slug, display_name)
    values ('00000000-0000-4000-8000-000000000513', '00000000-0000-4000-8000-00000000050d', 'carl-0005', 'Carl')$$,
  'critère 4 (précondition) : postgres attribue un profil à C, membre d''un autre projet'
);

-- ---------------------------------------------------------------------------
-- Critère 4 — B : authentifié sans appartenance (même propriétaire d'un profil, il n'accède à rien)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000050c","role":"authenticated"}';

select is_empty(
  $$select * from carnet.profiles$$,
  'critère 4 : un compte sans appartenance ne voit aucune ligne, pas même un profil à son nom'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name)
    values ('00000000-0000-4000-8000-00000000050c', 'bea-bis-0005', 'Bea bis')$$,
  '42501', null, 'critère 4 : un compte sans appartenance ne peut pas insérer de profil (RLS avant la contrainte d''unicité)'
);
with updated as (
  update carnet.profiles set display_name = 'Hacked' where id = '00000000-0000-4000-8000-000000000512' returning 1
)
select is(count(*), 0::bigint, 'critère 4 : un compte sans appartenance ne modifie pas un profil à son nom (0 ligne)') from updated;
with deleted as (
  delete from carnet.profiles where id = '00000000-0000-4000-8000-000000000512' returning 1
)
select is(count(*), 0::bigint, 'critère 4 : un compte sans appartenance ne supprime pas un profil à son nom (0 ligne)') from deleted;
select is(carnet.can_edit_profile('00000000-0000-4000-8000-000000000512'), false, 'critère 4 (décision 5) : can_edit_profile est faux pour un propriétaire sans appartenance à carnet');
reset role;

-- ---------------------------------------------------------------------------
-- Critère 4 — C : membre d'un autre projet de l'instance
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000050d","role":"authenticated"}';

select is_empty(
  $$select * from carnet.profiles$$,
  'critère 4 : un membre d''un autre projet ne voit aucune ligne, pas même un profil à son nom'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name)
    values ('00000000-0000-4000-8000-00000000050d', 'carl-bis-0005', 'Carl bis')$$,
  '42501', null, 'critère 4 : un membre d''un autre projet ne peut pas insérer de profil'
);
with updated as (
  update carnet.profiles set display_name = 'Hacked' where id = '00000000-0000-4000-8000-000000000513' returning 1
)
select is(count(*), 0::bigint, 'critère 4 : un membre d''un autre projet ne modifie pas un profil à son nom (0 ligne)') from updated;
with deleted as (
  delete from carnet.profiles where id = '00000000-0000-4000-8000-000000000513' returning 1
)
select is(count(*), 0::bigint, 'critère 4 : un membre d''un autre projet ne supprime pas un profil à son nom (0 ligne)') from deleted;
select is(carnet.can_edit_profile('00000000-0000-4000-8000-000000000513'), false, 'critère 4 (décision 5) : can_edit_profile est faux pour un propriétaire membre d''un autre projet');
reset role;

-- ---------------------------------------------------------------------------
-- Critère 4 — anonyme : aucun privilège sur la table ni sur les fonctions
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$select * from carnet.profiles$$,
  '42501', null, 'critère 4 : anon ne lit rien dans profiles'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name)
    values ('00000000-0000-4000-8000-00000000050a', 'anon-0005', 'Anon')$$,
  '42501', null, 'critère 4 : anon ne peut pas insérer dans profiles'
);
select throws_ok(
  $$select carnet.can_create_profile('00000000-0000-4000-8000-00000000050a')$$,
  '42501', null, 'critère 4 : anon ne peut pas appeler carnet.can_create_profile'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 5 (amendement B) — lecture directe de la vue refusée ; accès unitaire par carnet.get_public_profile(slug)
-- ---------------------------------------------------------------------------
-- Aucun profil publié : la fonction ne renvoie rien, sans erreur ; la vue n'est pas lisible directement.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select * from carnet.public_profiles$$,
  '42501', null, 'critère 5 (amendement B) : anon ne lit pas la vue public_profiles directement'
);
select lives_ok(
  $$select * from carnet.get_public_profile('inconnu-0005')$$,
  'critère 5 : get_public_profile ne lève jamais d''erreur pour un slug inconnu'
);
select is_empty(
  $$select slug from carnet.get_public_profile('inconnu-0005')$$,
  'critère 5 : get_public_profile renvoie zéro ligne pour un slug inconnu'
);
select is_empty(
  $$select slug from carnet.get_public_profile('alice-0005')$$,
  'critère 5 : anon n''obtient pas le profil de A tant qu''il n''est pas publié'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000050b","role":"authenticated"}';
select throws_ok(
  $$select * from carnet.public_profiles$$,
  '42501', null, 'critère 5 (amendement B) : un autre membre ne lit pas la vue public_profiles directement'
);
select is_empty(
  $$select slug from carnet.get_public_profile('alice-0005')$$,
  'critère 5 : un autre membre n''obtient pas le profil de A tant qu''il n''est pas publié'
);
reset role;

-- A publie lui-même son profil (update sous RLS) ; ceux de A2, B et C restent non publiés.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000050a","role":"authenticated"}';
with published as (
  update carnet.profiles set is_published = true where id = '00000000-0000-4000-8000-000000000510' returning 1
)
select is(count(*), 1::bigint, 'critère 5 : le propriétaire publie son profil par un update sous RLS (1 ligne affectée)') from published;
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select results_eq(
  $$select slug, display_name, contact_email from carnet.get_public_profile('alice-0005')$$,
  $$values ('alice-0005'::text, 'Alice B.'::text, 'alice-0005@example.test'::text)$$,
  'critère 5 : anon obtient exactement une ligne pour le profil publié de A, contact_email inclus (donnée publique, garde-fou = accès unitaire)'
);
select throws_ok(
  $$select owner_id from carnet.get_public_profile('alice-0005')$$,
  '42703', null, 'critère 5 : la ligne renvoyée par get_public_profile n''expose pas owner_id'
);
select is_empty(
  $$select slug from carnet.get_public_profile('bob-0005')$$,
  'critère 5 : anon n''obtient pas le profil non publié de A2 par son slug'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000050b","role":"authenticated"}';
select results_eq(
  $$select slug from carnet.get_public_profile('alice-0005')$$,
  $$values ('alice-0005'::text)$$,
  'critère 5 : un autre membre obtient exactement le profil publié de A par la fonction'
);
select results_eq(
  $$select slug from carnet.profiles$$,
  $$values ('bob-0005'::text)$$,
  'critère 5 : la publication n''ouvre pas la table profiles à un autre membre (toujours son seul profil)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 4 — A supprime son profil ; il n'est plus renvoyé par get_public_profile
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000050a","role":"authenticated"}';
with deleted as (
  delete from carnet.profiles where id = '00000000-0000-4000-8000-000000000510' returning 1
)
select is(count(*), 1::bigint, 'critère 4 : un membre supprime son profil (1 ligne affectée)') from deleted;
reset role;

select is(
  (select count(*) from carnet.profiles where id = '00000000-0000-4000-8000-000000000510'),
  0::bigint,
  'critère 4 : le profil supprimé par A n''existe plus (contrôle postgres)'
);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is_empty(
  $$select slug from carnet.get_public_profile('alice-0005')$$,
  'critère 5 : le profil supprimé n''est plus renvoyé par get_public_profile'
);
reset role;

select * from finish();
rollback;
