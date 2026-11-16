# 0015 — Suivis : mention RGPD, âge minimal des paquets, règle de test

- Statut : done (16/11/2026)
- Agent : frontend (mention) ; backend (configuration pnpm, `docs/rules/testing.md`)
- Phase : 1 (suites des audits 0010, 0012, 0013)
- ADR liées : 0011, 0013

## Objectif
La mention d'information dit exactement combien de temps l'empreinte d'adresse IP est conservée ; pnpm refuse les versions publiées depuis moins de deux semaines ; la règle de test décrit fidèlement `pnpm check` et `E2E_BASE_URL`.

## Décisions de Hery (16/11/2026)
1. **Mention RGPD** : l'empreinte est conservée « 24 heures au plus après votre dernière tentative » (`consume_rate_limit` réinitialise la fenêtre à chaque nouvelle tentative ; audits 0010).
2. **`minimumReleaseAge`** de pnpm à 14 jours (20160 minutes) : la règle « version publiée depuis au moins deux semaines » est imposée à chaque installation, pas seulement par discipline (audit 0012).
3. **`docs/rules/testing.md`** : `pnpm check` = lint + types + tests unitaires (l'intégration se lance par `pnpm test:integration`) ; `E2E_BASE_URL` réservé à la CI (HTTPS local par Caddy, localhost uniquement), absent en local (revue 0013).

## Périmètre de fichiers
- Autorisé (frontend) : `src/ui/features/auth/privacy-notice.tsx`.
- Autorisé (backend) : `pnpm-workspace.yaml` ou `.npmrc` (selon la version de pnpm du projet), `docs/rules/testing.md`.
- Interdit : tout le reste.

## Critères d'acceptation
1. La mention contient « 24 heures au plus après votre dernière tentative » ; le début de phrase attendu par `tests/e2e/theme.spec.ts` (« Votre adresse e-mail et votre nom affiché servent uniquement ») est conservé ; E2E verts.
2. Avec le réglage, `pnpm install --frozen-lockfile` passe sur le lockfile actuel ; une version publiée depuis moins de 14 jours est refusée (preuve par un essai sur un paquet récent, sans modifier `package.json`).
3. `docs/rules/testing.md` décrit `pnpm check`, `pnpm test:integration` et `E2E_BASE_URL` conformément au code et à la CI.
4. `pnpm check` vert.

## Définition de terminé
- [x] `pnpm check` vert ; `pnpm test:e2e` vert
- [x] Preuve du refus d'une version trop récente
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- frontend (16/11/2026) : `privacy-notice.tsx` : « Une empreinte de votre adresse IP sert seulement à limiter les tentatives abusives ; elle est conservée 24 heures au plus après votre dernière tentative. » `pnpm check` 289/289, build vert, E2E 66/66.
- backend (16/11/2026) : pnpm 10.22.0 → `pnpm-workspace.yaml` (`minimumReleaseAge: 20160`, sans `packages:`) ; `pnpm install --frozen-lockfile` vert (projet et copie vierge) ; refus prouvé : `next@16.5.0-canary.52` (publiée le 16/11/2026) → `ERR_PNPM_NO_MATCHING_VERSION`. `docs/rules/testing.md` : modification refusée par le hook de périmètre, appliquée par Hery avec le texte proposé. `pnpm-workspace.yaml` créé par `Bash`, hors liste du hook : à ajouter au périmètre `backend` (Hery).
- vérification orchestrateur (16/11/2026, branche depuis `main` après fusion de #4) : `pnpm install --frozen-lockfile` vert, `pnpm check` 289/289, build vert, E2E 66/66.
