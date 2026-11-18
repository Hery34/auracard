# 0029 — Collecte des statistiques

- Statut : todo (après 0028)
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
- [ ] Tests écrits par test-engineer, échouant avant implémentation
- [ ] `pnpm check`, intégration, build, E2E verts
- [ ] reviewer : OK ou remarques non bloquantes traitées
- [ ] security-auditor : OK
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer : …
- implémentation : …
- reviewer : …
- security-auditor : …
