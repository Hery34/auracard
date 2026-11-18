# 0034 — Fonctions SQL pour la collecte publique

- Statut : done
- Agent : db-architect ; test-engineer (pgTAP)
- Phase : 4 (préalable à l'implémentation de 0029)
- ADR liées : 0011 ; fiches 0016, 0028, 0029

## Objectif
La route de collecte (0029) enregistre un événement à partir du **slug** d'un profil publié, en un seul appel, et la page publique connaît l'identifiant de chaque lien pour rattacher les clics.

## Périmètre de fichiers
- db-architect : nouvelle migration dans `supabase/migrations/`.
- test-engineer : `supabase/tests/`.
- Interdit : tout le reste.

## Décisions (validées par Hery, 18/11/2026)
1. **`carnet.record_public_event(p_id uuid, p_slug text, p_type text, p_source text, p_link_id uuid, p_device_class text) returns void`** : `security definer`, `search_path = ''`, `service_role` seul (avenant ADR 0011). Mêmes contrôles `22023` que `record_event` (avant toute lecture), via les fonctions `is_valid_analytics_*` ; résout le slug d'un profil **publié** et écrit l'événement (`on conflict (id) do nothing`) ; slug inconnu, profil non publié ou lien d'un autre profil : rien d'écrit, même réponse. Aucune logique dupliquée avec `record_event` (factoriser si nécessaire).
2. **`get_public_links`** renvoie aussi `id` (uuid aléatoire, sans donnée personnelle). Signature et droits inchangés pour le reste ; les tests existants qui figent les colonnes sont ajustés.

## Critères d'acceptation
1. Un événement envoyé par slug pour un profil publié est enregistré une fois, même rejoué.
2. Slug inconnu, profil non publié, lien d'un autre profil : aucune écriture, réponse identique.
3. `anon` et `authenticated` ne peuvent pas exécuter `record_public_event`.
4. `get_public_links` renvoie l'`id` de chaque lien d'un profil publié, et rien pour un profil non publié.
5. Migration rejouable.

## Règles applicables
`docs/rules/supabase.md`, `docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`

## Hors périmètre
Route, cas d'usage et page (0029).

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `supabase test db` vert, migration rejouée (Hery)
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (18/11/2026) : `carnet_public_collection.test.sql` (71 tests, 59 en échec avant implémentation) ; tests 78 de `carnet_links_schema` et 121 de `carnet_links_access` ajustés (`id` exposé, en 1re colonne).
- implémentation (18/11/2026, db-architect) : `20261118140000_create_public_collection.sql` ; contrôle 22023 extrait dans `assert_valid_analytics_event` (aucun droit applicatif), `record_event` redéfinie pour l'appeler, `record_public_event` = contrôle → résolution du slug → délégation à `record_event` (règle de publication à un seul endroit) ; `get_public_links` supprimée puis recréée avec `id`. `supabase test db` 21 fichiers, 2193 tests.
- reviewer (18/11/2026) : **OK**. Retenu : `parallel safe` sur `assert_valid_analytics_event`, commentaire d'en-tête sur le double contrôle (voulu), test des droits (comme l'audit). Pour Hery : relancer seule l'ancienne migration 0016 après celle-ci échoue (42P13, type de retour changé) ; `db reset` rejoue dans l'ordre, sans problème.
- security-auditor (18/11/2026) : **OK**. Retenu : tests `function_privs_are` à vide sur `assert_valid_analytics_event`. Confirmé pour 0029 : clé de limite sur l'adresse seule, robots filtrés avant `rpc`, réponse identique.
- Clôture (18/11/2026) : `parallel safe` et commentaire ajoutés (77 tests). Hery : rejeu `psql` de la migration sans erreur, puis `supabase test db` 21 fichiers, 2199 tests, PASS.
