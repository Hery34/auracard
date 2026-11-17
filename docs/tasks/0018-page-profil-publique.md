# 0018 — Page profil publique `/p/{slug}`

- Statut : done (17/11/2026)
- Agent : frontend ; test-engineer (E2E)
- Phase : 2 (3/6)
- ADR liées : 0013 (amendée : thème automatique sur la page publique)

## Objectif
Un visiteur qui scanne une carte voit en moins d'une seconde, sur mobile, le profil publié : photo ou initiales, nom, poste, entreprise, bio, bouton « Ajouter aux contacts », coordonnées et liens avec leur icône.

## Périmètre de fichiers
- Autorisé (frontend) : `src/app/(public)/p/[slug]/**`, `src/ui/features/profile/**` (carte de profil réutilisée par l'aperçu de l'éditeur, 0020), `src/ui/features/profile/icons/**` (SVG intégrés), `src/app/globals.css` (variables du thème clair).
- Autorisé (test-engineer) : `tests/e2e/public-profile.spec.ts`, `tests/e2e/helpers/public-profile.ts`.
- Interdit : tout le reste.

## Décisions de conception
1. **Thème** (décision de Hery, 16/11/2026) : la page suit `prefers-color-scheme` du visiteur, accent émeraude AuraCard. Thème sombre = palette de 0012 ; thème clair = fond Blanc Cassé `#FCFCFD`, texte Noir Carbone, **émeraude assombri pour le texte et les liens** (l'émeraude `#00C896` sur blanc ne fait que 2,1:1) ; boutons émeraude à texte foncé dans les deux thèmes. Contrastes AA mesurés dans les deux thèmes. L'application (inscription, tableau de bord) reste en sombre seul.
2. **Rendu** : statique avec revalidation par tag `profile:<slug>` (`docs/architecture.md` §5.2) ; aucune lecture de cookies ; profil non publié ou inexistant → 404 identique (pas d'énumération).
3. **Icônes** : SVG intégrés d'après Simple Icons (CC0) pour les 10 plateformes de 0016, `aria-hidden`, nom accessible porté par le lien ; liens externes `rel="noopener noreferrer"`, `target="_blank"`.
4. **Référencement** : `noindex` sauf `is_indexable` ; métadonnées Open Graph (nom, poste, image si présente) ; `lang="fr"`.
5. **Avatar** : photo si présente (0021), sinon initiales sur fond émeraude.
6. **Navigateurs intégrés** (LinkedIn, Instagram, Facebook…) : message invitant à ouvrir dans le navigateur avant de télécharger la vCard (§5.3), détecté côté client.
8. *Exigences de l'audit 0016* : `url` et `label` sont des données non fiables (écriture directe possible par PostgREST) → revalider `protocol === 'https:'` à l'affichage, `rel="noopener noreferrer nofollow ugc"`, jamais de HTML construit à la main, hôte affiché en punycode s'il est montré en clair ; liens `whatsapp` et téléphone : même protection contre l'aspiration (numéro assemblé côté client au clic, pas de `wa.me/<numéro>` dans le HTML statique, `docs/rules/security.md`).
7. Aucune donnée non publiée dans le HTML ; pas de statistiques (phase 4) ni de formulaire de contact.

9. *Arbitrages de l'orchestrateur sur le contrat de test-engineer (17/11/2026)* : l'**e-mail** suit la même protection que le téléphone (pas de `mailto:` ni d'adresse dans le HTML statique, `docs/rules/security.md`) ; initiales sur émeraude `#00C896` dans les deux thèmes (texte foncé) ; site du profil : `rel="noopener noreferrer"` (`nofollow ugc` réservé aux liens de plateformes) ; révélation au clic observable (`<a href>` inséré ou `window.open`, pas une simple affectation de `location.href`). **Critère 5 (revalidation après modification) reporté en 0020** (aucune Server Action déclenchable sans l'éditeur) ; l'appel `updateTag` est couvert par les tests unitaires de 0017. Revalidation de `https:` à l'affichage : test unitaire d'une fonction pure de `src/ui/features/profile`.

10. *Après revue et audit (17/11/2026)* :
   - **Périmètre étendu** (accepté par la revue) : `src/app/layout.tsx`, `src/app/(auth)/layout.tsx`, `src/app/(dashboard)/layout.tsx` (nouveau), `src/app/page.tsx`, `src/ui/features/app-shell/app-header.tsx` (en-tête de l'application retiré de la page publique, décision de l'orchestrateur) ; `tests/e2e/helpers/accounts.ts` (adresse par test).
   - **Décision de Hery : lien de la vCard construit au clic** côté client (plus de `href="/v/{slug}"` dans le HTML statique, même mécanisme que les contacts) ; `src/app/robots.ts` avec `Disallow: /v/`. test-engineer adapte le test « bouton vCard » (autorisé par cette décision).
   - E-mail revalidé à l'affichage (format strict, refus de `?`, `&`, `/`, `:`), sinon non affiché ; avatar de l'Open Graph par `safeHttpsHref` seul (sans `toProfileCardView`).
   - **Décision de Hery : croissance du cache des 404** (slugs aléatoires) traitée au déploiement : limite de débit Traefik sur `/p/` et `/v/` et cache Next.js borné — **préalable à la mise en production** (fiche déploiement).
   - **Décision de Hery : CSP sans nonce** (compatible avec le rendu statique) + ADR consignant l'écart à la règle « nonces » — fiche dédiée avant la production.
   - Reportés : table `ICON_BY_PLATFORM` (ouvert/fermé), fidélité des tracés Simple Icons à vérifier en recette.

## Critères d'acceptation
1. Profil publié : tous les éléments visibles, liens dans l'ordre, icône par plateforme, bouton vCard vers `/v/{slug}`.
2. Profil non publié et slug inexistant → même 404, aucune donnée.
3. Contrastes AA mesurés en thème clair et sombre (`colorScheme` émulé par Playwright).
4. `noindex` présent par défaut, absent si `is_indexable`.
5. Après une modification par le propriétaire, la page publique affiche la nouvelle valeur (revalidation par tag).
6. `pnpm check`, `pnpm build` (route statique ou ISR), E2E verts iOS et Android.

## Règles applicables
`docs/rules/nextjs.md`, `docs/rules/security.md`, `docs/rules/testing.md`.

## Hors périmètre
- Couleur d'accent choisie par l'utilisateur, statistiques, contact, rendez-vous.

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `pnpm check` vert ; `pnpm build` vert ; `pnpm test:e2e` vert
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (17/11/2026) : `public-profile.spec.ts` (contenu, liens et icônes, contacts absents du HTML puis révélés au clic, 404 sans énumération, contrastes en clair et en sombre, `noindex`, Open Graph, navigateurs intégrés, rendu statique ; après revue : bouton vCard sans `/v/` avant clic, téléchargement au clic, un clic = une requête comptée, `robots.txt`, e-mail piégé non révélé), helpers `public-profile.ts` ; tests unitaires de `safe-href`, `safe-email`, `scrambled-text`, `initials`, `in-app-browser`, `profile-card-view`, et câblage du conteneur public. Échecs vérifiés ; tests de non-régression signalés comme tels.
- implémentation (frontend, 17/11/2026) : page `/p/[slug]` (SSG + tag `profile:<slug>` via le lecteur en cache de 0019, 404 identique), carte réutilisable, avatar ou initiales, icônes SVG des 10 plateformes (tracés Simple Icons dessinés de mémoire : fidélité à vérifier en recette), contacts et lien vCard brouillés et assemblés au clic, message pour navigateurs intégrés, thème clair/sombre automatique (`#007A5C` pour les liens en clair), `robots.ts`, en-tête de l'application déplacé hors de la page publique ; initiales limitées aux mots commençant par une lettre.
- reviewer (17/11/2026) : à corriger, non bloquant ; périmètre étendu consigné, tag partagé, avatar Open Graph ; vérification ciblée : **OK**. Report : `vcardHref` brouillé dans le modèle de vue (0020).
- security-auditor (17/11/2026) : à corriger, non bloquant ; aucune fuite, pas d'énumération ; arbitrages de Hery (lien vCard au clic, limite Traefik et cache borné avant production, CSP sans nonce + ADR) ; vérification ciblée : **OK**. Veille : 16.4.6 à jour, avis de novembre sur `"use cache"` non applicables.
- vérification orchestrateur (17/11/2026) : `pnpm check` 810/810, intégration 49/49, build vert (`/p/[slug]` ●, `/robots.txt` ○, `/v/[slug]` ƒ), E2E 146/146 (iOS et Android).
