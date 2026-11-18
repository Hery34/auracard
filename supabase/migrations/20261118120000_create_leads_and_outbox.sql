-- Fiche 0031 / ADR 0002, 0004, 0006, 0011 (avenant du 18/11/2026) — leads et outbox transactionnelle.
--   carnet.is_valid_plain_text : liste unique des caractères interdits (celle de 0022), écrite en échappements ;
--     p_allow_newlines autorise \n et \r (texte long). Utilisée par leads ; profiles et links : fiche dédiée.
--   carnet.profiles.accepts_leads : éditable par le propriétaire (droit update par colonne, liste de 0022 + 1),
--     exposée en dernière colonne de carnet.public_profiles, donc par get_public_profile (décision 10).
--   carnet.leads : lus et supprimés par le seul propriétaire (RLS) ; aucune insertion ni modification directe.
--     E-mail : un seul @, ni blanc, ni , ; < > " ; nom et message non vides hors blancs.
--   carnet.outbox : aucun accès anon / authenticated ; payload limité aux identifiants ({"lead_id": …}).
--   carnet.capture_lead : lead + outbox `lead.created` + analytics_events `lead_submitted` (id = id du lead, device_class
--     transmis par la route) dans la même transaction ; rejeu de la même clé → id existant, aucune écriture.
--     p_device_class invalide : 22023 avant tout contrôle du profil. Profil inconnu, non publié ou refusant les
--     messages : même erreur P0002.
--   carnet.claim_outbox / complete_outbox / fail_outbox : consommation par n8n (service_role seul). Décision 7 amendée :
--     attempts compte les réservations ; claim_outbox l'incrémente et renvoie la valeur après incrément ; un pending
--     dont attempts vaut déjà 5 passe dead à la réservation suivante, sans être renvoyé. Un lead.created dont le lead a
--     disparu n'est pas renvoyé et passe processed (décision 10). fail_outbox n'incrémente pas : erreur enregistrée,
--     dead si attempts >= 5, sinon pending avec son verrou (nouvel essai après 5 minutes).
--   carnet.purge_outbox / purge_leads + pg_cron `carnet-purge-outbox` (30 jours, âge = coalesce(processed_at, locked_at, created_at))
--     et `carnet-purge-leads` (12 mois).
-- Suppression de compte (0023) : cascade depuis carnet.profiles sur leads et outbox ; analytics_events déjà en cascade.
-- Préconditions : migration 0028 appliquée (is_valid_analytics_device_class) ; rôle de migration `postgres`
-- (bypassrls), propriétaire des fonctions ; pg_cron disponible. Rejouable, sans `cascade`.

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Validation de texte (liste de 0022, échappements uniquement)
-- ---------------------------------------------------------------------------
create or replace function carnet.is_valid_plain_text(p_value text, p_allow_newlines boolean)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
           case when p_allow_newlines then
             p_value !~ E'[\u0001-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'
           else
             p_value !~ E'[\u0001-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'
           end,
           false);
$$;

revoke execute on function carnet.is_valid_plain_text(text, boolean) from public, anon, authenticated;
grant execute on function carnet.is_valid_plain_text(text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Décisions 1 et 10 — profiles.accepts_leads
-- ---------------------------------------------------------------------------
alter table carnet.profiles add column if not exists accepts_leads boolean not null default true;

revoke update on carnet.profiles from authenticated;
grant update (display_name, job_title, company, bio, contact_email, phone, website_url, is_published, is_indexable,
              accepts_leads)
  on carnet.profiles to authenticated;

-- Ajout en fin de vue : le type ligne garde son identité, get_public_profile (select *, sql non atomique) renvoie la
-- nouvelle colonne sans être recréée ni changer de signature ou de droits.
create or replace view carnet.public_profiles
with (security_barrier = true)
as
  select slug, display_name, job_title, company, bio, avatar_url, banner_url, theme,
         contact_email, phone, website_url, is_indexable, logo_url, accepts_leads
    from carnet.profiles
   where is_published;

revoke all on carnet.public_profiles from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Décision 2 — carnet.leads
-- ---------------------------------------------------------------------------
create table if not exists carnet.leads (
  id              uuid        not null default gen_random_uuid(),
  profile_id      uuid        not null,
  name            text        not null,
  email           text        not null,
  message         text        not null,
  consent_at      timestamptz not null,
  idempotency_key uuid        not null,
  created_at      timestamptz not null default now(),
  constraint leads_pkey primary key (id),
  constraint leads_profile_id_fkey
    foreign key (profile_id) references carnet.profiles (id) on delete cascade,
  constraint leads_profile_id_idempotency_key_key unique (profile_id, idempotency_key),
  constraint leads_name_length_check check (char_length(btrim(name)) >= 1 and char_length(name) <= 100),
  constraint leads_email_length_check check (char_length(email) <= 254),
  constraint leads_email_format_check check (email ~ '^[^@[:space:],;<>"]+@[^@[:space:],;<>"]+$'),
  constraint leads_message_length_check check (
    char_length(btrim(message, E' \n\r')) >= 1 and char_length(message) <= 2000
  ),
  constraint leads_text_charset_check check (
    carnet.is_valid_plain_text(name, false)
    and carnet.is_valid_plain_text(email, false)
    and carnet.is_valid_plain_text(message, true)
  )
);

-- Index : leads_profile_id_idempotency_key_key commence par profile_id et couvre la clé étrangère.
create index if not exists leads_created_at_idx on carnet.leads (created_at);

alter table carnet.leads enable row level security;
alter table carnet.leads force row level security;

drop policy if exists leads_select_own on carnet.leads;
create policy leads_select_own
  on carnet.leads
  for select
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists leads_delete_own on carnet.leads;
create policy leads_delete_own
  on carnet.leads
  for delete
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

-- Le revoke de table retire aussi les droits par colonne (rejouable).
revoke all on carnet.leads from public, anon, authenticated;
grant select, delete on carnet.leads to authenticated;
grant all on carnet.leads to service_role;

-- ---------------------------------------------------------------------------
-- Décision 6 — carnet.outbox
-- ---------------------------------------------------------------------------
create table if not exists carnet.outbox (
  id           uuid        not null default gen_random_uuid(),
  type         text        not null,
  profile_id   uuid        not null,
  payload      jsonb       not null,
  status       text        not null default 'pending',
  attempts     integer     not null default 0,
  locked_at    timestamptz,
  processed_at timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  constraint outbox_pkey primary key (id),
  constraint outbox_profile_id_fkey
    foreign key (profile_id) references carnet.profiles (id) on delete cascade,
  constraint outbox_type_check check (type in ('lead.created')),
  constraint outbox_status_check check (status in ('pending', 'processed', 'dead')),
  constraint outbox_attempts_check check (attempts >= 0)
);

create index if not exists outbox_profile_id_idx on carnet.outbox (profile_id);
create index if not exists outbox_pending_created_at_idx on carnet.outbox (created_at) where status = 'pending';

alter table carnet.outbox enable row level security;
alter table carnet.outbox force row level security;

revoke all on carnet.outbox from public, anon, authenticated;
grant all on carnet.outbox to service_role;

-- ---------------------------------------------------------------------------
-- Décisions 4 et 5 — capture d'un message (service_role seul)
-- ---------------------------------------------------------------------------
drop function if exists carnet.capture_lead(text, text, text, text, uuid);

create or replace function carnet.capture_lead(
  p_slug text,
  p_name text,
  p_email text,
  p_message text,
  p_idempotency_key uuid,
  p_device_class text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_lead_id uuid;
begin
  if not carnet.is_valid_analytics_device_class(p_device_class) then
    raise exception 'invalid device class' using errcode = '22023';
  end if;

  select p.id into v_profile_id
    from carnet.profiles p
   where p.slug = p_slug
     and p.is_published
     and p.accepts_leads;

  if v_profile_id is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  insert into carnet.leads (profile_id, name, email, message, consent_at, idempotency_key)
  values (v_profile_id, p_name, p_email, p_message, now(), p_idempotency_key)
  on conflict on constraint leads_profile_id_idempotency_key_key do nothing
  returning id into v_lead_id;

  if v_lead_id is null then
    select l.id into v_lead_id
      from carnet.leads l
     where l.profile_id = v_profile_id
       and l.idempotency_key = p_idempotency_key;
    return v_lead_id;
  end if;

  insert into carnet.outbox (type, profile_id, payload)
  values ('lead.created', v_profile_id, jsonb_build_object('lead_id', v_lead_id));

  insert into carnet.analytics_events (id, profile_id, type, source, device_class)
  values (v_lead_id, v_profile_id, 'lead_submitted', 'direct', p_device_class);

  return v_lead_id;
end;
$$;

revoke execute on function carnet.capture_lead(text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function carnet.capture_lead(text, text, text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Décisions 7 (amendée) et 10 — consommation de l'outbox par n8n (service_role seul)
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
             when o.type = 'lead.created'
                  and not exists (select 1 from carnet.leads l where l.id = (o.payload ->> 'lead_id')::uuid)
               then 'processed'
             when o.attempts >= 5 then 'dead'
             else 'claim'
           end as outcome
      from carnet.outbox o
     where o.status = 'pending'
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
    left join carnet.leads l on c.type = 'lead.created' and l.id = (c.payload ->> 'lead_id')::uuid
   where c.type <> 'lead.created' or l.id is not null
   order by c.created_at, c.id;
end;
$$;

create or replace function carnet.complete_outbox(p_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update carnet.outbox o
     set status = 'processed', processed_at = now()
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
           500)
   where o.id = p_id
     and o.status = 'pending';
$$;

revoke execute on function carnet.claim_outbox(integer) from public, anon, authenticated;
grant execute on function carnet.claim_outbox(integer) to service_role;
revoke execute on function carnet.complete_outbox(uuid) from public, anon, authenticated;
grant execute on function carnet.complete_outbox(uuid) to service_role;
revoke execute on function carnet.fail_outbox(uuid, text) from public, anon, authenticated;
grant execute on function carnet.fail_outbox(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Décision 8 — purges (exécutées par pg_cron sous `postgres`) ; renvoient le nombre de lignes supprimées
-- ---------------------------------------------------------------------------
create or replace function carnet.purge_outbox(p_older_than interval)
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
      message = 'purge_outbox: p_older_than must be a positive interval';
  end if;

  delete from carnet.outbox o
   where o.status in ('processed', 'dead')
     and coalesce(o.processed_at, o.locked_at, o.created_at) < now() - p_older_than;

  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

create or replace function carnet.purge_leads(p_older_than interval)
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
      message = 'purge_leads: p_older_than must be a positive interval';
  end if;

  delete from carnet.leads l
   where l.created_at < now() - p_older_than;

  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke execute on function carnet.purge_outbox(interval) from public, anon, authenticated, service_role;
revoke execute on function carnet.purge_leads(interval) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tâches pg_cron (décision 8). Préfixe `carnet-` ; rejeu : cron.schedule met à jour la tâche du même nom (même jobid).
-- ---------------------------------------------------------------------------
select cron.schedule(
  'carnet-purge-outbox',
  '40 3 * * *',
  $$select carnet.purge_outbox(interval '30 days')$$
);

select cron.schedule(
  'carnet-purge-leads',
  '50 3 * * *',
  $$select carnet.purge_leads(interval '12 months')$$
);
