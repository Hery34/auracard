# 0010 — Usages autorisés du client `service_role`
- Statut : Remplacée par 0011 (15/11/2026)

## Contexte
`docs/rules/security.md` impose que le client `service_role` (qui contourne la RLS) vive uniquement dans `src/server/infrastructure/supabase/admin.ts` et ne soit importé que par les cas d'usage **listés dans une ADR**. Aucune ADR ne tient encore cette liste. Par ailleurs `platform` n'est pas exposé à PostgREST (fiches 0003 et 0004) : l'application ne peut écrire l'appartenance `platform.project_members` qu'au travers d'une fonction SQL `security definer` du schéma `carnet`, réservée à `service_role`.

## Décision
1. Le client `service_role` n'est utilisé que par les cas d'usage suivants, chacun appelant une fonction SQL `security definer` dédiée plutôt que des écritures directes sur les tables :
   | Cas d'usage | Fonction SQL | Fiche |
   |---|---|---|
   | `register-user` (inscription, et « compte existant d'un autre projet » qui rejoint `carnet`) | `carnet.register_member(p_user_id, p_display_name, p_slug)` : appartenance `on conflict do nothing` + profil `on conflict (owner_id) do nothing`, dans une transaction | 0006, 0007 |
   | `delete-account` (RGPD : profil → appartenance → `auth.users` si dernière appartenance) | à définir | fiche RGPD |
   | traitement de l'outbox par n8n (hors Next.js, credential n8n) | — | phase 4 |
2. L'identifiant utilisateur passé à ces fonctions provient **toujours** de la session serveur ou du retour de GoTrue, jamais d'un paramètre fourni par le client.
3. Les fonctions appelées par `service_role` ont `execute` révoqué pour `public`, `anon` et `authenticated`.
4. `is_member()` et `can_*` ne sont jamais utilisées comme contrôle d'autorisation sous `service_role` (JWT sans `sub` : toujours `false`).
5. Toute extension de cette liste passe par une nouvelle ADR qui remplace celle-ci.

## Conséquences
- Surface `service_role` minimale et auditable ; `admin.ts` importé à deux endroits au plus.
- Une fonction SQL par intention : atomicité (appartenance + profil) et idempotence garanties en base.
- Les tests d'intégration des cas d'usage exigent la clé `service_role` locale (`.env.local`, jamais lue par Claude).

## Alternatives écartées
- Exposer `platform` à PostgREST pour écrire `project_members` directement : contraire à l'ADR 0002 et aux fiches 0003/0004.
- Créer l'appartenance par un trigger sur `auth.users` : GoTrue est commun à l'instance, un trigger inscrirait tous les comptes de tous les projets dans `carnet`.
- Créer l'appartenance côté client après `signUp` : l'identité viendrait du client, interdit par `supabase.md`.
