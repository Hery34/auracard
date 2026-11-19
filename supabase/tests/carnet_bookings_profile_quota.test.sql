-- Fiche 0039, point 8 (Hery, 19/11/2026) — quota du profil sur les seules réservations réussies.
-- La limite applicative `booking-profile` est supprimée ; carnet.book_slot_at refuse avec le SQLSTATE dédié CN005 si
-- le profil a déjà 20 réservations CONFIRMÉES créées dans les 23 dernières heures (status = 'confirmed' et
-- created_at > p_now − 23 h : une réservation annulée, par le visiteur ou le propriétaire, libère le quota), contrôle
-- fait sous carnet.lock_profile_bookings et APRÈS la
-- détection du rejeu (un rejeu reste un succès, même au plafond). Un échec (CN001 slot_taken, CN002 slot_unavailable)
-- n'écrit rien, donc ne consomme rien. Le refus CN005 n'écrit rien (ni réservation, ni jeton, ni outbox, ni analytics).
-- Critère 2 de la fiche (« limite dépassée : rien n'est écrit »), règle d'idempotence (rejeu).
-- Personas (UUID fixes, plage 0039 5xxx propre à ce fichier) :
--   Q 0…a membre carnet, profil PQ 0…10 publié (qui-0039q), Europe/Paris ; type q0 (30 min, tampon 0, délai 0, video) ;
--     exception extra mardi 2 mars 2027 00:00Z–24:00Z (seule disponibilité).
--   R 0…b membre carnet, profil PR 0…11 publié (roy-0039q) ; type r0 identique ; même exception extra.
-- Horloge T = 2027-03-01 12:00Z. Réservations semées directement (postgres) pour PQ :
--   18 confirmées créées à T − 1 h (dont une le 2 mars 05:00Z, dans l'exception extra, pour provoquer CN001) ;
--   1 confirmée créée à T − 22 h 59 (compte jusqu'à T + 1 min) ; 1 confirmée créée à T − 23 h 01 (ne compte pas).
--   → 19 réservations comptées à T. Plus loin, 17 réservations annulées semées à T + 22 h 03 : elles ne comptent pas.
--   Enfin 16 confirmées semées à T + 22 h 05 remettent PQ au plafond ; annuler l'une d'elles libère une place.
-- Tout est annulé par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(28);

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

-- SQLSTATE d'une instruction ('OK' si elle réussit).
create function pg_temp.state(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end
$$;

create temp table res (label text, booking_id uuid, cancel_token text);

create function pg_temp.book(p_label text, p_slug text, p_type uuid, p_start timestamptz, p_key uuid, p_now timestamptz)
returns void
language plpgsql as $$
begin
  insert into res (label, booking_id, cancel_token)
  select p_label, r.booking_id, r.cancel_token
    from carnet.book_slot_at(p_slug, p_type, p_start, 'Vic Visiteur', 'vic@example.test', null, 'Bonjour', p_key,
                             'mobile', p_now) r;
end
$$;

-- Empreinte de tout ce qu'une réservation écrit pour PQ : réservations, jetons, outbox, analytics booking_confirmed.
create function pg_temp.written() returns text
language sql as $$
  select concat_ws('/',
    (select count(*) from carnet.bookings where profile_id = '00000000-0000-4000-8000-003950000010'),
    (select count(*) from carnet.booking_tokens t join carnet.bookings b on b.id = t.booking_id
      where b.profile_id = '00000000-0000-4000-8000-003950000010'),
    (select count(*) from carnet.outbox where profile_id = '00000000-0000-4000-8000-003950000010'),
    (select count(*) from carnet.analytics_events
      where profile_id = '00000000-0000-4000-8000-003950000010' and type = 'booking_confirmed'))
$$;

create temp table snapshot (label text primary key, value text);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00395000000a', 'q-carnet-0039q@test.local'),
  ('00000000-0000-4000-8000-00395000000b', 'r-carnet-0039q@test.local');

insert into platform.project_members (project_id, user_id, role)
  select p.id, u.id, 'user'
    from platform.projects p
   cross join (values ('00000000-0000-4000-8000-00395000000a'::uuid), ('00000000-0000-4000-8000-00395000000b'::uuid)) as u (id)
   where p.slug = 'carnet';

insert into carnet.profiles (id, owner_id, slug, display_name, is_published) values
  ('00000000-0000-4000-8000-003950000010', '00000000-0000-4000-8000-00395000000a', 'qui-0039q', 'Qui', true),
  ('00000000-0000-4000-8000-003950000011', '00000000-0000-4000-8000-00395000000b', 'roy-0039q', 'Roy', true);

select lives_ok(
  $$insert into carnet.event_types (id, profile_id, title, duration_min, buffer_min, min_notice_min, location_kind, location_text, is_active, position) values
      ('00000000-0000-4000-8000-0039500000e0', '00000000-0000-4000-8000-003950000010', 'Appel', 30, 0, 0, 'video', null, true, 0),
      ('00000000-0000-4000-8000-0039500000e1', '00000000-0000-4000-8000-003950000011', 'Appel', 30, 0, 0, 'video', null, true, 0)$$,
  'fixture : types de rendez-vous de PQ et PR'
);
select lives_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-003950000010', tstzrange('2027-03-02 00:00Z', '2027-03-03 00:00Z'), 'extra'),
      ('00000000-0000-4000-8000-003950000011', tstzrange('2027-03-02 00:00Z', '2027-03-03 00:00Z'), 'extra')$$,
  'fixture : ouverture ponctuelle le mardi 2 mars 2027 pour PQ et PR'
);
select lives_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, consent_at,
                                 idempotency_key, created_at)
      select '00000000-0000-4000-8000-003950000010', '00000000-0000-4000-8000-0039500000e0',
             tstzrange(s.start, s.start + interval '30 minutes', '[)'), 'Ancien Visiteur', 'ancien@example.test',
             s.created_at, s.key, s.created_at
        from (
          select '2027-03-10 00:00Z'::timestamptz + make_interval(hours => i) as start,
                 ('00000000-0000-4000-8000-0039500001' || lpad(i::text, 2, '0'))::uuid as key,
                 '2027-03-01 11:00Z'::timestamptz as created_at
            from generate_series(1, 17) i
          union all
          values ('2027-03-02 05:00Z'::timestamptz, '00000000-0000-4000-8000-003950000118'::uuid, '2027-03-01 11:00Z'::timestamptz),
                 ('2027-03-11 01:00Z', '00000000-0000-4000-8000-003950000119', '2027-02-28 13:01Z'),
                 ('2027-03-11 02:00Z', '00000000-0000-4000-8000-003950000120', '2027-02-28 12:59Z')
        ) s$$,
  'fixture : 20 réservations semées pour PQ (19 créées dans les 23 h avant T ; une créée à T − 23 h 01)'
);
select is(
  pg_temp.txt($$select count(*)::text from carnet.bookings
                 where profile_id = '00000000-0000-4000-8000-003950000010'
                   and created_at > '2027-03-01 12:00Z'::timestamptz - interval '23 hours'$$),
  '19',
  'fixture : 19 réservations de PQ créées dans les 23 h précédant T'
);

-- ---------------------------------------------------------------------------
-- Un échec ne consomme rien (CN001, CN002 à 19 réservations comptées)
-- ---------------------------------------------------------------------------
select is(
  pg_temp.state($$select pg_temp.book('taken', 'qui-0039q', '00000000-0000-4000-8000-0039500000e0', '2027-03-02 05:00Z',
                                      '00000000-0000-4000-8000-0039500002a1', '2027-03-01 12:00Z')$$),
  'CN001',
  'point 8 : créneau déjà pris à 19 réservations comptées → CN001 (slot_taken), pas CN005'
);
select is(
  pg_temp.state($$select pg_temp.book('unavailable', 'qui-0039q', '00000000-0000-4000-8000-0039500000e0', '2027-03-04 09:00Z',
                                      '00000000-0000-4000-8000-0039500002a2', '2027-03-01 12:00Z')$$),
  'CN002',
  'point 8 : créneau hors disponibilités → CN002 (slot_unavailable)'
);
select is(pg_temp.written(), '20/0/0/0', 'point 8 : CN001 et CN002 n''ont rien écrit');

-- ---------------------------------------------------------------------------
-- 20e réservation acceptée : les échecs et la réservation de plus de 23 h ne comptent pas
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select pg_temp.book('k20', 'qui-0039q', '00000000-0000-4000-8000-0039500000e0', '2027-03-02 08:00Z',
                        '00000000-0000-4000-8000-0039500002b0', '2027-03-01 12:00Z')$$,
  'point 8 : 20e réservation acceptée (échecs non comptés ; réservation créée à T − 23 h 01 hors fenêtre)'
);
select is(pg_temp.written(), '21/1/1/1', 'point 8 : la 20e réservation écrit réservation, jeton, outbox et analytics');

insert into snapshot values ('at_cap', pg_temp.written());

-- ---------------------------------------------------------------------------
-- 21e réservation refusée : CN005, rien d'écrit
-- ---------------------------------------------------------------------------
select is(
  pg_temp.state($$select pg_temp.book('k21', 'qui-0039q', '00000000-0000-4000-8000-0039500000e0', '2027-03-02 09:00Z',
                                      '00000000-0000-4000-8000-0039500002b1', '2027-03-01 12:00Z')$$),
  'CN005',
  'point 8 : 21e réservation dans les 23 h → CN005 (quota du profil)'
);
select is(pg_temp.written(), (select value from snapshot where label = 'at_cap'),
  'point 8 / critère 2 : CN005 n''écrit rien (ni réservation, ni jeton, ni outbox, ni analytics)');
select is(
  pg_temp.txt($$select count(*)::text from carnet.bookings where idempotency_key = '00000000-0000-4000-8000-0039500002b1'$$),
  '0',
  'point 8 : aucune réservation avec la clé refusée'
);
select lives_ok(
  $$select pg_temp.book('aged', 'qui-0039q', '00000000-0000-4000-8000-0039500000e0', '2027-03-02 09:30Z',
                        '00000000-0000-4000-8000-0039500002b2', '2027-03-01 12:02Z')$$,
  'point 8 : à T + 2 min, la réservation créée à T − 22 h 59 a 23 h 01 → hors fenêtre, réservation acceptée'
);
select is(
  pg_temp.state($$select pg_temp.book('k21-again', 'qui-0039q', '00000000-0000-4000-8000-0039500000e0', '2027-03-02 10:30Z',
                                      '00000000-0000-4000-8000-0039500002b3', '2027-03-01 12:03Z')$$),
  'CN005',
  'point 8 : de nouveau 20 réservations dans les 23 h → CN005'
);

update snapshot set value = pg_temp.written() where label = 'at_cap';

-- ---------------------------------------------------------------------------
-- Rejeu au plafond : toujours un succès, rien d'écrit
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select pg_temp.book('k20-replay', 'qui-0039q', '00000000-0000-4000-8000-0039500000e0', '2027-03-02 08:00Z',
                        '00000000-0000-4000-8000-0039500002b0', '2027-03-01 12:05Z')$$,
  'point 8 / idempotence : rejeu de la clé de la 20e réservation au plafond → succès (pas CN005)'
);
select ok(
  coalesce((select r.booking_id = k.booking_id and r.cancel_token is null
              from res r, res k where r.label = 'k20-replay' and k.label = 'k20'), false),
  'point 8 / idempotence : le rejeu renvoie la même réservation, jeton nul'
);
select lives_ok(
  $$select pg_temp.book('seed-replay', 'qui-0039q', '00000000-0000-4000-8000-0039500000e0', '2027-03-02 10:00Z',
                        '00000000-0000-4000-8000-003950000101', '2027-03-01 12:05Z')$$,
  'point 8 / idempotence : rejeu d''une clé déjà enregistrée (autre créneau) au plafond → succès'
);
select is(
  (select booking_id from res where label = 'seed-replay'),
  (select id from carnet.bookings where idempotency_key = '00000000-0000-4000-8000-003950000101'),
  'point 8 / idempotence : le rejeu renvoie la réservation existante'
);
select is(pg_temp.written(), (select value from snapshot where label = 'at_cap'), 'point 8 : les rejeux n''écrivent rien');

-- ---------------------------------------------------------------------------
-- Le quota est par profil ; la fenêtre glisse
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select pg_temp.book('other-profile', 'roy-0039q', '00000000-0000-4000-8000-0039500000e1', '2027-03-02 09:00Z',
                        '00000000-0000-4000-8000-0039500002c0', '2027-03-01 12:00Z')$$,
  'point 8 : PQ au plafond n''empêche pas une réservation chez PR'
);
select lives_ok(
  $$select pg_temp.book('slid', 'qui-0039q', '00000000-0000-4000-8000-0039500000e0', '2027-03-02 14:00Z',
                        '00000000-0000-4000-8000-0039500002d0', '2027-03-02 10:02Z')$$,
  'point 8 : 22 h 02 après T, les réservations créées à T − 1 h sortent de la fenêtre → réservation acceptée'
);
select lives_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, status, visitor_name, visitor_email, consent_at,
                                 idempotency_key, cancelled_at, cancelled_by, created_at)
      select '00000000-0000-4000-8000-003950000010', '00000000-0000-4000-8000-0039500000e0',
             tstzrange('2027-03-12 00:00Z'::timestamptz + make_interval(hours => i),
                       '2027-03-12 00:30Z'::timestamptz + make_interval(hours => i), '[)'),
             'cancelled', 'Ancien Visiteur', 'ancien@example.test', '2027-03-02 10:03Z',
             ('00000000-0000-4000-8000-0039500003' || lpad(i::text, 2, '0'))::uuid,
             '2027-03-02 10:03Z', 'visitor', '2027-03-02 10:03Z'
        from generate_series(1, 17) i$$,
  'fixture : 17 réservations de PQ créées à T + 22 h 03 puis annulées (3 réservations confirmées déjà dans la fenêtre)'
);
select lives_ok(
  $$select pg_temp.book('cancelled-free', 'qui-0039q', '00000000-0000-4000-8000-0039500000e0', '2027-03-02 15:00Z',
                        '00000000-0000-4000-8000-0039500002d1', '2027-03-02 10:04Z')$$,
  'point 8 : les 17 réservations annulées ne comptent pas (3 confirmées dans les 23 h) → réservation acceptée'
);

-- ---------------------------------------------------------------------------
-- Au plafond, annuler une réservation confirmée libère une place
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, consent_at,
                                 idempotency_key, created_at)
      select '00000000-0000-4000-8000-003950000010', '00000000-0000-4000-8000-0039500000e0',
             tstzrange('2027-03-13 00:00Z'::timestamptz + make_interval(hours => i),
                       '2027-03-13 00:30Z'::timestamptz + make_interval(hours => i), '[)'),
             'Ancien Visiteur', 'ancien@example.test', '2027-03-02 10:05Z',
             ('00000000-0000-4000-8000-0039500004' || lpad(i::text, 2, '0'))::uuid,
             '2027-03-02 10:05Z'
        from generate_series(1, 16) i$$,
  'fixture : 16 réservations confirmées de PQ créées à T + 22 h 05 (20 confirmées dans les 23 h)'
);
select is(
  pg_temp.state($$select pg_temp.book('cap-again', 'qui-0039q', '00000000-0000-4000-8000-0039500000e0', '2027-03-02 16:00Z',
                                      '00000000-0000-4000-8000-0039500002d2', '2027-03-02 10:06Z')$$),
  'CN005',
  'point 8 : 20 réservations confirmées dans les 23 h → CN005'
);
select lives_ok(
  $$update carnet.bookings
       set status = 'cancelled', cancelled_at = '2027-03-02 10:07Z', cancelled_by = 'owner'
     where idempotency_key = '00000000-0000-4000-8000-003950000401'$$,
  'fixture : le propriétaire annule une des 20 réservations confirmées'
);
select lives_ok(
  $$select pg_temp.book('freed', 'qui-0039q', '00000000-0000-4000-8000-0039500000e0', '2027-03-02 17:00Z',
                        '00000000-0000-4000-8000-0039500002d3', '2027-03-02 10:08Z')$$,
  'point 8 : au plafond, l''annulation d''une réservation confirmée libère une place → réservation acceptée'
);
select is(
  pg_temp.txt($$select count(*)::text from carnet.bookings where profile_id = '00000000-0000-4000-8000-003950000010'$$),
  '58',
  'point 8 : seules les réservations acceptées et semées existent (20 + 3 + 17 + 1 + 16 + 1)'
);

select * from finish();
rollback;
