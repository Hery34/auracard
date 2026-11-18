# 0029 — Collecte des statistiques

- Statut : done
- Agent : backend (cas d'usage, adaptateur, route `/api/beacon`, instrumentation `/t`, `/q`, `/v`) ; frontend (script de beacon sur `/p/{slug}`) ; test-engineer
- Phase : 4
- ADR liées : 0006, 0011, 0012 ; fiches 0018, 0019, 0025, 0028

## Objectif
Les scans NFC et QR, les vues du profil, les téléchargements de vCard et les clics (liens, téléphone, e-mail) alimentent `analytics_events`, sans cookie, sans donnée personnelle et sans ralentir les redirections.

## Périmètre de fichiers
- backend : `src/domain/analytics/`, `src/server/use-cases/record-event.ts`, adaptateur `src/server/repositories/supabase-event-recorder.ts`, `src/server/container.ts`, `src/app/(public)/api/beacon/route.ts`, `src/app/(public)/t/`, `q/`, `v/` (ajout de l'enregistrement uniquement), règle ESLint `no-restricted-imports` (liste des adaptateurs admin).
- frontend : composant client de beacon dans `src/ui/features/` et son montage dans `src/app/(public)/p/[slug]/page.tsx`.
- test-engineer : tests unitaires, intégration, E2E.
- Interdit : tout le reste.

## Décisions (validées par Hery, 18/11/2026)
1. **Aucun cookie, aucun stockage local, aucune empreinte** : la mesure reste exemptée de consentement.
2. **Domaine** : `AnalyticsEvent` (types et sources de 0028), `classifyUserAgent(ua) → mobile | desktop | bot` (liste des robots et aperçus de liens : moteurs, `facebookexternalhit`, `LinkedInBot`, `Slackbot`, `WhatsApp`, `Twitterbot`, `TelegramBot`, `Discordbot`… ; user-agent vide = robot). Les robots ne sont jamais enregistrés.
3. **Redirections `/t` et `/q`** : l'événement (`nfc_scan` / `qr_scan`, `id` généré côté serveur) est écrit **sans bloquer** la réponse (`after()` de Next.js) ; un échec d'enregistrement est journalisé et ne change pas la redirection. La redirection ajoute `?s=nfc` ou `?s=qr` à `/p/{slug}`.
4. **`/v/{slug}`** : `vcard_download`, même principe.
5. **Page publique (statique)** : un petit composant client lit `?s=`, puis le retire de l'URL (`history.replaceState`), et envoie par `navigator.sendBeacon` un `profile_view` (UUID généré au montage) ; chaque clic de lien ou de contact envoie un `link_click` / `contact_click`. La page reste statique (aucune lecture de `searchParams` côté serveur).
6. **`/api/beacon`** : `POST` JSON validé par Zod stricte (taille bornée), robots écartés par user-agent, limitation de débit `beacon:<empreinte de l'adresse>` 300/h (`consume_rate_limit`), réponse `204` dans tous les cas (aucun oracle sur l'existence du profil), `no-store`. Le profil est désigné par son `slug` ; la résolution en `profile_id` se fait côté serveur.
7. **Écriture** par le client `service_role`, via `record_event` seulement (avenant ADR 0011).

8. *Reporté de l'audit 0028* : l'adaptateur n'appelle que `rpc('record_event')`, jamais la table ; l'`id` venu du beacon est validé (uuid v4) ; limitation de débit et filtrage des robots **avant** `record_event`, quel que soit l'`id` (le dédoublonnage ne protège pas contre le gonflement) ; mention d'information « mesure d'audience sans cookie » sur la page publique (ou politique de confidentialité, 0011). Types `database.types.ts` régénérés (`pnpm db:types`) par backend.

9. *Hery (18/11/2026), après les tests* : écriture par `rpc('record_public_event')` avec le slug (fiche 0034), plus de port `PublishedProfileIds` ; `get_public_links` expose `id` → `PublicLink.id` et `link_id` dans le beacon ; limitation de débit des événements serveur (`/t`, `/q`, `/v`) `scan:<empreinte de l'adresse>` **60/h**, la redirection et la vCard n'étant jamais bloquées. Orchestrateur : un lien de la table `links` (WhatsApp compris) → `link_click` ; un champ du profil (téléphone, e-mail, site web) → `contact_click` ; `link_click`/`contact_click` reprennent la source de la visite.

10. *Hery (18/11/2026), après revue et audit* :
    - **Anti-gonflement depuis un site tiers** : `/api/beacon` ignore silencieusement (réponse `204` inchangée, rien n'est enregistré, aucune limite consommée) toute requête dont l'en-tête `Origin` est présent et différent de l'origine de `SITE_URL`, ou dont `Sec-Fetch-Site` est présent et différent de `same-origin`. En-têtes absents → requête traitée normalement. `/t` et `/q` n'enregistrent le scan que si `Sec-Fetch-Dest` est absent ou vaut `document` ; la redirection reste identique dans tous les cas.
    - **Pas de limite par profil** : exception assumée à `docs/rules/security.md` (« par IP et par profil ») pour la collecte de statistiques — mesure « au mieux » ; un plafond par profil permettrait de saturer le compteur et d'effacer les vraies visites. Ne s'applique qu'aux statistiques (pas aux leads ni aux réservations).
    - **Panne du limiteur** : asymétrie conservée — beacon → `err("unexpected")`, événements serveur → `ok("ignored")` ; le résultat est jeté par `after()` dans les deux cas.
    - **Corrections mineures** : commentaire de `beacon/route.ts` (les échecs sont journalisés par les adaptateurs) ; bornes `40` / `36` remplacées par des constantes exportées du domaine ; `BeaconEvent` = `Omit<BeaconInput, "userAgent" | "clientAddress">` ; `use-profile-beacon.ts` : un échec de la mesure (API absente, exception) ne casse jamais la page (`try/catch` silencieux) ; `docs/architecture.md` : retirer le « s » isolé entre §8 et §9 et rétablir le saut de ligne final (confié à backend, sans autre modification).
    - **Origine de comparaison** : `siteUrl` exporté par `@/server/container` (jamais l'URL reçue, qui diffère derrière Traefik). Pour les E2E locaux sans proxy (`http://localhost:3000`) : `env.ts` accepte en production un `SITE_URL` en `http://` **uniquement** pour l'hôte `localhost` ou `127.0.0.1` (tout autre hôte reste refusé) ; `playwright.config.ts` passe par défaut `SITE_URL=http://localhost:3000` (Hery, 18/11/2026). Confié à backend.
    - Hors code, à vérifier au déploiement : `x-forwarded-for` transmis par Traefik, délais de lecture du corps côté Traefik.

## Critères d'acceptation
1. Un scan NFC d'un profil publié produit un `nfc_scan` puis un `profile_view` de source `nfc` ; idem QR.
2. La même requête de beacon rejouée (même `id`) ne crée qu'un événement.
3. Un user-agent de robot ou d'aperçu de lien ne crée aucun événement ; la réponse reste `204`.
4. Une panne de l'enregistrement ne casse ni la redirection ni la vCard.
5. La page `/p/{slug}` reste générée statiquement ; aucun cookie n'est posé.
6. Au-delà de la limite, les événements sont ignorés silencieusement.

## Règles applicables
`docs/rules/nextjs.md`, `docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`

## Hors périmètre
Tableau de bord (0030), événements du module de rendez-vous (phase 5).

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `pnpm check`, intégration, build, E2E verts
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (18/11/2026) : 13 fichiers créés (domaine, cas d'usage, adaptateur, routes `/api/beacon`, `/v`, intégration, E2E 13 × 2), 4 modifiés (`/t`, `/q` → `?s=nfc|qr`, `rate-limits`, `container-public`). Échec prouvé. Contrat : `classifyUserAgent`, `parseBeaconEvent`, `makeRecordBeaconEvent` (robot → limite → validation → écriture), `makeRecordServerEvent`, route `/api/beacon` (texte ≤ 1024 o, Zod stricte, toujours 204 `private, no-store`), mention « Mesure d'audience sans cookie ». Bloquants remontés (slug → id, `link_id`) : tranchés par Hery (point 9), tests à ajuster.
- implémentation backend (18/11/2026) : domaine `analytics-event.ts`, `user-agent.ts`, `ports.ts` ; `record-event.ts` (robot → limite → validation → écriture ; beacon : panne du limiteur = `err`, serveur : `ignored`) ; adaptateur `rpc('record_public_event')` seul ; route `/api/beacon` (flux ≤ 1024 o, `z.strictObject`, `after()`, 204 `private, no-store`) ; `/t`, `/q`, `/v` instrumentés par `after()` ; `PublicLink.id` ; types régénérés ; ESLint : groupe `adminAdapters` importable par `container.ts` seul. Robots : `HeadlessChrome` volontairement non filtré (Playwright), limite connue. Unitaires 2047/2048 (reste : `profile-card-view`, frontend), intégration `analytics` 9/9.
- implémentation frontend (18/11/2026) : `src/ui/features/analytics/` (cibles `data-beacon-link` / `data-beacon-contact`, écoute unique en capture sur `document`, clic simulé de `ContactReveal` non compté, une vue par montage, `?s=` retiré par `replaceState`), `AudienceNotice` « Mesure d'audience sans cookie » rendue dans la page (pas dans l'aperçu), `ProfileLinkView.id`, aperçu de l'éditeur `id ?? key`. Build : `● /p/[slug]` (SSG), HTML identique avec et sans `?s=`, aucun cookie ni stockage. Trois tests à ajuster (aperçu avec `id`, Chromium et 204, `?s=` dans `nfc.spec`), renvoyés à test-engineer.
- reviewer (18/11/2026) : OK, aucun bloquant ; traités au point 10 (commentaire beacon, constantes `SLUG_MAX_LENGTH`/`UUID_LENGTH`, `Omit`, `try/catch` du beacon client, typo `architecture.md`) ; asymétrie de panne du limiteur conservée (Hery) ; suggestions non retenues : conteneur dédié au beacon, factorisation du câblage admin, `p_link_id default null`.
- security-auditor (18/11/2026) : OK, aucun bloquant ; traités au point 10 : filtre `Origin`/`Sec-Fetch-Site` sur `/api/beacon`, `Sec-Fetch-Dest` sur `/t` et `/q`, exception « pas de limite par profil » consignée, liste ADR 0011 complétée. À vérifier au déploiement : `x-forwarded-for` et délais Traefik. Point 10 : helpers dans `src/app/(public)/fetch-metadata.ts` (lint ADR 0012), `env.ts` accepte `http://localhost|127.0.0.1` en production, helper E2E `e2eSiteOrigin()`. Vérif orchestrateur : check 2096, intégration 206, build OK, E2E 348/348.
