-- Création d'un lot de puces NFC en stock (fiche 0025, décision 9 ; ADR 0011, précisions du 17/11/2026).
--
-- Usage, en tant que postgres, depuis la racine du dépôt (umask 077 : fichier lisible par vous seul) :
--   umask 077
--   psql "<url de la base>" -X -v count=50 -v site_url=https://carnet.example -v out=/chemin/hors/depot/puces.csv -f supabase/scripts/provision_nfc_tags.sql
--
--   count    : nombre de puces, de 1 à 500 (obligatoire)
--   site_url : origine publique du site, https://hote[:port], sans chemin (obligatoire)
--   out      : fichier CSV produit, hors du dépôt, ni vide ni « | » (obligatoire) ; colonnes url,activation_code
--
-- Création des puces et écriture du fichier dans une même transaction : si l'écriture échoue, le lot est annulé.
--
-- AVERTISSEMENT : les codes d'activation en clair sont montrés une seule fois, dans ce fichier uniquement
-- (seule leur empreinte est stockée). Détruire le fichier après impression ou remise des codes.
-- Le batch_id du lot est affiché sur la sortie standard.

\set ON_ERROR_STOP on

\if :{?count}
\else
  \warn 'Variable count absente : -v count=<1..500>'
  do $$ begin raise exception 'provisioning refused'; end $$;
\endif
\if :{?site_url}
\else
  \warn 'Variable site_url absente : -v site_url=https://...'
  do $$ begin raise exception 'provisioning refused'; end $$;
\endif
\if :{?out}
\else
  \warn 'Variable out absente : -v out=/chemin/hors/depot/puces.csv'
  do $$ begin raise exception 'provisioning refused'; end $$;
\endif

select :'count' ~ '^(500|[1-4][0-9]{2}|[1-9][0-9]?)$' as count_ok \gset
\if :count_ok
\else
  \warn 'Variable count invalide : entier de 1 à 500 attendu'
  do $$ begin raise exception 'provisioning refused'; end $$;
\endif

select :'site_url' ~ '^https://[a-z0-9.-]+(:[0-9]+)?/?$' as site_url_ok \gset
\if :site_url_ok
\else
  \warn 'Variable site_url invalide : https://hote[:port] attendu, sans chemin'
  do $$ begin raise exception 'provisioning refused'; end $$;
\endif

select :'out' <> '' and pg_catalog.left(pg_catalog.ltrim(:'out'), 1) <> '|' as out_ok \gset
\if :out_ok
\else
  \warn 'Variable out invalide : chemin de fichier attendu, ni vide ni commande « | »'
  do $$ begin raise exception 'provisioning refused'; end $$;
\endif

select pg_catalog.gen_random_uuid() as batch_id \gset
\echo 'batch_id :' :batch_id

begin;

copy (
  select pg_catalog.rtrim(:'site_url', '/') || '/t/' || p.uid as url, p.activation_code
  from carnet.provision_nfc_tags(:'batch_id'::uuid, :'count'::integer) as p
) to stdout with (format csv, header) \g :out

commit;
