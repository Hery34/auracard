-- Fiche 0006 / ADR 0010 — fonction `carnet.register_member` : appartenance `platform.project_members` (carnet, rôle
-- `user` par défaut) + profil initial `carnet.profiles` (non publié), en une transaction idempotente. Appelée uniquement
-- par le client `service_role` de Next.js (cas d'usage `register-user`, `admin.ts`) ; l'identité est le paramètre
-- `p_user_id` (session serveur ou retour GoTrue), jamais le JWT (ADR 0010 §2 et §4). Rien dans `public`. Rejouable.
-- Précondition : le rôle qui applique (postgres, bypassrls) devient propriétaire de la fonction security definer ;
-- c'est lui qui écrit dans `platform.project_members` et `carnet.profiles` (RLS forcée, aucune politique d'insertion).
-- Erreurs (décision 2) : 23505 `profiles_slug_key` et 23514 (`check` de profiles) remontent telles quelles, la
-- transaction de la fonction est annulée en entier (aucune appartenance orpheline) ; projet carnet inactif → P0001.
-- Nuance du rejeu (décision 4) : pour un compte déjà membre, les `check` de `profiles` sont évalués avant l'arbitre
-- `on conflict (owner_id)` : un rejeu n'est tolérant qu'à des arguments valides (Zod en amont) ; un rejeu dont le slug a
-- entre-temps été pris par un autre compte ne lève pas 23505 (arbitre évalué d'abord, profil existant conservé).

-- ---------------------------------------------------------------------------
-- Fonction (décisions 1, 3, 4)
-- ---------------------------------------------------------------------------
create or replace function carnet.register_member(p_user_id uuid, p_display_name text, p_slug text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_profile_id uuid;
begin
  select id
    into v_project_id
    from platform.projects
   where slug = 'carnet'
     and status = 'active';

  if not found then
    raise exception 'carnet: projet inactif ou absent du registre';
  end if;

  insert into platform.project_members (project_id, user_id)
  values (v_project_id, p_user_id)
  on conflict do nothing;

  -- Compte déjà membre : profil conservé tel quel, p_display_name et p_slug ignorés (décision 4).
  insert into carnet.profiles (owner_id, display_name, slug)
  values (p_user_id, p_display_name, p_slug)
  on conflict (owner_id) do nothing;

  select id
    into v_profile_id
    from carnet.profiles
   where owner_id = p_user_id;

  return v_profile_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilèges (décision 5, ADR 0010 §3) : service_role seul ; rien pour public, anon ni authenticated.
-- ---------------------------------------------------------------------------
revoke execute on function carnet.register_member(uuid, text, text) from public, anon, authenticated;
grant execute on function carnet.register_member(uuid, text, text) to service_role;
