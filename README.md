# Projet ModuleAir / NebuleAir  
Capteurs fixes de qualité de l’air – BUT Mesures Physiques

Ce dépôt regroupe le code et la documentation des systèmes **ModuleAir** (air intérieur) et **NebuleAir** (air extérieur), développés dans le cadre du BUT Mesures Physiques pour analyser la qualité de l’air sur le campus de l’IUT et autour du parc Longchamp / St Jérôme. :contentReference[oaicite:0]{index=0}

---

## Objectifs du projet

- Concevoir **des capteurs fixes** de qualité de l’air intérieur et extérieur.
- Assurer **l’acquisition, l’envoi et la visualisation** des données (temps réel + historique).
- Proposer un **prototype réaliste “quasi-industriel”** : boîtier, électronique, firmware, dashboard.
- Préparer **une démonstration client** avec comparaison de la qualité d’air intérieur / extérieur. 

---

## Les deux systèmes

### 1. ModuleAir – Air intérieur

Capteur dédié aux mesures en exterieur  

**Fonctionnalités principales :**

- Mesure :
  - Température et humidité : **BME-280**
  - Particules fines : **NextPM (Tera)**
- Affichage sur **écran LED matriciel 64×32**  
  - Rafraîchissement toutes les 2 minutes  
  - Codes couleur selon les seuils de qualité
- Connexion **Wi-Fi**
- Envoi des données vers un serveur  
  - **MQTT** ou **HTTP (POST)**
- Intégration dans un **boîtier** (usage semi-industriel / pédagogique)

### 2. NebuleAir – Air extérieur

Capteur dédié aux mesures en extérieur sur le campus / alentours. :contentReference[oaicite:3]{index=3}  

**Fonctionnalités principales :**

- Mesure :
  - Particules fines : **NextPM (Tera)**
  - Température / humidité : **BME280 (Bosch)**
- Gestion d’une **LED WS2812** (ou anneau/bande) pour afficher un niveau de pollution
- Connexion **Wi-Fi**
- Envoi de données **toutes les minutes** vers le serveur (MQTT ou HTTP)
- Boîtier **étanche** adapté à l’extérieur
- Possibilité de **cartographie / géolocalisation** dans l’interface client

---

## Architecture globale

### Matériel (hardware)

- Microcontrôleur : **ESP-32-WROOM-32U**
- Capteurs :
  - NextPM (PM1 / PM2.5 / PM10)
  - BME280 (T°, RH) – NebuleAir
  - MH-Z19B (CO₂) – ModuleAir
- Affichage :
  - Matrice LED 160×80 mm 64×32 px – ModuleAir
  - LED WS2812 (indicateur simple) – NebuleAir
- Programmation via **module CH340** (convertisseur USB ↔ UART nécessaire). :contentReference[oaicite:4]{index=4}  

### Logiciel (software)

- **Firmware ESP32** (Arduino / PlatformIO)
- **Transport des données** : MQTT ou HTTP
- **Base de données** : InfluxDB ou équivalent
- **Dashboard / UI** : site web (Chart.js, etc.), Node-RED UI ou front maison
- (Optionnel) Flows Node-RED pour parsing, stockage, visualisation simple


