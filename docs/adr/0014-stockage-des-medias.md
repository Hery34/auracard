# 0014 — Stockage des médias du profil (Supabase Storage)
- Statut : Acceptée (17/11/2026)

## Contexte
La phase 2 ajoute la photo de profil, la bannière et le logo (fiche 0021). L'instance Supabase est partagée entre plusieurs projets (ADR 0002) : le schéma `storage` et sa table `storage.objects` sont communs à tous. La page publique est statique et invalidée par tag (0018) ; ses images sont aussi lues par les robots d'aperçu de liens (Open Graph) et intégrées à la vCard (0019).

## Décision
1. **Bucket public `carnet-media`** (préfixe du projet), créé par migration, limité à 2 Mo par fichier et aux types `image/jpeg`, `image/png`, `image/webp`. URL publiques stables (compatibles avec la page statique, l'Open Graph et la vCard) ; noms imprévisibles `<profile_id>/<kind>-<uuid>.<ext>` (`kind` = `avatar`, `banner`, `logo`) ; l'ancien fichier est supprimé à chaque remplacement ; aucune politique ne permet de **lister** le bucket.
2. **Politiques sur `storage.objects` strictement limitées à `bucket_id = 'carnet-media'`** et au dossier d'un profil que l'appelant peut modifier (`carnet.can_edit_profile`). Aucune politique de portée générale. La modification du schéma `storage`, partagé, est validée par Hery (17/11/2026) ; toute nouvelle politique sur ce schéma repasse en revue et en audit.
3. **Pas de ré-encodage côté serveur** (pas de `sharp`) : le navigateur redimensionne et ré-encode l'image avant l'envoi, ce qui retire les métadonnées EXIF. Le serveur vérifie le type réel (octets de signature) et la taille. Risque accepté : un fichier envoyé directement par l'API, hors de l'éditeur, garde les métadonnées de la photo de son propriétaire.
4. La stack locale et la CI démarrent le service Storage.

## Conséquences
- Avant la mise en production : lister, en tant que `postgres`, les politiques existantes de `storage.objects` **et** de `storage.buckets` (et `storage.s3_multipart_uploads*` si l'accès S3 est activé) sur l'instance réelle. Une politique permissive d'un autre projet (combinées par « OU » ; `roles = {public}` vaut aussi pour `authenticated`) pourrait s'appliquer à `carnet-media` : sur `objects`, accès aux fichiers ; sur `buckets`, modification de la configuration (types autorisés, taille, visibilité). Les politiques `RESTRICTIVE` n'élargissent rien mais peuvent bloquer carnet.
- Les politiques d'écriture imposent aussi le format du nom d'objet (`<profile_id>/<kind>-<uuid>.<ext>`), pour qu'un téléversement direct par l'API Storage ne puisse créer ni nom prévisible, ni sous-dossier, ni segment `..`.
- Fichiers orphelins (remplacement interrompu, téléversement direct non référencé) et suppression du dossier avec le compte : fiche de suivi (purge périodique et cas d'usage de suppression de compte, RGPD) avant l'ouverture publique.
- L'image d'un profil non publié reste lisible par qui connaît son URL exacte (non devinable, non listable).
- La suppression de compte (RGPD) devra supprimer le dossier du profil dans `carnet-media`.

- La limite de corps des Server Actions passe à 3 Mo pour **toutes** les actions (Next.js n'offre pas de limite par action) : risque accepté, borné par la limitation de débit en amont (proxy inverse) au déploiement.
- Dimensions des images bornées côté serveur (1500 × 1500) par lecture de l'en-tête, contre les images « bombes » envoyées hors de l'éditeur.

## Alternatives écartées
- Bucket privé et URL signées : expiration incompatible avec la page statique mise en cache et avec les robots d'aperçu.
- Ré-encodage serveur avec `sharp` : nouvelle dépendance native, jugée inutile par Hery.
- URL d'images externes saisies par l'utilisateur : pistage et liens cassés.
