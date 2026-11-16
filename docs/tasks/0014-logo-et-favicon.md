# 0014 — Logo et favicon AuraCard

- Statut : blocked (fichiers vectoriels à fournir par Hery)
- Agent : frontend ; test-engineer (E2E)
- Phase : 1 (après 0012)
- ADR liées : —
- Référence : `docs/assets/charte_graphique_auracard.jpeg` (symbole aux anneaux entrelacés, décision de Hery du 16/11/2026)

## Objectif
L'en-tête affiche le bloc-marque AuraCard et l'onglet du navigateur, l'écran d'accueil mobile et les partages affichent le symbole, nets à toutes les tailles.

## Fichiers à fournir par Hery (bloquant)
Les fichiers de `docs/assets/` sont des JPEG (fond noir, pas de transparence, compression) : inutilisables tels quels pour un logo net ou un favicon. Il faut, de préférence depuis l'outil de la personne qui a dessiné la charte :
1. Bloc-marque horizontal (symbole + « AURACARD ») en **SVG**, fond transparent, texte vectorisé.
2. Symbole seul en **SVG**, fond transparent.
3. Symbole dans un carré arrondi Ardoise et dans un cercle émeraude (déclinaisons de la charte), en SVG ou PNG 1024 × 1024.
À défaut, frontend peut redessiner le symbole en SVG d'après la charte, à valider visuellement par Hery (risque d'écart avec l'original).

## Périmètre de fichiers
- Autorisé (frontend) : `public/brand/**`, `src/app/icon.svg`, `src/app/apple-icon.png`, `src/app/favicon.ico` (remplacement), `src/app/manifest.ts`, `src/app/opengraph-image.png`, `src/app/layout.tsx` (en-tête), `src/ui/primitives/logo.tsx`.
- Autorisé (test-engineer) : `tests/e2e/**`.
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
- [ ] Fichiers vectoriels fournis par Hery (ou redessin validé)
- [ ] Tests écrits par test-engineer, échouant avant implémentation
- [ ] `pnpm check` vert ; `pnpm build` vert ; `pnpm test:e2e` vert
- [ ] reviewer : OK ou remarques non bloquantes traitées
- [ ] security-auditor : OK
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer : …
- implémentation : …
- reviewer : …
- security-auditor : …
