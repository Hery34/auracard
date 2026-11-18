# carnet-media-purge — installation

Purge quotidienne des fichiers orphelins du bucket `carnet-media` (fiche 0027, ADR 0006, ADR 0011 avenant du 17/11/2026).

## Fonctionnement
1. **Daily schedule** : tous les jours à 03:15 (fuseau `Europe/Paris`, réglage du workflow).
2. **Config** : un champ `supabaseUrl`, URL publique de l'instance Supabase ; les deux nœuds HTTP construisent leur URL à partir de ce champ.
3. **List orphan media** : `POST /rest/v1/rpc/list_orphan_media` (en-tête `Content-Profile: carnet`, corps `{ "p_older_than": "24 hours" }`).
4. **Batch by 100** : regroupe les noms par lots de 100 ; liste vide → aucun lot, le workflow s'arrête sans rien supprimer.
5. **Delete orphan media** : `DELETE /storage/v1/object/carnet-media`, corps `{ "prefixes": [...] }`. Un objet déjà absent n'est pas une erreur : le workflow est rejouable.

Les deux appels HTTP sont réessayés 3 fois (5 s d'intervalle) avant échec de l'exécution.

## Limites connues
- **1000 lignes par réponse** : PostgREST limite chaque réponse à 1000 lignes. Au-delà de 1000 orphelins, la purge s'étale sur plusieurs jours (1000 au plus par exécution).
- **Aucun workflow d'erreur** n'est configuré : un échec ne se voit que dans l'historique des exécutions de n8n.
- **Délai minimal** : la valeur `p_older_than` passée à `list_orphan_media` doit rester d'au moins 1 heure ; la fonction refuse une valeur plus courte.

## Installation
1. **Identifiant n8n** : créer un identifiant de type *Supabase API* nommé exactement `carnet Supabase service_role` :
   - *Host* : URL publique de l'instance Supabase ;
   - *Service Role Secret* : clé `service_role` de l'instance.
   n8n l'envoie dans les en-têtes `apikey` et `Authorization` ; elle n'apparaît jamais dans le workflow.
   - Restreindre l'identifiant au seul domaine de Supabase (réglage « Allowed HTTP Request Domains » de l'identifiant, si la version de n8n le propose).
   - Ne jamais partager cet identifiant avec les autres projets de l'instance n8n.
2. **Import** : *Workflows → Import from File* → `carnet-media-purge.json`.
3. **URL de l'instance** : dans le nœud « Config », remplacer la valeur d'exemple `https://supabase.example` du champ `supabaseUrl` par l'URL publique réelle de Supabase (même URL que *Host*, sans `/` final). Le workflow ne lit pas l'environnement : l'accès à l'environnement reste bloqué sur l'instance n8n.
4. **Activation** : vérifier que les deux nœuds HTTP sont rattachés à l'identifiant, puis activer le workflow (il est exporté inactif).
5. **Contrôle** : une exécution manuelle doit réussir, y compris rejouée immédiatement.

## Règles
- Aucun secret dans le dépôt : ni clé, ni JWT, ni URL propre à un environnement ; pas de `pinData` dans l'export.
- Ré-export après modification : remettre la valeur d'exemple dans « Config », retirer `pinData` et vérifier avec `pnpm test:integration tests/integration/n8n-media-purge-workflow.test.ts`.
- Rotation de la clé `service_role` : opération d'instance (ADR 0011) ; mettre à jour l'identifiant n8n en même temps que les autres projets.
