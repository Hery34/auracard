# 0002 — Coquille applicative Next.js

- Statut : done (14/11/2026)
- Agent : frontend (tests : test-engineer)
- Phase : 1
- ADR liées : 0003, 0007

## Objectif
L'application se construit (`pnpm build`, sortie standalone) et sert une page d'accueil minimale en français avec les en-têtes de sécurité de la fiche 0001 ; le premier test E2E Playwright passe sur les deux profils mobiles.

## Périmètre de fichiers
- Autorisé (frontend) : `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`.
- Autorisé (test-engineer) : `tests/e2e/home.spec.ts`.
- Interdit : tout le reste. Aucun fichier dans `public/` (pas de logos ni d'images de démonstration).

## Critères d'acceptation
1. Étant donné le build de production, quand un visiteur demande `/`, alors la réponse est 200, le document porte `<html lang="fr">`, le titre `carnet`, et le texte « carnet » est visible. Vérifié sur les profils mobile iOS et Android.
2. Les en-têtes `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` et `Content-Security-Policy: frame-ancestors 'none'` sont présents sur `/` ; `X-Powered-By` est absent.
3. Aucun fichier de `src/app/` ne contient `"use client"`.
4. `globals.css` contient `@import "tailwindcss";` et rien d'autre. Aucune police ni feuille de style externe.
5. `pnpm build` réussit ; `pnpm check` et `pnpm test:e2e` sont verts.

## Règles applicables
`docs/rules/nextjs.md` (App Router, Server Components), `docs/rules/security.md`, `docs/rules/testing.md`.

## Hors périmètre
Design, composants `src/ui/`, pages réelles (phase 2), favicon et métadonnées sociales.

## Définition de terminé
- [x] `tests/e2e/home.spec.ts` écrit par test-engineer, échouant avant implémentation (404 sur les deux profils)
- [x] `pnpm check`, `pnpm build` et `pnpm test:e2e` verts, lancés par l'orchestrateur (7 tests unitaires, 4 E2E)
- [x] reviewer : OK, remarques non bloquantes consignées
- [x] security-auditor : OK, remarques reportées à la prochaine fiche backend et à la fiche Dockerfile
- [x] Aucune déviation d'architecture
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (14/11/2026) : `tests/e2e/home.spec.ts`, 2 tests × 2 projets (`ios-webkit`, `android-chromium`). Preuve d'échec sur le build sans page : test 1 rouge (404 au lieu de 200) sur les deux profils. Le test 2 (en-têtes) passait déjà, les en-têtes de 0001 s'appliquant aussi à la 404 : décision orchestrateur, ajout de `expect(response.status()).toBe(200)` pour vérifier la vraie page. Incident : un `next start` orphelin (laissé par l'étape 0001) occupait le port 3000 ; arrêté par l'orchestrateur avant l'implémentation.
- implémentation (frontend, 14/11/2026) : `layout.tsx` (Server Component, `lang="fr"`, `metadata.title = "carnet"`), `page.tsx` (`<main><h1>carnet</h1></main>`), `globals.css` (`@import "tailwindcss";`). `pnpm check` vert, `pnpm build` en App Router (`/` et `/_not-found` statiques), `pnpm test:e2e` 4/4, port 3000 libre après. Signalé : `pnpm start` avertit que `output: standalone` attend `node .next/standalone/server.js` ; les E2E n'exercent donc pas l'artefact standalone → à traiter à la fiche Dockerfile (déjà noté en 0001).
- reviewer (14/11/2026) : **OK avec remarques non bloquantes**. Critères 1 à 5 conformes, typage `React.ReactNode` sans import correct (espace de noms UMD en position type, `jsx: react-jsx`), test et implémentation cohérents. Notes : `.first()` dans le test neutralise le mode strict (choix test-engineer, conservé) ; `src/app/.gitkeep` devenu inutile (à supprimer à l'occasion) ; les textes d'interface des pages réelles passeront par le fichier de traduction (phase 2). Pour la fiche Dockerfile : copier `public/` et `.next/static/` dans `.next/standalone/`, lancer `node .next/standalone/server.js` avec `HOSTNAME=0.0.0.0`, et pointer les E2E sur cet artefact (script `start:standalone` ou image CI).
- security-auditor (14/11/2026) : **OK avec remarques non bloquantes**. Aucune ressource externe, aucun secret ni `process.env`, en-têtes vérifiés sur la vraie page (200) sur les deux profils. Reportés : `public/.gitkeep` servi à `GET /.gitkeep` (corps vide) → ne pas le copier dans le standalone ou le supprimer au premier vrai fichier de `public/` ; `.gitkeep` redondants dans `src/app/` et `tests/e2e/` (ménage à l'occasion) ; `NEXT_TELEMETRY_DISABLED=1` à ajouter dans `ci.yml` et le futur Dockerfile (prochaine fiche backend) ; E2E sur l'artefact standalone à la fiche Dockerfile. Rappel : le test E2E verrouille la CSP `frame-ancestors 'none'`, à mettre à jour avec la CSP complète de phase 2.
