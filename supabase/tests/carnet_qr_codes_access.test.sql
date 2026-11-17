-- Fiche 0024 — carnet.qr_codes : comportements par persona.
-- Critères couverts : 3 (resolve_qr_code), 4 (lecture du QR), 6 (ensure_qr_code, set_qr_style), 7 (suppression du profil).
-- Structure, contraintes et grants : carnet_qr_codes_schema.test.sql.
-- Contrat figé pour db-architect (interprétations les plus strictes, voir rapport 0024) :
--   ensure_qr_code / set_qr_style : appelant non membre de carnet → 42501 ; membre sans profil → erreur (SQLSTATE libre),
--     aucune ligne créée ; ensure_qr_code rejoué renvoie la même ligne (id, code, style) sans écriture (ctid inchangé)
--     et ne réinitialise pas un style personnalisé.
--   set_qr_style : p_style nul ou invalide (clé manquante ou inconnue, couleur hors ^#[0-9a-f]{6}$, logo non booléen,
--     non objet) → 22023 sans écriture ; style identique (même dans un autre ordre de clés) → aucune écriture (ctid inchangé) ;
--     le code ne change jamais.
--   resolve_qr_code : slug seulement pour un profil publié ; inconnu, non publié, nul → null.
-- Les codes et id générés sont mémorisés dans des réglages locaux à la transaction (test0024q.*) via set_config.
-- Personas (UUID fixes, plage 0…248x/0…249x propre à ce fichier) :
--   A  0…248a  membre (owner) de carnet, profil 0…2490 publié (slug alice-q24)
--   B  0…248b  membre (user) de carnet, profil 0…2491 NON publié (slug bob-q24)
--   N  0…248e  membre (user) de carnet sans profil
--   C  0…248d  membre de other_q24 (projet 0…2482), profil orphelin 0…2493 publié (slug carl-q24), QR 'cccccccc' posé par postgres
--   anon       rôle anon, claims sans sub
-- Fixtures créées par postgres (bypassrls) dans la transaction, annulées par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(60);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000248a', 'a-carnet-q24@test.local'),
  ('00000000-0000-4000-8000-00000000248b', 'b-carnet-q24@test.local'),
  ('00000000-0000-4000-8000-00000000248e', 'n-carnet-q24@test.local'),
  ('00000000-0000-4000-8000-00000000248d', 'c-other-q24@test.local');

insert into platform.projects (id, slug, name, db_schema)
  values ('00000000-0000-4000-8000-000000002482', 'other_q24', 'Other q24', 'other_q24');

insert into platform.project_members (project_id, user_id, role)
  select id, '00000000-0000-4000-8000-00000000248a', 'owner' from platform.projects where slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  select id, '00000000-0000-4000-8000-00000000248b', 'user' from platform.projects where slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  select id, '00000000-0000-4000-8000-00000000248e', 'user' from platform.projects where slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  values ('00000000-0000-4000-8000-000000002482', '00000000-0000-4000-8000-00000000248d', 'user');

insert into carnet.profiles (id, owner_id, slug, display_name, is_published) values
  ('00000000-0000-4000-8000-000000002490', '00000000-0000-4000-8000-00000000248a', 'alice-q24', 'Alice', true),
  ('00000000-0000-4000-8000-000000002491', '00000000-0000-4000-8000-00000000248b', 'bob-q24', 'Bob', false),
  ('00000000-0000-4000-8000-000000002493', '00000000-0000-4000-8000-00000000248d', 'carl-q24', 'Carl', true);

insert into carnet.qr_codes (id, code, profile_id)
  values ('00000000-0000-4000-8000-0000000024a3', 'cccccccc', '00000000-0000-4000-8000-000000002493');

-- ---------------------------------------------------------------------------
-- Critère 6 — ensure_qr_code : refus
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select * from carnet.ensure_qr_code()$$, '42501', null, 'critère 6 : anon ne peut pas appeler ensure_qr_code (42501)');
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select * from carnet.ensure_qr_code()$$, '42501', null, 'critère 6 : service_role ne peut pas appeler ensure_qr_code (42501)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248d","role":"authenticated"}';
select throws_ok($$select * from carnet.ensure_qr_code()$$, '42501', null,
  'critère 6 : un compte d''un autre projet (profil orphelin) ne peut pas appeler ensure_qr_code (42501)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248e","role":"authenticated"}';
select throws_ok($$select * from carnet.ensure_qr_code()$$, null::char(5), null, 'critère 6 : un membre sans profil reçoit une erreur de ensure_qr_code');
reset role;

select is(
  (select count(*) from carnet.qr_codes),
  1::bigint,
  'critère 6 : les appels refusés n''ont créé aucun QR (seul celui de C, posé par postgres, existe)'
);

-- ---------------------------------------------------------------------------
-- Critère 6 — ensure_qr_code : création puis rejeu idempotent
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248a","role":"authenticated"}';
do $$
declare
  r carnet.qr_codes;
begin
  r := carnet.ensure_qr_code();
  perform set_config('test0024q.a_id', r.id::text, true);
  perform set_config('test0024q.a_code', r.code, true);
  perform set_config('test0024q.a_profile', r.profile_id::text, true);
  perform set_config('test0024q.a_style', r.style::text, true);
end
$$;
reset role;

select is(current_setting('test0024q.a_profile'), '00000000-0000-4000-8000-000000002490',
  'critère 6 : ensure_qr_code renvoie la ligne du profil de l''appelant');
select ok(current_setting('test0024q.a_code') ~ '^[0-9a-hjkmnp-tv-z]{8}$',
  'critère 6 (décision 3) : le code créé fait 8 caractères de l''alphabet [0-9a-hjkmnp-tv-z]');
select is(current_setting('test0024q.a_style')::jsonb, '{"fg":"#000000","bg":"#ffffff","logo":false}'::jsonb,
  'critère 6 (décision 4) : le QR créé porte le style par défaut');
select results_eq(
  $$select id::text, code from carnet.qr_codes where profile_id = '00000000-0000-4000-8000-000000002490'$$,
  format($$values (%L::text, %L::text)$$, current_setting('test0024q.a_id'), current_setting('test0024q.a_code')),
  'critère 6 : la ligne renvoyée est bien celle enregistrée (contrôle postgres)'
);

do $$
begin
  perform set_config('test0024q.a_ctid',
    (select ctid::text from carnet.qr_codes where id = current_setting('test0024q.a_id')::uuid), true);
end
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248a","role":"authenticated"}';
select results_eq(
  $$select id::text, code, profile_id, style from carnet.ensure_qr_code()$$,
  format($$values (%L::text, %L::text, '00000000-0000-4000-8000-000000002490'::uuid, '{"fg":"#000000","bg":"#ffffff","logo":false}'::jsonb)$$,
         current_setting('test0024q.a_id'), current_setting('test0024q.a_code')),
  'critère 6 : ensure_qr_code appelé deux fois renvoie la même ligne (même id, même code)'
);
select results_eq(
  $$select code from carnet.ensure_qr_code()$$,
  format($$values (%L::text)$$, current_setting('test0024q.a_code')),
  'critère 6 : troisième appel, toujours le même code'
);
reset role;
select is(
  (select count(*) from carnet.qr_codes where profile_id = '00000000-0000-4000-8000-000000002490'),
  1::bigint,
  'critère 6 : un seul QR pour le profil de A après trois appels'
);
select is(
  (select ctid::text from carnet.qr_codes where id = current_setting('test0024q.a_id')::uuid),
  current_setting('test0024q.a_ctid'),
  'critère 6 : ensure_qr_code rejoué n''écrit rien (aucune nouvelle version de ligne)'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248b","role":"authenticated"}';
do $$
begin
  perform set_config('test0024q.b_code', (select code from carnet.ensure_qr_code()), true);
end
$$;
reset role;
select isnt(current_setting('test0024q.b_code'), current_setting('test0024q.a_code'),
  'critère 6 : le QR de B a un code différent de celui de A');

-- ---------------------------------------------------------------------------
-- Critère 4 — lecture du QR par persona
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248a","role":"authenticated"}';
select results_eq(
  $$select code, profile_id from carnet.qr_codes$$,
  format($$values (%L::text, '00000000-0000-4000-8000-000000002490'::uuid)$$, current_setting('test0024q.a_code')),
  'critère 4 : A voit son QR, et seulement le sien'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248b","role":"authenticated"}';
select results_eq(
  $$select code from carnet.qr_codes$$,
  format($$values (%L::text)$$, current_setting('test0024q.b_code')),
  'critère 4 : un autre membre (B) ne voit que son QR, pas celui de A'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248e","role":"authenticated"}';
select is_empty($$select id from carnet.qr_codes$$, 'critère 4 : un membre sans profil ne voit aucun QR');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248d","role":"authenticated"}';
select is_empty($$select id from carnet.qr_codes$$,
  'critère 4 : un compte d''un autre projet ne voit rien, même le QR de son profil orphelin');
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select id from carnet.qr_codes$$, '42501', null, 'critère 4 : anon ne lit pas carnet.qr_codes (42501)');
reset role;

-- Écritures directes refusées (décision 5)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248a","role":"authenticated"}';
select throws_ok(
  $$update carnet.qr_codes set code = 'zzzzzzzz' where profile_id = '00000000-0000-4000-8000-000000002490'$$,
  '42501', null, 'décision 5 : update direct du code de son QR refusé (42501)'
);
select throws_ok(
  $$update carnet.qr_codes set style = '{"fg":"#111111","bg":"#ffffff","logo":false}' where profile_id = '00000000-0000-4000-8000-000000002490'$$,
  '42501', null, 'décision 5 : update direct du style de son QR refusé (42501)'
);
select throws_ok(
  $$delete from carnet.qr_codes where profile_id = '00000000-0000-4000-8000-000000002490'$$,
  '42501', null, 'décision 5 : delete direct de son QR refusé (42501)'
);
select throws_ok(
  $$insert into carnet.qr_codes (code, profile_id) values ('zzzzzzzz', '00000000-0000-4000-8000-000000002490')$$,
  '42501', null, 'décision 5 : insert direct d''un QR refusé (42501)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 6 — set_qr_style
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select * from carnet.set_qr_style('{"fg":"#111111","bg":"#ffffff","logo":false}')$$,
  '42501', null, 'critère 6 : anon ne peut pas appeler set_qr_style (42501)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248d","role":"authenticated"}';
select throws_ok($$select * from carnet.set_qr_style('{"fg":"#111111","bg":"#ffffff","logo":false}')$$,
  '42501', null, 'critère 6 : un compte d''un autre projet ne peut pas styliser le QR de son profil orphelin (42501)');
reset role;
select is(
  (select style from carnet.qr_codes where code = 'cccccccc'),
  '{"fg":"#000000","bg":"#ffffff","logo":false}'::jsonb,
  'critère 6 : le style du QR orphelin de C est inchangé'
);

do $$
begin
  perform set_config('test0024q.a_ctid',
    (select ctid::text from carnet.qr_codes where id = current_setting('test0024q.a_id')::uuid), true);
end
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248a","role":"authenticated"}';
select throws_ok($$select * from carnet.set_qr_style('{"fg":"#000000","bg":"#ffffff","logo":false,"shape":"dots"}')$$,
  '22023', null, 'critère 6 : clé inconnue refusée (22023)');
select throws_ok($$select * from carnet.set_qr_style('{"fg":"#000000","bg":"#ffffff"}')$$,
  '22023', null, 'critère 6 : clé logo manquante refusée (22023)');
select throws_ok($$select * from carnet.set_qr_style('{"fg":"#000000","logo":false}')$$,
  '22023', null, 'critère 6 : clé bg manquante refusée (22023)');
select throws_ok($$select * from carnet.set_qr_style('{"fg":"#FFFFFF","bg":"#000000","logo":false}')$$,
  '22023', null, 'critère 6 : couleur en majuscules refusée (22023)');
select throws_ok($$select * from carnet.set_qr_style('{"fg":"#fff","bg":"#000000","logo":false}')$$,
  '22023', null, 'critère 6 : couleur courte refusée (22023)');
select throws_ok($$select * from carnet.set_qr_style('{"fg":"red","bg":"#000000","logo":false}')$$,
  '22023', null, 'critère 6 : couleur nommée refusée (22023)');
select throws_ok($$select * from carnet.set_qr_style('{"fg":"#000000","bg":"#00000g","logo":false}')$$,
  '22023', null, 'critère 6 : couleur non hexadécimale refusée (22023)');
select throws_ok($$select * from carnet.set_qr_style('{"fg":"#000000","bg":"#ffffff\n","logo":false}')$$,
  '22023', null, 'critère 6 : couleur suivie d''un saut de ligne refusée (22023)');
select throws_ok($$select * from carnet.set_qr_style('{"fg":["#000000"],"bg":"#ffffff","logo":false}')$$,
  '22023', null, 'critère 6 : couleur non chaîne refusée (22023)');
select throws_ok($$select * from carnet.set_qr_style('{"fg":"#000000","bg":"#ffffff","logo":1}')$$,
  '22023', null, 'critère 6 : logo non booléen refusé (22023)');
select throws_ok($$select * from carnet.set_qr_style('["#000000","#ffffff",false]')$$,
  '22023', null, 'critère 6 : style non objet refusé (22023)');
select throws_ok($$select * from carnet.set_qr_style('null'::jsonb)$$,
  '22023', null, 'critère 6 : style null JSON refusé (22023)');
select throws_ok($$select * from carnet.set_qr_style(null)$$,
  '22023', null, 'critère 6 : p_style nul refusé (22023)');
reset role;
select results_eq(
  format($$select style, ctid::text from carnet.qr_codes where id = %L$$, current_setting('test0024q.a_id')),
  format($$values ('{"fg":"#000000","bg":"#ffffff","logo":false}'::jsonb, %L::text)$$, current_setting('test0024q.a_ctid')),
  'critère 6 : les styles refusés n''ont rien écrit (style par défaut, aucune nouvelle version de ligne)'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248a","role":"authenticated"}';
select results_eq(
  $$select id::text, code, profile_id, style from carnet.set_qr_style('{"fg":"#1a2b3c","bg":"#fafafa","logo":true}')$$,
  format($$values (%L::text, %L::text, '00000000-0000-4000-8000-000000002490'::uuid, '{"fg":"#1a2b3c","bg":"#fafafa","logo":true}'::jsonb)$$,
         current_setting('test0024q.a_id'), current_setting('test0024q.a_code')),
  'critère 6 : set_qr_style valide renvoie la ligne de A avec le nouveau style, code inchangé'
);
reset role;
select results_eq(
  format($$select code, style from carnet.qr_codes where id = %L$$, current_setting('test0024q.a_id')),
  format($$values (%L::text, '{"fg":"#1a2b3c","bg":"#fafafa","logo":true}'::jsonb)$$, current_setting('test0024q.a_code')),
  'critère 6 : le nouveau style est enregistré, le code ne change jamais (contrôle postgres)'
);
select isnt(
  (select ctid::text from carnet.qr_codes where id = current_setting('test0024q.a_id')::uuid),
  current_setting('test0024q.a_ctid'),
  'critère 6 : un style différent est bien écrit (nouvelle version de ligne)'
);

do $$
begin
  perform set_config('test0024q.a_ctid',
    (select ctid::text from carnet.qr_codes where id = current_setting('test0024q.a_id')::uuid), true);
end
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248a","role":"authenticated"}';
select results_eq(
  $$select style from carnet.set_qr_style('{"logo":true,"bg":"#fafafa","fg":"#1a2b3c"}')$$,
  $$values ('{"fg":"#1a2b3c","bg":"#fafafa","logo":true}'::jsonb)$$,
  'critère 6 : set_qr_style rejoué avec le même style (autre ordre de clés) renvoie la ligne'
);
reset role;
select is(
  (select ctid::text from carnet.qr_codes where id = current_setting('test0024q.a_id')::uuid),
  current_setting('test0024q.a_ctid'),
  'critère 6 : set_qr_style inchangé n''écrit rien (aucune nouvelle version de ligne)'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248a","role":"authenticated"}';
select results_eq(
  $$select code, style from carnet.ensure_qr_code()$$,
  format($$values (%L::text, '{"fg":"#1a2b3c","bg":"#fafafa","logo":true}'::jsonb)$$, current_setting('test0024q.a_code')),
  'critère 6 : ensure_qr_code après personnalisation conserve le style (ne réinitialise rien)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248b","role":"authenticated"}';
select results_eq(
  $$select code, style from carnet.set_qr_style('{"fg":"#222222","bg":"#eeeeee","logo":false}')$$,
  format($$values (%L::text, '{"fg":"#222222","bg":"#eeeeee","logo":false}'::jsonb)$$, current_setting('test0024q.b_code')),
  'critère 6 : set_qr_style par B ne touche que le QR de B'
);
reset role;
select is(
  (select style from carnet.qr_codes where id = current_setting('test0024q.a_id')::uuid),
  '{"fg":"#1a2b3c","bg":"#fafafa","logo":true}'::jsonb,
  'critère 6 : le style de A est inchangé après l''appel de B'
);

-- ---------------------------------------------------------------------------
-- Critère 3 — resolve_qr_code
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is(carnet.resolve_qr_code(current_setting('test0024q.a_code')), 'alice-q24',
  'critère 3 : QR d''un profil publié → slug (anon)');
select is(carnet.resolve_qr_code(current_setting('test0024q.b_code')), null::text,
  'critère 3 : QR d''un profil non publié → null');
select is(carnet.resolve_qr_code('zzzzzzzz'), null::text, 'critère 3 : code inconnu → null');
select is(carnet.resolve_qr_code(null), null::text, 'critère 3 : code nul → null');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000248b","role":"authenticated"}';
select is(carnet.resolve_qr_code(current_setting('test0024q.b_code')), null::text,
  'critère 3 : même le propriétaire d''un profil non publié obtient null pour son QR');
select is(carnet.resolve_qr_code(current_setting('test0024q.a_code')), 'alice-q24',
  'critère 3 : authenticated résout le QR d''un profil publié');
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(carnet.resolve_qr_code(current_setting('test0024q.a_code')), 'alice-q24',
  'critère 3 : service_role résout le QR d''un profil publié');
reset role;

-- ---------------------------------------------------------------------------
-- Critère 7 — suppression du profil : QR supprimé
-- ---------------------------------------------------------------------------
select lives_ok(
  $$delete from auth.users where id = '00000000-0000-4000-8000-00000000248b'$$,
  'critère 7 : suppression du compte B (cascade auth.users → profiles) sans erreur'
);
select is(
  (select count(*) from carnet.qr_codes where code = current_setting('test0024q.b_code')),
  0::bigint,
  'critère 7 : le QR de B est supprimé avec son profil'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$delete from carnet.profiles where id = '00000000-0000-4000-8000-000000002490'$$,
  'critère 7 : suppression directe du profil de A par service_role sans erreur'
);
reset role;
select is(
  (select count(*) from carnet.qr_codes where id = current_setting('test0024q.a_id')::uuid),
  0::bigint,
  'critère 7 : le QR de A est supprimé avec son profil'
);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is(carnet.resolve_qr_code(current_setting('test0024q.a_code')), null::text,
  'critère 7 et 3 : le code d''un QR supprimé ne se résout plus');
reset role;

select * from finish();
rollback;
