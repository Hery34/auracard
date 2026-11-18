# Architecture — carnet

> Statut : **validée par Hery** (14/11/2026).
> Une fois validée, ce document est figé. Toute évolution passe par une ADR et un accord explicite.

## 1. Vision en une phrase
Un professionnel indépendant partage son profil par une puce NFC ou un QR code ; le visiteur enregistre la vCard, laisse ses coordonnées ou prend rendez-vous ; le propriétaire suit tout le parcours dans ses statistiques.

## 2. Périmètre validé
Voir `docs/scope.md`. En bref : **indépendants d'abord**, pas de carnet de contacts côté utilisateur, statistiques, module de rendez-vous **natif** (phase 1 sans synchronisation d'agenda, phase 2 Google/Outlook).

## 3. Architecture en couches (hexagonale)

```
 src/app  (Next.js : pages, Server Actions, route handlers)   ─┐
 src/ui   (composants React)                                    │ dépend de ↓
 src/server  (cas d'usage, repositories, adaptateurs, container)│
 src/domain  (entités, value objects, règles, ports) ◄──────────┘  ne dépend de rien
```

- **domain** : TypeScript pur. Entités (`Profile`, `Link`, `NfcTag`, `Lead`, `Booking`, `AvailabilityRule`), value objects (`Slug`, `Email`, `TimeZone`, `TimeRange`), règles, **ports** (`ProfileRepository`, `CalendarProvider`, `Clock`, `IdGenerator`, `OutboxWriter`).
- **server** : cas d'usage (un par intention), repositories Supabase, adaptateurs, composition root (`container.ts`), infrastructure (clients Supabase, env, logger).
- **app / ui** : présentation. N'accède aux données que via les cas d'usage.

### Arborescence
```
src/
├── domain/
│   ├── profile/   analytics/   lead/   nfc/   booking/
│   └── shared/            # Result, value objects communs, ports transverses (Clock, IdGenerator)
├── server/
│   ├── use-cases/         # register-user, update-profile, record-event, capture-lead, …
│   ├── booking/           # cas d'usage du module rendez-vous (agent scheduling)
│   ├── repositories/      # implémentations Supabase des ports
│   ├── adapters/          # e-mail, stockage, fournisseurs d'agenda (agent integrations)
│   ├── infrastructure/    # supabase/{server,admin}.ts, env.ts, logger.ts
│   └── container.ts       # composition root
├── app/
│   ├── (public)/p/[slug]/            # profil public (statique + ISR)
│   ├── (public)/p/[slug]/rdv/        # prise de rendez-vous
│   ├── (public)/t/[uid]/route.ts     # redirection NFC (+ événement)
│   ├── (public)/q/[code]/route.ts    # redirection QR (+ événement)
│   ├── (public)/v/[slug]/route.ts    # téléchargement vCard (+ événement)
│   ├── (public)/api/beacon/route.ts  # vues et clics
│   ├── (dashboard)/…                 # éditeur, statistiques, NFC/QR, disponibilités
│   └── (auth)/…
└── ui/
    ├── primitives/        # boutons, champs, cartes
    └── features/          # composants par fonctionnalité
supabase/migrations/   supabase/tests/   n8n/workflows/   tests/{integration,e2e,builders}/
```

## 4. Données

### 4.1 Instance partagée — schéma `platform` (registre commun, ADR 0002)
| Table | Colonnes principales | Rôle |
|---|---|---|
| `platform.projects` | `id`, `slug` (unique, `carnet`), `name`, `db_schema` (unique), `status` (`active`/`archived`), `created_at`, `updated_at` | Liste des projets de l'instance. |
| `platform.project_members` | `project_id`, `user_id` → `auth.users`, `role` (`owner`/`admin`/`user`), `created_at` ; clé primaire (`project_id`, `user_id`) | Appartenance d'un compte à un projet. |

Fonction `platform.is_project_member(p_slug text) → boolean` (`security definer`, `stable`, `search_path = ''`). Écritures réservées à `service_role`. Lecture : chacun ne voit que ses propres appartenances.

### 4.2 Schéma `carnet` (modèle logique — le SQL est écrit par db-architect)
| Table | Contenu | Points clés |
|---|---|---|
| `profiles` | `owner_id`, `slug` (unique), nom, poste, entreprise, bio, avatar, bannière, `theme`, coordonnées, `is_published`, `is_indexable` | 1 profil par utilisateur au MVP (contrainte levable). |
| `links` | `profile_id`, `platform`, `url`, `label`, `position` | Ordre unique par profil. |
| `nfc_tags` | `uid` (unique), `profile_id` (nullable), `status` (`stock`/`assigned`/`disabled`), `activation_code_hash` | Une puce peut être réassignée. |
| `qr_codes` | `code` (court, unique), `profile_id`, `style` | Code stable imprimé ; cible modifiable. |
| `analytics_events` | `id` (fourni par l'émetteur), `profile_id`, `type`, `source` (`nfc`/`qr`/`direct`), `link_id`, `device_class`, `country`, `is_bot`, `occurred_at` | Brut, idempotent, durée de conservation bornée. |
| `analytics_daily` | `profile_id`, `day`, `metric`, `value` ; unique (`profile_id`, `day`, `metric`) | Agrégats `pg_cron`, recalculables. |
| `leads` | `profile_id`, `name`, `email`, `message`, `consent_at`, `idempotency_key` | Formulaire de contact. |
| `event_types` | `profile_id`, `title`, `duration_min`, `buffer_min`, `min_notice_min`, `is_active` | Types de rendez-vous. |
| `availability_rules` | `profile_id`, `weekday`, `start_time`, `end_time`, `time_zone` | Disponibilités récurrentes. |
| `availability_exceptions` | `profile_id`, `range` (`tstzrange`), `kind` (`busy`/`extra`) | Absences, ouvertures ponctuelles. |
| `bookings` | `profile_id`, `event_type_id`, `range` (`tstzrange`), visiteur, `status`, `cancel_token_hash`, `idempotency_key` | **Contrainte d'exclusion** (`btree_gist`) : pas de chevauchement de réservations confirmées par profil. |
| `outbox` | `id`, `type`, `payload`, `created_at`, `locked_at`, `processed_at`, `attempts`, `last_error`, `status` | Effets externes (§7). |

Fonctions d'autorisation : `carnet.is_member()` (= `platform.is_project_member('carnet')`), `carnet.can_edit_profile(profile_id)`. Toutes les politiques passent par elles (ADR 0004).
Accès public : vue `carnet.public_profiles` (profils publiés, colonnes publiques uniquement).

## 5. Flux principaux

### 5.1 Scan NFC / QR
```
puce NFC → https://<domaine>/t/{uid}      QR → https://<domaine>/q/{code}
        └── route handler : résout la cible, écrit l'événement (id unique), 307 → /p/{slug}
```
- La redirection est **toujours** servie par nous : réassignation possible, statistiques fiables, puces et QR jamais réimprimés.
- Puce non assignée → page d'activation (code d'activation à saisir par le propriétaire connecté).

### 5.2 Profil public
- Page statique (ISR) invalidée par tag à chaque modification. Aucune donnée personnelle non publiée dans le HTML.
- Vues et clics envoyés par *beacon* (`navigator.sendBeacon`) vers `/api/beacon`, filtrés (robots, aperçus de liens) côté serveur.

### 5.3 vCard
- `/v/{slug}` génère la vCard 3.0 (compatibilité maximale) avec en-têtes `text/vcard` + `Content-Disposition`. Photo incluse en taille réduite.
- Détection des navigateurs intégrés (LinkedIn, Instagram…) : message invitant à ouvrir dans le navigateur.

### 5.4 Contact (lead)
- Formulaire → Server Action (Zod, anti-robot, limitation de débit, clé d'idempotence) → `leads` + événement `outbox` dans **la même transaction**.

## 6. Module de rendez-vous (ADR 0005)
- **Phase 1** : types de rendez-vous, disponibilités récurrentes et exceptions, calcul des créneaux (fonction pure), réservation, e-mails avec `.ics`, annulation et report par lien, rappels.
- **Phase 2** : port `CalendarProvider` implémenté pour Google (Calendar API, *free/busy*) et Microsoft (Graph). Lecture des occupations au calcul des créneaux, écriture de l'événement à la réservation. Jetons OAuth chiffrés.
- Garanties : anti-chevauchement en base, idempotence par clé, UTC + fuseau IANA, cas DST testés.
- Données consolidées : `booking_viewed`, `booking_started`, `booking_confirmed` alimentent l'entonnoir scan → profil → rendez-vous.

## 7. Asynchrone : outbox + n8n (ADR 0006)
```
transaction métier ──► insert carnet.outbox ──► n8n (interrogation périodique ou déclencheur pg_net)
                                                   ├─ e-mail propriétaire (nouveau lead / rendez-vous)
                                                   ├─ e-mail visiteur (confirmation + .ics / vCard)
                                                   ├─ rappels de rendez-vous
                                                   └─ (option) CRM du propriétaire
```
- n8n ne reçoit **rien** directement du navigateur et ne traite **pas** les statistiques (insertion directe + agrégation en base).
- Traitement idempotent : réservation de l'événement, action, `processed_at` ; erreurs → `attempts`, puis statut `dead` + alerte.

## 8. Environnements et hébergement
- **Supabase** : instance auto-hébergée existante (UE), schéma `carnet`. Une base de développement locale (`supabase start`) pour les tests.
- **Next.js** : Docker sur VPS EasyPanel (ADR 0007).
- **n8n** : instance existante, workflows versionnés dans `n8n/workflows/`.
- Domaine : `auracard.fr` (ADR 0015), URL courte et stable pour les puces et QR, gravée dans le matériel donc irréversible ; branché plus tard.

## 9. Phases (révisées)
1. **Socle** : initialisation Next.js (version corrigée la plus récente), outillage (`pnpm check`, CI), registre `platform`, schéma `carnet` de base, inscription + appartenance.
2. **Profil public & vCard** : éditeur minimal, page profil, vCard, liens.
3. **NFC / QR** : redirections, activation des puces, générateur de QR.
4. **Statistiques & contact** : événements, agrégats, tableau de bord, formulaire de contact, outbox + n8n.
5. **Rendez-vous phase 1**.
6. **Recette & mise en production**.
7. **Rendez-vous phase 2** (synchronisation Google / Outlook).

## 10. Points ouverts (à trancher par ADR, avec Hery)
- Hébergement Next.js.
- Nom de domaine des redirections.
- Bibliothèque de dates/fuseaux (Temporal natif si disponible dans la version Node retenue, sinon alternative).
- Solution anti-robot.
- Fournisseur d'envoi d'e-mails.
- Facturation (hors MVP) et comportement d'un profil quand l'abonnement expire.