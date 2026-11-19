# 0039 — Réservation publique

- Statut : done
- Agent : scheduling (cas d'usage, Server Action) ; frontend (page publique) ; test-engineer
- Phase : 5
- ADR liées : 0008, 0011, 0012, 0016 ; fiches 0029, 0032, 0036, 0037

## Objectif
Depuis le profil public, un visiteur choisit un type de rendez-vous, un jour et un créneau sur `/p/{slug}/rdv`, laisse ses coordonnées et reçoit une confirmation immédiate.

## Périmètre de fichiers
- scheduling : `src/server/booking/` (cas d'usage `book-slot`, lecture des créneaux via les fonctions publiques de 0036 et le calcul de 0037), Server Action, `container.ts`.
- frontend : `src/app/(public)/p/[slug]/rdv/`, `src/ui/features/booking/`, bouton « Prendre rendez-vous » sur `/p/{slug}` (affiché s'il existe au moins un type actif).
- test-engineer : unitaires, intégration, E2E.
- Interdit : tout le reste.

## Décisions (ADR 0016 ; modèle de la fiche 0032)
1. Ordre de la Server Action : validation (Zod, `src/server/booking/` ou `actions`) → robot (`classifyUserAgent`) → limite `booking:<empreinte>` 5/h → Turnstile (`action: "booking"`, `cData: slug`, jeton validé une fois) → limite `booking-profile:<slug>` 20/23 h → `book_slot` (`service_role`). Clé d'idempotence générée à l'ouverture du formulaire, régénérée après tout refus sans écriture.
2. Créneaux affichés dans le fuseau du navigateur, fuseau du propriétaire indiqué s'il diffère ; créneau pris entre l'affichage et l'envoi → message explicite et liste rafraîchie.
3. Téléphone obligatoire pour le mode `phone` ; mention RGPD (art. 13 : finalité, destinataire, 12 mois après le rendez-vous, droits, Cloudflare, Infomaniak) et consentement obligatoire.
4. Statistiques : `booking_viewed` (ouverture de la page), `booking_started` (choix d'un créneau) par le beacon de 0029 ; `booking_confirmed` écrit par `book_slot`.
5. Page de confirmation : récapitulatif, ajout à l'agenda (`.ics` téléchargeable), rappel que l'e-mail de confirmation contient le lien d'annulation.

6. *Hery (19/11/2026)* : limite de lecture des créneaux `booking-slots` **60/h par adresse**.
7. *Orchestrateur, après les tests (19/11/2026)* :
   - **Périmètre étendu** : backend — `src/domain/analytics/analytics-event.ts` (métriques `booking_*`), `src/domain/shared/rate-limits.ts` (portées `booking`, `booking-profile`, `booking-slots`), `src/server/repositories/supabase-daily-aggregate-reader.ts` (**régression latente** : refusait les métriques `booking_*`, la page Statistiques aurait renvoyé `unexpected` dès la première agrégation), `src/server/use-cases/record-event.ts` et `/api/beacon` (`booking_confirmed` refusé), `eslint.config.mjs` (`supabase-slot-booker` dans `adminAdapters`) ; scheduling — `src/server/booking/actions.ts` (création, désactivation, suppression de type invalident `profileCacheTag(slug)` pour que le lien « Prendre rendez-vous » de `/p/{slug}` suive).
   - Lecture des créneaux par **Server Action** (POST) ; téléphone imposé par `book_slot` (22023 → `phone_required`) et `required` dans le formulaire.
   - **Clé d'idempotence liée au choix** (type + créneau) : nouvelle clé à chaque changement de sélection, même clé pour le même choix après `unexpected` (pas de récapitulatif d'un autre créneau) ; régénérée après tout refus sans écriture.
   - `booking_viewed` et `booking_started` (une fois par page), source `direct` ; « Prendre rendez-vous » est un lien (`<a>`).
   - Lien de visio jamais public (0036 point 14) : le helper « https seulement » sert à 0041 et 0042.
   - *Implémentation (scheduling)* : invalidation de `profileCacheTag(slug)` faite par un décorateur dans `container.ts` (les actions ne connaissent pas le slug), après succès de toute modification qui change la page publique en cache (fuseau, types, ordre, activation, suppression, semaine type) ; page publique mise en cache (`cached-public-booking-reader`), occupations jamais en cache.
   - *Implémentation (frontend)* : erreur `unexpected` de la page de réservation sur `/p/{slug}` → erreur 500 (comme `loadProfile`, jamais de page mise en cache sans lien par erreur) ; type et semaine affichés après lecture des créneaux (« Chargement des créneaux… » annoncé) ; conversion d'heures par `Intl`/`Date` côté navigateur, `.ics` proposé seulement si `Temporal` est disponible.
   - DST en E2E conditionnel (changement d'heure entre J+2 et J+50) ; couverture inconditionnelle par unitaires et pgTAP.
8. *Après revue et audit (19/11/2026)* :
   - **Hery — quota du profil sur les seules réservations réussies** : la limite applicative `booking-profile` est supprimée ; `book_slot_at` refuse (SQLSTATE dédié **`CN005`**) si le profil a déjà 20 réservations **confirmées créées** dans les 23 dernières heures (une réservation annulée — par l'annulation groupée du propriétaire notamment — libère le quota), contrôlé sous `lock_profile_bookings` et après la détection du rejeu (un rejeu reste un succès). Un échec (`slot_taken`, `slot_unavailable`) ne consomme rien. Nouvelle migration (db-architect) ; traduction `CN005` → `rate_limited`. Annulation groupée par le propriétaire en 0042. ~~Le report n'est pas soumis au quota (compte inchangé)~~ — faux si l'origine a plus de 23 h (audit, reporté en 0040) ; au plafond, `CN005` est levé avant les contrôles de type et de créneau (traduit `rate_limited`, sans oracle). Migration `20261119120000_booking_profile_quota.sql`.
   - **Hery — mention RGPD complétée** (réservation et formulaire de contact) : « Base légale : votre consentement, que vous pouvez retirer à tout moment auprès de <propriétaire>. Vous pouvez introduire une réclamation auprès de la CNIL. »
   - **Semaine DST** (ramené de 0040) : la lecture suit la semaine locale exacte du navigateur ; `listSlotsAction` accepte une fin `to` bornée à 169 h (`SLOT_READ_WINDOW_HOURS` → 169) ; test du 31/10/2027 à Paris.
   - **Garde commun** (fonction `guardPublicSubmission(deps, policy, input)`) : la séquence jeton → robot → limite par adresse → Turnstile lié au slug est extraite dans `src/server/use-cases/shared/` (backend) et utilisée par `capture-lead` et `book-slot` (`CHALLENGE_TOKEN_MAX_LENGTH` unique).
   - `list-public-slots` ne dépend plus d'un schéma Zod de la couche action (identifiant validé par l'action) ; échec de relecture du profil après écriture journalisé (`logInfrastructureError`) ; 22023 → `phone_required` commenté explicitement ; Turnstile déplacé dans `src/ui/features/challenge/` ; CI : `sudo dpkg --configure -a || true` avant chaque nouvel essai d'installation.
   - Reportés : envoi vers des adresses non vérifiées (0041), limitation de débit PostgREST/Traefik sur `/rest/v1/rpc/get_public_*` et `bodySizeLimit` des actions publiques (préalables de production), CSP (fiche dédiée), croissance du cache pour des slugs inventés (accepté, comme le profil).

## Notes héritées de 0036 (revue et audit, 18/11/2026)
- Au rejeu, `book_slot` renvoie `cancel_token` null ; le rejeu ne vérifie pas que les paramètres sont identiques (comme `capture_lead`).
- Le consentement n'est pas un paramètre de `book_slot` : l'action l'impose (Zod) avant l'appel.
- Erreurs à traduire : 22023, P0002, CN001 (créneau pris), CN002 (indisponible), 23514/23502 bruts sur les champs visiteur.
- `booking_confirmed` doit être refusé par `record-event` et `/api/beacon` (seuls `booking_viewed`, `booking_started` y sont acceptés ; étendre `record-event.test.ts`).
- Test d'intégration de concurrence réelle (deux transactions, même créneau et tampon) : une réussite, un CN001.
- *Reporté de 0037* : demander les occupations (`get_public_busy_ranges`) jusqu'à `to + 720 min` (durée max 480 + tampon max 240), sinon un créneau en fin de plage peut être affiché puis refusé (CN001) ; plage affichée limitée en conséquence (≤ 62 j − 12 h, sinon 22023). Les règles du jsonb portent des secondes (`HH:MM:SS`) : l'adaptateur les ramène à `HH:MM` (`SlotRule`).
- *Reporté de l'audit 0037/0038* : lieu `video` = texte libre → rendu en lien seulement si le schéma est `https:` (jamais `javascript:`), échappé partout ; période demandée par requête courte (une semaine) et limitation de débit sur la lecture des créneaux (coût du calcul).
- *Reporté de l'audit 0037* : `computeSlots` teste chaque candidat contre toutes les occupations (`busy.some`, O(N × B)) ; avant d'exposer le calcul publiquement, parcours conjoint des débuts et des occupations triés (O(N + B)) ou recherche dichotomique (scheduling + test de performance avec ~18 000 occupations).
- Adaptateur `book_slot` dédié (avenant ADR 0011), ajouté à `adminAdapters`.
- Les triggers de plafonds des disponibilités prennent le même verrou par profil (`lock_profile_bookings`) : une réservation attend brièvement pendant une modification des disponibilités ; à prendre en compte dans le test de concurrence, qui couvre aussi les plafonds de disponibilités (deux insertions concurrentes au-delà du plafond : une seule passe ; reporté de l'audit 0036).

## Critères d'acceptation
1. Réservation valide confirmée ; double soumission = une seule réservation.
2. Créneau déjà pris, hors disponibilités, Turnstile refusé, limite dépassée : rien n'est écrit, message explicite.
3. Profil non publié ou sans type actif : pas de bouton, page 404.
4. Accessible (sélection du créneau au clavier, erreurs annoncées), E2E iOS et Android, cas DST.

## Règles applicables
`docs/rules/nextjs.md`, `docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`

## Hors périmètre
E-mails (0041), annulation et report (0040).

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `pnpm check`, intégration, build, E2E verts
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (19/11/2026) : domaine (`booking`, `ics`, `slots` O(N + B)), cas d'usage (`book-slot`, `list-public-slots`, `get-public-booking-page`), garde commun, adaptateurs, actions et schémas, UI (`booking-form-view`, `slot-days`, `slot-week`, `location-link`, messages) ; intégration `public-booking` 21 (concurrence réelle : même créneau, tampon, rejeu, plafonds, quota `CN005`) ; pgTAP `carnet_bookings_profile_quota` 28 et 28 cas TS/SQL ; E2E `public-booking.spec.ts` (DST conditionnel).
- implémentation (19/11/2026) : backend (métriques `booking_*`, limites `booking` 5/h et `booking-slots` 60/h, garde `guardPublicSubmission`, `capture-lead` sur le garde, ESLint, CI) ; db-architect (`20261119120000_booking_profile_quota.sql`, `CN005`) ; scheduling (`computeSlots` O(N + B), `.ics`, cas d'usage, `supabase-slot-booker` / lecteurs public et en cache, actions publiques, conteneur, invalidation du cache) ; frontend (`/p/{slug}/rdv`, lien « Prendre rendez-vous », semaine locale exacte, Turnstile dans `features/challenge`, beacon, primitives partagées, mentions RGPD). Hery : `db reset` + rejeu.
- reviewer (19/11/2026) : 1er passage à corriger (semaine DST, garde dupliqué, couches) → point 8 ; 2e passage OK.
- security-auditor (19/11/2026) : 1er passage 2 MOYEN (blocage ciblé → quota `CN005` sur réservations confirmées + annulation groupée 0042 ; e-mails non vérifiés → 0041) ; 2e passage OK ; MOYEN report hors quota et FAIBLE plage inversée reportés en 0040. Vérif orchestrateur : pgTAP 3081, check 3572, intégration 289, build, E2E 482 + 2 ignorés.
