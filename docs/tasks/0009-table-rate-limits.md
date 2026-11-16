# 0009 — Limitation de débit : table `carnet.rate_limits` et fonction `consume_rate_limit`

- Statut : done (15/11/2026)
- Agent : db-architect (tests pgTAP : test-engineer)
- Phase : 1 (prérequis de 0007 ; réutilisée en phases 4 et 5)
- ADR liées : 0011 (remplace 0010), 0002

## Objectif
Le serveur peut, avec le client `service_role`, compter les tentatives d'une surface publique par visiteur sur une fenêtre fixe et savoir si la limite est dépassée, sans jamais stocker d'adresse IP brute.

## Périmètre de fichiers
- Autorisé (db-architect) : `supabase/migrations/20261115170000_create_rate_limits.sql`.
- Autorisé (test-engineer) : `supabase/tests/carnet_rate_limits*.test.sql`.
- Interdit : tout le reste.

## Décisions de conception (validées avec l'approche le 15/11/2026)
1. Table `carnet.rate_limits` : `key text primary key` avec `check (char_length(key) between 1 and 128)`, `window_start timestamptz not null`, `count integer not null check (count >= 0)`. Pas d'`id`, pas d'horodatage de création. RLS `enable` + `force`, **aucune politique, aucun grant** à `anon`/`authenticated`/`service_role` : la fonction est la seule porte.
2. Fonction `carnet.consume_rate_limit(p_key text, p_limit integer, p_window interval) returns boolean` : `plpgsql` ou `sql`, `volatile`, `security definer`, propriétaire `postgres`, `search_path = ''`. Un seul `insert … on conflict (key) do update` : si `window_start < now() - p_window`, nouvelle fenêtre (`window_start = now()`, `count = 1`), sinon `count + 1` ; renvoie `count <= p_limit`. `p_limit` ≤ 0 ou `p_window` ≤ 0 → exception (22023). `revoke execute … from public, anon, authenticated` ; `grant execute … to service_role`.
3. Clé fournie par l'appelant (0007) : `sha256(secret || portée || adresse)` encodé hex (64 caractères), portée en préfixe lisible facultative (`signup:` + empreinte). La base ne connaît jamais l'adresse.
4. Purge : fonction `carnet.purge_rate_limits(p_older_than interval) returns integer` (lignes dont `window_start < now() - p_older_than` ; *ajout audit 15/11/2026 :* `p_older_than` nul ou ≤ 0 → 22023, sinon un bogue d'appelant remettrait tous les compteurs à zéro), `security definer`, `service_role` seulement ; sa planification `pg_cron` relève de la fiche rétention (phase 4). Pas de purge paresseuse dans `consume_rate_limit` (une seule responsabilité).
5. Idempotence : un rejeu consomme deux unités, par conception (on compte les tentatives), exception documentée dans l'ADR 0011.

## Critères d'acceptation
1. Structure : table, colonnes, contraintes nommées (`rate_limits_pkey`, `rate_limits_key_length_check`, `rate_limits_count_check`), RLS `enable` + `force`, `policies_are = {}`, `table_privs_are` `{}` pour `anon`, `authenticated`, `service_role`, `public` ; rien dans `public` ; invariants existants (toute table forcée, aucune relation lisible par `anon`, aucune fonction exécutable par `public`, `search_path` partout) restent verts.
2. Fonctions : signatures, `definer`, `volatile`, `search_path = ''`, propriétaire `bypassrls`, `execute` pour `service_role` seul ; `anon`/`authenticated` → 42501.
3. Comportement (sous `service_role`) : `p_limit = 3`, fenêtre 1 heure : trois appels → `true`, quatrième → `false`, cinquième → `false` (`count = 5`) ; deux clés différentes indépendantes ; fenêtre expirée (postgres recule `window_start` de deux heures) → `true` et `count = 1` ; **fenêtre en cours vieillie** (*ajout revue 15/11/2026*) : postgres recule `window_start` de 30 minutes, appel avec fenêtre 1 heure → `true`, `count` incrémenté et `window_start` inchangé ; puis appel avec fenêtre 10 minutes → `true`, `count = 1`, `window_start = now()` ; `p_limit` ou `p_window` nuls → 22023 ; `p_limit = 0` → exception 22023 ; `p_window = interval '0'` → 22023 ; clé vide ou de 129 caractères → 23514.
4. `purge_rate_limits(interval '1 hour')` supprime les lignes dont la fenêtre a commencé il y a plus d'une heure et renvoie leur nombre ; les autres restent ; `interval '0'`, intervalle négatif ou `null` → 22023 ; `p_key` nul dans `consume_rate_limit` → 23502.
5. Idempotence de la migration (double application) ; tests rejouables.

## Règles applicables
`docs/rules/supabase.md`, `docs/rules/security.md` (RGPD : pas d'adresse brute), `docs/rules/idempotence.md`, ADR 0011.

## Hors périmètre
- Calcul de l'empreinte, port `RateLimiter` et adaptateur, env `RATE_LIMIT_SECRET`, seuils par surface → 0007. Planification `pg_cron` de la purge → fiche rétention, **à livrer avant la mise en production** (audit).

## Consignes de déploiement complémentaires
1. `db push` par `postgres` (`bypassrls`). Contrôle : `POST /rest/v1/rpc/consume_rate_limit` clé `anon` → 401 ; clé `service_role` → `true` ; `GET /rest/v1/rate_limits` avec `service_role` → 42501 ; OpenAPI `anon` inchangé.
2. EasyPanel : `RATE_LIMIT_SECRET` (64 hex, `openssl rand -hex 32`) en variable d'exécution, jamais en argument de build ni dans les logs ; distinct par environnement.
3. Avant d'ouvrir l'inscription : six tentatives avec `X-Forwarded-For`/`X-Real-Ip` forgés et variés → la sixième refusée.
4. Tâche `pg_cron` de purge (24 h, horaire) en place avant la mise en production ; vérifier `cron.job_run_details` ; surveiller `count(*)` de la table (postgres) comme indicateur d'abus.
5. Dumps : données pseudonymisées, rétention alignée ; mention au registre des traitements et dans la politique de confidentialité. Compteur par profil (formulaire de contact) → phase 4 (même fonction, clé `contact:<profil>`).

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation (88/89 rouges)
- [x] `supabase test db` vert (532/532 après compléments de revue et d'audit) ; `pnpm check` vert (7 tests) — vérifiés par l'orchestrateur le 15/11/2026
- [x] Migration appliquée deux fois sans erreur (dump identique)
- [x] reviewer : OK, remarques non bloquantes traitées (scénario de fenêtre vieillie avec preuve par mutant, arguments nuls, purge à second intervalle)
- [x] security-auditor : OK, remarques non bloquantes ; garde sur la purge et `p_key` nul traités ; points élevés reportés dans la fiche 0007
- [x] Aucune déviation d'architecture (ADR 0011 acceptée par Hery le 15/11/2026)
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (15/11/2026) : `carnet_rate_limits.test.sql`, plan 89 : structure (contraintes nommées, RLS forcée sans politique ni grant, 42501 pour tous les rôles y compris `service_role` sur la table), deux fonctions (definer, volatile, `search_path`, `bypassrls`, privilèges `service_role` seul, 42501 sous `authenticated`/`anon`), fenêtre fixe (3 vrais puis 2 faux, `count = 5`, clés indépendantes, expiration par recul de `window_start` → `true` et `count = 1`), 22023 pour limite ou fenêtre ≤ 0, 23514 pour clé vide ou 129 caractères, 128 accepté, purge (1 puis 0, pas de purge paresseuse). Échec vérifié : 88/89 rouges, 422 existants verts ; sonde 89/89, quatre mutants discriminés (P0001, purge paresseuse, `clock_timestamp`, grant table). Points pour db-architect : `errcode = '22023'`, pas de pré-validation de la clé, `now()`, types exacts (`integer`, pas `bigint`), aucun grant de table.
- implémentation (db-architect, 15/11/2026) : `20261115170000_create_rate_limits.sql` : table avec contraintes nommées, RLS `enable` + `force`, aucune politique, `revoke all` défensif sur la table pour tous les rôles ; `consume_rate_limit` (`plpgsql`, definer, `search_path = ''`, garde 22023, un seul `insert … on conflict (key) do update`, `returning rate_limits.count`) ; `purge_rate_limits` (`delete` + `row_count`) ; `revoke`/`grant execute` `service_role` seul. 511/511 sur trois exécutions, double application (trois applications au total), dump identique avant et après. Risques : pas d'index sur `window_start` (purge par balayage, acceptable), purge à planifier (`pg_cron`, fiche rétention), rafale 2 × limite en bordure de fenêtre (inhérent). Vérifié par l'orchestrateur : 511/511, `pnpm check` 7/7, `POST /rest/v1/rpc/consume_rate_limit` avec la clé `anon` → 401, OpenAPI `anon` inchangé.
- implémentation, retouche post-audit (db-architect, 15/11/2026) : garde 22023 sur `purge_rate_limits` (`p_older_than` nul ou ≤ 0) avant le `delete`, en-tête mis à jour ; deux réapplications sans erreur, 528/528 (plan test-engineer passé à 106 entre-temps) ; garde prouvée par sonde hors dépôt (5/5) en attendant les tests.
- test-engineer, compléments post-revue et audit (15/11/2026) : plan 110 : fenêtre en cours vieillie (recul de 30 minutes : `count = 2`, `window_start` inchangé ; fenêtre 10 minutes : `count = 1`, `window_start = now()`), `p_limit`/`p_window`/`p_key` nuls (22023, 22023, 23502), purge à 20 minutes puis garde 22023 (`0`, négatif, `null`). Mutants : « ignore `p_window` » → 3 échecs, « réécrit `window_start` » → 2 échecs. 532/532. Vérifié par l'orchestrateur : 532/532, `pnpm check` 7/7, cinq migrations, sept fichiers de tests.
- reviewer (15/11/2026) : **OK, remarques non bloquantes.** Conforme aux cinq décisions et aux critères ; `revoke all` défensif sur la table à conserver (seul garde-fou exécutable contre un futur `alter default privileges … to service_role`) ; `returning rate_limits.count` justifié ; pas d'index sur `window_start` acceptable au MVP. À corriger (tests, retenu) : scénario « fenêtre en cours vieillie » (un mutant ignorant `p_window` ou codant 1 heure en dur passait les 89 tests) ; retenus aussi : `null` → 22023 testé, purge avec un second intervalle. Fiche rétention : validation de `p_older_than`, index `window_start` si volume.
- security-auditor (15/11/2026) : **OK, remarques non bloquantes** pour la migration ; deux points élevés reportés dans la fiche 0007 (adresse lue au **dernier** élément de `x-forwarded-for` avec `TRUSTED_PROXY_HOPS = 1`, validation `net.isIP`, seau `unknown` en production ; IPv6 agrégée au /64 avant empreinte, sinon quotas illimités). Inaccessibilité confirmée (table sans grant : seul verrou contre `service_role` qui a `bypassrls`, test `table_privs_are` à ne jamais retirer). Moyens, traités : garde 22023 sur `purge_rate_limits` ; purge `pg_cron` (24 h, horaire) à livrer **avant la mise en production** (minimisation, `security.md`), argument ≥ plus longue fenêtre. Faibles : HMAC-SHA256 plutôt que concaténation, secret 32 octets hex (64 caractères, Zod `min(64)`), test `p_key` nul → 23502 (ajouté), journalisation par code seulement. RGPD : empreinte salée = donnée pseudonymisée (registre des traitements, conservation 24 h). Fenêtre fixe et seuils acceptables ; à arbitrer par Hery : second compteur de connexion par compte, seuil d'inscription 5 ou 10 par heure (salons, Wi-Fi partagé), compteur global face au plafond e-mail GoTrue. Veille : rien de nouveau.
