# 0016 — Table `links` et lecture publique des liens

- Statut : done (16/11/2026)
- Schéma (décisions 1 à 6) validé par Hery le 16/11/2026.
- Agent : db-architect ; test-engineer (pgTAP)
- Phase : 2 (profil public & vCard, 1/6)
- ADR liées : 0002, 0004

## Objectif
Un propriétaire enregistre jusqu'à 12 liens ordonnés sur son profil ; un visiteur lit les liens d'un profil publié, et rien d'autre.

## Périmètre de fichiers
- Autorisé (db-architect) : `supabase/migrations/<horodatage>_create_links.sql` (types TypeScript : backend, 0017).
- Autorisé (test-engineer) : `supabase/tests/carnet_links_*.test.sql`.
- Interdit : tout le reste ; aucune modification de `carnet.get_public_profile` ni de la vue `public_profiles` (signature existante conservée).

## Décisions de conception (à valider par Hery — schéma de données)
1. **Table `carnet.links`** : `id uuid` (clé), `profile_id uuid` → `carnet.profiles(id)` `on delete cascade`, `platform text`, `url text`, `label text` (nullable), `position smallint`, `created_at`, `updated_at` (trigger `carnet.set_updated_at`).
2. **Plateformes** (liste fermée, contrainte `check`) : `linkedin`, `x`, `instagram`, `facebook`, `github`, `youtube`, `tiktok`, `whatsapp`, `website`, `document` (brochure, catalogue PDF). Les icônes correspondantes sont des SVG intégrés côté interface (décision de Hery).
3. **Contraintes nommées** : `url` commence par `https://`, 2048 caractères au plus ; `label` 1 à 40 caractères ; `position` 0 à 11 ; unique (`profile_id`, `position`) **différable** (réordonnancement dans une transaction) ; au plus 12 liens par profil (garanti par la contrainte de position).
4. **RLS** : lecture, création, modification, suppression par le propriétaire seul, via `carnet.can_edit_profile(profile_id)` (exige l'appartenance `carnet`) ; aucun accès `anon`.
5. **Remplacement atomique** : fonction `carnet.replace_links(p_profile_id uuid, p_links jsonb) returns setof carnet.links` (`security invoker`, donc soumise à la RLS) qui applique la liste complète dans l'ordre reçu (identifiants conservés : voir décision 8, qui remplace « supprime puis réinsère »). Rejouer le même appel donne le même état (idempotence, `docs/rules/idempotence.md`). Validation des éléments par les contraintes de la table (erreurs 23514 remontées telles quelles).
6. **Lecture publique** : fonction `carnet.get_public_links(p_slug text) returns table(platform, url, label, position)` (`security definer`, `search_path = ''`, `stable`), qui ne renvoie que les liens d'un profil **publié**, triés par position ; `execute` accordé à `anon` et `authenticated` (même modèle que `get_public_profile`).

7. *Précisions de l'orchestrateur (16/11/2026, cas laissés ouverts par les tests)* : `p_links` nul ou qui n'est pas un tableau JSON → 22023 (convention de 0009) ; une clé `position` dans un élément est ignorée (la position est le rang dans le tableau) ; `get_public_links` applique **exactement** la même règle de visibilité que `get_public_profile` (en s'appuyant sur la vue `carnet.public_profiles`), y compris pour un profil publié dont le propriétaire n'est plus membre de `carnet` ; le schéma d'URL est en minuscules (`https://` exact, `HTTPS://` refusé).

8. *Décisions de Hery après revue et audit (16/11/2026)* — la migration n'est appliquée nulle part hors local : elle est modifiée sur place.
   - **Identifiants conservés** (statistiques de clics de la phase 4) : un élément de `p_links` peut porter l'`id` d'un lien existant **du même profil** → mis à jour sur place (plateforme, URL, libellé, position) ; sans `id` → créé ; liens du profil absents de la liste → supprimés. `id` inconnu, d'un autre profil, ou présent deux fois → 22023, sans aucun effet. Clés `profile_id`, `position`, `created_at` d'un élément ignorées.
   - **Contrôles en tête de `replace_links`** : `p_links` nul ou non tableau → 22023 ; plus de 12 éléments → 23514 avant toute lecture ; élément qui n'est pas un objet → 22023 ; profil non modifiable par l'appelant (`can_edit_profile` faux) → 42501, même avec une liste vide ; verrou `for update` sur la ligne du profil (deux appels concurrents sont sérialisés) ; contrainte de position différée pendant l'appel.
   - **`execute` de `replace_links` retiré à `service_role`** (aucun cas d'usage, ADR 0011).
   - **Nouvelles contraintes nommées** : `links_url_charset_check` (aucun espace ni caractère de contrôle dans `url`), `links_url_host_check` (hôte non vide après `https://`), `links_label_charset_check` (aucun caractère de contrôle ni bidirectionnel U+202A–U+202E, U+2066–U+2069 dans `label`).
   - `get_public_links` : filtre `is_published` redondant retiré (la vue `public_profiles` porte seule la règle).
   - Types TypeScript régénérés : prérequis de 0017, faits par backend.
   - *Précisions après le second audit (16/11/2026, durcissement validé par Hery)* : contraintes indépendantes de la locale — `links_url_charset_check` : ASCII imprimable seulement (`url ~ '^[!-~]+$'` ; l'application stocke `new URL(x).href`, toujours ASCII) ; `links_url_host_check` : `^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#]|$)` (refuse `user@host`, `\`, `:443` sans hôte) ; `links_label_charset_check` : liste explicite de points de code interdits (C0, U+007F–U+009F, U+00AD, U+061C, U+180E, U+200B, U+200E, U+200F, U+2028–U+202E, U+2060–U+2064, U+2066–U+2069, U+FEFF ; U+200C et U+200D autorisés pour les émojis composés) ; nouvelle `links_label_blank_check` (au moins un caractère non blanc). `replace_links` : `platform`, `url` et `label` doivent être des chaînes JSON (`label` peut être `null`), sinon 22023 ; verrou `for no key update` (sérialise deux appels sans bloquer les futures insertions qui référencent le profil) et 42501 si aucune ligne n'est verrouillée.
   - *Précisions de mise en œuvre retenues (16/11/2026, contrat consommé par 0017)* : `id` JSON `null` = absent (création) ; `id` comparés sans tenir compte de la casse, `id` malformé → 22023 ; ligne identique non réécrite (`updated_at` inchangé au rejeu) ; contrainte de position remise en `immediate` avant le retour (une violation remonte dans l'appel, pas au `commit`).

## Critères d'acceptation
1. Le propriétaire crée, lit, modifie et supprime ses liens ; un autre membre de `carnet`, un compte d'un autre projet et `anon` n'y ont aucun accès direct.
2. `replace_links` appliqué deux fois avec la même liste donne le même résultat ; une liste réordonnée est acceptée (contrainte différable) ; 13 liens → erreur ; `url` en `http://` ou `javascript:` → 23514.
3. `get_public_links` renvoie les liens triés d'un profil publié, rien pour un profil non publié ou inexistant, et aucune colonne interne (`id`, `profile_id`).
4. Suppression du profil → liens supprimés (cascade).
5. Migration rejouable ; double application prouvée.

## Règles applicables
`docs/rules/supabase.md`, `docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`.

## Hors périmètre
- Statistiques de clics (phase 4, `analytics_events.link_id`). Cas d'usage et Server Actions (0017).

## Définition de terminé
- [x] Schéma validé par Hery
- [x] Tests pgTAP écrits par test-engineer, échouant avant implémentation
- [x] `supabase test db` vert ; double application prouvée ; `pnpm check` vert
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (16/11/2026) : `carnet_links_schema.test.sql` (113) et `carnet_links_access.test.sql` (81) : structure et contraintes nommées, différabilité, trigger, RLS et politiques, privilèges, propriétés des fonctions, quatre personas et `anon`, `replace_links` (rejeu, réordonnancement, 12/13 liens, schémas refusés, atomicité, 22023, clé `position` ignorée), `get_public_links` (tri, colonnes, même visibilité que `get_public_profile` en 6 cas), cascades. Échec vérifié avant implémentation ; implémentation de référence 194/194.
- implémentation (db-architect, 16/11/2026) : `20261116120000_create_links.sql` conforme au contrat (table, 7 contraintes, trigger, RLS `is_member` + `can_edit_profile`, privilèges, `replace_links` invoker avec garde 22023, `get_public_links` definer sur `public_profiles`). Vérification exécutée par Hery (`db reset` refusé aux agents) : `supabase db reset` + `supabase test db` → 743/743 ; rejeu par `psql -f` sans erreur (`already exists, skipping`, politiques recréées) puis 743/743.
- reviewer (1re revue, 16/11/2026) : à corriger, non bloquant ; problème des `id` porté à Hery → décision 8.
- security-auditor (1er audit, 16/11/2026) : à corriger, non bloquant ; contraintes de caractères, contrôles de `replace_links`, exigences applicatives (0017, 0018, 0020) → décision 8 et fiches suivantes.
- test-engineer (décision 8, 16/11/2026) : plans 128 (schéma) et 110 (accès) ; identifiants conservés, refus 22023/23514/42501 stricts, nouvelles contraintes ; 40 échecs contre l'ancienne migration, 238/238 contre la nouvelle (transaction annulée).
- implémentation (db-architect, décision 8, 16/11/2026) : migration modifiée sur place ; choix : `id` JSON `null` = absent, `id` comparés en texte sans casse, ligne identique non réécrite, contrainte remise en `immediate` avant le retour.
- vérification exécutée par Hery (16/11/2026) : `supabase db reset` + `supabase test db` → 787/787 ; rejeu par `psql -f` sans erreur, puis 787/787.
- reviewer (2e revue, 16/11/2026) : à corriger, non bloquant ; traités : précisions de mise en œuvre écrites dans la décision 8, trois tests de couverture (`id` nul, majuscules, `updated_at` inchangé au rejeu, ajoutés après coup), périmètre et rapports à jour, contrat 0017 précisé. Non retenu : verrou plus léger à ce stade (remplacé ensuite par `for no key update` sur demande de l'audit).
- security-auditor (2e audit, 16/11/2026) : à corriger, non bloquant ; aucun contournement de `replace_links` ; contraintes de caractères dépendantes de la locale → précisions après le second audit (décision 8), appliquées et testées (154 + 130). Vérification ciblée : **OK** ; réserve faible acceptée : libellé fait uniquement d'espaces Unicode (U+00A0…) accepté en locale C par `links_label_blank_check` → `trim()` côté application (0017).
- vérification finale (16/11/2026) : par Hery, `supabase db reset` + `supabase test db` → 833/833, rejeu par `psql -f` sans erreur puis 833/833 ; par l'orchestrateur, `pnpm check` 289/289, `pnpm test:integration` 26/26.
