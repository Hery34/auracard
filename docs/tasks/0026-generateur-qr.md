# 0026 — Générateur de QR code

- Statut : todo (après 0025)
- Agent : backend (dépendance `uqr`, cas d'usage du style) ; frontend (éditeur, rendu, export) ; test-engineer
- Phase : 3 (3/3)
- ADR liées : 0013

## Objectif
Le propriétaire voit son QR code (`/q/{code}`), choisit ses couleurs (contraste minimal vérifié), ajoute le logo de son profil au centre (correction d'erreur H) et le télécharge en SVG et PNG.

## À détailler avant lancement
Dépendance `uqr` validée par Hery (17/11/2026, 0 dépendance, MIT) ; contraste et sens clair/sombre ; taille du logo bornée ; export PNG par canvas dans le navigateur ; le QR encode l'URL issue de `SITE_URL` : **le domaine définitif doit être choisi avant toute impression**.
