# 0025 — Redirections NFC/QR, activation et gestion des puces

- Statut : todo (après 0024)
- Agent : backend (domaine, cas d'usage, routes, script) ; frontend (pages) ; test-engineer
- Phase : 3 (2/3)
- ADR liées : 0011, 0012

## Objectif
`/t/{uid}` et `/q/{code}` redirigent (307, `no-store`) vers `/p/{slug}` ; une puce en stock mène à une page d'activation où le propriétaire connecté saisit le code ; le tableau de bord liste ses puces (désactiver, réactiver, libérer) ; Hery crée un lot de puces par un script SQL versionné lancé avec `psql` en tant que `postgres` (choix de Hery, 17/11/2026 : aucune clé `service_role` hors du serveur), qui sort un CSV (URL complète à écrire avec son téléphone, code à remettre au client).

## À détailler avant lancement
Routes (`src/app/(public)/t/[uid]/route.ts`, `q/[code]/route.ts`), page `/t/{uid}/activer` (retour après connexion), limitation de débit (`nfc-activate` par compte et par adresse ; `nfc-resolve` par adresse), `robots.txt` (`/t/`, `/q/`), `X-Robots-Tag: noindex`, page `/tableau-de-bord/puces`, script SQL de provisioning (variables psql : nombre, URL du site ; CSV écrit hors du dépôt, `batch_id` affiché) ; régénération de `database.types.ts` en première étape (backend) ; notes de 0024 décision 10 (colonnes listées, `release` rejoué → `false` = succès).
