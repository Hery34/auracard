# 0005 — Module de rendez-vous natif en deux phases
- Statut : Acceptée (14/11/2026)

## Contexte
Le cahier des charges prévoyait FluidCalendar. Hery préfère un outil natif pour consolider les données (entonnoir scan → profil → rendez-vous). Un outil qui ne lit pas l'agenda réel provoque des doubles réservations.

## Décision
- **Phase 1** : disponibilités gérées dans l'application, réservation, e-mails + `.ics`, annulation / report par lien, rappels.
- **Phase 2** : port `CalendarProvider` avec adaptateurs Google Calendar et Microsoft Graph (lecture des occupations, écriture des événements).
- Garanties en base : contrainte d'exclusion anti-chevauchement, clé d'idempotence unique.
- Agent dédié : `scheduling`.

## Conséquences
- Données complètes de bout en bout, aucune dépendance à un service tiers en phase 1.
- En phase 1, l'utilisateur tient ses disponibilités à jour lui-même : à dire clairement dans l'interface.
- La phase 2 implique une vérification OAuth par Google (portée calendrier) : délai à anticiper.

## Alternatives écartées
- FluidCalendar : projet jeune, multi-tenant incertain.
- Lien Calendly / Cal.com : rupture de l'entonnoir de données.
