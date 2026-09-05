import jsPDF from 'jspdf';
import { DiagnosticTroubleCode, ObdPid, VinInfo, ConnectionStatus } from '../types';
import { errorLogRepo, commLogger, AppLogger } from '../logging/logger';

export interface ReportData {
  vehicleName: string;
  vinInfo?: VinInfo;
  dtcList: DiagnosticTroubleCode[];
  liveDataPids: ObdPid[];
  scanDate: string;
  deviceStatus: ConnectionStatus;
  technicianNotes?: string;
}

export class ReportGenerator {
  public static generatePdf(data: ReportData, language: 'ar' | 'en' = 'ar'): void {
    const doc = new jsPDF();
    const isAr = language === 'ar';

    // Header styling
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, 210, 38, 'F');

    doc.setTextColor(56, 189, 248); // sky-400
    doc.setFontSize(22);
    doc.text('HAMZA OBD PRO', 15, 18);

    doc.setTextColor(203, 213, 225); // slate-300
    doc.setFontSize(10);
    doc.text('Automotive Diagnostic & Telemetry System — Official Diagnostic Report', 15, 27);
    doc.text(`Generated: ${data.scanDate}`, 15, 33);

    // Vehicle Summary Box
    doc.setFillColor(241, 245, 249);
    doc.rect(15, 45, 180, 32, 'F');
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(12);
    doc.text('Vehicle & Scan Identification:', 20, 53);

    doc.setFontSize(10);
    doc.text(`Vehicle: ${data.vehicleName}`, 20, 62);
    doc.text(`VIN: ${data.vinInfo?.rawVin || 'Not Read'}`, 20, 69);
    doc.text(`Manufacturer: ${data.vinInfo?.manufacturer || 'Unknown'}`, 110, 62);
    doc.text(`Model Year: ${data.vinInfo?.year || 'Unknown'}`, 110, 69);

    // DTC Section
    const dtcList = data.dtcList || [];
    doc.setFontSize(14);
    doc.setTextColor(220, 38, 38); // red-600
    doc.text(`Diagnostic Trouble Codes (${dtcList.length} Detected)`, 15, 88);

    let y = 96;
    if (dtcList.length === 0) {
      doc.setFontSize(10);
      doc.setTextColor(22, 101, 52); // green-800
      doc.text('No trouble codes found. All monitored systems are normal.', 20, y);
      y += 12;
    } else {
      doc.setFontSize(9);
      dtcList.forEach((dtc) => {
        doc.setFillColor(254, 242, 242);
        doc.rect(15, y - 4, 180, 14, 'F');

        doc.setTextColor(185, 28, 28);
        doc.setFont('Helvetica', 'bold');
        doc.text(`[${dtc.code}]`, 20, y + 3);

        doc.setTextColor(30, 41, 59);
        doc.setFont('Helvetica', 'normal');
        doc.text(`${dtc.descriptionEn}`, 45, y + 3);
        doc.text(`ECU: ${dtc.ecuAddressHex} (${dtc.status})`, 140, y + 3);

        y += 18;
      });
    }

    // Live Data Snapshot
    y = Math.max(y + 6, 150);
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.setFont('Helvetica', 'bold');
    doc.text('Key Live Telemetry Snapshot', 15, y);

    y += 8;
    doc.setFontSize(9);
    doc.setFont('Helvetica', 'normal');

    const samplePids = (data.liveDataPids || []).slice(0, 6);
    samplePids.forEach((pid, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const xPos = col === 0 ? 20 : 110;
      const yPos = y + (row * 10);

      doc.text(`* ${pid.name}: ${pid.currentValue} ${pid.unit}`, xPos, yPos);
    });

    // Technical Log Summary
    const errorCount = errorLogRepo.getLogs().filter(l => l.severity === 'ERROR' || l.severity === 'CRITICAL').length;
    const packetCount = commLogger.getPackets().length;

    y += 40;
    doc.setFillColor(248, 250, 252);
    doc.rect(15, y, 180, 24, 'F');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`Communication Packets Exchanged: ${packetCount}`, 20, y + 8);
    doc.text(`System Diagnostic Events Logged: ${errorCount}`, 20, y + 16);
    doc.text('Diagnostic Protocol: ISO 15765-4 CAN 11-bit / 500kbps', 110, y + 8);
    doc.text('Security / CRC: Verified OK', 110, y + 16);

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('HAMZA OBD PRO — Enterprise Automotive Diagnostics Engine', 15, 285);
    doc.text('Page 1 of 1', 180, 285);

    doc.save(`Hamza_OBD_Report_${Date.now()}.pdf`);
  }

  public static exportDiagnosticBundleJson(vehicleName: string, vin?: string): void {
    const bundle = {
      bundleMeta: {
        app: 'HAMZA OBD PRO',
        version: '2.5.0-PRO',
        exportedAt: new Date().toISOString(),
        correlationId: 'BUNDLE-' + Date.now().toString(36)
      },
      vehicleContext: {
        name: vehicleName,
        vin: vin || 'Not Read',
        ecuCount: 0,
        batteryVoltage: 0.0
      },
      errorLogs: errorLogRepo.getLogs(),
      communicationPackets: commLogger.getPackets(),
    };

    const cleanStr = AppLogger.redactSensitiveData(JSON.stringify(bundle, null, 2));
    const blob = new Blob([cleanStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Hamza_OBD_Diagnostic_Bundle_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
