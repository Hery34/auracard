# 0007 — Hébergement Next.js sur un VPS administré par EasyPanel
- Statut : Acceptée (14/11/2026)

## Contexte
`docs/architecture.md` §8 laissait l'hébergement de Next.js ouvert (Vercel ou conteneur sur l'infrastructure de Hery), à trancher avant la phase 5. Supabase et n8n sont déjà auto-hébergés ; `docs/rules/security.md` impose un hébergement dans l'Union européenne. Hery dispose d'un VPS administré par EasyPanel.

## Décision
- Next.js tourne dans **un conteneur Docker sur le VPS**, déployé par **EasyPanel** depuis le dépôt Git.
- Construction par un **`Dockerfile` versionné** (Node LTS et pnpm épinglés, `output: 'standalone'`), pas par Nixpacks ni Buildpacks : la version exacte de Next.js (ADR 0003) et du runtime est maîtrisée dans le dépôt. Le `Dockerfile` est un fichier de configuration racine, confié à `backend`.
- **Une seule instance** au MVP. TLS et reverse proxy assurés par EasyPanel ; les en-têtes de sécurité sont posés par l'application, pas par le proxy.
- Variables d'environnement et secrets saisis dans EasyPanel, jamais dans le dépôt.
- La CI (GitHub Actions) exécute `pnpm check` ; le déploiement de `main` n'a lieu qu'après une CI verte.
- Tâches planifiées : `pg_cron` côté base et n8n (ADR 0006). Aucune dépendance à un cron d'hébergeur.
- Le VPS est situé dans l'Union européenne.

## Conséquences
- Positives : coût fixe, aucune dépendance à un fournisseur de plateforme, données et traitements en UE, cohérence avec Supabase et n8n auto-hébergés. L'application est sans état : la donnée vit dans Supabase, un conteneur se recrée sans perte.
- ISR et `revalidateTag` fonctionnent avec le cache fichier par défaut tant qu'il n'y a qu'une instance.
- Négatives : pas de CDN en bordure ; le temps de réponse dépend du VPS. Acceptable, les pages publiques sont servies en ISR.
- Le serveur Next.js est exposé directement : la veille et les mises à jour mensuelles de l'ADR 0003 deviennent d'autant plus importantes.
- Risques : point de panne unique (acceptable au MVP) ; un passage à plusieurs réplicas exigerait un cache partagé (`cacheHandler` Redis) et une nouvelle ADR.
- Prérequis : un dépôt Git distant (GitHub) dès la phase 1.

## Alternatives écartées
- Vercel : coût variable, dépendance à un fournisseur, infrastructure déjà disponible chez Hery.
- Construction automatique EasyPanel (Nixpacks / Buildpacks) : versions de Node et pnpm moins maîtrisées.
