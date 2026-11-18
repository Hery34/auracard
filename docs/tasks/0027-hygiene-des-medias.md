# 0027 — Hygiène des médias

- Statut : done
- Agent : db-architect (fonctions SQL, politique Storage) ; integrations (workflow n8n) ; frontend (message de refus) si nécessaire ; test-engineer
- Phase : 6 (préalable à l'ouverture publique)
- ADR liées : 0002, 0006, 0011 (avenants du 17/11/2026), 0014 ; fiches 0021, 0023

## Objectif
Le bucket `carnet-media` ne peut pas se remplir : les fichiers orphelins sont purgés chaque jour, et un dossier de profil ne peut pas dépasser 6 fichiers.

## Périmètre de fichiers
- db-architect : nouvelle migration dans `supabase/migrations/`.
- integrations : `n8n/workflows/carnet-media-purge.json` (+ notice d'installation dans le même dossier).
- frontend / backend : uniquement le message affiché quand un envoi est refusé par le plafond, si l'erreur actuelle ne le distingue pas.
- test-engineer : pgTAP, tests unitaires, test de structure du workflow.
- Interdit : tout le reste.

## Décisions (validées par Hery, 17/11/2026)
1. **Purge** :
   - `carnet.list_orphan_media(p_older_than interval)`, `security definer`, `search_path = ''`, exécutable par `service_role` seulement ;
   - renvoie le nom des objets de `carnet-media` créés depuis plus de `p_older_than` qu'aucun profil ne référence (`avatar_url`, `banner_url`, `logo_url`), dossiers des profils supprimés compris ; ne touche à aucun autre bucket ;
   - workflow n8n quotidien : appel de la fonction avec `24 hours`, puis suppression par l'API Storage par lots de 100 ; rejouable (objet déjà absent = succès) ; clé `service_role` dans les identifiants n8n, jamais dans le JSON versionné.
2. **Plafond** : la politique `carnet_media_insert_own` refuse un nouvel objet quand le dossier du profil en contient déjà 6 (fonction de comptage `security definer`). Léger dépassement accepté en cas d'envois simultanés. Message : « Trop d'images en attente, réessayez plus tard. »
3. **Droits `service_role`** : conservés tels quels et documentés (ADR 0011, avenant « Droits sur les tables »).

## Critères d'acceptation
1. Un objet non référencé et plus vieux que le délai est listé ; un objet référencé, ou plus récent, ne l'est pas ; aucun objet d'un autre bucket n'est listé.
2. `anon` et `authenticated` ne peuvent pas exécuter `list_orphan_media`.
3. Le 7ᵉ envoi dans un dossier qui contient 6 objets est refusé ; le remplacement normal d'une image (4 objets au plus) reste possible.
4. Le workflow versionné ne contient aucun secret ; il appelle la fonction puis supprime par lots de 100.
5. Rejouer la purge ne produit aucune erreur.

## Règles applicables
`docs/rules/supabase.md`, `docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`

## Hors périmètre
Révocation des droits `service_role` sur les tables (écartée), quota global du bucket, purge d'autres buckets.

## Définition de terminé
- [x] Décisions validées par Hery
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `pnpm check`, intégration, `supabase test db`, build, E2E verts
- [x] reviewer et security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
1. *Contrat de test-engineer retenu (17/11/2026, arbitrages de l'orchestrateur)* : 37 pgTAP (`carnet_media_hygiene.test.sql`), 9 tests de structure du workflow et 6 tests sur la pile locale (`tests/integration/`). `list_orphan_media(p_older_than interval) returns table (name text)` ; workflow à 4 nœuds nommés (« Daily schedule », « List orphan media », « Batch by 100 », « Delete orphan media »), identifiants n8n référencés par nom, aucun secret. Arbitrages :
   - **Pas de message dédié au plafond** (écart à la décision 2) : un refus Storage par politique renvoie la même réponse (`AccessDenied`) quel que soit le motif ; le traduire en « Trop d'images en attente » serait parfois faux. L'interface normale n'atteint jamais le plafond (4 fichiers au plus) : seul un envoi direct par l'API le touche, et le message générique suffit.
   - Un objet ancien de `carnet-media` au nom hors format est orphelin et purgé.
   - Comptage du plafond en `stable` (état au début de l'instruction) : garde verts les tests 0021 d'insertion multiple, cohérent avec le « léger dépassement accepté ».
   - Tests du workflow dans `tests/integration/` (le projet vitest `unit` ne couvre que `src/`).
2. *Implémentation (17/11/2026)* : migration `20261117170000_create_media_hygiene.sql` (`list_orphan_media`, `count_profile_media` `stable`, politique `carnet_media_insert_own` recréée avec `< 6`) ; `supabase test db` 1625 verts, intégration média 6/6. Workflow `n8n/workflows/carnet-media-purge.json` + notice (03:15 Europe/Paris, lots de 100 par nœud Code, 3 nouvelles tentatives à 5 s, identifiant n8n « carnet Supabase service_role »), structure 9/9, jamais exécuté dans n8n.
   - **Hery (17/11/2026)** : l'URL de Supabase vient d'un 5ᵉ nœud « Config » (URL publique, saisie à l'import), pas de `$env` : on garde `N8N_BLOCK_ENV_ACCESS_IN_NODE` bloqué sur l'instance n8n partagée.
   - À faire trancher par l'audit : `count_profile_media` est exécutable par tout `authenticated` sur n'importe quel uuid (nombre d'objets d'un dossier d'un bucket public).
3. *Après revue et audit (17/11/2026, arbitrages de l'orchestrateur)* : vérification avant correctifs : `pnpm check` 1797, `supabase test db` 1625, intégration 146, build, E2E 286. reviewer **OK** ; security-auditor **à corriger**.
   - **À corriger (audit)** : `count_profile_media` est `security definer` et appelable par `/rpc` : tout `authenticated` de l'instance, même d'un autre projet, compte les fichiers de n'importe quel profil. → renvoie `null` si `carnet.can_edit_profile(p_profile_id)` est faux (`null < 6` refuse l'insertion) ; `grant` à `authenticated` seulement (pas `service_role`) ; tests pgTAP : `null` pour un autre membre et pour un compte d'un autre projet.
   - **Course listage/suppression** fermée : `set_profile_image` refuse un objet créé depuis plus d'une heure (un objet éligible à la purge ne peut plus devenir référencé).
   - **Garde** : `list_orphan_media` refuse `p_older_than < interval '1 hour'` (erreur `22023`).
   - **Notice n8n** : limite PostgREST de 1000 lignes (purge étalée sur plusieurs jours au-delà) ; pas de workflow d'erreur, échecs visibles dans l'historique n8n ; identifiant `service_role` restreint au domaine Supabase si la version de n8n le permet, jamais partagé avec d'autres projets.
   - **Risques acceptés** : plafond contournable par envois parallèles (comptage sans verrou, borné par le nombre de requêtes et 2 Mo chacune, excédent purgé sous 24 h) → limite de débit sur `POST /storage/v1/object` au proxy inverse, prérequis de mise en production ; téléversements résumables inachevés ni comptés ni purgés ; `move` entre profils d'un même propriétaire (sans effet au MVP, un profil par compte).
   - **Hery (17/11/2026)** : message générique conservé pour un refus de plafond ; l’abandon du message dédié de la décision 2 est validé.
4. *Clôture (17/11/2026)* : migration `20261117180000_media_hygiene_audit_fixes.sql` (`count_profile_media` → `null` sans `can_edit_profile`, `authenticated` seulement ; `list_orphan_media` refuse `null` et `< 1 hour` ; `set_profile_image` refuse un objet de plus d'une heure sauf rejeu du même objet). security-auditor **OK**, reviewer **OK** après ajout du test de rejeu (pgTAP 61 sur ce fichier). Remarques mineures non traitées : commentaire « (0 pour null) » périmé dans `20261117170000` ; `created_at` nul laisserait passer la garde (théorique). Vérification : `pnpm check` 1797, `supabase test db` 1649, intégration 146, build, E2E 286/286. Workflow n8n jamais exécuté dans une instance : à importer et tester par Hery.
