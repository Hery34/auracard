-- Fiche 0022 / ADR 0002, 0004, 0011 — `carnet.profiles` : droit update par colonne, insert direct retiré, contraintes de
-- format. Contexte : audit 0017 (risque élevé) ; `grant update` sans liste de colonnes (migration 20261115120000) laissait
-- un membre changer par PostgREST son `slug` (y compris vers un slug réservé), `owner_id`, `theme`, `avatar_url`,
-- `banner_url`, et écrire des valeurs que l'application refuse. La décision 4 de 0005 (pas de validation de format en
-- base) est levée : la base porte désormais les mêmes règles que l'application (0017) et que `links` (0016).
-- Décisions de Hery (16/11/2026) : correction immédiate ; insert direct par authenticated retiré (révocation et
-- politique `profiles_insert_own` supprimée), la création passe uniquement par `carnet.register_member` (security
-- definer, propriétaire postgres bypassrls : ne dépend ni du privilège insert d'authenticated ni de la politique ; le
-- slug initial reste posé par lui et ses insertions sont soumises aux nouvelles contraintes) ; delete direct par
-- authenticated retiré aussi (décision 8 : révocation et politique `profiles_delete_own` supprimée ; la suppression de
-- compte passera par un cas d'usage dédié). Aucune fonction ni migration ne dépend de cette politique ; la cascade
-- `auth.users` -> `carnet.profiles` -> `carnet.links` reste valable (elle ne passe ni par authenticated ni par la RLS).
-- Rejouable : revoke puis grant (le revoke de table retire aussi les droits par colonne) ; drop policy if exists ;
-- contraintes ajoutées `not valid` si absentes, puis validées si elles ne le sont pas encore.
-- Précondition production : avant `supabase db push`, vérifier qu'aucune ligne ne viole les contraintes (sinon
-- `validate constraint` échoue et la migration est annulée en entier). La requête suivante doit être exécutée en tant
-- que `postgres` (bypassrls ; sous un autre rôle, la RLS forcée la ferait renvoyer 0 ligne à tort) et renvoyer 0 ligne :
--   select id, slug,
--          website_url is not null and not (website_url ~ '^[!-~]+$'
--            and website_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#]|$)')                as bad_website_url,
--          concat_ws(' ', display_name, job_title, company, contact_email, phone)
--            ~ E'[\u0001-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'
--          or bio ~ E'[\u0001-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'
--                                                                                               as bad_text,
--          phone is not null and phone !~ '^\+?[0-9 .()-]+$'                                   as bad_phone,
--          display_name !~ '[^[:space:]]'                                                       as blank_display_name
--     from carnet.profiles
--    where (website_url is not null and not (website_url ~ '^[!-~]+$'
--            and website_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#]|$)'))
--       or concat_ws(' ', display_name, job_title, company, contact_email, phone)
--            ~ E'[\u0001-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'
--       or bio ~ E'[\u0001-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'
--       or (phone is not null and phone !~ '^\+?[0-9 .()-]+$')
--       or display_name !~ '[^[:space:]]';

-- ---------------------------------------------------------------------------
-- Privilèges (décisions 1, 2, 6 et 8)
-- ---------------------------------------------------------------------------
revoke update on carnet.profiles from authenticated;
grant update (display_name, job_title, company, bio, contact_email, phone, website_url, is_published, is_indexable)
  on carnet.profiles to authenticated;

revoke insert on carnet.profiles from authenticated;
drop policy if exists profiles_insert_own on carnet.profiles;

revoke delete on carnet.profiles from authenticated;
drop policy if exists profiles_delete_own on carnet.profiles;

-- ---------------------------------------------------------------------------
-- Contraintes de format (décisions 3, 4 et 7), indépendantes de la locale
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'carnet.profiles'::regclass and conname = 'profiles_website_url_format_check'
  ) then
    alter table carnet.profiles
      add constraint profiles_website_url_format_check check (
        website_url is null
        or (website_url ~ '^[!-~]+$'
            and website_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#]|$)')
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'carnet.profiles'::regclass and conname = 'profiles_text_charset_check'
  ) then
    alter table carnet.profiles
      add constraint profiles_text_charset_check check (
        display_name !~ E'[\u0001-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'
        and job_title !~ E'[\u0001-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'
        and company !~ E'[\u0001-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'
        and contact_email !~ E'[\u0001-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'
        and phone !~ E'[\u0001-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'
        and bio !~ E'[\u0001-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'carnet.profiles'::regclass and conname = 'profiles_phone_format_check'
  ) then
    alter table carnet.profiles
      add constraint profiles_phone_format_check check (phone ~ '^\+?[0-9 .()-]+$') not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'carnet.profiles'::regclass and conname = 'profiles_display_name_blank_check'
  ) then
    alter table carnet.profiles
      add constraint profiles_display_name_blank_check check (display_name ~ '[^[:space:]]') not valid;
  end if;
end
$$;

do $$
declare
  v_conname name;
begin
  for v_conname in
    select conname from pg_catalog.pg_constraint
     where conrelid = 'carnet.profiles'::regclass
       and not convalidated
       and conname in ('profiles_website_url_format_check', 'profiles_text_charset_check',
                       'profiles_phone_format_check', 'profiles_display_name_blank_check')
  loop
    execute format('alter table carnet.profiles validate constraint %I', v_conname);
  end loop;
end
$$;
