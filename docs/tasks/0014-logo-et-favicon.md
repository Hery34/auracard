# 0014 — Logo et favicon AuraCard

- Statut : done
- Agent : frontend ; test-engineer (E2E)
- Phase : 1 (après 0012)
- ADR liées : —
- Référence : `docs/assets/charte_graphique_auracard.jpeg` (symbole aux anneaux entrelacés, décision de Hery du 16/11/2026)

## Objectif
L'en-tête affiche le bloc-marque AuraCard et l'onglet du navigateur, l'écran d'accueil mobile et les partages affichent le symbole, nets à toutes les tailles.

## Fichiers fournis par Hery (18/11/2026)
- `docs/assets/auracard-logo.svg` : bloc-marque horizontal (symbole + « AURACARD » vectorisé), 1771 × 400.
- `docs/assets/eslint.config.svg` : symbole seul, 680 × 440 (nom de fichier sans importance).
- **Forme intérieure de référence : le polygone du bloc-marque** (Hery). Le rectangle + trait du symbole seul est écarté : le symbole est repris avec le polygone.
- Les deux fichiers ont un fond opaque `#111111` et l'entrelacement est obtenu par des traits `#111111` qui « découpent » les bandes. Frontend **retire le fond et remplace ces découpes par un `<mask>`** : transparence réelle, rendu identique sur fond `#111111`, utilisable sur le thème `#0A0A0C` et sur la page publique claire. Déclinaisons carré Ardoise et cercle émeraude produites à partir du symbole nettoyé. Validation visuelle par Hery (capture comparée aux JPEG de la charte).

## Périmètre de fichiers
- Autorisé (frontend) : `public/brand/**`, `src/app/icon.svg`, `src/app/apple-icon.png`, `src/app/favicon.ico` (remplacement), `src/app/manifest.ts`, `src/app/opengraph-image.png`, `src/app/layout.tsx` (en-tête), `src/ui/primitives/logo.tsx`, `src/ui/features/app-shell/app-header.tsx` (ajouté le 18/11/2026 : c'est lui qui rend l'en-tête).
- Autorisé (test-engineer) : `tests/e2e/**`, `src/app/brand-assets.test.ts`.
- Ajouts du 18/11/2026 (orchestrateur) : frontend `src/app/(public)/p/[slug]/page.tsx` (image de partage par défaut), `src/app/opengraph-image.png`, `src/app/layout.tsx` (`metadataBase`) ; backend `src/server/container.ts` (export `siteUrl`, ADR 0012 : seule porte autorisée), `src/server/container-site-url.test.ts`, `scripts/brand-assets.mjs` (génération des fichiers de marque) ; test-engineer `src/app/brand-assets.test.ts`, `tests/e2e/profile-images.spec.ts` (`og:image` par défaut, décision de Hery).
- Interdit : tout le reste.

## Décisions de conception (proposées)
1. Conventions de fichiers de métadonnées de Next.js (`icon.svg`, `apple-icon.png`, `favicon.ico`, `manifest.ts`, `opengraph-image.png`) plutôt que des balises écrites à la main.
2. Favicon : symbole seul ; `apple-icon` et icônes du manifeste : symbole sur carré Ardoise (lisible sur l'écran d'accueil) ; `theme_color` et `background_color` `#0A0A0C`.
3. En-tête : composant `Logo` (SVG en ligne, `aria-label="AuraCard"` ou texte masqué), remplace l'en-tête textuel provisoire de 0012 ; hauteur adaptée au mobile, lien vers `/`.
4. SVG nettoyés (aucun script, aucune référence externe) avant d'être versionnés.

## Critères d'acceptation
1. `GET /icon.svg`, `/apple-icon.png`, `/favicon.ico`, `/manifest.webmanifest` répondent 200 avec le bon type ; le HTML référence ces icônes.
2. L'en-tête affiche le logo avec un nom accessible « AuraCard » ; le lien mène à `/`.
3. Les SVG ne contiennent ni `<script>`, ni gestionnaire `on*`, ni `href` externe.
4. `pnpm check`, `pnpm build`, `pnpm test:e2e` verts.

## Règles applicables
`docs/rules/nextjs.md`, `docs/rules/security.md` (SVG), `docs/rules/testing.md`.

## Hors périmètre
- Gabarits d'e-mails, supports physiques (cartes métal ou bois), page d'accueil marketing.

## Définition de terminé
- [x] Fichiers vectoriels fournis par Hery
- [x] Rendu validé visuellement par Hery
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `pnpm check` vert ; `pnpm build` vert ; `pnpm test:e2e` vert
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (18/11/2026) : `tests/e2e/brand.spec.ts` (20 E2E, critères 1–2) et `src/app/brand-assets.test.ts` (vitest `unit`, critère 3, dans `pnpm check`) ; 29 + 20 échecs avant implémentation. Contrat : `public/brand/auracard-logo.svg`, `auracard-symbol.svg`, `auracard-symbol-slate.svg` (carré Ardoise `#1E2022`, seul fond opaque admis), `auracard-symbol-emerald.svg` ; `src/app/icon.svg`, `apple-icon.png`, `favicon.ico`, `manifest.ts`. Règles SVG plus strictes que la fiche, acceptées par l'orchestrateur : aucune `<image>`, `<foreignObject>`, DOCTYPE/ENTITY, `url()` externe, `@import`, ni couleur `#111111` (preuve que les découpes sont passées en `<mask>`). `docs/rules/security.md` n'a pas de section SVG : à ajouter (proposition à Hery). Non couvert : fidélité visuelle (Hery), `opengraph-image.png`, tailles des icônes du manifeste.
- implémentation (18/11/2026, frontend) : `public/brand/` (4 SVG, `icon-192/512.png`), `src/app/icon.svg` (media query clair), `apple-icon.png`, `favicon.ico` (créé), `manifest.ts`, `src/ui/primitives/logo.tsx` (SVG en ligne, `currentColor` + `primary`), `app-header.tsx`. Découpes `#111111` → un `<mask>` par calque, disque intérieur → vrai trou. `pnpm check` 1827, build, E2E 306/306. PNG/ICO générés par Playwright Chromium + `magick` (script non versionné).
- reviewer (18/11/2026) : à corriger, non bloquant — ICO blanc illisible sur barre claire ; `opengraph-image` prévu et non produit ; suggestions retenues : `useId()` pour les id de masque, noms d'id lisibles, commentaire « light backgrounds » corrigé, `lang: "fr"` au manifeste, test de cohérence des tracés `logo.tsx` / `auracard-logo.svg`, commande de génération consignée. Duplication des tracés acceptée.
- **Hery (18/11/2026)** : palette de la charte (`#00C896`, `#FCFCFD`) à la place des teintes source ; déclinaison émeraude validée ; `opengraph-image` (1200 × 630, bloc-marque sur fond sombre) à produire maintenant, y compris comme aperçu des profils sans avatar. Orchestrateur : ICO sur carré Ardoise.
- corrections (18/11/2026) : test SVG en liste blanche (50 tests, 24 contournements refusés, test de cohérence des tracés) ; `opengraph-image.png` 1200 × 630, image par défaut des profils sans avatar ; ICO sur carré Ardoise ; `useId()` et id lisibles ; `lang: "fr"` ; `metadataBase` depuis `siteUrl` ; script versionné (`node scripts/brand-assets.mjs`, Chromium de `@playwright/test` + `magick`). `pnpm check` 1848, build, E2E 318/318.
- contre-revue (18/11/2026) : à corriger, non bloquant — périmètre de la fiche (mis à jour ci-dessus) ; `scripts/brand-assets.mjs` : `try/finally` (fermeture du navigateur, suppression du dossier temporaire) et garde sur les tracés trouvés. Notés sans action : coût de l'import de `container.ts` dans le layout racine (module léger = amendement ADR 0012, plus tard si besoin) ; URL de l'image de partage sans paramètre de version.
- security-auditor (18/11/2026) : à corriger — fichiers livrés sains ; test SVG contournable (préfixes d'espace de noms, `>` entre guillemets, `<?xml-stylesheet`, animations, échappements CSS/XML, attributs URL hors `href`, `src/app/` non parcouru). → test réécrit en liste blanche, sans dépendance.

- Clôture (18/11/2026, orchestrateur) : contre-audit **OK** (guillemets refusés dans les valeurs et `<style>` : 52 tests SVG) ; script `try/finally` + garde sur les tracés. Vérifié : `pnpm check` 1850/1850, `SITE_URL=https://localhost:3000 pnpm build` vert sans avertissement `metadataBase`, `pnpm test:e2e` 318/318.
