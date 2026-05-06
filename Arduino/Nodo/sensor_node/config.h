/**
 * config.h — Nodo sensor ESP8266  v1.4
 * Sensores : DHT11 + Nivel de agua (analógico) + Humedad del suelo (digital)
 * LoRa     : RA-02 SX1278 SPI
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  MAPA DE PINES                                                   │
 * │                                                                  │
 * │  D1 (GPIO 5)  → DHT11 DATA                                      │
 * │  A0           → Sensor nivel de agua AO (analógico 0–100 %)     │
 * │  D3 (GPIO 0)  → Sensor humedad suelo DO (digital, wet=LOW)      │
 * │                                                                  │
 * │  D5 (GPIO 14) → LoRa SCK                                        │
 * │  D6 (GPIO 12) → LoRa MISO                                       │
 * │  D7 (GPIO 13) → LoRa MOSI                                       │
 * │  D8 (GPIO 15) → LoRa NSS                                        │
 * │  D4 (GPIO 2)  → LoRa RST                                        │
 * │  D2 (GPIO 4)  → LoRa DIO0                                       │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * CAMBIO RESPECTO A v1.3:
 *   Agua  : se conecta el pin AO del sensor de agua a A0 (antes DO→GPIO3).
 *           Esto permite leer 0–100 % de nivel en lugar de solo 0/1.
 *   Suelo : se conecta el pin DO del sensor de suelo a GPIO3 (antes AO→A0).
 *           La lectura es ahora digital (húmedo / seco).
 *
 * NOTA GPIO3 (RX): mismo que antes — solo TX activo en este sketch.
 */

#pragma once

// ══════════════════════════════════════════════════════════════════
//  INTERVALO DE ENVÍO
//  Cambiar a 900000 para producción (15 min)
// ══════════════════════════════════════════════════════════════════
#define SEND_INTERVAL_MS  3000

// ══════════════════════════════════════════════════════════════════
//  IDENTIFICACIÓN DEL NODO
// ══════════════════════════════════════════════════════════════════
#define NODE_ID  "NODO_01"

// ══════════════════════════════════════════════════════════════════
//  PINES — Sensores
// ══════════════════════════════════════════════════════════════════

// DHT11 DATA → D1 (GPIO 5)
#define PIN_DHT11      5

// Sensor nivel de agua → A0 (analógico)
// Conectar pin AO del sensor a A0 del NodeMCU
#define PIN_WATER_LVL  A0

// Sensor humedad del suelo → D3 (GPIO0)
// Conectar pin DO del sensor a D3 del NodeMCU
// INPUT_PULLUP: seco = HIGH, húmedo = LOW
// NOTA: GPIO3 (RX) NO usar — lo mantiene HIGH el hardware UART (Serial.begin)
#define PIN_SOIL       0

// ══════════════════════════════════════════════════════════════════
//  CALIBRACIÓN SENSOR DE AGUA (analógico en A0)
//  Medir en aire seco y sumergido; ajustar según tu sensor.
//  Sensores resistivos baratos típicos en NodeMCU (0–3.3 V → 0–1023):
// ══════════════════════════════════════════════════════════════════
#define WATER_DRY   50    // lectura en aire seco  (ajustar)
#define WATER_WET  750    // lectura sumergido      (ajustar)

// ══════════════════════════════════════════════════════════════════
//  PINES — LoRa RA-02
// ══════════════════════════════════════════════════════════════════
#define LORA_NSS   15   // D8
#define LORA_RST    2   // D4
#define LORA_DIO0   4   // D2

// ══════════════════════════════════════════════════════════════════
//  PARÁMETROS LoRa — deben coincidir con relay_central
// ══════════════════════════════════════════════════════════════════
#define LORA_FREQUENCY   433E6
#define LORA_SF          9
#define LORA_BW          125E3
#define LORA_CR          5
#define LORA_TX_POWER    17
#define LORA_SYNC_WORD   0x12
#define LORA_PREAMBLE    8

// ══════════════════════════════════════════════════════════════════
//  DIRECCIONES DE RED
// ══════════════════════════════════════════════════════════════════
#define NODE_ADDR   0x02
#define RELAY_ADDR  0x01
