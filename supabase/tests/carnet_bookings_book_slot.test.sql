-- Fiche 0036 / ADR 0016 — réservation publique : carnet.book_slot_at (horloge injectée) et carnet.book_slot.
-- Critères couverts : 1 (pas de chevauchement, tampons compris ; la concurrence réelle est hors pgTAP), 2 (rejeu de la
-- même clé : même réservation, aucun doublon, un seul événement outbox et analytics), 3 (refus hors disponibilités,
-- exception busy, délai minimal, horizon de 60 jours, début non aligné sur le pas), 5 (changements d'heure Europe/Paris
-- de mars et d'octobre 2027, fuseau sans DST Asia/Tokyo, fuseau de session « visiteur » sans effet). Décisions 7, 9,
-- 10, 12 ; points 14 (booking_tokens) et 15 (alignement, horizon figé). Le verrou transactionnel par profil
-- (pg_advisory_xact_lock) n'est pas observable dans une seule session pgTAP : la concurrence réelle est testée en
-- intégration (0039) ; ici, le comportement séquentiel du tampon (CN001 tampons compris) reste couvert.
-- Contrat (voir aussi l'en-tête de carnet_bookings_schema.test.sql) — book_slot_at(p_slug, p_event_type_id, p_start,
-- p_visitor_name, p_visitor_email, p_visitor_phone, p_message, p_idempotency_key, p_device_class, p_now)
-- returns table (booking_id uuid, cancel_token text), dans cet ordre :
--   1. 22023 : p_device_class nul ou hors (mobile, desktop), p_idempotency_key nul, p_start nul — avant toute lecture.
--   2. P0002 : slug inconnu ou profil non publié (message identique).
--   3. Rejeu : une réservation (profile_id, p_idempotency_key) existe → renvoie (son id, cancel_token = null), sans
--      aucune écriture ni contrôle de créneau (même si le créneau est passé ou si le contenu diffère).
--   4. P0002 : type inconnu, d'un autre profil ou inactif.
--   5. 22023 : location_kind = 'phone' et téléphone nul ou blanc.
--   6. CN002 : p_start < p_now + min_notice_min ; p_start > p_now + interval '60 days' (borne figée à l'instant, incluse :
--      p_start = p_now + 60 days accepté, + 60 days 30 min refusé ; délai inclus testé à la minute).
--   7. CN002 : le rendez-vous [p_start, p_start + duration_min) n'est pas entièrement contenu dans une règle du jour
--      local (fuseau du profil, jour ISO et heures locales, quelle que soit la TimeZone de session) ni dans une
--      exception extra ; ou il n'est pas aligné : (p_start − début de la plage qui le contient) doit être un multiple
--      de duration_min, le début de plage étant l'instant (timestamptz) du début de la règle ce jour-là dans le fuseau
--      du profil, ou lower(range) de l'exception extra (le pas se compte en durée réelle, DST compris) ; ou
--      [p_start, p_start + duration_min + buffer_min) chevauche une exception busy.
--      Le tampon peut dépasser la fin d'une règle ou d'une exception extra, jamais entrer dans une exception busy.
--   8. CN001 : [p_start, fin + buffer_min) chevauche [lower, upper + buffer_min de son type) d'une réservation
--      confirmée du profil (contiguïté acceptée) ; 23P01 de la contrainte traduit en CN001.
--   9. Insertion : range = [p_start, p_start + duration_min) '[)', status confirmed, consent_at = created_at = p_now,
--      cancel_token = 64 caractères hexadécimaux minuscules (256 bits aléatoires) ; une ligne booking_tokens
--      (token_hash = sha256(convert_to(cancel_token, 'UTF8')), booking_id) ; le clair n'est écrit nulle part ailleurs
--      que dans l'outbox. Un rejeu n'ajoute aucun jeton.
--      Même transaction : outbox booking.confirmed payload = {"booking_id", "cancel_token"} exactement, et
--      analytics_events (id = booking_id, type booking_confirmed, source direct, device_class = p_device_class).
--      Données visiteur invalides : 23514 (contraintes), rien d'écrit. Point 18 : p_message vide ou blanc
--      (btrim = '') enregistré null, comme le téléphone.
-- book_slot(…) = book_slot_at(…, now()), service_role seul.
-- Personas (UUID fixes, plage 0036 3xxx propre à ce fichier) :
--   A 0…a membre carnet, profil PA 0…10 publié (ana-0036b), Europe/Paris ; types e0 (30 min, tampon 30, délai 120,
--     video), e1 (60 min, tampon 0, délai 1440, in_person), e2 (inactif), e3 (30 min, tampon 0, délai 0, phone),
--     e7 (45 min, tampon 0, délai 0, video) ; règles lun–ven 09–12 et 14–18, dimanche 01–04 et 09–12 ; busy ven 5 mars
--     2027 08:15Z–08:45Z et 14:00Z–15:00Z ; extra sam 6 mars 2027 09:00Z–10:30Z
--   B 0…b membre carnet, profil PB 0…11 publié (ben-0036b), Asia/Tokyo (sans DST) ; type e4 (60 min, délai 0) ;
--     règles lundi 06–08 et 09–17
--   U 0…c membre carnet, profil PU 0…12 non publié (uma-0036b) ; type e5
--   W 0…f membre carnet, profil PW 0…14 publié (wil-0036b) ; type e6 (30 min, délai 120) ; extra autour de now()
--     (bornes à la minute, point 17 : date_trunc('minute', now()) − 1 h à + 8 h)
-- Horloges : T_MAR = 2027-03-01 12:00Z (lundi), T_OCT = 2027-10-01 12:00Z (vendredi) ; book_slot (enveloppe) testée
-- relativement à now(), figé dans la transaction.
-- Dates : changement d'heure 2027-03-28 01:00Z (CET → CEST) et 2027-10-31 01:00Z (CEST → CET).
-- Tout est annulé par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(119);

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

-- SQLSTATE et message d'une instruction ('OK' si elle réussit) : comparaison de refus sans oracle.
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
grant select, insert on res to service_role;

create function pg_temp.book(p_label text, p_slug text, p_type uuid, p_start timestamptz, p_key uuid, p_now timestamptz,
                             p_phone text default null, p_device text default 'mobile',
                             p_name text default 'Vic Visiteur', p_email text default 'vic@example.test')
returns void
language plpgsql as $$
begin
  insert into res (label, booking_id, cancel_token)
  select p_label, r.booking_id, r.cancel_token
    from carnet.book_slot_at(p_slug, p_type, p_start, p_name, p_email, p_phone, 'Bonjour', p_key, p_device, p_now) r;
end
$$;

create function pg_temp.book_now(p_label text, p_slug text, p_type uuid, p_start timestamptz, p_key uuid)
returns void
language plpgsql as $$
begin
  insert into res (label, booking_id, cancel_token)
  select p_label, r.booking_id, r.cancel_token
    from carnet.book_slot(p_slug, p_type, p_start, 'Vic Visiteur', 'vic@example.test', null, 'Bonjour', p_key, 'desktop') r;
end
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00363000000a', 'a-carnet-0036b@test.local'),
  ('00000000-0000-4000-8000-00363000000b', 'b-carnet-0036b@test.local'),
  ('00000000-0000-4000-8000-00363000000c', 'u-carnet-0036b@test.local'),
  ('00000000-0000-4000-8000-00363000000f', 'w-carnet-0036b@test.local');

insert into platform.project_members (project_id, user_id, role)
  select p.id, u.id, 'user'
    from platform.projects p
   cross join (values ('00000000-0000-4000-8000-00363000000a'::uuid), ('00000000-0000-4000-8000-00363000000b'::uuid),
                      ('00000000-0000-4000-8000-00363000000c'::uuid), ('00000000-0000-4000-8000-00363000000f'::uuid)) as u (id)
   where p.slug = 'carnet';

insert into carnet.profiles (id, owner_id, slug, display_name, is_published) values
  ('00000000-0000-4000-8000-003630000010', '00000000-0000-4000-8000-00363000000a', 'ana-0036b', 'Ana', true),
  ('00000000-0000-4000-8000-003630000011', '00000000-0000-4000-8000-00363000000b', 'ben-0036b', 'Ben', true),
  ('00000000-0000-4000-8000-003630000012', '00000000-0000-4000-8000-00363000000c', 'uma-0036b', 'Uma', false),
  ('00000000-0000-4000-8000-003630000014', '00000000-0000-4000-8000-00363000000f', 'wil-0036b', 'Wil', true);

select lives_ok(
  $$update carnet.profiles set time_zone = 'Asia/Tokyo' where id = '00000000-0000-4000-8000-003630000011'$$,
  'fixture : PB est en Asia/Tokyo'
);
select lives_ok(
  $$insert into carnet.event_types (id, profile_id, title, duration_min, buffer_min, min_notice_min, location_kind, location_text, is_active, position) values
      ('00000000-0000-4000-8000-0036300000e0', '00000000-0000-4000-8000-003630000010', 'Appel', 30, 30, 120, 'video', 'https://visio.example.test/ana', true, 0),
      ('00000000-0000-4000-8000-0036300000e1', '00000000-0000-4000-8000-003630000010', 'Rendez-vous', 60, 0, 1440, 'in_person', '1 rue de Paris', true, 1),
      ('00000000-0000-4000-8000-0036300000e2', '00000000-0000-4000-8000-003630000010', 'Ancien', 30, 0, 0, 'video', null, false, 2),
      ('00000000-0000-4000-8000-0036300000e3', '00000000-0000-4000-8000-003630000010', 'Téléphone', 30, 0, 0, 'phone', null, true, 3),
      ('00000000-0000-4000-8000-0036300000e7', '00000000-0000-4000-8000-003630000010', 'Atelier', 45, 0, 0, 'video', null, true, 4),
      ('00000000-0000-4000-8000-0036300000e4', '00000000-0000-4000-8000-003630000011', 'Call', 60, 0, 0, 'video', null, true, 0),
      ('00000000-0000-4000-8000-0036300000e5', '00000000-0000-4000-8000-003630000012', 'Uma', 30, 0, 0, 'video', null, true, 0),
      ('00000000-0000-4000-8000-0036300000e6', '00000000-0000-4000-8000-003630000014', 'Wil', 30, 0, 120, 'video', null, true, 0)$$,
  'fixture : types de rendez-vous'
);
select lives_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time)
      select '00000000-0000-4000-8000-003630000010', d, t.s, t.e
        from generate_series(1, 5) d, (values ('09:00'::time, '12:00'::time), ('14:00', '18:00')) t (s, e)
      union all
      values ('00000000-0000-4000-8000-003630000010'::uuid, 7, '01:00'::time, '04:00'::time),
             ('00000000-0000-4000-8000-003630000010', 7, '09:00', '12:00'),
             ('00000000-0000-4000-8000-003630000011', 1, '06:00', '08:00'),
             ('00000000-0000-4000-8000-003630000011', 1, '09:00', '17:00'),
             ('00000000-0000-4000-8000-003630000012', 1, '09:00', '12:00')$$,
  'fixture : règles (PA lun–ven et dimanche, PB lundi en heure de Tokyo, PU lundi)'
);
select lives_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-003630000010', tstzrange('2027-03-05 08:15Z', '2027-03-05 08:45Z'), 'busy'),
      ('00000000-0000-4000-8000-003630000010', tstzrange('2027-03-05 14:00Z', '2027-03-05 15:00Z'), 'busy'),
      ('00000000-0000-4000-8000-003630000010', tstzrange('2027-03-06 09:00Z', '2027-03-06 10:30Z'), 'extra'),
      ('00000000-0000-4000-8000-003630000014', tstzrange(date_trunc('minute', now()) - interval '1 hour', date_trunc('minute', now()) + interval '8 hours'), 'extra')$$,
  'fixture : exceptions (busy et extra de PA, extra de PW autour de now())'
);

-- ---------------------------------------------------------------------------
-- Décision 7 / critère 2 — première réservation
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select pg_temp.book('b1', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-03 08:00Z',
                        '00000000-0000-4000-8000-0036300000a1', '2027-03-01 12:00Z')$$,
  'décision 7 : réservation e0 mercredi 3 mars 09:00 (Paris, CET) acceptée'
);
select ok(
  coalesce((select booking_id is not null and cancel_token ~ '^[0-9a-f]{64}$' from res where label = 'b1'), false),
  'décision 12 : book_slot_at renvoie l''id et un jeton en clair de 64 caractères hexadécimaux'
);
select is(
  pg_temp.txt($$select row(b.profile_id, b.event_type_id, b.range, b.status, b.visitor_name, b.visitor_email, b.visitor_phone,
                           b.message, b.consent_at, b.created_at, b.idempotency_key, b.cancelled_at, b.cancelled_by,
                           b.rescheduled_from, b.reminder_queued_at)::text
                  from carnet.bookings b where b.id = (select booking_id from res where label = 'b1')$$),
  row('00000000-0000-4000-8000-003630000010'::uuid, '00000000-0000-4000-8000-0036300000e0'::uuid,
      tstzrange('2027-03-03 08:00Z', '2027-03-03 08:30Z', '[)'), 'confirmed'::text, 'Vic Visiteur'::text,
      'vic@example.test'::text, null::text, 'Bonjour'::text, '2027-03-01 12:00Z'::timestamptz,
      '2027-03-01 12:00Z'::timestamptz, '00000000-0000-4000-8000-0036300000a1'::uuid, null::timestamptz, null::text,
      null::uuid, null::timestamptz)::text,
  'décision 7 : ligne écrite (durée imposée de 30 min, confirmed, consent_at = created_at = horloge injectée)'
);
select is(
  pg_temp.txt($$select string_agg((t.token_hash = sha256(convert_to(r.cancel_token, 'UTF8')))::text, ',')
                  from carnet.booking_tokens t join res r on r.booking_id = t.booking_id where r.label = 'b1'$$),
  'true',
  'point 14 : une seule ligne booking_tokens pour b1, token_hash = SHA-256 du jeton renvoyé'
);
select ok(
  coalesce(pg_temp.txt($$select (strpos(row_to_json(b)::text, r.cancel_token) = 0
                                 and not exists (select 1 from carnet.booking_tokens t
                                                  where t.booking_id = b.id
                                                    and strpos(row_to_json(t)::text || encode(t.token_hash, 'hex'), r.cancel_token) > 0))::text
                           from carnet.bookings b join res r on r.booking_id = b.id where r.label = 'b1'$$)::boolean, false),
  'décision 12 : le jeton en clair n''est stocké ni dans bookings ni dans booking_tokens'
);
select is(
  pg_temp.txt($$select count(*)::text from carnet.outbox o join res r on o.payload ->> 'booking_id' = r.booking_id::text
                 where r.label = 'b1'$$),
  '1',
  'critère 2 : un seul événement d''outbox pour b1'
);
select is(
  pg_temp.txt($$select row(o.type, o.profile_id, o.status, o.payload = jsonb_build_object('booking_id', r.booking_id, 'cancel_token', r.cancel_token))::text
                  from carnet.outbox o join res r on o.payload ->> 'booking_id' = r.booking_id::text where r.label = 'b1'$$),
  row('booking.confirmed'::text, '00000000-0000-4000-8000-003630000010'::uuid, 'pending'::text, true)::text,
  'décision 9 : booking.confirmed, pending, payload = {booking_id, cancel_token} exactement (jeton pour le message visiteur)'
);
select is(
  pg_temp.txt($$select row(a.profile_id, a.type, a.source, a.device_class, a.link_id)::text
                  from carnet.analytics_events a join res r on a.id = r.booking_id where r.label = 'b1'$$),
  row('00000000-0000-4000-8000-003630000010'::uuid, 'booking_confirmed'::text, 'direct'::text, 'mobile'::text, null::uuid)::text,
  'décision 10 : analytics_events booking_confirmed (id = id de la réservation, source direct, appareil transmis)'
);

-- Rejeu
select lives_ok(
  $$select pg_temp.book('b1_replay', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-03 08:00Z',
                        '00000000-0000-4000-8000-0036300000a1', '2027-03-01 12:00Z')$$,
  'critère 2 : rejeu identique sans erreur (le créneau occupé par b1 elle-même n''est pas un chevauchement)'
);
select lives_ok(
  $$select pg_temp.book('b1_replay_other', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-03-04 13:00Z',
                        '00000000-0000-4000-8000-0036300000a1', '2027-03-01 12:30Z', null, 'desktop', 'Autre', 'autre@example.test')$$,
  'critère 2 : rejeu avec la même clé et un contenu différent sans erreur'
);
select lives_ok(
  $$select pg_temp.book('b1_replay_late', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-03 08:00Z',
                        '00000000-0000-4000-8000-0036300000a1', '2027-03-03 09:00Z')$$,
  'critère 2 : rejeu après le début du rendez-vous sans erreur (le rejeu précède les contrôles de créneau)'
);
select ok(
  coalesce((select count(*) = 3 and bool_and(r.booking_id = b.booking_id and r.cancel_token is null)
              from res r, res b where r.label like 'b1\_replay%' and b.label = 'b1'), false),
  'critère 2 et décision 12 : chaque rejeu renvoie le même id et aucun jeton (jeton en clair renvoyé une seule fois)'
);
select is(
  pg_temp.txt($$select row((select count(*) from carnet.bookings where profile_id = '00000000-0000-4000-8000-003630000010'),
                           (select count(*) from carnet.outbox where profile_id = '00000000-0000-4000-8000-003630000010'),
                           (select count(*) from carnet.analytics_events where profile_id = '00000000-0000-4000-8000-003630000010'))::text$$),
  '(1,1,1)',
  'critère 2 : après trois rejeux, une réservation, un événement d''outbox, un événement de statistiques'
);
select is(
  pg_temp.txt($$select count(*)::text from carnet.booking_tokens t join res r on r.booking_id = t.booking_id where r.label = 'b1'$$),
  '1',
  'critère 2 et point 14 : les rejeux n''ajoutent aucun jeton à b1'
);
select is(
  pg_temp.txt($$select row(range, visitor_name, consent_at)::text from carnet.bookings where id = (select booking_id from res where label = 'b1')$$),
  row(tstzrange('2027-03-03 08:00Z', '2027-03-03 08:30Z', '[)'), 'Vic Visiteur'::text, '2027-03-01 12:00Z'::timestamptz)::text,
  'critère 2 : le rejeu n''a rien modifié'
);
select lives_ok(
  $$select pg_temp.book('kb', 'ben-0036b', '00000000-0000-4000-8000-0036300000e4', '2027-03-08 00:00Z',
                        '00000000-0000-4000-8000-0036300000a1', '2027-03-01 12:00Z')$$,
  'décision 5 : la même clé sur un autre profil (PB, lundi 09:00 à Tokyo) crée une réservation'
);
select ok(
  coalesce((select k.booking_id <> b.booking_id and k.cancel_token is not null from res k, res b where k.label = 'kb' and b.label = 'b1'), false),
  'décision 5 : réservation distincte, avec son propre jeton'
);

-- ---------------------------------------------------------------------------
-- Critère 1 — chevauchement, tampons compris (CN001)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-03 08:00Z', '00000000-0000-4000-8000-003630000901', '2027-03-01 12:00Z')$$,
  'CN001', null, 'critère 1 : même créneau que b1 avec une autre clé → CN001'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-03 08:30Z', '00000000-0000-4000-8000-003630000902', '2027-03-01 12:00Z')$$,
  'CN001', null, 'critère 1 : début (aligné) pendant le tampon de 30 min de b1 → CN001'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-03 08:45Z', '00000000-0000-4000-8000-003630000950', '2027-03-01 12:00Z')$$,
  'CN002', null, 'point 15 : 09:45 (Paris) n''est pas aligné sur le pas de 30 min depuis 09:00 → CN002 (et non CN001)'
);
select lives_ok(
  $$select pg_temp.book('b2', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-03 09:00Z', '00000000-0000-4000-8000-0036300000a2', '2027-03-01 12:00Z')$$,
  'critère 1 : début exactement à la fin du tampon de b1 (10:00 Paris) accepté'
);
select lives_ok(
  $$select pg_temp.book('b3', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-03-04 10:00Z', '00000000-0000-4000-8000-0036300000a3', '2027-03-01 12:00Z')$$,
  'décision 7 : e1 jeudi 4 mars 11:00–12:00 (Paris) accepté'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-04 09:30Z', '00000000-0000-4000-8000-003630000903', '2027-03-01 12:00Z')$$,
  'CN001', null, 'critère 1 : le tampon du nouveau rendez-vous (09:30–10:30Z) empiète sur b3 → CN001'
);
select lives_ok(
  $$select pg_temp.book('b4', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-04 09:00Z', '00000000-0000-4000-8000-0036300000a4', '2027-03-01 12:00Z')$$,
  'critère 1 : tampon du nouveau rendez-vous se terminant au début de b3 accepté'
);
select is(
  pg_temp.txt($$select string_agg(extract(epoch from upper(b.range) - lower(b.range))::int::text, ',' order by r.label)
                  from carnet.bookings b join res r on r.booking_id = b.id where r.label in ('b1', 'b3')$$),
  '1800,3600',
  'décision 7 : durée imposée par le type (30 min pour e0, 60 min pour e1)'
);

-- ---------------------------------------------------------------------------
-- Critère 3 — hors disponibilités (CN002)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-03 11:00Z', '00000000-0000-4000-8000-003630000904', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 3 : mercredi 12:00 (Paris), entre deux plages → CN002'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e7', '2027-03-03 16:45Z', '00000000-0000-4000-8000-003630000905', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 3 : e7 (45 min) à 17:45 (Paris), aligné depuis 14:00, déborde la plage 14–18 → CN002'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e7', '2027-03-03 16:15Z', '00000000-0000-4000-8000-003630000951', '2027-03-01 12:00Z')$$,
  'CN002', null, 'point 15 : e7 à 17:15 (Paris) n''est pas un multiple de 45 min depuis 14:00 → CN002'
);
select lives_ok(
  $$select pg_temp.book('b16', 'ana-0036b', '00000000-0000-4000-8000-0036300000e7', '2027-03-03 16:00Z', '00000000-0000-4000-8000-0036300000c3', '2027-03-01 12:00Z')$$,
  'point 15 : e7 à 17:00 (Paris) = 14:00 + 4 × 45 min, fin 17:45, accepté'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-03 07:30Z', '00000000-0000-4000-8000-003630000906', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 3 : 08:30 (Paris), avant la plage → CN002'
);
select lives_ok(
  $$select pg_temp.book('b5', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-03 10:30Z', '00000000-0000-4000-8000-0036300000a5', '2027-03-01 12:00Z')$$,
  'critère 3 : 11:30–12:00 (Paris) accepté, le tampon peut dépasser la fin de la plage'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-06 08:00Z', '00000000-0000-4000-8000-003630000907', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 3 : samedi sans règle, hors exception extra → CN002'
);
-- Exceptions busy : vendredi 5 mars 08:15Z–08:45Z (09:15–09:45 à Paris) et 14:00Z–15:00Z (15:00–16:00 à Paris)
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-05 14:00Z', '00000000-0000-4000-8000-003630000908', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 3 : rendez-vous dans l''exception busy → CN002'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-05 08:00Z', '00000000-0000-4000-8000-003630000909', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 3 : rendez-vous aligné (09:00 Paris) à cheval sur le début de l''exception busy 08:15Z → CN002'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-05 13:30Z', '00000000-0000-4000-8000-003630000910', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 3 : tampon du rendez-vous dans l''exception busy → CN002'
);
select lives_ok(
  $$select pg_temp.book('b6', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-05 13:00Z', '00000000-0000-4000-8000-0036300000a6', '2027-03-01 12:00Z')$$,
  'critère 3 : rendez-vous + tampon se terminant au début de l''exception busy accepté'
);
select lives_ok(
  $$select pg_temp.book('b7', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-05 15:00Z', '00000000-0000-4000-8000-0036300000a7', '2027-03-01 12:00Z')$$,
  'critère 3 : rendez-vous à la fin de l''exception busy accepté'
);
-- Exception extra : samedi 6 mars 09:00Z–10:30Z (10:00–11:30 à Paris) ; le pas se compte depuis lower(range).
select lives_ok(
  $$select pg_temp.book('b8', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-06 09:00Z', '00000000-0000-4000-8000-0036300000a8', '2027-03-01 12:00Z')$$,
  'critère 3 : samedi dans l''exception extra accepté'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-03-06 10:00Z', '00000000-0000-4000-8000-003630000911', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 3 : e1 aligné (10:00Z) débordant l''exception extra (fin 11:00Z > 10:30Z) → CN002'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-06 09:45Z', '00000000-0000-4000-8000-003630000952', '2027-03-01 12:00Z')$$,
  'CN002', null, 'point 15 : 09:45Z n''est pas aligné sur le pas de 30 min depuis le début de l''exception extra → CN002'
);
select lives_ok(
  $$select pg_temp.book('b9', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-06 10:00Z', '00000000-0000-4000-8000-0036300000a9', '2027-03-01 12:00Z')$$,
  'critère 3 : rendez-vous se terminant à la fin de l''exception extra (et au bout du tampon de b8) accepté'
);

-- ---------------------------------------------------------------------------
-- Critère 3 — délai minimal (T_MAR = lundi 1er mars 12:00Z = 13:00 à Paris)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-01 14:00Z', '00000000-0000-4000-8000-003630000912', '2027-03-01 12:01Z')$$,
  'CN002', null, 'critère 3 : créneau aligné à 119 min de l''horloge pour un délai de 120 → CN002'
);
select lives_ok(
  $$select pg_temp.book('b10', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-01 14:00Z', '00000000-0000-4000-8000-0036300000b0', '2027-03-01 12:00Z')$$,
  'critère 3 : exactement 120 min avant le début accepté (borne incluse)'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-03-02 10:00Z', '00000000-0000-4000-8000-003630000913', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 3 : 22 h avant le début pour un délai de 24 h → CN002'
);
select lives_ok(
  $$select pg_temp.book('b11', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-03-02 13:00Z', '00000000-0000-4000-8000-0036300000b1', '2027-03-01 12:00Z')$$,
  'critère 3 : 25 h avant le début pour un délai de 24 h accepté'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e3', '2027-03-01 08:00Z', '00000000-0000-4000-8000-003630000914', '2027-03-01 12:00Z', '+33 6 00 00 00 00')$$,
  'CN002', null, 'critère 3 : créneau passé (délai 0) → CN002'
);

-- ---------------------------------------------------------------------------
-- Critère 3 et point 15 — horizon = p_now + interval '60 days' (2027-04-30 12:00Z = 14:00 CEST, borne incluse)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select pg_temp.book('b12', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-04-29 07:00Z', '00000000-0000-4000-8000-0036300000b2', '2027-03-01 12:00Z')$$,
  'critère 3 : J+59 (jeudi 29 avril 09:00 CEST) accepté'
);
select lives_ok(
  $$select pg_temp.book('b13', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-04-30 07:00Z', '00000000-0000-4000-8000-0036300000b3', '2027-03-01 12:00Z')$$,
  'critère 3 : J+60 avant l''heure de l''horloge (vendredi 30 avril 07:00Z) accepté'
);
select lives_ok(
  $$select pg_temp.book('b15', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-04-30 12:00Z', '00000000-0000-4000-8000-0036300000c4', '2027-03-01 12:00Z')$$,
  'point 15 : début = p_now + 60 jours exactement (30 avril 12:00Z) accepté (borne incluse)'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-04-30 12:30Z', '00000000-0000-4000-8000-003630000953', '2027-03-01 12:00Z')$$,
  'CN002', null, 'point 15 : début = p_now + 60 jours 30 min (créneau aligné) → CN002 (borne figée à l''instant, pas au jour)'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-04-30 14:00Z', '00000000-0000-4000-8000-003630000915', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 3 : J+60 après l''heure de l''horloge (30 avril 14:00Z) → CN002'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-05-03 07:00Z', '00000000-0000-4000-8000-003630000916', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 3 : J+63 (lundi 3 mai) → CN002'
);

-- ---------------------------------------------------------------------------
-- Décision 7 — profil, type, téléphone, paramètres
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select pg_temp.book('x', 'zzz-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-08 08:00Z', '00000000-0000-4000-8000-003630000917', '2027-03-01 12:00Z')$$,
  'P0002', null, 'décision 7 : slug inconnu → P0002'
);
select throws_ok(
  $$select pg_temp.book('x', 'uma-0036b', '00000000-0000-4000-8000-0036300000e5', '2027-03-08 08:00Z', '00000000-0000-4000-8000-003630000918', '2027-03-01 12:00Z')$$,
  'P0002', null, 'décision 7 : profil non publié → P0002'
);
select ok(
  pg_temp.err($$select pg_temp.book('x', 'uma-0036b', '00000000-0000-4000-8000-0036300000e5', '2027-03-08 08:00Z', '00000000-0000-4000-8000-003630000918', '2027-03-01 12:00Z')$$)
  = pg_temp.err($$select pg_temp.book('x', 'zzz-0036b', '00000000-0000-4000-8000-0036300000e5', '2027-03-08 08:00Z', '00000000-0000-4000-8000-003630000918', '2027-03-01 12:00Z')$$)
  and pg_temp.err($$select pg_temp.book('x', 'zzz-0036b', '00000000-0000-4000-8000-0036300000e5', '2027-03-08 08:00Z', '00000000-0000-4000-8000-003630000918', '2027-03-01 12:00Z')$$) like 'P0002: %',
  'décision 7 : profil non publié et slug inconnu → P0002, même message (aucun oracle)'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e2', '2027-03-08 08:00Z', '00000000-0000-4000-8000-003630000919', '2027-03-01 12:00Z')$$,
  'P0002', null, 'décision 7 : type inactif → P0002'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e4', '2027-03-08 08:00Z', '00000000-0000-4000-8000-003630000920', '2027-03-01 12:00Z')$$,
  'P0002', null, 'décision 7 : type d''un autre profil → P0002'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000ef', '2027-03-08 08:00Z', '00000000-0000-4000-8000-003630000921', '2027-03-01 12:00Z')$$,
  'P0002', null, 'décision 7 : type inconnu → P0002'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e3', '2027-03-08 08:00Z', '00000000-0000-4000-8000-003630000922', '2027-03-01 12:00Z')$$,
  '22023', null, 'ADR 0016 §8 : type phone sans téléphone → 22023'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e3', '2027-03-08 08:00Z', '00000000-0000-4000-8000-003630000923', '2027-03-01 12:00Z', '   ')$$,
  '22023', null, 'ADR 0016 §8 : type phone avec téléphone blanc → 22023'
);
select lives_ok(
  $$select pg_temp.book('b14', 'ana-0036b', '00000000-0000-4000-8000-0036300000e3', '2027-03-08 08:00Z', '00000000-0000-4000-8000-0036300000b4', '2027-03-01 12:00Z', '+33 6 12 34 56 78')$$,
  'ADR 0016 §8 : type phone avec téléphone accepté'
);
select is(
  pg_temp.txt($$select visitor_phone from carnet.bookings where id = (select booking_id from res where label = 'b14')$$),
  '+33 6 12 34 56 78',
  'ADR 0016 §8 : le téléphone du visiteur est enregistré'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-08 09:00Z', '00000000-0000-4000-8000-003630000924', '2027-03-01 12:00Z', null, 'tablet')$$,
  '22023', null, 'décision 7 : p_device_class hors liste → 22023'
);
select throws_ok(
  $$select pg_temp.book('x', 'zzz-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-08 09:00Z', '00000000-0000-4000-8000-003630000925', '2027-03-01 12:00Z', null, null)$$,
  '22023', null, 'décision 7 : p_device_class nul → 22023, avant le contrôle du profil'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-08 09:00Z', null, '2027-03-01 12:00Z')$$,
  '22023', null, 'idempotence : clé d''idempotence nulle → 22023'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', null, '00000000-0000-4000-8000-003630000926', '2027-03-01 12:00Z')$$,
  '22023', null, 'décision 7 : début nul → 22023'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-08 09:00Z', '00000000-0000-4000-8000-003630000927', '2027-03-01 12:00Z',
                        null, 'mobile', 'Vic', 'vic example.test')$$,
  '23514', null, 'décision 5 : e-mail du visiteur invalide → 23514'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-08 09:00Z', '00000000-0000-4000-8000-003630000928', '2027-03-01 12:00Z',
                        null, 'mobile', '', 'vic@example.test')$$,
  '23514', null, 'décision 5 : nom du visiteur vide → 23514'
);

-- ---------------------------------------------------------------------------
-- Décision 7 — atomicité : échec de l'outbox ou des statistiques → aucune réservation
-- ---------------------------------------------------------------------------
alter table carnet.outbox add constraint test_0036_reject_booking_confirmed check (type <> 'booking.confirmed') not valid;
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-08 09:00Z', '00000000-0000-4000-8000-003630000929', '2027-03-01 12:00Z')$$,
  '23514', null, 'décision 7 : l''insertion dans l''outbox échoue → l''erreur remonte'
);
alter table carnet.outbox drop constraint test_0036_reject_booking_confirmed;
alter table carnet.analytics_events add constraint test_0036_reject_booking_confirmed check (type <> 'booking_confirmed') not valid;
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-08 09:00Z', '00000000-0000-4000-8000-003630000930', '2027-03-01 12:00Z')$$,
  '23514', null, 'décision 7 : l''insertion dans analytics_events échoue → l''erreur remonte'
);
alter table carnet.analytics_events drop constraint test_0036_reject_booking_confirmed;

select is(
  pg_temp.txt($$select count(*)::text from carnet.bookings where idempotency_key::text like '00000000-0000-4000-8000-003630000%'
                  and idempotency_key::text >= '00000000-0000-4000-8000-003630000900'$$),
  '0',
  'critères 1 à 3 et atomicité : aucun refus n''a écrit de réservation'
);
select is(
  pg_temp.txt($$select row((select count(*) from carnet.bookings where profile_id = '00000000-0000-4000-8000-003630000010'),
                           (select count(*) from carnet.outbox where profile_id = '00000000-0000-4000-8000-003630000010' and type = 'booking.confirmed'),
                           (select count(*) from carnet.analytics_events where profile_id = '00000000-0000-4000-8000-003630000010' and type = 'booking_confirmed'))::text$$),
  '(16,16,16)',
  'décision 7 : 16 réservations de PA acceptées, autant d''événements d''outbox et de statistiques, rien de plus'
);
select ok(
  coalesce(pg_temp.txt($$select count(distinct booking_id)::text from carnet.booking_tokens$$)
           = pg_temp.txt($$select count(*)::text from carnet.bookings$$), false)
  and coalesce(pg_temp.txt($$select count(*)::text from carnet.booking_tokens$$)
           = pg_temp.txt($$select count(*)::text from carnet.bookings$$), false)
  and (select count(distinct cancel_token) from res where cancel_token is not null) = (select count(*) from res where cancel_token is not null)
  and (select count(*) from res where cancel_token is not null) >= 15,
  'décision 12 et point 14 : un jeton par réservation créée (hachages et jetons renvoyés tous distincts)'
);

-- ---------------------------------------------------------------------------
-- Critère 5 — fuseau de session (visiteur) différent du fuseau du profil
-- ---------------------------------------------------------------------------
set local timezone = 'America/New_York';
select lives_ok(
  $$select pg_temp.book('s1', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-08 09:00Z', '00000000-0000-4000-8000-0036300000c1', '2027-03-01 12:00Z')$$,
  'critère 5 : session en America/New_York, lundi 8 mars 09:00Z = 10:00 à Paris (04:00 à New York) accepté'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-08 07:00Z', '00000000-0000-4000-8000-003630000931', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 5 : session en America/New_York, 07:00Z = 08:00 à Paris refusé (règle lue dans le fuseau du profil)'
);
set local timezone = 'Asia/Tokyo';
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e0', '2027-03-08 01:00Z', '00000000-0000-4000-8000-003630000932', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 5 : session en Asia/Tokyo, 01:00Z = 10:00 à Tokyo mais 02:00 à Paris → CN002'
);
set local timezone = 'UTC';

-- ---------------------------------------------------------------------------
-- Critère 5 — Europe/Paris, passage à l'heure d'été (dimanche 28 mars 2027) ; e1 : 60 min, sans tampon
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select pg_temp.book('m1', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-03-21 08:00Z', '00000000-0000-4000-8000-0036300000d1', '2027-03-01 12:00Z')$$,
  'critère 5 : dimanche 21 mars 08:00Z = 09:00 CET accepté'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-03-21 07:00Z', '00000000-0000-4000-8000-003630000933', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 5 : dimanche 21 mars 07:00Z = 08:00 CET → CN002'
);
select lives_ok(
  $$select pg_temp.book('m2', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-03-28 07:00Z', '00000000-0000-4000-8000-0036300000d2', '2027-03-01 12:00Z')$$,
  'critère 5 : dimanche 28 mars 07:00Z = 09:00 CEST accepté (un décalage fixe +1 le refuserait)'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-03-28 06:00Z', '00000000-0000-4000-8000-003630000934', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 5 : dimanche 28 mars 06:00Z = 08:00 CEST → CN002'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-03-28 10:00Z', '00000000-0000-4000-8000-003630000935', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 5 : dimanche 28 mars 10:00Z = 12:00–13:00 CEST → CN002 (un décalage fixe +1 l''accepterait)'
);
select lives_ok(
  $$select pg_temp.book('m3', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-03-28 09:00Z', '00000000-0000-4000-8000-0036300000d3', '2027-03-01 12:00Z')$$,
  'critère 5 : dimanche 28 mars 09:00Z = 11:00–12:00 CEST accepté'
);
-- Plage de nuit 01:00–04:00 (heure locale) : 00:00Z–02:00Z ce jour-là (l'heure 02:00–03:00 n'existe pas).
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-03-27 23:30Z', '00000000-0000-4000-8000-003630000937', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 5 : 27 mars 23:30Z = dimanche 00:30 CET, avant la plage de nuit → CN002'
);
select lives_ok(
  $$select pg_temp.book('m4', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-03-28 00:00Z', '00000000-0000-4000-8000-0036300000d4', '2027-03-01 12:00Z')$$,
  'critère 5 : 28 mars 00:00Z = 01:00 CET → fin 03:00 CEST, dans la plage de nuit, accepté'
);
select lives_ok(
  $$select pg_temp.book('m5', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-03-28 01:00Z', '00000000-0000-4000-8000-0036300000d5', '2027-03-01 12:00Z')$$,
  'critère 5 : 28 mars 01:00Z = 03:00–04:00 CEST accepté'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-03-28 02:00Z', '00000000-0000-4000-8000-003630000936', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 5 : 28 mars 02:00Z = 04:00 CEST, après la plage de nuit → CN002'
);

-- ---------------------------------------------------------------------------
-- Critère 5 — Europe/Paris, retour à l'heure d'hiver (dimanche 31 octobre 2027) ; T_OCT = 1er octobre 12:00Z
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select pg_temp.book('o1', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-10-24 07:00Z', '00000000-0000-4000-8000-0036300000d6', '2027-10-01 12:00Z')$$,
  'critère 5 : dimanche 24 octobre 07:00Z = 09:00 CEST accepté'
);
select lives_ok(
  $$select pg_temp.book('o2', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-10-31 08:00Z', '00000000-0000-4000-8000-0036300000d7', '2027-10-01 12:00Z')$$,
  'critère 5 : dimanche 31 octobre 08:00Z = 09:00 CET accepté (un décalage fixe +2 le refuserait)'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-10-31 07:00Z', '00000000-0000-4000-8000-003630000938', '2027-10-01 12:00Z')$$,
  'CN002', null, 'critère 5 : dimanche 31 octobre 07:00Z = 08:00 CET → CN002 (un décalage fixe +2 l''accepterait)'
);
select lives_ok(
  $$select pg_temp.book('o3', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-10-31 10:00Z', '00000000-0000-4000-8000-0036300000d8', '2027-10-01 12:00Z')$$,
  'critère 5 : dimanche 31 octobre 10:00Z = 11:00–12:00 CET accepté'
);
-- Plage de nuit 01:00–04:00 (heure locale) : 30 octobre 23:00Z–31 octobre 03:00Z (l'heure 02:00–03:00 existe deux fois).
select lives_ok(
  $$select pg_temp.book('o4', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-10-30 23:00Z', '00000000-0000-4000-8000-0036300000d9', '2027-10-01 12:00Z')$$,
  'critère 5 : samedi 30 octobre 23:00Z = dimanche 01:00 CEST accepté (jour ISO lu dans le fuseau du profil)'
);
select lives_ok(
  $$select pg_temp.book('o5', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-10-31 00:00Z', '00000000-0000-4000-8000-0036300000da', '2027-10-01 12:00Z')$$,
  'critère 5 : 31 octobre 00:00Z = 02:00 CEST accepté'
);
select lives_ok(
  $$select pg_temp.book('o6', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-10-31 01:00Z', '00000000-0000-4000-8000-0036300000db', '2027-10-01 12:00Z')$$,
  'critère 5 : 31 octobre 01:00Z = 02:00 CET (seconde occurrence de 02:00) accepté, sans chevaucher o5'
);
select lives_ok(
  $$select pg_temp.book('o7', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-10-31 02:00Z', '00000000-0000-4000-8000-0036300000dc', '2027-10-01 12:00Z')$$,
  'critère 5 : 31 octobre 02:00Z = 03:00–04:00 CET accepté'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-10-31 03:00Z', '00000000-0000-4000-8000-003630000939', '2027-10-01 12:00Z')$$,
  'CN002', null, 'critère 5 : 31 octobre 03:00Z = 04:00 CET, après la plage de nuit → CN002'
);
select throws_ok(
  $$select pg_temp.book('x', 'ana-0036b', '00000000-0000-4000-8000-0036300000e1', '2027-10-30 22:00Z', '00000000-0000-4000-8000-003630000940', '2027-10-01 12:00Z')$$,
  'CN002', null, 'critère 5 : 30 octobre 22:00Z = dimanche 00:00 CEST, avant la plage de nuit → CN002'
);
select is(
  pg_temp.txt($$select string_agg(lower(b.range)::text, ',' order by lower(b.range))
                  from carnet.bookings b join res r on r.booking_id = b.id where r.label in ('o4', 'o5', 'o6', 'o7')$$),
  '2027-10-30 23:00:00+00,2027-10-31 00:00:00+00,2027-10-31 01:00:00+00,2027-10-31 02:00:00+00',
  'critère 5 : quatre rendez-vous d''une heure dans une plage locale de « 3 h » qui dure 4 h réelles ce jour-là'
);

-- ---------------------------------------------------------------------------
-- Critère 5 — fuseau sans DST (Asia/Tokyo, UTC+9 toute l'année) ; e4 : 60 min, délai 0
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select pg_temp.book('t1', 'ben-0036b', '00000000-0000-4000-8000-0036300000e4', '2027-03-28 21:00Z', '00000000-0000-4000-8000-0036300000f1', '2027-03-01 12:00Z')$$,
  'critère 5 : dimanche 28 mars 21:00Z = lundi 06:00 à Tokyo accepté (jour ISO du fuseau du profil)'
);
select throws_ok(
  $$select pg_temp.book('x', 'ben-0036b', '00000000-0000-4000-8000-0036300000e4', '2027-03-28 20:00Z', '00000000-0000-4000-8000-003630000941', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 5 : 28 mars 20:00Z = lundi 05:00 à Tokyo → CN002'
);
select throws_ok(
  $$select pg_temp.book('x', 'ben-0036b', '00000000-0000-4000-8000-0036300000e4', '2027-03-29 21:00Z', '00000000-0000-4000-8000-003630000942', '2027-03-01 12:00Z')$$,
  'CN002', null, 'critère 5 : lundi 29 mars 21:00Z = mardi 06:00 à Tokyo → CN002'
);
select lives_ok(
  $$select pg_temp.book('t2', 'ben-0036b', '00000000-0000-4000-8000-0036300000e4', '2027-03-29 00:00Z', '00000000-0000-4000-8000-0036300000f2', '2027-03-01 12:00Z')$$,
  'critère 5 : lundi 29 mars 00:00Z = 09:00 à Tokyo accepté (le DST européen de la veille est sans effet)'
);
select lives_ok(
  $$select pg_temp.book('t3', 'ben-0036b', '00000000-0000-4000-8000-0036300000e4', '2027-10-31 21:00Z', '00000000-0000-4000-8000-0036300000f3', '2027-10-01 12:00Z')$$,
  'critère 5 : dimanche 31 octobre 21:00Z = lundi 1er novembre 06:00 à Tokyo accepté'
);
select lives_ok(
  $$select pg_temp.book('t4', 'ben-0036b', '00000000-0000-4000-8000-0036300000e4', '2027-11-01 07:00Z', '00000000-0000-4000-8000-0036300000f4', '2027-10-01 12:00Z')$$,
  'critère 5 : lundi 1er novembre 07:00Z = 16:00–17:00 à Tokyo accepté'
);
select throws_ok(
  $$select pg_temp.book('x', 'ben-0036b', '00000000-0000-4000-8000-0036300000e4', '2027-11-01 08:00Z', '00000000-0000-4000-8000-003630000943', '2027-10-01 12:00Z')$$,
  'CN002', null, 'critère 5 : lundi 1er novembre 08:00Z = 17:00 à Tokyo → CN002'
);

-- ---------------------------------------------------------------------------
-- Point 18 — message vide ou blanc enregistré null (comme le téléphone)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into res (label, booking_id, cancel_token)
      select 'm_empty', r.booking_id, r.cancel_token
        from carnet.book_slot_at('ana-0036b', '00000000-0000-4000-8000-0036300000e3', '2027-04-14 07:00Z', 'Vic Visiteur',
                                 'vic@example.test', '+33 6 12 34 56 78', '', '00000000-0000-4000-8000-0036300000b8', 'mobile',
                                 '2027-03-01 12:00Z') r$$,
  'point 18 : réservation avec un message vide acceptée'
);
select lives_ok(
  $$insert into res (label, booking_id, cancel_token)
      select 'm_blank', r.booking_id, r.cancel_token
        from carnet.book_slot_at('ana-0036b', '00000000-0000-4000-8000-0036300000e3', '2027-04-14 07:30Z', 'Vic Visiteur',
                                 'vic@example.test', '+33 6 12 34 56 78', '   ', '00000000-0000-4000-8000-0036300000b9', 'mobile',
                                 '2027-03-01 12:00Z') r$$,
  'point 18 : réservation avec un message blanc acceptée'
);
select is(
  pg_temp.txt($$select string_agg(r.label || '=' || coalesce(b.message, 'null'), ',' order by r.label)
                  from res r join carnet.bookings b on b.id = r.booking_id where r.label in ('m_empty', 'm_blank')$$),
  'm_blank=null,m_empty=null',
  'point 18 : p_message vide ou blanc → message null'
);

-- ---------------------------------------------------------------------------
-- Décision 7 — book_slot (enveloppe, horloge réelle) par service_role
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select pg_temp.book_now('w1', 'wil-0036b', '00000000-0000-4000-8000-0036300000e6', date_trunc('minute', now()) + interval '3 hours', '00000000-0000-4000-8000-0036300000c2')$$,
  'décision 7 : service_role réserve par book_slot (now() + 3 h, dans l''exception extra)'
);
select lives_ok(
  $$select pg_temp.book_now('w1_replay', 'wil-0036b', '00000000-0000-4000-8000-0036300000e6', date_trunc('minute', now()) + interval '3 hours', '00000000-0000-4000-8000-0036300000c2')$$,
  'critère 2 : rejeu de book_slot sans erreur'
);
select throws_ok(
  $$select pg_temp.book_now('x', 'wil-0036b', '00000000-0000-4000-8000-0036300000e6', date_trunc('minute', now()) + interval '1 hour', '00000000-0000-4000-8000-003630000944')$$,
  'CN002', null, 'décision 7 : book_slot applique le délai minimal avec now() (now() + 1 h pour 120 min → CN002)'
);
select throws_ok(
  $$select pg_temp.book_now('x', 'wil-0036b', '00000000-0000-4000-8000-0036300000e6', date_trunc('minute', now()) + interval '3 hours', '00000000-0000-4000-8000-003630000945')$$,
  'CN001', null, 'critère 1 : book_slot refuse le même créneau avec une autre clé → CN001'
);
select throws_ok(
  $$select pg_temp.book_now('x', 'wil-0036b', '00000000-0000-4000-8000-0036300000e6', date_trunc('minute', now()) + interval '3 hours 15 minutes', '00000000-0000-4000-8000-003630000946')$$,
  'CN002', null, 'point 15 : book_slot refuse un début non aligné sur le pas depuis le début de l''extra (minute de now() − 1 h) → CN002'
);
reset role;
select ok(
  coalesce((select w.booking_id = r.booking_id and w.cancel_token ~ '^[0-9a-f]{64}$' and r.cancel_token is null
              from res w, res r where w.label = 'w1' and r.label = 'w1_replay'), false),
  'critère 2 et décision 12 : book_slot renvoie le jeton une fois, puis le même id sans jeton'
);
select is(
  pg_temp.txt($$select row(consent_at = now(), created_at = now(), lower(range) = date_trunc('minute', now()) + interval '3 hours',
                           upper(range) = date_trunc('minute', now()) + interval '3 hours 30 minutes')::text
                  from carnet.bookings where id = (select booking_id from res where label = 'w1')$$),
  '(t,t,t,t)',
  'décision 7 : book_slot équivaut à book_slot_at(…, now()) (consentement et création à l''heure serveur)'
);
select is(
  pg_temp.txt($$select row((select count(*) from carnet.bookings where profile_id = '00000000-0000-4000-8000-003630000014'),
                           (select count(*) from carnet.outbox where profile_id = '00000000-0000-4000-8000-003630000014'),
                           (select count(*) from carnet.analytics_events where profile_id = '00000000-0000-4000-8000-003630000014' and device_class = 'desktop'))::text$$),
  '(1,1,1)',
  'critère 2 : book_slot rejoué → une réservation, un événement d''outbox, un événement de statistiques'
);

select * from finish();
rollback;
