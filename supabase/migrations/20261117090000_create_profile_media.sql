-- Fiche 0021 / ADR 0014 (Acceptée), 0002, 0004 — médias du profil dans Supabase Storage : colonne `logo_url`, bucket
-- public `carnet-media`, politiques d'écriture de son dossier par le propriétaire du profil, enregistrement de la
-- référence par `carnet.set_profile_image`. Les colonnes `avatar_url`, `banner_url`, `logo_url` contiennent le nom de
-- l'objet (`<profile_id>/<kind>-<uuid>.<ext>`), pas une URL ; aucune n'est modifiable directement par `authenticated`
-- (0022) : seule `set_profile_image` (security definer) les écrit. Elle ne supprime jamais de ligne de
-- `storage.objects` : la Server Action supprime l'ancien fichier par l'API Storage.
-- Décision 10 : `carnet.is_valid_media_name` est l'unique validation du format (politiques d'écriture,
-- `set_profile_image`, contrainte `profiles_media_names_check`).
-- Portée dans le schéma `storage` (partagé par tous les projets de l'instance, modification validée par Hery le
-- 17/11/2026) : une ligne de `storage.buckets` (`carnet-media`) et quatre politiques `carnet_media_*` sur
-- `storage.objects`, toutes `to authenticated` et limitées à `bucket_id = 'carnet-media'`. Aucun privilège, aucune
-- autre politique ni aucun autre bucket n'est modifié. Aucune politique `anon` : la lecture passe par l'URL publique
-- du bucket ; rien ne permet à `anon` de lister le bucket. Rejouable.
-- Précondition (rôle d'application `postgres`, celui de `supabase db push`) : droit de créer des politiques sur
-- `storage.objects` et d'écrire dans `storage.buckets` ; `set_profile_image`, dont il devient propriétaire, lit
-- `storage.objects` (bypassrls) et `carnet.profiles`.
-- Préconditions production, avant `supabase db push`, requêtes exécutées en tant que `postgres` (fiche 0021, déc. 10) :
--   1. Politiques des tables Storage partagées. Les politiques permissives se combinent par « OU » : une politique
--      d'un autre projet sans filtre sur `bucket_id` s'appliquerait aussi à `carnet-media`. `roles = {public}`
--      désigne tous les rôles, `authenticated` et `anon` compris. Une politique `RESTRICTIVE` s'ajoute par « ET » à
--      toutes les autres et peut bloquer ou conditionner `carnet-media`. Chaque ligne doit restreindre `bucket_id`
--      (dans `qual` et `with_check`) à un bucket autre que `carnet-media`, ou n'avoir aucun effet sur lui ; sinon
--      arrêt et arbitrage de Hery. `s3_multipart_uploads*` ne concernent que les instances où S3 est activé :
--        select tablename, policyname, permissive, roles, cmd, qual, with_check
--          from pg_catalog.pg_policies
--         where schemaname = 'storage'
--           and tablename in ('objects', 'buckets', 's3_multipart_uploads', 's3_multipart_uploads_parts')
--         order by tablename, policyname;
--   2. Le bucket ne doit pas déjà appartenir à un autre projet (l'upsert ci-dessous en reprendrait la configuration) ;
--      la requête suivante doit renvoyer 0 ligne :
--        select id, name, public, created_at from storage.buckets where id = 'carnet-media';
--   3. Valeurs existantes d'`avatar_url` et `banner_url` conformes au format (sinon `validate constraint
--      profiles_media_names_check` échoue) ; la requête suivante doit renvoyer 0 ligne :
--        select p.id, p.avatar_url, p.banner_url
--          from carnet.profiles p
--         where (p.avatar_url is not null and not (
--                  p.avatar_url ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
--                  and split_part(p.avatar_url, '/', 1) = p.id::text))
--            or (p.banner_url is not null and not (
--                  p.banner_url ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/banner-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
--                  and split_part(p.banner_url, '/', 1) = p.id::text));
--   4. Version de `storage-api` identique à la locale (même image Docker ; même dernière migration Storage) :
--        select id, name, executed_at from storage.migrations order by id desc limit 1;

-- ---------------------------------------------------------------------------
-- Colonne logo_url (même règle que avatar_url et banner_url ; aucun grant update de colonne pour authenticated)
-- ---------------------------------------------------------------------------
alter table carnet.profiles add column if not exists logo_url text;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'carnet.profiles'::regclass and conname = 'profiles_logo_url_length_check'
  ) then
    alter table carnet.profiles
      add constraint profiles_logo_url_length_check check (char_length(logo_url) <= 2048);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Validation d'un nom d'objet `<uuid>/<kind>-<uuid>.<ext>` (UUID en minuscules) ; false pour null, jamais d'erreur
-- ---------------------------------------------------------------------------
create or replace function carnet.is_valid_media_name(p_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
           p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(avatar|banner|logo)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$',
           false
         );
$$;

revoke execute on function carnet.is_valid_media_name(text) from public, anon;
grant execute on function carnet.is_valid_media_name(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Colonnes d'images : nulles ou nom valide, dans le dossier du profil, du type de la colonne
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'carnet.profiles'::regclass and conname = 'profiles_media_names_check'
  ) then
    alter table carnet.profiles
      add constraint profiles_media_names_check check (
        (avatar_url is null or (carnet.is_valid_media_name(avatar_url)
                                and split_part(avatar_url, '/', 1) = id::text
                                and split_part(split_part(avatar_url, '/', 2), '-', 1) = 'avatar'))
        and (banner_url is null or (carnet.is_valid_media_name(banner_url)
                                    and split_part(banner_url, '/', 1) = id::text
                                    and split_part(split_part(banner_url, '/', 2), '-', 1) = 'banner'))
        and (logo_url is null or (carnet.is_valid_media_name(logo_url)
                                  and split_part(logo_url, '/', 1) = id::text
                                  and split_part(split_part(logo_url, '/', 2), '-', 1) = 'logo'))
      ) not valid;
  end if;
end
$$;

alter table carnet.profiles validate constraint profiles_media_names_check;

-- ---------------------------------------------------------------------------
-- Bucket (ADR 0014, décision 1)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('carnet-media', 'carnet-media', true, 2097152, '{image/jpeg,image/png,image/webp}')
on conflict (id) do update
  set name               = excluded.name,
      public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Profil désigné par un nom d'objet : premier segment s'il est un UUID en minuscules, sinon null (jamais d'erreur de conversion)
-- ---------------------------------------------------------------------------
create or replace function carnet.media_profile_id(p_object_name text)
returns uuid
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
           when pg_catalog.split_part(p_object_name, '/', 1)
                ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then pg_catalog.split_part(p_object_name, '/', 1)::uuid
         end;
$$;

revoke execute on function carnet.media_profile_id(text) from public, anon;
grant execute on function carnet.media_profile_id(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Politiques storage.objects (ADR 0014, décision 2 ; fiche 0021, décision 10) : appartenance au projet, puis
-- bucket, puis profil modifiable ; nom valide exigé à l'écriture. Une par opération
-- ---------------------------------------------------------------------------
drop policy if exists carnet_media_select_own on storage.objects;
create policy carnet_media_select_own
  on storage.objects
  for select
  to authenticated
  using ((select carnet.is_member()) and bucket_id = 'carnet-media' and (select carnet.can_edit_profile(carnet.media_profile_id(name))));

drop policy if exists carnet_media_insert_own on storage.objects;
create policy carnet_media_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    (select carnet.is_member()) and bucket_id = 'carnet-media' and (select carnet.can_edit_profile(carnet.media_profile_id(name)))
    and carnet.is_valid_media_name(name)
  );

drop policy if exists carnet_media_update_own on storage.objects;
create policy carnet_media_update_own
  on storage.objects
  for update
  to authenticated
  using ((select carnet.is_member()) and bucket_id = 'carnet-media' and (select carnet.can_edit_profile(carnet.media_profile_id(name))))
  with check (
    (select carnet.is_member()) and bucket_id = 'carnet-media' and (select carnet.can_edit_profile(carnet.media_profile_id(name)))
    and carnet.is_valid_media_name(name)
  );

drop policy if exists carnet_media_delete_own on storage.objects;
create policy carnet_media_delete_own
  on storage.objects
  for delete
  to authenticated
  using ((select carnet.is_member()) and bucket_id = 'carnet-media' and (select carnet.can_edit_profile(carnet.media_profile_id(name))));

-- ---------------------------------------------------------------------------
-- Enregistrement de la référence d'une image du profil de l'appelant ; renvoie l'ancien nom d'objet (ou null)
-- ---------------------------------------------------------------------------
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

    select o.metadata ->> 'mimetype'
      into v_mimetype
      from storage.objects o
     where o.bucket_id = 'carnet-media' and o.name = p_object_name;

    if not found then
      raise exception 'object not found' using errcode = '22023';
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
