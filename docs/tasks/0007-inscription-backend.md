# 0007 — Inscription : environnement, clients Supabase, domaine et cas d'usage

- Statut : done (16/11/2026)
- Agent : backend (tests : test-engineer)
- Phase : 1 (lot « inscription + appartenance », 2/3 ; dépend de 0006)
- ADR liées : 0002, 0004, 0010 (`service_role`), 0003 (version Next.js)

## Objectif
Le serveur sait inscrire une personne (e-mail + mot de passe), l'enregistrer comme membre de `carnet` avec son profil initial, et faire rejoindre `carnet` à un compte déjà existant sur l'instance. Tout passe par des cas d'usage testés, derrière des ports ; aucune page encore (fiche 0008).

## Périmètre de fichiers
- Autorisé (backend) : `package.json`, `pnpm-lock.yaml`, `.env.example`, `vitest.config.mts` (renommage de `vitest.config.ts`), `.github/workflows/ci.yml` (une ligne), `src/domain/profile/**` (hors tests), `src/domain/shared/**`, `src/server/**` (hors `booking/`, `adapters/`).
- Autorisé (test-engineer) : `src/**/*.test.ts`, `tests/integration/**`, `tests/builders/**`.
- Interdit : `src/app/`, `src/ui/`, `supabase/`, tout le reste.

## Décisions de conception (validées par Hery le 15/11/2026)
1. **Dépendances épinglées** (validées le 15/11/2026) : `zod` 4.6.7, `@supabase/supabase-js` 2.119.0, `@supabase/ssr` 0.12.7, `server-only` 0.0.1. Installation par `pnpm add --save-exact` (confirmation demandée par les réglages).
2. **Environnement** `src/server/infrastructure/env.ts` : schéma Zod analysé une fois au chargement, échec bruyant au démarrage. Publiques : `NEXT_PUBLIC_SUPABASE_URL` (URL), `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Serveur : `SUPABASE_SERVICE_ROLE_KEY`. `.env.example` documenté, `.env*` ignorés par git et interdits en lecture à Claude : Hery crée `.env.local` avec les valeurs de `supabase status`.
3. **Clients Supabase** : `infrastructure/supabase/server.ts` (`@supabase/ssr`, cookies de `next/headers`, `db: { schema: 'carnet' }`, une instance par requête) ; `infrastructure/supabase/admin.ts` (`import 'server-only'`, clé `service_role`, `db: { schema: 'carnet' }`, `auth: { persistSession: false, autoRefreshToken: false }`), importé uniquement par le registrar de l'ADR 0010 ; types générés `infrastructure/supabase/database.types.ts` par `supabase gen types typescript --local --schema carnet` (script `pnpm db:types`), versionnés.
4. **Domaine** (`src/domain/profile/slug.ts`, TypeScript pur) : value object `Slug` : `Slug.parse(text): Result<Slug, SlugError>` (même regex que la base), `Slug.fromDisplayName(name): Slug` (NFD sans diacritiques, minuscules, tout caractère hors `[a-z0-9]` → `-`, tirets fusionnés et rognés, complété à 3 caractères, tronqué à 40), `slug.withSuffix(suffix): Slug` (tronque pour rester ≤ 40). Ports : `src/domain/profile/ports.ts` → `ProfileRegistrar.register({ userId, displayName, slug }): Promise<Result<{ profileId }, 'slug_taken' | 'project_inactive' | 'unexpected'>>` ; `src/domain/shared/ports/auth-gateway.ts` → `AuthGateway.signUp({ email, password }): Promise<Result<{ userId, sessionCreated }, 'email_taken' | 'weak_password' | 'unexpected'>>`, `signIn`, `currentUser()` ; `src/domain/shared/ports/id-generator.ts` → `IdGenerator.uuid(): string` (injecté : aucun aléa direct dans le domaine ni les cas d'usage).
5. **Cas d'usage** (`src/server/use-cases/`) : `register-user.ts` : `signUp` → si `email_taken` → `err('email_taken')` ; sinon slug depuis le nom, `registrar.register` ; sur `slug_taken`, nouveau slug suffixé de 4 caractères tirés de `IdGenerator.uuid()`, trois tentatives au plus ; renvoie `ok({ profileId, needsEmailConfirmation: !sessionCreated })`. `ensure-membership.ts` : pour un compte authentifié (identifiant lu de la session serveur, jamais du client) non encore membre, même enregistrement avec un nom par défaut (partie locale de l'e-mail) ; idempotent par construction (`register_member`).
6. **Compte existant d'un autre projet** (ADR 0002) : GoTrue, confirmations activées, renvoie un utilisateur factice sans erreur pour un e-mail déjà pris (anti-énumération) ; le gateway le détecte (`identities` vide) et renvoie `email_taken`. Le parcours « se connecter puis rejoindre » passe par `ensure-membership`.
7. **Adaptateurs** : `src/server/repositories/supabase-profile-registrar.ts` (client admin, `rpc('register_member', …)`, mappage `23505` → `slug_taken`, `P0001` → `project_inactive`, reste → `unexpected` journalisé) ; `src/server/infrastructure/supabase/auth-gateway.ts` (client serveur) ; `src/server/infrastructure/id-generator.ts` (`crypto.randomUUID`). Composition root `src/server/container.ts` : fabriques par requête.
8. **Server Actions** dans `src/server/actions/auth.ts` (`'use server'`, périmètre backend) : `registerAction`, `signInAction`, `signOutAction`, structure `validate (Zod) → authenticate → authorize → useCase → map Result` ; entrées : `email` (Zod e-mail, 254), `password` (8 à 72), `displayName` (1 à 80). Clé d'idempotence de l'inscription : l'e-mail lui-même (GoTrue) et `register_member` (idempotente par compte) ; aucune colonne supplémentaire. Les pages (0008) ne font qu'appeler ces actions.
9. **Tests d'intégration** (`tests/integration/`) contre la pile locale : `globalSetup` qui lit `supabase status -o env` et renseigne `process.env` si les variables manquent (aucun secret en fichier ; la pile doit tourner, sinon le `globalSetup` échoue avec un message clair). `vitest.config.ts` renommé `vitest.config.mts` (report de la fiche 0001), jamais `"type": "module"` dans `package.json`.
10. **CI** : `NEXT_TELEMETRY_DISABLED: "1"` ajouté à `ci.yml` (report 0002). Les tests d'intégration et pgTAP en CI exigent la CLI Supabase dans GitHub Actions : fiche dédiée après 0008 ; d'ici là `pnpm check` en CI ne doit pas casser → les tests d'intégration sont exclus de `pnpm check` et lancés par `pnpm test:integration` (ajouté au script `check` quand la CI aura la pile).


## Contrats (figés pour que les tests précèdent le code ; noms et signatures à respecter)
```ts
// src/domain/shared/result.ts (existant) : Result<T, E>, ok(), err()

// src/domain/profile/slug.ts — TypeScript pur
export type Slug = string & { readonly __brand: 'Slug' };
export const SLUG_PATTERN: RegExp;                       // /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
export const RESERVED_SLUGS: ReadonlySet<string>;        // t, q, v, p, api, login, inscription, connexion, tableau-de-bord, verifier-email, deconnexion, _next, assets, admin, www
export function parseSlug(text: string): Result<Slug, 'invalid_slug' | 'reserved_slug'>;
export function slugFromDisplayName(name: string): Slug; // NFD sans diacritiques, minuscules, hors [a-z0-9] → '-', tirets fusionnés/rognés, < 3 → complété par '-' + 'x' répété de façon déterministe ('a' → 'a-x'), > 40 → tronqué sans tiret final ; si réservé → suffixe '-1'
export function slugWithSuffix(slug: Slug, suffix: string): Slug; // tronque la base pour rester ≤ 40, suffixe normalisé [a-z0-9]

// src/domain/profile/ports.ts
export type RegistrarError = 'slug_taken' | 'project_inactive' | 'unexpected';
export interface ProfileRegistrar { register(input: { userId: string; displayName: string; slug: Slug }): Promise<Result<{ profileId: string }, RegistrarError>>; }
export interface MembershipReader { isMember(): Promise<Result<boolean, 'unexpected'>>; } // compte de la session courante

// src/domain/shared/ports/auth-gateway.ts
export type SignUpError = 'email_taken' | 'weak_password' | 'rate_limited' | 'registration_closed' | 'unexpected'; // amendé 16/11 (audit) : GoTrue over_request_rate_limit/over_email_send_rate_limit → rate_limited ; signup_disabled → registration_closed
export type SignInError = 'invalid_credentials' | 'email_not_confirmed' | 'rate_limited' | 'unexpected'; // amendé 16/11 : email_not_confirmed dédié (renvoyé par GoTrue seulement après mot de passe valide, pas d'oracle)
export interface AuthGateway {
  signUp(input: { email: string; password: string }): Promise<Result<{ userId: string; sessionCreated: boolean }, SignUpError>>;
  signIn(input: { email: string; password: string }): Promise<Result<{ userId: string }, SignInError>>;
  signOut(): Promise<Result<void, 'unexpected'>>;
  currentUser(): Promise<Result<{ userId: string; email: string } | null, 'unexpected'>>;
}

// src/domain/shared/ports/id-generator.ts
export interface IdGenerator { uuid(): string; }

// src/domain/shared/ports/rate-limiter.ts
export interface RateLimiter { consume(input: { scope: RateLimitScope; subject: string; limit: number; windowSeconds: number }): Promise<Result<{ allowed: boolean }, 'unexpected'>>; }

// src/domain/shared/rate-limits.ts
export type RateLimitScope = 'signup' | 'login' | 'login-account';
export const RATE_LIMITS: Readonly<Record<RateLimitScope, { limit: number; windowSeconds: number }>>; // signup 10/3600, login 10/900, login-account 10/900
export const LONGEST_RATE_LIMIT_WINDOW_SECONDS: number; // max des fenêtres (= argument minimal de purge)

// src/server/use-cases/register-user.ts
export type RegisterUserError = 'rate_limited' | 'email_taken' | 'weak_password' | 'slug_unavailable' | 'registration_closed' | 'unexpected';
export function makeRegisterUser(deps: { auth: AuthGateway; registrar: ProfileRegistrar; ids: IdGenerator; rateLimiter: RateLimiter }):
  (input: { email: string; password: string; displayName: string; clientAddress: string }) => Promise<Result<{ profileId?: string; needsEmailConfirmation: boolean }, RegisterUserError>>;
// ordre : rate limit (signup, clientAddress) → signUp → si sessionCreated : slug → register (3 tentatives, suffixe = 4 premiers caractères hex de ids.uuid()) → ok({ profileId, needsEmailConfirmation: false }) ; sinon (option (a), Hery 16/11/2026) : AUCUN appel au registrar, ok({ needsEmailConfirmation: true }) sans profileId, l'adhésion se fait à la première connexion confirmée (sign-in → ensure-membership) ; rate_limited avant tout appel GoTrue ; rateLimiter 'unexpected' → err('unexpected') (fermeture sûre)

// src/server/use-cases/sign-in.ts
export type SignInUseCaseError = 'rate_limited' | 'invalid_credentials' | 'email_not_confirmed' | 'display_name_required' | 'slug_unavailable' | 'registration_closed' | 'unexpected'; // amendé 16/11
export function makeSignIn(deps: { auth: AuthGateway; membership: MembershipReader; registrar: ProfileRegistrar; ids: IdGenerator; rateLimiter: RateLimiter }):
  (input: { email: string; password: string; displayName?: string; clientAddress: string }) => Promise<Result<{ userId: string; joined: boolean }, SignInUseCaseError>>;
// ordre : rate limit login (adresse) puis login-account (e-mail normalisé) → signIn → isMember ? ok(joined=false) : (displayName ? register idempotent → ok(joined=true) : err('display_name_required'))

// src/server/infrastructure/env.ts
export const envSchema: z.ZodType<Env>; export function parseEnv(raw: NodeJS.ProcessEnv): Env; export const env: Env; // lazy ou module-level, mais parseEnv testable sans effet de bord
// Env : NEXT_PUBLIC_SUPABASE_URL (url), NEXT_PUBLIC_SUPABASE_ANON_KEY (min 20), SUPABASE_SERVICE_ROLE_KEY (min 20), RATE_LIMIT_SECRET (/^[0-9a-f]{64}$/), NODE_ENV

// src/server/infrastructure/client-address.ts — pure
export function clientAddressFrom(headers: Headers, options: { trustedProxyHops: number; production: boolean }): string;
// dernier élément de x-forwarded-for (trustedProxyHops = 1 → le dernier), net.isIP ; IPv4 mappée → IPv4 ; IPv6 → préfixe /64 canonique ('2001:db8:1:2::' sans zone) ; invalide ou absent → production ? 'unknown' : '127.0.0.1'

// src/server/repositories/supabase-rate-limiter.ts
export function rateLimitKey(secret: string, scope: RateLimitScope, subject: string): string; // `${scope}:${hmacSha256Hex(secret, `${scope}:${subject}`)}` → /^[a-z-]+:[0-9a-f]{64}$/
export function makeSupabaseRateLimiter(admin: SupabaseClient<Database, 'carnet'>, secret: string): RateLimiter; // rpc('consume_rate_limit', { p_key, p_limit, p_window: `${windowSeconds} seconds` })

// src/server/repositories/supabase-profile-registrar.ts
export function makeSupabaseProfileRegistrar(admin: SupabaseClient<Database, 'carnet'>): ProfileRegistrar; // rpc('register_member') ; **tout 23505 → slug_taken** (par construction de la fonction SQL, verrouillée par pgTAP, le seul conflit d'unicité possible est `profiles_slug_key` : aucun branchement sur le message, arbitrage H6 du 15/11/2026) ; P0001 → project_inactive ; reste → unexpected (journal : code seul + identifiant de corrélation, jamais message/details/hint)

// src/server/repositories/supabase-membership-reader.ts (ajout 15/11/2026, H1)
export function makeSupabaseMembershipReader(server: SupabaseClient<Database, 'carnet'>): MembershipReader; // rpc('is_member') sous la session courante

// src/server/infrastructure/supabase/auth-gateway.ts
export function makeSupabaseAuthGateway(server: SupabaseClient<Database, 'carnet'>): AuthGateway; // signUp : identities vide (confirmations activées) OU erreur GoTrue `user_already_exists` (confirmations désactivées, cas local) → email_taken ; code GoTrue `weak_password` → weak_password ; sessionCreated = !!data.session ; signIn : `invalid_credentials` → invalid_credentials

// src/server/container.ts
export function createContainer(): Promise<{ registerUser; signIn; auth: AuthGateway }>; // par requête (cookies) ; seul module autorisé à importer admin.ts (règle ESLint), il injecte les clients dans les fabriques

// src/server/actions/auth-schemas.ts (ajout 16/11, revue : module sans directive, partagé avec les formulaires 0008)
export const registerSchema: z.ZodType<{ email: string; password: string; displayName: string }>; export const signInSchema: z.ZodType<{ email: string; password: string; displayName?: string }>;
// displayName : trim, 1 à 80, aucun caractère de contrôle ni de format (/^[^\p{Cc}\p{Cf}]*$/u, audit 16/11)

// src/server/actions/auth.ts ('use server')
export type ActionState = { status: 'idle' } | { status: 'error'; error: RegisterUserError | SignInUseCaseError | 'invalid_input'; fields?: Record<string, string> } | { status: 'check_email' };
export async function registerAction(prev: ActionState, formData: FormData): Promise<ActionState>; // succès avec session → redirect('/tableau-de-bord') ; sans session → { status: 'check_email' }
export async function signInAction(prev: ActionState, formData: FormData): Promise<ActionState>; // succès → redirect('/tableau-de-bord')
export async function signOutAction(): Promise<void>; // → redirect('/connexion')
```
Tests unitaires (Vitest, `src/**/*.test.ts`) : `slug`, `rate-limits`, `client-address`, `rateLimitKey`, `parseEnv`, `register-user` et `sign-in` avec ports simulés (`tests/builders/` : `fakeAuthGateway`, `fakeRegistrar`, `fakeRateLimiter`, `fixedIds`), actions avec `vi.mock('@/server/container')` et `vi.mock('next/navigation')`. Tests d'intégration (`tests/integration/*.test.ts`, `pnpm test:integration`) : `register-user`, `sign-in` + `ensure-membership`, rate limiter réel (clé `signup`, 11e appel refusé, nettoyage par `purge` impossible sans attendre → clés uniques par exécution), nettoyage des comptes par `auth.admin.deleteUser(id, false)`.

## Critères d'acceptation
1. `pnpm check` vert ; `pnpm build` vert ; lint de couches : `src/domain` sans import `next`/`@supabase`/`react`.
2. `env.ts` : variables valides → objet typé ; `NEXT_PUBLIC_SUPABASE_URL` absente ou non-URL → exception au chargement (test unitaire avec `vi.stubEnv`).
3. `Slug` : `parse` accepte `abc`, `a-b`, 40 caractères ; refuse `ab`, `-abc`, `abc-`, `Abc`, `a_b`, 41 caractères ; `fromDisplayName('Élodie  Durand-Mérel!')` → `elodie-durand-merel` ; `fromDisplayName('A')` → complété à 3 caractères de façon déterministe (par exemple `a-0`… : à fixer par test-engineer, règle : jamais d'aléa) ; `fromDisplayName` d'un nom de 60 caractères → 40 au plus sans tiret final ; `withSuffix` conserve ≤ 40.
4. `register-user` (ports simulés) : `rate_limited` avant tout appel au gateway quand le limiteur refuse ; succès → `ok` avec `profileId` et `needsEmailConfirmation` ; `email_taken` → `err('email_taken')` sans appel au registrar ; `slug_taken` puis succès → deux appels, second slug suffixé ; trois `slug_taken` → `err('slug_unavailable')` ; `project_inactive` → `err('registration_closed')` ; `weak_password` → `err('weak_password')`.
5. `sign-in` (ports simulés) : deux compteurs consommés dans l'ordre `login` (adresse) puis `login-account` (e-mail normalisé) ; refus de l'un → `rate_limited` sans appel au gateway ; identifiants invalides → `invalid_credentials` ; membre → `ok({ joined: false })` sans appel au registrar ; non membre sans nom → `display_name_required` ; non membre avec nom → registrar appelé avec l'identifiant renvoyé par `signIn` (jamais une entrée du client) → `ok({ joined: true })` ; rejoué → idempotent.
6. Intégration (pile locale) : inscription d'un e-mail unique → compte GoTrue, appartenance `carnet`, profil non publié avec le slug attendu ; réinscription du même e-mail → `email_taken` ; connexion d'un compte créé directement par le client admin (sans appartenance) avec un nom → appartenance et profil, `joined: true` ; seconde connexion → `joined: false` ; limiteur réel : 11e appel `signup` d'une même adresse refusé ; chaque test nettoie ses comptes (`auth.admin.deleteUser(id, false)`, suppression dure → cascade vérifiée).
7. `database.types.ts` généré, à jour avec les trois migrations (vérification : `pnpm db:types` ne produit aucun diff).
8. Server Actions : entrée invalide → `{ status: 'error', error: 'invalid_input' }` sans appel au cas d'usage ; succès → `redirect('/tableau-de-bord')` ; inscription sans session → `{ status: 'check_email' }` ; `signOutAction` appelle `signOut` puis `redirect('/connexion')` ; `clientAddressFrom` : dernier élément de `x-forwarded-for`, IPv4 mappée, IPv6 /64, zone retirée, absent/invalide → `unknown` en production et `127.0.0.1` sinon ; tests unitaires avec conteneur simulé.

## Règles applicables
`docs/rules/nextjs.md` (Server Actions, env), `docs/rules/security.md` (`admin.ts`), `docs/rules/solid-dry.md`, `docs/rules/design-patterns.md`, `docs/rules/idempotence.md`, `docs/rules/testing.md`.

## Points reportés par les audits 0005 et 0006 (à intégrer aux critères)
- Journalisation : erreurs du registrar journalisées par `code` + nom de contrainte + identifiant de corrélation, jamais `details`/`hint`/`message` bruts (les `DETAIL` Postgres contiennent la ligne entière). Mappage 23505 → `slug_taken` seulement si la contrainte est `profiles_slug_key` ; 23503 et le reste → `unexpected`. Jamais de branchement sur le message.
- `admin.ts` : `import 'server-only'` et règle ESLint `no-restricted-imports` n'autorisant son import que depuis `src/server/container.ts` (injection de dépendances : les adaptateurs reçoivent le client ; un seul point d'import, ADR 0011 vérifiable par lint ; *amendé le 15/11/2026*).
- Zod : `displayName` `trim`, 1 à 80, refus des caractères de contrôle ; `password` 8 à 72 ; slug généré validé par la même regex que la base + liste de réservés (`t`, `q`, `v`, `p`, `api`, `login`, `inscription`, `connexion`, `tableau-de-bord`, `_next`, `assets`…) ; validation même sur rejeu.
- `ensure-membership` : ne dérive pas le nom de la partie locale de l'e-mail ; la page de connexion (0008) demande un nom si le compte n'est pas encore membre. Le cas d'usage reçoit donc `displayName` en entrée.
- Limitation de débit par adresse du visiteur (décision Hery 15/11/2026 : table `carnet.rate_limits`, fiche 0009, ADR 0011) : port `RateLimiter.consume(scope, subject): Promise<Result<boolean, 'unexpected'>>` dans `src/domain/shared/ports/`, adaptateur `src/server/repositories/supabase-rate-limiter.ts` (client admin, `rpc('consume_rate_limit', …)`, clé = `scope + ':' + sha256(RATE_LIMIT_SECRET + scope + adresse)` hex), env `RATE_LIMIT_SECRET` (32 octets min, serveur) ; seuils (Hery, 15/11/2026) : inscription 10 par adresse et par heure (`signup`), connexion 10 par adresse et par 15 minutes (`login`) **et** 10 par compte et par 15 minutes (`login-account`, sujet = e-mail normalisé en minuscules) ; pas de compteur global pour l'instant ; adresse lue de `x-forwarded-for` au **dernier** élément (posé par le proxy le plus proche, Traefik d'EasyPanel ; constante `TRUSTED_PROXY_HOPS = 1`), jamais le premier (contrôlable par le client) ; validée par `net.isIP` ; en production, en-tête absente ou invalide → seau fixe `unknown` journalisé ; `127.0.0.1` hors production seulement ; IPv6 agrégée au /64 avant empreinte, `::ffff:a.b.c.d` ramenée à l'IPv4 (tests : formes compressée, mappée, avec zone). Empreinte : HMAC-SHA256 (`createHmac('sha256', secret).update(scope + ':' + adresse)`), `RATE_LIMIT_SECRET` 32 octets hex (64 caractères, Zod `min(64)`), clé finale `^[a-z-]+:[0-9a-f]{64}$` sans l'adresse (test unitaire). Constante unique « plus longue fenêtre » partagée avec l'argument de purge. Sur dépassement, `err('rate_limited')` avant tout appel à GoTrue, avec le délai dans le message. À arbitrer par Hery avant lancement : seuil d'inscription 5 ou 10 par heure (salons, Wi-Fi partagé) ; second compteur de connexion par compte (`login-account:` + HMAC de l'e-mail normalisé, 10 par 15 minutes) ; compteur global `signup:global` (~25 par heure) face au plafond e-mail GoTrue (30 par heure pour toute l'instance).
- Tests d'intégration : nettoyage par `auth.admin.deleteUser(id, false)` (suppression dure) et vérification de la cascade appartenance + profil.

## Consignes de déploiement complémentaires (s'ajoutent à 0003 à 0009)
1. Réseau : conteneur Next.js joignable par Traefik seulement (aucun port publié sur l'hôte, réseau Traefik uniquement). Tests avant ouverture : depuis deux réseaux différents l'adresse retenue diffère ; en-tête `X-Forwarded-For` forgé à travers Traefik → le dernier élément reste l'adresse réelle ; accès direct au port → refusé. Si Cloudflare est ajouté, `TRUSTED_PROXY_HOPS` passe à 2.
2. Traefik : `X-Forwarded-Host` = hôte public, `X-Forwarded-Proto: https` (vérification d'origine des Server Actions ; sinon `serverActions.allowedOrigins`) ; HSTS côté proxy, cookies `Secure`.
3. EasyPanel : `SUPABASE_SERVICE_ROLE_KEY` et `RATE_LIMIT_SECRET` en variables d'exécution seulement ; `NODE_ENV=production` posé par `next start`.
4. CI : dès que `pnpm build` évaluera `env.ts` (0008), variables factices satisfaisant le schéma, jamais les vraies clés.
5. GoTrue (instance) : `GOTRUE_RATE_LIMIT_SIGN_IN_SIGN_UPS` (30 par 5 minutes et par IP : global pour carnet) à relever ou accepter ; `GOTRUE_RATE_LIMIT_EMAIL_SENT` ; état des confirmations à confirmer (les deux chemins sont gérés) ; `GOTRUE_SESSIONS_TIMEBOX` / `INACTIVITY_TIMEOUT` (cookie 400 jours, jetons de rafraîchissement sans expiration par défaut) ; GoTrue ≥ 2.185.0.
6. Avant l'ouverture publique : flux « mot de passe oublié » ; purge des comptes non confirmés anciens (opération d'instance, ADR plateforme) ; purge `pg_cron` de `rate_limits` (0009).

## Points à reporter en 0008
- Cookies : mêmes `cookieOptions` dans `proxy.ts` ; proxy sur runtime Node, `getUser()` ; jamais de cookies posés par un route handler Edge.
- CSP complète avec nonce par requête via `proxy.ts` (`default-src 'self'`, `script-src 'self' 'nonce-…'`, `form-action 'self'`, `base-uri 'none'`, `object-src 'none'`, `frame-ancestors 'none'`) ; aujourd'hui seul `frame-ancestors` est posé.
- Messages : `invalid_credentials` et `rate_limited` génériques (délai indiqué) ; `email_taken` avec lien vers la connexion ; `email_not_confirmed` → « confirmez votre e-mail » ; `unexpected` neutre ; traduction de `fields` par nom de champ sans écho de la valeur.
- Mention RGPD sous les formulaires (finalité, destinataire, durée, instance partagée, compteurs pseudonymisés 24 h) ; `autocomplete="new-password"`, `maxLength`.
- `signOutAction` ignore le `Result` de `signOut` : état d'erreur ou nouvelle tentative.
- Si option (a) retenue : `check_email` sans `profileId`, adhésion à la première connexion (le formulaire de connexion demande déjà un nom au non-membre).

## Hors périmètre
- Pages, formulaires, `proxy.ts`, E2E → 0008. Supabase en CI → fiche CI. Turnstile sur l'inscription : non prévu par l'ADR 0008 (contact et rendez-vous) ; GoTrue limite déjà le débit des inscriptions. Lien magique, OAuth : plus tard.

## Définition de terminé
- [x] Tests écrits par test-engineer, échouant avant implémentation (vérifié : 7 verts sur 66 avant implémentation)
- [x] `pnpm check` (268) et `pnpm test:integration` (26) verts ; `pnpm build` vert ; pgTAP 532 — vérifiés par l'orchestrateur le 16/11/2026 après l'option (a)
- [x] reviewer : OK, remarques non bloquantes traitées (schémas extraits, ADR 0012 rédigée, ESLint, `slugWithSuffix`, `eventId`, tests du gateway)
- [x] security-auditor : rien de bloquant ; durcissements retenus appliqués (cookies, journal `unknown_address`, garde des tests d'intégration, mappages GoTrue, `\p{Cf}`, `server-only`) ; option (a) retenue par Hery le 16/11/2026 (appliquée avant clôture)
- [x] Aucune déviation d'architecture (ADR 0012 acceptée par Hery le 16/11/2026)
- [x] Ligne ajoutée dans `docs/journal.md`

## Rapports
- test-engineer (15/11/2026) : 9 fichiers unitaires (slug, rate-limits, client-address, env, rate-limiter, profile-registrar, register-user, sign-in, actions), builders partagés (`tests/builders/` : journal d'appels, fakes des ports, client admin simulé avec erreurs PostgREST réalistes, env), 3 fichiers d'intégration + `setup/` (globalSetup `supabase status -o env`, clients, fixtures uniques par exécution, nettoyage par suppression dure avec vérification de cascade). 66 tests : 7 verts (existants), le reste rouge ou sauté (imports introuvables), vérifié par l'orchestrateur. Hypothèses retenues : H1 fabrique `makeSupabaseMembershipReader` ajoutée au contrat ; H2 réservés vérifiés avant le motif ; H3 complétion `-x`/`x-x` ; H4 `trustedProxyHops` = n-ième depuis la fin ; H6 tout 23505 → `slug_taken` (test « owner_id_key → unexpected » à inverser) ; H7 gateway mappe `user_already_exists` et identités vides vers `email_taken` ; H8 même politique de slug en `sign-in` ; ESLint : `admin.ts` importable depuis `container.ts` seulement. Config Vitest attendue : deux projets `unit` et `integration` (globalSetup, 30 s, séquentiel), alias `server-only` → module vide en test. Retouches appliquées : import de `makeSupabaseMembershipReader` dans les tests d'intégration ; test 23505 inversé (`it.each` : `slug_taken` quelle que soit la contrainte).
- implémentation (backend, 16/11/2026) : dépendances exactes installées (`zod` 4.6.7, `@supabase/supabase-js` 2.119.0, `@supabase/ssr` 0.12.7, `server-only` 0.0.1) ; domaine pur (`rate-limits`, ports, `slug`) ; `env.ts` (`parseEnv(Partial<ProcessEnv>)`, `env` évalué au chargement), `client-address.ts`, `logger.ts` (`logInfrastructureError` : JSON `{ level, source, code, correlationId }`), `id-generator.ts`, clients `server.ts`/`admin.ts` (`server-only`), `auth-gateway.ts` (`email_taken` sur `user_already_exists`/`email_exists`/identités vides), trois repositories, cas d'usage `register-user`, `sign-in`, `ensure-membership` + étapes partagées `enforce-rate-limits` et `register-profile`, `container.ts` (seul importateur d'`admin.ts`, règle ESLint), `actions/auth.ts` ; `vitest.config.mts` à deux projets ; scripts `test`, `test:integration`, `db:types` ; `database.types.ts` généré sans diff ; CI `NEXT_TELEMETRY_DISABLED`. `pnpm check` 220 tests verts, `pnpm test:integration` 12 verts, `pnpm build` vert. Écarts déclarés : type de `parseEnv`, étapes partagées, `displayName` vide = absent en connexion, `email_not_confirmed` → `unexpected` (0008 décidera d'une erreur dédiée). **Bloqué** : `.env.example` non créé (réglages : toute écriture `.env*` refusée) → contenu transmis à Hery. Point pour 0008/CI : `env` évalué à l'import, le prérendu au build exigera les variables dès qu'une page importera `src/server`. Vérifié par l'orchestrateur le 16/11/2026 : `pnpm check` 220/220, intégration 12/12, build vert, domaine sans import `next`/`react`/`@supabase`/`node:`, dépendances et scripts conformes, CI amendée.
- implémentation, retouches post-revue et audit (backend, 16/11/2026) : `auth-schemas.ts` (sans directive, `\p{Cc}` et `\p{Cf}` refusés), cookies `httpOnly`/`secure` (production)/`lax`, journal `unknown_address` (`logWarning`), `server-only` dans `env.ts` (alias Vitest vers `server-only/empty.js`), gateway en tables code → erreur (`rate_limited`, `registration_closed`, `email_not_confirmed`), `slugWithSuffix` borné (toujours 3 à 40), `eventId`, ESLint étendu (pureté du domaine, frontière de présentation ADR 0012, motifs `admin.{js,ts}` explicites). `pnpm check` 251 tests, intégration 12, build vert, `db:types` sans diff. `.env.example` toujours à créer par Hery.
- test-engineer, compléments post-revue et audit (16/11/2026) : `auth-gateway.test.ts` (25 tests, fake du client `auth` avec les vraies classes d'erreur supabase-js), cas `email_not_confirmed`/`rate_limited`/`registration_closed` dans les cas d'usage, U+202E/U+200B/U+200D/U+00AD refusés par les schémas et les actions, `slugWithSuffix` borné, `env.test.ts` sans `delete`, garde `assertLocalSupabaseUrl` (12 tests, `CARNET_INTEGRATION_ALLOW_REMOTE=1` pour lever), `CarnetClient` importé. 267 unitaires, 26 intégration. Vérifié par l'orchestrateur le 16/11/2026 : `pnpm check` 267/267, intégration 26/26, build vert, pgTAP 532/532, retouches présentes (`\p{Cf}`, cookies, `server-only`, `eventId`).
- implémentation, option (a) (backend + test-engineer, 16/11/2026) : `register-user` n'appelle le registrar que si `sessionCreated` ; sans session → `ok({ needsEmailConfirmation: true })` sans `profileId` ; tests unitaires stricts (séquence sans `registrar.register`), `check_email` simulé sans `profileId`, test d'intégration rétréci (`profileId` attendu avec session, confirmations désactivées en local). Vérifié par l'orchestrateur : `pnpm check` 268/268, intégration 26/26, build vert.
- reviewer (16/11/2026) : **OK, remarques non bloquantes.** Couches, contrats, écarts déclarés, mappages confrontés au SQL, `Result` partout, conteneur par requête, règle ESLint, Vitest à deux projets, tests (builders, idempotence) : conformes. À corriger (retenu) : schémas Zod extraits dans `src/server/actions/auth-schemas.ts` (module sans directive, importable par les formulaires 0008) ; emplacement `src/server/actions/` à consigner par ADR → ADR 0012 rédigée (Proposée). Suggestions retenues : `slugWithSuffix` borne la longueur du suffixe (invariant du value object) ; ESLint : pureté du domaine étendue à `@/server`, `@/app`, `@/ui` et aux builtins Node sans préfixe, et `src/app`/`src/ui` interdits d'importer `repositories/*` et `infrastructure/*` ; `correlationId` renommé `eventId` (identifiant par ligne, pas de corrélation par requête : fiche observabilité) ; tests unitaires du gateway GoTrue (`email_taken` par identités vides et `user_already_exists`, `weak_password`, `invalid_credentials`, `currentUser`), `email_exists` documenté ; `env.test.ts` sans `delete process.env` ; `tests/integration/setup/clients.ts` importe `CarnetClient` ; `RATE_LIMIT_SECRET` inutile dans le globalSetup. Non retenus : `env` paresseux (les tests figent l'échec au chargement ; la CI `e2e` recevra des variables factices de build, fiche CI/0008) ; `fields` en codes plutôt qu'en messages (0008 traduit par nom de champ) ; alias `server-only` (à ajouter au premier test important `container.ts`). Pour 0008 : `signOutAction` ignore le `Result` de `signOut` (contrat `void`) → état d'erreur ou nouvelle tentative à prévoir.
- security-auditor (16/11/2026) : **à corriger, rien de bloquant.** Confinement `service_role`, chaîne `validate → useCase`, identité toujours issue de GoTrue, limitation de débit (ordre, portées, HMAC, fermeture sûre), journalisation sans donnée personnelle, dépendances exactes et à jour (`@supabase/ssr` 0.12.7, `supabase-js` 2.119.0, `zod` 4.6.7 : incident de dépôt zod du 21/09 sans version npm malveillante) : conformes. **Élevé (consigne de déploiement)** : la lecture du dernier élément de `x-forwarded-for` n'est sûre que si seul Traefik atteint Next.js (aucun port publié) ; NAT Docker → seau unique → fermeture de l'inscription ; tests réseau avant ouverture. **Moyen, soumis à Hery** : `register-user` écrit appartenance et profil sous l'identité renvoyée par `signUp` même sans session (confirmations activées : un `signUp` sur un compte existant non confirmé d'un autre projet répond sans authentifier) → option (a) n'écrire que si `sessionCreated`, sinon adhésion à la première connexion confirmée (`ensure-membership`), ou (b) risque accepté. **Moyens, retenus** : cookies `@supabase/ssr` sans `secure` ni `httpOnly` par défaut → `cookieOptions { httpOnly: true, secure: production, sameSite: 'lax' }` (mêmes options dans `proxy.ts`, 0008) ; journal `unknown_address` quand l'adresse tombe dans le seau `unknown` ; tests d'intégration refusant toute URL non locale (suppression dure par `listUsers`/`deleteUser` sur toute l'instance sinon). Feuille de route : réinitialisation de mot de passe avant l'ouverture publique, purge des comptes non confirmés (ADR plateforme). **Faibles, retenus** : `server-only` dans `env.ts` ; mappages GoTrue (`email_not_confirmed` dédié, `over_*_rate_limit` → `rate_limited`, `signup_disabled` → `registration_closed`) ; motifs ESLint `**/supabase/admin.{js,ts}` ; `displayName` sans `\p{Cf}` (U+202E, zéro-largeur). Non retenus : `Pick<CarnetClient, 'rpc'>` (contrats figés), `check_email` dans les deux cas (énumération d'e-mail acceptée, mitigée 10/h), identifiant de corrélation par requête (fiche observabilité). Veille : rien de nouveau.
