-- Fiche 0023 / ADR 0002, 0011 (avenant du 17/11/2026) — suppression de compte (RGPD art. 17).
-- `delete_own_account` (authenticated) : efface les données `carnet` de l'appelant (`auth.uid()`, aucun paramètre) :
-- son profil (liens et QR par cascade, puces remises en `stock` par le trigger `profiles_release_nfc_tags` de 0024),
-- ses compteurs `carnet.rate_limits` en clair `<portée>:<uuid>` et sa seule appartenance `platform.project_members` au
-- projet `carnet`. Pas de garde `carnet.is_member()` : un profil restant sans appartenance est supprimé quand même.
-- Les clés empreintes HMAC ne contiennent pas l'uuid : elles restent jusqu'à la purge sous 24 h (fiche 0010).
-- Ne touche ni `auth.users` (adaptateur admin, si orphelin) ni `storage.objects` (API Storage, étape 1).
-- Rejeu, ou compte sans rien dans `carnet` : succès sans effet. Sans `sub` dans les claims : 42501, rien n'est supprimé.
-- `is_orphan_account` (service_role) : true ssi aucune appartenance, quel que soit le projet ou son statut.
-- Propriétaire `postgres` (bypassrls), comme les autres fonctions security definer. Rejouable, sans `cascade`.

create or replace function carnet.delete_own_account()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  delete from carnet.profiles p
   where p.owner_id = v_user_id;

  delete from carnet.rate_limits r
   where r.key like '%:' || v_user_id::text
     and strpos(left(r.key, char_length(r.key) - 37), ':') = 0;

  delete from platform.project_members pm
   using platform.projects pr
   where pr.id = pm.project_id
     and pr.slug = 'carnet'
     and pm.user_id = v_user_id;
end;
$$;

revoke execute on function carnet.delete_own_account() from public, anon, service_role;
grant execute on function carnet.delete_own_account() to authenticated;

create or replace function carnet.is_orphan_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
      from platform.project_members pm
     where pm.user_id = p_user_id
  );
$$;

revoke execute on function carnet.is_orphan_account(uuid) from public, anon, authenticated;
grant execute on function carnet.is_orphan_account(uuid) to service_role;
