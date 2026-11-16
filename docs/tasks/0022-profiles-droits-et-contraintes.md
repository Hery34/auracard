# 0022 — `profiles` : droits par colonne et contraintes de format

- Statut : done (16/11/2026)
- Agent : db-architect ; test-engineer (pgTAP, unitaires) ; backend (alignement des schémas applicatifs, décision 9)
- Phase : 2 (correctif de sécurité, avant 0018 et 0019)
- ADR liées : 0002, 0004, 0011

## Objectif
Un membre connecté qui écrit directement par PostgREST ne peut modifier que les champs éditables de son profil, et la base refuse les valeurs que l'application refuse déjà.

## Contexte
Audit 0017 (risque élevé) : `grant update on carnet.profiles to authenticated` (migration `20261115120000_create_profiles.sql`) couvre toutes les colonnes, et le schéma `carnet` est exposé à PostgREST. Sur sa propre ligne, un membre peut changer son `slug` (y compris vers un slug réservé : cartes NFC et QR cassées, décision 1 de 0017 contournée), écrire `avatar_url`/`banner_url` arbitraires, un `website_url` non `https:` et des caractères de contrôle ou bidirectionnels dans les textes. La décision 4 de 0005 (« pas de validation de format en base ») supposait que l'application était le seul chemin d'écriture. Décision de Hery (16/11/2026) : corriger maintenant.

## Périmètre de fichiers
- Autorisé (db-architect) : nouvelle migration `supabase/migrations/<horodatage>_restrict_profiles_writes.sql` (la migration de 0005 est déjà en `main` : on ne la modifie pas).
- Autorisé (db-architect, décision 10) : nouvelle migration `supabase/migrations/<horodatage>_restrict_links_writes.sql`.
- Autorisé (backend, décision 9) : `src/server/actions/auth-schemas.ts`, `src/server/actions/profile-schemas.ts`.
- Autorisé (test-engineer) : `supabase/tests/carnet_profiles_writes.test.sql`, `supabase/tests/carnet_links_*.test.sql`, `src/server/actions/{auth,profile}-schemas.test.ts` ; adaptations des tests existants de `profiles` seulement si un privilège testé change (à signaler).
- Interdit : tout le reste.

## Décisions de conception
1. **Droit `update` par colonne** : `revoke update on carnet.profiles from authenticated`, puis `grant update (display_name, job_title, company, bio, contact_email, phone, website_url, is_published, is_indexable)`. `slug`, `owner_id`, `theme`, `avatar_url`, `banner_url`, `id`, horodatages : hors de portée (`updated_at` reste posé par le trigger). Les images passeront par 0021.
2. **Droit `insert`** : vérifier comment le profil est créé (`carnet.register_member`, `security definer`, `service_role`, 0006). Si aucun chemin applicatif n'utilise l'`insert` direct par `authenticated`, le retirer (et sa politique), sinon le limiter aux mêmes colonnes plus `slug` validé : db-architect le signale avant d'écrire.
3. **Contraintes nommées** (mêmes règles que l'application en 0017 et que `links` en 0016, indépendantes de la locale) :
   - `profiles_website_url_format_check` : `https://`, ASCII imprimable, hôte `[A-Za-z0-9.-]+` avec port facultatif (même expression que `links_url_host_check`) ;
   - `profiles_text_charset_check` (ou une par colonne) : `display_name`, `job_title`, `company`, `contact_email`, `phone` sans les caractères interdits de `links_label_charset_check` ; `bio` idem en autorisant `\n` et `\r` ;
   - `profiles_phone_format_check` : `^\+?[0-9 .()-]+$` ;
   - `profiles_display_name_blank_check` : au moins un caractère non blanc.
4. **Données existantes** : vérifier qu'aucune ligne réelle ne viole les nouvelles contraintes (base locale ; en production, à vérifier avant `db push`, consigné dans le rapport). Ajout par `alter table … add constraint … not valid` puis `validate constraint`, rejouable.
5. `register_member` (`security definer`) reste fonctionnel : le slug initial est posé par lui.

6. *Décisions de Hery (16/11/2026)* : **`insert` direct retiré** (`revoke insert … from authenticated`, `drop policy profiles_insert_own`) : la création passe uniquement par `register_member`. test-engineer est autorisé à adapter les tests existants de 0005 touchés par ces changements de privilèges (`carnet_profiles_schema.test.sql` l. 620 `table_privs_are`, l. 728 `website_url` de longueur maximale → `'https://a.test/' || repeat('a', 2033)`, assertions d'`insert` sous `authenticated` de `carnet_profiles_access.test.sql`, politique `profiles_insert_own`).
7. Contrat de test-engineer : `profiles_website_url_format_check`, `profiles_text_charset_check` (une contrainte sur `bio`, `company`, `contact_email`, `display_name`, `job_title`, `phone` ; `bio` autorise U+000A et U+000D seulement), `profiles_phone_format_check`, `profiles_display_name_blank_check`, toutes validées.

8. *Décision de Hery (16/11/2026)* : **`delete` direct retiré aussi** (`revoke delete … from authenticated`, `drop policy profiles_delete_own`) : sans création directe, une suppression bloquerait le compte. La suppression de compte passera par un cas d'usage dédié (RGPD, suppression en cascade du profil, des liens et de l'appartenance). test-engineer adapte les tests de 0005 correspondants.

9. *Après revue (16/11/2026, bloquant levé par extension du périmètre, décidée par l'orchestrateur)* : l'application acceptait U+2028 et U+2029 dans `displayName`, `jobTitle`, `company` (`/^[^\p{Cc}\p{Cf}]*$/u`) alors que `profiles_text_charset_check` les refuse → `invalid_input` sans champ, et à l'inscription un compte `auth` sans appartenance ni profil. Correction : les schémas applicatifs refusent aussi U+2028 et U+2029 (nom à l'inscription et au profil, poste, entreprise). La base ne change pas.
10. *Décision de Hery (16/11/2026, audit 0022)* : **droits par colonne sur `carnet.links`** aussi, par une nouvelle migration : `revoke insert, update … from authenticated`, puis `grant insert (profile_id, platform, url, label, position)` et `grant update (platform, url, label, position)` (`id`, `created_at`, `updated_at` et le rattachement à un autre profil hors de portée ; compatible avec `replace_links`).
11. *Autres corrections retenues* : caractères interdits écrits en échappements `\uXXXX` (comme 0016) dans la migration, l'en-tête et les tests (pas de caractères bruts invisibles ou bidirectionnels) ; précondition de production à exécuter **en tant que `postgres`** (sinon 0 ligne à tort) ; libellé du test `owner_id` de `carnet_profiles_access.test.sql` (refus par le privilège de colonne). Reportés : `[:space:]` dépendant de la locale (fiche ultérieure, `profiles` et `links`), `can_create_profile` devenue inutile, `grant all` à `service_role` (fiche suppression de compte), **fiche « suppression de compte » (RGPD, art. 17) avant l'ouverture publique**.

## Critères d'acceptation
1. Sous `authenticated`, sur son propre profil : `update` de chaque colonne éditable accepté ; `update` de `slug`, `owner_id`, `theme`, `avatar_url`, `banner_url` → 42501.
2. Valeurs refusées (23514, contrainte nommée) : `website_url` en `http:`, `javascript:`, `data:`, avec identifiants, non ASCII ; textes avec caractère de contrôle, bidirectionnel ou invisible ; téléphone avec lettres ; nom fait seulement d'espaces. Valeurs valides acceptées (accents, émoji composé dans la bio, sauts de ligne dans la bio).
3. `register_member` et les tests existants (0005, 0006, 0007) restent verts ; l'inscription E2E fonctionne.
4. Migration rejouable ; double application prouvée.

## Règles applicables
`docs/rules/supabase.md`, `docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`.

## Définition de terminé
- [x] Tests pgTAP écrits par test-engineer, échouant avant implémentation
- [x] `supabase test db` vert ; double application prouvée ; `pnpm check`, `pnpm test:integration` et E2E verts
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (16/11/2026) : `carnet_profiles_writes.test.sql` (108 : droits par colonne déclaratifs et en situation, refus 42501 sur `slug` réservé, `owner_id`, `theme`, images, horodatages ; 4 contraintes refusées/acceptées ; `insert` et `delete` retirés ; `register_member` soumis aux contraintes, sans orphelin ; `service_role`) ; tests de 0005 et 0016 adaptés avec l'accord de Hery (privilèges de table, politiques, `website_url` à 2048 au bon format, profils créés sous `postgres`, cascade compte → profil → liens) ; décision 9 (U+2028/U+2029 dans `auth.test.ts` et `profile-schemas.test.ts`) ; décision 10 (`carnet_links_{schema,access}` : droits par colonne, 42501 sur `id`, `profile_id`, horodatages) ; décision 11 (échappements `\uXXXX` partout, aucun caractère brut dans `src`, `tests`, `supabase`). Implémentation de référence refusée par les permissions : passage au vert prouvé sur les vraies migrations.
- implémentation : db-architect — `20261116150000_restrict_profiles_writes.sql` (droits par colonne, `insert`/`delete` retirés, 4 contraintes `not valid` + `validate`, échappements, précondition de production « en tant que `postgres` ») et `20261116170000_restrict_links_writes.sql` (droits par colonne sur `links`) ; backend — règle unique `src/server/actions/single-line-text.ts` (`\p{Cc}\p{Cf}\p{Zl}\p{Zp}`) partagée par `auth-schemas.ts` et `profile-schemas.ts`.
- reviewer (16/11/2026) : bloquant (U+2028/U+2029 acceptés par l'application et refusés par la base → compte orphelin à l'inscription) → décision 9 ; vérification ciblée : **OK**. Reste : commentaire d'en-tête de `profile-schemas.test.ts` à compléter (`\p{Zl}\p{Zp}`) au prochain passage sur ce fichier.
- security-auditor (16/11/2026) : **OK** ; risque élevé de 0017 traité ; moyen sur `links` → décision 10 ; vérification ciblée : **OK**. Reportés (décision 11) : `[:space:]` dépendant de la locale, `can_create_profile` inutile, `grant all` à `service_role`, **fiche suppression de compte (RGPD) avant l'ouverture**.
- vérification (16/11/2026) : par Hery, `supabase db reset` + `supabase test db` → 952/952, rejeu des deux migrations par `psql -f` sans erreur puis 952/952 ; par l'orchestrateur, `pnpm check` 616/616, intégration 49/49, build vert, E2E 66/66 (iOS et Android).
- **Avant tout `db push` en production** : exécuter en tant que `postgres` la requête de précondition de l'en-tête de `20261116150000_restrict_profiles_writes.sql` → 0 ligne attendue.
