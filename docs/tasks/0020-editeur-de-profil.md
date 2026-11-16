# 0020 — Éditeur de profil avec aperçu en direct

- Statut : todo (après 0017 et 0018)
- Agent : frontend ; test-engineer (E2E)
- Phase : 2 (5/6)
- ADR liées : 0012, 0013

## Objectif
Depuis le tableau de bord, le propriétaire modifie ses informations et ses liens, voit l'aperçu mobile se mettre à jour pendant la saisie, enregistre, publie ou dépublie son profil.

## Périmètre de fichiers
- Autorisé (frontend) : `src/app/(dashboard)/tableau-de-bord/profil/**`, `src/app/(dashboard)/tableau-de-bord/page.tsx` (lien vers l'éditeur et vers la page publique), `src/ui/features/profile-editor/**`, `src/ui/primitives/**` (composants Shadcn nécessaires : `textarea`, `switch`… adaptés comme en 0012).
- Autorisé (test-engineer) : `tests/e2e/profile-editor.spec.ts`.
- Interdit : tout le reste.

## Décisions de conception
1. **Route** : `/tableau-de-bord/profil` ; Server Component qui revérifie la session et charge le profil (`getOwnProfile`), puis formulaire client feuille.
2. **Formulaire** : champs nom affiché, poste, entreprise, bio (compteur 500), e-mail public, téléphone, site web ; interrupteurs « Profil publié » et « Visible dans les moteurs de recherche » ; enregistrement par `updateProfileAction` (0017), messages français, mêmes règles d'accessibilité que 0008.
3. **Liens** : liste éditable (plateforme, URL, libellé facultatif), ajout, suppression, déplacement par boutons « monter / descendre » (accessibles au clavier, pas de glisser-déposer en phase 2), 12 au plus ; enregistrement de la liste entière par `replaceLinksAction`.
4. **Aperçu en direct** : la carte de profil de 0018 (`src/ui/features/profile`) rendue côté client à partir de l'état du formulaire, dans un cadre de largeur mobile ; sur petit écran, bascule « Modifier / Aperçu ».
6. Lien `whatsapp` ou téléphone : mention « ce numéro sera visible publiquement sur votre profil » (audit 0016). Les liens existants gardent leur `id` à l'enregistrement (0016, décision 8).
5. Le slug est affiché (lien vers la page publique), non modifiable.

## Critères d'acceptation
1. Modifier un champ met à jour l'aperçu sans enregistrement ; enregistrer puis recharger conserve la valeur ; la page publique la montre (0018).
2. Liens : ajout, réordonnancement, suppression enregistrés ; 13e lien impossible ; URL non `https://` refusée avec un message par champ.
3. Publier / dépublier : la page publique passe de 404 à 200 et inversement.
4. Sans session → redirection `/connexion` (page et action).
5. Accessibilité : labels, erreurs annoncées, ≥ 44 px, contrastes AA, ordre de tabulation logique.
6. `pnpm check`, `pnpm build`, E2E verts iOS et Android.

## Hors périmètre
- Téléversement d'images (0021), couleur d'accent, glisser-déposer, changement de slug.

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
