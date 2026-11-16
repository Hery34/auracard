-- Fiche 0016 / ADR 0002, 0004 — table `carnet.links`, remplacement atomique et lecture publique des liens.
-- Un propriétaire enregistre jusqu'à 12 liens ordonnés (positions 0 à 11) ; toutes les politiques passent par
-- `carnet.can_edit_profile`. `carnet.replace_links` conserve l'`id` des liens existants (statistiques de clics,
-- phase 4), refuse en 22023 tout élément dont `platform`/`url` ne sont pas des chaînes JSON ou `label` ni chaîne
-- ni `null`, et sérialise les appels concurrents par un verrou `for no key update` sur le profil (42501 si aucune
-- ligne verrouillée) (décision 8). Contraintes de caractères indépendantes de la locale : URL en ASCII imprimable,
-- hôte `[A-Za-z0-9.-]` (port facultatif), libellé sans points de code de contrôle/invisibles listés explicitement
-- (U+200C/U+200D autorisés) et non blanc. La seule porte publique
-- est `carnet.get_public_links(slug)`, bâtie sur la vue interne `carnet.public_profiles` (même visibilité que
-- `get_public_profile`, inchangée). Rien dans `public`. Rejouable.
-- Précondition : le rôle qui applique (postgres, bypassrls) devient propriétaire de `get_public_links` (security definer).

-- ---------------------------------------------------------------------------
-- Table (décisions 1 à 3 et 8)
-- ---------------------------------------------------------------------------
create table if not exists carnet.links (
  id         uuid        not null default gen_random_uuid(),
  profile_id uuid        not null,
  platform   text        not null,
  url        text        not null,
  label      text,
  position   smallint    not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint links_pkey primary key (id),
  constraint links_profile_id_fkey
    foreign key (profile_id) references carnet.profiles (id) on delete cascade,
  constraint links_profile_id_position_key unique (profile_id, position) deferrable initially immediate,
  constraint links_platform_check check (platform in (
    'linkedin', 'x', 'instagram', 'facebook', 'github', 'youtube', 'tiktok', 'whatsapp', 'website', 'document'
  )),
  constraint links_url_https_check check (url like 'https://%'),
  constraint links_url_length_check check (char_length(url) <= 2048),
  constraint links_url_charset_check check (url ~ '^[!-~]+$'),
  constraint links_url_host_check check (url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#]|$)'),
  constraint links_label_length_check check (char_length(label) between 1 and 40),
  constraint links_label_charset_check check (label !~ E'[\u0001-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'),
  constraint links_label_blank_check check (label ~ '[^[:space:]]'),
  constraint links_position_range_check check (position between 0 and 11)
);

-- Index : l'index unique de links_profile_id_position_key commence par profile_id et couvre la clé étrangère.

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_trigger
     where tgname = 'links_set_updated_at'
       and tgrelid = 'carnet.links'::regclass
  ) then
    create trigger links_set_updated_at
      before update on carnet.links
      for each row execute function carnet.set_updated_at();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- RLS (décision 4) : propriétaire seul, une politique par opération, aucune pour anon.
-- ---------------------------------------------------------------------------
alter table carnet.links enable row level security;
alter table carnet.links force row level security;

drop policy if exists links_select_own on carnet.links;
create policy links_select_own
  on carnet.links
  for select
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists links_insert_own on carnet.links;
create policy links_insert_own
  on carnet.links
  for insert
  to authenticated
  with check ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists links_update_own on carnet.links;
create policy links_update_own
  on carnet.links
  for update
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)))
  with check ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists links_delete_own on carnet.links;
create policy links_delete_own
  on carnet.links
  for delete
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

grant select, insert, update, delete on carnet.links to authenticated;
grant all on carnet.links to service_role;

-- ---------------------------------------------------------------------------
-- Remplacement atomique (décisions 5, 7 et 8) : security invoker, donc soumis à la RLS.
-- Élément avec `id` d'un lien du profil → mis à jour sur place ; sans `id` → créé ; lien absent → supprimé.
-- Position = rang dans le tableau ; clés `profile_id`, `position`, `created_at` ignorées. Une ligne inchangée
-- n'est pas réécrite (updated_at stable au rejeu). Erreurs de contraintes remontées telles quelles.
-- ---------------------------------------------------------------------------
create or replace function carnet.replace_links(p_profile_id uuid, p_links jsonb)
returns setof carnet.links
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if p_links is null or jsonb_typeof(p_links) <> 'array' then
    raise exception 'p_links must be a JSON array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_links) > 12 then
    raise exception 'at most 12 links per profile' using errcode = '23514';
  end if;

  if exists (select 1 from jsonb_array_elements(p_links) as e(value) where jsonb_typeof(e.value) <> 'object') then
    raise exception 'each link must be a JSON object' using errcode = '22023';
  end if;

  if exists (
       select 1
         from jsonb_array_elements(p_links) as e(value)
        where coalesce(jsonb_typeof(e.value -> 'platform'), '') <> 'string'
           or coalesce(jsonb_typeof(e.value -> 'url'), '') <> 'string'
           or coalesce(jsonb_typeof(e.value -> 'label'), 'null') not in ('string', 'null')
     ) then
    raise exception 'platform and url must be JSON strings, label a JSON string or null' using errcode = '22023';
  end if;

  if not carnet.can_edit_profile(p_profile_id) then
    raise exception 'profile not editable' using errcode = '42501';
  end if;

  perform 1 from carnet.profiles where id = p_profile_id for no key update;
  if not found then
    raise exception 'profile not editable' using errcode = '42501';
  end if;

  set constraints carnet.links_profile_id_position_key deferred;

  if exists (
       select 1
         from jsonb_array_elements(p_links) as e(value)
        where e.value ->> 'id' is not null
          and not exists (
            select 1
              from carnet.links l
             where l.profile_id = p_profile_id
               and l.id::text = lower(e.value ->> 'id')
          )
     )
     or (
       select count(e.value ->> 'id') <> count(distinct lower(e.value ->> 'id'))
         from jsonb_array_elements(p_links) as e(value)
     ) then
    raise exception 'link ids must be distinct and belong to the profile' using errcode = '22023';
  end if;

  delete from carnet.links l
   where l.profile_id = p_profile_id
     and not exists (
       select 1
         from jsonb_array_elements(p_links) as e(value)
        where lower(e.value ->> 'id') = l.id::text
     );

  update carnet.links l
     set platform = e.value ->> 'platform',
         url      = e.value ->> 'url',
         label    = e.value ->> 'label',
         position = (e.ordinality - 1)::smallint
    from jsonb_array_elements(p_links) with ordinality as e(value, ordinality)
   where l.profile_id = p_profile_id
     and l.id::text = lower(e.value ->> 'id')
     and (l.platform, l.url, l.label, l.position)
         is distinct from (e.value ->> 'platform', e.value ->> 'url', e.value ->> 'label', (e.ordinality - 1)::smallint);

  insert into carnet.links (profile_id, platform, url, label, position)
  select p_profile_id, e.value ->> 'platform', e.value ->> 'url', e.value ->> 'label', (e.ordinality - 1)::smallint
    from jsonb_array_elements(p_links) with ordinality as e(value, ordinality)
   where e.value ->> 'id' is null;

  set constraints carnet.links_profile_id_position_key immediate;

  return query
    select * from carnet.links l where l.profile_id = p_profile_id order by l.position;
end;
$$;

revoke execute on function carnet.replace_links(uuid, jsonb) from public, anon, service_role;
grant execute on function carnet.replace_links(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Lecture publique (décisions 6 et 7) : liens d'un profil visible par carnet.public_profiles (profils publiés),
-- jointure sur le slug (la vue n'expose pas id). Aucune colonne interne renvoyée.
-- ---------------------------------------------------------------------------
create or replace function carnet.get_public_links(p_slug text)
returns table (platform text, url text, label text, "position" smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select l.platform, l.url, l.label, l.position
    from carnet.public_profiles pp
    join carnet.profiles p on p.slug = pp.slug
    join carnet.links l on l.profile_id = p.id
   where pp.slug = p_slug
   order by l.position;
$$;

revoke execute on function carnet.get_public_links(text) from public;
grant execute on function carnet.get_public_links(text) to anon, authenticated, service_role;
