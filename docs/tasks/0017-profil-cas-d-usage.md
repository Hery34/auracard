# 0017 — Profil : domaine, cas d'usage et Server Actions

- Statut : done (16/11/2026)
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
5. **Invalidation** : après une écriture réussie, `revalidateTag('profile:<id>')` (page publique et vCard).
6. **Lecture publique** : `getPublicProfile(slug)` via un client Supabase **sans cookies** (clé `anon`, compatible rendu statique) → `get_public_profile` + `get_public_links` ; `null` si non publié.
7. *Exigences de l'audit 0016* (le schéma `carnet` est exposé à PostgREST : les contraintes de la base sont la seule barrière, mais l'application filtre aussi) : URL analysée par `new URL()` → `https:`, hôte avec un point, sans identifiants (`user@host`), sans espace ni caractère de contrôle, ≤ 2048 ; hôte cohérent avec la plateforme (`linkedin` → `linkedin.com`, `x` → `x.com`/`twitter.com`, `whatsapp` → `wa.me`/`api.whatsapp.com`, etc. ; `website` et `document` libres) ; URL **stockée sous la forme normalisée `new URL(x).href`** (ASCII) ; hôte comparé exactement ou par suffixe précédé d'un point (`host === 'linkedin.com' || host.endsWith('.linkedin.com')`), jamais par `includes` ; libellé 1–40 après `trim()` JavaScript (retire aussi les espaces Unicode ; réserve de l'audit 0016 : un libellé fait d'espaces Unicode passe `links_label_blank_check` en locale C), sans les caractères interdits par `links_label_charset_check` (0016, décision 8), libellé vide → `null` ; `replaceLinksAction` transmet l'`id` de **chaque lien existant** (sinon le lien est recréé avec un nouvel `id` et ses statistiques de clics de la phase 4 sont perdues ; 0016, décision 8) ; régénération de `database.types.ts` (`pnpm db:types`) en premier.
8. **Limitation de débit** des écritures : 60 par heure par compte (`profile-write`, table de 0009). Seuil validé par Hery le 16/11/2026.

9. *Arbitrages de l'orchestrateur sur les contrats de test-engineer (16/11/2026)* :
   - ~~Tag de cache `profile:<id>`~~ — **remplacé** (décision 10).
   - **Lecture du propriétaire pour l'éditeur (0020)** : `getOwnProfile` renvoie le profil complet (tous les champs modifiables, `isPublished`, `isIndexable`, `slug`) et ses liens existants avec leur `id` et leur position (`LinkRepository.listOwn` ou équivalent sous RLS), sinon la conservation des `id` ne tient pas au premier enregistrement.
   - Hypothèses de test-engineer retenues : profil ciblé par `getOwn` (pas de `profileId` transmis, profil d'autrui → `not_found`) ; limitation de débit après authentification, avant lecture (entrées invalides non décomptées) ; table des hôtes par plateforme fixée par test-engineer ; alphabet d'hôte `[a-z0-9.-]` aussi pour le site du profil ; règles de caractères du téléphone, du poste, de l'entreprise et de la bio ; interrupteurs `"on"` ; liens en JSON dans le champ `links` ; succès de `replaceLinks` → liens enregistrés avec leurs `id` ; `theme` exclu du profil public.

10. *Après revue et audit (16/11/2026)* :
   - **Tag de cache `profile:<slug>`** (décision de Hery) : la page publique, la vCard et la page « introuvable » ne connaissent que le slug (la vue publique n'expose pas l'`id`) ; un 404 mis en cache pour un profil non publié est ainsi invalidé à la publication. `docs/rules/nextjs.md` amendée en conséquence. Le jour où le slug deviendra modifiable, l'action invalidera l'ancien et le nouveau. Les cas d'usage renvoient le `slug` (lu par `getOwn`).
   - **`updateTag`** au lieu de `revalidateTag(…, "max")` dans les Server Actions : lecture immédiate de sa propre écriture (critère 5 de 0018).
   - `parseHttpsUrl` : `new URL()` dans un `try` (pas `URL.parse`, absent de Safari < 18 alors que le module est partagé avec les formulaires) ; hôtes refusés : adresse IPv4 (y compris formes normalisées), nom terminé par un point ; l'hôte analysé est renvoyé avec la valeur (pas de seconde analyse dans `parseLink`).
   - Bio : mêmes caractères interdits que le libellé, sauf `\n` et `\r`.
   - `id` des liens normalisés en minuscules par le schéma (doublons détectés avant la base).

## Critères d'acceptation
1. Unitaires (ports simulés) : chaque cas d'usage couvre succès, non authentifié, profil d'un autre compte, entrée invalide, panne du dépôt.
2. Intégration (pile locale) : mise à jour réelle sous RLS ; un compte ne peut pas modifier le profil d'un autre ; `replace_links` rejoué → même état ; `getPublicProfile` d'un profil non publié → `null`.
3. `updateTag('profile:<slug>')` appelé après succès, jamais après échec (décision 10).
4. `pnpm check` et `pnpm test:integration` verts.

## Règles applicables
`docs/rules/solid-dry.md`, `docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`, `docs/rules/nextjs.md`.

## Hors périmètre
- Images (0021). Pages et éditeur (0018, 0020). vCard (0019).

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `pnpm check` vert ; `pnpm test:integration` vert
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (16/11/2026) : contrats TypeScript figés (domaine `HttpsUrl`/`Phone`/`Link`/`Profile`, ports `ProfileWriter`/`LinkRepository`/`PublicProfileReader`, cas d'usage, actions, schémas) et ~130 tests unitaires + 23 d'intégration ; compléments décision 9 (`getOwnProfile` complet avec liens) et décision 10 (tag par slug, `updateTag`, `{ value, host }`, IPv4 et point final, bio, `id` en minuscules) ; échecs vérifiés à chaque étape ; aucune implémentation de référence possible (hook de périmètre). Incident : Prettier lancé par `npx` (hors dépendances), mise en forme de 4 fichiers de test retouchée, contenu inchangé.
- implémentation (backend, 16/11/2026) : domaine, cas d'usage (`authorize-profile-write.ts` partagé, hors liste mais accepté par la revue), adaptateurs Supabase (rédacteur, liens, lecteur public, lecteur du propriétaire élargi), client public sans cookies, conteneur public, actions et schémas ; types régénérés ; `DISPLAY_NAME_MAX_LENGTH` dérivé du domaine. Aucun test modifié ni contesté. Une session interrompue par la mise en veille du Mac, reprise sans perte.
- reviewer (16/11/2026) : à corriger, non bloquant ; tag `profile:<id>` inutilisable par la page publique → décision 10 (Hery : `profile:<slug>`) ; `URL.parse` → `new URL()` ; reportés : regex de texte dupliquée avec `auth-schemas.ts`, `textFields`/`invalidInput` à extraire au 3e usage, `PublicEmail` absent, `OwnProfile` rangé dans `ports.ts`.
- security-auditor (16/11/2026) : à corriger ; risque **élevé** hors fiche (droit `update` de `profiles` sur toutes les colonnes, via PostgREST) → fiche 0022 (décision de Hery) ; faibles traités par la décision 10 (IPv4/point final, bio, `id` à la casse près). Redirecteurs ouverts des plateformes : à traiter en 0018 (`rel`, hôte réel affiché). Vérification ciblée de la décision 10 : **OK**. Veille Next.js : 16.4.6 à jour (GHSA-vvgp-ww4w-46vf corrigé en 16.4.5).
- vérification orchestrateur (16/11/2026) : `pnpm check` 606/606, `pnpm test:integration` 49/49, `pnpm build` vert.
