# 0011 — Usages autorisés du client `service_role` (remplace 0010)
- Statut : Acceptée (15/11/2026)

## Contexte
L'ADR 0010 liste les cas d'usage autorisés à employer le client `service_role`. L'audit de la fiche 0006 a établi que l'inscription est appelée côté serveur : GoTrue ne voit que l'adresse IP du VPS, ses limites par adresse deviennent globales. `docs/rules/security.md` impose une limitation de débit par adresse du visiteur sur les surfaces publiques. Hery a retenu (15/11/2026) une table `carnet.rate_limits` servie par une fonction SQL plutôt qu'un compteur en mémoire. Cette fonction doit être réservée à `service_role` : ouverte à `anon`, elle permettrait de consommer des quotas arbitraires ou de remplir la table.

## Décision
Reprend l'ADR 0010 intégralement (points 2 à 5 inchangés) et étend la liste du point 1 :

| Cas d'usage | Fonction SQL | Fiche |
|---|---|---|
| `register-user`, `ensure-membership` | `carnet.register_member(p_user_id, p_display_name, p_slug)` | 0006, 0007 |
| limitation de débit des surfaces publiques (inscription, connexion, puis contact et rendez-vous) | `carnet.consume_rate_limit(p_key, p_limit, p_window) → boolean` : compteur à fenêtre fixe, clé = empreinte SHA-256 salée (secret serveur) de `<portée>:<adresse>`, jamais l'adresse brute | 0009, 0007 |
| `delete-account` (RGPD) | à définir | fiche RGPD |
| traitement de l'outbox par n8n (hors Next.js) | — | phase 4 |

## Conséquences
- Mêmes que l'ADR 0010 ; `admin.ts` est importé par deux adaptateurs au plus (`supabase-profile-registrar.ts`, `supabase-rate-limiter.ts`), ce que la règle ESLint `no-restricted-imports` vérifie.
- La clé `service_role` est unique pour toute l'instance (un seul `JWT_SECRET`) : sa rotation est une opération d'instance qui touche tous les projets et n8n. Risque hérité de l'ADR 0002, consigné ici.
- Un rejeu d'action consomme deux unités de quota : voulu (on compte les tentatives), exception à `idempotence.md` documentée.

## Alternatives écartées
- Compteur en mémoire dans le proxy : perdu au redémarrage, non testable en base, le proxy ne protège rien (`nextjs.md`).
- Fonction ouverte à `anon` : consommation de quotas d'autrui, remplissage de la table.
- Limitation Kong par adresse : inopérante, Kong ne voit que l'adresse du VPS pour les appels serveur.
