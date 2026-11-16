# 0012 — Shadcn/ui et thème de la charte AuraCard

- Statut : done (16/11/2026)
- Validé par Hery (16/11/2026) : ajout de Shadcn/ui (point 1, versions exactes choisies par backend et consignées dans le rapport) ; police **Montserrat** via `next/font/google` (point 3, option b).
- Agent : backend (dépendances, `components.json`, fichiers racine) ; frontend (thème, migration des primitives, nom affiché) ; test-engineer (non-régression, contrastes)
- Phase : 1 (avant la phase 2 : éditeur et tableau de bord)
- ADR liées : à rédiger si Hery le souhaite (« bibliothèque de composants et thème ») — proposée : ADR 0013
- Référence : `docs/assets/charte_graphique_auracard.jpeg`

## Objectif
Les primitives `Button`, `Input` et `Field` reposent sur Shadcn/ui (convention Next.js de Hery) et l'interface applique la charte AuraCard (thème sombre, palette, police, nom commercial), sans régression d'accessibilité, avant que la phase 2 n'ajoute de nombreux composants.

## Périmètre de fichiers
- Autorisé (backend) : `package.json`, `pnpm-lock.yaml`, `components.json`.
- Autorisé (frontend) : `src/app/globals.css` (variables de thème), `src/app/layout.tsx` (police, `metadata.title`, nom affiché), `src/ui/primitives/**`, `src/ui/lib/**` (utilitaire `cn`, ADR 0013), `src/ui/features/auth/**` (nom affiché dans les messages et la mention, imports), et *(régularisé après revue)* `src/app/page.tsx`, `src/app/(auth)/**/page.tsx`, `src/app/(dashboard)/tableau-de-bord/page.tsx` (nom affiché, classes de thème).
- Point 2 (emplacements) validé par Hery le 16/11/2026 : ADR 0013. Point 4 : `--input` = gris de bordure (`#6B6B73`, Shadcn l'utilise comme couleur de bordure), fond des champs `bg-muted` (Ardoise). Critère 5 : +11,1 Ko gzip accepté par l'orchestrateur et le reviewer (dont 8,5 Ko pour `tailwind-merge`, ADR 0013), sous réserve de la piste `<label>` natif.
- Autorisé (test-engineer) : `tests/e2e/**` (ajout de vérifications de thème et de nom ; contrat de balisage de 0008 inchangé).
- Interdit : tout le reste. Le nom technique `carnet` (dépôt, schéma Supabase, registre `platform`, identifiants de code, noms de tâches `pg_cron`) **ne change pas**.

## Décisions de Hery (16/11/2026)
- **Nom commercial affiché : AuraCard** (interface, titres, e-mails à venir, mentions) ; `carnet` reste le nom technique.
- **Symbole de référence : les anneaux entrelacés** de la charte (pas le « C + clé » de `Logo_auracard.jpeg` et `favicon.jpeg`) ; logo et favicon traités en 0014.
- **Thème sombre par défaut.**
- **Charte intégrée dans cette fiche** (variables de thème Shadcn = palette de la charte).

## Décisions de conception (à valider par Hery)
1. **Dépendances** (arrêt obligatoire §2), versions exactes épinglées, la plus récente publiée depuis au moins deux semaines, compatibles React 19.3 et Tailwind 4.3 : `class-variance-authority`, `clsx`, `tailwind-merge`, et les primitives Radix nécessaires (`@radix-ui/react-slot`, `@radix-ui/react-label`) ou le paquet unifié `radix-ui` selon ce que la CLI génère. Pas de `lucide-react` tant qu'aucune icône n'est utilisée. La CLI `shadcn` est lancée par `pnpm dlx` (version exacte), **jamais** ajoutée aux dépendances. backend présente la liste exacte et les versions à Hery avant l'installation.
2. **Emplacements** : `components.json` avec alias `ui` → `@/ui/primitives` et `utils` → `@/ui/lib/utils`, pour respecter `docs/architecture.md` §3 (pas de dossier `components/` à la racine).
3. **Police** (arrêt) : la charte indique « Geometria / Modern Sans ». Geometria est une police commerciale (licence web payante, fichiers à auto-héberger). Options : (a) Hery fournit la licence et les fichiers `woff2`, chargés par `next/font/local` ; (b) alternative géométrique libre chargée par `next/font/google` (auto-hébergée au build, aucune requête vers Google à l'exécution), par exemple Montserrat ou Urbanist. Proposition : (b) Montserrat jusqu'à une éventuelle licence.
4. **Palette → variables Shadcn** (thème sombre uniquement, pas de bascule) :
   | Variable | Couleur de la charte |
   |---|---|
   | `--background` | Noir Carbone `#0A0A0C` |
   | `--card`, `--popover`, `--input`, `--muted` | Ardoise `#1E2022` |
   | `--foreground`, `--card-foreground` | Blanc Cassé `#FCFCFD` |
   | `--primary`, `--ring` | Vert Émeraude NFC `#00C896` |
   | `--primary-foreground` | Noir Carbone `#0A0A0C` |
   | `--muted-foreground` | gris à définir, contraste ≥ 4,5:1 sur Ardoise |
   | `--border` | gris à définir, contraste ≥ 3:1 sur Noir Carbone (bord de champ, WCAG 1.4.11) |
   | `--destructive` | rouge à définir, lisible sur Noir Carbone (messages d'erreur ≥ 4,5:1) |
5. **Contrastes (contrainte de la charte)** : émeraude sur Noir Carbone ≈ 9:1 (texte et liens OK) ; **texte blanc sur émeraude ≈ 2,1:1, interdit** → les boutons primaires ont un texte Noir Carbone sur émeraude ; l'émeraude n'est jamais utilisé comme couleur de texte sur fond clair.
6. **Migration** : `Button` et `Input` remplacés par les composants Shadcn (`button`, `input`, `label`) ; `Field` reste un composant maison qui assemble `Label` + `Input` + message d'erreur et conserve `aria-invalid`, `aria-describedby`, cibles ≥ 44 px et contraste AA (classes ajustées si les valeurs par défaut de Shadcn sont plus petites).
7. **Nom affiché** : « carnet » → « AuraCard » dans l'en-tête de `layout.tsx`, `metadata.title`, les messages (« rejoindre carnet » → « rejoindre AuraCard ») et la mention RGPD. Le logo n'est pas encore intégré (0014) : en-tête textuel « AURA » Blanc Cassé + « CARD » émeraude en attendant.
8. **`color-scheme: dark`** sur `html` (contrôles natifs, barres de défilement) et `<meta name="theme-color" content="#0A0A0C">`.

## Critères d'acceptation
1. `pnpm check`, `pnpm build` et `pnpm test:e2e` (iOS et Android) verts ; le contrat de balisage de 0008 (labels, boutons, `role="alert"`, `aria-*`) est inchangé.
2. Les pages `/inscription`, `/connexion`, `/verifier-email`, `/tableau-de-bord` s'affichent en thème sombre (fond `#0A0A0C`) ; titre de document et en-tête « AuraCard » ; plus aucune occurrence visible de « carnet » dans l'interface.
3. Contrastes vérifiés (test E2E ou audit axe/Lighthouse consigné) : texte courant, texte atténué, messages d'erreur ≥ 4,5:1 ; bordures de champs et anneau de focus ≥ 3:1 ; boutons primaires texte foncé sur émeraude.
4. Aucune dépendance sans version exacte ; `pnpm audit --prod` sans vulnérabilité ; aucun fichier hors des emplacements décidés au point 2 ; police servie depuis le domaine de l'application (aucune requête tierce à l'exécution, CSP inchangée).
5. Le poids JavaScript client de `/inscription` et `/connexion` ne dépasse pas de plus de 10 Ko gzip la mesure de 0008 (8,5 Ko gzip par page) ; écart justifié sinon.

## Règles applicables
`docs/rules/nextjs.md`, `docs/rules/solid-dry.md`, `docs/rules/security.md` (dépendances, CSP), `docs/rules/testing.md`.

## Hors périmètre
- Logo, symbole et favicon (0014). Thème clair et bascule. Thèmes des profils publics (`profiles.theme`, phase 2). Nouveaux composants (dialogue, menu, carte…) : ajoutés par les fiches de phase 2 qui en ont besoin.

## Définition de terminé
- [x] Liste des dépendances et versions validée par Hery ; police choisie (point 3)
- [x] Filet de non-régression confirmé par test-engineer (E2E 0008 verts avant migration) et tests de thème et de nom écrits, échouant avant implémentation
- [x] `pnpm check` vert ; `pnpm build` vert ; `pnpm test:e2e` vert
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK (dépendances, police auto-hébergée)
- [x] Aucune déviation d'architecture (sinon ADR validée par Hery)
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (16/11/2026) : filet 0008 vert (30/30) ; `theme.spec.ts` (thème sombre, AuraCard, `color-scheme`, `theme-color`, Montserrat, boutons texte foncé sur émeraude, contrastes texte ≥ 4,5:1 et bordures/focus ≥ 3:1, tableau de bord, polices servies par l'application sans requête Google), helper `contrast.ts` (couleurs peintes par le navigateur, oklch et alpha compris) ; `home.spec.ts` adapté à AuraCard (accord orchestrateur, conséquence de la décision de Hery). Après revue : focus d'un champ invalide et focus clavier du bouton primaire (`Alt+Tab` sous WebKit, boutons hors tabulation par défaut sur macOS ; vérifié aussi sur WebKit Linux). 28 puis 6 rouges avant implémentation.
- implémentation (backend, 16/11/2026) : `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.7.0, `@radix-ui/react-slot` 1.5.0 (le paquet unifié `radix-ui` retiré après audit), `components.json` (`radix-nova`, alias sous `@/ui`, `hooks` → `@/ui/lib/hooks`), CLI `shadcn` 4.23.0 par `pnpm dlx`. Paquet `cn` du registre écarté (0.x récent).
- implémentation (frontend, 16/11/2026) : `cn` (`twMerge(clsx())`), `Button` (`cva` + `Slot`, variantes `default`/`outline`, `type="button"` par défaut, ≥ 44 px, anneau de focus décalé sur le fond), `Input` (`text-base`, ≥ 44 px, focus visible même invalide), `<label>` natif, `Field` maison inchangé ; palette dans `:root` (`#A1A1AA` atténué 7,7:1, `#6B6B73` bordures 3,7:1, `#FF6B6B` erreurs 7,1:1, anneau émeraude à 70 % 4,9:1, texte foncé sur émeraude 9,1:1) ; Montserrat `next/font/google` ; titre `%s · AuraCard`, `themeColor`, `color-scheme: dark` ; « carnet » remplacé à l'écran. Poids JS gzip : `/inscription` 186,1 Ko, `/connexion` 186,0 Ko (+10,5 Ko par rapport à avant 0012, dont 8,5 Ko `tailwind-merge`, accepté, ADR 0013).
- reviewer (16/11/2026) : bloquant (dossier `src/ui/lib/` hors architecture) → levé par l'ADR 0013 validée par Hery. À corriger traités : focus des champs invalides, `type` par défaut, périmètre régularisé, justification du poids. Écarts 1 à 6 de frontend confirmés.
- security-auditor (16/11/2026) : **OK**. Versions exactes et anciennes de plus de 2 semaines, provenance SLSA, aucun script d'installation, aucun avis ; police auto-hébergée, CSP inchangée ; veille Next.js : 16.4.6 à jour. Faibles : surface de `radix-ui` (traité : `@radix-ui/react-slot` seul) ; règle des deux semaines à imposer par `minimumReleaseAge` de pnpm (à soumettre à Hery).
- vérification orchestrateur (16/11/2026) : `pnpm check` 289/289, `pnpm build` vert, `supabase test db` 549/549, intégration 26/26, `pnpm test:e2e` 66/66 (iOS et Android), `pnpm audit --prod` sans vulnérabilité.
