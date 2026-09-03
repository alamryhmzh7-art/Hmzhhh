import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { DiagnosticTroubleCode, ObdPid, VinInfo, ConnectionStatus } from '../types';
import { standardPids } from '../obd/pidDecoder';
import { ReportGenerator } from '../reports/reportGenerator';
import { useAuth } from '../services/AuthContext';
import { 
  FileText, 
  Download, 
  Printer, 
  CheckCircle2, 
  Car, 
  AlertTriangle, 
  ShieldCheck, 
  Calendar,
  User,
  Wrench
} from 'lucide-react';

interface ReportsViewProps {
  status: ConnectionStatus;
  vinInfo: VinInfo;
  dtcList: DiagnosticTroubleCode[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({ status, vinInfo, dtcList }) => {
  const { t, isRtl, language } = useI18n();
  const { user, diagnosticHistory } = useAuth();
  const [techName, setTechName] = useState<string>('Hamza Diagnostic Specialist');
  const [shopName, setShopName] = useState<string>('Hamza Pro Auto Workshop');
  const [notes, setNotes] = useState<string>('Routine vehicle diagnostic scan completed. Systems evaluated.');

  const handleGeneratePdf = () => {
    ReportGenerator.generatePdf({
      vehicleName: vinInfo.isValid ? `${vinInfo.manufacturer} ${vinInfo.model}` : 'Toyota Camry (2022)',
      vinInfo,
      dtcList,
      liveDataPids: standardPids,
      scanDate: new Date().toLocaleString(),
      deviceStatus: status,
      technicianNotes: notes
    }, language);
  };

  const handleExportJson = () => {
    ReportGenerator.exportDiagnosticBundleJson(
      vinInfo.isValid ? `${vinInfo.manufacturer} ${vinInfo.model}` : 'Toyota Camry (2022)',
      vinInfo.rawVin
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-400" />
            <h2 className="text-lg font-bold text-white">
              {t('reportsTitle')}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-950 text-blue-400 border border-blue-800 font-mono font-bold">
              PDF & JSON Diagnostic Export
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Generate Official Vehicle Inspection Certificates with DTC status, Telemetry, and Technical audit
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleGeneratePdf}
            className="px-5 py-2.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2 transition-all shadow-md shadow-blue-950/50"
          >
            <Download className="h-4 w-4" />
            <span>{t('btnExportPdf')}</span>
          </button>

          <button
            onClick={handleExportJson}
            className="px-4 py-2.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 flex items-center gap-2 transition-colors"
          >
            <Download className="h-4 w-4" />
            <span>{t('btnExportJson')}</span>
          </button>
        </div>
      </div>

      {/* Report Customization Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          Diagnostic Certificate Metadata
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-400 block mb-1">
              Workshop / Service Center Name
            </label>
            <input
              type="text"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 block mb-1">
              Diagnostic Specialist / Technician
            </label>
            <input
              type="text"
              value={techName}
              onChange={(e) => setTechName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-400 block mb-1">
            Technician Diagnostic Notes & Recommendations
          </label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Report Document Sheet Preview */}
      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 sm:p-8 max-w-4xl mx-auto shadow-2xl space-y-6">
        {/* Document Header */}
        <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-5 gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xl text-white font-['Chakra_Petch',sans-serif]">
                HAMZA <span className="text-cyan-400">OBD PRO</span>
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800 font-mono font-bold">
                OFFICIAL REPORT
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">{shopName}</p>
            <p className="text-[11px] text-slate-500">Inspected by: {techName}</p>
          </div>

          <div className="text-right text-xs font-mono text-slate-400">
            <div>Date: {new Date().toLocaleDateString()}</div>
            <div>Time: {new Date().toLocaleTimeString()}</div>
            <div className="text-cyan-400">ISO 15765-4 500k CAN</div>
          </div>
        </div>

        {/* Vehicle Identity Box */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
          <div>
            <span className="text-slate-500 block text-[10px]">VEHICLE</span>
            <span className="text-white font-bold">{vinInfo.isValid ? `${vinInfo.manufacturer} ${vinInfo.model}` : 'Toyota Camry'}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">VIN NUMBER</span>
            <span className="text-cyan-400 font-bold">{vinInfo.rawVin || '4T1BF1FK5NU123456'}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">MODEL YEAR</span>
            <span className="text-slate-200 font-bold">{vinInfo.year || '2022'}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">COUNTRY</span>
            <span className="text-slate-200 font-bold">{vinInfo.country || 'USA'}</span>
          </div>
        </div>

        {/* Trouble Codes Table in Sheet */}
        <div>
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
            Diagnostic Trouble Code Findings ({dtcList.length} Active)
          </h4>

          {dtcList.length === 0 ? (
            <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-4 text-center text-xs text-emerald-400 font-medium">
              No DTC Faults Detected. Monitored electronic control units passed full OBD-II readiness tests.
            </div>
          ) : (
            <div className="space-y-2">
              {dtcList.map(dtc => (
                <div key={dtc.code} className="bg-slate-900/80 border border-slate-800 p-3 rounded-lg flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-extrabold text-rose-400 text-sm">[{dtc.code}]</span>
                    <span className="font-bold text-slate-200">{isRtl ? dtc.descriptionAr : dtc.descriptionEn}</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">{dtc.ecuAddressHex}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Telemetry Snapshot in Sheet */}
        <div>
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
            Diagnostic Sensor Telemetry Snapshot
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
            {standardPids.slice(0, 4).map(pid => (
              <div key={pid.id} className="bg-slate-900/60 border border-slate-800 p-2.5 rounded-lg">
                <span className="text-slate-500 block text-[10px]">{pid.name}</span>
                <span className="text-white font-bold">{pid.currentValue} {pid.unit}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        {notes && (
          <div className="pt-4 border-t border-slate-800 text-xs text-slate-400">
            <strong className="text-slate-300 block mb-1">Technician Remarks:</strong>
            <p className="bg-slate-900 p-3 rounded-lg border border-slate-800">{notes}</p>
          </div>
        )}
      </div>

      {/* Cloud-Saved Diagnostic History Logs (Firebase Integration) */}
      {user && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-cyan-400" />
              <span>{isRtl ? 'سجل تشخيصات السحابة الآمن' : 'Secure Cloud Diagnostic Logs'}</span>
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800 font-mono font-bold">
              {diagnosticHistory.length} {isRtl ? 'سجلات' : 'records'}
            </span>
          </div>

          {diagnosticHistory.length === 0 ? (
            <p className="text-xs text-slate-500 italic">
              {isRtl ? 'لا توجد سجلات تشخيصية سحابية حالياً. ابدأ بفحص المحرك (DTC) لحفظ أول سجل تلقائياً.' : 'No cloud diagnostic records found. Run a DTC scan to automatically save your session.'}
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
              {diagnosticHistory.map(report => (
                <div key={report.id} className="bg-slate-950 border border-slate-800 p-4 rounded-lg space-y-2 relative group hover:border-cyan-500/50 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-sm">
                      {report.manufacturer} {report.model}
                    </span>
                    <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400 border border-slate-700">
                      {report.year}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400">
                    <div>
                      <span className="block text-slate-500 text-[8px] uppercase">{isRtl ? 'رقم الهيكل' : 'VIN'}</span>
                      <span className="text-cyan-400 font-bold">{report.rawVin}</span>
                    </div>
                    <div>
                      <span className="block text-slate-500 text-[8px] uppercase">{isRtl ? 'البطارية' : 'Battery'}</span>
                      <span>{report.batteryVoltage?.toFixed(2)} V</span>
                    </div>
                    <div>
                      <span className="block text-slate-500 text-[8px] uppercase">{isRtl ? 'الحالة' : 'Status'}</span>
                      <span className="text-emerald-400 font-bold">{report.status}</span>
                    </div>
                    <div>
                      <span className="block text-slate-500 text-[8px] uppercase">{isRtl ? 'التاريخ' : 'Date'}</span>
                      <span>
                        {report.timestamp?.seconds 
                          ? new Date(report.timestamp.seconds * 1000).toLocaleDateString()
                          : new Date(report.timestamp || Date.now()).toLocaleDateString()
                        }
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-900">
                    <span className="block text-slate-500 text-[8px] uppercase mb-1">{isRtl ? 'أكواد الأعطال' : 'DTC Faults'}</span>
                    <div className="flex flex-wrap gap-1">
                      {report.dtcCodes && report.dtcCodes.length > 0 ? (
                        report.dtcCodes.map(code => (
                          <span key={code} className="px-1.5 py-0.5 rounded bg-rose-950/40 border border-rose-900/60 text-rose-400 font-bold text-[9px]">
                            {code}
                          </span>
                        ))
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-950/40 border border-emerald-900/60 text-emerald-400 text-[9px]">
                          {isRtl ? 'سليم' : 'Healthy'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
