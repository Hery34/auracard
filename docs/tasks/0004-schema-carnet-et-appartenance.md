# 0004 — Schéma `carnet` : création, enregistrement au registre, fonction d'appartenance

- Statut : done (15/11/2026)
- Agent : db-architect (tests pgTAP : test-engineer)
- Phase : 1
- ADR liées : 0002 (registre `platform` et schéma `carnet`), 0004 (autorisation par fonctions)

## Objectif
Le projet `carnet` existe sur l'instance : son schéma est créé et exposé à PostgREST, il est enregistré dans `platform.projects`, et `carnet.is_member()` est disponible pour toutes les politiques RLS à venir. Aucune table métier encore : elles arrivent avec les fiches suivantes (`profiles` en 0005, inscription en 0006).

## Périmètre de fichiers
- Autorisé (db-architect) : `supabase/migrations/20261115090000_create_carnet_schema.sql`, `supabase/config.toml` (section `[api]` uniquement).
- Autorisé (test-engineer) : `supabase/tests/carnet_schema*.test.sql` ; et, *amendement du 15/11/2026*, `supabase/tests/platform_registry_access.test.sql` pour la seule raison suivante : sa fixture insérait une ligne `carnet` dans `platform.projects`, en collision avec la ligne posée par cette migration. La fixture devient un projet neutre `alpha` (les tests du registre restent génériques et indépendants de `carnet`, conformément à l'ADR 0002 point 5) ; le commentaire sur `carnet.is_member()` « security definer » est corrigé en « security invoker ». Aucun autre changement.
- Interdit : tout le reste. Aucun objet dans `public`. Aucune modification de la migration `platform` (déjà appliquée en local ; toute évolution = nouvelle migration).

## Décisions de conception (validées par Hery le 15/11/2026)
1. Enregistrement du projet par la migration elle-même : `insert into platform.projects (slug, name, db_schema) values ('carnet', 'carnet', 'carnet') on conflict (slug) do nothing` (règle `idempotence.md`, données de référence).
2. `carnet.is_member()` = `platform.is_project_member('carnet')`, `language sql`, `stable`, `security invoker` (pas besoin de `definer` : `authenticated` a déjà `execute` sur la fonction `platform` ; pas de nouvelle surface `definer`), `set search_path = ''`. `revoke execute … from public, anon`, `grant execute … to authenticated, service_role`. Conséquence déjà actée en 0003 : aucune politique `anon` n'appelle `is_member()`.
3. Privilèges du schéma : `revoke all on schema carnet from public` ; `grant usage on schema carnet to anon, authenticated, service_role` (`anon` en a besoin pour les vues publiques à venir ; `usage` seul ne donne accès à aucune table). Aucun `alter default privileges` : chaque table et chaque fonction recevront des `grant` explicites dans leur fiche, et un test d'invariant vérifiera qu'aucune fonction de `carnet` n'est exécutable par `public`.
4. Exposition PostgREST locale : `[api] schemas = ["public", "graphql_public", "carnet"]` (ajout, pas remplacement : l'instance partagée héberge d'autres projets) ; `extra_search_path` inchangé (pas de résolution non qualifiée vers `carnet`). Sur l'instance partagée, l'ajout de `carnet` à `PGRST_DB_SCHEMAS` suivi d'un redémarrage de PostgREST fait partie des consignes de déploiement.
5. Pas de `carnet.set_updated_at()` ici : la fonction arrivera avec la première table qui en a besoin (0005), sans réutiliser celle de `platform`.

## Critères d'acceptation
1. Après migration, le schéma `carnet` existe ; aucun objet n'a été créé dans `public`.
2. `platform.projects` contient exactement une ligne de slug `carnet` (`db_schema = 'carnet'`, `status = 'active'`), y compris après double application de la migration.
3. `carnet.is_member()` existe, renvoie `boolean`, `language sql`, `stable`, `security invoker`, `search_path = ''` ; `execute` révoqué de `public` et `anon`, accordé à `authenticated` et `service_role` ; invariant « aucune fonction de `carnet` exécutable par `public` ».
4. Étant donné un compte membre de `carnet`, `is_member()` renvoie `true` ; non membre → `false` ; membre d'un autre projet → `false` ; `auth.uid()` nul → `false` ; membre d'un projet `carnet` passé `archived` → `false`.
5. Privilèges du schéma : `anon`, `authenticated`, `service_role` = `{USAGE}` ; `public` = `{}`.
6. PostgREST local expose `carnet` : `GET {API}/rest/v1/` avec `Accept-Profile: carnet` répond 200 (vérification orchestrateur par `curl` avec la clé `anon` locale), et `Accept-Profile: platform` est toujours refusé.
7. Migration rejouable (mêmes règles qu'en 0003) ; `supabase test db` rejouable (transactions annulées).

## Règles applicables
`docs/rules/supabase.md`, `docs/rules/idempotence.md`, `docs/rules/security.md`, `docs/rules/testing.md`.

## Conduite des tests locaux
Identique à la fiche 0003 (`supabase test db`, `migration up`, `migration repair --status reverted … --local` pour la double application ; pas de `psql`, pas de `db reset`). Le changement de `[api] schemas` exige un redémarrage de la pile locale (`supabase stop && supabase start`, sans `--no-backup` : la base est conservée).

## Consignes de déploiement complémentaires (à ajouter à celles de la fiche 0003)
Ordre : sauvegarde → pré-vérifications → `db push` → vérifications SQL → PostgREST → vérifications HTTP → consignation.
1. Sauvegarde des données de `platform` avant toute écriture dans le registre partagé (hors dépôt).
2. Pré-vérifications SQL (Hery, `postgres`) : aucune ligne `platform.projects` avec `slug = 'carnet'` ou `db_schema = 'carnet'` ; aucun schéma `carnet` ; aucune entrée `pg_default_acl` globale ou sur `carnet`/`platform` pour `anon`/`authenticated`/`public` ; `schema_migrations` contient `20261114180000` et pas `20261115090000`.
3. `supabase db push --dry-run` (connexion directe, pas le pooler ; mot de passe jamais dans l'historique ni dans un fichier lisible par Claude), une seule migration listée, puis `db push` avec confirmation.
4. Post-vérifications SQL : `nspacl` de `carnet` = `anon=U`, `authenticated=U`, `service_role=U`, pas d'entrée `public` ; `is_member()` : `prosecdef = false`, `search_path=""`, ACL sans `public` ni `anon`, propriétaire `postgres` ; une ligne `carnet` `active` dans le registre ; sous `authenticated` avec un `sub` inexistant → `false` ; sous `anon` → 42501.
5. PostgREST : `PGRST_DB_SCHEMAS` = valeur actuelle + `,carnet` (ne jamais retirer les schémas des autres projets, jamais `platform`) ; `PGRST_DB_EXTRA_SEARCH_PATH` inchangé (jamais `carnet` ni `platform`). Recréer le conteneur `rest` (variable d'environnement non relue autrement), vérifier ses logs. Après la migration.
6. Vérifications HTTP (clés `anon` puis `service_role`) : `Accept-Profile: carnet` → 200 (`anon` ne voit que `/`, `service_role` voit `/rpc/is_member`) ; `Accept-Profile: platform` → 406 ; `POST /rest/v1/rpc/is_member` avec clé `anon` → 401/403 ; racine OpenAPI par défaut (`public`) inchangée.
7. Realtime : `pg_publication_tables` vide pour `carnet` et `platform`.
8. Versions : PostgreSQL ≥ 17.11 (ou PostgREST ≥ 16.5) pour CVE-2026-14669 ; GoTrue ≥ 2.185.0 pour CVE-2026-31813.
9. Consigner rôle, versions, sorties 2, 4, 6, 7. Ne pas exécuter les fichiers pgTAP contre l'instance.

## Points à reporter dans les fiches suivantes
- Fiche 0005 (`profiles`, vue `public_profiles`) : toute politique avec clause `to` explicite (`authenticated` ou `anon`), jamais `for all` ni `to public` implicite ; une politique `anon` n'appelle jamais `is_member()` (42501) ; invariants pgTAP : « aucune politique dont `polroles` contient `anon` ou `public` ne référence `is_member` », « toute politique a un `polroles` explicite », « toute table de `carnet` a `relforcerowsecurity` », « `(select carnet.is_member())` enveloppé dans toutes les politiques » (regex sur `pg_get_expr(polqual)`, `search_path = ''` empêchant l'inlining). Vue `public_profiles` : trancher explicitement entre vue propriétaire `postgres` filtrante (colonnes publiées uniquement, `is_published`) et `with (security_invoker = true)` + politique `anon` dédiée ; test persona `anon` (aucune ligne non publiée, aucun 42501). Vérification `curl` d'introspection GraphQL avec la clé `anon` : aucun type `profiles`. Aucune vue `carnet` ne lit `platform.*`. `enable` + `force` RLS avant tout `grant` ; `anon` : `select` uniquement sur les vues/fonctions publiques listées ; `table_privs_are(..., 'anon', '{}')` sur chaque table de base ; `search_path = ''` sur toutes les fonctions ; aucune table `carnet` dans `supabase_realtime` sans décision.
- Dépôt plateforme futur (ADR 0002 point 5) : écrire comme invariant le contrat « `platform` conserve `usage` pour `authenticated` et `execute` sur `is_project_member(text)` pour `authenticated` », sinon verrouillage de `carnet`.
- ADR future « custom access token hook » : le hook GoTrue s'exécute sous `supabase_auth_admin`, sans `usage` sur `platform`/`carnet` : grants dédiés et décision explicite nécessaires.
- Règles (Hery) : `docs/rules/supabase.md` → « `security invoker` par défaut, `definer` seulement si nécessaire ; `search_path = ''` et noms qualifiés pour toutes les fonctions » ; « jamais `carnet` ni `platform` dans `extra_search_path` / `PGRST_DB_EXTRA_SEARCH_PATH` ».

## Hors périmètre
- Table `profiles`, `can_edit_profile`, `can_read_profile_private`, vue `public_profiles` → fiche 0005.
- Clients Supabase, `env.ts`, cas d'usage `register-user`, pages d'authentification → fiche 0006 (nouvelles dépendances `zod`, `@supabase/supabase-js`, `@supabase/ssr` à valider par Hery).
- `supabase gen types typescript --local --schema carnet` → fiche 0006 (première table).
- `db push` sur l'instance partagée : à la demande de Hery, avec les consignes de la fiche 0003.

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation (vérifié : 19 échecs sur 22 exécutés, 5 non atteints)
- [x] `supabase test db` vert (151/151 après compléments de revue et d'audit) ; `pnpm check` vert (7 tests) ; PostgREST `carnet` 200 / `platform` 406 — vérifiés par l'orchestrateur le 15/11/2026
- [x] Migration appliquée deux fois sans erreur ; une seule ligne `carnet` dans le registre (test critère 2 vert après double application)
- [x] reviewer : OK, remarques non bloquantes ; commentaire 7a, e-mails `alpha` et en-tête de migration traités
- [x] security-auditor : OK, remarques non bloquantes ; garde-fou registre et sonde de privilèges par défaut traités
- [x] Aucune déviation d'architecture (ADR 0002, ADR 0004, `architecture.md` §4.2 ligne « fonctions d'autorisation »)
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (15/11/2026) : `carnet_schema.test.sql`, plan 27 (critères 1, 2, 3 avec invariant et appel `anon` → 42501, 4 avec personas A/B/C sur plage `04xx`, 5, 7). Échec vérifié : 19 échecs sur 22 exécutés, 5 non atteints (schéma absent) ; les 119 tests `platform` restent verts. Justesse validée par sonde avec implémentation de référence (27/27). Signalé : collision de la fixture `carnet` de `platform_registry_access.test.sql` avec la ligne du registre → arbitrage orchestrateur : fixture renommée `alpha`. Appliqué (16 remplacements, plan 37 inchangé, dont les deux `throws_ok` d'unicité et deux requêtes `update`/`delete` qui visaient la fixture) ; `platform` 119/119 verts, `carnet_schema` toujours rouge ; collision levée prouvée par sonde. Reste deux adresses e-mail de fixture `a-carnet@test.local` sans rôle fonctionnel, laissées telles quelles.
- test-engineer, retouches post-revue et audit (15/11/2026) : commentaire 7a réécrit (JWT sans `sub`, sans référence à `carnet`), e-mails `a-alpha@`/`a2-alpha@` ; `carnet_schema.test.sql` plan 32 : table témoin `default_privs_probe` + `table_privs_are` `{}` pour `anon`/`authenticated`/`public` + `is_empty` sur `pg_default_acl` (global ou `carnet`). 151/151 sur deux exécutions ; verrou prouvé par sonde (`alter default privileges … grant select to anon` → 2 échecs).
- implémentation (db-architect, 15/11/2026) : `20261115090000_create_carnet_schema.sql` (schéma, `revoke`/`grant usage`, insertion du registre `on conflict (slug) do nothing`, `carnet.is_member()` `sql`/`stable`/`security invoker`/`search_path = ''`, `revoke`/`grant execute` explicites) ; `config.toml` `[api] schemas` + `carnet`. `migration up`, `supabase stop` puis `start` (base conservée), `supabase test db` 146/146 sur trois exécutions, double application prouvée (`repair --status reverted` + `up`), `Accept-Profile: carnet` → 200, `platform` → 406 `PGRST106`. Dump `carnet` : schéma + fonction seulement. Aucun écart. Risques instance : ajouter `carnet` à `PGRST_DB_SCHEMAS` puis redémarrer PostgREST (coupure brève pour tous les projets, à planifier), après le `db push` ; migration à appliquer par `postgres` ; `on conflict do nothing` ne corrige pas une ligne `carnet` divergente préexistante. Vérifié par l'orchestrateur : 146/146, `pnpm check` 7/7, codes HTTP 200/406.
- implémentation, retouches post-revue (db-architect, 15/11/2026) : en-tête complété (précondition `bypassrls` pour l'insertion dans `platform.projects`) ; garde-fou `do $$ … raise exception $$` après l'`insert` si la ligne `carnet` est absente, `archived` ou avec un autre `db_schema`. Deux réapplications (`repair --status reverted` + `up`) sans erreur, `supabase test db` 146/146 après chacune.
- reviewer (15/11/2026) : **OK, remarques non bloquantes.** Conforme aux cinq décisions et aux critères 1 à 5 et 7 ; conserver `public` et `graphql_public` dans `[api] schemas` est souhaitable (même profil par défaut qu'en production, échec bruyant si un client oublie `db.schema`). Test regex `pg_get_functiondef` à conserver (encode la décision 2 et DRY). À corriger : commentaire 7a de `platform_registry_access.test.sql` décrivant un chemin impossible et citant `carnet` → reformuler « JWT sans `sub` sous `authenticated`/`service_role` » ; e-mails de fixture `a-carnet@` → `a-alpha@`. Suggestion retenue S1 : en-tête de la migration mentionnant la précondition `bypassrls` pour l'insertion dans `platform.projects` ; pré-contrôle de déploiement : aucune ligne `slug = 'carnet'` ou `db_schema = 'carnet'` préexistante. Non retenues : test pgTAP de la double insertion (preuve par `repair` + `up`), renommage `other` → `other_0004`. S5 pour Hery : préciser dans `docs/rules/supabase.md` « `security invoker` par défaut, `definer` seulement si nécessaire, `search_path = ''` et noms qualifiés pour toutes les fonctions ».
- security-auditor (15/11/2026) : **OK, remarques non bloquantes.** Chaîne `authenticated` → `is_member()` (invoker) → `is_project_member` (definer, `postgres`) sûre et complète ; tous les cas limites fermés (`anon` 42501, JWT `service_role` → `false`, politique `to public` → 42501). `usage` pour `anon` n'ouvre aucun objet aujourd'hui. PostgREST : schéma vide exposé sans fuite, `platform` inatteignable (406 `PGRST106`). Insertion registre par `postgres` conforme. Traitées : garde-fou bruyant après l'`insert` (ligne `carnet` absente ou divergente → exception), sonde de privilèges par défaut dans les tests `carnet`. Reportées en 0005+ (voir « Points à reporter »). Veille : CVE-2026-14669 (PostgreSQL `to_char`, corrigé 17.11 ; PostgREST 16.5 atténue), CVE-2026-31813 (GoTrue < 2.185.0) ; local PG 17.11 / GoTrue 2.197 OK ; versions de l'instance à vérifier au déploiement.
