-- Fiche 0009 / ADR 0011 — limitation de débit des surfaces publiques : table `carnet.rate_limits` (compteur à fenêtre fixe
-- par clé) et fonctions `carnet.consume_rate_limit` / `carnet.purge_rate_limits`, réservées au client `service_role` de Next.js.
-- La clé est une empreinte SHA-256 salée (secret serveur) calculée par l'application, jamais l'adresse brute du visiteur
-- (RGPD, décision 3) ; la base ne connaît que l'empreinte. La table n'a ni politique ni privilège : les fonctions sont la seule
-- porte (décision 1). Un rejeu consomme deux unités, par conception (décision 5, exception documentée dans l'ADR 0011).
-- Rien dans `public`. Rejouable.
-- Précondition : le rôle qui applique (postgres, bypassrls) devient propriétaire des fonctions security definer ; c'est lui
-- qui écrit dans `rate_limits` (RLS forcée, aucune politique). Horloge : `now()`, figée dans la transaction.
-- Les deux fonctions refusent des arguments nuls ou non positifs (22023) avant toute écriture.

-- ---------------------------------------------------------------------------
-- Table (décision 1) : une ligne par clé, pas d'id ni d'horodatage de création.
-- ---------------------------------------------------------------------------
create table if not exists carnet.rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  count        integer     not null,
  constraint rate_limits_pkey primary key (key),
  constraint rate_limits_key_length_check check (char_length(key) between 1 and 128),
  constraint rate_limits_count_check check (count >= 0)
);

alter table carnet.rate_limits enable row level security;
alter table carnet.rate_limits force row level security;

-- Aucune politique, aucun grant de table (pas même à service_role) : seules les fonctions ci-dessous y accèdent.
revoke all on carnet.rate_limits from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- consume_rate_limit (décision 2) : un seul insert … on conflict ; nouvelle fenêtre si l'ancienne est expirée, sinon
-- incrément ; renvoie count <= p_limit (les refus sont comptés). Arguments non positifs → 22023. Pas de pré-validation de
-- la clé : les contraintes de la table remontent telles quelles (23514 longueur, 23502 clé nulle). Pas de purge ici.
-- ---------------------------------------------------------------------------
create or replace function carnet.consume_rate_limit(p_key text, p_limit integer, p_window interval)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_limit is null or p_limit <= 0 or p_window is null or p_window <= interval '0' then
    raise exception using
      errcode = '22023',
      message = 'consume_rate_limit: p_limit must be positive and p_window a positive interval';
  end if;

  insert into carnet.rate_limits (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case
                  when rate_limits.window_start < now() - p_window then 1
                  else rate_limits.count + 1
                end,
        window_start = case
                         when rate_limits.window_start < now() - p_window then now()
                         else rate_limits.window_start
                       end
  returning rate_limits.count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke execute on function carnet.consume_rate_limit(text, integer, interval) from public, anon, authenticated;
grant execute on function carnet.consume_rate_limit(text, integer, interval) to service_role;

-- ---------------------------------------------------------------------------
-- purge_rate_limits (décision 4) : supprime les fenêtres ouvertes avant now() - p_older_than, renvoie leur nombre.
-- p_older_than nul ou non positif → 22023 (un tel intervalle effacerait les fenêtres actives). Sa planification pg_cron
-- relève de la fiche rétention.
-- ---------------------------------------------------------------------------
create or replace function carnet.purge_rate_limits(p_older_than interval)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_older_than is null or p_older_than <= interval '0' then
    raise exception using
      errcode = '22023',
      message = 'purge_rate_limits: p_older_than must be a positive interval';
  end if;

  delete from carnet.rate_limits
   where window_start < now() - p_older_than;

  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke execute on function carnet.purge_rate_limits(interval) from public, anon, authenticated;
grant execute on function carnet.purge_rate_limits(interval) to service_role;
