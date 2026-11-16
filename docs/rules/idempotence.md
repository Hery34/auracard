# Idempotence

**Principe** : toute opération susceptible d'être rejouée (double clic, rafraîchissement, nouvelle tentative réseau, rejeu d'un workflow, migration relancée) **DOIT** produire le même état final qu'une exécution unique, sans effet de bord dupliqué.

## Base de données — migrations
- **DOIT** : `create table if not exists`, `create index if not exists`, `create or replace function`, `drop policy if exists` puis `create policy`, `do $$ … if not exists … $$` pour les types et contraintes.
- **DOIT** : une migration appliquée n'est jamais modifiée. On en écrit une nouvelle.
- **DOIT** : les données de référence (ex. ligne `carnet` dans `platform.projects`) sont insérées par `insert … on conflict (…) do nothing` ou `do update`.

## Écritures applicatives
- **DOIT** : toute création déclenchée par un utilisateur ou un visiteur (réservation, lead, événement de statistique) porte une **clé d'idempotence** :
  - générée côté client (UUID v4) au montage du formulaire ou du composant ;
  - stockée dans une colonne `idempotency_key` avec contrainte `unique (profile_id, idempotency_key)` ;
  - en cas de conflit, le cas d'usage renvoie le résultat **déjà existant** (pas d'erreur).
- **DOIT** : les mises à jour de profil sont des `upsert` ou des `update` complets, jamais des incréments relatifs côté application.
- Les compteurs ne sont jamais incrémentés dans une ligne : on insère des événements, puis on agrège (voir statistiques).

## Événements de statistiques
- **DOIT** : chaque événement a un `id` UUID fourni par l'émetteur (beacon ou route de redirection) ; `insert … on conflict (id) do nothing`.
- L'agrégation quotidienne (`pg_cron`) recalcule une journée complète par `insert … on conflict (profile_id, day, metric) do update` : la relancer ne double rien.

## Outbox et n8n
- **DOIT** : chaque événement de l'outbox a un `id` et un `processed_at`. Le workflow :
  1. réserve l'événement (`update … set locked_at = now() where id = $1 and processed_at is null and (locked_at is null or locked_at < now() - interval '5 minutes') returning *`) ;
  2. agit ;
  3. marque `processed_at`.
- **DOIT** : les appels sortants qui le permettent (SMTP via fournisseur, CRM) transmettent l'`id` de l'événement comme clé d'idempotence du fournisseur.

## Server Actions
- **DOIT** : une Server Action rejouée avec la même clé ne crée rien de plus. Le bouton de soumission est désactivé pendant l'envoi, mais **cela ne remplace jamais** la clé côté serveur.

## Vérification
- **DOIT** : pour chaque opération rejouable, un test l'exécute deux fois et vérifie l'état final (voir `testing.md`).
