# 0039 — Réservation publique

- Statut : todo (après 0037 et 0038)
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

## Notes héritées de 0036 (revue et audit, 18/11/2026)
- Au rejeu, `book_slot` renvoie `cancel_token` null ; le rejeu ne vérifie pas que les paramètres sont identiques (comme `capture_lead`).
- Le consentement n'est pas un paramètre de `book_slot` : l'action l'impose (Zod) avant l'appel.
- Erreurs à traduire : 22023, P0002, CN001 (créneau pris), CN002 (indisponible), 23514/23502 bruts sur les champs visiteur.
- `booking_confirmed` doit être refusé par `record-event` et `/api/beacon` (seuls `booking_viewed`, `booking_started` y sont acceptés ; étendre `record-event.test.ts`).
- Test d'intégration de concurrence réelle (deux transactions, même créneau et tampon) : une réussite, un CN001.
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
