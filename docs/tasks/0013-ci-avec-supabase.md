# 0013 — CI avec la pile Supabase locale

- Statut : todo (action GitHub tierce à valider par Hery)
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
- [ ] Action `supabase/setup-cli` et épinglage par SHA validés par Hery
- [ ] Preuves d'échec (migration cassée, E2E cassé) consignées
- [ ] `pnpm check` vert en local ; les trois jobs verts sur GitHub
- [ ] reviewer : OK ou remarques non bloquantes traitées
- [ ] security-auditor : OK
- [ ] Aucune déviation d'architecture (sinon ADR validée par Hery)
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer : …
- implémentation : …
- reviewer : …
- security-auditor : …
