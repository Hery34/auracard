# 0023 — Suppression de compte et hygiène des médias

- Statut : todo (préalable à l'ouverture publique)
- Agent : à préciser (db-architect, backend, integrations, frontend) ; test-engineer
- Phase : 6 (recette et mise en production) — à livrer avant l'ouverture publique
- ADR liées : 0002, 0011, 0014

## Objectif
Un membre supprime son compte et toutes ses données `carnet` disparaissent (droit à l'effacement, RGPD art. 17) ; le bucket `carnet-media` ne peut pas se remplir de fichiers orphelins.

## Origine
- 0022 (décision 8) : plus de suppression directe du profil par l'API ; la suppression de compte passe par un cas d'usage dédié.
- ADR 0014 et audits de 0021 : fichiers orphelins (remplacement interrompu, erreur ambiguë, téléversement direct par l'API Storage), suppression du dossier du profil avec le compte, plafond par dossier sur l'instance partagée.

## À concevoir (décisions à soumettre à Hery)
1. Cas d'usage « supprimer mon compte » : confirmation, suppression du dossier `carnet-media/<profile_id>/` par l'API Storage, du profil, des liens (cascade), de l'appartenance `platform.project_members` ; compte `auth.users` partagé entre projets : supprimer seulement l'appartenance `carnet` ou le compte entier ? (décision de plateforme).
2. Purge périodique des objets de `carnet-media` non référencés depuis plus de N heures (n8n ou `pg_cron` + fonction serveur).
3. Plafond par dossier (nombre d'objets ou volume) pour qu'un compte ne puisse pas remplir le disque partagé par téléversement direct.
4. Droits de `service_role` sur `carnet.profiles` réduits aux besoins réels (audit 0022).

## Définition de terminé
- [ ] Décisions validées par Hery
- [ ] Tests écrits par test-engineer, échouant avant implémentation
- [ ] `pnpm check`, `supabase test db`, E2E verts
- [ ] reviewer et security-auditor : OK
- [ ] Ligne ajoutée dans `docs/journal.md`
