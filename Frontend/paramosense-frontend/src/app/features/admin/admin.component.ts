import { Component, OnInit, OnDestroy, ChangeDetectorRef, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { NavbarComponent } from '../../shared/components/navbar/navbar.component';
import * as L from 'leaflet';

interface Sensor {
  sensorId:    string;
  types:       string[];
  type:        string;  // legacy fallback
  lat:         number;
  lng:         number;
  status:      string;
  statusClass: string;
}

interface Location {
  _id?:         string;
  locationId:   string;
  locationName: string;
  mapCenter:    { lat: number; lng: number };
  mapZoom:      number;
  sensors:      Sensor[];
}

interface UserRecord {
  _id:       string;
  name:      string;
  email:     string;
  rol?:      string;
  telefono?: string;
  area?:     string;
  municipio?: string;
}

interface ActiveNode {
  nodeId:      string;
  lastSeen:    string;
  temperature: number | null;
  humidity:    number | null;
  water:       boolean;
  soil:        number | null;
  readings:    number;
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, RouterModule, NavbarComponent, FormsModule],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.css']
})
export class AdminComponent implements OnInit, OnDestroy {
  // ── password gate ──────────────────────────────────────────
  showPasswordModal = true;
  adminPassword     = '';
  passwordError     = '';

  // ── tabs ───────────────────────────────────────────────────
  activeTab: 'locations' | 'users' = 'locations';

  // ── data ───────────────────────────────────────────────────
  locations: Location[]       = [];
  selectedLocation: Location | null = null;
  isSaving   = false;
  isLoading  = true;
  loadError  = '';
  saveMessage = '';
  saveError   = false;

  // ── users tab ──────────────────────────────────────────────
  users: UserRecord[]  = [];
  usersLoading = false;
  usersError   = '';

  // ── connected nodes (real Arduino) ────────────────────────
  activeNodes: ActiveNode[]    = [];
  nodesLoading = false;
  showNodePicker = false;
  pickerMode: 'real' | 'sim'  = 'real';
  pickerStep: 'list' | 'type' = 'list';
  selectedNode: ActiveNode | null = null;
  selectedNodeTypes: string[] = ['Temperatura'];
  testActionMsg = '';
  testActionError = false;
  testActionLoading = false;

  readonly typeOptions   = ['Temperatura', 'Humedad', 'Nivel de Agua', 'Presión', 'CO2'];
  readonly statusOptions = ['Funcional', 'Crítico', 'Advertencia', 'Planificado'];
  readonly statusClassMap: Record<string, string> = {
    'Funcional':   'normal',
    'Crítico':     'critical',
    'Advertencia': 'warning',
    'Planificado': 'planned'
  };

  // ── admin map ───────────────────────────────────────────────
  private adminMap: L.Map | null = null;
  private adminMarkers: L.CircleMarker[] = [];

  @ViewChild('adminMapContainer') set adminMapContainer(el: ElementRef | undefined) {
    if (el) setTimeout(() => this.initAdminMap(el.nativeElement), 50);
    else    this.destroyAdminMap();
  }

  private readonly API = '';

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {}

  ngOnInit() {}

  ngOnDestroy() {
    this.destroyAdminMap();
  }

  // ── password ────────────────────────────────────────────────

  checkPassword() {
    if (this.adminPassword === '6969') {
      this.showPasswordModal = false;
      this.passwordError     = '';
      this.loadLocations();
    } else {
      this.passwordError  = 'Contraseña incorrecta. Inténtalo de nuevo.';
      this.adminPassword  = '';
    }
  }

  cancelPassword() {
    this.router.navigate(['/dashboard']);
  }

  // ── locations ───────────────────────────────────────────────

  loadLocations() {
    this.isLoading = true;
    this.loadError = '';
    this.http.get<Location[]>(`${this.API}/api/locations`).subscribe({
      next: (data) => {
        this.locations = data;
        if (data.length > 0) this.selectLocation(data[0]);
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loadError = 'No se pudo conectar al backend (). Verifica que el servidor esté corriendo.';
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  switchTab(tab: 'locations' | 'users') {
    this.activeTab = tab;
    if (tab === 'users' && !this.usersLoading && (!this.users.length || this.usersError)) {
      this.loadUsers();
    }
    this.cdr.detectChanges();
  }

  loadUsers() {
    this.usersLoading = true;
    this.usersError   = '';
    this.http.get<UserRecord[]>(`${this.API}/api/admin/users`).subscribe({
      next: (data) => {
        this.users        = data;
        this.usersLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.usersError   = 'No se pudo cargar la lista de usuarios.';
        this.usersLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  rolLabel(rol: string | undefined): string {
    const map: Record<string, string> = {
      agricultor:  'Agricultor',
      autoridad:   'Autoridad Ambiental',
      tecnico:     'Operador Técnico',
      ingeniero:   'Ingeniero / Analista',
      funcionario: 'Funcionario Ambiental',
    };
    return rol ? (map[rol] || rol) : '—';
  }

  areaLabel(area: string | undefined): string {
    const map: Record<string, string> = {
      chingaza:    'Chingaza',
      sumapaz:     'Sumapaz',
      guerrero:    'Guerrero',
      rabanal:     'Rabanal',
      cruz_verde:  'Cruz Verde',
    };
    return area ? (map[area] || area) : '—';
  }

  selectLocation(loc: Location) {
    this.destroyAdminMap();
    this.selectedLocation = JSON.parse(JSON.stringify(loc));
    this.saveMessage     = '';
    this.testActionMsg   = '';
    this.showNodePicker  = false;
    this.cdr.detectChanges();
  }

  // ── real sensor addition ────────────────────────────────────

  openNodePicker() {
    this.pickerMode     = 'real';
    this.showNodePicker = true;
    this.nodesLoading   = true;
    this.cdr.detectChanges();

    this.http.get<ActiveNode[]>(`${this.API}/api/nodes/active`).subscribe({
      next: (nodes) => {
        this.activeNodes  = nodes;
        this.nodesLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.activeNodes  = [];
        this.nodesLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  openSimPicker() {
    this.pickerMode     = 'sim';
    this.pickerStep     = 'list';
    this.showNodePicker = true;
    this.nodesLoading   = true;
    this.cdr.detectChanges();

    this.http.get<ActiveNode[]>(`${this.API}/api/nodes/active`).subscribe({
      next: (nodes) => {
        this.activeNodes  = nodes;
        this.nodesLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.activeNodes  = [];
        this.nodesLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  get filteredPickerNodes(): ActiveNode[] {
    if (this.pickerMode === 'sim') return this.activeNodes.filter(n => n.nodeId.startsWith('SIM_'));
    return this.activeNodes.filter(n => !n.nodeId.startsWith('SIM_'));
  }

  addSimNode(node: ActiveNode) {
    if (!this.selectedLocation) return;
    const allTypes = ['Temperatura', 'Humedad', 'Nivel de Agua', 'Humedad suelo'];
    const existingIdx = this.selectedLocation.sensors.findIndex(s => s.sensorId === node.nodeId);
    if (existingIdx >= 0) {
      const existing = this.selectedLocation.sensors[existingIdx];
      existing.types = allTypes;
      existing.type  = allTypes[0];
    } else {
      this.selectedLocation.sensors.push({
        sensorId:    node.nodeId,
        types:       [...allTypes],
        type:        allTypes[0],
        lat:         this.selectedLocation.mapCenter.lat,
        lng:         this.selectedLocation.mapCenter.lng,
        status:      'Funcional',
        statusClass: 'normal'
      });
    }
    this.updateAdminMapMarkers();
    this.closeNodePicker();
  }

  get hasSimSensors(): boolean {
    return this.selectedLocation?.sensors.some(s => s.sensorId.startsWith('SIM_')) ?? false;
  }

  removeSimSensors() {
    if (!this.selectedLocation) return;
    this.selectedLocation.sensors = this.selectedLocation.sensors.filter(s => !s.sensorId.startsWith('SIM_'));
    this.updateAdminMapMarkers();
    this.testActionMsg   = 'Sensores simulados eliminados de la lista.';
    this.testActionError = false;
    this.cdr.detectChanges();
  }

  addRealNode(node: ActiveNode) {
    this.selectedNode      = node;
    this.selectedNodeTypes = ['Temperatura'];
    this.pickerStep        = 'type';
    this.cdr.detectChanges();
  }

  toggleNodeType(type: string) {
    const idx = this.selectedNodeTypes.indexOf(type);
    if (idx >= 0) {
      this.selectedNodeTypes.splice(idx, 1);
    } else {
      this.selectedNodeTypes.push(type);
    }
    this.cdr.detectChanges();
  }

  isTypeSelected(type: string): boolean {
    return this.selectedNodeTypes.includes(type);
  }

  confirmAddNode() {
    if (!this.selectedLocation || !this.selectedNode || this.selectedNodeTypes.length === 0) return;
    const node = this.selectedNode;

    const existingIdx = this.selectedLocation.sensors.findIndex(s => s.sensorId === node.nodeId);
    if (existingIdx >= 0) {
      // Merge types into existing sensor entry
      const existing = this.selectedLocation.sensors[existingIdx];
      const merged = Array.from(new Set([...(existing.types || [existing.type].filter(Boolean)), ...this.selectedNodeTypes]));
      existing.types = merged;
      existing.type  = merged[0];
    } else {
      this.selectedLocation.sensors.push({
        sensorId:    node.nodeId,
        types:       [...this.selectedNodeTypes],
        type:        this.selectedNodeTypes[0],
        lat:         this.selectedLocation.mapCenter.lat,
        lng:         this.selectedLocation.mapCenter.lng,
        status:      'Funcional',
        statusClass: 'normal'
      });
    }
    this.updateAdminMapMarkers();

    this.showNodePicker    = false;
    this.pickerStep        = 'list';
    this.selectedNode      = null;
    this.selectedNodeTypes = ['Temperatura'];
    this.cdr.detectChanges();
  }

  goBackToNodeList() {
    this.pickerStep        = 'list';
    this.selectedNode      = null;
    this.selectedNodeTypes = ['Temperatura'];
    this.cdr.detectChanges();
  }

  closeNodePicker() {
    this.showNodePicker    = false;
    this.pickerStep        = 'list';
    this.selectedNode      = null;
    this.selectedNodeTypes = ['Temperatura'];
    this.cdr.detectChanges();
  }

  sensorTypesLabel(sensor: Sensor): string {
    const arr = sensor.types?.length ? sensor.types : (sensor.type ? [sensor.type] : []);
    return arr.filter(Boolean).join(' · ') || '—';
  }

  lastSeenLabel(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const min  = Math.floor(diff / 60000);
    if (min < 1)  return 'hace menos de 1 min';
    if (min < 60) return `hace ${min} min`;
    return `hace ${Math.floor(min / 60)} h`;
  }

  // ── test sensors ────────────────────────────────────────────

  addTestSensors() {
    if (!this.selectedLocation) return;
    this.testActionLoading = true;
    this.testActionMsg     = '';

    this.http.post<any>(`${this.API}/api/admin/locations/${this.selectedLocation.locationId}/sensors/test`, {})
      .subscribe({
        next: (res) => {
          this.testActionMsg   = res.message;
          this.testActionError = false;
          this.testActionLoading = false;
          this.loadLocations();
        },
        error: (err) => {
          this.testActionMsg   = err.error?.message || 'Error al agregar sensores de prueba';
          this.testActionError = true;
          this.testActionLoading = false;
          this.cdr.detectChanges();
        }
      });
  }

  removeTestSensors() {
    if (!this.selectedLocation) return;
    this.testActionLoading = true;
    this.testActionMsg     = '';

    this.http.delete<any>(`${this.API}/api/admin/locations/${this.selectedLocation.locationId}/sensors/test`)
      .subscribe({
        next: (res) => {
          this.testActionMsg   = res.message;
          this.testActionError = false;
          this.testActionLoading = false;
          this.loadLocations();
        },
        error: (err) => {
          this.testActionMsg   = err.error?.message || 'Error al eliminar sensores de prueba';
          this.testActionError = true;
          this.testActionLoading = false;
          this.cdr.detectChanges();
        }
      });
  }

  get hasTestSensors(): boolean {
    return this.selectedLocation?.sensors.some(s => s.sensorId.startsWith('TEST-')) ?? false;
  }

  // ── sensor table actions ────────────────────────────────────

  removeSensor(index: number) {
    if (!this.selectedLocation) return;
    this.selectedLocation.sensors.splice(index, 1);
    this.updateAdminMapMarkers();
    this.cdr.detectChanges();
  }

  onStatusChange(sensor: Sensor) {
    sensor.statusClass = this.statusClassMap[sensor.status] ?? 'normal';
    this.updateAdminMapMarkers();
  }

  isTestSensor(s: Sensor): boolean { return s.sensorId.startsWith('TEST-'); }
  isSimSensor(s: Sensor):  boolean { return s.sensorId.startsWith('SIM_'); }
  isRealSensor(s: Sensor): boolean { return !s.sensorId.startsWith('TEST-') && !s.sensorId.startsWith('NUEVO-') && !s.sensorId.startsWith('SIM_'); }

  saveLocation() {
    if (!this.selectedLocation) return;
    this.isSaving    = true;
    this.saveMessage = '';

    this.http
      .put(`${this.API}/api/admin/locations/${this.selectedLocation.locationId}`, this.selectedLocation)
      .subscribe({
        next: () => {
          this.saveMessage = 'Cambios guardados exitosamente';
          this.saveError   = false;
          this.isSaving    = false;
          this.loadLocations();
        },
        error: (err) => {
          this.saveMessage = 'Error al guardar: ' + (err.error?.message ?? 'Error del servidor');
          this.saveError   = true;
          this.isSaving    = false;
          this.cdr.detectChanges();
        }
      });
  }

  // ── admin map ───────────────────────────────────────────────

  private initAdminMap(el: HTMLElement) {
    if (this.adminMap) return;
    if (!this.selectedLocation) return;

    this.adminMap = L.map(el, {
      center:      [this.selectedLocation.mapCenter.lat, this.selectedLocation.mapCenter.lng],
      zoom:        this.selectedLocation.mapZoom,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(this.adminMap);

    this.updateAdminMapMarkers();
  }

  updateAdminMapMarkers() {
    if (!this.adminMap || !this.selectedLocation) return;

    this.adminMarkers.forEach(m => this.adminMap!.removeLayer(m));
    this.adminMarkers = [];

    this.selectedLocation.sensors.forEach(sensor => {
      let color = '#16a34a';
      if (sensor.statusClass === 'critical') color = '#dc2626';
      else if (sensor.statusClass === 'warning' || sensor.statusClass === 'planned') color = '#d97706';

      // Test sensors get a distinct dashed border look via opacity
      const opts: L.CircleMarkerOptions = {
        radius:      10,
        fillColor:   color,
        color:       sensor.sensorId.startsWith('TEST-') ? '#7c3aed' : '#fff',
        weight:      sensor.sensorId.startsWith('TEST-') ? 2.5 : 2,
        opacity:     1,
        fillOpacity: sensor.sensorId.startsWith('TEST-') ? 0.55 : 0.88,
      };

      const m = L.circleMarker([sensor.lat, sensor.lng], opts).addTo(this.adminMap!);
      const label = sensor.sensorId.startsWith('TEST-') ? '(prueba) ' : '';
      const typeLabel = (sensor.types?.length ? sensor.types : [sensor.type]).filter(Boolean).join(', ');
      m.bindPopup(`<b>${label}${sensor.sensorId}</b><br>${typeLabel}<br>${sensor.status}`);
      this.adminMarkers.push(m);
    });
  }

  private destroyAdminMap() {
    if (this.adminMap) { this.adminMap.remove(); this.adminMap = null; }
    this.adminMarkers = [];
  }
}
