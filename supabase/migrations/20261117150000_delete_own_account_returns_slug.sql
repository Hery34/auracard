-- Fiche 0023 (rapport 2) / ADR 0002, 0011 — `delete_own_account` renvoie désormais le slug du profil supprimé
-- (pour expirer le cache public), null si aucun profil n'a été supprimé (rejeu, membre sans profil, autre projet).
-- Le type de retour change : `create or replace` ne suffit pas, la fonction est supprimée puis recréée avec ses droits.
-- Prédicat `rate_limits` réécrit, même effet : clé exactement `<portée>:<uuid de l'appelant>`.
-- Propriétés inchangées : security definer, search_path vide, propriétaire `postgres`, rejeu sans effet. Rejouable.

drop function if exists carnet.delete_own_account();

create function carnet.delete_own_account()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_slug text;
begin
  if v_user_id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  delete from carnet.profiles p
   where p.owner_id = v_user_id
  returning p.slug into v_slug;

  delete from carnet.rate_limits r
   where r.key = split_part(r.key, ':', 1) || ':' || v_user_id::text;

  delete from platform.project_members pm
   using platform.projects pr
   where pr.id = pm.project_id
     and pr.slug = 'carnet'
     and pm.user_id = v_user_id;

  return v_slug;
end;
$$;

revoke execute on function carnet.delete_own_account() from public, anon, service_role;
grant execute on function carnet.delete_own_account() to authenticated;
