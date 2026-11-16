# Tests

## Méthode : TDD
1. `test-engineer` traduit les critères d'acceptation de la fiche en tests qui **échouent**.
2. L'agent spécialisé implémente jusqu'au vert, **sans modifier les tests**.
3. Si un test semble faux, l'agent s'arrête et le signale ; l'orchestrateur tranche.

## Outils
| Niveau | Outil | Emplacement |
|---|---|---|
| Unitaire (domaine) | Vitest | `src/domain/**/*.test.ts` |
| Intégration (cas d'usage + repositories) | Vitest + base de test | `tests/integration/` |
| RLS et SQL | pgTAP | `supabase/tests/` |
| Bout en bout | Playwright (profils mobile iOS / Android émulés) | `tests/e2e/` |

## Règles
- **DOIT** : domaine couvert à 90 % minimum ; chaque règle métier a son test.
- **DOIT** : chaque opération rejouable a un test « exécutée deux fois ».
- **DOIT** : chaque table a ses tests RLS : propriétaire, autre utilisateur du projet, utilisateur d'un **autre projet** de l'instance, visiteur anonyme.
- **DOIT** : module de rendez-vous : tests des changements d'heure (dernier dimanche de mars et d'octobre), des fuseaux différents entre propriétaire et visiteur, et de deux réservations simultanées sur le même créneau.
- **DOIT** : horloge et générateur d'identifiants injectés ; aucun test ne dépend de l'heure réelle ni de l'ordre d'exécution.
- On ne mocke que les ports (repositories, fournisseurs), jamais le domaine.
- Données de test via `tests/builders/`.

## Commande unique
`pnpm check` = lint + vérification des types + tests unitaires et d'intégration. Les E2E tournent avant chaque fusion sur `main`.

## Recette réelle (phase 5)
Lecture NFC et QR sur appareils physiques : iPhone récent, iPhone ancien, Android avec NFC activé et désactivé, navigateurs intégrés (LinkedIn, Instagram, WhatsApp) pour le téléchargement vCard.
