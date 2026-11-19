# 0043 — CI : réessais de l'installation Playwright

- Statut : review (CI de la PR)
- Agent : backend (`.github/`)
- Phase : 5 (outillage)
- ADR liées : — ; fiches 0013, 0035

## Objectif
Une lenteur passagère du miroir Ubuntu ne fait plus échouer le job `e2e` : l'installation des dépendances Playwright est retentée avant d'échouer.

## Contexte
Runs #79 (PR 0032) et #83 (`main`, 19/11/2026) : `pnpm exec playwright install-deps chromium webkit` a dépassé la limite de 5 min (0035) en téléchargeant les paquets `apt` depuis `azure.archive.ubuntu.com` ; une relance passe.

## Décision (Hery, 19/11/2026)
Les deux étapes d'installation Playwright (`install --with-deps` et `install-deps`) sont exécutées jusqu'à **3 fois**, chaque essai borné à **4 min** (`timeout 240`), avant d'échouer ; `timeout-minutes` de l'étape relevé en conséquence (13 min) ; aucune action GitHub ni dépendance nouvelle.

## Périmètre de fichiers
- Autorisé : `.github/workflows/ci.yml`
- Interdit : tout le reste.

## Critères d'acceptation
1. Les deux étapes réessaient jusqu'à 3 fois, 4 min par essai, et échouent avec un message clair après le 3e échec.
2. Le reste du workflow est inchangé ; le run de la PR est vert.

## Définition de terminé
- [ ] Pas de test automatisé (configuration CI) : vérification par le run de la PR
- [x] reviewer : diff relu (orchestrateur)
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- implémentation (backend, 19/11/2026) : deux étapes en `shell: bash`, 3 essais `timeout -k 10 240`, avertissement entre essais, erreur explicite au 3e échec ; `timeout-minutes` de l'étape 13, du job `e2e` 28 (au lieu de 20) pour absorber le pire cas ; YAML relu (parseur Ruby). Diff relu par l'orchestrateur.
