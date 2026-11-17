# 0019 — vCard `/v/{slug}`

- Statut : done (17/11/2026)
- Agent : backend (sérialisation vCard, cas d'usage) ; frontend (route handler) ; test-engineer
- Phase : 2 (4/6)
- ADR liées : —

## Objectif
« Ajouter aux contacts » télécharge une vCard 3.0 que les carnets d'adresses iOS et Android importent correctement.

## Périmètre de fichiers
- Autorisé (backend) : `src/domain/profile/vcard.ts` (sérialiseur pur), `src/server/use-cases/get-vcard.ts`, `src/server/container.ts`, `src/server/infrastructure/env.ts` (`SITE_URL`), `src/domain/shared/rate-limits.ts` (portée `vcard`), `playwright.config.ts` et `.github/workflows/ci.yml` (`SITE_URL` de test).
- Autorisé (frontend) : `src/app/(public)/v/[slug]/route.ts`.
- Autorisé (test-engineer) : `src/domain/profile/vcard.test.ts`, `src/server/use-cases/get-vcard.test.ts`, `tests/e2e/vcard.spec.ts`, `tests/e2e/helpers/vcard.ts`.
- Interdit : tout le reste.

## Décisions de conception
1. **vCard 3.0** (`docs/architecture.md` §5.3) : `BEGIN`, `VERSION:3.0`, `N`, `FN`, `ORG`, `TITLE`, `EMAIL;TYPE=INTERNET`, `TEL;TYPE=CELL`, `URL` (site, puis profil public), `NOTE` (bio), `PHOTO;ENCODING=b;TYPE=JPEG` (après 0021, taille réduite), `END`.
2. **Encodage** : UTF-8, fins de ligne CRLF, échappement de `\`, `,`, `;` et des sauts de ligne (`\r\n`, `\r` et `\n` isolés), caractères de contrôle retirés (règle valable aussi si des liens entrent plus tard dans la vCard), pliage des lignes à 75 octets sans couper un caractère multioctet. Fonction pure, testée sur des cas accentués, emoji et champs vides.
3. **Réponse** : `Content-Type: text/vcard; charset=utf-8`, `Content-Disposition: attachment; filename="<slug>.vcf"`, mêmes en-têtes de sécurité, cache revalidé par le tag `profile:<slug>` ; profil non publié → 404.
4. **Nom** : `N` dérivé de `display_name` (tout le nom dans le champ « nom » si on ne peut pas séparer prénom et nom de façon fiable).

5. *Décisions de Hery (17/11/2026)* :
   - **`SITE_URL`** : variable serveur validée par Zod dans `env.ts` (`https://` obligatoire en production, `http://localhost:3000` accepté hors production) ; sert à l'`URL` du profil public dans la vCard (jamais l'en-tête `Host`, la réponse étant mise en cache). Hery l'ajoute à `.env.local` et `.env.example` (écriture `.env*` interdite aux agents) ; CI et Playwright reçoivent une valeur de test. Domaine définitif à choisir (gravé dans les puces).
   - **Limitation de débit** du téléchargement : portée `vcard`, 30 par heure et par adresse (table de 0009, adresse comme à l'inscription). Conséquence : le gestionnaire de route reste **dynamique** (contrôle à chaque requête) ; seule la **lecture du profil** est mise en cache sous le tag `profile:<slug>`. Dépassement → 429 sans contenu.
6. Contrats figés par test-engineer (en tête de `vcard.test.ts` et `get-vcard.test.ts`) : `serializeVCard(profile, { profileUrl })`, `makeGetVCard({ publicProfiles, profileUrl })`, `PublicContainer.getVCard`. URL non échappées (type uri) : à vérifier en recette réelle (phase 5).

7. *Après revue et audit (17/11/2026)* :
   - **Périmètre étendu** (accepté par la revue) : `src/server/use-cases/download-vcard.ts`, `src/server/repositories/cached-public-profile-reader.ts`, `src/server/infrastructure/request-client-address.ts` (calcul d'adresse extrait, partagé avec l'inscription), `src/server/actions/auth.ts`, et les tests `download-vcard.test.ts`, `cached-public-profile-reader.test.ts`, `container-public.test.ts`, `env-site-url.test.ts`.
   - Réponses de `/v/` (200, 404, 429, 500) : `Cache-Control: private, no-store` et `X-Robots-Tag: noindex, nofollow` (décision de Hery).
   - `websiteUrl` revalidé par `parseHttpsUrl` avant sérialisation (défense en profondeur).
   - Tag de cache défini une seule fois (`profileCacheTag(slug)` dans `src/server/`), utilisé par l'action et le lecteur en cache.
   - `downloadVCard(slug, headers)` reçoit les en-têtes de la requête (le conteneur ne lit plus `next/headers`) ; `PublicContainer.getVCard` retiré s'il n'a pas d'usage hors tests (contrat de test à adapter, autorisé).
   - **`SITE_URL` en local** : laisser `SITE_URL` absent de `.env.local` pour `pnpm dev` (défaut `http://localhost:3000`) ; pour `pnpm build`/`pnpm start` (mode production), la fournir en `https://` par l'environnement ou `.env.production.local` (ex. `https://localhost:3000`).
   - Dette notée : `unstable_cache` est l'API héritée de Next 16 ; une migration vers `"use cache"` exigerait `cacheComponents` (décision structurelle, fiche dédiée).

## Critères d'acceptation
1. Unitaires : sortie exacte attendue pour un profil complet, minimal, accentué et avec des caractères à échapper ; aucune ligne de plus de 75 octets.
2. E2E : `GET /v/{slug}` d'un profil publié → 200, en-têtes attendus, contenu analysable ; non publié → 404.
3. `pnpm check`, `pnpm build`, E2E verts.

## Hors périmètre
- vCard 4.0, QR code de la vCard, statistiques de téléchargement (phase 4).

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `pnpm check` vert ; `pnpm test:e2e` vert
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (17/11/2026) : contrats figés ; `vcard.test.ts` (sortie exacte, échappement, contrôles, pliage à 75 octets par point de code), `get-vcard.test.ts` (dont `websiteUrl` non https retiré), `vcard.spec.ts` (en-têtes, 404, rejeu, limite 30/h → 429 sans contenu, `no-store`/`noindex`), renforcement des tests de backend (cache, `SITE_URL`, tag partagé, en-têtes passés au conteneur).
- implémentation (backend, 17/11/2026) : sérialiseur pur, `get-vcard`, `download-vcard` (limite avant lecture), lecteur en cache `unstable_cache` tagué (échecs non mis en cache), `profileCacheTag`, calcul d'adresse extrait, `SITE_URL` (Zod, https en production), conteneur public paresseux pour `service_role`, sans `next/headers` ; frontend : route `/v/[slug]` (429/404/500 sans contenu, `no-store`, `noindex`).
- reviewer et security-auditor : voir fiche 0018 (revue commune), **OK** après corrections. Dette : `unstable_cache` (API héritée de Next 16).
- vérification orchestrateur : voir fiche 0018.
