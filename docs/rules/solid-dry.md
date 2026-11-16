# SOLID et DRY

## S — Responsabilité unique
- **DOIT** : un cas d'usage par fichier (`src/server/use-cases/update-profile.ts`). Il orchestre ; il ne contient ni SQL ni JSX.
- **DOIT** : un repository par agrégat (`ProfileRepository`, `BookingRepository`). Il traduit ; il ne décide pas.
- Un composant React affiche ; la logique (formatage, calcul) va dans des fonctions ou hooks testables.

## O — Ouvert / fermé
- **DOIT** : ajouter un type d'événement de statistique, un réseau social ou un fournisseur d'agenda se fait **en ajoutant** une stratégie ou un adaptateur, pas en modifiant un `switch` central.
- Les listes de valeurs (plateformes de liens, types d'événements) sont des registres déclaratifs, pas des conditions dispersées.

## L — Substitution de Liskov
- **DOIT** : tout adaptateur d'un port respecte le contrat complet du port, erreurs comprises. Un `InMemoryProfileRepository` (tests) et un `SupabaseProfileRepository` sont interchangeables sans changement du cas d'usage.

## I — Ségrégation des interfaces
- **DOIT** : des ports petits et ciblés (`ProfileReader`, `ProfileWriter`) plutôt qu'un `Database` générique. Un cas d'usage ne dépend que de ce qu'il utilise.

## D — Inversion des dépendances
- **DOIT** : `src/domain/` définit les ports ; `src/server/` les implémente. Le sens des imports est toujours `app → server → domain`, jamais l'inverse.
- **DOIT** : les dépendances (repositories, horloge, générateur d'identifiants, logger) sont injectées dans les cas d'usage par une fabrique (`src/server/container.ts`), pas importées directement.
- L'horloge (`Clock`) et le générateur d'identifiants (`IdGenerator`) sont des ports : aucun `new Date()` ni `crypto.randomUUID()` dans le domaine.

## DRY — Don't Repeat Yourself
- **DOIT** : une règle métier n'existe qu'à un seul endroit. Exemple : la validité d'un *slug* de profil est définie dans le domaine et réutilisée par le schéma Zod, pas réécrite.
- **DOIT** : un schéma Zod par entrée, partagé entre formulaire client et Server Action.
- **DOIT** : les règles d'accès vivent dans des **fonctions SQL** appelées par les politiques RLS, pas recopiées de politique en politique.
- **Mais** : DRY porte sur la **connaissance**, pas sur la ressemblance du code. Deux blocs semblables qui évoluent pour des raisons différentes restent séparés. Pas d'abstraction avant le deuxième usage réel (règle de trois pour les utilitaires).
