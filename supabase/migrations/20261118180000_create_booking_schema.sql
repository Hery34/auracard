-- Fiche 0036 / ADR 0002, 0004, 0005, 0011, 0016 — schéma du module de rendez-vous.
--   btree_gist (schéma extensions) : contraintes d'exclusion mêlant uuid / smallint (=) et plages (&&).
--   carnet.is_valid_time_zone : nom exact de pg_timezone_names (casse comprise) ; déclarée immutable pour servir dans
--     une contrainte check (la base IANA ne change qu'avec une mise à jour du serveur).
--   carnet.profiles.time_zone : fuseau du profil (ADR 0016 §2, amende architecture §4), éditable par le propriétaire
--     (droit update par colonne, liste de 0031 + 1), non exposé par public_profiles.
--   carnet.is_valid_plain_text : execute accordé à authenticated (contrainte de event_types, écrite directement sous
--     RLS) ; fonction pure, sans lecture.
--   carnet.event_types : au plus 10 par profil (positions 0 à 9 uniques) ; unique (id, profile_id), cible de la clé
--     composite de bookings (un type ne sert qu'aux réservations de son profil ; on delete no action : un type ayant
--     des réservations se désactive, il ne se supprime pas).
--   carnet.availability_rules : heures locales du fuseau du profil ; aucune plage chevauchante le même jour (exclusion) ;
--     point 17 : heures à la minute, plage d'au moins 5 minutes (check), au plus 50 règles par profil (trigger).
--   carnet.availability_exceptions : plages [) finies, busy ou extra ; point 17 : bornes à la minute (check), au plus
--     200 exceptions à venir (upper(range) > now()) par profil (trigger).
--   Plafonds (point 17) : triggers after insert or update (après la RLS : aucun oracle sur le profil d'autrui), sous
--     carnet.lock_profile_bookings (verrou transactionnel du profil) puis recomptage : robustes en concurrence en
--     read committed (niveau de PostgREST). Refus 23514.
--   Point 18 : update par colonne (champs métier seulement) sur event_types, availability_rules, availability_exceptions.
--   carnet.bookings : aucune écriture directe (fonctions security definer) ; exclusion des plages confirmées par profil.
--   carnet.booking_tokens : hachages SHA-256 des jetons d'annulation (plusieurs par réservation), aucun accès direct.
--   outbox_type_check : types booking.* ajoutés ; is_valid_analytics_metric : booking_viewed, booking_started,
--     booking_confirmed ajoutées.
-- Suppression de compte (0023) : cascade depuis carnet.profiles sur les quatre tables ; booking_tokens en cascade
-- depuis bookings. La clé bookings → event_types (no action) est vérifiée en fin d'instruction : la cascade du profil
-- supprime types et réservations ensemble.
-- Préconditions : rôle de migration `postgres` (bypassrls) ; btree_gist disponible sur l'instance (ADR 0016 §5, à
-- confirmer par Hery). Rejouable, sans `cascade`.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Décision 1 — profiles.time_zone
-- ---------------------------------------------------------------------------
create or replace function carnet.is_valid_time_zone(p_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_value);
$$;

revoke execute on function carnet.is_valid_time_zone(text) from public, anon;
grant execute on function carnet.is_valid_time_zone(text) to authenticated, service_role;

alter table carnet.profiles add column if not exists time_zone text not null default 'Europe/Paris';

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'profiles_time_zone_check' and conrelid = 'carnet.profiles'::regclass
  ) then
    alter table carnet.profiles
      add constraint profiles_time_zone_check check (carnet.is_valid_time_zone(time_zone));
  end if;
end
$$;

revoke update on carnet.profiles from authenticated;
grant update (display_name, job_title, company, bio, contact_email, phone, website_url, is_published, is_indexable,
              accepts_leads, time_zone)
  on carnet.profiles to authenticated;

grant execute on function carnet.is_valid_plain_text(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Décision 2 — carnet.event_types
-- ---------------------------------------------------------------------------
create table if not exists carnet.event_types (
  id             uuid        not null default gen_random_uuid(),
  profile_id     uuid        not null,
  title          text        not null,
  duration_min   integer     not null,
  buffer_min     integer     not null default 0,
  min_notice_min integer     not null default 120,
  location_kind  text        not null,
  location_text  text,
  is_active      boolean     not null default true,
  position       smallint    not null,
  created_at     timestamptz not null default now(),
  constraint event_types_pkey primary key (id),
  constraint event_types_profile_id_fkey
    foreign key (profile_id) references carnet.profiles (id) on delete cascade,
  constraint event_types_profile_id_position_key unique (profile_id, position) deferrable initially immediate,
  constraint event_types_id_profile_id_key unique (id, profile_id),
  constraint event_types_title_check check (
    char_length(title) between 1 and 80 and title ~ '[^[:space:]]' and carnet.is_valid_plain_text(title, false)
  ),
  constraint event_types_duration_min_check check (duration_min between 5 and 480),
  constraint event_types_buffer_min_check check (buffer_min between 0 and 240),
  constraint event_types_min_notice_min_check check (min_notice_min between 0 and 43200),
  constraint event_types_location_kind_check check (location_kind in ('in_person', 'phone', 'video')),
  constraint event_types_location_text_check check (
    location_text is null
    or (char_length(location_text) between 1 and 500 and carnet.is_valid_plain_text(location_text, false))
  ),
  constraint event_types_position_check check (position between 0 and 9)
);

-- Index : event_types_profile_id_position_key commence par profile_id et couvre la clé étrangère.

-- ---------------------------------------------------------------------------
-- Décision 3 — carnet.availability_rules (heures locales du fuseau du profil)
-- ---------------------------------------------------------------------------
create table if not exists carnet.availability_rules (
  id         uuid        not null default gen_random_uuid(),
  profile_id uuid        not null,
  weekday    smallint    not null,
  start_time time        not null,
  end_time   time        not null,
  created_at timestamptz not null default now(),
  constraint availability_rules_pkey primary key (id),
  constraint availability_rules_profile_id_fkey
    foreign key (profile_id) references carnet.profiles (id) on delete cascade,
  constraint availability_rules_weekday_check check (weekday between 1 and 7),
  constraint availability_rules_time_order_check check (start_time < end_time),
  constraint availability_rules_min_length_check check (end_time - start_time >= interval '5 minutes'),
  constraint availability_rules_minute_precision_check check (
    extract(second from start_time) = 0 and extract(second from end_time) = 0
  ),
  -- Date fixe arbitraire : seule compte la comparaison des heures ; [) laisse les plages contiguës.
  constraint availability_rules_no_overlap exclude using gist (
    profile_id with =,
    weekday with =,
    tsrange(date '2000-01-03' + start_time, date '2000-01-03' + end_time) with &&
  )
);

-- Index : l'index gist de availability_rules_no_overlap commence par profile_id et couvre la clé étrangère.

-- ---------------------------------------------------------------------------
-- Décision 4 — carnet.availability_exceptions
-- ---------------------------------------------------------------------------
create table if not exists carnet.availability_exceptions (
  id         uuid        not null default gen_random_uuid(),
  profile_id uuid        not null,
  range      tstzrange   not null,
  kind       text        not null,
  created_at timestamptz not null default now(),
  constraint availability_exceptions_pkey primary key (id),
  constraint availability_exceptions_profile_id_fkey
    foreign key (profile_id) references carnet.profiles (id) on delete cascade,
  constraint availability_exceptions_range_check check (
    not isempty(range) and not lower_inf(range) and not upper_inf(range) and lower_inc(range) and not upper_inc(range)
  ),
  constraint availability_exceptions_kind_check check (kind in ('busy', 'extra')),
  -- Epoch : indépendant du fuseau de session (secondes et fractions refusées).
  constraint availability_exceptions_minute_precision_check check (
    mod(extract(epoch from lower(range)), 60) = 0 and mod(extract(epoch from upper(range)), 60) = 0
  )
);

-- Couvre la clé étrangère et les recherches de chevauchement par profil.
create index if not exists availability_exceptions_profile_id_range_idx
  on carnet.availability_exceptions using gist (profile_id, range);

-- ---------------------------------------------------------------------------
-- Décision 5 — carnet.bookings
-- ---------------------------------------------------------------------------
create table if not exists carnet.bookings (
  id                 uuid        not null default gen_random_uuid(),
  profile_id         uuid        not null,
  event_type_id      uuid        not null,
  range              tstzrange   not null,
  status             text        not null default 'confirmed',
  visitor_name       text        not null,
  visitor_email      text        not null,
  visitor_phone      text,
  message            text,
  consent_at         timestamptz not null,
  idempotency_key    uuid        not null,
  cancelled_at       timestamptz,
  cancelled_by       text,
  rescheduled_from   uuid,
  reminder_queued_at timestamptz,
  created_at         timestamptz not null default now(),
  constraint bookings_pkey primary key (id),
  constraint bookings_profile_id_fkey
    foreign key (profile_id) references carnet.profiles (id) on delete cascade,
  constraint bookings_event_type_id_profile_id_fkey
    foreign key (event_type_id, profile_id) references carnet.event_types (id, profile_id) on delete no action,
  constraint bookings_rescheduled_from_fkey
    foreign key (rescheduled_from) references carnet.bookings (id) on delete set null,
  constraint bookings_profile_id_idempotency_key_key unique (profile_id, idempotency_key),
  constraint bookings_range_check check (
    not isempty(range) and not lower_inf(range) and not upper_inf(range) and lower_inc(range) and not upper_inc(range)
  ),
  constraint bookings_status_check check (status in ('confirmed', 'cancelled')),
  constraint bookings_cancelled_by_check check (cancelled_by in ('visitor', 'owner')),
  constraint bookings_cancellation_consistency_check check (
    (status = 'cancelled') = (cancelled_at is not null) and (status = 'cancelled') = (cancelled_by is not null)
  ),
  constraint bookings_visitor_name_check check (
    char_length(visitor_name) between 1 and 100 and visitor_name ~ '[^[:space:]]'
  ),
  constraint bookings_visitor_email_length_check check (char_length(visitor_email) <= 254),
  constraint bookings_visitor_email_format_check check (visitor_email ~ '^[^@[:space:],;<>"]+@[^@[:space:],;<>"]+$'),
  constraint bookings_visitor_phone_check check (
    char_length(visitor_phone) <= 32 and visitor_phone ~ '^\+?[0-9 .()-]+$'
  ),
  constraint bookings_message_length_check check (char_length(message) <= 2000),
  constraint bookings_text_charset_check check (
    carnet.is_valid_plain_text(visitor_name, false)
    and carnet.is_valid_plain_text(visitor_email, false)
    and (message is null or carnet.is_valid_plain_text(message, true))
  ),
  constraint bookings_no_overlap exclude using gist (profile_id with =, range with &&) where (status = 'confirmed')
);

-- Index : bookings_profile_id_idempotency_key_key commence par profile_id et couvre la clé étrangère du profil.
create index if not exists bookings_event_type_id_profile_id_idx on carnet.bookings (event_type_id, profile_id);
create index if not exists bookings_rescheduled_from_idx on carnet.bookings (rescheduled_from);
-- Occupations par profil (contrôle de créneau, lecture publique), y compris les réservations annulées.
create index if not exists bookings_profile_id_range_idx on carnet.bookings using gist (profile_id, range);
-- Rappels (pg_cron toutes les 15 minutes).
create index if not exists bookings_reminder_due_idx
  on carnet.bookings (lower(range))
  where status = 'confirmed' and reminder_queued_at is null;

-- ---------------------------------------------------------------------------
-- Point 14 — carnet.booking_tokens
-- ---------------------------------------------------------------------------
create table if not exists carnet.booking_tokens (
  token_hash bytea       not null,
  booking_id uuid        not null,
  created_at timestamptz not null default now(),
  constraint booking_tokens_pkey primary key (token_hash),
  constraint booking_tokens_booking_id_fkey
    foreign key (booking_id) references carnet.bookings (id) on delete cascade,
  constraint booking_tokens_token_hash_length_check check (octet_length(token_hash) = 32)
);

create index if not exists booking_tokens_booking_id_idx on carnet.booking_tokens (booking_id);

-- ---------------------------------------------------------------------------
-- Points 15 et 18 — verrou transactionnel par profil (réservations, report, plafonds de disponibilités)
-- ---------------------------------------------------------------------------
create or replace function carnet.lock_profile_bookings(p_profile_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carnet.bookings:' || p_profile_id::text, 0));
end;
$$;

revoke execute on function carnet.lock_profile_bookings(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Point 17 — plafonds par profil (after : la ligne a passé la RLS ; recomptage sous verrou)
-- ---------------------------------------------------------------------------
create or replace function carnet.enforce_availability_rules_limit()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform carnet.lock_profile_bookings(new.profile_id);

  if (select count(*) from carnet.availability_rules r where r.profile_id = new.profile_id) > 50 then
    raise exception 'availability rules limit reached' using errcode = '23514';
  end if;

  return null;
end;
$$;

revoke execute on function carnet.enforce_availability_rules_limit() from public, anon, authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
     where tgname = 'availability_rules_limit' and tgrelid = 'carnet.availability_rules'::regclass
  ) then
    create trigger availability_rules_limit
      after insert or update on carnet.availability_rules
      for each row execute function carnet.enforce_availability_rules_limit();
  end if;
end
$$;

-- Une exception terminée ne compte pas et n'est pas contrôlée. range && [now(), ∞) ⇔ upper(range) > now() pour une
-- plage [) non vide (forme indexable par availability_exceptions_profile_id_range_idx).
create or replace function carnet.enforce_availability_exceptions_limit()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if pg_catalog.upper(new.range) <= pg_catalog.now() then
    return null;
  end if;

  perform carnet.lock_profile_bookings(new.profile_id);

  if (select count(*)
        from carnet.availability_exceptions x
       where x.profile_id = new.profile_id
         and x.range && pg_catalog.tstzrange(pg_catalog.now(), null)) > 200 then
    raise exception 'availability exceptions limit reached' using errcode = '23514';
  end if;

  return null;
end;
$$;

revoke execute on function carnet.enforce_availability_exceptions_limit() from public, anon, authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
     where tgname = 'availability_exceptions_limit' and tgrelid = 'carnet.availability_exceptions'::regclass
  ) then
    create trigger availability_exceptions_limit
      after insert or update on carnet.availability_exceptions
      for each row execute function carnet.enforce_availability_exceptions_limit();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Décision 6 — RLS : propriétaire seul, une politique par opération, aucune pour anon
-- ---------------------------------------------------------------------------
alter table carnet.event_types enable row level security;
alter table carnet.event_types force row level security;
alter table carnet.availability_rules enable row level security;
alter table carnet.availability_rules force row level security;
alter table carnet.availability_exceptions enable row level security;
alter table carnet.availability_exceptions force row level security;
alter table carnet.bookings enable row level security;
alter table carnet.bookings force row level security;
alter table carnet.booking_tokens enable row level security;
alter table carnet.booking_tokens force row level security;

drop policy if exists event_types_select_own on carnet.event_types;
create policy event_types_select_own
  on carnet.event_types
  for select
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists event_types_insert_own on carnet.event_types;
create policy event_types_insert_own
  on carnet.event_types
  for insert
  to authenticated
  with check ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists event_types_update_own on carnet.event_types;
create policy event_types_update_own
  on carnet.event_types
  for update
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)))
  with check ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists event_types_delete_own on carnet.event_types;
create policy event_types_delete_own
  on carnet.event_types
  for delete
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists availability_rules_select_own on carnet.availability_rules;
create policy availability_rules_select_own
  on carnet.availability_rules
  for select
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists availability_rules_insert_own on carnet.availability_rules;
create policy availability_rules_insert_own
  on carnet.availability_rules
  for insert
  to authenticated
  with check ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists availability_rules_update_own on carnet.availability_rules;
create policy availability_rules_update_own
  on carnet.availability_rules
  for update
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)))
  with check ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists availability_rules_delete_own on carnet.availability_rules;
create policy availability_rules_delete_own
  on carnet.availability_rules
  for delete
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists availability_exceptions_select_own on carnet.availability_exceptions;
create policy availability_exceptions_select_own
  on carnet.availability_exceptions
  for select
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists availability_exceptions_insert_own on carnet.availability_exceptions;
create policy availability_exceptions_insert_own
  on carnet.availability_exceptions
  for insert
  to authenticated
  with check ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists availability_exceptions_update_own on carnet.availability_exceptions;
create policy availability_exceptions_update_own
  on carnet.availability_exceptions
  for update
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)))
  with check ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists availability_exceptions_delete_own on carnet.availability_exceptions;
create policy availability_exceptions_delete_own
  on carnet.availability_exceptions
  for delete
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists bookings_select_own on carnet.bookings;
create policy bookings_select_own
  on carnet.bookings
  for select
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

-- booking_tokens : aucune politique (accès par fonctions security definer seulement).

-- Le revoke de table retire aussi les droits par colonne (rejouable).
revoke all on carnet.event_types from public, anon, authenticated;
grant select, insert, delete on carnet.event_types to authenticated;
grant update (title, duration_min, buffer_min, min_notice_min, location_kind, location_text, is_active, position)
  on carnet.event_types to authenticated;
grant all on carnet.event_types to service_role;

revoke all on carnet.availability_rules from public, anon, authenticated;
grant select, insert, delete on carnet.availability_rules to authenticated;
grant update (weekday, start_time, end_time) on carnet.availability_rules to authenticated;
grant all on carnet.availability_rules to service_role;

revoke all on carnet.availability_exceptions from public, anon, authenticated;
grant select, insert, delete on carnet.availability_exceptions to authenticated;
grant update (range, kind) on carnet.availability_exceptions to authenticated;
grant all on carnet.availability_exceptions to service_role;

revoke all on carnet.bookings from public, anon, authenticated;
grant select on carnet.bookings to authenticated;
grant all on carnet.bookings to service_role;

revoke all on carnet.booking_tokens from public, anon, authenticated;
grant all on carnet.booking_tokens to service_role;

-- ---------------------------------------------------------------------------
-- Décision 9 — types d'outbox
-- ---------------------------------------------------------------------------
alter table carnet.outbox drop constraint if exists outbox_type_check;
alter table carnet.outbox add constraint outbox_type_check check (
  type in ('lead.created', 'booking.confirmed', 'booking.cancelled', 'booking.rescheduled', 'booking.reminder')
);

-- ---------------------------------------------------------------------------
-- Décision 10 — métriques (liste étendue ; droits conservés par create or replace)
-- ---------------------------------------------------------------------------
create or replace function carnet.is_valid_analytics_metric(p_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(p_value in ('profile_view', 'nfc_scan', 'qr_scan', 'vcard_download', 'link_click', 'contact_click',
                              'lead_submitted', 'booking_viewed', 'booking_started', 'booking_confirmed'), false);
$$;
