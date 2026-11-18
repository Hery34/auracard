# 0033 — Workflow n8n : e-mail de nouveau message

- Statut : todo (après 0031)
- Agent : integrations ; test-engineer (structure du workflow)
- Phase : 4
- ADR liées : 0006, 0009, 0011 ; fiches 0027 (conventions du workflow), 0031

## Objectif
Moins d'une minute après un nouveau message, le propriétaire reçoit un e-mail qui le contient, avec une réponse possible directement au visiteur.

## Périmètre de fichiers
- integrations : `n8n/workflows/carnet-outbox-leads.json` et sa notice `carnet-outbox-leads.md`.
- test-engineer : `tests/integration/` (structure du workflow).
- Interdit : tout le reste.

## Décisions (validées par Hery, 18/11/2026)
1. **Interrogation toutes les minutes** : `claim_outbox(20)` par `rpc` avec l'identifiant n8n « carnet Supabase service_role » (même que 0027), pas de `pg_net`.
2. **Pour chaque `lead.created`** : e-mail SMTP Infomaniak (identifiant n8n, jamais dans le JSON) au propriétaire ; `Reply-To` = e-mail du visiteur ; `Message-ID` dérivé de l'`id` de l'événement ; texte brut + HTML simple, contenu du visiteur échappé ; lien vers `/tableau-de-bord/messages`. Puis `complete_outbox` ; en cas d'erreur `fail_outbox`.
3. **Conventions de 0027** : nœud « Config » (URL Supabase, adresse d'expédition, URL du site), aucun `$env`, aucun secret, nœuds nommés.
4. **Doublon possible** si n8n s'arrête entre l'envoi et l'acquittement : accepté (rare, sans gravité).
5. Événements `dead` visibles par une requête documentée dans la notice ; pas de workflow d'alerte au MVP.

6. *Reporté de l'audit 0031* : `id` de l'événement comme clé d'idempotence (`Message-ID`) ; HTML de `lead_name` et `lead_message` échappé ; nom affiché encodé (RFC 2047, entre guillemets) ; `fail_outbox` reçoit un code d'erreur normalisé, jamais le corps de l'erreur SMTP ; `Reply-To` = `lead_email` seul, jamais `"<nom>" <e-mail>` en texte brut ; rappeler `claim_outbox` jusqu'à un lot vide (un lot peut être incomplet : les événements écartés comptent dans `p_limit`) ; conservation des exécutions n8n désactivée ou purgée (sinon les données des leads survivent aux 12 mois).

## Critères d'acceptation
1. Le JSON versionné ne contient aucun secret ni `$env`.
2. Le workflow réserve, envoie, puis acquitte ; une erreur d'envoi appelle `fail_outbox`.
3. Le contenu du visiteur ne peut pas injecter d'en-tête ni de HTML.
4. La notice décrit l'import, les identifiants, le domaine d'expédition (SPF, DKIM, DMARC) et le test manuel.

## Règles applicables
`docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`

## Hors périmètre
E-mail au visiteur, CRM, rappels de rendez-vous (phase 5).

## Définition de terminé
- [ ] Tests écrits par test-engineer, échouant avant implémentation
- [ ] Structure du workflow verte ; import et envoi réel testés par Hery
- [ ] reviewer : OK ou remarques non bloquantes traitées
- [ ] security-auditor : OK
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer : …
- implémentation : …
- reviewer : …
- security-auditor : …
