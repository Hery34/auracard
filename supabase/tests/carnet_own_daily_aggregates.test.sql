-- Fiche 0030, décision 8 (amendée par Hery le 18/11/2026 après seconde revue et audit) — lecture des agrégats du
-- propriétaire : carnet.get_own_daily_aggregates(p_profile_id uuid, p_from date, p_to date).
-- Critères couverts : 1 (lignes de la plage, bornes incluses, aucune troncature) et 2 (aucun accès aux chiffres d'un
-- autre profil, ni par un autre membre carnet, ni par un compte d'un autre projet, ni par anon).
-- Contrat figé pour db-architect :
--   carnet.get_own_daily_aggregates(p_profile_id uuid, p_from date, p_to date) returns jsonb (une seule valeur, pas
--     de setof) : stable, security invoker (RLS analytics_daily_select_own inchangée, gardée comme garde),
--     set search_path = '' ; paramètres nommés p_profile_id, p_from, p_to ; une seule surcharge (l'ancienne
--     (date, date) n'existe plus). execute à authenticated seul (ni public, ni anon, ni service_role).
--     Renvoie un tableau jsonb des lignes de carnet.analytics_daily visibles par l'appelant (RLS) dont
--     profile_id = p_profile_id et day ∈ [p_from, p_to] (index analytics_daily_bucket_key) ; id d'un profil d'autrui,
--     inconnu, ou JWT sans sub → '[]' ;
--     chaque élément a exactement les clés day ("YYYY-MM-DD"), metric, link_id (null possible), source (null possible),
--     value (nombre). Aucune ligne → '[]'::jsonb, jamais null. Ordre non imposé.
--     22023 : p_profile_id nul, p_from ou p_to nul, p_from > p_to, plage de plus de 400 jours (366 jours inclus, 12 mois bissextiles,
--     acceptés ; p_to − p_from = 401 refusé ; la borne exacte de 400 n'est pas figée ici).
-- Personas (UUID fixes, plage 0…30xx propre à ce fichier) :
--   A 0…300a membre carnet, profil 0…3010 : 6 lignes autour du 10–14 novembre 2026, plus 150 lignes en janvier–février 2026
--   B 0…300b membre carnet, profil 0…3011 sans aucun agrégat
--   C 0…300c membre carnet, profil 0…3012 avec des agrégats aux mêmes jours que A
--   X 0…300d membre du projet other_0030 seul, sans profil
--   O 0…300e membre du projet other_0030 seul, propriétaire du profil 0…3013 avec des agrégats (appartenance carnet perdue)
-- Preuve d'usage de l'index : compteurs de la transaction (pg_stat_get_xact_numscans / pg_stat_get_xact_tuples_returned)
-- de analytics_daily_bucket_key autour d'un appel réel de la fonction, sous enable_seqscan = off (sur une table de
-- quelques centaines de lignes le planificateur choisirait un seq scan, ce qui ne dit rien du prédicat). Un EXPLAIN
-- d'une requête recopiée ne prouverait que l'existence de l'index, pas la requête de la fonction ; ici, seul un
-- prédicat profile_id = p_profile_id and day between … placé en condition d'index renvoie exactement les 4 entrées
-- de A dans la plage (un filtre sur day seul en renverrait aussi celles de C et de O). C'est le premier appel du
-- script, pour qu'aucun plan générique mis en cache (seq scan) ne soit réutilisé.
-- Les dates sont fixes : la fonction ne lit pas l'horloge. Les appels passent par lives_ok / throws_ok, pour que
-- l'absence de la fonction produise des échecs et non un abandon du script. Tout est annulé par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(67);

create temp table reads (label text primary key, v jsonb);
grant select, insert on reads to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000300a', 'a-carnet-0030@test.local'),
  ('00000000-0000-4000-8000-00000000300b', 'b-carnet-0030@test.local'),
  ('00000000-0000-4000-8000-00000000300c', 'c-carnet-0030@test.local'),
  ('00000000-0000-4000-8000-00000000300d', 'x-other-0030@test.local'),
  ('00000000-0000-4000-8000-00000000300e', 'o-former-0030@test.local');

insert into platform.projects (id, slug, name, db_schema, status) values
  ('00000000-0000-4000-8000-000000003002', 'other_0030', 'Other 0030', 'other_0030', 'active');

insert into platform.project_members (project_id, user_id, role)
  select p.id, u.id, 'user'
    from platform.projects p
   cross join (values ('00000000-0000-4000-8000-00000000300a'::uuid), ('00000000-0000-4000-8000-00000000300b'::uuid),
                      ('00000000-0000-4000-8000-00000000300c'::uuid)) as u (id)
   where p.slug = 'carnet';
insert into platform.project_members (project_id, user_id, role) values
  ('00000000-0000-4000-8000-000000003002', '00000000-0000-4000-8000-00000000300d', 'user'),
  ('00000000-0000-4000-8000-000000003002', '00000000-0000-4000-8000-00000000300e', 'user');

insert into carnet.profiles (id, owner_id, slug, display_name, is_published) values
  ('00000000-0000-4000-8000-000000003010', '00000000-0000-4000-8000-00000000300a', 'ada-0030', 'Ada', true),
  ('00000000-0000-4000-8000-000000003011', '00000000-0000-4000-8000-00000000300b', 'bea-0030', 'Bea', true),
  ('00000000-0000-4000-8000-000000003012', '00000000-0000-4000-8000-00000000300c', 'cyd-0030', 'Cyd', true),
  ('00000000-0000-4000-8000-000000003013', '00000000-0000-4000-8000-00000000300e', 'oto-0030', 'Oto', true);

-- A : 9 et 15 novembre hors plage [10, 14] ; 10 et 14 sur les bornes ; un clic de lien supprimé (uuid sans lien).
insert into carnet.analytics_daily (profile_id, day, metric, link_id, source, value) values
  ('00000000-0000-4000-8000-000000003010', '2026-11-09', 'profile_view', null, 'direct', 100),
  ('00000000-0000-4000-8000-000000003010', '2026-11-10', 'profile_view', null, 'nfc', 3),
  ('00000000-0000-4000-8000-000000003010', '2026-11-12', 'link_click', '00000000-0000-4000-8000-0000000030f0', 'qr', 2),
  ('00000000-0000-4000-8000-000000003010', '2026-11-12', 'contact_click', null, 'direct', 1),
  ('00000000-0000-4000-8000-000000003010', '2026-11-14', 'nfc_scan', null, 'nfc', 4),
  ('00000000-0000-4000-8000-000000003010', '2026-11-15', 'profile_view', null, 'direct', 200);

-- A : 150 lignes du 1er janvier au 19 février 2026 (50 jours × 3 sources).
insert into carnet.analytics_daily (profile_id, day, metric, link_id, source, value)
  select '00000000-0000-4000-8000-000000003010', d::date, 'profile_view', null, s, 1
    from generate_series(date '2026-01-01', date '2026-02-19', interval '1 day') as d
   cross join (values ('nfc'), ('qr'), ('direct')) as src (s);

insert into carnet.analytics_daily (profile_id, day, metric, link_id, source, value) values
  ('00000000-0000-4000-8000-000000003012', '2026-11-10', 'profile_view', null, 'nfc', 7),
  ('00000000-0000-4000-8000-000000003012', '2026-11-12', 'vcard_download', null, 'direct', 7),
  ('00000000-0000-4000-8000-000000003013', '2026-11-11', 'profile_view', null, 'qr', 9);

-- ---------------------------------------------------------------------------
-- Décision 8 — la requête filtrée utilise analytics_daily_bucket_key (premier appel du script)
-- ---------------------------------------------------------------------------
create temp table index_stats (label text primary key, scans bigint, tuples bigint);
grant select, insert on index_stats to authenticated;

set local enable_seqscan = off;
insert into index_stats
  select 'before', pg_stat_get_xact_numscans('carnet.analytics_daily_bucket_key'::regclass),
         pg_stat_get_xact_tuples_returned('carnet.analytics_daily_bucket_key'::regclass);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000300a","role":"authenticated"}';
select lives_ok(
  $$insert into reads
      select 'a_plan', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2026-11-10', '2026-11-14')$$,
  'décision 8 : A lit ses agrégats du 10 au 14 novembre (seq scan désactivé) sans erreur'
);
reset role;
insert into index_stats
  select 'after', pg_stat_get_xact_numscans('carnet.analytics_daily_bucket_key'::regclass),
         pg_stat_get_xact_tuples_returned('carnet.analytics_daily_bucket_key'::regclass);
set local enable_seqscan = on;

select cmp_ok(
  (select a.scans - b.scans from index_stats a, index_stats b where a.label = 'after' and b.label = 'before'),
  '>=', 1::bigint,
  'décision 8 : l''appel parcourt l''index analytics_daily_bucket_key'
);
select is(
  (select a.tuples - b.tuples from index_stats a, index_stats b where a.label = 'after' and b.label = 'before'),
  4::bigint,
  'décision 8 : profile_id et day sont conditions d''index — seules les 4 entrées de A dans la plage sont lues (ni C, ni O, ni le reste de A)'
);
select is(
  (select jsonb_array_length(v) from reads where label = 'a_plan'),
  4,
  'décision 8 : la lecture sous enable_seqscan = off rend les 4 lignes de A'
);

-- ---------------------------------------------------------------------------
-- Décision 8 — propriétés de la fonction
-- ---------------------------------------------------------------------------
select has_function('carnet', 'get_own_daily_aggregates', array['uuid', 'date', 'date'],
  'décision 8 : carnet.get_own_daily_aggregates(uuid, date, date) existe');
select hasnt_function('carnet', 'get_own_daily_aggregates', array['date', 'date'],
  'décision 8 : l''ancienne signature carnet.get_own_daily_aggregates(date, date) n''existe plus');
select function_returns('carnet', 'get_own_daily_aggregates', array['uuid', 'date', 'date'], 'jsonb',
  'décision 8 : get_own_daily_aggregates renvoie jsonb');
select ok(
  coalesce((select not p.proretset from pg_proc p
             where p.oid = to_regprocedure('carnet.get_own_daily_aggregates(uuid, date, date)')), false),
  'décision 8 : get_own_daily_aggregates renvoie une seule valeur (pas setof), non concernée par max_rows'
);
select isnt_definer('carnet', 'get_own_daily_aggregates', array['uuid', 'date', 'date'],
  'décision 8 : get_own_daily_aggregates est security invoker (RLS de analytics_daily appliquée)');
select volatility_is('carnet', 'get_own_daily_aggregates', array['uuid', 'date', 'date'], 'stable',
  'décision 8 : get_own_daily_aggregates est stable');
select ok(
  exists (select 1 from pg_proc p
           where p.oid = to_regprocedure('carnet.get_own_daily_aggregates(uuid, date, date)')
             and p.proconfig @> array['search_path=""']
             and p.proargnames = array['p_profile_id', 'p_from', 'p_to']),
  'décision 8 : get_own_daily_aggregates fixe search_path = '''' et nomme ses paramètres p_profile_id, p_from, p_to'
);
select is(
  (select count(*) from pg_proc p where p.proname = 'get_own_daily_aggregates'),
  1::bigint,
  'décision 8 : une seule surcharge de get_own_daily_aggregates sur l''instance (dans carnet)'
);

select function_privs_are('carnet', 'get_own_daily_aggregates', array['uuid', 'date', 'date'], 'authenticated', array['EXECUTE'],
  'décision 8 : authenticated peut exécuter get_own_daily_aggregates');
select function_privs_are('carnet', 'get_own_daily_aggregates', array['uuid', 'date', 'date'], 'anon', '{}'::name[],
  'décision 8 : anon ne peut pas exécuter get_own_daily_aggregates');
select function_privs_are('carnet', 'get_own_daily_aggregates', array['uuid', 'date', 'date'], 'public', '{}'::name[],
  'décision 8 : public ne peut pas exécuter get_own_daily_aggregates');
select function_privs_are('carnet', 'get_own_daily_aggregates', array['uuid', 'date', 'date'], 'service_role', '{}'::name[],
  'décision 8 : service_role ne peut pas exécuter get_own_daily_aggregates (jamais service_role pour la lecture)');

-- ---------------------------------------------------------------------------
-- Critère 2 — anon et service_role refusés
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2026-11-10', '2026-11-14')$$,
  '42501', null,
  'critère 2 : anon ne peut pas appeler get_own_daily_aggregates (42501)'
);
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2026-11-10', '2026-11-14')$$,
  '42501', null,
  'décision 8 : service_role ne peut pas appeler get_own_daily_aggregates (42501)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 1 — lectures du propriétaire A
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000300a","role":"authenticated"}';
select lives_ok(
  $$insert into reads
      select 'a_range', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2026-11-10', '2026-11-14')$$,
  'critère 1 : A lit ses agrégats du 10 au 14 novembre avec l''id de son profil sans erreur'
);
select lives_ok(
  $$insert into reads
      select 'a_single_day', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2026-11-12', '2026-11-12')$$,
  'critère 1 : A lit une plage d''un seul jour (p_from = p_to) sans erreur'
);
select lives_ok(
  $$insert into reads
      select 'a_empty', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2026-06-01', '2026-06-30')$$,
  'critère 3 : A lit une plage sans donnée sans erreur'
);
select lives_ok(
  $$insert into reads
      select 'a_many', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2026-01-01', '2026-02-19')$$,
  'décision 8 : A lit 150 lignes en un seul appel sans erreur'
);
select lives_ok(
  $$insert into reads
      select 'a_leap_year', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2027-03-01', '2028-02-29')$$,
  'décision 8 : une plage de 366 jours (12 mois d''une année bissextile) est acceptée'
);
select lives_ok(
  $$insert into reads
      select 'a_with_c_id', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003012', '2026-11-10', '2026-11-14')$$,
  'critère 2 : A appelle avec l''id du profil de C sans erreur'
);
select lives_ok(
  $$insert into reads
      select 'a_with_o_id', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003013', '2026-01-01', '2026-11-30')$$,
  'critère 2 : A appelle avec l''id du profil de O sans erreur'
);
select lives_ok(
  $$insert into reads
      select 'a_with_unknown_id', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-0000000030ff', '2026-01-01', '2026-11-30')$$,
  'critère 2 : A appelle avec l''id d''un profil inexistant sans erreur'
);
select throws_ok(
  $$select carnet.get_own_daily_aggregates(null, '2026-11-10', '2026-11-14')$$,
  '22023', null,
  'décision 8 : p_profile_id nul → 22023'
);
select throws_ok(
  $$select carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2026-11-14', '2026-11-10')$$,
  '22023', null,
  'décision 8 : p_from > p_to → 22023'
);
select throws_ok(
  $$select carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2025-01-01', '2026-02-06')$$,
  '22023', null,
  'décision 8 : plage de plus de 400 jours (p_to − p_from = 401) → 22023'
);
select throws_ok(
  $$select carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2020-01-01', '2026-11-18')$$,
  '22023', null,
  'décision 8 : plage de plusieurs années → 22023'
);
select throws_ok(
  $$select carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', null, '2026-11-14')$$,
  '22023', null,
  'décision 8 : p_from nul → 22023'
);
select throws_ok(
  $$select carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2026-11-10', null)$$,
  '22023', null,
  'décision 8 : p_to nul → 22023'
);
select throws_ok(
  $$select carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', null, null)$$,
  '22023', null,
  'décision 8 : p_from et p_to nuls → 22023'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 2 — B (autre membre carnet), C (autre membre avec données), X et O (autre projet), JWT sans sub
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000300b","role":"authenticated"}';
select lives_ok(
  $$insert into reads
      select 'b_own', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003011', '2026-01-01', '2026-11-30')$$,
  'critère 2 : B (membre carnet sans agrégat) lit son propre profil sans erreur'
);
select lives_ok(
  $$insert into reads
      select 'b_with_a_id', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2026-01-01', '2026-11-30')$$,
  'critère 2 : B appelle avec l''id du profil de A sans erreur'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000300c","role":"authenticated"}';
select lives_ok(
  $$insert into reads
      select 'c_own', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003012', '2026-11-10', '2026-11-14')$$,
  'critère 2 : C (membre carnet avec agrégats) lit son propre profil sans erreur'
);
select lives_ok(
  $$insert into reads
      select 'c_with_a_id', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2026-11-10', '2026-11-14')$$,
  'critère 2 : C appelle avec l''id du profil de A sans erreur'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000300d","role":"authenticated"}';
select lives_ok(
  $$insert into reads
      select 'x_with_a_id', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2026-01-01', '2026-11-30')$$,
  'critère 2 : X (autre projet) appelle avec l''id du profil de A sans erreur'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000300e","role":"authenticated"}';
select lives_ok(
  $$insert into reads
      select 'o_own', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003013', '2026-01-01', '2026-11-30')$$,
  'critère 2 : O (autre projet, ancien propriétaire) appelle avec l''id de son ancien profil sans erreur'
);
select lives_ok(
  $$insert into reads
      select 'o_with_a_id', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2026-01-01', '2026-11-30')$$,
  'critère 2 : O appelle avec l''id du profil de A sans erreur'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select lives_ok(
  $$insert into reads
      select 'no_sub_with_a_id', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2026-01-01', '2026-11-30')$$,
  'critère 2 : un JWT authenticated sans sub appelle avec l''id du profil de A sans erreur'
);
reset role;

-- ---------------------------------------------------------------------------
-- Vérifications (postgres)
-- ---------------------------------------------------------------------------
select is(
  (select jsonb_typeof(v) from reads where label = 'a_range'),
  'array',
  'décision 8 : le résultat est un tableau jsonb'
);
select set_eq(
  $$select r.day, r.metric, r.link_id, r.source, r.value
      from reads, jsonb_to_recordset(reads.v) as r (day date, metric text, link_id uuid, source text, value integer)
     where reads.label = 'a_range'$$,
  $$values ('2026-11-10'::date, 'profile_view', null::uuid, 'nfc', 3),
           ('2026-11-12'::date, 'link_click', '00000000-0000-4000-8000-0000000030f0'::uuid, 'qr', 2),
           ('2026-11-12'::date, 'contact_click', null::uuid, 'direct', 1),
           ('2026-11-14'::date, 'nfc_scan', null::uuid, 'nfc', 4)$$,
  'critère 1 : A reçoit exactement ses lignes du 10 au 14 novembre, bornes incluses (ni le 9, ni le 15, ni C, ni O)'
);
select is(
  (select jsonb_array_length(v) from reads where label = 'a_range'),
  4,
  'critère 1 : A reçoit 4 éléments, sans doublon'
);
select ok(
  coalesce((select bool_and(array(select jsonb_object_keys(e) order by 1) = array['day', 'link_id', 'metric', 'source', 'value'])
              from reads, jsonb_array_elements(reads.v) as e
             where reads.label = 'a_range'), false),
  'décision 8 : chaque élément a exactement les clés day, metric, link_id, source, value (link_id et source présents même nuls)'
);
select ok(
  coalesce((select bool_and(e ->> 'day' ~ '^\d{4}-\d{2}-\d{2}$' and jsonb_typeof(e -> 'value') = 'number')
              from reads, jsonb_array_elements(reads.v) as e
             where reads.label = 'a_range'), false),
  'décision 8 : day est au format YYYY-MM-DD et value est un nombre'
);
select is(
  (select count(*) from reads, jsonb_array_elements(reads.v) as e
    where reads.label = 'a_range' and jsonb_typeof(e -> 'link_id') = 'null'),
  3::bigint,
  'décision 8 : link_id nul est rendu par null (trois lignes sans lien)'
);
select is(
  (select jsonb_array_length(v) from reads where label = 'a_single_day'),
  2,
  'critère 1 : p_from = p_to → les deux lignes du 12 novembre'
);
select is(
  (select v from reads where label = 'a_empty'),
  '[]'::jsonb,
  'critère 3 : plage sans donnée → [] (pas null)'
);
select is(
  (select jsonb_array_length(v) from reads where label = 'a_many'),
  150,
  'décision 8 : plus de 100 lignes (150) renvoyées en une seule valeur'
);
select is(
  (select sum((e ->> 'value')::integer) from reads, jsonb_array_elements(reads.v) as e where reads.label = 'a_many'),
  150::bigint,
  'décision 8 : la somme des 150 lignes est intacte'
);
select is(
  (select v from reads where label = 'a_leap_year'),
  '[]'::jsonb,
  'décision 8 : plage de 366 jours sans donnée → []'
);
select is(
  (select v from reads where label = 'a_with_c_id'),
  '[]'::jsonb,
  'critère 2 : A, propriétaire, avec l''id du profil de C (données aux mêmes jours) → [] (RLS)'
);
select is(
  (select v from reads where label = 'a_with_o_id'),
  '[]'::jsonb,
  'critère 2 : A avec l''id du profil de O → [] (RLS)'
);
select is(
  (select v from reads where label = 'a_with_unknown_id'),
  '[]'::jsonb,
  'critère 2 : A avec l''id d''un profil inexistant → []'
);
select is(
  (select v from reads where label = 'b_own'),
  '[]'::jsonb,
  'critère 2 : B, sans agrégat, reçoit [] pour son propre profil'
);
select is(
  (select v from reads where label = 'b_with_a_id'),
  '[]'::jsonb,
  'critère 2 : B, autre membre carnet, avec l''id du profil de A → [] (RLS)'
);
select set_eq(
  $$select r.day, r.metric, r.value
      from reads, jsonb_to_recordset(reads.v) as r (day date, metric text, value integer)
     where reads.label = 'c_own'$$,
  $$values ('2026-11-10'::date, 'profile_view', 7), ('2026-11-12'::date, 'vcard_download', 7)$$,
  'critère 2 : C reçoit ses seules lignes, jamais celles de A aux mêmes jours'
);
select is(
  (select v from reads where label = 'c_with_a_id'),
  '[]'::jsonb,
  'critère 2 : C, membre carnet avec données, avec l''id du profil de A → [] (RLS)'
);
select is(
  (select v from reads where label = 'x_with_a_id'),
  '[]'::jsonb,
  'critère 2 : X, compte d''un autre projet, avec l''id du profil de A → []'
);
select is(
  (select v from reads where label = 'o_own'),
  '[]'::jsonb,
  'critère 2 : O, autre projet, avec l''id de son ancien profil carnet → [] (appartenance carnet exigée)'
);
select is(
  (select v from reads where label = 'o_with_a_id'),
  '[]'::jsonb,
  'critère 2 : O, autre projet, avec l''id du profil de A → []'
);
select is(
  (select v from reads where label = 'no_sub_with_a_id'),
  '[]'::jsonb,
  'critère 2 : JWT authenticated sans sub, avec l''id du profil de A → []'
);

-- ---------------------------------------------------------------------------
-- Décision 8 — RLS inchangée, aucune écriture, rejeu
-- ---------------------------------------------------------------------------
select policies_are('carnet', 'analytics_daily', array['analytics_daily_select_own'],
  'décision 8 : analytics_daily garde la seule politique analytics_daily_select_own');
select is(
  (select count(*) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000003010'),
  156::bigint,
  'décision 8 : les lectures n''ont rien écrit ni supprimé (156 lignes pour A)'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000300a","role":"authenticated"}';
select lives_ok(
  $$insert into reads
      select 'a_range_again', carnet.get_own_daily_aggregates('00000000-0000-4000-8000-000000003010', '2026-11-10', '2026-11-14')$$,
  'critère 1 : A relit la même plage sans erreur'
);
reset role;
select ok(
  coalesce((select (select jsonb_agg(e order by e::text) from jsonb_array_elements(v) e) from reads where label = 'a_range_again')
         = (select (select jsonb_agg(e order by e::text) from jsonb_array_elements(v) e) from reads where label = 'a_range'), false),
  'critère 1 : relue deux fois, la même plage donne les mêmes lignes'
);

select * from finish();
rollback;
