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
| `delete-account` (RGPD) : suppression du compte `auth.users` **seulement s'il n'appartient plus à aucun projet** | `carnet.is_orphan_account(p_user_id) → boolean` puis `auth.admin.deleteUser` (adaptateur dédié) | 0023 |
| purge des fichiers orphelins de `carnet-media` par n8n (clé dans les identifiants n8n, hors Next.js) | fonction SQL de listage des orphelins + API Storage | 0027 |
| traitement de l'outbox par n8n (hors Next.js) | — | phase 4 |

## Conséquences
- Mêmes que l'ADR 0010 ; `admin.ts` n'est importé que par `src/server/container.ts`, qui injecte le client admin dans les adaptateurs autorisés (`supabase-profile-registrar.ts`, `supabase-rate-limiter.ts`, `supabase-instance-account-remover.ts`) ; la règle ESLint `no-restricted-imports` le vérifie.
- La clé `service_role` est unique pour toute l'instance (un seul `JWT_SECRET`) : sa rotation est une opération d'instance qui touche tous les projets et n8n. Risque hérité de l'ADR 0002, consigné ici.
- Un rejeu d'action consomme deux unités de quota : voulu (on compte les tentatives), exception à `idempotence.md` documentée.
- *Précision validée par Hery (17/11/2026, fiche 0024)* : `consume_rate_limit` peut aussi être appelée **depuis une fonction `security definer` de `carnet`** (propriétaire `postgres`, aucun grant supplémentaire). Cas unique : `activate_nfc_tag`, clé `nfc-activate:<uuid du compte>` en clair (identifiant déjà en base, aucune adresse IP), pour que la limite d'essais ne soit pas contournable par PostgREST. La règle « clé = empreinte salée » reste obligatoire pour toute clé dérivée d'une adresse.
- *Création des puces NFC (fiche 0025, Hery, 17/11/2026)* : `carnet.provision_nfc_tags` est lancée par Hery avec `psql` en tant que `postgres` (script SQL versionné), **sans** client `service_role` : ce n'est pas un nouvel usage au sens du point 1.
- *Avenant validé par Hery (17/11/2026, fiches 0023 et 0027)* : suppression de compte → `auth.users` supprimé uniquement si aucune ligne `platform.project_members` ne subsiste (sinon les autres projets perdraient l'accès) ; le client admin reste créé par `container.ts` seul (règle ESLint inchangée) et injecté dans un adaptateur dédié. Risque résiduel accepté : si le compte rejoint un autre projet entre `is_orphan_account` et `deleteUser` (quelques millisecondes, même personne), la cascade de `platform.project_members` efface cette nouvelle appartenance ; aucun verrou n'est possible entre un appel SQL et GoTrue. Purge des médias orphelins par un workflow n8n quotidien (ADR 0006) avec la clé `service_role` rangée dans les identifiants n8n.

## Alternatives écartées
- Compteur en mémoire dans le proxy : perdu au redémarrage, non testable en base, le proxy ne protège rien (`nextjs.md`).
- Fonction ouverte à `anon` : consommation de quotas d'autrui, remplissage de la table.
- Limitation Kong par adresse : inopérante, Kong ne voit que l'adresse du VPS pour les appels serveur.
