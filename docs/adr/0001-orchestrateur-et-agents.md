# 0001 — Orchestrateur et agents spécialisés
- Statut : Acceptée (14/11/2026)

## Contexte
Hery veut une organisation où un agent orchestrateur ne code jamais et délègue à des agents spécialisés soumis à des règles strictes.

## Décision
- L'orchestrateur est la **session principale** de Claude Code, définie par `CLAUDE.md`. Ce n'est pas un sous-agent : dans Claude Code, un sous-agent ne peut pas lancer d'autres sous-agents.
- Huit sous-agents dans `.claude/agents/` : `db-architect`, `backend`, `scheduling`, `frontend`, `integrations`, `test-engineer`, `reviewer`, `security-auditor`.
- Chaque agent a un périmètre d'écriture. Il est imposé par le hook `PreToolUse` `.claude/hooks/guard-scope.mjs`, qui s'appuie sur les champs `agent_id` / `agent_type` transmis quand l'appel vient d'un sous-agent.
- Circuit : fiche → tests (rouges) → implémentation (verts) → revue + audit → vérification par l'orchestrateur.

## Conséquences
- Discipline forte, traçabilité par fiches et journal.
- **Limite** : le hook couvre `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, pas `Bash`. Une écriture par redirection shell n'est pas bloquée techniquement ; la règle de `CLAUDE.md` la couvre.
- Plus lent qu'un agent unique sur les petites modifications : accepté.

## Alternatives écartées
- Agent unique avec règles : pas de séparation des rôles ni de revue indépendante.
- Orchestrateur en sous-agent : impossible (pas de délégation imbriquée).
