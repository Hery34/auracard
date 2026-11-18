# 0030 — Tableau de bord des statistiques

- Statut : done
- Agent : backend (cas d'usage de lecture) ; frontend (page) ; test-engineer
- Phase : 4
- ADR liées : 0012, 0013 ; fiches 0028, 0029

## Objectif
Le propriétaire voit sur `/tableau-de-bord/statistiques` ses scans, vues, téléchargements de vCard et clics, par jour, semaine ou mois, au total et par lien.

## Périmètre de fichiers
- backend : `src/server/use-cases/get-own-stats.ts`, repository de lecture, `src/domain/analytics/` (regroupement par semaine ou mois, à partir des agrégats quotidiens).
- frontend : `src/app/(dashboard)/tableau-de-bord/statistiques/`, `src/ui/features/stats/`, lien dans la navigation du tableau de bord.
- test-engineer : tests unitaires, intégration, E2E.
- Interdit : tout le reste.

## Décisions (validées par Hery, 18/11/2026)
1. **Aucune bibliothèque de graphiques** : barres en SVG ou CSS, accessibles (tableau de données équivalent ou `aria-label` par barre), thème AuraCard.
2. **Périodes** : 7 jours (par jour), 30 jours (par jour), 12 semaines (par semaine ISO), 12 mois (par mois) ; jours en Europe/Paris ; jours sans donnée affichés à zéro.
3. **Contenu** : cartes de totaux (scans NFC, scans QR, vues, vCard, clics) ; répartition des vues par source (NFC, QR, direct) ; tableau des clics par lien (libellé actuel ; « Lien supprimé », regroupés en une seule ligne, pour tout `link_id` qui ne correspond plus à un lien du profil) ; clics sur téléphone et e-mail.
4. **Lecture** par le client utilisateur (RLS de `analytics_daily`), jamais par `service_role`. Page dynamique, `no-store`.
5. Mention sous les chiffres : « Mis à jour toutes les 15 minutes. Robots et aperçus de liens exclus. »
6. *Hery (18/11/2026), amende la décision 3* : `contact_click` n'enregistre pas la cible (0029 point 9 : téléphone, e-mail et site web) → une seule carte « Clics contact (téléphone, e-mail, site web) », pas de détail par cible. Les cartes de totaux sont donc : scans NFC, scans QR, vues, vCard, clics sur les liens, clics contact. Détail par cible éventuel dans une fiche ultérieure (changement de schéma).
7. *Orchestrateur, contrat des tests (18/11/2026)* : période par défaut 30 jours (`?periode=` invalide → défaut, choix du frontend) ; semaines ISO lundi–dimanche et mois civils, l'intervalle en cours se termine aujourd'hui ; un tableau de données équivalent par graphique (par jour/semaine/mois, par source, par lien) ; état vide = aucune donnée sur la période affichée ; liens actuels affichés même à 0, ligne unique « Lien supprimé » en dernier si > 0 (un `link_id` nul compte comme supprimé) ; port `Clock` (`src/domain/shared/ports/clock.ts`, prévu par `architecture.md` §3) ; ~~lecture paginée de `analytics_daily` par le client de session (`max_rows` = 1000), sans nouvelle fonction SQL~~ (remplacé par le point 8).
8. *Hery (18/11/2026), après revue (bloquant)* : l'instance partagée fixe `PGRST_DB_MAX_ROWS` = 100 (fiche 0005, point 4) → toute lecture par lignes serait tronquée.
   - **Lecture** par une fonction SQL `carnet.get_own_daily_aggregates(p_from date, p_to date)` (db-architect) : `security invoker` (RLS de `analytics_daily` inchangée, client de session, jamais `service_role`), `search_path = ''`, `stable`, renvoie **une seule valeur `jsonb`** (tableau des lignes quotidiennes `day, metric, link_id, source, value` de la plage, bornes incluses), donc non concernée par `max_rows`. Droit `execute` pour `authenticated` seul. Plage bornée (≤ 400 jours, `p_from ≤ p_to`, sinon erreur 22023). Le regroupement reste dans le domaine TypeScript. Plus de pagination dans le dépôt.
   - **Pile locale alignée sur la production** : `supabase/config.toml` `max_rows = 100`, pour que les tests détectent toute troncature.
   - **Série** : graphique en barres des vues conservé ; tableau de la série **visible** (replié dans un `<details>` sur mobile) avec une colonne par métrique (`STATS_METRICS` : scans NFC, scans QR, vues, vCard, clics sur les liens, clics contact).
   - **Corrections de revue** : `empty: boolean` calculé par `buildStats` (règle du domaine, plus dans la vue) ; `CARD_ORDER` → `STATS_METRICS`, `SOURCE_ORDER` → `ANALYTICS_SOURCES` ; `isStatsMetric` réutilise le `includes` de `analytics-event.ts` ; extraction de `linkClickRows` ; libellés visibles du premier et du dernier intervalle sous les barres ; test unitaire de `src/ui/features/stats/stats-view.ts`.
   - *Hery (18/11/2026), après seconde revue et audit (ÉLEVÉ : coût proportionnel à toute l'instance, index inutilisé)* : signature `carnet.get_own_daily_aggregates(p_profile_id uuid, p_from date, p_to date)`, filtre `profile_id = p_profile_id and day between p_from and p_to` (index `analytics_daily_bucket_key`), RLS conservée comme garde (id d'autrui ou null → `[]` ou 22023 pour null) ; le dépôt transmet `profileId` (port `listOwn(profileId, range)` exact, prêt pour plusieurs profils par membre). La migration n'a jamais été déployée : elle est modifiée en place, avec suppression de l'ancienne signature `(date, date)` pour la pile locale. Tests : plan utilisant l'index, JWT `authenticated` sans `sub` → `[]`. Dépôt : `day` au format `YYYY-MM-DD` et `value` entier vérifiés.
   - `<details>` du tableau de série **ouvert par défaut**, repliable (tableau équivalent toujours présent dans l'arbre d'accessibilité).
   - Règle « liste > 100 lignes → fonction jsonb ou pagination testée » : à ajouter par Hery dans `docs/rules/supabase.md`.
   - Non retenu : pagination par clé, plafond de pages (sans objet), `await connection()` (même schéma que les autres pages, couvert par l'E2E `no-store`), libellés de lien en double.

## Critères d'acceptation
1. Étant donné des agrégats connus, la page affiche les bons totaux pour chaque période et chaque regroupement.
2. Un propriétaire ne voit jamais les chiffres d'un autre profil.
3. Sans aucune donnée, la page affiche un état vide explicite.
4. Lisible et utilisable sur mobile (iOS et Android E2E), contrastes AA.

## Règles applicables
`docs/rules/nextjs.md`, `docs/rules/security.md`, `docs/rules/testing.md`

## Hors périmètre
Export CSV, comparaison entre périodes, entonnoir de rendez-vous (phase 5).

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation
- [x] `pnpm check`, intégration, build, E2E verts
- [x] reviewer : OK ou remarques non bloquantes traitées
- [x] security-auditor : OK
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (18/11/2026) : domaine 76+, cas d'usage 12, dépôt 13, `stats-view` ; intégration stats 21 (RLS, > 100 et > 1000 lignes avec `max_rows` = 100) ; pgTAP `get_own_daily_aggregates` 67 (signature, droits, isolation, usage de l'index par compteurs `pg_stat`) ; E2E 14 × 2. Helper `eventsOf` paginé (troncature à 100 révélée).
- implémentation (18/11/2026) : db-architect `get_own_daily_aggregates(p_profile_id, p_from, p_to)` jsonb, `max_rows = 100` local ; backend domaine `stats.ts` (`Clock`, `buildStats`, `empty`, `linkClickRows`), cas d'usage, dépôt (un `rpc`, validation stricte) ; frontend page Server Component, cartes, barres CSS, tableaux équivalents, tableau de série 7 colonnes dans `<details open>`.
- reviewer (18/11/2026) : 1er passage BLOQUANT (pagination tronquée par `PGRST_DB_MAX_ROWS` = 100 en production) → point 8 ; 2e passage : bloquant levé, filtre `p_profile_id` demandé (traité). Suggestions non retenues : imports fusionnés, borne 400 non figée.
- security-auditor (18/11/2026) : OK (isolation, client de session, XSS, `no-store`, Next.js 16.4.6 à jour) ; 2e passage ÉLEVÉ (coût proportionnel à l'instance sans filtre profil) traité par `p_profile_id` ; faibles traités (format `day`/`value`, JWT sans `sub`). Vérif orchestrateur : check 2253, intégration 225, pgTAP PASS, build, E2E 376/376.
