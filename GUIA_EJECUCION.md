# Guía de Ejecución — ParamoSense

---

## Tecnologías utilizadas

| Capa | Tecnología | Versión | Rol |
|---|---|---|---|
| **Firmware nodo** | Arduino (C++) + ESP8266 (NodeMCU) | — | Lee sensores, transmite por LoRa |
| **Firmware gateway** | Arduino (C++) + ESP32 | — | Recibe LoRa, reenvía por MQTT |
| **Radio** | LoRa 433 MHz (módulo RA-02 SX1278) | SF9, BW125, CR4/5 | Enlace inalámbrico nodo → gateway |
| **Broker MQTT** | HiveMQ (público) | broker.hivemq.com:1883 | Transporte de mensajes IoT |
| **Backend** | Node.js + Express | 18+ | API REST + consumidor MQTT |
| **Base de datos** | MongoDB + Mongoose | 6+ | Almacenamiento de lecturas y dashboards |
| **Seguridad** | bcryptjs | — | Hash de contraseñas de usuario |
| **Frontend** | Angular 21 (Standalone Components) | 21.2 | Panel de monitoreo web |
| **Mapas** | Leaflet | — | Mapa interactivo de sensores |
| **Exportación** | jsPDF + xlsx | — | Reportes PDF / Excel |
| **Librería LoRa** | Sandeep Mistry LoRa | — | Comunicación SX1278 desde Arduino |
| **Librería DHT** | Adafruit DHT sensor | — | Lectura temperatura y humedad |
| **JSON** | ArduinoJson | — | Serialización/deserialización en firmware |
| **MQTT cliente (fw)** | PubSubClient (Nick O'Leary) | — | Cliente MQTT en ESP32 |
| **MQTT cliente (backend)** | mqtt (npm) | — | Suscripción al broker desde Node.js |

---

## Flujo completo del sistema

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        NODO SENSOR (ESP8266)                           │
│                                                                         │
│  DHT11 (GPIO5/D1)  →  temperatura + humedad del aire                   │
│  Sensor agua (A0)  →  nivel 0-100 % (ADC 0–1023 mapeado)              │
│  Sensor suelo (GPIO0/D3, INPUT_PULLUP) → húmedo(LOW) / seco(HIGH)     │
│                                                                         │
│  Cada SEND_INTERVAL_MS (dev: 3 s / prod: 900 s):                       │
│    1. Lee sensores                                                      │
│    2. Serializa JSON: {"id":"NODO_01","t":14.5,"h":82.0,               │
│                        "water":45,"soil":100}                           │
│    3. Envía paquete LoRa: [RELAY_ADDR=0x01][NODE_ADDR=0x02][JSON]      │
└──────────────────┬──────────────────────────────────────────────────────┘
                   │  LoRa 433 MHz (SF9, BW125kHz, CR4/5, SyncWord=0x12)
                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      GATEWAY CENTRAL (ESP32)                            │
│                                                                         │
│  1. Recibe paquete LoRa, valida destino (RELAY_ADDR=0x01)              │
│  2. Deserializa JSON del nodo                                           │
│  3. Renombra campos cortos → largos:                                    │
│       id → nodeId,  t → temperature,  h → humidity                     │
│  4. Publica en MQTT topic "paramosense/data":                           │
│       {"nodeId":"NODO_01","temperature":14.5,"humidity":82.0,          │
│        "water":45,"soil":100}                                           │
└──────────────────┬──────────────────────────────────────────────────────┘
                   │  WiFi → MQTT broker.hivemq.com:1883
                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       BACKEND (Node.js / Express)                       │
│                                                                         │
│  mqttClient.on('message') → procesa payload:                           │
│    - Normaliza water: boolean→0/100 (legacy) o Number→0–100           │
│    - Valida DHT11: descarta temperatura/humedad si valor < -900        │
│    - Crea SensorReading en MongoDB (colección raw)                     │
│    - Actualiza todos los documentos Dashboard con:                      │
│        readings[], waterHistory[], chartData[] (máx 200 puntos)        │
│                                                                         │
│  GET /api/dashboard/:email → calcula en tiempo real:                   │
│    - Últimas 100 lecturas raw de SensorReading                         │
│    - Construye globalReadings por tipo (Temperatura/Humedad/           │
│      Nivel de agua/Humedad suelo)                                       │
│    - Devuelve JSON con readings, chartData, environmentalSummary       │
└──────────────────┬──────────────────────────────────────────────────────┘
                   │  HTTP REST (polling cada 30 s)
                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      FRONTEND (Angular 21)                              │
│                                                                         │
│  DashboardComponent:                                                    │
│    - Tarjetas KPI: Sensores activos, Estado del agua, Alertas, Clima   │
│    - Mini gráficas SVG: Nivel de agua / Temperatura / Humedad / Suelo │
│    - Tabla de lecturas recientes (últimas 80)                          │
│    - Modal gráfica ampliada con filtro por rango de tiempo             │
│                                                                         │
│  MapComponent (Leaflet):                                                │
│    - Marcadores por sensor con estado (Normal/Advertencia/Crítico)     │
│                                                                         │
│  AdminComponent (oculto — 5 clicks en logo):                           │
│    - Editar coordenadas y tipo de sensores en MongoDB                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Colecciones MongoDB

| Colección | Contenido |
|---|---|
| `users` | Cuentas de usuario (nombre, email, password hash, área, municipio) |
| `sensorreadings` | Lecturas raw: nodeId, temperature, humidity, water, soil, receivedAt |
| `dashboards` | Datos procesados por usuario: readings[], chartData[], environmentalSummary |
| `locations` | Zonas geográficas con coordenadas y lista de sensores (mapa) |

---

## Requisitos previos

| Herramienta | Versión mínima | Descarga |
|---|---|---|
| Node.js | 18+ | nodejs.org |
| MongoDB Community | 6+ | mongodb.com/try/download/community |
| Arduino IDE | 2.x | arduino.cc/en/software |
| npm | 9+ | incluido con Node.js |

---

## Estructura de carpetas

```
Proyecto/
├── GUIA_EJECUCION.md              ← este archivo
├── Arduino/
│   ├── Central/relay_central/     ← Gateway ESP32 (LoRa → MQTT)
│   │   ├── relay_central.ino
│   │   └── config.h               ← WiFi, MQTT, pines LoRa ESP32
│   └── Nodo/sensor_node/          ← Nodo sensor ESP8266
│       ├── sensor_node.ino
│       └── config.h               ← pines sensores, calibración, LoRa
├── Backend/backend-paramosense/
│   ├── server.js
│   └── package.json
└── Frontend/paramosense-frontend/
    └── src/
```

---

## PASO 1 — Instalar dependencias

### Backend
```powershell
cd "Proyecto\Backend\backend-paramosense"
npm install
```

### Frontend
```powershell
cd "Proyecto\Frontend\paramosense-frontend"
npm install
```

---

## PASO 2 — Iniciar MongoDB

Abre una terminal y ejecuta:
```powershell
mongod
```
MongoDB escucha en `mongodb://127.0.0.1:27017`. No se requiere configuración adicional.
Las colecciones se crean automáticamente al primer inicio del backend.

---

## PASO 3 — Iniciar el Backend

```powershell
cd "Proyecto\Backend\backend-paramosense"
npm start
```

**Salida esperada:**
```
[MongoDB] Conectado
[Seed] Ubicaciones iniciales cargadas en MongoDB   ← solo la primera vez
[MQTT] Conectado a broker.hivemq.com
[MQTT] Suscrito a paramosense/data
[Backend] Servidor en http://localhost:3000
```

---

## PASO 4 — Iniciar el Frontend

Abre una **segunda terminal**:
```powershell
cd "Proyecto\Frontend\paramosense-frontend"
npm start
```

Accede a: **http://localhost:4200**

---

## PASO 5 — Configurar y cargar el Arduino

### 5a. Nodo sensor (ESP8266)

Carpeta: `Arduino/Nodo/sensor_node/`

1. Abre `sensor_node.ino` en Arduino IDE.
2. Selecciona board: **NodeMCU 1.0 (ESP-12E)** o **LOLIN D1 mini**.
3. Instala librerías desde Library Manager:
   - `LoRa` (Sandeep Mistry)
   - `DHT sensor library` (Adafruit)
   - `Adafruit Unified Sensor` (Adafruit)
   - `ArduinoJson`
4. Edita `config.h` y ajusta `NODE_ID` (único por nodo) y los valores de calibración del sensor de agua (ver sección de sensores más abajo).
5. Sube el sketch al ESP8266.

### 5b. Gateway Central (ESP32)

Carpeta: `Arduino/Central/relay_central/`

1. Abre `relay_central.ino` en Arduino IDE.
2. Selecciona board: **ESP32 Dev Module**.
3. Instala librerías desde Library Manager:
   - `LoRa` (Sandeep Mistry)
   - `ArduinoJson`
   - `PubSubClient` (Nick O'Leary)
4. Edita `Arduino/Central/relay_central/config.h` y cambia las credenciales WiFi:
   ```c
   #define WIFI_SSID     "TU_SSID_WIFI"
   #define WIFI_PASSWORD "TU_CONTRASENA_WIFI"
   ```
5. Sube el sketch al ESP32.

---

## Configuración de sensores

### DHT11 — Temperatura y Humedad del aire

- **Pin:** D1 (GPIO5) del NodeMCU
- **Librería:** Adafruit DHT
- **Tipo:** `DHT11`
- **Requisito hardware:** Resistencia pull-up de 4.7 kΩ – 10 kΩ entre el pin DATA y 3.3 V (el NodeMCU ya la incluye internamente en D1)
- **Valores enviados:** temperatura (°C) y humedad (%), omitidos si el sensor falla
- **Diagnóstico:** Si el Serial Monitor muestra `DHT11 sin dato`, revisar el cableado y el pull-up

### Sensor de nivel de agua (analógico)

- **Pin:** A0 del NodeMCU (pin `AO` del módulo sensor)
- **Lectura:** ADC 0–1023 → mapeado a 0–100 %
- **Calibración** (en `Arduino/Nodo/sensor_node/config.h`):

```c
#define WATER_DRY   50    // ADC en aire seco — AJUSTAR según tu sensor
#define WATER_WET  750    // ADC completamente sumergido — AJUSTAR
```

Para calibrar:
1. Con el sensor en el aire, leer el ADC en el Serial Monitor (`ADC=???`)
2. Anotar ese valor → asignarlo a `WATER_DRY`
3. Sumergir el sensor completamente, leer el ADC
4. Anotar ese valor → asignarlo a `WATER_WET`

Si el sensor siempre reporta 0 % es porque el ADC está por debajo de `WATER_DRY`. Reducir `WATER_DRY` a 0 o al valor leído en aire.

### Sensor de humedad del suelo (digital)

- **Pin:** D3 (GPIO0) del NodeMCU (pin `DO` del módulo sensor)
- **Modo:** `INPUT_PULLUP` — seco = HIGH, húmedo = LOW
- **Valores enviados:** 100 % (húmedo) o 0 % (seco)
- **Advertencia sobre GPIO0:** GPIO0 es un strapping pin del ESP8266. Si el suelo está muy húmedo al encender el nodo y el sensor arrastra el pin a LOW, el ESP8266 puede entrar en modo de programación en lugar de arrancar normalmente. Para evitarlo, encender el nodo antes de conectar el sensor, o agregar una resistencia pull-up adicional de 4.7 kΩ entre D3 y 3.3 V.

---

## Panel de Administrador (oculto)

Para editar coordenadas y estado de los sensores en el mapa:

1. Inicia sesión en la aplicación.
2. En cualquier pantalla, **haz clic 5 veces seguidas** sobre el logo "PARAMO SENSE" en la barra de navegación (dentro de 3 segundos).
3. Serás redirigido automáticamente a `/admin`.
4. Selecciona la zona, edita los sensores y presiona **Guardar cambios**.

---

## Endpoints del Backend

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/register` | Registro de usuario |
| POST | `/api/login` | Inicio de sesión |
| GET | `/api/dashboard/:email` | Datos del panel por usuario |
| GET | `/api/locations` | Lista de ubicaciones y sensores |
| GET | `/api/nodes/active` | Nodos con lecturas en las últimas 24 h |
| PUT | `/api/admin/locations/:locationId` | Editar sensores de una ubicación |
| POST | `/api/sensordata` | Inserción manual de lectura (fallback HTTP) |
| POST | `/api/admin/locations/:locationId/sensors/test` | Agregar sensores de prueba |
| DELETE | `/api/admin/locations/:locationId/sensors/test` | Eliminar sensores de prueba |

---

## Solución de problemas comunes

| Error | Causa probable | Solución |
|---|---|---|
| `[MongoDB] Error de conexión` | MongoDB no está corriendo | Ejecutar `mongod` primero |
| `[MQTT] rc=-2` | Sin internet | Verificar conexión WiFi del ESP32 |
| `[LoRa] LoRa no inició` | Cableado incorrecto | Revisar pines en `config.h` |
| Frontend no carga datos | Backend no iniciado | Iniciar `npm start` en backend primero |
| `DHT11 sin lectura válida` | Fallo sensor o cableado | Revisar conexión y pull-up en GPIO5 |
| Nivel de agua siempre 0 % | Valor `WATER_DRY` muy alto | Calibrar `WATER_DRY` con el ADC real en aire |
| Nodo no arranca / modo boot | GPIO0 en LOW al inicio | Suelo húmedo al encender; ver advertencia GPIO0 |
| Gráfica de agua sin datos | Documentos antiguos sin campo `water` | Backend v2 ya incluye water=0 por defecto; reiniciar backend |

---

## Notas sobre MQTT

- Broker usado: `broker.hivemq.com` (público, gratuito, sin autenticación).
- Topic de publicación: `paramosense/data`
- Payload del gateway al backend (JSON):
  ```json
  {
    "nodeId": "NODO_01",
    "temperature": 14.5,
    "humidity": 82.0,
    "water": 45,
    "soil": 100
  }
  ```
- El backend procesa cada mensaje MQTT y actualiza todos los dashboards en MongoDB.
- El frontend refresca automáticamente cada 30 segundos.
- Badge "MQTT Activo" aparece en el dashboard cuando hay lecturas de nodos reales (IDs que empiezan con `NODO`).
