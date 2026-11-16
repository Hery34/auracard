# 0018 — Page profil publique `/p/{slug}`

- Statut : todo (après 0017)
- Agent : frontend ; test-engineer (E2E)
- Phase : 2 (3/6)
- ADR liées : 0013 (amendée : thème automatique sur la page publique)

## Objectif
Un visiteur qui scanne une carte voit en moins d'une seconde, sur mobile, le profil publié : photo ou initiales, nom, poste, entreprise, bio, bouton « Ajouter aux contacts », coordonnées et liens avec leur icône.

## Périmètre de fichiers
- Autorisé (frontend) : `src/app/(public)/p/[slug]/**`, `src/ui/features/profile/**` (carte de profil réutilisée par l'aperçu de l'éditeur, 0020), `src/ui/features/profile/icons/**` (SVG intégrés), `src/app/globals.css` (variables du thème clair).
- Autorisé (test-engineer) : `tests/e2e/public-profile.spec.ts`.
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
