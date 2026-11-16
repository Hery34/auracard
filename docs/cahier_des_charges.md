> **Document d'origine, amendé par `docs/scope.md`** (FluidCalendar remplacé par un module natif, indépendants d'abord, Supabase auto-hébergé, statistiques sans n8n).

# Cahier des Charges Fonctionnel et Technique : SaaS de Cartes de Visite Connectées (NFC & QR Code)

## 1. Introduction et Contexte du Projet

### 1.1. Présentation du Produit
Le projet consiste à développer une solution SaaS permettant aux professionnels de gérer, partager et mettre à jour leur identité numérique professionnelle ("Smart Business Card"). Chaque utilisateur dispose d'un profil numérique hébergé dans le cloud, accessible instantanément via deux vecteurs physiques :
1. **Une pastille NFC / Carte physique** (à approcher du smartphone de l'interlocuteur).
2. **Un QR Code dynamique** (affiché au dos du support physique ou sur un écran/signature email).

### 1.2. Objectifs Métier
* **Image de marque :** Offrir une première impression haut de gamme, moderne et éco-responsable.
* **Zéro friction :** Permettre l'enregistrement direct des contacts dans le carnet d'adresses du destinataire sans installation d'application mobile.
* **Centralisation & Analytics :** Permettre aux individus et aux équipes (B2B) de piloter leur réseau, de suivre les performances de leurs interactions et d'automatiser le suivi commercial.

---

## 2. Spécifications de la Stack Technique

* **Front-end :** Next.js (React) pour un rendu ultra-rapide (SSR/SSG), un SEO optimisé pour les pages profils publiques et une expérience utilisateur fluide.
* **Back-end & Base de données :** Supabase (PostgreSQL, Authentification, Row Level Security - RLS, Stockage de fichiers et Realtime).
* **Automatisations :** n8n (self-hosted ou cloud) pour la gestion des webhooks, la synchronisation CRM et les notifications asynchrones.
* **Prise de rendez-vous :** Intégration native avec FluidCalendar.

---

## 3. Périmètre Fonctionnel

### 3.1. Espace Public : La Page Profil du Contact (Landing Page Mobile)
C'est la page visible par l'interlocuteur après le scan du QR code ou du tag NFC.
* **Design responsive & épuré :** Chargement instantané (< 1 seconde), mode sombre/clair automatique, design aux couleurs de la marque ou de l'utilisateur.
* **En-tête de profil :** Photo de profil professionnelle, nom, prénom, poste, entreprise et mini-bio.
* **Boutons d'action principaux (CTA) :**
  * "Ajouter aux contacts" (Téléchargement direct du fichier `.vcf` ou vCard v3.0/v4.0).
  * "Prendre un rendez-vous" (Intégration directe du widget de prise de rendez-vous **FluidCalendar**).
* **Liens et Réseaux :**
  * Liens cliquables vers les réseaux sociaux professionnels (LinkedIn, X, Instagram, GitHub...).
  * Liens vers le site web de l'entreprise, catalogue produits ou brochure PDF.
  * Coordonnées cliquables (Téléphone, E-mail, Adresse physique avec géolocalisation).
* **Module "Lead Capture" (Échange mutuel) :** Un formulaire discret permettant à l'interlocuteur de laisser son propre nom, email et message pour que le propriétaire de la carte reçoive immédiatement ses coordonnées.

### 3.2. Espace Utilisateur : Tableau de Bord (Dashboard Next.js)
* **Authentification sécurisée :** Connexion via Supabase Auth (Email/Mot de passe + SSO Google/LinkedIn si possible).
* **Éditeur de profil en temps réel :**
  * Modification des informations textuelles, des liens et des visuels (logo, avatar, bannière).
  * Aperçu en direct (Live Preview) du rendu mobile de la carte.
* **Générateur de QR Code :**
  * Génération automatique d'un QR code dynamique lié à l'URL unique du profil.
  * Options de personnalisation graphique du QR code (couleurs, intégration du logo au centre).
* **Association du tag NFC :**
  * Interface permettant d'associer l'identifiant unique d'une pastille NFC au compte de l'utilisateur (via un lien de provisioning ou un scan d'activation).
* **Statistiques et Analytics :**
  * Nombre total de scans / taps NFC.
  * Statistiques par période (jour, semaine, mois).
  * Suivi des clics par lien (ex: combien ont cliqué sur LinkedIn vs FluidCalendar).

### 3.3. Espace Administrateur (Multi-utilisateurs / B2B)
* **Gestion d'équipe (Workspace) :** Création d'une organisation, ajout de collaborateurs.
* **Charte graphique unifiée :** Application d'un modèle de design global (template d'entreprise) pour tous les collaborateurs afin de garantir l'homogénéité de l'image de marque.
* **Rôles et Permissions :** Administrateur vs Utilisateur standard.

---

## 4. Architecture des Données (Supabase)

La base de données PostgreSQL sur Supabase s'articulera autour des tables principales suivantes :

1. `users` (géré en partie par Supabase Auth) : Informations de compte et abonnements.
2. `profiles` : Données de la carte de visite (titre, bio, avatar_url, banner_url, theme_config, fluidcalendar_link, etc.).
3. `nfc_tags` : Table de liaison entre les puces physiques (UID du tag) et les `profiles`.
4. `links` : Liens sociaux et professionnels rattachés à un profil (`profile_id`, `platform`, `url`, `position`).
5. `analytics_events` : Logs de chaque interaction (`profile_id`, `event_type` [scan_nfc, scan_qr, click_link], `user_agent`, `created_at`).
6. `leads` : Contacts récoltés via le formulaire d'échange mutuel (`profile_id`, `name`, `email`, `message`, `created_at`).

*Mesures de sécurité :* Mise en place rigoureuse des politiques **Row Level Security (RLS)** pour que chaque utilisateur ne puisse modifier que ses propres données.

---

## 5. Workflows d'Automatisation (n8n)

L'outil **n8n** servira de chef d'orchestre pour les traitements asynchrones et l'interconnexion :

1. **Workflow de Lead Capture :**
   * *Déclencheur :* Webhook Supabase lorsqu'un prospect remplit le formulaire d'échange mutuel sur la page profil.
   * *Actions :* 
     * Envoi d'une notification e-mail ou push au propriétaire de la carte.
     * Création automatique d'un contact dans le CRM de l'entreprise (ex: HubSpot, Notion ou Google Sheets).
     * Envoi d'un e-mail de remerciement automatisé au prospect avec les coordonnées du propriétaire en pièce jointe (`.vcf`).
2. **Workflow d'Analytics :**
   * *Déclencheur :* Webhook lors d'un scan ou d'un clic de lien.
   * *Actions :* Nettoyage et agrégation des données pour alimenter un tableau de bord analytique propre sans surcharger la base de données principale.

---

## 6. Planning et Étapes de Développement

* **Phase 1 : Socle Technique & Base de Données**
  * Configuration du projet Next.js et connexion à Supabase.
  * Mise en place du schéma SQL et des règles RLS.
* **Phase 2 : Développement du Profil Public & Génération vCard**
  * Création de la page profil mobile-first ultra-rapide.
  * Intégration du téléchargement de la vCard et du widget **FluidCalendar**.
* **Phase 3 : Tableau de Bord & Gestion des NFC/QR**
  * Interface d'édition du profil utilisateur.
  * Générateur de QR code dynamique et association des pastilles NFC.
* **Phase 4 : Automatisations et Analytics**
  * Connexion des webhooks avec **n8n** pour la gestion des leads et des notifications.
  * Implémentation des graphiques de statistiques.
* **Phase 5 : Recette, Tests et Déploiement**
  * Tests sur différents smartphones (iOS/Android, lecture NFC et caméra pour QR).
  * Mise en production (Vercel pour Next.js, Supabase Cloud, instance n8n).
