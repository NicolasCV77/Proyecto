/**
 * ============================================================
 *  GATEWAY CENTRAL — ESP32 + RA-02 SX1278 + WiFi + MQTT  v1.1
 *
 *  Flujo: Nodo sensor → (LoRa 433 MHz) → Este ESP32
 *         → (WiFi + MQTT) → broker.hivemq.com → Backend
 *
 *  Librerías (Library Manager):
 *    - LoRa         (Sandeep Mistry)
 *    - ArduinoJson
 *    - PubSubClient (Nick O'Leary)
 *    - WiFi         (incluida en ESP32 core)
 *
 *  Board: "ESP32 Dev Module"
 * ============================================================
 */

#include "config.h"
#include <SPI.h>
#include <LoRa.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <PubSubClient.h>

WiFiClient   wifiClient;
PubSubClient mqttClient(wifiClient);

uint32_t packetsReceived = 0;
uint32_t packetsForwarded = 0;
uint32_t packetsDropped = 0;

// ==========================================================
//  HELPERS DE LOG
// ==========================================================
void logSep() {
  Serial.println("──────────────────────────────────────────");
}

void logDoubleSep() {
  Serial.println("==========================================");
}

// ==========================================================
//  WiFi
// ==========================================================
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.println();
  logSep();
  Serial.printf("[WiFi] Conectando a SSID: '%s'\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  int dots = 0;
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > WIFI_TIMEOUT_MS) {
      Serial.println("\n[WiFi] ✗ Tiempo de conexión agotado.");
      Serial.println("[WiFi] Verifica SSID y contraseña en config.h");
      return;
    }
    delay(500);
    Serial.print(".");
    if (++dots % 20 == 0) Serial.println();
  }

  Serial.println();
  Serial.println("[WiFi] ✓ Conectado!");
  Serial.printf ("[WiFi]   IP       : %s\n", WiFi.localIP().toString().c_str());
  Serial.printf ("[WiFi]   Gateway  : %s\n", WiFi.gatewayIP().toString().c_str());
  Serial.printf ("[WiFi]   RSSI WiFi: %d dBm\n", WiFi.RSSI());
  logSep();
}

// ==========================================================
//  MQTT
// ==========================================================
void connectMQTT() {
  if (mqttClient.connected()) return;

  Serial.printf("[MQTT] Conectando a %s:%d\n", MQTT_BROKER, MQTT_PORT);
  Serial.printf("[MQTT] Client ID: %s\n", MQTT_CLIENT_ID);

  int attempt = 0;
  while (!mqttClient.connected()) {
    attempt++;
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[MQTT] Sin WiFi, reconectando primero...");
      connectWiFi();
    }

    Serial.printf("[MQTT] Intento #%d...", attempt);
    if (mqttClient.connect(MQTT_CLIENT_ID)) {
      Serial.println(" ✓ OK");
    } else {
      Serial.printf(" ✗ rc=%d — reintentando en 5 s\n", mqttClient.state());
      // Estado MQTT: -4=timeout -3=broker unavail -2=bad client id
      //              -1=bad creds 1=refused 2=unavail 3=bad user 4=auth fail
      delay(5000);
    }
    if (attempt >= 5) {
      Serial.println("[MQTT] ✗ 5 intentos fallidos. Continuando sin MQTT.");
      return;
    }
  }
}

// ==========================================================
//  Publicar JSON al broker
// ==========================================================
bool publishMQTT(const String& jsonBody) {
  if (!mqttClient.connected()) {
    Serial.println("[MQTT] Sin conexión — intentando reconectar...");
    connectMQTT();
  }

  bool ok = mqttClient.publish(MQTT_TOPIC, jsonBody.c_str(), false);
  if (ok) {
    packetsForwarded++;
    Serial.printf("[MQTT] ✓ Publicado en topic '%s'\n", MQTT_TOPIC);
    Serial.println("[MQTT]   Payload: " + jsonBody);
  } else {
    Serial.println("[MQTT] ✗ Error al publicar — verifca conexión al broker.");
  }
  return ok;
}

// ==========================================================
//  SETUP
// ==========================================================
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  delay(200);

  Serial.println();
  Serial.println("╔══════════════════════════════════════════╗");
  Serial.println("║  ParamoSense — Gateway Central  v1.1     ║");
  Serial.println("║  LoRa 433 MHz → WiFi → MQTT              ║");
  Serial.println("╚══════════════════════════════════════════╝");
  Serial.println();

  const int STEPS = 3;

  // ── Paso 1: WiFi ─────────────────────────────────────────
  Serial.printf("[1/%d] Iniciando WiFi...\n", STEPS);
  connectWiFi();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("      ⚠ Continuando sin WiFi (MQTT no disponible)");
  }

  // ── Paso 2: MQTT ─────────────────────────────────────────
  Serial.printf("[2/%d] Iniciando MQTT...\n", STEPS);
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setKeepAlive(MQTT_KEEPALIVE);
  connectMQTT();
  if (!mqttClient.connected()) {
    Serial.println("      ⚠ Continuando sin MQTT (los paquetes LoRa se recibirán pero no se reenviarán)");
  }

  // ── Paso 3: LoRa ─────────────────────────────────────────
  Serial.printf("[3/%d] Iniciando LoRa RA-02...\n", STEPS);
  Serial.printf("       Pines SPI: SCK=%d MISO=%d MOSI=%d NSS=%d\n",
                LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
  Serial.printf("       RST=%d  DIO0=%d\n", LORA_RST, LORA_DIO0);

  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
  LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQUENCY)) {
    Serial.printf("[3/%d] ✗ LoRa FALLO — revisar módulo RA-02 y conexiones SPI.\n", STEPS);
    Serial.println("       → El gateway no puede funcionar sin LoRa.");
    while (true) { delay(1000); }
  }

  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW);
  LoRa.setCodingRate4(LORA_CR);
  LoRa.setTxPower(LORA_TX_POWER);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.setPreambleLength(LORA_PREAMBLE);
  LoRa.disableCrc();

  Serial.printf("[3/%d] ✓ LoRa listo\n", STEPS);
  Serial.printf("       Frecuencia  : %.0f MHz\n", (float)LORA_FREQUENCY / 1e6);
  Serial.printf("       SF=%-2d  BW=125 kHz  CR=4/%d  Pwr=%d dBm\n",
                LORA_SF, LORA_CR, LORA_TX_POWER);
  Serial.printf("       SyncWord    : 0x%02X\n", LORA_SYNC_WORD);
  Serial.printf("       Mi dirección: 0x%02X\n", RELAY_ADDR);

  Serial.println();
  logDoubleSep();
  Serial.println("  Gateway listo — escuchando paquetes LoRa...");
  logDoubleSep();
  Serial.println();
}

// ==========================================================
//  LOOP
// ==========================================================
void loop() {
  // Mantener conexiones ─────────────────────────────────────
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Conexión perdida. Reconectando...");
    connectWiFi();
  }
  if (!mqttClient.connected()) {
    Serial.println("[MQTT] Desconectado. Reconectando...");
    connectMQTT();
  }
  mqttClient.loop();

  // Escuchar LoRa ───────────────────────────────────────────
  int packetSize = LoRa.parsePacket();
  if (packetSize == 0) return;

  packetsReceived++;

  Serial.println();
  logDoubleSep();
  Serial.printf("  PAQUETE #%u  |  Tamaño: %d bytes\n", packetsReceived, packetSize);
  logDoubleSep();

  if (packetSize < 3) {
    packetsDropped++;
    Serial.println("  ⚠ Paquete demasiado corto — descartado.");
    while (LoRa.available()) LoRa.read();
    return;
  }

  // Cabecera de dirección ───────────────────────────────────
  uint8_t dest = LoRa.read();
  uint8_t src  = LoRa.read();

  Serial.printf("  Destino : 0x%02X  (yo soy 0x%02X)\n", dest, RELAY_ADDR);
  Serial.printf("  Origen  : 0x%02X\n", src);

  if (dest != RELAY_ADDR) {
    packetsDropped++;
    Serial.printf("  SKIP — paquete para 0x%02X, no para mí.\n", dest);
    while (LoRa.available()) LoRa.read();
    return;
  }

  // Leer payload ────────────────────────────────────────────
  String payload = "";
  while (LoRa.available()) payload += (char)LoRa.read();

  int   rssi = LoRa.packetRssi();
  float snr  = LoRa.packetSnr();

  Serial.printf("  RSSI    : %d dBm  (ideal > -100)\n", rssi);
  Serial.printf("  SNR     : %.1f dB  (ideal > 0)\n", snr);
  Serial.println("  JSON RX : " + payload);

  // Deserializar ────────────────────────────────────────────
  StaticJsonDocument<192> rxDoc;
  DeserializationError err = deserializeJson(rxDoc, payload);

  if (err) {
    packetsDropped++;
    Serial.println("  ✗ JSON inválido: " + String(err.c_str()));
    logDoubleSep();
    return;
  }

  // Mostrar datos del nodo ──────────────────────────────────
  const char* nodeId     = rxDoc["id"] | "desconocido";
  float       temp       = rxDoc["t"]  | -999.0f;
  float       hum        = rxDoc["h"]  | -999.0f;
  int         waterLevel = rxDoc["water"] | 0;   // 0–100 %
  int         soil       = rxDoc["soil"]  | -1;

  bool waterAlert = waterLevel > 30;

  Serial.println();
  Serial.println("  ┌─ DATOS DEL NODO ───────────────────┐");
  Serial.printf ("  │ Nodo ID     : %-20s│\n", nodeId);
  if (temp > -900)
    Serial.printf("  │ Temperatura : %-17.1f °C│\n", temp);
  else
    Serial.println("  │ Temperatura : --- (sin dato)       │");
  if (hum > -900)
    Serial.printf("  │ Humedad aire: %-18.1f %%│\n", hum);
  else
    Serial.println("  │ Humedad aire: --- (sin dato)       │");
  Serial.printf ("  │ Nivel agua  : %-3d %%               │\n", waterLevel);
  if (soil >= 0)
    Serial.printf("  │ Humedad suelo: %-18d%%│\n", soil);
  else
    Serial.println("  │ Humedad suelo: --- (sin dato)      │");
  Serial.println("  └────────────────────────────────────┘");

  if (waterAlert) {
    Serial.printf("  ⚠ ALERTA: Nivel de agua elevado (%d%%)\n", waterLevel);
  }

  // Construir JSON para backend (nombres largos) ────────────
  StaticJsonDocument<192> txDoc;
  txDoc["nodeId"] = nodeId;
  if (temp > -900) txDoc["temperature"] = roundf(temp * 10.0f) / 10.0f;
  if (hum  > -900) txDoc["humidity"]    = roundf(hum  * 10.0f) / 10.0f;
  txDoc["water"] = waterLevel;   // 0–100
  if (soil >= 0)   txDoc["soil"] = soil;

  String txBody;
  serializeJson(txDoc, txBody);

  // Publicar vía MQTT ───────────────────────────────────────
  Serial.println();
  Serial.println("  → Reenviando al broker MQTT...");
  bool ok = publishMQTT(txBody);

  Serial.println();
  Serial.println("  ┌─ ESTADÍSTICAS ─────────────────────┐");
  Serial.printf ("  │ Recibidos  : %-21u│\n", packetsReceived);
  Serial.printf ("  │ Reenviados : %-21u│\n", packetsForwarded);
  Serial.printf ("  │ Descartados: %-21u│\n", packetsDropped);
  Serial.println("  └────────────────────────────────────┘");
  logDoubleSep();
  Serial.println();
}
