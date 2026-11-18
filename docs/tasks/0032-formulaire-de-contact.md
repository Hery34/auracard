# 0032 — Formulaire de contact et liste des messages

- Statut : todo (après 0031)
- Agent : integrations (adaptateur Turnstile) ; backend (domaine, cas d'usage, Server Actions) ; frontend (formulaire public, interrupteur dans l'éditeur, page des messages) ; test-engineer
- Phase : 4
- ADR liées : 0008, 0011, 0012 ; fiches 0018, 0020, 0031

## Objectif
Un visiteur laisse son nom, son e-mail et un message depuis le profil public ; le propriétaire les retrouve en lecture seule sur `/tableau-de-bord/messages` et peut les supprimer.

## Périmètre de fichiers
- integrations : `src/server/adapters/turnstile.ts`.
- backend : `src/domain/lead/` (dont le port `BotChallengeVerifier` dans `src/domain/shared/`), `src/server/use-cases/capture-lead.ts`, `list-own-leads.ts`, `delete-own-lead.ts`, adaptateurs Supabase, `container.ts`, `env.ts`, Server Actions, règle ESLint des imports admin.
- frontend : `src/ui/features/lead/`, `src/app/(public)/p/[slug]/page.tsx` (montage), `src/app/(dashboard)/tableau-de-bord/messages/`, interrupteur « Recevoir des messages » dans l'éditeur (0020).
- test-engineer : tests unitaires, intégration, E2E.
- Interdit : tout le reste. `.env.example` : à compléter par Hery (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`).

## Décisions (validées par Hery, 18/11/2026)
1. **Formulaire replié** (« Laisser mes coordonnées ») ; le script Turnstile n'est chargé qu'à l'ouverture : aucun script tiers pour le visiteur qui ne l'ouvre pas. Absent si `accepts_leads = false`.
2. **Server Action** (ordre imposé) : Zod stricte (bornes de 0031) → limitation de débit `lead:<empreinte de l'adresse>` 5/h et `lead-profile:<profile_id>` 50/jour → vérification Turnstile (refus si échec ou indisponibilité) → `capture_lead` (`service_role`). Clé d'idempotence générée au montage du formulaire. Rejeu : succès, aucun doublon.
3. **Mention d'information RGPD** sous le formulaire (finalité : transmettre vos coordonnées à `<nom du propriétaire>` ; destinataire : le propriétaire ; durée : 12 mois ; Cloudflare cité pour le contrôle anti-robot, Infomaniak pour l'envoi de l'e-mail au propriétaire) et case à cocher obligatoire ; `consent_at` = heure serveur.
4. **Pas d'e-mail au visiteur**, pas de CRM.
5. **Page `/tableau-de-bord/messages`** : liste des messages (plus récent d'abord), lecture seule, suppression avec confirmation ; client utilisateur (RLS), jamais `service_role`.
6. **Tests** : clés de test Cloudflare (toujours accepté, toujours refusé) ; implémentation factice du port en unitaire.
7. **CSP** : `challenges.cloudflare.com` à prévoir dans la fiche CSP (préalable production).

8. `capture_lead` reçoit `p_device_class` calculé par `classifyUserAgent` (0029) ; un robot est refusé avant l'appel.
9. *Reporté de l'audit 0031* : Zod `.email()` et longueurs minimales ; envoi refusé sans case de consentement cochée (`consent_at` n'est posé par la base qu'après ce contrôle).

## Critères d'acceptation
1. Un envoi valide crée un message visible par le propriétaire ; double soumission = un seul message.
2. Jeton Turnstile refusé ou absent, Cloudflare indisponible, limite dépassée : rien n'est écrit, message explicite.
3. Profil non publié ou qui refuse les messages : pas de formulaire, et la Server Action refuse.
4. Le propriétaire supprime un message ; un autre compte ne peut ni le lire ni le supprimer.
5. Le script Turnstile n'est pas chargé tant que le formulaire est fermé ; `/p/{slug}` reste statique.
6. Formulaire accessible (étiquettes, erreurs annoncées), E2E iOS et Android.

## Règles applicables
`docs/rules/nextjs.md`, `docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`

## Hors périmètre
Envoi de l'e-mail (0033), réponse depuis l'application, export.

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
