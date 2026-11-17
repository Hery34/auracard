# Architecture Decision Records

Une décision structurante = un fichier `NNNN-titre.md`. Statuts : **Proposée** → **Acceptée** (par Hery) → éventuellement **Remplacée par NNNN**.
Une ADR acceptée n'est jamais réécrite : on en écrit une nouvelle qui la remplace.

| N° | Titre | Statut |
|---|---|---|
| 0001 | Orchestrateur et agents spécialisés | Acceptée |
| 0002 | Supabase partagé : registre `platform` et schéma `carnet` | Acceptée |
| 0003 | Politique de version Next.js | Acceptée |
| 0004 | Indépendants d'abord, B2B préparé par les fonctions d'autorisation | Acceptée |
| 0005 | Module de rendez-vous natif en deux phases | Acceptée |
| 0006 | Outbox transactionnelle et rôle de n8n | Acceptée |
| 0007 | Hébergement Next.js sur un VPS administré par EasyPanel | Acceptée |
| 0008 | Défi anti-robot : Cloudflare Turnstile | Proposée |
| 0009 | Fournisseur d'envoi d'e-mails : Infomaniak | Acceptée |
| 0010 | Usages autorisés du client `service_role` | Remplacée par 0011 |
| 0011 | Usages autorisés du client `service_role` (v2 : limitation de débit) | Acceptée |
| 0012 | Emplacement des Server Actions et frontière `src/app` → `src/server` | Acceptée |
| 0013 | Shadcn/ui, thème AuraCard et dossier `src/ui/lib/` | Acceptée |
| 0014 | Stockage des médias du profil (Supabase Storage) | Acceptée |
| 0015 | Domaine public `auracard.fr` | Acceptée |

## Modèle
```
# NNNN — Titre
- Statut : Proposée | Acceptée (date) | Remplacée par NNNN
## Contexte
## Décision
## Conséquences (positives, négatives, risques)
## Alternatives écartées
```
