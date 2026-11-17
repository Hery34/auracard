-- Fiche 0024 / ADR 0002, 0004, 0011 — puces NFC (`carnet.nfc_tags`) et QR codes (`carnet.qr_codes`).
-- Aucune écriture directe par `anon` ni `authenticated` : tout passe par des fonctions security definer. Lecture par le
-- propriétaire du profil seulement (`can_edit_profile`), jamais du hash du code d'activation (privilèges par colonne).
-- Accès public : `resolve_nfc_tag` et `resolve_qr_code` ne renvoient qu'un slug de profil publié, sans oracle entre
-- puce inconnue, désactivée ou rattachée à un profil non publié. Stock créé par `provision_nfc_tags` (`service_role`).
-- Identifiants, codes d'activation et codes QR : alphabet Crockford minuscule `0123456789abcdefghjkmnpqrstvwxyz`
-- (32 symboles), un octet aléatoire par caractère masqué sur 5 bits (`& 31`) : distribution uniforme, sans biais de
-- modulo. Collision : nouvelle tentative (10 au plus).
-- Suppression d'un profil (décision 7) : le trigger `profiles_release_nfc_tags` (before delete sur `carnet.profiles`)
-- remet ses puces en `stock` ; il est indispensable : sans lui, le `on delete set null` de la clé étrangère violerait
-- `nfc_tags_status_profile_check` (puce `assigned` sans profil) et bloquerait la suppression du profil. Le QR est
-- supprimé par cascade. Hors ce cas, retirer `profile_id` sans repasser `status` à `stock` est refusé (23514).
-- Ajout sur `carnet.profiles` : un trigger, aucune colonne ni privilège modifié.
-- Activation (fiche 0024, décision 9) : `activate_nfc_tag` consomme `carnet.consume_rate_limit` (migration
-- 20261115170000, security definer, propriétaire `postgres`) avec la clé `nfc-activate:<auth.uid()>`, 10 essais par
-- heure, avant toute lecture et tout bcrypt ; au-delà elle renvoie `rate_limited` (valeur : l'incrément n'est pas
-- annulé). La limite par adresse reste dans l'application (0025).
-- Profil de l'appelant (décision 10) : filtré par `owner_id` (index) puis validé par `carnet.can_edit_profile` (point
-- d'extension unique, ADR 0004), comme `set_profile_image`.
-- Rejouable, sans `cascade`.
-- Préconditions (instance partagée), requêtes exécutées en tant que `postgres` avant `supabase db push` :
--   1. pgcrypto installée dans le schéma `extensions` (les appels sont qualifiés `extensions.crypt`,
--      `extensions.gen_salt`, `extensions.gen_random_bytes`) ; la requête doit renvoyer `extensions` :
--        select extnamespace::regnamespace from pg_catalog.pg_extension where extname = 'pgcrypto';
--      Garde-fou ci-dessous : la migration échoue sinon. Ne pas créer ni déplacer l'extension depuis ce projet (elle est
--      partagée) : arbitrage de Hery.
--   2. Rôle d'application `postgres` (bypassrls) : il devient propriétaire des fonctions security definer, qui lisent
--      et écrivent `carnet.nfc_tags`, `carnet.qr_codes` et lisent `carnet.profiles` malgré la RLS forcée.

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_extension e
     where e.extname = 'pgcrypto'
       and e.extnamespace = 'extensions'::regnamespace
  ) then
    raise exception 'pgcrypto absente du schéma extensions';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Génération aléatoire (interne : aucun rôle API ne l'exécute)
-- ---------------------------------------------------------------------------
create or replace function carnet.random_crockford(p_length integer)
returns text
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.string_agg(
           pg_catalog.substr('0123456789abcdefghjkmnpqrstvwxyz', (pg_catalog.get_byte(b.bytes, i) & 31) + 1, 1),
           '' order by i)
    from (select extensions.gen_random_bytes(p_length) as bytes) b,
         pg_catalog.generate_series(0, p_length - 1) as i;
$$;

revoke execute on function carnet.random_crockford(integer) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Table nfc_tags (décisions 1 et 2)
-- ---------------------------------------------------------------------------
create table if not exists carnet.nfc_tags (
  id                   uuid        not null default gen_random_uuid(),
  uid                  text        not null,
  profile_id           uuid,
  status               text        not null default 'stock',
  activation_code_hash text        not null,
  batch_id             uuid        not null,
  activated_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint nfc_tags_pkey primary key (id),
  constraint nfc_tags_uid_key unique (uid),
  constraint nfc_tags_profile_id_fkey
    foreign key (profile_id) references carnet.profiles (id) on delete set null,
  constraint nfc_tags_uid_format_check check (uid ~ '^[0-9a-hjkmnp-tv-z]{12}$'),
  constraint nfc_tags_status_check check (status in ('stock', 'assigned', 'disabled')),
  constraint nfc_tags_status_profile_check check ((status = 'stock') = (profile_id is null))
);

create index if not exists nfc_tags_profile_id_idx on carnet.nfc_tags (profile_id);
create index if not exists nfc_tags_batch_id_idx on carnet.nfc_tags (batch_id);

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
     where tgname = 'nfc_tags_set_updated_at' and tgrelid = 'carnet.nfc_tags'::regclass
  ) then
    create trigger nfc_tags_set_updated_at
      before update on carnet.nfc_tags
      for each row execute function carnet.set_updated_at();
  end if;
end
$$;

-- Décision 7 : avant la suppression d'un profil, ses puces reviennent en stock (même code d'activation). Sans ce
-- trigger, le `on delete set null` violerait `nfc_tags_status_profile_check` et bloquerait la suppression ; avec lui,
-- la clé étrangère ne trouve plus aucune ligne. Security definer : la suppression peut venir de `service_role` ou de
-- la cascade `auth.users` ; seul ce cas remet une puce en stock hors `release_nfc_tag`.
create or replace function carnet.release_profile_nfc_tags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update carnet.nfc_tags t
     set status = 'stock',
         profile_id = null,
         activated_at = null
   where t.profile_id = old.id;
  return old;
end;
$$;

revoke execute on function carnet.release_profile_nfc_tags() from public, anon, authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
     where tgname = 'profiles_release_nfc_tags' and tgrelid = 'carnet.profiles'::regclass
  ) then
    create trigger profiles_release_nfc_tags
      before delete on carnet.profiles
      for each row execute function carnet.release_profile_nfc_tags();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Style du QR (décision 4) : unique validation, utilisée par la contrainte et par `set_qr_style` ; false, jamais d'erreur
-- ---------------------------------------------------------------------------
create or replace function carnet.is_valid_qr_style(p_style jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
           case when pg_catalog.jsonb_typeof(p_style) = 'object' then
             p_style ?& array['fg', 'bg', 'logo']
             and (p_style - array['fg', 'bg', 'logo']) = '{}'::jsonb
             and pg_catalog.jsonb_typeof(p_style -> 'fg') = 'string'
             and (p_style ->> 'fg') ~ '^#[0-9a-f]{6}$'
             and pg_catalog.jsonb_typeof(p_style -> 'bg') = 'string'
             and (p_style ->> 'bg') ~ '^#[0-9a-f]{6}$'
             and pg_catalog.jsonb_typeof(p_style -> 'logo') = 'boolean'
           end,
           false
         );
$$;

revoke execute on function carnet.is_valid_qr_style(jsonb) from public, anon, authenticated;
grant execute on function carnet.is_valid_qr_style(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Table qr_codes (décisions 3 et 4)
-- ---------------------------------------------------------------------------
create table if not exists carnet.qr_codes (
  id         uuid        not null default gen_random_uuid(),
  code       text        not null,
  profile_id uuid        not null,
  style      jsonb       not null default '{"fg": "#000000", "bg": "#ffffff", "logo": false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qr_codes_pkey primary key (id),
  constraint qr_codes_code_key unique (code),
  constraint qr_codes_profile_id_key unique (profile_id),
  constraint qr_codes_profile_id_fkey
    foreign key (profile_id) references carnet.profiles (id) on delete cascade,
  constraint qr_codes_code_format_check check (code ~ '^[0-9a-hjkmnp-tv-z]{8}$'),
  constraint qr_codes_style_check check (carnet.is_valid_qr_style(style))
);

-- Index : l'index unique de qr_codes_profile_id_key couvre la clé étrangère.

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
     where tgname = 'qr_codes_set_updated_at' and tgrelid = 'carnet.qr_codes'::regclass
  ) then
    create trigger qr_codes_set_updated_at
      before update on carnet.qr_codes
      for each row execute function carnet.set_updated_at();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- RLS (décision 5) : lecture par le propriétaire, aucune politique d'écriture, rien pour anon
-- ---------------------------------------------------------------------------
alter table carnet.nfc_tags enable row level security;
alter table carnet.nfc_tags force row level security;
alter table carnet.qr_codes enable row level security;
alter table carnet.qr_codes force row level security;

drop policy if exists nfc_tags_select_own on carnet.nfc_tags;
create policy nfc_tags_select_own
  on carnet.nfc_tags
  for select
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

drop policy if exists qr_codes_select_own on carnet.qr_codes;
create policy qr_codes_select_own
  on carnet.qr_codes
  for select
  to authenticated
  using ((select carnet.is_member()) and (select carnet.can_edit_profile(profile_id)));

-- Privilèges : le revoke de table retire aussi les droits par colonne (rejouable). `activation_code_hash` exclu.
revoke all on carnet.nfc_tags from public, anon, authenticated;
grant select (id, uid, profile_id, status, batch_id, activated_at, created_at, updated_at)
  on carnet.nfc_tags to authenticated;
grant all on carnet.nfc_tags to service_role;

revoke all on carnet.qr_codes from public, anon, authenticated;
grant select on carnet.qr_codes to authenticated;
grant all on carnet.qr_codes to service_role;

-- ---------------------------------------------------------------------------
-- Résolution publique (décision 6) : une ligne toujours, slug seulement pour un profil publié
-- ---------------------------------------------------------------------------
create or replace function carnet.resolve_nfc_tag(p_uid text)
returns table (state text, slug text)
language sql
stable
security definer
set search_path = ''
rows 1
as $$
  select case
           when t.status = 'assigned' and p.is_published then 'active'
           when t.status = 'stock' then 'activation'
           else 'not_found'
         end,
         case when t.status = 'assigned' and p.is_published then p.slug end
    from (select 1) as one
    left join carnet.nfc_tags t on t.uid = p_uid
    left join carnet.profiles p on p.id = t.profile_id;
$$;

revoke execute on function carnet.resolve_nfc_tag(text) from public;
grant execute on function carnet.resolve_nfc_tag(text) to anon, authenticated, service_role;

create or replace function carnet.resolve_qr_code(p_code text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.slug
    from carnet.qr_codes q
    join carnet.profiles p on p.id = q.profile_id
   where q.code = p_code
     and p.is_published;
$$;

revoke execute on function carnet.resolve_qr_code(text) from public;
grant execute on function carnet.resolve_qr_code(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Activation d'une puce en stock sur le profil de l'appelant. `invalid` unique pour puce inconnue, code faux, puce
-- d'un autre ou désactivée ; un hash bcrypt est calculé même si la puce est inconnue (pas d'écart de durée).
-- ---------------------------------------------------------------------------
create or replace function carnet.activate_nfc_tag(p_uid text, p_code text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_code       text := pg_catalog.lower(pg_catalog.replace(p_code, '-', ''));
  v_tag        record;
begin
  if not coalesce(carnet.is_member(), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if not carnet.consume_rate_limit('nfc-activate:' || auth.uid()::text, 10, interval '1 hour') then
    return 'rate_limited';
  end if;

  select p.id into v_profile_id
    from carnet.profiles p
   where p.owner_id = (select auth.uid())
     and carnet.can_edit_profile(p.id);

  if v_profile_id is null then
    return 'no_profile';
  end if;

  if v_code is null or v_code = '' then
    return 'invalid';
  end if;

  select t.id, t.status, t.profile_id, t.activation_code_hash
    into v_tag
    from carnet.nfc_tags t
   where t.uid = p_uid
     for update;

  -- Coût bcrypt identique à celui de provision_nfc_tags (gen_salt('bf', 8)) : même durée que la puce soit connue ou non.
  if not found then
    perform extensions.crypt(v_code, extensions.gen_salt('bf', 8));
    return 'invalid';
  end if;

  if v_tag.activation_code_hash is distinct from extensions.crypt(v_code, v_tag.activation_code_hash) then
    return 'invalid';
  end if;

  if v_tag.status = 'assigned' and v_tag.profile_id = v_profile_id then
    return 'already_yours';
  end if;

  if v_tag.status <> 'stock' then
    return 'invalid';
  end if;

  update carnet.nfc_tags t
     set status = 'assigned',
         profile_id = v_profile_id,
         activated_at = now()
   where t.id = v_tag.id;

  return 'activated';
end;
$$;

revoke execute on function carnet.activate_nfc_tag(text, text) from public, anon, service_role;
grant execute on function carnet.activate_nfc_tag(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Désactivation / réactivation par le propriétaire (assigned <-> disabled) ; false si puce absente ou d'un autre
-- ---------------------------------------------------------------------------
create or replace function carnet.set_nfc_tag_enabled(p_tag_id uuid, p_enabled boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_target text := case when p_enabled then 'assigned' else 'disabled' end;
begin
  if not coalesce(carnet.is_member(), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_enabled is null then
    raise exception 'invalid enabled flag' using errcode = '22023';
  end if;

  select t.status into v_status
    from carnet.nfc_tags t
   where t.id = p_tag_id
     and carnet.can_edit_profile(t.profile_id)
     for update;

  if not found then
    return false;
  end if;

  if v_status <> v_target then
    update carnet.nfc_tags t set status = v_target where t.id = p_tag_id;
  end if;

  return true;
end;
$$;

revoke execute on function carnet.set_nfc_tag_enabled(uuid, boolean) from public, anon, service_role;
grant execute on function carnet.set_nfc_tag_enabled(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Libération par le propriétaire : retour explicite en stock, même code d'activation ; false si puce absente,
-- d'un autre ou déjà libérée
-- ---------------------------------------------------------------------------
create or replace function carnet.release_nfc_tag(p_tag_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not coalesce(carnet.is_member(), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update carnet.nfc_tags t
     set status = 'stock',
         profile_id = null,
         activated_at = null
   where t.id = p_tag_id
     and carnet.can_edit_profile(t.profile_id);

  return found;
end;
$$;

revoke execute on function carnet.release_nfc_tag(uuid) from public, anon, service_role;
grant execute on function carnet.release_nfc_tag(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- QR code du profil de l'appelant, créé si absent. `on conflict (profile_id) do nothing` : profil déjà doté (rejeu ou
-- création concurrente) -> lecture de la ligne existante ; collision sur `qr_codes_code_key` (seule unique_violation
-- interceptée) -> nouvelle tentative. Membre sans profil : 42501.
-- ---------------------------------------------------------------------------
create or replace function carnet.ensure_qr_code()
returns carnet.qr_codes
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_row        carnet.qr_codes;
  v_constraint text;
begin
  if not coalesce(carnet.is_member(), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select p.id into v_profile_id
    from carnet.profiles p
   where p.owner_id = (select auth.uid())
     and carnet.can_edit_profile(p.id);

  if v_profile_id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  for i in 1..10 loop
    begin
      insert into carnet.qr_codes (code, profile_id)
      values (carnet.random_crockford(8), v_profile_id)
      on conflict (profile_id) do nothing;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'qr_codes_code_key' then
        raise;
      end if;
    end;

    select * into v_row from carnet.qr_codes q where q.profile_id = v_profile_id;
    if found then
      return v_row;
    end if;
  end loop;

  raise exception 'qr code generation failed' using errcode = '23505';
end;
$$;

revoke execute on function carnet.ensure_qr_code() from public, anon, service_role;
grant execute on function carnet.ensure_qr_code() to authenticated;

-- ---------------------------------------------------------------------------
-- Style du QR de l'appelant (créé si absent) ; 22023 si style invalide ; aucune écriture si inchangé
-- ---------------------------------------------------------------------------
create or replace function carnet.set_qr_style(p_style jsonb)
returns carnet.qr_codes
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row carnet.qr_codes;
begin
  if not coalesce(carnet.is_member(), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if not carnet.is_valid_qr_style(p_style) then
    raise exception 'invalid qr style' using errcode = '22023';
  end if;

  v_row := carnet.ensure_qr_code();

  if v_row.style is distinct from p_style then
    update carnet.qr_codes q
       set style = p_style
     where q.id = v_row.id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke execute on function carnet.set_qr_style(jsonb) from public, anon, service_role;
grant execute on function carnet.set_qr_style(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Création d'un lot de puces en stock (service_role) ; codes en clair renvoyés une seule fois (`XXXXX-XXXXX`,
-- majuscules ; l'activation est insensible à la casse et au tiret).
-- Un `batch_id` déjà utilisé est refusé ; verrou consultatif contre deux appels simultanés du même lot.
-- ---------------------------------------------------------------------------
create or replace function carnet.provision_nfc_tags(p_batch_id uuid, p_count integer)
returns table (uid text, activation_code text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  text;
  v_code text;
  v_done boolean;
begin
  if p_batch_id is null or p_count is null or p_count < 1 or p_count > 500 then
    raise exception 'invalid batch' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carnet.nfc_tags:' || p_batch_id::text, 0));

  if exists (select 1 from carnet.nfc_tags t where t.batch_id = p_batch_id) then
    raise exception 'batch already provisioned' using errcode = '23505';
  end if;

  for n in 1..p_count loop
    v_done := false;
    for attempt in 1..10 loop
      v_uid := carnet.random_crockford(12);
      v_code := carnet.random_crockford(10);

      insert into carnet.nfc_tags (uid, activation_code_hash, batch_id)
      -- Coût bcrypt identique à celui du calcul factice de activate_nfc_tag (gen_salt('bf', 8)).
      values (v_uid, extensions.crypt(v_code, extensions.gen_salt('bf', 8)), p_batch_id)
      on conflict on constraint nfc_tags_uid_key do nothing;

      if found then
        v_done := true;
        exit;
      end if;
    end loop;

    if not v_done then
      raise exception 'nfc tag uid generation failed' using errcode = '23505';
    end if;

    uid := v_uid;
    activation_code := pg_catalog.upper(pg_catalog.substr(v_code, 1, 5) || '-' || pg_catalog.substr(v_code, 6, 5));
    return next;
  end loop;
end;
$$;

revoke execute on function carnet.provision_nfc_tags(uuid, integer) from public, anon, authenticated;
grant execute on function carnet.provision_nfc_tags(uuid, integer) to service_role;
