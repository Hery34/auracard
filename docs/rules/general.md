# Règles générales

## TypeScript
- **DOIT** : `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- **DOIT** : aucun `any` ; `unknown` + validation à la place. Aucun `@ts-ignore` ; `@ts-expect-error` seulement avec commentaire justificatif.
- **DOIT** : types de la base générés (`supabase gen types typescript --schema carnet`) — jamais écrits à la main.
- Types du domaine distincts des types de la base : la conversion se fait dans les repositories (mappers).

## Gestion des erreurs
- **DOIT** : le domaine et les cas d'usage renvoient un `Result<T, E>` (`{ ok: true, value } | { ok: false, error }`). Les exceptions sont réservées aux erreurs non récupérables (bug, infrastructure indisponible).
- Les erreurs métier sont des unions discriminées nommées (`ProfileSlugTaken`, `SlotUnavailable`…), jamais des chaînes libres.
- Aucune erreur technique (message SQL, pile) n'est renvoyée au navigateur.

## Nommage
- Code, identifiants, tables, colonnes : **anglais**. Documentation et messages à Hery : français. Textes de l'interface : via un fichier de traduction (`fr` par défaut).
- Fichiers : `kebab-case.ts`. Composants React : `PascalCase.tsx`. Cas d'usage : verbe + objet (`update-profile.ts`, `book-slot.ts`).
- Tables : pluriel `snake_case` (`analytics_events`). Colonnes booléennes : `is_` / `has_`.

## Taille et forme
- Une fonction fait une chose ; au-delà d'environ 40 lignes, se demander si elle en fait deux.
- Pas de code mort, pas de code commenté, pas de `console.log` (logger structuré `src/server/infrastructure/logger.ts`).
- Imports absolus via `@/` ; pas d'import relatif qui remonte plus de deux niveaux.

## Dépendances
- **DOIT** : toute nouvelle dépendance est validée par Hery (via l'orchestrateur). Critères : maintenue, sans CVE ouverte, taille raisonnable, pas d'équivalent natif.
- **DOIT** : versions épinglées exactement pour `next`, `react`, `react-dom`, `@supabase/*`.

## Git
- Commits conventionnels : `feat(profile): …`, `fix(booking): …`, `chore(deps): …`.
- Une fiche = une branche `NNNN-titre-court`. Pas de commit direct sur `main`.
- `pnpm check` (lint + types + tests) vert avant tout commit.
