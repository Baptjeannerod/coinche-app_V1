# Coinche Nights (offline, 100% vanilla)

**Fonctionnalités clés**
- Gestion joueurs (ajout/renommage/suppression, unicité).
- Sessions par date, présences par joueur.
- Appairages par round, tables de 4 quand possible, rotation des joueurs en attente.
- Saisie scores, désignation vainqueur, cagnotte automatique (€/perdant).
- Stats par joueur, binômes favoris, exports CSV/JSON, import JSON (remplacer ou fusionner).
- PWA optionnelle : cache app-shell, offline.

## Installation
1. Déposez tous les fichiers sur un serveur statique (ou ouvrez `index.html` en file:// avec Chrome).
2. (Optionnel) Installez l’app sur iPad via « Partager » → « Sur l’écran d’accueil ».
3. Le service worker met en cache l’app-shell (offline).

## Sauvegardes
- Export JSON pour backup, Import JSON (remplacer/fusionner).
- Export CSV pour l’historique des tables.

## Maintenance
- Bouton « Vider cache PWA » pour forcer la mise à jour (pensez à incrémenter `CACHE_NAME` dans `sw.js`).
- « Reset données » efface `localStorage` (`coinche_v1`).

## Données
Voir `schema.json` pour la structure. Les tables stockent `loserPaysPerPlayer` au moment de la partie (historique préservé).
