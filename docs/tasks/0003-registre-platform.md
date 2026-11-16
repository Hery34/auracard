# 0003 — Registre `platform` : projets et appartenances

- Statut : done (14/11/2026)
- Agent : db-architect (tests pgTAP : test-engineer)
- Phase : 1
- ADR liées : 0002 (registre `platform` et schéma `carnet`), 0004 (autorisation par fonctions)

## Objectif
L'instance Supabase partagée dispose de son registre commun : la liste des projets, l'appartenance des comptes à un projet et la fonction `platform.is_project_member(slug)` sur laquelle reposeront **toutes** les politiques RLS de `carnet`. Le projet Supabase local (`supabase start`) est initialisé et les tests pgTAP s'exécutent.

## Périmètre de fichiers
- Autorisé (db-architect) : `supabase/config.toml`, `supabase/seed.sql`, `supabase/.gitignore`, `supabase/migrations/20261114180000_create_platform_registry.sql`.
- Autorisé (test-engineer) : `supabase/tests/platform_registry*.test.sql` (un ou deux fichiers).
- Interdit : tout le reste. Aucun objet dans `public`. Rien dans `src/`, `package.json` ni `.github/`.

## Décisions de conception (validées par Hery le 14/11/2026)
1. Schéma `platform`, tables `projects` et `project_members` telles que décrites dans `docs/architecture.md` §4.1, sans colonne supplémentaire.
2. `is_project_member(p_slug)` renvoie `true` seulement si le projet est `active` : archiver un projet ferme l'accès de tous ses membres sans toucher aux appartenances.
3. La ligne `carnet` de `platform.projects` est insérée par la migration qui crée le schéma `carnet` (fiche 0004). Le registre reste générique et la migration `platform` pourra être déplacée telle quelle dans un dépôt « plateforme » (ADR 0002, point 5).
4. `platform` n'est **pas** exposé à PostgREST. L'application n'y accède jamais directement : `carnet` fournira `carnet.is_member()` (fiche 0004) et une fonction d'inscription `security definer` réservée à `service_role` (fiche inscription).
5. Lecture : un compte authentifié ne voit que ses propres lignes de `project_members` ; `projects` n'est lisible par aucun rôle client. Aucune politique d'écriture : seules les écritures `service_role` (qui contourne la RLS) sont possibles. `anon` n'a aucun privilège sur `platform`.
6. `supabase/config.toml` : `project_id = "carnet"`, `[db] major_version` aligné sur la version Postgres de l'instance partagée (à confirmer par Hery ; défaut CLI : 17). `[api] schemas` reste par défaut jusqu'à la fiche 0004. Services locaux désactivés : `[analytics]` (Logflare et Vector inutiles au développement) et `[edge_runtime]` (aucune Edge Function prévue, asynchrone via outbox et n8n ; de plus l'image `edge-runtime:v1.77.4` est corrompue dans le moteur Docker d'OrbStack de ce poste, décision orchestrateur du 14/11/2026).

## Critères d'acceptation
1. **Projet local** : `supabase/config.toml` versionné, `supabase start` démarre sans erreur, `supabase test db` exécute les fichiers de `supabase/tests/`.
2. **Tables** : après migration existent
   - `platform.projects` : `id uuid primary key default gen_random_uuid()`, `slug text not null unique`, `name text not null`, `db_schema text not null unique`, `status text not null default 'active'` avec `check (status in ('active','archived'))`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` maintenu par trigger ; `slug` et `db_schema` contraints à `^[a-z][a-z0-9_]*$`.
   - `platform.project_members` : `project_id uuid not null references platform.projects(id) on delete cascade`, `user_id uuid not null references auth.users(id) on delete cascade`, `role text not null default 'user'` avec `check (role in ('owner','admin','user'))`, `created_at timestamptz not null default now()`, clé primaire (`project_id`, `user_id`), index sur `user_id`.
3. **Fonction** : `platform.is_project_member(p_slug text) returns boolean`, `language sql`, `security definer`, `stable`, `set search_path = ''`, noms entièrement qualifiés, `auth.uid()` enveloppé dans `(select …)`. `execute` révoqué de `public` et `anon`, accordé à `authenticated` et `service_role`.
4. Étant donné un compte membre d'un projet `active` de slug `carnet`, quand il appelle `is_project_member('carnet')`, alors le résultat est `true`.
5. Étant donné un compte authentifié sans appartenance, alors `false`.
6. Étant donné un compte membre d'un **autre projet** de l'instance, alors `false` pour `carnet` et `true` pour son propre projet.
7. Étant donné un visiteur anonyme (`auth.uid()` nul, appel par un contexte autorisé tel que `carnet.is_member()` à venir), alors `false`. Le rôle `anon` lui-même n'a pas le droit d'appeler la fonction (42501, conséquence des critères 3 et 11). *(amendé le 14/11/2026 sur signalement de test-engineer)*
8. Étant donné un projet passé en `archived`, quand un de ses membres appelle la fonction, alors `false`.
9. Étant donné un slug inconnu, alors `false` (jamais `null`).
10. **RLS** : `enable row level security` et `force row level security` sur les deux tables. Politique `select` nommée `project_members_select_own` pour `authenticated` sur `project_members` (`user_id = (select auth.uid())`) ; aucune politique sur `projects`. Un compte authentifié ne lit pas les appartenances d'un autre compte, y compris celles d'un autre membre du **même** projet ; il ne peut ni insérer, ni modifier, ni supprimer dans les deux tables ; il ne lit rien dans `projects` ; `anon` ne lit rien. Pas de `for all`.
11. **Privilèges** : `usage` sur le schéma pour `authenticated` et `service_role` ; `select` sur `project_members` pour `authenticated` ; tous privilèges sur les tables pour `service_role` (+ `alter default privileges in schema platform`). Aucun privilège pour `anon` ni `public`. *Ajouté le 14/11/2026 sur audit :* aucune fonction de `platform` n'est exécutable par `public` (invariant testé sur `pg_proc`) ; chaque fonction créée est suivie d'un `revoke execute … from public` et de `grant` nominatifs, donc `revoke execute on function platform.set_updated_at() from public`. Le `alter default privileges in schema platform revoke execute on functions from public` proposé par l'audit est inopérant : Postgres ne permet pas à un `revoke` par schéma de retirer le privilège intégré accordé à `public` ; seule la forme globale le ferait, et elle s'appliquerait à toutes les fonctions futures de tous les schémas de l'instance. Décision d'instance, non prise ici (voir « Points à reporter »).
12. **Idempotence** : la migration appliquée une seconde fois sur la même base ne produit ni erreur ni doublon (`create schema if not exists`, `create table if not exists`, `create index if not exists`, `create or replace function`, `drop policy if exists` puis `create policy`, `do $$ … $$` pour trigger et contraintes ; les contraintes nommées déclarées en ligne dans un `create table if not exists` sont admises, l'instruction entière étant ignorée au rejeu — *amendé le 14/11/2026 sur avis du reviewer*).
13. Aucun objet créé dans `public`.
14. Rejouer `supabase test db` donne le même résultat : chaque fichier de test tourne dans une transaction annulée.

## Règles applicables
`docs/rules/supabase.md`, `docs/rules/idempotence.md`, `docs/rules/security.md`, `docs/rules/testing.md`.

## Conduite des tests locaux
- Base locale : `supabase start` (Docker fourni par OrbStack). `supabase db reset` est interdit par `.claude/settings.json` : pour repartir d'une base vierge, `supabase stop --no-backup && supabase start` ; pour appliquer une migration ajoutée depuis, `supabase migration up`.
- Tests : `supabase test db` (pgTAP et `pg_prove` embarqués). Si l'extension n'est pas déjà active, le fichier de test commence par `create extension if not exists pgtap with schema extensions;`.
- Les tests insèrent leurs utilisateurs dans `auth.users` et leurs projets (`carnet`, `other`) eux-mêmes, simulent les rôles par `set local role authenticated | anon` et `set local request.jwt.claims`, et terminent par `rollback`.
- Vérification de l'idempotence (critère 12) : db-architect applique la migration une seconde fois sur la base locale (`supabase migration repair --status reverted 20261114180000 --local` puis `supabase migration up`) et joint la sortie à son rapport.

## Notes d'implémentation (issues des tests, à respecter par db-architect)
- La fonction `security definer` doit appartenir au rôle qui applique la migration (`postgres`, `bypassrls`) : avec `force row level security` et aucune politique pour le propriétaire, un propriétaire sans `bypassrls` rendrait la fonction fausse pour tous.
- Unicité de `slug` et `db_schema` par **contraintes** `unique`, pas seulement par index.
- Schéma : `grant usage` uniquement (`grant all` ajouterait `create` et fait échouer le test de privilèges).
- Trigger `updated_at` : `now()` (heure de transaction), pas `clock_timestamp()`.
- `alter default privileges in schema platform grant all on tables to service_role` sans clause `for role` (s'applique au rôle qui migre).
- Tests pgTAP : `supabase test db` arrête un fichier à la première erreur SQL brute (`ON_ERROR_STOP`).

## Consignes pour le déploiement sur l'instance partagée (à reprendre dans la fiche `db push`)
Issues de l'audit du 14/11/2026. `psql` étant interdit à Claude, les vérifications SQL sont exécutées par Hery (Studio en tant que `postgres`).
1. Avant : le rôle utilisé par la CLI doit être `postgres` avec `rolbypassrls = true` (`select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user;`). Un autre rôle rendrait `is_project_member` fausse pour tous : verrouillage total de `carnet`.
2. Avant : `show server_version;` alignée sur `[db] major_version` de `config.toml`.
3. Avant : aucun privilège par défaut global ou hors `public` accordé à `anon`/`authenticated` (`pg_default_acl`) ; aucun schéma `platform` ni `carnet` préexistant (`pg_namespace`).
4. `supabase db push --dry-run`, puis `supabase db push` (confirmation exigée par `.claude/settings.json`).
5. Après : propriétaire de `is_project_member` = `postgres` (`bypassrls`) ; `relrowsecurity`/`relforcerowsecurity` vrais sur les deux tables ; `role_table_grants` limités à `authenticated`/`project_members`/`SELECT` et `service_role` ; `nspacl` de `platform` = `usage` pour `authenticated` et `service_role` ; `proacl` sans entrée `PUBLIC` ; appel fonctionnel sous `authenticated` avec un slug inexistant → `false`.
6. PostgREST : `PGRST_DB_SCHEMAS` et `PGRST_DB_EXTRA_SEARCH_PATH` sans `platform` (ni maintenant ni quand `carnet` sera ajouté ; un changement de `PGRST_DB_SCHEMAS` exige un redémarrage de PostgREST). Vérification HTTP : `Accept-Profile: platform` refusé, racine OpenAPI sans `projects` ni `project_members`.
7. Realtime : `pg_publication_tables` vide pour `platform`, `supabase_realtime` avec `puballtables = false`.
8. Ne jamais rejouer la migration à la main : s'en remettre à `supabase_migrations.schema_migrations`. Les fichiers pgTAP insèrent dans `auth.users` (annulé par `rollback`) : ne pas les exécuter contre l'instance sans accord explicite de Hery.
9. Consigner dans la fiche de déploiement : rôle, version serveur, sorties des points 5 à 7.

## Points à reporter dans les fiches suivantes
- Fiche 0004 : une politique `carnet` évaluée pour `anon` ne peut pas appeler `platform.is_project_member` (42501) ; passer par `carnet.is_member()` (`security definer`, propriétaire `postgres`) ou ne pas l'appeler. `carnet` ne réutilise pas `platform.set_updated_at()` : seul couplage autorisé, `is_project_member`. Le test « `public` vide » cassera au premier `create extension` sans `with schema extensions`.
- Fiche inscription / backend : sous un JWT `service_role` (sans `sub`), `is_project_member` renvoie `false` : ne jamais s'en servir comme contrôle d'autorisation avec le client admin. Politique GoTrue (longueur de mot de passe, confirmation d'e-mail) commune à tous les projets de l'instance : à traiter au niveau plateforme.
- Fiche RGPD : `auth.admin.deleteUser(id, shouldSoftDelete = true)` ne pose que `deleted_at` et ne déclenche aucune cascade ; exiger la suppression dure ou supprimer l'appartenance explicitement. Supprimer `auth.users` supprime les appartenances de tous les projets : ne le faire que s'il ne reste aucune appartenance.
- Premier `git init` : vérifier que `git status` ne propose ni `supabase/.temp` ni `supabase/.branches`.
- Règles : proposer à Hery d'amender `docs/rules/idempotence.md` (contraintes en ligne dans `create table if not exists` admises).
- Règles : proposer à Hery d'ajouter à `docs/rules/supabase.md` : « toute fonction créée dans `platform` ou `carnet` est suivie de `revoke execute … from public` et de `grant execute` nominatifs ; un test pgTAP d'invariant le vérifie par schéma ». Option d'instance à trancher par Hery (hors carnet) : `alter default privileges revoke execute on functions from public` global pour le rôle `postgres`.

## Hors périmètre
- Ligne `carnet` dans `platform.projects`, schéma `carnet`, `carnet.is_member()`, exposition PostgREST (`[api] schemas`) → fiche 0004.
- Cas d'usage `register-user` et fonction d'inscription → fiche inscription.
- Script `pnpm test:db` et exécution des tests pgTAP en CI (CLI Supabase dans GitHub Actions) → fiche CI/déploiement.
- `supabase db push` vers l'instance partagée : **uniquement à la demande explicite de Hery**, après clôture de la fiche.
- Hook d'accès GoTrue pour inscrire les projets dans le JWT (ADR 0002, évolution possible).
- Compte membre de plusieurs projets : couvert par construction (une ligne par projet). Restent à traiter plus tard : suppression du compte `auth.users` seulement quand il ne reste aucune appartenance (fiche RGPD) ; e-mails d'authentification GoTrue communs à l'instance, personnalisation par projet via le hook « send email » vers n8n (ADR avant mise en production).

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation (vérifié par l'orchestrateur)
- [x] `supabase test db` vert (119/119 après compléments d'audit) ; `pnpm check` vert (7 tests) — vérifiés par l'orchestrateur le 14/11/2026
- [x] Migration appliquée deux fois sans erreur (sortie jointe au rapport)
- [x] reviewer : OK, remarques non bloquantes consignées
- [x] security-auditor : OK, remarques non bloquantes ; les trois remarques moyennes traitées (tests + `revoke`)
- [x] Aucune déviation d'architecture (migration conforme à l'ADR 0002 et à `architecture.md` §4.1)
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (14/11/2026) : 2 fichiers, 110 tests (`platform_registry_schema.test.sql` plan 76 : structure, fonction, RLS déclarative, privilèges, `public` vide ; `platform_registry_access.test.sql` plan 34 : contraintes, cascades, trigger, critères 4 à 9, RLS en situation avec personas A/B/C/D et anon). Échec vérifié par l'orchestrateur sur base vierge : access 0/34 exécutés (relation absente), schema 63 échecs sur 64 exécutés. Justesse validée hors projet par une DDL jetable (110/110) et trois mutations ciblées. Critère 7 scindé (`auth.uid()` nul → `false` ; rôle `anon` → 42501), critère 8 testé par passage `active` → `archived` : les deux arbitrages sont retenus.
- test-engineer, complément après audit (14/11/2026) : 119 tests (schema plan 82, access plan 37). Ajoutés : persona A2 (autre membre du même projet, 3 tests), privilèges nuls pour `anon`/`authenticated`/`public` sur la table témoin (3), propriétaire de `is_project_member` avec `bypassrls` (1), invariant « aucune fonction de `platform` exécutable par `public` » (1), `execute` révoqué sur `set_updated_at` (1). Les 2 derniers rouges avant correctif, imputables à `set_updated_at()`. Découverte : `alter default privileges in schema … revoke execute on functions from public` est inopérant sur le privilège intégré de `public` (seule la forme globale agit), d'où l'arbitrage « revoke explicite par fonction + invariant ».
- implémentation, étape 1 (db-architect, 14/11/2026) : `supabase init` non interactif ; `config.toml` = défaut sauf deux lignes (`[edge_runtime] enabled = false`, `[analytics] enabled = false`), `project_id = "carnet"`, `major_version = 17` ; `supabase start` en 29 s, 9 conteneurs sains (Postgres 17.11, GoTrue 2.197, PostgREST 16.4) ; `supabase test db` → `NOTESTS` (code 1 tant qu'aucun fichier de test, à noter pour la CI) ; `supabase db dump --local --schema platform` → « no matching schemas » (base vierge). Obstacle : image `edge-runtime:v1.77.4` corrompue dans le store Docker d'OrbStack (inspect → 500 « layer does not exist »), contournée par la désactivation du service, moteur Docker non touché.
- implémentation, étape 2 (db-architect, 14/11/2026) : `20261114180000_create_platform_registry.sql`, 121 lignes, générique (aucune référence à `carnet`). Contraintes nommées déclarées en ligne (`projects_slug_key`, `projects_db_schema_key`, `projects_status_check`, `projects_slug_format_check`, `projects_db_schema_format_check`, `project_members_*_fkey` cascade, `project_members_role_check`), index `project_members_user_id_idx`, fonction trigger `platform.set_updated_at()` + trigger `projects_set_updated_at` (bloc `do $$`), `is_project_member` (`sql`, `stable`, `security definer`, `search_path = ''`, `exists`, projet `active`), RLS `enable` + `force`, politique `project_members_select_own`, privilèges du critère 11. `supabase test db` 110/110 sur trois exécutions ; double application prouvée (`migration repair --status reverted --local` puis `migration up`). Écarts déclarés : contraintes en ligne plutôt qu'en blocs `do $$` ; `set_updated_at()` non listée par la fiche ; `execute` par défaut de `set_updated_at()` pour `public` non révoqué (soumis à l'audit). Risque instance partagée : `db push` doit être exécuté par `postgres` (`bypassrls`), sinon la fonction renvoie `false` pour tous.
- implémentation, correctif post-audit (db-architect, 14/11/2026) : `revoke execute on function platform.set_updated_at() from public;` (ligne 61, migration 123 lignes). Réappliquée en local (`repair --status reverted` + `migration up`), `supabase test db` 119/119 sur trois exécutions, double application à nouveau prouvée. Vérifié par l'orchestrateur : 119/119, `pnpm check` vert.
- reviewer (14/11/2026) : **OK, remarques non bloquantes.** Conforme critère par critère et à l'ADR 0002 ; contraintes en ligne jugées acceptables (critère 12 amendé) ; `set_updated_at()` justifiée. Suggestions non retenues pour cette fiche : `create or replace trigger` à la place du bloc `do $$` ; `revoke execute` sur `set_updated_at()` (une fonction trigger n'est pas appelable directement) ; en-tête de la migration citant la fiche ; tests redondants (détection du trigger par `pg_trigger`, `is not null` après `is(false)`, comptage après `results_eq`) ; `[db.seed] sql_paths` sans `seed.sql`. À reporter : fiche 0004 ne réutilise pas `platform.set_updated_at()` (seul couplage autorisé : `is_project_member`) ; le test « `public` vide » cassera au premier `create extension` sans `with schema extensions` ; proposition à Hery d'amender `docs/rules/idempotence.md` pour les contraintes en ligne.
- security-auditor (14/11/2026) : **OK, remarques non bloquantes.** Isolation entre projets correcte (pas d'oracle d'existence de projet, `anon` sans aucun accès), fonction sans injection possible, `stable` correct, aucun secret versionné, `platform` non exposé en local. Traitées avant clôture : persona « autre membre du même projet » (testing.md), assertions négatives sur la table témoin des privilèges par défaut, test du `bypassrls` du propriétaire de la fonction, `alter default privileges … revoke execute on functions from public`, `revoke execute` sur `set_updated_at()`. Non retenues : `set row_security = off` dans la fonction (échec bruyant plutôt que `false` si le propriétaire n'a pas `bypassrls`), test de la cascade sous `supabase_auth_admin` (les triggers d'intégrité s'exécutent comme propriétaire). Veille Next.js : 16.4.6 ≥ dernière version corrigée 16.4.5 (3/11/2026), aucun écart.
