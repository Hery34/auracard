-- Fiche 0036 / ADR 0011 (avenant), 0016 — fonctions du module de rendez-vous.
--   Lectures publiques (anon, authenticated, service_role), une seule valeur jsonb (règle « Limite de lignes ») :
--     get_public_booking_page(slug) : fuseau, types actifs (location_text pour in_person seulement), règles ;
--     get_public_busy_ranges(slug, from, to) : occupations [début, fin + tampon) et exceptions busy, exceptions extra,
--       sans aucune donnée visiteur ; fenêtre ≤ 62 jours, comprise dans [now() − 1 jour, now() + 1440 h + 1 jour]
--       (point 18 : pas d'historique public). Slug inconnu ou non publié : null (même réponse).
--   Écritures (service_role ; variantes _at à horloge injectée exécutables par personne) :
--     book_slot[_at], cancel_booking_by_token[_at], reschedule_booking_by_token[_at] ; lecture get_booking_by_token[_at].
--     cancel_own_booking (authenticated, propriétaire, sans délai minimal ; rendez-vous commencé ou non confirmé →
--       sans effet).
--   Internes (exécutables par personne, appelées par les fonctions ci-dessus sous `postgres`) :
--     carnet.hash_booking_token : SHA-256 du jeton (seule forme stockée et comparée) ;
--     carnet.issue_booking_token : jeton de 32 octets aléatoires (64 hex), seul son hachage est stocké ;
--     carnet.meets_min_notice : règle du délai minimal (réservation, annulation, report, page du jeton) ;
--     carnet.assert_bookable_slot : règle SQL d'autorité du créneau (CN002 puis CN001), partagée par la réservation et
--       le report ;
--     carnet.insert_booking : insertion de la réservation (23P01 → CN001), jeton neuf et événement outbox
--       booking.confirmed ou booking.rescheduled (selon rescheduled_from), partagée par la réservation et le report.
--   Créneau (point 15) : délai minimal (borne incluse) ; horizon p_now + 1440 h (60 jours de 24 h, indépendant de la
--     TimeZone de session) ; rendez-vous contenu dans une règle du jour local (fuseau du profil) ou une exception extra,
--     début aligné sur la durée depuis le début de cette plage ; [début, fin + tampon) hors exception busy ; aucune
--     réservation confirmée dont [début, fin + son tampon) chevauche [début, fin + tampon).
--   Concurrence : carnet.lock_profile_bookings (migration 20261118180000) dans book_slot_at et
--     reschedule_booking_by_token_at (le tampon n'est pas couvert par la contrainte d'exclusion) ; 23P01 résiduel
--     traduit en CN001.
--   Codes : 22023 paramètre invalide ; P0002 cible introuvable (message unique) ; CN001 créneau pris ; CN002 créneau
--     indisponible ; CN003 délai d'annulation ou de report dépassé.
-- Préconditions : migration 20261118180000 ; pgcrypto dans le schéma extensions (extensions.gen_random_bytes) ;
-- rôle de migration `postgres` (bypassrls), propriétaire des fonctions security definer. Rejouable.

-- ---------------------------------------------------------------------------
-- Internes
-- ---------------------------------------------------------------------------
create or replace function carnet.hash_booking_token(p_token text)
returns bytea
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));
$$;

revoke execute on function carnet.hash_booking_token(text) from public, anon, authenticated, service_role;

create or replace function carnet.issue_booking_token(p_booking_id uuid)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_token text;
begin
  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');

  insert into carnet.booking_tokens (token_hash, booking_id)
  values (carnet.hash_booking_token(v_token), p_booking_id);

  return v_token;
end;
$$;

revoke execute on function carnet.issue_booking_token(uuid) from public, anon, authenticated, service_role;

-- Borne incluse : un début exactement à p_now + délai respecte le délai.
create or replace function carnet.meets_min_notice(p_start timestamptz, p_now timestamptz, p_min_notice_min integer)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_start >= p_now + pg_catalog.make_interval(mins => p_min_notice_min);
$$;

revoke execute on function carnet.meets_min_notice(timestamptz, timestamptz, integer)
  from public, anon, authenticated, service_role;

create or replace function carnet.assert_bookable_slot(
  p_profile_id uuid,
  p_time_zone text,
  p_duration_min integer,
  p_buffer_min integer,
  p_min_notice_min integer,
  p_start timestamptz,
  p_now timestamptz,
  p_ignore_booking_id uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_end timestamptz := p_start + pg_catalog.make_interval(mins => p_duration_min);
  v_occupied tstzrange := pg_catalog.tstzrange(p_start, v_end + pg_catalog.make_interval(mins => p_buffer_min), '[)');
  v_local timestamp := p_start at time zone p_time_zone;
  v_day date := v_local::date;
  v_weekday smallint := extract(isodow from v_local)::smallint;
begin
  -- Horizon de 60 jours exprimé en 1440 heures (et non '60 days') : durée absolue, indépendante de la TimeZone de
  -- session et des changements d'heure, identique au calcul TypeScript des créneaux (fiche 0037, point 16).
  if not carnet.meets_min_notice(p_start, p_now, p_min_notice_min)
     or p_start > p_now + interval '1440 hours' then
    raise exception 'slot unavailable' using errcode = 'CN002';
  end if;

  if not exists (
    select 1
      from (
        select (v_day + r.start_time) at time zone p_time_zone as starts_at,
               (v_day + r.end_time) at time zone p_time_zone as ends_at
          from carnet.availability_rules r
         where r.profile_id = p_profile_id
           and r.weekday = v_weekday
        union all
        select pg_catalog.lower(x.range), pg_catalog.upper(x.range)
          from carnet.availability_exceptions x
         where x.profile_id = p_profile_id
           and x.kind = 'extra'
           and x.range @> pg_catalog.tstzrange(p_start, v_end, '[)')
      ) w
     where w.starts_at <= p_start
       and v_end <= w.ends_at
       and pg_catalog.mod(extract(epoch from p_start - w.starts_at), (p_duration_min * 60)::numeric) = 0
  ) then
    raise exception 'slot unavailable' using errcode = 'CN002';
  end if;

  if exists (
    select 1
      from carnet.availability_exceptions x
     where x.profile_id = p_profile_id
       and x.kind = 'busy'
       and x.range && v_occupied
  ) then
    raise exception 'slot unavailable' using errcode = 'CN002';
  end if;

  -- Préfiltre indexé : un tampon fait au plus 240 minutes (event_types_buffer_min_check).
  if exists (
    select 1
      from carnet.bookings b
      join carnet.event_types t on t.id = b.event_type_id
     where b.profile_id = p_profile_id
       and b.status = 'confirmed'
       and b.id is distinct from p_ignore_booking_id
       and b.range && pg_catalog.tstzrange(p_start - interval '240 minutes', pg_catalog.upper(v_occupied), '[)')
       and pg_catalog.tstzrange(pg_catalog.lower(b.range),
                                pg_catalog.upper(b.range) + pg_catalog.make_interval(mins => t.buffer_min), '[)')
           && v_occupied
  ) then
    raise exception 'slot taken' using errcode = 'CN001';
  end if;
end;
$$;

revoke execute on function carnet.assert_bookable_slot(uuid, text, integer, integer, integer, timestamptz, timestamptz, uuid)
  from public, anon, authenticated, service_role;

-- Appelée sous le verrou du profil, après assert_bookable_slot. p_rescheduled_from null : booking.confirmed ;
-- sinon booking.rescheduled (previous_booking_id). Le jeton en clair n'est renvoyé qu'ici et dans la charge utile.
create or replace function carnet.insert_booking(
  p_profile_id uuid,
  p_event_type_id uuid,
  p_start timestamptz,
  p_duration_min integer,
  p_visitor_name text,
  p_visitor_email text,
  p_visitor_phone text,
  p_message text,
  p_consent_at timestamptz,
  p_idempotency_key uuid,
  p_rescheduled_from uuid,
  p_now timestamptz,
  out o_booking_id uuid,
  out o_cancel_token text
)
language plpgsql
volatile
set search_path = ''
as $$
begin
  begin
    insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, visitor_phone, message,
                                 consent_at, idempotency_key, rescheduled_from, created_at)
    values (p_profile_id, p_event_type_id,
            pg_catalog.tstzrange(p_start, p_start + pg_catalog.make_interval(mins => p_duration_min), '[)'),
            p_visitor_name, p_visitor_email, p_visitor_phone, p_message,
            p_consent_at, p_idempotency_key, p_rescheduled_from, p_now)
    returning id into o_booking_id;
  exception when exclusion_violation then
    raise exception 'slot taken' using errcode = 'CN001';
  end;

  o_cancel_token := carnet.issue_booking_token(o_booking_id);

  insert into carnet.outbox (type, profile_id, payload)
  values (case when p_rescheduled_from is null then 'booking.confirmed' else 'booking.rescheduled' end,
          p_profile_id,
          pg_catalog.jsonb_build_object('booking_id', o_booking_id, 'cancel_token', o_cancel_token)
          || case when p_rescheduled_from is null then '{}'::jsonb
                  else pg_catalog.jsonb_build_object('previous_booking_id', p_rescheduled_from) end);
end;
$$;

revoke execute on function carnet.insert_booking(uuid, uuid, timestamptz, integer, text, text, text, text, timestamptz,
                                                 uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Décision 6 — lectures publiques
-- ---------------------------------------------------------------------------
create or replace function carnet.get_public_booking_page(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'time_zone', p.time_zone,
           'event_types', coalesce(
             (select pg_catalog.jsonb_agg(
                       pg_catalog.jsonb_build_object(
                         'id', t.id,
                         'title', t.title,
                         'duration_min', t.duration_min,
                         'buffer_min', t.buffer_min,
                         'min_notice_min', t.min_notice_min,
                         'location_kind', t.location_kind,
                         'position', t.position)
                       || case when t.location_kind = 'in_person'
                               then pg_catalog.jsonb_build_object('location_text', t.location_text)
                               else '{}'::jsonb end
                       order by t.position)
                from carnet.event_types t
               where t.profile_id = p.id
                 and t.is_active),
             '[]'::jsonb),
           'rules', coalesce(
             (select pg_catalog.jsonb_agg(
                       pg_catalog.jsonb_build_object(
                         'weekday', r.weekday,
                         'start_time', r.start_time,
                         'end_time', r.end_time)
                       order by r.weekday, r.start_time)
                from carnet.availability_rules r
               where r.profile_id = p.id),
             '[]'::jsonb))
    from carnet.profiles p
   where p.slug = p_slug
     and p.is_published;
$$;

revoke execute on function carnet.get_public_booking_page(text) from public;
grant execute on function carnet.get_public_booking_page(text) to anon, authenticated, service_role;

create or replace function carnet.get_public_busy_ranges(p_slug text, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_window tstzrange;
begin
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '62 days'
     or p_from < pg_catalog.now() - interval '1 day'
     or p_to > pg_catalog.now() + interval '1440 hours' + interval '1 day' then
    raise exception 'invalid range' using errcode = '22023';
  end if;

  select p.id into v_profile_id
    from carnet.profiles p
   where p.slug = p_slug
     and p.is_published;

  if v_profile_id is null then
    return null;
  end if;

  v_window := pg_catalog.tstzrange(p_from, p_to, '[)');

  return pg_catalog.jsonb_build_object(
    'busy', coalesce(
      (select pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object('start', pg_catalog.lower(o.r), 'end', pg_catalog.upper(o.r))
                order by pg_catalog.lower(o.r), pg_catalog.upper(o.r))
         from (
           select pg_catalog.tstzrange(pg_catalog.lower(b.range),
                                       pg_catalog.upper(b.range) + pg_catalog.make_interval(mins => t.buffer_min),
                                       '[)') as r
             from carnet.bookings b
             join carnet.event_types t on t.id = b.event_type_id
            where b.profile_id = v_profile_id
              and b.status = 'confirmed'
              and b.range && pg_catalog.tstzrange(p_from - interval '240 minutes', p_to, '[)')
           union all
           select x.range
             from carnet.availability_exceptions x
            where x.profile_id = v_profile_id
              and x.kind = 'busy'
              and x.range && v_window
         ) o
        where o.r && v_window),
      '[]'::jsonb),
    'extra', coalesce(
      (select pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object('start', pg_catalog.lower(x.range), 'end', pg_catalog.upper(x.range))
                order by pg_catalog.lower(x.range), pg_catalog.upper(x.range))
         from carnet.availability_exceptions x
        where x.profile_id = v_profile_id
          and x.kind = 'extra'
          and x.range && v_window),
      '[]'::jsonb));
end;
$$;

revoke execute on function carnet.get_public_busy_ranges(text, timestamptz, timestamptz) from public;
grant execute on function carnet.get_public_busy_ranges(text, timestamptz, timestamptz) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Décision 7 — réservation publique
-- ---------------------------------------------------------------------------
create or replace function carnet.book_slot_at(
  p_slug text,
  p_event_type_id uuid,
  p_start timestamptz,
  p_visitor_name text,
  p_visitor_email text,
  p_visitor_phone text,
  p_message text,
  p_idempotency_key uuid,
  p_device_class text,
  p_now timestamptz
)
returns table (booking_id uuid, cancel_token text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid;
  v_time_zone text;
  v_type carnet.event_types;
  v_booking_id uuid;
  v_token text;
begin
  if not carnet.is_valid_analytics_device_class(p_device_class)
     or p_idempotency_key is null
     or p_start is null
     or p_now is null then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;

  select p.id, p.time_zone into v_profile_id, v_time_zone
    from carnet.profiles p
   where p.slug = p_slug
     and p.is_published;

  if v_profile_id is null then
    raise exception 'booking target not found' using errcode = 'P0002';
  end if;

  perform carnet.lock_profile_bookings(v_profile_id);

  select b.id into v_booking_id
    from carnet.bookings b
   where b.profile_id = v_profile_id
     and b.idempotency_key = p_idempotency_key;

  if v_booking_id is not null then
    return query select v_booking_id, null::text;
    return;
  end if;

  select t.* into v_type
    from carnet.event_types t
   where t.id = p_event_type_id
     and t.profile_id = v_profile_id
     and t.is_active;

  if v_type.id is null then
    raise exception 'booking target not found' using errcode = 'P0002';
  end if;

  if v_type.location_kind = 'phone' and coalesce(pg_catalog.btrim(p_visitor_phone), '') = '' then
    raise exception 'visitor phone required' using errcode = '22023';
  end if;

  perform carnet.assert_bookable_slot(v_profile_id, v_time_zone, v_type.duration_min, v_type.buffer_min,
                                      v_type.min_notice_min, p_start, p_now, null);

  select i.o_booking_id, i.o_cancel_token into v_booking_id, v_token
    from carnet.insert_booking(v_profile_id, v_type.id, p_start, v_type.duration_min, p_visitor_name, p_visitor_email,
                               case when pg_catalog.btrim(p_visitor_phone) = '' then null else p_visitor_phone end,
                               case when pg_catalog.btrim(p_message) = '' then null else p_message end,
                               p_now, p_idempotency_key, null, p_now) i;

  insert into carnet.analytics_events (id, profile_id, type, source, device_class)
  values (v_booking_id, v_profile_id, 'booking_confirmed', 'direct', p_device_class);

  return query select v_booking_id, v_token;
end;
$$;

revoke execute on function carnet.book_slot_at(text, uuid, timestamptz, text, text, text, text, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function carnet.book_slot(
  p_slug text,
  p_event_type_id uuid,
  p_start timestamptz,
  p_visitor_name text,
  p_visitor_email text,
  p_visitor_phone text,
  p_message text,
  p_idempotency_key uuid,
  p_device_class text
)
returns table (booking_id uuid, cancel_token text)
language sql
volatile
security definer
set search_path = ''
as $$
  select r.booking_id, r.cancel_token
    from carnet.book_slot_at(p_slug, p_event_type_id, p_start, p_visitor_name, p_visitor_email, p_visitor_phone,
                             p_message, p_idempotency_key, p_device_class, pg_catalog.now()) r;
$$;

revoke execute on function carnet.book_slot(text, uuid, timestamptz, text, text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function carnet.book_slot(text, uuid, timestamptz, text, text, text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Décision 7 — annulation par jeton (visiteur)
-- ---------------------------------------------------------------------------
create or replace function carnet.cancel_booking_by_token_at(p_token text, p_now timestamptz)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_booking carnet.bookings;
  v_min_notice_min integer;
begin
  if p_now is null then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;

  select b.* into v_booking
    from carnet.booking_tokens k
    join carnet.bookings b on b.id = k.booking_id
   where k.token_hash = carnet.hash_booking_token(p_token)
     for update of b;

  if v_booking.id is null then
    raise exception 'booking target not found' using errcode = 'P0002';
  end if;

  if v_booking.status = 'cancelled' then
    return v_booking.id;
  end if;

  select t.min_notice_min into v_min_notice_min from carnet.event_types t where t.id = v_booking.event_type_id;

  if not carnet.meets_min_notice(pg_catalog.lower(v_booking.range), p_now, v_min_notice_min) then
    raise exception 'cancellation deadline passed' using errcode = 'CN003';
  end if;

  update carnet.bookings b
     set status = 'cancelled', cancelled_at = p_now, cancelled_by = 'visitor'
   where b.id = v_booking.id;

  insert into carnet.outbox (type, profile_id, payload)
  values ('booking.cancelled', v_booking.profile_id,
          pg_catalog.jsonb_build_object('booking_id', v_booking.id, 'cancelled_by', 'visitor'));

  return v_booking.id;
end;
$$;

revoke execute on function carnet.cancel_booking_by_token_at(text, timestamptz) from public, anon, authenticated, service_role;

create or replace function carnet.cancel_booking_by_token(p_token text)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select carnet.cancel_booking_by_token_at(p_token, pg_catalog.now());
$$;

revoke execute on function carnet.cancel_booking_by_token(text) from public, anon, authenticated;
grant execute on function carnet.cancel_booking_by_token(text) to service_role;

-- ---------------------------------------------------------------------------
-- Décision 7 — report par jeton (visiteur)
-- ---------------------------------------------------------------------------
create or replace function carnet.reschedule_booking_by_token_at(
  p_token text,
  p_start timestamptz,
  p_idempotency_key uuid,
  p_now timestamptz
)
returns table (booking_id uuid, cancel_token text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_old carnet.bookings;
  v_type carnet.event_types;
  v_time_zone text;
  v_booking_id uuid;
  v_replay_of uuid;
  v_token text;
begin
  if p_idempotency_key is null or p_start is null or p_now is null then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;

  select b.* into v_old
    from carnet.booking_tokens k
    join carnet.bookings b on b.id = k.booking_id
   where k.token_hash = carnet.hash_booking_token(p_token);

  if v_old.id is null then
    raise exception 'booking target not found' using errcode = 'P0002';
  end if;

  perform carnet.lock_profile_bookings(v_old.profile_id);

  select n.id, n.rescheduled_from into v_booking_id, v_replay_of
    from carnet.bookings n
   where n.profile_id = v_old.profile_id
     and n.idempotency_key = p_idempotency_key;

  if v_booking_id is not null then
    if v_replay_of is distinct from v_old.id then
      raise exception 'invalid parameter' using errcode = '22023';
    end if;
    return query select v_booking_id, null::text;
    return;
  end if;

  -- Relecture après le verrou : état à jour (annulation concurrente comprise).
  select b.* into v_old from carnet.bookings b where b.id = v_old.id for update;

  select p.time_zone into v_time_zone
    from carnet.profiles p
   where p.id = v_old.profile_id
     and p.is_published;

  if v_old.status <> 'confirmed' or v_time_zone is null then
    raise exception 'booking target not found' using errcode = 'P0002';
  end if;

  select t.* into v_type from carnet.event_types t where t.id = v_old.event_type_id;

  if not carnet.meets_min_notice(pg_catalog.lower(v_old.range), p_now, v_type.min_notice_min) then
    raise exception 'reschedule deadline passed' using errcode = 'CN003';
  end if;

  if not v_type.is_active then
    raise exception 'slot unavailable' using errcode = 'CN002';
  end if;

  perform carnet.assert_bookable_slot(v_old.profile_id, v_time_zone, v_type.duration_min, v_type.buffer_min,
                                      v_type.min_notice_min, p_start, p_now, v_old.id);

  update carnet.bookings b
     set status = 'cancelled', cancelled_at = p_now, cancelled_by = 'visitor'
   where b.id = v_old.id;

  select i.o_booking_id, i.o_cancel_token into v_booking_id, v_token
    from carnet.insert_booking(v_old.profile_id, v_old.event_type_id, p_start, v_type.duration_min, v_old.visitor_name,
                               v_old.visitor_email, v_old.visitor_phone, v_old.message, v_old.consent_at,
                               p_idempotency_key, v_old.id, p_now) i;

  return query select v_booking_id, v_token;
end;
$$;

revoke execute on function carnet.reschedule_booking_by_token_at(text, timestamptz, uuid, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function carnet.reschedule_booking_by_token(p_token text, p_start timestamptz, p_idempotency_key uuid)
returns table (booking_id uuid, cancel_token text)
language sql
volatile
security definer
set search_path = ''
as $$
  select r.booking_id, r.cancel_token
    from carnet.reschedule_booking_by_token_at(p_token, p_start, p_idempotency_key, pg_catalog.now()) r;
$$;

revoke execute on function carnet.reschedule_booking_by_token(text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function carnet.reschedule_booking_by_token(text, timestamptz, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Point 15 — page d'annulation et de report (0040) ; null sans distinction (aucun oracle)
-- ---------------------------------------------------------------------------
create or replace function carnet.get_booking_by_token_at(p_token text, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'booking_id', b.id,
           'start', pg_catalog.lower(b.range),
           'end', pg_catalog.upper(b.range),
           'event_type_id', t.id,
           'event_type_title', t.title,
           'duration_min', t.duration_min,
           'location_kind', t.location_kind,
           'location_text', t.location_text,
           'time_zone', p.time_zone,
           'profile_slug', p.slug,
           'owner_display_name', p.display_name,
           'can_cancel', carnet.meets_min_notice(pg_catalog.lower(b.range), p_now, t.min_notice_min),
           'can_reschedule', carnet.meets_min_notice(pg_catalog.lower(b.range), p_now, t.min_notice_min)
                             and t.is_active
                             and p.is_published)
    from carnet.booking_tokens k
    join carnet.bookings b on b.id = k.booking_id
    join carnet.event_types t on t.id = b.event_type_id
    join carnet.profiles p on p.id = b.profile_id
   where k.token_hash = carnet.hash_booking_token(p_token)
     and b.status = 'confirmed'
     and pg_catalog.lower(b.range) > p_now;
$$;

revoke execute on function carnet.get_booking_by_token_at(text, timestamptz) from public, anon, authenticated, service_role;

create or replace function carnet.get_booking_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select carnet.get_booking_by_token_at(p_token, pg_catalog.now());
$$;

revoke execute on function carnet.get_booking_by_token(text) from public, anon, authenticated;
grant execute on function carnet.get_booking_by_token(text) to service_role;

-- ---------------------------------------------------------------------------
-- Décision 7 — annulation par le propriétaire (authenticated), sans délai minimal ; rendez-vous commencé → sans effet
-- ---------------------------------------------------------------------------
create or replace function carnet.cancel_own_booking(p_booking_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_status text;
  v_range tstzrange;
begin
  select b.profile_id into v_profile_id from carnet.bookings b where b.id = p_booking_id;

  -- Autorisation avant tout verrou : réservation d'autrui ou inconnue → même réponse.
  if v_profile_id is null or not (carnet.is_member() and carnet.can_edit_profile(v_profile_id)) then
    raise exception 'booking target not found' using errcode = 'P0002';
  end if;

  select b.status, b.range into v_status, v_range from carnet.bookings b where b.id = p_booking_id for update;

  if v_status is distinct from 'confirmed' or pg_catalog.lower(v_range) <= pg_catalog.now() then
    return;
  end if;

  update carnet.bookings b
     set status = 'cancelled', cancelled_at = pg_catalog.now(), cancelled_by = 'owner'
   where b.id = p_booking_id;

  insert into carnet.outbox (type, profile_id, payload)
  values ('booking.cancelled', v_profile_id,
          pg_catalog.jsonb_build_object('booking_id', p_booking_id, 'cancelled_by', 'owner'));
end;
$$;

revoke execute on function carnet.cancel_own_booking(uuid) from public, anon, service_role;
grant execute on function carnet.cancel_own_booking(uuid) to authenticated;
