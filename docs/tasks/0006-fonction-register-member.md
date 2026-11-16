# 0006 — Fonction `carnet.register_member` : appartenance et profil en une transaction

- Statut : done (15/11/2026)
- Agent : db-architect (tests pgTAP : test-engineer)
- Phase : 1 (lot « inscription + appartenance », première des trois fiches : 0006 SQL, 0007 backend, 0008 pages)
- ADR liées : 0002 (appartenance créée côté serveur, idempotente), 0010 (usages de `service_role`, Acceptée)

## Objectif
Le serveur peut, avec le client `service_role`, enregistrer un compte GoTrue comme membre de `carnet` et lui créer son profil initial en une seule transaction idempotente, sans jamais écrire directement dans `platform`.

## Périmètre de fichiers
- Autorisé (db-architect) : `supabase/migrations/20261115150000_create_register_member.sql`.
- Autorisé (test-engineer) : `supabase/tests/carnet_register_member*.test.sql`.
- Interdit : tout le reste.

## Décisions de conception (validées par Hery le 15/11/2026)
1. `carnet.register_member(p_user_id uuid, p_display_name text, p_slug text) returns uuid` (identifiant du profil) : `language plpgsql`, `security definer`, propriétaire `postgres`, `set search_path = ''`, `volatile`. Corps : `insert into platform.project_members (project_id, user_id) select id, p_user_id from platform.projects where slug = 'carnet' and status = 'active' on conflict do nothing` ; si aucun projet actif → `raise exception` ; puis `insert into carnet.profiles (owner_id, display_name, slug) values (…) on conflict (owner_id) do nothing` ; retourne l'`id` du profil (créé ou préexistant).
2. Conflit de slug avec un autre propriétaire : l'erreur 23505 (`profiles_slug_key`) remonte telle quelle ; l'appelant (cas d'usage 0007) régénère un slug suffixé et rappelle. Les `check` de la table (format du slug, longueur du nom) remontent de même (23514) : la validation applicative Zod les précède.
3. Le profil est créé **à l'inscription** avec `display_name` et `slug` (non publié, `is_indexable` faux) : un membre a toujours exactement un profil, l'éditeur (phase 2) ne fait que le compléter.
4. Compte déjà membre (rejeu, double clic, « compte existant d'un autre projet » déjà inscrit) : aucune écriture, retour de l'identifiant du profil existant, `p_display_name`/`p_slug` ignorés.
5. Privilèges : `revoke execute … from public, anon, authenticated` ; `grant execute … to service_role` uniquement.

## Critères d'acceptation
1. Fonction : signature, `definer`, propriétaire `bypassrls`, `search_path = ''`, `volatile`, privilèges (`service_role` seul ; `anon`/`authenticated` → 42501 à l'appel), invariant « aucune fonction de `carnet` exécutable par `public` ».
2. Étant donné un compte sans appartenance, quand `register_member` est appelée (rôle `service_role` ou `postgres`), alors une ligne `platform.project_members` (`carnet`, rôle `user`) et un profil (`owner_id`, `display_name`, `slug`, `is_published = false`) existent ; la fonction renvoie l'`id` du profil.
3. Rejouée avec les mêmes arguments, puis avec des arguments différents : aucune ligne supplémentaire, même `id` renvoyé.
4. Compte déjà membre d'un **autre** projet : l'appartenance `carnet` s'ajoute, l'autre reste.
5. Slug déjà pris par un autre compte : 23505 `profiles_slug_key`, et **aucune** appartenance créée (transaction atomique : la fonction entière est annulée).
6. Slug invalide (`ab`, `Abc`) ou nom trop long : 23514, rien n'est écrit.
7. Projet `carnet` archivé : exception, rien n'est écrit.
8. Idempotence de la migration (double application) ; rejouabilité des tests.

## Règles applicables
`docs/rules/supabase.md`, `docs/rules/idempotence.md`, `docs/rules/security.md`, ADR 0010.

## Consignes de déploiement complémentaires (s'ajoutent à 0003, 0004, 0005)
1. Pré : `schema_migrations` contient `20261115120000` et pas `20261115150000` ; aucune `register_member` dans `carnet`.
2. Post SQL : `proowner` = `postgres` `bypassrls`, `prosecdef`, `proconfig = {search_path=""}`, `provolatile = 'v'`, `proacl` = `service_role=X` uniquement, `pg_get_functiondef` sans `auth.uid`/`is_member`.
3. Sonde fermée sans donnée réelle : `select carnet.register_member(gen_random_uuid(), 'smoke', 'smoke-test-0006')` → 23503 ; comptages `project_members`/`profiles` inchangés.
4. HTTP (`Content-Profile: carnet`) : `POST /rest/v1/rpc/register_member` avec la clé `anon` et avec un JWT `authenticated` → 401/403 ; OpenAPI `anon` sans `/rpc/register_member`.
5. Clé `service_role` : uniquement dans l'environnement serveur EasyPanel, jamais `NEXT_PUBLIC_`, jamais en argument de build ni dans les logs ; secret GitHub réservé au futur job d'intégration ; procédure de rotation à consigner (= `JWT_SECRET` de l'instance, toutes les clés de tous les projets).
6. GoTrue (instance, commun à tous les projets) : `GOTRUE_RATE_LIMIT_EMAIL_SENT` (globale, défaut 30/h), `GOTRUE_RATE_LIMIT_HEADER` posé par Kong seulement, `GOTRUE_URI_ALLOW_LIST` avec l'URL de `carnet`. `signUp` étant appelé côté serveur, GoTrue voit l'IP du VPS pour tout le monde : la limitation par IP client se fait dans `carnet` (0007/0008).

## Points à reporter dans les fiches suivantes
- 0007 : journalisation des erreurs par `code` + contrainte + corrélation, sans `details`/`hint`/`message` ; mappage 23505 → `slug_taken` seulement si `profiles_slug_key`, 23503 → `unexpected` ; `admin.ts` : `import 'server-only'` + règle ESLint `no-restricted-imports` n'autorisant son import que depuis `supabase-profile-registrar.ts` ; Zod `displayName` : `trim`, 1 à 80, refus des caractères de contrôle ; slug : regex + liste de réservés ; limitation de débit par IP client sur `registerAction` et `ensure-membership` ; `ensure-membership` ne dérive pas le nom de l'e-mail (fragment d'adresse rendu public à la publication) : demander un nom ; tests d'intégration nettoyés par suppression dure avec vérification de la cascade.
- 0008 : mention d'information RGPD sur le formulaire (finalité, destinataire, durée, authentification sur instance partagée) ; aucun `dangerouslySetInnerHTML`.
- Fiche RGPD : suppression dure obligatoire (un compte soft-deleted reste inscriptible) ; ordre profil → appartenance → `auth.users` si dernière appartenance.
- Phase 2 : `profiles_delete_own` existe, l'invariant « un membre a toujours un profil » n'est pas garanti en base ; `ensure-membership` recrée un profil au passage suivant (à documenter).

## Hors périmètre
- Client `admin.ts`, cas d'usage `register-user`, génération du slug, Zod → fiche 0007 (backend ; dépendances `zod`, `@supabase/supabase-js`, `@supabase/ssr`, `server-only` à valider).
- Pages d'inscription et de connexion, `proxy.ts`, tableau de bord minimal, E2E → fiche 0008 (frontend + test-engineer).
- Suppression de compte → fiche RGPD.

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation (36/42 rouges, vérifié)
- [x] `supabase test db` vert (422/422 après compléments de revue et d'audit) ; `pnpm check` vert (7 tests) — vérifiés par l'orchestrateur le 15/11/2026
- [x] Migration appliquée deux fois sans erreur
- [x] reviewer : OK, remarques non bloquantes traitées (résolution unique du projet, messages par SQLSTATE, rejeu avec slug pris)
- [x] security-auditor : OK, remarques non bloquantes ; cas fermés testés (23503, 23502) ; journalisation sans données personnelles reportée en 0007
- [x] Aucune déviation d'architecture (ADR 0010 acceptée par Hery le 15/11/2026)
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (15/11/2026) : `carnet_register_member.test.sql`, plan 42 : déclaratif (signature, `plpgsql`, definer, volatile, `search_path`, `bypassrls`, corps sans `auth.uid`/`is_member`/`can_`/`is_project_member`, privilèges `service_role` seul), 42501 sous `authenticated` et `anon`, personas N/O/P/Q/R (création, triple rejeu idempotent, multi-projet, slug pris → 23505 atomique, 23514 slug et nom, projet archivé → P0001), état final croisé. Échec vérifié : 36/42 rouges, 370 existants verts ; sonde 42/42. Points pour db-architect : code P0001, messages d'erreur remontés tels quels, `insert … select` silencieux à compléter par un test explicite, pas de mention des appels interdits dans les commentaires du corps.
- implémentation (db-architect, 15/11/2026) : `20261115150000_create_register_member.sql` : `plpgsql`, `volatile`, `security definer`, `search_path = ''` ; garde-fou P0001 avant toute écriture ; appartenance `on conflict do nothing` ; profil `on conflict (owner_id) do nothing` ; retour de l'`id` du profil ; pas de bloc `exception` ; `revoke` public/anon/authenticated, `grant` service_role. `migration up`, 412/412 sur trois exécutions, double application (`repair --status reverted` + `up`) sans erreur, dump conforme. Écarts : aucun. Nuance signalée : compte déjà membre + arguments invalides → 23514 (les `check` précèdent l'arbitre `on conflict`) ; `p_user_id` inconnu → 23503. Vérifié par l'orchestrateur : 412/412, `pnpm check` 7/7, `POST /rest/v1/rpc/register_member` avec la clé `anon` → 401.
- implémentation, retouche post-revue et audit (db-architect, 15/11/2026) : identifiant du projet résolu une fois (`select id into v_project_id … ; if not found then raise exception`), prédicat dupliqué supprimé, nuance du rejeu documentée en en-tête ; deux réapplications sans erreur, 412/412 après chacune.
- test-engineer, retouches post-revue et audit (15/11/2026) : plan 52 : messages des `throws_ok` → `null` avec justification de la contrainte unique en jeu ; rejeu de N avec le slug de O (décision 4, arbitre avant `profiles_slug_key`) ; cas fermés (`p_user_id` inconnu → 23503, `p_user_id`/`p_slug` nuls → 23502, rien d'écrit). 422/422 sur deux exécutions. Vérifié par l'orchestrateur : 422/422, `pnpm check` 7/7, un seul prédicat « projet actif », aucun identifiant interdit dans la migration.
- reviewer (15/11/2026) : **OK, remarques non bloquantes.** Conforme aux cinq décisions, aux critères 1 à 8 et à l'ADR 0010. Retenu : résoudre l'identifiant du projet une fois (`select id into v_project_id … ; if not found then raise exception`) au lieu de répéter le prédicat « projet actif » ; messages d'erreur des `throws_ok` passés à `null` (SQLSTATE seul, cohérence 0005, indépendance de la locale) ; test du rejeu avec un slug pris entre-temps par un autre compte (arbitre `owner_id` avant `profiles_slug_key`, retour de l'id existant). Nuance « rejeu avec arguments invalides → 23514 » : acceptable (Zod précède l'appel ; un contournement doit remonter). Pour 0007 : brancher la gestion d'erreur sur le SQLSTATE, jamais sur le message ; valider par Zod même sur rejeu.
- security-auditor (15/11/2026) : **OK, remarques non bloquantes.** Seule voie d'écriture dans `platform` depuis l'API, projet `carnet` actif seulement, rôle `user` ; injection impossible (SQL statique, `search_path = ''`) ; `p_user_id` inconnu → 23503 fermé. Surface si la clé `service_role` fuyait : marginale par rapport à ce que la clé donne déjà (bypass RLS `carnet`, API admin GoTrue de toute l'instance) ; mitigation = confinement de la clé. Moyen, reporté en 0007 : les `DETAIL` Postgres de 23514/23502 contiennent la ligne entière (données personnelles) → journaliser `code` + contrainte + corrélation seulement, jamais `details`/`hint`/`message`. Faibles, traités : fenêtre entre garde-fou et `insert … select` (résolution unique), cas fermés testés (23503, 23502), messages par code. Faibles, reportés : comptes soft-deleted/bannis inscriptibles (fiche RGPD : suppression dure) ; clé `service_role` unique pour toute l'instance, rotation = `JWT_SECRET` (hérité ADR 0002, à consigner lors d'une prochaine ADR). Veille : rien de nouveau.
