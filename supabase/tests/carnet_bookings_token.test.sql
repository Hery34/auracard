-- Fiche 0036 / ADR 0016 §7 — annulation et report par le visiteur (jeton), annulation par le propriétaire :
-- carnet.cancel_booking_by_token_at / cancel_booking_by_token, carnet.reschedule_booking_by_token_at /
-- reschedule_booking_by_token, carnet.cancel_own_booking, carnet.get_booking_by_token_at / get_booking_by_token
-- (page d'annulation et de report, 0040), carnet.booking_tokens (plusieurs jetons valides par réservation).
-- Critères couverts : 2 (idempotence des trois opérations : rejouées, aucun second événement), 3 (le nouveau créneau
-- d'un report suit les mêmes règles que book_slot, DST compris), 4 (un autre propriétaire ou un compte d'un autre
-- projet n'annule rien ; jeton faux → refus sans oracle). Décisions 7, 9, 12 ; points 14, 15, 16 et 18.
-- Contrat (voir aussi l'en-tête de carnet_bookings_schema.test.sql) :
--   cancel_booking_by_token_at(p_token text, p_now timestamptz) returns uuid :
--     réservation trouvée par booking_tokens.token_hash = sha256(convert_to(p_token, 'UTF8')) (n'importe lequel de
--     ses jetons) ; jeton nul, vide, inconnu ou
--     de casse différente → P0002, message identique ; déjà annulée (par le visiteur, le propriétaire ou un report) →
--     renvoie son id, aucune écriture (cancelled_at et cancelled_by inchangés) ; lower(range) < p_now +
--     min_notice_min du type → CN003, rien d'écrit (borne incluse : exactement le délai est accepté) ; sinon
--     status cancelled, cancelled_at = p_now, cancelled_by visitor, outbox booking.cancelled payload =
--     {"booking_id", "cancelled_by": "visitor"} exactement, dans la même transaction.
--   reschedule_booking_by_token_at(p_token text, p_start timestamptz, p_idempotency_key uuid, p_now timestamptz)
--     returns table (booking_id uuid, cancel_token text) :
--     22023 si p_idempotency_key ou p_start nul ; jeton inconnu → P0002 ; rejeu : une réservation (profil, clé)
--     existe avec rescheduled_from = réservation du jeton → (son id, null), aucune écriture ; clé déjà portée par une
--     autre réservation du profil (réservation directe ou report d'une autre réservation) → 22023, rien d'écrit ;
--     réservation du jeton annulée ou profil dépublié → P0002, même message que le jeton inconnu (l'annulation par
--     jeton reste possible sur un profil dépublié) ; lower(range) ancienne < p_now + délai → CN003 ; nouveau créneau validé comme book_slot_at
--     (même type, CN002 / CN001, alignement et horizon compris), l'ancienne réservation n'étant pas comptée comme
--     occupation ; type désactivé depuis la réservation → CN002 (après CN003 ; l'annulation reste possible) ; puis : ancienne →
--     cancelled (cancelled_at = p_now, cancelled_by visitor) ; nouvelle → confirmed, même profil, type et données
--     visiteur, consent_at de l'ancienne, created_at = p_now, rescheduled_from = ancienne, idempotency_key =
--     p_idempotency_key, nouveau jeton (64 hex) dont seul le hachage est stocké (booking_tokens de la nouvelle) ;
--     les jetons de l'ancienne restent en table mais ne donnent plus accès (réservation annulée) ; outbox : un seul booking.rescheduled
--     payload = {"booking_id" (nouvelle), "previous_booking_id", "cancel_token" (nouveau)} exactement ; ni
--     booking.cancelled, ni booking.confirmed, ni booking_confirmed dans analytics_events. Échec → rien d'écrit.
--   cancel_own_booking(p_booking_id uuid) returns void (authenticated) : réservation d'un profil que l'appelant peut
--     éditer (is_member et can_edit_profile), à tout moment (aucun délai minimal) ; sinon P0002, même message
--     (réservation d'autrui, inconnue, compte d'un autre projet) ; déjà annulée ou déjà commencée (lower(range) <=
--     now(), point 18) → sans effet, sans erreur, aucun événement ; sinon cancelled, cancelled_at = now(),
--     cancelled_by owner, outbox booking.cancelled {"booking_id", "cancelled_by": "owner"}.
--   get_booking_by_token_at(p_token text, p_now timestamptz) returns jsonb (stable, aucune écriture) :
--     SQL null, sans distinction (aucun oracle), si le jeton est nul, vide, inconnu, si la réservation est annulée
--     (par le visiteur, le propriétaire ou un report) ou si elle a commencé (lower(range) <= p_now) ; sinon exactement
--     {"booking_id", "start", "end" (lower / upper de range), "event_type_id", "event_type_title", "duration_min",
--      "location_kind", "location_text" (valeur de la colonne, quel que soit le mode : le porteur du jeton est le
--      visiteur), "time_zone" (du profil), "profile_slug", "owner_display_name" (profiles.display_name),
--      "can_cancel" (lower(range) >= p_now + min_notice_min), "can_reschedule" (can_cancel, type actif et profil
--      publié, point 18)}. Profil dépublié : la page reste renvoyée (annulation possible).
--     Aucune donnée visiteur. Tous les jetons d'une réservation confirmée et à venir donnent la même réponse.
--   Enveloppes cancel_booking_by_token(p_token), reschedule_booking_by_token(p_token, p_start, p_idempotency_key) et
--     get_booking_by_token(p_token) : variantes _at avec now(), service_role seul.
-- Personas (UUID fixes, plage 0036 4xxx propre à ce fichier) :
--   A 0…a membre carnet, profil PA 0…10 publié (ana-0036t), Europe/Paris ; e0 (30 min, tampon 15, délai 120, video,
--     lien de visio),
--     e1 (60 min, tampon 0, délai 1440) ; règles lun–ven 09–12 et 14–18, dimanche 09–12
--   B 0…b membre carnet, profil PB 0…11 (ben-0036t) ; C 0…d membre du projet other_0036t seul ; N 0…e sans profil
--   W 0…f membre carnet, profil PW 0…14 publié (wil-0036t) ; e6 (30 min, délai 120) ; extra de now() + 1 j à + 3 j
-- Horloge : T = 2027-03-01 12:00Z (lundi, 13:00 à Paris) pour les variantes _at ; enveloppes relatives à now().
-- Tout est annulé par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(103);

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

create function pg_temp.err(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end
$$;

create temp table res (label text, booking_id uuid, cancel_token text);
grant select, insert on res to authenticated, service_role;

create function pg_temp.book(p_label text, p_type uuid, p_start timestamptz, p_key uuid)
returns void
language plpgsql as $$
begin
  insert into res (label, booking_id, cancel_token)
  select p_label, r.booking_id, r.cancel_token
    from carnet.book_slot_at('ana-0036t', p_type, p_start, 'Vic Visiteur', 'vic@example.test', '+33 6 11 22 33 44',
                             E'Bonjour,\nà bientôt', p_key, 'mobile', '2027-03-01 12:00Z') r;
end
$$;

create function pg_temp.cancel(p_label text, p_token text, p_now timestamptz)
returns void
language plpgsql as $$
begin
  insert into res (label, booking_id) values (p_label, carnet.cancel_booking_by_token_at(p_token, p_now));
end
$$;

create function pg_temp.resched(p_label text, p_token text, p_start timestamptz, p_key uuid, p_now timestamptz)
returns void
language plpgsql as $$
begin
  insert into res (label, booking_id, cancel_token)
  select p_label, r.booking_id, r.cancel_token from carnet.reschedule_booking_by_token_at(p_token, p_start, p_key, p_now) r;
end
$$;

create function pg_temp.tok(p_label text) returns text language sql stable as $$
  select cancel_token from res where label = p_label
$$;

-- Réservation brute (postgres) avec un jeton connu (ligne booking_tokens).
create function pg_temp.raw_booking(p_profile uuid, p_type uuid, p_start timestamptz, p_minutes integer, p_token text)
returns uuid
language plpgsql as $$
declare
  v uuid;
begin
  insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, consent_at, idempotency_key)
  values (p_profile, p_type, tstzrange(p_start, p_start + make_interval(mins => p_minutes), '[)'), 'Vic',
          'vic@example.test', now(), gen_random_uuid())
  returning id into v;
  insert into carnet.booking_tokens (token_hash, booking_id) values (sha256(convert_to(p_token, 'UTF8')), v);
  return v;
end
$$;

-- Lecture de la page d'annulation (horloge injectée) ; null si la fonction n'existe pas encore.
create function pg_temp.page(p_token text, p_now timestamptz) returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  execute 'select carnet.get_booking_by_token_at($1, $2)' into v using p_token, p_now;
  return v;
exception when undefined_table or undefined_function or undefined_column or invalid_schema_name or undefined_object then
  return null;
end
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00364000000a', 'a-carnet-0036t@test.local'),
  ('00000000-0000-4000-8000-00364000000b', 'b-carnet-0036t@test.local'),
  ('00000000-0000-4000-8000-00364000000d', 'c-other-0036t@test.local'),
  ('00000000-0000-4000-8000-00364000000e', 'n-carnet-0036t@test.local'),
  ('00000000-0000-4000-8000-00364000000f', 'w-carnet-0036t@test.local');

insert into platform.projects (id, slug, name, db_schema)
  values ('00000000-0000-4000-8000-003640000002', 'other_0036t', 'Other 0036t', 'other_0036t');
insert into platform.project_members (project_id, user_id, role)
  select p.id, u.id, 'user'
    from platform.projects p
   cross join (values ('00000000-0000-4000-8000-00364000000a'::uuid), ('00000000-0000-4000-8000-00364000000b'::uuid),
                      ('00000000-0000-4000-8000-00364000000e'::uuid), ('00000000-0000-4000-8000-00364000000f'::uuid)) as u (id)
   where p.slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  values ('00000000-0000-4000-8000-003640000002', '00000000-0000-4000-8000-00364000000d', 'user');

insert into carnet.profiles (id, owner_id, slug, display_name, is_published) values
  ('00000000-0000-4000-8000-003640000010', '00000000-0000-4000-8000-00364000000a', 'ana-0036t', 'Ana', true),
  ('00000000-0000-4000-8000-003640000011', '00000000-0000-4000-8000-00364000000b', 'ben-0036t', 'Ben', true),
  ('00000000-0000-4000-8000-003640000014', '00000000-0000-4000-8000-00364000000f', 'wil-0036t', 'Wil', true);

select lives_ok(
  $$insert into carnet.event_types (id, profile_id, title, duration_min, buffer_min, min_notice_min, location_kind, location_text, position) values
      ('00000000-0000-4000-8000-0036400000e0', '00000000-0000-4000-8000-003640000010', 'Appel', 30, 15, 120, 'video', 'https://visio.example.test/ana', 0),
      ('00000000-0000-4000-8000-0036400000e1', '00000000-0000-4000-8000-003640000010', 'Rendez-vous', 60, 0, 1440, 'in_person', null, 1),
      ('00000000-0000-4000-8000-0036400000e6', '00000000-0000-4000-8000-003640000014', 'Wil', 30, 0, 120, 'video', null, 0)$$,
  'fixture : types de rendez-vous'
);
select lives_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time)
      select '00000000-0000-4000-8000-003640000010', d, t.s, t.e
        from generate_series(1, 5) d, (values ('09:00'::time, '12:00'::time), ('14:00', '18:00')) t (s, e)
      union all
      values ('00000000-0000-4000-8000-003640000010'::uuid, 7, '09:00'::time, '12:00'::time)$$,
  'fixture : règles de PA'
);
select lives_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind)
      values ('00000000-0000-4000-8000-003640000014', tstzrange(date_trunc('minute', now()) + interval '1 day', date_trunc('minute', now()) + interval '3 days'), 'extra')$$,
  'fixture : exception extra de PW'
);
select lives_ok(
  $$select pg_temp.book('r1', '00000000-0000-4000-8000-0036400000e0', '2027-03-03 08:00Z', '00000000-0000-4000-8000-0036400000a1'),
           pg_temp.book('r2', '00000000-0000-4000-8000-0036400000e0', '2027-03-03 10:00Z', '00000000-0000-4000-8000-0036400000a2'),
           pg_temp.book('c1', '00000000-0000-4000-8000-0036400000e0', '2027-03-04 08:00Z', '00000000-0000-4000-8000-0036400000a3'),
           pg_temp.book('c2', '00000000-0000-4000-8000-0036400000e0', '2027-03-01 14:00Z', '00000000-0000-4000-8000-0036400000a4'),
           pg_temp.book('c3', '00000000-0000-4000-8000-0036400000e1', '2027-03-02 13:00Z', '00000000-0000-4000-8000-0036400000a5'),
           pg_temp.book('o1', '00000000-0000-4000-8000-0036400000e0', '2027-03-04 10:00Z', '00000000-0000-4000-8000-0036400000a6')$$,
  'fixture : six réservations de PA par book_slot_at (T = 2027-03-01 12:00Z)'
);
select lives_ok(
  $$insert into carnet.booking_tokens (token_hash, booking_id)
      values (sha256(convert_to(repeat('7', 64), 'UTF8')), (select booking_id from res where label = 'r2'))$$,
  'fixture : second jeton valide pour r2 (comme celui d''un rappel)'
);

-- ---------------------------------------------------------------------------
-- Point 15 — get_booking_by_token_at (page d'annulation et de report)
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.page(pg_temp.tok('r2'), '2027-03-01 12:00Z')) k),
  array['booking_id', 'can_cancel', 'can_reschedule', 'duration_min', 'end', 'event_type_id', 'event_type_title',
        'location_kind', 'location_text', 'owner_display_name', 'profile_slug', 'start', 'time_zone'],
  'point 15 : la page a exactement les clés du contrat (aucune donnée visiteur)'
);
select is(
  (select row(j ->> 'booking_id' = (select booking_id::text from res where label = 'r2'), (j ->> 'start')::timestamptz,
              (j ->> 'end')::timestamptz, j ->> 'event_type_id', j ->> 'event_type_title', (j ->> 'duration_min')::int,
              j ->> 'location_kind', j ->> 'location_text', j ->> 'time_zone', j ->> 'profile_slug',
              j ->> 'owner_display_name', (j ->> 'can_cancel')::boolean, (j ->> 'can_reschedule')::boolean)::text
     from (select pg_temp.page(pg_temp.tok('r2'), '2027-03-01 12:00Z') j) x),
  row(true, '2027-03-03 10:00Z'::timestamptz, '2027-03-03 10:30Z'::timestamptz, '00000000-0000-4000-8000-0036400000e0'::text,
      'Appel'::text, 30, 'video'::text, 'https://visio.example.test/ana'::text, 'Europe/Paris'::text, 'ana-0036t'::text,
      'Ana'::text, true, true)::text,
  'point 15 : valeurs de la page pour r2 (réservation, type, lieu même video, fuseau, slug, propriétaire, actions possibles)'
);
select ok(
  coalesce(pg_temp.page(repeat('7', 64), '2027-03-01 12:00Z') = pg_temp.page(pg_temp.tok('r2'), '2027-03-01 12:00Z'), false),
  'point 14 : le second jeton de r2 donne la même page (plusieurs jetons valides)'
);
select is(
  (select row((j ->> 'can_cancel')::boolean, (j ->> 'can_reschedule')::boolean)::text
     from (select pg_temp.page(pg_temp.tok('c2'), '2027-03-01 12:01Z') j) x),
  '(f,f)',
  'point 15 : c2 dans 119 min pour un délai de 120 → page renvoyée, ni annulation ni report possibles'
);
select is(
  (select ((pg_temp.page(pg_temp.tok('c2'), '2027-03-01 12:00Z')) ->> 'can_cancel')::boolean),
  true,
  'point 15 : c2 exactement 120 min avant → annulation possible (borne incluse, comme CN003)'
);
select ok(
  pg_temp.page(pg_temp.tok('r2'), '2027-03-03 09:59Z') is not null,
  'point 15 : r2 une minute avant son début → page renvoyée'
);
select ok(
  pg_temp.page(pg_temp.tok('r2'), '2027-03-03 10:00Z') is null and pg_temp.page(pg_temp.tok('r2'), '2027-03-04 00:00Z') is null,
  'point 15 : réservation commencée ou passée → null'
);
select ok(
  pg_temp.page(repeat('0', 64), '2027-03-01 12:00Z') is null and pg_temp.page(null, '2027-03-01 12:00Z') is null
  and pg_temp.page('', '2027-03-01 12:00Z') is null and pg_temp.page(upper(pg_temp.tok('r1')), '2027-03-01 12:00Z') is null
  and to_regprocedure('carnet.get_booking_by_token_at(text, timestamptz)') is not null,
  'point 15 : jeton inconnu, nul, vide ou de casse différente → null (même réponse, aucune erreur)'
);

-- ---------------------------------------------------------------------------
-- Annulation par jeton
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select pg_temp.cancel('c1_done', pg_temp.tok('c1'), '2027-03-01 12:00Z')$$,
  'décision 7 : le visiteur annule c1 avec son jeton'
);
select ok(
  coalesce((select d.booking_id = c.booking_id from res d, res c where d.label = 'c1_done' and c.label = 'c1'), false),
  'décision 7 : cancel_booking_by_token_at renvoie l''id de la réservation annulée'
);
select is(
  pg_temp.txt($$select row(status, cancelled_at, cancelled_by)::text from carnet.bookings where id = (select booking_id from res where label = 'c1')$$),
  row('cancelled'::text, '2027-03-01 12:00Z'::timestamptz, 'visitor'::text)::text,
  'décision 7 : c1 passe cancelled, cancelled_at = horloge, cancelled_by = visitor'
);
select is(
  pg_temp.txt($$select row(o.type, o.profile_id, o.status, o.payload = jsonb_build_object('booking_id', r.booking_id, 'cancelled_by', 'visitor'))::text
                  from carnet.outbox o join res r on o.payload ->> 'booking_id' = r.booking_id::text
                 where r.label = 'c1' and o.type = 'booking.cancelled'$$),
  row('booking.cancelled'::text, '00000000-0000-4000-8000-003640000010'::uuid, 'pending'::text, true)::text,
  'décision 9 : booking.cancelled, payload = {booking_id, cancelled_by: visitor} exactement (pas de jeton)'
);
select lives_ok(
  $$select pg_temp.cancel('c1_replay', pg_temp.tok('c1'), '2027-03-01 13:00Z')$$,
  'critère 2 : annulation rejouée sans erreur'
);
select is(
  pg_temp.txt($$select row((select booking_id from res where label = 'c1_replay') = b.id, b.cancelled_at,
                           (select count(*) from carnet.outbox where type = 'booking.cancelled' and payload ->> 'booking_id' = b.id::text))::text
                  from carnet.bookings b where b.id = (select booking_id from res where label = 'c1')$$),
  row(true, '2027-03-01 12:00Z'::timestamptz, 1)::text,
  'critère 2 : le rejeu renvoie le même id, ne change pas cancelled_at, n''écrit pas de second événement'
);
select lives_ok(
  $$select pg_temp.book('c1_rebook', '00000000-0000-4000-8000-0036400000e0', '2027-03-04 08:00Z', '00000000-0000-4000-8000-0036400000a7')$$,
  'décision 7 : le créneau libéré par l''annulation est de nouveau réservable'
);
select ok(
  pg_temp.page(pg_temp.tok('c1'), '2027-03-01 12:00Z') is null
  and to_regprocedure('carnet.get_booking_by_token_at(text, timestamptz)') is not null,
  'point 15 : réservation annulée → null, comme un jeton inconnu (aucun oracle)'
);

-- Refus sans oracle
select throws_ok($$select pg_temp.cancel('x', repeat('0', 64), '2027-03-01 12:00Z')$$, 'P0002', null, 'critère 4 : jeton inconnu → P0002');
select throws_ok($$select pg_temp.cancel('x', null, '2027-03-01 12:00Z')$$, 'P0002', null, 'critère 4 : jeton nul → P0002');
select throws_ok($$select pg_temp.cancel('x', '', '2027-03-01 12:00Z')$$, 'P0002', null, 'critère 4 : jeton vide → P0002');
select throws_ok(
  $$select pg_temp.cancel('x', upper(pg_temp.tok('r1')), '2027-03-01 12:00Z')$$,
  'P0002', null, 'décision 12 : jeton de casse différente → P0002 (comparaison exacte du hachage)'
);
select ok(
  pg_temp.err($$select pg_temp.cancel('x', repeat('0', 64), '2027-03-01 12:00Z')$$)
  = pg_temp.err($$select pg_temp.cancel('x', 'court', '2027-03-01 12:00Z')$$)
  and pg_temp.err($$select pg_temp.cancel('x', null, '2027-03-01 12:00Z')$$) = pg_temp.err($$select pg_temp.cancel('x', repeat('0', 64), '2027-03-01 12:00Z')$$)
  and pg_temp.err($$select pg_temp.cancel('x', repeat('0', 64), '2027-03-01 12:00Z')$$) like 'P0002: %',
  'critère 4 : jeton inconnu, mal formé ou nul → même code, même message (aucun oracle)'
);
select is(
  pg_temp.txt($$select string_agg(status, ',' order by r.label) from carnet.bookings b join res r on r.booking_id = b.id
                 where r.label in ('r1', 'r2', 'c2', 'c3', 'o1')$$),
  'confirmed,confirmed,confirmed,confirmed,confirmed',
  'critère 4 : les refus n''ont touché aucune autre réservation'
);

-- Délai minimal (CN003)
select throws_ok(
  $$select pg_temp.cancel('x', pg_temp.tok('c2'), '2027-03-01 12:01Z')$$,
  'CN003', null, 'ADR 0016 §7 : c2 commence dans 119 min pour un délai de 120 → CN003'
);
select throws_ok(
  $$select pg_temp.cancel('x', pg_temp.tok('c3'), '2027-03-01 13:30Z')$$,
  'CN003', null, 'ADR 0016 §7 : c3 commence dans 23 h 30 pour un délai de 24 h → CN003'
);
select throws_ok(
  $$select pg_temp.cancel('x', pg_temp.tok('r2'), '2027-03-03 10:30Z')$$,
  'CN003', null, 'ADR 0016 §7 : rendez-vous déjà commencé → CN003'
);
select is(
  pg_temp.txt($$select string_agg(status, ',' order by r.label) from carnet.bookings b join res r on r.booking_id = b.id
                 where r.label in ('c2', 'c3', 'r2')$$),
  'confirmed,confirmed,confirmed',
  'ADR 0016 §7 : les refus CN003 laissent les réservations confirmées'
);
select lives_ok(
  $$select pg_temp.cancel('c2_done', pg_temp.tok('c2'), '2027-03-01 12:00Z')$$,
  'ADR 0016 §7 : c2 annulée exactement 120 min avant (borne incluse)'
);
select is(
  pg_temp.txt($$select count(*)::text from carnet.outbox where type = 'booking.cancelled' and profile_id = '00000000-0000-4000-8000-003640000010'$$),
  '2',
  'décision 9 : deux booking.cancelled au total (c1, c2), aucun pour les refus'
);

-- ---------------------------------------------------------------------------
-- Report par jeton
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select pg_temp.resched('n1', pg_temp.tok('r1'), '2027-03-03 08:30Z', '00000000-0000-4000-8000-0036400000b1', '2027-03-01 12:00Z')$$,
  'décision 7 : report de r1 vers 08:30Z (dans le tampon de l''ancien créneau, qui ne compte pas comme occupé)'
);
select ok(
  coalesce((select n.booking_id <> r.booking_id and n.cancel_token ~ '^[0-9a-f]{64}$' and n.cancel_token <> r.cancel_token
              from res n, res r where n.label = 'n1' and r.label = 'r1'), false),
  'décision 12 : le report renvoie une nouvelle réservation et un nouveau jeton en clair'
);
select is(
  pg_temp.txt($$select row(status, cancelled_at, cancelled_by)::text from carnet.bookings where id = (select booking_id from res where label = 'r1')$$),
  row('cancelled'::text, '2027-03-01 12:00Z'::timestamptz, 'visitor'::text)::text,
  'décision 7 : l''ancienne réservation passe cancelled (visitor, horloge)'
);
select is(
  pg_temp.txt($$select row(n.profile_id = o.profile_id, n.event_type_id = o.event_type_id, n.range, n.status,
                           n.visitor_name = o.visitor_name and n.visitor_email = o.visitor_email
                             and n.visitor_phone = o.visitor_phone and n.message = o.message,
                           n.consent_at = o.consent_at, n.created_at, n.rescheduled_from = o.id, n.idempotency_key,
                           (select array_agg(t.token_hash) from carnet.booking_tokens t where t.booking_id = n.id)
                             = array[sha256(convert_to((select cancel_token from res where label = 'n1'), 'UTF8'))])::text
                  from carnet.bookings n, carnet.bookings o
                 where n.id = (select booking_id from res where label = 'n1') and o.id = (select booking_id from res where label = 'r1')$$),
  row(true, true, tstzrange('2027-03-03 08:30Z', '2027-03-03 09:00Z', '[)'), 'confirmed'::text, true, true,
      '2027-03-01 12:00Z'::timestamptz, true, '00000000-0000-4000-8000-0036400000b1'::uuid, true)::text,
  'décision 7 et point 14 : la nouvelle réservation reprend profil, type, visiteur et consentement, porte rescheduled_from et un seul jeton (le nouveau)'
);
select ok(
  pg_temp.page(pg_temp.tok('r1'), '2027-03-01 12:00Z') is null
  and ((pg_temp.page(pg_temp.tok('n1'), '2027-03-01 12:00Z')) ->> 'start')::timestamptz = '2027-03-03 08:30Z',
  'point 15 : après report, l''ancien jeton ne donne plus rien, le nouveau ouvre la nouvelle réservation'
);
select is(
  pg_temp.txt($$select row(o.type, o.status, o.payload = jsonb_build_object('booking_id', n.booking_id, 'previous_booking_id', r.booking_id,
                                                                            'cancel_token', n.cancel_token))::text
                  from carnet.outbox o, res n, res r
                 where n.label = 'n1' and r.label = 'r1' and o.type = 'booking.rescheduled' and o.payload ->> 'booking_id' = n.booking_id::text$$),
  row('booking.rescheduled'::text, 'pending'::text, true)::text,
  'décision 9 : booking.rescheduled, payload = {booking_id, previous_booking_id, cancel_token} exactement (nouveau jeton, message visiteur)'
);
select is(
  pg_temp.txt($$select row((select count(*) from carnet.outbox where type = 'booking.rescheduled'),
                           (select count(*) from carnet.outbox where payload ->> 'booking_id' = r.booking_id::text and type = 'booking.cancelled'),
                           (select count(*) from carnet.outbox where payload ->> 'booking_id' = n.booking_id::text and type = 'booking.confirmed'),
                           (select count(*) from carnet.analytics_events where id = n.booking_id))::text
                  from res n, res r where n.label = 'n1' and r.label = 'r1'$$),
  '(1,0,0,0)',
  'décision 9 : un seul booking.rescheduled ; ni booking.cancelled pour l''ancienne, ni booking.confirmed ni booking_confirmed pour la nouvelle'
);
select lives_ok(
  $$select pg_temp.resched('n1_replay', pg_temp.tok('r1'), '2027-03-03 08:30Z', '00000000-0000-4000-8000-0036400000b1', '2027-03-01 12:05Z')$$,
  'critère 2 : report rejoué (même jeton, même clé) sans erreur'
);
select ok(
  coalesce((select x.booking_id = n.booking_id and x.cancel_token is null from res x, res n where x.label = 'n1_replay' and n.label = 'n1'), false),
  'critère 2 : le rejeu renvoie la même nouvelle réservation, sans jeton'
);
select is(
  pg_temp.txt($$select count(*)::text from carnet.booking_tokens where booking_id = (select booking_id from res where label = 'n1')$$),
  '1',
  'critère 2 et point 14 : le rejeu n''ajoute aucun jeton'
);
select is(
  pg_temp.txt($$select row((select count(*) from carnet.bookings where profile_id = '00000000-0000-4000-8000-003640000010'),
                           (select count(*) from carnet.outbox where type = 'booking.rescheduled'))::text$$),
  '(8,1)',
  'critère 2 : après le rejeu, toujours 8 réservations pour PA et un seul booking.rescheduled'
);
select throws_ok(
  $$select pg_temp.resched('x', pg_temp.tok('r1'), '2027-03-03 09:00Z', '00000000-0000-4000-8000-0036400000b2', '2027-03-01 12:00Z')$$,
  'P0002', null, 'ADR 0016 §7 : l''ancien jeton avec une autre clé ne reporte plus (réservation annulée → P0002)'
);
select throws_ok(
  $$select pg_temp.resched('x', pg_temp.tok('c1'), '2027-03-03 09:00Z', '00000000-0000-4000-8000-0036400000b3', '2027-03-01 12:00Z')$$,
  'P0002', null, 'ADR 0016 §7 : une réservation annulée ne se reporte pas (P0002)'
);
select throws_ok(
  $$select pg_temp.resched('x', repeat('0', 64), '2027-03-03 09:00Z', '00000000-0000-4000-8000-0036400000b4', '2027-03-01 12:00Z')$$,
  'P0002', null, 'critère 4 : report avec un jeton inconnu → P0002'
);
select throws_ok(
  $$select pg_temp.resched('x', pg_temp.tok('r2'), '2027-03-03 09:00Z', null, '2027-03-01 12:00Z')$$,
  '22023', null, 'idempotence : report sans clé → 22023'
);
select throws_ok(
  $$select pg_temp.resched('x', pg_temp.tok('r2'), '2027-03-06 09:00Z', '00000000-0000-4000-8000-0036400000b5', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 3 : report vers un samedi sans disponibilité → CN002'
);
select throws_ok(
  $$select pg_temp.resched('x', pg_temp.tok('r2'), '2027-03-01 13:00Z', '00000000-0000-4000-8000-0036400000b6', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 3 : report vers un créneau dans le délai minimal → CN002'
);
select throws_ok(
  $$select pg_temp.resched('x', pg_temp.tok('r2'), '2027-03-03 09:15Z', '00000000-0000-4000-8000-0036400000bc', '2027-03-01 12:00Z')$$,
  'CN002', null, 'point 15 : report vers 10:15 (Paris), non aligné sur le pas de 30 min depuis 09:00 → CN002'
);
select throws_ok(
  $$select pg_temp.resched('x', pg_temp.tok('r2'), '2027-05-03 07:00Z', '00000000-0000-4000-8000-0036400000bd', '2027-03-01 12:00Z')$$,
  'CN002', null, 'point 15 : report au-delà de p_now + 60 jours → CN002'
);
select throws_ok(
  $$select pg_temp.resched('x', pg_temp.tok('r2'), '2027-03-03 08:30Z', '00000000-0000-4000-8000-0036400000b7', '2027-03-01 12:00Z')$$,
  'CN001', null, 'critère 1 : report sur la nouvelle réservation n1 → CN001'
);
select throws_ok(
  $$select pg_temp.resched('x', pg_temp.tok('c3'), '2027-03-03 14:00Z', '00000000-0000-4000-8000-0036400000b8', '2027-03-01 13:30Z')$$,
  'CN003', null, 'ADR 0016 §7 : report d''un rendez-vous qui commence avant le délai minimal → CN003'
);
select throws_ok(
  $$select pg_temp.resched('x', pg_temp.tok('r2'), '2027-03-28 06:30Z', '00000000-0000-4000-8000-0036400000b9', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 5 : report au dimanche 28 mars 06:30Z = 08:30 CEST → CN002'
);
select is(
  pg_temp.txt($$select row((select status from carnet.bookings where id = (select booking_id from res where label = 'r2')),
                           (select count(*) from carnet.bookings where idempotency_key::text between '00000000-0000-4000-8000-0036400000b2'
                                                                                         and '00000000-0000-4000-8000-0036400000b9'
                                                                         or idempotency_key::text in ('00000000-0000-4000-8000-0036400000bc',
                                                                                                      '00000000-0000-4000-8000-0036400000bd')))::text$$),
  '(confirmed,0)',
  'décision 7 : les reports refusés n''écrivent rien et laissent r2 confirmée'
);
select lives_ok(
  $$select pg_temp.resched('n2', repeat('7', 64), '2027-03-28 07:00Z', '00000000-0000-4000-8000-0036400000ba', '2027-03-01 12:00Z')$$,
  'critère 5 et point 14 : report de r2 avec son second jeton au dimanche 28 mars 07:00Z = 09:00 CEST accepté'
);
select is(
  pg_temp.txt($$select range::text from carnet.bookings where id = (select booking_id from res where label = 'n2')$$),
  tstzrange('2027-03-28 07:00Z', '2027-03-28 07:30Z', '[)')::text,
  'critère 5 : la réservation reportée porte la plage UTC attendue'
);
select lives_ok(
  $$select pg_temp.cancel('n1_cancel', pg_temp.tok('n1'), '2027-03-01 12:00Z')$$,
  'décision 12 : le nouveau jeton annule la réservation reportée'
);
select is(
  pg_temp.txt($$select status from carnet.bookings where id = (select booking_id from res where label = 'n1')$$),
  'cancelled',
  'décision 12 : n1 est annulée par son jeton'
);

-- Point 15 — type désactivé : report refusé (CN002), annulation possible
select lives_ok(
  $$select pg_temp.book('d1', '00000000-0000-4000-8000-0036400000e1', '2027-03-05 13:00Z', '00000000-0000-4000-8000-0036400000a8')$$,
  'fixture : d1 (e1) vendredi 5 mars 14:00 (Paris)'
);
select lives_ok(
  $$update carnet.event_types set is_active = false where id = '00000000-0000-4000-8000-0036400000e1'$$,
  'fixture : le propriétaire désactive e1'
);
select is(
  (select row((j ->> 'can_cancel')::boolean, (j ->> 'can_reschedule')::boolean)::text
     from (select pg_temp.page(pg_temp.tok('d1'), '2027-03-01 12:00Z') j) x),
  '(t,f)',
  'point 15 : type désactivé → la page propose l''annulation, pas le report'
);
select throws_ok(
  $$select pg_temp.resched('x', pg_temp.tok('d1'), '2027-03-05 15:00Z', '00000000-0000-4000-8000-0036400000be', '2027-03-01 12:00Z')$$,
  'CN002', null, 'point 15 : report d''une réservation dont le type a été désactivé → CN002'
);
select lives_ok(
  $$select pg_temp.cancel('d1_done', pg_temp.tok('d1'), '2027-03-01 12:00Z')$$,
  'point 15 : l''annulation par jeton reste possible pour un type désactivé'
);
select is(
  pg_temp.txt($$select row(status, cancelled_by)::text from carnet.bookings where id = (select booking_id from res where label = 'd1')$$),
  '(cancelled,visitor)',
  'point 15 : d1 annulée par le visiteur'
);

-- Point 16 — profil dépublié : report refusé (P0002, sans oracle), annulation possible
select lives_ok(
  $$select pg_temp.book('p1', '00000000-0000-4000-8000-0036400000e0', '2027-03-08 08:00Z', '00000000-0000-4000-8000-0036400000a9'),
           pg_temp.book('q1', '00000000-0000-4000-8000-0036400000e0', '2027-03-09 08:00Z', '00000000-0000-4000-8000-0036400000aa')$$,
  'fixture : p1 lundi 8 mars et q1 mardi 9 mars 09:00 (Paris), type e0'
);
select lives_ok(
  $$update carnet.profiles set is_published = false where id = '00000000-0000-4000-8000-003640000010'$$,
  'fixture : A dépublie PA'
);
select is(
  (select row(j ->> 'booking_id' = (select booking_id::text from res where label = 'p1'),
              (j ->> 'can_cancel')::boolean, (j ->> 'can_reschedule')::boolean)::text
     from (select pg_temp.page(pg_temp.tok('p1'), '2027-03-01 12:00Z') j) x),
  '(t,t,f)',
  'point 18 : profil dépublié → la page reste lisible, propose l''annulation mais pas le report (can_reschedule faux)'
);
select throws_ok(
  $$select pg_temp.resched('x', pg_temp.tok('p1'), '2027-03-08 09:00Z', '00000000-0000-4000-8000-0036400000bf', '2027-03-01 12:00Z')$$,
  'P0002', null, 'point 16 : report d''une réservation d''un profil dépublié → P0002'
);
select ok(
  pg_temp.err($$select pg_temp.resched('x', pg_temp.tok('p1'), '2027-03-08 09:00Z', '00000000-0000-4000-8000-0036400000bf', '2027-03-01 12:00Z')$$)
  = pg_temp.err($$select pg_temp.resched('x', repeat('0', 64), '2027-03-08 09:00Z', '00000000-0000-4000-8000-0036400000bf', '2027-03-01 12:00Z')$$),
  'point 16 : profil dépublié ou jeton inconnu → même code, même message (aucun oracle)'
);
select is(
  pg_temp.txt($$select row((select status from carnet.bookings where id = (select booking_id from res where label = 'p1')),
                           (select count(*) from carnet.bookings where idempotency_key = '00000000-0000-4000-8000-0036400000bf'))::text$$),
  '(confirmed,0)',
  'point 16 : le report refusé n''écrit rien et laisse p1 confirmée'
);
select lives_ok(
  $$select pg_temp.cancel('p1_done', pg_temp.tok('p1'), '2027-03-01 12:00Z')$$,
  'point 16 : l''annulation par jeton reste possible sur un profil dépublié'
);
select is(
  pg_temp.txt($$select row(status, cancelled_by)::text from carnet.bookings where id = (select booking_id from res where label = 'p1')$$),
  '(cancelled,visitor)',
  'point 16 : p1 annulée par le visiteur malgré la dépublication'
);
select lives_ok(
  $$update carnet.profiles set is_published = true where id = '00000000-0000-4000-8000-003640000010'$$,
  'fixture : A republie PA'
);

-- Point 16 — clé d'idempotence déjà portée par une autre réservation du profil → 22023 (plus de 23505 brut)
select throws_ok(
  $$select pg_temp.resched('x', pg_temp.tok('q1'), '2027-03-09 09:00Z', '00000000-0000-4000-8000-0036400000a3', '2027-03-01 12:00Z')$$,
  '22023', null, 'point 16 : report de q1 avec la clé de la réservation c1 → 22023'
);
select throws_ok(
  $$select pg_temp.resched('x', pg_temp.tok('q1'), '2027-03-09 09:00Z', '00000000-0000-4000-8000-0036400000b1', '2027-03-01 12:00Z')$$,
  '22023', null, 'point 16 : report de q1 avec la clé du report r1 → n1 (pas un rejeu de q1) → 22023'
);
select is(
  pg_temp.txt($$select row(b.status, (select count(*) from carnet.bookings where rescheduled_from = b.id),
                           (select count(*) from carnet.outbox where type = 'booking.rescheduled' and payload ->> 'previous_booking_id' = b.id::text))::text
                  from carnet.bookings b where b.id = (select booking_id from res where label = 'q1')$$),
  '(confirmed,0,0)',
  'point 16 : les reports refusés pour clé déjà prise n''écrivent rien (q1 confirmée, aucun report, aucun événement)'
);

-- ---------------------------------------------------------------------------
-- Annulation par le propriétaire
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select set_config('t0036t.o2', pg_temp.raw_booking('00000000-0000-4000-8000-003640000010', '00000000-0000-4000-8000-0036400000e0',
                                                       now() + interval '10 minutes', 30, repeat('9', 64))::text, true),
           set_config('t0036t.o3', pg_temp.raw_booking('00000000-0000-4000-8000-003640000010', '00000000-0000-4000-8000-0036400000e0',
                                                       now() - interval '5 minutes', 10, repeat('8', 64))::text, true)$$,
  'fixture : o2 commence dans 10 minutes, o3 a commencé il y a 5 minutes (horloge réelle)'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00364000000b","role":"authenticated"}';
select throws_ok(
  $$select carnet.cancel_own_booking((select booking_id from res where label = 'o1'))$$,
  'P0002', null, 'critère 4 : B n''annule pas la réservation de A (P0002)'
);
select ok(
  pg_temp.err($$select carnet.cancel_own_booking((select booking_id from res where label = 'o1'))$$)
  = pg_temp.err($$select carnet.cancel_own_booking('00000000-0000-4000-8000-0036400000ff')$$)
  and pg_temp.err($$select carnet.cancel_own_booking('00000000-0000-4000-8000-0036400000ff')$$) like 'P0002: %',
  'critère 4 : réservation d''autrui ou inconnue → même code, même message'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00364000000e","role":"authenticated"}';
select throws_ok(
  $$select carnet.cancel_own_booking((select booking_id from res where label = 'o1'))$$,
  'P0002', null, 'critère 4 : un membre sans profil n''annule rien (P0002)'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00364000000d","role":"authenticated"}';
select throws_ok(
  $$select carnet.cancel_own_booking((select booking_id from res where label = 'o1'))$$,
  'P0002', null, 'critère 4 : un compte d''un autre projet n''annule rien (P0002)'
);
reset role;
select is(
  pg_temp.txt($$select status from carnet.bookings where id = (select booking_id from res where label = 'o1')$$),
  'confirmed',
  'critère 4 : o1 reste confirmée après les tentatives d''autrui'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00364000000a","role":"authenticated"}';
select lives_ok(
  $$select carnet.cancel_own_booking((select booking_id from res where label = 'o1'))$$,
  'décision 7 : A annule sa réservation o1'
);
select lives_ok(
  $$select carnet.cancel_own_booking((select booking_id from res where label = 'o1'))$$,
  'critère 2 : annulation par le propriétaire rejouée sans erreur'
);
select lives_ok(
  $$select carnet.cancel_own_booking(current_setting('t0036t.o2', true)::uuid)$$,
  'ADR 0016 §7 : le propriétaire annule à tout moment (o2 commence dans 10 minutes)'
);
select lives_ok(
  $$select carnet.cancel_own_booking(current_setting('t0036t.o3', true)::uuid)$$,
  'point 18 : annuler un rendez-vous déjà commencé (o3) ne lève pas d''erreur'
);
select throws_ok(
  $$select carnet.cancel_own_booking('00000000-0000-4000-8000-0036400000ff')$$,
  'P0002', null, 'décision 7 : réservation inconnue → P0002'
);
reset role;
select is(
  pg_temp.txt($$select row(b.status, b.cancelled_at, b.cancelled_by,
                           (select count(*) from carnet.outbox o where o.payload ->> 'booking_id' = b.id::text))::text
                  from carnet.bookings b where b.id = current_setting('t0036t.o3', true)::uuid$$),
  '(confirmed,,,0)',
  'point 18 : rendez-vous commencé → cancel_own_booking sans effet (o3 confirmée, aucun événement outbox)'
);
select is(
  pg_temp.txt($$select row(status, cancelled_at = now(), cancelled_by)::text from carnet.bookings where id = (select booking_id from res where label = 'o1')$$),
  row('cancelled'::text, true, 'owner'::text)::text,
  'décision 7 : o1 passe cancelled, cancelled_at = now(), cancelled_by = owner'
);
select is(
  pg_temp.txt($$select row(count(*), bool_and(o.payload = jsonb_build_object('booking_id', r.booking_id, 'cancelled_by', 'owner')))::text
                  from carnet.outbox o join res r on o.payload ->> 'booking_id' = r.booking_id::text
                 where r.label = 'o1' and o.type = 'booking.cancelled'$$),
  '(1,t)',
  'critère 2 et décision 9 : un seul booking.cancelled pour o1, payload = {booking_id, cancelled_by: owner} (visiteur prévenu)'
);
select is(
  pg_temp.txt($$select row(status, cancelled_by)::text from carnet.bookings where id = current_setting('t0036t.o2', true)::uuid$$),
  row('cancelled'::text, 'owner'::text)::text,
  'ADR 0016 §7 : o2 annulée par le propriétaire malgré le délai minimal'
);
select lives_ok(
  $$select pg_temp.cancel('o1_visitor', pg_temp.tok('o1'), '2027-03-01 12:00Z')$$,
  'décision 7 : le visiteur annule ensuite par jeton une réservation déjà annulée par le propriétaire, sans erreur'
);
select is(
  pg_temp.txt($$select row(b.cancelled_by, (select count(*) from carnet.outbox where type = 'booking.cancelled' and payload ->> 'booking_id' = b.id::text))::text
                  from carnet.bookings b where b.id = (select booking_id from res where label = 'o1')$$),
  row('owner'::text, 1)::text,
  'critère 2 : cancelled_by reste owner, aucun second événement'
);

-- ---------------------------------------------------------------------------
-- Enveloppes à horloge réelle (service_role)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select set_config('t0036t.w1', pg_temp.raw_booking('00000000-0000-4000-8000-003640000014', '00000000-0000-4000-8000-0036400000e6',
                                                       now() + interval '1 day 1 hour', 30, repeat('ab', 32))::text, true),
           set_config('t0036t.w2', pg_temp.raw_booking('00000000-0000-4000-8000-003640000014', '00000000-0000-4000-8000-0036400000e6',
                                                       now() + interval '1 day 3 hours', 30, repeat('cd', 32))::text, true),
           set_config('t0036t.w3', pg_temp.raw_booking('00000000-0000-4000-8000-003640000014', '00000000-0000-4000-8000-0036400000e6',
                                                       now() + interval '30 minutes', 30, repeat('ef', 32))::text, true)$$,
  'fixture : réservations de PW à horloge réelle (w1, w2 demain, w3 dans 30 minutes)'
);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select ok(
  coalesce(pg_temp.txt($$select carnet.cancel_booking_by_token(repeat('ab', 32))::text$$) = current_setting('t0036t.w1', true), false),
  'décision 7 : cancel_booking_by_token (service_role) annule w1 et renvoie son id'
);
select throws_ok(
  $$select carnet.cancel_booking_by_token(repeat('ef', 32))$$,
  'CN003', null, 'ADR 0016 §7 : cancel_booking_by_token applique le délai avec now() (w3 dans 30 min → CN003)'
);
select lives_ok(
  $$insert into res (label, booking_id, cancel_token)
      select 'w2_new', r.booking_id, r.cancel_token
        from carnet.reschedule_booking_by_token(repeat('cd', 32), date_trunc('minute', now()) + interval '2 days', '00000000-0000-4000-8000-0036400000c1') r$$,
  'décision 7 : reschedule_booking_by_token (service_role) reporte w2 dans l''exception extra'
);
reset role;
select is(
  pg_temp.txt($$select row(o.status, o.cancelled_at = now(), n.status, n.rescheduled_from = o.id, n.created_at = now(), lower(n.range) = date_trunc('minute', now()) + interval '2 days')::text
                  from carnet.bookings o, carnet.bookings n
                 where o.id = current_setting('t0036t.w2', true)::uuid and n.id = (select booking_id from res where label = 'w2_new')$$),
  '(cancelled,t,confirmed,t,t,t)',
  'décision 7 : les enveloppes équivalent aux variantes _at avec now()'
);
select is(
  pg_temp.txt($$select status from carnet.bookings where id = current_setting('t0036t.w1', true)::uuid$$) || ','
  || pg_temp.txt($$select status from carnet.bookings where id = current_setting('t0036t.w3', true)::uuid$$),
  'cancelled,confirmed',
  'décision 7 : w1 annulée, w3 inchangée'
);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select ok(
  coalesce(pg_temp.txt($$select (carnet.get_booking_by_token(repeat('ef', 32)) ->> 'booking_id')$$) = current_setting('t0036t.w3', true), false),
  'point 15 : get_booking_by_token (service_role) renvoie la page de w3 avec now()'
);
select ok(
  coalesce(pg_temp.txt($$select (carnet.get_booking_by_token(repeat('ab', 32)) is null)::text$$)::boolean, false),
  'point 15 : get_booking_by_token sur w1 annulée → null'
);
reset role;

select * from finish();
rollback;
