# 0001 — Socle Next.js et outillage

- Statut : done (14/11/2026)
- Agent : backend (tests : test-engineer)
- Phase : 1
- ADR liées : 0003 (version Next.js), 0007 (hébergement : `output: 'standalone'`)

## Objectif
Le dépôt est un projet Next.js 16 vérifiable d'une seule commande : `pnpm check` (lint + types + tests unitaires) passe en local et en CI, le harnais E2E est en place, et le premier bloc du domaine (`Result`) existe.

## Contexte vérifié le 14/11/2026 par l'orchestrateur
- Registre npm : `next` **16.4.6**, publiée le 09/11/2026 ; release de maintenance stable, postérieure au correctif de sécurité du 03/11/2026 (16.4.5). C'est la version à épingler. backend revérifie `pnpm view next version` et https://nextjs.org/blog le jour de l'installation ; si une version plus récente existe, il s'arrête et le signale.
- `react` / `react-dom` : 19.3.1.
- `typescript` : la 7.0.x (compilateur natif) n'est **pas** supportée par `typescript-eslint` (`<6.1.0`), dépendance d'`eslint-config-next`. Épingler la dernière **6.0.x** (6.0.3 ce jour).
- Poste : Node 26.13.0 (via fnm), pnpm 10.22.0, pas de corepack.
- `create-next-app` est **exclu** : le dossier n'est pas vide (il refuserait) et il écraserait `README.md` et `.gitignore`. Les fichiers sont écrits à la main.

## Périmètre de fichiers
- Autorisé (backend) : `package.json`, `pnpm-lock.yaml`, `.npmrc`, `.node-version`, `.gitignore`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `src/domain/shared/result.ts`.
- Autorisé (test-engineer) : `src/domain/shared/result.test.ts`.
- Interdit : tout le reste. En particulier `src/app/` (fiche 0002), `README.md`, `CLAUDE.md`, `.claude/`.

## Dépendances (à valider par Hery)
| Paquet | Version | Rôle |
|---|---|---|
| `next` | 16.4.6 exacte | framework |
| `react`, `react-dom` | 19.3.1 exacte | |
| `typescript` | 6.0.3 exacte | voir contexte |
| `@types/node`, `@types/react`, `@types/react-dom` | dernières compatibles | types |
| `eslint`, `eslint-config-next` | 10.x, 16.4.6 | lint |
| `tailwindcss`, `@tailwindcss/postcss` | 4.3.x | styles (utilisés à partir de la fiche 0002) |
| `vitest` | 5.1.x | tests unitaires et d'intégration |
| `@playwright/test` | 1.x dernière | E2E (premier test à la fiche 0002) |

Rien d'autre. `zod` et `@supabase/*` arrivent avec la fiche d'inscription.

## Critères d'acceptation
1. Étant donné un poste avec Node 26 et pnpm 10, quand on exécute `pnpm install --frozen-lockfile`, alors l'installation réussit. `package.json` porte `packageManager` (pnpm, version exacte) et `engines.node` (`>=26 <27`) ; `.node-version` contient la version Node retenue ; `.npmrc` contient `engine-strict=true`.
2. `pnpm check` enchaîne `lint`, `typecheck` (`tsc --noEmit`) et `test` (`vitest run`), et passe.
3. `tsconfig.json` : `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` à `true` ; alias `@/*` → `./src/*`.
4. `next.config.ts` : `images.unoptimized: true`, `poweredByHeader: false`, `output: 'standalone'`, et sur toutes les routes les en-têtes `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Content-Security-Policy: frame-ancestors 'none'`.
5. `eslint.config.mjs` (flat config ; `next lint` n'existe plus en 16, le script appelle la CLI ESLint) : `eslint-config-next` (core-web-vitals + typescript) et `no-restricted-imports` : dans `src/domain/**`, tout import de `next`, `next/*`, `react`, `react/*`, `react-dom`, `react-dom/*`, `@supabase/*` est une erreur *(`react-dom/*` ajouté le 14/11/2026 sur constat de backend)* ; dans `src/app/**` et `src/ui/**`, tout import de `@supabase/*` est une erreur. Preuve : backend crée un fichier temporaire violant chaque règle, constate l'échec de `pnpm lint`, le supprime, et le consigne dans son rapport.
6. `vitest.config.ts` : environnement `node`, `include` : `src/**/*.test.ts` et `tests/integration/**/*.test.ts` ; l'alias `@/` est résolu.
7. `playwright.config.ts` : `testDir: tests/e2e`, deux projets, mobile iOS émulé (WebKit) et mobile Android émulé (Chromium), `webServer` servant le build de production ; script `test:e2e`. `pnpm test:e2e --pass-with-no-tests` sort en 0 (aucun test avant la fiche 0002).
8. `src/domain/shared/result.ts` exporte le type `Result<T, E>` (`{ ok: true; value: T } | { ok: false; error: E }`) et les constructeurs `ok(value)` et `err(error)`. Aucun import. Les tests de test-engineer passent.
9. `.github/workflows/ci.yml` : déclenché sur `push` et `pull_request` ; `permissions: contents: read` au niveau du workflow. Job `check` : Node lu dans `.node-version`, pnpm lu dans `packageManager`, `pnpm install --frozen-lockfile`, `pnpm check`, puis `pnpm audit --prod` (bloquant) et `pnpm audit` complet dans une étape distincte en `continue-on-error: true` (visible, jamais `|| true`). Job `e2e` : installation des navigateurs Playwright, `pnpm build`, `pnpm test:e2e`. *(Amendé le 14/11/2026 sur recommandation de security-auditor : l'avis GHSA-g3hv-75wg-m249 ne touche que l'outillage de lint, jamais déployé.)*
10. `git init -b main` exécuté. `.gitignore` complété (`next-env.d.ts`, `*.tsbuildinfo`, `test-results/`). **Aucun commit** : le premier commit est fait par Hery.
11. Rejouer `pnpm install` puis `pnpm check` ne modifie aucun fichier (hors `pnpm-lock.yaml` au premier passage).

## Règles applicables
`docs/rules/general.md` (TypeScript, dépendances), `docs/rules/nextjs.md`, `docs/rules/security.md` (en-têtes), `docs/rules/testing.md`.

## Hors périmètre
- `src/app/` : fiche 0002 (frontend).
- Supabase (client, `env.ts` Zod, types générés) : fiche d'inscription.
- CSP complète avec nonce : fiche de la première page publique (phase 2). Déviation temporaire de `nextjs.md`, consignée ici : la CSP de cette fiche ne porte que `frame-ancestors`.
- `Dockerfile` : fiche de premier déploiement (ADR 0007).
- shadcn/ui : première fiche d'interface.

## Définition de terminé
- [x] `result.test.ts` écrit par test-engineer, échouant avant implémentation
- [x] `pnpm check` vert, lancé par l'orchestrateur (7 tests)
- [x] `pnpm test:e2e --pass-with-no-tests` sort en 0 (après `pnpm build`)
- [x] reviewer : OK, remarques non bloquantes consignées
- [x] security-auditor : OK, `permissions` et audit en deux étapes appliqués ; `pnpm audit --prod` propre
- [x] Aucune déviation d'architecture hors la CSP partielle consignée ci-dessus
- [x] Ligne ajoutée dans `docs/journal.md`

## Prérequis à lever par Hery avant lancement
1. Valider le tableau des dépendances.
2. Corriger `.claude/hooks/guard-scope.mjs` : le périmètre racine de backend ne couvre ni `vitest.config.ts`, `postcss.config.mjs`, `playwright.config.ts`, `.node-version`, `.npmrc`, ni `.gitignore`. Correctif proposé : autoriser backend à écrire tout fichier **à la racine** (chemin sans `/`) sauf `CLAUDE.md` et `README.md`, en insérant après le bloc `if (isTestFile) { … }` :
   ```js
   // Fichiers de configuration à la racine : backend (sauf les documents protégés).
   const ROOT_PROTECTED = ["CLAUDE.md", "README.md"];
   if (agent === "backend" && !rel.includes("/") && !ROOT_PROTECTED.includes(rel)) process.exit(0);
   ```

## Rapports
- test-engineer (14/11/2026) : `src/domain/shared/result.test.ts`, 7 tests (`ok`, `err`, union exacte et rétrécissement via `expectTypeOf`, absence d'effet de bord). Preuve d'échec : `result.ts` absent, Vitest non installé. Les assertions de type sont vérifiées par `tsc --noEmit`, pas par `vitest run` : `tsconfig.json` doit inclure les `*.test.ts`. Décision orchestrateur : le type reste **sans `readonly`**, exactement comme le critère 8 ; `ok` et `err` renvoient un objet neuf à chaque appel.
- implémentation (backend, 14/11/2026) : 13 fichiers créés, `.gitignore` complété, `git init -b main` sans commit. Versions : next 16.4.6, react 19.3.1, typescript 6.0.3, eslint 10.15.0, vitest 5.1.0, @playwright/test 1.65.1, tailwind 4.3.5. `pnpm check` vert (7 tests), preuve ESLint fournie (fichier temporaire dans `src/domain`, `--stdin-filename` pour `src/app` et `src/ui`), idempotence prouvée par empreintes SHA-256. E2E à vide : exige un `pnpm build` préalable (webServer), puis sort en 0. Correction après revue (14/11/2026) : `ci.yml` reçoit `permissions: contents: read` et les étapes `pnpm audit --prod` (bloquante) puis `pnpm audit` en `continue-on-error: true` ; `pnpm check` toujours vert, vérifié par l'orchestrateur. Écarts signalés : `pnpm audit` sort en 1 (GHSA-g3hv-75wg-m249, minimatch via typescript-eslint, devDependency, modéré) → arbitrage ; `react-dom/*` ajouté aux motifs interdits du domaine ; `.remember/` ajouté aux ignores ESLint ; `vite` pair auto-installé non déclaré.
- reviewer (14/11/2026) : **OK avec remarques non bloquantes**. Critères 1 à 11 conformes à la lettre, vérifiés dans les paquets installés. Écarts backend tous justifiés (`react-dom/*` → critère 5 amendé ; `.remember/` ignoré par ESLint, fuite d'un outil de session, consigné ; `webServer` par `port`, Playwright dérive `baseURL` ; `vite` pair verrouillé par le lockfile, non déclaré). Consignés : `.npmrc` `save-exact=true` (sert la règle d'épinglage), `forbidOnly` et `reuseExistingServer` dans Playwright. `vitest.config.ts` en ESM sans `"type": "module"` : acceptable, correction future = renommer en `vitest.config.mts`, jamais `"type": "module"`. Décision orchestrateur : le job CI `e2e` reste rouge tant que 0002 n'a pas écrit le premier test ; accepté sans drapeau temporaire, aucun dépôt distant n'existe encore et 0002 suit immédiatement. Vigilance pour les revues de `src/domain/` : `no-restricted-imports` ne couvre pas `import()` dynamique.
- security-auditor (14/11/2026) : **OK avec remarques non bloquantes**. 16.4.6 confirmée dernière stable corrigée (16.4.5 = correctif du 03/11 ; 16.4.6 = rétroportage du 09/11). En-têtes, secrets, lockfile, CI sans secret ni `pull_request_target` : conformes. À traiter avant clôture : `pnpm audit --prod` bloquant + `pnpm audit` complet en `continue-on-error: true` ; bloc `permissions: contents: read` au niveau du workflow. Reportés : épinglage SHA des actions et `Strict-Transport-Security` (fiche de déploiement) ; `minimumReleaseAge` pnpm (décision Hery). Note pour la CSP de phase 2 : une CSP à nonce impose le rendu dynamique, incompatible avec la page profil statique → arbitrer hash / `'strict-dynamic'` avant d'écrire la CSP. Note pour backend derrière un proxy : ne jamais renvoyer telle quelle une `Response` obtenue par `fetch` (GHSA-pc58-hwjq-p385).
