-- Fiche 0031 — leads et outbox : profiles.accepts_leads, carnet.leads, carnet.outbox, capture_lead, claim_outbox,
-- complete_outbox, fail_outbox, purges planifiées par pg_cron, suppression de compte ; décision 10 (accepts_leads exposé
-- par get_public_profile en dernière colonne de public_profiles ; lead supprimé avant envoi : claim_outbox ne renvoie pas
-- son lead.created et le marque processed).
-- Critères couverts : 1 (idempotence de capture_lead : un lead, un événement d'outbox, un lead_submitted), 2 (atomicité :
-- échec de l'outbox ou de analytics_events → aucun lead), 3 (claim_outbox sans double réservation, verrou de plus de
-- 5 minutes repris), 4 (dead à 5 échecs, plus réservé), 5 (droits d'exécution et RLS : propriétaire, autre membre, compte
-- d'un autre projet, anon), 6 (refus identique P0002, rien d'écrit), 7 (tâches pg_cron uniques ; le rejeu de la migration
-- est prouvé par db-architect). Décisions 1 à 9.
-- Dépendance à la fiche 0028 : les assertions sur carnet.analytics_events (lead_submitted, atomicité côté statistiques)
-- supposent que la table existe et accepte une ligne (id, profile_id, type = 'lead_submitted') écrite par capture_lead ;
-- la migration 0031 doit être ordonnée après celle de 0028.
-- Contrat figé pour db-architect :
--   carnet.profiles.accepts_leads boolean not null default true ; update de colonne accordé à authenticated.
--   carnet.leads : id uuid pk default gen_random_uuid(), profile_id uuid not null (fk profiles on delete cascade),
--     name text not null (≤ 100), email text not null (≤ 254), message text not null (≤ 2000), consent_at timestamptz
--     not null, idempotency_key uuid not null, created_at timestamptz not null default now() ;
--     unique (profile_id, idempotency_key) ; refus 23514 sur longueur ou caractère interdit (liste de
--     profiles_text_charset_check : name et email sans \n ni \r, message comme bio avec \n et \r autorisés).
--     RLS activée et forcée ; authenticated : select et delete seulement (politiques select et delete, propriétaire
--     via carnet.can_edit_profile / is_member) ; anon : rien.
--   carnet.outbox : id uuid pk default gen_random_uuid(), type text not null, profile_id uuid not null (fk profiles on
--     delete cascade, indexée), payload jsonb not null, status text not null default 'pending' (check pending,
--     processed, dead → 23514 sinon), attempts integer not null default 0, locked_at timestamptz, processed_at
--     timestamptz, last_error text, created_at timestamptz not null default now(). RLS activée et forcée ; aucun
--     privilège ni politique pour anon et authenticated. Pour lead.created : payload = {"lead_id": "<id>"} exactement.
--   carnet.capture_lead(p_slug text, p_name text, p_email text, p_message text, p_idempotency_key uuid,
--     p_device_class text) returns uuid (id du lead, nouveau ou existant) ; volatile, security definer, search_path '' ;
--     execute service_role seul ; plus aucune surcharge à 5 paramètres. p_device_class nul ou hors de (mobile, desktop)
--     → 22023 avant tout contrôle du profil, rien d'écrit ; le lead_submitted porte ce device_class.
--     E-mail : refus 23514 sans @ ou avec espace, virgule, point-virgule, <, > ou ". Nom et message : refus 23514 si vides
--     ou réduits à des blancs. (Nom de la fonction de validation de texte non figé.)
--     consent_at = created_at = now() à la première insertion. Profil inconnu, non publié ou accepts_leads = false :
--     P0002, même message, détail et indice, rien d'écrit. Rejeu (même profil, même clé) : renvoie l'id existant,
--     ne modifie rien, n'écrit rien. La même clé sur un autre profil crée un autre lead.
--   carnet.claim_outbox(p_limit integer) returns table (id uuid, type text, attempts integer, owner_display_name text,
--     owner_email text, lead_name text, lead_email text, lead_message text, lead_created_at timestamptz) ;
--     volatile, security definer, search_path '' ; execute service_role seul ; for update skip locked.
--     Réserve (locked_at = now()) au plus p_limit événements status = 'pending' non verrouillés ou verrouillés depuis
--     plus de 5 minutes, du plus ancien (created_at) au plus récent.
--     Décision 7 amendée (orchestrateur, 18/11/2026) : attempts = nombre de réservations (tentatives d'envoi).
--     claim_outbox fait attempts + 1 et renvoie la valeur après incrément ; un événement pending dont attempts vaut déjà
--     5 (n8n tombé pendant la 5e tentative) passe dead à la réservation suivante, sans être renvoyé ni incrémenté.
--     5 cycles réservation + échec = 5 envois ; 6 réservations sans échec renvoient 1, 2, 3, 4, 5 puis rien.
--   carnet.complete_outbox(p_id uuid) returns void : status processed, processed_at = now() ; rejeu sans effet
--     (processed_at inchangé) ; id inconnu sans erreur. service_role seul.
--   carnet.fail_outbox(p_id uuid, p_error text) returns void : n'incrémente pas attempts ; enregistre last_error ;
--     dead si attempts >= 5, sinon reste pending avec son verrou (nouvel essai après 5 minutes) ; un
--     événement processed ou dead ne redevient pas pending ; last_error ≤ 500 caractères et sans l'adresse e-mail
--     contenue dans p_error. service_role seul.
--   carnet.purge_outbox(p_older_than interval) returns integer : supprime les événements processed ou dead dont
--     coalesce(processed_at, locked_at, created_at) < now() - p_older_than (jamais pending), renvoie leur nombre ; 22023 si null ou ≤ 0.
--   carnet.purge_leads(p_older_than interval) returns integer : supprime les leads créés avant now() - p_older_than,
--     renvoie leur nombre ; 22023 si null ou ≤ 0. Aucune des deux purges n'est exécutable par anon ni authenticated.
--   pg_cron : 'carnet-purge-outbox' → select carnet.purge_outbox(interval '30 days') ;
--             'carnet-purge-leads'  → select carnet.purge_leads(interval '12 months') ;
--     quotidiennes (minute heure * * *), base postgres, utilisateur postgres, actives, uniques.
-- Atomicité (critère 2) : une contrainte check temporaire (annulée par le rollback) fait échouer l'insertion dans
-- l'outbox, puis dans analytics_events ; aucun lead ne doit rester.
-- Concurrence (critère 3) : une seule session pgTAP ; « pas de double réservation » est prouvé par deux claim
-- successifs (le verrou posé par le premier exclut ses lignes du second) et par la présence de skip locked.
-- Personas (UUID fixes, plage 0…31xx propre à cette fiche) :
--   A  0…310a  membre de carnet, profil PA 0…3110 publié (ana-0031), contact_email ≠ e-mail du compte
--   B  0…310b  membre de carnet, profil PB 0…3111 publié (ben-0031)
--   U  0…310c  membre de carnet, profil PU 0…3112 non publié (uma-0031)
--   R  0…310d  membre de carnet, profil PR 0…3113 publié (rex-0031), passe lui-même accepts_leads à false
--   C  0…310e  membre de other_0031 (projet 0…3102) seul, propriétaire du profil PC 0…3114 (cyd-0031)
--   N  0…310f  membre de carnet sans profil
-- Leads fixes 0…31dX, événements fixes 0…31eX / 0…31fX / 0…31cX, clés d'idempotence 0…31aX / 0…31bX.
-- Horloge : now() figé dans la transaction ; toutes les anciennetés sont posées relativement à now().
-- Fixtures créées par postgres (bypassrls) ; tout est annulé par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(241);

-- Compte les lignes supprimées par une instruction exécutée avec les droits de l'appelant (security invoker : la RLS
-- s'applique au rôle courant). Un delete dans un WITH ne peut pas être imbriqué dans un argument de is().
create function pg_temp.delete_count(q text) returns bigint language plpgsql as $f$ declare n bigint; begin execute q; get diagnostics n = row_count; return n; end $f$;

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000310a', 'a-carnet-0031@test.local'),
  ('00000000-0000-4000-8000-00000000310b', 'b-carnet-0031@test.local'),
  ('00000000-0000-4000-8000-00000000310c', 'u-carnet-0031@test.local'),
  ('00000000-0000-4000-8000-00000000310d', 'r-carnet-0031@test.local'),
  ('00000000-0000-4000-8000-00000000310e', 'c-other-0031@test.local'),
  ('00000000-0000-4000-8000-00000000310f', 'n-carnet-0031@test.local');

insert into platform.projects (id, slug, name, db_schema)
  values ('00000000-0000-4000-8000-000000003102', 'other_0031', 'Other 0031', 'other_0031');

insert into platform.project_members (project_id, user_id, role)
  select p.id, u.id, 'user'
    from platform.projects p
   cross join (values ('00000000-0000-4000-8000-00000000310a'::uuid), ('00000000-0000-4000-8000-00000000310b'::uuid),
                      ('00000000-0000-4000-8000-00000000310c'::uuid), ('00000000-0000-4000-8000-00000000310d'::uuid),
                      ('00000000-0000-4000-8000-00000000310f'::uuid)) as u (id)
   where p.slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  values ('00000000-0000-4000-8000-000000003102', '00000000-0000-4000-8000-00000000310e', 'user');

insert into carnet.profiles (id, owner_id, slug, display_name, contact_email, is_published) values
  ('00000000-0000-4000-8000-000000003110', '00000000-0000-4000-8000-00000000310a', 'ana-0031', 'Ana', 'contact-ana@example.test', true),
  ('00000000-0000-4000-8000-000000003111', '00000000-0000-4000-8000-00000000310b', 'ben-0031', 'Ben', null, true),
  ('00000000-0000-4000-8000-000000003112', '00000000-0000-4000-8000-00000000310c', 'uma-0031', 'Uma', null, false),
  ('00000000-0000-4000-8000-000000003113', '00000000-0000-4000-8000-00000000310d', 'rex-0031', 'Rex', null, true),
  ('00000000-0000-4000-8000-000000003114', '00000000-0000-4000-8000-00000000310e', 'cyd-0031', 'Cyd', null, true);

-- ---------------------------------------------------------------------------
-- Décision 1 — profiles.accepts_leads (structure)
-- ---------------------------------------------------------------------------
select has_column('carnet', 'profiles', 'accepts_leads', 'décision 1 : carnet.profiles.accepts_leads existe');
select col_type_is('carnet', 'profiles', 'accepts_leads', 'boolean', 'décision 1 : accepts_leads est boolean');
select col_not_null('carnet', 'profiles', 'accepts_leads', 'décision 1 : accepts_leads est not null');
select col_default_is('carnet', 'profiles', 'accepts_leads', 'true', 'décision 1 : accepts_leads vaut true par défaut');
select ok(
  case when to_regclass('carnet.profiles') is null
         or not exists (select 1 from pg_attribute where attrelid = 'carnet.profiles'::regclass and attname = 'accepts_leads')
       then false
       else has_column_privilege('authenticated', 'carnet.profiles', 'accepts_leads', 'UPDATE') end,
  'décision 1 : authenticated a update sur la colonne accepts_leads'
);
select ok(
  case when not exists (select 1 from pg_attribute where attrelid = 'carnet.profiles'::regclass and attname = 'accepts_leads')
       then false
       else not has_column_privilege('anon', 'carnet.profiles', 'accepts_leads', 'UPDATE') end,
  'décision 1 : anon n''a pas update sur accepts_leads'
);
select is(
  (select a.attname::text from pg_attribute a
    where a.attrelid = 'carnet.public_profiles'::regclass and a.attnum > 0 and not a.attisdropped
    order by a.attnum desc limit 1),
  'accepts_leads',
  'décision 10 : carnet.public_profiles (donc get_public_profile) expose accepts_leads, ajoutée en dernière colonne'
);

-- ---------------------------------------------------------------------------
-- Décision 2 — carnet.leads (structure)
-- ---------------------------------------------------------------------------
select has_table('carnet', 'leads', 'décision 2 : la table carnet.leads existe');
select columns_are('carnet', 'leads',
  array['id', 'profile_id', 'name', 'email', 'message', 'consent_at', 'idempotency_key', 'created_at'],
  'décision 2 : carnet.leads a exactement les colonnes de la fiche');
select col_is_pk('carnet', 'leads', 'id', 'décision 2 : id est la clé primaire de leads');
select col_type_is('carnet', 'leads', 'id', 'uuid', 'décision 2 : leads.id est uuid');
select col_type_is('carnet', 'leads', 'profile_id', 'uuid', 'décision 2 : leads.profile_id est uuid');
select col_type_is('carnet', 'leads', 'name', 'text', 'décision 2 : leads.name est text');
select col_type_is('carnet', 'leads', 'email', 'text', 'décision 2 : leads.email est text');
select col_type_is('carnet', 'leads', 'message', 'text', 'décision 2 : leads.message est text');
select col_type_is('carnet', 'leads', 'consent_at', 'timestamp with time zone', 'décision 2 : leads.consent_at est timestamptz');
select col_type_is('carnet', 'leads', 'idempotency_key', 'uuid', 'décision 2 : leads.idempotency_key est uuid');
select col_type_is('carnet', 'leads', 'created_at', 'timestamp with time zone', 'décision 2 : leads.created_at est timestamptz');
select ok(
  (select count(*) = 8 from pg_attribute
    where attrelid = to_regclass('carnet.leads') and attnum > 0 and not attisdropped and attnotnull),
  'décision 2 : les 8 colonnes de leads sont not null'
);
select col_is_unique('carnet', 'leads', array['profile_id', 'idempotency_key'],
  'décision 2 : unique (profile_id, idempotency_key) sur leads');
select ok(
  exists (select 1 from pg_constraint c
           where c.conrelid = to_regclass('carnet.leads') and c.contype = 'f'
             and c.confrelid = 'carnet.profiles'::regclass and c.confdeltype = 'c'
             and c.conkey = array[(select attnum from pg_attribute
                                    where attrelid = to_regclass('carnet.leads') and attname = 'profile_id')]),
  'décision 2 : leads.profile_id référence profiles avec on delete cascade'
);
select ok(
  coalesce((select relrowsecurity and relforcerowsecurity from pg_class where oid = to_regclass('carnet.leads')), false),
  'décision 3 : RLS activée et forcée sur carnet.leads'
);
select is(
  (select array_agg(distinct cmd::text order by cmd::text) from pg_policies where schemaname = 'carnet' and tablename = 'leads'),
  array['DELETE', 'SELECT'],
  'décision 3 : leads n''a que des politiques select et delete (aucune insert, update ni all)'
);
select is(
  (select count(*) from pg_policies
    where schemaname = 'carnet' and tablename = 'leads' and roles && array['anon', 'public']::name[]),
  0::bigint,
  'décision 3 : aucune politique de leads ne vise anon ni public'
);
select table_privs_are('carnet', 'leads', 'authenticated', array['DELETE', 'SELECT'],
  'décision 3 : authenticated a select et delete sur leads, rien d''autre');
select table_privs_are('carnet', 'leads', 'anon', '{}'::name[], 'décision 3 : anon n''a aucun privilège sur leads');
select ok(
  case when to_regclass('carnet.leads') is null then false
       else not has_any_column_privilege('authenticated', 'carnet.leads', 'UPDATE')
        and not has_any_column_privilege('authenticated', 'carnet.leads', 'INSERT') end,
  'décision 3 : authenticated n''a ni insert ni update, même par colonne, sur leads'
);

-- ---------------------------------------------------------------------------
-- Décision 6 — carnet.outbox (structure)
-- ---------------------------------------------------------------------------
select has_table('carnet', 'outbox', 'décision 6 : la table carnet.outbox existe');
select columns_are('carnet', 'outbox',
  array['id', 'type', 'profile_id', 'payload', 'status', 'attempts', 'locked_at', 'processed_at', 'last_error', 'created_at'],
  'décision 6 : carnet.outbox a exactement les colonnes de la fiche');
select col_is_pk('carnet', 'outbox', 'id', 'décision 6 : id est la clé primaire de outbox');
select col_type_is('carnet', 'outbox', 'id', 'uuid', 'décision 6 : outbox.id est uuid');
select col_type_is('carnet', 'outbox', 'type', 'text', 'décision 6 : outbox.type est text');
select col_type_is('carnet', 'outbox', 'profile_id', 'uuid', 'décision 6 : outbox.profile_id est uuid');
select col_type_is('carnet', 'outbox', 'payload', 'jsonb', 'décision 6 : outbox.payload est jsonb');
select col_type_is('carnet', 'outbox', 'status', 'text', 'décision 6 : outbox.status est text');
select col_type_is('carnet', 'outbox', 'attempts', 'integer', 'décision 6 : outbox.attempts est integer');
select col_type_is('carnet', 'outbox', 'locked_at', 'timestamp with time zone', 'décision 6 : outbox.locked_at est timestamptz');
select col_type_is('carnet', 'outbox', 'processed_at', 'timestamp with time zone', 'décision 6 : outbox.processed_at est timestamptz');
select col_type_is('carnet', 'outbox', 'last_error', 'text', 'décision 6 : outbox.last_error est text');
select col_type_is('carnet', 'outbox', 'created_at', 'timestamp with time zone', 'décision 6 : outbox.created_at est timestamptz');
select is(
  (select array_agg(attname::text order by attname) from pg_attribute
    where attrelid = to_regclass('carnet.outbox') and attnum > 0 and not attisdropped and attnotnull),
  array['attempts', 'created_at', 'id', 'payload', 'profile_id', 'status', 'type'],
  'décision 6 : not null sur id, type, profile_id, payload, status, attempts, created_at ; locked_at, processed_at, last_error nullables'
);
select col_default_is('carnet', 'outbox', 'status', 'pending'::text, 'décision 6 : status vaut pending par défaut');
select col_default_is('carnet', 'outbox', 'attempts', '0', 'décision 6 : attempts vaut 0 par défaut');
select ok(
  exists (select 1 from pg_constraint c
           where c.conrelid = to_regclass('carnet.outbox') and c.contype = 'f'
             and c.confrelid = 'carnet.profiles'::regclass and c.confdeltype = 'c'
             and c.conkey = array[(select attnum from pg_attribute
                                    where attrelid = to_regclass('carnet.outbox') and attname = 'profile_id')]),
  'décision 6 : outbox.profile_id référence profiles avec on delete cascade'
);
select ok(
  exists (select 1 from pg_index i
           where i.indrelid = to_regclass('carnet.outbox')
             and i.indkey[0] = (select attnum from pg_attribute
                                 where attrelid = to_regclass('carnet.outbox') and attname = 'profile_id')),
  'décision 6 : un index commence par outbox.profile_id (clé étrangère)'
);
select ok(
  coalesce((select relrowsecurity and relforcerowsecurity from pg_class where oid = to_regclass('carnet.outbox')), false),
  'décision 6 : RLS activée et forcée sur carnet.outbox'
);
select is(
  (select count(*) from pg_policies
    where schemaname = 'carnet' and tablename = 'outbox' and roles && array['anon', 'authenticated', 'public']::name[]),
  0::bigint,
  'décision 6 : aucune politique de outbox ne vise anon, authenticated ni public'
);
select table_privs_are('carnet', 'outbox', 'authenticated', '{}'::name[], 'décision 6 : authenticated n''a aucun privilège sur outbox');
select table_privs_are('carnet', 'outbox', 'anon', '{}'::name[], 'décision 6 : anon n''a aucun privilège sur outbox');
select ok(
  case when to_regclass('carnet.outbox') is null then false
       else not has_any_column_privilege('authenticated', 'carnet.outbox', 'SELECT')
        and not has_any_column_privilege('anon', 'carnet.outbox', 'SELECT') end,
  'décision 6 : ni anon ni authenticated ne lisent une colonne de outbox'
);

-- ---------------------------------------------------------------------------
-- Décisions 4, 5, 7, 8 — fonctions (structure et droits)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'capture_lead', array['text', 'text', 'text', 'text', 'uuid', 'text'],
  'décision 4 : carnet.capture_lead(text, text, text, text, uuid, text) existe');
select hasnt_function('carnet', 'capture_lead', array['text', 'text', 'text', 'text', 'uuid'],
  'décision 4 (amendée) : l''ancienne signature à 5 paramètres n''existe plus (aucune surcharge sans device_class)');
select function_returns('carnet', 'capture_lead', array['text', 'text', 'text', 'text', 'uuid', 'text'], 'uuid',
  'décision 4 : capture_lead renvoie uuid (id du lead)');
select is_definer('carnet', 'capture_lead', array['text', 'text', 'text', 'text', 'uuid', 'text'], 'décision 4 : capture_lead est security definer');
select volatility_is('carnet', 'capture_lead', array['text', 'text', 'text', 'text', 'uuid', 'text'], 'volatile', 'décision 4 : capture_lead est volatile');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.capture_lead(text, text, text, text, uuid, text)')
             and p.proconfig @> array['search_path=""']
             and p.proargnames = array['p_slug', 'p_name', 'p_email', 'p_message', 'p_idempotency_key', 'p_device_class']),
  'décision 4 : capture_lead fixe search_path = '''' et nomme ses paramètres p_slug, p_name, p_email, p_message, p_idempotency_key, p_device_class'
);
select function_privs_are('carnet', 'capture_lead', array['text', 'text', 'text', 'text', 'uuid', 'text'], 'service_role', array['EXECUTE'],
  'décision 5 : execute accordé à service_role sur capture_lead');
select function_privs_are('carnet', 'capture_lead', array['text', 'text', 'text', 'text', 'uuid', 'text'], 'anon', '{}'::name[],
  'critère 5 : execute refusé à anon sur capture_lead');
select function_privs_are('carnet', 'capture_lead', array['text', 'text', 'text', 'text', 'uuid', 'text'], 'authenticated', '{}'::name[],
  'critère 5 : execute refusé à authenticated sur capture_lead');
select function_privs_are('carnet', 'capture_lead', array['text', 'text', 'text', 'text', 'uuid', 'text'], 'public', '{}'::name[],
  'critère 5 : execute révoqué pour public sur capture_lead');

select has_function('carnet', 'claim_outbox', array['integer'], 'décision 7 : carnet.claim_outbox(integer) existe');
select is(
  (select pg_get_function_result(to_regprocedure('carnet.claim_outbox(integer)'))),
  'TABLE(id uuid, type text, attempts integer, owner_display_name text, owner_email text, lead_name text, lead_email text, lead_message text, lead_created_at timestamp with time zone)',
  'décision 7 : claim_outbox renvoie la table du contrat (événement + données de l''e-mail)'
);
select is_definer('carnet', 'claim_outbox', array['integer'], 'décision 7 : claim_outbox est security definer');
select volatility_is('carnet', 'claim_outbox', array['integer'], 'volatile', 'décision 7 : claim_outbox est volatile (elle verrouille)');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.claim_outbox(integer)')
             and p.proconfig @> array['search_path=""'] and p.proargnames[1] = 'p_limit'),
  'décision 7 : claim_outbox fixe search_path = '''' et nomme son paramètre p_limit'
);
select ok(
  coalesce(pg_get_functiondef(to_regprocedure('carnet.claim_outbox(integer)')) ~* 'for\s+update\s+skip\s+locked', false),
  'critère 3 : claim_outbox réserve avec for update skip locked'
);

select has_function('carnet', 'complete_outbox', array['uuid'], 'décision 7 : carnet.complete_outbox(uuid) existe');
select function_returns('carnet', 'complete_outbox', array['uuid'], 'void', 'décision 7 : complete_outbox renvoie void');
select is_definer('carnet', 'complete_outbox', array['uuid'], 'décision 7 : complete_outbox est security definer');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.complete_outbox(uuid)')
             and p.proconfig @> array['search_path=""'] and p.proargnames = array['p_id']),
  'décision 7 : complete_outbox fixe search_path = '''' et nomme son paramètre p_id'
);

select has_function('carnet', 'fail_outbox', array['uuid', 'text'], 'décision 7 : carnet.fail_outbox(uuid, text) existe');
select function_returns('carnet', 'fail_outbox', array['uuid', 'text'], 'void', 'décision 7 : fail_outbox renvoie void');
select is_definer('carnet', 'fail_outbox', array['uuid', 'text'], 'décision 7 : fail_outbox est security definer');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.fail_outbox(uuid, text)')
             and p.proconfig @> array['search_path=""'] and p.proargnames = array['p_id', 'p_error']),
  'décision 7 : fail_outbox fixe search_path = '''' et nomme ses paramètres p_id, p_error'
);

select function_privs_are('carnet', 'claim_outbox', array['integer'], 'service_role', array['EXECUTE'], 'décision 7 : execute accordé à service_role sur claim_outbox');
select function_privs_are('carnet', 'claim_outbox', array['integer'], 'anon', '{}'::name[], 'critère 5 : execute refusé à anon sur claim_outbox');
select function_privs_are('carnet', 'claim_outbox', array['integer'], 'authenticated', '{}'::name[], 'critère 5 : execute refusé à authenticated sur claim_outbox');
select function_privs_are('carnet', 'claim_outbox', array['integer'], 'public', '{}'::name[], 'critère 5 : execute révoqué pour public sur claim_outbox');
select function_privs_are('carnet', 'complete_outbox', array['uuid'], 'service_role', array['EXECUTE'], 'décision 7 : execute accordé à service_role sur complete_outbox');
select function_privs_are('carnet', 'complete_outbox', array['uuid'], 'anon', '{}'::name[], 'critère 5 : execute refusé à anon sur complete_outbox');
select function_privs_are('carnet', 'complete_outbox', array['uuid'], 'authenticated', '{}'::name[], 'critère 5 : execute refusé à authenticated sur complete_outbox');
select function_privs_are('carnet', 'complete_outbox', array['uuid'], 'public', '{}'::name[], 'critère 5 : execute révoqué pour public sur complete_outbox');
select function_privs_are('carnet', 'fail_outbox', array['uuid', 'text'], 'service_role', array['EXECUTE'], 'décision 7 : execute accordé à service_role sur fail_outbox');
select function_privs_are('carnet', 'fail_outbox', array['uuid', 'text'], 'anon', '{}'::name[], 'critère 5 : execute refusé à anon sur fail_outbox');
select function_privs_are('carnet', 'fail_outbox', array['uuid', 'text'], 'authenticated', '{}'::name[], 'critère 5 : execute refusé à authenticated sur fail_outbox');
select function_privs_are('carnet', 'fail_outbox', array['uuid', 'text'], 'public', '{}'::name[], 'critère 5 : execute révoqué pour public sur fail_outbox');

select has_function('carnet', 'purge_outbox', array['interval'], 'décision 8 : carnet.purge_outbox(interval) existe');
select function_returns('carnet', 'purge_outbox', array['interval'], 'integer', 'décision 8 : purge_outbox renvoie integer');
select has_function('carnet', 'purge_leads', array['interval'], 'décision 8 : carnet.purge_leads(interval) existe');
select function_returns('carnet', 'purge_leads', array['interval'], 'integer', 'décision 8 : purge_leads renvoie integer');
select ok(
  exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.purge_outbox(interval)')
             and p.proconfig @> array['search_path=""'] and p.proargnames = array['p_older_than'])
  and exists (select 1 from pg_proc p where p.oid = to_regprocedure('carnet.purge_leads(interval)')
             and p.proconfig @> array['search_path=""'] and p.proargnames = array['p_older_than']),
  'décision 8 : purge_outbox et purge_leads fixent search_path = '''' et nomment leur paramètre p_older_than'
);
select function_privs_are('carnet', 'purge_outbox', array['interval'], 'anon', '{}'::name[], 'décision 8 : execute refusé à anon sur purge_outbox');
select function_privs_are('carnet', 'purge_outbox', array['interval'], 'authenticated', '{}'::name[], 'décision 8 : execute refusé à authenticated sur purge_outbox');
select function_privs_are('carnet', 'purge_leads', array['interval'], 'anon', '{}'::name[], 'décision 8 : execute refusé à anon sur purge_leads');
select function_privs_are('carnet', 'purge_leads', array['interval'], 'authenticated', '{}'::name[], 'décision 8 : execute refusé à authenticated sur purge_leads');

-- ---------------------------------------------------------------------------
-- Critère 7 — tâches pg_cron (uniques, quotidiennes, commande exacte)
-- ---------------------------------------------------------------------------
create temp table cron_job_snapshot_0031 (
  jobname text, schedule text, command text, database text, username text, active boolean
);
insert into cron_job_snapshot_0031 (jobname, schedule, command, database, username, active)
  select jobname, schedule, command, database, username, active
    from cron.job
   where jobname in ('carnet-purge-outbox', 'carnet-purge-leads')
      or command ilike '%purge_outbox%' or command ilike '%purge_leads%';

select is(
  (select count(*) from cron_job_snapshot_0031 where jobname = 'carnet-purge-outbox'),
  1::bigint,
  'critère 7 : cron.job contient exactement une tâche carnet-purge-outbox'
);
select is(
  (select count(*) from cron_job_snapshot_0031 where jobname = 'carnet-purge-leads'),
  1::bigint,
  'critère 7 : cron.job contient exactement une tâche carnet-purge-leads'
);
select is(
  (select count(*) from cron_job_snapshot_0031),
  2::bigint,
  'critère 7 : aucune autre tâche n''appelle purge_outbox ni purge_leads'
);
select is(
  (select regexp_replace(btrim(regexp_replace(command, '\s+', ' ', 'g')), '\s*;$', '')
     from cron_job_snapshot_0031 where jobname = 'carnet-purge-outbox'),
  'select carnet.purge_outbox(interval ''30 days'')',
  'décision 8 : la commande de carnet-purge-outbox est select carnet.purge_outbox(interval ''30 days'')'
);
select is(
  (select regexp_replace(btrim(regexp_replace(command, '\s+', ' ', 'g')), '\s*;$', '')
     from cron_job_snapshot_0031 where jobname = 'carnet-purge-leads'),
  'select carnet.purge_leads(interval ''12 months'')',
  'décision 8 : la commande de carnet-purge-leads est select carnet.purge_leads(interval ''12 months'')'
);
select is(
  (select count(*) from cron_job_snapshot_0031
    where jobname in ('carnet-purge-outbox', 'carnet-purge-leads')
      and schedule ~ '^[0-9]{1,2} [0-9]{1,2} \* \* \*$'),
  2::bigint,
  'décision 8 : les deux tâches sont quotidiennes (minute heure * * *)'
);
select is(
  (select count(*) from cron_job_snapshot_0031
    where jobname in ('carnet-purge-outbox', 'carnet-purge-leads')
      and database = 'postgres' and username = 'postgres' and active),
  2::bigint,
  'critère 7 : les deux tâches sont actives, dans la base postgres, sous postgres'
);

-- ---------------------------------------------------------------------------
-- Décision 1 — accepts_leads en situation : le propriétaire le modifie, un autre membre non
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000310d","role":"authenticated"}';
select lives_ok(
  $$update carnet.profiles set accepts_leads = false where id = '00000000-0000-4000-8000-000000003113'$$,
  'décision 1 : R passe accepts_leads à false sur son propre profil'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000310b","role":"authenticated"}';
select lives_ok(
  $$update carnet.profiles set accepts_leads = false where id = '00000000-0000-4000-8000-000000003110'$$,
  'décision 1 : B tente de modifier accepts_leads du profil de A (aucune ligne visible)'
);
reset role;

select is(
  (select array_agg(accepts_leads order by slug) from carnet.profiles
    where id in ('00000000-0000-4000-8000-000000003110', '00000000-0000-4000-8000-000000003113')),
  array[true, false],
  'décision 1 : accepts_leads de A reste true (B n''y touche pas), celui de R vaut false'
);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is(
  (select accepts_leads from carnet.get_public_profile('ana-0031')),
  true,
  'décision 10 : get_public_profile renvoie accepts_leads = true par défaut (anon)'
);
select is(
  (select accepts_leads from carnet.get_public_profile('rex-0031')),
  false,
  'décision 10 : get_public_profile renvoie accepts_leads = false quand le propriétaire l''a désactivé (anon)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 1 — idempotence de capture_lead (service_role)
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select ok(
  set_config('t0031.lead1',
    carnet.capture_lead('ana-0031', 'Vic', 'vic@example.test', E'Bonjour,\nà bientôt', '00000000-0000-4000-8000-0000000031a1', 'desktop')::text,
    true) is not null,
  'critère 1 : premier appel de capture_lead sur ana-0031 renvoie un id'
);
select is(
  carnet.capture_lead('ana-0031', 'Vic', 'vic@example.test', E'Bonjour,\nà bientôt', '00000000-0000-4000-8000-0000000031a1', 'mobile'),
  current_setting('t0031.lead1')::uuid,
  'critère 1 : rejeu identique avec la même clé renvoie le même id'
);
select is(
  carnet.capture_lead('ana-0031', 'Autre', 'autre@example.test', 'Autre message', '00000000-0000-4000-8000-0000000031a1', 'mobile'),
  current_setting('t0031.lead1')::uuid,
  'critère 1 : rejeu avec la même clé et un contenu différent renvoie le lead existant'
);
select isnt(
  carnet.capture_lead('ben-0031', 'Vic', 'vic@example.test', 'Pour Ben', '00000000-0000-4000-8000-0000000031a1', 'mobile'),
  current_setting('t0031.lead1')::uuid,
  'décision 2 : la même clé sur un autre profil crée un autre lead (unicité par profil)'
);
select ok(
  set_config('t0031.lead2',
    carnet.capture_lead('ana-0031', 'Wil', 'wil@example.test', 'Second message', '00000000-0000-4000-8000-0000000031a2', 'mobile')::text,
    true) is not null,
  'critère 1 : une autre clé sur ana-0031 crée un second lead'
);
reset role;

select is(
  (select count(*) from carnet.leads
    where profile_id = '00000000-0000-4000-8000-000000003110' and idempotency_key = '00000000-0000-4000-8000-0000000031a1'),
  1::bigint,
  'critère 1 : trois appels avec la même clé → un seul lead pour ana-0031'
);
select is(
  (select row(id, name, email, message, consent_at, created_at)::text from carnet.leads
    where profile_id = '00000000-0000-4000-8000-000000003110' and idempotency_key = '00000000-0000-4000-8000-0000000031a1'),
  row(current_setting('t0031.lead1')::uuid, 'Vic'::text, 'vic@example.test'::text, E'Bonjour,\nà bientôt'::text, now(), now())::text,
  'critère 1 : le rejeu n''a rien modifié ; consent_at et created_at = heure serveur de la première insertion'
);
select is(
  (select count(*) from carnet.outbox where payload ->> 'lead_id' = current_setting('t0031.lead1')),
  1::bigint,
  'critère 1 : un seul événement d''outbox pour ce lead'
);
select is(
  (select row(type, profile_id, payload, status, attempts, locked_at, processed_at, last_error)::text
     from carnet.outbox where payload ->> 'lead_id' = current_setting('t0031.lead1')),
  row('lead.created'::text, '00000000-0000-4000-8000-000000003110'::uuid,
      jsonb_build_object('lead_id', current_setting('t0031.lead1')::uuid), 'pending'::text, 0,
      null::timestamptz, null::timestamptz, null::text)::text,
  'décision 6 : l''événement est lead.created, pending, 0 tentative, payload = {lead_id} seulement'
);
select is(
  (select count(*) from carnet.outbox where profile_id = '00000000-0000-4000-8000-000000003110'),
  2::bigint,
  'critère 1 : ana-0031 a exactement deux événements (un par lead distinct)'
);
-- Dépendance 0028 : carnet.analytics_events.
select is(
  (select count(*) from carnet.analytics_events
    where id = current_setting('t0031.lead1')::uuid
      and profile_id = '00000000-0000-4000-8000-000000003110' and type = 'lead_submitted'),
  1::bigint,
  'critère 1 (0028) : un analytics_events lead_submitted dont l''id est celui du lead'
);
select is(
  (select count(*) from carnet.analytics_events
    where profile_id = '00000000-0000-4000-8000-000000003110' and type = 'lead_submitted'),
  2::bigint,
  'critère 1 (0028) : ana-0031 a exactement deux lead_submitted (pas de doublon au rejeu)'
);
select is(
  (select array_agg(device_class::text order by (id = current_setting('t0031.lead1')::uuid) desc) from carnet.analytics_events
    where id in (current_setting('t0031.lead1')::uuid, current_setting('t0031.lead2')::uuid)),
  array['desktop', 'mobile'],
  'décision 4 (amendée, 0028) : lead_submitted porte le device_class transmis (desktop pour le lead 1, mobile pour le lead 2)'
);

-- Décision 4 (amendée) : p_device_class nul ou hors liste → 22023, avant tout contrôle du profil, rien d'écrit.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select carnet.capture_lead('ben-0031', 'Dev', 'dev@example.test', 'ok', '00000000-0000-4000-8000-0000000031a5', null)$$,
  '22023', null, 'décision 4 (amendée) : p_device_class nul → 22023'
);
select throws_ok(
  $$select carnet.capture_lead('ben-0031', 'Dev', 'dev@example.test', 'ok', '00000000-0000-4000-8000-0000000031a5', 'tablet')$$,
  '22023', null, 'décision 4 (amendée) : p_device_class hors liste (tablet) → 22023'
);
select throws_ok(
  $$select carnet.capture_lead('zzz-0031', 'Dev', 'dev@example.test', 'ok', '00000000-0000-4000-8000-0000000031a5', 'tablet')$$,
  '22023', null, 'décision 4 (amendée) : slug inconnu et p_device_class invalide → 22023 (contrôle avant le profil)'
);
select throws_ok(
  $$select carnet.capture_lead('uma-0031', 'Dev', 'dev@example.test', 'ok', '00000000-0000-4000-8000-0000000031a5', 'Mobile')$$,
  '22023', null, 'décision 4 (amendée) : profil non publié et p_device_class invalide (Mobile) → 22023 (contrôle avant le profil)'
);
reset role;
select is(
  (select count(*) from carnet.leads where idempotency_key = '00000000-0000-4000-8000-0000000031a5'),
  0::bigint,
  'décision 4 (amendée) : aucun lead écrit pour un p_device_class invalide'
);

-- ---------------------------------------------------------------------------
-- Critère 6 — refus identique : profil non publié, accepts_leads = false, slug inconnu
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select carnet.capture_lead('uma-0031', 'Vic', 'vic@example.test', 'Bonjour', '00000000-0000-4000-8000-0000000031a4', 'mobile')$$,
  'P0002', null, 'critère 6 : profil non publié → P0002'
);
select throws_ok(
  $$select carnet.capture_lead('rex-0031', 'Vic', 'vic@example.test', 'Bonjour', '00000000-0000-4000-8000-0000000031a4', 'mobile')$$,
  'P0002', null, 'critère 6 : accepts_leads = false → P0002'
);
select throws_ok(
  $$select carnet.capture_lead('zzz-0031', 'Vic', 'vic@example.test', 'Bonjour', '00000000-0000-4000-8000-0000000031a4', 'mobile')$$,
  'P0002', null, 'critère 6 : slug inconnu → P0002'
);
do $$
declare
  v_slug text;
  v_out text[] := '{}';
  v_state text;
  v_msg text;
  v_detail text;
  v_hint text;
begin
  foreach v_slug in array array['uma-0031', 'rex-0031', 'zzz-0031'] loop
    begin
      perform carnet.capture_lead(v_slug, 'Vic', 'vic@example.test', 'Bonjour', '00000000-0000-4000-8000-0000000031a4', 'mobile');
      v_out := v_out || 'no error'::text;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text,
                              v_detail = pg_exception_detail, v_hint = pg_exception_hint;
      v_out := v_out || concat_ws('|', v_state, v_msg, v_detail, v_hint);
    end;
  end loop;
  perform set_config('t0031.refusals', array_to_string(v_out, E'\n'), true);
end
$$;
select is(
  (select count(distinct r) from unnest(string_to_array(current_setting('t0031.refusals'), E'\n')) as r),
  1::bigint,
  'critère 6 : non publié, accepts_leads = false et slug inconnu donnent la même erreur (code, message, détail, indice)'
);
reset role;

select is(
  (select count(*) from carnet.leads
    where profile_id in ('00000000-0000-4000-8000-000000003112', '00000000-0000-4000-8000-000000003113')),
  0::bigint,
  'critère 6 : aucun lead écrit pour le profil non publié ni pour celui qui refuse les messages'
);
select is(
  (select count(*) from carnet.outbox
    where profile_id in ('00000000-0000-4000-8000-000000003112', '00000000-0000-4000-8000-000000003113')),
  0::bigint,
  'critère 6 : aucun événement d''outbox écrit pour ces profils'
);
select is(
  (select count(*) from carnet.analytics_events
    where profile_id in ('00000000-0000-4000-8000-000000003112', '00000000-0000-4000-8000-000000003113')),
  0::bigint,
  'critère 6 (0028) : aucun analytics_events écrit pour ces profils'
);

-- ---------------------------------------------------------------------------
-- Décision 2 — longueurs et caractères (refus 23514, rien d'écrit)
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select carnet.capture_lead('ana-0031', repeat('n', 100), 'v1@example.test', 'ok', '00000000-0000-4000-8000-0000000031b1', 'mobile')$$,
  'décision 2 : nom de 100 caractères accepté'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', repeat('n', 101), 'v2@example.test', 'ok', '00000000-0000-4000-8000-0000000031b2', 'mobile')$$,
  '23514', null, 'décision 2 : nom de 101 caractères refusé (23514)'
);
select lives_ok(
  $$select carnet.capture_lead('ana-0031', 'Long', repeat('e', 241) || '@example.test', 'ok', '00000000-0000-4000-8000-0000000031b3', 'mobile')$$,
  'décision 2 : e-mail de 254 caractères accepté'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', 'Long', repeat('e', 242) || '@example.test', 'ok', '00000000-0000-4000-8000-0000000031b4', 'mobile')$$,
  '23514', null, 'décision 2 : e-mail de 255 caractères refusé (23514)'
);
select lives_ok(
  $$select carnet.capture_lead('ana-0031', 'Long', 'v5@example.test', repeat('m', 2000), '00000000-0000-4000-8000-0000000031b5', 'mobile')$$,
  'décision 2 : message de 2000 caractères accepté'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', 'Long', 'v6@example.test', repeat('m', 2001), '00000000-0000-4000-8000-0000000031b6', 'mobile')$$,
  '23514', null, 'décision 2 : message de 2001 caractères refusé (23514)'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', E'Vic\u0007', 'v7@example.test', 'ok', '00000000-0000-4000-8000-0000000031b7', 'mobile')$$,
  '23514', null, 'décision 2 : caractère de contrôle dans le nom refusé (23514)'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', E'Vic\nBcc', 'v8@example.test', 'ok', '00000000-0000-4000-8000-0000000031b8', 'mobile')$$,
  '23514', null, 'décision 2 : saut de ligne dans le nom refusé (23514, injection d''en-tête)'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', 'Vic', E'v9\r\n@example.test', 'ok', '00000000-0000-4000-8000-0000000031b9', 'mobile')$$,
  '23514', null, 'décision 2 : retour chariot dans l''e-mail refusé (23514)'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', 'Vic', E'v10\u200B@example.test', 'ok', '00000000-0000-4000-8000-0000000031ba', 'mobile')$$,
  '23514', null, 'décision 2 : caractère invisible (U+200B) dans l''e-mail refusé (23514)'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', 'Vic', 'v11@example.test', E'texte \u202E inversé', '00000000-0000-4000-8000-0000000031bb', 'mobile')$$,
  '23514', null, 'décision 2 : caractère bidirectionnel (U+202E) dans le message refusé (23514)'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', 'Vic', 'a@x, b@y', 'ok', '00000000-0000-4000-8000-0000000031bd', 'mobile')$$,
  '23514', null, 'décision 2 (audit) : e-mail avec virgule et espace (a@x, b@y) refusé (23514)'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', 'Vic', 'nobody', 'ok', '00000000-0000-4000-8000-0000000031be', 'mobile')$$,
  '23514', null, 'décision 2 (audit) : e-mail sans @ (nobody) refusé (23514)'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', 'Vic', '"a"@x', 'ok', '00000000-0000-4000-8000-0000000031bf', 'mobile')$$,
  '23514', null, 'décision 2 (audit) : e-mail avec guillemet ("a"@x) refusé (23514)'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', 'Vic', 'a b@x.test', 'ok', '00000000-0000-4000-8000-0000000031c6', 'mobile')$$,
  '23514', null, 'décision 2 (audit) : e-mail avec espace refusé (23514)'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', 'Vic', 'a;b@x.test', 'ok', '00000000-0000-4000-8000-0000000031c7', 'mobile')$$,
  '23514', null, 'décision 2 (audit) : e-mail avec point-virgule refusé (23514)'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', 'Vic', '<a@x.test>', 'ok', '00000000-0000-4000-8000-0000000031c8', 'mobile')$$,
  '23514', null, 'décision 2 (audit) : e-mail avec chevrons refusé (23514)'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', '', 'v14@example.test', 'ok', '00000000-0000-4000-8000-0000000031c9', 'mobile')$$,
  '23514', null, 'décision 2 (audit) : nom vide refusé (23514)'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', '   ', 'v15@example.test', 'ok', '00000000-0000-4000-8000-0000000031ca', 'mobile')$$,
  '23514', null, 'décision 2 (audit) : nom réduit à des espaces refusé (23514)'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', 'Vic', 'v16@example.test', '', '00000000-0000-4000-8000-0000000031cb', 'mobile')$$,
  '23514', null, 'décision 2 (audit) : message vide refusé (23514)'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', 'Vic', 'v17@example.test', E'  \n  ', '00000000-0000-4000-8000-0000000031cc', 'mobile')$$,
  '23514', null, 'décision 2 (audit) : message réduit à des espaces et sauts de ligne refusé (23514)'
);
select lives_ok(
  $$select carnet.capture_lead('ana-0031', 'Vic', 'v12@example.test', E'ligne 1\r\nligne 2\nligne 3', '00000000-0000-4000-8000-0000000031bc', 'mobile')$$,
  'décision 2 : sauts de ligne \n et \r acceptés dans le message'
);
select throws_ok(
  $$select carnet.capture_lead('ana-0031', 'Vic', 'v13@example.test', 'ok', null, 'mobile')$$,
  null::char(5), null, 'décision 2 : clé d''idempotence nulle refusée'
);
reset role;

select is(
  (select count(*) from carnet.leads
    where idempotency_key in ('00000000-0000-4000-8000-0000000031b2', '00000000-0000-4000-8000-0000000031b4',
                              '00000000-0000-4000-8000-0000000031b6', '00000000-0000-4000-8000-0000000031b7',
                              '00000000-0000-4000-8000-0000000031b8', '00000000-0000-4000-8000-0000000031b9',
                              '00000000-0000-4000-8000-0000000031ba', '00000000-0000-4000-8000-0000000031bb',
                              '00000000-0000-4000-8000-0000000031bd', '00000000-0000-4000-8000-0000000031be',
                              '00000000-0000-4000-8000-0000000031bf', '00000000-0000-4000-8000-0000000031c6',
                              '00000000-0000-4000-8000-0000000031c7', '00000000-0000-4000-8000-0000000031c8',
                              '00000000-0000-4000-8000-0000000031c9', '00000000-0000-4000-8000-0000000031ca',
                              '00000000-0000-4000-8000-0000000031cb', '00000000-0000-4000-8000-0000000031cc')
       or email = 'v13@example.test'),
  0::bigint,
  'décision 2 : aucune saisie refusée n''a laissé de lead'
);
select is(
  (select count(*) from carnet.outbox where profile_id = '00000000-0000-4000-8000-000000003110'),
  (select count(*) from carnet.leads where profile_id = '00000000-0000-4000-8000-000000003110'),
  'décision 4 : ana-0031 a autant d''événements d''outbox que de leads (refus sans événement)'
);

-- ---------------------------------------------------------------------------
-- Critère 2 — atomicité : échec de l'outbox (puis de analytics_events) → aucun lead
-- ---------------------------------------------------------------------------
alter table carnet.outbox add constraint test_0031_reject_lead_created check (type <> 'lead.created') not valid;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select carnet.capture_lead('ben-0031', 'Atom', 'atom@example.test', 'Atomicité', '00000000-0000-4000-8000-0000000031a3', 'mobile')$$,
  '23514', null, 'critère 2 : l''insertion dans l''outbox échoue (contrainte de test) → capture_lead échoue'
);
reset role;

alter table carnet.outbox drop constraint test_0031_reject_lead_created;

select is(
  (select count(*) from carnet.leads where idempotency_key = '00000000-0000-4000-8000-0000000031a3'),
  0::bigint,
  'critère 2 : outbox en échec → le lead n''existe pas'
);
select is(
  (select count(*) from carnet.analytics_events
    where profile_id = '00000000-0000-4000-8000-000000003111' and type = 'lead_submitted'),
  1::bigint,
  'critère 2 (0028) : outbox en échec → aucun lead_submitted de plus pour ben-0031 (seul celui du lead précédent)'
);

-- Dépendance 0028 : contrainte temporaire sur carnet.analytics_events.
alter table carnet.analytics_events add constraint test_0031_reject_lead_submitted check (type <> 'lead_submitted') not valid;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select carnet.capture_lead('ben-0031', 'Atom', 'atom@example.test', 'Atomicité', '00000000-0000-4000-8000-0000000031a3', 'mobile')$$,
  '23514', null, 'critère 2 (0028) : l''insertion dans analytics_events échoue → capture_lead échoue'
);
reset role;

alter table carnet.analytics_events drop constraint test_0031_reject_lead_submitted;

select is(
  (select count(*) from carnet.leads where idempotency_key = '00000000-0000-4000-8000-0000000031a3')
    + (select count(*) from carnet.outbox o
        where o.profile_id = '00000000-0000-4000-8000-000000003111'
          and not exists (select 1 from carnet.leads l where l.id::text = o.payload ->> 'lead_id')),
  0::bigint,
  'critère 2 (0028) : analytics_events en échec → ni lead ni événement d''outbox orphelin'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select carnet.capture_lead('ben-0031', 'Atom', 'atom@example.test', 'Atomicité', '00000000-0000-4000-8000-0000000031a3', 'mobile')$$,
  'critère 2 : après les échecs, la même clé est acceptée (aucune trace partielle ne la bloque)'
);
reset role;
select is(
  (select count(*) from carnet.leads where idempotency_key = '00000000-0000-4000-8000-0000000031a3')
    + (select count(*) from carnet.outbox o
        join carnet.leads l on l.id::text = o.payload ->> 'lead_id'
       where l.idempotency_key = '00000000-0000-4000-8000-0000000031a3'),
  2::bigint,
  'critère 2 : un lead et un événement après la reprise'
);

-- ---------------------------------------------------------------------------
-- Critère 5 — RLS sur leads : propriétaire, autre membre, compte d'un autre projet, membre sans profil, anon
-- ---------------------------------------------------------------------------
insert into carnet.leads (id, profile_id, name, email, message, consent_at, idempotency_key, created_at) values
  ('00000000-0000-4000-8000-0000000031d0', '00000000-0000-4000-8000-000000003110', 'Zoe', 'zoe@example.test', 'Salut Ana',
   now() - interval '8 days', '00000000-0000-4000-8000-0000000031c0', now() - interval '8 days'),
  ('00000000-0000-4000-8000-0000000031d1', '00000000-0000-4000-8000-000000003111', 'Yan', 'yan@example.test', 'Salut Ben',
   now() - interval '7 days', '00000000-0000-4000-8000-0000000031c1', now() - interval '7 days'),
  ('00000000-0000-4000-8000-0000000031d2', '00000000-0000-4000-8000-000000003114', 'Xia', 'xia@example.test', 'Salut Cyd',
   now() - interval '6 days', '00000000-0000-4000-8000-0000000031c2', now() - interval '6 days');

do $$
begin
  perform set_config('t0031.pa_count',
    (select count(*)::text from carnet.leads where profile_id = '00000000-0000-4000-8000-000000003110'), true);
end
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000310a","role":"authenticated"}';
select is(
  (select count(*) from carnet.leads),
  current_setting('t0031.pa_count')::bigint,
  'critère 5 : A lit tous ses leads'
);
select is(
  (select count(*) from carnet.leads where profile_id <> '00000000-0000-4000-8000-000000003110'),
  0::bigint,
  'critère 5 : A ne lit aucun lead d''un autre profil'
);
select is(
  (select name || ' / ' || email || ' / ' || message from carnet.leads where id = '00000000-0000-4000-8000-0000000031d0'),
  'Zoe / zoe@example.test / Salut Ana',
  'critère 5 : A lit le contenu de son lead'
);
select is(
  pg_temp.delete_count($d$delete from carnet.leads where id = current_setting('t0031.lead2')::uuid$d$),
  1::bigint,
  'critère 5 : A supprime un de ses leads'
);
select throws_ok(
  $$insert into carnet.leads (profile_id, name, email, message, consent_at, idempotency_key)
    values ('00000000-0000-4000-8000-000000003110', 'Moi', 'moi@example.test', 'x', now(), gen_random_uuid())$$,
  '42501', null, 'décision 3 : A ne peut pas insérer directement un lead (42501)'
);
select throws_ok(
  $$update carnet.leads set message = 'modifié' where id = '00000000-0000-4000-8000-0000000031d0'$$,
  '42501', null, 'décision 3 : A ne peut pas modifier un lead (42501)'
);
select throws_ok(
  $$select count(*) from carnet.outbox$$,
  '42501', null, 'décision 6 : A (propriétaire) ne lit pas l''outbox (42501)'
);
reset role;

select is(
  (select count(*) from carnet.leads where id = current_setting('t0031.lead2')::uuid),
  0::bigint,
  'critère 5 : la suppression par A est effective'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000310b","role":"authenticated"}';
select is(
  (select count(*) from carnet.leads where profile_id = '00000000-0000-4000-8000-000000003110'),
  0::bigint,
  'critère 5 : B (autre membre de carnet) ne lit aucun lead de A'
);
select is(
  pg_temp.delete_count($d$delete from carnet.leads where profile_id = '00000000-0000-4000-8000-000000003110'$d$),
  0::bigint,
  'critère 5 : B ne supprime aucun lead de A'
);
select is(
  (select count(*) from carnet.leads where profile_id <> '00000000-0000-4000-8000-000000003111'),
  0::bigint,
  'critère 5 : B ne lit que les leads de son profil'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000310e","role":"authenticated"}';
select is(
  (select count(*) from carnet.leads),
  0::bigint,
  'critère 5 : C (compte d''un autre projet) ne lit aucun lead, pas même ceux du profil qu''il possède'
);
select is(
  pg_temp.delete_count($d$delete from carnet.leads$d$),
  0::bigint,
  'critère 5 : C ne supprime aucun lead'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000310f","role":"authenticated"}';
select is(
  (select count(*) from carnet.leads),
  0::bigint,
  'critère 5 : N (membre sans profil) ne lit aucun lead'
);
reset role;

select is(
  (select count(*) from carnet.leads
    where profile_id = '00000000-0000-4000-8000-000000003110')::text
    || '/' || (select count(*) from carnet.leads where id = '00000000-0000-4000-8000-0000000031d2'),
  (current_setting('t0031.pa_count')::bigint - 1)::text || '/1',
  'critère 5 : seuls les leads supprimés par A ont disparu (B et C n''ont rien supprimé)'
);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select count(*) from carnet.leads$$, '42501', null, 'critère 5 : anon ne lit pas leads (42501)');
select throws_ok($$delete from carnet.leads$$, '42501', null, 'critère 5 : anon ne supprime pas dans leads (42501)');
select throws_ok($$select count(*) from carnet.outbox$$, '42501', null, 'décision 6 : anon ne lit pas outbox (42501)');
reset role;

-- ---------------------------------------------------------------------------
-- Critère 5 — exécution refusée en situation à anon et authenticated
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select carnet.capture_lead('ben-0031', 'Spam', 'spam@example.test', 'spam', gen_random_uuid(), 'mobile')$$,
  '42501', null, 'critère 5 : anon n''exécute pas capture_lead (42501)'
);
select throws_ok($$select * from carnet.claim_outbox(10)$$, '42501', null, 'critère 5 : anon n''exécute pas claim_outbox (42501)');
select throws_ok($$select carnet.complete_outbox(gen_random_uuid())$$, '42501', null, 'critère 5 : anon n''exécute pas complete_outbox (42501)');
select throws_ok($$select carnet.fail_outbox(gen_random_uuid(), 'x')$$, '42501', null, 'critère 5 : anon n''exécute pas fail_outbox (42501)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000310b","role":"authenticated"}';
select throws_ok(
  $$select carnet.capture_lead('ben-0031', 'Spam', 'spam@example.test', 'spam', gen_random_uuid(), 'mobile')$$,
  '42501', null, 'critère 5 : authenticated n''exécute pas capture_lead, même sur son propre profil (42501)'
);
select throws_ok($$select * from carnet.claim_outbox(10)$$, '42501', null, 'critère 5 : authenticated n''exécute pas claim_outbox (42501)');
select throws_ok($$select carnet.complete_outbox(gen_random_uuid())$$, '42501', null, 'critère 5 : authenticated n''exécute pas complete_outbox (42501)');
select throws_ok($$select carnet.fail_outbox(gen_random_uuid(), 'x')$$, '42501', null, 'critère 5 : authenticated n''exécute pas fail_outbox (42501)');
select throws_ok($$select carnet.purge_outbox(interval '30 days')$$, '42501', null, 'décision 8 : authenticated n''exécute pas purge_outbox (42501)');
select throws_ok($$select carnet.purge_leads(interval '12 months')$$, '42501', null, 'décision 8 : authenticated n''exécute pas purge_leads (42501)');
reset role;

-- ---------------------------------------------------------------------------
-- Critère 3 — claim_outbox : ordre, limite, pas de double réservation, verrou expiré repris, données de l'e-mail
-- Ancienneté (created_at) : e5 -30 min verrouillé il y a 4 min 59 s (non repris) ; e1 -10 min ; e2 -9 min ; e3 -8 min ;
-- e4 -7 min verrouillé il y a 5 min 1 s (repris) ; e6 processed et e7 dead, plus anciens, jamais réservés.
-- ---------------------------------------------------------------------------
delete from carnet.outbox;
insert into carnet.outbox (id, type, profile_id, payload, status, attempts, locked_at, processed_at, created_at) values
  ('00000000-0000-4000-8000-0000000031e1', 'lead.created', '00000000-0000-4000-8000-000000003110',
   '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}', 'pending', 0, null, null, now() - interval '10 minutes'),
  ('00000000-0000-4000-8000-0000000031e2', 'lead.created', '00000000-0000-4000-8000-000000003111',
   '{"lead_id":"00000000-0000-4000-8000-0000000031d1"}', 'pending', 0, null, null, now() - interval '9 minutes'),
  ('00000000-0000-4000-8000-0000000031e3', 'lead.created', '00000000-0000-4000-8000-000000003110',
   '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}', 'pending', 1, null, null, now() - interval '8 minutes'),
  ('00000000-0000-4000-8000-0000000031e4', 'lead.created', '00000000-0000-4000-8000-000000003111',
   '{"lead_id":"00000000-0000-4000-8000-0000000031d1"}', 'pending', 0, now() - interval '5 minutes 1 second', null,
   now() - interval '7 minutes'),
  ('00000000-0000-4000-8000-0000000031e5', 'lead.created', '00000000-0000-4000-8000-000000003110',
   '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}', 'pending', 0, now() - interval '4 minutes 59 seconds', null,
   now() - interval '30 minutes'),
  ('00000000-0000-4000-8000-0000000031e6', 'lead.created', '00000000-0000-4000-8000-000000003110',
   '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}', 'processed', 0, null, now() - interval '35 minutes',
   now() - interval '40 minutes'),
  ('00000000-0000-4000-8000-0000000031e7', 'lead.created', '00000000-0000-4000-8000-000000003110',
   '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}', 'dead', 5, null, null, now() - interval '50 minutes');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select ok(
  set_config('t0031.claim1',
    coalesce((select string_agg(c.id::text, ',' order by c.id) from carnet.claim_outbox(2) c), ''), true) is not null,
  'critère 3 : service_role exécute un premier claim_outbox(2)'
);
reset role;

select is(
  current_setting('t0031.claim1'),
  '00000000-0000-4000-8000-0000000031e1,00000000-0000-4000-8000-0000000031e2',
  'critère 3 : claim_outbox(2) réserve les 2 plus anciens réservables (e1, e2), ni le verrou récent, ni processed, ni dead'
);
select is(
  (select count(*) from carnet.outbox
    where id in ('00000000-0000-4000-8000-0000000031e1', '00000000-0000-4000-8000-0000000031e2') and locked_at = now()),
  2::bigint,
  'critère 3 : les événements réservés portent locked_at = now()'
);
select is(
  (select array_agg(attempts order by id) from carnet.outbox
    where id in ('00000000-0000-4000-8000-0000000031e1', '00000000-0000-4000-8000-0000000031e2')),
  array[1, 1],
  'décision 7 (amendée) : chaque réservation incrémente attempts (e1 et e2 passent de 0 à 1)'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
create temp table claim2_0031 as select * from carnet.claim_outbox(10);
select is(
  (select array_agg(id::text order by id) from claim2_0031),
  array['00000000-0000-4000-8000-0000000031e3', '00000000-0000-4000-8000-0000000031e4'],
  'critère 3 : le second claim ne renvoie que e3 et e4 (verrou de plus de 5 minutes repris), jamais e1/e2 ni e5'
);
select is(
  (select count(*) from claim2_0031 where id::text = any (string_to_array(current_setting('t0031.claim1'), ','))),
  0::bigint,
  'critère 3 : aucun événement n''est renvoyé par deux claim successifs'
);
select is(
  (select count(*) from carnet.claim_outbox(10)),
  0::bigint,
  'critère 3 : un troisième claim ne renvoie rien (tout est verrouillé)'
);
select is(
  (select row(type, attempts, owner_display_name, owner_email, lead_name, lead_email, lead_message, lead_created_at)::text
     from claim2_0031 where id = '00000000-0000-4000-8000-0000000031e3'),
  row('lead.created'::text, 2, 'Ana'::text, 'a-carnet-0031@test.local'::text, 'Zoe'::text, 'zoe@example.test'::text,
      'Salut Ana'::text, now() - interval '8 days')::text,
  'décision 7 (amendée) : attempts renvoyé = valeur après incrément (1 → 2) ; lead.created renvoie nom affiché et e-mail du compte (auth.users, pas contact_email) du propriétaire, nom, e-mail, message et date du visiteur'
);
select is(
  (select lead_name || ' → ' || owner_display_name || ' <' || owner_email || '>' from claim2_0031
    where id = '00000000-0000-4000-8000-0000000031e4'),
  'Yan → Ben <b-carnet-0031@test.local>',
  'décision 7 : chaque événement porte les données de son propre lead et de son propriétaire'
);
select throws_ok($$select * from carnet.claim_outbox(0)$$, '22023', null, 'décision 7 : claim_outbox(0) refusé (22023)');
select throws_ok($$select * from carnet.claim_outbox(null)$$, '22023', null, 'décision 7 : claim_outbox(null) refusé (22023)');
reset role;

-- ---------------------------------------------------------------------------
-- Décision 7 — complete_outbox idempotente
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select carnet.complete_outbox('00000000-0000-4000-8000-0000000031e1')$$,
  'décision 7 : service_role acquitte e1'
);
reset role;
select is(
  (select status || ' ' || (processed_at = now())::text from carnet.outbox where id = '00000000-0000-4000-8000-0000000031e1'),
  'processed true',
  'décision 7 : e1 passe processed avec processed_at = now()'
);
update carnet.outbox set processed_at = '2026-11-01 00:00:00+00' where id = '00000000-0000-4000-8000-0000000031e1';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select carnet.complete_outbox('00000000-0000-4000-8000-0000000031e1')$$,
  'décision 7 : acquitter e1 une seconde fois ne lève pas d''erreur'
);
select lives_ok(
  $$select carnet.complete_outbox('00000000-0000-4000-8000-0000000031ff')$$,
  'décision 7 : acquitter un id inconnu ne lève pas d''erreur'
);
reset role;
select is(
  (select status || ' ' || processed_at::text from carnet.outbox where id = '00000000-0000-4000-8000-0000000031e1'),
  'processed ' || '2026-11-01 00:00:00+00'::timestamptz::text,
  'décision 7 : le second acquittement ne change rien (processed_at inchangé)'
);
update carnet.outbox set locked_at = null where id = '00000000-0000-4000-8000-0000000031e1';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(
  (select count(*) from carnet.claim_outbox(10) where id = '00000000-0000-4000-8000-0000000031e1'),
  0::bigint,
  'décision 7 : un événement traité n''est plus réservé, même déverrouillé'
);
reset role;

-- Décision 10 : lead supprimé par son propriétaire avant l'envoi → événement non renvoyé et marqué processed.
insert into carnet.leads (id, profile_id, name, email, message, consent_at, idempotency_key, created_at) values
  ('00000000-0000-4000-8000-0000000031d5', '00000000-0000-4000-8000-000000003111', 'Gus', 'gus@example.test', 'Effacé',
   now() - interval '2 minutes', '00000000-0000-4000-8000-0000000031c5', now() - interval '2 minutes');
insert into carnet.outbox (id, type, profile_id, payload, status, attempts, created_at) values
  ('00000000-0000-4000-8000-0000000031ea', 'lead.created', '00000000-0000-4000-8000-000000003111',
   '{"lead_id":"00000000-0000-4000-8000-0000000031d5"}', 'pending', 0, now() - interval '2 minutes');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000310b","role":"authenticated"}';
select is(
  pg_temp.delete_count($d$delete from carnet.leads where id = '00000000-0000-4000-8000-0000000031d5'$d$),
  1::bigint,
  'décision 10 : B supprime son lead avant que n8n ait envoyé l''e-mail'
);
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(
  (select count(*) from carnet.claim_outbox(10) where id = '00000000-0000-4000-8000-0000000031ea'),
  0::bigint,
  'décision 10 : claim_outbox ne renvoie pas le lead.created d''un lead supprimé'
);
reset role;
select is(
  (select status from carnet.outbox where id = '00000000-0000-4000-8000-0000000031ea'),
  'processed',
  'décision 10 : l''événement d''un lead supprimé est marqué processed par claim_outbox'
);

-- ---------------------------------------------------------------------------
-- Critère 4 — fail_outbox : dead à 5 tentatives, plus réservé ; erreur tronquée sans e-mail
-- ---------------------------------------------------------------------------
insert into carnet.outbox (id, type, profile_id, payload, status, attempts, locked_at, created_at) values
  ('00000000-0000-4000-8000-0000000031f1', 'lead.created', '00000000-0000-4000-8000-000000003110',
   '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}', 'pending', 0, now(), now() - interval '1 minute'),
  ('00000000-0000-4000-8000-0000000031f2', 'lead.created', '00000000-0000-4000-8000-000000003110',
   '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}', 'pending', 0, now(), now() - interval '1 minute'),
  ('00000000-0000-4000-8000-0000000031f3', 'lead.created', '00000000-0000-4000-8000-000000003110',
   '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}', 'processed', 0, null, now() - interval '1 minute');

-- fail_outbox n'incrémente pas : f2 (attempts 0, verrouillé à now()) reste pending, attempts 0, verrou conservé.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select carnet.fail_outbox('00000000-0000-4000-8000-0000000031f2', 'smtp timeout')$$,
  'décision 7 (amendée) : service_role signale un échec sur f2'
);
reset role;
select is(
  (select status || ' ' || attempts || ' ' || last_error || ' ' || (locked_at = now())::text
     from carnet.outbox where id = '00000000-0000-4000-8000-0000000031f2'),
  'pending 0 smtp timeout true',
  'décision 7 (amendée) : fail_outbox n''incrémente pas attempts, garde pending sous 5, enregistre last_error et conserve le verrou'
);

-- Critère 4 : 5 cycles réservation puis échec sur f1 (verrou vieilli de 6 minutes avant chaque réservation).
-- Relevé par cycle : attempts renvoyé par claim_outbox (-1 si f1 n'est pas renvoyé), puis statut après fail_outbox.
update carnet.outbox set locked_at = null where id = '00000000-0000-4000-8000-0000000031f1';
do $$
declare
  v_seen text[] := '{}';
  v_attempts integer;
  v_status text;
begin
  for i in 1..5 loop
    select coalesce(max(c.attempts), -1) into v_attempts
      from carnet.claim_outbox(10) c where c.id = '00000000-0000-4000-8000-0000000031f1';
    perform carnet.fail_outbox('00000000-0000-4000-8000-0000000031f1', 'smtp timeout');
    select o.status into v_status from carnet.outbox o where o.id = '00000000-0000-4000-8000-0000000031f1';
    v_seen := v_seen || (v_attempts::text || ':' || v_status);
    update carnet.outbox set locked_at = now() - interval '6 minutes'
     where id = '00000000-0000-4000-8000-0000000031f1' and locked_at is not null;
  end loop;
  perform set_config('t0031.f1', array_to_string(v_seen, ','), true);
end
$$;
select is(
  current_setting('t0031.f1'),
  '1:pending,2:pending,3:pending,4:pending,5:dead',
  'critère 4 : 5 cycles réservation + échec = 5 envois (attempts 1 à 5) ; f1 passe dead au 5e fail_outbox'
);
select is(
  (select status || ' ' || attempts || ' ' || last_error from carnet.outbox where id = '00000000-0000-4000-8000-0000000031f1'),
  'dead 5 smtp timeout',
  'critère 4 : après 5 tentatives échouées, f1 est dead, attempts = 5, last_error conservé'
);
update carnet.outbox set locked_at = null where id = '00000000-0000-4000-8000-0000000031f1';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(
  (select count(*) from carnet.claim_outbox(10) where id = '00000000-0000-4000-8000-0000000031f1'),
  0::bigint,
  'critère 4 : un événement dead n''est plus réservé, même déverrouillé'
);
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select carnet.fail_outbox('00000000-0000-4000-8000-0000000031f1', 'late')$$,
  'critère 4 : un échec tardif sur un événement dead ne lève pas d''erreur'
);
select lives_ok(
  $$select carnet.fail_outbox('00000000-0000-4000-8000-0000000031f3', 'late')$$,
  'décision 7 : un échec tardif sur un événement processed ne lève pas d''erreur'
);
select lives_ok(
  $$select carnet.fail_outbox('00000000-0000-4000-8000-0000000031f2', repeat('x', 3000))$$,
  'décision 7 : un message d''erreur de 3000 caractères est accepté'
);
reset role;
select is(
  (select array_agg(status order by id) from carnet.outbox
    where id in ('00000000-0000-4000-8000-0000000031f1', '00000000-0000-4000-8000-0000000031f3')),
  array['dead', 'processed'],
  'critère 4 : un échec tardif ne ramène ni un dead ni un processed à pending'
);
select ok(
  (select char_length(last_error) between 1 and 500 from carnet.outbox where id = '00000000-0000-4000-8000-0000000031f2'),
  'décision 7 : last_error est tronqué à 500 caractères au plus'
);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select carnet.fail_outbox('00000000-0000-4000-8000-0000000031f2', '550 5.1.1 <zoe@example.test>: recipient rejected')$$,
  'décision 7 : échec dont le message contient une adresse e-mail'
);
reset role;
select is(
  (select position('zoe@example.test' in last_error) from carnet.outbox where id = '00000000-0000-4000-8000-0000000031f2'),
  0,
  'décision 7 : last_error ne contient pas l''adresse e-mail du message d''erreur (aucune donnée personnelle)'
);

-- Décision 7 amendée : réservations seules, sans fail_outbox (n8n tombe entre l'envoi et l'acquittement).
-- h1 est réservé, son verrou vieillit de 6 minutes, et ainsi de suite : 6 appels de claim_outbox (5e tentative perdue :
-- h1 reste pending avec attempts = 5, la réservation suivante le passe dead sans le renvoyer).
-- Valeur relevée à chaque appel : attempts renvoyé pour h1, -1 s'il n'est pas renvoyé.
insert into carnet.outbox (id, type, profile_id, payload, status, attempts, created_at) values
  ('00000000-0000-4000-8000-0000000031eb', 'lead.created', '00000000-0000-4000-8000-000000003110',
   '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}', 'pending', 0, now() - interval '1 minute');
do $$
declare
  v_seen text[] := '{}';
  v_attempts integer;
begin
  for i in 1..6 loop
    select coalesce(max(c.attempts), -1) into v_attempts
      from carnet.claim_outbox(10) c where c.id = '00000000-0000-4000-8000-0000000031eb';
    v_seen := v_seen || v_attempts::text;
    update carnet.outbox set locked_at = now() - interval '6 minutes'
     where id = '00000000-0000-4000-8000-0000000031eb' and locked_at is not null;
  end loop;
  perform set_config('t0031.h1', array_to_string(v_seen, ','), true);
end
$$;
select is(
  current_setting('t0031.h1'),
  '1,2,3,4,5,-1',
  'décision 7 (amendée) : 5 réservations renvoient h1 (attempts 1 à 5) ; la 6e le passe dead sans le renvoyer'
);
select is(
  (select status || ' ' || attempts from carnet.outbox where id = '00000000-0000-4000-8000-0000000031eb'),
  'dead 5',
  'décision 7 (amendée) : après 6 réservations sans acquittement ni échec, h1 est dead et attempts reste à 5'
);

-- ---------------------------------------------------------------------------
-- Décision 8 — purges (rejouables) : outbox traitée ou morte > 30 jours, leads > 12 mois
-- ---------------------------------------------------------------------------
delete from carnet.outbox;
insert into carnet.outbox (id, type, profile_id, payload, status, attempts, processed_at, created_at) values
  ('00000000-0000-4000-8000-0000000031c1', 'lead.created', '00000000-0000-4000-8000-000000003110', '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}',
   'processed', 0, now() - interval '31 days', now() - interval '31 days'),
  ('00000000-0000-4000-8000-0000000031c2', 'lead.created', '00000000-0000-4000-8000-000000003110', '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}',
   'dead', 5, null, now() - interval '31 days'),
  ('00000000-0000-4000-8000-0000000031c3', 'lead.created', '00000000-0000-4000-8000-000000003110', '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}',
   'processed', 0, now() - interval '29 days', now() - interval '29 days'),
  ('00000000-0000-4000-8000-0000000031c4', 'lead.created', '00000000-0000-4000-8000-000000003110', '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}',
   'pending', 2, null, now() - interval '31 days'),
  ('00000000-0000-4000-8000-0000000031c5', 'lead.created', '00000000-0000-4000-8000-000000003110', '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}',
   'dead', 5, null, now() - interval '29 days'),
  ('00000000-0000-4000-8000-0000000031c6', 'lead.created', '00000000-0000-4000-8000-000000003110', '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}',
   'processed', 3, now() - interval '10 days', now() - interval '40 days');
insert into carnet.outbox (id, type, profile_id, payload, status, attempts, locked_at, processed_at, created_at) values
  ('00000000-0000-4000-8000-0000000031c7', 'lead.created', '00000000-0000-4000-8000-000000003110', '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}',
   'dead', 5, now() - interval '10 days', null, now() - interval '40 days');

select is(carnet.purge_outbox(interval '30 days'), 2, 'décision 8 : purge_outbox(30 jours) supprime 2 événements');
select is(
  (select array_agg(id::text order by id) from carnet.outbox),
  array['00000000-0000-4000-8000-0000000031c3', '00000000-0000-4000-8000-0000000031c4', '00000000-0000-4000-8000-0000000031c5',
        '00000000-0000-4000-8000-0000000031c6', '00000000-0000-4000-8000-0000000031c7'],
  'décision 8 : processed et dead de plus de 30 jours supprimés ; récents et pending (même ancien) conservés ; âge = coalesce(processed_at, locked_at, created_at) (créé il y a 40 jours, traité il y a 10 : conservé)'
);
select is(
  (select status || ' ' || attempts from carnet.outbox where id = '00000000-0000-4000-8000-0000000031c7'),
  'dead 5',
  'décision 8 (contre-revue) : un dead créé il y a 40 jours mais verrouillé il y a 10 n''est pas purgé (âge = coalesce(processed_at, locked_at, created_at))'
);
select is(carnet.purge_outbox(interval '30 days'), 0, 'décision 8 : purge_outbox rejouée ne supprime rien de plus');

delete from carnet.leads where created_at < now() - interval '11 months';
insert into carnet.leads (id, profile_id, name, email, message, consent_at, idempotency_key, created_at) values
  ('00000000-0000-4000-8000-0000000031d3', '00000000-0000-4000-8000-000000003110', 'Old', 'old@example.test', 'Ancien',
   now() - interval '12 months 1 day', '00000000-0000-4000-8000-0000000031c3', now() - interval '12 months 1 day'),
  ('00000000-0000-4000-8000-0000000031d4', '00000000-0000-4000-8000-000000003110', 'Young', 'young@example.test', 'Récent',
   now() - interval '12 months' + interval '1 day', '00000000-0000-4000-8000-0000000031c4', now() - interval '12 months' + interval '1 day');

select is(carnet.purge_leads(interval '12 months'), 1, 'décision 8 : purge_leads(12 mois) supprime 1 lead');
select is(
  (select array_agg(id::text order by id) from carnet.leads
    where id in ('00000000-0000-4000-8000-0000000031d0', '00000000-0000-4000-8000-0000000031d3', '00000000-0000-4000-8000-0000000031d4')),
  array['00000000-0000-4000-8000-0000000031d0', '00000000-0000-4000-8000-0000000031d4'],
  'décision 8 : le lead de plus de 12 mois est supprimé, ceux de moins de 12 mois conservés'
);
select is(carnet.purge_leads(interval '12 months'), 0, 'décision 8 : purge_leads rejouée ne supprime rien de plus');

select throws_ok($$select carnet.purge_outbox(null)$$, '22023', null, 'décision 8 : purge_outbox(null) refusé (22023)');
select throws_ok($$select carnet.purge_outbox(interval '0')$$, '22023', null, 'décision 8 : purge_outbox(0) refusé (22023)');
select throws_ok($$select carnet.purge_leads(null)$$, '22023', null, 'décision 8 : purge_leads(null) refusé (22023)');
select throws_ok($$select carnet.purge_leads(interval '-1 day')$$, '22023', null, 'décision 8 : purge_leads(intervalle négatif) refusé (22023)');

-- ---------------------------------------------------------------------------
-- Décision 9 — delete_own_account (0023) emporte leads et outbox du profil, rien d'autre
-- ---------------------------------------------------------------------------
insert into carnet.outbox (id, type, profile_id, payload, status, created_at) values
  ('00000000-0000-4000-8000-0000000031e8', 'lead.created', '00000000-0000-4000-8000-000000003110',
   '{"lead_id":"00000000-0000-4000-8000-0000000031d0"}', 'pending', now()),
  ('00000000-0000-4000-8000-0000000031e9', 'lead.created', '00000000-0000-4000-8000-000000003111',
   '{"lead_id":"00000000-0000-4000-8000-0000000031d1"}', 'pending', now());

select ok(
  (select count(*) > 0 from carnet.leads where profile_id = '00000000-0000-4000-8000-000000003110')
  and (select count(*) > 0 from carnet.outbox where profile_id = '00000000-0000-4000-8000-000000003110'),
  'décision 9 : avant suppression, A a des leads et des événements d''outbox'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000310a","role":"authenticated"}';
select is(carnet.delete_own_account(), 'ana-0031', 'décision 9 : A supprime son compte (delete_own_account)');
reset role;

select is(
  (select count(*) from carnet.leads where profile_id = '00000000-0000-4000-8000-000000003110')
    + (select count(*) from carnet.outbox where profile_id = '00000000-0000-4000-8000-000000003110'),
  0::bigint,
  'décision 9 : tous les leads et événements d''outbox du profil de A sont supprimés'
);
select is(
  (select count(*) from carnet.leads where id = '00000000-0000-4000-8000-0000000031d1')
    + (select count(*) from carnet.outbox where id = '00000000-0000-4000-8000-0000000031e9'),
  2::bigint,
  'décision 9 : les leads et événements de B sont intacts'
);

select * from finish();
rollback;
