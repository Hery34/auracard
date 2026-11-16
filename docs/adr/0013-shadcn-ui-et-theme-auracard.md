# 0013 — Shadcn/ui, thème AuraCard et dossier `src/ui/lib/`
- Statut : Acceptée (16/11/2026)

## Contexte
La convention Next.js de Hery prend Shadcn/ui comme base des composants. La fiche 0012 l'introduit avec la charte AuraCard (`docs/assets/charte_graphique_auracard.jpeg`). Shadcn suppose un utilitaire `cn` et un dossier de hooks que `docs/architecture.md` §3 ne prévoit pas : sous `src/ui/`, seuls `primitives/` et `features/` existent. Le reviewer de la fiche 0012 demande que cet écart soit consigné.

## Décision
1. **Shadcn/ui** est la base des primitives. Les composants générés vivent dans `src/ui/primitives/` (alias `ui`) et sont adaptés au projet (cibles ≥ 44 px, champs en 16 px, contrastes AA). La CLI `shadcn` est lancée en version exacte par `pnpm dlx`, jamais installée.
2. **Dépendances** (versions exactes, validées par Hery le 16/11/2026) : `class-variance-authority`, `clsx`, `tailwind-merge`, `radix-ui`. Pas de paquet `cn` (0.x, trop récent), pas de `lucide-react`, pas de `tw-animate-css` tant qu'aucun composant ne les exige.
3. **Nouveau dossier `src/ui/lib/`** : utilitaires transverses de présentation (`cn` dans `utils.ts`), sans dépendance au domaine ni au serveur. Les hooks client éventuels vont dans `src/ui/lib/hooks/` (alias `hooks` de `components.json`) ; l'alias `components` ne doit pas servir à écrire hors de `primitives/` et `features/`.
4. **Thème** : sombre uniquement, variables CSS de la charte dans `:root` de `src/app/globals.css` (seule source de la palette), police Montserrat via `next/font/google` (auto-hébergée au build). Texte foncé sur émeraude (le blanc sur émeraude est à 2,1:1).
5. **Nom affiché** : AuraCard ; `carnet` reste le nom technique (dépôt, schéma, identifiants).
6. `docs/architecture.md` §3 est lu avec cet amendement ; le document reste figé.

## Conséquences
- Les fiches de phase 2 ajoutent les composants Shadcn dont elles ont besoin, dans `primitives/`, avec les mêmes adaptations.
- `tailwind-merge` coûte environ 8,5 Ko gzip au JavaScript client des pages à formulaires ; coût payé une fois pour toutes les primitives.
- Toute nouvelle couleur passe par une variable de `globals.css` et un contrôle de contraste (tests `tests/e2e/theme.spec.ts`).

## Alternatives écartées
- `cn` dans `src/ui/primitives/utils.ts` : mélange utilitaires et composants dans le même dossier.
- `cn` avec `clsx` seul (sans `tailwind-merge`) : les surcharges de `className` entreraient en conflit sans erreur visible.
- Paquet `cn` du registre Shadcn : version 0.x publiée depuis deux semaines seulement.
