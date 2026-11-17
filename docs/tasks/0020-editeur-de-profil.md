# 0020 — Éditeur de profil avec aperçu en direct

- Statut : done (17/11/2026)
- Agent : frontend ; test-engineer (E2E)
- Phase : 2 (5/6)
- ADR liées : 0012, 0013

## Objectif
Depuis le tableau de bord, le propriétaire modifie ses informations et ses liens, voit l'aperçu mobile se mettre à jour pendant la saisie, enregistre, publie ou dépublie son profil.

## Périmètre de fichiers
- Autorisé (frontend) : `src/app/(dashboard)/tableau-de-bord/profil/**`, `src/app/(dashboard)/tableau-de-bord/page.tsx` (lien vers l'éditeur et vers la page publique), `src/ui/features/profile-editor/**`, `src/ui/primitives/**` (composants Shadcn nécessaires : `textarea`, `switch`… adaptés comme en 0012).
- Autorisé (test-engineer) : `tests/e2e/profile-editor.spec.ts`, `tests/e2e/helpers/profile-editor.ts`, tests unitaires des modules purs de `src/ui/features/profile-editor/`.
- Interdit : tout le reste.

## Décisions de conception
1. **Route** : `/tableau-de-bord/profil` ; Server Component qui revérifie la session et charge le profil (`getOwnProfile`), puis formulaire client feuille.
2. **Formulaire** : champs nom affiché, poste, entreprise, bio (compteur 500), e-mail public, téléphone, site web ; interrupteurs « Profil publié » et « Visible dans les moteurs de recherche » ; enregistrement par `updateProfileAction` (0017), messages français, mêmes règles d'accessibilité que 0008.
3. **Liens** : liste éditable (plateforme, URL, libellé facultatif), ajout, suppression, déplacement par boutons « monter / descendre » (accessibles au clavier, pas de glisser-déposer en phase 2), 12 au plus ; enregistrement de la liste entière par `replaceLinksAction`.
4. **Aperçu en direct** : la carte de profil de 0018 (`src/ui/features/profile`) rendue côté client à partir de l'état du formulaire, dans un cadre de largeur mobile ; sur petit écran, bascule « Modifier / Aperçu ».
5. Le slug est affiché (lien vers la page publique), non modifiable.
6. Lien `whatsapp` ou téléphone : mention « ce numéro sera visible publiquement sur votre profil » (audit 0016). Les liens existants gardent leur `id` à l'enregistrement (0016, décision 8).
7. *(abandonnée, voir décision 11)* *Report de la revue 0018* : l'aperçu rend `ProfileCard` côté client → typer `vcardHref` brouillé dans le modèle de vue (`ScrambledText`, comme le téléphone et l'e-mail), pour que `/v/{slug}` ne passe jamais en clair dans les données RSC.

8. *Arbitrage de l'orchestrateur (17/11/2026)* : pas de nouvelle dépendance — interrupteurs en `<input type="checkbox" role="switch">` natifs stylés (pas de `@radix-ui/react-switch`), `textarea` natif stylé comme les primitives existantes. Toute dépendance supplémentaire serait soumise à Hery.
9. Contrats de 0017 à utiliser : `getOwnProfile` (profil complet et liens avec `id` et position), `updateProfileAction`, `replaceLinksAction` (liste complète en JSON dans le champ `links`, `id` de chaque lien existant transmis, liens enregistrés renvoyés avec leurs `id`), messages d'erreur par champ.

10. *Contrat de test-engineer retenu (17/11/2026)* : un seul bouton « Enregistrer » (profil puis liens, `updateProfileAction` puis `replaceLinksAction`) ; `<select>` natif pour la plateforme ; libellés, messages et rôles figés en tête de `tests/e2e/profile-editor.spec.ts`. Échec partiel (profil enregistré, liens refusés) : message par champ sur les liens, profil conservé ; à documenter.

11. *Après implémentation (17/11/2026, arbitrages de l'orchestrateur)* :
   - **Bio** : le navigateur envoie les sauts de ligne d'un `FormData` en `\r\n` (spécification HTML) → le schéma `bio` de `src/server/actions/profile-schemas.ts` normalise `\r\n?` en `\n` **avant** la borne de 500 (backend).
   - **Session expirée pendant une Server Action** : `src/proxy.ts` ne redirige pas les requêtes portant l'en-tête `Next-Action` ; l'action renvoie `unauthenticated` (elle revérifie toujours la session, le proxy n'est qu'un confort) et l'éditeur redirige vers `/connexion` (backend).
   - **Décision 7 abandonnée** : l'éditeur ne transmet au client que le slug, le modèle de vue est construit dans le navigateur ; le test E2E prouve que `/v/{slug}` n'apparaît jamais en clair dans le HTML ni le RSC. Typer `vcardHref` en `ScrambledText` n'apporterait rien.
   - **Échec partiel** : profil enregistré, liens refusés → alerte « Vérifiez les champs signalés. Vos informations ont été enregistrées, mais pas vos liens. », erreurs sur les liens, saisie conservée.

12. *Après revue et audit (17/11/2026)* : repli de l'éditeur sur erreur levée (réseau, erreur serveur, action introuvable après redéploiement) → alerte `unexpected`, saisie conservée, **sans** `router.refresh()` ; proxy : exception limitée aux `POST` portant `Next-Action` ; liste des plateformes à numéro public définie une seule fois (`ReadonlySet<LinkPlatform>`, partagée par la carte et l'éditeur) ; aperçu `inert` (pas de téléchargement de la vCard publiée ni de navigation depuis l'aperçu) ; attributs `name` inutiles retirés si aucun test ne s'en sert ; échec partiel vérifié en E2E (alerte complète, profil écrit en base, saisie conservée).

## Critères d'acceptation
1. Modifier un champ met à jour l'aperçu sans enregistrement ; enregistrer puis recharger conserve la valeur ; la page publique la montre (0018).
2. Liens : ajout, réordonnancement, suppression enregistrés ; 13e lien impossible ; URL non `https://` refusée avec un message par champ.
3. Publier / dépublier : la page publique passe de 404 à 200 et inversement, **y compris quand le 404 était déjà en cache** (critère 5 de 0018, reporté ici) ; une modification enregistrée apparaît sur `/p/{slug}` et dans `/v/{slug}`.
4. Sans session → redirection `/connexion` (page et action).
5. Accessibilité : labels, erreurs annoncées, ≥ 44 px, contrastes AA, ordre de tabulation logique.
6. `pnpm check`, `pnpm build`, E2E verts iOS et Android.

## Hors périmètre
- Téléversement d'images (0021), couleur d'accent, glisser-déposer, changement de slug.

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `pnpm check` vert ; `pnpm build` vert ; `pnpm test:e2e` vert
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (17/11/2026) : `profile-editor.spec.ts` (23 tests × iOS/Android : accès et contournement du proxy, aperçu en direct et bascule, champs et erreurs par champ, liens au clavier avec `id` conservés vérifiés en base, idempotence, 12 liens au plus, publication d'un profil dont le 404 était en cache → 200, modification visible sur `/p` et `/v`, dépublication, accessibilité et contrastes ; après revue : échec partiel complet, aperçu `inert`) ; tests unitaires des modules de l'éditeur (`editor-state`, `link-list`, `serialize`, `messages`), `proxy.test.ts` (premier test du proxy), bio normalisée, `routes.test.ts`. 42/46 rouges avant implémentation ; tests de non-régression signalés.
- implémentation : frontend (page Server Component, formulaire client feuille, primitives natives `textarea`/`select`/`switch` sans dépendance, aperçu par la carte de 0018 rendu `inert`, conservation des `id` par `withSavedIds`, échec partiel, liste unique des plateformes à numéro public, `Field` avec `name` facultatif si `id`) ; backend (bio `\r\n` → `\n` avant la borne, proxy laissant passer les `POST` `Next-Action`).
- reviewer (17/11/2026) : à corriger, non bloquant ; traités : repli sur erreur sans `router.refresh()`, test de l'échec partiel, numérotation de la fiche ; aperçu `inert`, `ReadonlySet`, `name` retirés. Accepté : abandon de la décision 7. Reportés : `SelectField` au 2e `<select>`, `blankToNull` à garder aligné avec le schéma.
- security-auditor (17/11/2026) : **OK** ; exception `Next-Action` sans risque (chaque action et chaque page revérifient la session) ; faibles traités (exception limitée à `POST`, source unique des plateformes à numéro, commentaire). Veille : 16.4.6 à jour.
- vérification orchestrateur (17/11/2026) : `pnpm check` 845/845, intégration 49/49, build vert, E2E 194/194 (iOS et Android).
