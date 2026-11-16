-- Fiche 0022 — carnet.profiles : droit update par colonne, contraintes de format, register_member inchangé.
-- Critères couverts : 1 (privilèges par colonne, déclaratif et en situation), 2 (contraintes nommées, refus 23514 et
-- valeurs acceptées), 3 (register_member fonctionnel et soumis aux nouvelles contraintes).
-- Le critère 4 (double application de la migration) est prouvé par db-architect.
-- Contrat (noms exacts attendus de la migration) :
--   profiles_website_url_format_check  sur website_url : ^https://, ASCII imprimable, hôte [A-Za-z0-9.-]+, port facultatif
--   profiles_text_charset_check        sur display_name, job_title, company, contact_email, phone (liste de
--                                      links_label_charset_check) et bio (même liste, \n et \r autorisés)
--   profiles_phone_format_check        sur phone : ^\+?[0-9 .()-]+$
--   profiles_display_name_blank_check  sur display_name : au moins un caractère non blanc
--   Toutes validées (convalidated) après `validate constraint`.
-- Les messages attendus sont ceux de la locale du serveur local (anglais), comme carnet_links_schema.test.sql.
-- Ordre d'évaluation des check : alphabétique (documentation PostgreSQL) ; chaque cas refusé est construit pour qu'une
-- seule contrainte puisse jouer, sauf le téléphone avec caractère invisible (deux contraintes, SQLSTATE seul).
-- Insert direct par authenticated (décision 6, Hery 16/11/2026) : retiré (privilège et politique profiles_insert_own) ;
-- tout insert direct sous authenticated → 42501 quelles que soient les colonnes ; la création passe par register_member.
-- Delete direct par authenticated (décision 8, Hery 16/11/2026) : retiré (privilège et politique profiles_delete_own) ;
-- delete de son propre profil sous authenticated → 42501 ; la suppression de compte passera par un cas d'usage dédié.
-- Personas (UUID fixes, plage 0…22xx propre à cette fiche) :
--   A  0…220a  membre (user) de carnet, propriétaire du profil 0…2210 (slug alice-0022), créé par postgres
--   I  0…220b  membre (user) de carnet sans profil (insert direct refusé)
--   C  0…220d  membre de other_0022 (projet 0…2202), profil orphelin 0…2213 (slug carl-0022)
--   N  0…220e  compte sans appartenance, inscription nominale par register_member
--   Q  0…220f  compte sans appartenance, inscriptions refusées par les nouvelles contraintes
-- Fixtures créées par postgres (bypassrls) dans la transaction, annulées par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(108);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000220a', 'a-carnet-0022@test.local'),
  ('00000000-0000-4000-8000-00000000220b', 'i-carnet-0022@test.local'),
  ('00000000-0000-4000-8000-00000000220d', 'c-other-0022@test.local'),
  ('00000000-0000-4000-8000-00000000220e', 'n-new-0022@test.local'),
  ('00000000-0000-4000-8000-00000000220f', 'q-invalid-0022@test.local');

insert into platform.projects (id, slug, name, db_schema)
  values ('00000000-0000-4000-8000-000000002202', 'other_0022', 'Other 0022', 'other_0022');

insert into platform.project_members (project_id, user_id, role)
  select id, '00000000-0000-4000-8000-00000000220a', 'user' from platform.projects where slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  select id, '00000000-0000-4000-8000-00000000220b', 'user' from platform.projects where slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  values ('00000000-0000-4000-8000-000000002202', '00000000-0000-4000-8000-00000000220d', 'user');

-- Horodatages anciens posés à l'insert (le trigger ne joue qu'à l'update) : prouvent que le trigger pose updated_at.
insert into carnet.profiles (id, owner_id, slug, display_name, created_at, updated_at) values
  ('00000000-0000-4000-8000-000000002210', '00000000-0000-4000-8000-00000000220a', 'alice-0022', 'Alice',
   '2020-01-01 00:00:00+00', '2020-01-01 00:00:00+00'),
  ('00000000-0000-4000-8000-000000002213', '00000000-0000-4000-8000-00000000220d', 'carl-0022', 'Carl',
   '2020-01-01 00:00:00+00', '2020-01-01 00:00:00+00');

-- ---------------------------------------------------------------------------
-- Critère 1 — déclaratif : update par colonne (décision 1)
-- ---------------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'carnet.profiles', 'UPDATE'),
  'critère 1 (décision 1) : authenticated n''a plus le privilège update sur toute la table profiles'
);
select ok(
  has_column_privilege('authenticated', 'carnet.profiles', 'display_name', 'UPDATE')
  and has_column_privilege('authenticated', 'carnet.profiles', 'job_title', 'UPDATE')
  and has_column_privilege('authenticated', 'carnet.profiles', 'company', 'UPDATE')
  and has_column_privilege('authenticated', 'carnet.profiles', 'bio', 'UPDATE')
  and has_column_privilege('authenticated', 'carnet.profiles', 'contact_email', 'UPDATE')
  and has_column_privilege('authenticated', 'carnet.profiles', 'phone', 'UPDATE')
  and has_column_privilege('authenticated', 'carnet.profiles', 'website_url', 'UPDATE')
  and has_column_privilege('authenticated', 'carnet.profiles', 'is_published', 'UPDATE')
  and has_column_privilege('authenticated', 'carnet.profiles', 'is_indexable', 'UPDATE'),
  'critère 1 (décision 1) : authenticated a update sur les 9 colonnes éditables'
);
select is(
  (select array_agg(a.attname::text order by a.attname)
     from pg_attribute a
    where a.attrelid = 'carnet.profiles'::regclass
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'carnet.profiles', a.attname, 'UPDATE')),
  array['bio', 'company', 'contact_email', 'display_name', 'is_indexable', 'is_published', 'job_title', 'phone', 'website_url'],
  'critère 1 (décision 1) : authenticated a update sur exactement les 9 colonnes éditables, aucune autre'
);
select ok(
  has_table_privilege('service_role', 'carnet.profiles', 'UPDATE'),
  'critère 1 (décision 1) : service_role conserve update sur toute la table profiles'
);
select ok(
  not has_column_privilege('anon', 'carnet.profiles', 'display_name', 'UPDATE'),
  'critère 1 (décision 1) : anon n''obtient aucun update de colonne sur profiles'
);

-- ---------------------------------------------------------------------------
-- Critère 1 — A sur son propre profil : colonnes éditables acceptées
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000220a","role":"authenticated"}';

select lives_ok(
  $$update carnet.profiles set display_name = 'Alice B.' where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 1 : update de display_name accepté sur son profil'
);
reset role;
select ok(
  (select updated_at > '2020-01-02 00:00:00+00' and created_at = '2020-01-01 00:00:00+00'
     from carnet.profiles where id = '00000000-0000-4000-8000-000000002210'),
  'critère 1 (décision 1) : updated_at reste posé par le trigger, created_at inchangé'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000220a","role":"authenticated"}';

select lives_ok(
  $$update carnet.profiles set job_title = 'Ingénieure' where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 1 : update de job_title accepté sur son profil'
);
select lives_ok(
  $$update carnet.profiles set company = 'Société Générale' where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 1 : update de company accepté sur son profil'
);
select lives_ok(
  $$update carnet.profiles set bio = 'Bio de test' where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 1 : update de bio accepté sur son profil'
);
select lives_ok(
  $$update carnet.profiles set contact_email = 'alice-0022@example.test' where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 1 : update de contact_email accepté sur son profil'
);
select lives_ok(
  $$update carnet.profiles set phone = '+33 6 12 34 56 78' where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 1 : update de phone accepté sur son profil'
);
select lives_ok(
  $$update carnet.profiles set website_url = 'https://alice.example.test' where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 1 : update de website_url accepté sur son profil'
);
select lives_ok(
  $$update carnet.profiles set is_published = true where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 1 : update de is_published accepté sur son profil'
);
select lives_ok(
  $$update carnet.profiles set is_indexable = true where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 1 : update de is_indexable accepté sur son profil'
);
-- Forme d'un PATCH PostgREST complet (cas d'usage update-profile) : les 9 colonnes en une requête.
with updated as (
  update carnet.profiles
     set display_name = 'Alice', job_title = 'Ingénieure', company = 'Société Générale', bio = 'Bio de test',
         contact_email = 'alice-0022@example.test', phone = '+33 6 12 34 56 78',
         website_url = 'https://alice.example.test', is_published = false, is_indexable = false
   where id = '00000000-0000-4000-8000-000000002210'
  returning 1
)
select is(count(*), 1::bigint, 'critère 1 : update des 9 colonnes éditables en une requête accepté (1 ligne affectée)') from updated;
reset role;

select results_eq(
  $$select display_name, job_title, company, bio, contact_email, phone, website_url, is_published, is_indexable
      from carnet.profiles where id = '00000000-0000-4000-8000-000000002210'$$,
  $$values ('Alice'::text, 'Ingénieure'::text, 'Société Générale'::text, 'Bio de test'::text,
            'alice-0022@example.test'::text, '+33 6 12 34 56 78'::text, 'https://alice.example.test'::text, false, false)$$,
  'critère 1 : les colonnes éditables portent les valeurs écrites par A (contrôle postgres)'
);

-- ---------------------------------------------------------------------------
-- Critère 1 — A sur son propre profil : colonnes hors périmètre → 42501
-- Chaque valeur passerait la RLS et les contraintes existantes : seul le privilège de colonne peut refuser.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000220a","role":"authenticated"}';

select throws_ok(
  $$update carnet.profiles set slug = 'alice-bis-0022' where id = '00000000-0000-4000-8000-000000002210'$$,
  '42501', null, 'critère 1 : update de slug refusé sur son profil (42501)'
);
select throws_ok(
  $$update carnet.profiles set slug = 'admin' where id = '00000000-0000-4000-8000-000000002210'$$,
  '42501', null, 'critère 1 : update de slug vers un slug réservé refusé sur son profil (42501)'
);
select throws_ok(
  $$update carnet.profiles set owner_id = '00000000-0000-4000-8000-00000000220a' where id = '00000000-0000-4000-8000-000000002210'$$,
  '42501', null, 'critère 1 : update de owner_id (même vers soi-même, with check satisfait) refusé sur son profil (42501)'
);
select throws_ok(
  $$update carnet.profiles set theme = '{"primary":"#112233"}'::jsonb where id = '00000000-0000-4000-8000-000000002210'$$,
  '42501', null, 'critère 1 : update de theme refusé sur son profil (42501)'
);
select throws_ok(
  $$update carnet.profiles set avatar_url = 'https://cdn.example.test/a.png' where id = '00000000-0000-4000-8000-000000002210'$$,
  '42501', null, 'critère 1 : update de avatar_url refusé sur son profil (42501)'
);
select throws_ok(
  $$update carnet.profiles set banner_url = 'https://cdn.example.test/b.png' where id = '00000000-0000-4000-8000-000000002210'$$,
  '42501', null, 'critère 1 : update de banner_url refusé sur son profil (42501)'
);
select throws_ok(
  $$update carnet.profiles set id = '00000000-0000-4000-8000-000000002210' where id = '00000000-0000-4000-8000-000000002210'$$,
  '42501', null, 'critère 1 (décision 1) : update de id refusé sur son profil (42501)'
);
select throws_ok(
  $$update carnet.profiles set created_at = '2021-01-01 00:00:00+00' where id = '00000000-0000-4000-8000-000000002210'$$,
  '42501', null, 'critère 1 (décision 1) : update de created_at refusé sur son profil (42501)'
);
select throws_ok(
  $$update carnet.profiles set updated_at = '2021-01-01 00:00:00+00' where id = '00000000-0000-4000-8000-000000002210'$$,
  '42501', null, 'critère 1 (décision 1) : update de updated_at refusé sur son profil (42501)'
);
select throws_ok(
  $$update carnet.profiles set display_name = 'Alice', slug = 'alice-ter-0022' where id = '00000000-0000-4000-8000-000000002210'$$,
  '42501', null, 'critère 1 : un update mêlant une colonne éditable et slug est refusé en entier (42501)'
);
reset role;

select results_eq(
  $$select slug, owner_id, theme, avatar_url, banner_url, created_at
      from carnet.profiles where id = '00000000-0000-4000-8000-000000002210'$$,
  $$values ('alice-0022'::text, '00000000-0000-4000-8000-00000000220a'::uuid, '{}'::jsonb, null::text, null::text,
            '2020-01-01 00:00:00+00'::timestamptz)$$,
  'critère 1 : slug, owner_id, theme, avatar_url, banner_url et created_at de A sont inchangés (contrôle postgres)'
);

-- Membre d'un autre projet, même propriétaire d'une ligne : le privilège refuse avant la RLS.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000220d","role":"authenticated"}';
select throws_ok(
  $$update carnet.profiles set slug = 'carl-bis-0022' where id = '00000000-0000-4000-8000-000000002213'$$,
  '42501', null, 'critère 1 : un membre d''un autre projet ne peut pas modifier le slug d''un profil à son nom (42501)'
);
reset role;
select is(
  (select slug from carnet.profiles where id = '00000000-0000-4000-8000-000000002213'),
  'carl-0022',
  'critère 1 : le slug du profil orphelin de C est inchangé (contrôle postgres)'
);

-- ---------------------------------------------------------------------------
-- Décision 6 — insert direct par authenticated retiré : déclaratif puis en situation (I, membre sans profil)
-- ---------------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'carnet.profiles', 'INSERT'),
  'décision 6 : authenticated n''a plus le privilège insert sur la table profiles'
);
select ok(
  not has_any_column_privilege('authenticated', 'carnet.profiles', 'INSERT'),
  'décision 6 : authenticated n''a le privilège insert sur aucune colonne de profiles'
);
select ok(
  not exists (
    select 1 from pg_policy p
     where p.polrelid = 'carnet.profiles'::regclass
       and (p.polname = 'profiles_insert_own' or p.polcmd in ('a', '*'))
  ),
  'décision 6 : la politique profiles_insert_own est supprimée et aucune politique insert ne la remplace'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000220b","role":"authenticated"}';
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name)
    values ('00000000-0000-4000-8000-00000000220b', 'ines-0022', 'Inès')$$,
  '42501', null, 'décision 6 : un membre ne peut pas créer directement un profil minimal (owner_id, slug, display_name) (42501)'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, job_title, company, bio, contact_email, phone, website_url, is_published, is_indexable)
    values ('00000000-0000-4000-8000-00000000220b', 'ines-0022', 'Inès', 'CEO', 'Acme', 'Bio', 'ines@example.test',
            '+33 6 12 34 56 78', 'https://ines.example.test', false, false)$$,
  '42501', null, 'décision 6 : un membre ne peut pas créer directement un profil avec les seules colonnes éditables et slug (42501)'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, avatar_url)
    values ('00000000-0000-4000-8000-00000000220b', 'ines-0022', 'Inès', 'https://cdn.example.test/a.png')$$,
  '42501', null, 'décision 6 : un membre ne peut pas créer directement un profil avec avatar_url (42501)'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, banner_url)
    values ('00000000-0000-4000-8000-00000000220b', 'ines-0022', 'Inès', 'https://cdn.example.test/b.png')$$,
  '42501', null, 'décision 6 : un membre ne peut pas créer directement un profil avec banner_url (42501)'
);
select throws_ok(
  $$insert into carnet.profiles (owner_id, slug, display_name, theme)
    values ('00000000-0000-4000-8000-00000000220b', 'ines-0022', 'Inès', '{"primary":"#112233"}'::jsonb)$$,
  '42501', null, 'décision 6 : un membre ne peut pas créer directement un profil avec theme (42501)'
);
reset role;
select is(
  (select count(*) from carnet.profiles where owner_id = '00000000-0000-4000-8000-00000000220b'),
  0::bigint,
  'décision 6 : aucun profil n''a été créé pour I par insert direct (contrôle postgres)'
);

-- ---------------------------------------------------------------------------
-- Décision 8 — delete direct par authenticated retiré : déclaratif puis en situation (A, sur son propre profil)
-- ---------------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'carnet.profiles', 'DELETE'),
  'décision 8 : authenticated n''a plus le privilège delete sur la table profiles'
);
select ok(
  not exists (
    select 1 from pg_policy p
     where p.polrelid = 'carnet.profiles'::regclass
       and (p.polname = 'profiles_delete_own' or p.polcmd in ('d', '*'))
  ),
  'décision 8 : la politique profiles_delete_own est supprimée et aucune politique delete ne la remplace'
);
select ok(
  has_table_privilege('service_role', 'carnet.profiles', 'DELETE'),
  'décision 8 : service_role conserve le privilège delete sur profiles (futur cas d''usage de suppression de compte)'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000220a","role":"authenticated"}';
select throws_ok(
  $$delete from carnet.profiles where id = '00000000-0000-4000-8000-000000002210'$$,
  '42501', null, 'décision 8 : un membre ne peut pas supprimer directement son propre profil (42501)'
);
reset role;
select is(
  (select count(*) from carnet.profiles where id = '00000000-0000-4000-8000-000000002210'),
  1::bigint,
  'décision 8 : le profil de A existe toujours après la tentative de suppression directe (contrôle postgres)'
);

-- ---------------------------------------------------------------------------
-- Critère 2 — déclaratif : contraintes nommées, sur les bonnes colonnes, validées (décisions 3 et 4)
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(a.attname::text order by a.attname)
     from pg_constraint k
     join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
    where k.conrelid = 'carnet.profiles'::regclass
      and k.conname = 'profiles_website_url_format_check' and k.contype = 'c' and k.convalidated),
  array['website_url'],
  'critère 2 (décision 3) : la contrainte check validée profiles_website_url_format_check porte sur website_url'
);
select is(
  (select array_agg(a.attname::text order by a.attname)
     from pg_constraint k
     join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
    where k.conrelid = 'carnet.profiles'::regclass
      and k.conname = 'profiles_text_charset_check' and k.contype = 'c' and k.convalidated),
  array['bio', 'company', 'contact_email', 'display_name', 'job_title', 'phone'],
  'critère 2 (décision 3) : la contrainte check validée profiles_text_charset_check porte sur display_name, job_title, company, bio, contact_email, phone'
);
select is(
  (select array_agg(a.attname::text order by a.attname)
     from pg_constraint k
     join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
    where k.conrelid = 'carnet.profiles'::regclass
      and k.conname = 'profiles_phone_format_check' and k.contype = 'c' and k.convalidated),
  array['phone'],
  'critère 2 (décision 3) : la contrainte check validée profiles_phone_format_check porte sur phone'
);
select is(
  (select array_agg(a.attname::text order by a.attname)
     from pg_constraint k
     join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
    where k.conrelid = 'carnet.profiles'::regclass
      and k.conname = 'profiles_display_name_blank_check' and k.contype = 'c' and k.convalidated),
  array['display_name'],
  'critère 2 (décision 3) : la contrainte check validée profiles_display_name_blank_check porte sur display_name'
);

-- ---------------------------------------------------------------------------
-- Critère 2 — en comportement, par A sur son profil (chemin PostgREST réel)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000220a","role":"authenticated"}';

-- website_url
select throws_ok(
  $$update carnet.profiles set website_url = 'http://alice.example.test' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_website_url_format_check"',
  'critère 2 : website_url en http: est refusée (profiles_website_url_format_check)'
);
select throws_ok(
  $$update carnet.profiles set website_url = 'javascript:alert(1)' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_website_url_format_check"',
  'critère 2 : website_url en javascript: est refusée (profiles_website_url_format_check)'
);
select throws_ok(
  $$update carnet.profiles set website_url = 'data:text/html,<script>alert(1)</script>' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_website_url_format_check"',
  'critère 2 : website_url en data: est refusée (profiles_website_url_format_check)'
);
select throws_ok(
  $$update carnet.profiles set website_url = 'https://user:pass@alice.example.test' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_website_url_format_check"',
  'critère 2 : website_url avec identifiants (user:pass@) est refusée (profiles_website_url_format_check)'
);
select throws_ok(
  $$update carnet.profiles set website_url = 'https://linkedin.com@evil.test' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_website_url_format_check"',
  'critère 2 : website_url avec information utilisateur (linkedin.com@evil.test) est refusée (profiles_website_url_format_check)'
);
select throws_ok(
  $$update carnet.profiles set website_url = 'https://exämple.test' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_website_url_format_check"',
  'critère 2 : website_url avec hôte non ASCII est refusée (profiles_website_url_format_check)'
);
select throws_ok(
  $$update carnet.profiles set website_url = 'https://alice.example.test/café' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_website_url_format_check"',
  'critère 2 : website_url avec chemin non ASCII est refusée (profiles_website_url_format_check)'
);
select throws_ok(
  $$update carnet.profiles set website_url = 'https://alice.example.test/a b' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_website_url_format_check"',
  'critère 2 : website_url contenant une espace est refusée (profiles_website_url_format_check)'
);
select throws_ok(
  $$update carnet.profiles set website_url = E'https://alice.example.test/\u0007' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_website_url_format_check"',
  'critère 2 : website_url contenant un caractère de contrôle est refusée (profiles_website_url_format_check)'
);
select throws_ok(
  $$update carnet.profiles set website_url = 'https://' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_website_url_format_check"',
  'critère 2 : website_url sans hôte est refusée (profiles_website_url_format_check)'
);
select throws_ok(
  $$update carnet.profiles set website_url = 'https://alice.example.test:abc/' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_website_url_format_check"',
  'critère 2 : website_url avec port non numérique est refusée (profiles_website_url_format_check)'
);
select throws_ok(
  $$update carnet.profiles set website_url = 'https://\evil.test' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_website_url_format_check"',
  'critère 2 : website_url avec barre oblique inverse dans l''hôte est refusée (profiles_website_url_format_check)'
);
select lives_ok(
  $$update carnet.profiles set website_url = 'https://Alice.example.test:8443/a/b?x=1&y=%C3%A9#p2' where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 2 : website_url https avec port, chemin, requête, encodage % et fragment est acceptée'
);
select lives_ok(
  $$update carnet.profiles set website_url = 'https://xn--exmple-cua.test/' where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 2 : website_url avec hôte punycode est acceptée'
);
select lives_ok(
  $$update carnet.profiles set website_url = null where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 2 : website_url null est acceptée'
);

-- phone
select throws_ok(
  $$update carnet.profiles set phone = '+33 6 12 34 AB' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_phone_format_check"',
  'critère 2 : téléphone avec lettres refusé (profiles_phone_format_check)'
);
select throws_ok(
  $$update carnet.profiles set phone = '++33 6 12 34 56' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_phone_format_check"',
  'critère 2 : téléphone avec deux « + » refusé (profiles_phone_format_check)'
);
select throws_ok(
  $$update carnet.profiles set phone = '06 12 34 56 78 +' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_phone_format_check"',
  'critère 2 : téléphone avec « + » ailleurs qu''en tête refusé (profiles_phone_format_check)'
);
select throws_ok(
  $$update carnet.profiles set phone = '' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_phone_format_check"',
  'critère 2 : téléphone vide refusé (profiles_phone_format_check)'
);
-- Deux contraintes refusent ce cas (format et jeu de caractères) : SQLSTATE seul.
select throws_ok(
  $$update carnet.profiles set phone = E'06 12\u200B34 56 78' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', null,
  'critère 2 : téléphone avec caractère invisible (U+200B) refusé (23514)'
);
select lives_ok(
  $$update carnet.profiles set phone = '+33 (0)6 12-34.56.78' where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 2 : téléphone avec +, parenthèses, tirets, points et espaces accepté'
);
select lives_ok(
  $$update carnet.profiles set phone = null where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 2 : téléphone null accepté'
);

-- display_name : blanc
select throws_ok(
  $$update carnet.profiles set display_name = '   ' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_display_name_blank_check"',
  'critère 2 : nom fait seulement d''espaces refusé (profiles_display_name_blank_check)'
);
select throws_ok(
  $$update carnet.profiles set display_name = '' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_display_name_blank_check"',
  'critère 2 : nom vide refusé (profiles_display_name_blank_check)'
);

-- Textes : contrôle, bidirectionnel, invisible (une seule contrainte peut jouer : valeurs non blanches, courtes)
select throws_ok(
  $$update carnet.profiles set display_name = E'Alice\u0007' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : display_name avec caractère de contrôle (U+0007) refusé (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set display_name = E'Alice\u202Eecila' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : display_name avec caractère bidirectionnel (U+202E) refusé (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set display_name = E'Ali\u200Bce' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : display_name avec caractère invisible (U+200B) refusé (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set display_name = E'Alice\nBob' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : display_name avec saut de ligne refusé (seule la bio les autorise) (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set job_title = E'CEO\u001B' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : job_title avec caractère de contrôle (U+001B) refusé (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set job_title = E'CEO\u2066x' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : job_title avec caractère bidirectionnel (U+2066) refusé (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set job_title = E'CE\u00ADO' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : job_title avec caractère invisible (U+00AD) refusé (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set company = E'Acme\u007F' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : company avec caractère de contrôle (U+007F) refusé (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set company = E'Acme\u200F' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : company avec caractère bidirectionnel (U+200F) refusé (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set company = E'\uFEFFAcme' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : company avec caractère invisible (U+FEFF) refusé (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set contact_email = E'alice@example.test\u0085' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : contact_email avec caractère de contrôle C1 (U+0085) refusé (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set contact_email = E'alice\u061C@example.test' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : contact_email avec caractère bidirectionnel (U+061C) refusé (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set contact_email = E'alice\u2060@example.test' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : contact_email avec caractère invisible (U+2060) refusé (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set bio = E'Bio\tavec tabulation' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : bio avec caractère de contrôle (tabulation U+0009) refusée (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set bio = E'Bio\u000Bverticale' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : bio avec tabulation verticale (U+000B, voisine de \n) refusée (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set bio = E'Bio\u000Cpage' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : bio avec saut de page (U+000C, entre \n et \r) refusée (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set bio = E'Bio\u202Dx' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : bio avec caractère bidirectionnel (U+202D) refusée (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set bio = E'Bio\u2028suite' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : bio avec séparateur de ligne Unicode (U+2028) refusée (profiles_text_charset_check)'
);
select throws_ok(
  $$update carnet.profiles set bio = E'Bio\u180Ex' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 2 : bio avec caractère invisible (U+180E) refusée (profiles_text_charset_check)'
);

-- Valeurs valides acceptées
select lives_ok(
  $$update carnet.profiles set display_name = 'Élodie Müller-Ñúñez' where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 2 : display_name accentué accepté'
);
select lives_ok(
  $$update carnet.profiles set display_name = E'Élodie \U0001F469\u200D\U0001F4BB' where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 2 : display_name avec émoji composé (ZWJ U+200D) accepté'
);
select lives_ok(
  $$update carnet.profiles set job_title = 'Ingénieure en chef', company = 'Société d''Études & Co.' where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 2 : job_title et company accentués et ponctués acceptés'
);
select lives_ok(
  $$update carnet.profiles set contact_email = 'élodie+carte@example.test' where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 2 : contact_email avec caractère accentué accepté (pas de validation de format en base)'
);
select lives_ok(
  $$update carnet.profiles
       set bio = E'Première ligne\nDeuxième ligne\r\nTroisième : café, naïveté \U0001F468\u200D\U0001F469\u200D\U0001F467 et \U0001F44B\U0001F3FD'
     where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 2 : bio avec accents, sauts de ligne (\n, \r\n) et émojis composés (ZWJ, modificateur de teinte) acceptée'
);
select lives_ok(
  $$update carnet.profiles set bio = E'\u0645\u0631\u062D\u0628\u0627 \u05E9\u05DC\u05D5\u05DD 你好 \u200C' where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 2 : bio en arabe, hébreu et chinois (sans marque de direction) et U+200C acceptée'
);
select lives_ok(
  $$update carnet.profiles set job_title = null, company = null, bio = null, contact_email = null where id = '00000000-0000-4000-8000-000000002210'$$,
  'critère 2 : job_title, company, bio et contact_email null acceptés'
);
reset role;

select results_eq(
  $$select display_name, job_title, company, bio, contact_email, phone, website_url
      from carnet.profiles where id = '00000000-0000-4000-8000-000000002210'$$,
  $$values (E'Élodie \U0001F469\u200D\U0001F4BB'::text, null::text, null::text, null::text, null::text, null::text, null::text)$$,
  'critère 2 : le profil de A porte les dernières valeurs valides, aucune valeur refusée n''a été écrite (contrôle postgres)'
);

-- service_role (client admin) est soumis aux mêmes contraintes : elles valent pour tout chemin d'écriture.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$update carnet.profiles set website_url = 'http://alice.example.test' where id = '00000000-0000-4000-8000-000000002210'$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_website_url_format_check"',
  'critère 2 : service_role est aussi soumis à profiles_website_url_format_check'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 3 — register_member (security definer, service_role) reste fonctionnel
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select carnet.register_member('00000000-0000-4000-8000-00000000220e', 'Nöémie Ñúñez', 'noemie-0022')$$,
  'critère 3 : register_member inscrit un compte neuf avec un nom accentué'
);
select lives_ok(
  $$select carnet.register_member('00000000-0000-4000-8000-00000000220e', 'Nöémie Ñúñez', 'noemie-0022')$$,
  'critère 3 : register_member rejoué pour le même compte ne lève pas d''erreur'
);
reset role;

select results_eq(
  $$select owner_id, slug, display_name, is_published
      from carnet.profiles where owner_id = '00000000-0000-4000-8000-00000000220e'$$,
  $$values ('00000000-0000-4000-8000-00000000220e'::uuid, 'noemie-0022'::text, 'Nöémie Ñúñez'::text, false)$$,
  'critère 3 : register_member pose le slug initial et le nom ; un seul profil après rejeu'
);
select is(
  (select count(*) from platform.project_members pm join platform.projects p on p.id = pm.project_id
    where pm.user_id = '00000000-0000-4000-8000-00000000220e' and p.slug = 'carnet'),
  1::bigint,
  'critère 3 : register_member crée une seule appartenance à carnet après rejeu'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select carnet.register_member('00000000-0000-4000-8000-00000000220f', '   ', 'quentin-0022')$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_display_name_blank_check"',
  'critère 3 : register_member avec un nom fait seulement d''espaces lève 23514 (profiles_display_name_blank_check)'
);
select throws_ok(
  $$select carnet.register_member('00000000-0000-4000-8000-00000000220f', E'Quentin\u202E', 'quentin-0022')$$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_text_charset_check"',
  'critère 3 : register_member avec un nom contenant U+202E lève 23514 (profiles_text_charset_check)'
);
reset role;

select is(
  (select count(*) from carnet.profiles where owner_id = '00000000-0000-4000-8000-00000000220f'),
  0::bigint,
  'critère 3 : aucun profil écrit pour Q après les refus'
);
select is(
  (select count(*) from platform.project_members where user_id = '00000000-0000-4000-8000-00000000220f'),
  0::bigint,
  'critère 3 : aucune appartenance orpheline écrite pour Q après les refus (transaction de la fonction annulée)'
);

select * from finish();
rollback;
