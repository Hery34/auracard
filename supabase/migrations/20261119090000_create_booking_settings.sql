-- Fiche 0038, décision 4 (Hery, 18/11/2026) — paramétrage des rendez-vous par le propriétaire.
--   carnet.reject_ended_availability_exception : trigger after insert or update (après la RLS, comme les plafonds de
--     0036 : aucun oracle sur le profil d'autrui) ; refus 23514 d'une exception terminée (upper(range) <= now()) ; une
--     exception en cours reste acceptée. Trigger plutôt que check : now() n'est pas immuable.
--   carnet.purge_availability_exceptions(p_older_than) : exceptions terminées depuis plus de p_older_than, tous profils ;
--     renvoie le nombre supprimé ; 22023 si nul ou <= 0 ; aucun rôle applicatif (pg_cron sous postgres).
--   pg_cron : `carnet-purge-availability-exceptions` (quotidienne, 30 jours).
--   carnet.replace_availability_rules(p_profile_id, p_rules) : security invoker (RLS du propriétaire), authenticated
--     seul ; remplacement atomique de la liste des règles (suppression puis insertion, une instruction d'appel) ;
--     22023 sur la forme de p_rules, 42501 si le profil n'est pas modifiable (même liste vide) ; 23514 / CN004 / 23P01 des
--     contraintes remontés tels quels. Les règles ne sont référencées par aucune table : leurs id ne sont pas conservés.
--   carnet.reorder_event_types(p_profile_id, p_order) : security invoker, authenticated seul ; positions 0…n−1 dans
--     l'ordre donné en une instruction (event_types_profile_id_position_key deferrable initially immediate, vérifiée en
--     fin d'instruction) ; 22023 si p_order n'est pas exactement l'ensemble des types du profil ; 42501 sinon modifiable.
--   Les deux fonctions verrouillent la ligne du profil (for no key update), comme carnet.replace_links (0016).
--   Point 6 (Hery, 18/11/2026, amende la décision 17 de 0036) : carnet.enforce_availability_rules_limit et
--     carnet.enforce_availability_exceptions_limit redéfinies à l'identique, sauf le SQLSTATE : CN004 (plafond atteint)
--     au lieu de 23514 ; les autres refus restent 23514.
-- Préconditions : migrations 20261118180000 à 20261118200000 ; rôle de migration `postgres` ; pg_cron disponible.
-- Rejouable.

-- ---------------------------------------------------------------------------
-- Point 6 — plafonds de 0036 : SQLSTATE dédié CN004 (triggers inchangés)
-- ---------------------------------------------------------------------------
create or replace function carnet.enforce_availability_rules_limit()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform carnet.lock_profile_bookings(new.profile_id);

  if (select count(*) from carnet.availability_rules r where r.profile_id = new.profile_id) > 50 then
    raise exception 'availability rules limit reached' using errcode = 'CN004';
  end if;

  return null;
end;
$$;

revoke execute on function carnet.enforce_availability_rules_limit() from public, anon, authenticated, service_role;

create or replace function carnet.enforce_availability_exceptions_limit()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if pg_catalog.upper(new.range) <= pg_catalog.now() then
    return null;
  end if;

  perform carnet.lock_profile_bookings(new.profile_id);

  if (select count(*)
        from carnet.availability_exceptions x
       where x.profile_id = new.profile_id
         and x.range && pg_catalog.tstzrange(pg_catalog.now(), null)) > 200 then
    raise exception 'availability exceptions limit reached' using errcode = 'CN004';
  end if;

  return null;
end;
$$;

revoke execute on function carnet.enforce_availability_exceptions_limit() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Refus des exceptions terminées
-- ---------------------------------------------------------------------------
create or replace function carnet.reject_ended_availability_exception()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
begin
  if pg_catalog.upper(new.range) <= pg_catalog.now() then
    raise exception 'availability exception already ended' using errcode = '23514';
  end if;

  return null;
end;
$$;

revoke execute on function carnet.reject_ended_availability_exception() from public, anon, authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
     where tgname = 'availability_exceptions_not_ended' and tgrelid = 'carnet.availability_exceptions'::regclass
  ) then
    create trigger availability_exceptions_not_ended
      after insert or update on carnet.availability_exceptions
      for each row execute function carnet.reject_ended_availability_exception();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Purge (pg_cron sous `postgres`) ; renvoie le nombre d'exceptions supprimées
-- ---------------------------------------------------------------------------
create or replace function carnet.purge_availability_exceptions(p_older_than interval)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_older_than is null or p_older_than <= interval '0' then
    raise exception using
      errcode = '22023',
      message = 'purge_availability_exceptions: p_older_than must be a positive interval';
  end if;

  delete from carnet.availability_exceptions x
   where pg_catalog.upper(x.range) < pg_catalog.now() - p_older_than;

  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke execute on function carnet.purge_availability_exceptions(interval) from public, anon, authenticated, service_role;

-- Rejeu : cron.schedule met à jour la tâche du même nom (même jobid).
select cron.schedule(
  'carnet-purge-availability-exceptions',
  '10 4 * * *',
  $$select carnet.purge_availability_exceptions(interval '30 days')$$
);

-- ---------------------------------------------------------------------------
-- Remplacement atomique des règles hebdomadaires (décision 1)
-- p_rules : [{ "weekday": nombre, "start_time": "HH:MI", "end_time": "HH:MI" }, …] ('24:00' accepté en fin).
-- ---------------------------------------------------------------------------
create or replace function carnet.replace_availability_rules(p_profile_id uuid, p_rules jsonb)
returns setof carnet.availability_rules
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if p_rules is null or pg_catalog.jsonb_typeof(p_rules) <> 'array' then
    raise exception 'p_rules must be a JSON array' using errcode = '22023';
  end if;

  if exists (
       select 1
         from pg_catalog.jsonb_array_elements(p_rules) as e(value)
        where pg_catalog.jsonb_typeof(e.value) <> 'object'
           or coalesce(pg_catalog.jsonb_typeof(e.value -> 'weekday'), '') <> 'number'
           or coalesce(pg_catalog.jsonb_typeof(e.value -> 'start_time'), '') <> 'string'
           or coalesce(pg_catalog.jsonb_typeof(e.value -> 'end_time'), '') <> 'string'
     ) then
    raise exception 'each rule must be an object with a numeric weekday and string start_time, end_time'
      using errcode = '22023';
  end if;

  if not carnet.can_edit_profile(p_profile_id) then
    raise exception 'profile not editable' using errcode = '42501';
  end if;

  perform 1 from carnet.profiles p where p.id = p_profile_id for no key update;
  if not found then
    raise exception 'profile not editable' using errcode = '42501';
  end if;

  delete from carnet.availability_rules r where r.profile_id = p_profile_id;

  begin
    insert into carnet.availability_rules (profile_id, weekday, start_time, end_time)
    select p_profile_id,
           (e.value ->> 'weekday')::smallint,
           (e.value ->> 'start_time')::time,
           (e.value ->> 'end_time')::time
      from pg_catalog.jsonb_array_elements(p_rules) as e(value);
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
         or numeric_value_out_of_range then
      raise exception 'invalid weekday or time value' using errcode = '22023';
  end;

  return query
    select * from carnet.availability_rules r
     where r.profile_id = p_profile_id
     order by r.weekday, r.start_time;
end;
$$;

revoke execute on function carnet.replace_availability_rules(uuid, jsonb) from public, anon, service_role;
grant execute on function carnet.replace_availability_rules(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Réordonnancement des types (note de 0036) : une seule instruction update
-- ---------------------------------------------------------------------------
create or replace function carnet.reorder_event_types(p_profile_id uuid, p_order uuid[])
returns setof carnet.event_types
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if p_order is null then
    raise exception 'p_order must not be null' using errcode = '22023';
  end if;

  if not carnet.can_edit_profile(p_profile_id) then
    raise exception 'profile not editable' using errcode = '42501';
  end if;

  perform 1 from carnet.profiles p where p.id = p_profile_id for no key update;
  if not found then
    raise exception 'profile not editable' using errcode = '42501';
  end if;

  if coalesce(pg_catalog.array_ndims(p_order), 1) <> 1
     or pg_catalog.array_position(p_order, null) is not null
     or (select count(distinct o.id) from pg_catalog.unnest(p_order) as o(id)) <> pg_catalog.cardinality(p_order)
     or (select count(*) from carnet.event_types t where t.profile_id = p_profile_id) <> pg_catalog.cardinality(p_order)
     or exists (
          select 1
            from pg_catalog.unnest(p_order) as o(id)
           where not exists (select 1 from carnet.event_types t where t.profile_id = p_profile_id and t.id = o.id)
        ) then
    raise exception 'p_order must list each event type of the profile exactly once' using errcode = '22023';
  end if;

  update carnet.event_types t
     set position = (o.ordinality - 1)::smallint
    from pg_catalog.unnest(p_order) with ordinality as o(id, ordinality)
   where t.profile_id = p_profile_id
     and t.id = o.id
     and t.position <> (o.ordinality - 1)::smallint;

  return query
    select * from carnet.event_types t
     where t.profile_id = p_profile_id
     order by t.position;
end;
$$;

revoke execute on function carnet.reorder_event_types(uuid, uuid[]) from public, anon, service_role;
grant execute on function carnet.reorder_event_types(uuid, uuid[]) to authenticated;
