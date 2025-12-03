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
- **Dashboard / UI** : site web (Chart.js, etc.), (https://risx31.github.io/nebuleair-site/dashboard.html)

- ![Léonard aka la pomme malicieuse](\Users\Etu\Downloads\pomme_mechante.png)




