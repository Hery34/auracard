-- Fiche 0028 / ADR 0002, 0004, 0006, 0011 (avenant du 18/11/2026) — statistiques.
--   carnet.analytics_events : événements bruts, `id` fourni par l'émetteur (rejeu sans doublon). Aucune donnée
--     d'identification du visiteur (ni IP, ni user-agent, ni pays). Aucun accès anon / authenticated ; écriture par
--     `carnet.record_event`, réservée à `service_role` (route serveur, après filtrage des robots et limitation de débit).
--   carnet.analytics_daily : agrégats par jour civil Europe/Paris, lus par le seul propriétaire. `link_id` sans clé
--     étrangère (décision 4 corrigée) : un lien supprimé garde ses agrégats sous son uuid d'origine.
--   carnet.aggregate_analytics_day : recalcul complet d'une journée (insert … on conflict … do update), jamais de
--     suppression d'agrégat. Les `link_click` dont `link_id` est nul (lien supprimé, set null) sont ignorés : leurs
--     agrégats existent déjà sous l'uuid d'origine. Limite connue : un clic dont le lien est supprimé avant le premier
--     passage de l'agrégation (15 minutes au plus) n'est jamais compté.
--     Fenêtre : un jour antérieur à aujourd'hui (Paris) − 89 jours n'est pas recalculé (aucun effet, aucune erreur) ;
--     ses événements bruts peuvent être partiellement purgés (90 jours), ses agrégats restent tels quels.
--     Limite : dans la fenêtre, un bucket dont tous les événements disparaissent garde sa valeur (aucune ligne produite,
--     aucune suppression). Aucun traitement actuel ne supprime d'événement dans la fenêtre (purge à 90 jours ; la
--     cascade depuis profiles emporte aussi les agrégats ; le set null de link_id est voulu).
--   carnet.purge_analytics_events : suppression des événements bruts plus anciens que l'intervalle ; agrégats conservés.
--   pg_cron : `carnet-aggregate-analytics` (toutes les 15 minutes, aujourd'hui et hier) et `carnet-purge-analytics-events`
--     (quotidienne, 90 jours). Rejeu : cron.schedule met à jour la tâche du même nom (même jobid).
-- Suppression de compte (0023) : cascade depuis carnet.profiles sur les deux tables, aucune modification nécessaire.
-- Préconditions : rôle de migration `postgres` (bypassrls), propriétaire des fonctions ; pg_cron disponible sur
-- l'instance (déjà utilisée par la fiche 0010). Rejouable, sans `cascade`.

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Listes de valeurs : unique définition, utilisée par les contraintes et par `record_event` ; false, jamais d'erreur
-- ---------------------------------------------------------------------------
create or replace function carnet.is_valid_analytics_metric(p_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(p_value in ('profile_view', 'nfc_scan', 'qr_scan', 'vcard_download', 'link_click', 'contact_click',
                              'lead_submitted'), false);
$$;

revoke execute on function carnet.is_valid_analytics_metric(text) from public, anon, authenticated;
grant execute on function carnet.is_valid_analytics_metric(text) to service_role;

create or replace function carnet.is_valid_analytics_source(p_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(p_value in ('nfc', 'qr', 'direct'), false);
$$;

revoke execute on function carnet.is_valid_analytics_source(text) from public, anon, authenticated;
grant execute on function carnet.is_valid_analytics_source(text) to service_role;

create or replace function carnet.is_valid_analytics_device_class(p_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(p_value in ('mobile', 'desktop'), false);
$$;

revoke execute on function carnet.is_valid_analytics_device_class(text) from public, anon, authenticated;
grant execute on function carnet.is_valid_analytics_device_class(text) to service_role;

-- ---------------------------------------------------------------------------
-- Événements bruts (décision 1)
-- ---------------------------------------------------------------------------
create table if not exists carnet.analytics_events (
  id           uuid        not null,
  profile_id   uuid        not null,
  type         text        not null,
  source       text        not null,
  link_id      uuid,
  device_class text        not null,
  occurred_at  timestamptz not null default pg_catalog.now(),
  constraint analytics_events_pkey primary key (id),
  constraint analytics_events_profile_id_fkey
    foreign key (profile_id) references carnet.profiles (id) on delete cascade,
  constraint analytics_events_link_id_fkey
    foreign key (link_id) references carnet.links (id) on delete set null,
  constraint analytics_events_type_check check (carnet.is_valid_analytics_metric(type)),
  constraint analytics_events_source_check check (carnet.is_valid_analytics_source(source)),
  constraint analytics_events_device_class_check check (carnet.is_valid_analytics_device_class(device_class)),
  constraint analytics_events_link_id_check check (link_id is null or type = 'link_click')
);

create index if not exists analytics_events_profile_id_idx on carnet.analytics_events (profile_id);
create index if not exists analytics_events_link_id_idx on carnet.analytics_events (link_id);
create index if not exists analytics_events_occurred_at_idx on carnet.analytics_events (occurred_at);

-- ---------------------------------------------------------------------------
-- Agrégats quotidiens (décision 4)
-- ---------------------------------------------------------------------------
create table if not exists carnet.analytics_daily (
  profile_id uuid    not null,
  day        date    not null,
  metric     text    not null,
  link_id    uuid,
  source     text,
  value      integer not null,
  constraint analytics_daily_bucket_key unique nulls not distinct (profile_id, day, metric, link_id, source),
  constraint analytics_daily_profile_id_fkey
    foreign key (profile_id) references carnet.profiles (id) on delete cascade,
  constraint analytics_daily_metric_check check (carnet.is_valid_analytics_metric(metric)),
  constraint analytics_daily_source_check check (source is null or carnet.is_valid_analytics_source(source))
);

-- Index : analytics_daily_bucket_key commence par profile_id et couvre la clé étrangère.

-- ---------------------------------------------------------------------------
-- RLS et privilèges (décision 6)
-- ---------------------------------------------------------------------------
alter table carnet.analytics_events enable row level security;
alter table carnet.analytics_events force row level security;
alter table carnet.analytics_daily enable row level security;
alter table carnet.analytics_daily force row level security;

drop policy if exists analytics_daily_select_own on carnet.analytics_daily;
create policy analytics_daily_select_own
  on carnet.analytics_daily
  for select
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

-- Le revoke de table retire aussi les droits par colonne (rejouable).
revoke all on carnet.analytics_events from public, anon, authenticated;
grant all on carnet.analytics_events to service_role;

revoke all on carnet.analytics_daily from public, anon, authenticated;
grant select on carnet.analytics_daily to authenticated;
grant all on carnet.analytics_daily to service_role;

-- ---------------------------------------------------------------------------
-- Enregistrement d'un événement (décisions 2 et 3). 22023 avant toute lecture du profil (aucun oracle) ; profil absent
-- ou non publié, lien absent ou d'un autre profil : rien n'est écrit, même réponse. Rejeu du même id : sans effet.
-- ---------------------------------------------------------------------------
create or replace function carnet.record_event(
  p_id uuid,
  p_profile_id uuid,
  p_type text,
  p_source text,
  p_link_id uuid,
  p_device_class text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_id is null
     or not carnet.is_valid_analytics_metric(p_type)
     or not carnet.is_valid_analytics_source(p_source)
     or not carnet.is_valid_analytics_device_class(p_device_class)
     or (p_type = 'link_click') <> (p_link_id is not null) then
    raise exception 'invalid analytics event' using errcode = '22023';
  end if;

  insert into carnet.analytics_events (id, profile_id, type, source, link_id, device_class)
  select p_id, p.id, p_type, p_source, p_link_id, p_device_class
    from carnet.profiles p
   where p.id = p_profile_id
     and p.is_published
     and (p_link_id is null
          or exists (select 1 from carnet.links l where l.id = p_link_id and l.profile_id = p.id))
  on conflict (id) do nothing;
end;
$$;

revoke execute on function carnet.record_event(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function carnet.record_event(uuid, uuid, text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Agrégation d'une journée civile Europe/Paris (décisions 4 et 5). Exécutée par pg_cron sous `postgres`.
-- ---------------------------------------------------------------------------
create or replace function carnet.aggregate_analytics_day(p_day date)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into carnet.analytics_daily (profile_id, day, metric, link_id, source, value)
  select e.profile_id, p_day, e.type, e.link_id, e.source, pg_catalog.count(*)::integer
    from carnet.analytics_events e
   where e.occurred_at >= (p_day::timestamp at time zone 'Europe/Paris')
     and e.occurred_at < ((p_day + 1)::timestamp at time zone 'Europe/Paris')
     and not (e.type = 'link_click' and e.link_id is null)
     -- Fenêtre : avant J−89 (Paris), les événements bruts peuvent être purgés ; aucun effet, agrégats conservés.
     and p_day >= (pg_catalog.now() at time zone 'Europe/Paris')::date - 89
   group by e.profile_id, e.type, e.link_id, e.source
  on conflict on constraint analytics_daily_bucket_key do update
    set value = excluded.value;
$$;

revoke execute on function carnet.aggregate_analytics_day(date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Purge des événements bruts (décision 5) ; renvoie le nombre de lignes supprimées
-- ---------------------------------------------------------------------------
create or replace function carnet.purge_analytics_events(p_older_than interval)
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
      message = 'purge_analytics_events: p_older_than must be a positive interval';
  end if;

  delete from carnet.analytics_events e
   where e.occurred_at < pg_catalog.now() - p_older_than;

  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke execute on function carnet.purge_analytics_events(interval) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tâches pg_cron (décision 5). Préfixe `carnet-` ; aucune autre tâche touchée.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'carnet-aggregate-analytics',
  '*/15 * * * *',
  $$select carnet.aggregate_analytics_day(d.day) from (values ((pg_catalog.now() at time zone 'Europe/Paris')::date), ((pg_catalog.now() at time zone 'Europe/Paris')::date - 1)) as d (day)$$
);

select cron.schedule(
  'carnet-purge-analytics-events',
  '30 3 * * *',
  $$select carnet.purge_analytics_events(interval '90 days')$$
);
