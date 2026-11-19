-- Fiche 0039, point 8 (Hery, 19/11/2026) — quota du profil sur les seules réservations réussies.
--   La limite applicative `booking-profile` est supprimée ; carnet.book_slot_at est redéfinie à l'identique (même
--   signature, mêmes droits : exécutable par personne, appelée par carnet.book_slot sous `postgres`), sauf un contrôle
--   ajouté sous carnet.lock_profile_bookings, APRÈS la détection du rejeu (un rejeu reste un succès, même au plafond) :
--   si le profil a déjà 20 réservations confirmées créées après p_now − 23 h, refus CN005 sans rien écrire. Une
--   réservation annulée (par le visiteur ou par le propriétaire) libère le quota ; un échec (CN001, CN002) n'écrit rien,
--   donc ne consomme rien.
--   Index partiel bookings_profile_id_created_at_confirmed_idx pour ce comptage.
--   Codes : ceux de 20261118190000, plus CN005 quota de réservations du profil atteint.
-- Préconditions : migrations 20261118180000 et 20261118190000 ; rôle de migration `postgres`. Rejouable.

create index if not exists bookings_profile_id_created_at_confirmed_idx
  on carnet.bookings (profile_id, created_at)
  where status = 'confirmed';

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

  if (select count(*)
        from carnet.bookings b
       where b.profile_id = v_profile_id
         and b.status = 'confirmed'
         and b.created_at > p_now - interval '23 hours') >= 20 then
    raise exception 'booking quota reached' using errcode = 'CN005';
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
