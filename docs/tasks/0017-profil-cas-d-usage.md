# 0017 — Profil : domaine, cas d'usage et Server Actions

- Statut : todo (après 0016)
- Agent : backend ; test-engineer (unitaires, intégration)
- Phase : 2 (2/6)
- ADR liées : 0002, 0004, 0011, 0012

## Objectif
Le propriétaire met à jour son profil (textes, coordonnées, publication, indexation) et ses liens par des Server Actions sûres ; la page publique lit un profil publié et ses liens sans session.

## Périmètre de fichiers
- Autorisé (backend) : `src/domain/profile/**` (entités `Profile`, `Link`, value objects `HttpsUrl`, `Phone`, `PublicEmail`, ports), `src/server/use-cases/{update-profile,replace-links,get-public-profile,get-own-profile}.ts`, `src/server/repositories/supabase-{profile,link,public-profile}-*.ts`, `src/server/actions/profile.ts`, `src/server/actions/profile-schemas.ts`, `src/server/container.ts`, `src/server/infrastructure/supabase/*` (client public sans cookies si nécessaire ; `database.types.ts` régénéré par `pnpm db:types`), `package.json` (script `db:types` si absent).
- Autorisé (test-engineer) : tests unitaires et d'intégration correspondants, `tests/builders/`.
- Interdit : tout le reste.

## Décisions de conception
1. **Slug non modifiable** en phase 2 (décision de Hery, 16/11/2026) : aucune action ne le change.
2. **Validation** : schémas Zod partagés (`profile-schemas.ts`, ADR 0012) avec les bornes de `carnet.profiles` (nom 80, poste 80, entreprise 80, bio 500, e-mail 254, téléphone 32, site 2048) et de `links` (0016) ; URL `https://` uniquement ; aucune valeur réfléchie dans les messages d'erreur.
3. **Chaîne de chaque action** : `validate → authenticate (getUser) → authorize (profil du compte) → useCase → map Result` ; erreurs `invalid_input | unauthenticated | not_found | unexpected`.
4. **Liens** : `replaceLinksAction` envoie la liste complète ordonnée → `carnet.replace_links` (rejouable).
5. **Invalidation** : après une écriture réussie, `revalidateTag('profile:<slug>')` (page publique et vCard).
6. **Lecture publique** : `getPublicProfile(slug)` via un client Supabase **sans cookies** (clé `anon`, compatible rendu statique) → `get_public_profile` + `get_public_links` ; `null` si non publié.
7. *Exigences de l'audit 0016* (le schéma `carnet` est exposé à PostgREST : les contraintes de la base sont la seule barrière, mais l'application filtre aussi) : URL analysée par `new URL()` → `https:`, hôte avec un point, sans identifiants (`user@host`), sans espace ni caractère de contrôle, ≤ 2048 ; hôte cohérent avec la plateforme (`linkedin` → `linkedin.com`, `x` → `x.com`/`twitter.com`, `whatsapp` → `wa.me`/`api.whatsapp.com`, etc. ; `website` et `document` libres) ; URL **stockée sous la forme normalisée `new URL(x).href`** (ASCII) ; hôte comparé exactement ou par suffixe précédé d'un point (`host === 'linkedin.com' || host.endsWith('.linkedin.com')`), jamais par `includes` ; libellé 1–40 après `trim()` JavaScript (retire aussi les espaces Unicode ; réserve de l'audit 0016 : un libellé fait d'espaces Unicode passe `links_label_blank_check` en locale C), sans les caractères interdits par `links_label_charset_check` (0016, décision 8), libellé vide → `null` ; `replaceLinksAction` transmet l'`id` de **chaque lien existant** (sinon le lien est recréé avec un nouvel `id` et ses statistiques de clics de la phase 4 sont perdues ; 0016, décision 8) ; régénération de `database.types.ts` (`pnpm db:types`) en premier.
8. **Limitation de débit** des écritures : 60 par heure par compte (`profile-write`, table de 0009). Seuil validé par Hery le 16/11/2026.

## Critères d'acceptation
1. Unitaires (ports simulés) : chaque cas d'usage couvre succès, non authentifié, profil d'un autre compte, entrée invalide, panne du dépôt.
2. Intégration (pile locale) : mise à jour réelle sous RLS ; un compte ne peut pas modifier le profil d'un autre ; `replace_links` rejoué → même état ; `getPublicProfile` d'un profil non publié → `null`.
3. `revalidateTag` appelé avec le bon tag après succès, jamais après échec.
4. `pnpm check` et `pnpm test:integration` verts.

## Règles applicables
`docs/rules/solid-dry.md`, `docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`, `docs/rules/nextjs.md`.

## Hors périmètre
- Images (0021). Pages et éditeur (0018, 0020). vCard (0019).

## Définition de terminé
- [ ] Tests écrits par test-engineer, échouant avant implémentation
- [ ] `pnpm check` vert ; `pnpm test:integration` vert
- [ ] reviewer : OK ou remarques non bloquantes traitées
- [ ] security-auditor : OK
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer : …
- implémentation : …
- reviewer : …
- security-auditor : …
