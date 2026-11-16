# Next.js

## Version et veille de sécurité
- **DOIT** : version exacte épinglée (`"next": "16.x.y"`, sans `^`), alignée avec `react` / `react-dom` recommandés par cette version.
- **DOIT** : à l'initialisation, prendre la **dernière version corrigée** publiée (référence au 14/11/2026 : 16.4.5, correctifs du 3 novembre 2026). Vérifier sur https://nextjs.org/blog avant d'installer, car Vercel publie des correctifs de sécurité mensuels.
- **DOIT** : contrôle mensuel par `security-auditor` (blog Next.js + avis GitHub de `vercel/next.js`) ; `pnpm audit` en CI, sachant qu'il peut réagir avec retard.
- Mise à jour de version : fiche dédiée, `pnpm check` + E2E verts avant fusion.

## Réduction de la surface d'attaque
- **DOIT** : `images.unoptimized: true` dans `next.config.ts`. L'optimisation d'images intégrée a fait l'objet de plusieurs failles critiques en 2026 ; nos images sont redimensionnées par le stockage.
- **DOIT** : ne pas utiliser `next/og` / `ImageResponse` sans ADR (même raison).
- **DOIT** : `poweredByHeader: false`, en-têtes de sécurité (CSP stricte, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) définis dans `next.config.ts`.
- Pas de WebSocket servi par Next.js.

## App Router
- **DOIT** : Server Components par défaut ; `"use client"` sur les seules feuilles interactives.
- **DOIT** : `params` et `searchParams` traités comme asynchrones (Next 16).
- Groupes de routes : `(public)` pour profil, redirections NFC/QR et rendez-vous ; `(dashboard)` pour l'espace connecté ; `(auth)` pour connexion/inscription.
- Page profil : génération statique + `revalidateTag('profile:<id>')` à chaque modification.

## Autorisation
- **DOIT** : le `proxy` (ex-`middleware`) ne sert qu'au confort (redirection vers la connexion). **Il ne protège rien.** Plusieurs contournements du middleware ont été corrigés en 2026.
- **DOIT** : chaque Server Action et route handler revérifie la session (`supabase.auth.getUser()`, jamais `getSession()` seul côté serveur) et l'autorisation métier.

## Server Actions
- **DOIT** : structure fixe : `validate (Zod) → authenticate → authorize → useCase → map Result`.
- **DOIT** : pas de logique métier dans l'action : elle appelle un cas d'usage.
- **DOIT** : clé d'idempotence pour toute création (voir `idempotence.md`).

## Variables d'environnement
- **DOIT** : validées au démarrage par un schéma Zod (`src/server/infrastructure/env.ts`). Seules `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` sont publiques.
