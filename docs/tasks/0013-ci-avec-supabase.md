# 0013 — CI avec la pile Supabase locale

- Statut : done (16/11/2026)
- Validé par Hery (16/11/2026) : action `supabase/setup-cli` et épinglage de toutes les actions par SHA.
- Validé par Hery (16/11/2026, après diagnostic de l'exécution 43878811015) : **décision 6 — HTTPS local par Caddy dans le job `e2e` uniquement**. Cause : WebKit Linux (Playwright) n'enregistre pas les cookies `Secure` reçus en HTTP, même sur `localhost` ; les cookies de production restent `Secure`. Caddy 2.11.9, binaire de la release GitHub officielle, SHA-512 du fichier `caddy_2.11.9_checksums.txt` épinglé et vérifié (`sha512sum --check --strict`) ; `E2E_BASE_URL` défini sur l'étape `test:e2e` seulement, comportement local inchangé. Périmètre étendu à `.github/e2e.Caddyfile`.
- Agent : backend (`.github/workflows/ci.yml`, scripts `package.json`) ; test-engineer (adaptations éventuelles des `globalSetup` et `globalTeardown`)
- Phase : 1 (socle : outillage et CI)
- ADR liées : 0002, 0003

## Objectif
Chaque push et chaque pull request exécutent toute la suite : pgTAP, tests d'intégration et E2E complets (dont `tests/e2e/auth.spec.ts`), sur une pile Supabase locale démarrée dans le job, au lieu du seul `home.spec.ts` avec des variables factices.

## Périmètre de fichiers
- Autorisé (backend) : `.github/workflows/ci.yml`, `package.json` (scripts uniquement), `playwright.config.ts` (seulement si la détection CI doit changer).
- Autorisé (test-engineer) : `tests/integration/setup/**`, `tests/e2e/global-teardown.ts`, `tests/e2e/helpers/**`.
- Interdit : tout le reste ; aucun secret GitHub réel ; aucune connexion à l'instance de production.

## Décisions de conception (à valider par Hery)
1. **CLI Supabase en CI** : action `supabase/setup-cli` (dépendance tierce, arrêt obligatoire §2), version de la CLI épinglée à celle utilisée en local ; toutes les actions épinglées par **SHA de commit** (pas seulement par étiquette), y compris celles déjà présentes.
2. **Pile allégée** : `supabase start -x studio,imgproxy,inbucket,edge-runtime,logflare,vector,realtime,storage-api` (seulement ce qu'exigent les tests : Postgres, GoTrue, PostgREST, Kong) ; la liste exacte est vérifiée par backend contre `supabase/config.toml`.
3. **Jobs** :
   - `check` : inchangé (lint, types, unitaires, audits), sans Supabase, rapide.
   - `db` : `supabase start`, `supabase db reset` (migrations depuis zéro, donc preuve d'application sur base vierge), puis `supabase test db` (pgTAP).
   - `e2e` : `supabase start`, variables injectées depuis `supabase status -o env` (comme `playwright.config.ts` en local), `RATE_LIMIT_SECRET` de test, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e` complet sur iOS et Android. Les variables factices actuelles disparaissent.
4. **`globalTeardown`** : actuellement désactivé en CI (`playwright.config.ts`) ; inutile puisque la pile est jetée en fin de job. On le garde désactivé, sauf avis contraire du reviewer.
5. **Garde-fous** : l'URL de la pile est locale (`127.0.0.1`), donc les gardes `assertLocalSupabaseUrl` passent sans échappatoire ; `CARNET_INTEGRATION_ALLOW_REMOTE` n'est jamais défini en CI.

## Critères d'acceptation
1. Sur une branche de test, les trois jobs passent : pgTAP (532 tests ou plus), intégration (26 ou plus), E2E (30 ou plus, iOS et Android).
2. Une migration volontairement cassée fait échouer `db` ; un E2E volontairement cassé fait échouer `e2e` (preuve dans le rapport, puis retrait).
3. Aucune valeur factice ni secret réel dans `ci.yml` ; aucune variable ne pointe hors de `127.0.0.1`.
4. Toutes les actions sont épinglées par SHA ; `permissions: contents: read` conservé.
5. Durée totale indiquée dans le rapport (objectif : moins de 10 minutes) ; caches pnpm et navigateurs Playwright utilisés.

## Règles applicables
`docs/rules/testing.md`, `docs/rules/security.md` (secrets, dépendances), `docs/rules/supabase.md`, `docs/rules/nextjs.md`.

## Hors périmètre
- Déploiement continu vers le VPS (fiche déploiement, ADR 0007). Veille mensuelle des avis de sécurité automatisée. Protection de branche sur GitHub (réglage de Hery).

## Définition de terminé
- [x] Action `supabase/setup-cli` et épinglage par SHA validés par Hery
- [x] Preuves d'échec (migration cassée, E2E cassé) consignées
- [x] `pnpm check` vert en local ; les trois jobs verts sur GitHub
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Aucune déviation d'architecture (sinon ADR validée par Hery)
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer : sans objet (aucun test nouveau ; filet = suites existantes).
- implémentation (backend, 16/11/2026) : jobs `check`, `db` (`supabase start` allégé, `db reset`, `test db`), `e2e` (intégration, build, E2E complets) ; actions épinglées par SHA (checkout v7.0.1, pnpm/action-setup v6.1.1, setup-node v7.1.0, supabase/setup-cli v3.2.0, cache v6.1.0), CLI 2.120.0, services exclus `realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`. Exécution 43878811015 : `e2e` 29/30, `[ios-webkit] auth.spec.ts:253` (cookies `Secure` non stockés par WebKit Linux en HTTP) → décision 6, Caddy 2.11.9 en HTTPS local (`E2E_BASE_URL`, CI seulement). Durcissements post-revue/audit : `pipefail` et contrôle des 3 variables exportées, SHA-512 officiel de Caddy, `persist-credentials: false`, `bind 127.0.0.1`, `E2E_BASE_URL` limité à localhost, clé de cache Playwright avec navigateurs, `setup-node` retiré de `db`. `RATE_LIMIT_SECRET` reste au niveau du job (validé au build par `env.ts`).
- vérification orchestrateur (16/11/2026) : exécution 43882756599 verte — `check` 24 s (289 unitaires), `db` 2 min 00 (532 pgTAP), `e2e` 3 min 59 (26 intégration, 30 E2E iOS et Android) ; ≈ 4 min en parallèle ; caches pnpm restaurés. Preuves d'échec : E2E → exécution 43878811015 (`e2e` rouge, code 1) ; migration cassée → branche jetable `proof/0013-broken-migration` (`select 1/0;`), exécution 43883715535 : `db` et `e2e` rouges (`division by zero`, SQLSTATE 22012, dès `supabase start`), `check` vert ; branche supprimée. `pnpm audit` complet : 1 avis moyen `minimatch` (dépendance de développement via `eslint-config-next`), non bloquant ; `--prod` : aucun.
- reviewer (16/11/2026) : bloquant (procédure : Caddy non consigné ; preuve migration manquante) → levé (décision 6 consignée, preuve faite). À corriger traités (commentaire teardown, `pipefail`, `setup-node`, chiffres et caches). Suggestions : clé de cache (fait) ; ligne `E2E_BASE_URL` dans `docs/rules/testing.md` et écart antérieur « `pnpm check` lance l'intégration » dans ce même fichier → à reprendre (règles hors périmètre orchestrateur, à soumettre à Hery).
- security-auditor (16/11/2026) : **OK**. SHA des actions et actions internes de `setup-cli` vérifiés, Caddy à jour (2.11.9, avis 2.11.8 corrigés), clés de démonstration locales acceptables, `pull_request` sans `pull_request_target`. Faibles traités : SHA-512 officiel, `persist-credentials: false`, `ignoreHTTPSErrors` limité à localhost, `bind 127.0.0.1`. Hors périmètre : réglage « approbation des workflows de forks » (Hery).
