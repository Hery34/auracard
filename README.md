# carnet

SaaS de cartes de visite connectées (NFC + QR code) : profil partageable, vCard, statistiques, prise de rendez-vous native.

> **État** : structure de développement uniquement. Aucun code applicatif. L'architecture (`docs/architecture.md`) est validée.

## Comment travailler
Ouvrir le dossier dans Claude Code : la session principale est l'**orchestrateur** (`CLAUDE.md`). Il ne code pas ; il rédige des fiches dans `docs/tasks/` et les confie aux agents de `.claude/agents/`.

Exemple de démarrage :
> « Prépare la fiche 0001 de la phase 1 : initialisation du projet Next.js. »

## Repères
| Où | Quoi |
|---|---|
| `CLAUDE.md` | Constitution et rôle de l'orchestrateur |
| `.claude/agents/` | Les 8 agents spécialisés |
| `.claude/hooks/guard-scope.mjs` | Garde-fou : chaque agent n'écrit que dans son périmètre |
| `docs/architecture.md` | Architecture (figée après validation) |
| `docs/adr/` | Décisions |
| `docs/rules/` | Règles de codage |
| `docs/scope.md` | Périmètre validé, amende le cahier des charges |
| `docs/tasks/` | Fiches de tâches |

## Prérequis du poste
Node.js LTS (le hook est écrit en JavaScript), pnpm, Supabase CLI, Claude Code.
