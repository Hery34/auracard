# 0026 — Générateur de QR code

- Statut : tests (lot A ; lot B bloqué jusqu au 25/11/2026)
- Agent : backend (dépendance `uqr`, variable `QR_PRINT_READY`, domaine, cas d'usage, dépôt, Server Action) ; frontend (page, rendu, export) ; test-engineer
- Phase : 3 (3/3)
- ADR liées : 0011, 0012, 0013 ; fiches 0021 (logo), 0024 (schéma), 0025 (`/q/{code}`)

## Objectif
Le propriétaire voit son QR code (`/q/{code}`), choisit ses couleurs (contraste minimal vérifié), ajoute le logo de son profil au centre et le télécharge en SVG et PNG.

## Périmètre de fichiers
- Autorisé :
  - backend : `package.json` / `pnpm-lock.yaml` (`uqr` en version exacte), `src/server/infrastructure/env.ts` (+ `.env.example`), `src/domain/qr/`, `src/server/use-cases/` (QR), `src/server/repositories/` (QR), `src/server/actions/qr*.ts`, `src/server/container.ts`, `src/domain/shared/rate-limits.ts` si nécessaire ;
  - frontend : `src/app/(dashboard)/tableau-de-bord/qr/`, lien depuis `src/app/(dashboard)/tableau-de-bord/page.tsx`, `src/ui/features/qr/` ;
  - test-engineer : tests correspondants, `tests/`.
- Aucune migration : `ensure_qr_code`, `set_qr_style`, `resolve_qr_code` existent (0024).
- Interdit : tout le reste.

## Décisions de conception (validées par Hery, 17/11/2026)
1. **Page `/tableau-de-bord/qr`**, liée depuis le tableau de bord. Le QR est créé au premier affichage par `ensure_qr_code` (idempotent) côté serveur.
2. **Contenu** : `${SITE_URL}/q/{code}` ; le code est stable, indépendant du slug.
3. **Rendu** : `uqr` (version exacte épinglée) calcule la matrice ; dessin SVG dans `src/ui/features/qr/` ; aperçu en direct au changement de couleur, avant enregistrement. Contrôle des couleurs en fonction pure dans `src/domain/qr/` (sans dépendance).
4. **Couleurs** : modules foncés sur fond clair obligatoires (luminance relative `fg` < `bg`) et contraste WCAG ≥ 4,5:1. Vérifié par le domaine, appliqué par la Server Action ; l'aperçu signale la règle non respectée et l'enregistrement est refusé.
5. **Logo** : `logo_url` du profil (0021) uniquement ; sans logo, l'option est désactivée avec renvoi vers l'éditeur de profil. Correction d'erreur **H** avec logo, **M** sans. Logo ≤ 20 % du côté du QR, posé sur un carré de la couleur de fond.
6. **Export dans le navigateur**, rien de stocké côté serveur : SVG autonome (logo intégré en `data:`), PNG 1024 px par canvas. Noms `carnet-qr-{code}.svg` et `carnet-qr-{code}.png`.
7. **Enregistrement du style** : Server Action → `set_qr_style`, limite `profile-write` existante. Compte sans profil ou hors projet (42501) → `no_profile`. Style invalide (22023) → `invalid`. Rejouer un style identique : succès sans écriture.
8. **Domaine provisoire** : tant que `QR_PRINT_READY` n'est pas `true` (absente par défaut), la page affiche en permanence « Domaine provisoire : n'imprimez pas ce QR code. ».

## Critères d'acceptation
1. Étant donné un membre avec profil, quand il ouvre `/tableau-de-bord/qr`, alors il voit un QR qui encode `${SITE_URL}/q/{code}` ; deux ouvertures donnent le même code.
2. Couleurs claires sur fond foncé, ou contraste < 4,5:1 → refusées (domaine, action) et signalées dans l'aperçu.
3. Avec logo : correction H, logo ≤ 20 % du côté ; sans `logo_url` : option désactivée.
4. Export SVG autonome et PNG 1024 px, noms conformes.
5. Sans session → redirection vers `/connexion` (proxy) ; l'action vérifie elle-même la session et l'appartenance.
6. `QR_PRINT_READY` absente → avertissement visible ; `true` → absent.
7. Un utilisateur d'un autre projet de l'instance n'accède à aucun QR (`no_profile`).
8. Accessibilité : QR avec alternative textuelle (URL encodée), champs de couleur étiquetés, cibles ≥ 44 px.

## Règles applicables
`docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`, `docs/rules/nextjs.md`, `docs/rules/solid-dry.md`

## Hors périmètre
Choix du domaine définitif, plusieurs QR par profil, statistiques de scan (phase 4), logo autre que `logo_url`.

## Définition de terminé
- [ ] Tests écrits par test-engineer, échouant avant implémentation
- [ ] `pnpm check`, intégration, build, E2E verts
- [ ] reviewer : OK ou remarques non bloquantes traitées
- [ ] security-auditor : OK
- [ ] Aucune déviation d'architecture (sinon ADR validée par Hery)
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
1. *Découpage (17/11/2026, validé par Hery)* : `uqr@0.1.3` (MIT, sans dépendance, publié le 03/04/2026) ne peut pas être installé avant le 25/11/2026. Le lockfile du 16/11 contient des versions de moins de 14 jours (next 16.4.6 et `@next/swc-*` du 09/11, tailwindcss et `@tailwindcss/oxide` 4.3.5 du 06/11, vite 8.3.8 et rolldown 1.2.19 du 11/11) : toute nouvelle résolution est refusée par `minimumReleaseAge`. Un override de vite ne suffit pas, car vite est une dépendance pair installée automatiquement, et sa variante en dépendance directe retire en silence les binaires de Next et de Tailwind du lockfile. Aucune exception à la règle.
   - **Lot A (maintenant)** : domaine `src/domain/qr/` (URL `${SITE_URL}/q/{code}`, règle foncé sur clair et contraste ≥ 4,5:1, niveau de correction M/H selon le logo, taille du logo ≤ 20 %) ; `QR_PRINT_READY` dans `env.ts` (fait) ; cas d'usage, dépôt (`ensure_qr_code`, `set_qr_style`), Server Action ; page `/tableau-de-bord/qr` (URL encodée, couleurs, case logo, avertissement, retour des erreurs) et lien depuis le tableau de bord. Critères 1 (sans rendu de l'image), 2, 3 (règles et case logo), 5, 6, 7, 8.
   - **Lot B (à partir du 25/11/2026)** : installation de `uqr@0.1.3`, dessin SVG avec logo, aperçu en direct, export SVG et PNG. Critères 1 (image), 3 (logo dessiné), 4.
   - À traiter à part : `docs/rules/nextjs.md` (« dernière version corrigée ») contredit `minimumReleaseAge` (14 jours) ; les deux règles ne peuvent pas être respectées en même temps lors d'un correctif de sécurité de Next.js.
2. *Contrat de test-engineer retenu (17/11/2026, arbitrages de l'orchestrateur)* : contrats figés en tête des fichiers de test (`src/domain/qr/{contrast,qr-style,qr-url,ports}.ts`, `makeGetOwnQrCode`, `makeSaveQrStyle`, `makeSupabaseQrCodeRepository`, `saveQrStyleAction`, container, page). 162 tests unitaires, 13 d'intégration et 11 E2E nouveaux, cohérents avec une implémentation de référence jetable. Arbitrages acceptés : refus du domaine renvoyé avec la règle précise (`invalid_color`, `not_darker`, `low_contrast`), `invalid` réservé au code 22023 ; couleurs vérifiées avant la session (aucun appel) ; `logo: true` accepté sans `logo_url` (case désactivée dans la page, dessin du lot B conditionné aux deux) ; `getOwnQrCode` lit le profil (`logoUrl`) et répond `no_profile` sans appeler `ensure_qr_code`. `uqr` reste dans `src/ui/features/qr/` (décision 3), donc pas d'extension de la règle ESLint du domaine. `QR_PRINT_READY=true` couvert par le seul test d'env.
3. *Lot A livré (17/11/2026)* : backend (domaine `src/domain/qr/`, dépôt, cas d'usage, action, `qrPrintReady` exposé par le container car la page ne peut pas importer `env`, ADR 0012) ; frontend (page `/tableau-de-bord/qr`, case logo native car le `Switch` porte `role="switch"`, logo retiré du profil → case décochée et désactivée). Vérification : `pnpm check` 1704, intégration 119, build, E2E 278/278. reviewer **OK**, security-auditor **OK**. Suggestions non traitées, à reconsidérer au lot B ou plus tard : `.max(7)` sur `fg`/`bg` dans `qr-schemas.ts` ; 42501 traduit par le dépôt QR (`no_profile`) et non par le cas d'usage (le dépôt NFC renvoie `not_member`) ; `isQrStyle` et `isQrCode` à ranger dans `src/domain/qr/` ; séquence « session → profil propre » présente trois fois (variantes différentes, statu quo défendable) ; alerte d'erreur visible jusqu'à la soumission suivante.
