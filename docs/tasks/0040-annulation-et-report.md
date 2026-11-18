# 0040 — Annulation et report par le visiteur

- Statut : todo (après 0039)
- Agent : scheduling ; frontend ; test-engineer
- Phase : 5
- ADR liées : 0011, 0016 ; fiches 0036, 0039

## Objectif
Le visiteur annule ou reporte son rendez-vous depuis le lien reçu par e-mail (`/rdv/{jeton}`), tant que le délai minimal du type n'est pas dépassé.

## Périmètre de fichiers
- scheduling : cas d'usage `cancel-booking`, `reschedule-booking` (fonctions de 0036), Server Actions, `container.ts`.
- frontend : `src/app/(public)/rdv/[token]/`, `src/ui/features/booking/`.
- test-engineer : unitaires, intégration, E2E.
- Interdit : tout le reste.

## Décisions (ADR 0016)
1. Jeton opaque (≥ 128 bits), comparé par hachage en base ; page `no-store`, `noindex`, `Referrer-Policy: no-referrer` ; jeton invalide ou rendez-vous passé → même réponse générique (aucun oracle).
2. Report = choix d'un nouveau créneau (calcul de 0037) ; atomique : l'ancien passe `cancelled`, le nouveau porte `rescheduled_from` ; nouveau lien envoyé (0041).
3. Après le délai minimal : actions masquées, « contactez <propriétaire> ».
4. Limite de débit par adresse sur ces actions.

## Notes héritées de 0036 (revue et audit, 18/11/2026)
- Au rejeu du report, le jeton renvoyé est null ; les anciens jetons deviennent inopérants après un report.
- `get_public_busy_ranges` compte la propre réservation du visiteur comme occupée, alors que le SQL l'ignore au report : des créneaux valides seront masqués (acceptable).
- Limite de débit par adresse **et** par jeton haché (reports en boucle = e-mails en boucle) ; actions en POST ; `Referrer-Policy: no-referrer` ; aucune journalisation des URL contenant le jeton.

## Critères d'acceptation
1. Annulation et report idempotents (double clic = un seul effet).
2. Un jeton d'un autre rendez-vous ou falsifié ne permet rien.
3. Accessible, E2E iOS et Android.

## Règles applicables
`docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`

## Hors périmètre
Annulation par le propriétaire (0042), e-mails (0041).

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
