# 0032 — Formulaire de contact et liste des messages

- Statut : done
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
10. *Hery (18/11/2026), règle « Limite de lignes PostgREST » de `docs/rules/supabase.md`* : la liste des messages peut dépasser 100 lignes (50/jour × 12 mois) → **pages de 20**, plus récent d'abord, lien « Messages plus anciens » ; pagination par clé (`created_at`, `id`) transmise en paramètre d'URL (`?avant=`, valeur opaque validée, invalide → première page) ; lecture directe sous RLS par le client de session, sans nouvelle fonction SQL ; test au-delà de 100 messages. Server Components, sans JavaScript client pour la liste.
11. *Orchestrateur* : aucune nouvelle dépendance npm — vérification Turnstile par `fetch` vers l'API `siteverify` (adaptateur `integrations`), widget chargé par un `<script>` Cloudflare injecté à l'ouverture du formulaire. Le message est affiché en texte brut (aucun rendu HTML ni lien automatique).
12. *Hery (18/11/2026), amende la décision 2* : limite par profil sur **`lead-profile:<slug>`** (le `profile_id` n'est pas connu avant `capture_lead` sans lecture `service_role`, interdite par l'ADR 0011 ; le slug n'est pas modifiable par le propriétaire — à revoir si cela change) ; fenêtre de **23 h** (et non 24 h) pour rester sous la purge `pg_cron` des `rate_limits` (`interval '23 hours'`, 0010), mention de conservation inchangée.
13. *Orchestrateur, contrat des tests (18/11/2026)* : ~~Zod dans le domaine (`leadSubmissionSchema`, partagé par l'action et le cas d'usage)~~ (déviation non validée, annulée au point 14) ; jeton absent → `challenge_failed` ; aucune adresse IP envoyée à Cloudflare ; `hostname` Cloudflare non vérifié (les clés de test renvoient `example.com`) ; rejeu au-delà de 5/h depuis la même adresse → `rate_limited` (on compte les tentatives, ADR 0011) ; E2E : clés de test Cloudflare (`1x…AA` accepté), second serveur `pnpm start` sur le port 3001 avec la clé secrète « toujours refusé » (`2x…AA`), accès réseau à `challenges.cloudflare.com` requis en CI ; clés de test dans le job `e2e` de la CI (le build valide l'environnement).

14. *Hery (18/11/2026), après revue (bloquant) et audit (moyens)* :
    - **Zod hors du domaine** (`architecture.md` §3, ADR 0012 §2) : `leadSubmissionSchema` et le parsing passent dans `src/server/actions/lead-schemas.ts` (modèle de `profile-schemas.ts`) ; le domaine `src/domain/lead/` ne garde que les types et bornes (`LeadSubmission`, `OwnLead`, `LEAD_TEXT_MAX_LENGTH`, `LeadInvalidField`) ; le cas d'usage reçoit une `LeadSubmission` typée (plus de double validation) ; la règle « texte multiligne » (CRLF normalisé, caractères interdits hors `\n`) est factorisée et partagée par la bio et le message.
    - **Frontière UI** : `src/ui/` n'importe plus `@/server/use-cases/*` ; le type d'erreur est exporté par `src/server/actions/lead.ts` (`CaptureLeadActionError`).
    - **Ordre amendé (décision 2)** : validation → robot → limite `lead:<empreinte>` 5/h → Turnstile → limite `lead-profile:<slug>` 50/23 h → `capture_lead` ; la limite par profil n'est consommée qu'après un défi réussi.
    - **Jeton lié au profil** : widget rendu avec `action: "lead"` et `cData: <slug>` ; le serveur refuse (`challenge_failed`) si l'`action` ou le `cdata` renvoyés par Cloudflare diffèrent (comportement des clés de test à vérifier et documenter) ; test « même jeton et même clé, autre slug → refusé ».
    - **Mention RGPD complétée** : « Vous pouvez demander l'accès à vos coordonnées, leur effacement ou vous opposer à leur traitement auprès de <nom du propriétaire>. Cloudflare peut traiter des données techniques hors de l'Union européenne. »
    - *Orchestrateur (tactique)* : clé d'idempotence régénérée côté client après `challenge_failed` (rien n'est écrit dans ce cas) ; clés de test Cloudflare (`^[123]x0+AA$`) refusées par `env.ts` en production hors `SITE_URL` `localhost`/`127.0.0.1` ; `reuseExistingServer: false` pour le serveur de refus (port 3001) ; `hostname` non vérifié côté serveur — la liste des domaines autorisés est configurée sur la clé chez Cloudflare (à vérifier au déploiement) ; refus « jeton absent » et « robot » non comptés dans les limites (aucun appel externe), assumé.
    - *Hery (18/11/2026), après les tests* : les clés de test Cloudflare ne renvoient ni `action` ni `cdata` → l'adaptateur accepte leur absence **uniquement** si la réponse porte `metadata.result_with_testing_key: true` (sinon `unavailable`, jamais accepté) ; motif des clés de test refusées par `env.ts` en production publique élargi à `^[123]x0+[A-F]{2}$` (toutes les clés de site et secrètes de test). La liaison jeton ↔ slug est prouvée par les tests unitaires (adaptateur, cas d'usage) ; pas d'E2E dédié (impossible avec les clés de test), aucun `test.fixme` laissé.
    - *Hery (18/11/2026), après le second audit (MOYEN : un défi rejoué avec la même `idempotency_key` épuise le quota du profil)* : l'adaptateur **n'envoie plus `idempotency_key` à siteverify** — chaque jeton n'est validé qu'une fois (rejeu → `challenge_failed`, quota profil non consommé) ; `idempotencyKey` retiré de `BotChallengeInput` ; la clé reste celle de `capture_lead` (anti-doublon) et est **régénérée côté client après tout refus sans écriture** (tous les états d'erreur sauf `unexpected`, où une écriture n'est pas exclue) ; widget réinitialisé après tout refus autre que `invalid_input`. Risque résiduel accepté : réponse perdue après un envoi réussi → renvoi avec un nouveau jeton et une nouvelle clé → doublon possible (rare).
    - *Orchestrateur (tactique, revue et audit)* : constante unique `LEAD_CHALLENGE_ACTION = "lead"` dans `src/domain/lead/lead.ts` (émise par le widget, comparée par le cas d'usage) ; chargeur du script Turnstile : un échec `onload` (API absente) remet aussi le cache à `null` (nouvel essai possible) ; `env.ts` : commentaire « garde-fou de configuration, pas une frontière de sécurité » (un `SITE_URL` local en production publique se voit aussitôt) ; validité d'un jeton < 5 s après succès non garantie unique par Cloudflare (99 %) : impact négligeable, borné par 5/h par adresse.
    - Reporté : primitive `ConfirmDialog` commune avec les puces NFC (fiche séparée), emplacement du curseur base64url, déplacement de `FORBIDDEN_LABEL_CHARACTERS` dans `domain/shared/`, CSP (`challenges.cloudflare.com` en `script-src`/`frame-src`), `bodySizeLimit` des Server Actions publiques.

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
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `pnpm check`, intégration, build, E2E verts
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (18/11/2026) : domaine, schémas (`lead-schemas`, `multiline-text`), 3 cas d'usage, adaptateurs Turnstile (44) et Supabase, Server Actions, env ; intégration `leads` (pagination > 100 messages, isolation, idempotence) ; E2E `lead.spec.ts` 22 × 2 (clés de test Cloudflare, serveur de refus sur 3001). Clés de test vérifiées par appel réel à siteverify (ni `action` ni `cdata`, `metadata.result_with_testing_key`).
- implémentation (18/11/2026) : integrations `turnstile.ts` (siteverify, `secret` + `response` seuls, `action`/`cdata` comparés) ; backend domaine `lead`, `capture-lead` (validation → robot → limite adresse → Turnstile → limite profil → `capture_lead`), `list-own-leads` (pages de 20 par clé), `delete-own-lead`, dépôts, actions, `env.ts` (clés de test refusées en production publique), `acceptsLeads`, Playwright (2 serveurs, `baseURL`), CI ; frontend formulaire replié (script Cloudflare à l'ouverture, clé d'idempotence régénérée après refus), interrupteur de l'éditeur, page `/tableau-de-bord/messages`.
- reviewer (18/11/2026) : 1er passage BLOQUANT (Zod dans le domaine, import `use-cases` depuis `src/ui`) → point 14 ; 2e passage OK ; suggestions traitées (constante `LEAD_CHALLENGE_ACTION`, chargeur Turnstile retentable).
- security-auditor (18/11/2026) : 1er passage 2 MOYEN (quota profil avant Turnstile ; jeton multi-profils) → point 14 ; 2e passage 1 MOYEN (rejeu via `idempotency_key`) → clé retirée de siteverify ; faibles traités ou consignés (RGPD art. 13, clés de test en production, `hostname`, CSP, `bodySizeLimit`). Vérif orchestrateur : check 2566, intégration 245, pgTAP PASS (1 échec intermittent isolé juste après redémarrage de la pile, 4 relances vertes), build, E2E 420/420.
