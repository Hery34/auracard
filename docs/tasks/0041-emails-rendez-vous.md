# 0041 — E-mails, `.ics` et rappels des rendez-vous

- Statut : todo (après 0036)
- Agent : integrations ; test-engineer
- Phase : 5
- ADR liées : 0006, 0009, 0016 ; fiches 0033, 0036

## Objectif
n8n envoie, à partir de l'outbox, les e-mails de confirmation, d'annulation, de report et de rappel au visiteur et au propriétaire, avec une invitation `.ics` valide.

## Périmètre de fichiers
- integrations : `n8n/workflows/` (workflow `carnet-outbox-bookings` et sa notice, sur le modèle de `carnet-outbox-leads`), générateur `.ics` partagé si nécessaire (`src/server/adapters/` pour l'`.ics` téléchargeable de 0039).
- test-engineer : tests du workflow (modèle `tests/integration/n8n-outbox-leads-workflow.test.ts`) et de l'`.ics`.
- Interdit : tout le reste.

## Décisions (ADR 0009, 0016)
1. Types traités : `booking.confirmed` (visiteur : confirmation + `.ics` + liens annuler/reporter ; propriétaire : nouvelle réservation), `booking.cancelled` (l'autre partie prévenue ; `.ics` `METHOD:CANCEL`), `booking.rescheduled` (`.ics` mis à jour, même `UID`, `SEQUENCE` incrémenté), `booking.reminder` (visiteur, 24 h avant).
2. `.ics` RFC 5545 : `UID` stable par rendez-vous (dérivé de l'`id`), heures en UTC, `LOCATION` selon le lieu, `ORGANIZER` = propriétaire.
3. SMTP Infomaniak, `From` / `Reply-To` comme en 0033 ; textes en français ; aucune donnée inutile dans les journaux ; traitement idempotent (`claim_outbox` / `complete_outbox` / `fail_outbox`, au plus 5 envois).

## Notes héritées de 0036 (revue et audit, 18/11/2026)
- Colonnes de `claim_booking_outbox` typées non nulles dans `database.types.ts` alors que `previous_booking_id`, `previous_booking_start/end`, `cancelled_by`, `cancel_token`, `visitor_phone`, `visitor_message`, `location_text` peuvent être null.
- `cancel_token` **jamais** dans l'e-mail au propriétaire (même événement `booking.confirmed` pour les deux messages).
- Fuseau renvoyé = celui du propriétaire : `.ics` en UTC.
- *Reporté de l'audit 0038* : `location_text` (texte libre) échappé dans les e-mails et le `.ics` (CRLF neutralisé, pliage RFC 5545) ; lien de visio rendu cliquable seulement s'il est en `https:`.
- n8n : désactiver ou élaguer la sauvegarde des exécutions réussies (données visiteur, jeton).

## Critères d'acceptation
1. Chaque type produit les bons e-mails ; un rejeu n'envoie rien en double.
2. `.ics` importable (Google Agenda, Apple Calendrier, Outlook) ; annulation et report reconnus comme tels.
3. Test réel par Hery (notice).

## Règles applicables
`docs/rules/idempotence.md`, `docs/rules/security.md`, `docs/rules/testing.md`

## Hors périmètre
Synchronisation d'agenda (phase 7).

## Définition de terminé
- [ ] Tests écrits par test-engineer, échouant avant implémentation
- [ ] `pnpm check` et tests du workflow verts
- [ ] reviewer : OK ou remarques non bloquantes traitées
- [ ] security-auditor : OK
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer : …
- implémentation : …
- reviewer : …
- security-auditor : …
