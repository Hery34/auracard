# 0025 — Redirections NFC/QR, activation et gestion des puces

- Statut : done
- Agent : backend (types, domaine, cas d'usage, dépôts, actions, routes) ; frontend (pages) ; db-architect (script de provisioning) ; test-engineer
- Phase : 3 (2/3)
- ADR liées : 0011 (précisions du 17/11/2026), 0012 ; fiche 0024

## Objectif
`/t/{uid}` et `/q/{code}` redirigent vers `/p/{slug}` ; une puce en stock mène à une page d'activation où le propriétaire connecté saisit le code ; le tableau de bord liste ses puces (désactiver, réactiver, libérer) ; Hery crée un lot de puces par un script SQL versionné lancé avec `psql` en tant que `postgres` (choix de Hery, 17/11/2026 : aucune clé `service_role` hors du serveur), qui sort un CSV (URL complète à écrire avec son téléphone, code à remettre au client).

## Périmètre de fichiers
- backend : `src/server/infrastructure/supabase/database.types.ts` (régénéré, **première étape**), `src/domain/nfc/**`, `src/server/use-cases/*nfc*`, `src/server/use-cases/*qr*` (résolution seulement), `src/server/repositories/supabase-nfc-*`, `src/server/repositories/supabase-qr-*`, `src/server/actions/nfc*.ts`, `src/server/actions/auth*.ts` (retour après connexion), `src/server/container.ts`, `src/app/(public)/t/[uid]/route.ts`, `src/app/(public)/q/[code]/route.ts`, `src/app/robots.ts`.
- frontend : `src/app/(public)/activer/[uid]/**`, `src/app/(dashboard)/tableau-de-bord/puces/**`, `src/app/(dashboard)/tableau-de-bord/page.tsx` (lien), `src/app/(auth)/connexion/**` (champ de retour), `src/ui/features/nfc/**`.
- db-architect : `supabase/scripts/provision_nfc_tags.sql`.
- test-engineer : tests unitaires `*.test.ts` des fichiers ci-dessus, `tests/integration/nfc*.test.ts`, `tests/e2e/nfc*.spec.ts` (+ aides).
- Interdit : tout le reste, en particulier `supabase/migrations/`.

## Décisions de conception
1. **`/t/{uid}`** (route handler, `GET`, dynamique) : `uid` hors format (`^[0-9a-hjkmnp-tv-z]{12}$`) → 404 sans appel à la base. `resolve_nfc_tag` : `active` → **307** vers `/p/{slug}` ; `activation` → **307** vers `/activer/{uid}` ; `not_found` → **404** (petite page HTML française « Cette carte n'est pas active. »). Aucun effet de bord (pas d'événement avant la phase 4). En-têtes sur toute réponse : `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`.
2. **`/q/{code}`** : même chose avec `^[0-9a-hjkmnp-tv-z]{8}$` et `resolve_qr_code` (pas d'état `activation`).
3. Route handlers plutôt que pages : la phase 4 y écrira l'événement de scan.
4. **Limitation de débit** : activation par adresse, portée `nfc-activate`, 30 par heure (en plus du compteur par compte de 0024) ; résolution `/t` et `/q` **sans** limite applicative (adresses partagées en salon ou en entreprise ; limite Traefik au déploiement, comme `/p/`, et résolution `anon` acceptée en 0024). `robots.txt` interdit aussi `/t/`, `/q/`, `/activer/`.
5. **`/activer/{uid}`** (page publique, dynamique, `noindex`) : `uid` hors format → 404. Sans session : « Connectez-vous pour activer cette carte » avec lien `/connexion?suivant=/activer/{uid}` et lien d'inscription (après confirmation de l'e-mail, l'utilisateur approche de nouveau la carte). Avec session : champ « Code d'activation » (format `XXXXX-XXXXX`, casse et tiret libres, `autocomplete="off"`, `inputmode` texte, majuscules à l'affichage) et bouton « Activer ». La page n'interroge pas l'état de la puce (pas d'oracle supplémentaire) : c'est l'action qui répond.
6. **Action `activateNfcTagAction(previous, formData)`** : session revérifiée, membre, limite par adresse, appel `activate_nfc_tag`. Réponses : `activated` et `already_yours` → redirection vers `/tableau-de-bord/puces` ; `invalid` → « Code incorrect ou carte indisponible. » ; `rate_limited` (base ou adresse) → « Trop d'essais. Réessayez dans une heure. » ; `no_profile` → message et lien vers l'éditeur ; `unauthenticated` → `/connexion?suivant=…`.
7. **Retour après connexion** : `/connexion` accepte `suivant`, transmis par un champ caché ; l'action de connexion ne redirige vers lui que s'il correspond **exactement** à `^/activer/[0-9a-hjkmnp-tv-z]{12}$` (liste blanche ; tout le reste → `/tableau-de-bord`, pas de redirection ouverte).
8. **`/tableau-de-bord/puces`** : liste des puces du propriétaire (colonnes listées explicitement, jamais `select *` : privilèges par colonne de 0024) : identifiant abrégé (4 derniers caractères), statut en français (« Active », « Désactivée »), date d'activation. Actions par puce : « Désactiver » / « Réactiver » (`set_nfc_tag_enabled`) et « Retirer de mon compte » (`release_nfc_tag`, confirmation explicite : « La carte pourra être activée de nouveau avec son code. »). Un `false` au rejeu de `release` est traité comme un succès (idempotence). Limite `profile-write` existante. Lien depuis le tableau de bord. État vide : « Aucune carte. Approchez votre carte d'un téléphone pour l'activer. »
9. **Script `supabase/scripts/provision_nfc_tags.sql`** : variables `psql` `count` et `site_url` (obligatoires, refus si absentes), `batch_id` généré et affiché ; sortie CSV `url,activation_code` (`<site_url>/t/<uid>`, code `XXXXX-XXXXX`) par `\copy … to` un fichier passé en variable `out`, hors du dépôt ; en-tête d'usage (commande exacte, avertissement : codes en clair montrés une seule fois, fichier à détruire après impression ou remise). `.gitignore` non modifié : le chemin de sortie est à la charge de Hery.
10. Accessibilité et style : mêmes règles que 0008 et 0020 (labels, erreurs annoncées, cibles ≥ 44 px, contrastes AA, Shadcn/ui et thème AuraCard).

## Critères d'acceptation
1. Puce assignée à un profil publié → `/t/{uid}` répond 307 vers `/p/{slug}` ; QR d'un profil publié → `/q/{code}` 307 ; inconnue, désactivée, non publiée → 404 identiques ; format invalide → 404 sans requête en base ; en-têtes `no-store` et `noindex` partout.
2. Puce en stock → 307 vers `/activer/{uid}` ; sans session, lien de connexion qui ramène sur la page d'activation ; avec session, bon code (casse et tiret indifférents) → puce sur le profil, redirection vers « Mes puces » ; rejouer → même résultat sans erreur.
3. Mauvais code → message unique ; 11e essai dans l'heure → « Trop d'essais » ; 31e essai depuis une même adresse → idem.
4. `suivant` hors liste blanche (`//evil.example`, `/tableau-de-bord`, `https://…`, encodages) → redirection vers `/tableau-de-bord`, jamais ailleurs.
5. Mes puces : désactiver → `/t/{uid}` 404 ; réactiver → 307 ; retirer → la puce repasse en stock (`/t/{uid}` → `/activer/{uid}`) et se réactive avec le même code. Un autre membre ne voit ni n'agit sur les puces d'autrui.
6. Script : lancé deux fois, il crée deux lots distincts ; le CSV contient `count` lignes au bon format.
7. `pnpm check`, `pnpm build`, E2E verts iOS et Android ; accessibilité vérifiée.

## Hors périmètre
Événements de statistique (phase 4), générateur de QR et création du QR (0026), page d'administration, transfert direct entre comptes.

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `pnpm check`, intégration, `supabase test db`, build, E2E verts
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports

11. *Types (backend, 17/11/2026)* : `database.types.ts` régénéré (`pnpm check` 1154 vert). Types générés trop larges ou faux, à corriger par des types locaux honnêtes dans les dépôts (précédent `set_profile_image`, 0021) : `resolve_nfc_tag` → une seule ligne `{ state: "active" | "activation" | "not_found"; slug: string | null }` (lire `data[0]`) ; `resolve_qr_code` → `string | null` ; `activate_nfc_tag` → union des cinq valeurs, erreur 42501 pour un non-membre ; `nfc_tags.status` → `"stock" | "assigned" | "disabled"`.
12. *Contrat de test-engineer retenu (17/11/2026, arbitrages de l'orchestrateur)* : contrats figés en tête des fichiers de test (domaine `src/domain/nfc/{nfc-tag,activation-path,ports}.ts`, cas d'usage, dépôts, actions `src/server/actions/nfc.ts`, container, routes, `src/ui/features/nfc/{tag-row,messages}.ts`, balisage E2E). Périmètre backend étendu à `src/domain/shared/rate-limits.ts` (portée `nfc-activate`). Compte hors projet → `no_profile` ; format invalide → `invalid` (même message) ; `release` sur la puce d'autrui → succès sans effet (aucun oracle) ; uid en majuscules → 404 ; confirmation de retrait par boîte de dialogue dans la page ; pas de substitution Crockford (O→0, I/L→1) au MVP. Script : `\copy` n'interpole pas les variables psql → `copy (…) to stdout with (format csv, header) \g :out`, `ON_ERROR_STOP` activé par le script, aucun code sur stdout/stderr.
13. *Après revue et audit (17/11/2026, arbitrages de l'orchestrateur)* :
   - **Bloquant (reviewer)** : `/activer` lit la session dans un Server Component, que le proxy ne rafraîchit pas → `src/proxy.ts` (périmètre backend étendu) couvre aussi `/activer/:path*` **en rafraîchissement seul**, sans redirection vers `/connexion` ; la page détecte la session par `auth.currentUser()` (déjà exposé par le conteneur) au lieu de `getOwnProfile()`.
   - **Moyen (audit + revue)** : `Location` **relatif** (`/p/{slug}`, `/activer/{uid}`) sur `/t` et `/q`, jamais construit depuis `request.url` ; commentaire corrigé ; tests : relatif quelle que soit l'URL de la requête.
   - **DRY** : `textFields` (3 exemplaires) → `src/server/actions/form-fields.ts` (module sans directive), importé par `auth.ts`, `profile.ts` (périmètre étendu) et `nfc.ts`. Réexportation inutile de `ACTIVATION_CODE_INPUT_MAX_LENGTH` retirée. `signInToActivatePath(uid)` dans `src/domain/nfc/activation-path.ts`, utilisé par l'action et la page.
   - **Accessibilité** : erreur d'activation passée à `Field` (`aria-invalid`, `aria-describedby`) en plus de l'alerte.
   - **Script** : refus si `out` est vide ou commence par `|` ; `site_url` doit correspondre à `^https://[a-z0-9.-]+(:[0-9]+)?/?$` (pas de chemin, `https` obligatoire) ; appel et écriture du CSV dans une transaction (`begin` / `commit`) : une écriture ratée annule le lot ; commande documentée avec `umask 077`.
   - Acceptés : `scan-responses.ts` (module partagé des deux routes, présentation) ; `<dialog>` natif (écart assumé à l'ADR 0013 pour éviter `@radix-ui/react-alert-dialog` ; à déplacer en primitive au deuxième usage) ; tri de « Mes puces » par `activated_at` décroissant.
14. *Après relecture ciblée (17/11/2026, validé par Hery)* : reviewer et security-auditor OK sur le point 13. Retenus : `src/proxy.ts` traite `/activer` (sans uid) comme `/activer/…` (rafraîchissement seul, jamais de redirection : 404 de Next.js) ; en-tête de contrat de `src/app/(public)/t/[uid]/route.test.ts` aligné sur la décision 13 (`Location` relatif uniquement). Écartés : regex `site_url` permissive (`https://..`) et écrasement silencieux du CSV (opérateur de confiance). Build bloqué par `SITE_URL` absent de l'environnement local (hors code).
15. *Vérification (17/11/2026)* : `pnpm check` 1526, intégration 106, `supabase test db` 1515, build (avec `SITE_URL=https://localhost:3000`, comme la CI), E2E 256/256. Clôturée.
