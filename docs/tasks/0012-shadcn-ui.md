# 0012 — Shadcn/ui et thème de la charte AuraCard

- Statut : todo (dépendances et police à valider par Hery avant installation)
- Agent : backend (dépendances, `components.json`, fichiers racine) ; frontend (thème, migration des primitives, nom affiché) ; test-engineer (non-régression, contrastes)
- Phase : 1 (avant la phase 2 : éditeur et tableau de bord)
- ADR liées : à rédiger si Hery le souhaite (« bibliothèque de composants et thème ») — proposée : ADR 0013
- Référence : `docs/assets/charte_graphique_auracard.jpeg`

## Objectif
Les primitives `Button`, `Input` et `Field` reposent sur Shadcn/ui (convention Next.js de Hery) et l'interface applique la charte AuraCard (thème sombre, palette, police, nom commercial), sans régression d'accessibilité, avant que la phase 2 n'ajoute de nombreux composants.

## Périmètre de fichiers
- Autorisé (backend) : `package.json`, `pnpm-lock.yaml`, `components.json`.
- Autorisé (frontend) : `src/app/globals.css` (variables de thème), `src/app/layout.tsx` (police, `metadata.title`, nom affiché), `src/ui/primitives/**`, `src/ui/lib/**` (utilitaire `cn`), `src/ui/features/auth/**` (nom affiché dans les messages et la mention, imports).
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
- [ ] Liste des dépendances et versions validée par Hery ; police choisie (point 3)
- [ ] Filet de non-régression confirmé par test-engineer (E2E 0008 verts avant migration) et tests de thème et de nom écrits, échouant avant implémentation
- [ ] `pnpm check` vert ; `pnpm build` vert ; `pnpm test:e2e` vert
- [ ] reviewer : OK ou remarques non bloquantes traitées
- [ ] security-auditor : OK (dépendances, police auto-hébergée)
- [ ] Aucune déviation d'architecture (sinon ADR validée par Hery)
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer : …
- implémentation : …
- reviewer : …
- security-auditor : …
