const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const mqtt     = require('mqtt');

const app = express();
app.use(cors());
app.use(express.json());

// ── MongoDB ──────────────────────────────────────────────────────────────────

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/paramosense')
    .then(() => {
        console.log('[MongoDB] Conectado');
        seedLocations();
    })
    .catch(err => console.error('[MongoDB] Error de conexión:', err));

// ── Schemas & Models ─────────────────────────────────────────────────────────

const UserSchema = new mongoose.Schema({
    name:      { type: String, required: true },
    email:     { type: String, required: true, unique: true },
    password:  { type: String, required: true },
    rol:       String,
    telefono:  String,
    area:      String,
    municipio: String
});
const User = mongoose.model('User', UserSchema);

// Punto de datos para el histórico con timestamp real
const ChartPointSchema = new mongoose.Schema({
    iso:         String,   // ISO 8601 — sirve para filtrar por rango de tiempo
    temperature: Number,
    humidity:    Number,
    water:       Number,   // 0–100 % nivel de agua
    soil:        Number    // 0–100%
}, { _id: false });

const DashboardSchema = new mongoose.Schema({
    userEmail:    String,
    syncTime:     String,
    userName:     String,
    currentDate:  String,
    locationId:   String,
    locationName: String,
    activeSensors:    Number,
    totalSensors:     Number,
    criticalAlerts:   Number,
    inactiveSensors:  Number,
    sensorHistory:    [Number],
    waterHistory:     [Number],
    temperatureHistory: [Number],
    humidityHistory:  [Number],
    soilHistory:      [Number],
    alertHistory:     [Number],
    chartData:        [ChartPointSchema],  // últimos 200 puntos con timestamps
    environmentalSummary: {
        temperature: Number,
        humidity:    Number,
        waterLevel:  Number,
        soil:        Number,
        status:      String
    },
    readings: [{
        timestamp:   String,
        sensorId:    String,
        type:        { type: String },
        value:       Number,
        unit:        String,
        status:      String,
        statusClass: String
    }]
});
const Dashboard = mongoose.model('Dashboard', DashboardSchema);

const SensorReadingSchema = new mongoose.Schema({
    nodeId:      String,
    temperature: Number,
    humidity:    Number,
    water:       Number,   // 0–100 % nivel de agua
    soil:        Number,   // 0 o 100 (seco/húmedo) desde v1.4; 0–100 en v1.3
    receivedAt:  { type: Date, default: Date.now }
});
const SensorReading = mongoose.model('SensorReading', SensorReadingSchema);

const SensorSchema = new mongoose.Schema({
    sensorId:    String,
    types:       [String],  // array of sensor types (primary)
    type:        String,    // legacy single-type fallback
    lat:         Number,
    lng:         Number,
    status:      String,
    statusClass: String
}, { _id: false });

const LocationSchema = new mongoose.Schema({
    locationId:   { type: String, unique: true },
    locationName: String,
    mapCenter:    { lat: Number, lng: Number },
    mapZoom:      Number,
    sensors:      [SensorSchema]
});
const Location = mongoose.model('Location', LocationSchema);

// ── Seed de ubicaciones ──────────────────────────────────────────────────────

const DEFAULT_LOCATIONS = [
    {
        locationId: 'chingaza',
        locationName: 'Páramo de Chingaza (Embalse de Chuza)',
        mapCenter: { lat: 4.5986, lng: -73.7115 },
        mapZoom: 15,
        sensors: [
            { sensorId: 'CH-101', type: 'Nivel de Agua', lat: 4.5986, lng: -73.7115, status: 'Funcional', statusClass: 'normal' },
            { sensorId: 'CH-102', type: 'Humedad',       lat: 4.5991, lng: -73.7110, status: 'Funcional', statusClass: 'normal' },
            { sensorId: 'CH-105', type: 'Temperatura',   lat: 4.5981, lng: -73.7120, status: 'Crítico',   statusClass: 'critical' }
        ]
    },
    {
        locationId: 'sumapaz',
        locationName: 'Páramo de Sumapaz (Laguna Los Tunjos)',
        mapCenter: { lat: 4.2760, lng: -74.2110 },
        mapZoom: 16,
        sensors: [
            { sensorId: 'SU-201', type: 'Temperatura',   lat: 4.2760, lng: -74.2110, status: 'Funcional',   statusClass: 'normal' },
            { sensorId: 'SU-202', type: 'Nivel de Agua', lat: 4.2757, lng: -74.2107, status: 'Advertencia', statusClass: 'warning' }
        ]
    },
    {
        locationId: 'guerrero',
        locationName: 'Páramo de Guerrero (Represa del Neusa)',
        mapCenter: { lat: 5.1500, lng: -73.9610 },
        mapZoom: 14,
        sensors: [
            { sensorId: 'GU-301', type: 'Nivel de Agua', lat: 5.1500, lng: -73.9610, status: 'Funcional',   statusClass: 'normal' },
            { sensorId: 'GU-304', type: 'Temperatura',   lat: 5.1505, lng: -73.9605, status: 'Planificado', statusClass: 'planned' }
        ]
    },
    {
        locationId: 'rabanal',
        locationName: 'Páramo de Rabanal (Laguna Teatinos)',
        mapCenter: { lat: 5.4410, lng: -73.4752 },
        mapZoom: 15,
        sensors: [
            { sensorId: 'RA-401', type: 'Humedad',       lat: 5.4410, lng: -73.4752, status: 'Funcional', statusClass: 'normal' },
            { sensorId: 'RA-402', type: 'Nivel de Agua', lat: 5.4415, lng: -73.4747, status: 'Crítico',   statusClass: 'critical' }
        ]
    },
    {
        locationId: 'cruz_verde',
        locationName: 'Cruz Verde - Choachí (Laguna El Verjón)',
        mapCenter: { lat: 4.5647, lng: -73.9961 },
        mapZoom: 17,
        sensors: [
            { sensorId: 'CV-501', type: 'Temperatura',   lat: 4.5647, lng: -73.9961, status: 'Funcional', statusClass: 'normal' },
            { sensorId: 'CV-502', type: 'Nivel de Agua', lat: 4.5648, lng: -73.9959, status: 'Funcional', statusClass: 'normal' }
        ]
    }
];

async function seedLocations() {
    try {
        const count = await Location.countDocuments();
        if (count > 0) return;
        await Location.insertMany(DEFAULT_LOCATIONS);
        console.log('[Seed] Ubicaciones iniciales cargadas en MongoDB');
    } catch (e) {
        console.error('[Seed] Error al cargar ubicaciones:', e.message);
    }
}

// ── MQTT ─────────────────────────────────────────────────────────────────────

const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://broker.hivemq.com';
const MQTT_TOPIC  = process.env.MQTT_TOPIC      || 'paramosense/data';

const mqttClient = mqtt.connect(MQTT_BROKER, {
    clientId:        `paramosense-backend-${Math.random().toString(16).slice(2, 8)}`,
    clean:           true,
    reconnectPeriod: 5000,
    connectTimeout:  30000
});

mqttClient.on('connect', () => {
    console.log(`[MQTT] Conectado a ${MQTT_BROKER}`);
    mqttClient.subscribe(MQTT_TOPIC, (err) => {
        if (err) console.error('[MQTT] Error al suscribirse:', err.message);
        else     console.log(`[MQTT] Suscrito a ${MQTT_TOPIC}`);
    });
});

mqttClient.on('error',     (err) => console.error('[MQTT] Error:', err.message));
mqttClient.on('reconnect', ()    => console.log('[MQTT] Reconectando...'));
mqttClient.on('offline',   ()    => console.log('[MQTT] Broker sin conexión'));

mqttClient.on('message', async (topic, message) => {
    try {
        const raw = message.toString();
        console.log(`[MQTT] Mensaje recibido en '${topic}': ${raw}`);

        const payload = JSON.parse(raw);

        // Remapear campos cortos del Arduino al esquema del backend
        const nodeId   = payload.nodeId ?? payload.id ?? 'NODO_XX';

        // Filtrar valores inválidos (-999 indica fallo del sensor DHT11)
        const rawTemp  = payload.temperature ?? payload.t ?? null;
        const rawHum   = payload.humidity    ?? payload.h ?? null;
        const temperature = (rawTemp !== null && rawTemp > -900) ? rawTemp : null;
        const humidity    = (rawHum  !== null && rawHum  > -900) ? rawHum  : null;

        // water: puede llegar como número 0–100 (v1.4+) o boolean legacy
        const rawWater = payload.water ?? 0;
        const water    = typeof rawWater === 'boolean'
            ? (rawWater ? 100 : 0)
            : Math.max(0, Math.min(100, Number(rawWater)));
        const waterAlert = water > 30;

        const soil = typeof payload.soil === 'number' ? payload.soil : null;

        console.log(`[MQTT] Nodo: ${nodeId} | Temp: ${temperature ?? 'N/A'}°C | Hum: ${humidity ?? 'N/A'}% | Agua: ${water}% | Suelo: ${soil ?? 'N/A'}%`);

        // Guardar lectura raw
        await SensorReading.create({ nodeId, temperature, humidity, water, soil, receivedAt: new Date() });

        const ts     = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
        const isoNow = new Date().toISOString();
        const waterPct = water;  // ya es 0–100

        // Lecturas formateadas para la tabla del dashboard
        const newReadings = [];

        if (temperature != null) {
            newReadings.push({
                timestamp: ts, sensorId: nodeId,
                type: 'Temperatura', value: temperature, unit: '°C',
                status: 'Normal', statusClass: 'normal'
            });
        }

        if (humidity != null) {
            newReadings.push({
                timestamp: ts, sensorId: nodeId,
                type: 'Humedad', value: humidity, unit: '%',
                status: 'Normal', statusClass: 'normal'
            });
        }

        newReadings.push({
            timestamp: ts, sensorId: nodeId,
            type: 'Nivel de agua', value: water, unit: '%',
            status: waterAlert ? 'Alerta' : 'Normal',
            statusClass: waterAlert ? 'critical' : 'normal'
        });

        if (soil != null) {
            newReadings.push({
                timestamp: ts, sensorId: nodeId,
                type: 'Humedad suelo', value: soil, unit: '%',
                status: soil < 30 ? 'Seco' : 'Normal',
                statusClass: soil < 30 ? 'warning' : 'normal'
            });
        }

        // Punto de datos para el histórico con timestamp real
        const chartPoint = {
            iso:         isoNow,
            temperature: temperature ?? 0,
            humidity:    humidity    ?? 0,
            water:       water,        // 0–100
            soil:        soil ?? 0
        };

        // Contar nodos activos en las últimas 24h
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const activeNodeIds = await SensorReading.distinct('nodeId', { receivedAt: { $gte: since24h } });
        const activeCount = activeNodeIds.length;

        // Actualizar todos los dashboards
        const dashboards = await Dashboard.find();
        for (const dash of dashboards) {
            dash.readings = [...newReadings, ...dash.readings].slice(0, 20);
            dash.markModified('readings');

            // Historial de series temporales (últimas 20 lecturas)
            if (temperature != null) {
                dash.temperatureHistory = [temperature, ...(dash.temperatureHistory || [])].slice(0, 20);
                dash.markModified('temperatureHistory');
            }
            if (humidity != null) {
                dash.humidityHistory = [humidity, ...(dash.humidityHistory || [])].slice(0, 20);
                dash.markModified('humidityHistory');
            }
            dash.waterHistory = [waterPct, ...(dash.waterHistory || [])].slice(0, 20);
            dash.markModified('waterHistory');
            if (soil != null) {
                dash.soilHistory = [soil, ...(dash.soilHistory || [])].slice(0, 20);
                dash.markModified('soilHistory');
            }

            // Datos con timestamp para filtrar por rango de tiempo
            dash.chartData = [chartPoint, ...(dash.chartData || [])].slice(0, 200);
            dash.markModified('chartData');

            dash.environmentalSummary = {
                temperature: temperature ?? 0,
                humidity:    humidity    ?? 0,
                waterLevel:  waterPct,
                soil:        soil ?? null,
                status:      waterAlert ? 'Alerta' : 'Óptimo'
            };

            dash.syncTime       = ts;
            dash.currentDate    = new Date().toISOString().split('T')[0];
            dash.activeSensors  = activeCount;
            dash.inactiveSensors = Math.max(0, (dash.totalSensors || 0) - activeCount);
            if (waterAlert) dash.criticalAlerts = (dash.criticalAlerts || 0) + 1;

            await dash.save();
        }

        console.log('[MQTT] Dashboards actualizados');
    } catch (e) {
        console.error('[MQTT] Error procesando mensaje:', e.message);
    }
});

// ── Auth ──────────────────────────────────────────────────────────────────────

const toTitleCase = s => (s || '').replace(/\b\w/g, c => c.toUpperCase());

app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, rol, telefono, area, municipio } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ message: 'Nombre, correo y contraseña son obligatorios.' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            return res.status(400).json({ message: 'Correo electrónico inválido.' });
        }
        if (password.length < 8) {
            return res.status(400).json({ message: 'La contraseña debe tener al menos 8 caracteres.' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const userExists = await User.findOne({ email: normalizedEmail });
        if (userExists) return res.status(400).json({ message: 'El correo ya está registrado' });

        const hashedPassword = await bcrypt.hash(password, await bcrypt.genSalt(10));
        await User.create({
            name:      toTitleCase(name.trim()),
            email:     normalizedEmail,
            password:  hashedPassword,
            rol, telefono, area, municipio
        });

        res.status(201).json({ message: 'Usuario registrado exitosamente' });
    } catch (error) {
        console.error('[Register] Error:', error);
        res.status(500).json({ message: 'Error en el servidor', error });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user) return res.status(400).json({ message: 'Credenciales inválidas' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Credenciales inválidas' });

        res.status(200).json({ message: 'Login exitoso', userName: toTitleCase(user.name), email: user.email });
    } catch (error) {
        res.status(500).json({ message: 'Error en el servidor', error });
    }
});

// ── Dashboard ────────────────────────────────────────────────────────────────

app.get('/api/dashboard/:email', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.params.email });
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

        const rawArea = (user.area || '').toLowerCase();
        let safeLocationId = 'chingaza';
        if      (rawArea.includes('sumapaz'))                            safeLocationId = 'sumapaz';
        else if (rawArea.includes('guerrero'))                           safeLocationId = 'guerrero';
        else if (rawArea.includes('rabanal'))                            safeLocationId = 'rabanal';
        else if (rawArea.includes('cruz') || rawArea.includes('verde'))  safeLocationId = 'cruz_verde';
        else if (rawArea.includes('chingaza'))                           safeLocationId = 'chingaza';
        else if (rawArea !== '')                                          safeLocationId = rawArea.trim().replace(/\s+/g, '_');

        let data = await Dashboard.findOne({ userEmail: req.params.email });

        if (!data) {
            const loc          = await Location.findOne({ locationId: safeLocationId });
            const totalSensors = loc ? loc.sensors.length : 0;

            data = await Dashboard.create({
                userEmail:    user.email,
                syncTime:     '—',
                userName:     user.name,
                currentDate:  new Date().toISOString().split('T')[0],
                locationId:   safeLocationId,
                locationName: user.area ? `Sector: ${user.area}` : 'Ubicación General',
                activeSensors:      0,
                totalSensors,
                criticalAlerts:     0,
                inactiveSensors:    totalSensors,
                sensorHistory:      [],
                waterHistory:       [],
                temperatureHistory: [],
                humidityHistory:    [],
                soilHistory:        [],
                alertHistory:       [],
                chartData:          [],
                environmentalSummary: null,
                readings:           []
            });
        } else {
            // Limpiar datos ficticios de versiones anteriores
            const isFakeData =
                data.readings.some(r => r.sensorId === 'PS-001') ||
                (data.totalSensors === 12 && data.activeSensors === 10);

            if (isFakeData) {
                const loc          = await Location.findOne({ locationId: safeLocationId });
                const totalSensors = loc ? loc.sensors.length : 0;
                data.readings             = [];
                data.activeSensors        = 0;
                data.totalSensors         = totalSensors;
                data.criticalAlerts       = 0;
                data.inactiveSensors      = totalSensors;
                data.sensorHistory        = [];
                data.waterHistory         = [];
                data.temperatureHistory   = [];
                data.humidityHistory      = [];
                data.soilHistory          = [];
                data.alertHistory         = [];
                data.chartData            = [];
                data.environmentalSummary = null;
                data.syncTime             = '—';
                data.markModified('readings');
                data.markModified('sensorHistory');
                data.markModified('waterHistory');
                data.markModified('temperatureHistory');
                data.markModified('humidityHistory');
                data.markModified('soilHistory');
                data.markModified('alertHistory');
                data.markModified('chartData');
                console.log('[Dashboard] Datos ficticios limpiados para', req.params.email);
            }

            if (data.locationId !== safeLocationId) {
                data.locationId   = safeLocationId;
                data.locationName = user.area ? `Sector: ${user.area}` : 'Ubicación General';
            }

            await data.save();
        }

        // Calcular sensores activos en tiempo real (últimas 24h)
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const activeNodeIds = await SensorReading.distinct('nodeId', { receivedAt: { $gte: since24h } });

        // Lecturas globales desde la colección raw (igual para todos los usuarios)
        // 100 raw readings → ~25 per sensor type → enough chart points
        const rawReadings = await SensorReading.find().sort({ receivedAt: -1 }).limit(100).lean();
        const globalReadings = [];
        for (const r of rawReadings) {
            const isoDate = new Date(r.receivedAt).toISOString();
            const ts = new Date(r.receivedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
            // Nivel de agua: siempre incluir (default 0 si el campo falta en documentos antiguos).
            // NOTA: `undefined != null` evalúa a false en JS, por eso no se usó `if (r.water != null)`.
            const waterVal   = r.water ?? 0;
            const waterAlert = waterVal > 30;
            if (r.temperature != null) globalReadings.push({ timestamp: ts, isoDate, sensorId: r.nodeId, type: 'Temperatura',    value: r.temperature, unit: '°C', status: 'Normal',                       statusClass: 'normal' });
            if (r.humidity    != null) globalReadings.push({ timestamp: ts, isoDate, sensorId: r.nodeId, type: 'Humedad',        value: r.humidity,    unit: '%',  status: 'Normal',                       statusClass: 'normal' });
                                       globalReadings.push({ timestamp: ts, isoDate, sensorId: r.nodeId, type: 'Nivel de agua',  value: waterVal,      unit: '%',  status: waterAlert ? 'Alerta' : 'Normal', statusClass: waterAlert ? 'critical' : 'normal' });
            if (r.soil        != null) globalReadings.push({ timestamp: ts, isoDate, sensorId: r.nodeId, type: 'Humedad suelo',  value: r.soil,        unit: '%',  status: r.soil < 30 ? 'Seco' : 'Normal', statusClass: r.soil < 30 ? 'warning' : 'normal' });
        }

        // Reconstruir historial de series desde la colección raw (global, cronológico)
        const chartRaw = await SensorReading.find().sort({ receivedAt: 1 }).limit(200).lean();
        const tempHistory  = chartRaw.filter(r => r.temperature != null).slice(-20).map(r => r.temperature);
        const humHistory   = chartRaw.filter(r => r.humidity    != null).slice(-20).map(r => r.humidity);
        const waterHistory = chartRaw.slice(-20).map(r => r.water ?? 0);  // siempre presente, default 0
        const soilHistory  = chartRaw.filter(r => r.soil        != null).slice(-20).map(r => r.soil);
        const chartData    = chartRaw.map(r => ({
            iso:         new Date(r.receivedAt).toISOString(),
            temperature: r.temperature ?? 0,
            humidity:    r.humidity    ?? 0,
            water:       r.water       ?? 0,
            soil:        r.soil        ?? 0,
        }));

        // environmentalSummary from latest reading
        const latest = chartRaw[chartRaw.length - 1];
        const envSummary = latest ? {
            temperature: latest.temperature ?? 0,
            humidity:    latest.humidity    ?? 0,
            waterLevel:  latest.water       ?? 0,
            soil:        latest.soil        ?? null,
            status:      (latest.water || 0) > 30 ? 'Alerta' : 'Óptimo',
        } : null;

        const base = data.toObject ? data.toObject() : data;

        res.json({
            ...base,
            activeSensors:        activeNodeIds.length,
            inactiveSensors:      Math.max(0, (base.totalSensors || 0) - activeNodeIds.length),
            readings:             globalReadings.slice(0, 80),
            temperatureHistory:   tempHistory,
            humidityHistory:      humHistory,
            waterHistory:         waterHistory,
            soilHistory:          soilHistory,
            chartData:            chartData,
            environmentalSummary: envSummary || base.environmentalSummary || null,
        });
    } catch (err) {
        console.error('[Dashboard] Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── Locations (público) ───────────────────────────────────────────────────────

app.get('/api/locations', async (req, res) => {
    try {
        const locations = await Location.find({}, { __v: 0 });
        res.json(locations);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Admin — usuarios registrados ─────────────────────────────────────────────

app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await User.find({}).select('-password').lean();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Admin — editar ubicaciones ────────────────────────────────────────────────

app.put('/api/admin/locations/:locationId', async (req, res) => {
    try {
        const { sensors, locationName, mapCenter, mapZoom } = req.body;
        const updated = await Location.findOneAndUpdate(
            { locationId: req.params.locationId },
            { $set: { sensors, locationName, mapCenter, mapZoom } },
            { new: true }
        );
        if (!updated) return res.status(404).json({ message: 'Ubicación no encontrada' });
        res.json({ message: 'Ubicación actualizada correctamente', location: updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Nodos activos (han enviado datos en las últimas 24 h) ────────────────────

app.get('/api/nodes/active', async (req, res) => {
    try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // últimas 24 h
        const nodes = await SensorReading.aggregate([
            { $match: { receivedAt: { $gte: since } } },
            { $sort:  { receivedAt: -1 } },
            {
                $group: {
                    _id:         '$nodeId',
                    lastSeen:    { $first: '$receivedAt' },
                    temperature: { $first: '$temperature' },
                    humidity:    { $first: '$humidity' },
                    water:       { $first: '$water' },
                    soil:        { $first: '$soil' },
                    count:       { $sum: 1 }
                }
            },
            { $sort: { lastSeen: -1 } }
        ]);
        res.json(nodes.map(n => ({
            nodeId:      n._id,
            lastSeen:    n.lastSeen,
            temperature: n.temperature,
            humidity:    n.humidity,
            water:       n.water,
            soil:        n.soil,
            readings:    n.count
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Admin — sensores de prueba ────────────────────────────────────────────────

const TEST_SENSORS = [
    { sensorId: 'TEST-T01', type: 'Temperatura',   status: 'Funcional',  statusClass: 'normal'  },
    { sensorId: 'TEST-H01', type: 'Humedad',       status: 'Advertencia',statusClass: 'warning'  },
    { sensorId: 'TEST-W01', type: 'Nivel de Agua', status: 'Funcional',  statusClass: 'normal'  },
    { sensorId: 'TEST-S01', type: 'Temperatura',   status: 'Crítico',    statusClass: 'critical' },
];

// Inyectar sensores de prueba en la ubicación seleccionada
app.post('/api/admin/locations/:locationId/sensors/test', async (req, res) => {
    try {
        const loc = await Location.findOne({ locationId: req.params.locationId });
        if (!loc) return res.status(404).json({ message: 'Ubicación no encontrada' });

        // Calcular offsets alrededor del centro del mapa
        const offsets = [
            { lat:  0.001, lng:  0.001 },
            { lat: -0.001, lng:  0.001 },
            { lat:  0.001, lng: -0.001 },
            { lat: -0.001, lng: -0.002 },
        ];

        const newSensors = TEST_SENSORS.map((s, i) => ({
            ...s,
            lat: loc.mapCenter.lat + (offsets[i]?.lat ?? 0),
            lng: loc.mapCenter.lng + (offsets[i]?.lng ?? 0),
        }));

        // Agregar solo los que no existen todavía
        const existingIds = loc.sensors.map(s => s.sensorId);
        const toAdd = newSensors.filter(s => !existingIds.includes(s.sensorId));

        if (toAdd.length === 0) {
            return res.json({ message: 'Los sensores de prueba ya existen', location: loc });
        }

        loc.sensors.push(...toAdd);
        await loc.save();

        res.json({ message: `${toAdd.length} sensores de prueba agregados`, location: loc });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Eliminar sensores de prueba de la ubicación
app.delete('/api/admin/locations/:locationId/sensors/test', async (req, res) => {
    try {
        const loc = await Location.findOne({ locationId: req.params.locationId });
        if (!loc) return res.status(404).json({ message: 'Ubicación no encontrada' });

        const before = loc.sensors.length;
        loc.sensors = loc.sensors.filter(s => !s.sensorId.startsWith('TEST-'));
        const removed = before - loc.sensors.length;

        await loc.save();
        res.json({ message: `${removed} sensores de prueba eliminados`, location: loc });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Sensor data (fallback HTTP desde Arduino si MQTT no está disponible) ──────

app.post('/api/sensordata', async (req, res) => {
    try {
        const { nodeId, temperature, humidity, water, soil } = req.body;
        await SensorReading.create({ nodeId, temperature, humidity, water, soil });
        res.status(201).json({ message: 'Dato registrado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Backend] Servidor en http://localhost:${PORT}`);
});
