-- Fiche 0036 / ADR 0016 §4 et §8 — tâches planifiées du module de rendez-vous et statistiques :
-- carnet.queue_booking_reminders (rappel 24 h avant), carnet.purge_bookings (12 mois après la fin), tâches pg_cron,
-- métriques booking_viewed / booking_started / booking_confirmed, effacement du jeton par la purge de l'outbox (0031),
-- carnet.claim_booking_outbox (consommation des booking.* par n8n, point 15).
-- Critères couverts : 2 (rappel écrit une seule fois même si la tâche repasse ; claim sans double réservation),
-- 6 (tâches pg_cron uniques ; le rejeu de la migration est prouvé par db-architect). Décisions 8, 9, 10, 11 ;
-- points 14, 15, 17 (jeton retiré de l'outbox au traitement) et 18 (créneau précédent, rappel d'un rendez-vous commencé).
-- Contrat (voir aussi l'en-tête de carnet_bookings_schema.test.sql) :
--   queue_booking_reminders() returns integer : pour chaque réservation status = 'confirmed', reminder_queued_at nul,
--     lower(range) ∈ [now() + 23 h 45, now() + 24 h 15[ et created_at <= lower(range) − 24 h : une ligne d'outbox
--     booking.reminder (profile_id du profil, payload = {"booking_id", "cancel_token"} exactement, jeton neuf de 64 hex
--     dont le hachage est inséré dans booking_tokens pour cette réservation ; les jetons antérieurs restent valides) et
--     reminder_queued_at = now(), dans la même transaction ; renvoie le nombre de rappels écrits. Rejouée : 0, aucun
--     doublon, aucun jeton supplémentaire.
--   purge_bookings(p_older_than interval) returns integer : supprime les réservations (tout statut) dont
--     upper(range) < now() − p_older_than ; rescheduled_from des survivantes passe à null (fk on delete set null) ;
--     renvoie le nombre supprimé ; leurs booking_tokens disparaissent avec elles (cascade) ; 22023 si p_older_than nul
--     ou ≤ 0.
--   claim_booking_outbox(p_limit integer) (colonnes : en-tête de carnet_bookings_schema) : même mécanique que
--     claim_outbox (0031) restreinte aux types booking.* : candidats status = 'pending', non verrouillés ou verrouillés
--     depuis plus de 5 minutes, du plus ancien (created_at, id) au plus récent, au plus p_limit, for update skip
--     locked ; parmi eux : réservation disparue (payload booking_id absent de bookings) → processed, non renvoyé ;
--     booking.reminder d'une réservation qui n'est plus confirmée ou qui a commencé (lower(range) <= now(), point 18)
--     → processed, non renvoyé ; attempts déjà >= 5 → dead, non renvoyé ; tout événement écarté (processed ou dead)
--     perd la clé cancel_token de sa charge utile (point 17) ; sinon locked_at = now(), attempts + 1, renvoyé avec la
--     valeur après incrément (jeton conservé jusqu'au traitement). lead.created jamais
--     touché. Colonnes : booking_id et cancel_token tirés de la charge utile (cancel_token null pour booking.cancelled),
--     previous_booking_id de la charge utile (booking.rescheduled, sinon null), previous_booking_start /
--     previous_booking_end = lower / upper(range) de cette réservation précédente (sinon null, point 18), cancelled_by de la charge utile
--     (booking.cancelled, sinon null), booking_start / booking_end = lower / upper(range), event_type_title,
--     location_kind, location_text (quel que soit le mode), time_zone et profile_slug du profil,
--     owner_display_name = profiles.display_name, owner_email = auth.users.email du propriétaire,
--     visitor_name / visitor_email / visitor_phone / visitor_message = colonnes de bookings. 22023 si p_limit nul ou < 1.
--   complete_outbox / fail_outbox (0031, point 17) : pour un booking.*, la clé cancel_token est retirée de la charge
--     utile au passage processed (complete) ou dead (fail) ; un fail qui laisse pending la garde.
--   pg_cron : 'carnet-queue-booking-reminders' '*/15 * * * *' → select carnet.queue_booking_reminders() ;
--             'carnet-purge-bookings' quotidienne (minute heure * * *) → select carnet.purge_bookings(interval '12 months') ;
--     base postgres, utilisateur postgres, actives, uniques, replanification sous le même nom = même jobid.
-- Personas (UUID fixes, plage 0036 5xxx propre à ce fichier) :
--   A 0…a membre carnet, profil PA 0…10 publié (ana-0036j), type e0 ; B 0…b membre carnet, profil PB 0…11 (ben-0036j), type e1.
-- Réservations brutes (postgres) de 5 minutes, posées relativement à now() (figé dans la transaction).
-- Tout est annulé par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(81);

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

create temp table ids (label text primary key, id uuid);
grant select on ids to service_role;
create function pg_temp.tok0(p_label text) returns text language sql immutable as $$
  select left(encode(sha256(convert_to(p_label, 'UTF8')), 'hex'), 64)
$$;
create temp table reads (label text primary key, n bigint);
create temp table cron_job_snapshot (
  jobid bigint, jobname text, schedule text, command text, database text, username text, active boolean
);

-- Réservation brute : début = now() + p_offset, durée p_minutes, création et statut paramétrables ; un jeton
-- initial (64 caractères) dérivé du libellé, comme celui de booking.confirmed.
create function pg_temp.raw(p_label text, p_profile uuid, p_type uuid, p_offset interval, p_minutes integer,
                            p_created interval, p_status text default 'confirmed', p_reminded interval default null)
returns void
language plpgsql as $$
declare
  v uuid;
begin
  insert into carnet.bookings (profile_id, event_type_id, range, status, visitor_name, visitor_email, consent_at,
                               idempotency_key, cancelled_at, cancelled_by, reminder_queued_at, created_at)
  values (p_profile, p_type, tstzrange(now() + p_offset, now() + p_offset + make_interval(mins => p_minutes), '[)'),
          p_status, 'Vic', 'vic@example.test', now() + p_created,
          gen_random_uuid(), case when p_status = 'cancelled' then now() + p_created end,
          case when p_status = 'cancelled' then 'visitor' end, now() + p_reminded, now() + p_created)
  returning id into v;
  insert into ids (label, id) values (p_label, v);
  insert into carnet.booking_tokens (token_hash, booking_id) values (sha256(convert_to(pg_temp.tok0(p_label), 'UTF8')), v);
end
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00365000000a', 'a-carnet-0036j@test.local'),
  ('00000000-0000-4000-8000-00365000000b', 'b-carnet-0036j@test.local');
insert into platform.project_members (project_id, user_id, role)
  select p.id, u.id, 'user'
    from platform.projects p
   cross join (values ('00000000-0000-4000-8000-00365000000a'::uuid), ('00000000-0000-4000-8000-00365000000b'::uuid)) as u (id)
   where p.slug = 'carnet';
insert into carnet.profiles (id, owner_id, slug, display_name, is_published) values
  ('00000000-0000-4000-8000-003650000010', '00000000-0000-4000-8000-00365000000a', 'ana-0036j', 'Ana', true),
  ('00000000-0000-4000-8000-003650000011', '00000000-0000-4000-8000-00365000000b', 'ben-0036j', 'Ben', true);

select lives_ok(
  $$insert into carnet.event_types (id, profile_id, title, duration_min, location_kind, location_text, position) values
      ('00000000-0000-4000-8000-0036500000e0', '00000000-0000-4000-8000-003650000010', 'Appel', 30, 'video', 'https://visio.example.test/ana', 0),
      ('00000000-0000-4000-8000-0036500000e1', '00000000-0000-4000-8000-003650000011', 'Call', 30, 'video', null, 0)$$,
  'fixture : types'
);
select lives_ok(
  $$select pg_temp.raw('q1', '00000000-0000-4000-8000-003650000010', '00000000-0000-4000-8000-0036500000e0', '23 hours 45 minutes', 5, '-3 days'),
           pg_temp.raw('q2', '00000000-0000-4000-8000-003650000010', '00000000-0000-4000-8000-0036500000e0', '23 hours 50 minutes', 5, '-3 days'),
           pg_temp.raw('q3', '00000000-0000-4000-8000-003650000010', '00000000-0000-4000-8000-0036500000e0', '24 hours', 5, '-1 hour'),
           pg_temp.raw('q4', '00000000-0000-4000-8000-003650000010', '00000000-0000-4000-8000-0036500000e0', '24 hours 10 minutes', 5, '-3 days'),
           pg_temp.raw('q5', '00000000-0000-4000-8000-003650000011', '00000000-0000-4000-8000-0036500000e1', '24 hours', 5, '-3 days'),
           pg_temp.raw('n1', '00000000-0000-4000-8000-003650000010', '00000000-0000-4000-8000-0036500000e0', '23 hours 40 minutes', 5, '-3 days'),
           pg_temp.raw('n2', '00000000-0000-4000-8000-003650000010', '00000000-0000-4000-8000-0036500000e0', '24 hours 15 minutes', 5, '-3 days'),
           pg_temp.raw('n3', '00000000-0000-4000-8000-003650000010', '00000000-0000-4000-8000-0036500000e0', '23 hours 55 minutes', 5, '0 seconds'),
           pg_temp.raw('n4', '00000000-0000-4000-8000-003650000010', '00000000-0000-4000-8000-0036500000e0', '24 hours', 5, '-3 days', 'cancelled'),
           pg_temp.raw('n5', '00000000-0000-4000-8000-003650000010', '00000000-0000-4000-8000-0036500000e0', '24 hours 5 minutes', 5, '-3 days', 'confirmed', '-1 hour')$$,
  'fixture : réservations autour de la fenêtre de rappel'
);

-- ---------------------------------------------------------------------------
-- Décision 8 — rappels
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into reads (label, n) values ('reminders_1', carnet.queue_booking_reminders())$$,
  'décision 8 : queue_booking_reminders s''exécute (postgres, comme pg_cron)'
);
select is(
  (select string_agg(i.label, ',' order by i.label) from ids i
    where pg_temp.txt(format($$select (reminder_queued_at = now())::text from carnet.bookings where id = %L$$, i.id)) = 'true'),
  'q1,q2,q3,q4,q5',
  'décision 8 : rappel planifié pour les réservations commençant dans [23 h 45, 24 h 15[ et créées au moins 24 h avant (tous profils)'
);
select is(
  (select string_agg(i.label || '=' || coalesce(pg_temp.txt(format($$select count(*)::text from carnet.outbox
                                                                    where type = 'booking.reminder' and payload ->> 'booking_id' = %L$$, i.id)), 'null'), ','
                     order by i.label)
     from ids i),
  'n1=0,n2=0,n3=0,n4=0,n5=0,q1=1,q2=1,q3=1,q4=1,q5=1',
  'décision 8 : un booking.reminder par réservation éligible ; aucun avant la fenêtre, à sa borne haute, pour une réservation faite moins de 24 h avant, annulée ou déjà rappelée'
);
select ok(
  coalesce((select n from reads where label = 'reminders_1')
             = pg_temp.txt($$select count(*)::text from carnet.bookings where reminder_queued_at = now()$$)::bigint, false)
  and (select n from reads where label = 'reminders_1') >= 5,
  'décision 8 : queue_booking_reminders renvoie le nombre de rappels écrits (au moins les 5 du jeu)'
);
select is(
  pg_temp.txt($$select string_agg(o.profile_id::text || ':' || o.status, ',' order by i.label)
                  from ids i join carnet.outbox o on o.type = 'booking.reminder' and o.payload ->> 'booking_id' = i.id::text
                 where i.label in ('q1', 'q5')$$),
  '00000000-0000-4000-8000-003650000010:pending,00000000-0000-4000-8000-003650000011:pending',
  'décision 9 : booking.reminder pending, rattaché au profil de la réservation'
);
select is(
  pg_temp.txt($$select string_agg(i.label || '=' || (o.payload = jsonb_build_object('booking_id', i.id, 'cancel_token', o.payload ->> 'cancel_token')
                                                     and o.payload ->> 'cancel_token' ~ '^[0-9a-f]{64}$')::text, ',' order by i.label)
                  from ids i join carnet.outbox o on o.type = 'booking.reminder' and o.payload ->> 'booking_id' = i.id::text$$),
  'q1=true,q2=true,q3=true,q4=true,q5=true',
  'point 14 : chaque booking.reminder a pour payload exactement {booking_id, cancel_token} (jeton de 64 hex)'
);
select is(
  pg_temp.txt($$select string_agg(i.label || '=' || (select count(*) from carnet.booking_tokens t
                                                      where t.booking_id = i.id
                                                        and t.token_hash = sha256(convert_to(o.payload ->> 'cancel_token', 'UTF8')))::text
                                                  || '/' || (o.payload ->> 'cancel_token' <> pg_temp.tok0(i.label))::text, ',' order by i.label)
                  from ids i join carnet.outbox o on o.type = 'booking.reminder' and o.payload ->> 'booking_id' = i.id::text$$),
  'q1=1/true,q2=1/true,q3=1/true,q4=1/true,q5=1/true',
  'point 14 : le jeton du rappel est neuf (différent du jeton initial) et son hachage est enregistré pour la réservation'
);
select is(
  pg_temp.txt($$select count(distinct o.payload ->> 'cancel_token')::text from carnet.outbox o where o.type = 'booking.reminder'$$),
  '5',
  'point 14 : un jeton distinct par rappel'
);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select ok(
  coalesce(pg_temp.txt($$select (carnet.get_booking_by_token(pg_temp.tok0('q1')) ->> 'booking_id'
                                 = (select id::text from ids where label = 'q1')
                                 and carnet.get_booking_by_token(o.payload ->> 'cancel_token')
                                     = carnet.get_booking_by_token(pg_temp.tok0('q1')))::text
                           from carnet.outbox o
                          where o.type = 'booking.reminder' and o.payload ->> 'booking_id' = (select id::text from ids where label = 'q1')$$)::boolean, false),
  'point 14 : le jeton initial et celui du rappel ouvrent tous deux la réservation q1 (plusieurs jetons valides)'
);
reset role;
select is(
  pg_temp.txt(format($$select (reminder_queued_at = now() - interval '1 hour')::text from carnet.bookings where id = %L$$,
                     (select id from ids where label = 'n5'))),
  'true',
  'décision 8 : le marqueur d''une réservation déjà rappelée n''est pas modifié'
);
select is(
  pg_temp.txt($$select count(*)::text from carnet.bookings b join ids i on i.id = b.id
                 where i.label in ('n1', 'n2', 'n3', 'n4') and b.reminder_queued_at is not null$$),
  '0',
  'décision 8 : aucune réservation non éligible ne reçoit de marqueur'
);
select lives_ok(
  $$insert into reads (label, n) values ('reminders_2', carnet.queue_booking_reminders())$$,
  'critère 2 : la tâche repasse dans la même fenêtre'
);
select is((select n from reads where label = 'reminders_2'), 0::bigint, 'critère 2 : second passage → 0 rappel');
select is(
  pg_temp.txt($$select count(*)::text from carnet.booking_tokens t join ids i on i.id = t.booking_id where i.label like 'q%'$$),
  '10',
  'critère 2 et point 14 : après le second passage, toujours 2 jetons par réservation rappelée (initial + rappel), aucun de plus'
);
select is(
  pg_temp.txt($$select count(*)::text from carnet.outbox o join ids i on o.payload ->> 'booking_id' = i.id::text where o.type = 'booking.reminder'$$),
  '5',
  'critère 2 : toujours 5 booking.reminder, un par réservation (aucun doublon)'
);

-- ---------------------------------------------------------------------------
-- Décision 11 — purge des réservations 12 mois après la fin
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select pg_temp.raw('p_old', '00000000-0000-4000-8000-003650000010', '00000000-0000-4000-8000-0036500000e0', '-13 months', 30, '-14 months'),
           pg_temp.raw('p_old_cancelled', '00000000-0000-4000-8000-003650000010', '00000000-0000-4000-8000-0036500000e0', '-13 months -2 hours', 30, '-14 months', 'cancelled'),
           pg_temp.raw('p_chain_old', '00000000-0000-4000-8000-003650000010', '00000000-0000-4000-8000-0036500000e0', '-13 months -4 hours', 30, '-14 months', 'cancelled'),
           pg_temp.raw('p_chain_new', '00000000-0000-4000-8000-003650000010', '00000000-0000-4000-8000-0036500000e0', '-11 months', 30, '-13 months'),
           pg_temp.raw('p_recent', '00000000-0000-4000-8000-003650000011', '00000000-0000-4000-8000-0036500000e1', '-11 months -2 hours', 30, '-12 months')$$,
  'fixture : réservations terminées il y a 13 et 11 mois'
);
select lives_ok(
  $$update carnet.bookings set rescheduled_from = (select id from ids where label = 'p_chain_old')
     where id = (select id from ids where label = 'p_chain_new')$$,
  'fixture : p_chain_new est le report de p_chain_old'
);
select lives_ok(
  $$insert into reads (label, n) values ('bookings_before', (select count(*) from carnet.bookings))$$,
  'fixture : nombre de réservations avant la purge'
);
select lives_ok(
  $$insert into reads (label, n) values ('purged', carnet.purge_bookings(interval '12 months'))$$,
  'décision 11 : purge_bookings(12 mois) s''exécute (postgres, comme pg_cron)'
);
select is(
  (select string_agg(i.label, ',' order by i.label) from ids i
    where i.label like 'p\_%' and pg_temp.txt(format($$select count(*)::text from carnet.bookings where id = %L$$, i.id)) = '1'),
  'p_chain_new,p_recent',
  'décision 11 : les réservations terminées depuis plus de 12 mois (confirmées ou annulées) sont supprimées, les autres restent'
);
select is(
  pg_temp.txt(format($$select coalesce(rescheduled_from::text, 'null') from carnet.bookings where id = %L$$, (select id from ids where label = 'p_chain_new'))),
  'null',
  'décision 11 : le report survivant perd sa référence à la réservation purgée (set null)'
);
select is(
  pg_temp.txt($$select string_agg(i.label || '=' || (select count(*) from carnet.booking_tokens t where t.booking_id = i.id)::text, ',' order by i.label)
                  from ids i where i.label like 'p\_%'$$),
  'p_chain_new=1,p_chain_old=0,p_old=0,p_old_cancelled=0,p_recent=1',
  'point 14 : les jetons des réservations purgées disparaissent avec elles, les autres restent'
);
select ok(
  coalesce((select n from reads where label = 'purged')
             = (select n from reads where label = 'bookings_before') - pg_temp.txt($$select count(*)::text from carnet.bookings$$)::bigint, false)
  and (select n from reads where label = 'purged') >= 3,
  'décision 11 : purge_bookings renvoie le nombre de réservations supprimées (au moins les 3 du jeu)'
);
select is(
  pg_temp.txt($$select count(*)::text from carnet.bookings b join ids i on i.id = b.id where i.label like 'q%' or i.label like 'n%'$$),
  '10',
  'décision 11 : les réservations à venir ne sont pas touchées'
);
select throws_ok($$select carnet.purge_bookings(null)$$, '22023', null, 'décision 11 : intervalle nul → 22023');
select throws_ok($$select carnet.purge_bookings(interval '0')$$, '22023', null, 'décision 11 : intervalle nul (0) → 22023');
select throws_ok($$select carnet.purge_bookings(interval '-1 day')$$, '22023', null, 'décision 11 : intervalle négatif → 22023');

-- ---------------------------------------------------------------------------
-- Décision 9 — la purge de l'outbox (0031) efface les jetons en clair des événements traités
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into carnet.outbox (id, type, profile_id, payload, status, processed_at, created_at) values
      ('00000000-0000-4000-8000-0036500000c1', 'booking.confirmed', '00000000-0000-4000-8000-003650000010',
       jsonb_build_object('booking_id', gen_random_uuid(), 'cancel_token', repeat('a', 64)), 'processed',
       now() - interval '31 days', now() - interval '31 days')$$,
  'fixture : booking.confirmed traité il y a 31 jours, jeton en clair dans la charge utile'
);
select lives_ok($$select carnet.purge_outbox(interval '30 days')$$, 'décision 9 : purge_outbox (0031) s''exécute');
select is(
  (select count(*) from carnet.outbox where id = '00000000-0000-4000-8000-0036500000c1'),
  0::bigint,
  'décision 9 : l''événement et son jeton en clair sont effacés par la purge de l''outbox'
);


-- ---------------------------------------------------------------------------
-- Point 15 — claim_booking_outbox (n8n, service_role) ; claim_outbox ne touche pas les booking.*
-- Ancienneté : k6 lead.created -30 min ; k8 verrouillé il y a 1 min (non repris) -20 min ; k1 -10 ; k2 -9 ; k3 -8 ;
-- k4 -7 (rappel d'une réservation annulée) ; k5 -6 (réservation disparue) ; k7 -5 (attempts 5) ;
-- k9 -4 (point 18 : rappel d'une réservation confirmée déjà commencée).
-- ---------------------------------------------------------------------------
delete from carnet.outbox;
select lives_ok(
  $$select pg_temp.raw('s1', '00000000-0000-4000-8000-003650000010', '00000000-0000-4000-8000-0036500000e0', '-10 minutes', 30, '-3 days')$$,
  'fixture : s1, réservation confirmée commencée il y a 10 minutes'
);
select lives_ok(
  $$insert into carnet.outbox (id, type, profile_id, payload, status, attempts, locked_at, created_at) values
      ('00000000-0000-4000-8000-0036500000f6', 'lead.created', '00000000-0000-4000-8000-003650000010',
       jsonb_build_object('lead_id', gen_random_uuid()), 'pending', 0, null, now() - interval '30 minutes'),
      ('00000000-0000-4000-8000-0036500000f8', 'booking.confirmed', '00000000-0000-4000-8000-003650000010',
       jsonb_build_object('booking_id', (select id from ids where label = 'q2'), 'cancel_token', repeat('8', 64)), 'pending', 0,
       now() - interval '1 minute', now() - interval '20 minutes'),
      ('00000000-0000-4000-8000-0036500000f1', 'booking.confirmed', '00000000-0000-4000-8000-003650000010',
       jsonb_build_object('booking_id', (select id from ids where label = 'q1'), 'cancel_token', repeat('1', 64)), 'pending', 0,
       null, now() - interval '10 minutes'),
      ('00000000-0000-4000-8000-0036500000f2', 'booking.cancelled', '00000000-0000-4000-8000-003650000010',
       jsonb_build_object('booking_id', (select id from ids where label = 'n4'), 'cancelled_by', 'visitor'), 'pending', 0,
       null, now() - interval '9 minutes'),
      ('00000000-0000-4000-8000-0036500000f3', 'booking.rescheduled', '00000000-0000-4000-8000-003650000011',
       jsonb_build_object('booking_id', (select id from ids where label = 'q5'), 'previous_booking_id', (select id from ids where label = 'p_recent'),
                          'cancel_token', repeat('3', 64)), 'pending', 1, null, now() - interval '8 minutes'),
      ('00000000-0000-4000-8000-0036500000f4', 'booking.reminder', '00000000-0000-4000-8000-003650000010',
       jsonb_build_object('booking_id', (select id from ids where label = 'n4'), 'cancel_token', repeat('4', 64)), 'pending', 0,
       null, now() - interval '7 minutes'),
      ('00000000-0000-4000-8000-0036500000f5', 'booking.confirmed', '00000000-0000-4000-8000-003650000010',
       jsonb_build_object('booking_id', '00000000-0000-4000-8000-0036500000bf', 'cancel_token', repeat('5', 64)), 'pending', 0,
       null, now() - interval '6 minutes'),
      ('00000000-0000-4000-8000-0036500000f7', 'booking.reminder', '00000000-0000-4000-8000-003650000010',
       jsonb_build_object('booking_id', (select id from ids where label = 'q3'), 'cancel_token', repeat('6', 64)), 'pending', 5,
       null, now() - interval '5 minutes'),
      ('00000000-0000-4000-8000-0036500000f9', 'booking.reminder', '00000000-0000-4000-8000-003650000010',
       jsonb_build_object('booking_id', (select id from ids where label = 's1'), 'cancel_token', repeat('7', 64)), 'pending', 0,
       null, now() - interval '4 minutes')$$,
  'fixture : événements d''outbox booking.* et un lead.created'
);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$create temp table claim_leads_0036 as select * from carnet.claim_outbox(10)$$,
  'point 15 : claim_outbox (0031) exécuté sur l''outbox contenant des booking.*'
);
reset role;
select is(
  pg_temp.txt($$select coalesce(string_agg(right(id::text, 2), ','), '') from claim_leads_0036$$),
  '',
  'point 15 : claim_outbox ne renvoie aucun booking.* (le lead.created sans lead est écarté)'
);
select is(
  (select string_agg(right(id::text, 2) || '=' || status || '/' || attempts || '/' || (locked_at is not null)::text, ',' order by id)
     from carnet.outbox where id::text like '00000000-0000-4000-8000-0036500000f%' and type like 'booking.%'),
  'f1=pending/0/false,f2=pending/0/false,f3=pending/1/false,f4=pending/0/false,f5=pending/0/false,f7=pending/5/false,f8=pending/0/true,'
  || 'f9=pending/0/false',
  'point 15 : claim_outbox ne verrouille, n''incrémente ni ne marque aucun booking.* (restreinte à lead.created)'
);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$create temp table claim1_0036 as select * from carnet.claim_booking_outbox(2)$$,
  'point 15 : service_role exécute claim_booking_outbox(2)'
);
select lives_ok(
  $$create temp table claim2_0036 as select * from carnet.claim_booking_outbox(10)$$,
  'point 15 : second claim_booking_outbox(10)'
);
select lives_ok(
  $$create temp table claim3_0036 as select * from carnet.claim_booking_outbox(10)$$,
  'point 15 : troisième claim_booking_outbox(10)'
);
reset role;
select is(
  pg_temp.txt($$select string_agg(id::text, ',' order by id) from claim1_0036$$),
  '00000000-0000-4000-8000-0036500000f1,00000000-0000-4000-8000-0036500000f2',
  'point 15 : claim_booking_outbox(2) réserve les 2 booking.* les plus anciens réservables (ni lead.created, ni verrou récent)'
);
select is(
  pg_temp.txt($$select string_agg(id::text, ',' order by id) from claim2_0036$$),
  '00000000-0000-4000-8000-0036500000f3',
  'points 15 et 18 : le second claim ne renvoie que k3 (rappel d''une annulée, réservation disparue, attempts 5 et rappel d''un rendez-vous commencé écartés)'
);
select is(
  pg_temp.txt($$select count(*)::text from claim3_0036$$),
  '0',
  'critère 2 : un troisième claim ne renvoie rien (aucune double réservation)'
);
select is(
  (select string_agg(right(id::text, 2) || '=' || status || '/' || attempts || '/' || (locked_at is not null)::text, ',' order by id)
     from carnet.outbox where id::text like '00000000-0000-4000-8000-0036500000f%'),
  'f1=pending/1/true,f2=pending/1/true,f3=pending/2/true,f4=processed/0/false,f5=processed/0/false,f6=processed/0/false,'
  || 'f7=dead/5/false,f8=pending/0/true,f9=processed/0/false',
  'points 15 et 18 : états après les claims (réservés : attempts + 1 et verrou ; écartés : processed ou dead, k9 processed ; lead.created traité par claim_outbox seul)'
);
select ok(
  coalesce((select processed_at = now() from carnet.outbox where id = '00000000-0000-4000-8000-0036500000f9'), false),
  'point 18 : le rappel d''un rendez-vous commencé passe processed (processed_at = now()) sans être renvoyé'
);
select is(
  (select string_agg(right(id::text, 2) || '=' || (payload ? 'cancel_token')::text || '/' || (payload ? 'booking_id')::text, ',' order by id)
     from carnet.outbox where id in ('00000000-0000-4000-8000-0036500000f4', '00000000-0000-4000-8000-0036500000f5',
                                     '00000000-0000-4000-8000-0036500000f7', '00000000-0000-4000-8000-0036500000f9')),
  'f4=false/true,f5=false/true,f7=false/true,f9=false/true',
  'point 17 : les événements écartés par claim_booking_outbox (processed ou dead) perdent cancel_token, gardent booking_id'
);
select is(
  (select string_agg(right(id::text, 2) || '=' || (payload ->> 'cancel_token'), ',' order by id)
     from carnet.outbox where id in ('00000000-0000-4000-8000-0036500000f1', '00000000-0000-4000-8000-0036500000f3')),
  'f1=' || repeat('1', 64) || ',f3=' || repeat('3', 64),
  'point 17 : un événement réservé (en cours d''envoi) garde son jeton jusqu''au traitement'
);
select is(
  pg_temp.txt($$select row(c.type, c.attempts, c.booking_id = (select id from ids where label = 'q1'), c.previous_booking_id,
                           c.cancelled_by, c.booking_start = lower(b.range), c.booking_end = upper(b.range), c.event_type_title,
                           c.location_kind, c.location_text, c.time_zone, c.profile_slug, c.owner_display_name, c.owner_email,
                           c.visitor_name, c.visitor_email, c.visitor_phone, c.visitor_message, c.cancel_token)::text
                  from claim1_0036 c join carnet.bookings b on b.id = c.booking_id
                 where c.id = '00000000-0000-4000-8000-0036500000f1'$$),
  row('booking.confirmed'::text, 1, true, null::uuid, null::text, true, true, 'Appel'::text, 'video'::text,
      'https://visio.example.test/ana'::text, 'Europe/Paris'::text, 'ana-0036j'::text, 'Ana'::text,
      'a-carnet-0036j@test.local'::text, 'Vic'::text, 'vic@example.test'::text, null::text, null::text, repeat('1', 64))::text,
  'point 15 : booking.confirmed renvoie type, attempts, réservation, type de RDV, lieu (même video), fuseau, slug, propriétaire (e-mail du compte), visiteur, jeton de la charge utile'
);
select is(
  pg_temp.txt($$select row(type, booking_id = (select id from ids where label = 'n4'), cancelled_by, cancel_token, previous_booking_id)::text
                  from claim1_0036 where id = '00000000-0000-4000-8000-0036500000f2'$$),
  row('booking.cancelled'::text, true, 'visitor'::text, null::text, null::uuid)::text,
  'point 15 : booking.cancelled renvoie cancelled_by, sans jeton'
);
select is(
  pg_temp.txt($$select row(type, attempts, previous_booking_id = (select id from ids where label = 'p_recent'), cancel_token,
                           profile_slug, owner_email, location_text)::text
                  from claim2_0036 where id = '00000000-0000-4000-8000-0036500000f3'$$),
  row('booking.rescheduled'::text, 2, true, repeat('3', 64), 'ben-0036j'::text, 'b-carnet-0036j@test.local'::text, null::text)::text,
  'point 15 : booking.rescheduled renvoie previous_booking_id, le nouveau jeton et les données de son propre profil'
);
select is(
  pg_temp.txt($$select row(c.previous_booking_start = lower(p.range), c.previous_booking_end = upper(p.range))::text
                  from claim2_0036 c join carnet.bookings p on p.id = c.previous_booking_id
                 where c.id = '00000000-0000-4000-8000-0036500000f3'$$),
  '(t,t)',
  'point 18 : booking.rescheduled renvoie previous_booking_start / previous_booking_end (créneau de la réservation reportée)'
);
select is(
  pg_temp.txt($$select string_agg(right(id::text, 2) || '=' || (previous_booking_start is null)::text || '/' || (previous_booking_end is null)::text, ',' order by id)
                  from claim1_0036$$),
  'f1=true/true,f2=true/true',
  'point 18 : previous_booking_start / previous_booking_end nuls hors booking.rescheduled'
);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select * from carnet.claim_booking_outbox(0)$$, '22023', null, 'point 15 : claim_booking_outbox(0) refusé (22023)');
select throws_ok($$select * from carnet.claim_booking_outbox(null)$$, '22023', null, 'point 15 : claim_booking_outbox(null) refusé (22023)');
reset role;
select lives_ok(
  $$insert into carnet.outbox (id, type, profile_id, payload, status, attempts, locked_at, created_at) values
      ('00000000-0000-4000-8000-0036500000fa', 'booking.reminder', '00000000-0000-4000-8000-003650000010',
       jsonb_build_object('booking_id', (select id from ids where label = 'q1'), 'cancel_token', repeat('a', 64)), 'pending', 5,
       now(), now() - interval '3 minutes')$$,
  'fixture : ka, booking.reminder réservé à sa 5e tentative (jeton en clair)'
);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select carnet.complete_outbox('00000000-0000-4000-8000-0036500000f1'),
           carnet.fail_outbox('00000000-0000-4000-8000-0036500000f2', 'smtp down'),
           carnet.fail_outbox('00000000-0000-4000-8000-0036500000f3', 'smtp down'),
           carnet.fail_outbox('00000000-0000-4000-8000-0036500000fa', 'smtp down')$$,
  'points 15 et 17 : complete_outbox et fail_outbox acquittent les booking.*'
);
select lives_ok(
  $$select carnet.complete_outbox('00000000-0000-4000-8000-0036500000f1')$$,
  'critère 2 : complete_outbox rejouée sans erreur'
);
reset role;
select is(
  (select string_agg(right(id::text, 2) || '=' || status, ',' order by id) from carnet.outbox
    where id in ('00000000-0000-4000-8000-0036500000f1', '00000000-0000-4000-8000-0036500000f2',
                 '00000000-0000-4000-8000-0036500000f3', '00000000-0000-4000-8000-0036500000fa')),
  'f1=processed,f2=pending,f3=pending,fa=dead',
  'point 15 : f1 traité, f2 et f3 restent pending après un échec, ka passe dead (5 tentatives)'
);
select is(
  (select payload from carnet.outbox where id = '00000000-0000-4000-8000-0036500000f1'),
  jsonb_build_object('booking_id', (select id from ids where label = 'q1')),
  'point 17 : complete_outbox retire cancel_token de la charge utile (booking_id conservé, rejeu sans effet)'
);
select is(
  (select payload from carnet.outbox where id = '00000000-0000-4000-8000-0036500000fa'),
  jsonb_build_object('booking_id', (select id from ids where label = 'q1')),
  'point 17 : fail_outbox au passage à dead retire cancel_token de la charge utile'
);
select is(
  (select payload ->> 'cancel_token' from carnet.outbox where id = '00000000-0000-4000-8000-0036500000f3'),
  repeat('3', 64),
  'point 17 : fail_outbox qui laisse l''événement pending garde le jeton (nouvel essai)'
);
select is(
  (select payload from carnet.outbox where id = '00000000-0000-4000-8000-0036500000f2'),
  jsonb_build_object('booking_id', (select id from ids where label = 'n4'), 'cancelled_by', 'visitor'),
  'point 17 : booking.cancelled (sans jeton) garde sa charge utile'
);

-- ---------------------------------------------------------------------------
-- Décision 10 — métriques de l'entonnoir de rendez-vous
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0036500000d1', 'ana-0036j', 'booking_viewed', 'direct', null, 'mobile')$$,
  'décision 10 : record_public_event accepte booking_viewed'
);
select lives_ok(
  $$select carnet.record_public_event('00000000-0000-4000-8000-0036500000d2', 'ana-0036j', 'booking_started', 'qr', null, 'desktop')$$,
  'décision 10 : record_public_event accepte booking_started'
);
reset role;
select is(
  (select string_agg(type || ':' || source, ',' order by type) from carnet.analytics_events
    where id in ('00000000-0000-4000-8000-0036500000d1', '00000000-0000-4000-8000-0036500000d2')),
  'booking_started:qr,booking_viewed:direct',
  'décision 10 : booking_viewed et booking_started enregistrés'
);
select lives_ok(
  $$insert into carnet.analytics_events (id, profile_id, type, source, device_class)
      values ('00000000-0000-4000-8000-0036500000d3', '00000000-0000-4000-8000-003650000010', 'booking_confirmed', 'direct', 'mobile')$$,
  'décision 10 : analytics_events accepte booking_confirmed'
);
select lives_ok(
  $$select carnet.aggregate_analytics_day((now() at time zone 'Europe/Paris')::date)$$,
  'décision 10 : l''agrégation (0028) du jour s''exécute'
);
select is(
  (select string_agg(metric || '=' || value, ',' order by metric) from carnet.analytics_daily
    where profile_id = '00000000-0000-4000-8000-003650000010' and day = (now() at time zone 'Europe/Paris')::date
      and metric like 'booking%'),
  'booking_confirmed=1,booking_started=1,booking_viewed=1',
  'décision 10 : les trois métriques de rendez-vous sont agrégées dans analytics_daily'
);

-- ---------------------------------------------------------------------------
-- Critère 6 et décisions 8, 11 — tâches pg_cron
-- ---------------------------------------------------------------------------
insert into cron_job_snapshot (jobid, jobname, schedule, command, database, username, active)
  select jobid, jobname, schedule, command, database, username, active
    from cron.job
   where jobname in ('carnet-queue-booking-reminders', 'carnet-purge-bookings')
      or command ilike '%queue_booking_reminders%' or command ilike '%purge_bookings%';

select is(
  (select count(*) from cron_job_snapshot where jobname = 'carnet-queue-booking-reminders'),
  1::bigint,
  'critère 6 : exactement une tâche carnet-queue-booking-reminders'
);
select is(
  (select count(*) from cron_job_snapshot where jobname = 'carnet-purge-bookings'),
  1::bigint,
  'critère 6 : exactement une tâche carnet-purge-bookings'
);
select is(
  (select count(*) from cron_job_snapshot),
  2::bigint,
  'critère 6 : aucune autre tâche n''appelle queue_booking_reminders ni purge_bookings'
);
select is(
  (select schedule from cron_job_snapshot where jobname = 'carnet-queue-booking-reminders'),
  '*/15 * * * *',
  'décision 8 : les rappels sont planifiés toutes les 15 minutes'
);
select is(
  (select regexp_replace(btrim(regexp_replace(command, '\s+', ' ', 'g')), '\s*;$', '')
     from cron_job_snapshot where jobname = 'carnet-queue-booking-reminders'),
  'select carnet.queue_booking_reminders()',
  'décision 8 : la commande est select carnet.queue_booking_reminders()'
);
select ok(
  coalesce((select schedule ~ '^[0-9]{1,2} [0-9]{1,2} \* \* \*$' from cron_job_snapshot where jobname = 'carnet-purge-bookings'), false),
  'décision 11 : la purge est quotidienne (minute heure * * *)'
);
select is(
  (select regexp_replace(btrim(regexp_replace(command, '\s+', ' ', 'g')), '\s*;$', '')
     from cron_job_snapshot where jobname = 'carnet-purge-bookings'),
  'select carnet.purge_bookings(interval ''12 months'')',
  'décision 11 : la commande est select carnet.purge_bookings(interval ''12 months'')'
);
select is(
  (select count(*) from cron_job_snapshot
    where jobname in ('carnet-queue-booking-reminders', 'carnet-purge-bookings')
      and database = 'postgres' and username = 'postgres' and active),
  2::bigint,
  'critère 6 : les deux tâches sont actives, dans la base postgres, sous postgres'
);
select ok(
  coalesce((select cron.schedule(jobname, schedule, command) = jobid from cron_job_snapshot where jobname = 'carnet-queue-booking-reminders'), false),
  'critère 6 : replanifier carnet-queue-booking-reminders sous le même nom garde le même jobid'
);
select ok(
  coalesce((select cron.schedule(jobname, schedule, command) = jobid from cron_job_snapshot where jobname = 'carnet-purge-bookings'), false),
  'critère 6 : replanifier carnet-purge-bookings sous le même nom garde le même jobid'
);
select is(
  (select count(*) from cron.job where jobname in ('carnet-queue-booking-reminders', 'carnet-purge-bookings')),
  2::bigint,
  'critère 6 : toujours une seule tâche de chaque nom après replanification'
);
-- Fumée : les commandes enregistrées, exécutées telles quelles par postgres, ne lèvent pas d'erreur.
select lives_ok(
  coalesce((select command from cron_job_snapshot where jobname = 'carnet-queue-booking-reminders'), 'select carnet.queue_booking_reminders()'),
  'décision 8 : la commande de rappel enregistrée s''exécute sans erreur'
);
select lives_ok(
  coalesce((select command from cron_job_snapshot where jobname = 'carnet-purge-bookings'), 'select carnet.purge_bookings(interval ''12 months'')'),
  'décision 11 : la commande de purge enregistrée s''exécute sans erreur'
);

select * from finish();
rollback;
