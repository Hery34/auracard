# 0003 — Politique de version Next.js
- Statut : Acceptée (14/11/2026)

## Contexte
Hery veut éviter d'exposer des CVE connues. En 2026, Next.js a connu de nombreux avis de sécurité, dont plusieurs critiques (exécution de code à distance via l'optimisation d'images, contournements du middleware, SSRF sur les déploiements auto-hébergés). Vercel publie désormais des correctifs de sécurité mensuels. Au 14/11/2026, la dernière version corrigée est la **16.4.5** (3 novembre 2026).

## Décision
- Version **exacte** épinglée, la plus récente corrigée au moment de l'initialisation (vérifiée ce jour-là, pas recopiée de ce document).
- Veille mensuelle par `security-auditor` ; `pnpm audit` en CI.
- Réduction de surface : `images.unoptimized: true`, pas de `next/og` sans ADR, pas de WebSocket servi par Next.js, autorisation jamais déléguée au middleware/proxy.

## Conséquences
- Une fiche de mise à jour par mois environ.
- Les images doivent être redimensionnées au téléversement ou par le stockage.

## Alternatives écartées
- Branche 15.x LTS : fin de vie proche, et les correctifs y arrivent aussi.
- Plages `^16.x` : mise à jour silencieuse non testée.
