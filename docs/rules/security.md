# Sécurité et RGPD

## Authentification et autorisation
- **DOIT** : vérification de la session et du droit dans chaque Server Action / route handler (voir `nextjs.md`).
- **DOIT** : isolation multi-projets par RLS (voir `supabase.md`).
- **DOIT** : client `service_role` uniquement dans `src/server/infrastructure/supabase/admin.ts`, importé seulement par les cas d'usage listés dans une ADR.

## Secrets
- **DOIT** : aucun secret dans le dépôt ; `.env*` dans `.gitignore` et interdits en lecture pour Claude (`.claude/settings.json`).
- **DOIT** : aucun secret dans les exports n8n (références aux *credentials* uniquement).

## Surfaces publiques (profil, formulaire de contact, rendez-vous)
- **DOIT** : limitation de débit par IP et par profil (table `carnet.rate_limits` ou proxy) + défi anti-robot (Cloudflare Turnstile ou équivalent, choix par ADR).
- **DOIT** : validation Zod stricte, longueur maximale sur chaque champ texte.
- **DOIT** : e-mail et téléphone publics rendus de façon à gêner l'aspiration (assemblage côté client au clic, pas de `mailto:` en clair dans le HTML statique).
- **DOIT** : option `noindex` par profil, activée par défaut.

## NFC et QR
- La puce NFC et le QR code ne contiennent **que** une URL de redirection (`/t/{uid}`, `/q/{code}`) : jamais l'URL directe du profil ni une donnée personnelle.
- Les puces standard sont clonables : aucune décision de sécurité ne repose sur la possession d'une puce.

## Jetons
- Jetons d'annulation / report / activation : 32 octets aléatoires minimum, **seul le hash** (SHA-256) est stocké, expiration obligatoire, usage unique quand c'est pertinent.
- **Exception validée par Hery (17/11/2026, fiche 0024)** : code d'activation **imprimé** remis avec une puce NFC. 10 caractères Crockford (≈ 50 bits), haché en bcrypt (`crypt`/`gen_salt('bf')`), sans expiration (valable tant que la puce existe, réutilisable après libération). Conditions : identifiant de puce aléatoire et non énumérable, réponse identique pour toute erreur (puce inconnue, code faux, puce prise), **limitation de débit obligatoire** par compte et par adresse sur l'activation.

## RGPD
- **DOIT** : minimisation : pas d'adresse IP brute stockée dans les statistiques (hash journalier salé au plus, ou pays dérivé puis IP jetée) ; user-agent réduit à une catégorie (mobile / desktop / bot).
- **DOIT** : mention d'information sur le formulaire de contact et la page de rendez-vous (finalité, destinataire, durée).
- **DOIT** : durées de conservation définies (événements bruts, leads, rendez-vous passés) et appliquées par une tâche `pg_cron`.
- **DOIT** : suppression de compte = suppression en cascade des données du projet `carnet` et de l'appartenance `platform.project_members`.
- Instance auto-hébergée : l'hébergement doit rester dans l'Union européenne.

## En-têtes HTTP
- CSP stricte (nonces si scripts en ligne), `frame-ancestors 'none'` sauf pages d'intégration explicitement prévues.
