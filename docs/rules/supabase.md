# Supabase (auto-hébergé, partagé)

## Organisation de l'instance
- L'instance héberge **plusieurs projets**. Le schéma `platform` est le **registre commun** : `platform.projects` liste les projets, `platform.project_members` dit quel compte appartient à quel projet (voir ADR 0002).
- **DOIT** : tout objet du projet vit dans le schéma `carnet`. Rien dans `public`.
- **DOIT** : le schéma `carnet` est exposé à PostgREST (variable `PGRST_DB_SCHEMAS` de l'instance auto-hébergée) et le client Supabase est créé avec `db: { schema: 'carnet' }`.
- **DOIT** : le stockage utilise des *buckets* préfixés `carnet-` (`carnet-media`).
- **DOIT NE PAS** : modifier `platform` sans ADR acceptée par Hery — il est partagé avec les futurs projets.

## Authentification partagée
- `auth.users` est **commun à toute l'instance**. Être connecté ne prouve **pas** l'appartenance au projet.
- **DOIT** : toute politique RLS de `carnet` passe par une fonction qui exige `platform.is_project_member('carnet')`.
- **DOIT** : l'inscription crée l'appartenance côté serveur (cas d'usage `register-user`, client `service_role`), de façon idempotente (`on conflict do nothing`). Jamais à partir de métadonnées fournies par le client.

## Migrations
- Outil : Supabase CLI, dossier `supabase/migrations/`, appliquées sur l'instance par `supabase db push` **avec validation de Hery**.
- Règles d'idempotence : voir `idempotence.md`.

## RLS
- **DOIT** : `enable row level security` + `force row level security` sur chaque table de `carnet`.
- **DOIT** : une politique par opération (`select`, `insert`, `update`, `delete`) et par rôle (`anon`, `authenticated`) ; pas de `for all`.
- **DOIT** : les politiques appellent des fonctions d'autorisation (`carnet.can_edit_profile(profile_id)`), ce qui permettra d'ajouter les organisations (B2B) en modifiant une fonction, pas toutes les politiques.
- **DOIT** : l'accès `anon` passe par des vues ou fonctions publiques explicites (`carnet.public_profiles`) qui n'exposent que les colonnes publiées.
- **DOIT** : fonctions `security definer` avec `set search_path = ''`, noms qualifiés, `stable` quand c'est possible.

## Performance
- Index sur toutes les clés étrangères et sur les colonnes utilisées dans les politiques RLS.
- Les fonctions d'autorisation appelées dans les politiques sont enveloppées dans `(select …)` pour être évaluées une fois par requête.
- Statistiques : table d'événements brute partitionnée par mois si le volume le justifie (ADR à prévoir), agrégats quotidiens via `pg_cron`.
