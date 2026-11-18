# 0038 — Paramétrage des rendez-vous par le propriétaire

- Statut : todo (après 0036)
- Agent : scheduling (cas d'usage, dépôts, Server Actions) ; frontend (pages) ; test-engineer
- Phase : 5
- ADR liées : 0012, 0013, 0016 ; fiches 0020, 0036

## Objectif
Le propriétaire choisit son fuseau, crée ses types de rendez-vous (durée, tampon, délai minimal, lieu) et saisit ses disponibilités hebdomadaires, ses absences et ses ouvertures ponctuelles sur `/tableau-de-bord/rendez-vous/reglages`.

## Périmètre de fichiers
- scheduling : `src/domain/booking/`, `src/server/booking/` (cas d'usage, dépôts Supabase, Server Actions), `container.ts` (câblage).
- frontend : `src/app/(dashboard)/tableau-de-bord/rendez-vous/`, `src/ui/features/booking/`.
- test-engineer : unitaires, intégration, E2E.
- Interdit : tout le reste.

## Décisions (ADR 0016)
1. Écritures par le client utilisateur sous RLS (jamais `service_role`) ; autorisation vérifiée dans chaque Server Action ; mise à jour idempotente (remplacement de la liste des règles, comme les liens en 0016/0020).
2. Rappel visible : « En phase 1, votre agenda (Google, Outlook) n'est pas lu : tenez vos disponibilités à jour. » (ADR 0005).
3. Au plus 10 types ; un type désactivé disparaît de la page publique, ses réservations existantes restent.

## Notes héritées de 0036 (revue et audit, 18/11/2026)
- Positions de types 0 à 9 : chercher une position libre ; réordonnancement en une seule instruction (contrainte unique `deferrable initially immediate`).
- Un type ayant des réservations se désactive (FK `no action`, 23503 à traduire).
- Fuseau limité à `Intl.supportedValuesOf('timeZone')` (`pg_timezone_names` accepte des noms que `Intl` refuse).
- Erreurs à traduire : 23514 (bornes, plafonds de 50 règles / 200 exceptions, minutes), 23P01 (règles qui se chevauchent).
- *Reporté de l'audit 0036 (db-architect + test-engineer, dans cette fiche)* : exceptions déjà terminées ni plafonnées ni purgées → refuser l'insertion d'une exception terminée (`upper(range) <= now()`) **ou** les purger (tâche quotidienne existante, au-delà de N jours) ; tests pgTAP sous `authenticated` : écrire sur le profil plein d'autrui → 42501 (jamais 23514), plafond appliqué à un `update` qui ramène une exception passée dans le futur.

## Critères d'acceptation
1. Création, modification, désactivation et réordonnancement des types ; enregistrement des règles et exceptions ; relecture identique.
2. Un autre compte ne lit ni ne modifie rien.
3. Accessible (étiquettes, erreurs annoncées), mobile, contrastes AA.

## Règles applicables
`docs/rules/nextjs.md`, `docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`

## Hors périmètre
Réservation publique (0039), synchronisation d'agenda (phase 7).

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
