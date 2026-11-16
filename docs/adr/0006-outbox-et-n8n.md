# 0006 — Outbox transactionnelle et rôle de n8n
- Statut : Acceptée (14/11/2026)

## Contexte
Le cahier des charges faisait passer chaque scan et chaque clic par un webhook n8n. Cela ajoute de la latence et un point de panne sur le chemin le plus fréquent. Inversement, un e-mail envoyé avant la validation d'une transaction peut partir pour une réservation qui n'existe pas.

## Décision
- **Statistiques** : insertion directe dans `carnet.analytics_events` (idempotente), agrégation quotidienne par `pg_cron`. Pas de n8n.
- **Effets externes** (e-mails, rappels, CRM) : la transaction métier écrit un événement dans `carnet.outbox` ; n8n le consomme (interrogation toutes les minutes, ou déclencheur `pg_net` → webhook n8n signé), de façon idempotente.

## Conséquences
- Aucun e-mail perdu ni doublé, aucun e-mail pour une transaction annulée.
- Délai d'envoi de quelques secondes à une minute : acceptable.
- Une table de plus à surveiller (événements en échec).

## Alternatives écartées
- Webhook direct depuis l'application vers n8n : perte possible si n8n est indisponible, pas de garantie transactionnelle.
- Webhooks de base Supabase sur chaque table : couplage fort au schéma, rejeu difficile.
