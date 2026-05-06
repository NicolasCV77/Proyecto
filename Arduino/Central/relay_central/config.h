/**
 * config.h — Gateway Central ESP32
 * Comunicación: LoRa RX (desde nodos) → WiFi → MQTT (hacia backend)
 *
 * ┌──────────────────────────────────────────────────────┐
 * │  PINES ESP32 — RA-02 SX1278                          │
 * │  SCK   → GPIO 25   MISO  → GPIO 34                  │
 * │  MOSI  → GPIO 27   NSS   → GPIO 32                  │
 * │  RST   → GPIO 4    DIO0  → GPIO 23                  │
 * └──────────────────────────────────────────────────────┘
 *
 * Librerías requeridas (Library Manager):
 *   - LoRa          (Sandeep Mistry)
 *   - ArduinoJson
 *   - PubSubClient  (Nick O'Leary)
 *   - WiFi          (incluida en ESP32 Arduino core)
 */

#pragma once

// ══════════════════════════════════════════════════════════
//  WiFi — cambiar por tus credenciales reales
// ══════════════════════════════════════════════════════════
#define WIFI_SSID        "AQUI_CON_YO"
#define WIFI_PASSWORD    "52692goo"
#define WIFI_TIMEOUT_MS  15000

// ══════════════════════════════════════════════════════════
//  MQTT — broker público HiveMQ (sin autenticación)
//  Para producción usa un broker privado con TLS.
// ══════════════════════════════════════════════════════════
#define MQTT_BROKER     "broker.hivemq.com"
#define MQTT_PORT       1883
#define MQTT_CLIENT_ID  "paramosense-central-01"   // único por gateway
#define MQTT_TOPIC      "paramosense/data"
#define MQTT_KEEPALIVE  60

// ══════════════════════════════════════════════════════════
//  Pines RA-02 (SPI hardware ESP32)
// ══════════════════════════════════════════════════════════
#define LORA_SCK    25
#define LORA_MISO   34
#define LORA_MOSI   27
#define LORA_NSS    32
#define LORA_RST    4
#define LORA_DIO0   23

// ══════════════════════════════════════════════════════════
//  Parámetros radio — deben coincidir con los nodos
// ══════════════════════════════════════════════════════════
#define LORA_FREQUENCY   433E6
#define LORA_SF          9
#define LORA_BW          125E3
#define LORA_CR          5
#define LORA_TX_POWER    17
#define LORA_SYNC_WORD   0x12
#define LORA_PREAMBLE    8

// ══════════════════════════════════════════════════════════
//  Dirección de red
// ══════════════════════════════════════════════════════════
#define RELAY_ADDR  0x01   // debe coincidir con RELAY_ADDR de los nodos
