# 0024 — Schéma des puces NFC et des QR codes

- Statut : done (17/11/2026)
- Agent : db-architect ; test-engineer (pgTAP)
- Phase : 3 (1/3)
- ADR liées : 0002, 0004, 0011

## Objectif
La base sait créer des puces en stock, les activer sur le profil de leur propriétaire, les désactiver ou les libérer, donner à chaque profil un QR code stable et personnalisable, et résoudre une puce ou un QR vers le slug d'un profil publié, sans rien exposer d'autre.

## Choix validés par Hery (17/11/2026)
- Pas d'événement de statistique en phase 3 : les redirections sont des `GET` sans effet de bord ; la phase 4 branchera `analytics_events`.
- Identifiant de puce **aléatoire** généré par nous (écrit dans l'enregistrement NDEF avec l'URL), pas l'UID matériel.
- Stock créé par **script en ligne de commande** (fonction réservée à `service_role`), pas d'interface d'administration.
- Bibliothèque QR `uqr` (fiche 0026).

## Périmètre de fichiers
- Autorisé (db-architect) : `supabase/migrations/2026111712*_create_nfc_tags_and_qr_codes.sql` (une migration), types générés si le projet les versionne.
- Autorisé (test-engineer) : `supabase/tests/carnet_nfc_tags*.test.sql`, `supabase/tests/carnet_qr_codes*.test.sql`.
- Interdit : tout le reste, en particulier les schémas `platform` et `storage`.

## Décisions de conception
1. **`carnet.nfc_tags`** : `id uuid` (clé), `uid text` unique (12 caractères de l'alphabet `[0-9a-hjkmnp-tv-z]` en minuscules, Crockford sans `i l o u`, ≈ 60 bits), `profile_id uuid null` → `profiles` (`on delete set null` **et** statut remis à `stock` par la même opération, voir 7), `status` (`stock` / `assigned` / `disabled`), `activation_code_hash text not null`, `batch_id uuid not null`, `activated_at`, `created_at`, `updated_at` (trigger `carnet.set_updated_at`). Contrainte : `status = 'stock'` ⇔ `profile_id is null`.
2. **Code d'activation** : 10 caractères du même alphabet (≈ 50 bits), affiché `XXXXX-XXXXX` ; la base ne garde que `crypt(code, gen_salt('bf'))` (pgcrypto, schéma où l'extension est installée sur l'instance — à vérifier et documenter en précondition). Comparaison insensible à la casse et aux tirets (normalisation dans la fonction).
3. **`carnet.qr_codes`** : `id uuid`, `code text` unique (8 caractères du même alphabet, ≈ 40 bits), `profile_id uuid not null unique` → `profiles` (`on delete cascade`), `style jsonb not null default` (voir 4), `created_at`, `updated_at`. Un QR par profil au MVP ; le code ne change jamais (imprimé).
4. **Style du QR** : objet à clés fermées `{"fg": "#rrggbb", "bg": "#rrggbb", "logo": boolean}`, défaut `{"fg":"#000000","bg":"#ffffff","logo":false}` ; contrainte `check` (clés exactes, couleurs `^#[0-9a-f]{6}$`). Le contraste minimal est vérifié par le domaine (0026), pas en SQL.
5. **RLS** (ADR 0004, toute politique commence par `(select carnet.is_member())`) : lecture par le propriétaire uniquement (`can_edit_profile(profile_id)`) ; **aucun** droit d'écriture direct (`insert`/`update`/`delete` révoqués à `anon`, `authenticated`) ; `anon` ne lit rien. `activation_code_hash` jamais lisible par `authenticated` (privilèges par colonne ou vue).
6. **Fonctions** (`security definer`, `search_path = ''`, `revoke … from public` puis `grant` explicite) :
   - `carnet.resolve_nfc_tag(p_uid text)` → `(state text, slug text)` ; `anon`, `authenticated`, `service_role`. `state` = `active` (puce assignée **et** profil publié : `slug` rempli), `activation` (puce en stock : `slug` nul), sinon `not_found` (inconnue, désactivée, profil non publié : aucun oracle entre ces cas). `stable`.
   - `carnet.resolve_qr_code(p_code text)` → `slug text` ou nul (profil publié seulement) ; mêmes rôles.
   - `carnet.activate_nfc_tag(p_uid text, p_code text)` → `text` ; `authenticated`. Membre requis ; assigne la puce **en stock** au profil de l'appelant si le code correspond. Résultats : `activated`, `already_yours` (déjà assignée à son profil : idempotent, sans écriture), `invalid` (puce inconnue, code faux, puce d'un autre, désactivée : **même** réponse), `no_profile`. Verrou de ligne (`for update`) contre deux activations simultanées. Limitation de débit : compteur par compte dans la fonction (décision 9), par adresse dans l'application (0025).
   - `carnet.set_nfc_tag_enabled(p_tag_id uuid, p_enabled boolean)` → `boolean` (trouvé ou non) ; `authenticated`, propriétaire seulement ; `assigned` ↔ `disabled` ; idempotent.
   - `carnet.release_nfc_tag(p_tag_id uuid)` → `boolean` ; propriétaire seulement ; repasse la puce en `stock` (`profile_id` nul) ; le même code d'activation reste valable (il est imprimé avec la puce) ; idempotent.
   - `carnet.ensure_qr_code()` → ligne `qr_codes` du profil de l'appelant, créée si absente ; idempotent sous concurrence (`insert … on conflict (profile_id) do nothing` puis lecture) ; nouvelle tentative si collision de `code`.
   - `carnet.set_qr_style(p_style jsonb)` → ligne ; propriétaire ; refus `22023` si style invalide ; sans écriture si inchangé.
   - `carnet.provision_nfc_tags(p_batch_id uuid, p_count integer)` → `table(uid text, activation_code text)` ; **`service_role` seulement**. 1 ≤ `p_count` ≤ 500 ; rejouer un `batch_id` déjà utilisé lève une erreur (les codes en clair ne sont montrés qu'une fois) ; nouvelle tentative si collision d'`uid`.
7. Suppression d'un profil (cascade de compte, 0023) : ses puces reviennent en `stock` (trigger ou fonction de suppression), son QR est supprimé.
8. Migration rejouable, sans `cascade`, préconditions en en-tête (extension pgcrypto et son schéma, rôle `postgres`).

## Critères d'acceptation
1. `provision_nfc_tags` crée N puces en stock avec des `uid` et codes distincts, refuse un `batch_id` rejoué, est refusée à `anon` et `authenticated`.
2. Un membre active une puce en stock avec le bon code (casse et tiret indifférents) ; même appel rejoué → `already_yours` sans écriture ; mauvais code, puce d'un autre, puce désactivée, puce inconnue → `invalid` identique ; non-membre (compte d'un autre projet) → refus.
3. `resolve_nfc_tag` et `resolve_qr_code` ne renvoient un slug que pour un profil publié ; aucune différence observable entre puce inconnue, désactivée ou profil non publié.
4. Le propriétaire voit ses puces et son QR, jamais le hash du code ; un autre membre ne voit rien ; `anon` ne lit aucune table.
5. Désactiver, réactiver, libérer sont réservés au propriétaire et idempotents ; une puce libérée se réactive avec le même code.
6. `ensure_qr_code` appelé deux fois renvoie le même code ; `set_qr_style` refuse clé inconnue ou couleur invalide.
7. Profil supprimé → ses puces en stock, son QR supprimé.

## Règles applicables
`docs/rules/supabase.md`, `docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`

## Hors périmètre
Événements de statistique (phase 4), routes et pages (0025, 0026), plusieurs QR par profil, transfert direct d'une puce entre comptes.

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `supabase db reset` + `supabase test db` verts ; migration rejouée sans erreur
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports

- Schéma validé par Hery (17/11/2026) : décisions 1 à 8 telles quelles.
- Précision de Hery (17/11/2026) : il écrit lui-même les URL `/t/{uid}` dans les puces avec son téléphone (application d’écriture NFC) à partir du CSV du script ; le client active ensuite sa puce avec le code remis. Schéma inchangé ; le CSV doit être facile à recopier (une URL complète par ligne, code au format `XXXXX-XXXXX`).
- Écart avec `docs/rules/security.md` (Jetons) signalé par db-architect : exception pour le code d'activation imprimé validée par Hery (17/11/2026) et ajoutée à la règle.

9. *Après audit (17/11/2026)* :
   - **Bloquant traité, option validée par Hery** : `activate_nfc_tag` consomme elle-même un compteur par compte (`carnet.consume_rate_limit`, clé `nfc-activate:<auth.uid()>`, 10 essais par heure) **avant** toute lecture et tout bcrypt, et renvoie `rate_limited` au-delà (valeur, pas exception, pour que l'incrément ne soit pas annulé). La limite par adresse reste dans l'application (0025).
   - Code nul ou vide → `invalid` avant toute lecture (pas d'écart de durée qui révélerait l'existence d'un `uid`).
   - Coût bcrypt explicite et identique aux deux endroits (`gen_salt('bf', 8)`), avec un commentaire qui les lie.
   - Accepté et reporté en 0025 : `resolve_nfc_tag` et `resolve_qr_code` appelables par `anon` via PostgREST (profils publiés seulement, même risque que `get_public_profile`) ; procédure : une puce reconditionnée est reprovisionnée dans un nouveau lot (le code de l'ancien détenteur ne doit pas rester valable).
10. *Après revue (17/11/2026)* :
   - `activate_nfc_tag` et `ensure_qr_code` retrouvent le profil de l'appelant en repassant par `carnet.can_edit_profile` (point d'extension unique, ADR 0004), comme `set_profile_image`.
   - Commentaires de la migration corrigés (le `on delete set null` sans le trigger **bloque** la suppression, ce n'est pas un filet) ; clause `t.profile_id is not null` redondante retirée.
   - `set_qr_style` crée le QR s'il manque (via `ensure_qr_code`) : écart assumé avec la décision 6, sans risque.
   - Tests déclaratifs ajoutés : `execute` refusé à `anon`/`authenticated` sur `random_crockford`, `release_profile_nfc_tags`, `is_valid_qr_style` ; existence du trigger `profiles_release_nfc_tags`.
   - **Reporté en 0025** : régénération de `database.types.ts` (backend, première étape) ; usage `service_role` du script de provisioning à ajouter à l'ADR 0011 (avenant soumis à Hery avant 0025) ; notes d'usage (`select` par colonnes listées, `release` rejoué → `false` traité comme succès, CSV écrit avant de rendre la main et `batch_id` affiché) ; `ensure_qr_code` ne distingue pas non-membre et membre sans profil (à trancher en 0026).

## Rapports
- test-engineer (17/11/2026) : 4 fichiers pgTAP (`carnet_nfc_tags_schema`, `carnet_nfc_tags_access`, `carnet_qr_codes_schema`, `carnet_qr_codes_access`), 378 puis 409 tests après revue et audit ; personas A, B, U, N, C (autre projet), R, `anon`, `service_role` ; absence d'écriture prouvée par `ctid`, absence de lecture par `pg_stat_xact_user_tables` ; pouvoir discriminant vérifié par mutation d'un prototype jetable. Contrôles de source sur `owner_id` assouplis par l'orchestrateur (index utilisé, `can_edit_profile` exigé).
- implémentation (db-architect, 17/11/2026) : migration `20261117120000_create_nfc_tags_and_qr_codes.sql` (garde-fou pgcrypto dans `extensions`, `random_crockford` sans biais, bcrypt coût 8, trigger `before delete` sur `profiles`, `is_valid_qr_style` unique, `ensure_qr_code` avec `on conflict (profile_id)` et nouvelle tentative sur collision de code, limite d'essais par compte).
- reviewer (17/11/2026) : à corriger, non bloquant (commentaires, clause redondante, `can_edit_profile`, tests déclaratifs, reports en 0025) ; vérification ciblée : **OK**.
- security-auditor (17/11/2026) : **bloquant** (limite d'essais contournable par PostgREST) → décision 9 validée par Hery ; faibles traités (code vide, coût bcrypt) ou reportés (résolution `anon`, reconditionnement) ; vérification ciblée : **OK**. Note : l'en-tête de `20261115170000_create_rate_limits.sql` (empreinte salée, `service_role` seul) est dépassé par l'appel interne de 0024 → à reporter dans l'avenant à l'ADR 0011 (0025).
- vérification orchestrateur (17/11/2026) : `supabase db reset` + rejeu de la migration + `supabase test db` = 1515/1515 (16 fichiers), lancés par Hery.
- **Avant production** : pgcrypto dans `extensions`, application par `postgres`, migration 20261115170000 appliquée.

