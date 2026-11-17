-- Fiche 0021, décision 9 / ADR 0014 — `logo_url` (nom d'objet du bucket `carnet-media`) rendue publique au même titre
-- que `avatar_url` et `banner_url` : colonne ajoutée en fin de la vue interne `carnet.public_profiles`
-- (`security_barrier` conservé, profils publiés et colonnes publiques uniquement, aucun privilège pour les rôles API).
-- Ajout en fin de vue : `create or replace view` suffit (règle de la fiche 0005). `carnet.get_public_profile` renvoie
-- `setof carnet.public_profiles` : son type de retour est le type ligne de la vue, dont l'identité ne change pas ; son
-- corps (`select *`, fonction sql non atomique, analysé à l'exécution) renvoie la nouvelle colonne sans être recréé,
-- et ses privilèges `execute` restent intacts. `carnet.get_public_links` ne lit que `pp.slug` : inchangée.
-- Rejouable : la seconde application remplace la vue par une définition identique.

create or replace view carnet.public_profiles
with (security_barrier = true)
as
  select slug, display_name, job_title, company, bio, avatar_url, banner_url, theme,
         contact_email, phone, website_url, is_indexable, logo_url
    from carnet.profiles
   where is_published;

revoke all on carnet.public_profiles from public, anon, authenticated;
