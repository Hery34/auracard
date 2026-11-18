# 0031 — Schéma des leads et de l'outbox

- Statut : done
- Agent : db-architect ; test-engineer (pgTAP)
- Phase : 4
- ADR liées : 0002, 0004, 0006, 0011 ; règles `idempotence.md` (outbox), `security.md` (RGPD)

## Objectif
Un message laissé par un visiteur est enregistré une seule fois avec, dans la même transaction, l'événement qui déclenchera l'e-mail au propriétaire ; n8n peut réserver, traiter et acquitter ces événements sans doublon.

## Périmètre de fichiers
- db-architect : nouvelle(s) migration(s) dans `supabase/migrations/`.
- test-engineer : `supabase/tests/`.
- Interdit : tout le reste.

## Décisions (validées par Hery, 18/11/2026, sauf mention)
1. **`profiles.accepts_leads boolean not null default true`**, éditable par le propriétaire (ajout aux droits par colonne de 0022).
2. **`carnet.leads`** : `id`, `profile_id` (cascade), `name`, `email`, `message`, `consent_at`, `idempotency_key uuid`, `created_at` ; `unique (profile_id, idempotency_key)` ; contraintes de longueur (nom ≤ 100, e-mail ≤ 254, message ≤ 2000) et de caractères (règle de 0022).
3. **Lecture et suppression** par le propriétaire seul (RLS) ; aucune insertion ni modification directe.
4. **`carnet.capture_lead(p_slug, p_name, p_email, p_message, p_idempotency_key)`** : `security definer` ; refuse (`P0002`, même réponse) un profil non publié ou qui n'accepte pas les leads ; à la première insertion, écrit dans la **même transaction** l'événement d'outbox `lead.created` et un `analytics_events` `lead_submitted` (`id` = id du lead) ; au rejeu (même clé), renvoie le lead existant sans rien écrire de plus.
5. **Exécution de `capture_lead` réservée à `service_role`** (avenant ADR 0011 validé par Hery, 18/11/2026). Ouverte à `anon`, elle contournerait Turnstile et la limitation de débit (spam des propriétaires).
6. **`carnet.outbox`** : `id`, `type`, `profile_id` (cascade), `payload jsonb` (identifiants seulement : `lead_id`), `status` (`pending`, `processed`, `dead`), `attempts`, `locked_at`, `processed_at`, `last_error`, `created_at`. Aucun accès `anon`/`authenticated`.
7. **Fonctions pour n8n** (`service_role` seul) :
   - `claim_outbox(p_limit)` : réserve jusqu'à `p_limit` événements (`for update skip locked`, verrou expiré après 5 minutes) et renvoie, pour `lead.created`, les données nécessaires à l'e-mail (nom affiché et e-mail du propriétaire lu dans `auth.users`, nom, e-mail et message du visiteur, date) ;
   - `complete_outbox(p_id)` : idempotente ;
   - `fail_outbox(p_id, p_error)` : `attempts + 1`, `dead` à 5 tentatives, erreur tronquée sans donnée personnelle.
8. **Conservation** (`pg_cron`, quotidien) : outbox traitée ou morte supprimée après 30 jours ; **leads supprimés 12 mois après leur création** (Hery, 18/11/2026).
10. *Ajouts de l'orchestrateur (18/11/2026, après les tests)* : `carnet.get_public_profile` expose `accepts_leads` (nécessaire en 0032 pour masquer le formulaire) ; `claim_outbox` ne renvoie pas un `lead.created` dont le lead a été supprimé entre-temps et le marque `processed` (aucun e-mail pour un message effacé) ; `last_error` tronqué à 500 caractères et adresses e-mail masquées.
9. **Suppression de compte** : cascade depuis `profiles` ; vérifier `delete_own_account()` (0023).

## Critères d'acceptation
1. Deux appels avec la même clé d'idempotence donnent un seul lead, un seul événement d'outbox, un seul `lead_submitted`.
2. Si l'insertion de l'outbox échoue, le lead n'existe pas (même transaction).
3. Deux `claim_outbox` simultanés ne renvoient jamais le même événement ; un verrou de plus de 5 minutes est repris.
4. Après 5 échecs, l'événement passe `dead` et n'est plus réservé.
5. `anon` et `authenticated` n'exécutent aucune de ces fonctions ; le propriétaire lit et supprime ses leads, personne d'autre (y compris un compte d'un autre projet).
6. Profil non publié ou `accepts_leads = false` : refus identique, rien d'écrit.
7. Migration rejouable, tâches `pg_cron` non dupliquées.

## Règles applicables
`docs/rules/supabase.md`, `docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`

## Hors périmètre
E-mail au visiteur, CRM, déclencheur `pg_net`.

## Définition de terminé
- [x] Avenant ADR 0011 et durée de conservation validés par Hery
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `supabase test db` vert, migration rejouée (Hery)
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (18/11/2026) : `supabase/tests/carnet_leads_outbox.test.sql`, 215 pgTAP (100 en échec, arrêt au test 103 sur `accepts_leads` absente : tests 103–215 jamais exécutés, `psql` refusé) ; `carnet_profiles_writes.test.sql` test 3 porté à 10 colonnes. Contrat : `capture_lead(...) returns uuid` (P0002 identique), `claim_outbox(p_limit) returns table(id, type, attempts, owner_display_name, owner_email, lead_name, lead_email, lead_message, lead_created_at)` avec `for update skip locked`, `complete_outbox` / `fail_outbox` `void`, `purge_outbox` / `purge_leads` `returns integer`, tâches `carnet-purge-outbox` et `carnet-purge-leads`. Arbitrages acceptés : atomicité par contrainte temporaire, concurrence prouvée par `skip locked`, ordre croissant, aucun retour à `pending`. Migration à ordonner après 0028. Complément décision 10 : `plan(221)`, `accepts_leads` en 14ᵉ et dernière colonne de `public_profiles` ; tests ajustés : `carnet_profiles_schema` (`columns_are`, en échec voulu), `carnet_media_storage` (`logo_url` 13ᵉ colonne, vert).
- implémentation (18/11/2026, db-architect) : `20261118120000_create_leads_and_outbox.sql`, appliquée par `migration up`. `capture_lead` écrit `lead_submitted` directement (`source = direct`, `device_class = mobile` : l'appareil n'est pas connu, sans effet sur les agrégats) ; refus `P0002` « profile not found » identique ; `claim_outbox` marque `processed` les leads disparus et filtre un lead supprimé entre réservation et lecture ; `fail_outbox` garde `locked_at` (nouvel essai après 5 min), masque les e-mails `[email]`, tronque à 500 ; purges sur `created_at` ; `pg_cron` 3 h 40 et 3 h 50 ; index partiel `pending`. Rejeu prouvé dans une transaction annulée. 18/20 fichiers verts, `carnet_analytics` 230/230, `pnpm check` 1847. Deux défauts dans les tests (CTE `delete` dans `is(...)` ; `columns_are` de `profiles` sans `accepts_leads`) renvoyés à test-engineer ; copie corrigée 221/221. Pour 0033 : transmettre l'`id` de l'événement comme clé d'idempotence (double réservation possible au-delà de 5 min).
- reviewer (18/11/2026) : à corriger, non bloquant — liste de caractères interdits copiée en caractères **littéraux invisibles** (U+200B, U+202E…) → fonction unique `immutable` écrite en `\uXXXX` ; `device_class = 'mobile'` inventé ; commentaire « même instruction » → « même transaction ». Suggestions retenues : tronquer `p_error` avant le masquage, purge de l'outbox sur `coalesce(processed_at, created_at)`, échappements `E'\u…'` dans les tests. Atomicité, idempotence, concurrence, transitions, purges, rejeu : conformes.
- **Hery (18/11/2026)** : `capture_lead` reçoit `p_device_class` (calculé par la route 0032 avec `classifyUserAgent`) ; **décision 7 amendée** : `claim_outbox` incrémente `attempts` à chaque réservation, `dead` à 5 (réservations ou échecs) ; précision ADR 0011 étendue aux tables `analytics_*`, `leads`, `outbox`.
- corrections (18/11/2026, db-architect) : `is_valid_plain_text(p_value, p_allow_newlines)` en `\uXXXX` (aucun caractère invisible littéral) ; e-mail `^[^@[:space:],;<>"]+@[^@[:space:],;<>"]+$`, nom et message non vides ; `capture_lead(…, p_device_class)` (ancienne signature supprimée) ; `attempts` = réservations, `dead` à 5, `fail_outbox` sans incrément ; `left(p_error, 2000)` avant masquage ; purge sur `coalesce(processed_at, created_at)`. Validé en transactions annulées : 240/240 (migration rejouée deux fois), 731/731 sur les fichiers liés ; `pnpm check` 1850. Types à régénérer en 0029.
- contre-audit (18/11/2026) : **OK** (liste identique à 0022, aucun caractère invisible dans `supabase/`, au plus 5 envois, pas d'oracle sur `p_device_class`).
- contre-revue (18/11/2026) : **OK**. Retenu : purge d'un `dead` sur `coalesce(processed_at, locked_at, created_at)` (délai de diagnostic après la dernière tentative). Notés : `db reset` obligatoire avant la vérification du rejeu (une base où la 1re version a été appliquée garde les anciennes contraintes) ; appels de `claim_outbox` sous `postgres` dans les tests (droits vérifiés ailleurs).
- Backlog : faire passer les contraintes de caractères de `profiles` et `links` à la fonction unique (fiche dédiée ; accorder alors `execute` à `authenticated`, sinon les `update` du propriétaire échouent en 42501).
- security-auditor (18/11/2026) : **OK**. Retenu pour correction dans la migration (orchestrateur) : réservation qui incrémente `attempts` (sinon boucle d'e-mails si n8n tombe entre envoi et acquittement), `check` de format e-mail (un `@`, ni espace ni `,;<>"`), longueur minimale 1 (nom, message). Reporté en 0032/0033. `grant all` de `service_role` sur `leads`, `outbox`, `analytics_events` : précision ADR 0011 à étendre (Hery).
- Clôture (18/11/2026) : Hery — `supabase db reset` + `supabase test db` 20/20 fichiers, 2122 tests (`carnet_leads_outbox` 241) ; rejeu `psql` sans erreur, `jobid` inchangés (4, 5). Types TypeScript à régénérer en 0029.
