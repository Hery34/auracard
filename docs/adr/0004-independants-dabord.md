# 0004 — Indépendants d'abord, B2B préparé par les fonctions d'autorisation
- Statut : Acceptée (14/11/2026)

## Contexte
Hery a choisi de cibler d'abord les indépendants. Le B2B (organisations, rôles, charte imposée) reste un objectif. Ajouter des organisations après coup oblige souvent à réécrire toutes les politiques RLS.

## Décision
- Au MVP : un profil appartient à un utilisateur (`profiles.owner_id`). Pas de table d'organisation.
- **Toutes** les politiques RLS appellent `carnet.can_edit_profile(profile_id)` / `carnet.can_read_profile_private(profile_id)` au lieu de comparer `owner_id = auth.uid()`.
- Le jour du B2B : ajout de `organizations`, `organization_members`, `profiles.organization_id` (nullable), `templates` ; seule la **définition des fonctions** change, les politiques restent.

## Conséquences
- Coût quasi nul aujourd'hui, migration B2B beaucoup plus simple.
- Légère indirection dans les politiques (performance maîtrisée par `(select …)` et `stable`).

## Alternatives écartées
- Modéliser les organisations dès maintenant (compte personnel = organisation d'un membre) : plus robuste à long terme, mais complexité immédiate inutile pour les indépendants.
