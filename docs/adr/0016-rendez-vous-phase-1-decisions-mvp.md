# 0016 — Rendez-vous phase 1 : décisions MVP
- Statut : Acceptée (18/11/2026)

## Contexte
L'ADR 0005 fixe un module de rendez-vous natif en deux phases ; `docs/architecture.md` §4 esquisse les tables (`event_types`, `availability_rules`, `availability_exceptions`, `bookings`) et §6 les garanties. Avant le découpage de la phase 5 (fiches 0036 à 0042), Hery a tranché les choix de fond le 18/11/2026.

## Décision
1. **Confirmation immédiate** : une réservation valide (Turnstile, limites de débit, anti-chevauchement en base) est confirmée dès l'envoi ; pas de validation du propriétaire ni de double opt-in.
2. **Un fuseau horaire par profil** (IANA, défaut `Europe/Paris`) : toutes les disponibilités du propriétaire y sont exprimées. **Amende `docs/architecture.md` §4** : `availability_rules.time_zone` est remplacé par un fuseau porté par le profil. Le visiteur voit les créneaux dans le fuseau de son navigateur ; le fuseau du propriétaire est indiqué s'il diffère.
3. **Lieu par type de rendez-vous** : mode `in_person` / `phone` / `video` et texte libre (adresse ou lien de visio fixe), repris dans les e-mails et le `.ics`. Pour `phone`, le téléphone du visiteur est obligatoire. Aucune intégration Meet/Teams en phase 1.
4. **Rappel** : un e-mail au visiteur 24 h avant (aucun si la réservation est faite moins de 24 h avant), avec les liens d'annulation et de report ; planifié par `pg_cron`, qui écrit dans l'outbox.
5. **Anti-chevauchement déclaratif** : contrainte d'exclusion sur `bookings` (`tstzrange`, réservations confirmées, par profil) avec l'extension `btree_gist`, installée par la migration (`create extension if not exists btree_gist with schema extensions`). Hery confirme sa disponibilité sur l'instance partagée avant déploiement.
6. **Créneaux** : horizon de 60 jours ; pas = durée du type ; tampon appliqué après chaque rendez-vous ; délai minimal par type (défaut 2 h).
7. **Annulation et report par le visiteur** (lien à jeton haché, reçu par e-mail) tant que le rendez-vous commence après le délai minimal du type ; au-delà, la page invite à contacter le propriétaire. Le propriétaire peut annuler à tout moment depuis son tableau de bord ; le visiteur est prévenu.
8. **Données du visiteur** : nom et e-mail obligatoires, téléphone obligatoire seulement pour le mode `phone`, message facultatif ; consentement et mention RGPD (art. 13, sur le modèle de 0032) ; suppression 12 mois après la date du rendez-vous (`pg_cron`).

## Conséquences
- Positives : parcours sans friction, données complètes pour l'entonnoir scan → profil → rendez-vous ; garantie anti-double-réservation en base.
- Négatives : une fausse adresse e-mail peut bloquer un créneau (atténué par Turnstile, les limites et l'annulation par le propriétaire) ; un propriétaire qui change de fuseau doit revoir ses disponibilités.
- Risques : `btree_gist` est une extension d'instance (partagée) — standard et sans effet sur les autres schémas, mais à confirmer ; l'interface doit rappeler qu'en phase 1 l'agenda réel n'est pas lu (ADR 0005).

## Alternatives écartées
- Validation par le propriétaire, double opt-in par e-mail : plus de flux, plus de friction.
- Fuseau par règle (schéma initial) : rarement utile pour un indépendant, plus complexe à saisir et à tester.
- Verrou applicatif (`pg_advisory_xact_lock`) au lieu de la contrainte d'exclusion : pas de garantie déclarative.
- Horizon et pas réglables, deux rappels, conservation de 3 mois : reportés ou non retenus pour le MVP.
