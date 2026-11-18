-- Fiche 0030, point 8 — lecture des agrégats quotidiens d'un profil du propriétaire en une seule valeur jsonb (non
-- concernée par PGRST_DB_MAX_ROWS).
--   carnet.get_own_daily_aggregates(p_profile_id, p_from, p_to) : security invoker ; filtre
--     profile_id = p_profile_id et day ∈ [p_from, p_to] (index analytics_daily_bucket_key) ; la RLS
--     analytics_daily_select_own (inchangée) reste la garde : id d'un profil d'autrui → '[]'. Plage bornes incluses,
--     au plus 400 jours ; p_profile_id, p_from ou p_to nul, p_from > p_to ou plage trop longue → 22023.
--     Aucune ligne → '[]'. authenticated seul.
--   L'ancienne signature (date, date), présente seulement sur la pile locale, est supprimée.
-- Précondition : rôle de migration `postgres`. Rejouable.

drop function if exists carnet.get_own_daily_aggregates(date, date);

create or replace function carnet.get_own_daily_aggregates(p_profile_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_profile_id is null then
    raise exception 'invalid profile id' using errcode = '22023';
  end if;

  if p_from is null or p_to is null or p_from > p_to or p_to - p_from >= 400 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;

  return coalesce(
    (select jsonb_agg(jsonb_build_object(
              'day', d.day,
              'metric', d.metric,
              'link_id', d.link_id,
              'source', d.source,
              'value', d.value))
       from carnet.analytics_daily d
      where d.profile_id = p_profile_id
        and d.day between p_from and p_to),
    '[]'::jsonb
  );
end;
$$;

comment on function carnet.get_own_daily_aggregates(uuid, date, date) is
  'Agrégats quotidiens du profil p_profile_id sur [p_from, p_to], au plus 400 jours, sous RLS (profil d''autrui → []) ; tableau jsonb, [] si vide.';

revoke execute on function carnet.get_own_daily_aggregates(uuid, date, date) from public, anon, service_role;
grant execute on function carnet.get_own_daily_aggregates(uuid, date, date) to authenticated;
