import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NavbarComponent } from '../../shared/components/navbar/navbar.component';
import { HttpClient } from '@angular/common/http';

import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface GeneratedReport {
  name: string;
  date: string;
  type: string;
  size: string;
}

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, RouterModule, NavbarComponent, FormsModule],
  templateUrl: './reports.component.html',
  styleUrls: ['./reports.component.css']
})
export class ReportsComponent implements OnInit {
  currentDate = new Date().toLocaleDateString('es-CO', { month: 'long', day: 'numeric' });
  isGenerating = false;

  dashboardData: any = null;

  availableSectors: string[] = ['Todos los sectores'];
  availableTypes: string[] = ['Todas las variables'];
  selectedSector = 'Todos los sectores';
  selectedType = 'Todas las variables';
  startDate: string = '';
  endDate: string = '';

  recentReports: GeneratedReport[] = [];
  filterError  = '';
  exportFormat: 'excel' | 'pdf' | 'csv' = 'excel';

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.fetchDynamicData();
  }

  fetchDynamicData() {
    const userEmail = localStorage.getItem('userEmail');
    if (!userEmail) return;

    this.http.get<any>(`/api/dashboard/${userEmail}`).subscribe({
      next: (data) => {
        this.dashboardData = data;

        if (data.locationName) {
          this.availableSectors.push(data.locationName);
        }

        if (data.readings && data.readings.length > 0) {
          const uniqueTypes = new Set(data.readings.map((r: any) => r.type));
          this.availableTypes = [...this.availableTypes, ...Array.from(uniqueTypes)] as string[];
        }
      },
      error: (err) => console.error('Error cargando datos para reportes', err)
    });
  }

  quickDownload(type: string) {
    const data = this.dashboardData?.readings;
    if (!data) return alert('No hay datos cargados para exportar.');

    if (type === 'Datos Excel') {
      this.exportToExcel(data, 'Exportacion_Completa');
    } else if (type === 'Log CSV') {
      const alertData = data.filter((r: any) => r.statusClass !== 'normal');
      this.exportToCSV(alertData.length > 0 ? alertData : data, 'Log_Alertas');
    } else if (type === 'Resumen PDF') {
      this.exportToPDF(data, 'Resumen_Ejecutivo');
    }
  }

  generateCustomReport() {
    this.filterError = '';

    if (!this.dashboardData || !this.dashboardData.readings) {
      this.filterError = 'No hay datos en la base de datos para filtrar.';
      return;
    }

    if ((this.startDate && !this.endDate) || (!this.startDate && this.endDate)) {
      this.filterError = 'Selecciona tanto la fecha de inicio como la fecha de fin.';
      return;
    }

    if (this.startDate && this.endDate && this.startDate > this.endDate) {
      this.filterError = 'La fecha de inicio no puede ser mayor que la fecha de fin.';
      return;
    }

    this.isGenerating = true;

    setTimeout(() => {
      let filteredData = this.dashboardData.readings;

      if (this.selectedType !== 'Todas las variables') {
        filteredData = filteredData.filter((r: any) => r.type === this.selectedType);
      }

      if (this.startDate && this.endDate) {
        const startMs = new Date(`${this.startDate}T00:00:00`).getTime();
        const endMs   = new Date(`${this.endDate}T23:59:59`).getTime();

        filteredData = filteredData.filter((r: any) => {
          // Prefer isoDate (added by backend v2) for accurate date filtering
          const iso = r.isoDate || r.timestamp;
          const ms  = new Date(iso).getTime();
          if (isNaN(ms)) return false;
          return ms >= startMs && ms <= endMs;
        });
      }

      this.isGenerating = false;

      if (filteredData.length === 0) {
        this.filterError = this.startDate
          ? `Sin datos entre ${this.startDate} y ${this.endDate} para los filtros seleccionados.`
          : 'Sin datos para los filtros seleccionados.';
        return;
      }

      if (this.exportFormat === 'pdf') {
        this.exportToPDF(filteredData, 'Reporte_Personalizado');
      } else if (this.exportFormat === 'csv') {
        this.exportToCSV(filteredData, 'Reporte_Personalizado');
      } else {
        this.exportToExcel(filteredData, 'Reporte_Personalizado');
      }
    }, 800);
  }



  exportToExcel(dataToExport: any[], fileNamePrefix: string) {
    const excelData = this.formatDataForExport(dataToExport);
    const worksheet: XLSX.WorkSheet = XLSX.utils.json_to_sheet(excelData);
    const workbook: XLSX.WorkBook = { Sheets: { 'Datos': worksheet }, SheetNames: ['Datos'] };
    const finalName = `${fileNamePrefix}_${new Date().getTime()}.xlsx`;

    XLSX.writeFile(workbook, finalName);
    this.addReportToHistory(finalName, 'Excel', excelData.length);
  }

  exportToCSV(dataToExport: any[], fileNamePrefix: string) {
    const csvData = this.formatDataForExport(dataToExport);
    const worksheet: XLSX.WorkSheet = XLSX.utils.json_to_sheet(csvData);
    const finalName = `${fileNamePrefix}_${new Date().getTime()}.csv`;
    const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = finalName;
    link.click();
    this.addReportToHistory(finalName, 'CSV', csvData.length);
  }

  exportToPDF(dataToExport: any[], fileNamePrefix: string) {
    const doc = new jsPDF();
    const finalName = `${fileNamePrefix}_${new Date().getTime()}.pdf`;

    doc.setFontSize(18);
    doc.text('ParamoSense - Reporte de Monitoreo Hídrico', 14, 20);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Fecha de generación: ${new Date().toLocaleString('es-CO')}`, 14, 28);
    doc.text(`Usuario: ${this.dashboardData?.userName || 'Administrador'}`, 14, 34);

    const bodyData = dataToExport.map((r: any) => [
      r.isoDate ? new Date(r.isoDate).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : r.timestamp,
      r.sensorId, r.type, `${r.value} ${r.unit}`, r.status
    ]);

    autoTable(doc, {
      head: [['Hora/Fecha', 'ID Sensor', 'Variable', 'Valor', 'Estado']],
      body: bodyData,
      startY: 40,
      theme: 'striped',
      headStyles: { fillColor: [13, 148, 136] },
      styles: { fontSize: 9 }
    });

    doc.save(finalName);
    this.addReportToHistory(finalName, 'PDF', bodyData.length);
  }

  private formatDataForExport(data: any[]) {
    return data.map((r: any) => ({
      'Fecha / Hora': r.isoDate
        ? new Date(r.isoDate).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
        : r.timestamp,
      'Sensor ID': r.sensorId,
      'Tipo': r.type,
      'Valor': r.value,
      'Unidad': r.unit,
      'Estado': r.status
    }));
  }

  private addReportToHistory(name: string, type: string, rowsCount: number) {
    let sizeCalc = 0;
    if (type === 'Excel') sizeCalc = rowsCount * 0.12;
    if (type === 'CSV') sizeCalc = rowsCount * 0.05;
    if (type === 'PDF') sizeCalc = (rowsCount * 0.15) + 12.5;

    const fileSize = sizeCalc > 1024 ? `${(sizeCalc / 1024).toFixed(2)} MB` : `${sizeCalc.toFixed(1)} KB`;

    this.recentReports.unshift({
      name: name,
      date: new Date().toLocaleDateString('es-CO'),
      type: type,
      size: fileSize
    });
  }
}
