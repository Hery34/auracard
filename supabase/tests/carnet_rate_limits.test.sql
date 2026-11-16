-- Fiche 0009 / ADR 0011 — table carnet.rate_limits et fonctions carnet.consume_rate_limit(text, integer, interval) returns boolean,
-- carnet.purge_rate_limits(interval) returns integer : compteur à fenêtre fixe réservé à service_role, la fonction est la seule porte.
-- Critères couverts : 1 (structure, contraintes nommées, RLS enable + force, aucune politique, aucun privilège de table ;
-- déclaratif + 42501 en situation pour anon, authenticated et service_role), 2 (signatures, definer, volatile, search_path,
-- propriétaire bypassrls, execute pour service_role seul ; 42501 en situation pour anon et authenticated), 3 (limite, refus comptés,
-- clés indépendantes, fenêtre en cours vieillie puis expirée selon p_window, expiration, 22023 — zéro, négatif, null —, 23514,
-- clé nulle 23502), 4 (purge : nombre renvoyé, lignes conservées, rejeu → 0, seuil plus court, 22023 — zéro, négatif, null),
-- 5 partiellement (rejouabilité : rollback final ; la double application de la migration est prouvée par db-architect).
-- Non dupliqués ici (couverts par carnet_schema.test.sql et carnet_profiles_schema.test.sql, même base) : « rien dans public »,
-- « aucune fonction de carnet exécutable par public », « toute table de carnet activée et forcée », « aucune relation de carnet
-- lisible par anon », « toute fonction de carnet fixe search_path », « aucune table publiée dans Realtime » : ces invariants
-- couvrent les nouveaux objets.
-- Pas de données par utilisateur : la table n'a ni politique ni grant ; un membre de carnet, un membre d'un autre projet de
-- l'instance et un visiteur anonyme sont tous renvoyés par le privilège (42501) avant toute politique. Le cas authenticated
-- (sub quelconque, non inséré dans auth.users : le privilège est vérifié avant toute lecture) vaut donc pour les deux premiers.
-- Clés de test préfixées `test-0009:` (jamais d'adresse, décision 3). Les appels nominaux se font sous `set local role service_role`
-- (claims sans sub, comme admin.ts) via lives_ok (savepoint pgTAP : une fonction absente ne fait pas avorter la transaction) ;
-- leurs valeurs de retour vont dans des tables temporaires (consume_results, purge_results). La table rate_limits n'ayant aucun
-- grant, ses lignes sont lues par postgres (bypassrls), lui aussi via lives_ok (table absente avant implémentation), copiées dans
-- rate_limits_snapshot ; les assertions portent sur ces copies.
-- now() est figé dans la transaction : l'expiration de fenêtre et l'ancienneté des lignes à purger sont posées par des update /
-- insert explicites de postgres, jamais par l'heure réelle. Les refus et les erreurs sont vérifiés par SQLSTATE seul (pas de message).
-- Tout s'exécute dans une transaction annulée : rien ne persiste (critère 5).
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(110);

-- ---------------------------------------------------------------------------
-- Critère 1 — table, colonnes, contraintes nommées, RLS, politiques, privilèges (décision 1)
-- ---------------------------------------------------------------------------
select has_table('carnet', 'rate_limits', 'critère 1 : la table carnet.rate_limits existe');
select columns_are(
  'carnet', 'rate_limits',
  array['key', 'window_start', 'count'],
  'critère 1 : rate_limits a exactement les colonnes key, window_start, count (ni id, ni horodatage de création)'
);

select col_type_is('carnet', 'rate_limits', 'key', 'text', 'critère 1 : rate_limits.key est text');
select col_not_null('carnet', 'rate_limits', 'key', 'critère 1 : rate_limits.key est not null');
select col_is_pk('carnet', 'rate_limits', 'key', 'critère 1 : rate_limits.key est la clé primaire');

select col_type_is('carnet', 'rate_limits', 'window_start', 'timestamp with time zone', 'critère 1 : rate_limits.window_start est timestamptz');
select col_not_null('carnet', 'rate_limits', 'window_start', 'critère 1 : rate_limits.window_start est not null');

select col_type_is('carnet', 'rate_limits', 'count', 'integer', 'critère 1 : rate_limits.count est integer');
select col_not_null('carnet', 'rate_limits', 'count', 'critère 1 : rate_limits.count est not null');

-- Contraintes nommées
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
     where n.nspname = 'carnet' and c.relname = 'rate_limits'
       and k.conname = 'rate_limits_pkey' and k.contype = 'p'
       and array_length(k.conkey, 1) = 1 and a.attname = 'key'
  ),
  'critère 1 : la clé primaire sur key se nomme rate_limits_pkey'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
     where n.nspname = 'carnet' and c.relname = 'rate_limits'
       and k.conname = 'rate_limits_key_length_check' and k.contype = 'c'
       and a.attname = 'key'
  ),
  'critère 1 : la contrainte check de longueur de key se nomme rate_limits_key_length_check'
);
select ok(
  exists (
    select 1
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (k.conkey)
     where n.nspname = 'carnet' and c.relname = 'rate_limits'
       and k.conname = 'rate_limits_count_check' and k.contype = 'c'
       and a.attname = 'count'
  ),
  'critère 1 : la contrainte check sur count se nomme rate_limits_count_check'
);

-- RLS enable + force, aucune politique
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'carnet' and c.relname = 'rate_limits'),
  'critère 1 : row level security activée sur carnet.rate_limits'
);
select ok(
  (select c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'carnet' and c.relname = 'rate_limits'),
  'critère 1 : row level security forcée sur carnet.rate_limits'
);
select policies_are('carnet', 'rate_limits', '{}'::name[], 'critère 1 : aucune politique sur rate_limits (la fonction est la seule porte)');

-- Privilèges de table : aucun, pour personne (décision 1)
select table_privs_are('carnet', 'rate_limits', 'anon', '{}'::name[], 'critère 1 : anon n''a aucun privilège sur rate_limits');
select table_privs_are('carnet', 'rate_limits', 'authenticated', '{}'::name[], 'critère 1 : authenticated n''a aucun privilège sur rate_limits');
select table_privs_are('carnet', 'rate_limits', 'service_role', '{}'::name[], 'critère 1 : service_role n''a aucun privilège sur rate_limits (seule consume_rate_limit y écrit)');
select table_privs_are('carnet', 'rate_limits', 'public', '{}'::name[], 'critère 1 : public n''a aucun privilège sur rate_limits');

-- ---------------------------------------------------------------------------
-- Critère 2 — consume_rate_limit(text, integer, interval) returns boolean (décision 2)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'consume_rate_limit', array['text', 'integer', 'interval'], 'critère 2 : carnet.consume_rate_limit(text, integer, interval) existe');
select function_returns('carnet', 'consume_rate_limit', array['text', 'integer', 'interval'], 'boolean', 'critère 2 : consume_rate_limit renvoie boolean');
select is_definer('carnet', 'consume_rate_limit', array['text', 'integer', 'interval'], 'critère 2 : consume_rate_limit est security definer');
select volatility_is('carnet', 'consume_rate_limit', array['text', 'integer', 'interval'], 'volatile', 'critère 2 : consume_rate_limit est volatile');
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'consume_rate_limit'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 2 : consume_rate_limit fixe set search_path = '''' (proconfig)'
);
select ok(
  coalesce((
    select bool_and(r.rolbypassrls or r.rolsuper)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
     where n.nspname = 'carnet' and p.proname = 'consume_rate_limit'
  ), false),
  'critère 2 : le propriétaire de consume_rate_limit (security definer) contourne la RLS'
);
-- ADR 0010 §2 et §4 (repris par 0011) : sous service_role auth.uid() est nul et is_member()/can_* valent false ;
-- l'identité est la clé passée en paramètre, la fonction ne doit s'appuyer sur aucun d'eux.
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'consume_rate_limit'
       and pg_get_functiondef(p.oid) !~* '(auth\.uid\(|carnet\.is_member\(|carnet\.can_|platform\.is_project_member\()'
  ),
  'critère 2 (ADR 0010 §2) : consume_rate_limit n''appelle ni auth.uid() ni is_member()/is_project_member()/can_* (identité = clé)'
);
select function_privs_are('carnet', 'consume_rate_limit', array['text', 'integer', 'interval'], 'service_role', array['EXECUTE'], 'critère 2 : execute accordé à service_role sur consume_rate_limit');
select function_privs_are('carnet', 'consume_rate_limit', array['text', 'integer', 'interval'], 'anon', '{}'::name[], 'critère 2 : execute révoqué pour anon sur consume_rate_limit');
select function_privs_are('carnet', 'consume_rate_limit', array['text', 'integer', 'interval'], 'authenticated', '{}'::name[], 'critère 2 : execute révoqué pour authenticated sur consume_rate_limit');
select function_privs_are('carnet', 'consume_rate_limit', array['text', 'integer', 'interval'], 'public', '{}'::name[], 'critère 2 : execute révoqué pour public sur consume_rate_limit');

-- ---------------------------------------------------------------------------
-- Critère 2 — purge_rate_limits(interval) returns integer (décision 4)
-- ---------------------------------------------------------------------------
select has_function('carnet', 'purge_rate_limits', array['interval'], 'critère 2 : carnet.purge_rate_limits(interval) existe');
select function_returns('carnet', 'purge_rate_limits', array['interval'], 'integer', 'critère 2 : purge_rate_limits renvoie integer');
select is_definer('carnet', 'purge_rate_limits', array['interval'], 'critère 2 : purge_rate_limits est security definer');
select volatility_is('carnet', 'purge_rate_limits', array['interval'], 'volatile', 'critère 2 : purge_rate_limits est volatile');
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'purge_rate_limits'
       and p.proconfig @> array['search_path=""']
  ),
  'critère 2 : purge_rate_limits fixe set search_path = '''' (proconfig)'
);
select ok(
  coalesce((
    select bool_and(r.rolbypassrls or r.rolsuper)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
     where n.nspname = 'carnet' and p.proname = 'purge_rate_limits'
  ), false),
  'critère 2 : le propriétaire de purge_rate_limits (security definer) contourne la RLS'
);
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'carnet'
       and p.proname = 'purge_rate_limits'
       and pg_get_functiondef(p.oid) !~* '(auth\.uid\(|carnet\.is_member\(|carnet\.can_|platform\.is_project_member\()'
  ),
  'critère 2 (ADR 0010 §2) : purge_rate_limits n''appelle ni auth.uid() ni is_member()/is_project_member()/can_*'
);
select function_privs_are('carnet', 'purge_rate_limits', array['interval'], 'service_role', array['EXECUTE'], 'critère 2 : execute accordé à service_role sur purge_rate_limits');
select function_privs_are('carnet', 'purge_rate_limits', array['interval'], 'anon', '{}'::name[], 'critère 2 : execute révoqué pour anon sur purge_rate_limits');
select function_privs_are('carnet', 'purge_rate_limits', array['interval'], 'authenticated', '{}'::name[], 'critère 2 : execute révoqué pour authenticated sur purge_rate_limits');
select function_privs_are('carnet', 'purge_rate_limits', array['interval'], 'public', '{}'::name[], 'critère 2 : execute révoqué pour public sur purge_rate_limits');

-- ---------------------------------------------------------------------------
-- Critères 1 et 2 — en situation : ni authenticated (sub quelconque) ni anon n'appellent les fonctions ni ne lisent la table ;
-- service_role ne lit ni n'écrit la table directement.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000901","role":"authenticated"}';
select throws_ok(
  $$select carnet.consume_rate_limit('test-0009:x', 1, interval '1 hour')$$,
  '42501', null, 'critère 2 : le rôle authenticated ne peut pas appeler consume_rate_limit'
);
select throws_ok(
  $$select carnet.purge_rate_limits(interval '1 hour')$$,
  '42501', null, 'critère 2 : le rôle authenticated ne peut pas appeler purge_rate_limits'
);
select throws_ok(
  $$select count(*) from carnet.rate_limits$$,
  '42501', null, 'critère 1 : le rôle authenticated ne peut pas lire rate_limits'
);
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select carnet.consume_rate_limit('test-0009:x', 1, interval '1 hour')$$,
  '42501', null, 'critère 2 : le rôle anon ne peut pas appeler consume_rate_limit'
);
select throws_ok(
  $$select carnet.purge_rate_limits(interval '1 hour')$$,
  '42501', null, 'critère 2 : le rôle anon ne peut pas appeler purge_rate_limits'
);
select throws_ok(
  $$select count(*) from carnet.rate_limits$$,
  '42501', null, 'critère 1 : le rôle anon ne peut pas lire rate_limits'
);
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select count(*) from carnet.rate_limits$$,
  '42501', null, 'critère 1 : service_role ne lit pas rate_limits directement (la fonction est la seule porte)'
);
select throws_ok(
  $$insert into carnet.rate_limits (key, window_start, count) values ('test-0009:direct', now(), 1)$$,
  '42501', null, 'critère 1 : service_role n''écrit pas dans rate_limits directement'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 1 — contrainte count en comportement (postgres, bypassrls) ; les contraintes sur key sont exercées au critère 3
-- par la fonction, seul chemin d'écriture réel.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into carnet.rate_limits (key, window_start, count) values ('test-0009:negative', now(), -1)$$,
  '23514', null, 'critère 1 (décision 1) : count = -1 est refusé (rate_limits_count_check)'
);

-- ---------------------------------------------------------------------------
-- Tables temporaires (postgres) : valeurs renvoyées par les appels sous service_role, copies des lignes lues par postgres.
-- ---------------------------------------------------------------------------
create temp table consume_results (label text primary key, allowed boolean);
create temp table purge_results (label text primary key, purged integer);
grant select, insert on consume_results, purge_results to service_role;
create temp table rate_limits_snapshot (
  label text, key text, window_start timestamptz, count integer,
  primary key (label, key)
);

-- ---------------------------------------------------------------------------
-- Critère 3 — clé test-0009:a, limite 3, fenêtre 1 heure : trois true, puis false, false ; count = 5 (décisions 2 et 5)
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into consume_results (label, allowed) select 'a1', carnet.consume_rate_limit('test-0009:a', 3, interval '1 hour')$$,
  'critère 3 : premier appel sur test-0009:a (limite 3, fenêtre 1 h)'
);
select lives_ok(
  $$insert into consume_results (label, allowed) select 'a2', carnet.consume_rate_limit('test-0009:a', 3, interval '1 hour')$$,
  'critère 3 : deuxième appel sur test-0009:a'
);
select lives_ok(
  $$insert into consume_results (label, allowed) select 'a3', carnet.consume_rate_limit('test-0009:a', 3, interval '1 hour')$$,
  'critère 3 : troisième appel sur test-0009:a'
);
select lives_ok(
  $$insert into consume_results (label, allowed) select 'a4', carnet.consume_rate_limit('test-0009:a', 3, interval '1 hour')$$,
  'critère 3 : quatrième appel sur test-0009:a'
);
select lives_ok(
  $$insert into consume_results (label, allowed) select 'a5', carnet.consume_rate_limit('test-0009:a', 3, interval '1 hour')$$,
  'critère 3 : cinquième appel sur test-0009:a'
);
reset role;

select results_eq(
  $$select label, allowed from consume_results where label in ('a1', 'a2', 'a3', 'a4', 'a5') order by label$$,
  $$values ('a1'::text, true), ('a2'::text, true), ('a3'::text, true), ('a4'::text, false), ('a5'::text, false)$$,
  'critère 3 : trois appels acceptés (true), quatrième et cinquième refusés (false)'
);
select lives_ok(
  $$insert into rate_limits_snapshot (label, key, window_start, count)
    select 'a_after_five', key, window_start, count from carnet.rate_limits where key = 'test-0009:a'$$,
  'critère 3 : postgres lit la ligne test-0009:a après cinq appels'
);
select is(
  (select count from rate_limits_snapshot where label = 'a_after_five' and key = 'test-0009:a'),
  5,
  'critère 3 (décision 5) : count = 5 après cinq appels, les refus comptent (un rejeu consomme une unité de plus)'
);

-- ---------------------------------------------------------------------------
-- Critère 3 — clé test-0009:b indépendante : premier appel true alors que a est épuisée ; a reste à 5, b à 1
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into consume_results (label, allowed) select 'b1', carnet.consume_rate_limit('test-0009:b', 3, interval '1 hour')$$,
  'critère 3 : premier appel sur test-0009:b alors que test-0009:a est épuisée'
);
reset role;

select is(
  (select allowed from consume_results where label = 'b1'),
  true,
  'critère 3 : test-0009:b est acceptée (true) : les clés sont indépendantes'
);
select lives_ok(
  $$insert into rate_limits_snapshot (label, key, window_start, count)
    select 'after_b', key, window_start, count from carnet.rate_limits where key in ('test-0009:a', 'test-0009:b')$$,
  'critère 3 : postgres lit les lignes test-0009:a et test-0009:b après l''appel sur b'
);
select results_eq(
  $$select key, count from rate_limits_snapshot where label = 'after_b' order by key$$,
  $$values ('test-0009:a'::text, 5), ('test-0009:b'::text, 1)$$,
  'critère 3 : une ligne par clé, a reste à 5 et b est à 1'
);

-- ---------------------------------------------------------------------------
-- Critère 3 (amendé par la revue) — fenêtre en cours vieillie : postgres recule window_start de b de 30 minutes (count = 1).
-- Avec p_window = 1 h la fenêtre court encore : incrément (count = 2) et window_start inchangé. Avec p_window = 10 minutes
-- la même ligne est expirée : nouvelle fenêtre (count = 1, window_start = now()). Tue un mutant qui ignore p_window,
-- code la fenêtre en dur ou réécrit window_start à chaque incrément.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update carnet.rate_limits set window_start = now() - interval '30 minutes' where key = 'test-0009:b'$$,
  'critère 3 : postgres recule window_start de test-0009:b de 30 minutes (fenêtre en cours)'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into consume_results (label, allowed) select 'b_aged', carnet.consume_rate_limit('test-0009:b', 3, interval '1 hour')$$,
  'critère 3 : appel sur test-0009:b avec p_window = 1 h, fenêtre vieille de 30 minutes'
);
reset role;

select is(
  (select allowed from consume_results where label = 'b_aged'),
  true,
  'critère 3 : fenêtre en cours : l''appel est accepté (true)'
);
select lives_ok(
  $$insert into rate_limits_snapshot (label, key, window_start, count)
    select 'b_aged', key, window_start, count from carnet.rate_limits where key = 'test-0009:b'$$,
  'critère 3 : postgres lit la ligne test-0009:b après l''appel sur fenêtre en cours'
);
select is(
  (select count from rate_limits_snapshot where label = 'b_aged' and key = 'test-0009:b'),
  2,
  'critère 3 : fenêtre en cours : count passe à 2'
);
select is(
  (select window_start from rate_limits_snapshot where label = 'b_aged' and key = 'test-0009:b'),
  now() - interval '30 minutes',
  'critère 3 : fenêtre en cours : window_start inchangé (now() - 30 minutes), un incrément ne réécrit pas la fenêtre'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into consume_results (label, allowed) select 'b_short', carnet.consume_rate_limit('test-0009:b', 3, interval '10 minutes')$$,
  'critère 3 : appel sur test-0009:b avec p_window = 10 minutes, fenêtre vieille de 30 minutes'
);
reset role;

select is(
  (select allowed from consume_results where label = 'b_short'),
  true,
  'critère 3 : la fenêtre de 10 minutes est expirée : l''appel est accepté (true)'
);
select lives_ok(
  $$insert into rate_limits_snapshot (label, key, window_start, count)
    select 'b_short', key, window_start, count from carnet.rate_limits where key = 'test-0009:b'$$,
  'critère 3 : postgres lit la ligne test-0009:b après l''appel à fenêtre courte'
);
select is(
  (select count from rate_limits_snapshot where label = 'b_short' and key = 'test-0009:b'),
  1,
  'critère 3 : fenêtre de 10 minutes expirée : count = 1 (p_window est bien pris en compte)'
);
select is(
  (select window_start from rate_limits_snapshot where label = 'b_short' and key = 'test-0009:b'),
  now(),
  'critère 3 : fenêtre de 10 minutes expirée : window_start = now()'
);

-- ---------------------------------------------------------------------------
-- Critère 3 — fenêtre expirée : postgres recule window_start de a de deux heures (fenêtre 1 h) ; l'appel suivant ouvre une
-- nouvelle fenêtre : true, count = 1, window_start = now() (now() est figé dans la transaction, l'heure réelle n'intervient pas)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update carnet.rate_limits set window_start = now() - interval '2 hours' where key = 'test-0009:a'$$,
  'critère 3 : postgres recule window_start de test-0009:a de deux heures (fenêtre expirée)'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into consume_results (label, allowed) select 'a_expired', carnet.consume_rate_limit('test-0009:a', 3, interval '1 hour')$$,
  'critère 3 : appel sur test-0009:a après expiration de la fenêtre'
);
reset role;

select is(
  (select allowed from consume_results where label = 'a_expired'),
  true,
  'critère 3 : après expiration de la fenêtre, l''appel est accepté (true)'
);
select lives_ok(
  $$insert into rate_limits_snapshot (label, key, window_start, count)
    select 'a_renewed', key, window_start, count from carnet.rate_limits where key = 'test-0009:a'$$,
  'critère 3 : postgres lit la ligne test-0009:a après renouvellement de la fenêtre'
);
select is(
  (select count from rate_limits_snapshot where label = 'a_renewed' and key = 'test-0009:a'),
  1,
  'critère 3 : nouvelle fenêtre : count = 1'
);
select is(
  (select window_start from rate_limits_snapshot where label = 'a_renewed' and key = 'test-0009:a'),
  now(),
  'critère 3 : nouvelle fenêtre : window_start = now() (horloge de la transaction)'
);

-- ---------------------------------------------------------------------------
-- Critère 3 — arguments invalides (décision 2 : p_limit ≤ 0 ou p_window ≤ 0 → 22023) ; clé hors longueur (décision 1 :
-- la contrainte rate_limits_key_length_check remonte telle quelle, 23514) ; clé de 128 caractères acceptée.
-- throws_ok s'exécute sous savepoint : aucune ligne ne subsiste pour ces clés.
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select carnet.consume_rate_limit('test-0009:limit', 0, interval '1 hour')$$,
  '22023', null, 'critère 3 (décision 2) : p_limit = 0 lève 22023'
);
select throws_ok(
  $$select carnet.consume_rate_limit('test-0009:limit', -1, interval '1 hour')$$,
  '22023', null, 'critère 3 (décision 2) : p_limit = -1 lève 22023'
);
select throws_ok(
  $$select carnet.consume_rate_limit('test-0009:window', 3, interval '0')$$,
  '22023', null, 'critère 3 (décision 2) : p_window = interval ''0'' lève 22023'
);
select throws_ok(
  $$select carnet.consume_rate_limit('test-0009:window', 3, interval '-1 minute')$$,
  '22023', null, 'critère 3 (décision 2) : p_window négatif lève 22023'
);
select throws_ok(
  $$select carnet.consume_rate_limit('test-0009:limit', null, interval '1 hour')$$,
  '22023', null, 'critère 3 (décision 2) : p_limit null lève 22023'
);
select throws_ok(
  $$select carnet.consume_rate_limit('test-0009:window', 3, null)$$,
  '22023', null, 'critère 3 (décision 2) : p_window null lève 22023'
);
-- Clé nulle : pas de pré-validation, la contrainte not null de la clé primaire remonte telle quelle.
select throws_ok(
  $$select carnet.consume_rate_limit(null, 3, interval '1 hour')$$,
  '23502', null, 'critère 3 (décision 1) : p_key null lève 23502 (rate_limits.key not null)'
);
select throws_ok(
  $$select carnet.consume_rate_limit('', 3, interval '1 hour')$$,
  '23514', null, 'critère 3 (décision 1) : une clé vide lève 23514 (rate_limits_key_length_check)'
);
select throws_ok(
  $$select carnet.consume_rate_limit('test-0009:' || repeat('k', 119), 3, interval '1 hour')$$,
  '23514', null, 'critère 3 (décision 1) : une clé de 129 caractères lève 23514 (rate_limits_key_length_check)'
);
select lives_ok(
  $$insert into consume_results (label, allowed) select 'k128', carnet.consume_rate_limit('test-0009:' || repeat('k', 118), 3, interval '1 hour')$$,
  'critère 3 (décision 1) : une clé de 128 caractères passe la contrainte de longueur'
);
reset role;

select is(
  (select allowed from consume_results where label = 'k128'),
  true,
  'critère 3 (décision 1) : le premier appel sur la clé de 128 caractères renvoie true'
);

-- ---------------------------------------------------------------------------
-- Critère 4 — purge_rate_limits(interval '1 hour') : supprime les fenêtres ouvertes il y a plus d'une heure, renvoie leur
-- nombre, laisse les autres ; rejouée → 0 (idempotence.md). Décision 4 : consume_rate_limit ne purge pas.
-- Le nombre renvoyé porte sur toute la table : des lignes réelles d'une session locale (0007) pourraient le fausser ;
-- postgres les neutralise dans la transaction (annulé par le rollback). Les clés a, b et k128 ont window_start = now().
-- ---------------------------------------------------------------------------
select lives_ok(
  $$delete from carnet.rate_limits where key not like 'test-0009:%'$$,
  'critère 4 : postgres neutralise les lignes étrangères à la fiche (annulé par le rollback)'
);
select lives_ok(
  $$insert into carnet.rate_limits (key, window_start, count) values
      ('test-0009:purge-old', now() - interval '3 hours', 4),
      ('test-0009:purge-recent', now() - interval '30 minutes', 2),
      ('test-0009:purge-now', now(), 1)$$,
  'critère 4 : postgres insère trois lignes : fenêtres ouvertes il y a 3 h, 30 min et maintenant'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into consume_results (label, allowed) select 'c1', carnet.consume_rate_limit('test-0009:c', 3, interval '1 hour')$$,
  'décision 4 : appel sur test-0009:c en présence d''une ligne ancienne'
);
reset role;

select lives_ok(
  $$insert into rate_limits_snapshot (label, key, window_start, count)
    select 'before_purge', key, window_start, count from carnet.rate_limits where key like 'test-0009:purge-%'$$,
  'critère 4 : postgres lit les trois lignes avant purge'
);
select is(
  (select count(*) from rate_limits_snapshot where label = 'before_purge'),
  3::bigint,
  'décision 4 : consume_rate_limit ne supprime aucune ligne ancienne (pas de purge paresseuse)'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into purge_results (label, purged) select 'p1', carnet.purge_rate_limits(interval '1 hour')$$,
  'critère 4 : service_role appelle purge_rate_limits(interval ''1 hour'')'
);
reset role;

select is(
  (select purged from purge_results where label = 'p1'),
  1,
  'critère 4 : purge_rate_limits renvoie 1 (seule la fenêtre ouverte il y a 3 h a plus d''une heure)'
);
select lives_ok(
  $$insert into rate_limits_snapshot (label, key, window_start, count)
    select 'after_purge', key, window_start, count from carnet.rate_limits where key like 'test-0009:purge-%'$$,
  'critère 4 : postgres lit les lignes restantes après purge'
);
select results_eq(
  $$select key from rate_limits_snapshot where label = 'after_purge' order by key$$,
  $$values ('test-0009:purge-now'::text), ('test-0009:purge-recent'::text)$$,
  'critère 4 : les fenêtres ouvertes il y a 30 min et maintenant restent, celle de 3 h est supprimée'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into purge_results (label, purged) select 'p2', carnet.purge_rate_limits(interval '1 hour')$$,
  'critère 4 : purge_rate_limits rejouée avec le même argument'
);
reset role;

select is(
  (select purged from purge_results where label = 'p2'),
  0,
  'critère 4 (idempotence) : la seconde purge renvoie 0'
);
select lives_ok(
  $$insert into rate_limits_snapshot (label, key, window_start, count)
    select 'after_replay', key, window_start, count from carnet.rate_limits where key like 'test-0009:purge-%'$$,
  'critère 4 : postgres lit les lignes après le rejeu de la purge'
);
select is(
  (select count(*) from rate_limits_snapshot where label = 'after_replay'),
  2::bigint,
  'critère 4 (idempotence) : les deux lignes restantes sont intactes après le rejeu'
);

-- Seuil plus court (revue) : à 20 minutes, la fenêtre ouverte il y a 30 minutes est à son tour supprimée ; purge-now reste.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into purge_results (label, purged) select 'p3', carnet.purge_rate_limits(interval '20 minutes')$$,
  'critère 4 : service_role appelle purge_rate_limits(interval ''20 minutes'')'
);
reset role;

select is(
  (select purged from purge_results where label = 'p3'),
  1,
  'critère 4 : purge_rate_limits(20 minutes) renvoie 1 (la fenêtre ouverte il y a 30 minutes)'
);
select lives_ok(
  $$insert into rate_limits_snapshot (label, key, window_start, count)
    select 'after_purge_20', key, window_start, count from carnet.rate_limits where key like 'test-0009:purge-%'$$,
  'critère 4 : postgres lit les lignes restantes après la purge à 20 minutes'
);
select results_eq(
  $$select key from rate_limits_snapshot where label = 'after_purge_20' order by key$$,
  $$values ('test-0009:purge-now'::text)$$,
  'critère 4 : seule la fenêtre ouverte maintenant reste après la purge à 20 minutes'
);

-- Critère 4 (amendé par l'audit) — même garde que consume_rate_limit : p_older_than ≤ 0 ou null → 22023
-- (une purge « plus vieux que zéro » viderait toute la table). throws_ok s'exécute sous savepoint : rien n'est supprimé.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select carnet.purge_rate_limits(interval '0')$$,
  '22023', null, 'critère 4 : purge_rate_limits(interval ''0'') lève 22023'
);
select throws_ok(
  $$select carnet.purge_rate_limits(interval '-1 hour')$$,
  '22023', null, 'critère 4 : purge_rate_limits négatif lève 22023'
);
select throws_ok(
  $$select carnet.purge_rate_limits(null)$$,
  '22023', null, 'critère 4 : purge_rate_limits(null) lève 22023'
);
reset role;

select * from finish();
rollback;
