-- Fiche 0003 / ADR 0002 — registre commun de l'instance Supabase partagée.
-- Schéma `platform` : liste des projets et appartenance des comptes à un projet.
-- Cette migration est générique (aucune référence à `carnet`) et rejouable ; elle a vocation
-- à être déplacée telle quelle dans un dépôt « plateforme » quand un deuxième projet arrivera.
-- Le rôle qui l'applique (postgres, bypassrls) devient propriétaire de la fonction security definer.

create schema if not exists platform;

revoke all on schema platform from public;
grant usage on schema platform to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists platform.projects (
  id         uuid        not null default gen_random_uuid(),
  slug       text        not null,
  name       text        not null,
  db_schema  text        not null,
  status     text        not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_pkey primary key (id),
  constraint projects_slug_key unique (slug),
  constraint projects_db_schema_key unique (db_schema),
  constraint projects_status_check check (status in ('active', 'archived')),
  constraint projects_slug_format_check check (slug ~ '^[a-z][a-z0-9_]*$'),
  constraint projects_db_schema_format_check check (db_schema ~ '^[a-z][a-z0-9_]*$')
);

create table if not exists platform.project_members (
  project_id uuid        not null,
  user_id    uuid        not null,
  role       text        not null default 'user',
  created_at timestamptz not null default now(),
  constraint project_members_pkey primary key (project_id, user_id),
  constraint project_members_project_id_fkey
    foreign key (project_id) references platform.projects (id) on delete cascade,
  constraint project_members_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete cascade,
  constraint project_members_role_check check (role in ('owner', 'admin', 'user'))
);

create index if not exists project_members_user_id_idx
  on platform.project_members (user_id);

-- ---------------------------------------------------------------------------
-- Trigger updated_at
-- ---------------------------------------------------------------------------
create or replace function platform.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function platform.set_updated_at() from public;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_trigger
     where tgname = 'projects_set_updated_at'
       and tgrelid = 'platform.projects'::regclass
  ) then
    create trigger projects_set_updated_at
      before update on platform.projects
      for each row execute function platform.set_updated_at();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Fonction d'autorisation : toutes les politiques RLS des projets reposent dessus.
-- Vrai seulement si le compte courant est membre d'un projet `active` portant ce slug.
-- ---------------------------------------------------------------------------
create or replace function platform.is_project_member(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from platform.project_members pm
      join platform.projects p on p.id = pm.project_id
     where p.slug = p_slug
       and p.status = 'active'
       and pm.user_id = (select auth.uid())
  );
$$;

revoke execute on function platform.is_project_member(text) from public, anon;
grant execute on function platform.is_project_member(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table platform.projects enable row level security;
alter table platform.projects force row level security;
alter table platform.project_members enable row level security;
alter table platform.project_members force row level security;

drop policy if exists project_members_select_own on platform.project_members;
create policy project_members_select_own
  on platform.project_members
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Privilèges : lecture de ses appartenances pour authenticated ; écritures via service_role
-- (qui contourne la RLS) ; rien pour anon ni public.
-- ---------------------------------------------------------------------------
grant select on platform.project_members to authenticated;
grant all on all tables in schema platform to service_role;
alter default privileges in schema platform grant all on tables to service_role;
