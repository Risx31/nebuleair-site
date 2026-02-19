/***************************************************************************
  Projet NebuleAir – Mesure de la qualité de l’air extérieur
  Carte : ESP32-WROOM-32U
  Capteurs : BME280 (I²C) + NextPM (UART)
  Indicateur : LED WS2812 (niveau de pollution)
  Version : 4.1 (WiFi station + WiFiManager + InfluxDB Cloud)

  👉 Objectif :
  Mesurer la qualité de l’air extérieur, envoyer les données vers InfluxDB Cloud,
  gérer une connexion WiFi robuste et indiquer l’état du système via LEDs.
***************************************************************************/

/* =======================================================================
   =========================  LIBRAIRIES  ================================
   ======================================================================= */

// Gestion WiFi ESP32
#include <WiFi.h>

// Serveur local (utilisé par WiFiManager)
#include <WebServer.h>
#include <DNSServer.h>

// Communication I2C
#include <Wire.h>

// BME280
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>

// UART secondaire pour NextPM
#include <HardwareSerial.h>

// LEDs WS2812
#include <Adafruit_NeoPixel.h>

// Gestion simplifiée du WiFi (portail captif)
#include <WiFiManager.h>

// -------- InfluxDB (envoi des données Cloud) --------
#include <InfluxDbClient.h>
#include <InfluxDbCloud.h>


/* =======================================================================
   ======================== CONFIG INFLUXDB ==============================
   ======================================================================= */

// Paramètres Cloud (URL, organisation, bucket, token sécurisé)
#define INFLUXDB_URL "https://eu-central-1-1.aws.cloud2.influxdata.com"
#define INFLUXDB_TOKEN "TOKEN"
#define INFLUXDB_ORG "ORG_ID"
#define INFLUXDB_BUCKET "Nodule Air"
#define TZ_INFO "UTC1"

// Création du client InfluxDB
InfluxDBClient influx(
  INFLUXDB_URL,
  INFLUXDB_ORG,
  INFLUXDB_BUCKET,
  INFLUXDB_TOKEN,
  InfluxDbCloud2CACert
);

// Création d’un point de mesure nommé "nebuleair"
Point sensor("nebuleair");


/* =======================================================================
   ============================ CAPTEURS ================================
   ======================================================================= */

// -------- BME280 (Température / Humidité / Pression) --------
#define BME_I2C_ADDRESS 0x76
Adafruit_BME280 bme;

// -------- NextPM (Particules fines) --------
// Utilisation de Serial1 (UART matériel secondaire)
#define serialNPM Serial1
#define PM_SERIAL_RX 39
#define PM_SERIAL_TX 32

// Variables de stockage des mesures PM
float pm1_ugm3  = 0.0;
float pm25_ugm3 = 0.0;
float pm10_ugm3 = 0.0;

// Indique si la lecture capteur est valide
bool sensorOK = false;

// Timer lecture NextPM
unsigned long nextpm_previousMillis = 0;
const unsigned long nextpm_interval = 10000; // toutes les 10 secondes


/* =======================================================================
   ============================== LED ===================================
   ======================================================================= */

// LED WS2812
#define LED_PIN   33
#define LED_COUNT 2

// LED 0 = WiFi, LED 1 = état capteur
#define LED_WIFI   0
#define LED_SENSOR 1

Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);


/* =======================================================================
   ============================= TIMERS =================================
   ======================================================================= */

unsigned long previousMillis = 0;
const unsigned long interval = 10000; // Envoi des données toutes les 10 sec


/* =======================================================================
   ========================== NEXTPM LOGIC ===============================
   ======================================================================= */

// Vérifie l’intégrité du message reçu (checksum)
bool checksum_valid(const uint8_t (&data)[16]) {
  uint8_t sum = 0;
  for (int i = 0; i < 16; i++) sum += data[i];
  return (sum % 0x100 == 0);
}

// Envoie la commande au capteur NextPM pour demander les concentrations
void send_concentration_command() {
  const uint8_t cmd[] = {0x81, 0x12, 0x6D};
  serialNPM.write(cmd, 3);
}

// Lecture complète des données particules
void read_concentration() {

  sensorOK = false;  // Par défaut on considère la mesure invalide

  send_concentration_command();

  // Attente de réponse (timeout 3 secondes)
  unsigned long timeout = millis();
  while (!serialNPM.available() && millis() - timeout < 3000) delay(10);
  if (!serialNPM.available()) return;

  // Recherche de l’entête du message
  const uint8_t header[2] = {0x81, 0x12};
  if (!serialNPM.find(header, 2)) return;

  uint8_t state, data[12], checksum;

  // Lecture des données
  if (serialNPM.readBytes(&state, 1) != 1) return;
  if (serialNPM.readBytes(data, 12) != 12) return;
  if (serialNPM.readBytes(&checksum, 1) != 1) return;

  // Reconstruction message complet pour vérification
  uint8_t full_msg[16];
  full_msg[0] = header[0];
  full_msg[1] = header[1];
  full_msg[2] = state;
  memcpy(&full_msg[3], data, 12);
  full_msg[15] = checksum;

  // Vérification intégrité
  if (!checksum_valid(full_msg)) return;

  // Extraction des valeurs PM (division par 10 selon protocole Tera)
  pm1_ugm3  = word(data[6],  data[7])  / 10.0;
  pm25_ugm3 = word(data[8],  data[9])  / 10.0;
  pm10_ugm3 = word(data[10], data[11]) / 10.0;

  sensorOK = true;
}


/* =======================================================================
   ========================== GESTION LED ================================
   ======================================================================= */

// Animation quand le WiFi est connecté
void wifiOkAnimation() {
  for (int i = 0; i < 3; i++) {
    strip.setPixelColor(LED_WIFI, strip.Color(0, 0, 150));
    strip.show();
    delay(200);
    strip.setPixelColor(LED_WIFI, 0);
    strip.show();
    delay(150);
  }
}

// LED capteur : vert si OK, rouge sinon
void updateSensorLed(bool ok) {
  strip.setPixelColor(
    LED_SENSOR,
    ok ? strip.Color(0,150,0) : strip.Color(150,0,0)
  );
  strip.show();
}


/* =======================================================================
   ============================ WIFI ROBUSTE =============================
   ======================================================================= */

void ensureWiFi() {

  static unsigned long lastAttempt = 0;
  static unsigned long wifiDownSince = 0;

  // Si WiFi OK → rien à faire
  if (WiFi.status() == WL_CONNECTED) {
    wifiDownSince = 0;
    return;
  }

  // Si WiFi perdu → mémorise moment de perte
  if (wifiDownSince == 0) wifiDownSince = millis();

  // Limite tentative reconnexion à toutes les 10 sec
  if (millis() - lastAttempt < 10000) return;

  lastAttempt = millis();

  // LED jaune pendant reconnexion
  strip.setPixelColor(LED_WIFI, strip.Color(150,150,0));
  strip.show();

  WiFi.disconnect();
  delay(300);
  WiFi.begin(); // Reconnexion automatique

  // Si WiFi mort > 5 minutes → reboot sécurité
  if (millis() - wifiDownSince > 300000) {
    ESP.restart();
  }
}


/* =======================================================================
   =============================== SETUP ================================
   ======================================================================= */

void setup() {

  Serial.begin(115200);

  // Initialisation LED
  strip.begin();
  strip.setBrightness(40);
  strip.clear();
  strip.show();

  // -------- WIFI --------
  WiFi.mode(WIFI_STA);

  WiFiManager wm;

  // Si WiFi inconnu → portail captif NebuleAir-Setup
  bool res = wm.autoConnect("NebuleAir-Setup", "nebuleair123");

  if (!res) {
    ESP.restart();
  }

  wifiOkAnimation();

  // -------- CAPTEURS --------
  bme.begin(BME_I2C_ADDRESS);

  serialNPM.begin(115200, SERIAL_8E1, PM_SERIAL_RX, PM_SERIAL_TX);
  serialNPM.setTimeout(3000);

  delay(15000); // Stabilisation NextPM

  // -------- INFLUXDB --------
  timeSync(TZ_INFO, "pool.ntp.org", "time.nis.gov");

  sensor.addTag("device", "NebuleAir");
  sensor.addTag("location", "exterieur");
}


/* =======================================================================
   ================================ LOOP =================================
   ======================================================================= */

void loop() {

  ensureWiFi();

  unsigned long currentMillis = millis();

  // Lecture PM périodique
  if (currentMillis - nextpm_previousMillis >= nextpm_interval) {
    nextpm_previousMillis = currentMillis;
    read_concentration();
  }

  // Envoi données périodique
  if (currentMillis - previousMillis >= interval) {

    previousMillis = currentMillis;

    updateSensorLed(sensorOK);

    sensor.clearFields();

    // Ajout mesures BME
    sensor.addField("temperature", bme.readTemperature());
    sensor.addField("pression",    bme.readPressure() / 100.0F);
    sensor.addField("humidite",    bme.readHumidity());

    // Ajout mesures PM
    sensor.addField("pm1",  pm1_ugm3);
    sensor.addField("pm25", pm25_ugm3);
    sensor.addField("pm10", pm10_ugm3);

    // Envoi Cloud
    influx.writePoint(sensor);
  }
}
