# 0009 — Fournisseur d'envoi d'e-mails : Infomaniak
- Statut : Acceptée (14/11/2026)

## Contexte
Les e-mails (nouveau lead, confirmation de rendez-vous avec `.ics`, rappels, annulation) sont émis par n8n à partir de l'outbox (ADR 0006). Il faut un fournisseur d'envoi. Hery utilise déjà Infomaniak.

## Décision
- Envoi par **SMTP authentifié Infomaniak depuis n8n**. Les identifiants sont un *credential* n8n ; les exports dans `n8n/workflows/` n'y font que référence (`docs/rules/security.md`).
- Une adresse d'expédition dédiée sur un domaine détenu par Hery, avec **SPF, DKIM et DMARC** configurés dans la zone DNS Infomaniak avant le premier envoi.
- `Reply-To` vers le propriétaire du profil quand le message est envoyé pour son compte au visiteur.
- E-mails **transactionnels uniquement**. Aucune newsletter, aucun envoi en masse.
- L'application Next.js n'envoie **jamais** d'e-mail directement : pas d'adaptateur e-mail dans `src/server/adapters/`.

## Conséquences
- Positives : aucun nouveau fournisseur ni nouveau compte, coût déjà couvert, hébergeur suisse soumis à une décision d'adéquation RGPD.
- Négatives : quota d'envoi d'une boîte SMTP classique ; suffisant au MVP, à surveiller. Un passage à un relais transactionnel dédié ferait l'objet d'une nouvelle ADR.
- La délivrabilité dépend du domaine d'expédition : lié au point ouvert « nom de domaine ».
- La mention d'information RGPD cite Infomaniak comme sous-traitant pour l'envoi d'e-mails.

## Alternatives écartées
- Resend, Postmark, Brevo : nouveau fournisseur et nouveau coût, sans besoin au MVP.
- Envoi direct depuis Next.js : contredit l'ADR 0006.
