# 0021 — Images du profil (Supabase Storage)

- Statut : done (17/11/2026)
- Agent : db-architect (bucket et politiques) ; backend (cas d'usage, validation, CI et pile locale) ; frontend (téléversement dans l'éditeur, affichage) ; test-engineer
- Phase : 2 (6/6)
- ADR liées : 0002, 0011, 0014 (stockage des médias, Acceptée)

## Objectif
Le propriétaire ajoute une photo de profil, une bannière et un logo ; ils s'affichent sur la page publique et la photo est incluse dans la vCard.

## Décisions validées par Hery (16/11/2026)
- Stockage dans **Supabase Storage** de l'instance partagée.

## Décisions de conception (à valider par Hery avant lancement)
1. **Bucket** `carnet-media` (préfixe du projet, instance partagée) ; chemins `<profile_id>/<kind>-<uuid>.<ext>` (`kind` = `avatar`, `banner`, `logo`).
2. **Lecture** : bucket public (URL stables, servies par le CDN de Storage, compatibles avec la page statique) ou bucket privé avec URL signées (meilleure confidentialité des images d'un profil non publié, mais page statique plus complexe). Proposition : public, avec des noms imprévisibles et la suppression de l'ancien fichier à chaque remplacement.
3. **Écriture** : politiques sur `storage.objects` limitées à `bucket_id = 'carnet-media'` et au dossier d'un profil dont `carnet.can_edit_profile` est vrai. C'est une modification du schéma `storage`, partagé par tous les projets de l'instance (arrêt obligatoire).
4. **Contrôles** : JPEG, PNG ou WebP seulement, vérifiés par les octets de signature côté serveur ; 2 Mo au plus ; dimensions bornées. Les métadonnées EXIF (dont la position GPS) doivent disparaître : ré-encodage dans le navigateur (canvas) avant envoi **et** ré-encodage côté serveur, qui demanderait une nouvelle dépendance (`sharp`) — à trancher.
5. **Pile locale et CI** : réactiver le service `storage-api` (exclu en 0013) dans le job `e2e`.

## Décisions de Hery (17/11/2026) et conception retenue
1. **Bucket public** `carnet-media` (ADR 0014) : 2 Mo, `image/jpeg|png|webp`, chemins `<profile_id>/<kind>-<uuid>.<ext>`, ancien fichier supprimé au remplacement, aucune liste possible.
2. **Politiques `storage.objects`** limitées à `bucket_id = 'carnet-media'` et au dossier d'un profil modifiable par l'appelant (validé par Hery : schéma `storage` partagé).
3. **Pas de ré-encodage serveur** : le navigateur redimensionne (avatar et logo 512 px, bannière 1500 px de large) et ré-encode en JPEG ou WebP avant l'envoi, ce qui retire l'EXIF ; le serveur vérifie les octets de signature et la taille. Risque accepté (ADR 0014).
4. **Chemin d'écriture** (arbitrage de l'orchestrateur) : envoi par une **Server Action** (`uploadProfileImageAction(kind, file)`), qui vérifie session, profil, type réel et taille, puis téléverse avec le client de l'utilisateur (soumis aux politiques), puis enregistre la référence par une fonction `carnet.set_profile_image(p_kind, p_object_name)` (`security definer`, `search_path = ''`, exige `can_edit_profile`, vérifie que l'objet existe dans `carnet-media` et dans le dossier du profil, met à jour `avatar_url`/`banner_url`/`logo` et supprime l'ancien objet) — car `avatar_url` et `banner_url` ne sont pas modifiables par `authenticated` (0022). Suppression d'une image par `removeProfileImageAction(kind)` (même fonction avec `null`). Limite de taille des Server Actions relevée à 3 Mo (`next.config.ts`, `serverActions.bodySizeLimit`). Limitation de débit : portée `profile-write` (0017).
5. **Valeur stockée** (arbitrage de l'orchestrateur) : la base ne connaît pas l'URL publique de Supabase → les colonnes `avatar_url`, `banner_url` et la nouvelle **`logo_url`** (ajoutée par migration, nullable, ≤ 2048, non modifiable directement par `authenticated`) contiennent le **nom de l'objet** dans le bucket (`<profile_id>/<kind>-<uuid>.<ext>`). Le lecteur côté serveur construit l'URL publique (`<NEXT_PUBLIC_SUPABASE_URL>/storage/v1/object/public/carnet-media/<nom>`), revalidée `https:` à l'affichage. `set_profile_image` renvoie l'ancien nom d'objet ; **la Server Action supprime l'ancien fichier par l'API Storage** (pas de `delete` direct sur `storage.objects`, qui laisserait le fichier physique orphelin). Le profil ciblé est celui de l'appelant (`owner_id = auth.uid()`), et le dossier de l'objet doit être son `id`.
6. **Affichage** : page publique (avatar à la place des initiales, bannière, logo), Open Graph (`og:image` = avatar), aperçu de l'éditeur, vCard (`PHOTO;ENCODING=b;TYPE=JPEG|PNG|WEBP` selon le type de l'avatar, lu côté serveur **uniquement** depuis l'origine Supabase configurée — jamais une URL arbitraire —, délai 3 s et 1 Mo au plus ; absent si indisponible).
7. **Stack locale et CI** : service `storage-api` démarré (retiré de la liste d'exclusion de la CI) ; bucket présent dans la migration (pas seulement dans `config.toml`).
8. Invalidation : `updateTag('profile:<slug>')` après chaque changement d'image.
9. *Après la migration (17/11/2026)* : la vue `carnet.public_profiles` et `carnet.get_public_profile` exposent aussi `logo_url` (colonne ajoutée en fin de vue ; si le type de retour de la fonction change, `drop function` + `create`, jamais `cascade`, conformément à la note de 0005), dans une migration de 0021. La Server Action ne supprime **pas** l'ancien fichier quand l'ancien nom renvoyé par `set_profile_image` est égal au nouveau (rejeu). UUID des noms d'objets en minuscules (`crypto.randomUUID()`).

10. *Après revue et audit de la base (17/11/2026, arbitrages de l'orchestrateur dans le cadre des décisions validées)* — migration `20261117090000` modifiée sur place (appliquée nulle part hors local) :
   - **Une seule fonction de validation** `carnet.is_valid_media_name(p_name text) returns boolean` (`immutable`, `search_path = ''`, jamais d'erreur) : `^<uuid minuscule>/(avatar|banner|logo)-<uuid minuscule>\.(jpg|png|webp)$` ; utilisée dans le `with check` des politiques d'insertion et de modification, par `set_profile_image` et par la contrainte de colonnes ; `media_profile_id` n'accepte plus que les minuscules.
   - Politiques en deux temps : `(select carnet.is_member())` en tête, puis le bucket, puis `can_edit_profile(media_profile_id(name))`.
   - `set_profile_image` : profil de l'appelant puis **`carnet.can_edit_profile`** (fonction d'autorisation unique, préparation B2B) ; type MIME de l'objet (`metadata->>'mimetype'`) cohérent avec l'extension, sinon 22023 ; **pas d'`update` si la valeur ne change pas** (`updated_at` stable au rejeu).
   - Contrainte nommée `profiles_media_names_check` (`not valid` puis `validate`) : `avatar_url`, `banner_url`, `logo_url` nuls ou noms valides dont le premier segment est `id::text` et le `kind` correspond à la colonne.
   - Préconditions de production : politiques de `storage.objects`, `storage.buckets` (et `s3_multipart_uploads*` si S3 activé), en tant que `postgres` ; bucket `carnet-media` non pris par un autre projet ; valeurs existantes d'`avatar_url`/`banner_url` conformes au format (sinon `validate` échoue) ; version de `storage-api` identique à la locale.
   - Suivi hors 0021 : purge des fichiers orphelins et suppression du dossier avec le compte (RGPD), avant l'ouverture.

11. *Contrats applicatifs de test-engineer retenus (17/11/2026, arbitrages de l'orchestrateur)* : actions `uploadProfileImageAction(previous, formData)` (champs `kind`, `file`) et `removeProfileImageAction(previous, formData)`, alignées sur l'existant ; affichage des images en `https:` **ou** `http:` sur `127.0.0.1`/`localhost` seulement (pile locale et CI ; l'URL est construite par le serveur depuis l'origine Supabase configurée, jamais depuis une saisie) ; échec de suppression de l'ancien fichier → opération réussie, fichier orphelin ramassé par la purge prévue (suivi) ; un faux fichier consomme une unité de `profile-write` (ordre session → limite → profil → validation), l'action refusant déjà au-delà de 2 Mo avant le conteneur ; avatar lu à chaque téléchargement de vCard (borné par la limite `vcard`).

12. *Après revue et audit de la partie applicative (17/11/2026, arbitrages de l'orchestrateur)* :
   - **Emplacement** (bloquant de la revue, retour à `docs/architecture.md` §3 et `design-patterns.md`) : `supabase-media-storage.ts` et `media-fetcher.ts` déplacés dans `src/server/adapters/` (agent integrations), le lecteur réutilise `publicMediaUrl` (format d'URL défini une fois).
   - **Dimensions contrôlées côté serveur** : largeur et hauteur lues dans l'en-tête (PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X, sans dépendance), refus au-delà de 1500 × 1500 (`invalid_file`) ; l'éditeur borne aussi la hauteur de la bannière à 1500.
   - **Nettoyage après échec de `set`** seulement sur refus certain (`not_found`, 42501) ; une erreur ambiguë (`unexpected`) laisse un orphelin plutôt qu'une référence cassée (modification du test autorisée).
   - **Envois rapprochés** : le champ de fichier est désactivé pendant un envoi (l'aperçu reflète toujours la base).
   - **Affichage** : `safeImageSrc` n'accepte que l'origine Supabase configurée (plus strict que l'exception `http:` locale, compatible E2E) ; `env.ts` refuse une URL Supabase avec chemin.
   - Accessibilité : avatar `alt=""` (le nom suit en titre), logo `alt="Logo de <entreprise>"` (sinon « Logo »), dimensions ou ratio pour éviter le décalage ; aide permanente « JPEG, PNG ou WebP » ; mention « Ces images sont visibles publiquement. ».
   - Test d'intégration comparant la validation des noms d'objets du domaine et `carnet.is_valid_media_name` sur une même table de cas.
   - Types locaux honnêtes pour `set_profile_image` (`string | null` en entrée et en sortie) au lieu de `as string`.
   - Notés : `bodySizeLimit` de 3 Mo valable pour toutes les Server Actions (risque accepté, ADR 0014, limitation en amont au déploiement) ; CSP à venir : `img-src` = origine Supabase (jamais `*`) ; second fichier d'actions `profile-image.ts` assumé (champs de fichier distincts).

## Critères d'acceptation (à préciser après validation)
1. Téléversement, remplacement et suppression par le propriétaire ; aucun autre compte, projet ou `anon` ne peut écrire dans le dossier.
2. Fichier non image, trop lourd ou falsifié refusé ; EXIF absents du fichier stocké.
3. Image affichée sur la page publique et dans l'aperçu ; photo réduite incluse dans la vCard.

## Définition de terminé
- [x] Décisions 2 à 4 validées par Hery ; ADR 0014 acceptée
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `pnpm check`, `supabase test db`, `pnpm test:e2e` verts ; CI verte
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer, base (17/11/2026) : `carnet_media_storage.test.sql` (110 : colonne `logo_url`, bucket, `media_profile_id`, 4 politiques limitées au bucket et en situation avec 5 personas et un bucket d'un autre projet intact, `set_profile_image` refus et réussites, rejeu, ancien objet jamais supprimé par la fonction, `logo_url` exposé publiquement) ; `carnet_profiles_schema.test.sql` adapté (colonnes de la vue et de la table, accepté). 120/120 rouges avant migration. Arbitrage : nom réduit à un UUID sans dossier → `media_profile_id` = `null`.
- db-architect (17/11/2026) : `20261117090000_create_profile_media.sql` (colonne, bucket, `media_profile_id`, politiques, `set_profile_image`, préconditions de production en en-tête) et `20261117100000_expose_public_profile_logo.sql` (vue publique, `get_public_profile` non recréée car `setof carnet.public_profiles`).
- vérification par Hery (17/11/2026) : `supabase db reset` + `supabase test db` → 1062/1062 ; rejeu des deux migrations par `psql -f` sans erreur, puis 1062/1062.
- reviewer et security-auditor, partie base (17/11/2026) : à corriger, non bloquants → décision 10 (validation unique `is_valid_media_name`, `can_edit_profile`, pas de réécriture au rejeu, type MIME, contrainte de colonnes, préconditions `storage.buckets`). test-engineer : 154 tests (erreur de syntaxe PL/pgSQL trouvée dans la migration et corrigée par db-architect) ; retouche de `carnet_profiles_schema.test.sql` acceptée. Vérification par Hery : `db reset` + tests → **1106/1106**, rejeu sans erreur puis 1106/1106. Vérifications ciblées revue et audit : **OK** (partie base validée).
- test-engineer, partie applicative (17/11/2026) : contrats figés et tests (domaine : signatures, taille, dimensions dans l'en-tête, noms d'objets, URL publiques ; cas d'usage d'envoi et de suppression rejoués deux fois ; actions ; lecteur de photo anti-SSRF ; lecteurs ; vCard `PHOTO` ; intégration Storage réelle avec personas et comparaison avec `is_valid_media_name` ; E2E avec PNG porteur d'EXIF GPS). Rouges avant implémentation ; tests de non-régression signalés.
- implémentation (17/11/2026) : backend (domaine, cas d'usage, actions, lecteurs, vCard, `bodySizeLimit` 3 Mo, types régénérés, Storage en CI, `originSchema`) ; integrations (adaptateurs `src/server/adapters/supabase-media-storage.ts` et `media-fetcher.ts`) ; frontend (champs d'envoi avec redimensionnement et ré-encodage dans le navigateur, champ désactivé pendant l'envoi, affichage de l'avatar, de la bannière et du logo, `safeImageSrc` limité à l'origine Supabase, textes alternatifs, mention publique).
- reviewer, partie applicative (17/11/2026) : bloquant (emplacement des adaptateurs) → déplacés ; à corriger (envois rapprochés, nettoyage sur erreur ambiguë) traités ; vérification ciblée : **OK**.
- security-auditor, partie applicative (17/11/2026) : à corriger, non bloquant ; dimensions, `safeImageSrc`, origine Supabase sans chemin traités ; plafond par dossier et purge → fiche 0023 ; vérification ciblée : **OK**. Veille Next.js : 16.4.6 à jour.
- vérification orchestrateur (17/11/2026) : `pnpm check` 1154/1154, intégration 63/63, `supabase test db` 1106/1106, build vert (`/p/[slug]` statique), E2E 214/214 (iOS et Android) ; `NEXT_PUBLIC_SUPABASE_URL` de `.env.local` corrigée par Hery (origine nue).
- **Avant production** : préconditions en en-tête de `20261117090000_create_profile_media.sql` (politiques `storage.objects`/`storage.buckets`, bucket libre, valeurs existantes conformes, version de `storage-api`) ; `NEXT_PUBLIC_SUPABASE_URL` en origine nue ; fiche 0023.

