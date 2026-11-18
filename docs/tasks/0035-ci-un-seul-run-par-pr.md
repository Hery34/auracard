# 0035 — CI : un seul run par PR, installation Playwright bornée

- Statut : review (CI de la PR)
- Agent : backend (`.github/`)
- Phase : 4 (outillage)
- ADR liées : — ; fiche 0013 (CI + Supabase)

## Objectif
Chaque push sur une branche dotée d'une PR ne lance qu'un seul run de CI, et un miroir Ubuntu lent fait échouer l'installation de Playwright en quelques minutes au lieu d'épuiser les 20 minutes du job `e2e`.

## Contexte
PR #20 (18/11/2026), commits 28ad67d et e063e12 : `on: [push, pull_request]` lance deux runs simultanés ; à chaque fois, le run `pull_request` est resté bloqué dans `playwright install-deps` (téléchargement `apt` à quelques secondes par paquet) jusqu'à l'annulation à 20 min, pendant que le run `push`, parti 4 s plus tôt, passait l'étape en 26 s.

## Décisions (Hery, 18/11/2026)
1. Déclencheurs : `push` sur `main` uniquement, `pull_request` sur toutes les branches.
2. `timeout-minutes: 5` sur les deux étapes d'installation Playwright (`install --with-deps` et `install-deps`).

## Périmètre de fichiers
- Autorisé : `.github/workflows/ci.yml`
- Interdit : tout le reste.

## Critères d'acceptation
1. Un push sur une branche avec PR ouverte déclenche un seul run (`pull_request`).
2. Un push sur `main` déclenche un run (`push`).
3. Les deux étapes d'installation Playwright ont `timeout-minutes: 5` ; le reste du workflow est inchangé.

## Règles applicables
`docs/rules/testing.md`

## Hors périmètre
Mise en cache des paquets `apt`, changement d'image du runner.

## Définition de terminé
- [ ] Pas de test automatisé (configuration CI) : vérification par le run de la PR
- [ ] CI verte sur la PR, un seul run
- [ ] reviewer : OK
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- implémentation (backend, 18/11/2026) : `on.push.branches: [main]` + `pull_request` ; `timeout-minutes: 5` sur les deux étapes Playwright ; YAML validé (parseur Ruby), pas d'`actionlint` local.
- reviewer : diff de 5 lignes relu par l'orchestrateur, conforme aux décisions 1 et 2. Ligne de journal ajoutée sur la branche 0028 (évite un conflit d'ajout en fin de fichier).
