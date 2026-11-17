# 0002 — Supabase partagé : registre `platform` et schéma `carnet`
- Statut : Acceptée (14/11/2026) — conception du registre recommandée par Claude, validée par Hery.

## Contexte
L'instance Supabase auto-hébergée de Hery accueillera plusieurs projets. Elle doit d'abord exposer une table listant les projets. `carnet` est le premier : rien n'existe encore.

## Décision
1. Un schéma **`platform`**, propriété de l'instance et non d'un projet :
   - `platform.projects` (`id`, `slug` unique, `name`, `db_schema` unique, `status`, horodatages) ;
   - `platform.project_members` (`project_id`, `user_id`, `role`, `created_at`) ;
   - `platform.is_project_member(p_slug text)` (`security definer`, `stable`, `search_path = ''`).
   - RLS : lecture de ses propres appartenances ; écriture réservée à `service_role`.
2. Chaque projet a **son propre schéma** (`carnet` ici), exposé à PostgREST, et ses *buckets* de stockage préfixés.
3. `auth.users` étant commun, **toute politique RLS** d'un projet exige l'appartenance au projet.
4. L'appartenance est créée **côté serveur** à l'inscription (cas d'usage `register-user`, `service_role`, `on conflict do nothing`).
5. La migration qui crée `platform` vit dans ce dépôt pour l'instant ; elle sera déplacée dans un dépôt « plateforme » quand un deuxième projet arrivera.

## Conséquences
- Isolation nette entre projets, un même compte peut appartenir à plusieurs projets.
- Un utilisateur inscrit sur un autre projet partage le même identifiant : la page d'inscription de `carnet` doit gérer le cas « compte existant, pas encore membre ».
- Évolution possible : *custom access token hook* de GoTrue pour inscrire les projets dans le JWT et éviter une requête par vérification (ADR future si la performance l'exige).
- *Invariant d'instance (Hery, 17/11/2026, fiche 0023)* : tout projet de l'instance qui conserve des données liées à un compte `auth.users` garde sa ligne `platform.project_members` tant que ces données existent. La suppression de compte de carnet supprime `auth.users` dès qu'il ne reste aucune appartenance (ADR 0011) : un projet sans ligne verrait ses données effacées par cascade, ou bloquerait la suppression si sa clé étrangère est en `restrict`.

## Alternatives écartées
- Colonne `project_id` dans `public` : une politique oubliée = fuite entre projets.
- Instance séparée par projet : isolation maximale mais coût d'exploitation multiplié ; écartée par Hery.
