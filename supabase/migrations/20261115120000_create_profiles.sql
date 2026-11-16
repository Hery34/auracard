-- Fiche 0005 / ADR 0004 — table `carnet.profiles`, fonctions d'autorisation, vue interne et accès public unitaire.
-- Un membre de carnet possède un profil (un seul au MVP, contrainte `profiles_owner_id_key` levable) ; toutes les
-- politiques passent par `carnet.can_*` (B2B : seule la définition des fonctions changera). La seule porte
-- publique est `carnet.get_public_profile(slug)` (accès unitaire, amendement B), bâtie sur la vue interne
-- `carnet.public_profiles` (profils publiés, colonnes publiques). Rien dans `public`. Rejouable.
-- Précondition : le rôle qui applique (postgres, bypassrls) devient propriétaire des fonctions security definer
-- et de la vue ; sans `bypassrls`, les fonctions ne pourraient pas lire `profiles.owner_id` sans récursion de politique
-- et `get_public_profile` ne renverrait rien.

-- ---------------------------------------------------------------------------
-- Trigger updated_at : fonction propre à carnet (aucun couplage avec platform.set_updated_at)
-- ---------------------------------------------------------------------------
create or replace function carnet.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function carnet.set_updated_at() from public;

-- ---------------------------------------------------------------------------
-- Table (décisions 1 à 4)
-- ---------------------------------------------------------------------------
create table if not exists carnet.profiles (
  id            uuid        not null default gen_random_uuid(),
  owner_id      uuid        not null,
  slug          text        not null,
  display_name  text        not null,
  job_title     text,
  company       text,
  bio           text,
  avatar_url    text,
  banner_url    text,
  theme         jsonb       not null default '{}'::jsonb,
  contact_email text,
  phone         text,
  website_url   text,
  is_published  boolean     not null default false,
  is_indexable  boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_owner_id_fkey
    foreign key (owner_id) references auth.users (id) on delete cascade,
  constraint profiles_slug_key unique (slug),
  constraint profiles_owner_id_key unique (owner_id),
  constraint profiles_slug_format_check check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  constraint profiles_theme_check check (jsonb_typeof(theme) = 'object' and pg_column_size(theme) <= 4096),
  constraint profiles_display_name_length_check check (char_length(display_name) <= 80),
  constraint profiles_job_title_length_check check (char_length(job_title) <= 80),
  constraint profiles_company_length_check check (char_length(company) <= 80),
  constraint profiles_bio_length_check check (char_length(bio) <= 500),
  constraint profiles_contact_email_length_check check (char_length(contact_email) <= 254),
  constraint profiles_phone_length_check check (char_length(phone) <= 32),
  constraint profiles_website_url_length_check check (char_length(website_url) <= 2048),
  constraint profiles_avatar_url_length_check check (char_length(avatar_url) <= 2048),
  constraint profiles_banner_url_length_check check (char_length(banner_url) <= 2048)
);

-- Index : les contraintes uniques profiles_slug_key et profiles_owner_id_key suffisent ;
-- l'index unique sur owner_id couvre aussi la clé étrangère.

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_trigger
     where tgname = 'profiles_set_updated_at'
       and tgrelid = 'carnet.profiles'::regclass
  ) then
    create trigger profiles_set_updated_at
      before update on carnet.profiles
      for each row execute function carnet.set_updated_at();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table carnet.profiles enable row level security;
alter table carnet.profiles force row level security;

-- ---------------------------------------------------------------------------
-- Fonctions d'autorisation (décision 5). Au MVP can_edit_profile et can_read_profile_private ont la même
-- définition ; elles divergeront avec le B2B (ADR 0004). Security definer pour lire owner_id sans récursion.
-- ---------------------------------------------------------------------------
create or replace function carnet.can_edit_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select carnet.is_member()
     and exists (
       select 1
         from carnet.profiles p
        where p.id = p_profile_id
          and p.owner_id = (select auth.uid())
     );
$$;

revoke execute on function carnet.can_edit_profile(uuid) from public, anon;
grant execute on function carnet.can_edit_profile(uuid) to authenticated, service_role;

create or replace function carnet.can_read_profile_private(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select carnet.is_member()
     and exists (
       select 1
         from carnet.profiles p
        where p.id = p_profile_id
          and p.owner_id = (select auth.uid())
     );
$$;

revoke execute on function carnet.can_read_profile_private(uuid) from public, anon;
grant execute on function carnet.can_read_profile_private(uuid) to authenticated, service_role;

-- Security invoker : ne lit pas profiles, pas de nouvelle surface definer. Sert au with check d'insert et d'update.
create or replace function carnet.can_create_profile(p_owner_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select carnet.is_member() and p_owner_id = (select auth.uid());
$$;

revoke execute on function carnet.can_create_profile(uuid) from public, anon;
grant execute on function carnet.can_create_profile(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Politiques (décision 6) : une par opération, toutes `to authenticated`, aucune pour anon.
-- Deux temps : `(select carnet.is_member())` (initplan non corrélé, évalué une fois par requête) court-circuite
-- les non-membres avant tout appel definer ; la fonction can_* (corrélée à la ligne) porte la décision.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_own on carnet.profiles;
create policy profiles_select_own
  on carnet.profiles
  for select
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_read_profile_private(id)));

drop policy if exists profiles_insert_own on carnet.profiles;
create policy profiles_insert_own
  on carnet.profiles
  for insert
  to authenticated
  with check ((select carnet.is_member()) and (select carnet.can_create_profile(owner_id)));

drop policy if exists profiles_update_own on carnet.profiles;
create policy profiles_update_own
  on carnet.profiles
  for update
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(id)))
  with check ((select carnet.is_member()) and (select carnet.can_create_profile(owner_id)));

drop policy if exists profiles_delete_own on carnet.profiles;
create policy profiles_delete_own
  on carnet.profiles
  for delete
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(id)));

-- ---------------------------------------------------------------------------
-- Vue interne et accès public unitaire (décision 7, amendement B). Vue : droits du propriétaire postgres (hors RLS :
-- voulu), security_barrier, profils publiés et colonnes publiques uniquement ; aucun rôle API ne la lit directement.
-- ---------------------------------------------------------------------------
create or replace view carnet.public_profiles
with (security_barrier = true)
as
  select slug, display_name, job_title, company, bio, avatar_url, banner_url, theme,
         contact_email, phone, website_url, is_indexable
    from carnet.profiles
   where is_published;

revoke all on carnet.public_profiles from public, anon, authenticated;

-- Accès unitaire par slug (audit 0005, option B) : un profil n'est atteignable qu'en connaissant son slug, aucun annuaire énumérable.
create or replace function carnet.get_public_profile(p_slug text)
returns setof carnet.public_profiles
language sql
stable
security definer
set search_path = ''
rows 1
as $$
  select * from carnet.public_profiles where slug = p_slug;
$$;

revoke execute on function carnet.get_public_profile(text) from public;
grant execute on function carnet.get_public_profile(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privilèges table (décision 8) : authenticated filtré par RLS ; service_role tout ; rien pour anon ni public.
-- Pas d'alter default privileges, pas de publication Realtime.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on carnet.profiles to authenticated;
grant all on carnet.profiles to service_role;
