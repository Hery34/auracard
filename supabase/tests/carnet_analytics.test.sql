-- Fiche 0028 — schéma des statistiques : carnet.analytics_events, carnet.analytics_daily, carnet.record_event,
-- carnet.aggregate_analytics_day, carnet.purge_analytics_events, tâches pg_cron, cascade de delete_own_account (0023).
-- Critères couverts : 1 à 6 en comportement ; 7 en partie (tâches uniques, même jobid quand cron.schedule est rejoué
-- sous le même nom ; le rejeu complet de la migration reste prouvé par db-architect et Hery).
-- Contrat figé pour db-architect :
--   carnet.analytics_events : id uuid pk sans défaut (fourni par l'émetteur) ; profile_id uuid not null fk profiles
--     on delete cascade ; type text not null (analytics_events_type_check : profile_view, nfc_scan, qr_scan,
--     vcard_download, link_click, contact_click, lead_submitted) ; source text not null (analytics_events_source_check :
--     nfc, qr, direct) ; link_id uuid null fk links on delete set null (analytics_events_link_id_check : link_id nul
--     sauf pour link_click) ; device_class text not null (analytics_events_device_class_check : mobile, desktop) ;
--     occurred_at timestamptz not null default now(). Exactement ces colonnes (ni IP, ni user-agent, ni pays…).
--     Index de tête sur profile_id, link_id et occurred_at. RLS activée et forcée, aucune politique, aucun privilège
--     pour anon, authenticated, public.
--   carnet.analytics_daily : profile_id uuid not null fk cascade ; day date not null (jour civil Europe/Paris) ;
--     metric text not null (analytics_daily_metric_check, mêmes valeurs que type) ; link_id uuid null SANS clé étrangère
--     (décision 4 corrigée par Hery : un lien supprimé garde ses agrégats sous son uuid d'origine) ; source text null (analytics_daily_source_check) ; value integer not null. Exactement ces colonnes.
--     Contrainte unique analytics_daily_bucket_key (profile_id, day, metric, link_id, source) nulls not distinct.
--     RLS activée et forcée ; une seule politique analytics_daily_select_own (select,
--     authenticated, (select carnet.is_member()) and (select carnet.can_edit_profile(profile_id))). authenticated : select
--     de table seulement, aucun droit insert/update par colonne ; anon et public : rien.
--     Supprimer des liens réussit toujours, laisse les agrégats intacts (uuid d'origine) ; un recalcul de la journée
--     ne compte pas en double les clics dont l'événement brut a perdu son link_id (set null côté analytics_events).
--   carnet.record_event(p_id uuid, p_profile_id uuid, p_type text, p_source text, p_link_id uuid, p_device_class text)
--     returns void : volatile, security definer, set search_path = '', propriétaire bypassrls ; execute à service_role
--     seul. occurred_at = now(). on conflict (id) do nothing. Profil inexistant ou non publié, link_id inconnu ou d'un
--     autre profil : rien n'est écrit, aucune erreur, même réponse. 22023 (avant tout contrôle du profil) : p_id nul,
--     type, source ou device_class nul ou hors liste, link_click sans link_id, link_id sur un autre type.
--   carnet.aggregate_analytics_day(p_day date) returns void : set search_path = '' ; recalcule complètement la journée
--     p_day (Europe/Paris) par insert … on conflict … do update set value = excluded.value (la valeur peut baisser) ;
--     une ligne par (profile_id, day, metric, link_id, source) au moins pour profile_view (par source) et link_click
--     (par lien) ; link_click à link_id nul ignorés. Fenêtre : si p_day < aujourd'hui (Paris) − 89 jours, aucun effet,
--     sans erreur (lignes intactes, aucune ajoutée, même avec des événements bruts restants) ; J−89 est recalculé.
--     Ne supprime jamais d'agrégat. Aucun execute pour anon, authenticated, public, service_role.
--   carnet.purge_analytics_events(p_older_than interval) returns integer (nombre d'événements supprimés) :
--     set search_path = '' ; supprime occurred_at < now() - p_older_than ; 22023 si nul ou non positif ; ne touche pas
--     aux agrégats. Aucun execute pour anon, authenticated, public, service_role.
--   pg_cron : carnet-aggregate-analytics (*/15 * * * *, recalcule aujourd'hui et hier en Europe/Paris, commande en une
--     instruction) ; carnet-purge-analytics-events (quotidienne, select carnet.purge_analytics_events(interval '90 days')).
--     Base postgres, utilisateur postgres, actives.
-- Personas (UUID fixes, plage 0…28xx propre à ce fichier) :
--   A 0…280a membre carnet, profil 0…2810 publié (ada-0028), liens 0…2820 et 0…2821
--   B 0…280b membre carnet, profil 0…2811 publié (bea-0028), lien 0…2822
--   U 0…280c membre carnet, profil 0…2812 non publié (uma-0028)
--   X 0…280d membre du projet other_0028 seul, sans profil
--   O 0…280e membre du projet other_0028 seul, propriétaire du profil 0…2813 (oto-0028, ancienne appartenance perdue)
-- Horloge : les événements datés sont insérés par postgres avec occurred_at explicite, relatif au jour de Paris de now()
-- (figé dans la transaction) via pg_temp.paris_day(décalage) et pg_temp.paris_at(jour, heure), pour rester dans la
-- fenêtre de recalcul quelle que soit la date d'exécution. Les lectures sur des objets encore absents passent par lives_ok ou pg_temp.num/pg_temp.txt
-- (null si l'objet n'existe pas), pour que l'absence d'implémentation produise des échecs et non un abandon du script.
-- Tout est annulé par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(232);

create function pg_temp.num(p_sql text) returns bigint
language plpgsql as $$
declare
  v bigint;
begin
  execute p_sql into v;
  return v;
exception when undefined_table or undefined_function or undefined_column or invalid_schema_name then
  return null;
end
$$;

create function pg_temp.txt(p_sql text) returns text
language plpgsql as $$
declare
  v text;
begin
  execute p_sql into v;
  return v;
exception when undefined_table or undefined_function or undefined_column or invalid_schema_name then
  return null;
end
$$;

create function pg_temp.paris_day(p_offset integer) returns date
language sql stable as $$
  select (now() at time zone 'Europe/Paris')::date + p_offset
$$;

create function pg_temp.paris_at(p_day date, p_time time) returns timestamptz
language sql stable as $$
  select (p_day + p_time) at time zone 'Europe/Paris'
$$;

create temp table rec_results (label text primary key, result text);
grant select, insert on rec_results to service_role;
create temp table reads (label text primary key, n bigint);
grant select, insert on reads to anon, authenticated, service_role;
create temp table agg_snapshot (profile_id uuid, day date, metric text, link_id uuid, source text, value integer);
create temp table cron_job_snapshot (
  jobid bigint, jobname text, schedule text, command text, database text, username text, active boolean
);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000280a', 'a-carnet-0028@test.local'),
  ('00000000-0000-4000-8000-00000000280b', 'b-carnet-0028@test.local'),
  ('00000000-0000-4000-8000-00000000280c', 'u-carnet-0028@test.local'),
  ('00000000-0000-4000-8000-00000000280d', 'x-other-0028@test.local'),
  ('00000000-0000-4000-8000-00000000280e', 'o-former-0028@test.local');

insert into platform.projects (id, slug, name, db_schema, status) values
  ('00000000-0000-4000-8000-000000002802', 'other_0028', 'Other 0028', 'other_0028', 'active');

insert into platform.project_members (project_id, user_id, role)
  select p.id, u.id, 'user'
    from platform.projects p
   cross join (values ('00000000-0000-4000-8000-00000000280a'::uuid), ('00000000-0000-4000-8000-00000000280b'::uuid),
                      ('00000000-0000-4000-8000-00000000280c'::uuid)) as u (id)
   where p.slug = 'carnet';
insert into platform.project_members (project_id, user_id, role) values
  ('00000000-0000-4000-8000-000000002802', '00000000-0000-4000-8000-00000000280d', 'user'),
  ('00000000-0000-4000-8000-000000002802', '00000000-0000-4000-8000-00000000280e', 'user');

insert into carnet.profiles (id, owner_id, slug, display_name, is_published) values
  ('00000000-0000-4000-8000-000000002810', '00000000-0000-4000-8000-00000000280a', 'ada-0028', 'Ada', true),
  ('00000000-0000-4000-8000-000000002811', '00000000-0000-4000-8000-00000000280b', 'bea-0028', 'Bea', true),
  ('00000000-0000-4000-8000-000000002812', '00000000-0000-4000-8000-00000000280c', 'uma-0028', 'Uma', false),
  ('00000000-0000-4000-8000-000000002813', '00000000-0000-4000-8000-00000000280e', 'oto-0028', 'Oto', true);

insert into carnet.links (id, profile_id, platform, url, label, position) values
  ('00000000-0000-4000-8000-000000002820', '00000000-0000-4000-8000-000000002810', 'github', 'https://github.com/ada-0028', null, 0),
  ('00000000-0000-4000-8000-000000002821', '00000000-0000-4000-8000-000000002810', 'website', 'https://ada.example.test', 'Site', 1),
  ('00000000-0000-4000-8000-000000002822', '00000000-0000-4000-8000-000000002811', 'github', 'https://github.com/bea-0028', null, 0);

-- ---------------------------------------------------------------------------
-- Décision 1 — carnet.analytics_events : structure
-- ---------------------------------------------------------------------------
select has_table('carnet', 'analytics_events', 'décision 1 : la table carnet.analytics_events existe');
select columns_are(
  'carnet', 'analytics_events',
  array['id', 'profile_id', 'type', 'source', 'link_id', 'device_class', 'occurred_at'],
  'décision 1 : analytics_events a exactement ces colonnes (ni IP, ni empreinte, ni user-agent, ni pays, ni identifiant de visiteur)'
);
select col_type_is('carnet', 'analytics_events', 'id', 'uuid', 'décision 1 : analytics_events.id est uuid');
select col_is_pk('carnet', 'analytics_events', 'id', 'décision 1 : analytics_events.id est la clé primaire');
select col_hasnt_default('carnet', 'analytics_events', 'id', 'décision 1 : analytics_events.id n''a pas de défaut (fourni par l''émetteur)');
select col_type_is('carnet', 'analytics_events', 'profile_id', 'uuid', 'décision 1 : analytics_events.profile_id est uuid');
select col_not_null('carnet', 'analytics_events', 'profile_id', 'décision 1 : analytics_events.profile_id est not null');
select fk_ok('carnet', 'analytics_events', 'profile_id', 'carnet', 'profiles', 'id', 'décision 1 : analytics_events.profile_id référence carnet.profiles(id)');
select col_type_is('carnet', 'analytics_events', 'type', 'text', 'décision 1 : analytics_events.type est text');
select col_not_null('carnet', 'analytics_events', 'type', 'décision 1 : analytics_events.type est not null');
select col_type_is('carnet', 'analytics_events', 'source', 'text', 'décision 1 : analytics_events.source est text');
select col_not_null('carnet', 'analytics_events', 'source', 'décision 1 : analytics_events.source est not null');
select col_type_is('carnet', 'analytics_events', 'link_id', 'uuid', 'décision 1 : analytics_events.link_id est uuid');
select col_is_null('carnet', 'analytics_events', 'link_id', 'décision 1 : analytics_events.link_id est nullable');
select fk_ok('carnet', 'analytics_events', 'link_id', 'carnet', 'links', 'id', 'décision 1 : analytics_events.link_id référence carnet.links(id)');
select col_type_is('carnet', 'analytics_events', 'device_class', 'text', 'décision 1 : analytics_events.device_class est text');
select col_not_null('carnet', 'analytics_events', 'device_class', 'décision 1 : analytics_events.device_class est not null');
select col_type_is('carnet', 'analytics_events', 'occurred_at', 'timestamp with time zone', 'décision 1 : analytics_events.occurred_at est timestamptz');
select col_not_null('carnet', 'analytics_events', 'occurred_at', 'décision 1 : analytics_events.occurred_at est not null');
select col_default_is('carnet', 'analytics_events', 'occurred_at', 'now()', 'décision 1 : analytics_events.occurred_at a pour défaut now() (horodatage serveur)');
select is(
  pg_temp.txt($$select k.confdeltype::text from pg_constraint k
                where k.conrelid = 'carnet.analytics_events'::regclass and k.contype = 'f'
                  and k.confrelid = 'carnet.profiles'::regclass$$),
  'c',
  'décision 1 : analytics_events.profile_id est on delete cascade'
);
select is(
  pg_temp.txt($$select k.confdeltype::text from pg_constraint k
                where k.conrelid = 'carnet.analytics_events'::regclass and k.contype = 'f'
                  and k.confrelid = 'carnet.links'::regclass$$),
  'n',
  'décision 1 : analytics_events.link_id est on delete set null'
);
select ok(
  pg_temp.num($$select count(*) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                where i.indrelid = 'carnet.analytics_events'::regclass and a.attname = 'profile_id'$$) > 0,
  'supabase.md : un index commence par analytics_events.profile_id (clé étrangère)'
);
select ok(
  pg_temp.num($$select count(*) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                where i.indrelid = 'carnet.analytics_events'::regclass and a.attname = 'link_id'$$) > 0,
  'supabase.md : un index commence par analytics_events.link_id (clé étrangère, set null)'
);
select ok(
  pg_temp.num($$select count(*) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                where i.indrelid = 'carnet.analytics_events'::regclass and a.attname = 'occurred_at'$$) > 0,
  'décision 5 : un index commence par analytics_events.occurred_at (agrégation d''une journée, purge)'
);
select ok(
  (select coalesce(array_agg(k.conname::text), '{}') from pg_constraint k
    where k.conrelid = to_regclass('carnet.analytics_events') and k.contype = 'c')
  @> array['analytics_events_type_check', 'analytics_events_source_check',
           'analytics_events_device_class_check', 'analytics_events_link_id_check'],
  'décision 1 : contraintes analytics_events_type_check, _source_check, _device_class_check et _link_id_check présentes'
);

-- Contraintes en comportement (postgres, bypassrls)
select throws_ok(
  $$insert into carnet.analytics_events (id, profile_id, type, source, device_class)
    values ('00000000-0000-4000-8000-0000000028c1', '00000000-0000-4000-8000-000000002813', 'page_view', 'direct', 'mobile')$$,
  '23514', null, 'décision 1 : un type hors liste est refusé par la table (23514)'
);
select throws_ok(
  $$insert into carnet.analytics_events (id, profile_id, type, source, device_class)
    values ('00000000-0000-4000-8000-0000000028c2', '00000000-0000-4000-8000-000000002813', 'profile_view', 'email', 'mobile')$$,
  '23514', null, 'décision 1 : une source hors liste est refusée par la table (23514)'
);
select throws_ok(
  $$insert into carnet.analytics_events (id, profile_id, type, source, device_class)
    values ('00000000-0000-4000-8000-0000000028c3', '00000000-0000-4000-8000-000000002813', 'profile_view', 'direct', 'bot')$$,
  '23514', null, 'décision 1 : device_class bot refusé par la table (les robots ne sont pas stockés, 23514)'
);
select throws_ok(
  $$insert into carnet.analytics_events (id, profile_id, type, source, link_id, device_class)
    values ('00000000-0000-4000-8000-0000000028c4', '00000000-0000-4000-8000-000000002810', 'profile_view', 'direct',
            '00000000-0000-4000-8000-000000002820', 'mobile')$$,
  '23514', null, 'décision 1 : link_id interdit pour un autre type que link_click (23514)'
);
select lives_ok(
  $$insert into carnet.analytics_events (id, profile_id, type, source, link_id, device_class) values
      ('00000000-0000-4000-8000-0000000028c5', '00000000-0000-4000-8000-000000002813', 'profile_view', 'nfc', null, 'mobile'),
      ('00000000-0000-4000-8000-0000000028c6', '00000000-0000-4000-8000-000000002813', 'nfc_scan', 'nfc', null, 'mobile'),
      ('00000000-0000-4000-8000-0000000028c7', '00000000-0000-4000-8000-000000002813', 'qr_scan', 'qr', null, 'desktop'),
      ('00000000-0000-4000-8000-0000000028c8', '00000000-0000-4000-8000-000000002813', 'vcard_download', 'direct', null, 'mobile'),
      ('00000000-0000-4000-8000-0000000028c9', '00000000-0000-4000-8000-000000002810', 'link_click', 'direct', '00000000-0000-4000-8000-000000002820', 'mobile'),
      ('00000000-0000-4000-8000-0000000028ca', '00000000-0000-4000-8000-000000002813', 'contact_click', 'direct', null, 'mobile'),
      ('00000000-0000-4000-8000-0000000028cb', '00000000-0000-4000-8000-000000002813', 'lead_submitted', 'direct', null, 'desktop')$$,
  'décision 1 : les sept types, trois sources et deux classes d''appareil sont acceptés'
);
select lives_ok(
  $$delete from carnet.analytics_events where id::text like '00000000-0000-4000-8000-0000000028c%'$$,
  'décision 1 : les lignes de contrôle des contraintes sont retirées'
);

-- ---------------------------------------------------------------------------
-- Décision 4 — carnet.analytics_daily : structure
-- ---------------------------------------------------------------------------
select has_table('carnet', 'analytics_daily', 'décision 4 : la table carnet.analytics_daily existe');
select columns_are(
  'carnet', 'analytics_daily',
  array['profile_id', 'day', 'metric', 'link_id', 'source', 'value'],
  'décision 4 : analytics_daily a exactement les colonnes profile_id, day, metric, link_id, source, value'
);
select col_type_is('carnet', 'analytics_daily', 'profile_id', 'uuid', 'décision 4 : analytics_daily.profile_id est uuid');
select col_not_null('carnet', 'analytics_daily', 'profile_id', 'décision 4 : analytics_daily.profile_id est not null');
select fk_ok('carnet', 'analytics_daily', 'profile_id', 'carnet', 'profiles', 'id', 'décision 4 : analytics_daily.profile_id référence carnet.profiles(id)');
select col_type_is('carnet', 'analytics_daily', 'day', 'date', 'décision 4 : analytics_daily.day est date');
select col_not_null('carnet', 'analytics_daily', 'day', 'décision 4 : analytics_daily.day est not null');
select col_type_is('carnet', 'analytics_daily', 'metric', 'text', 'décision 4 : analytics_daily.metric est text');
select col_not_null('carnet', 'analytics_daily', 'metric', 'décision 4 : analytics_daily.metric est not null');
select col_type_is('carnet', 'analytics_daily', 'link_id', 'uuid', 'décision 4 : analytics_daily.link_id est uuid');
select col_is_null('carnet', 'analytics_daily', 'link_id', 'décision 4 : analytics_daily.link_id est nullable');
select col_type_is('carnet', 'analytics_daily', 'source', 'text', 'décision 4 : analytics_daily.source est text');
select col_is_null('carnet', 'analytics_daily', 'source', 'décision 4 : analytics_daily.source est nullable');
select col_type_is('carnet', 'analytics_daily', 'value', 'integer', 'décision 4 : analytics_daily.value est integer');
select col_not_null('carnet', 'analytics_daily', 'value', 'décision 4 : analytics_daily.value est not null');
select is(
  pg_temp.txt($$select k.confdeltype::text from pg_constraint k
                where k.conrelid = 'carnet.analytics_daily'::regclass and k.contype = 'f'
                  and k.confrelid = 'carnet.profiles'::regclass$$),
  'c',
  'décision 4 : analytics_daily.profile_id est on delete cascade (agrégats conservés tant que le profil existe)'
);
select is(
  pg_temp.num($$select count(*) from pg_constraint k
                where k.conrelid = 'carnet.analytics_daily'::regclass and k.contype = 'f'
                  and (k.confrelid = 'carnet.links'::regclass
                       or k.conkey @> array[(select a.attnum from pg_attribute a
                                              where a.attrelid = k.conrelid and a.attname = 'link_id')])$$),
  0::bigint,
  'décision 4 (corrigée) : analytics_daily.link_id n''a aucune clé étrangère (agrégats conservés sous l''uuid d''origine)'
);
select is(
  pg_temp.txt($$select array_agg(a.attname::text order by x.ord)::text
                  from pg_constraint k
                  join pg_index i on i.indexrelid = k.conindid
                 cross join unnest(i.indkey::int2[]) with ordinality as x (attnum, ord)
                  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = x.attnum
                 where k.conrelid = 'carnet.analytics_daily'::regclass
                   and k.conname = 'analytics_daily_bucket_key' and k.contype = 'u'$$),
  '{profile_id,day,metric,link_id,source}',
  'décision 4 : contrainte unique analytics_daily_bucket_key sur (profile_id, day, metric, link_id, source)'
);
select is(
  pg_temp.txt($$select i.indnullsnotdistinct::text
                  from pg_constraint k join pg_index i on i.indexrelid = k.conindid
                 where k.conrelid = 'carnet.analytics_daily'::regclass and k.conname = 'analytics_daily_bucket_key'$$),
  'true',
  'décision 4 : analytics_daily_bucket_key est nulls not distinct'
);
select ok(
  (select coalesce(array_agg(k.conname::text), '{}') from pg_constraint k
    where k.conrelid = to_regclass('carnet.analytics_daily') and k.contype = 'c')
  @> array['analytics_daily_metric_check', 'analytics_daily_source_check'],
  'décision 4 : contraintes analytics_daily_metric_check et analytics_daily_source_check présentes'
);

-- Contraintes en comportement (postgres)
select throws_ok(
  $$insert into carnet.analytics_daily (profile_id, day, metric, link_id, source, value)
    values ('00000000-0000-4000-8000-000000002813', '2026-02-01', 'page_view', null, null, 1)$$,
  '23514', null, 'décision 4 : une métrique hors liste est refusée (23514)'
);
select throws_ok(
  $$insert into carnet.analytics_daily (profile_id, day, metric, link_id, source, value)
    values ('00000000-0000-4000-8000-000000002813', '2026-02-01', 'profile_view', null, 'email', 1)$$,
  '23514', null, 'décision 4 : une source hors liste est refusée (23514)'
);
select lives_ok(
  $$insert into carnet.analytics_daily (profile_id, day, metric, link_id, source, value)
    values ('00000000-0000-4000-8000-000000002813', '2026-02-01', 'profile_view', null, null, 1)$$,
  'décision 4 : postgres insère un agrégat sans lien ni source'
);
select throws_ok(
  $$insert into carnet.analytics_daily (profile_id, day, metric, link_id, source, value)
    values ('00000000-0000-4000-8000-000000002813', '2026-02-01', 'profile_view', null, null, 2)$$,
  '23505', null, 'décision 4 : un second agrégat identique avec link_id et source nuls est refusé (nulls not distinct, 23505)'
);

-- ---------------------------------------------------------------------------
-- Décision 6 — RLS et privilèges
-- ---------------------------------------------------------------------------
select ok(
  coalesce((select c.relrowsecurity and c.relforcerowsecurity from pg_class c where c.oid = to_regclass('carnet.analytics_events')), false),
  'décision 6 : RLS activée et forcée sur analytics_events'
);
select is(
  pg_temp.num($$select count(*) from pg_policy where polrelid = 'carnet.analytics_events'::regclass$$),
  0::bigint,
  'décision 6 : aucune politique sur analytics_events (aucun accès anon ni authenticated)'
);
select table_privs_are('carnet', 'analytics_events', 'anon', '{}'::name[], 'critère 3 : anon n''a aucun privilège sur analytics_events');
select table_privs_are('carnet', 'analytics_events', 'authenticated', '{}'::name[], 'critère 3 : authenticated n''a aucun privilège sur analytics_events');
select table_privs_are('carnet', 'analytics_events', 'public', '{}'::name[], 'critère 3 : public n''a aucun privilège sur analytics_events');
select ok(
  to_regclass('carnet.analytics_events') is not null
  and not exists (select 1 from pg_publication_tables where schemaname = 'carnet' and tablename = 'analytics_events'),
  'décision 6 : analytics_events existe et n''est pas publiée dans Realtime'
);
select is(
  pg_temp.num($$select count(*) from pg_attribute a
                where a.attrelid = 'carnet.analytics_events'::regclass and a.attnum > 0 and not a.attisdropped
                  and (has_column_privilege('anon', a.attrelid, a.attname, 'SELECT,INSERT,UPDATE')
                       or has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT,INSERT,UPDATE'))$$),
  0::bigint,
  'critère 3 : aucun droit par colonne pour anon ni authenticated sur analytics_events'
);

select ok(
  coalesce((select c.relrowsecurity and c.relforcerowsecurity from pg_class c where c.oid = to_regclass('carnet.analytics_daily')), false),
  'décision 6 : RLS activée et forcée sur analytics_daily'
);
select policies_are('carnet', 'analytics_daily', array['analytics_daily_select_own'], 'décision 6 : analytics_daily n''a que la politique analytics_daily_select_own');
select policy_cmd_is('carnet', 'analytics_daily', 'analytics_daily_select_own', 'SELECT', 'décision 6 : analytics_daily_select_own est une politique select');
select policy_roles_are('carnet', 'analytics_daily', 'analytics_daily_select_own', array['authenticated'], 'décision 6 : analytics_daily_select_own s''applique au seul rôle authenticated');
select ok(
  coalesce(pg_temp.txt($$select pg_get_expr(p.polqual, p.polrelid) from pg_policy p
                         where p.polrelid = 'carnet.analytics_daily'::regclass and p.polname = 'analytics_daily_select_own'$$), '')
    ~* '\(\s*select\s+carnet\.is_member\(\).*\(\s*select\s+carnet\.can_edit_profile\(\s*(analytics_daily\.)?profile_id',
  'décision 6 : analytics_daily_select_own exige (select carnet.is_member()) et (select carnet.can_edit_profile(profile_id))'
);
select table_privs_are('carnet', 'analytics_daily', 'anon', '{}'::name[], 'critère 4 : anon n''a aucun privilège sur analytics_daily');
select table_privs_are('carnet', 'analytics_daily', 'authenticated', array['SELECT'], 'décision 6 : authenticated n''a que select de table sur analytics_daily (filtré par RLS)');
select table_privs_are('carnet', 'analytics_daily', 'public', '{}'::name[], 'décision 6 : public n''a aucun privilège sur analytics_daily');
select is(
  pg_temp.num($$select count(*) from pg_attribute a
                where a.attrelid = 'carnet.analytics_daily'::regclass and a.attnum > 0 and not a.attisdropped
                  and has_column_privilege('authenticated', a.attrelid, a.attname, 'INSERT,UPDATE')$$),
  0::bigint,
  'décision 6 (conventions 0022) : authenticated n''a aucun droit insert ni update, même par colonne, sur analytics_daily'
);
select ok(
  to_regclass('carnet.analytics_daily') is not null
  and not exists (select 1 from pg_publication_tables where schemaname = 'carnet' and tablename = 'analytics_daily'),
  'décision 6 : analytics_daily existe et n''est pas publiée dans Realtime'
);

-- ---------------------------------------------------------------------------
-- Décisions 2 et 3 — carnet.record_event : propriétés et droits
-- ---------------------------------------------------------------------------
select has_function('carnet', 'record_event', array['uuid', 'uuid', 'text', 'text', 'uuid', 'text'],
  'décision 2 : carnet.record_event(uuid, uuid, text, text, uuid, text) existe');
select function_returns('carnet', 'record_event', array['uuid', 'uuid', 'text', 'text', 'uuid', 'text'], 'void',
  'décision 2 : record_event renvoie void (même réponse qu''un événement soit enregistré ou ignoré)');
select is_definer('carnet', 'record_event', array['uuid', 'uuid', 'text', 'text', 'uuid', 'text'],
  'décision 2 : record_event est security definer');
select volatility_is('carnet', 'record_event', array['uuid', 'uuid', 'text', 'text', 'uuid', 'text'], 'volatile',
  'décision 2 : record_event est volatile (elle écrit)');
select ok(
  exists (select 1 from pg_proc p
           where p.oid = to_regprocedure('carnet.record_event(uuid, uuid, text, text, uuid, text)')
             and p.proconfig @> array['search_path=""']
             and p.proargnames = array['p_id', 'p_profile_id', 'p_type', 'p_source', 'p_link_id', 'p_device_class']),
  'décision 2 : record_event fixe search_path = '''' et nomme ses paramètres p_id, p_profile_id, p_type, p_source, p_link_id, p_device_class'
);
select ok(
  exists (select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
           where p.oid = to_regprocedure('carnet.record_event(uuid, uuid, text, text, uuid, text)') and r.rolbypassrls),
  'décision 2 : le propriétaire de record_event contourne la RLS (postgres)'
);
select function_privs_are('carnet', 'record_event', array['uuid', 'uuid', 'text', 'text', 'uuid', 'text'], 'service_role', array['EXECUTE'],
  'décision 3 : execute accordé à service_role sur record_event');
select function_privs_are('carnet', 'record_event', array['uuid', 'uuid', 'text', 'text', 'uuid', 'text'], 'authenticated', '{}'::name[],
  'critère 3 : execute refusé à authenticated sur record_event');
select function_privs_are('carnet', 'record_event', array['uuid', 'uuid', 'text', 'text', 'uuid', 'text'], 'anon', '{}'::name[],
  'critère 3 : execute refusé à anon sur record_event');
select function_privs_are('carnet', 'record_event', array['uuid', 'uuid', 'text', 'text', 'uuid', 'text'], 'public', '{}'::name[],
  'critère 3 : execute révoqué pour public sur record_event');

-- ---------------------------------------------------------------------------
-- Critère 1 — même id rejoué : un seul événement (service_role)
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into rec_results select 'first', carnet.record_event('00000000-0000-4000-8000-0000000028e1',
      '00000000-0000-4000-8000-000000002810', 'profile_view', 'direct', null, 'mobile')::text$$,
  'critère 1 : service_role enregistre un profile_view sur un profil publié'
);
select lives_ok(
  $$insert into rec_results select 'replay', carnet.record_event('00000000-0000-4000-8000-0000000028e1',
      '00000000-0000-4000-8000-000000002810', 'profile_view', 'direct', null, 'mobile')::text$$,
  'critère 1 : le même événement rejoué (même id) ne lève aucune erreur'
);
select lives_ok(
  $$insert into rec_results select 'replay_other', carnet.record_event('00000000-0000-4000-8000-0000000028e1',
      '00000000-0000-4000-8000-000000002810', 'qr_scan', 'qr', null, 'desktop')::text$$,
  'critère 1 : un rejeu du même id avec un autre contenu ne lève aucune erreur'
);
reset role;

select is(
  pg_temp.num($$select count(*) from carnet.analytics_events where id = '00000000-0000-4000-8000-0000000028e1'$$),
  1::bigint,
  'critère 1 : un événement inséré deux fois (puis une troisième) avec le même id n''existe qu''une fois'
);
select is(
  pg_temp.txt($$select type || '/' || source || '/' || device_class from carnet.analytics_events
                where id = '00000000-0000-4000-8000-0000000028e1'$$),
  'profile_view/direct/mobile',
  'critère 1 : on conflict (id) do nothing, le premier enregistrement est conservé tel quel'
);
select is(
  pg_temp.txt($$select (occurred_at = now())::text from carnet.analytics_events
                where id = '00000000-0000-4000-8000-0000000028e1'$$),
  'true',
  'décision 1 : occurred_at est l''horodatage serveur (now() de la transaction)'
);

-- ---------------------------------------------------------------------------
-- Critère 2 — rien n'est enregistré pour un profil non publié ou un lien étranger ; même réponse
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into rec_results select 'unpublished', carnet.record_event('00000000-0000-4000-8000-0000000028e2',
      '00000000-0000-4000-8000-000000002812', 'profile_view', 'direct', null, 'mobile')::text$$,
  'critère 2 : record_event sur un profil non publié ne lève aucune erreur'
);
select lives_ok(
  $$insert into rec_results select 'unknown_profile', carnet.record_event('00000000-0000-4000-8000-0000000028e3',
      '00000000-0000-4000-8000-0000000028ff', 'profile_view', 'direct', null, 'mobile')::text$$,
  'critère 2 : record_event sur un profil inexistant ne lève aucune erreur (pas d''oracle)'
);
select lives_ok(
  $$insert into rec_results select 'foreign_link', carnet.record_event('00000000-0000-4000-8000-0000000028e4',
      '00000000-0000-4000-8000-000000002810', 'link_click', 'direct', '00000000-0000-4000-8000-000000002822', 'mobile')::text$$,
  'critère 2 : record_event avec le lien d''un autre profil ne lève aucune erreur'
);
select lives_ok(
  $$insert into rec_results select 'unknown_link', carnet.record_event('00000000-0000-4000-8000-0000000028e5',
      '00000000-0000-4000-8000-000000002810', 'link_click', 'direct', '00000000-0000-4000-8000-0000000028fe', 'mobile')::text$$,
  'critère 2 : record_event avec un lien inexistant ne lève aucune erreur'
);
select lives_ok(
  $$insert into rec_results select 'own_link', carnet.record_event('00000000-0000-4000-8000-0000000028e6',
      '00000000-0000-4000-8000-000000002810', 'link_click', 'direct', '00000000-0000-4000-8000-000000002820', 'desktop')::text$$,
  'critère 2 : record_event enregistre un link_click sur un lien du profil'
);
select lives_ok(
  $$insert into rec_results select 'other_profile', carnet.record_event('00000000-0000-4000-8000-0000000028e7',
      '00000000-0000-4000-8000-000000002811', 'profile_view', 'qr', null, 'mobile')::text$$,
  'critère 2 : record_event enregistre un profile_view sur un autre profil publié'
);
reset role;

select is(
  pg_temp.num($$select count(*) from carnet.analytics_events where id = '00000000-0000-4000-8000-0000000028e2'$$),
  0::bigint,
  'critère 2 : un événement pour un profil non publié n''est pas enregistré'
);
select is(
  pg_temp.num($$select count(*) from carnet.analytics_events where id = '00000000-0000-4000-8000-0000000028e3'$$),
  0::bigint,
  'critère 2 : un événement pour un profil inexistant n''est pas enregistré'
);
select is(
  pg_temp.num($$select count(*) from carnet.analytics_events where id = '00000000-0000-4000-8000-0000000028e4'$$),
  0::bigint,
  'critère 2 : un link_click avec le link_id d''un autre profil n''est pas enregistré'
);
select is(
  pg_temp.num($$select count(*) from carnet.analytics_events where id = '00000000-0000-4000-8000-0000000028e5'$$),
  0::bigint,
  'critère 2 : un link_click avec un link_id inexistant n''est pas enregistré'
);
select is(
  pg_temp.txt($$select profile_id || '/' || link_id from carnet.analytics_events where id = '00000000-0000-4000-8000-0000000028e6'$$),
  '00000000-0000-4000-8000-000000002810/00000000-0000-4000-8000-000000002820',
  'critère 2 : un link_click sur un lien du profil est enregistré avec son link_id'
);
select is(
  pg_temp.num($$select count(*) from carnet.analytics_events where id = '00000000-0000-4000-8000-0000000028e7'$$),
  1::bigint,
  'critère 2 : un événement sur un autre profil publié est enregistré'
);
select ok(
  (select count(*) = 9 and count(distinct coalesce(result, '<null>')) = 1 from rec_results),
  'critère 2 : la fonction répond pareil (enregistré, rejoué, profil non publié ou inexistant, lien étranger ou inexistant)'
);

-- ---------------------------------------------------------------------------
-- Décision 2 — 22023 sur valeur hors liste (vérifiée avant le profil : aucun oracle)
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select carnet.record_event('00000000-0000-4000-8000-0000000028d1', '00000000-0000-4000-8000-000000002810', 'page_view', 'direct', null, 'mobile')$$,
  '22023', null, 'décision 2 : type hors liste → 22023'
);
select throws_ok(
  $$select carnet.record_event('00000000-0000-4000-8000-0000000028d2', '00000000-0000-4000-8000-000000002810', 'profile_view', 'email', null, 'mobile')$$,
  '22023', null, 'décision 2 : source hors liste → 22023'
);
select throws_ok(
  $$select carnet.record_event('00000000-0000-4000-8000-0000000028d3', '00000000-0000-4000-8000-000000002810', 'profile_view', 'direct', null, 'bot')$$,
  '22023', null, 'décision 2 : device_class hors liste (bot) → 22023'
);
select throws_ok(
  $$select carnet.record_event('00000000-0000-4000-8000-0000000028d4', '00000000-0000-4000-8000-000000002810', null, 'direct', null, 'mobile')$$,
  '22023', null, 'décision 2 : type nul → 22023'
);
select throws_ok(
  $$select carnet.record_event('00000000-0000-4000-8000-0000000028d5', '00000000-0000-4000-8000-000000002810', 'profile_view', null, null, 'mobile')$$,
  '22023', null, 'décision 2 : source nulle → 22023'
);
select throws_ok(
  $$select carnet.record_event('00000000-0000-4000-8000-0000000028d6', '00000000-0000-4000-8000-000000002810', 'profile_view', 'direct', null, null)$$,
  '22023', null, 'décision 2 : device_class nul → 22023'
);
select throws_ok(
  $$select carnet.record_event(null, '00000000-0000-4000-8000-000000002810', 'profile_view', 'direct', null, 'mobile')$$,
  '22023', null, 'décision 2 : id nul → 22023 (l''id est fourni par l''émetteur)'
);
select throws_ok(
  $$select carnet.record_event('00000000-0000-4000-8000-0000000028d7', '00000000-0000-4000-8000-000000002810', 'link_click', 'direct', null, 'mobile')$$,
  '22023', null, 'décision 1 : link_click sans link_id → 22023 (obligatoire à l''insertion)'
);
select throws_ok(
  $$select carnet.record_event('00000000-0000-4000-8000-0000000028d8', '00000000-0000-4000-8000-000000002810', 'profile_view', 'direct', '00000000-0000-4000-8000-000000002820', 'mobile')$$,
  '22023', null, 'décision 1 : link_id sur un autre type que link_click → 22023'
);
select throws_ok(
  $$select carnet.record_event('00000000-0000-4000-8000-0000000028d9', '00000000-0000-4000-8000-000000002812', 'page_view', 'direct', null, 'mobile')$$,
  '22023', null, 'décision 2 : type hors liste sur un profil non publié → 22023 aussi (validation avant le profil, pas d''oracle)'
);
reset role;
select is(
  pg_temp.num($$select count(*) from carnet.analytics_events where id::text like '00000000-0000-4000-8000-0000000028d%'$$),
  0::bigint,
  'décision 2 : aucun appel rejeté en 22023 n''a laissé d''événement'
);

-- ---------------------------------------------------------------------------
-- Critère 3 — anon et authenticated : ni record_event, ni analytics_events
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select carnet.record_event('00000000-0000-4000-8000-0000000028b1', '00000000-0000-4000-8000-000000002810', 'profile_view', 'direct', null, 'mobile')$$,
  '42501', null, 'critère 3 : anon ne peut pas exécuter record_event (42501)'
);
select throws_ok($$select id from carnet.analytics_events$$, '42501', null, 'critère 3 : anon ne lit pas analytics_events (42501)');
select throws_ok($$select profile_id from carnet.analytics_daily$$, '42501', null, 'critère 4 : anon ne lit pas analytics_daily (42501)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000280a","role":"authenticated"}';
select throws_ok(
  $$select carnet.record_event('00000000-0000-4000-8000-0000000028b2', '00000000-0000-4000-8000-000000002810', 'profile_view', 'direct', null, 'mobile')$$,
  '42501', null, 'critère 3 : authenticated ne peut pas exécuter record_event, même sur son propre profil (42501)'
);
select throws_ok($$select id from carnet.analytics_events$$, '42501', null, 'critère 3 : authenticated ne lit pas analytics_events, même ceux de son profil (42501)');
select throws_ok(
  $$insert into carnet.analytics_events (id, profile_id, type, source, device_class)
    values ('00000000-0000-4000-8000-0000000028b3', '00000000-0000-4000-8000-000000002810', 'profile_view', 'direct', 'mobile')$$,
  '42501', null, 'critère 3 : authenticated n''insère pas directement dans analytics_events (42501)'
);
select throws_ok(
  $$insert into carnet.analytics_daily (profile_id, day, metric, value)
    values ('00000000-0000-4000-8000-000000002810', '2026-02-02', 'profile_view', 1000)$$,
  '42501', null, 'décision 6 : le propriétaire ne peut pas insérer d''agrégat (42501)'
);
select throws_ok(
  $$update carnet.analytics_daily set value = 1000 where profile_id = '00000000-0000-4000-8000-000000002810'$$,
  '42501', null, 'décision 6 : le propriétaire ne peut pas modifier ses agrégats (42501)'
);
select throws_ok(
  $$delete from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'$$,
  '42501', null, 'décision 6 : le propriétaire ne peut pas supprimer ses agrégats (42501)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 4 — lecture des agrégats : propriétaire seul
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into carnet.analytics_daily (profile_id, day, metric, link_id, source, value) values
      ('00000000-0000-4000-8000-000000002810', '2026-03-01', 'profile_view', null, 'nfc', 5),
      ('00000000-0000-4000-8000-000000002810', '2026-03-01', 'profile_view', null, 'qr', 2),
      ('00000000-0000-4000-8000-000000002810', '2026-03-01', 'link_click', '00000000-0000-4000-8000-000000002820', null, 4),
      ('00000000-0000-4000-8000-000000002811', '2026-03-01', 'profile_view', null, 'direct', 7),
      ('00000000-0000-4000-8000-000000002811', '2026-03-01', 'nfc_scan', null, 'nfc', 3),
      ('00000000-0000-4000-8000-000000002813', '2026-03-01', 'profile_view', null, 'direct', 9)$$,
  'critère 4 (précondition) : postgres insère des agrégats pour A, B et O'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000280a","role":"authenticated"}';
select lives_ok($$insert into reads select 'a_total', count(*) from carnet.analytics_daily$$, 'critère 4 : A lit analytics_daily sans erreur');
select lives_ok(
  $$insert into reads select 'a_foreign', count(*) from carnet.analytics_daily where profile_id <> '00000000-0000-4000-8000-000000002810'$$,
  'critère 4 : A interroge les agrégats des autres profils sans erreur'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000280b","role":"authenticated"}';
select lives_ok($$insert into reads select 'b_total', count(*) from carnet.analytics_daily$$, 'critère 4 : B lit analytics_daily sans erreur');
select lives_ok(
  $$insert into reads select 'b_sees_a', count(*) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'$$,
  'critère 4 : B interroge les agrégats de A sans erreur'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000280c","role":"authenticated"}';
select lives_ok($$insert into reads select 'u_total', count(*) from carnet.analytics_daily$$, 'critère 4 : U (membre sans statistiques) lit analytics_daily sans erreur');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000280d","role":"authenticated"}';
select lives_ok($$insert into reads select 'x_total', count(*) from carnet.analytics_daily$$, 'critère 4 : X (autre projet) interroge analytics_daily sans erreur');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000280e","role":"authenticated"}';
select lives_ok($$insert into reads select 'o_total', count(*) from carnet.analytics_daily$$, 'critère 4 : O (autre projet, propriétaire d''un profil) interroge analytics_daily sans erreur');
reset role;

select is((select n from reads where label = 'a_total'), 3::bigint, 'critère 4 : le propriétaire A lit ses trois agrégats');
select is((select n from reads where label = 'a_foreign'), 0::bigint, 'critère 4 : A ne lit aucun agrégat d''un autre profil');
select is((select n from reads where label = 'b_total'), 2::bigint, 'critère 4 : B ne lit que ses deux agrégats');
select is((select n from reads where label = 'b_sees_a'), 0::bigint, 'critère 4 : un autre membre de carnet (B) ne lit rien de A');
select is((select n from reads where label = 'u_total'), 0::bigint, 'critère 4 : un membre de carnet sans statistiques ne lit rien');
select is((select n from reads where label = 'x_total'), 0::bigint, 'critère 4 : un compte d''un autre projet de l''instance ne lit rien');
select is((select n from reads where label = 'o_total'), 0::bigint, 'critère 4 : un compte d''un autre projet ne lit rien, même les agrégats d''un profil qu''il possède (is_member)');

-- ---------------------------------------------------------------------------
-- Critère 5 — carnet.aggregate_analytics_day(p_day date)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'aggregate_analytics_day', array['date'], 'décision 4 : carnet.aggregate_analytics_day(date) existe');
select function_returns('carnet', 'aggregate_analytics_day', array['date'], 'void', 'décision 4 : aggregate_analytics_day renvoie void');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.aggregate_analytics_day(date)')
             and p.proconfig @> array['search_path=""'] and p.proargnames = array['p_day']),
  'décision 4 : aggregate_analytics_day fixe search_path = '''' et nomme son paramètre p_day'
);
select function_privs_are('carnet', 'aggregate_analytics_day', array['date'], 'anon', '{}'::name[], 'décision 6 : execute refusé à anon sur aggregate_analytics_day');
select function_privs_are('carnet', 'aggregate_analytics_day', array['date'], 'authenticated', '{}'::name[], 'décision 6 : execute refusé à authenticated sur aggregate_analytics_day');
select function_privs_are('carnet', 'aggregate_analytics_day', array['date'], 'public', '{}'::name[], 'décision 6 : execute révoqué pour public sur aggregate_analytics_day');
select function_privs_are('carnet', 'aggregate_analytics_day', array['date'], 'service_role', '{}'::name[], 'audit de sécurité : execute refusé à service_role sur aggregate_analytics_day (pg_cron sous postgres seulement)');

-- Horloge injectée : occurred_at explicites, relatifs au jour de Paris de now() (figé dans la transaction).
-- D = aujourd'hui (Paris) − 10 jours, dans la fenêtre de recalcul (J−89 et après). Les bornes sont des minuits de Paris :
-- elles valent en été comme en hiver ; 23 h 30 UTC tombe toujours le lendemain à Paris (UTC+1 ou UTC+2).
select lives_ok(
  $$insert into carnet.analytics_events (id, profile_id, type, source, link_id, device_class, occurred_at) values
      ('00000000-0000-4000-8000-0000000028a1', '00000000-0000-4000-8000-000000002810', 'profile_view', 'nfc', null, 'mobile', (pg_temp.paris_day(-11) + time '23:30') at time zone 'UTC'),
      ('00000000-0000-4000-8000-0000000028a2', '00000000-0000-4000-8000-000000002810', 'profile_view', 'nfc', null, 'mobile', pg_temp.paris_at(pg_temp.paris_day(-10), '10:00')),
      ('00000000-0000-4000-8000-0000000028a3', '00000000-0000-4000-8000-000000002810', 'profile_view', 'qr', null, 'desktop', pg_temp.paris_at(pg_temp.paris_day(-10), '12:00')),
      ('00000000-0000-4000-8000-0000000028a4', '00000000-0000-4000-8000-000000002810', 'link_click', 'direct', '00000000-0000-4000-8000-000000002820', 'mobile', pg_temp.paris_at(pg_temp.paris_day(-10), '13:00')),
      ('00000000-0000-4000-8000-0000000028a5', '00000000-0000-4000-8000-000000002810', 'link_click', 'direct', '00000000-0000-4000-8000-000000002820', 'mobile', pg_temp.paris_at(pg_temp.paris_day(-10), '14:00')),
      ('00000000-0000-4000-8000-0000000028a6', '00000000-0000-4000-8000-000000002810', 'link_click', 'direct', '00000000-0000-4000-8000-000000002821', 'desktop', pg_temp.paris_at(pg_temp.paris_day(-10), '15:00')),
      ('00000000-0000-4000-8000-0000000028a7', '00000000-0000-4000-8000-000000002810', 'nfc_scan', 'nfc', null, 'mobile', pg_temp.paris_at(pg_temp.paris_day(-9), '00:00') - interval '1 minute'),
      ('00000000-0000-4000-8000-0000000028a8', '00000000-0000-4000-8000-000000002810', 'nfc_scan', 'nfc', null, 'mobile', pg_temp.paris_at(pg_temp.paris_day(-9), '00:00')),
      ('00000000-0000-4000-8000-0000000028a9', '00000000-0000-4000-8000-000000002810', 'profile_view', 'direct', null, 'mobile', pg_temp.paris_at(pg_temp.paris_day(-10), '00:00') - interval '30 minutes'),
      ('00000000-0000-4000-8000-0000000028aa', '00000000-0000-4000-8000-000000002811', 'profile_view', 'nfc', null, 'mobile', pg_temp.paris_at(pg_temp.paris_day(-10), '10:00'))$$,
  'critère 5 (précondition) : postgres insère des événements datés autour des minuits de Paris de J−10'
);
select lives_ok($$select carnet.aggregate_analytics_day(pg_temp.paris_day(-10))$$, 'critère 5 : l''agrégation de J−10 s''exécute');

select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'
                and day = pg_temp.paris_day(-10) and metric = 'profile_view'$$),
  3::bigint,
  'critère 5 : A a 3 vues à J−10 (jour civil Europe/Paris)'
);
select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'
                and day = pg_temp.paris_day(-10) and metric = 'profile_view' and source = 'nfc'$$),
  2::bigint,
  'critère 5 : un événement à 23 h 30 UTC la veille compte pour le lendemain (Europe/Paris) : 2 vues nfc à J−10'
);
select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'
                and day = pg_temp.paris_day(-10) and metric = 'profile_view' and source = 'qr'$$),
  1::bigint,
  'critère 5 : les vues sont ventilées par source (1 vue qr à J−10)'
);
select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'
                and day = pg_temp.paris_day(-10) and metric = 'link_click' and link_id = '00000000-0000-4000-8000-000000002820'$$),
  2::bigint,
  'critère 5 : les clics sont ventilés par lien (2 clics sur le premier lien)'
);
select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'
                and day = pg_temp.paris_day(-10) and metric = 'link_click' and link_id = '00000000-0000-4000-8000-000000002821'$$),
  1::bigint,
  'critère 5 : 1 clic sur le second lien'
);
select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'
                and day = pg_temp.paris_day(-10) and metric = 'nfc_scan'$$),
  1::bigint,
  'critère 5 : 23 h 59 à Paris compte pour J−10, minuit à Paris pour le lendemain'
);
select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002811'
                and day = pg_temp.paris_day(-10) and metric = 'profile_view'$$),
  1::bigint,
  'critère 5 : les agrégats de B sont calculés séparément (1 vue à J−10)'
);
select is(
  pg_temp.num($$select count(*) from carnet.analytics_daily where day in (pg_temp.paris_day(-11), pg_temp.paris_day(-9))$$),
  0::bigint,
  'critère 5 : l''agrégation de J−10 n''écrit rien pour la veille ni le lendemain'
);

select lives_ok(
  $$insert into agg_snapshot select profile_id, day, metric, link_id, source, value from carnet.analytics_daily where day = pg_temp.paris_day(-10)$$,
  'critère 5 : instantané des agrégats de J−10'
);
select lives_ok($$select carnet.aggregate_analytics_day(pg_temp.paris_day(-10))$$, 'critère 5 : la même agrégation relancée s''exécute');
select ok((select count(*) > 0 from agg_snapshot), 'critère 5 : l''instantané de J−10 n''est pas vide');
select is(
  pg_temp.num($$select count(*) from (
                  (select profile_id, day, metric, link_id, source, value from carnet.analytics_daily where day = pg_temp.paris_day(-10)
                   except all select * from agg_snapshot)
                  union all
                  (select * from agg_snapshot
                   except all select profile_id, day, metric, link_id, source, value from carnet.analytics_daily where day = pg_temp.paris_day(-10))
                ) d$$),
  0::bigint,
  'critère 5 : relancer l''agrégation d''un jour donne exactement les mêmes lignes et valeurs (pas de double comptage)'
);

select lives_ok($$select carnet.aggregate_analytics_day(pg_temp.paris_day(-11))$$, 'critère 5 : l''agrégation de J−11 s''exécute');
select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'
                and day = pg_temp.paris_day(-11) and metric = 'profile_view'$$),
  1::bigint,
  'critère 5 : J−11 ne compte que 23 h 30 à Paris, pas 23 h 30 UTC (compté le lendemain)'
);

select lives_ok(
  $$insert into carnet.analytics_events (id, profile_id, type, source, link_id, device_class, occurred_at) values
      ('00000000-0000-4000-8000-0000000028ad', '00000000-0000-4000-8000-000000002810', 'profile_view', 'nfc', null, 'mobile', pg_temp.paris_at(pg_temp.paris_day(-10), '16:00'))$$,
  'décision 4 (précondition) : un événement tardif arrive pour J−10'
);
select lives_ok($$select carnet.aggregate_analytics_day(pg_temp.paris_day(-10))$$, 'décision 4 : le recalcul de J−10 s''exécute');
select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'
                and day = pg_temp.paris_day(-10) and metric = 'profile_view' and source = 'nfc'$$),
  3::bigint,
  'décision 4 : le recalcul complet met la valeur à jour (on conflict do update) : 3 vues nfc'
);
select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'
                and day = pg_temp.paris_day(-10) and metric = 'profile_view'$$),
  4::bigint,
  'décision 4 : 4 vues au total à J−10 après recalcul'
);

-- Recalcul complet dans la fenêtre : la valeur peut baisser (interdit la règle « ne fait que monter »).
select lives_ok(
  $$delete from carnet.analytics_events where id in ('00000000-0000-4000-8000-0000000028a2', '00000000-0000-4000-8000-0000000028ad')$$,
  'décision 4 (précondition) : postgres retire deux vues nfc brutes de J−10'
);
select lives_ok($$select carnet.aggregate_analytics_day(pg_temp.paris_day(-10))$$, 'décision 4 : le recalcul de J−10 après retrait s''exécute');
select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'
                and day = pg_temp.paris_day(-10) and metric = 'profile_view' and source = 'nfc'$$),
  1::bigint,
  'décision 4 : dans la fenêtre, le recalcul est complet et la valeur baisse (3 → 1 vue nfc ; do update set value = excluded.value)'
);
select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'
                and day = pg_temp.paris_day(-10) and metric = 'profile_view'$$),
  2::bigint,
  'décision 4 : 2 vues au total à J−10 après retrait et recalcul'
);

-- ---------------------------------------------------------------------------
-- Décision 4 — fenêtre de recalcul : J−89 (Paris) recalculé ; avant, aucun effet, sans erreur
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into carnet.analytics_events (id, profile_id, type, source, link_id, device_class, occurred_at) values
      ('00000000-0000-4000-8000-000000002871', '00000000-0000-4000-8000-000000002811', 'contact_click', 'direct', null, 'mobile', pg_temp.paris_at(pg_temp.paris_day(-89), '12:00'))$$,
  'décision 4 (précondition) : un événement brut à J−89 midi (Paris)'
);
select lives_ok($$select carnet.aggregate_analytics_day(pg_temp.paris_day(-89))$$, 'décision 4 : l''agrégation de J−89 s''exécute');
select is(
  pg_temp.txt($$select string_agg(metric || '/' || coalesce(source, '<null>') || '=' || value, ',' order by metric, source)
                  from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002811' and day = pg_temp.paris_day(-89)$$),
  'contact_click/direct=1',
  'décision 4 : J−89 est dans la fenêtre, il est agrégé'
);

select lives_ok(
  $$insert into carnet.analytics_daily (profile_id, day, metric, link_id, source, value)
    values ('00000000-0000-4000-8000-000000002811', pg_temp.paris_day(-90), 'profile_view', null, 'direct', 7)$$,
  'décision 4 (précondition) : postgres insère un agrégat de 7 vues à J−90'
);
select lives_ok(
  $$insert into carnet.analytics_events (id, profile_id, type, source, link_id, device_class, occurred_at) values
      ('00000000-0000-4000-8000-000000002872', '00000000-0000-4000-8000-000000002811', 'profile_view', 'direct', null, 'mobile', pg_temp.paris_at(pg_temp.paris_day(-90), '12:00')),
      ('00000000-0000-4000-8000-000000002873', '00000000-0000-4000-8000-000000002811', 'profile_view', 'direct', null, 'mobile', pg_temp.paris_at(pg_temp.paris_day(-90), '12:30')),
      ('00000000-0000-4000-8000-000000002874', '00000000-0000-4000-8000-000000002811', 'vcard_download', 'direct', null, 'mobile', pg_temp.paris_at(pg_temp.paris_day(-90), '13:00'))$$,
  'décision 4 (précondition) : des événements bruts restent à J−90 (2 vues, 1 vCard)'
);
select lives_ok($$select carnet.aggregate_analytics_day(pg_temp.paris_day(-90))$$, 'décision 4 : l''agrégation de J−90 (hors fenêtre, avec événements bruts) ne lève aucune erreur');
select is(
  pg_temp.txt($$select string_agg(metric || '/' || coalesce(source, '<null>') || '=' || value, ',' order by metric, source)
                  from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002811' and day = pg_temp.paris_day(-90)$$),
  'profile_view/direct=7',
  'décision 4 : hors fenêtre, avec événements bruts restants, la ligne est inchangée (7) et aucune ligne n''est ajoutée'
);
select lives_ok(
  $$delete from carnet.analytics_events where id in ('00000000-0000-4000-8000-000000002872', '00000000-0000-4000-8000-000000002873', '00000000-0000-4000-8000-000000002874')$$,
  'décision 4 (précondition) : plus aucun événement brut à J−90'
);
select lives_ok($$select carnet.aggregate_analytics_day(pg_temp.paris_day(-90))$$, 'décision 4 : l''agrégation de J−90 (hors fenêtre, sans événement brut) ne lève aucune erreur');
select is(
  pg_temp.txt($$select string_agg(metric || '/' || coalesce(source, '<null>') || '=' || value, ',' order by metric, source)
                  from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002811' and day = pg_temp.paris_day(-90)$$),
  'profile_view/direct=7',
  'décision 4 : hors fenêtre, sans événement brut, la ligne est inchangée (7) et aucune ligne n''est ajoutée'
);

-- ---------------------------------------------------------------------------
-- Décision 4 (corrigée) — suppression de liens : agrégats intacts sous leur uuid d'origine, sans double comptage
-- ---------------------------------------------------------------------------
select lives_ok(
  $$delete from carnet.links where id = '00000000-0000-4000-8000-000000002820'$$,
  'décision 4 : la suppression du premier lien cliqué réussit'
);
select lives_ok(
  $$delete from carnet.links where id = '00000000-0000-4000-8000-000000002821'$$,
  'décision 4 : la suppression d''un second lien cliqué le même jour (J−10) réussit'
);
select is(
  pg_temp.num($$select count(*) from carnet.analytics_events where profile_id = '00000000-0000-4000-8000-000000002810'
                and type = 'link_click' and link_id is null and (occurred_at at time zone 'Europe/Paris')::date = pg_temp.paris_day(-10)$$),
  3::bigint,
  'décision 1 : les événements des liens supprimés restent, link_id à null'
);
select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'
                and day = pg_temp.paris_day(-10) and metric = 'link_click'$$),
  3::bigint,
  'décision 4 : le total des clics de J−10 est conservé après suppression des liens'
);
select is(
  pg_temp.txt($$select string_agg(link_id || '=' || value, ',' order by link_id) from carnet.analytics_daily
                where profile_id = '00000000-0000-4000-8000-000000002810' and day = pg_temp.paris_day(-10) and metric = 'link_click'$$),
  '00000000-0000-4000-8000-000000002820=2,00000000-0000-4000-8000-000000002821=1',
  'décision 4 (corrigée) : après suppression, les agrégats de clics gardent l''uuid d''origine de chaque lien (2 et 1)'
);
select is(
  pg_temp.num($$select count(*) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'
                and day = '2026-03-01' and metric = 'link_click' and link_id = '00000000-0000-4000-8000-000000002820'$$),
  1::bigint,
  'décision 4 (corrigée) : un agrégat plus ancien du lien supprimé garde aussi son uuid'
);
select lives_ok($$select carnet.aggregate_analytics_day(pg_temp.paris_day(-10))$$, 'décision 4 : le recalcul de J−10 après suppression des liens s''exécute');
select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'
                and day = pg_temp.paris_day(-10) and metric = 'link_click'$$),
  3::bigint,
  'décision 4 : après recalcul, toujours 3 clics à J−10 (aucun double comptage des clics de liens supprimés)'
);
select is(
  pg_temp.txt($$select string_agg(coalesce(link_id::text, '<null>') || '=' || value, ',' order by link_id nulls last) from carnet.analytics_daily
                where profile_id = '00000000-0000-4000-8000-000000002810' and day = pg_temp.paris_day(-10) and metric = 'link_click'$$),
  '00000000-0000-4000-8000-000000002820=2,00000000-0000-4000-8000-000000002821=1',
  'décision 4 (corrigée) : après recalcul, les lignes de clics sont inchangées (uuid d''origine, aucune ligne à link_id nul ajoutée)'
);

-- ---------------------------------------------------------------------------
-- Critère 6 — carnet.purge_analytics_events(p_older_than interval)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'purge_analytics_events', array['interval'], 'décision 5 : carnet.purge_analytics_events(interval) existe');
select function_returns('carnet', 'purge_analytics_events', array['interval'], 'integer', 'décision 5 : purge_analytics_events renvoie le nombre d''événements supprimés (integer)');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.purge_analytics_events(interval)')
             and p.proconfig @> array['search_path=""'] and p.proargnames = array['p_older_than']),
  'décision 5 : purge_analytics_events fixe search_path = '''' et nomme son paramètre p_older_than'
);
select function_privs_are('carnet', 'purge_analytics_events', array['interval'], 'anon', '{}'::name[], 'décision 6 : execute refusé à anon sur purge_analytics_events');
select function_privs_are('carnet', 'purge_analytics_events', array['interval'], 'authenticated', '{}'::name[], 'décision 6 : execute refusé à authenticated sur purge_analytics_events');
select function_privs_are('carnet', 'purge_analytics_events', array['interval'], 'public', '{}'::name[], 'décision 6 : execute révoqué pour public sur purge_analytics_events');
select function_privs_are('carnet', 'purge_analytics_events', array['interval'], 'service_role', '{}'::name[], 'audit de sécurité : execute refusé à service_role sur purge_analytics_events (pg_cron sous postgres seulement)');
select throws_ok($$select carnet.purge_analytics_events(null)$$, '22023', null, 'décision 5 : intervalle nul → 22023');
select throws_ok($$select carnet.purge_analytics_events(interval '0')$$, '22023', null, 'décision 5 : intervalle nul (0) → 22023 (effacerait tout)');
select throws_ok($$select carnet.purge_analytics_events(interval '-1 day')$$, '22023', null, 'décision 5 : intervalle négatif → 22023');

select lives_ok(
  $$insert into carnet.analytics_events (id, profile_id, type, source, link_id, device_class, occurred_at) values
      ('00000000-0000-4000-8000-000000002891', '00000000-0000-4000-8000-000000002811', 'profile_view', 'direct', null, 'mobile', now() - interval '90 days 1 minute'),
      ('00000000-0000-4000-8000-000000002892', '00000000-0000-4000-8000-000000002811', 'profile_view', 'direct', null, 'mobile', now() - interval '89 days 23 hours 59 minutes')$$,
  'critère 6 (précondition) : postgres insère un événement de 90 jours et 1 minute et un de 89 jours 23 h 59'
);
select lives_ok($$insert into reads select 'daily_before', count(*) from carnet.analytics_daily$$, 'critère 6 : nombre d''agrégats avant purge relevé');
select lives_ok($$insert into reads select 'events_before', count(*) from carnet.analytics_events$$, 'critère 6 : nombre d''événements avant purge relevé');
select lives_ok(
  $$insert into reads select 'purged', carnet.purge_analytics_events(interval '90 days')$$,
  'critère 6 : purge_analytics_events(interval ''90 days'') s''exécute'
);
select is(
  pg_temp.num($$select count(*) from carnet.analytics_events where id = '00000000-0000-4000-8000-000000002891'$$),
  0::bigint,
  'critère 6 : l''événement de plus de 90 jours est supprimé'
);
select is(
  pg_temp.num($$select count(*) from carnet.analytics_events where id = '00000000-0000-4000-8000-000000002892'$$),
  1::bigint,
  'critère 6 : l''événement de moins de 90 jours est conservé'
);
select ok(
  coalesce((select n from reads where label = 'purged')
           = (select n from reads where label = 'events_before') - pg_temp.num($$select count(*) from carnet.analytics_events$$), false)
  and (select n from reads where label = 'purged') >= 1,
  'critère 6 : purge_analytics_events renvoie le nombre d''événements supprimés'
);
select ok(
  coalesce(pg_temp.num($$select count(*) from carnet.analytics_daily$$) = (select n from reads where label = 'daily_before'), false)
  and (select n from reads where label = 'daily_before') > 0,
  'critère 6 : la purge ne supprime aucun agrégat'
);

-- ---------------------------------------------------------------------------
-- Critère 7 et décision 5 — tâches pg_cron
-- ---------------------------------------------------------------------------
select has_extension('pg_cron', 'critère 7 : l''extension pg_cron est installée');
select lives_ok(
  $$insert into cron_job_snapshot (jobid, jobname, schedule, command, database, username, active)
    select jobid, jobname, schedule, command, database, username, active
      from cron.job
     where jobname in ('carnet-aggregate-analytics', 'carnet-purge-analytics-events')
        or command ilike '%aggregate_analytics%' or command ilike '%purge_analytics_events%'$$,
  'critère 7 : postgres lit cron.job'
);
select is(
  (select count(*) from cron_job_snapshot where jobname = 'carnet-aggregate-analytics'),
  1::bigint,
  'critère 7 : exactement une tâche carnet-aggregate-analytics'
);
select is(
  (select count(*) from cron_job_snapshot where command ilike '%aggregate_analytics%'),
  1::bigint,
  'critère 7 : aucune autre tâche n''appelle l''agrégation'
);
select is(
  (select schedule from cron_job_snapshot where jobname = 'carnet-aggregate-analytics'),
  '*/15 * * * *',
  'décision 5 : l''agrégation tourne toutes les 15 minutes'
);
select ok(
  coalesce((select database = 'postgres' and username = 'postgres' and active from cron_job_snapshot where jobname = 'carnet-aggregate-analytics'), false),
  'décision 5 : carnet-aggregate-analytics est active, base postgres, utilisateur postgres'
);
select is(
  (select count(*) from cron_job_snapshot where jobname = 'carnet-purge-analytics-events'),
  1::bigint,
  'critère 7 : exactement une tâche carnet-purge-analytics-events'
);
select is(
  (select count(*) from cron_job_snapshot where command ilike '%purge_analytics_events%'),
  1::bigint,
  'critère 7 : aucune autre tâche n''appelle la purge des événements'
);
select ok(
  coalesce((select schedule ~ '^[0-9]{1,2} [0-9]{1,2} \* \* \*$' from cron_job_snapshot where jobname = 'carnet-purge-analytics-events'), false),
  'décision 5 : la purge est quotidienne (minute et heure fixes, * * *)'
);
select is(
  (select regexp_replace(btrim(regexp_replace(command, '\s+', ' ', 'g')), '\s*;$', '')
     from cron_job_snapshot where jobname = 'carnet-purge-analytics-events'),
  'select carnet.purge_analytics_events(interval ''90 days'')',
  'décision 5 : la commande de purge est select carnet.purge_analytics_events(interval ''90 days'')'
);
select ok(
  coalesce((select database = 'postgres' and username = 'postgres' and active from cron_job_snapshot where jobname = 'carnet-purge-analytics-events'), false),
  'décision 5 : carnet-purge-analytics-events est active, base postgres, utilisateur postgres'
);
select ok(
  (select cron.schedule(jobname, schedule, command) = jobid from cron_job_snapshot where jobname = 'carnet-aggregate-analytics'),
  'critère 7 : replanifier carnet-aggregate-analytics sous le même nom garde le même jobid'
);
select ok(
  (select cron.schedule(jobname, schedule, command) = jobid from cron_job_snapshot where jobname = 'carnet-purge-analytics-events'),
  'critère 7 : replanifier carnet-purge-analytics-events sous le même nom garde le même jobid'
);
select is(
  (select count(*) from cron.job where jobname in ('carnet-aggregate-analytics', 'carnet-purge-analytics-events')),
  2::bigint,
  'critère 7 : toujours une seule tâche de chaque nom après replanification'
);

-- Fumée : la commande enregistrée, exécutée telle quelle par postgres, agrège aujourd'hui et hier (Europe/Paris).
select lives_ok(
  $$insert into carnet.analytics_events (id, profile_id, type, source, link_id, device_class, occurred_at) values
      ('00000000-0000-4000-8000-000000002881', '00000000-0000-4000-8000-000000002811', 'vcard_download', 'direct', null, 'mobile', now()),
      ('00000000-0000-4000-8000-000000002882', '00000000-0000-4000-8000-000000002811', 'vcard_download', 'direct', null, 'mobile',
        (((now() at time zone 'Europe/Paris')::date - 1) + time '12:00') at time zone 'Europe/Paris'),
      ('00000000-0000-4000-8000-000000002883', '00000000-0000-4000-8000-000000002811', 'vcard_download', 'direct', null, 'mobile',
        (((now() at time zone 'Europe/Paris')::date - 2) + time '12:00') at time zone 'Europe/Paris')$$,
  'décision 5 (précondition) : vCard téléchargée aujourd''hui, hier midi et avant-hier midi (heure de Paris)'
);
select lives_ok(
  $smoke$do $$
    declare
      v_command text;
    begin
      select command into strict v_command from cron_job_snapshot where jobname = 'carnet-aggregate-analytics';
      execute v_command;
    end
  $$$smoke$,
  'décision 5 : la commande de carnet-aggregate-analytics s''exécute sous postgres'
);
select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002811'
                and metric = 'vcard_download' and day = (now() at time zone 'Europe/Paris')::date$$),
  1::bigint,
  'décision 5 : la tâche d''agrégation recalcule aujourd''hui'
);
select is(
  pg_temp.num($$select sum(value) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002811'
                and metric = 'vcard_download' and day = (now() at time zone 'Europe/Paris')::date - 1$$),
  1::bigint,
  'décision 5 : la tâche d''agrégation recalcule hier'
);
select is(
  pg_temp.num($$select count(*) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002811'
                and metric = 'vcard_download' and day = (now() at time zone 'Europe/Paris')::date - 2$$),
  0::bigint,
  'décision 5 : la tâche d''agrégation ne touche pas à avant-hier'
);

select lives_ok(
  $$insert into carnet.analytics_events (id, profile_id, type, source, link_id, device_class, occurred_at) values
      ('00000000-0000-4000-8000-000000002884', '00000000-0000-4000-8000-000000002811', 'qr_scan', 'qr', null, 'mobile', now() - interval '91 days')$$,
  'décision 5 (précondition) : événement de 91 jours'
);
select lives_ok(
  $smoke$do $$
    declare
      v_command text;
    begin
      select command into strict v_command from cron_job_snapshot where jobname = 'carnet-purge-analytics-events';
      execute v_command;
    end
  $$$smoke$,
  'décision 5 : la commande de carnet-purge-analytics-events s''exécute sous postgres'
);
select is(
  pg_temp.num($$select count(*) from carnet.analytics_events where id = '00000000-0000-4000-8000-000000002884'$$),
  0::bigint,
  'décision 5 : la tâche de purge supprime l''événement de 91 jours'
);

-- ---------------------------------------------------------------------------
-- Décision 7 — delete_own_account (0023) emporte événements et agrégats du profil
-- ---------------------------------------------------------------------------
select ok(
  pg_temp.num($$select count(*) from carnet.analytics_events where profile_id = '00000000-0000-4000-8000-000000002810'$$) > 0
  and pg_temp.num($$select count(*) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'$$) > 0,
  'décision 7 (précondition) : le profil de A a des événements et des agrégats'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000280a","role":"authenticated"}';
select lives_ok($$select carnet.delete_own_account()$$, 'décision 7 : A supprime son compte');
reset role;
select is(
  pg_temp.num($$select count(*) from carnet.analytics_events where profile_id = '00000000-0000-4000-8000-000000002810'$$),
  0::bigint,
  'décision 7 : delete_own_account supprime les événements du profil'
);
select is(
  pg_temp.num($$select count(*) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002810'$$),
  0::bigint,
  'décision 7 : delete_own_account supprime les agrégats du profil'
);
select ok(
  pg_temp.num($$select count(*) from carnet.analytics_events where profile_id = '00000000-0000-4000-8000-000000002811'$$) > 0
  and pg_temp.num($$select count(*) from carnet.analytics_daily where profile_id = '00000000-0000-4000-8000-000000002811'$$) > 0,
  'décision 7 : les événements et agrégats de B ne sont pas touchés'
);

select * from finish();
rollback;
