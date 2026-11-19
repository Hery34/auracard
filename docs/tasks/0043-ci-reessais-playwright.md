# 0043 — CI : réessais de l'installation Playwright

- Statut : done
- Agent : backend (`.github/`)
- Phase : 5 (outillage)
- ADR liées : — ; fiches 0013, 0035

## Objectif
Une lenteur passagère du miroir Ubuntu ne fait plus échouer le job `e2e` : l'installation des dépendances Playwright est retentée avant d'échouer.

## Contexte
Runs #79 (PR 0032) et #83 (`main`, 19/11/2026) : `pnpm exec playwright install-deps chromium webkit` a dépassé la limite de 5 min (0035) en téléchargeant les paquets `apt` depuis `azure.archive.ubuntu.com` ; une relance passe.

## Décision (Hery, 19/11/2026)
Les deux étapes d'installation Playwright (`install --with-deps` et `install-deps`) sont exécutées jusqu'à **3 fois**, chaque essai borné à **4 min** (`timeout 240`), avant d'échouer ; `timeout-minutes` de l'étape relevé en conséquence (13 min) ; aucune action GitHub ni dépendance nouvelle. *Ajout (revue 0039, 19/11/2026)* : `sudo dpkg --configure -a || true` avant chaque nouvel essai (à partir du 2e), au cas où un `apt` interrompu laisserait dpkg verrouillé.

## Correctif (19/11/2026, run #84 de la PR #27)
`timeout` tuait `pnpm` mais pas l'`apt-get` lancé en `sudo` (pid survivant), qui gardait le verrou `dpkg` : les essais 2 et 3 échouaient aussitôt (`Could not get lock /var/lib/dpkg/lock-frontend`, code 100). Correctif (orchestrateur, tactique) :
- avant chaque nouvel essai : `sudo pkill -f -9 'apt-get|apt.systemd|dpkg' || true`, attente brève de la libération du verrou, puis `sudo dpkg --configure -a || true` ;
- configuration `apt` au début du job (`/etc/apt/apt.conf.d/80-ci-retries`) : `Acquire::Retries "3"; Acquire::http::Timeout "30"; Acquire::https::Timeout "30";` — un téléchargement bloqué est coupé et repris par `apt` lui-même.

- Autorisé : `.github/workflows/ci.yml`
- Interdit : tout le reste.

## Critères d'acceptation
1. Les deux étapes réessaient jusqu'à 3 fois, 4 min par essai, et échouent avec un message clair après le 3e échec.
2. Le reste du workflow est inchangé ; le run de la PR est vert.

## Définition de terminé
- [x] Pas de test automatisé (configuration CI) : run de la PR #27 vert (installation réussie au 1er essai en 26 s : **le chemin de réessai n'a pas encore été exercé en conditions réelles**, à surveiller au prochain incident du miroir)
- [x] reviewer : diff relu (orchestrateur)
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- implémentation (backend, 19/11/2026) : deux étapes en `shell: bash`, 3 essais `timeout -k 10 240`, avertissement entre essais, erreur explicite au 3e échec ; `timeout-minutes` de l'étape 13, du job `e2e` 28 (au lieu de 20) pour absorber le pire cas ; YAML relu (parseur Ruby). Diff relu par l'orchestrateur. Puis `dpkg --configure -a` à partir du 2e essai (revue 0039 : OK). Correctif run #84 : arrêt des `apt-get`/`dpkg` restants (motif `[a]pt-get|[a]pt.systemd|[d]pkg`), attente bornée du verrou, `dpkg --configure -a`, et `apt` configuré (`Acquire::Retries 3`, délais 30 s).
