-- Fiche 0036 / ADR 0006, 0016 — tâches et consommation de l'outbox du module de rendez-vous.
--   carnet.claim_outbox (0031) : restreinte à lead.created (point 15) ; signature, droits et comportement inchangés
--     pour les leads.
--   carnet.claim_booking_outbox(p_limit) : même mécanique que claim_outbox pour les booking.* (service_role seul) ;
--     réservation disparue, ou rappel d'une réservation qui n'est plus confirmée ou déjà commencée (point 18) →
--     processed ; attempts >= 5 → dead ; écartés : cancel_token retiré de la charge utile (point 17) ; sinon verrou,
--     attempts + 1, et données nécessaires à n8n (0041), dont le créneau de la réservation reportée (point 18).
--   carnet.complete_outbox / carnet.fail_outbox (0031) : signatures, droits et comportement inchangés ; point 17 :
--     cancel_token retiré de la charge utile des booking.* au passage à processed ou dead (pending le garde ;
--     lead.created jamais modifié).
--   carnet.queue_booking_reminders() : booking.reminder (jeton neuf) pour les réservations confirmées qui commencent
--     dans [now() + 23 h 45, now() + 24 h 15[, créées au moins 24 h avant leur début, une seule fois (reminder_queued_at).
--   carnet.purge_bookings(p_older_than) : réservations terminées depuis plus de p_older_than (jetons en cascade,
--     rescheduled_from des survivantes à null).
--   pg_cron : `carnet-queue-booking-reminders` (toutes les 15 minutes), `carnet-purge-bookings` (quotidienne, 12 mois).
-- Préconditions : migrations 20261118180000 et 20261118190000 ; rôle de migration `postgres` ; pg_cron disponible.
-- Rejouable.

-- ---------------------------------------------------------------------------
-- claim_outbox (0031) : lead.created seulement
-- ---------------------------------------------------------------------------
create or replace function carnet.claim_outbox(p_limit integer)
returns table (
  id uuid,
  type text,
  attempts integer,
  owner_display_name text,
  owner_email text,
  lead_name text,
  lead_email text,
  lead_message text,
  lead_created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'p_limit must be a positive integer' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select o.id,
           case
             when not exists (select 1 from carnet.leads l where l.id = (o.payload ->> 'lead_id')::uuid)
               then 'processed'
             when o.attempts >= 5 then 'dead'
             else 'claim'
           end as outcome
      from carnet.outbox o
     where o.type = 'lead.created'
       and o.status = 'pending'
       and (o.locked_at is null or o.locked_at < now() - interval '5 minutes')
     order by o.created_at, o.id
     limit p_limit
     for update skip locked
  ),
  discarded as (
    update carnet.outbox o
       set status = c.outcome,
           processed_at = case when c.outcome = 'processed' then now() else o.processed_at end
      from candidates c
     where o.id = c.id and c.outcome in ('processed', 'dead')
  ),
  claimed as (
    update carnet.outbox o
       set locked_at = now(), attempts = o.attempts + 1
      from candidates c
     where o.id = c.id and c.outcome = 'claim'
    returning o.id, o.type, o.attempts, o.profile_id, o.payload, o.created_at
  )
  select c.id, c.type, c.attempts, p.display_name, u.email::text, l.name, l.email, l.message, l.created_at
    from claimed c
    join carnet.profiles p on p.id = c.profile_id
    join auth.users u on u.id = p.owner_id
    join carnet.leads l on l.id = (c.payload ->> 'lead_id')::uuid
   order by c.created_at, c.id;
end;
$$;

revoke execute on function carnet.claim_outbox(integer) from public, anon, authenticated;
grant execute on function carnet.claim_outbox(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Point 15 — claim_booking_outbox (n8n, service_role seul)
-- ---------------------------------------------------------------------------
create or replace function carnet.claim_booking_outbox(p_limit integer)
returns table (
  id uuid,
  type text,
  attempts integer,
  booking_id uuid,
  previous_booking_id uuid,
  previous_booking_start timestamptz,
  previous_booking_end timestamptz,
  cancelled_by text,
  booking_start timestamptz,
  booking_end timestamptz,
  event_type_title text,
  location_kind text,
  location_text text,
  time_zone text,
  profile_slug text,
  owner_display_name text,
  owner_email text,
  visitor_name text,
  visitor_email text,
  visitor_phone text,
  visitor_message text,
  cancel_token text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'p_limit must be a positive integer' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select o.id,
           case
             when not exists (select 1 from carnet.bookings b where b.id = (o.payload ->> 'booking_id')::uuid)
               then 'processed'
             when o.type = 'booking.reminder'
                  and not exists (select 1 from carnet.bookings b
                                   where b.id = (o.payload ->> 'booking_id')::uuid
                                     and b.status = 'confirmed'
                                     and lower(b.range) > now())
               then 'processed'
             when o.attempts >= 5 then 'dead'
             else 'claim'
           end as outcome
      from carnet.outbox o
     where o.type in ('booking.confirmed', 'booking.cancelled', 'booking.rescheduled', 'booking.reminder')
       and o.status = 'pending'
       and (o.locked_at is null or o.locked_at < now() - interval '5 minutes')
     order by o.created_at, o.id
     limit p_limit
     for update skip locked
  ),
  discarded as (
    update carnet.outbox o
       set status = c.outcome,
           processed_at = case when c.outcome = 'processed' then now() else o.processed_at end,
           payload = o.payload - 'cancel_token'
      from candidates c
     where o.id = c.id and c.outcome in ('processed', 'dead')
  ),
  claimed as (
    update carnet.outbox o
       set locked_at = now(), attempts = o.attempts + 1
      from candidates c
     where o.id = c.id and c.outcome = 'claim'
    returning o.id, o.type, o.attempts, o.payload, o.created_at
  )
  -- Réservation reportée : left join (peut avoir été purgée) ; null hors booking.rescheduled.
  select c.id, c.type, c.attempts, b.id, (c.payload ->> 'previous_booking_id')::uuid, lower(pb.range), upper(pb.range),
         c.payload ->> 'cancelled_by', lower(b.range), upper(b.range), t.title, t.location_kind, t.location_text,
         p.time_zone, p.slug, p.display_name, u.email::text, b.visitor_name, b.visitor_email, b.visitor_phone, b.message,
         c.payload ->> 'cancel_token'
    from claimed c
    join carnet.bookings b on b.id = (c.payload ->> 'booking_id')::uuid
    left join carnet.bookings pb on pb.id = (c.payload ->> 'previous_booking_id')::uuid
    join carnet.event_types t on t.id = b.event_type_id
    join carnet.profiles p on p.id = b.profile_id
    join auth.users u on u.id = p.owner_id
   order by c.created_at, c.id;
end;
$$;

revoke execute on function carnet.claim_booking_outbox(integer) from public, anon, authenticated;
grant execute on function carnet.claim_booking_outbox(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Point 17 — complete_outbox / fail_outbox (0031) : jeton en clair retiré des booking.* traités ou morts
-- ---------------------------------------------------------------------------
create or replace function carnet.complete_outbox(p_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update carnet.outbox o
     set status = 'processed',
         processed_at = now(),
         payload = case when o.type like 'booking.%' then o.payload - 'cancel_token' else o.payload end
   where o.id = p_id
     and o.status = 'pending';
$$;

-- p_error tronqué avant le masquage (coût borné), adresses e-mail masquées, puis tronqué à 500 caractères.
create or replace function carnet.fail_outbox(p_id uuid, p_error text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update carnet.outbox o
     set status = case when o.attempts >= 5 then 'dead' else 'pending' end,
         last_error = left(
           regexp_replace(left(p_error, 2000), '[^[:space:]<>()"'',;:@]+@[^[:space:]<>()"'',;:@]+', '[email]', 'g'),
           500),
         payload = case when o.attempts >= 5 and o.type like 'booking.%' then o.payload - 'cancel_token'
                        else o.payload end
   where o.id = p_id
     and o.status = 'pending';
$$;

revoke execute on function carnet.complete_outbox(uuid) from public, anon, authenticated;
grant execute on function carnet.complete_outbox(uuid) to service_role;
revoke execute on function carnet.fail_outbox(uuid, text) from public, anon, authenticated;
grant execute on function carnet.fail_outbox(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Décision 8 — rappels (pg_cron sous `postgres`) ; renvoie le nombre de rappels écrits
-- ---------------------------------------------------------------------------
create or replace function carnet.queue_booking_reminders()
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_booking record;
  v_count integer := 0;
begin
  for v_booking in
    select b.id, b.profile_id
      from carnet.bookings b
     where b.status = 'confirmed'
       and b.reminder_queued_at is null
       and lower(b.range) >= now() + interval '23 hours 45 minutes'
       and lower(b.range) < now() + interval '24 hours 15 minutes'
       and b.created_at <= lower(b.range) - interval '24 hours'
       for update skip locked
  loop
    insert into carnet.outbox (type, profile_id, payload)
    values ('booking.reminder', v_booking.profile_id,
            pg_catalog.jsonb_build_object('booking_id', v_booking.id,
                                          'cancel_token', carnet.issue_booking_token(v_booking.id)));

    update carnet.bookings b set reminder_queued_at = now() where b.id = v_booking.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function carnet.queue_booking_reminders() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Décision 11 — purge (pg_cron sous `postgres`) ; renvoie le nombre de réservations supprimées
-- ---------------------------------------------------------------------------
create or replace function carnet.purge_bookings(p_older_than interval)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_older_than is null or p_older_than <= interval '0' then
    raise exception using
      errcode = '22023',
      message = 'purge_bookings: p_older_than must be a positive interval';
  end if;

  delete from carnet.bookings b
   where upper(b.range) < now() - p_older_than;

  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke execute on function carnet.purge_bookings(interval) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tâches pg_cron. Préfixe `carnet-` ; rejeu : cron.schedule met à jour la tâche du même nom (même jobid).
-- ---------------------------------------------------------------------------
select cron.schedule(
  'carnet-queue-booking-reminders',
  '*/15 * * * *',
  $$select carnet.queue_booking_reminders()$$
);

select cron.schedule(
  'carnet-purge-bookings',
  '0 4 * * *',
  $$select carnet.purge_bookings(interval '12 months')$$
);
