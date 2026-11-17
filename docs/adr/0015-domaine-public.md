# 0015 — Domaine public `auracard.fr`
- Statut : Acceptée (17/11/2026)

## Contexte
Les puces NFC (`/t/{uid}`) et les QR codes (`/q/{code}`) encodent une URL absolue, gravée ou imprimée : elle ne pourra plus changer (`docs/architecture.md` §5.1 et §8). L'origine publique est lue dans `SITE_URL` (fiches 0019, 0025, 0026).

## Décision
1. Le domaine public définitif est **`auracard.fr`** (choix de Hery, 17/11/2026) : `SITE_URL=https://auracard.fr` en production.
2. Il sera branché plus tard (DNS, proxy inverse, certificat). D'ici là, `QR_PRINT_READY` reste absente : la page QR avertit de ne pas imprimer (fiche 0026, décision 8), et aucune puce n'est encodée pour la production.

## Conséquences
- `QR_PRINT_READY=true` et l'encodage des puces de production n'interviennent qu'une fois `https://auracard.fr` servi par l'application.
- Le provisioning (`supabase/scripts/provision_nfc_tags.sql`) se lance alors avec `site_url=https://auracard.fr`.

## Alternatives écartées
Aucune autre proposition retenue par Hery.
