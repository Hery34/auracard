# 0011 — Page de confidentialité

- Statut : blocked (contenu juridique à fournir par Hery)
- Agent : frontend ; test-engineer (E2E)
- Phase : 1 (dette du lot inscription) — **préalable à l'ouverture publique** (audit 0008)
- ADR liées : 0002, 0007, 0008, 0009

## Objectif
Toute personne qui s'inscrit ou se connecte peut lire, depuis le formulaire, l'information complète exigée par l'article 13 du RGPD.

## Périmètre de fichiers
- Autorisé (frontend) : `src/app/(public)/confidentialite/page.tsx` (ou `src/app/confidentialite/page.tsx` si le groupe `(public)` n'existe pas encore), `src/ui/features/auth/privacy-notice.tsx` (lien vers la page), `src/app/layout.tsx` (lien de pied de page).
- Autorisé (test-engineer) : `tests/e2e/privacy.spec.ts`, `src/app/routes.test.ts` (ajout de la route).
- Interdit : tout le reste.

## Contenu à fournir par Hery (bloquant)
1. Identité et coordonnées du responsable de traitement (raison sociale ou nom, adresse, e-mail de contact) ; délégué à la protection des données s'il y en a un.
2. Finalités et base légale de chaque traitement : compte et profil (exécution du contrat), limitation des tentatives par empreinte d'IP (intérêt légitime : sécurité), e-mails transactionnels.
3. Destinataires et sous-traitants : hébergement du VPS et de l'instance Supabase (UE, ADR 0007), envoi d'e-mails Infomaniak (ADR 0009), Cloudflare Turnstile (ADR 0008, s'il est actif à l'ouverture). Instance d'authentification partagée avec d'autres projets de Hery : à formuler.
4. Durées de conservation : compte et profil (jusqu'à suppression du compte), empreinte IP 24 h au plus (fiche 0010), journaux techniques.
5. Droits : accès, rectification, effacement, limitation, opposition, portabilité ; comment les exercer ; réclamation auprès de la CNIL.
6. Date de dernière mise à jour.

## Décisions de conception (proposées)
1. Route française `/confidentialite`, Server Component statique (`○` au build), aucun script client, `lang="fr"`, en-têtes de sécurité inchangés.
2. Le contenu vit dans la page (texte versionné dans le dépôt) ; pas de CMS.
3. `privacy-notice.tsx` garde son résumé court et ajoute un lien « En savoir plus » vers `/confidentialite` ; lien « Confidentialité » dans le pied de page de `layout.tsx`.

## Critères d'acceptation
1. `GET /confidentialite` répond 200, page statique, `lang="fr"`, en-têtes de sécurité, sans `X-Powered-By`.
2. La page contient les six rubriques ci-dessus, chacune sous un titre (`h2`) ; hiérarchie de titres valide.
3. Les formulaires `/inscription` et `/connexion` et le pied de page comportent un lien vers `/confidentialite` (cible ≥ 44 px).
4. Aucun `"use client"` sur la page.

## Règles applicables
`docs/rules/security.md` (RGPD), `docs/rules/nextjs.md`, `docs/rules/testing.md`.

## Hors périmètre
- Mentions légales (LCEN), conditions générales d'utilisation, bandeau cookies (aucun cookie non essentiel aujourd'hui) : fiches séparées si nécessaire. Registre des traitements (document interne de Hery).

## Définition de terminé
- [ ] Contenu fourni et validé par Hery
- [ ] Tests écrits par test-engineer, échouant avant implémentation
- [ ] `pnpm check` vert ; `pnpm build` vert ; `pnpm test:e2e` vert
- [ ] reviewer : OK ou remarques non bloquantes traitées
- [ ] security-auditor : OK (cohérence avec les traitements réels)
- [ ] Aucune déviation d'architecture (sinon ADR validée par Hery)
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer : …
- implémentation : …
- reviewer : …
- security-auditor : …
