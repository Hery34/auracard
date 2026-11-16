# Périmètre validé (amende le cahier des charges)

Décisions prises avec Hery le 14/11/2026. En cas de contradiction, ce document prime sur `cahier_des_charges.md`.

| Sujet | Cahier des charges d'origine | Décision |
|---|---|---|
| Carnet de contacts côté utilisateur | Ambigu (nom du projet) | **Hors périmètre.** Le produit sert à partager son profil et à suivre ses statistiques. |
| Cible | Individus + équipes B2B | **Indépendants d'abord.** Le B2B (organisations, rôles, charte imposée) viendra plus tard ; l'architecture le prépare (ADR 0004). |
| Prise de rendez-vous | Widget FluidCalendar | **Module natif**, pour consolider les données. Phase 1 sans synchronisation d'agenda, phase 2 Google / Outlook (ADR 0005). |
| Supabase | Supabase Cloud | **Instance auto-hébergée existante**, partagée entre projets : schéma dédié `carnet` + registre `platform` (ADR 0002). |
| Next.js | Non précisé | Dernière version corrigée, épinglée, veille mensuelle (ADR 0003). |
| Statistiques | Webhook n8n à chaque événement | **Insertion directe en base + agrégation `pg_cron`.** n8n réservé aux effets externes via l'outbox (ADR 0006). |
| Organisation du développement | — | Orchestrateur qui ne code pas + agents spécialisés (ADR 0001). |
