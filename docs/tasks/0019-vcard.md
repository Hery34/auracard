# 0019 — vCard `/v/{slug}`

- Statut : todo (après 0017)
- Agent : backend (sérialisation vCard, cas d'usage) ; frontend (route handler) ; test-engineer
- Phase : 2 (4/6)
- ADR liées : —

## Objectif
« Ajouter aux contacts » télécharge une vCard 3.0 que les carnets d'adresses iOS et Android importent correctement.

## Périmètre de fichiers
- Autorisé (backend) : `src/domain/profile/vcard.ts` (sérialiseur pur), `src/server/use-cases/get-vcard.ts`, `src/server/container.ts`.
- Autorisé (frontend) : `src/app/(public)/v/[slug]/route.ts`.
- Autorisé (test-engineer) : `src/domain/profile/vcard.test.ts`, `tests/e2e/vcard.spec.ts`.
- Interdit : tout le reste.

## Décisions de conception
1. **vCard 3.0** (`docs/architecture.md` §5.3) : `BEGIN`, `VERSION:3.0`, `N`, `FN`, `ORG`, `TITLE`, `EMAIL;TYPE=INTERNET`, `TEL;TYPE=CELL`, `URL` (site, puis profil public), `NOTE` (bio), `PHOTO;ENCODING=b;TYPE=JPEG` (après 0021, taille réduite), `END`.
2. **Encodage** : UTF-8, fins de ligne CRLF, échappement de `\`, `,`, `;` et des sauts de ligne (`\r\n`, `\r` et `\n` isolés), caractères de contrôle retirés (règle valable aussi si des liens entrent plus tard dans la vCard), pliage des lignes à 75 octets sans couper un caractère multioctet. Fonction pure, testée sur des cas accentués, emoji et champs vides.
3. **Réponse** : `Content-Type: text/vcard; charset=utf-8`, `Content-Disposition: attachment; filename="<slug>.vcf"`, mêmes en-têtes de sécurité, cache revalidé par le tag `profile:<slug>` ; profil non publié → 404.
4. **Nom** : `N` dérivé de `display_name` (tout le nom dans le champ « nom » si on ne peut pas séparer prénom et nom de façon fiable).

## Critères d'acceptation
1. Unitaires : sortie exacte attendue pour un profil complet, minimal, accentué et avec des caractères à échapper ; aucune ligne de plus de 75 octets.
2. E2E : `GET /v/{slug}` d'un profil publié → 200, en-têtes attendus, contenu analysable ; non publié → 404.
3. `pnpm check`, `pnpm build`, E2E verts.

## Hors périmètre
- vCard 4.0, QR code de la vCard, statistiques de téléchargement (phase 4).

## Définition de terminé
- [ ] Tests écrits par test-engineer, échouant avant implémentation
- [ ] `pnpm check` vert ; `pnpm test:e2e` vert
- [ ] reviewer : OK ou remarques non bloquantes traitées
- [ ] security-auditor : OK
- [ ] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer : …
- implémentation : …
- reviewer : …
- security-auditor : …
