-- Fiche 0036 / ADR 0016 — isolation (RLS) des 4 tables du module de rendez-vous et lectures publiques
-- (get_public_booking_page, get_public_busy_ranges) ; booking_tokens sans accès direct ; fonctions service_role
-- (get_booking_by_token, claim_booking_outbox) refusées à anon et authenticated.
-- Critères couverts : 4 (aucune donnée visiteur lisible publiquement ; un autre propriétaire, un membre sans profil
-- ou un compte d'un autre projet ne lit ni ne modifie rien ; anon n'a aucun accès direct), décision 6 (lectures
-- publiques par fonctions jsonb bornées à 62 jours, au-delà de 100 éléments sans troncature), point 18 (fenêtre de
-- get_public_busy_ranges dans [now() − 1 jour, now() + 1440 h + 1 jour], sinon 22023 ; update par colonne : id,
-- profile_id et created_at non modifiables, 42501).
-- Contrat : voir l'en-tête de carnet_bookings_schema.test.sql.
-- Personas (UUID fixes, plage 0036 2xxx propre à ce fichier) :
--   A 0…a membre carnet, profil PA 0…10 publié (ana-0036a), Europe/Paris : types e0 (actif, 30 min, tampon 15,
--     video, lien de visio en location_text), e1 (actif, 60 min, in_person, adresse publique), e2 (inactif) ; 3 règles ; exceptions
--     busy et extra ; réservations bA1 (confirmée, e0), bA2 (annulée), bA3 (confirmée, e1)
--   B 0…b membre carnet, profil PB 0…11 publié (ben-0036a), Asia/Tokyo : type e3, règle, réservation bB1,
--     120 exceptions busy (preuve au-delà de 100 éléments)
--   U 0…c membre carnet, profil PU 0…12 non publié (uma-0036a) : type e4
--   C 0…d membre du projet other_0036a seul, propriétaire du profil PC 0…13 publié (cyd-0036a) : type e5, règle,
--     exception, réservation bC1
--   N 0…e membre carnet sans profil
-- Dates : pg_temp.at décale le jeu autour de now() (fenêtre publique, point 18).
-- Lectures via pg_temp.txt / pg_temp.rows (null si l'objet n'existe pas encore) ; fixtures par lives_ok. Tout est
-- annulé par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(114);

create function pg_temp.txt(p_sql text) returns text
language plpgsql as $$
declare
  v text;
begin
  execute p_sql into v;
  return v;
exception when undefined_table or undefined_function or undefined_column or invalid_schema_name or undefined_object then
  return null;
end
$$;

-- Nombre de lignes touchées par une instruction exécutée avec les droits de l'appelant (RLS du rôle courant).
create function pg_temp.rows(p_sql text) returns bigint
language plpgsql as $$
declare
  n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
exception when undefined_table or undefined_function or undefined_column or invalid_schema_name or undefined_object then
  return null;
end
$$;

-- Point 18 : la fenêtre publique est bornée autour de now() ; les dates du jeu sont décalées en bloc
-- (2027-03-01 00:00Z ↦ minuit UTC du jour courant), bornes à la minute, écarts entre dates conservés.
create function pg_temp.at(p text) returns timestamptz language sql stable as $$
  select date_trunc('day', now(), 'UTC') + (p::timestamptz - '2027-03-01 00:00Z'::timestamptz)
$$;

create temp table reads (label text primary key, v jsonb);
grant select, insert on reads to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00362000000a', 'a-carnet-0036a@test.local'),
  ('00000000-0000-4000-8000-00362000000b', 'b-carnet-0036a@test.local'),
  ('00000000-0000-4000-8000-00362000000c', 'u-carnet-0036a@test.local'),
  ('00000000-0000-4000-8000-00362000000d', 'c-other-0036a@test.local'),
  ('00000000-0000-4000-8000-00362000000e', 'n-carnet-0036a@test.local');

insert into platform.projects (id, slug, name, db_schema)
  values ('00000000-0000-4000-8000-003620000002', 'other_0036a', 'Other 0036a', 'other_0036a');

insert into platform.project_members (project_id, user_id, role)
  select p.id, u.id, 'user'
    from platform.projects p
   cross join (values ('00000000-0000-4000-8000-00362000000a'::uuid), ('00000000-0000-4000-8000-00362000000b'::uuid),
                      ('00000000-0000-4000-8000-00362000000c'::uuid), ('00000000-0000-4000-8000-00362000000e'::uuid)) as u (id)
   where p.slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  values ('00000000-0000-4000-8000-003620000002', '00000000-0000-4000-8000-00362000000d', 'user');

insert into carnet.profiles (id, owner_id, slug, display_name, is_published) values
  ('00000000-0000-4000-8000-003620000010', '00000000-0000-4000-8000-00362000000a', 'ana-0036a', 'Ana', true),
  ('00000000-0000-4000-8000-003620000011', '00000000-0000-4000-8000-00362000000b', 'ben-0036a', 'Ben', true),
  ('00000000-0000-4000-8000-003620000012', '00000000-0000-4000-8000-00362000000c', 'uma-0036a', 'Uma', false),
  ('00000000-0000-4000-8000-003620000013', '00000000-0000-4000-8000-00362000000d', 'cyd-0036a', 'Cyd', true);

select lives_ok(
  $$update carnet.profiles set time_zone = 'Asia/Tokyo' where id = '00000000-0000-4000-8000-003620000011'$$,
  'fixture : PB est en Asia/Tokyo'
);
select lives_ok(
  $$insert into carnet.event_types (id, profile_id, title, duration_min, buffer_min, min_notice_min, location_kind, location_text, is_active, position) values
      ('00000000-0000-4000-8000-0036200000e0', '00000000-0000-4000-8000-003620000010', 'Appel découverte', 30, 15, 120, 'video', 'https://visio.example.test/ana-secret', true, 0),
      ('00000000-0000-4000-8000-0036200000e1', '00000000-0000-4000-8000-003620000010', 'Rendez-vous', 60, 0, 1440, 'in_person', '1 rue Publique, Paris', true, 1),
      ('00000000-0000-4000-8000-0036200000e2', '00000000-0000-4000-8000-003620000010', 'Ancien type', 45, 0, 120, 'phone', null, false, 2),
      ('00000000-0000-4000-8000-0036200000e3', '00000000-0000-4000-8000-003620000011', 'Call', 60, 0, 0, 'video', null, true, 0),
      ('00000000-0000-4000-8000-0036200000e4', '00000000-0000-4000-8000-003620000012', 'Uma', 30, 0, 0, 'video', null, true, 0),
      ('00000000-0000-4000-8000-0036200000e5', '00000000-0000-4000-8000-003620000013', 'Cyd', 30, 0, 0, 'video', null, true, 0)$$,
  'fixture : types de rendez-vous'
);
select lives_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003620000010', 1, '09:00', '12:00'),
      ('00000000-0000-4000-8000-003620000010', 1, '14:00', '18:00'),
      ('00000000-0000-4000-8000-003620000010', 3, '09:00', '12:00'),
      ('00000000-0000-4000-8000-003620000011', 1, '09:00', '17:00'),
      ('00000000-0000-4000-8000-003620000012', 1, '09:00', '12:00'),
      ('00000000-0000-4000-8000-003620000013', 1, '09:00', '12:00')$$,
  'fixture : règles de disponibilité'
);
select lives_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-003620000010', tstzrange(pg_temp.at('2027-03-05 13:00Z'), pg_temp.at('2027-03-05 14:00Z')), 'busy'),
      ('00000000-0000-4000-8000-003620000010', tstzrange(pg_temp.at('2027-03-06 09:00Z'), pg_temp.at('2027-03-06 11:00Z')), 'extra'),
      ('00000000-0000-4000-8000-003620000010', tstzrange(pg_temp.at('2027-06-01 09:00Z'), pg_temp.at('2027-06-01 11:00Z')), 'busy'),
      ('00000000-0000-4000-8000-003620000013', tstzrange(pg_temp.at('2027-03-05 13:00Z'), pg_temp.at('2027-03-05 14:00Z')), 'busy')$$,
  'fixture : exceptions busy et extra'
);
select lives_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind)
      select '00000000-0000-4000-8000-003620000011',
             tstzrange(pg_temp.at('2027-03-10 00:00Z') + make_interval(hours => g),
                       pg_temp.at('2027-03-10 00:30Z') + make_interval(hours => g)), 'busy'
        from generate_series(0, 119) g$$,
  'fixture : 120 exceptions busy pour PB (au-delà de la limite de 100 lignes)'
);
select lives_ok(
  $$insert into carnet.bookings (id, profile_id, event_type_id, range, status, visitor_name, visitor_email, visitor_phone, message,
                                 consent_at, idempotency_key, cancelled_at, cancelled_by) values
      ('00000000-0000-4000-8000-0036200000b1', '00000000-0000-4000-8000-003620000010', '00000000-0000-4000-8000-0036200000e0',
       tstzrange(pg_temp.at('2027-03-03 08:00Z'), pg_temp.at('2027-03-03 08:30Z')), 'confirmed', 'Zoé Secret', 'zoe-secret@example.test', '+33 6 00 00 00 01',
       'Message privé', now(), '00000000-0000-4000-8000-0036200000a1', null, null),
      ('00000000-0000-4000-8000-0036200000b2', '00000000-0000-4000-8000-003620000010', '00000000-0000-4000-8000-0036200000e0',
       tstzrange(pg_temp.at('2027-03-03 09:00Z'), pg_temp.at('2027-03-03 09:30Z')), 'cancelled', 'Annulé Secret', 'annule-secret@example.test', null,
       null, now(), '00000000-0000-4000-8000-0036200000a2', now(), 'visitor'),
      ('00000000-0000-4000-8000-0036200000b3', '00000000-0000-4000-8000-003620000010', '00000000-0000-4000-8000-0036200000e1',
       tstzrange(pg_temp.at('2027-03-04 10:00Z'), pg_temp.at('2027-03-04 11:00Z')), 'confirmed', 'Yan Secret', 'yan-secret@example.test', null,
       null, now(), '00000000-0000-4000-8000-0036200000a3', null, null),
      ('00000000-0000-4000-8000-0036200000b4', '00000000-0000-4000-8000-003620000011', '00000000-0000-4000-8000-0036200000e3',
       tstzrange(pg_temp.at('2027-03-03 08:00Z'), pg_temp.at('2027-03-03 09:00Z')), 'confirmed', 'Xia Secret', 'xia-secret@example.test', null,
       null, now(), '00000000-0000-4000-8000-0036200000a4', null, null),
      ('00000000-0000-4000-8000-0036200000b5', '00000000-0000-4000-8000-003620000013', '00000000-0000-4000-8000-0036200000e5',
       tstzrange(pg_temp.at('2027-03-03 08:00Z'), pg_temp.at('2027-03-03 08:30Z')), 'confirmed', 'Wes Secret', 'wes-secret@example.test', null,
       null, now(), '00000000-0000-4000-8000-0036200000a5', null, null)$$,
  'fixture : réservations (bA1 confirmée, bA2 annulée, bA3 confirmée, bB1, bC1)'
);
select lives_ok(
  $$insert into carnet.booking_tokens (token_hash, booking_id) values
      (sha256(convert_to(repeat('a', 64), 'UTF8')), '00000000-0000-4000-8000-0036200000b1'),
      (sha256(convert_to(repeat('b', 64), 'UTF8')), '00000000-0000-4000-8000-0036200000b4'),
      (sha256(convert_to(repeat('c', 64), 'UTF8')), '00000000-0000-4000-8000-0036200000b5')$$,
  'fixture : jetons de bA1, bB1, bC1'
);

-- ---------------------------------------------------------------------------
-- Critère 4 — A, propriétaire
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00362000000a","role":"authenticated"}';
select is(pg_temp.txt($$select count(*)::text from carnet.event_types$$), '3', 'critère 4 : A voit ses 3 types et aucun autre');
select is(pg_temp.txt($$select count(*)::text from carnet.availability_rules$$), '3', 'critère 4 : A voit ses 3 règles et aucune autre');
select is(pg_temp.txt($$select count(*)::text from carnet.availability_exceptions$$), '3', 'critère 4 : A voit ses 3 exceptions et aucune autre');
select is(pg_temp.txt($$select count(*)::text from carnet.bookings$$), '3', 'critère 4 : A voit ses 3 réservations (annulée comprise) et aucune autre');
select is(
  pg_temp.txt($$select visitor_email from carnet.bookings where id = '00000000-0000-4000-8000-0036200000b1'$$),
  'zoe-secret@example.test',
  'décision 6 : le propriétaire lit les données visiteur de ses réservations'
);
select lives_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position)
      values ('00000000-0000-4000-8000-003620000010', 'Nouveau', 20, 'phone', 3)$$,
  'décision 6 : A crée un type sur son profil'
);
select is(
  pg_temp.rows($$update carnet.event_types set title = 'Appel' where id = '00000000-0000-4000-8000-0036200000e0'$$),
  1::bigint,
  'décision 6 : A modifie son type'
);
select lives_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time)
      values ('00000000-0000-4000-8000-003620000010', 5, '09:00', '12:00')$$,
  'décision 6 : A crée une règle sur son profil'
);
select is(
  pg_temp.rows($$update carnet.availability_rules set end_time = '11:00' where profile_id = '00000000-0000-4000-8000-003620000010' and weekday = 5$$),
  1::bigint,
  'décision 6 : A modifie sa règle'
);
select is(
  pg_temp.rows($$delete from carnet.availability_rules where profile_id = '00000000-0000-4000-8000-003620000010' and weekday = 5$$),
  1::bigint,
  'décision 6 : A supprime sa règle'
);
select lives_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind)
      values ('00000000-0000-4000-8000-003620000010', tstzrange(pg_temp.at('2027-07-01 09:00Z'), pg_temp.at('2027-07-01 10:00Z')), 'busy')$$,
  'décision 6 : A crée une exception sur son profil'
);
select is(
  pg_temp.rows($$update carnet.availability_exceptions
                    set range = tstzrange(pg_temp.at('2027-07-01 09:00Z'), pg_temp.at('2027-07-01 10:00Z')), kind = 'busy'
                  where profile_id = '00000000-0000-4000-8000-003620000010' and lower(range) = pg_temp.at('2027-07-01 09:00Z')$$),
  1::bigint,
  'point 18 : A modifie range et kind de son exception (colonnes métier)'
);
select is(
  pg_temp.rows($$delete from carnet.availability_exceptions where profile_id = '00000000-0000-4000-8000-003620000010' and lower(range) = pg_temp.at('2027-07-01 09:00Z')$$),
  1::bigint,
  'décision 6 : A supprime son exception'
);
select is(
  pg_temp.rows($$update carnet.event_types
                    set title = 'Appel', duration_min = 30, buffer_min = 15, min_notice_min = 120, location_kind = 'video',
                        location_text = 'https://visio.example.test/ana-secret', is_active = true, position = 0
                  where id = '00000000-0000-4000-8000-0036200000e0'$$),
  1::bigint,
  'point 18 : A modifie toutes les colonnes métier de son type'
);
select is(
  pg_temp.rows($$update carnet.availability_rules set weekday = 3, start_time = '09:00', end_time = '12:00'
                  where profile_id = '00000000-0000-4000-8000-003620000010' and weekday = 3$$),
  1::bigint,
  'point 18 : A modifie weekday, start_time et end_time de sa règle'
);
select throws_ok(
  $$update carnet.event_types set id = id where id = '00000000-0000-4000-8000-0036200000e0'$$,
  '42501', null, 'point 18 : A ne modifie pas id de son type (event_types, droit update par colonne, 42501)'
);
select throws_ok(
  $$update carnet.event_types set profile_id = profile_id where id = '00000000-0000-4000-8000-0036200000e0'$$,
  '42501', null, 'point 18 : A ne modifie pas profile_id de son type (event_types, droit update par colonne, 42501)'
);
select throws_ok(
  $$update carnet.event_types set created_at = created_at where id = '00000000-0000-4000-8000-0036200000e0'$$,
  '42501', null, 'point 18 : A ne modifie pas created_at de son type (event_types, droit update par colonne, 42501)'
);
select throws_ok(
  $$update carnet.availability_rules set id = id where profile_id = '00000000-0000-4000-8000-003620000010'$$,
  '42501', null, 'point 18 : A ne modifie pas id de sa règle (availability_rules, droit update par colonne, 42501)'
);
select throws_ok(
  $$update carnet.availability_rules set profile_id = profile_id where profile_id = '00000000-0000-4000-8000-003620000010'$$,
  '42501', null, 'point 18 : A ne modifie pas profile_id de sa règle (availability_rules, droit update par colonne, 42501)'
);
select throws_ok(
  $$update carnet.availability_rules set created_at = created_at where profile_id = '00000000-0000-4000-8000-003620000010'$$,
  '42501', null, 'point 18 : A ne modifie pas created_at de sa règle (availability_rules, droit update par colonne, 42501)'
);
select throws_ok(
  $$update carnet.availability_exceptions set id = id where profile_id = '00000000-0000-4000-8000-003620000010'$$,
  '42501', null, 'point 18 : A ne modifie pas id de son exception (availability_exceptions, droit update par colonne, 42501)'
);
select throws_ok(
  $$update carnet.availability_exceptions set profile_id = profile_id where profile_id = '00000000-0000-4000-8000-003620000010'$$,
  '42501', null, 'point 18 : A ne modifie pas profile_id de son exception (availability_exceptions, droit update par colonne, 42501)'
);
select throws_ok(
  $$update carnet.availability_exceptions set created_at = created_at where profile_id = '00000000-0000-4000-8000-003620000010'$$,
  '42501', null, 'point 18 : A ne modifie pas created_at de son exception (availability_exceptions, droit update par colonne, 42501)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position)
      values ('00000000-0000-4000-8000-003620000011', 'Intrus', 20, 'phone', 5)$$,
  '42501', null, 'critère 4 : A ne crée pas de type sur le profil de B (42501)'
);
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time)
      values ('00000000-0000-4000-8000-003620000011', 2, '09:00', '12:00')$$,
  '42501', null, 'critère 4 : A ne crée pas de règle sur le profil de B (42501)'
);
select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind)
      values ('00000000-0000-4000-8000-003620000011', tstzrange(pg_temp.at('2027-07-01 09:00Z'), pg_temp.at('2027-07-01 10:00Z')), 'busy')$$,
  '42501', null, 'critère 4 : A ne crée pas d''exception sur le profil de B (42501)'
);
select throws_ok(
  $$update carnet.event_types set profile_id = '00000000-0000-4000-8000-003620000011', position = 7
     where id = '00000000-0000-4000-8000-0036200000e2'$$,
  '42501', null, 'critère 4 : A ne déplace pas son type vers le profil de B (with check, 42501)'
);
select is(pg_temp.rows($$update carnet.event_types set title = 'Pirate' where id = '00000000-0000-4000-8000-0036200000e3'$$), 0::bigint,
  'critère 4 : A ne modifie pas le type de B (0 ligne)');
select is(pg_temp.rows($$delete from carnet.event_types where id = '00000000-0000-4000-8000-0036200000e3'$$), 0::bigint,
  'critère 4 : A ne supprime pas le type de B (0 ligne)');
select is(pg_temp.rows($$update carnet.availability_rules set end_time = '10:00' where profile_id = '00000000-0000-4000-8000-003620000011'$$), 0::bigint,
  'critère 4 : A ne modifie pas les règles de B (0 ligne)');
select is(pg_temp.rows($$delete from carnet.availability_exceptions where profile_id = '00000000-0000-4000-8000-003620000011'$$), 0::bigint,
  'critère 4 : A ne supprime pas les exceptions de B (0 ligne)');
select throws_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, consent_at, idempotency_key)
      values ('00000000-0000-4000-8000-003620000010', '00000000-0000-4000-8000-0036200000e0', tstzrange(pg_temp.at('2027-03-08 08:00Z'), pg_temp.at('2027-03-08 08:30Z')),
              'Moi', 'moi@example.test', now(), gen_random_uuid())$$,
  '42501', null, 'décision 6 : le propriétaire n''insère pas directement de réservation (42501)'
);
select throws_ok(
  $$update carnet.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'owner'
     where id = '00000000-0000-4000-8000-0036200000b1'$$,
  '42501', null, 'décision 6 : le propriétaire ne modifie pas directement sa réservation (42501 ; cancel_own_booking)'
);
select throws_ok(
  $$delete from carnet.bookings where id = '00000000-0000-4000-8000-0036200000b1'$$,
  '42501', null, 'décision 6 : le propriétaire ne supprime pas directement sa réservation (42501)'
);
select throws_ok($$select 1 from carnet.booking_tokens$$, '42501', null,
  'point 14 : le propriétaire ne lit pas booking_tokens, même pour ses réservations (42501)');
select throws_ok(
  $$insert into carnet.booking_tokens (token_hash, booking_id) values (sha256('\x36ab'::bytea), '00000000-0000-4000-8000-0036200000b1')$$,
  '42501', null, 'point 14 : le propriétaire n''ajoute pas de jeton (42501)'
);
select throws_ok($$select carnet.get_booking_by_token(repeat('a', 64))$$, '42501', null,
  'point 15 : authenticated n''exécute pas get_booking_by_token (42501 ; service_role seul)');
select throws_ok($$select * from carnet.claim_booking_outbox(10)$$, '42501', null,
  'point 15 : authenticated n''exécute pas claim_booking_outbox (42501)');
reset role;

-- ---------------------------------------------------------------------------
-- Critère 4 — B, autre membre carnet
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00362000000b","role":"authenticated"}';
select is(pg_temp.txt($$select count(*)::text from carnet.event_types where profile_id = '00000000-0000-4000-8000-003620000010'$$), '0',
  'critère 4 : B ne voit aucun type de A');
select is(pg_temp.txt($$select count(*)::text from carnet.availability_rules where profile_id = '00000000-0000-4000-8000-003620000010'$$), '0',
  'critère 4 : B ne voit aucune règle de A');
select is(pg_temp.txt($$select count(*)::text from carnet.availability_exceptions where profile_id = '00000000-0000-4000-8000-003620000010'$$), '0',
  'critère 4 : B ne voit aucune exception de A');
select is(pg_temp.txt($$select count(*)::text from carnet.bookings where profile_id = '00000000-0000-4000-8000-003620000010'$$), '0',
  'critère 4 : B ne voit aucune réservation de A');
select is(pg_temp.txt($$select count(*)::text from carnet.bookings$$), '1', 'critère 4 : B ne voit que sa propre réservation');
select is(pg_temp.rows($$update carnet.event_types set is_active = false where profile_id = '00000000-0000-4000-8000-003620000010'$$), 0::bigint,
  'critère 4 : B ne désactive aucun type de A (0 ligne)');
select is(pg_temp.rows($$delete from carnet.availability_rules where profile_id = '00000000-0000-4000-8000-003620000010'$$), 0::bigint,
  'critère 4 : B ne supprime aucune règle de A (0 ligne)');
select is(pg_temp.rows($$update carnet.availability_exceptions set kind = 'extra' where profile_id = '00000000-0000-4000-8000-003620000010'$$), 0::bigint,
  'critère 4 : B ne modifie aucune exception de A (0 ligne)');
reset role;

-- ---------------------------------------------------------------------------
-- Critère 4 — N, membre carnet sans profil
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00362000000e","role":"authenticated"}';
select is(
  pg_temp.txt($$select ((select count(*) from carnet.event_types) + (select count(*) from carnet.availability_rules)
                      + (select count(*) from carnet.availability_exceptions) + (select count(*) from carnet.bookings))::text$$),
  '0',
  'critère 4 : un membre sans profil ne voit aucune ligne des 4 tables'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position)
      values ('00000000-0000-4000-8000-003620000010', 'Intrus', 20, 'phone', 6)$$,
  '42501', null, 'critère 4 : un membre sans profil ne crée pas de type chez A (42501)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 4 — C, compte d'un autre projet (propriétaire de PC, sans appartenance carnet)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00362000000d","role":"authenticated"}';
select is(
  pg_temp.txt($$select ((select count(*) from carnet.event_types) + (select count(*) from carnet.availability_rules)
                      + (select count(*) from carnet.availability_exceptions) + (select count(*) from carnet.bookings))::text$$),
  '0',
  'critère 4 : un compte d''un autre projet ne voit aucune ligne, pas même celles de son ancien profil'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position)
      values ('00000000-0000-4000-8000-003620000013', 'Cyd 2', 20, 'phone', 1)$$,
  '42501', null, 'critère 4 : un compte d''un autre projet ne crée pas de type, même sur son ancien profil (42501)'
);
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time)
      values ('00000000-0000-4000-8000-003620000013', 2, '09:00', '12:00')$$,
  '42501', null, 'critère 4 : un compte d''un autre projet ne crée pas de règle (42501)'
);
select is(pg_temp.rows($$update carnet.event_types set title = 'X' where profile_id = '00000000-0000-4000-8000-003620000013'$$), 0::bigint,
  'critère 4 : un compte d''un autre projet ne modifie aucun type (0 ligne)');
select is(pg_temp.rows($$delete from carnet.availability_exceptions where profile_id = '00000000-0000-4000-8000-003620000013'$$), 0::bigint,
  'critère 4 : un compte d''un autre projet ne supprime aucune exception (0 ligne)');
select throws_ok(
  $$select carnet.cancel_own_booking('00000000-0000-4000-8000-0036200000b5')$$,
  'P0002', null, 'critère 4 : un compte d''un autre projet n''annule pas la réservation de son ancien profil (P0002)'
);
select throws_ok($$select 1 from carnet.booking_tokens$$, '42501', null,
  'point 14 : un compte d''un autre projet ne lit pas booking_tokens (42501)');
reset role;

-- ---------------------------------------------------------------------------
-- Critère 4 — anon : aucun accès direct
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select 1 from carnet.event_types$$, '42501', null, 'critère 4 : anon ne lit pas event_types (42501)');
select throws_ok($$select 1 from carnet.availability_rules$$, '42501', null, 'critère 4 : anon ne lit pas availability_rules (42501)');
select throws_ok($$select 1 from carnet.availability_exceptions$$, '42501', null, 'critère 4 : anon ne lit pas availability_exceptions (42501)');
select throws_ok($$select 1 from carnet.bookings$$, '42501', null, 'critère 4 : anon ne lit pas bookings (42501)');
select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind)
      values ('00000000-0000-4000-8000-003620000010', tstzrange(pg_temp.at('2027-07-01 09:00Z'), pg_temp.at('2027-07-01 10:00Z')), 'extra')$$,
  '42501', null, 'critère 4 : anon n''écrit pas dans availability_exceptions (42501)'
);
select throws_ok(
  $$select * from carnet.book_slot('ana-0036a', '00000000-0000-4000-8000-0036200000e0', pg_temp.at('2027-03-08 08:00Z'), 'Vic', 'vic@example.test',
                                   null, null, '00000000-0000-4000-8000-0036200000af', 'mobile')$$,
  '42501', null, 'décision 7 : anon n''exécute pas book_slot (42501)'
);
select throws_ok(
  $$select carnet.cancel_booking_by_token(repeat('a', 64))$$,
  '42501', null, 'décision 7 : anon n''exécute pas cancel_booking_by_token (42501)'
);
select throws_ok(
  $$select * from carnet.reschedule_booking_by_token(repeat('a', 64), pg_temp.at('2027-03-08 08:00Z'), '00000000-0000-4000-8000-0036200000af')$$,
  '42501', null, 'décision 7 : anon n''exécute pas reschedule_booking_by_token (42501)'
);
select throws_ok(
  $$select carnet.cancel_own_booking('00000000-0000-4000-8000-0036200000b1')$$,
  '42501', null, 'décision 7 : anon n''exécute pas cancel_own_booking (42501)'
);
select throws_ok($$select 1 from carnet.booking_tokens$$, '42501', null, 'point 14 : anon ne lit pas booking_tokens (42501)');
select throws_ok($$select carnet.get_booking_by_token(repeat('a', 64))$$, '42501', null,
  'point 15 : anon n''exécute pas get_booking_by_token (42501)');
select throws_ok($$select * from carnet.claim_booking_outbox(10)$$, '42501', null,
  'point 15 : anon n''exécute pas claim_booking_outbox (42501)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00362000000a","role":"authenticated"}';
select throws_ok(
  $$select * from carnet.book_slot('ana-0036a', '00000000-0000-4000-8000-0036200000e0', pg_temp.at('2027-03-08 08:00Z'), 'Vic', 'vic@example.test',
                                   null, null, '00000000-0000-4000-8000-0036200000af', 'mobile')$$,
  '42501', null, 'décision 7 : authenticated n''exécute pas book_slot (42501 ; service_role seul)'
);
select throws_ok(
  $$select carnet.cancel_booking_by_token(repeat('a', 64))$$,
  '42501', null, 'décision 7 : authenticated n''exécute pas cancel_booking_by_token (42501)'
);
reset role;

select is(
  pg_temp.txt($$select string_agg(status, ',' order by id) from carnet.bookings where profile_id = '00000000-0000-4000-8000-003620000010'$$),
  'confirmed,cancelled,confirmed',
  'critère 4 : aucune tentative ci-dessus n''a modifié les réservations de A'
);
select is(
  pg_temp.txt($$select string_agg(title || ':' || is_active::text, ',' order by title) from carnet.event_types
                 where profile_id in ('00000000-0000-4000-8000-003620000011', '00000000-0000-4000-8000-003620000013')$$),
  'Call:true,Cyd:true',
  'critère 4 : les types de B et de C sont intacts'
);

-- ---------------------------------------------------------------------------
-- Décision 6 — get_public_booking_page (anon)
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select lives_ok(
  $$insert into reads (label, v) values
      ('page_ana', carnet.get_public_booking_page('ana-0036a')),
      ('page_ben', carnet.get_public_booking_page('ben-0036a')),
      ('page_uma', carnet.get_public_booking_page('uma-0036a')),
      ('page_zzz', carnet.get_public_booking_page('zzz-0036a'))$$,
  'décision 6 : anon appelle get_public_booking_page'
);
reset role;

select is(
  (select array_agg(k order by k) from reads, jsonb_object_keys(v) k where label = 'page_ana'),
  array['event_types', 'rules', 'time_zone'],
  'décision 6 : la page publique a exactement les clés time_zone, event_types, rules'
);
select is((select v ->> 'time_zone' from reads where label = 'page_ana'), 'Europe/Paris', 'décision 6 : fuseau du profil (Europe/Paris)');
select is((select v ->> 'time_zone' from reads where label = 'page_ben'), 'Asia/Tokyo', 'décision 6 : fuseau du profil (Asia/Tokyo)');
select is(
  (select array_agg(e ->> 'title' order by ord) from reads, jsonb_array_elements(v -> 'event_types') with ordinality as t (e, ord)
    where label = 'page_ana'),
  array['Appel', 'Rendez-vous', 'Nouveau'],
  'décision 6 : types actifs uniquement (e0, e1, puis le type créé par A en position 3 ; e2 inactif exclu), triés par position'
);
select is(
  (select array_agg(distinct k order by k) from reads, jsonb_array_elements(v -> 'event_types') e, jsonb_object_keys(e) k
    where label = 'page_ana' and e ->> 'location_kind' <> 'in_person'),
  array['buffer_min', 'duration_min', 'id', 'location_kind', 'min_notice_min', 'position', 'title'],
  'décision 6 et point 14 : un type video ou phone expose exactement id, title, duration_min, buffer_min, min_notice_min, location_kind, position (pas de location_text)'
);
select is(
  (select array_agg(k order by k) from reads, jsonb_array_elements(v -> 'event_types') e, jsonb_object_keys(e) k
    where label = 'page_ana' and e ->> 'id' = '00000000-0000-4000-8000-0036200000e1'),
  array['buffer_min', 'duration_min', 'id', 'location_kind', 'location_text', 'min_notice_min', 'position', 'title'],
  'point 14 : un type in_person expose en plus location_text'
);
select is(
  (select e ->> 'location_text' from reads, jsonb_array_elements(v -> 'event_types') e
    where label = 'page_ana' and e ->> 'id' = '00000000-0000-4000-8000-0036200000e1'),
  '1 rue Publique, Paris',
  'point 14 : l''adresse d''un type in_person est publique'
);
select is(
  (select row(e ->> 'title', (e ->> 'duration_min')::int, (e ->> 'buffer_min')::int, (e ->> 'min_notice_min')::int,
              e ->> 'location_kind', (e ->> 'position')::int)::text
     from reads, jsonb_array_elements(v -> 'event_types') e
    where label = 'page_ana' and e ->> 'id' = '00000000-0000-4000-8000-0036200000e0'),
  row('Appel', 30, 15, 120, 'video', 0)::text,
  'décision 6 : valeurs du type e0 (titre modifié par A, 30 min, tampon 15, délai 120, video, position 0)'
);
select ok(
  coalesce((select v::text !~ 'visio\.example\.test|Ancien type' from reads where label = 'page_ana'), false),
  'point 14 : ni le lien de visio (video) ni le type inactif dans la page publique'
);
select is(
  (select count(*) from reads, jsonb_array_elements(v -> 'rules') r where label = 'page_ana'),
  3::bigint,
  'décision 6 : les 3 règles de A sont publiées'
);
select is(
  (select array_agg(distinct k order by k) from reads, jsonb_array_elements(v -> 'rules') r, jsonb_object_keys(r) k
    where label = 'page_ana'),
  array['end_time', 'start_time', 'weekday'],
  'décision 6 : chaque règle expose exactement weekday, start_time, end_time'
);
select is(
  (select string_agg((r ->> 'weekday') || ' ' || (r ->> 'start_time')::time::text || '-' || (r ->> 'end_time')::time::text, ','
                     order by (r ->> 'weekday')::int, (r ->> 'start_time')::time)
     from reads, jsonb_array_elements(v -> 'rules') r where label = 'page_ana'),
  '1 09:00:00-12:00:00,1 14:00:00-18:00:00,3 09:00:00-12:00:00',
  'décision 6 : contenu des règles (jour ISO, heures locales du profil)'
);
select ok(
  (select v is null from reads where label = 'page_uma') and (select v is null from reads where label = 'page_zzz'),
  'décision 6 : profil non publié et slug inconnu → null (même réponse)'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00362000000b","role":"authenticated"}';
select is(
  pg_temp.txt($$select carnet.get_public_booking_page('ana-0036a') ->> 'time_zone'$$),
  'Europe/Paris',
  'décision 6 : un autre membre lit la page publique de A comme anon'
);
reset role;

-- ---------------------------------------------------------------------------
-- Décision 6 et critère 4 — get_public_busy_ranges (anon)
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select lives_ok(
  $$insert into reads (label, v) values
      ('busy_ana', carnet.get_public_busy_ranges('ana-0036a', pg_temp.at('2027-03-01 00:00Z'), pg_temp.at('2027-03-08 00:00Z'))),
      ('busy_ana_buffer', carnet.get_public_busy_ranges('ana-0036a', pg_temp.at('2027-03-03 08:30Z'), pg_temp.at('2027-03-03 08:40Z'))),
      ('busy_ana_before', carnet.get_public_busy_ranges('ana-0036a', pg_temp.at('2027-03-02 00:00Z'), pg_temp.at('2027-03-03 08:00Z'))),
      ('busy_ana_62', carnet.get_public_busy_ranges('ana-0036a', now() - interval '1 day', now() + interval '1440 hours' + interval '1 day')),
      ('busy_ben', carnet.get_public_busy_ranges('ben-0036a', pg_temp.at('2027-03-01 00:00Z'), pg_temp.at('2027-03-20 00:00Z'))),
      ('busy_uma', carnet.get_public_busy_ranges('uma-0036a', pg_temp.at('2027-03-01 00:00Z'), pg_temp.at('2027-03-08 00:00Z'))),
      ('busy_zzz', carnet.get_public_busy_ranges('zzz-0036a', pg_temp.at('2027-03-01 00:00Z'), pg_temp.at('2027-03-08 00:00Z')))$$,
  'décision 6 et point 18 : anon appelle get_public_busy_ranges (62 jours exacts, de now() − 1 jour à now() + 1440 h + 1 jour, acceptés)'
);
select throws_ok(
  $$select carnet.get_public_busy_ranges('ana-0036a', pg_temp.at('2027-03-01 00:00Z'), pg_temp.at('2027-05-02 00:00:01Z'))$$,
  '22023', null, 'décision 6 : plage de plus de 62 jours refusée (22023)'
);
select throws_ok(
  $$select carnet.get_public_busy_ranges('ana-0036a', now() - interval '1 day' - interval '1 second', now())$$,
  '22023', null, 'point 18 : p_from antérieur à now() − 1 jour refusé (22023, pas d''historique public)'
);
select throws_ok(
  $$select carnet.get_public_busy_ranges('ana-0036a', now(), now() + interval '1440 hours' + interval '1 day' + interval '1 second')$$,
  '22023', null, 'point 18 : p_to postérieur à now() + 1440 h + 1 jour refusé (22023)'
);
select throws_ok(
  $$select carnet.get_public_busy_ranges('ana-0036a', '2020-01-01 00:00Z', '2020-01-08 00:00Z')$$,
  '22023', null, 'point 18 : fenêtre passée (janvier 2020) refusée (22023)'
);
select throws_ok(
  $$select carnet.get_public_busy_ranges('ana-0036a', pg_temp.at('2027-03-01 00:00Z'), pg_temp.at('2027-03-01 00:00Z'))$$,
  '22023', null, 'décision 6 : plage vide (from = to) refusée (22023)'
);
select throws_ok(
  $$select carnet.get_public_busy_ranges('ana-0036a', pg_temp.at('2027-03-08 00:00Z'), pg_temp.at('2027-03-01 00:00Z'))$$,
  '22023', null, 'décision 6 : from > to refusé (22023)'
);
select throws_ok(
  $$select carnet.get_public_busy_ranges('ana-0036a', null, pg_temp.at('2027-03-01 00:00Z'))$$,
  '22023', null, 'décision 6 : from nul refusé (22023)'
);
select throws_ok(
  $$select carnet.get_public_busy_ranges('ana-0036a', pg_temp.at('2027-03-01 00:00Z'), null)$$,
  '22023', null, 'décision 6 : to nul refusé (22023)'
);
reset role;

select is(
  (select array_agg(k order by k) from reads, jsonb_object_keys(v) k where label = 'busy_ana'),
  array['busy', 'extra'],
  'décision 6 : les occupations ont exactement les clés busy et extra'
);
select is(
  (select string_agg((e ->> 'start')::timestamptz::text || '/' || (e ->> 'end')::timestamptz::text, ','
                     order by (e ->> 'start')::timestamptz)
     from reads, jsonb_array_elements(v -> 'busy') e where label = 'busy_ana'),
  (select string_agg(x, ',' order by x) from (values
     (pg_temp.at('2027-03-03 08:00:00+00')::text || '/' || pg_temp.at('2027-03-03 08:45:00+00')::text),
     (pg_temp.at('2027-03-04 10:00:00+00')::text || '/' || pg_temp.at('2027-03-04 11:00:00+00')::text),
     (pg_temp.at('2027-03-05 13:00:00+00')::text || '/' || pg_temp.at('2027-03-05 14:00:00+00')::text)) v (x)),
  'décision 6 : busy = réservations confirmées (fin + tampon du type : bA1 jusqu''à 08:45) et exception busy ; annulée exclue'
);
select is(
  (select string_agg((e ->> 'start')::timestamptz::text || '/' || (e ->> 'end')::timestamptz::text, ',')
     from reads, jsonb_array_elements(v -> 'extra') e where label = 'busy_ana'),
  pg_temp.at('2027-03-06 09:00:00+00')::text || '/' || pg_temp.at('2027-03-06 11:00:00+00')::text,
  'décision 6 : extra = l''exception extra de la plage'
);
select is(
  (select array_agg(distinct k order by k)
     from reads, lateral (select jsonb_array_elements(v -> 'busy') union all select jsonb_array_elements(v -> 'extra')) e (o),
          jsonb_object_keys(e.o) k
    where label = 'busy_ana'),
  array['end', 'start'],
  'critère 4 : chaque occupation n''expose que start et end (ni id, ni nature, ni donnée visiteur)'
);
select ok(
  coalesce((select v::text !~* 'secret|Zoé|Yan|0036200000b|0036200000e|confirmed|cancelled|visitor' from reads where label = 'busy_ana'), false),
  'critère 4 : aucune donnée visiteur, aucun identifiant ni statut dans les occupations publiques'
);
select is(
  (select jsonb_array_length(v -> 'busy') from reads where label = 'busy_ana_buffer'),
  1,
  'décision 6 : une fenêtre qui ne touche que le tampon de bA1 renvoie bA1 (intersection, tampon compris)'
);
select is(
  (select v -> 'busy' from reads where label = 'busy_ana_before'),
  '[]'::jsonb,
  'décision 6 : une fenêtre qui se termine au début de bA1 ne la renvoie pas (bornes [) ) ; tableau vide, jamais null'
);
select is(
  (select jsonb_array_length(v -> 'busy') from reads where label = 'busy_ana_62'),
  3,
  'décision 6 : sur 62 jours (fenêtre maximale), l''exception de juin reste hors plage'
);
select is(
  (select jsonb_array_length(v -> 'busy') from reads where label = 'busy_ben'),
  121,
  'règle « limite de lignes » : 121 occupations de B renvoyées en une valeur, sans troncature à 100'
);
select ok(
  coalesce((select v::text !~* 'secret' from reads where label = 'busy_ben'), false),
  'critère 4 : les occupations de B ne contiennent aucune donnée visiteur'
);
select ok(
  (select v is null from reads where label = 'busy_uma') and (select v is null from reads where label = 'busy_zzz'),
  'décision 6 : profil non publié et slug inconnu → null (même réponse)'
);

select * from finish();
rollback;
