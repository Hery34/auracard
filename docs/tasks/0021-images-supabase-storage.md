# 0021 — Images du profil (Supabase Storage)

- Statut : todo (décisions à valider par Hery avant lancement ; après 0020)
- Agent : db-architect (bucket et politiques) ; backend (cas d'usage, validation, CI et pile locale) ; frontend (téléversement dans l'éditeur, affichage) ; test-engineer
- Phase : 2 (6/6)
- ADR liées : 0002 ; ADR à rédiger « stockage des médias »

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

## Critères d'acceptation (à préciser après validation)
1. Téléversement, remplacement et suppression par le propriétaire ; aucun autre compte, projet ou `anon` ne peut écrire dans le dossier.
2. Fichier non image, trop lourd ou falsifié refusé ; EXIF absents du fichier stocké.
3. Image affichée sur la page publique et dans l'aperçu ; photo réduite incluse dans la vCard.

## Définition de terminé
- [ ] Décisions 2 à 4 validées par Hery ; ADR « stockage des médias » acceptée
- [ ] Tests écrits par test-engineer, échouant avant implémentation
- [ ] `pnpm check`, `supabase test db`, `pnpm test:e2e` verts ; CI verte
- [ ] reviewer : OK ou remarques non bloquantes traitées
- [ ] security-auditor : OK
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- …
