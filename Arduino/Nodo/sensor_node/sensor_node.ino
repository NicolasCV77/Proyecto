/**
 * ============================================================
 *  NODO SENSOR — ESP8266 + RA-02 SX1278 LoRa  v1.4
 *
 *  Sensores:
 *    DHT11   → temperatura + humedad del aire
 *    A0      → nivel de agua (analógico, 0–100 %)
 *    GPIO3   → humedad del suelo (digital, húmedo/seco)
 *
 *  Modo: Loop (sin deep sleep)
 * ============================================================
 */

#include "config.h"
#include <SPI.h>
#include <LoRa.h>
#include <DHT.h>
#include <ArduinoJson.h>

DHT dht(PIN_DHT11, DHT11);

// ── Helpers de log ───────────────────────────────────────────
void printStep(int step, int total, const char* desc) {
  Serial.printf("\n[%d/%d] %s", step, total, desc);
}

// ── Prototipos ───────────────────────────────────────────────
String buildJson(float temp, float hum, int water, bool soilWet);
bool   sendLoRa(const String& payload);

// ── Lectura DHT11 robusta ─────────────────────────────────────
// Devuelve true si la lectura es válida; llena temp y hum.
bool readDHT(float &temp, float &hum) {
  temp = dht.readTemperature();
  hum  = dht.readHumidity();
  if (!isnan(temp) && !isnan(hum)) return true;

  // Primer intento fallido → esperar 2 s y reintentar con force=true
  delay(2000);
  temp = dht.readTemperature(false, true);   // Celsius, force new read
  hum  = dht.readHumidity(true);
  return !isnan(temp) && !isnan(hum);
}

// =============================================================
//  SETUP
// =============================================================
void setup() {
  Serial.begin(115200);
  delay(200);

  Serial.println();
  Serial.println("╔═══════════════════════════════════════╗");
  Serial.printf ("║  ParamoSense NODO  %-18s║\n", "v1.4");
  Serial.printf ("║  ID   : %-29s║\n", NODE_ID);
  Serial.printf ("║  Modo : %-29s║\n", "Loop mode (no deep sleep)");
  Serial.println("╚═══════════════════════════════════════╝");

  const int TOTAL = 3;

  // ── Paso 1: Pines ────────────────────────────────────────
  printStep(1, TOTAL, "Configurando pines...");
  pinMode(PIN_SOIL, INPUT_PULLUP);   // suelo → GPIO3, digital
  Serial.printf("\r[1/%d] Configurando pines...        ✓ OK\n", TOTAL);
  Serial.println("       DHT11  → GPIO " + String(PIN_DHT11));
  Serial.println("       Agua   → A0 (analógico 0–100%)");
  Serial.println("       Suelo  → GPIO " + String(PIN_SOIL) + " (digital, INPUT_PULLUP)");

  // ── Paso 2: DHT11 ────────────────────────────────────────
  printStep(2, TOTAL, "Iniciando DHT11...");
  dht.begin();
  Serial.printf("\r[2/%d] Iniciando DHT11...           Calentando", TOTAL);
  Serial.flush();
  for (int i = 0; i < 4; i++) { delay(500); Serial.print("."); }
  // Lectura de calentamiento (se descarta el resultado)
  dht.read(true);
  Serial.printf("\r[2/%d] Iniciando DHT11...           ✓ Listo      \n", TOTAL);

  // ── Paso 3: LoRa — con reintentos ────────────────────────
  printStep(3, TOTAL, "Iniciando LoRa RA-02...");
  LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);

  const int LORA_INIT_RETRIES = 3;
  bool loraOk = false;
  for (int attempt = 1; attempt <= LORA_INIT_RETRIES && !loraOk; attempt++) {
    Serial.printf("\r[3/%d] Iniciando LoRa RA-02...    Intento %d/%d...",
                  TOTAL, attempt, LORA_INIT_RETRIES);
    Serial.flush();
    if (LoRa.begin(LORA_FREQUENCY)) {
      loraOk = true;
    } else {
      if (attempt < LORA_INIT_RETRIES) {
        Serial.println(" sin respuesta — reintentando...");
        delay(1500);
      }
    }
  }

  if (!loraOk) {
    Serial.printf("\r[3/%d] Iniciando LoRa RA-02...    ✗ FALLO (%d intentos)\n",
                  TOTAL, LORA_INIT_RETRIES);
    Serial.println("       NSS=" + String(LORA_NSS) + " RST=" + String(LORA_RST) +
                   " DIO0=" + String(LORA_DIO0));
    Serial.println("[ERROR] LoRa no disponible. Detenido.");
    while (true) { delay(1000); }
  }

  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW);
  LoRa.setCodingRate4(LORA_CR);
  LoRa.setTxPower(LORA_TX_POWER);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.setPreambleLength(LORA_PREAMBLE);
  LoRa.disableCrc();

  Serial.printf("\r[3/%d] Iniciando LoRa RA-02...    ✓ OK          \n", TOTAL);
  Serial.printf("       Frecuencia : %.0f MHz  SF=%d  BW=125kHz  CR=4/%d\n",
                (float)LORA_FREQUENCY / 1e6, LORA_SF, LORA_CR);
  Serial.printf("       SyncWord: 0x%02X  Potencia: %d dBm\n", LORA_SYNC_WORD, LORA_TX_POWER);

  Serial.println();
  Serial.printf("[INFO] Intervalo de envío: %d ms\n", SEND_INTERVAL_MS);
  Serial.println("[INFO] Entrando en loop de envío continuo...");
}

// =============================================================
//  LOOP
// =============================================================
void loop() {
  const int TOTAL = 2;

  // ── Paso 1: Lectura de sensores ───────────────────────────
  printStep(1, TOTAL, "Leyendo sensores...");

  // DHT11 — temperatura y humedad del aire
  float temp, hum;
  bool dhtOk = readDHT(temp, hum);

  // Nivel de agua — analógico en A0 (0–100 %)
  int  waterRaw = analogRead(PIN_WATER_LVL);
  int  water    = constrain(map(waterRaw, WATER_DRY, WATER_WET, 0, 100), 0, 100);

  // Humedad del suelo — digital en GPIO3 (LOW = húmedo)
  bool soilWet = (digitalRead(PIN_SOIL) == LOW);

  Serial.printf("\r[1/%d] Leyendo sensores...          %s      \n",
                TOTAL, dhtOk ? "✓ OK" : "⚠ DHT11 sin dato");

  Serial.println("       ┌────────────────────────────────────┐");
  if (dhtOk) {
    Serial.printf( "       │ Temperatura   : %6.1f °C          │\n", temp);
    Serial.printf( "       │ Humedad aire  : %6.1f %%          │\n", hum);
  } else {
    Serial.println("       │ Temperatura   : --- sin dato       │");
    Serial.println("       │ Humedad aire  : --- sin dato       │");
    Serial.println("       │ ⚠ Revisa cable DHT11 y pullup      │");
  }
  Serial.printf(  "       │ Nivel agua    : %3d %%  (ADC=%4d) │\n", water, waterRaw);
  Serial.printf(  "       │ Humedad suelo : %-6s              │\n", soilWet ? "Húmedo" : "Seco");
  Serial.println("       └────────────────────────────────────┘");

  if (water > 30) Serial.println("       ⚠ ALERTA: Nivel de agua elevado");
  if (soilWet)    Serial.println("       INFO : Suelo húmedo detectado");
  if (!dhtOk)     Serial.println("       ⚠ DHT11 : sin datos válidos");

  // ── Paso 2: Transmisión LoRa ──────────────────────────────
  printStep(2, TOTAL, "Transmitiendo por LoRa...");

  String payload = buildJson(dhtOk ? temp : NAN, dhtOk ? hum : NAN, water, soilWet);

  Serial.printf("\r[2/%d] Transmitiendo...              Enviando...\n", TOTAL);
  Serial.println("       JSON → " + payload);
  Serial.printf ("       Destino: 0x%02X  Origen: 0x%02X\n", RELAY_ADDR, NODE_ADDR);

  bool ok = sendLoRa(payload);
  Serial.printf("\r[2/%d] Transmitiendo...              %s          \n",
                TOTAL, ok ? "✓ ENVIADO" : "✗ FALLO TX");

  // ── Resumen ───────────────────────────────────────────────
  Serial.println();
  Serial.println("══════════════════ RESUMEN ══════════════════");
  if (dhtOk) Serial.printf("  Temp : %.1f°C   Hum: %.1f%%\n", temp, hum);
  else        Serial.println("  Temp : ---   Hum: ---  (DHT sin dato)");
  Serial.printf("  Agua : %d%%   Suelo: %s\n", water, soilWet ? "Húmedo" : "Seco");
  Serial.printf("  LoRa TX : %s\n", ok ? "OK" : "FALLO");
  Serial.printf("  Próximo envío en %d ms\n", SEND_INTERVAL_MS);
  Serial.println("═════════════════════════════════════════════");

  delay(SEND_INTERVAL_MS);
}

// =============================================================
//  JSON
//  Campos enviados:
//    id    → NODE_ID
//    t     → temperatura °C  (omitido si NAN)
//    h     → humedad aire %  (omitido si NAN)
//    water → nivel agua 0–100 (siempre presente)
//    soil  → 1 si húmedo, 0 si seco
// =============================================================
String buildJson(float temp, float hum, int water, bool soilWet) {
  StaticJsonDocument<160> doc;
  doc["id"]    = NODE_ID;
  if (!isnan(temp)) doc["t"] = roundf(temp * 10.0f) / 10.0f;
  if (!isnan(hum))  doc["h"] = roundf(hum  * 10.0f) / 10.0f;
  doc["water"] = water;               // 0–100
  doc["soil"]  = soilWet ? 100 : 0;  // 100=húmedo, 0=seco
  String out;
  serializeJson(doc, out);
  return out;
}

// =============================================================
//  ENVÍO LoRa  [ DEST | SRC | JSON ]
// =============================================================
bool sendLoRa(const String& payload) {
  LoRa.beginPacket();
  LoRa.write(RELAY_ADDR);
  LoRa.write(NODE_ADDR);
  LoRa.print(payload);
  return (LoRa.endPacket() == 1);
}
