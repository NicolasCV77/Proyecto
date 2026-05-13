import { Component, OnInit, OnDestroy, AfterViewInit, ElementRef, ViewChild, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NavbarComponent } from '../../shared/components/navbar/navbar.component';
import { HttpClient } from '@angular/common/http';
import * as L from 'leaflet';

interface SensorDetail {
  sensorId:   string;
  type:       string;
  status:     string;
  statusClass: string;
  lat:        number;
  lng:        number;
  locationName: string;
  color:      string;
  readings:   any[];
}

interface MarkerInfo {
  leafletMarker: L.CircleMarker;
  title:    string;
  position: { lat: number; lng: number };
  detail:   SensorDetail;
}

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule, RouterModule, NavbarComponent, FormsModule],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.css'],
})
export class MapComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer') mapContainer!: ElementRef;

  currentDate  = new Date().toLocaleDateString('es-CO', { month: 'long', day: 'numeric' });
  locationName = 'Cargando sector...';
  searchQuery  = '';

  functionalCount = 0;
  criticalCount   = 0;
  plannedCount    = 0;

  // location selector
  allLocations: any[] = [];
  selectedLocationId = 'user';  // 'user' = user's default, 'all' = all, or a specific locationId

  // panel lateral de sensor seleccionado
  selectedSensor: SensorDetail | null = null;

  private map!: L.Map;
  private markerData: MarkerInfo[] = [];
  private allLiveReadings: any[] = [];
  private userDefaultLocationId = 'chingaza';

  private readonly API = '';

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit() {}

  ngAfterViewInit() {
    this.map = L.map(this.mapContainer.nativeElement, {
      center:      [4.6097, -74.0817],
      zoom:        10,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(this.map);

    this.loadMapData();
  }

  ngOnDestroy() {
    if (this.map) this.map.remove();
  }

  refresh() {
    this.selectedSensor = null;
    this.loadMapData();
  }

  closeSensorPanel() {
    this.selectedSensor = null;
  }

  selectLocation(id: string) {
    this.selectedLocationId = id;
    this.selectedSensor     = null;
    this.applySelectedLocation();
    this.cdr.detectChanges();
  }

  private applySelectedLocation() {
    if (!this.allLocations.length) return;

    if (this.selectedLocationId === 'all') {
      this.locationName = 'Todas las ubicaciones';
      this.map.setView([4.5, -73.8], 9);
      this.clearMarkers();
      this.allLocations.forEach(loc =>
        this.buildMarkers(loc.sensors || [], this.allLiveReadings, loc.locationName)
      );
      this.calculateStats();
      this.cdr.detectChanges();
    } else {
      const targetId = this.selectedLocationId === 'user'
        ? this.userDefaultLocationId
        : this.selectedLocationId;
      const loc = this.allLocations.find(l => l.locationId === targetId) || this.allLocations[0];
      this.applyLocation(loc, this.allLiveReadings);
    }
  }

  loadMapData() {
    const userEmail     = localStorage.getItem('userEmail');
    const savedLocation = localStorage.getItem('userLocation');

    if (!userEmail) {
      this.loadLocationsFromAPI(savedLocation || 'chingaza', []);
      return;
    }

    this.http.get<any>(`${this.API}/api/dashboard/${userEmail}`).subscribe({
      next: (userData) => {
        if (userData.locationId) {
          localStorage.setItem('userLocation', userData.locationId);
          this.userDefaultLocationId = userData.locationId;
        }
        this.allLiveReadings = userData.readings || [];
        this.loadLocationsFromAPI(userData.locationId || savedLocation || 'chingaza', this.allLiveReadings);
      },
      error: () => this.loadLocationsFromAPI(savedLocation || 'chingaza', []),
    });
  }

  loadLocationsFromAPI(defaultId: string, liveReadings: any[]) {
    this.http.get<any[]>(`${this.API}/api/locations`).subscribe({
      next: (all) => {
        this.allLocations          = all;
        this.userDefaultLocationId = defaultId;
        const loc = all.find(l => l.locationId === defaultId) || all[0];
        this.applyLocation(loc, liveReadings);
      },
      error: () => {
        this.http.get<any[]>('/assets/data/locations.json').subscribe({
          next: (all) => {
            this.allLocations = all;
            const loc = all.find(l => l.locationId === defaultId) || all[0];
            this.applyLocation(loc, liveReadings);
          },
          error: () => { this.locationName = 'Error cargando mapa'; }
        });
      },
    });
  }

  private applyLocation(loc: any, liveReadings: any[]) {
    this.locationName = loc.locationName;
    this.map.setView([loc.mapCenter.lat, loc.mapCenter.lng], loc.mapZoom);
    this.clearMarkers();
    if (loc.sensors?.length > 0) {
      this.buildMarkers(loc.sensors, liveReadings, loc.locationName);
    }
    this.calculateStats();
    this.cdr.detectChanges();
  }

  private buildMarkers(sensors: any[], liveReadings: any[], locName: string) {
    sensors.forEach((sensor: any) => {
      const live = liveReadings?.find((r: any) => r.sensorId === sensor.sensorId);
      const sc   = live ? live.statusClass : sensor.statusClass;
      const st   = live ? live.status      : sensor.status;

      let color      = '#16a34a';
      let statusText = 'Funcional';

      if      (sc === 'critical' || st === 'Crítico')     { color = '#dc2626'; statusText = 'CRÍTICO'; }
      else if (sc === 'warning'  || st === 'Advertencia') { color = '#d97706'; statusText = 'Advertencia'; }
      else if (sc === 'planned'  || st === 'Planificado') { color = '#d97706'; statusText = 'Planificado'; }

      const m = L.circleMarker([sensor.lat, sensor.lng], {
        radius:      10,
        fillColor:   color,
        color:       '#fff',
        weight:      2,
        opacity:     1,
        fillOpacity: 0.88,
      }).addTo(this.map);

      // Lecturas del sensor de las lecturas vivas
      const sensorReadings = liveReadings.filter(r => r.sensorId === sensor.sensorId);

      const typeLabel = (sensor.types?.length ? sensor.types : [sensor.type]).filter(Boolean).join(', ');

      const detail: SensorDetail = {
        sensorId:     sensor.sensorId,
        type:         typeLabel || sensor.type,
        status:       statusText,
        statusClass:  sc || 'normal',
        lat:          sensor.lat,
        lng:          sensor.lng,
        locationName: locName,
        color,
        readings:     sensorReadings,
      };

      m.on('click', () => {
        this.selectedSensor = detail;
        this.cdr.detectChanges();
      });

      // Tooltip hover
      m.bindTooltip(`<b>${sensor.sensorId}</b> — ${typeLabel || sensor.type}`, {
        permanent: false,
        direction: 'top',
        className: 'sensor-tooltip'
      });

      this.markerData.push({
        leafletMarker: m,
        title:    `${sensor.sensorId} - ${statusText}`,
        position: { lat: sensor.lat, lng: sensor.lng },
        detail,
      });
    });
  }

  private clearMarkers() {
    this.markerData.forEach(md => this.map.removeLayer(md.leafletMarker));
    this.markerData = [];
  }

  calculateStats() {
    this.functionalCount = 0;
    this.criticalCount   = 0;
    this.plannedCount    = 0;
    this.markerData.forEach(md => {
      if      (md.title.includes('CRÍTICO'))                                              this.criticalCount++;
      else if (md.title.includes('Planificado') || md.title.includes('Advertencia'))      this.plannedCount++;
      else                                                                                 this.functionalCount++;
    });
  }

  filterMarkers() {
    const query    = this.searchQuery.toLowerCase().trim();
    const matching: MarkerInfo[] = [];

    this.markerData.forEach(md => {
      const visible = !query || md.title.toLowerCase().includes(query);
      if (visible) { md.leafletMarker.addTo(this.map); matching.push(md); }
      else           this.map.removeLayer(md.leafletMarker);
    });

    if (query && matching.length === 1) {
      this.map.setView([matching[0].position.lat, matching[0].position.lng], 18);
      this.selectedSensor = matching[0].detail;
      this.cdr.detectChanges();
    }
  }

  statusBadgeClass(sc: string): string {
    const map: Record<string, string> = {
      normal:   'badge-normal',
      critical: 'badge-critical',
      warning:  'badge-warning',
      planned:  'badge-planned',
    };
    return map[sc] || 'badge-normal';
  }
}
