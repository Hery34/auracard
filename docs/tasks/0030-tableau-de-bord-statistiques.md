# 0030 — Tableau de bord des statistiques

- Statut : todo (après 0029)
- Agent : backend (cas d'usage de lecture) ; frontend (page) ; test-engineer
- Phase : 4
- ADR liées : 0012, 0013 ; fiches 0028, 0029

## Objectif
Le propriétaire voit sur `/tableau-de-bord/statistiques` ses scans, vues, téléchargements de vCard et clics, par jour, semaine ou mois, au total et par lien.

## Périmètre de fichiers
- backend : `src/server/use-cases/get-own-stats.ts`, repository de lecture, `src/domain/analytics/` (regroupement par semaine ou mois, à partir des agrégats quotidiens).
- frontend : `src/app/(dashboard)/tableau-de-bord/statistiques/`, `src/ui/features/stats/`, lien dans la navigation du tableau de bord.
- test-engineer : tests unitaires, intégration, E2E.
- Interdit : tout le reste.

## Décisions (validées par Hery, 18/11/2026)
1. **Aucune bibliothèque de graphiques** : barres en SVG ou CSS, accessibles (tableau de données équivalent ou `aria-label` par barre), thème AuraCard.
2. **Périodes** : 7 jours (par jour), 30 jours (par jour), 12 semaines (par semaine ISO), 12 mois (par mois) ; jours en Europe/Paris ; jours sans donnée affichés à zéro.
3. **Contenu** : cartes de totaux (scans NFC, scans QR, vues, vCard, clics) ; répartition des vues par source (NFC, QR, direct) ; tableau des clics par lien (libellé actuel ; « Lien supprimé », regroupés en une seule ligne, pour tout `link_id` qui ne correspond plus à un lien du profil) ; clics sur téléphone et e-mail.
4. **Lecture** par le client utilisateur (RLS de `analytics_daily`), jamais par `service_role`. Page dynamique, `no-store`.
5. Mention sous les chiffres : « Mis à jour toutes les 15 minutes. Robots et aperçus de liens exclus. »

## Critères d'acceptation
1. Étant donné des agrégats connus, la page affiche les bons totaux pour chaque période et chaque regroupement.
2. Un propriétaire ne voit jamais les chiffres d'un autre profil.
3. Sans aucune donnée, la page affiche un état vide explicite.
4. Lisible et utilisable sur mobile (iOS et Android E2E), contrastes AA.

## Règles applicables
`docs/rules/nextjs.md`, `docs/rules/security.md`, `docs/rules/testing.md`

## Hors périmètre
Export CSV, comparaison entre périodes, entonnoir de rendez-vous (phase 5).

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
