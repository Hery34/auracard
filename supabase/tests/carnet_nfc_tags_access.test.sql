-- Fiche 0024 — carnet.nfc_tags : comportements par persona.
-- Critères couverts : 1 (provision_nfc_tags), 2 (activate_nfc_tag), 3 (resolve_nfc_tag), 4 (lecture des puces),
-- 5 (set_nfc_tag_enabled, release_nfc_tag), 7 (suppression du profil). Structure et grants : carnet_nfc_tags_schema.test.sql.
-- Contrat figé pour db-architect (interprétations les plus strictes, voir rapport 0024) :
--   provision_nfc_tags : activation_code renvoyé au format affiché XXXXX-XXXXX, majuscules de l'alphabet Crockford
--     (^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$) ; hash bcrypt ($2a$/$2b$…) ; p_count hors [1, 500] ou nul → 22023 ;
--     batch_id rejoué → erreur (SQLSTATE libre), aucune puce créée.
--   activate_nfc_tag : appelant non membre de carnet (compte d'un autre projet) → 42501 ; code nul ou uid nul → invalid ;
--     already_yours exige aussi le bon code (mauvais code sur sa propre puce → invalid) ; sa propre puce désactivée → invalid ;
--     already_yours n'écrit rien (ctid inchangé : aucune nouvelle version de ligne, donc ni updated_at ni activated_at) ; activated pose activated_at.
--   resolve_nfc_tag : toujours exactement une ligne, (not_found, null) pour inconnue, désactivée, profil non publié, uid nul.
--   set_nfc_tag_enabled / release_nfc_tag : non membre → 42501 ; puce d'un autre membre ou en stock → false sans effet ;
--     rejeu sans changement d'état → aucune écriture (ctid inchangé) ; set_nfc_tag_enabled rejoué renvoie true ;
--     release_nfc_tag rejoué renvoie false (la puce n'appartient plus à l'appelant) sans erreur.
-- Ajouts après audit (décision 9) : hash $2a$08$ ; code nul ou vide → invalid sans aucun parcours de carnet.nfc_tags
--   (pg_stat_xact_user_tables, témoin positif) ; 10 essais par heure et par compte (clé nfc-activate:<auth.uid()>),
--   11e → rate_limited (valeur) sans écriture, compteur à 11 conservé, autre compte non affecté, fenêtre d'une heure.
--   Le compteur de A est remis à zéro (postgres) entre les blocs pour que les tests antérieurs restent sous la limite.
-- Les uid et codes provisionnés sont mémorisés dans des réglages locaux à la transaction (test0024.*) via set_config.
-- Personas (UUID fixes, plage 0…24xx hors 0…24c*/0…24d*/0…24e*/0…24f*, réservés au fichier schema) :
--   A  0…240a  membre (owner) de carnet, profil 0…2410 publié (slug alice-0024)
--   B  0…240b  membre (user) de carnet, profil 0…2411 publié (slug bob-0024)
--   U  0…2409  membre (user) de carnet, profil 0…2412 NON publié (slug una-0024)
--   N  0…240e  membre (user) de carnet sans profil
--   C  0…240d  membre de other_0024 (projet 0…2402), profil orphelin 0…2413 publié (slug carl-0024)
--   D  0…2408  membre (user) de carnet, profil 0…2414 (slug dora-0024), supprimé par cascade de auth.users
--   E  0…2407  membre (user) de carnet, profil 0…2415 (slug emma-0024), supprimé par service_role
--   R  0…2406  membre (user) de carnet, profil 0…2416 publié (slug rita-0024), limite d'essais (décision 9)
--   anon       rôle anon, claims sans sub
-- Puces : lot 0…24a1 de 10 puces provisionnées par service_role ; rang n → réglages test0024.uidN, test0024.codeN, test0024.idN.
--   1 stock (A l'active)          2 assigned à B           3 disabled chez B        4 assigned à U (non publié)
--   5 stock (refus et no_profile) 6 assigned à C (orphelin) 7 assigned à D          8 disabled chez D
--   9 assigned à E                10 stock (activée par A en fin de fichier, casse mixte)
-- Fixtures créées par postgres (bypassrls) dans la transaction, annulées par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(125);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000240a', 'a-carnet-0024@test.local'),
  ('00000000-0000-4000-8000-00000000240b', 'b-carnet-0024@test.local'),
  ('00000000-0000-4000-8000-000000002409', 'u-carnet-0024@test.local'),
  ('00000000-0000-4000-8000-00000000240e', 'n-carnet-0024@test.local'),
  ('00000000-0000-4000-8000-00000000240d', 'c-other-0024@test.local'),
  ('00000000-0000-4000-8000-000000002408', 'd-carnet-0024@test.local'),
  ('00000000-0000-4000-8000-000000002407', 'e-carnet-0024@test.local'),
  ('00000000-0000-4000-8000-000000002406', 'r-carnet-0024@test.local');

insert into platform.projects (id, slug, name, db_schema)
  values ('00000000-0000-4000-8000-000000002402', 'other_0024', 'Other 0024', 'other_0024');

insert into platform.project_members (project_id, user_id, role)
  select id, '00000000-0000-4000-8000-00000000240a', 'owner' from platform.projects where slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  select p.id, u.id, 'user'
    from platform.projects p
   cross join (values ('00000000-0000-4000-8000-00000000240b'::uuid), ('00000000-0000-4000-8000-000000002409'::uuid),
                      ('00000000-0000-4000-8000-00000000240e'::uuid), ('00000000-0000-4000-8000-000000002408'::uuid),
                      ('00000000-0000-4000-8000-000000002407'::uuid), ('00000000-0000-4000-8000-000000002406'::uuid)) as u (id)
   where p.slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  values ('00000000-0000-4000-8000-000000002402', '00000000-0000-4000-8000-00000000240d', 'user');

insert into carnet.profiles (id, owner_id, slug, display_name, is_published) values
  ('00000000-0000-4000-8000-000000002410', '00000000-0000-4000-8000-00000000240a', 'alice-0024', 'Alice', true),
  ('00000000-0000-4000-8000-000000002411', '00000000-0000-4000-8000-00000000240b', 'bob-0024', 'Bob', true),
  ('00000000-0000-4000-8000-000000002412', '00000000-0000-4000-8000-000000002409', 'una-0024', 'Una', false),
  ('00000000-0000-4000-8000-000000002413', '00000000-0000-4000-8000-00000000240d', 'carl-0024', 'Carl', true),
  ('00000000-0000-4000-8000-000000002414', '00000000-0000-4000-8000-000000002408', 'dora-0024', 'Dora', true),
  ('00000000-0000-4000-8000-000000002415', '00000000-0000-4000-8000-000000002407', 'emma-0024', 'Emma', true),
  ('00000000-0000-4000-8000-000000002416', '00000000-0000-4000-8000-000000002406', 'rita-0024', 'Rita', true);

-- ---------------------------------------------------------------------------
-- Critère 1 — provision_nfc_tags : refus pour anon et authenticated
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select * from carnet.provision_nfc_tags('00000000-0000-4000-8000-0000000024a9', 1)$$,
  '42501', null, 'critère 1 : provision_nfc_tags refusée à anon (42501)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select throws_ok(
  $$select * from carnet.provision_nfc_tags('00000000-0000-4000-8000-0000000024a9', 1)$$,
  '42501', null, 'critère 1 : provision_nfc_tags refusée à authenticated, même membre owner (42501)'
);
reset role;

select is(
  (select count(*) from carnet.nfc_tags where batch_id = '00000000-0000-4000-8000-0000000024a9'),
  0::bigint,
  'critère 1 : aucune puce créée par les appels refusés (contrôle postgres)'
);

-- ---------------------------------------------------------------------------
-- Critère 1 — provision_nfc_tags par service_role : lot de 10
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
do $$
declare
  r record;
  n integer := 0;
begin
  for r in select * from carnet.provision_nfc_tags('00000000-0000-4000-8000-0000000024a1', 10) loop
    n := n + 1;
    perform set_config('test0024.uid' || n, r.uid, true);
    perform set_config('test0024.code' || n, r.activation_code, true);
  end loop;
  perform set_config('test0024.count', n::text, true);
end
$$;
reset role;

do $$
begin
  for n in 1..10 loop
    perform set_config('test0024.id' || n,
      (select id::text from carnet.nfc_tags where uid = current_setting('test0024.uid' || n)), true);
  end loop;
end
$$;

select is(current_setting('test0024.count'), '10', 'critère 1 : provision_nfc_tags renvoie exactement p_count lignes');
select is(
  (select count(*) from carnet.nfc_tags where batch_id = '00000000-0000-4000-8000-0000000024a1'),
  10::bigint,
  'critère 1 : 10 puces créées avec le batch_id du lot'
);
select is(
  (select count(*) from carnet.nfc_tags
    where batch_id = '00000000-0000-4000-8000-0000000024a1' and status = 'stock' and profile_id is null and activated_at is null),
  10::bigint,
  'critère 1 : les puces créées sont en stock, sans profil ni date d''activation'
);
select is(
  (select count(distinct current_setting('test0024.uid' || n)) from generate_series(1, 10) n),
  10::bigint,
  'critère 1 : les 10 uid renvoyés sont distincts'
);
select is(
  (select count(distinct current_setting('test0024.code' || n)) from generate_series(1, 10) n),
  10::bigint,
  'critère 1 : les 10 codes d''activation renvoyés sont distincts'
);
select is(
  (select count(*) from generate_series(1, 10) n where current_setting('test0024.uid' || n) ~ '^[0-9a-hjkmnp-tv-z]{12}$'),
  10::bigint,
  'critère 1 (décision 1) : chaque uid fait 12 caractères de l''alphabet [0-9a-hjkmnp-tv-z]'
);
select is(
  (select count(*) from generate_series(1, 10) n
    where current_setting('test0024.code' || n) ~ '^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$'),
  10::bigint,
  'critère 1 (décision 2) : chaque code est renvoyé au format affiché XXXXX-XXXXX (10 caractères de l''alphabet, majuscules)'
);
select is(
  (select count(*) from carnet.nfc_tags t
    where t.batch_id = '00000000-0000-4000-8000-0000000024a1'
      and t.activation_code_hash ~ '^\$2[abxy]\$[0-9]{2}\$'),
  10::bigint,
  'critère 1 (décision 2) : activation_code_hash est un hash bcrypt'
);
select is(
  (select count(*) from carnet.nfc_tags t
    where t.batch_id = '00000000-0000-4000-8000-0000000024a1'
      and t.activation_code_hash ~ '^\$2a\$08\$'),
  10::bigint,
  'décision 9 : chaque hash provisionné commence par $2a$08$ (gen_salt(''bf'', 8))'
);
select is(
  (select count(*) from carnet.nfc_tags t
     join generate_series(1, 10) n on t.uid = current_setting('test0024.uid' || n)
    where strpos(lower(t.activation_code_hash), lower(replace(current_setting('test0024.code' || n), '-', ''))) > 0),
  0::bigint,
  'critère 1 (décision 2) : aucun hash ne contient le code en clair'
);
select is(
  (select count(distinct activation_code_hash) from carnet.nfc_tags where batch_id = '00000000-0000-4000-8000-0000000024a1'),
  10::bigint,
  'critère 1 (décision 2) : les hash sont distincts (sel par puce)'
);

-- Rejeu du lot et bornes de p_count
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select * from carnet.provision_nfc_tags('00000000-0000-4000-8000-0000000024a1', 10)$$,
  null::char(5), null, 'critère 1 : rejouer un batch_id déjà utilisé lève une erreur'
);
select throws_ok(
  $$select * from carnet.provision_nfc_tags('00000000-0000-4000-8000-0000000024a1', 1)$$,
  null::char(5), null, 'critère 1 : rejouer un batch_id déjà utilisé avec un autre p_count lève aussi une erreur'
);
select throws_ok(
  $$select * from carnet.provision_nfc_tags('00000000-0000-4000-8000-0000000024a2', 0)$$,
  '22023', null, 'décision 6 : p_count = 0 refusé (22023)'
);
select throws_ok(
  $$select * from carnet.provision_nfc_tags('00000000-0000-4000-8000-0000000024a2', -1)$$,
  '22023', null, 'décision 6 : p_count négatif refusé (22023)'
);
select throws_ok(
  $$select * from carnet.provision_nfc_tags('00000000-0000-4000-8000-0000000024a2', 501)$$,
  '22023', null, 'décision 6 : p_count = 501 refusé (22023)'
);
select throws_ok(
  $$select * from carnet.provision_nfc_tags('00000000-0000-4000-8000-0000000024a2', null)$$,
  '22023', null, 'décision 6 : p_count nul refusé (22023)'
);
reset role;
select is(
  (select count(*) from carnet.nfc_tags where batch_id in ('00000000-0000-4000-8000-0000000024a1', '00000000-0000-4000-8000-0000000024a2')),
  10::bigint,
  'critère 1 : rejeux et bornes refusés n''ont créé aucune puce'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(
  (select count(distinct uid) from carnet.provision_nfc_tags('00000000-0000-4000-8000-0000000024a3', 500)),
  500::bigint,
  'décision 6 : p_count = 500 (borne haute) accepté, 500 uid distincts'
);
reset role;
select is(
  (select count(*) from carnet.nfc_tags where batch_id = '00000000-0000-4000-8000-0000000024a3' and status = 'stock'),
  500::bigint,
  'décision 6 : 500 puces en stock créées pour le lot à la borne haute'
);

-- Affectations de départ (postgres)
update carnet.nfc_tags set status = 'assigned', profile_id = '00000000-0000-4000-8000-000000002411', activated_at = now()
 where id = current_setting('test0024.id2')::uuid;
update carnet.nfc_tags set status = 'disabled', profile_id = '00000000-0000-4000-8000-000000002411', activated_at = now()
 where id = current_setting('test0024.id3')::uuid;
update carnet.nfc_tags set status = 'assigned', profile_id = '00000000-0000-4000-8000-000000002412', activated_at = now()
 where id = current_setting('test0024.id4')::uuid;
update carnet.nfc_tags set status = 'assigned', profile_id = '00000000-0000-4000-8000-000000002413', activated_at = now()
 where id = current_setting('test0024.id6')::uuid;
update carnet.nfc_tags set status = 'assigned', profile_id = '00000000-0000-4000-8000-000000002414', activated_at = now()
 where id = current_setting('test0024.id7')::uuid;
update carnet.nfc_tags set status = 'disabled', profile_id = '00000000-0000-4000-8000-000000002414', activated_at = now()
 where id = current_setting('test0024.id8')::uuid;
update carnet.nfc_tags set status = 'assigned', profile_id = '00000000-0000-4000-8000-000000002415', activated_at = now()
 where id = current_setting('test0024.id9')::uuid;

-- ---------------------------------------------------------------------------
-- Critère 2 — activate_nfc_tag : anon et non-membre refusés
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  format($$select carnet.activate_nfc_tag(%L, %L)$$, current_setting('test0024.uid5'), current_setting('test0024.code5')),
  '42501', null, 'critère 2 : anon ne peut pas activer une puce (42501)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240d","role":"authenticated"}';
select throws_ok(
  format($$select carnet.activate_nfc_tag(%L, %L)$$, current_setting('test0024.uid5'), current_setting('test0024.code5')),
  '42501', null, 'critère 2 : un compte d''un autre projet (profil orphelin) ne peut pas activer une puce en stock avec le bon code (42501)'
);
reset role;

-- Membre sans profil
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240e","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid5'), current_setting('test0024.code5')),
  'no_profile',
  'critère 2 (décision 6) : un membre sans profil reçoit no_profile'
);
reset role;
select results_eq(
  format($$select status, profile_id from carnet.nfc_tags where id = %L$$, current_setting('test0024.id5')),
  $$values ('stock'::text, null::uuid)$$,
  'critère 2 : après le refus du non-membre et no_profile, la puce 5 est toujours en stock'
);

-- ---------------------------------------------------------------------------
-- Critère 2 — activate_nfc_tag : réponses invalid identiques, sans écriture
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('test0024.batch_ctids',
    (select string_agg(ctid::text, ',' order by id) from carnet.nfc_tags where batch_id = '00000000-0000-4000-8000-0000000024a1'), true);
end
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid1'), 'ZZZZZ-ZZZZZ'),
  'invalid',
  'critère 2 : mauvais code sur une puce en stock → invalid'
);
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid2'), current_setting('test0024.code2')),
  'invalid',
  'critère 2 : puce d''un autre membre avec son bon code → invalid'
);
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid3'), current_setting('test0024.code3')),
  'invalid',
  'critère 2 : puce désactivée (d''un autre) avec son bon code → invalid'
);
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid6'), current_setting('test0024.code6')),
  'invalid',
  'critère 2 : puce assignée au profil orphelin d''un compte d''un autre projet, bon code → invalid'
);
select is(
  carnet.activate_nfc_tag('zzzzzzzzzzzz', current_setting('test0024.code1')),
  'invalid',
  'critère 2 : puce inconnue → invalid'
);
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid1'), null),
  'invalid',
  'critère 2 : code nul → invalid'
);
select is(
  carnet.activate_nfc_tag(null, current_setting('test0024.code1')),
  'invalid',
  'critère 2 : uid nul → invalid'
);
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid1'), ''),
  'invalid',
  'critère 2 : code vide → invalid'
);
reset role;
-- Décision 9 : A a déjà consommé 8 essais ; remise à zéro de son compteur (postgres) pour rester sous la limite de 10.
delete from carnet.rate_limits where key like 'nfc-activate:%';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select is(
  (select count(distinct r)
     from (values
       (carnet.activate_nfc_tag(current_setting('test0024.uid1'), 'ZZZZZ-ZZZZZ')),
       (carnet.activate_nfc_tag(current_setting('test0024.uid2'), current_setting('test0024.code2'))),
       (carnet.activate_nfc_tag(current_setting('test0024.uid3'), current_setting('test0024.code3'))),
       (carnet.activate_nfc_tag('zzzzzzzzzzzz', current_setting('test0024.code1')))
     ) v (r)),
  1::bigint,
  'critère 2 : mauvais code, puce d''un autre, puce désactivée, puce inconnue → une seule et même réponse'
);
reset role;
select is(
  (select string_agg(ctid::text, ',' order by id) from carnet.nfc_tags where batch_id = '00000000-0000-4000-8000-0000000024a1'),
  current_setting('test0024.batch_ctids'),
  'critère 2 : les réponses invalid n''ont écrit sur aucune puce du lot (aucune nouvelle version de ligne)'
);
select results_eq(
  format($$select status, profile_id from carnet.nfc_tags where id in (%L, %L, %L) order by status, profile_id$$,
         current_setting('test0024.id1'), current_setting('test0024.id2'), current_setting('test0024.id3')),
  $$values ('assigned'::text, '00000000-0000-4000-8000-000000002411'::uuid),
           ('disabled'::text, '00000000-0000-4000-8000-000000002411'::uuid),
           ('stock'::text, null::uuid)$$,
  'critère 2 : puces 1 (stock), 2 (assigned à B), 3 (disabled chez B) inchangées'
);

-- ---------------------------------------------------------------------------
-- Décision 9 — code nul ou vide : invalid sans lire nfc_tags (compteurs de parcours de la transaction)
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('test0024.scans',
    (select (coalesce(seq_scan, 0) + coalesce(idx_scan, 0))::text from pg_stat_xact_user_tables where relid = 'carnet.nfc_tags'::regclass), true);
end
$$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid1'), null),
  'invalid',
  'décision 9 : code nul → invalid (contrôle de lecture)'
);
reset role;
select is(
  (select (coalesce(seq_scan, 0) + coalesce(idx_scan, 0))::text from pg_stat_xact_user_tables where relid = 'carnet.nfc_tags'::regclass),
  current_setting('test0024.scans'),
  'décision 9 : code nul → aucune lecture de carnet.nfc_tags (aucun parcours de table ni d''index)'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid1'), ''),
  'invalid',
  'décision 9 : code vide → invalid (contrôle de lecture)'
);
reset role;
select is(
  (select (coalesce(seq_scan, 0) + coalesce(idx_scan, 0))::text from pg_stat_xact_user_tables where relid = 'carnet.nfc_tags'::regclass),
  current_setting('test0024.scans'),
  'décision 9 : code vide → aucune lecture de carnet.nfc_tags (aucun parcours de table ni d''index)'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid1'), 'ZZZZZ-ZZZZZ'),
  'invalid',
  'décision 9 (témoin) : mauvais code non vide → invalid'
);
reset role;
select ok(
  (select coalesce(seq_scan, 0) + coalesce(idx_scan, 0) from pg_stat_xact_user_tables where relid = 'carnet.nfc_tags'::regclass)
    > current_setting('test0024.scans')::bigint,
  'décision 9 (témoin) : un code non vide lit bien carnet.nfc_tags (la mesure de lecture est sensible)'
);
-- A a consommé 7 essais depuis la dernière remise à zéro : nouvelle remise à zéro avant l'activation.
delete from carnet.rate_limits where key like 'nfc-activate:%';

-- ---------------------------------------------------------------------------
-- Critère 2 — activation par A, casse et tiret indifférents, rejeu already_yours sans écriture
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid1'), lower(replace(current_setting('test0024.code1'), '-', ''))),
  'activated',
  'critère 2 : A active la puce 1 avec le code en minuscules sans tiret → activated'
);
reset role;
select results_eq(
  format($$select status, profile_id, activated_at is not null from carnet.nfc_tags where id = %L$$, current_setting('test0024.id1')),
  $$values ('assigned'::text, '00000000-0000-4000-8000-000000002410'::uuid, true)$$,
  'critère 2 : la puce 1 est assigned au profil de A, activated_at posé'
);

do $$
begin
  perform set_config('test0024.ctid1', (select ctid::text from carnet.nfc_tags where id = current_setting('test0024.id1')::uuid), true);
  perform set_config('test0024.activated1', (select activated_at::text from carnet.nfc_tags where id = current_setting('test0024.id1')::uuid), true);
end
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid1'), upper(current_setting('test0024.code1'))),
  'already_yours',
  'critère 2 : même appel rejoué (code en majuscules avec tiret) → already_yours'
);
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid1'), current_setting('test0024.code1')),
  'already_yours',
  'critère 2 : troisième appel → already_yours (idempotent)'
);
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid1'), 'ZZZZZ-ZZZZZ'),
  'invalid',
  'critère 2 : sa propre puce avec un mauvais code → invalid (already_yours exige le bon code)'
);
reset role;
select results_eq(
  format($$select status, profile_id, ctid::text, activated_at::text from carnet.nfc_tags where id = %L$$, current_setting('test0024.id1')),
  format($$values ('assigned'::text, '00000000-0000-4000-8000-000000002410'::uuid, %L::text, %L::text)$$,
         current_setting('test0024.ctid1'), current_setting('test0024.activated1')),
  'critère 2 : already_yours n''écrit rien (aucune nouvelle version de ligne, activated_at inchangé)'
);

-- ---------------------------------------------------------------------------
-- Critère 4 — lecture des puces par persona
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select results_eq(
  $$select uid, status, profile_id from carnet.nfc_tags$$,
  format($$values (%L::text, 'assigned'::text, '00000000-0000-4000-8000-000000002410'::uuid)$$, current_setting('test0024.uid1')),
  'critère 4 : A voit sa puce, et seulement la sienne (ni le stock ni les puces des autres)'
);
select lives_ok(
  $$select id, uid, profile_id, status, batch_id, activated_at, created_at, updated_at from carnet.nfc_tags$$,
  'critère 4 : A lit toutes les colonnes autorisées de ses puces'
);
select throws_ok(
  $$select activation_code_hash from carnet.nfc_tags$$,
  '42501', null, 'critère 4 : A ne lit jamais activation_code_hash, même de sa puce (42501)'
);
select throws_ok(
  $$select * from carnet.nfc_tags$$,
  '42501', null, 'critère 4 : select * est refusé à A (activation_code_hash non lisible) (42501)'
);
select throws_ok(
  $$select uid from carnet.nfc_tags where activation_code_hash is not null$$,
  '42501', null, 'critère 4 : A ne peut pas filtrer sur activation_code_hash (42501)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240b","role":"authenticated"}';
select results_eq(
  $$select uid from carnet.nfc_tags order by uid$$,
  format($$select unnest(array[%L, %L]::text[]) order by 1$$, current_setting('test0024.uid2'), current_setting('test0024.uid3')),
  'critère 4 : B voit ses deux puces (assigned et disabled), aucune de A'
);
select is_empty(
  format($$select 1 from carnet.nfc_tags where id = %L$$, current_setting('test0024.id1')),
  'critère 4 : un autre membre (B) ne voit pas la puce de A'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240e","role":"authenticated"}';
select is_empty($$select id from carnet.nfc_tags$$, 'critère 4 : un membre sans profil ne voit aucune puce (ni le stock)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240d","role":"authenticated"}';
select is_empty($$select id from carnet.nfc_tags$$,
  'critère 4 : un compte d''un autre projet ne voit rien, même la puce assignée à son profil orphelin');
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select id from carnet.nfc_tags$$, '42501', null, 'critère 4 : anon ne lit pas carnet.nfc_tags (42501)');
reset role;

-- Écritures directes refusées (décision 5)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select throws_ok(
  format($$update carnet.nfc_tags set status = 'disabled' where id = %L$$, current_setting('test0024.id1')),
  '42501', null, 'décision 5 : update direct de sa propre puce refusé (42501)'
);
select throws_ok(
  format($$update carnet.nfc_tags set status = 'assigned', profile_id = '00000000-0000-4000-8000-000000002410' where id = %L$$,
         current_setting('test0024.id5')),
  '42501', null, 'décision 5 : s''attribuer directement une puce en stock refusé (42501)'
);
select throws_ok(
  format($$delete from carnet.nfc_tags where id = %L$$, current_setting('test0024.id1')),
  '42501', null, 'décision 5 : delete direct de sa propre puce refusé (42501)'
);
select throws_ok(
  $$insert into carnet.nfc_tags (uid, profile_id, status, activation_code_hash, batch_id)
    values ('yyyyyyyyyyyy', '00000000-0000-4000-8000-000000002410', 'assigned', 'x', '00000000-0000-4000-8000-0000000024a8')$$,
  '42501', null, 'décision 5 : insert direct d''une puce refusé (42501)'
);
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  format($$update carnet.nfc_tags set status = 'disabled' where id = %L$$, current_setting('test0024.id1')),
  '42501', null, 'décision 5 : update direct par anon refusé (42501)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 3 — resolve_nfc_tag : slug seulement pour un profil publié, aucun oracle
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select results_eq(
  format($$select state, slug from carnet.resolve_nfc_tag(%L)$$, current_setting('test0024.uid1')),
  $$values ('active'::text, 'alice-0024'::text)$$,
  'critère 3 : puce assignée à un profil publié → (active, slug) pour anon'
);
select results_eq(
  format($$select state, slug from carnet.resolve_nfc_tag(%L)$$, current_setting('test0024.uid5')),
  $$values ('activation'::text, null::text)$$,
  'critère 3 : puce en stock → (activation, null)'
);
select results_eq(
  $$select state, slug from carnet.resolve_nfc_tag('zzzzzzzzzzzz')$$,
  $$values ('not_found'::text, null::text)$$,
  'critère 3 : puce inconnue → (not_found, null), une ligne'
);
select results_eq(
  format($$select state, slug from carnet.resolve_nfc_tag(%L)$$, current_setting('test0024.uid3')),
  $$values ('not_found'::text, null::text)$$,
  'critère 3 : puce désactivée (profil publié) → (not_found, null), une ligne'
);
select results_eq(
  format($$select state, slug from carnet.resolve_nfc_tag(%L)$$, current_setting('test0024.uid4')),
  $$values ('not_found'::text, null::text)$$,
  'critère 3 : puce assignée à un profil non publié → (not_found, null), une ligne'
);
select results_eq(
  $$select state, slug from carnet.resolve_nfc_tag(null)$$,
  $$values ('not_found'::text, null::text)$$,
  'critère 3 : uid nul → (not_found, null), une ligne'
);
select is(
  (select count(distinct (r.state, r.slug))
     from (values (current_setting('test0024.uid3')), (current_setting('test0024.uid4')), ('zzzzzzzzzzzz')) v (u)
     cross join lateral carnet.resolve_nfc_tag(v.u) r),
  1::bigint,
  'critère 3 : inconnue, désactivée et profil non publié donnent exactement la même réponse (aucun oracle)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002409","role":"authenticated"}';
select results_eq(
  format($$select state, slug from carnet.resolve_nfc_tag(%L)$$, current_setting('test0024.uid4')),
  $$values ('not_found'::text, null::text)$$,
  'critère 3 : même le propriétaire d''un profil non publié obtient (not_found, null) pour sa puce'
);
select results_eq(
  format($$select state, slug from carnet.resolve_nfc_tag(%L)$$, current_setting('test0024.uid2')),
  $$values ('active'::text, 'bob-0024'::text)$$,
  'critère 3 : authenticated résout une puce active d''un autre profil publié'
);
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select results_eq(
  format($$select state, slug from carnet.resolve_nfc_tag(%L)$$, current_setting('test0024.uid1')),
  $$values ('active'::text, 'alice-0024'::text)$$,
  'critère 3 : service_role résout une puce active'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 5 — set_nfc_tag_enabled : propriétaire seulement, idempotent
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  format($$select carnet.set_nfc_tag_enabled(%L, false)$$, current_setting('test0024.id1')),
  '42501', null, 'critère 5 : anon ne peut pas désactiver une puce (42501)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240d","role":"authenticated"}';
select throws_ok(
  format($$select carnet.set_nfc_tag_enabled(%L, false)$$, current_setting('test0024.id6')),
  '42501', null, 'critère 5 : un compte d''un autre projet ne peut pas désactiver la puce de son profil orphelin (42501)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240b","role":"authenticated"}';
select is(
  carnet.set_nfc_tag_enabled(current_setting('test0024.id1')::uuid, false),
  false,
  'critère 5 : un autre membre (B) ne peut pas désactiver la puce de A → false'
);
select is(
  carnet.set_nfc_tag_enabled(current_setting('test0024.id5')::uuid, false),
  false,
  'critère 5 : une puce en stock ne peut pas être désactivée → false'
);
select is(
  carnet.set_nfc_tag_enabled('00000000-0000-4000-8000-0000000024ff', false),
  false,
  'critère 5 : une puce inexistante → false'
);
reset role;
select results_eq(
  format($$select status from carnet.nfc_tags where id in (%L, %L, %L) order by status$$,
         current_setting('test0024.id1'), current_setting('test0024.id5'), current_setting('test0024.id6')),
  $$values ('assigned'::text), ('assigned'::text), ('stock'::text)$$,
  'critère 5 : les refus n''ont modifié ni la puce de A, ni la puce en stock, ni celle du profil orphelin'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select is(
  carnet.set_nfc_tag_enabled(current_setting('test0024.id1')::uuid, false),
  true,
  'critère 5 : A désactive sa puce → true'
);
reset role;
select results_eq(
  format($$select status, profile_id from carnet.nfc_tags where id = %L$$, current_setting('test0024.id1')),
  $$values ('disabled'::text, '00000000-0000-4000-8000-000000002410'::uuid)$$,
  'critère 5 : la puce de A est disabled, toujours rattachée à son profil'
);
do $$
begin
  perform set_config('test0024.ctid1', (select ctid::text from carnet.nfc_tags where id = current_setting('test0024.id1')::uuid), true);
end
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select is(
  carnet.set_nfc_tag_enabled(current_setting('test0024.id1')::uuid, false),
  true,
  'critère 5 : désactivation rejouée → true (idempotent)'
);
reset role;
select results_eq(
  format($$select status, ctid::text from carnet.nfc_tags where id = %L$$, current_setting('test0024.id1')),
  format($$values ('disabled'::text, %L::text)$$, current_setting('test0024.ctid1')),
  'critère 5 : désactivation rejouée sans écriture (aucune nouvelle version de ligne)'
);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select results_eq(
  format($$select state, slug from carnet.resolve_nfc_tag(%L)$$, current_setting('test0024.uid1')),
  $$values ('not_found'::text, null::text)$$,
  'critère 3 et 5 : la puce désactivée de A ne se résout plus (not_found, null)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid1'), current_setting('test0024.code1')),
  'invalid',
  'critère 2 : sa propre puce désactivée avec le bon code → invalid (pas de réactivation par ce chemin)'
);
select is(
  carnet.set_nfc_tag_enabled(current_setting('test0024.id1')::uuid, true),
  true,
  'critère 5 : A réactive sa puce → true'
);
select is(
  carnet.set_nfc_tag_enabled(current_setting('test0024.id1')::uuid, true),
  true,
  'critère 5 : réactivation rejouée → true (idempotent)'
);
reset role;
select is(
  (select status from carnet.nfc_tags where id = current_setting('test0024.id1')::uuid),
  'assigned',
  'critère 5 : la puce de A est de nouveau assigned'
);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select results_eq(
  format($$select state, slug from carnet.resolve_nfc_tag(%L)$$, current_setting('test0024.uid1')),
  $$values ('active'::text, 'alice-0024'::text)$$,
  'critère 3 et 5 : la puce réactivée de A se résout de nouveau (active, alice-0024)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 5 — release_nfc_tag : propriétaire seulement, idempotent, même code réutilisable
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  format($$select carnet.release_nfc_tag(%L)$$, current_setting('test0024.id1')),
  '42501', null, 'critère 5 : anon ne peut pas libérer une puce (42501)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240d","role":"authenticated"}';
select throws_ok(
  format($$select carnet.release_nfc_tag(%L)$$, current_setting('test0024.id6')),
  '42501', null, 'critère 5 : un compte d''un autre projet ne peut pas libérer la puce de son profil orphelin (42501)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240b","role":"authenticated"}';
select is(
  carnet.release_nfc_tag(current_setting('test0024.id1')::uuid),
  false,
  'critère 5 : un autre membre (B) ne peut pas libérer la puce de A → false'
);
select is(
  carnet.release_nfc_tag(current_setting('test0024.id5')::uuid),
  false,
  'critère 5 : libérer une puce déjà en stock (sans propriétaire) → false'
);
reset role;
select results_eq(
  format($$select status, profile_id from carnet.nfc_tags where id = %L$$, current_setting('test0024.id1')),
  $$values ('assigned'::text, '00000000-0000-4000-8000-000000002410'::uuid)$$,
  'critère 5 : la puce de A est inchangée après la tentative de B'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select is(
  carnet.release_nfc_tag(current_setting('test0024.id1')::uuid),
  true,
  'critère 5 : A libère sa puce → true'
);
reset role;
select results_eq(
  format($$select status, profile_id from carnet.nfc_tags where id = %L$$, current_setting('test0024.id1')),
  $$values ('stock'::text, null::uuid)$$,
  'critère 5 : la puce libérée est en stock, profile_id nul'
);
do $$
begin
  perform set_config('test0024.ctid1', (select ctid::text from carnet.nfc_tags where id = current_setting('test0024.id1')::uuid), true);
end
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select lives_ok(
  format($$select carnet.release_nfc_tag(%L)$$, current_setting('test0024.id1')),
  'critère 5 : libération rejouée sans erreur (idempotent)'
);
select is(
  carnet.release_nfc_tag(current_setting('test0024.id1')::uuid),
  false,
  'critère 5 : libération rejouée → false (la puce n''appartient plus à A)'
);
select is_empty(
  format($$select 1 from carnet.nfc_tags where id = %L$$, current_setting('test0024.id1')),
  'critère 4 et 5 : A ne voit plus la puce libérée'
);
reset role;
select results_eq(
  format($$select status, profile_id, ctid::text from carnet.nfc_tags where id = %L$$, current_setting('test0024.id1')),
  format($$values ('stock'::text, null::uuid, %L::text)$$, current_setting('test0024.ctid1')),
  'critère 5 : libération rejouée sans écriture (aucune nouvelle version de ligne)'
);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select results_eq(
  format($$select state, slug from carnet.resolve_nfc_tag(%L)$$, current_setting('test0024.uid1')),
  $$values ('activation'::text, null::text)$$,
  'critère 3 et 5 : la puce libérée se résout en activation'
);
reset role;
-- Décision 9 : A a consommé 5 essais depuis la dernière remise à zéro ; remise à zéro avant les trois activations suivantes.
delete from carnet.rate_limits where key like 'nfc-activate:%';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid1'), current_setting('test0024.code1')),
  'activated',
  'critère 5 : la puce libérée se réactive avec le même code → activated'
);
reset role;
select results_eq(
  format($$select status, profile_id from carnet.nfc_tags where id = %L$$, current_setting('test0024.id1')),
  $$values ('assigned'::text, '00000000-0000-4000-8000-000000002410'::uuid)$$,
  'critère 5 : la puce réactivée est de nouveau assigned au profil de A'
);

-- Libération d'une puce désactivée
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240b","role":"authenticated"}';
select is(
  carnet.release_nfc_tag(current_setting('test0024.id3')::uuid),
  true,
  'critère 5 : B libère sa puce désactivée → true'
);
reset role;
select results_eq(
  format($$select status, profile_id from carnet.nfc_tags where id = %L$$, current_setting('test0024.id3')),
  $$values ('stock'::text, null::uuid)$$,
  'critère 5 : la puce désactivée libérée est en stock'
);

-- Une puce libérée par B s'active chez A avec le même code (aucun transfert direct, mais le code imprimé reste valable)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid3'), current_setting('test0024.code3')),
  'activated',
  'critère 5 : une puce libérée par B s''active chez A avec le code d''origine'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 7 — suppression du profil : puces remises en stock
-- ---------------------------------------------------------------------------
select lives_ok(
  $$delete from auth.users where id = '00000000-0000-4000-8000-000000002408'$$,
  'critère 7 : suppression du compte D (cascade auth.users → profiles) sans erreur'
);
select results_eq(
  format($$select status, profile_id from carnet.nfc_tags where id in (%L, %L)$$,
         current_setting('test0024.id7'), current_setting('test0024.id8')),
  $$values ('stock'::text, null::uuid), ('stock'::text, null::uuid)$$,
  'critère 7 : les puces de D (assigned et disabled) sont en stock, profile_id nul'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$delete from carnet.profiles where id = '00000000-0000-4000-8000-000000002415'$$,
  'critère 7 : suppression directe du profil de E par service_role sans erreur'
);
reset role;
select results_eq(
  format($$select status, profile_id from carnet.nfc_tags where id = %L$$, current_setting('test0024.id9')),
  $$values ('stock'::text, null::uuid)$$,
  'critère 7 : la puce de E est en stock, profile_id nul'
);
select is(
  (select count(*) from carnet.nfc_tags where id in (current_setting('test0024.id7')::uuid, current_setting('test0024.id8')::uuid,
                                                     current_setting('test0024.id9')::uuid)),
  3::bigint,
  'critère 7 : les puces ne sont pas supprimées avec le profil'
);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select results_eq(
  format($$select state, slug from carnet.resolve_nfc_tag(%L)$$, current_setting('test0024.uid7')),
  $$values ('activation'::text, null::text)$$,
  'critère 7 : une puce remise en stock par suppression du profil se résout en activation'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240b","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid8'), current_setting('test0024.code8')),
  'activated',
  'critère 7 : une puce remise en stock par suppression du profil s''active chez un autre membre avec son code'
);
reset role;

-- ---------------------------------------------------------------------------
-- Décision 9 — limite d'essais de activate_nfc_tag : 10 par heure et par compte (R), puis rate_limited
-- ---------------------------------------------------------------------------
delete from carnet.rate_limits where key like 'nfc-activate:%';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002406","role":"authenticated"}';
select is(
  (select count(*) from generate_series(1, 10) g
    where carnet.activate_nfc_tag(current_setting('test0024.uid5'), 'ZZZZZ-ZZZZZ') = 'invalid'),
  10::bigint,
  'décision 9 : les 10 premiers essais de R dans l''heure sont traités (invalid avec un mauvais code)'
);
reset role;
do $$
begin
  perform set_config('test0024.batch_ctids',
    (select string_agg(ctid::text, ',' order by id) from carnet.nfc_tags where batch_id = '00000000-0000-4000-8000-0000000024a1'), true);
end
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002406","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid5'), current_setting('test0024.code5')),
  'rate_limited',
  'décision 9 : 11e essai dans l''heure → rate_limited (valeur), même avec le bon code sur une puce en stock'
);
reset role;
select results_eq(
  format($$select status, profile_id from carnet.nfc_tags where id = %L$$, current_setting('test0024.id5')),
  $$values ('stock'::text, null::uuid)$$,
  'décision 9 : après rate_limited, la puce 5 est toujours en stock'
);
select is(
  (select string_agg(ctid::text, ',' order by id) from carnet.nfc_tags where batch_id = '00000000-0000-4000-8000-0000000024a1'),
  current_setting('test0024.batch_ctids'),
  'décision 9 : rate_limited n''écrit sur aucune puce (aucune nouvelle version de ligne)'
);
select is(
  (select count from carnet.rate_limits where key = 'nfc-activate:00000000-0000-4000-8000-000000002406'),
  11,
  'décision 9 : le compteur nfc-activate:<uid de R> vaut 11 (le refus est compté, l''incrément n''est pas annulé)'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240b","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid5'), current_setting('test0024.code5')),
  'activated',
  'décision 9 : un autre compte (B) n''est pas affecté par la limite de R et active la puce 5'
);
reset role;

update carnet.rate_limits set window_start = now() - interval '59 minutes'
 where key = 'nfc-activate:00000000-0000-4000-8000-000000002406';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002406","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid5'), 'ZZZZZ-ZZZZZ'),
  'rate_limited',
  'décision 9 : fenêtre ouverte depuis 59 minutes → toujours rate_limited'
);
reset role;

update carnet.rate_limits set window_start = now() - interval '61 minutes'
 where key = 'nfc-activate:00000000-0000-4000-8000-000000002406';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002406","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(current_setting('test0024.uid5'), 'ZZZZZ-ZZZZZ'),
  'invalid',
  'décision 9 : fenêtre ouverte depuis plus d''une heure → essai de nouveau traité (invalid : puce de B)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 2 — casse mixte avec tiret sur une puce neuve
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000240a","role":"authenticated"}';
select is(
  carnet.activate_nfc_tag(
    current_setting('test0024.uid10'),
    lower(left(current_setting('test0024.code10'), 3)) || substr(current_setting('test0024.code10'), 4)),
  'activated',
  'critère 2 : code en casse mixte avec tiret → activated'
);
select is(
  (select count(*) from carnet.nfc_tags),
  3::bigint,
  'critère 4 : A voit exactement ses trois puces (1, 3, 10)'
);
reset role;

select * from finish();
rollback;
