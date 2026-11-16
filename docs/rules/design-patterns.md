# Design patterns

Un pattern est imposé **là où il résout un problème identifié ci-dessous**, et nulle part ailleurs. Un pattern ajouté sans besoin est une remarque de revue.

## Imposés

| Pattern | Où | Problème résolu |
|---|---|---|
| **Ports & Adapters** (hexagonal) | toute l'architecture | Le domaine reste testable et indépendant de Supabase/Next.js. |
| **Repository** | `src/server/repositories/` | Isoler l'accès aux données et la conversion base ↔ domaine. |
| **Use Case / Application Service** | `src/server/use-cases/` | Un point d'entrée par intention métier, appelé par les Server Actions. |
| **Adapter** | `src/server/adapters/` | Fournisseurs d'agenda (Google, Outlook en phase 2), e-mail, stockage. |
| **Strategy** | statistiques, liens | Un comportement par type d'événement (`scan_nfc`, `scan_qr`, `view`, `click_link`, `booking_*`) ou par plateforme de lien, enregistré dans un registre. |
| **Transactional Outbox** | `carnet.outbox` + n8n | Garantir qu'un effet externe (e-mail, CRM) part une fois et une seule, après validation de la transaction. |
| **Result type** | domaine et cas d'usage | Erreurs métier explicites et typées, sans exceptions. |
| **Factory / Composition Root** | `src/server/container.ts` | Un seul endroit où les dépendances sont assemblées. |
| **Builder** | `tests/builders/` | Données de test lisibles et non dupliquées. |
| **Value Object** | domaine | `Slug`, `Email`, `TimeZone`, `TimeRange` valident à la construction et sont immuables. |

## Interdits ou à justifier
- **Singleton** mutable global (hors client Supabase par requête, géré par la composition root).
- **Service locator** : les dépendances sont passées, pas cherchées.
- Héritage profond : préférer la composition. Une classe abstraite seulement si plusieurs implémentations partagent un vrai comportement.
- **Active Record** (entités qui se sauvegardent elles-mêmes) : contraire à la séparation domaine / infrastructure.
- Couches « passe-plat » sans logique : si un service ne fait qu'appeler un repository, le cas d'usage appelle le repository.
