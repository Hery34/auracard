# Règles de codage

Chaque agent lit les règles listées dans sa définition (`.claude/agents/*.md`). Une règle marquée **DOIT** est vérifiée en revue et toute violation est bloquante.

| Fichier | Sujet | Agents concernés |
|---|---|---|
| `general.md` | TypeScript, nommage, erreurs, commits | tous |
| `idempotence.md` | Opérations rejouables | tous |
| `solid-dry.md` | SOLID, DRY, taille et responsabilité | tous les agents qui codent, reviewer |
| `design-patterns.md` | Patterns imposés, patterns interdits | backend, scheduling, integrations, reviewer |
| `nextjs.md` | Version, App Router, Server Actions | backend, frontend, security-auditor |
| `supabase.md` | Schéma partagé, migrations, RLS | db-architect, backend, security-auditor |
| `security.md` | Sécurité applicative et RGPD | tous |
| `testing.md` | TDD, pyramide, outils | test-engineer, reviewer |
