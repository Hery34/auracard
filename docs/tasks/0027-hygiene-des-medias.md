# 0027 — Hygiène des médias et droits `service_role`

- Statut : todo (après 0023)
- Agent : db-architect ; integrations (workflow n8n) ; test-engineer
- Phase : 6 (préalable à l'ouverture publique)
- ADR liées : 0006, 0011 (avenant du 17/11/2026), 0014 ; fiches 0021, 0022, 0023

## Objectif
Le bucket `carnet-media` ne peut pas se remplir de fichiers orphelins, et `service_role` n'a sur `carnet` que les droits dont il a besoin.

## Décisions (validées par Hery, 17/11/2026)
1. **Purge quotidienne par n8n** : une fonction SQL (`service_role` uniquement) liste les objets de `carnet-media` non référencés par un profil (`avatar_url`, `banner_url`, `logo_url`) et créés depuis plus de 24 h ; n8n les supprime par l'API Storage. Clé `service_role` dans les identifiants n8n.
2. **Plafond** : 6 objets au plus par dossier de profil (12 Mo), imposé par la politique d'insertion de `storage.objects` ; léger dépassement possible en cas d'envois simultanés, accepté.
3. **Droits `service_role`** sur `carnet.profiles` et `carnet.links` réduits aux besoins réels (audit 0022) ; liste établie par db-architect à partir de l'ADR 0011.

## À détailler avant lancement
Périmètre de fichiers, critères d'acceptation, format du workflow dans `n8n/workflows/`.
