# 0008 — Défi anti-robot : Cloudflare Turnstile
- Statut : Proposée (lecture « Cloudflare Turnstile » à confirmer par Hery — voir Contexte)

## Contexte
Les surfaces publiques (formulaire de contact, prise de rendez-vous) doivent combiner limitation de débit et défi anti-robot (`docs/rules/security.md`). Hery a retenu « Turnstile ». Turnstile est un produit **Cloudflare** ; Vercel n'a pas de produit de ce nom, et sa solution BotID n'est utilisable que sur un hébergement Vercel, écarté par l'ADR 0007. Cette ADR retient donc Cloudflare Turnstile.

## Décision
- **Cloudflare Turnstile** sur le formulaire de contact et sur la confirmation de rendez-vous. Pas de défi sur le *beacon* de statistiques : le filtrage des robots y reste côté serveur.
- Le widget est rendu côté client avec la clé de site (publique). Le **jeton est vérifié côté serveur, dans la Server Action, avant toute écriture**, via l'API de vérification de Cloudflare et la clé secrète. Un jeton ne sert qu'une fois.
- La vérification passe par un **port du domaine** (`BotChallengeVerifier`, dans `src/domain/shared`) implémenté par un adaptateur `src/server/adapters/turnstile.ts` (agent `integrations`). Les tests utilisent une implémentation factice ; le fournisseur reste remplaçable.
- Échec ou indisponibilité de la vérification : **refus** de la soumission avec un message explicite, et journalisation.
- La limitation de débit reste en place : le défi ne la remplace pas.
- CSP : autoriser le domaine `challenges.cloudflare.com` en `script-src` et `frame-src`.
- Développement et tests : clés de test fournies par Cloudflare (toujours accepté / toujours refusé), jamais les clés de production.

## Conséquences
- Positives : gratuit, sans compte Cloudflare pour les visiteurs, invisible dans la plupart des cas, indépendant de l'hébergeur.
- Négatives : un script tiers sur la page publique (à déclarer dans la CSP et la mention d'information RGPD) ; dépendance à Cloudflare pour la soumission des formulaires.
- Risque : panne de Cloudflare = formulaires bloqués (refus volontaire, à surveiller).

## Alternatives écartées
- Vercel BotID : réservé à l'hébergement Vercel.
- reCAPTCHA : collecte de données Google, friction utilisateur.
- hCaptcha : viable ; le port rend le remplacement possible sans toucher au domaine.
- Pot de miel seul : insuffisant face aux robots actuels.
