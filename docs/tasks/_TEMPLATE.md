# NNNN — Titre court

- Statut : todo | tests | in-progress | review | done | blocked
- Agent : db-architect | backend | scheduling | frontend | integrations
- Phase : 1 à 7 (voir `docs/architecture.md` §9)
- ADR liées : …

## Objectif
Une ou deux phrases : ce que l'utilisateur ou le système peut faire après cette tâche.

## Périmètre de fichiers
- Autorisé : `…`
- Interdit : tout le reste.

## Critères d'acceptation
1. Étant donné …, quand …, alors …
2. …
3. Rejouer l'opération ne crée aucun effet en double. *(si opération rejouable)*
4. Un utilisateur d'un autre projet de l'instance n'accède à rien. *(si données)*

## Règles applicables
`docs/rules/…`

## Hors périmètre
…

## Définition de terminé
- [ ] Tests écrits par test-engineer, échouant avant implémentation
- [ ] `pnpm check` vert
- [ ] reviewer : OK ou remarques non bloquantes traitées
- [ ] security-auditor : OK
- [ ] Aucune déviation d'architecture (sinon ADR validée par Hery)
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer : …
- implémentation : …
- reviewer : …
- security-auditor : …
