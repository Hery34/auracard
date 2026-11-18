# 0033 — Workflow n8n : e-mail de nouveau message

- Statut : review (code terminé ; import et test manuel par Hery en attente)
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
2. **Pour chaque `lead.created`** : e-mail SMTP Infomaniak (identifiant n8n, jamais dans le JSON) au propriétaire ; `Reply-To` = e-mail du visiteur ; ~~`Message-ID` dérivé de l'`id`~~ (**abandonné, Hery 18/11/2026** : le nœud « Send Email » ne permet pas de le fixer ; l'`id` de l'événement figure dans le corps de l'e-mail ; doublons bornés à 5 tentatives) ; texte brut + HTML simple, contenu du visiteur échappé ; lien vers `/tableau-de-bord/messages`. Puis `complete_outbox` ; en cas d'erreur `fail_outbox`.
3. **Conventions de 0027** : nœud « Config » (URL Supabase, adresse d'expédition, URL du site), aucun `$env`, aucun secret, nœuds nommés.
4. **Doublon possible** si n8n s'arrête entre l'envoi et l'acquittement : accepté (rare, sans gravité).
5. Événements `dead` visibles par une requête documentée dans la notice ; pas de workflow d'alerte au MVP.

6. *Reporté de l'audit 0031* : HTML de `lead_name` et `lead_message` échappé ; nom affiché encodé (RFC 2047, entre guillemets) ; `fail_outbox` reçoit un code d'erreur normalisé, jamais le corps de l'erreur SMTP ; `Reply-To` = `lead_email` seul, jamais `"<nom>" <e-mail>` en texte brut ; rappeler `claim_outbox` jusqu'à un lot vide (un lot peut être incomplet : les événements écartés comptent dans `p_limit`) ; conservation des exécutions n8n désactivée ou purgée (sinon les données des leads survivent aux 12 mois).

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
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [ ] Structure du workflow verte ; import et envoi réel testés par Hery
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (18/11/2026) : `tests/integration/n8n-outbox-leads-workflow.test.ts` (38 tests, en échec : fichiers absents), `tests/integration/support/n8n-workflow.ts` (exécution des nœuds Code), `tests/builders/outbox-event.ts`. Contrat : 9 nœuds nommés (« Every minute », « Config », « Claim outbox », « Has events », « Build email », « Send email », « Complete outbox », « Fail outbox », « Next batch ») ; « Build email » renvoie `{ id, to, from, replyTo, subject, text, html }` (RFC 2047, HTML échappé, `replyTo` vide si invalide) ; sortie erreur de « Send email » → « Fail outbox » avec un code littéral ; `saveDataSuccessExecution: none`. `messageId` retiré du contrat (décision de Hery).
- implémentation (18/11/2026, integrations) : `n8n/workflows/carnet-outbox-leads.json` (9 nœuds, « Build email » sans module externe, `From` `"<nom> via AuraCard" <adresse>` en clair, en-têtes sans contrôle ni bidi, `replyTo` vide si invalide, avertissement « Expéditeur non vérifié », `Référence : <id>`, `fail_outbox` avec `smtp_send_failed`, 3 nouvelles tentatives sur les acquittements seulement, `saveDataSuccessExecution: none`) et notice (import, identifiants, SPF/DKIM/DMARC, conservation des exécutions, limites connues, RGPD, test manuel à 3 messages). Nœuds vérifiés sur le code source de n8n (`emailSend` ≥ 2.1). Vérifié par l'orchestrateur : 51/51 (0033) et 12/12 (0027).
- reviewer (18/11/2026) : à corriger, non bloquant. Retenu (orchestrateur) : `From` = `"<nom nettoyé, \\ et " échappés> via AuraCard" <adresse>` en clair, **encodage RFC 2047 laissé à nodemailer** (qui remettrait sinon un mot encodé entre guillemets) — conforme à la lettre de la décision 6 ; caractères bidi (U+202A–202E, U+2066–2069) neutralisés dans les en-têtes ; tests : `p_id` lu depuis « Build email » (jamais `$json.id`), sortie « false » de « Has events » non reliée, nouvelles tentatives figées (aucune sur « Send email » et « Claim outbox ») ; notice : test manuel à 2–3 messages, limites connues (acquittement interrompu, `fail_outbox` tardif d'un lot mixte, lot entièrement écarté), constantes nommées dans « Build email ». Phase 5 : filtrer `claim_outbox` par type avant un second type d'événement.
- security-auditor (18/11/2026) : **OK**. Retenu (orchestrateur) : tests U+2028/U+2029 dans `lead_name` et `lead_email` ; mention « Expéditeur non vérifié : ne communiquez aucune information sensible » dans le corps ; notice : vérifier l'en-tête `From` brut au test manuel, phrase RGPD (exécutions en erreur ≤ 14 jours, n8n et Infomaniak sous-traitants). Pour mémoire : vérifier `type === 'lead.created'` au premier nouveau type.
