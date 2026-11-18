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
| enregistrement des statistiques (`/t`, `/q`, `/v`, `/api/beacon`), après filtrage des robots et limitation de débit | `carnet.record_public_event(p_id, p_slug, …)` (résout le slug d'un profil publié ; Hery, 18/11/2026) ; `carnet.record_event(…)` pour les écritures internes | 0028, 0029, 0034 |
| capture d'un message de visiteur, après Turnstile et limitation de débit | `carnet.capture_lead(…)` | 0031, 0032 |
| traitement de l'outbox par n8n (hors Next.js) | `carnet.claim_outbox`, `complete_outbox`, `fail_outbox` | 0031, 0033 |

## Conséquences
- Mêmes que l'ADR 0010 ; `admin.ts` n'est importé que par `src/server/container.ts`, qui injecte le client admin dans les adaptateurs autorisés (`supabase-profile-registrar.ts`, `supabase-rate-limiter.ts`, `supabase-instance-account-remover.ts`, `supabase-event-recorder.ts`) ; la règle ESLint `no-restricted-imports` le vérifie.
- La clé `service_role` est unique pour toute l'instance (un seul `JWT_SECRET`) : sa rotation est une opération d'instance qui touche tous les projets et n8n. Risque hérité de l'ADR 0002, consigné ici.
- Un rejeu d'action consomme deux unités de quota : voulu (on compte les tentatives), exception à `idempotence.md` documentée.
- *Précision validée par Hery (17/11/2026, fiche 0024)* : `consume_rate_limit` peut aussi être appelée **depuis une fonction `security definer` de `carnet`** (propriétaire `postgres`, aucun grant supplémentaire). Cas unique : `activate_nfc_tag`, clé `nfc-activate:<uuid du compte>` en clair (identifiant déjà en base, aucune adresse IP), pour que la limite d'essais ne soit pas contournable par PostgREST. La règle « clé = empreinte salée » reste obligatoire pour toute clé dérivée d'une adresse.
- *Création des puces NFC (fiche 0025, Hery, 17/11/2026)* : `carnet.provision_nfc_tags` est lancée par Hery avec `psql` en tant que `postgres` (script SQL versionné), **sans** client `service_role` : ce n'est pas un nouvel usage au sens du point 1.
- *Avenant validé par Hery (17/11/2026, fiches 0023 et 0027)* : suppression de compte → `auth.users` supprimé uniquement si aucune ligne `platform.project_members` ne subsiste (sinon les autres projets perdraient l'accès) ; le client admin reste créé par `container.ts` seul (règle ESLint inchangée) et injecté dans un adaptateur dédié. Risque résiduel accepté : si le compte rejoint un autre projet entre `is_orphan_account` et `deleteUser` (quelques millisecondes, même personne), la cascade de `platform.project_members` efface cette nouvelle appartenance ; aucun verrou n'est possible entre un appel SQL et GoTrue. Purge des médias orphelins par un workflow n8n quotidien (ADR 0006) avec la clé `service_role` rangée dans les identifiants n8n.

- *Droits sur les tables (Hery, 17/11/2026, fiche 0027)* : l'application n'utilise `service_role` que par des fonctions SQL (`register_member`, `consume_rate_limit`, `is_orphan_account`, puis `list_orphan_media` pour n8n). Les droits `all` de `service_role` sur `carnet.profiles`, `links`, `nfc_tags` et `qr_codes` sont conservés : ils servent aux tests d'intégration et à l'exploitation. Toute lecture ou écriture directe de ces tables par l'application reste interdite (adaptateurs limités aux appels `rpc`).

- *Avenant validé par Hery (18/11/2026, phase 4)* : `record_event` et `capture_lead` sont réservées à `service_role` ; ouvertes à `anon`, elles contourneraient par PostgREST le filtrage des robots, la limitation de débit et Turnstile (statistiques gonflées, spam des propriétaires). Chaque fonction a son adaptateur dédié injecté par `container.ts` ; la règle ESLint `no-restricted-imports` est étendue à ces adaptateurs.

- *Précision validée par Hery (18/11/2026, fiches 0028 et 0031)* : la conservation des droits `all` de `service_role` (précision du 17/11) s'étend à `carnet.analytics_events`, `analytics_daily`, `leads` et `outbox`, pour les mêmes raisons (tests d'intégration, exploitation). L'application n'y accède que par `rpc` (`record_event`, `capture_lead`, fonctions de l'outbox).

## Alternatives écartées
- Compteur en mémoire dans le proxy : perdu au redémarrage, non testable en base, le proxy ne protège rien (`nextjs.md`).
- Fonction ouverte à `anon` : consommation de quotas d'autrui, remplissage de la table.
- Limitation Kong par adresse : inopérante, Kong ne voit que l'adresse du VPS pour les appels serveur.
