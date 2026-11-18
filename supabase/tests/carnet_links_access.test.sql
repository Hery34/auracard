-- Fiche 0016 — table carnet.links : comportements par persona, carnet.replace_links et carnet.get_public_links en situation,
-- cascade à la suppression du profil.
-- Critères couverts : 1 (accès propriétaire / autre membre / autre projet / anon), 2 (replace_links : rejeu, réordonnancement,
-- 13 liens, http:// et javascript:), 3 (get_public_links : publié, non publié, inexistant, colonnes), 4 (cascade).
-- Décision 7 : p_links nul ou non tableau → 22023 ; clé position ignorée ; get_public_links a exactement la
-- visibilité de get_public_profile (publié, non publié, inexistant, propriétaire sans appartenance carnet).
-- La structure, les contraintes nommées et les propriétés des fonctions sont dans carnet_links_schema.test.sql.
-- Amendé par 0034 (décision 2) : get_public_links expose id ; le contrôle des id renvoyés est dans carnet_public_collection.test.sql.
-- Contrat de replace_links(p_profile_id, p_links) : p_links est un tableau jsonb d'objets {id?, platform, url, label?} ;
-- la position de chaque lien est son rang dans le tableau (0 pour le premier) ; une clé position fournie est ignorée.
-- Décision 8 : un élément portant l'id d'un lien existant du profil le met à jour sur place (id conservé) ; sans id → créé ;
-- liens absents de la liste → supprimés ; id inconnu, d'un autre profil ou en double → 22023 sans effet ; clés profile_id,
-- position, created_at ignorées ; élément non objet → 22023 ; plus de 12 éléments → 23514 avant toute lecture ;
-- profil non modifiable → 42501 même avec une liste vide ; execute refusé à service_role.
-- Décision 8, second audit : platform, url, label non chaîne JSON (label null accepté) → 22023 sans effet ;
-- id non canonique ({uuid}, sans tirets) → 22023 même s'il désigne un lien existant.
-- Les id générés sont mémorisés dans des réglages locaux à la transaction (test0016.*) via set_config.
-- Personas (UUID fixes, plage 0…16xx propre à cette fiche) :
--   A   0…160a  membre (owner) de carnet, propriétaire du profil 0…1620 (slug alice-0016)
--   A2  0…160b  membre (user) de carnet, propriétaire du profil 0…1621 (slug bob-0016), un lien 0…1650 posé par postgres
--   B   0…160c  authentifié sans appartenance ; profil « orphelin » 0…1622 avec un lien, attribués par postgres
--   C   0…160d  membre de other_0016 (projet 0…1602) ; profil « orphelin » 0…1623 avec un lien, attribués par postgres
--   anon        rôle anon, claims sans sub
-- Les fixtures sont créées par postgres (bypassrls) dans la transaction et annulées par le rollback final.
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;

select plan(140);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000160a', 'a-carnet-0016@test.local'),
  ('00000000-0000-4000-8000-00000000160b', 'a2-carnet-0016@test.local'),
  ('00000000-0000-4000-8000-00000000160c', 'b-no-member-0016@test.local'),
  ('00000000-0000-4000-8000-00000000160d', 'c-other-0016@test.local');

insert into platform.projects (id, slug, name, db_schema)
  values ('00000000-0000-4000-8000-000000001602', 'other_0016', 'Other 0016', 'other_0016');

insert into platform.project_members (project_id, user_id, role)
  select id, '00000000-0000-4000-8000-00000000160a', 'owner' from platform.projects where slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  select id, '00000000-0000-4000-8000-00000000160b', 'user' from platform.projects where slug = 'carnet';
insert into platform.project_members (project_id, user_id, role)
  values ('00000000-0000-4000-8000-000000001602', '00000000-0000-4000-8000-00000000160d', 'user');

insert into carnet.profiles (id, owner_id, slug, display_name) values
  ('00000000-0000-4000-8000-000000001620', '00000000-0000-4000-8000-00000000160a', 'alice-0016', 'Alice'),
  ('00000000-0000-4000-8000-000000001621', '00000000-0000-4000-8000-00000000160b', 'bob-0016', 'Bob'),
  ('00000000-0000-4000-8000-000000001622', '00000000-0000-4000-8000-00000000160c', 'bea-0016', 'Bea'),
  ('00000000-0000-4000-8000-000000001623', '00000000-0000-4000-8000-00000000160d', 'carl-0016', 'Carl');

insert into carnet.links (id, profile_id, platform, url, label, position) values
  ('00000000-0000-4000-8000-000000001650', '00000000-0000-4000-8000-000000001621', 'github', 'https://github.com/bob-0016', 'Bob GH', 0),
  ('00000000-0000-4000-8000-000000001651', '00000000-0000-4000-8000-000000001622', 'x', 'https://x.com/bea-0016', null, 0),
  ('00000000-0000-4000-8000-000000001652', '00000000-0000-4000-8000-000000001623', 'youtube', 'https://youtube.com/@carl-0016', null, 0);

-- ---------------------------------------------------------------------------
-- Critère 1 — A : propriétaire, accès direct à la table
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000160a","role":"authenticated"}';

select lives_ok(
  $$insert into carnet.links (profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001620', 'website', 'https://alice.example.test', 'Site', 0)$$,
  'critère 1 (amendé 0022, décision 10) : le propriétaire crée un lien sur son profil avec les seules colonnes accordées'
);
select results_eq(
  $$select platform, url, label, position from carnet.links$$,
  $$values ('website'::text, 'https://alice.example.test'::text, 'Site'::text, 0::smallint)$$,
  'critère 1 : le propriétaire relit son lien, et seulement le sien'
);
with updated as (
  update carnet.links set label = 'Mon site' where profile_id = '00000000-0000-4000-8000-000000001620' returning 1
)
select is(count(*), 1::bigint, 'critère 1 : le propriétaire modifie son lien (1 ligne affectée)') from updated;
with updated as (
  update carnet.links set platform = 'document', url = 'https://alice.example.test/brochure.pdf', label = 'Brochure', position = 1
   where profile_id = '00000000-0000-4000-8000-000000001620' returning 1
)
select is(count(*), 1::bigint, '0022 décision 10 : update de platform, url, label, position accepté sur son lien') from updated;
select throws_ok(
  $$update carnet.links set profile_id = '00000000-0000-4000-8000-000000001621'
     where profile_id = '00000000-0000-4000-8000-000000001620'$$,
  '42501', null, 'critère 1 : le propriétaire ne peut pas déplacer son lien vers le profil d''un autre (42501)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001621', 'x', 'https://x.com/intruder', 5)$$,
  '42501', null, 'critère 1 : le propriétaire ne peut pas créer de lien sur le profil d''un autre membre'
);

-- 0022 décision 10 : droits par colonne (insert : profile_id, platform, url, label, position ;
-- update : platform, url, label, position) ; id, created_at, updated_at et le rattachement hors de portée.
select throws_ok(
  $$insert into carnet.links (id, profile_id, platform, url, label, position)
    values ('00000000-0000-4000-8000-000000001641', '00000000-0000-4000-8000-000000001620', 'github', 'https://github.com/alice-0016', null, 2)$$,
  '42501', null, '0022 décision 10 : insert direct avec id choisi refusé sur son profil (42501)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position, created_at)
    values ('00000000-0000-4000-8000-000000001620', 'github', 'https://github.com/alice-0016', 2, '2000-01-01')$$,
  '42501', null, '0022 décision 10 : insert direct avec created_at refusé sur son profil (42501)'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position, updated_at)
    values ('00000000-0000-4000-8000-000000001620', 'github', 'https://github.com/alice-0016', 2, '2000-01-01')$$,
  '42501', null, '0022 décision 10 : insert direct avec updated_at refusé sur son profil (42501)'
);
select throws_ok(
  $$update carnet.links set id = '00000000-0000-4000-8000-000000001642' where profile_id = '00000000-0000-4000-8000-000000001620'$$,
  '42501', null, '0022 décision 10 : update de id refusé sur son lien (42501)'
);
select throws_ok(
  $$update carnet.links set profile_id = '00000000-0000-4000-8000-000000001620' where profile_id = '00000000-0000-4000-8000-000000001620'$$,
  '42501', null, '0022 décision 10 : update de profile_id refusé même vers son propre profil (with check satisfait) (42501)'
);
select throws_ok(
  $$update carnet.links set created_at = '2000-01-01' where profile_id = '00000000-0000-4000-8000-000000001620'$$,
  '42501', null, '0022 décision 10 : update de created_at refusé sur son lien (42501)'
);
select throws_ok(
  $$update carnet.links set updated_at = '2000-01-01' where profile_id = '00000000-0000-4000-8000-000000001620'$$,
  '42501', null, '0022 décision 10 : update de updated_at refusé sur son lien (42501)'
);
select is(
  (select count(*) from carnet.links where profile_id = '00000000-0000-4000-8000-000000001620'),
  1::bigint,
  '0022 décision 10 : les écritures refusées n''ont créé aucun lien'
);

with deleted as (
  delete from carnet.links where profile_id = '00000000-0000-4000-8000-000000001620' returning 1
)
select is(count(*), 1::bigint, 'critère 1 : le propriétaire supprime son lien (1 ligne affectée)') from deleted;
select is_empty($$select * from carnet.links$$, 'critère 1 : après suppression, le propriétaire ne voit plus aucun lien');

-- ---------------------------------------------------------------------------
-- Critère 2 — replace_links par le propriétaire
-- ---------------------------------------------------------------------------
select results_eq(
  $$select platform, url, label, position
      from carnet.replace_links(
        '00000000-0000-4000-8000-000000001620',
        '[{"platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016","label":"LinkedIn"},
          {"platform":"github","url":"https://github.com/alice-0016"},
          {"platform":"document","url":"https://alice.example.test/brochure.pdf","label":"Brochure"}]'::jsonb)
     order by position$$,
  $$values ('linkedin'::text, 'https://www.linkedin.com/in/alice-0016'::text, 'LinkedIn'::text, 0::smallint),
           ('github', 'https://github.com/alice-0016', null, 1::smallint),
           ('document', 'https://alice.example.test/brochure.pdf', 'Brochure', 2::smallint)$$,
  'critère 2 : replace_links enregistre la liste dans l''ordre reçu (position = rang) et renvoie les liens créés'
);
select results_eq(
  $$select platform, url, label, position from carnet.links order by position$$,
  $$values ('linkedin'::text, 'https://www.linkedin.com/in/alice-0016'::text, 'LinkedIn'::text, 0::smallint),
           ('github', 'https://github.com/alice-0016', null, 1::smallint),
           ('document', 'https://alice.example.test/brochure.pdf', 'Brochure', 2::smallint)$$,
  'critère 2 : la table contient exactement la liste remplacée'
);
-- ---------------------------------------------------------------------------
-- Critère 2 / décision 8 — identifiants conservés
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('test0016.li', (select id::text from carnet.links where platform = 'linkedin'), true);
  perform set_config('test0016.gh', (select id::text from carnet.links where platform = 'github'), true);
  perform set_config('test0016.doc', (select id::text from carnet.links where platform = 'document'), true);
end
$$;
select is(
  (select count(distinct id) from carnet.links),
  3::bigint,
  'critère 2 (décision 8) : chaque élément sans id reçoit un nouvel id (trois id distincts)'
);

select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%s","platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016","label":"LinkedIn"},
               {"id":"%s","platform":"github","url":"https://github.com/alice-0016"},
               {"id":"%s","platform":"document","url":"https://alice.example.test/brochure.pdf","label":"Brochure"}]',
             current_setting('test0016.li'), current_setting('test0016.gh'), current_setting('test0016.doc'))::jsonb)$$,
  'critère 2 (décision 8) : replace_links accepte des éléments portant l''id des liens existants du profil'
);
select results_eq(
  $$select id, platform, url, label, position from carnet.links order by position$$,
  $$values (current_setting('test0016.li')::uuid, 'linkedin'::text, 'https://www.linkedin.com/in/alice-0016'::text, 'LinkedIn'::text, 0::smallint),
           (current_setting('test0016.gh')::uuid, 'github', 'https://github.com/alice-0016', null, 1::smallint),
           (current_setting('test0016.doc')::uuid, 'document', 'https://alice.example.test/brochure.pdf', 'Brochure', 2::smallint)$$,
  'critère 2 (décision 8) : un élément portant l''id d''un lien existant le conserve (même id après l''appel)'
);
select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%s","platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016","label":"LinkedIn"},
               {"id":"%s","platform":"github","url":"https://github.com/alice-0016"},
               {"id":"%s","platform":"document","url":"https://alice.example.test/brochure.pdf","label":"Brochure"}]',
             current_setting('test0016.li'), current_setting('test0016.gh'), current_setting('test0016.doc'))::jsonb)$$,
  'critère 2 (décision 8) : la même liste avec id est rejouée sans erreur'
);
select results_eq(
  $$select id, platform, url, label, position from carnet.links order by position$$,
  $$values (current_setting('test0016.li')::uuid, 'linkedin'::text, 'https://www.linkedin.com/in/alice-0016'::text, 'LinkedIn'::text, 0::smallint),
           (current_setting('test0016.gh')::uuid, 'github', 'https://github.com/alice-0016', null, 1::smallint),
           (current_setting('test0016.doc')::uuid, 'document', 'https://alice.example.test/brochure.pdf', 'Brochure', 2::smallint)$$,
  'critère 2 (décision 8) : rejouer la même liste avec id donne le même état et les mêmes id (idempotence)'
);

select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%s","platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016-pro","label":"LinkedIn Pro"},
               {"id":"%s","platform":"website","url":"https://alice.example.test","label":"Site"},
               {"id":"%s","platform":"document","url":"https://alice.example.test/brochure.pdf"}]',
             current_setting('test0016.li'), current_setting('test0016.gh'), current_setting('test0016.doc'))::jsonb)$$,
  'critère 2 (décision 8) : replace_links met à jour sur place des liens identifiés par leur id'
);
select results_eq(
  $$select id, platform, url, label, position from carnet.links order by position$$,
  $$values (current_setting('test0016.li')::uuid, 'linkedin'::text, 'https://www.linkedin.com/in/alice-0016-pro'::text, 'LinkedIn Pro'::text, 0::smallint),
           (current_setting('test0016.gh')::uuid, 'website', 'https://alice.example.test', 'Site', 1::smallint),
           (current_setting('test0016.doc')::uuid, 'document', 'https://alice.example.test/brochure.pdf', null, 2::smallint)$$,
  'critère 2 (décision 8) : plateforme, url et libellé (retiré → nul) mis à jour, id conservés'
);

select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%s","platform":"document","url":"https://alice.example.test/brochure.pdf"},
               {"id":"%s","platform":"website","url":"https://alice.example.test","label":"Site"},
               {"id":"%s","platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016-pro","label":"LinkedIn Pro"}]',
             current_setting('test0016.doc'), current_setting('test0016.gh'), current_setting('test0016.li'))::jsonb)$$,
  'critère 2 (décision 8) : échanger les positions 0 et 2 de deux liens existants identifiés par leur id est accepté (contrainte différée)'
);
select results_eq(
  $$select id, platform, position from carnet.links order by position$$,
  $$values (current_setting('test0016.doc')::uuid, 'document'::text, 0::smallint),
           (current_setting('test0016.gh')::uuid, 'website', 1::smallint),
           (current_setting('test0016.li')::uuid, 'linkedin', 2::smallint)$$,
  'critère 2 (décision 8) : après l''échange, les deux liens ont permuté de position en conservant leur id'
);

select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%s","platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016","label":"LinkedIn"},
               {"platform":"github","url":"https://github.com/alice-0016"}]',
             current_setting('test0016.li'))::jsonb)$$,
  'critère 2 (décision 8) : une liste mêlant un id existant et un élément sans id est acceptée'
);
select results_eq(
  $$select platform, position, id = current_setting('test0016.li')::uuid from carnet.links order by position$$,
  $$values ('linkedin'::text, 0::smallint, true), ('github', 1::smallint, false)$$,
  'critère 2 (décision 8) : le lien identifié garde son id ; l''élément sans id reçoit un nouvel id'
);
select is_empty(
  $$select 1 from carnet.links where id in (current_setting('test0016.gh')::uuid, current_setting('test0016.doc')::uuid)$$,
  'critère 2 (décision 8) : les liens du profil absents de la liste sont supprimés (et le nouvel id n''en réutilise aucun)'
);
do $$
begin
  perform set_config('test0016.gh2', (select id::text from carnet.links where platform = 'github'), true);
end
$$;

select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%s","platform":"linkedin","url":"https://evil.example.test"},
               {"id":"00000000-0000-4000-8000-0000000016ee","platform":"website","url":"https://alice.example.test"}]',
             current_setting('test0016.li'))::jsonb)$$,
  '22023', null, 'critère 2 (décision 8) : un id inconnu est refusé (22023)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      '[{"id":"00000000-0000-4000-8000-000000001650","platform":"github","url":"https://evil.example.test"}]'::jsonb)$$,
  '22023', null, 'critère 2 (décision 8) : l''id d''un lien d''un autre profil est refusé (22023)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%1$s","platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016"},
               {"id":"%1$s","platform":"website","url":"https://evil.example.test"}]',
             current_setting('test0016.li'))::jsonb)$$,
  '22023', null, 'critère 2 (décision 8) : un id présent deux fois est refusé (22023)'
);
select throws_ok(
  $$select carnet.replace_links('00000000-0000-4000-8000-000000001620', '[1]'::jsonb)$$,
  '22023', null, 'critère 2 (décision 8) : un élément qui n''est pas un objet ([1]) est refusé (22023)'
);
select throws_ok(
  $$select carnet.replace_links('00000000-0000-4000-8000-000000001620', '[null]'::jsonb)$$,
  '22023', null, 'critère 2 (décision 8) : un élément nul ([null]) est refusé (22023)'
);
select results_eq(
  $$select id, platform, url, label, position from carnet.links order by position$$,
  $$values (current_setting('test0016.li')::uuid, 'linkedin'::text, 'https://www.linkedin.com/in/alice-0016'::text, 'LinkedIn'::text, 0::smallint),
           (current_setting('test0016.gh2')::uuid, 'github', 'https://github.com/alice-0016', null, 1::smallint)$$,
  'critère 2 (décision 8) : après les refus 22023 (id inconnu, d''autrui, en double, non objet), aucun changement'
);

-- Décision 8, second audit : types JSON stricts et id canonique ; le premier élément, valide, modifierait le lien li.
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%1$s","platform":"linkedin","url":"https://evil.example.test","label":"LinkedIn"},
               {"platform":1,"url":"https://alice.example.test"}]',
             current_setting('test0016.li'))::jsonb)$$,
  '22023', null, 'critère 2 (décision 8, second audit) : une platform nombre est refusée (22023)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%1$s","platform":"linkedin","url":"https://evil.example.test","label":"LinkedIn"},
               {"platform":true,"url":"https://alice.example.test"}]',
             current_setting('test0016.li'))::jsonb)$$,
  '22023', null, 'critère 2 (décision 8, second audit) : une platform booléenne est refusée (22023)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%1$s","platform":"linkedin","url":"https://evil.example.test","label":"LinkedIn"},
               {"platform":{"v":"website"},"url":"https://alice.example.test"}]',
             current_setting('test0016.li'))::jsonb)$$,
  '22023', null, 'critère 2 (décision 8, second audit) : une platform objet est refusée (22023)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%1$s","platform":"linkedin","url":"https://evil.example.test","label":"LinkedIn"},
               {"platform":"website","url":1}]',
             current_setting('test0016.li'))::jsonb)$$,
  '22023', null, 'critère 2 (décision 8, second audit) : une url nombre est refusée (22023)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%1$s","platform":"linkedin","url":"https://evil.example.test","label":"LinkedIn"},
               {"platform":"website","url":false}]',
             current_setting('test0016.li'))::jsonb)$$,
  '22023', null, 'critère 2 (décision 8, second audit) : une url booléenne est refusée (22023)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%1$s","platform":"linkedin","url":"https://evil.example.test","label":"LinkedIn"},
               {"platform":"website","url":{"href":"https://alice.example.test"}}]',
             current_setting('test0016.li'))::jsonb)$$,
  '22023', null, 'critère 2 (décision 8, second audit) : une url objet est refusée (22023)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%1$s","platform":"linkedin","url":"https://evil.example.test","label":"LinkedIn"},
               {"platform":"website","url":"https://alice.example.test","label":42}]',
             current_setting('test0016.li'))::jsonb)$$,
  '22023', null, 'critère 2 (décision 8, second audit) : un label nombre est refusé (22023)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%1$s","platform":"linkedin","url":"https://evil.example.test","label":"LinkedIn"},
               {"platform":"website","url":"https://alice.example.test","label":true}]',
             current_setting('test0016.li'))::jsonb)$$,
  '22023', null, 'critère 2 (décision 8, second audit) : un label booléen est refusé (22023)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%1$s","platform":"linkedin","url":"https://evil.example.test","label":"LinkedIn"},
               {"platform":"website","url":"https://alice.example.test","label":{"t":"Site"}}]',
             current_setting('test0016.li'))::jsonb)$$,
  '22023', null, 'critère 2 (décision 8, second audit) : un label objet est refusé (22023)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"{%s}","platform":"linkedin","url":"https://evil.example.test","label":"LinkedIn"}]',
             current_setting('test0016.li'))::jsonb)$$,
  '22023', null, 'critère 2 (décision 8, second audit) : un id entre accolades ({uuid}), même d''un lien existant, est refusé (22023)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%s","platform":"linkedin","url":"https://evil.example.test","label":"LinkedIn"}]',
             replace(current_setting('test0016.li'), '-', ''))::jsonb)$$,
  '22023', null, 'critère 2 (décision 8, second audit) : un id sans tirets, même d''un lien existant, est refusé (22023)'
);
select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%s","platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016","label":"LinkedIn"},
               {"id":"%s","platform":"github","url":"https://github.com/alice-0016","label":null}]',
             current_setting('test0016.li'), current_setting('test0016.gh2'))::jsonb)$$,
  'critère 2 (décision 8, second audit) : un label JSON null est accepté'
);
select results_eq(
  $$select id, platform, url, label, position from carnet.links order by position$$,
  $$values (current_setting('test0016.li')::uuid, 'linkedin'::text, 'https://www.linkedin.com/in/alice-0016'::text, 'LinkedIn'::text, 0::smallint),
           (current_setting('test0016.gh2')::uuid, 'github', 'https://github.com/alice-0016', null, 1::smallint)$$,
  'critère 2 (décision 8, second audit) : après les refus de type et d''id non canonique, aucun changement ; label null enregistré nul'
);

-- Décision 8, précisions de mise en œuvre : id JSON null = absent, id insensible à la casse, ligne identique non réécrite
select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%s","platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016","label":"LinkedIn"},
               {"id":"%s","platform":"github","url":"https://github.com/alice-0016"},
               {"id":null,"platform":"website","url":"https://alice.example.test"}]',
             current_setting('test0016.li'), current_setting('test0016.gh2'))::jsonb)$$,
  'critère 2 (décision 8) : un élément {"id": null, ...} est accepté'
);
select results_eq(
  $$select platform, position, id = current_setting('test0016.li')::uuid, id = current_setting('test0016.gh2')::uuid
      from carnet.links order by position$$,
  $$values ('linkedin'::text, 0::smallint, true, false), ('github', 1::smallint, false, true), ('website', 2::smallint, false, false)$$,
  'critère 2 (décision 8) : un élément {"id": null, ...} crée un nouveau lien (nouvel id)'
);

select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%s","platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016-pro","label":"LinkedIn Pro"},
               {"id":"%s","platform":"github","url":"https://github.com/alice-0016"}]',
             upper(current_setting('test0016.li')), current_setting('test0016.gh2'))::jsonb)$$,
  'critère 2 (décision 8) : un id existant écrit en majuscules est accepté'
);
select results_eq(
  $$select id, platform, url, label, position from carnet.links order by position$$,
  $$values (current_setting('test0016.li')::uuid, 'linkedin'::text, 'https://www.linkedin.com/in/alice-0016-pro'::text, 'LinkedIn Pro'::text, 0::smallint),
           (current_setting('test0016.gh2')::uuid, 'github', 'https://github.com/alice-0016', null, 1::smallint)$$,
  'critère 2 (décision 8) : un id existant écrit en majuscules met à jour le lien existant (même id, valeurs changées)'
);

-- now() est figé dans la transaction : updated_at est d'abord fixé dans le passé par postgres (trigger désactivé)
reset role;
alter table carnet.links disable trigger links_set_updated_at;
update carnet.links set updated_at = '2000-01-01' where profile_id = '00000000-0000-4000-8000-000000001620';
alter table carnet.links enable trigger links_set_updated_at;
set local role authenticated;
select is(
  (select count(*) from carnet.links where updated_at = '2000-01-01'),
  2::bigint,
  'critère 2 (précondition) : updated_at des liens du profil fixé dans le passé'
);
select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%s","platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016-pro","label":"LinkedIn Pro"},
               {"id":"%s","platform":"github","url":"https://github.com/alice-0016"}]',
             current_setting('test0016.li'), current_setting('test0016.gh2'))::jsonb)$$,
  'critère 2 (décision 8) : la liste identique avec id est rejouée sans erreur'
);
select results_eq(
  $$select id, updated_at from carnet.links order by position$$,
  $$values (current_setting('test0016.li')::uuid, '2000-01-01'::timestamptz), (current_setting('test0016.gh2')::uuid, '2000-01-01'::timestamptz)$$,
  'critère 2 (décision 8) : rejouer une liste identique (avec id) ne modifie pas updated_at (ligne identique non réécrite)'
);

select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      format('[{"id":"%s","platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016","label":"LinkedIn",
                "profile_id":"00000000-0000-4000-8000-000000001621","position":9,"created_at":"2000-01-01T00:00:00Z"},
               {"platform":"x","url":"https://x.com/alice-0016",
                "profile_id":"00000000-0000-4000-8000-000000001621","position":0,"created_at":"2000-01-01T00:00:00Z"}]',
             current_setting('test0016.li'))::jsonb)$$,
  'critère 2 (décision 8) : des clés profile_id, position, created_at dans les éléments ne font pas échouer l''appel'
);
select results_eq(
  $$select id = current_setting('test0016.li')::uuid, platform, profile_id, position, created_at = now()
      from carnet.links order by position$$,
  $$values (true, 'linkedin'::text, '00000000-0000-4000-8000-000000001620'::uuid, 0::smallint, true),
           (false, 'x', '00000000-0000-4000-8000-000000001620'::uuid, 1::smallint, true)$$,
  'critère 2 (décision 8) : clés profile_id, position, created_at ignorées (liens sur le profil appelé, position = rang, created_at intact)'
);

select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      '[{"platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016","label":"LinkedIn"},
        {"platform":"github","url":"https://github.com/alice-0016"},
        {"platform":"document","url":"https://alice.example.test/brochure.pdf","label":"Brochure"}]'::jsonb)$$,
  'critère 2 : replace_links appliquée une première fois avec une liste sans id'
);
select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      '[{"platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016","label":"LinkedIn"},
        {"platform":"github","url":"https://github.com/alice-0016"},
        {"platform":"document","url":"https://alice.example.test/brochure.pdf","label":"Brochure"}]'::jsonb)$$,
  'critère 2 : replace_links rejouée avec la même liste sans id ne lève pas d''erreur'
);
select results_eq(
  $$select platform, url, label, position from carnet.links order by position$$,
  $$values ('linkedin'::text, 'https://www.linkedin.com/in/alice-0016'::text, 'LinkedIn'::text, 0::smallint),
           ('github', 'https://github.com/alice-0016', null, 1::smallint),
           ('document', 'https://alice.example.test/brochure.pdf', 'Brochure', 2::smallint)$$,
  'critère 2 : replace_links appliquée deux fois avec la même liste sans id donne le même état (aucun doublon)'
);

select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      '[{"platform":"document","url":"https://alice.example.test/brochure.pdf","label":"Brochure"},
        {"platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016","label":"LinkedIn"},
        {"platform":"github","url":"https://github.com/alice-0016"}]'::jsonb)$$,
  'critère 2 : une liste réordonnée est acceptée'
);
select results_eq(
  $$select platform, position from carnet.links order by position$$,
  $$values ('document'::text, 0::smallint), ('linkedin', 1::smallint), ('github', 2::smallint)$$,
  'critère 2 : après réordonnancement, les positions suivent le nouvel ordre'
);

select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      (select jsonb_agg(jsonb_build_object('platform', 'website', 'url', 'https://alice.example.test/' || g) order by g)
         from generate_series(1, 12) g))$$,
  'critère 2 : une liste de 12 liens est acceptée'
);
select is(
  (select count(*) from carnet.links),
  12::bigint,
  'critère 2 : 12 liens enregistrés (positions 0 à 11)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      (select jsonb_agg(jsonb_build_object('platform', 'website', 'url', 'https://alice.example.test/' || g) order by g)
         from generate_series(1, 13) g))$$,
  '23514', null, 'critère 2 : une liste de 13 liens est refusée (links_position_range_check)'
);
select is(
  (select count(*) from carnet.links),
  12::bigint,
  'critère 2 : après le refus de 13 liens, la liste précédente est intacte (atomicité)'
);

select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      '[{"platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016","label":"LinkedIn"},
        {"platform":"github","url":"https://github.com/alice-0016"},
        {"platform":"document","url":"https://alice.example.test/brochure.pdf","label":"Brochure"}]'::jsonb)$$,
  'critère 2 (précondition) : retour à la liste de trois liens'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      '[{"platform":"website","url":"https://alice.example.test"},
        {"platform":"website","url":"http://alice.example.test"}]'::jsonb)$$,
  '23514', null, 'critère 2 : un élément en http:// est refusé (23514)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      '[{"platform":"website","url":"javascript:alert(1)"}]'::jsonb)$$,
  '23514', null, 'critère 2 : un élément en javascript: est refusé (23514)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      '[{"platform":"mastodon","url":"https://mastodon.example.test/@alice"}]'::jsonb)$$,
  '23514', null, 'critère 2 : un élément de plateforme hors liste est refusé (23514)'
);
select results_eq(
  $$select platform, position from carnet.links order by position$$,
  $$values ('linkedin'::text, 0::smallint), ('github', 1::smallint), ('document', 2::smallint)$$,
  'critère 2 : après les refus, la liste de trois liens est intacte (atomicité)'
);

select throws_ok(
  $$select carnet.replace_links('00000000-0000-4000-8000-000000001620', null)$$,
  '22023', null, 'critère 2 (décision 7) : p_links nul est refusé (22023)'
);
select throws_ok(
  $$select carnet.replace_links('00000000-0000-4000-8000-000000001620',
      '{"platform":"website","url":"https://alice.example.test"}'::jsonb)$$,
  '22023', null, 'critère 2 (décision 7) : p_links objet JSON (pas un tableau) est refusé (22023)'
);
select throws_ok(
  $$select carnet.replace_links('00000000-0000-4000-8000-000000001620', '"https://alice.example.test"'::jsonb)$$,
  '22023', null, 'critère 2 (décision 7) : p_links scalaire JSON (pas un tableau) est refusé (22023)'
);
select results_eq(
  $$select platform, position from carnet.links order by position$$,
  $$values ('linkedin'::text, 0::smallint), ('github', 1::smallint), ('document', 2::smallint)$$,
  'critère 2 (décision 7) : après p_links nul ou non tableau, la liste de trois liens est intacte (rien supprimé)'
);

select lives_ok(
  $$select carnet.replace_links('00000000-0000-4000-8000-000000001620', '[]'::jsonb)$$,
  'critère 2 : une liste vide est acceptée'
);
select is_empty($$select * from carnet.links$$, 'critère 2 : une liste vide supprime tous les liens du profil');
select results_eq(
  $$select platform, position
      from carnet.replace_links(
        '00000000-0000-4000-8000-000000001620',
        '[{"platform":"github","url":"https://github.com/alice-0016","position":7},
          {"platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016","position":0}]'::jsonb)
     order by position$$,
  $$values ('github'::text, 0::smallint), ('linkedin', 1::smallint)$$,
  'critère 2 (décision 7) : une clé position dans un élément est ignorée, la position renvoyée est le rang dans le tableau'
);
select results_eq(
  $$select platform, position from carnet.links order by position$$,
  $$values ('github'::text, 0::smallint), ('linkedin', 1::smallint)$$,
  'critère 2 (décision 7) : la position stockée est le rang dans le tableau, pas la clé position fournie'
);
select lives_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      '[{"platform":"linkedin","url":"https://www.linkedin.com/in/alice-0016","label":"LinkedIn"},
        {"platform":"github","url":"https://github.com/alice-0016"},
        {"platform":"document","url":"https://alice.example.test/brochure.pdf","label":"Brochure"}]'::jsonb)$$,
  'critère 2 (précondition) : la liste de trois liens est rétablie'
);

-- Réordonnancement direct en une instruction (contrainte différable) : linkedin ↔ document, et l'ordre physique
-- des lignes ne suit plus les positions (sert au tri de get_public_links plus bas).
with moved as (
  update carnet.links set position = case position when 0 then 2 else 0 end
   where profile_id = '00000000-0000-4000-8000-000000001620' and position in (0, 2)
  returning 1
)
select is(count(*), 2::bigint, 'critère 2 : le propriétaire échange deux positions en une instruction (contrainte différable)') from moved;
do $$
begin
  perform set_config('test0016.li3', (select id::text from carnet.links where platform = 'linkedin'), true);
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- Critère 1 — A2 : autre membre de carnet
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000160b","role":"authenticated"}';

select results_eq(
  $$select platform, url from carnet.links$$,
  $$values ('github'::text, 'https://github.com/bob-0016'::text)$$,
  'critère 1 : un autre membre ne voit que ses propres liens, pas ceux de A'
);
with updated as (
  update carnet.links set url = 'https://evil.example.test' where profile_id = '00000000-0000-4000-8000-000000001620' returning 1
)
select is(count(*), 0::bigint, 'critère 1 : un autre membre ne modifie pas les liens de A (0 ligne affectée)') from updated;
with deleted as (
  delete from carnet.links where profile_id = '00000000-0000-4000-8000-000000001620' returning 1
)
select is(count(*), 0::bigint, 'critère 1 : un autre membre ne supprime pas les liens de A (0 ligne affectée)') from deleted;
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001620', 'x', 'https://x.com/intruder', 5)$$,
  '42501', null, 'critère 1 : un autre membre ne peut pas créer de lien sur le profil de A'
);
select throws_ok(
  $$select carnet.replace_links('00000000-0000-4000-8000-000000001620',
      '[{"platform":"website","url":"https://evil.example.test"}]'::jsonb)$$,
  '42501', null, 'critère 2 : replace_links appelée par un autre membre sur le profil de A est refusée'
);
select throws_ok(
  $$select carnet.replace_links('00000000-0000-4000-8000-000000001620', '[]'::jsonb)$$,
  '42501', null, 'critère 2 (décision 8) : replace_links avec une liste vide sur le profil de A est refusée à un autre membre (42501)'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001620',
      (select jsonb_agg(jsonb_build_object('platform', 'website', 'url', 'https://evil.example.test/' || g) order by g)
         from generate_series(1, 13) g))$$,
  '23514', null, 'critère 2 (décision 8) : plus de 12 éléments → 23514 avant toute lecture, même sur le profil d''autrui'
);
select throws_ok(
  $$select carnet.replace_links(
      '00000000-0000-4000-8000-000000001621',
      format('[{"id":"%s","platform":"website","url":"https://evil.example.test"}]', current_setting('test0016.li3'))::jsonb)$$,
  '22023', null, 'critère 2 (décision 8) : un autre membre ne peut pas capter un lien de A en citant son id sur son propre profil (22023)'
);
select results_eq(
  $$select id, platform, url from carnet.links$$,
  $$values ('00000000-0000-4000-8000-000000001650'::uuid, 'github'::text, 'https://github.com/bob-0016'::text)$$,
  'critère 2 (décision 8) : après la tentative de captation, le profil de A2 garde son seul lien d''origine'
);
reset role;

select results_eq(
  $$select platform, url, label, position from carnet.links
     where profile_id = '00000000-0000-4000-8000-000000001620' order by position$$,
  $$values ('document'::text, 'https://alice.example.test/brochure.pdf'::text, 'Brochure'::text, 0::smallint),
           ('github', 'https://github.com/alice-0016', null, 1::smallint),
           ('linkedin', 'https://www.linkedin.com/in/alice-0016', 'LinkedIn', 2::smallint)$$,
  'critère 2 : replace_links appelée par un autre compte (liste vide ou non) n''a aucun effet sur les liens de A'
);
select is(
  (select id from carnet.links where profile_id = '00000000-0000-4000-8000-000000001620' and platform = 'linkedin'),
  current_setting('test0016.li3')::uuid,
  'critère 2 (décision 8) : le lien de A cité par A2 conserve son id et reste sur le profil de A'
);

-- ---------------------------------------------------------------------------
-- Critère 1 — B : authentifié sans appartenance (même propriétaire d'un profil et d'un lien, il n'accède à rien)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000160c","role":"authenticated"}';

select is_empty($$select * from carnet.links$$, 'critère 1 : un compte sans appartenance ne voit aucun lien, pas même les siens');
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001622', 'website', 'https://bea.example.test', 1)$$,
  '42501', null, 'critère 1 : un compte sans appartenance ne crée pas de lien, même sur un profil à son nom'
);
with updated as (
  update carnet.links set label = 'Hacked' where profile_id in ('00000000-0000-4000-8000-000000001620', '00000000-0000-4000-8000-000000001622') returning 1
)
select is(count(*), 0::bigint, 'critère 1 : un compte sans appartenance ne modifie aucun lien (0 ligne)') from updated;
with deleted as (
  delete from carnet.links where profile_id in ('00000000-0000-4000-8000-000000001620', '00000000-0000-4000-8000-000000001622') returning 1
)
select is(count(*), 0::bigint, 'critère 1 : un compte sans appartenance ne supprime aucun lien (0 ligne)') from deleted;
select throws_ok(
  $$select carnet.replace_links('00000000-0000-4000-8000-000000001622',
      '[{"platform":"website","url":"https://bea.example.test"}]'::jsonb)$$,
  '42501', null, 'critère 2 : replace_links est refusée à un compte sans appartenance, même sur un profil à son nom'
);
select throws_ok(
  $$select carnet.replace_links('00000000-0000-4000-8000-000000001622', '[]'::jsonb)$$,
  '42501', null, 'critère 2 (décision 8) : replace_links avec une liste vide est refusée à un compte sans appartenance (42501)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 1 — C : membre d'un autre projet de l'instance
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000160d","role":"authenticated"}';

select is_empty($$select * from carnet.links$$, 'critère 1 : un membre d''un autre projet ne voit aucun lien, pas même les siens');
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001623', 'website', 'https://carl.example.test', 1)$$,
  '42501', null, 'critère 1 : un membre d''un autre projet ne crée pas de lien, même sur un profil à son nom'
);
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001620', 'website', 'https://carl.example.test', 5)$$,
  '42501', null, 'critère 1 : un membre d''un autre projet ne crée pas de lien sur le profil de A'
);
with updated as (
  update carnet.links set label = 'Hacked' where profile_id in ('00000000-0000-4000-8000-000000001620', '00000000-0000-4000-8000-000000001623') returning 1
)
select is(count(*), 0::bigint, 'critère 1 : un membre d''un autre projet ne modifie aucun lien (0 ligne)') from updated;
with deleted as (
  delete from carnet.links where profile_id in ('00000000-0000-4000-8000-000000001620', '00000000-0000-4000-8000-000000001623') returning 1
)
select is(count(*), 0::bigint, 'critère 1 : un membre d''un autre projet ne supprime aucun lien (0 ligne)') from deleted;
select throws_ok(
  $$select carnet.replace_links('00000000-0000-4000-8000-000000001620',
      '[{"platform":"website","url":"https://carl.example.test"}]'::jsonb)$$,
  '42501', null, 'critère 2 : replace_links est refusée à un membre d''un autre projet sur le profil de A'
);
select throws_ok(
  $$select carnet.replace_links('00000000-0000-4000-8000-000000001623', '[]'::jsonb)$$,
  '42501', null, 'critère 2 (décision 8) : replace_links avec une liste vide est refusée à un membre d''un autre projet, même sur un profil à son nom (42501)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 1 — anon : aucun privilège sur la table ni sur replace_links
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok($$select * from carnet.links$$, '42501', null, 'critère 1 : anon ne lit pas la table links');
select throws_ok(
  $$insert into carnet.links (profile_id, platform, url, position)
    values ('00000000-0000-4000-8000-000000001620', 'website', 'https://anon.example.test', 5)$$,
  '42501', null, 'critère 1 : anon ne crée pas de lien'
);
select throws_ok(
  $$update carnet.links set label = 'Hacked'$$,
  '42501', null, 'critère 1 : anon ne modifie pas de lien'
);
select throws_ok(
  $$delete from carnet.links$$,
  '42501', null, 'critère 1 : anon ne supprime pas de lien'
);
select throws_ok(
  $$select carnet.replace_links('00000000-0000-4000-8000-000000001620', '[]'::jsonb)$$,
  '42501', null, 'critère 2 : anon ne peut pas appeler replace_links'
);
reset role;

set local role service_role;
select throws_ok(
  $$select carnet.replace_links('00000000-0000-4000-8000-000000001620', '[]'::jsonb)$$,
  '42501', null, 'critère 2 (décision 8) : service_role ne peut pas appeler replace_links (execute retiré)'
);
reset role;

-- Contrôle postgres : aucune tentative des autres comptes n'a modifié les liens.
select results_eq(
  $$select p.slug, l.platform, l.label, l.position
      from carnet.links l join carnet.profiles p on p.id = l.profile_id
     order by p.slug, l.position$$,
  $$values ('alice-0016'::text, 'document'::text, 'Brochure'::text, 0::smallint),
           ('alice-0016', 'github', null, 1::smallint),
           ('alice-0016', 'linkedin', 'LinkedIn', 2::smallint),
           ('bea-0016', 'x', null, 0::smallint),
           ('bob-0016', 'github', 'Bob GH', 0::smallint),
           ('carl-0016', 'youtube', null, 0::smallint)$$,
  'critère 1 : contrôle postgres, tous les liens sont intacts après les tentatives des autres comptes'
);

-- ---------------------------------------------------------------------------
-- Critère 3 — get_public_links
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select lives_ok(
  $$select * from carnet.get_public_links('inconnu-0016')$$,
  'critère 3 : get_public_links ne lève pas d''erreur pour un slug inexistant'
);
select is_empty(
  $$select * from carnet.get_public_links('inconnu-0016')$$,
  'critère 3 : get_public_links ne renvoie rien pour un profil inexistant'
);
select is_empty(
  $$select * from carnet.get_public_links(null)$$,
  'critère 3 : get_public_links ne renvoie rien pour un slug nul'
);
select is_empty(
  $$select * from carnet.get_public_links('alice-0016')$$,
  'critère 3 : get_public_links ne renvoie rien pour un profil non publié (anon)'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000160b","role":"authenticated"}';
select is_empty(
  $$select * from carnet.get_public_links('alice-0016')$$,
  'critère 3 : get_public_links ne renvoie rien pour un profil non publié (autre membre)'
);
reset role;

-- A publie son profil (update sous RLS) ; ceux de A2, B et C restent non publiés.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000160a","role":"authenticated"}';
with published as (
  update carnet.profiles set is_published = true where id = '00000000-0000-4000-8000-000000001620' returning 1
)
select is(count(*), 1::bigint, 'critère 3 (précondition) : le propriétaire publie son profil') from published;
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select results_eq(
  $$select platform, url, label, position from carnet.get_public_links('alice-0016')$$,
  $$values ('document'::text, 'https://alice.example.test/brochure.pdf'::text, 'Brochure'::text, 0::smallint),
           ('github', 'https://github.com/alice-0016', null, 1::smallint),
           ('linkedin', 'https://www.linkedin.com/in/alice-0016', 'LinkedIn', 2::smallint)$$,
  'critère 3 : anon obtient les liens du profil publié, triés par position, colonnes platform, url, label, position'
);
select lives_ok(
  $$select id from carnet.get_public_links('alice-0016')$$,
  'critère 3 (amendé 0034, décision 2) : get_public_links expose id (uuid du lien, sans donnée personnelle)'
);
select throws_ok(
  $$select profile_id from carnet.get_public_links('alice-0016')$$,
  '42703', null, 'critère 3 : get_public_links n''expose pas profile_id'
);
select is_empty(
  $$select * from carnet.get_public_links('bob-0016')$$,
  'critère 3 : anon n''obtient pas les liens du profil non publié de A2'
);
select throws_ok($$select * from carnet.links$$, '42501', null, 'critère 3 : la publication n''ouvre pas la table links à anon');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000160b","role":"authenticated"}';
select results_eq(
  $$select platform, position from carnet.get_public_links('alice-0016')$$,
  $$values ('document'::text, 0::smallint), ('github', 1::smallint), ('linkedin', 2::smallint)$$,
  'critère 3 : un autre membre obtient les liens triés du profil publié de A par la fonction'
);
select is_empty(
  $$select * from carnet.links where profile_id = '00000000-0000-4000-8000-000000001620'$$,
  'critère 3 : la publication n''ouvre pas la table links à un autre membre'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000160d","role":"authenticated"}';
select results_eq(
  $$select platform from carnet.get_public_links('alice-0016')$$,
  $$values ('document'::text), ('github'), ('linkedin')$$,
  'critère 3 : un membre d''un autre projet obtient aussi les liens publics (lecture publique, comme anon)'
);
reset role;

-- Décision 7 — même visibilité que get_public_profile. postgres publie les profils de B (propriétaire sans
-- appartenance carnet) et de C (propriétaire membre d'un autre projet) ; celui de A2 reste non publié.
-- get_public_profile ne filtre que sur is_published : ces deux profils y sont visibles, leurs liens doivent l'être aussi.
update carnet.profiles set is_published = true
 where id in ('00000000-0000-4000-8000-000000001622', '00000000-0000-4000-8000-000000001623');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select results_eq(
  $$select exists (select 1 from carnet.get_public_links('alice-0016')), exists (select 1 from carnet.get_public_profile('alice-0016'))$$,
  $$values (true, true)$$,
  'critère 3 (décision 7) : profil publié, get_public_links et get_public_profile sont tous deux non vides'
);
select results_eq(
  $$select exists (select 1 from carnet.get_public_links('bob-0016')), exists (select 1 from carnet.get_public_profile('bob-0016'))$$,
  $$values (false, false)$$,
  'critère 3 (décision 7) : profil non publié (avec un lien), get_public_links et get_public_profile sont tous deux vides'
);
select results_eq(
  $$select exists (select 1 from carnet.get_public_links('inconnu-0016')), exists (select 1 from carnet.get_public_profile('inconnu-0016'))$$,
  $$values (false, false)$$,
  'critère 3 (décision 7) : profil inexistant, get_public_links et get_public_profile sont tous deux vides'
);
select results_eq(
  $$select exists (select 1 from carnet.get_public_links('bea-0016')), exists (select 1 from carnet.get_public_profile('bea-0016'))$$,
  $$values (true, true)$$,
  'critère 3 (décision 7) : profil publié dont le propriétaire n''est pas membre de carnet, les deux fonctions sont non vides (même règle)'
);
select results_eq(
  $$select exists (select 1 from carnet.get_public_links('carl-0016')), exists (select 1 from carnet.get_public_profile('carl-0016'))$$,
  $$values (true, true)$$,
  'critère 3 (décision 7) : profil publié dont le propriétaire est membre d''un autre projet, les deux fonctions sont non vides (même règle)'
);
reset role;

-- A dépublie : plus rien n'est renvoyé.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000160a","role":"authenticated"}';
with unpublished as (
  update carnet.profiles set is_published = false where id = '00000000-0000-4000-8000-000000001620' returning 1
)
select is(count(*), 1::bigint, 'critère 3 (précondition) : le propriétaire dépublie son profil') from unpublished;
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is_empty(
  $$select * from carnet.get_public_links('alice-0016')$$,
  'critère 3 : après dépublication, get_public_links ne renvoie plus rien'
);
select results_eq(
  $$select exists (select 1 from carnet.get_public_links('alice-0016')), exists (select 1 from carnet.get_public_profile('alice-0016'))$$,
  $$values (false, false)$$,
  'critère 3 (décision 7) : après dépublication, get_public_links et get_public_profile sont tous deux vides'
);
reset role;

-- ---------------------------------------------------------------------------
-- Critère 4 — suppression du profil publié de A : ses liens disparaissent (cascade)
-- Amendé par 0022 (décision 8) : le delete direct sous authenticated est retiré ; le profil est supprimé par
-- la suppression du compte de A (postgres, cascade auth.users → profiles → links).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000160a","role":"authenticated"}';
update carnet.profiles set is_published = true where id = '00000000-0000-4000-8000-000000001620';
select throws_ok(
  $$delete from carnet.profiles where id = '00000000-0000-4000-8000-000000001620'$$,
  '42501', null, 'critère 4 (amendé 0022, décision 8) : le propriétaire ne supprime pas directement son profil (42501)'
);
reset role;

select lives_ok(
  $$delete from auth.users where id = '00000000-0000-4000-8000-00000000160a'$$,
  'critère 4 (précondition, amendé 0022) : le compte de A est supprimé (postgres), son profil publié avec lui'
);

select is(
  (select count(*) from carnet.links where profile_id = '00000000-0000-4000-8000-000000001620'),
  0::bigint,
  'critère 4 : la suppression du profil supprime ses liens (cascade, contrôle postgres)'
);
select is(
  (select count(*) from carnet.links),
  3::bigint,
  'critère 4 : les liens des autres profils sont intacts'
);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is_empty(
  $$select * from carnet.get_public_links('alice-0016')$$,
  'critère 4 : le profil supprimé n''a plus de liens publics'
);
reset role;

select * from finish();
rollback;
