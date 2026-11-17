# 0023 — Suppression de compte (RGPD)

- Statut : done
- Agent : db-architect (fonctions SQL) ; backend (adaptateurs, cas d'usage, action, ESLint `admin.ts`) ; frontend (page) ; test-engineer
- Phase : 6 (préalable à l'ouverture publique)
- ADR liées : 0002, 0004, 0011 (avenant du 17/11/2026), 0012, 0014 ; fiches 0022, 0024

## Objectif
Un membre supprime son compte : toutes ses données `carnet` disparaissent (RGPD art. 17), et son compte de connexion aussi s'il n'appartient plus à aucun projet de l'instance.

## Périmètre de fichiers
- db-architect : nouvelle migration dans `supabase/migrations/`, tests pgTAP.
- backend : `src/domain/` (compte), `src/server/` (use case, action, adaptateurs Storage et admin, container), `eslint.config.mjs` (troisième importeur autorisé de `admin.ts`).
- frontend : `src/app/(dashboard)/tableau-de-bord/compte/`, lien depuis le tableau de bord, `src/ui/features/account/`, message sur la page d'accueil.
- test-engineer : tests correspondants.
- Interdit : tout le reste. Hygiène des médias (purge, plafond, droits `service_role`) → fiche 0027.

## Décisions de conception (validées par Hery, 17/11/2026)
1. **Page `/tableau-de-bord/compte`**, liée depuis le tableau de bord : bouton « Supprimer mon compte », confirmation en saisissant `SUPPRIMER`. Effacement immédiat, sans délai de grâce ni suppression logique.
2. **Ordre**, chaque étape rejouable sans effet en double (une coupure laisse un état qu'un nouvel essai termine) :
   1. dossier `carnet-media/<profile_id>/` vidé par l'API Storage **avec la session de l'utilisateur** (politiques de 0021) ;
   2. `carnet.delete_own_account()` (`security definer`, appelant = `auth.uid()`) : suppression du profil (liens et QR en cascade, puces remises en stock par le trigger de 0024), des lignes `carnet.rate_limits` dont la clé contient l'uuid du compte, et de la ligne `platform.project_members` de `carnet`. Sans profil ni appartenance (rejeu) : succès sans effet ;
   3. `auth.users` supprimé **seulement si orphelin** : `carnet.is_orphan_account(p_user_id)` (`service_role` uniquement) puis `auth.admin.deleteUser` par un adaptateur dédié ; compte déjà absent = succès (ADR 0011, avenant) ;
   4. déconnexion locale (cookies `sb-*` effacés), redirection vers l'accueil avec le message « Votre compte a été supprimé. ».
3. **Autorisation** : session vérifiée dans l'action et le cas d'usage ; limite `profile-write` ; aucun identifiant fourni par le client.
4. Les autres projets de l'instance ne sont jamais touchés : seule la ligne `project_members` de `carnet` est supprimée, et `auth.users` reste dès qu'une autre appartenance subsiste.

## Critères d'acceptation
1. Membre avec profil, liens, médias, QR et puces : après suppression, plus aucune ligne `carnet` ni fichier `carnet-media/<profile_id>/` ; ses puces sont en `stock` ; `/p/{slug}` et `/q/{code}` répondent 404.
2. Compte sans autre projet → `auth.users` supprimé ; compte membre d'un autre projet → `auth.users` et l'autre appartenance conservés.
3. Rejouer l'action après une coupure à chaque étape aboutit au même état final, sans erreur.
4. Confirmation absente ou différente de `SUPPRIMER` → rien n'est supprimé.
5. Sans session → aucune suppression ; un compte ne peut supprimer que lui-même.
6. Après suppression, l'utilisateur est déconnecté et voit le message sur l'accueil.

## Règles applicables
`docs/rules/security.md`, `docs/rules/idempotence.md`, `docs/rules/supabase.md`, `docs/rules/testing.md`

## Hors périmètre
Purge des orphelins, plafond par dossier, réduction des droits `service_role` (0027) ; export des données (portabilité) ; statistiques (phase 4).

## Définition de terminé
- [x] Décisions validées par Hery
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `pnpm check`, intégration, `supabase test db`, build, E2E verts
- [x] reviewer et security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
1. *Contrat de test-engineer retenu (17/11/2026, arbitrages de l'orchestrateur)* : contrats figés en tête des fichiers de test (pgTAP `carnet_delete_account.test.sql` 73 tests ; domaine `src/domain/account/` ; `makeDeleteAccount` ; adaptateurs `supabase-media-folder-cleaner`, `supabase-carnet-account-eraser`, `supabase-instance-account-remover` ; `deleteAccountAction` ; container ; messages ; intégration 9 tests ; E2E 4 tests). Arbitrages acceptés :
   - **`rate_limits`** : seules les clés en clair `<portée>:<uuid>` (aujourd'hui `nfc-activate`) sont supprimées ; les clés en empreinte HMAC (`profile-write`, `login-*`…) ne sont pas attribuables en SQL sans le secret et restent jusqu'à la purge sous 24 h (fiche 0010). Écart assumé avec la décision 2.2.
   - **Cache public** : ajout d'un port `PublicProfileCache.expire(slug)`, appelé juste après l'étape SQL (sinon un échec ultérieur perdrait le slug et `/p/{slug}` resterait servi par le cache).
   - Rejeu après la suppression admin (session périmée) → `unauthenticated`, redirection vers `/connexion`, état final identique.
   - Un profil restant sans appartenance `carnet` est supprimé quand même.
   - ESLint : aucun changement, seul `container.ts` importe `admin.ts` (ADR 0011 corrigée en conséquence).
   - Risque signalé, accepté sous réserve de l'audit : un compte sans aucune appartenance qui appelle l'action voit son `auth.users` supprimé.
   - Non couvert en intégration (fixture `platform.*` par `psql` refusée) : cas multi-projets et `rate_limits`, couverts par pgTAP et unitaires. pgTAP exécuté jusqu'au test 24 seulement avant implémentation.
2. *Après revue et audit (17/11/2026, arbitrages de l'orchestrateur)* : vérification avant correctifs : `pnpm check` 1784, `supabase test db` 1588, intégration 128, build, E2E 286.
   - **Bloquant (reviewer)** : si `delete_own_account` est validée en base mais que la réponse se perd, `expire(slug)` n'est jamais appelé et le slug est perdu au rejeu (`/p/{slug}` servi indéfiniment par le cache sans `revalidate`). → le cas d'usage expire le slug lu **avant** de tester le résultat de `erase()`.
   - **Audit, même famille** : un profil sans appartenance `carnet` n'est pas lu par `getOwn` (RLS), son slug n'est pas expiré. → `delete_own_account()` renvoie le slug du profil supprimé (`text`, `null` si aucun) ; le cas d'usage expire aussi ce slug. Nouvelle migration `20261117150000_delete_own_account_returns_slug.sql` (`drop function if exists` puis recréation) plutôt qu’une modification en place : la première est déjà appliquée localement et ni `db reset` ni `psql` ne sont autorisés dans la session.
   - Migration : prédicat `rate_limits` réécrit `r.key = split_part(r.key, ':', 1) || ':' || v_user_id::text` (lisibilité, même effet).
   - Action : cookies `sb-*` effacés aussi dans le cas `unauthenticated` avant la redirection ; échec de `auth.signOut()` journalisé (code seulement).
   - UI : message d'erreur construit depuis `ACCOUNT_DELETION_CONFIRMATION` ; la page précise que le compte de connexion est supprimé, sauf s'il sert encore à d'autres services.
   - Documenté (orchestrateur) : ADR 0011 alignée (`admin.ts` importé par `container.ts` seul) ; course résiduelle « orphelin → `deleteUser` » consignée dans l'avenant. Hors code `carnet`, pour la politique de confidentialité : `auth.audit_log_entries`, journaux Kong et du proxy, sauvegardes, clés HMAC 24 h. Outbox (phase 4) : `delete_own_account` devra effacer ou anonymiser les événements en attente du compte.
   - Image envoyée pendant la suppression (entre les étapes 1 et 2) → orpheline, couverte par la purge de 0027.
3. *Clôture (17/11/2026)* : reviewer et security-auditor **OK** sur le rapport 2. Hery valide : invariant d'instance « tout projet qui garde des données liées à un compte garde sa ligne `platform.project_members` » (ADR 0002, à reporter dans `docs/rules/supabase.md`) ; pas de ressaisie du mot de passe au MVP (à reconsidérer avant l'ouverture publique). Acceptés : échec de `signOut` journalisé deux fois (passerelle avec le code GoTrue + action), `database.types.ts` déclare `string` sans `null` (limite du générateur, le dépôt gère `null`), deux migrations gardées (`20261117140000` + `20261117150000`). Vérification : `pnpm check` 1797, `supabase test db` 1588, intégration 128, build, E2E 286/286.
