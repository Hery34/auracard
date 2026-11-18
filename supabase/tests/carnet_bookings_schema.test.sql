-- Fiche 0036 / ADR 0016 — schéma du module de rendez-vous : profiles.time_zone, carnet.event_types,
-- carnet.availability_rules, carnet.availability_exceptions, carnet.bookings, carnet.booking_tokens, extension
-- btree_gist, types d'outbox, métriques de statistiques, signatures et droits des fonctions.
-- Critères couverts : 1 (exclusion déclarative sur les réservations confirmées ; la concurrence réelle — verrou par
-- profil — est renvoyée au test d'intégration de 0039), 4 (droits : aucune écriture directe sur bookings, aucun accès
-- direct à booking_tokens, rien pour anon), 6 (structure attendue).
-- Fichiers liés : carnet_bookings_access (RLS, fonctions publiques), carnet_bookings_book_slot (réservation, DST,
-- alignement, horizon), carnet_bookings_token (annulation, report, get_booking_by_token), carnet_bookings_jobs
-- (rappels, purge, claim_booking_outbox, pg_cron, statistiques) ; carnet_leads_outbox (claim_outbox restreinte).
--
-- CONTRAT FIGÉ POUR db-architect (commun aux cinq fichiers carnet_bookings_*, amendé par la fiche 0036 points 14 à 18) :
--   Extension : btree_gist dans le schéma extensions (create extension if not exists btree_gist with schema extensions).
--   carnet.profiles.time_zone text not null default 'Europe/Paris' ; valeur = un name exact de pg_timezone_names
--     (casse comprise : 'europe/paris', '+02:00', '' et 'Mars/Olympus' refusés en 23514) ; update de colonne accordé
--     à authenticated (11 colonnes éditables) ; non exposée par public_profiles (inchangée).
--   carnet.event_types : id uuid pk default gen_random_uuid(), profile_id uuid not null (fk profiles on delete cascade),
--     title text not null (1 à 80 caractères, non blanc, sans \n ni \r ni caractère interdit is_valid_plain_text),
--     duration_min integer not null (5–480), buffer_min integer not null default 0 (0–240),
--     min_notice_min integer not null default 120 (0–43 200), location_kind text not null (in_person, phone, video),
--     location_text text (null ou 1 à 500 caractères, sans \n ni \r ni caractère interdit), is_active boolean not null
--     default true, position smallint not null (0–9), created_at timestamptz not null default now().
--     unique (profile_id, position) (deferrable initially immediate conseillé) + check position 0–9 ⇒ au plus 10 types
--     par profil, garanti en base même en concurrence ; unique (id, profile_id) (cible de la clé composite de bookings).
--     Refus : 23514 (bornes, enum, texte), 23505 (position déjà prise).
--   carnet.availability_rules : id uuid pk default gen_random_uuid(), profile_id uuid not null (fk cascade),
--     weekday smallint not null (1–7, ISO : 1 = lundi), start_time time not null, end_time time not null,
--     created_at timestamptz not null default now() ; check start_time < end_time (23514) ; pas de chevauchement de
--     plages pour un même (profile_id, weekday) : contrainte d'exclusion (23P01) ; plages contiguës autorisées.
--     Point 17 (23514) : end_time − start_time >= 5 minutes ; start_time et end_time à la minute (ni secondes, ni
--     fraction) ; au plus 50 règles par profil (la 51e refusée en CN004, fiche 0038 point 6).
--   carnet.availability_exceptions : id uuid pk default gen_random_uuid(), profile_id uuid not null (fk cascade),
--     range tstzrange not null (non vide, bornes finies, '[)'), kind text not null (busy, extra),
--     created_at timestamptz not null default now() ; refus 23514.
--     Point 17 (23514) : bornes à la minute (date_trunc('minute', b) = b) ; au plus 200 exceptions dont la fin est à
--     venir (upper(range) > now()) par profil (CN004, fiche 0038 point 6 : SQLSTATE dédié « plafond atteint »). Fiche 0038, décision 4 : une exception déjà terminée
--     (upper(range) <= now()) est refusée à l'insertion et à la modification (23514) ; une exception en cours reste
--     acceptée. Refus porté par un trigger (now() n'est pas immuable : pas de check), ce qui permet aux tests de poser
--     des fixtures terminées triggers désactivés.
--   Point 18 — droits update par colonne (champs métier seulement) pour authenticated ; aucun update de table :
--     event_types : title, duration_min, buffer_min, min_notice_min, location_kind, location_text, is_active, position ;
--     availability_rules : weekday, start_time, end_time ; availability_exceptions : range, kind.
--     id, profile_id et created_at ne sont pas modifiables (42501).
--   carnet.bookings : id uuid pk default gen_random_uuid(), profile_id uuid not null (fk profiles on delete cascade),
--     event_type_id uuid not null, clé composite (event_type_id, profile_id) → event_types (id, profile_id) sans
--     cascade (on delete no action : un type ayant des réservations ne se supprime pas, 23503 ; il se désactive),
--     range tstzrange not null (non vide, bornes finies, '[)'), status text not null default 'confirmed'
--     (confirmed, cancelled), visitor_name text not null (1–100, non blanc, sans \n), visitor_email text not null
--     (≤ 254, format de leads_email_format_check), visitor_phone text (null ou ≤ 32 et '^\+?[0-9 .()-]+$'),
--     message text (null ou ≤ 2000, \n autorisé), consent_at timestamptz not null, idempotency_key uuid not null,
--     unique (profile_id, idempotency_key), cancelled_at timestamptz, cancelled_by text (visitor, owner),
--     rescheduled_from uuid (fk bookings on delete set null), reminder_queued_at timestamptz,
--     created_at timestamptz not null default now(). Plus de colonne cancel_token_hash (point 14).
--     Cohérence (23514) : status = 'cancelled' ⇔ cancelled_at not null ⇔ cancelled_by not null.
--     Exclusion btree_gist : exclude using gist (profile_id with =, range with &&) where (status = 'confirmed') → 23P01.
--     Index sur event_type_id et rescheduled_from (clés étrangères).
--   carnet.booking_tokens (point 14) : token_hash bytea pk (exactement 32 octets = SHA-256, sinon 23514 ; doublon
--     23505), booking_id uuid not null (fk bookings on delete cascade : purgés avec la réservation, 23503 si inconnue),
--     created_at timestamptz not null default now() ; exactement ces 3 colonnes ; index commençant par booking_id ;
--     plusieurs jetons par réservation. Jeton en clair = 64 caractères hexadécimaux minuscules (256 bits aléatoires),
--     token_hash = sha256(convert_to(jeton, 'UTF8')) ; le clair n'est jamais stocké hors de la charge utile outbox.
--     Un jeton est valide tant que sa réservation est confirmée et à venir (lower(range) > maintenant).
--     RLS activée et forcée, aucune politique ; aucun privilège pour anon ni authenticated (accès par fonctions).
--   RLS activée et forcée sur les 4 tables métier ; politiques par opération, to authenticated, via carnet.is_member()
--     et carnet.can_edit_profile(profile_id) ; aucune politique pour anon ni public.
--     event_types, availability_rules, availability_exceptions : select, insert, update, delete au propriétaire
--     (privilège update par colonne, point 18).
--     bookings : select seul (le propriétaire lit les données visiteur de ses réservations) ; aucun insert, update,
--     delete, même par colonne. anon : aucun privilège sur les 5 tables.
--   Outbox : outbox_type_check accepte lead.created, booking.confirmed, booking.cancelled, booking.rescheduled,
--     booking.reminder, rien d'autre (23514). Charges utiles (clés exactes) ; chaque message visiteur porte un jeton
--     neuf, dont le hachage est inséré dans booking_tokens dans la même transaction :
--       booking.confirmed   {"booking_id", "cancel_token"}
--       booking.rescheduled {"booking_id" (nouvelle), "previous_booking_id", "cancel_token" (jeton de la nouvelle)}
--       booking.reminder    {"booking_id", "cancel_token"}
--       booking.cancelled   {"booking_id", "cancelled_by"}                       (pas de jeton)
--   carnet.claim_outbox(p_limit) (0031) ne réclame plus que lead.created : les booking.* ne sont ni renvoyés, ni
--     verrouillés, ni incrémentés, ni marqués (point 15).
--   Point 17 — jeton en clair retiré de outbox.payload dès le traitement d'un booking.* : la clé cancel_token est
--     supprimée (payload - 'cancel_token', les autres clés restent) quand complete_outbox le passe processed, quand
--     fail_outbox le passe dead, et quand claim_booking_outbox l'écarte (processed ou dead). Un fail_outbox qui le
--     laisse pending garde le jeton (nouvel essai). lead.created inchangé (charge utile conservée).
--   Statistiques : is_valid_analytics_metric accepte en plus booking_viewed, booking_started, booking_confirmed.
--   Fonctions (toutes set search_path = '', noms qualifiés) :
--     carnet.get_public_booking_page(p_slug text) returns jsonb — stable, security definer ; execute anon,
--       authenticated, service_role. Profil publié : {"time_zone", "event_types", "rules"} exactement ;
--       event_types = types actifs triés par position, éléments {"id", "title", "duration_min", "buffer_min",
--       "min_notice_min", "location_kind", "position"} exactement, plus "location_text" (valeur de la colonne) pour
--       les seuls types location_kind = 'in_person' (point 14 : jamais pour phone ni video) ; ni is_active ;
--       rules = éléments {"weekday", "start_time", "end_time"} exactement ("HH:MM:SS"). Slug inconnu ou profil non
--       publié : SQL null (même réponse).
--     carnet.get_public_busy_ranges(p_slug text, p_from timestamptz, p_to timestamptz) returns jsonb — stable,
--       security definer ; mêmes droits. {"busy": [{"start", "end"}], "extra": [{"start", "end"}]} exactement ;
--       busy = réservations confirmées du profil [lower, upper + buffer_min de leur type) et exceptions busy ;
--       extra = exceptions extra ; seules les plages qui intersectent [p_from, p_to) ; aucune autre clé (ni id, ni
--       donnée visiteur, ni nature de l'occupation). 22023 si un paramètre est nul, p_from >= p_to,
--       p_to − p_from > 62 jours (62 jours exacts acceptés), p_from < now() − interval '1 day' ou
--       p_to > now() + interval '1440 hours' + interval '1 day' (point 18 : pas d'historique public ; bornes
--       exactes acceptées). Slug inconnu ou non publié : SQL null.
--     carnet.book_slot_at(p_slug text, p_event_type_id uuid, p_start timestamptz, p_visitor_name text,
--       p_visitor_email text, p_visitor_phone text, p_message text, p_idempotency_key uuid, p_device_class text,
--       p_now timestamptz) returns table (booking_id uuid, cancel_token text) — volatile, security definer ;
--       execute à personne (ni public, anon, authenticated, service_role) : horloge injectée pour les tests, appelée
--       par le seul enveloppeur. Verrou transactionnel par profil (non testable en pgTAP : intégration 0039).
--       Règles (alignement, horizon) : voir carnet_bookings_book_slot.
--     carnet.book_slot(mêmes paramètres sans p_now) returns table (booking_id uuid, cancel_token text) — volatile,
--       security definer ; service_role seul ; équivaut à book_slot_at(…, now()).
--     carnet.cancel_booking_by_token_at(p_token text, p_now timestamptz) returns uuid — personne ;
--     carnet.cancel_booking_by_token(p_token text) returns uuid — service_role seul.
--     carnet.reschedule_booking_by_token_at(p_token text, p_start timestamptz, p_idempotency_key uuid, p_now timestamptz)
--       returns table (booking_id uuid, cancel_token text) — personne ;
--     carnet.reschedule_booking_by_token(p_token text, p_start timestamptz, p_idempotency_key uuid)
--       returns table (booking_id uuid, cancel_token text) — service_role seul.
--     carnet.get_booking_by_token_at(p_token text, p_now timestamptz) returns jsonb — stable, security definer ;
--       personne ; carnet.get_booking_by_token(p_token text) returns jsonb — stable, security definer, service_role
--       seul, = get_booking_by_token_at(p_token, now()). Forme : voir carnet_bookings_token.
--     carnet.cancel_own_booking(p_booking_id uuid) returns void — security definer ; authenticated seul.
--     carnet.queue_booking_reminders() returns integer — personne ; pg_cron 'carnet-queue-booking-reminders'
--       '*/15 * * * *' → select carnet.queue_booking_reminders().
--     carnet.purge_bookings(p_older_than interval) returns integer — personne ; pg_cron 'carnet-purge-bookings'
--       quotidienne (minute heure * * *) → select carnet.purge_bookings(interval '12 months').
--     carnet.claim_booking_outbox(p_limit integer) returns table (id uuid, type text, attempts integer,
--       booking_id uuid, previous_booking_id uuid, previous_booking_start timestamptz,
--       previous_booking_end timestamptz, cancelled_by text, booking_start timestamptz,
--       booking_end timestamptz, event_type_title text, location_kind text, location_text text, time_zone text,
--       profile_slug text, owner_display_name text, owner_email text, visitor_name text, visitor_email text,
--       visitor_phone text, visitor_message text, cancel_token text) — volatile, security definer ; service_role
--       seul ; for update skip locked. Comportement : voir carnet_bookings_jobs. complete_outbox / fail_outbox :
--       signatures inchangées, jeton retiré (point 17).
--     Point 18 — carnet.hash_booking_token(p_token text) returns bytea — immutable, set search_path = '' ;
--       = sha256(convert_to(p_token, 'UTF8')) ; exécutable ni par anon ni par authenticated.
--     carnet.lock_profile_bookings(p_profile_id uuid) returns void — volatile, set search_path = '' ; verrou
--       transactionnel du profil (pg_advisory_xact_lock) ; exécutable ni par anon ni par authenticated.
--   Codes d'erreur : 22023 paramètre invalide ; P0002 cible introuvable (profil inconnu ou non publié, type inconnu,
--     d'un autre profil ou inactif, jeton inconnu, réservation non accessible), message identique dans chaque
--     fonction ; CN001 créneau pris (chevauchement avec une réservation confirmée, tampons compris, y compris 23P01
--     traduit) ; CN002 créneau indisponible (hors règles et extra, début non aligné sur le pas, exception busy, délai
--     minimal, horizon, report vers un type désactivé) ; CN003 délai d'annulation ou de report dépassé.
-- Personas (UUID fixes, plage 0036 1xxx propre à ce fichier) :
--   A 0…0036 1000 000a membre carnet, profil PA 0…0036 1000 0010 (ana-0036s) ; B 0…000b membre carnet, profil PB 0…0011.
-- Fixtures créées par postgres (bypassrls) via lives_ok ; lectures via pg_temp.txt (null si objet absent) pour que
-- l'absence du schéma produise des échecs et non un abandon. Tout est annulé par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(257);

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

-- Réservation brute (postgres) : clé d'idempotence aléatoire, sans jeton.
create function pg_temp.raw_booking(p_profile uuid, p_type uuid, p_start timestamptz, p_minutes integer,
                                    p_status text default 'confirmed')
returns uuid
language plpgsql as $$
declare
  v uuid;
begin
  insert into carnet.bookings (profile_id, event_type_id, range, status, visitor_name, visitor_email, consent_at,
                               idempotency_key, cancelled_at, cancelled_by)
  values (p_profile, p_type, tstzrange(p_start, p_start + make_interval(mins => p_minutes), '[)'), p_status,
          'Vic', 'vic@example.test', now(), gen_random_uuid(),
          case when p_status = 'cancelled' then now() end, case when p_status = 'cancelled' then 'owner' end)
  returning id into v;
  return v;
end
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00361000000a', 'a-carnet-0036s@test.local'),
  ('00000000-0000-4000-8000-00361000000b', 'b-carnet-0036s@test.local');

insert into platform.project_members (project_id, user_id, role)
  select p.id, u.id, 'user'
    from platform.projects p
   cross join (values ('00000000-0000-4000-8000-00361000000a'::uuid), ('00000000-0000-4000-8000-00361000000b'::uuid)) as u (id)
   where p.slug = 'carnet';

insert into carnet.profiles (id, owner_id, slug, display_name, is_published) values
  ('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-00361000000a', 'ana-0036s', 'Ana', true),
  ('00000000-0000-4000-8000-003610000011', '00000000-0000-4000-8000-00361000000b', 'ben-0036s', 'Ben', true);

-- ---------------------------------------------------------------------------
-- Décision 5 — extension btree_gist
-- ---------------------------------------------------------------------------
select has_extension('extensions', 'btree_gist', 'décision 5 : l''extension btree_gist est installée dans le schéma extensions');

-- ---------------------------------------------------------------------------
-- Décision 1 — profiles.time_zone
-- ---------------------------------------------------------------------------
select has_column('carnet', 'profiles', 'time_zone', 'décision 1 : carnet.profiles.time_zone existe');
select col_type_is('carnet', 'profiles', 'time_zone', 'text', 'décision 1 : time_zone est text');
select col_not_null('carnet', 'profiles', 'time_zone', 'décision 1 : time_zone est not null');
select col_default_is('carnet', 'profiles', 'time_zone', 'Europe/Paris'::text, 'décision 1 : time_zone vaut Europe/Paris par défaut');
select is(
  pg_temp.txt($$select time_zone from carnet.profiles where id = '00000000-0000-4000-8000-003610000010'$$),
  'Europe/Paris',
  'décision 1 : un profil existant reçoit Europe/Paris'
);
select ok(
  coalesce(pg_temp.txt($$select has_column_privilege('authenticated', 'carnet.profiles', 'time_zone', 'UPDATE')::text$$), 'false')::boolean,
  'décision 1 : authenticated a update sur la colonne time_zone'
);
select ok(
  not coalesce(pg_temp.txt($$select has_column_privilege('anon', 'carnet.profiles', 'time_zone', 'UPDATE')::text$$), 'true')::boolean,
  'décision 1 : anon n''a pas update sur time_zone'
);
select ok(
  not exists (select 1 from pg_attribute where attrelid = 'carnet.public_profiles'::regclass and attname = 'time_zone'),
  'décision 1 : public_profiles n''expose pas time_zone (le fuseau public passe par get_public_booking_page)'
);
select lives_ok(
  $$update carnet.profiles set time_zone = 'Asia/Tokyo' where id = '00000000-0000-4000-8000-003610000011'$$,
  'décision 1 : Asia/Tokyo (nom IANA de pg_timezone_names) est accepté'
);
select lives_ok(
  $$update carnet.profiles set time_zone = 'UTC' where id = '00000000-0000-4000-8000-003610000011'$$,
  'décision 1 : UTC est accepté'
);
select throws_ok(
  $$update carnet.profiles set time_zone = 'Mars/Olympus' where id = '00000000-0000-4000-8000-003610000011'$$,
  '23514', null, 'décision 1 : un fuseau inconnu (Mars/Olympus) est refusé en 23514'
);
select throws_ok(
  $$update carnet.profiles set time_zone = 'europe/paris' where id = '00000000-0000-4000-8000-003610000011'$$,
  '23514', null, 'décision 1 : la casse doit être exacte (europe/paris refusé en 23514)'
);
select throws_ok(
  $$update carnet.profiles set time_zone = '+02:00' where id = '00000000-0000-4000-8000-003610000011'$$,
  '23514', null, 'décision 1 : un décalage POSIX (+02:00) n''est pas un nom IANA → 23514'
);
select throws_ok(
  $$update carnet.profiles set time_zone = '' where id = '00000000-0000-4000-8000-003610000011'$$,
  '23514', null, 'décision 1 : une chaîne vide est refusée en 23514'
);

-- Le propriétaire modifie son fuseau ; un autre membre ne touche pas celui d'autrui.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00361000000a","role":"authenticated"}';
select lives_ok(
  $$update carnet.profiles set time_zone = 'America/Sao_Paulo' where id = '00000000-0000-4000-8000-003610000010'$$,
  'décision 1 : A modifie le fuseau de son propre profil'
);
select lives_ok(
  $$update carnet.profiles set time_zone = 'Europe/London' where id = '00000000-0000-4000-8000-003610000011'$$,
  'décision 1 : A tente de modifier le fuseau du profil de B (aucune ligne visible)'
);
reset role;
select is(
  pg_temp.txt($$select string_agg(time_zone, ',' order by slug) from carnet.profiles where slug in ('ana-0036s', 'ben-0036s')$$),
  'America/Sao_Paulo,UTC',
  'décision 1 : le fuseau de A est modifié, celui de B reste celui posé par postgres'
);

-- ---------------------------------------------------------------------------
-- Décision 2 — carnet.event_types (structure)
-- ---------------------------------------------------------------------------
select has_table('carnet', 'event_types', 'décision 2 : la table carnet.event_types existe');
select columns_are('carnet', 'event_types',
  array['id', 'profile_id', 'title', 'duration_min', 'buffer_min', 'min_notice_min', 'location_kind', 'location_text',
        'is_active', 'position', 'created_at'],
  'décision 2 : event_types a exactement les colonnes du contrat');
select col_is_pk('carnet', 'event_types', 'id', 'décision 2 : id est la clé primaire de event_types');
select col_type_is('carnet', 'event_types', 'id', 'uuid', 'décision 2 : event_types.id est uuid');
select col_default_is('carnet', 'event_types', 'id', 'gen_random_uuid()', 'décision 2 : event_types.id par défaut gen_random_uuid()');
select col_type_is('carnet', 'event_types', 'profile_id', 'uuid', 'décision 2 : event_types.profile_id est uuid');
select col_type_is('carnet', 'event_types', 'title', 'text', 'décision 2 : title est text');
select col_type_is('carnet', 'event_types', 'duration_min', 'integer', 'décision 2 : duration_min est integer');
select col_type_is('carnet', 'event_types', 'buffer_min', 'integer', 'décision 2 : buffer_min est integer');
select col_type_is('carnet', 'event_types', 'min_notice_min', 'integer', 'décision 2 : min_notice_min est integer');
select col_type_is('carnet', 'event_types', 'location_kind', 'text', 'décision 2 : location_kind est text');
select col_type_is('carnet', 'event_types', 'location_text', 'text', 'décision 2 : location_text est text');
select col_type_is('carnet', 'event_types', 'is_active', 'boolean', 'décision 2 : is_active est boolean');
select col_type_is('carnet', 'event_types', 'position', 'smallint', 'décision 2 : position est smallint');
select col_type_is('carnet', 'event_types', 'created_at', 'timestamp with time zone', 'décision 2 : created_at est timestamptz');
select is(
  (select array_agg(attname::text order by attname) from pg_attribute
    where attrelid = to_regclass('carnet.event_types') and attnum > 0 and not attisdropped and not attnotnull),
  array['location_text'],
  'décision 2 : seule location_text est nullable dans event_types'
);
select col_default_is('carnet', 'event_types', 'buffer_min', '0', 'décision 2 : buffer_min vaut 0 par défaut');
select col_default_is('carnet', 'event_types', 'min_notice_min', '120', 'décision 2 : min_notice_min vaut 120 (2 h) par défaut');
select col_default_is('carnet', 'event_types', 'is_active', 'true', 'décision 2 : is_active vaut true par défaut');
select col_default_is('carnet', 'event_types', 'created_at', 'now()', 'décision 2 : created_at vaut now() par défaut');
select ok(
  exists (select 1 from pg_constraint c
           where c.conrelid = to_regclass('carnet.event_types') and c.contype = 'f'
             and c.confrelid = 'carnet.profiles'::regclass and c.confdeltype = 'c'),
  'décision 2 : event_types.profile_id référence profiles avec on delete cascade'
);
select col_is_unique('carnet', 'event_types', array['profile_id', 'position'], 'décision 2 : unique (profile_id, position)');
select col_is_unique('carnet', 'event_types', array['id', 'profile_id'], 'décision 5 : unique (id, profile_id), cible de la clé composite de bookings');

-- Décision 2 — contraintes en situation
select lives_ok(
  $$insert into carnet.event_types (id, profile_id, title, duration_min, location_kind, position) values
      ('00000000-0000-4000-8000-0036100000e0', '00000000-0000-4000-8000-003610000010', 'Appel', 30, 'video', 0)$$,
  'décision 2 : un type minimal (titre, durée, lieu, position) est accepté'
);
select is(
  pg_temp.txt($$select row(buffer_min, min_notice_min, is_active, location_text)::text from carnet.event_types
                 where id = '00000000-0000-4000-8000-0036100000e0'$$),
  '(0,120,t,)',
  'décision 2 : valeurs par défaut appliquées (tampon 0, délai 120, actif, sans texte de lieu)'
);
select lives_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, buffer_min, min_notice_min, location_kind, location_text, position) values
      ('00000000-0000-4000-8000-003610000010', 'Bornes basses', 5, 0, 0, 'phone', null, 1),
      ('00000000-0000-4000-8000-003610000010', 'Bornes hautes', 480, 240, 43200, 'in_person', repeat('a', 500), 2)$$,
  'décision 2 : bornes incluses acceptées (durée 5 et 480, tampon 0 et 240, délai 0 et 43 200, lieu 500 caractères)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position) values
      ('00000000-0000-4000-8000-003610000010', 'X', 4, 'video', 3)$$,
  '23514', null, 'décision 2 : durée 4 min refusée (23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position) values
      ('00000000-0000-4000-8000-003610000010', 'X', 481, 'video', 3)$$,
  '23514', null, 'décision 2 : durée 481 min refusée (23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, buffer_min, location_kind, position) values
      ('00000000-0000-4000-8000-003610000010', 'X', 30, -1, 'video', 3)$$,
  '23514', null, 'décision 2 : tampon négatif refusé (23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, buffer_min, location_kind, position) values
      ('00000000-0000-4000-8000-003610000010', 'X', 30, 241, 'video', 3)$$,
  '23514', null, 'décision 2 : tampon 241 min refusé (23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, min_notice_min, location_kind, position) values
      ('00000000-0000-4000-8000-003610000010', 'X', 30, -1, 'video', 3)$$,
  '23514', null, 'décision 2 : délai minimal négatif refusé (23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, min_notice_min, location_kind, position) values
      ('00000000-0000-4000-8000-003610000010', 'X', 30, 43201, 'video', 3)$$,
  '23514', null, 'décision 2 : délai minimal 43 201 min refusé (23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position) values
      ('00000000-0000-4000-8000-003610000010', 'X', 30, 'zoom', 3)$$,
  '23514', null, 'décision 2 : location_kind hors liste (zoom) refusé (23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position) values
      ('00000000-0000-4000-8000-003610000010', '', 30, 'video', 3)$$,
  '23514', null, 'décision 2 : titre vide refusé (23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position) values
      ('00000000-0000-4000-8000-003610000010', '   ', 30, 'video', 3)$$,
  '23514', null, 'décision 2 : titre réduit à des blancs refusé (23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position) values
      ('00000000-0000-4000-8000-003610000010', repeat('a', 81), 30, 'video', 3)$$,
  '23514', null, 'décision 2 : titre de 81 caractères refusé (23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position) values
      ('00000000-0000-4000-8000-003610000010', E'Appel\nlong', 30, 'video', 3)$$,
  '23514', null, 'décision 2 : titre avec saut de ligne refusé (texte simple, 23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position) values
      ('00000000-0000-4000-8000-003610000010', E'Appel​', 30, 'video', 3)$$,
  '23514', null, 'décision 2 : titre avec caractère invisible (U+200B) refusé (23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, location_text, position) values
      ('00000000-0000-4000-8000-003610000010', 'X', 30, 'in_person', repeat('a', 501), 3)$$,
  '23514', null, 'décision 2 : texte de lieu de 501 caractères refusé (23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, location_text, position) values
      ('00000000-0000-4000-8000-003610000010', 'X', 30, 'in_person', '', 3)$$,
  '23514', null, 'décision 2 : texte de lieu vide refusé (null attendu à la place, 23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, location_text, position) values
      ('00000000-0000-4000-8000-003610000010', 'X', 30, 'in_person', E'1 rue\nParis', 3)$$,
  '23514', null, 'décision 2 : texte de lieu avec saut de ligne refusé (23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position) values
      ('00000000-0000-4000-8000-003610000010', 'X', 30, 'video', -1)$$,
  '23514', null, 'décision 2 : position négative refusée (23514)'
);

-- Au plus 10 types par profil : positions 0 à 9 uniques.
select lives_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position)
      select '00000000-0000-4000-8000-003610000010', 'Type ' || g, 30, 'video', g from generate_series(3, 9) g$$,
  'décision 2 : A atteint 10 types (positions 0 à 9)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position) values
      ('00000000-0000-4000-8000-003610000010', 'Onzième', 30, 'video', 10)$$,
  '23514', null, 'décision 2 : un 11e type en position 10 est refusé (23514)'
);
select throws_ok(
  $$insert into carnet.event_types (profile_id, title, duration_min, location_kind, position) values
      ('00000000-0000-4000-8000-003610000010', 'Onzième', 30, 'video', 4)$$,
  '23505', null, 'décision 2 : un 11e type sur une position déjà prise est refusé (23505)'
);
select is(
  pg_temp.txt($$select count(*)::text from carnet.event_types where profile_id = '00000000-0000-4000-8000-003610000010'$$),
  '10',
  'décision 2 : A a exactement 10 types'
);
select lives_ok(
  $$insert into carnet.event_types (id, profile_id, title, duration_min, location_kind, position) values
      ('00000000-0000-4000-8000-0036100000e1', '00000000-0000-4000-8000-003610000011', 'Appel', 60, 'phone', 0)$$,
  'décision 2 : la position 0 reste libre pour un autre profil (unicité par profil)'
);

-- ---------------------------------------------------------------------------
-- Décision 3 — carnet.availability_rules
-- ---------------------------------------------------------------------------
select has_table('carnet', 'availability_rules', 'décision 3 : la table carnet.availability_rules existe');
select columns_are('carnet', 'availability_rules',
  array['id', 'profile_id', 'weekday', 'start_time', 'end_time', 'created_at'],
  'décision 3 : availability_rules a exactement les colonnes du contrat (aucune colonne de fuseau)');
select col_is_pk('carnet', 'availability_rules', 'id', 'décision 3 : id est la clé primaire');
select col_type_is('carnet', 'availability_rules', 'weekday', 'smallint', 'décision 3 : weekday est smallint');
select col_type_is('carnet', 'availability_rules', 'start_time', 'time without time zone', 'décision 3 : start_time est time');
select col_type_is('carnet', 'availability_rules', 'end_time', 'time without time zone', 'décision 3 : end_time est time');
select col_type_is('carnet', 'availability_rules', 'created_at', 'timestamp with time zone', 'décision 3 : created_at est timestamptz');
select ok(
  (select count(*) = 6 from pg_attribute
    where attrelid = to_regclass('carnet.availability_rules') and attnum > 0 and not attisdropped and attnotnull),
  'décision 3 : les 6 colonnes de availability_rules sont not null'
);
select ok(
  exists (select 1 from pg_constraint c
           where c.conrelid = to_regclass('carnet.availability_rules') and c.contype = 'f'
             and c.confrelid = 'carnet.profiles'::regclass and c.confdeltype = 'c'),
  'décision 3 : availability_rules.profile_id référence profiles avec on delete cascade'
);
select ok(
  exists (select 1 from pg_index i
           where i.indrelid = to_regclass('carnet.availability_rules')
             and i.indkey[0] = (select attnum from pg_attribute
                                 where attrelid = to_regclass('carnet.availability_rules') and attname = 'profile_id')),
  'décision 3 : un index commence par availability_rules.profile_id'
);
select lives_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003610000010', 1, '09:00', '12:00'),
      ('00000000-0000-4000-8000-003610000010', 1, '12:00', '14:00'),
      ('00000000-0000-4000-8000-003610000010', 7, '09:00', '12:00')$$,
  'décision 3 : plages contiguës le même jour et jours 1 et 7 acceptés'
);
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003610000010', 0, '09:00', '12:00')$$,
  '23514', null, 'décision 3 : weekday 0 refusé (23514)'
);
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003610000010', 8, '09:00', '12:00')$$,
  '23514', null, 'décision 3 : weekday 8 refusé (23514)'
);
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003610000010', 2, '12:00', '12:00')$$,
  '23514', null, 'décision 3 : start_time = end_time refusé (23514)'
);
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003610000010', 2, '14:00', '09:00')$$,
  '23514', null, 'décision 3 : start_time > end_time refusé (23514)'
);
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003610000010', 1, '11:00', '13:00')$$,
  '23P01', null, 'décision 3 : plage chevauchant deux plages du même jour refusée (exclusion, 23P01)'
);
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003610000010', 1, '10:00', '11:00')$$,
  '23P01', null, 'décision 3 : plage incluse dans une plage existante refusée (23P01)'
);
select lives_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003610000010', 2, '10:00', '11:00'),
      ('00000000-0000-4000-8000-003610000011', 1, '10:00', '11:00')$$,
  'décision 3 : mêmes heures un autre jour ou sur un autre profil acceptées'
);

-- Point 17 — plafonds des règles en base (23514)
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003610000010', 2, '13:00', '13:04')$$,
  '23514', null, 'point 17 : plage de 4 minutes refusée (23514, au moins 5 minutes)'
);
select lives_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003610000010', 2, '13:10', '13:15')$$,
  'point 17 : plage de 5 minutes exactement acceptée'
);
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003610000010', 2, '15:00:30', '16:00')$$,
  '23514', null, 'point 17 : début avec secondes (15:00:30) refusé (23514, heures à la minute)'
);
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003610000010', 2, '17:00', '18:00:30')$$,
  '23514', null, 'point 17 : fin avec secondes (18:00:30) refusée (23514)'
);
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003610000010', 2, '19:00:00.5', '20:00')$$,
  '23514', null, 'point 17 : début avec fraction de seconde refusé (23514)'
);
select lives_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time)
      select '00000000-0000-4000-8000-003610000011', 4, '00:00'::time + make_interval(mins => 10 * g), '00:00'::time + make_interval(mins => 10 * g + 5)
        from generate_series(1, 50 - (select count(*)::int from carnet.availability_rules where profile_id = '00000000-0000-4000-8000-003610000011')) g$$,
  'point 17 : PB complété jusqu''à 50 règles'
);
select is(
  pg_temp.txt($$select count(*)::text from carnet.availability_rules where profile_id = '00000000-0000-4000-8000-003610000011'$$),
  '50',
  'point 17 : PB a exactement 50 règles'
);
select throws_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003610000011', 6, '09:00', '12:00')$$,
  'CN004', null, 'fiche 0038 point 6 : 51e règle d''un profil refusée par le trigger de plafond (CN004, au plus 50)'
);
select lives_ok(
  $$insert into carnet.availability_rules (profile_id, weekday, start_time, end_time) values
      ('00000000-0000-4000-8000-003610000010', 6, '09:00', '12:00')$$,
  'point 17 : le plafond est par profil (PA ajoute encore une règle)'
);

-- ---------------------------------------------------------------------------
-- Décision 4 — carnet.availability_exceptions
-- ---------------------------------------------------------------------------
select has_table('carnet', 'availability_exceptions', 'décision 4 : la table carnet.availability_exceptions existe');
select columns_are('carnet', 'availability_exceptions',
  array['id', 'profile_id', 'range', 'kind', 'created_at'],
  'décision 4 : availability_exceptions a exactement les colonnes du contrat');
select col_is_pk('carnet', 'availability_exceptions', 'id', 'décision 4 : id est la clé primaire');
select col_type_is('carnet', 'availability_exceptions', 'range', 'tstzrange', 'décision 4 : range est tstzrange');
select col_type_is('carnet', 'availability_exceptions', 'kind', 'text', 'décision 4 : kind est text');
select ok(
  (select count(*) = 5 from pg_attribute
    where attrelid = to_regclass('carnet.availability_exceptions') and attnum > 0 and not attisdropped and attnotnull),
  'décision 4 : les 5 colonnes de availability_exceptions sont not null'
);
select ok(
  exists (select 1 from pg_constraint c
           where c.conrelid = to_regclass('carnet.availability_exceptions') and c.contype = 'f'
             and c.confrelid = 'carnet.profiles'::regclass and c.confdeltype = 'c'),
  'décision 4 : availability_exceptions.profile_id référence profiles avec on delete cascade'
);
select ok(
  exists (select 1 from pg_index i
           where i.indrelid = to_regclass('carnet.availability_exceptions')
             and i.indkey[0] = (select attnum from pg_attribute
                                 where attrelid = to_regclass('carnet.availability_exceptions') and attname = 'profile_id')),
  'décision 4 : un index commence par availability_exceptions.profile_id'
);
select lives_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-003610000010', tstzrange('2027-03-05 13:00Z', '2027-03-05 14:00Z'), 'busy'),
      ('00000000-0000-4000-8000-003610000010', tstzrange('2027-03-05 13:30Z', '2027-03-05 15:00Z'), 'extra')$$,
  'décision 4 : exceptions busy et extra acceptées (le chevauchement entre exceptions est permis)'
);
select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-003610000010', tstzrange('2027-03-05 13:00Z', '2027-03-05 13:00Z'), 'busy')$$,
  '23514', null, 'décision 4 : plage vide refusée (23514)'
);
select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-003610000010', tstzrange('2027-03-05 13:00Z', null), 'busy')$$,
  '23514', null, 'décision 4 : plage sans borne supérieure refusée (23514)'
);
select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-003610000010', tstzrange(null, '2027-03-05 13:00Z'), 'busy')$$,
  '23514', null, 'décision 4 : plage sans borne inférieure refusée (23514)'
);
select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-003610000010', tstzrange('2027-03-05 13:00Z', '2027-03-05 14:00Z'), 'holiday')$$,
  '23514', null, 'décision 4 : kind hors liste (holiday) refusé (23514)'
);

-- Point 17 — bornes à la minute et plafond de 200 exceptions à venir (23514)
select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-003610000010', tstzrange('2027-03-05 16:00:30Z', '2027-03-05 17:00Z'), 'busy')$$,
  '23514', null, 'point 17 : borne inférieure avec secondes refusée (23514, bornes à la minute)'
);
select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-003610000010', tstzrange('2027-03-05 18:00Z', '2027-03-05 19:00:30Z'), 'busy')$$,
  '23514', null, 'point 17 : borne supérieure avec secondes refusée (23514)'
);
select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-003610000010', tstzrange('2027-03-05 20:00:00.000001Z', '2027-03-05 21:00Z'), 'extra')$$,
  '23514', null, 'point 17 : borne avec microsecondes refusée (23514)'
);
select lives_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind)
      select '00000000-0000-4000-8000-003610000011',
             tstzrange(date_trunc('minute', now()) + interval '1 day' + make_interval(hours => g),
                       date_trunc('minute', now()) + interval '1 day' + make_interval(hours => g, mins => 30)), 'busy'
        from generate_series(1, 200 - (select count(*)::int from carnet.availability_exceptions
                                        where profile_id = '00000000-0000-4000-8000-003610000011' and upper(range) > now())) g$$,
  'point 17 : PB complété jusqu''à 200 exceptions à venir'
);
select is(
  pg_temp.txt($$select count(*)::text from carnet.availability_exceptions where profile_id = '00000000-0000-4000-8000-003610000011' and upper(range) > now()$$),
  '200',
  'point 17 : PB a exactement 200 exceptions à venir'
);
select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-003610000011', tstzrange(date_trunc('minute', now()) + interval '30 days', date_trunc('minute', now()) + interval '30 days 1 hour'), 'extra')$$,
  'CN004', null, 'fiche 0038 point 6 : 201e exception à venir d''un profil refusée par le trigger de plafond (CN004, au plus 200)'
);
select throws_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-003610000010', tstzrange(date_trunc('minute', now()) - interval '3 days', date_trunc('minute', now()) - interval '2 days'), 'busy')$$,
  '23514', null, 'fiche 0038 décision 4 : une exception déjà terminée (upper(range) <= now()) est refusée à l''insertion (23514)'
);
select throws_ok(
  $$update carnet.availability_exceptions
       set range = tstzrange(date_trunc('minute', now()) - interval '3 days', date_trunc('minute', now()) - interval '2 days')
     where id = (select id from carnet.availability_exceptions
                  where profile_id = '00000000-0000-4000-8000-003610000010' and upper(range) > now()
                  order by lower(range) limit 1)$$,
  '23514', null, 'fiche 0038 décision 4 : modifier une exception pour la rendre terminée est refusé (23514)'
);
select lives_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-003610000010', tstzrange(date_trunc('minute', now()) - interval '1 hour', date_trunc('minute', now()) + interval '1 hour'), 'busy')$$,
  'fiche 0038 décision 4 : une exception en cours (début passé, fin à venir) reste acceptée'
);
select lives_ok(
  $$insert into carnet.availability_exceptions (profile_id, range, kind) values
      ('00000000-0000-4000-8000-003610000010', tstzrange(date_trunc('minute', now()) + interval '30 days', date_trunc('minute', now()) + interval '30 days 1 hour'), 'extra')$$,
  'point 17 : le plafond est par profil (PA ajoute encore une exception à venir)'
);

-- ---------------------------------------------------------------------------
-- Décision 5 — carnet.bookings (structure)
-- ---------------------------------------------------------------------------
select has_table('carnet', 'bookings', 'décision 5 : la table carnet.bookings existe');
select columns_are('carnet', 'bookings',
  array['id', 'profile_id', 'event_type_id', 'range', 'status', 'visitor_name', 'visitor_email', 'visitor_phone',
        'message', 'consent_at', 'idempotency_key', 'cancelled_at', 'cancelled_by',
        'rescheduled_from', 'reminder_queued_at', 'created_at'],
  'décision 5 et point 14 : bookings a exactement les colonnes du contrat (aucune colonne de jeton, ni clair ni haché)');
select col_is_pk('carnet', 'bookings', 'id', 'décision 5 : id est la clé primaire de bookings');
select col_default_is('carnet', 'bookings', 'id', 'gen_random_uuid()', 'décision 5 : bookings.id par défaut gen_random_uuid()');
select col_type_is('carnet', 'bookings', 'range', 'tstzrange', 'décision 5 : range est tstzrange');
select col_type_is('carnet', 'bookings', 'status', 'text', 'décision 5 : status est text');
select col_default_is('carnet', 'bookings', 'status', 'confirmed'::text, 'décision 5 : status vaut confirmed par défaut');
select col_type_is('carnet', 'bookings', 'consent_at', 'timestamp with time zone', 'décision 5 : consent_at est timestamptz');
select col_type_is('carnet', 'bookings', 'idempotency_key', 'uuid', 'décision 5 : idempotency_key est uuid');
select col_type_is('carnet', 'bookings', 'cancelled_at', 'timestamp with time zone', 'décision 5 : cancelled_at est timestamptz');
select col_type_is('carnet', 'bookings', 'cancelled_by', 'text', 'décision 5 : cancelled_by est text');
select col_type_is('carnet', 'bookings', 'rescheduled_from', 'uuid', 'décision 5 : rescheduled_from est uuid');
select col_type_is('carnet', 'bookings', 'reminder_queued_at', 'timestamp with time zone', 'décision 8 : reminder_queued_at est timestamptz');
select col_type_is('carnet', 'bookings', 'created_at', 'timestamp with time zone', 'décision 5 : created_at est timestamptz');
select col_default_is('carnet', 'bookings', 'created_at', 'now()', 'décision 5 : created_at vaut now() par défaut');
select is(
  (select array_agg(attname::text order by attname) from pg_attribute
    where attrelid = to_regclass('carnet.bookings') and attnum > 0 and not attisdropped and not attnotnull),
  array['cancelled_at', 'cancelled_by', 'message', 'reminder_queued_at', 'rescheduled_from', 'visitor_phone'],
  'décision 5 : seules visitor_phone, message, cancelled_at, cancelled_by, rescheduled_from, reminder_queued_at sont nullables'
);
select col_is_unique('carnet', 'bookings', array['profile_id', 'idempotency_key'], 'décision 5 : unique (profile_id, idempotency_key)');
select ok(
  exists (select 1 from pg_constraint c
           where c.conrelid = to_regclass('carnet.bookings') and c.contype = 'f'
             and c.confrelid = 'carnet.profiles'::regclass and c.confdeltype = 'c'),
  'décision 5 : bookings.profile_id référence profiles avec on delete cascade'
);
select ok(
  exists (select 1 from pg_constraint c
           where c.conrelid = to_regclass('carnet.bookings') and c.contype = 'f'
             and c.confrelid = to_regclass('carnet.event_types') and c.confdeltype = 'a'
             and array_length(c.conkey, 1) = 2),
  'décision 5 : (event_type_id, profile_id) référence event_types (id, profile_id), on delete no action'
);
select ok(
  exists (select 1 from pg_constraint c
           where c.conrelid = to_regclass('carnet.bookings') and c.contype = 'f'
             and c.confrelid = to_regclass('carnet.bookings') and c.confdeltype = 'n'),
  'décision 5 : rescheduled_from référence bookings avec on delete set null'
);
select ok(
  exists (select 1 from pg_index i
           where i.indrelid = to_regclass('carnet.bookings')
             and i.indkey[0] = (select attnum from pg_attribute where attrelid = to_regclass('carnet.bookings') and attname = 'event_type_id')),
  'décision 5 : un index commence par bookings.event_type_id (clé étrangère)'
);
select ok(
  exists (select 1 from pg_index i
           where i.indrelid = to_regclass('carnet.bookings')
             and i.indkey[0] = (select attnum from pg_attribute where attrelid = to_regclass('carnet.bookings') and attname = 'rescheduled_from')),
  'décision 5 : un index commence par bookings.rescheduled_from (clé étrangère)'
);
select ok(
  exists (select 1 from pg_constraint c
           join pg_am am on am.oid = (select relam from pg_class where oid = c.conindid)
          where c.conrelid = to_regclass('carnet.bookings') and c.contype = 'x' and am.amname = 'gist'
            and pg_get_constraintdef(c.oid) ~ 'profile_id WITH =' and pg_get_constraintdef(c.oid) ~ 'range WITH &&'
            and pg_get_constraintdef(c.oid) ~ 'confirmed'),
  'décision 5 : contrainte d''exclusion gist (profile_id =, range &&) limitée aux réservations confirmées'
);

-- Décision 5 — contraintes en situation (postgres)
select lives_ok(
  $$insert into carnet.event_types (id, profile_id, title, duration_min, location_kind, position) values
      ('00000000-0000-4000-8000-0036100000e2', '00000000-0000-4000-8000-003610000011', 'Visio', 30, 'video', 1)$$,
  'fixture : type e2 sur le profil de B'
);
select lives_ok(
  $$select set_config('t0036s.b1', pg_temp.raw_booking('00000000-0000-4000-8000-003610000010',
      '00000000-0000-4000-8000-0036100000e0', '2027-03-03 08:00Z', 30)::text, true)$$,
  'critère 1 : une réservation confirmée est insérée (postgres)'
);
select throws_ok(
  $$select pg_temp.raw_booking('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0', '2027-03-03 08:15Z', 30)$$,
  '23P01', null, 'critère 1 : une réservation confirmée chevauchante du même profil est refusée en base (23P01)'
);
select throws_ok(
  $$select pg_temp.raw_booking('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0', '2027-03-03 07:00Z', 120)$$,
  '23P01', null, 'critère 1 : une réservation englobante est refusée (23P01)'
);
select lives_ok(
  $$select pg_temp.raw_booking('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0', '2027-03-03 08:30Z', 30)$$,
  'critère 1 : une réservation contiguë ([) : fin = début) est acceptée par la contrainte'
);
select lives_ok(
  $$select set_config('t0036s.bc', pg_temp.raw_booking('00000000-0000-4000-8000-003610000010',
      '00000000-0000-4000-8000-0036100000e0', '2027-03-03 08:00Z', 30, 'cancelled')::text, true)$$,
  'critère 1 : une réservation annulée sur la même plage est acceptée (exclusion limitée à confirmed)'
);
select throws_ok(
  $$update carnet.bookings set status = 'confirmed', cancelled_at = null, cancelled_by = null
     where id = current_setting('t0036s.bc', true)::uuid$$,
  '23P01', null, 'critère 1 : repasser l''annulée en confirmed sur une plage occupée est refusé (23P01)'
);
select lives_ok(
  $$select set_config('t0036s.bb', pg_temp.raw_booking('00000000-0000-4000-8000-003610000011',
      '00000000-0000-4000-8000-0036100000e2', '2027-03-03 08:00Z', 30)::text, true)$$,
  'critère 1 : la même plage sur un autre profil est acceptée (exclusion par profil)'
);
select throws_ok(
  $$select pg_temp.raw_booking('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e2', '2027-03-04 08:00Z', 30)$$,
  '23503', null, 'décision 5 : un type d''un autre profil est refusé (clé composite, 23503)'
);
select throws_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, consent_at, idempotency_key)
    values ('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0',
            tstzrange('2027-03-04 08:00Z', '2027-03-04 08:00Z'), 'Vic', 'vic@example.test', now(),
            gen_random_uuid())$$,
  '23514', null, 'décision 5 : plage vide refusée (23514)'
);
select throws_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, consent_at, idempotency_key)
    values ('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0',
            tstzrange('2027-03-04 08:00Z', null), 'Vic', 'vic@example.test', now(), gen_random_uuid())$$,
  '23514', null, 'décision 5 : plage non bornée refusée (23514)'
);
select throws_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, consent_at, idempotency_key)
    values ('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0',
            tstzrange('2027-03-04 08:00Z', '2027-03-04 08:30Z', '[]'), 'Vic', 'vic@example.test', now(), gen_random_uuid())$$,
  '23514', null, 'décision 5 : plage fermée à droite refusée (forme [) imposée, 23514)'
);
select throws_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, status, visitor_name, visitor_email, consent_at, idempotency_key)
    values ('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0',
            tstzrange('2027-03-04 08:00Z', '2027-03-04 08:30Z'), 'pending', 'Vic', 'vic@example.test', now(), gen_random_uuid())$$,
  '23514', null, 'décision 5 : status hors liste (pending) refusé (23514)'
);
select throws_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, status, visitor_name, visitor_email, consent_at, idempotency_key)
    values ('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0',
            tstzrange('2027-03-04 08:00Z', '2027-03-04 08:30Z'), 'cancelled', 'Vic', 'vic@example.test', now(), gen_random_uuid())$$,
  '23514', null, 'décision 5 : cancelled sans cancelled_at ni cancelled_by refusé (23514)'
);
select throws_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, consent_at, idempotency_key, cancelled_at, cancelled_by)
    values ('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0',
            tstzrange('2027-03-04 09:00Z', '2027-03-04 09:30Z'), 'Vic', 'vic@example.test', now(), gen_random_uuid(), now(), 'owner')$$,
  '23514', null, 'décision 5 : confirmed avec cancelled_at refusé (23514)'
);
select throws_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, status, visitor_name, visitor_email, consent_at, idempotency_key, cancelled_at, cancelled_by)
    values ('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0',
            tstzrange('2027-03-04 10:00Z', '2027-03-04 10:30Z'), 'cancelled', 'Vic', 'vic@example.test', now(), gen_random_uuid(), now(), 'admin')$$,
  '23514', null, 'décision 5 : cancelled_by hors liste (admin) refusé (23514)'
);
select throws_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, consent_at, idempotency_key)
    values ('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0',
            tstzrange('2027-03-04 12:00Z', '2027-03-04 12:30Z'), '  ', 'vic@example.test', now(), gen_random_uuid())$$,
  '23514', null, 'décision 5 : nom du visiteur blanc refusé (23514)'
);
select throws_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, consent_at, idempotency_key)
    values ('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0',
            tstzrange('2027-03-04 12:00Z', '2027-03-04 12:30Z'), repeat('a', 101), 'vic@example.test', now(), gen_random_uuid())$$,
  '23514', null, 'décision 5 : nom du visiteur de 101 caractères refusé (23514)'
);
select throws_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, consent_at, idempotency_key)
    values ('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0',
            tstzrange('2027-03-04 12:00Z', '2027-03-04 12:30Z'), 'Vic', 'vic example.test', now(), gen_random_uuid())$$,
  '23514', null, 'décision 5 : e-mail du visiteur invalide refusé (23514)'
);
select throws_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, visitor_phone, consent_at, idempotency_key)
    values ('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0',
            tstzrange('2027-03-04 12:00Z', '2027-03-04 12:30Z'), 'Vic', 'vic@example.test', 'appelez-moi', now(), gen_random_uuid())$$,
  '23514', null, 'décision 5 : téléphone du visiteur au format invalide refusé (23514)'
);
select throws_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, message, consent_at, idempotency_key)
    values ('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0',
            tstzrange('2027-03-04 12:00Z', '2027-03-04 12:30Z'), 'Vic', 'vic@example.test', repeat('a', 2001), now(), gen_random_uuid())$$,
  '23514', null, 'décision 5 : message de 2001 caractères refusé (23514)'
);
select lives_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, visitor_phone, message, consent_at, idempotency_key)
    values ('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0',
            tstzrange('2027-03-04 12:00Z', '2027-03-04 12:30Z'), 'Vic', 'vic@example.test', '+33 6 12 34 56 78', E'Bonjour,\nà bientôt',
            now(), '00000000-0000-4000-8000-0036100000a1')$$,
  'décision 5 : téléphone et message multiligne valides acceptés'
);
select throws_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, consent_at, idempotency_key)
    values ('00000000-0000-4000-8000-003610000010', '00000000-0000-4000-8000-0036100000e0',
            tstzrange('2027-03-04 13:00Z', '2027-03-04 13:30Z'), 'Vic', 'vic@example.test', now(), '00000000-0000-4000-8000-0036100000a1')$$,
  '23505', null, 'décision 5 : la même clé d''idempotence sur le même profil est refusée (23505)'
);
select lives_ok(
  $$insert into carnet.bookings (profile_id, event_type_id, range, visitor_name, visitor_email, consent_at, idempotency_key)
    values ('00000000-0000-4000-8000-003610000011', '00000000-0000-4000-8000-0036100000e2',
            tstzrange('2027-03-04 13:00Z', '2027-03-04 13:30Z'), 'Vic', 'vic@example.test', now(), '00000000-0000-4000-8000-0036100000a1')$$,
  'décision 5 : la même clé d''idempotence sur un autre profil est acceptée'
);

-- ---------------------------------------------------------------------------
-- Point 14 — carnet.booking_tokens (plusieurs jetons valides par réservation)
-- ---------------------------------------------------------------------------
select has_table('carnet', 'booking_tokens', 'point 14 : la table carnet.booking_tokens existe');
select columns_are('carnet', 'booking_tokens', array['token_hash', 'booking_id', 'created_at'],
  'point 14 : booking_tokens a exactement token_hash, booking_id, created_at');
select col_is_pk('carnet', 'booking_tokens', 'token_hash', 'point 14 : token_hash est la clé primaire (hachage unique)');
select col_type_is('carnet', 'booking_tokens', 'token_hash', 'bytea', 'point 14 : token_hash est bytea (SHA-256)');
select col_type_is('carnet', 'booking_tokens', 'booking_id', 'uuid', 'point 14 : booking_id est uuid');
select col_type_is('carnet', 'booking_tokens', 'created_at', 'timestamp with time zone', 'point 14 : created_at est timestamptz');
select col_default_is('carnet', 'booking_tokens', 'created_at', 'now()', 'point 14 : created_at vaut now() par défaut');
select ok(
  (select count(*) = 3 from pg_attribute
    where attrelid = to_regclass('carnet.booking_tokens') and attnum > 0 and not attisdropped and attnotnull),
  'point 14 : les 3 colonnes de booking_tokens sont not null'
);
select ok(
  exists (select 1 from pg_constraint c
           where c.conrelid = to_regclass('carnet.booking_tokens') and c.contype = 'f'
             and c.confrelid = to_regclass('carnet.bookings') and c.confdeltype = 'c'),
  'point 14 : booking_tokens.booking_id référence bookings avec on delete cascade (purgés avec la réservation)'
);
select ok(
  exists (select 1 from pg_index i
           where i.indrelid = to_regclass('carnet.booking_tokens')
             and i.indkey[0] = (select attnum from pg_attribute where attrelid = to_regclass('carnet.booking_tokens') and attname = 'booking_id')),
  'point 14 : un index commence par booking_tokens.booking_id (clé étrangère)'
);
select lives_ok(
  $$insert into carnet.booking_tokens (token_hash, booking_id) values
      (sha256(convert_to(repeat('1', 64), 'UTF8')), current_setting('t0036s.b1', true)::uuid),
      (sha256(convert_to(repeat('2', 64), 'UTF8')), current_setting('t0036s.b1', true)::uuid),
      (sha256(convert_to(repeat('3', 64), 'UTF8')), current_setting('t0036s.bb', true)::uuid)$$,
  'point 14 : deux jetons pour la même réservation b1 (et un pour la réservation de B) acceptés'
);
select throws_ok(
  $$insert into carnet.booking_tokens (token_hash, booking_id)
      values (sha256(convert_to(repeat('1', 64), 'UTF8')), current_setting('t0036s.bc', true)::uuid)$$,
  '23505', null, 'point 14 : le même hachage est refusé, même pour une autre réservation (23505)'
);
select throws_ok(
  $$insert into carnet.booking_tokens (token_hash, booking_id) values ('\x0102'::bytea, current_setting('t0036s.b1', true)::uuid)$$,
  '23514', null, 'point 14 : un hachage qui n''a pas 32 octets est refusé (23514)'
);
select throws_ok(
  $$insert into carnet.booking_tokens (token_hash, booking_id)
      values (sha256(convert_to(repeat('4', 64), 'UTF8')), '00000000-0000-4000-8000-0036100000ff')$$,
  '23503', null, 'point 14 : un jeton d''une réservation inconnue est refusé (23503)'
);
select is(
  pg_temp.txt($$select count(*)::text from carnet.booking_tokens where booking_id = current_setting('t0036s.b1', true)::uuid$$),
  '2',
  'point 14 : b1 porte deux jetons'
);

select throws_ok(
  $$delete from carnet.event_types where id = '00000000-0000-4000-8000-0036100000e0'$$,
  '23503', null, 'décision 5 : un type ayant des réservations ne peut pas être supprimé (23503 ; il se désactive)'
);
select lives_ok(
  $$delete from carnet.profiles where id = '00000000-0000-4000-8000-003610000011'$$,
  'suppression de compte (0023) : supprimer un profil emporte ses types, règles, exceptions et réservations sans erreur'
);
select is(
  pg_temp.txt($$select (select count(*) from carnet.event_types where profile_id = '00000000-0000-4000-8000-003610000011')
                     + (select count(*) from carnet.availability_rules where profile_id = '00000000-0000-4000-8000-003610000011')
                     + (select count(*) from carnet.bookings where profile_id = '00000000-0000-4000-8000-003610000011')
                     + (select count(*) from carnet.booking_tokens where booking_id = current_setting('t0036s.bb', true)::uuid)$$),
  '0',
  'suppression de compte (0023) : aucune ligne du profil supprimé ne subsiste (jetons compris)'
);

-- ---------------------------------------------------------------------------
-- Décision 6 — RLS et privilèges (déclaratif)
-- ---------------------------------------------------------------------------
select ok(
  coalesce((select bool_and(relrowsecurity and relforcerowsecurity) and count(*) = 4 from pg_class
             where oid in (to_regclass('carnet.event_types'), to_regclass('carnet.availability_rules'),
                           to_regclass('carnet.availability_exceptions'), to_regclass('carnet.bookings'))), false),
  'décision 6 : RLS activée et forcée sur les 4 tables'
);
select is(
  (select array_agg(distinct cmd::text order by cmd::text) from pg_policies where schemaname = 'carnet' and tablename = 'event_types'),
  array['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  'décision 6 : event_types a une politique par opération (aucune for all)'
);
select is(
  (select array_agg(distinct cmd::text order by cmd::text) from pg_policies where schemaname = 'carnet' and tablename = 'availability_rules'),
  array['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  'décision 6 : availability_rules a une politique par opération'
);
select is(
  (select array_agg(distinct cmd::text order by cmd::text) from pg_policies where schemaname = 'carnet' and tablename = 'availability_exceptions'),
  array['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  'décision 6 : availability_exceptions a une politique par opération'
);
select is(
  (select array_agg(distinct cmd::text order by cmd::text) from pg_policies where schemaname = 'carnet' and tablename = 'bookings'),
  array['SELECT'],
  'décision 6 : bookings n''a qu''une politique select'
);
select is(
  (select count(*) from pg_policies
    where schemaname = 'carnet' and tablename in ('event_types', 'availability_rules', 'availability_exceptions', 'bookings')
      and roles && array['anon', 'public']::name[]),
  0::bigint,
  'décision 6 : aucune politique des 4 tables ne vise anon ni public'
);
select is(
  (select count(*) from pg_policies
    where schemaname = 'carnet' and tablename in ('event_types', 'availability_rules', 'availability_exceptions', 'bookings')
      and not (coalesce(qual, '') || coalesce(with_check, '') ~ 'can_edit_profile'
               and coalesce(qual, '') || coalesce(with_check, '') ~ 'is_member')),
  0::bigint,
  'décision 6 : toutes les politiques passent par is_member et can_edit_profile'
);
select is(
  (select count(*) from pg_policies
    where schemaname = 'carnet' and tablename in ('event_types', 'availability_rules', 'availability_exceptions', 'bookings')),
  13::bigint,
  'décision 6 : 13 politiques au total (4 + 4 + 4 + 1)'
);
select table_privs_are('carnet', 'event_types', 'authenticated', array['DELETE', 'INSERT', 'SELECT'],
  'décision 6 et point 18 : authenticated a select, insert, delete sur event_types (update par colonne seulement)');
select table_privs_are('carnet', 'availability_rules', 'authenticated', array['DELETE', 'INSERT', 'SELECT'],
  'décision 6 et point 18 : authenticated a select, insert, delete sur availability_rules (update par colonne seulement)');
select table_privs_are('carnet', 'availability_exceptions', 'authenticated', array['DELETE', 'INSERT', 'SELECT'],
  'décision 6 et point 18 : authenticated a select, insert, delete sur availability_exceptions (update par colonne seulement)');
select is(
  (select string_agg(c || '=' || has_column_privilege('authenticated', 'carnet.event_types', c, 'UPDATE')::text, ',' order by c)
     from unnest(array['id', 'profile_id', 'title', 'duration_min', 'buffer_min', 'min_notice_min', 'location_kind',
                       'location_text', 'is_active', 'position', 'created_at']) c),
  'buffer_min=true,created_at=false,duration_min=true,id=false,is_active=true,location_kind=true,location_text=true,'
  || 'min_notice_min=true,position=true,profile_id=false,title=true',
  'point 18 : update de event_types par colonne (champs métier ; ni id, ni profile_id, ni created_at)'
);
select is(
  (select string_agg(c || '=' || has_column_privilege('authenticated', 'carnet.availability_rules', c, 'UPDATE')::text, ',' order by c)
     from unnest(array['id', 'profile_id', 'weekday', 'start_time', 'end_time', 'created_at']) c),
  'created_at=false,end_time=true,id=false,profile_id=false,start_time=true,weekday=true',
  'point 18 : update de availability_rules par colonne (weekday, start_time, end_time)'
);
select is(
  (select string_agg(c || '=' || has_column_privilege('authenticated', 'carnet.availability_exceptions', c, 'UPDATE')::text, ',' order by c)
     from unnest(array['id', 'profile_id', 'range', 'kind', 'created_at']) c),
  'created_at=false,id=false,kind=true,profile_id=false,range=true',
  'point 18 : update de availability_exceptions par colonne (range, kind)'
);
select table_privs_are('carnet', 'bookings', 'authenticated', array['SELECT'],
  'décision 6 : authenticated n''a que select sur bookings');
select ok(
  case when to_regclass('carnet.bookings') is null then false
       else not has_any_column_privilege('authenticated', 'carnet.bookings', 'UPDATE')
        and not has_any_column_privilege('authenticated', 'carnet.bookings', 'INSERT') end,
  'décision 6 : authenticated n''a ni insert ni update, même par colonne, sur bookings'
);
select table_privs_are('carnet', 'event_types', 'anon', '{}'::name[], 'critère 4 : anon n''a aucun privilège sur event_types');
select table_privs_are('carnet', 'availability_rules', 'anon', '{}'::name[], 'critère 4 : anon n''a aucun privilège sur availability_rules');
select table_privs_are('carnet', 'availability_exceptions', 'anon', '{}'::name[], 'critère 4 : anon n''a aucun privilège sur availability_exceptions');
select table_privs_are('carnet', 'bookings', 'anon', '{}'::name[], 'critère 4 : anon n''a aucun privilège sur bookings');
select ok(
  case when to_regclass('carnet.bookings') is null then false
       else not has_any_column_privilege('anon', 'carnet.bookings', 'SELECT') end,
  'critère 4 : anon ne lit aucune colonne de bookings'
);
select ok(
  coalesce((select relrowsecurity and relforcerowsecurity from pg_class where oid = to_regclass('carnet.booking_tokens')), false),
  'point 14 : RLS activée et forcée sur booking_tokens'
);
select is(
  (select count(*) from pg_policies where schemaname = 'carnet' and tablename = 'booking_tokens'),
  0::bigint,
  'point 14 : aucune politique sur booking_tokens (accès par fonctions security definer)'
);
select table_privs_are('carnet', 'booking_tokens', 'authenticated', '{}'::name[], 'point 14 : authenticated n''a aucun privilège sur booking_tokens');
select table_privs_are('carnet', 'booking_tokens', 'anon', '{}'::name[], 'point 14 : anon n''a aucun privilège sur booking_tokens');

-- ---------------------------------------------------------------------------
-- Décision 9 — types d'outbox
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into carnet.outbox (type, profile_id, payload)
      select t, '00000000-0000-4000-8000-003610000010', '{}'::jsonb
        from unnest(array['lead.created', 'booking.confirmed', 'booking.cancelled', 'booking.rescheduled', 'booking.reminder']) t$$,
  'décision 9 : outbox accepte lead.created et les 4 types booking.*'
);
select throws_ok(
  $$insert into carnet.outbox (type, profile_id, payload) values ('booking.created', '00000000-0000-4000-8000-003610000010', '{}')$$,
  '23514', null, 'décision 9 : un autre type (booking.created) reste refusé (23514)'
);

-- ---------------------------------------------------------------------------
-- Décision 10 — métriques
-- ---------------------------------------------------------------------------
select ok(
  carnet.is_valid_analytics_metric('booking_viewed') and carnet.is_valid_analytics_metric('booking_started')
  and carnet.is_valid_analytics_metric('booking_confirmed'),
  'décision 10 : booking_viewed, booking_started, booking_confirmed sont des métriques valides'
);
select ok(
  (select bool_and(carnet.is_valid_analytics_metric(m)) from unnest(array['profile_view', 'nfc_scan', 'qr_scan',
     'vcard_download', 'link_click', 'contact_click', 'lead_submitted']) m),
  'décision 10 : les 7 métriques existantes restent valides'
);
select ok(
  not carnet.is_valid_analytics_metric('booking_cancelled') and not carnet.is_valid_analytics_metric(null),
  'décision 10 : aucune autre métrique (booking_cancelled, null) n''est acceptée'
);

-- ---------------------------------------------------------------------------
-- Décisions 6 à 11 — fonctions : existence, propriétés, droits
-- ---------------------------------------------------------------------------
select has_function('carnet', 'get_public_booking_page', array['text'], 'décision 6 : get_public_booking_page(text) existe');
select has_function('carnet', 'get_public_busy_ranges', array['text', 'timestamp with time zone', 'timestamp with time zone'],
  'décision 6 : get_public_busy_ranges(text, timestamptz, timestamptz) existe');
select has_function('carnet', 'book_slot',
  array['text', 'uuid', 'timestamp with time zone', 'text', 'text', 'text', 'text', 'uuid', 'text'],
  'décision 7 : book_slot(slug, type, début, nom, e-mail, téléphone, message, clé, appareil) existe (pas de fin : durée imposée)');
select has_function('carnet', 'book_slot_at',
  array['text', 'uuid', 'timestamp with time zone', 'text', 'text', 'text', 'text', 'uuid', 'text', 'timestamp with time zone'],
  'décision 7 : book_slot_at(…, p_now) existe (horloge injectée)');
select has_function('carnet', 'cancel_booking_by_token', array['text'], 'décision 7 : cancel_booking_by_token(text) existe');
select has_function('carnet', 'cancel_booking_by_token_at', array['text', 'timestamp with time zone'], 'décision 7 : cancel_booking_by_token_at(text, timestamptz) existe');
select has_function('carnet', 'reschedule_booking_by_token', array['text', 'timestamp with time zone', 'uuid'],
  'décision 7 : reschedule_booking_by_token(text, timestamptz, uuid) existe');
select has_function('carnet', 'reschedule_booking_by_token_at', array['text', 'timestamp with time zone', 'uuid', 'timestamp with time zone'],
  'décision 7 : reschedule_booking_by_token_at(text, timestamptz, uuid, timestamptz) existe');
select has_function('carnet', 'cancel_own_booking', array['uuid'], 'décision 7 : cancel_own_booking(uuid) existe');
select has_function('carnet', 'queue_booking_reminders', '{}'::name[], 'décision 8 : queue_booking_reminders() existe');
select has_function('carnet', 'purge_bookings', array['interval'], 'décision 11 : purge_bookings(interval) existe');
select has_function('carnet', 'get_booking_by_token', array['text'], 'point 15 : get_booking_by_token(text) existe');
select has_function('carnet', 'get_booking_by_token_at', array['text', 'timestamp with time zone'],
  'point 15 : get_booking_by_token_at(text, timestamptz) existe (horloge injectée)');
select has_function('carnet', 'claim_booking_outbox', array['integer'], 'point 15 : claim_booking_outbox(integer) existe');
select has_function('carnet', 'hash_booking_token', array['text'], 'point 18 : hash_booking_token(text) existe');
select has_function('carnet', 'lock_profile_bookings', array['uuid'], 'point 18 : lock_profile_bookings(uuid) existe');
select is(
  (select string_agg(p.proname || ':' || p.provolatile::text || ':' || coalesce(p.proconfig @> array['search_path=""'], false)::text
                     || ':' || pg_get_function_result(p.oid), ',' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'carnet' and p.proname in ('hash_booking_token', 'lock_profile_bookings')),
  'hash_booking_token:i:true:bytea,lock_profile_bookings:v:true:void',
  'point 18 : hash_booking_token immutable renvoie bytea, lock_profile_bookings volatile renvoie void ; search_path = '''''
);
select is(
  pg_temp.txt($$select (carnet.hash_booking_token(repeat('ab', 32)) = sha256(convert_to(repeat('ab', 32), 'UTF8')))::text$$),
  'true',
  'point 18 : hash_booking_token(t) = sha256(convert_to(t, ''UTF8''))'
);
select lives_ok(
  $$select carnet.lock_profile_bookings('00000000-0000-4000-8000-003610000010')$$,
  'point 18 : lock_profile_bookings s''exécute dans une transaction (verrou transactionnel)'
);
select is(
  (select string_agg(p.proname || '=' || (has_function_privilege('anon', p.oid, 'EXECUTE')
                                         or has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text, ',' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'carnet' and p.proname in ('hash_booking_token', 'lock_profile_bookings')),
  'hash_booking_token=false,lock_profile_bookings=false',
  'point 18 : hash_booking_token et lock_profile_bookings exécutables ni par anon ni par authenticated'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'carnet'
      and p.proname in ('get_public_booking_page', 'get_public_busy_ranges', 'book_slot', 'book_slot_at',
                        'cancel_booking_by_token', 'cancel_booking_by_token_at', 'reschedule_booking_by_token',
                        'reschedule_booking_by_token_at', 'cancel_own_booking', 'queue_booking_reminders', 'purge_bookings',
                        'get_booking_by_token', 'get_booking_by_token_at', 'claim_booking_outbox')),
  14::bigint,
  'décisions 6 à 11 et point 15 : une seule surcharge par fonction (14 fonctions)'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'carnet'
      and p.proname in ('get_public_booking_page', 'get_public_busy_ranges', 'book_slot', 'book_slot_at',
                        'cancel_booking_by_token', 'cancel_booking_by_token_at', 'reschedule_booking_by_token',
                        'reschedule_booking_by_token_at', 'cancel_own_booking', 'queue_booking_reminders', 'purge_bookings',
                        'get_booking_by_token', 'get_booking_by_token_at', 'claim_booking_outbox')
      and p.proconfig @> array['search_path=""']),
  14::bigint,
  'règle supabase : les 14 fonctions fixent search_path = '''''
);
select is(
  (select string_agg(p.proname || ':' || p.prosecdef::text || ':' || p.provolatile::text, ',' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'carnet'
      and p.proname in ('get_public_booking_page', 'get_public_busy_ranges', 'book_slot', 'book_slot_at',
                        'cancel_booking_by_token', 'cancel_booking_by_token_at', 'reschedule_booking_by_token',
                        'reschedule_booking_by_token_at', 'cancel_own_booking', 'get_booking_by_token',
                        'get_booking_by_token_at', 'claim_booking_outbox')),
  'book_slot:true:v,book_slot_at:true:v,cancel_booking_by_token:true:v,cancel_booking_by_token_at:true:v,'
  || 'cancel_own_booking:true:v,claim_booking_outbox:true:v,get_booking_by_token:true:s,get_booking_by_token_at:true:s,'
  || 'get_public_booking_page:true:s,get_public_busy_ranges:true:s,'
  || 'reschedule_booking_by_token:true:v,reschedule_booking_by_token_at:true:v',
  'décisions 6, 7 et point 15 : security definer ; lectures stable, écritures (et claim qui verrouille) volatile'
);
select is(
  pg_get_function_result(to_regprocedure('carnet.book_slot(text, uuid, timestamptz, text, text, text, text, uuid, text)')),
  'TABLE(booking_id uuid, cancel_token text)',
  'décision 7 : book_slot renvoie table (booking_id uuid, cancel_token text)'
);
select is(
  pg_get_function_result(to_regprocedure('carnet.book_slot_at(text, uuid, timestamptz, text, text, text, text, uuid, text, timestamptz)')),
  'TABLE(booking_id uuid, cancel_token text)',
  'décision 7 : book_slot_at renvoie table (booking_id uuid, cancel_token text)'
);
select is(
  (select array_to_string(proargnames, ',') from pg_proc
    where oid = to_regprocedure('carnet.book_slot_at(text, uuid, timestamptz, text, text, text, text, uuid, text, timestamptz)')),
  'p_slug,p_event_type_id,p_start,p_visitor_name,p_visitor_email,p_visitor_phone,p_message,p_idempotency_key,p_device_class,p_now,booking_id,cancel_token',
  'décision 7 : noms des paramètres de book_slot_at figés'
);
select is(
  pg_get_function_result(to_regprocedure('carnet.reschedule_booking_by_token(text, timestamptz, uuid)')),
  'TABLE(booking_id uuid, cancel_token text)',
  'décision 7 : reschedule_booking_by_token renvoie table (booking_id uuid, cancel_token text)'
);
select is(
  pg_get_function_result(to_regprocedure('carnet.cancel_booking_by_token(text)')),
  'uuid',
  'décision 7 : cancel_booking_by_token renvoie uuid'
);
select is(
  pg_get_function_result(to_regprocedure('carnet.cancel_own_booking(uuid)')),
  'void',
  'décision 7 : cancel_own_booking renvoie void'
);
select is(
  pg_get_function_result(to_regprocedure('carnet.get_public_booking_page(text)')) || ','
  || pg_get_function_result(to_regprocedure('carnet.get_public_busy_ranges(text, timestamptz, timestamptz)')),
  'jsonb,jsonb',
  'décision 6 : les deux lectures publiques renvoient une seule valeur jsonb (limite de lignes PostgREST)'
);
select is(
  pg_get_function_result(to_regprocedure('carnet.queue_booking_reminders()')) || ','
  || pg_get_function_result(to_regprocedure('carnet.purge_bookings(interval)')),
  'integer,integer',
  'décisions 8 et 11 : rappels et purge renvoient le nombre de lignes traitées'
);
select is(
  pg_get_function_result(to_regprocedure('carnet.get_booking_by_token(text)')) || ','
  || pg_get_function_result(to_regprocedure('carnet.get_booking_by_token_at(text, timestamptz)')),
  'jsonb,jsonb',
  'point 15 : get_booking_by_token et sa variante _at renvoient une seule valeur jsonb'
);
select is(
  (select array_to_string(proargnames, ',') from pg_proc where oid = to_regprocedure('carnet.get_booking_by_token_at(text, timestamptz)')),
  'p_token,p_now',
  'point 15 : paramètres de get_booking_by_token_at (p_token, p_now)'
);
select is(
  pg_get_function_result(to_regprocedure('carnet.claim_booking_outbox(integer)')),
  'TABLE(id uuid, type text, attempts integer, booking_id uuid, previous_booking_id uuid, '
  || 'previous_booking_start timestamp with time zone, previous_booking_end timestamp with time zone, cancelled_by text, '
  || 'booking_start timestamp with time zone, booking_end timestamp with time zone, event_type_title text, '
  || 'location_kind text, location_text text, time_zone text, profile_slug text, owner_display_name text, '
  || 'owner_email text, visitor_name text, visitor_email text, visitor_phone text, visitor_message text, cancel_token text)',
  'points 15 et 18 : claim_booking_outbox renvoie la table du contrat (événement, réservation, créneau précédent, type, lieu, fuseau, propriétaire, visiteur, jeton)'
);
select is(
  (select array_to_string(proargnames[1:1], ',') from pg_proc where oid = to_regprocedure('carnet.claim_booking_outbox(integer)')),
  'p_limit',
  'point 15 : claim_booking_outbox nomme son paramètre p_limit'
);
select ok(
  coalesce(pg_get_functiondef(to_regprocedure('carnet.claim_booking_outbox(integer)')) ~* 'for\s+update\s+skip\s+locked', false),
  'point 15 : claim_booking_outbox réserve avec for update skip locked'
);

-- Droits d'exécution
select function_privs_are('carnet', 'get_public_booking_page', array['text'], 'anon', array['EXECUTE'], 'décision 6 : anon exécute get_public_booking_page');
select function_privs_are('carnet', 'get_public_busy_ranges', array['text', 'timestamp with time zone', 'timestamp with time zone'], 'anon', array['EXECUTE'],
  'décision 6 : anon exécute get_public_busy_ranges');
select function_privs_are('carnet', 'get_public_booking_page', array['text'], 'authenticated', array['EXECUTE'], 'décision 6 : authenticated exécute get_public_booking_page');
select function_privs_are('carnet', 'get_public_busy_ranges', array['text', 'timestamp with time zone', 'timestamp with time zone'], 'service_role', array['EXECUTE'],
  'décision 6 : service_role exécute get_public_busy_ranges');
select is(
  (select string_agg(r || '=' || has_function_privilege(r, f, 'EXECUTE')::text, ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          (select to_regprocedure('carnet.book_slot(text, uuid, timestamptz, text, text, text, text, uuid, text)') f) x
    where f is not null),
  'anon=false,authenticated=false,service_role=true',
  'décision 7 : book_slot exécutable par service_role seul'
);
select is(
  (select string_agg(r || '=' || has_function_privilege(r, f, 'EXECUTE')::text, ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          (select to_regprocedure('carnet.cancel_booking_by_token(text)') f) x
    where f is not null),
  'anon=false,authenticated=false,service_role=true',
  'décision 7 : cancel_booking_by_token exécutable par service_role seul'
);
select is(
  (select string_agg(r || '=' || has_function_privilege(r, f, 'EXECUTE')::text, ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          (select to_regprocedure('carnet.reschedule_booking_by_token(text, timestamptz, uuid)') f) x
    where f is not null),
  'anon=false,authenticated=false,service_role=true',
  'décision 7 : reschedule_booking_by_token exécutable par service_role seul'
);
select is(
  (select string_agg(r || '=' || has_function_privilege(r, f, 'EXECUTE')::text, ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          (select to_regprocedure('carnet.cancel_own_booking(uuid)') f) x
    where f is not null),
  'anon=false,authenticated=true,service_role=false',
  'décision 7 : cancel_own_booking exécutable par authenticated seul'
);
select is(
  (select string_agg(r || '=' || has_function_privilege(r, f, 'EXECUTE')::text, ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          (select to_regprocedure('carnet.get_booking_by_token(text)') f) x
    where f is not null),
  'anon=false,authenticated=false,service_role=true',
  'point 15 : get_booking_by_token exécutable par service_role seul'
);
select is(
  (select string_agg(r || '=' || has_function_privilege(r, f, 'EXECUTE')::text, ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          (select to_regprocedure('carnet.claim_booking_outbox(integer)') f) x
    where f is not null),
  'anon=false,authenticated=false,service_role=true',
  'point 15 : claim_booking_outbox exécutable par service_role seul'
);
select is(
  (select string_agg(p.proname || '=' || (has_function_privilege('anon', p.oid, 'EXECUTE')
                                         or has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                         or has_function_privilege('service_role', p.oid, 'EXECUTE'))::text, ',' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'carnet'
      and p.proname in ('book_slot_at', 'cancel_booking_by_token_at', 'reschedule_booking_by_token_at',
                        'queue_booking_reminders', 'purge_bookings', 'get_booking_by_token_at')),
  'book_slot_at=false,cancel_booking_by_token_at=false,get_booking_by_token_at=false,purge_bookings=false,queue_booking_reminders=false,reschedule_booking_by_token_at=false',
  'décisions 7, 8, 11 : variantes à horloge injectée, rappels et purge exécutables par personne (ni anon, ni authenticated, ni service_role)'
);

select * from finish();
rollback;
