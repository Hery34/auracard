# 0012 — Emplacement des Server Actions et frontière `src/app` → `src/server`
- Statut : Acceptée (16/11/2026)

## Contexte
`docs/architecture.md` §3 place les Server Actions dans `src/app` (« pages, Server Actions, route handlers »). La constitution (`CLAUDE.md`) confie les Server Actions à l'agent `backend`, dont le périmètre d'écriture est `src/domain/` et `src/server/`, tandis que `src/app/` appartient à `frontend`. La fiche 0007 (décision 8, validée par Hery le 15/11/2026) a placé les actions dans `src/server/actions/`. Le reviewer de la fiche 0007 demande que cette divergence avec l'architecture figée soit consignée par ADR, comme l'exige le document lui-même.

## Décision
1. Les Server Actions vivent dans `src/server/actions/` (fichiers `'use server'`, un fichier par domaine fonctionnel : `auth.ts`, puis `profile.ts`, `booking.ts`…). Elles appartiennent à `backend` (ou `scheduling` pour `src/server/booking/actions.ts`). Les route handlers restent dans `src/app` (fichiers `route.ts`, agent `frontend`), et appellent des cas d'usage de `src/server`.
2. Les schémas Zod des actions vivent dans des modules sans directive (`src/server/actions/*-schemas.ts`) pour être partagés avec les formulaires (`solid-dry.md` : un schéma par entrée).
3. Frontière de présentation : `src/app` et `src/ui` n'importent de `src/server` que `src/server/actions/*` (actions et schémas) et, pour les Server Components, `src/server/container` ou des cas d'usage de lecture exposés par le conteneur. Jamais `src/server/repositories/*` ni `src/server/infrastructure/*`. Règle ESLint `no-restricted-imports` correspondante.
4. `docs/architecture.md` §3 est lu avec cet amendement ; le document reste figé.

## Conséquences
- Périmètres d'agents cohérents avec le hook de périmètre ; la structure `validate → authenticate → authorize → useCase → map Result` est revue par le reviewer dans le périmètre `backend`.
- `src/app` reste une couche de présentation pure, vérifiable par lint.

## Alternatives écartées
- Actions dans `src/app` écrites par `frontend` : mélange de responsabilités, la validation et l'autorisation sortiraient du périmètre backend.
- Actions dans `src/app` écrites par `backend` : impossible avec le hook de périmètre sans exception par fichier.
