# Projet Sens'Air  
Capteurs fixes de qualité de l’air – BUT Mesures Physiques

Ce dépôt regroupe le code et la documentation du système **Sens'Air** (air extérieur), développé dans le cadre d'un projet du BUT Mesures Physiques pour analyser la qualité de l’air sur le site du parc Longchamps.

---

## Objectifs du projet

- Mettre en place **des capteurs fixes** de qualité de l’air extérieur.
- Assurer **l’acquisition, l’envoi et la visualisation** des données (temps réel + historique).
- Proposer un **prototype réaliste “quasi-industriel”** : boîtier, électronique, dashboard.
- Réaliser **un échantillonage** avec comparaison des données à celle d'AtmoSud. 

---


### Sens'Air – Air extérieur  

**Fonctionnalités principales :**

 - Mesure :
  - Particules fines : **NextPM (Tera)**
  - Température / humidité : **BME280 (Bosch)**
- Connexion **Wi-Fi**
- Gestion de **LED** pour afficher la connexion Wifi ou le dépassement de seuils. 
- Envoi de données **toutes les minutes** vers le serveur HTTP
- Boîtier **étanche** adapté à l’extérieur
- Possibilité de **cartographie** dans l’interface client

---

## Architecture globale

### Matériel (hardware)

- Microcontrôleur : **ESP-32-WROOM-32U**  - 5/15 euro
- Capteurs :
  - NextPM (PM1 / PM2.5 / PM10) - 90/110 euro
  - BME280 (T°, RH) - 5/10 euro 

- Affichage :
  - LED (indicateur simple) – 0.10 euro
- Programmation via **module CH340** (convertisseur USB ↔ UART nécessaire).

### Logiciel (software)

- **Firmware ESP32** (Arduino / PlatformIO)
- **Transport des données** : HTTP
- **Base de données** : InfluxDB 
- **Dashboard / UI** : site web (Chart.js, etc.), (https://risx31.github.io/nebuleair-site/index.html)


![image](image/Décrochage2.jpg)

## Architecture logicielle 

L'écosystème **NebuleAir** repose sur une architecture en trois couches, conçue pour offrir une visualisation propre de nos données.

### 1. Stockage et Backend (Data Layer)
* **Base de données InfluxDB (Cloud)** : Les données envoyées par l'ESP32 sont stockées dans un bucket nommé `Nodule Air`. Il s'agit d'une base de données basée en "séries temporelles", idéale pour le suivi.
* **Proxy Render (Middleware)** : Pour sécuriser les clés d'API et contourner les restrictions CORS, un proxy intermédiaire hébergé sur **Render** (`nebuleairproxy.onrender.com`) assure la liaison entre le site web et InfluxDB.

### 2. Interface Client (Frontend)
Le site est une application web statique (HTML/CSS/JS) organisée en plusieurs modules :

* **Dashboard (`index.html` & `dashboard.js`)** : 
    * Affiche les dernières mesures de particules fines (PM1, PM2.5, PM10), température et humidité en temps réel.
    * Visualisation graphique interactive via **Chart.js**.
    * Cartographie **Leaflet** pour localiser précisément le capteur fixe.
    * Système d'exportation des données au format CSV avec choix de la fréquence d'échantillonnage.
* **Module de Comparaison & Calibration (`comparaison.html` & `comparaison.js`)** :
    * Permet de confronter les données brutes du capteur aux données de référence de la station **AtmoSud** (MRS-LCP).
    * Calcule automatiquement des indicateurs de performance : corrélation ($R^2$), erreur ($RMSE$) et classement par "Division" (A, B ou Hors Critères) selon les standards de qualité.
    * **Auto-calibration** : Utilise une régression linéaire pour calculer des coefficients de correction ($a$ et $b$) afin d'ajuster la dérive des capteurs.

### 3. Fonctionnalités Transverses
* **Gestion du thème** : Un mode sombre/clair persistant est intégré via `common.js` et le `localStorage` du navigateur.
* **Correction dynamique** : Une fois la calibration effectuée, la correction peut être activée sur le dashboard principal pour ajuster les valeurs de PM2.5 affichées.
* **Easter Egg** : Un jeu "Snake" est intégré au site, activable via le mot-clé secret "snake" au clavier.

### Technologies utilisées
* **Langages** : HTML5, CSS3, JavaScript (ES6+).
* **Librairies** : [Chart.js](https://www.chartjs.org/), [Leaflet](https://leafletjs.com/), [date-fns](https://date-fns.org/).
* **Hébergement** : GitHub Pages pour le site statique et Render pour le proxy API.

## Organisation du dépôt

Le projet est structuré de manière à séparer la logique de présentation (HTML), les styles (CSS), les scripts de traitement (JS) et les données de test (Data).

### 📂 Racine du projet
* `index.html` : Page d'accueil et Dashboard principal du projet.
* `comparaison.html` : Interface dédiée à l'analyse comparative et à la calibration des capteurs.
* `dashboard.html` : Vue alternative ou détaillée des mesures en temps réel.
* `status.html` / `settings.html` : Pages de suivi de l'état du système et de configuration des paramètres.
* `README.md` : Documentation principale du projet.

### 📂 assets/ (Ressources statiques)
* **`/js/`** : Contient l'intelligence du site.
    * `api.js` : Gestion des requêtes vers le proxy InfluxDB.
    * `dashboard.js` : Logique d'affichage des graphiques et de mise à jour des cartes de données.
    * `comparaison.js` : Algorithmes de régression linéaire, calcul des KPIs ($R^2$, $RMSE$) et gestion des CSV.
    * `common.js` : Fonctions transverses (thème sombre, formatage du temps).
    * `snake.js` : Code source de l'Easter Egg interactif.
* **`/css/`** : Feuilles de style organisées par modules (`style.css`, `dark.css`, `dashboard.css`).
* **`/data/`** : Stockage des fichiers de données pour la démonstration.
    * `Données_brutes2026.CSV` : Données issues du capteur Sens'Air.
    * `MRS-LCP.CSV` : Données de référence de la station AtmoSud Longchamp.

### 📂 image/
* Regroupe les photographies du prototype, du boîtier et des installations sur site pour illustrer le rapport de projet.
