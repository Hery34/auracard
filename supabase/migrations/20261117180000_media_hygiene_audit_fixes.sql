-- Fiche 0027, rapport 3 (après revue et audit) — correctifs de 20261117170000_create_media_hygiene.sql et de 0021 :
--   1. `carnet.count_profile_media` : null si l'appelant ne peut pas modifier le profil ; execute pour authenticated seul.
--   2. `carnet.list_orphan_media` : délai inférieur à 1 heure (ou null) refusé en 22023.
--   3. `carnet.set_profile_image` : refuse en 22023 un nouvel objet de carnet-media créé depuis plus d'une heure
--      (candidat à la purge) ; réaffecter l'objet déjà référencé reste accepté (rejeu idempotent). Reste inchangé.
-- Rejouable (create or replace, revoke/grant explicites).

create or replace function carnet.list_orphan_media(p_older_than interval)
returns table (name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_older_than is null or p_older_than < interval '1 hour' then
    raise exception 'older_than must be at least 1 hour' using errcode = '22023';
  end if;

  return query
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
end;
$$;

revoke execute on function carnet.list_orphan_media(interval) from public, anon, authenticated;
grant execute on function carnet.list_orphan_media(interval) to service_role;

create or replace function carnet.count_profile_media(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when coalesce(carnet.can_edit_profile(p_profile_id), false) then
             (select pg_catalog.count(*)::integer
                from storage.objects o
               where o.bucket_id = 'carnet-media'
                 and o.name like p_profile_id::text || '/%')
         end;
$$;

revoke execute on function carnet.count_profile_media(uuid) from public, anon, service_role;
grant execute on function carnet.count_profile_media(uuid) to authenticated;

create or replace function carnet.set_profile_image(p_kind text, p_object_name text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_previous   text;
  v_mimetype   text;
  v_created_at timestamptz;
begin
  if p_kind is null or p_kind not in ('avatar', 'banner', 'logo') then
    raise exception 'invalid image kind' using errcode = '22023';
  end if;

  select p.id,
         case p_kind when 'avatar' then p.avatar_url when 'banner' then p.banner_url else p.logo_url end
    into v_profile_id, v_previous
    from carnet.profiles p
   where p.owner_id = (select auth.uid())
     for update;

  if not coalesce(carnet.can_edit_profile(v_profile_id), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_object_name is not null then
    if not carnet.is_valid_media_name(p_object_name)
       or pg_catalog.split_part(p_object_name, '/', 1) <> v_profile_id::text
       or pg_catalog.split_part(pg_catalog.split_part(p_object_name, '/', 2), '-', 1) <> p_kind then
      raise exception 'invalid object name' using errcode = '22023';
    end if;

    select o.metadata ->> 'mimetype', o.created_at
      into v_mimetype, v_created_at
      from storage.objects o
     where o.bucket_id = 'carnet-media' and o.name = p_object_name;

    if not found then
      raise exception 'object not found' using errcode = '22023';
    end if;

    if v_previous is distinct from p_object_name
       and v_created_at < pg_catalog.now() - interval '1 hour' then
      raise exception 'object too old' using errcode = '22023';
    end if;

    if v_mimetype is distinct from
       (case pg_catalog.split_part(p_object_name, '.', 2)
          when 'jpg'  then 'image/jpeg'
          when 'png'  then 'image/png'
          when 'webp' then 'image/webp'
        end) then
      raise exception 'object type mismatch' using errcode = '22023';
    end if;
  end if;

  if v_previous is distinct from p_object_name then
    update carnet.profiles p
       set avatar_url = case when p_kind = 'avatar' then p_object_name else p.avatar_url end,
           banner_url = case when p_kind = 'banner' then p_object_name else p.banner_url end,
           logo_url   = case when p_kind = 'logo'   then p_object_name else p.logo_url   end
     where p.id = v_profile_id;
  end if;

  return v_previous;
end;
$$;

revoke execute on function carnet.set_profile_image(text, text) from public, anon, service_role;
grant execute on function carnet.set_profile_image(text, text) to authenticated;
