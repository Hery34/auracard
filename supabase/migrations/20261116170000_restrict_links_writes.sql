-- Fiche 0022 (décision 10) / ADR 0002, 0004 — `carnet.links` : droits insert et update par colonne.
-- Contexte : audit 0022 ; `grant insert, update` sans liste de colonnes (migration 20261116120000) laissait un membre
-- poser par PostgREST `id`, `created_at`, `updated_at`, et rattacher un de ses liens à un autre de ses profils
-- (`profile_id` en update). Décision de Hery (16/11/2026) : droits par colonne, comme `carnet.profiles`.
-- `carnet.replace_links` (security invoker) reste fonctionnel : son insert n'écrit que profile_id, platform, url,
-- label, position (id et horodatages par défaut) ; son update n'écrit que platform, url, label, position
-- (updated_at posé par le trigger `links_set_updated_at`, qui n'exige pas de privilège de colonne).
-- Select, delete, RLS et politiques inchangés. Rejouable : le revoke de table retire aussi les droits par colonne.

revoke insert, update on carnet.links from authenticated;
grant insert (profile_id, platform, url, label, position) on carnet.links to authenticated;
grant update (platform, url, label, position) on carnet.links to authenticated;
