-- Fiche 0004 / ADR 0002 — projet `carnet` sur l'instance Supabase partagée.
-- Crée le schéma `carnet`, enregistre le projet dans le registre `platform.projects`
-- et expose `carnet.is_member()`, socle de toutes les politiques RLS à venir (ADR 0004).
-- Aucune table métier ici (profiles : fiche 0005). Rien dans `public`. Rejouable.
-- Exposition PostgREST : `carnet` ajouté à `[api] schemas` (local) / `PGRST_DB_SCHEMAS` (instance).
-- Précondition : l'insert dans `platform.projects` (RLS forcée, aucune politique d'écriture) exige un rôle
-- `bypassrls` (postgres, celui de `supabase db push`) ; tout autre rôle échoue en 42501.

create schema if not exists carnet;

-- Décision 3 : `usage` seul (aucune table accessible par ce biais) ; pas d'`alter default privileges`,
-- chaque table et chaque fonction recevront leurs `grant` explicites dans leur fiche.
revoke all on schema carnet from public;
grant usage on schema carnet to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Registre : enregistrement du projet (donnée de référence, idempotente)
-- ---------------------------------------------------------------------------
insert into platform.projects (slug, name, db_schema)
values ('carnet', 'carnet', 'carnet')
on conflict (slug) do nothing;

-- Garde-fou : une ligne `carnet` préexistante `archived` ou avec un autre `db_schema` serait sinon conservée en silence.
do $$
begin
  if not exists (
    select 1
      from platform.projects
     where slug = 'carnet'
       and db_schema = 'carnet'
       and status = 'active'
  ) then
    raise exception 'platform.projects: ligne carnet absente ou divergente (db_schema ou status)';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Fonction d'appartenance : délègue à platform.is_project_member (security definer).
-- Décision 2 : security invoker — `authenticated` a déjà `execute` sur la fonction `platform`,
-- pas de nouvelle surface definer. Révoquée pour `anon` : aucune politique `anon` ne l'appelle.
-- ---------------------------------------------------------------------------
create or replace function carnet.is_member()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select platform.is_project_member('carnet');
$$;

revoke execute on function carnet.is_member() from public, anon;
grant execute on function carnet.is_member() to authenticated, service_role;
