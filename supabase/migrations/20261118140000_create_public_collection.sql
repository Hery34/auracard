-- Fiche 0034 / ADR 0011 (avenant du 18/11/2026) — collecte publique des statistiques.
--   carnet.assert_valid_analytics_event : contrôle 22023 unique (extrait de record_event, inchangé), appelé par
--     record_event et record_public_event ; aucune lecture, aucune donnée.
--     Par slug, il s'exécute deux fois (voulu) : record_public_event valide avant toute lecture, puis record_event
--     revalide ; coût négligeable.
--   carnet.record_event : redéfinie pour appeler ce contrôle ; signature, propriétés, droits et comportement inchangés.
--   carnet.record_public_event : contrôle 22023 avant toute lecture, résolution du slug, puis délégation à record_event
--     (règle de publication, appartenance du lien, on conflict (id) do nothing). Slug nul ou inconnu : profil nul, rien
--     n'est écrit, même réponse. service_role seul.
--   carnet.get_public_links : renvoie aussi `id` en première colonne (type de retour modifié : drop puis create ; aucun
--     objet SQL n'en dépend). Corps, propriétés et droits inchangés pour le reste.
-- Précondition : rôle de migration `postgres` (bypassrls), propriétaire des fonctions security definer. Rejouable.

-- ---------------------------------------------------------------------------
-- Contrôle des paramètres d'un événement (22023), sans lecture
-- ---------------------------------------------------------------------------
create or replace function carnet.assert_valid_analytics_event(
  p_id uuid,
  p_type text,
  p_source text,
  p_link_id uuid,
  p_device_class text
)
returns void
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
begin
  if p_id is null
     or not carnet.is_valid_analytics_metric(p_type)
     or not carnet.is_valid_analytics_source(p_source)
     or not carnet.is_valid_analytics_device_class(p_device_class)
     or (p_type = 'link_click') <> (p_link_id is not null) then
    raise exception 'invalid analytics event' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function carnet.assert_valid_analytics_event(uuid, text, text, uuid, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- record_event (fiche 0028) : même comportement, contrôle factorisé
-- ---------------------------------------------------------------------------
create or replace function carnet.record_event(
  p_id uuid,
  p_profile_id uuid,
  p_type text,
  p_source text,
  p_link_id uuid,
  p_device_class text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform carnet.assert_valid_analytics_event(p_id, p_type, p_source, p_link_id, p_device_class);

  insert into carnet.analytics_events (id, profile_id, type, source, link_id, device_class)
  select p_id, p.id, p_type, p_source, p_link_id, p_device_class
    from carnet.profiles p
   where p.id = p_profile_id
     and p.is_published
     and (p_link_id is null
          or exists (select 1 from carnet.links l where l.id = p_link_id and l.profile_id = p.id))
  on conflict (id) do nothing;
end;
$$;

revoke execute on function carnet.record_event(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function carnet.record_event(uuid, uuid, text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Enregistrement par slug (décision 1)
-- ---------------------------------------------------------------------------
create or replace function carnet.record_public_event(
  p_id uuid,
  p_slug text,
  p_type text,
  p_source text,
  p_link_id uuid,
  p_device_class text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
begin
  perform carnet.assert_valid_analytics_event(p_id, p_type, p_source, p_link_id, p_device_class);

  select p.id into v_profile_id from carnet.profiles p where p.slug = p_slug;

  perform carnet.record_event(p_id, v_profile_id, p_type, p_source, p_link_id, p_device_class);
end;
$$;

revoke execute on function carnet.record_public_event(uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function carnet.record_public_event(uuid, text, text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Lecture publique des liens (décision 2) : id en première colonne
-- ---------------------------------------------------------------------------
drop function if exists carnet.get_public_links(text);

create function carnet.get_public_links(p_slug text)
returns table (id uuid, platform text, url text, label text, "position" smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.platform, l.url, l.label, l.position
    from carnet.public_profiles pp
    join carnet.profiles p on p.slug = pp.slug
    join carnet.links l on l.profile_id = p.id
   where pp.slug = p_slug
   order by l.position;
$$;

revoke execute on function carnet.get_public_links(text) from public;
grant execute on function carnet.get_public_links(text) to anon, authenticated, service_role;
