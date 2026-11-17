-- Fiche 0027 / ADR 0014, 0011 (avenants du 17/11/2026) — hygiène du bucket `carnet-media` :
--   1. `carnet.list_orphan_media` : noms des objets de `carnet-media` plus vieux que le délai et qu'aucun profil ne
--      référence (avatar_url, banner_url, logo_url), dossiers des profils supprimés et noms hors format compris.
--      Lecture seule ; exécutable par `service_role` seulement (workflow n8n de purge, qui supprime par l'API Storage).
--   2. Plafond de 6 objets par dossier de profil dans la politique `carnet_media_insert_own` (conditions de 0021
--      inchangées). `carnet.count_profile_media` est `stable` : le comptage voit l'état au début de l'instruction ;
--      un léger dépassement est accepté en cas d'envois simultanés (décision 2).
-- Portée dans le schéma `storage` : seule la politique `carnet_media_insert_own` est recréée. Rejouable.

-- ---------------------------------------------------------------------------
-- Objets orphelins de carnet-media (aucun autre bucket)
-- ---------------------------------------------------------------------------
create or replace function carnet.list_orphan_media(p_older_than interval)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'carnet-media'
     and o.created_at < pg_catalog.now() - p_older_than
     and not exists (
       select 1
         from carnet.profiles p
        where p.id = carnet.media_profile_id(o.name)
          and o.name in (p.avatar_url, p.banner_url, p.logo_url)
     );
$$;

revoke execute on function carnet.list_orphan_media(interval) from public, anon, authenticated;
grant execute on function carnet.list_orphan_media(interval) to service_role;

-- ---------------------------------------------------------------------------
-- Nombre d'objets de carnet-media dans le dossier d'un profil (0 pour null)
-- ---------------------------------------------------------------------------
create or replace function carnet.count_profile_media(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.count(*)::integer
    from storage.objects o
   where o.bucket_id = 'carnet-media'
     and o.name like p_profile_id::text || '/%';
$$;

revoke execute on function carnet.count_profile_media(uuid) from public, anon;
grant execute on function carnet.count_profile_media(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Politique d'envoi : conditions de 0021 + plafond de 6 objets par dossier
-- ---------------------------------------------------------------------------
drop policy if exists carnet_media_insert_own on storage.objects;
create policy carnet_media_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    (select carnet.is_member()) and bucket_id = 'carnet-media' and (select carnet.can_edit_profile(carnet.media_profile_id(name)))
    and carnet.is_valid_media_name(name)
    and (select carnet.count_profile_media(carnet.media_profile_id(name))) < 6
  );
