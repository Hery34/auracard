# 0042 — Mes rendez-vous et entonnoir

- Statut : todo (après 0039)
- Agent : scheduling ; frontend ; backend (statistiques) ; test-engineer
- Phase : 5
- ADR liées : 0012, 0016 ; fiches 0030, 0036, 0039

## Objectif
Le propriétaire consulte ses rendez-vous à venir et passés sur `/tableau-de-bord/rendez-vous`, en annule un (le visiteur est prévenu), et voit l'entonnoir scan → profil → rendez-vous dans ses statistiques.

## Périmètre de fichiers
- scheduling : cas d'usage `list-own-bookings`, `cancel-own-booking`, Server Action, `container.ts`.
- backend : `src/domain/analytics/stats.ts` (métriques `booking_*`), lecture existante de 0030.
- frontend : `src/app/(dashboard)/tableau-de-bord/rendez-vous/`, `src/ui/features/booking/`, `src/ui/features/stats/`.
- test-engineer : unitaires, intégration, E2E.
- Interdit : tout le reste.

## Décisions (ADR 0016)
1. Liste paginée (règle « Limite de lignes PostgREST ») : à venir d'abord (ordre chronologique), passés ensuite ; heures dans le fuseau du profil ; client de session sous RLS.
2. Annulation par le propriétaire avec confirmation, à tout moment, idempotente (`cancel_own_booking`).
3. Statistiques : carte « Rendez-vous » et entonnoir vues → `booking_viewed` → `booking_started` → `booking_confirmed`.

## Notes héritées de 0036 (revue, 18/11/2026)
- Lecture des réservations du propriétaire : pagination testée au-delà de 100 ou fonction jsonb (règle « Limite de lignes PostgREST »).
- `cancel_own_booking` renvoie void, idempotente ; sans effet sur un rendez-vous déjà commencé.

## Critères d'acceptation
1. Ordre, pagination au-delà de 100, fuseau correct.
2. Un autre compte ne voit ni n'annule rien.
3. Entonnoir juste sur des agrégats connus ; E2E iOS et Android.

## Règles applicables
`docs/rules/nextjs.md`, `docs/rules/security.md`, `docs/rules/supabase.md`, `docs/rules/testing.md`

## Hors périmètre
Export, synchronisation d'agenda (phase 7).

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
