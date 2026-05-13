import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { NavbarComponent } from '../../shared/components/navbar/navbar.component';
import { MinValPipe, MaxValPipe, AvgValPipe } from './chart-stats.pipes';

export interface SensorReading {
  _id?: string;
  timestamp:   string;
  sensorId:    string;
  type:        string;
  value:       number;
  unit:        string;
  status:      string;
  statusClass: string;
}

export interface ChartPoint {
  iso:         string;
  temperature: number;
  humidity:    number;
  water:       number;
  soil:        number;
}

export interface DashboardData {
  _id?:         string;
  userEmail:    string;
  locationId?:  string;
  locationName: string;
  syncTime:     string;
  userName:     string;
  currentDate:  string;
  activeSensors:      number;
  totalSensors:       number;
  criticalAlerts:     number;
  inactiveSensors:    number;
  sensorHistory:      number[];
  waterHistory:       number[];
  temperatureHistory: number[];
  humidityHistory:    number[];
  soilHistory:        number[];
  alertHistory:       number[];
  chartData?:         ChartPoint[];
  environmentalSummary?: {
    temperature: number;
    humidity:    number;
    waterLevel:  number;
    soil?:       number | null;
    status:      string;
  } | null;
  readings: SensorReading[];
}

export type ChartType = 'water' | 'temperature' | 'humidity' | 'soil';
export type TimeRange = '1h' | '6h' | '24h' | '7d' | 'custom';

interface AlertRecord {
  id:       number;
  type:     'critical' | 'warning' | 'info';
  title:    string;
  desc:     string;
  time:     string;
  location: string;
}

interface ClimateCategory {
  name:       string;
  cssClass:   string;
  tempRange:  string;
  humRange:   string;
  waterRange: string;
  soilRange:  string;
  desc:       string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, NavbarComponent, FormsModule, MinValPipe, MaxValPipe, AvgValPipe],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  dashboardData: DashboardData | null = null;
  isLoading = true;
  error = '';
  mqttActive = false;

  // ── chart expansion ──────────────────────────────────────
  expandedChart: ChartType | null = null;
  timeRange: TimeRange = '24h';
  customFrom = '';
  customTo   = '';

  // ── alerts panel ─────────────────────────────────────────
  showAlertsPanel = false;
  readonly SAMPLE_ALERTS: AlertRecord[] = [
    { id: 1,  type: 'critical', title: 'Nivel de agua crítico',        desc: 'Sensor CH-105 superó el 90% — riesgo de inundación en zona baja.',       time: '14:32', location: 'Chingaza' },
    { id: 2,  type: 'critical', title: 'Temperatura fuera de rango',   desc: 'Sensor SU-201 registró 23 °C — umbral paramuno excedido (>18 °C).',       time: '13:55', location: 'Sumapaz' },
    { id: 3,  type: 'warning',  title: 'Humedad suelo baja',           desc: 'Zona Guerrero: humedad suelo < 25% — posible estrés hídrico.',             time: '13:10', location: 'Guerrero' },
    { id: 4,  type: 'critical', title: 'Sensor sin señal',             desc: 'RA-402 no reporta desde hace 3 horas — verificar batería o conectividad.',time: '12:40', location: 'Rabanal' },
    { id: 5,  type: 'warning',  title: 'Humedad del aire baja',        desc: 'Sensor CV-501: humedad < 45% — condición de desecación detectada.',        time: '12:15', location: 'Cruz Verde' },
    { id: 6,  type: 'critical', title: 'Nivel de agua en mínimo',      desc: 'Sensor GU-301: nivel 8% — embalse en estado crítico.',                     time: '11:50', location: 'Guerrero' },
    { id: 7,  type: 'warning',  title: 'Fluctuación rápida de nivel',  desc: 'CH-101: variación de +15% en 20 min — evento de escorrentía probable.',    time: '11:22', location: 'Chingaza' },
    { id: 8,  type: 'info',     title: 'Mantenimiento programado',     desc: 'Sensor SU-202 entrará en mantenimiento el 2026-05-10.',                    time: '10:00', location: 'Sumapaz' },
    { id: 9,  type: 'critical', title: 'Temperatura bajo mínimo',      desc: 'Sensor RA-401: 1.2 °C — riesgo de congelación del suelo paramuno.',        time: '09:45', location: 'Rabanal' },
    { id: 10, type: 'warning',  title: 'Batería baja en nodo',         desc: 'NODO_01: batería estimada < 15% — reemplazar antes de 48 h.',              time: '09:00', location: 'Chingaza' },
  ];

  // ── climate modal ─────────────────────────────────────────
  showClimateModal = false;
  readonly CLIMATE_CATEGORIES: ClimateCategory[] = [
    {
      name:       'Óptimo',
      cssClass:   'cat-optimal',
      tempRange:  '5 °C – 15 °C',
      humRange:   '> 70 %',
      waterRange: '60 % – 100 %',
      soilRange:  '> 60 %',
      desc:       'Condiciones ideales para el ecosistema paramuno. Alta humedad, temperatura baja y nivel de agua adecuado mantienen la funcionalidad hídrica.',
    },
    {
      name:       'Intermedio',
      cssClass:   'cat-medium',
      tempRange:  '15 °C – 20 °C / 3 °C – 5 °C',
      humRange:   '40 % – 70 %',
      waterRange: '40 % – 60 %',
      soilRange:  '30 % – 60 %',
      desc:       'Condiciones aceptables pero bajo vigilancia. Puede indicar inicio de temporada seca o presión antrópica. Se recomienda monitoreo frecuente.',
    },
    {
      name:       'Crítico',
      cssClass:   'cat-critical',
      tempRange:  '> 20 °C / < 3 °C',
      humRange:   '< 40 %',
      waterRange: '< 40 % o > 90 %',
      soilRange:  '< 30 %',
      desc:       'Condiciones de estrés severo. Temperatura extrema, desecación o inundación. Se requiere intervención inmediata y alerta a autoridades ambientales.',
    },
  ];

  // ── location / sensor filter ──────────────────────────────
  selectedLocationId = 'all';
  selectedSensorId   = 'all';
  allLocations: { locationId: string; locationName: string; sensors: { sensorId: string }[] }[] = [];
  private locationSensorMap = new Map<string, string[]>();

  private pollingInterval: any;
  private readonly POLL_MS = 30_000;

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.loadLocations();
    this.fetchDashboardData();
    this.pollingInterval = setInterval(() => this.fetchDashboardData(), this.POLL_MS);
  }

  ngOnDestroy() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
  }

  loadLocations() {
    this.http.get<any[]>('/api/locations').subscribe({
      next: (locs) => {
        this.allLocations = locs;
        this.locationSensorMap.clear();
        for (const loc of locs) {
          this.locationSensorMap.set(loc.locationId, (loc.sensors || []).map((s: any) => s.sensorId));
        }
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  onLocationChange() {
    this.selectedSensorId = 'all';
    this.cdr.markForCheck();
  }

  clearFilters() {
    this.selectedLocationId = 'all';
    this.selectedSensorId   = 'all';
    this.cdr.markForCheck();
  }

  get isFiltered(): boolean {
    return this.selectedLocationId !== 'all' || this.selectedSensorId !== 'all';
  }

  fetchDashboardData() {
    this.error = '';
    const userEmail = localStorage.getItem('userEmail');

    if (!userEmail) {
      this.error     = 'No se encontró sesión de usuario.';
      this.isLoading = false;
      this.cdr.detectChanges();
      return;
    }

    this.http.get<DashboardData>(`/api/dashboard/${userEmail}`).subscribe({
      next: (data) => {
        this.dashboardData = data;
        this.dashboardData.syncTime = new Date().toLocaleTimeString('es-CO', {
          hour: '2-digit', minute: '2-digit', hour12: false
        });
        this.mqttActive = (data.readings || []).some(r => r.sensorId?.startsWith('NODO'));
        this.isLoading  = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error conectando al servidor:', err);
        if (!this.dashboardData) {
          this.error = 'No se encontraron datos. Mostrando panel por defecto.';
          this.dashboardData = {
            userEmail:          userEmail,
            locationName:       'Ubicación desconocida',
            syncTime:           new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }),
            userName:           'Usuario',
            currentDate:        new Date().toLocaleDateString('es-CO', { month: 'long', day: 'numeric' }),
            activeSensors:      0,
            totalSensors:       0,
            criticalAlerts:     0,
            inactiveSensors:    0,
            sensorHistory:      [],
            waterHistory:       [],
            temperatureHistory: [],
            humidityHistory:    [],
            soilHistory:        [],
            alertHistory:       [],
            chartData:          [],
            environmentalSummary: null,
            readings: [],
          };
        }
        this.isLoading = false;
        this.cdr.detectChanges();
      },
    });
  }

  refresh() {
    this.isLoading = true;
    this.fetchDashboardData();
  }

  // ── alerts panel ─────────────────────────────────────────

  openAlertsPanel() {
    this.showAlertsPanel = true;
    document.body.style.overflow = 'hidden';
  }

  closeAlertsPanel() {
    this.showAlertsPanel = false;
    document.body.style.overflow = '';
  }

  alertBadgeClass(type: string): string {
    return type === 'critical' ? 'alert-badge-critical'
         : type === 'warning'  ? 'alert-badge-warning'
         : 'alert-badge-info';
  }

  get criticalAlertsCount(): number {
    return this.SAMPLE_ALERTS.filter(a => a.type === 'critical').length;
  }

  // ── climate modal ─────────────────────────────────────────

  openClimateModal() {
    this.showClimateModal = true;
    document.body.style.overflow = 'hidden';
  }

  closeClimateModal() {
    this.showClimateModal = false;
    document.body.style.overflow = '';
  }

  get climateStatus(): string {
    const s = this.filteredEnvSummary;
    if (!s) return 'Sin datos';
    const temp  = s.temperature;
    const hum   = s.humidity;
    const water = s.waterLevel;
    if (temp > 20 || temp < 3 || hum < 40 || water < 40 || water > 90) return 'Crítico';
    if (temp > 15 || temp < 5 || hum < 70 || water < 60) return 'Intermedio';
    return 'Óptimo';
  }

  get climateStatusClass(): string {
    const s = this.climateStatus;
    return s === 'Crítico' ? 'status-critical' : s === 'Intermedio' ? 'status-medium' : 'status-optimal';
  }

  // ── water status ─────────────────────────────────────────

  get waterStatus(): { label: string; cssClass: string } {
    const level = this.filteredEnvSummary?.waterLevel ?? -1;
    if (level < 0) return { label: '—', cssClass: '' };
    if (level >= 80) return { label: 'Óptimo',     cssClass: 'status-optimal'  };
    if (level >= 40) return { label: 'Intermedio', cssClass: 'status-medium'   };
    return              { label: 'Crítico',     cssClass: 'status-critical' };
  }

  // ── filter helpers ───────────────────────────────────────

  get filteredReadings(): SensorReading[] {
    const all = this.dashboardData?.readings || [];
    let result = all;

    if (this.selectedLocationId !== 'all') {
      const locSensors = this.locationSensorMap.get(this.selectedLocationId) || [];
      if (locSensors.length > 0) {
        result = result.filter(r => locSensors.includes(r.sensorId));
      }
    }

    if (this.selectedSensorId !== 'all') {
      result = result.filter(r => r.sensorId === this.selectedSensorId);
    }

    return result;
  }

  get availableSensors(): string[] {
    const all = this.dashboardData?.readings || [];
    let source = all;
    if (this.selectedLocationId !== 'all') {
      const locSensors = this.locationSensorMap.get(this.selectedLocationId) || [];
      if (locSensors.length > 0) {
        source = source.filter(r => locSensors.includes(r.sensorId));
      }
    }
    return [...new Set(source.map(r => r.sensorId))];
  }

  get filteredEnvSummary() {
    const r = this.filteredReadings;
    if (!r.length) return null;
    const latestOf = (type: string) => r.find(x => x.type === type)?.value ?? null;
    const water = latestOf('Nivel de agua');
    const temp  = latestOf('Temperatura');
    const hum   = latestOf('Humedad');
    const soil  = latestOf('Humedad suelo');
    return {
      temperature: temp  ?? 0,
      humidity:    hum   ?? 0,
      waterLevel:  water ?? 0,
      soil:        soil  ?? null,
      status:      (water ?? 0) > 30 ? 'Alerta' : 'Óptimo'
    };
  }

  get filteredActiveSensors(): number {
    return new Set(this.filteredReadings.map(r => r.sensorId)).size;
  }

  // ── getters ──────────────────────────────────────────────

  get hasRealData(): boolean {
    return this.filteredReadings.length > 0;
  }

  get hasAnyData(): boolean {
    return (this.dashboardData?.readings?.length ?? 0) > 0;
  }

  get hasSoilData(): boolean {
    return this.derivedSoilHistory.length > 0;
  }

  // ── mini chart helpers ────────────────────────────────────

  private buildPath(data: number[]): string {
    if (data.length < 2) return `M0,35 L100,35`;
    const max = Math.max(...data);
    const min = Math.min(...data);
    if (max === min) return `M0,35 L100,35`;
    const range = max - min;
    return data.map((val, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 35 - ((val - min) / range) * 30;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  private buildArea(path: string): string {
    return `${path} L100,40 L0,40 Z`;
  }

  // Extract values by type from filtered readings, oldest→newest order for charts
  private readingsOf(type: string): number[] {
    return this.filteredReadings
      .filter(r => r.type === type)
      .map(r => r.value)
      .reverse();
  }

  get derivedWaterHistory():   number[] { return this.readingsOf('Nivel de agua'); }
  get derivedTempHistory():    number[] { return this.readingsOf('Temperatura'); }
  get derivedHumHistory():     number[] { return this.readingsOf('Humedad'); }
  get derivedSoilHistory():    number[] { return this.readingsOf('Humedad suelo'); }

  get waterChartPath():       string { return this.buildPath(this.derivedWaterHistory); }
  get waterChartArea():       string { return this.buildArea(this.waterChartPath); }
  get temperatureChartPath(): string { return this.buildPath(this.derivedTempHistory); }
  get temperatureChartArea(): string { return this.buildArea(this.temperatureChartPath); }
  get humidityChartPath():    string { return this.buildPath(this.derivedHumHistory); }
  get humidityChartArea():    string { return this.buildArea(this.humidityChartPath); }
  get soilChartPath():        string { return this.buildPath(this.derivedSoilHistory); }
  get soilChartArea():        string { return this.buildArea(this.soilChartPath); }

  // ── axis labels ──────────────────────────────────────────

  yLabels(data: number[]): number[] {
    if (!data.length) return [100, 75, 50, 25, 0];
    const max = Math.max(...data);
    const min = Math.min(...data);
    // When all values identical, show a fixed 0-100 scale
    if (max === min) return [100, 75, 50, 25, 0];
    const range = max - min;
    return [max, min + range * 0.75, min + range * 0.5, min + range * 0.25, min]
      .map(v => Math.round(v));
  }

  get chartXLabels(): string[] {
    if (!this.filteredReadings.length) return [];
    return this.filteredReadings.map(r => r.timestamp).slice(0, 6).reverse();
  }

  // ── expanded chart ────────────────────────────────────────

  openChart(type: ChartType) {
    this.expandedChart = type;
    document.body.style.overflow = 'hidden';
    this.cdr.detectChanges();
  }

  closeChart() {
    this.expandedChart = null;
    document.body.style.overflow = '';
    this.cdr.detectChanges();
  }

  setTimeRange(range: TimeRange) {
    this.timeRange = range;
    if (range !== 'custom') {
      this.customFrom = '';
      this.customTo   = '';
    }
  }

  get filteredChartData(): ChartPoint[] {
    // When a filter is active, chartData (global) doesn't have sensorId info,
    // so use syntheticChartData built from filteredReadings instead.
    const all = this.isFiltered ? [] : (this.dashboardData?.chartData || []);

    if (!all.length) return this.syntheticChartData;

    let filtered: ChartPoint[];

    if (this.timeRange === 'custom') {
      const from = this.customFrom ? new Date(this.customFrom).getTime() : 0;
      const to   = this.customTo   ? new Date(this.customTo).getTime() + 86399999 : Date.now();
      filtered = all.filter(p => {
        const t = new Date(p.iso).getTime();
        return t >= from && t <= to;
      }).slice().reverse();
    } else {
      const msMap: Record<string, number> = {
        '1h':  3_600_000,
        '6h':  21_600_000,
        '24h': 86_400_000,
        '7d':  604_800_000,
      };
      const cutoff = Date.now() - (msMap[this.timeRange] || msMap['24h']);
      filtered = all.filter(p => new Date(p.iso).getTime() >= cutoff).slice().reverse();
    }

    if (!filtered.length) {
      const synth = this.syntheticChartData;
      if (synth.length) return synth;
      return all.slice(0, 50).reverse();
    }

    return filtered;
  }

  private get syntheticChartData(): ChartPoint[] {
    const readings = this.filteredReadings;
    if (!readings.length) return [];
    // Group readings by isoDate (each raw SensorReading may produce multiple type rows)
    const byIso = new Map<string, ChartPoint>();
    for (const r of readings) {
      const iso = (r as any).isoDate || r.timestamp;
      if (!byIso.has(iso)) byIso.set(iso, { iso, temperature: 0, humidity: 0, water: 0, soil: 0 });
      const p = byIso.get(iso)!;
      if (r.type === 'Temperatura')    p.temperature = r.value;
      if (r.type === 'Humedad')        p.humidity    = r.value;
      if (r.type === 'Nivel de agua')  p.water       = r.value;
      if (r.type === 'Humedad suelo')  p.soil        = r.value;
    }
    return Array.from(byIso.values()).reverse();
  }

  get expandedChartPoints(): number[] {
    const data = this.filteredChartData;
    if (!data.length) return [];
    switch (this.expandedChart) {
      case 'water':       return data.map(p => p.water);
      case 'temperature': return data.map(p => p.temperature);
      case 'humidity':    return data.map(p => p.humidity);
      case 'soil':        return data.map(p => p.soil);
      default:            return [];
    }
  }

  get expandedChartPath(): string { return this.buildExpandedPath(this.expandedChartPoints); }
  get expandedChartArea(): string { return this.buildExpandedArea(this.expandedChartPath); }

  private buildExpandedPath(data: number[]): string {
    if (data.length < 2) return 'M0,80 L100,80';
    const max = Math.max(...data);
    const min = Math.min(...data);
    if (max === min) return 'M0,80 L100,80';
    const absMin = min;
    const absMax = max;
    const range  = absMax - absMin || 1;
    return data.map((val, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 80 - ((val - absMin) / range) * 65;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  }

  private buildExpandedArea(path: string): string {
    return `${path} L100,90 L0,90 Z`;
  }

  get expandedYLabels(): number[] {
    return this.yLabels(this.expandedChartPoints);
  }

  get expandedXLabels(): string[] {
    const data = this.filteredChartData;
    if (!data.length) return [];
    const step = Math.max(1, Math.floor(data.length / 5));
    return data.filter((_, i) => i % step === 0).map(p =>
      new Date(p.iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
    );
  }

  expandedChartTitle(): string {
    const map: Record<ChartType, string> = {
      water:       'Nivel de Agua',
      temperature: 'Temperatura',
      humidity:    'Humedad del Aire',
      soil:        'Humedad del Suelo',
    };
    return map[this.expandedChart!] || '';
  }

  expandedChartUnit(): string {
    const map: Record<ChartType, string> = {
      water:       '%',
      temperature: '°C',
      humidity:    '%',
      soil:        '%',
    };
    return map[this.expandedChart!] || '';
  }

  expandedChartColor(): string {
    const map: Record<ChartType, string> = {
      water:       '#2563eb',
      temperature: '#ef4444',
      humidity:    '#0d9488',
      soil:        '#d97706',
    };
    return map[this.expandedChart!] || '#0d9488';
  }
}
