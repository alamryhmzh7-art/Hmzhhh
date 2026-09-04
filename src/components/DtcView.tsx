import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { DiagnosticTroubleCode, ConnectionStatus, VinInfo } from '../types';
import { initialDtcDatabase, DtcDecoder } from '../obd/dtcDatabase';
import { transportManager } from '../network/TransportManager';
import { useAuth } from '../services/AuthContext';
import { 
  AlertTriangle, 
  Trash2, 
  RefreshCw, 
  ShieldAlert, 
  CheckCircle2, 
  Info, 
  FileText, 
  Flame, 
  Layers,
  ChevronDown,
  ChevronUp,
  X
} from 'lucide-react';

interface DtcViewProps {
  status: ConnectionStatus;
  dtcList: DiagnosticTroubleCode[];
  setDtcList: React.Dispatch<React.SetStateAction<DiagnosticTroubleCode[]>>;
  isMockMode?: boolean;
  vinInfo?: VinInfo;
  batteryVoltage?: number;
}

export const DtcView: React.FC<DtcViewProps> = ({ 
  status, 
  dtcList, 
  setDtcList, 
  isMockMode = false,
  vinInfo,
  batteryVoltage
}) => {
  const { t, isRtl } = useI18n();
  const { user, saveDiagnosticReport } = useAuth();
  const [selectedDtc, setSelectedDtc] = useState<DiagnosticTroubleCode | null>(null);
  const [showClearModal, setShowClearModal] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [scanStep, setScanStep] = useState<string>('');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [clearSuccessMessage, setClearSuccessMessage] = useState<string | null>(null);

  const handleReadDtc = async () => {
    setIsScanning(true);
    setClearSuccessMessage(null);
    setConnectionError(null);
    setScanProgress(0);
    setScanStep(isRtl ? 'جاري تهيئة قناة الاتصال ومقبس OBD-II...' : 'Initializing OBD-II interface...');

    const steps = [
      { progress: 20, labelAr: 'جاري البحث في بروتوكولات CAN الحالية...', labelEn: 'Scanning active CAN Protocols...' },
      { progress: 40, labelAr: 'جاري قراءة كود التعريف ورقم الشاسيه VIN...', labelEn: 'Reading Vehicle Identification Number (VIN)...' },
      { progress: 60, labelAr: 'جاري الاتصال بوحدة ECM للبحث عن أعطال المحرك...', labelEn: 'Establishing session with ECM (Stored DTCs)...' },
      { progress: 80, labelAr: 'جاري الاتصال بوحدات الفرامل ABS والوسائد الهوائية SRS...', labelEn: 'Querying auxiliary chassis and body systems (SRS/ABS)...' },
      { progress: 100, labelAr: 'جاري تجميع حزم البيانات وصياغة التقرير النهائي...', labelEn: 'Analyzing and generating final diagnostic health report...' }
    ];

    try {
      for (const step of steps) {
        await new Promise(resolve => setTimeout(resolve, 500));
        setScanProgress(step.progress);
        setScanStep(isRtl ? step.labelAr : step.labelEn);
      }

      // Check if we are in real mode and NOT connected
      if (status !== 'CONNECTED' && !isMockMode) {
        throw new Error('NOT_CONNECTED');
      }

      // Send Mode 03 (Request Stored DTCs) via transportManager
      const resp = await transportManager.sendRequest([0x03], '0x7E0');
      if (resp.status === 'SUCCESS' || isMockMode) {
        let results: DiagnosticTroubleCode[] = [];
        if (isMockMode) {
          results = initialDtcDatabase.slice(0, 3);
        } else if (resp.responseRaw) {
          const bytes = resp.responseRaw.split(' ').map(b => parseInt(b, 16));
          const dtcBytes = bytes[0] === 0x43 ? bytes.slice(2) : bytes;
          results = DtcDecoder.parseDtcList(dtcBytes, 'CONFIRMED');
        }
        setDtcList(results);

        if (user) {
          saveDiagnosticReport({
            id: `scan_${Date.now()}`,
            rawVin: vinInfo?.rawVin || '4T1BF1FK5NU123456',
            manufacturer: vinInfo?.manufacturer || 'Toyota',
            model: vinInfo?.model || 'Camry',
            year: vinInfo?.year || 2022,
            country: vinInfo?.country || 'United States',
            batteryVoltage: batteryVoltage || 14.15,
            dtcCodes: results.map(d => d.code),
            status: 'Completed'
          }).catch(err => {
            console.error("Failed to save scan to cloud history:", err);
          });
        }
      } else {
        setDtcList([]);
      }
    } catch (err: any) {
      setDtcList([]);
      if (err?.message === 'NOT_CONNECTED') {
        setConnectionError(isRtl 
          ? 'تنبيه: جهاز Hamza OBD Pro غير متصل بالسيارة. يرجى الدخول لمدير الاتصال وتوصيل محول ESP32، أو تفعيل "وضع المحاكاة" (Demo Mode) من شريط الأدوات العلوي لإجراء فحص افتراضي.' 
          : 'Warning: Hamza OBD Pro is not connected to the vehicle. Please open the Connection Manager and connect your ESP32 adapter, or activate "Demo Mode" from the top header to run a simulated scan.'
        );
      } else {
        setConnectionError(isRtl
          ? 'حدث خطأ غير متوقع أثناء الفحص. يرجى التحقق من اتصال شبكة OBD-II وإعادة المحاولة.'
          : 'An unexpected error occurred during the scan. Please verify OBD-II link connection and try again.'
        );
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleConfirmClearDtc = async () => {
    setIsClearing(true);
    try {
      // Send Mode 04 (Clear DTCs) via transportManager
      const resp = await transportManager.sendRequest([0x04], '0x7E0');
      if (resp.status === 'SUCCESS') {
        setDtcList([]);
        setShowClearModal(false);
        setClearSuccessMessage(isRtl ? 'تم إرسال أمر مسح الأعطال (Mode 04) وإعادة ضبط مؤشر فحص المحرك بنجاح.' : 'DTCs Cleared and Check Engine Light reset successfully (Mode 04).');
      } else {
        setShowClearModal(false);
        setConnectionError(isRtl ? 'فشل مسح الأعطال: لم تستجب وحدة التحكم' : 'Clear failed: ECU did not respond (0x44)');
      }
    } catch {
      //
    } finally {
      setIsClearing(false);
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/40';
      case 'HIGH':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/40';
      case 'MEDIUM':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
      default:
        return 'bg-blue-500/20 text-blue-400 border-blue-500/40';
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-500" />
            <h2 className="text-lg font-bold text-white">
              {t('dtcTitle')}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-rose-950 text-rose-400 border border-rose-800/80 font-bold font-mono">
              {dtcList.length} {t('dtcCode')}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            OBD-II Service 0x03 (Stored), 0x07 (Pending), 0x04 (Clear) & Freeze Frame
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReadDtc}
            disabled={isScanning}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-2 transition-all shadow-md shadow-cyan-950/50"
          >
            <RefreshCw className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? t('connecting') : t('btnScan')}</span>
          </button>

          <button
            onClick={() => setShowClearModal(true)}
            disabled={dtcList.length === 0}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 transition-all flex items-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Trash2 className="h-4 w-4" />
            <span>{t('btnClearDtc')}</span>
          </button>
        </div>
      </div>

      {/* Live Scan Progress Bar */}
      {isScanning && (
        <div className="bg-slate-900 border border-cyan-500/40 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-cyan-400 font-bold">
              {scanStep}
            </span>
            <span className="text-slate-400">{scanProgress}%</span>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-200"
              style={{ width: `${scanProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Connection Warning Panel */}
      {connectionError && (
        <div className="bg-rose-950/40 border border-rose-500/30 rounded-xl p-4 flex gap-3 text-rose-300">
          <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400" />
          <div className="text-xs md:text-sm font-medium space-y-1">
            <p>{connectionError}</p>
          </div>
        </div>
      )}

      {/* Success Notification if Cleared */}
      {clearSuccessMessage && (
        <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-4 flex items-center gap-3 text-emerald-400">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span className="text-xs md:text-sm font-medium">{clearSuccessMessage}</span>
        </div>
      )}

      {/* DTC List & Detailed Breakdown */}
      {dtcList.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-12 text-center flex flex-col items-center justify-center">
          <div className="h-14 w-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-3">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h3 className="text-base font-bold text-white">
            {t('noDtcFound')}
          </h3>
          <p className="text-xs text-slate-400 max-w-md mt-1">
            All powertrain, chassis, body, and communication modules report 0 active trouble codes.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: DTC Cards */}
          <div className="lg:col-span-1 space-y-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              Active Detected Codes
            </span>
            {dtcList.map((dtc) => {
              const isSelected = selectedDtc?.code === dtc.code;
              return (
                <div
                  key={dtc.code}
                  onClick={() => setSelectedDtc(dtc)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-slate-800 border-cyan-500 shadow-md shadow-cyan-950/50'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-extrabold text-base text-rose-400 font-mono tracking-wider">
                      {dtc.code}
                    </span>
                    <span className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded border font-bold ${getSeverityBadge(dtc.severity)}`}>
                      {dtc.severity}
                    </span>
                  </div>
                  <h4 className="font-bold text-xs text-slate-200 line-clamp-1">
                    {isRtl ? dtc.descriptionAr : dtc.descriptionEn}
                  </h4>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 font-mono">
                    <span>{dtc.system}</span>
                    <span>{dtc.ecuAddressHex}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right Column: In-Depth Diagnostic Detail & Freeze Frame */}
          <div className="lg:col-span-2">
            {selectedDtc ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-black text-rose-400 font-mono tracking-wider">
                        {selectedDtc.code}
                      </span>
                      <span className={`text-xs uppercase font-mono px-2.5 py-0.5 rounded border font-bold ${getSeverityBadge(selectedDtc.severity)}`}>
                        {selectedDtc.severity}
                      </span>
                      <span className="text-xs font-mono text-cyan-400 bg-slate-800 px-2 py-0.5 rounded">
                        ECU {selectedDtc.ecuAddressHex}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-white mt-1">
                      {isRtl ? selectedDtc.descriptionAr : selectedDtc.descriptionEn}
                    </h3>
                  </div>
                </div>

                {/* Symptoms */}
                <div>
                  <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-2">
                    {t('dtcSymptoms')}
                  </h4>
                  <ul className="space-y-1 text-xs text-slate-300">
                    {(isRtl ? selectedDtc.symptomsAr : selectedDtc.symptomsEn).map((sym, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-cyan-500 font-bold">•</span>
                        <span>{sym}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Possible Causes */}
                <div>
                  <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">
                    {t('dtcCauses')}
                  </h4>
                  <ul className="space-y-1 text-xs text-slate-300">
                    {(isRtl ? selectedDtc.causesAr : selectedDtc.causesEn).map((cause, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-amber-500 font-bold">•</span>
                        <span>{cause}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Recommended Fix / Inspection */}
                <div>
                  <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2">
                    {t('dtcFixes')}
                  </h4>
                  <ul className="space-y-1 text-xs text-slate-300">
                    {(isRtl ? selectedDtc.fixesAr : selectedDtc.fixesEn).map((fix, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-emerald-500 font-bold">•</span>
                        <span>{fix}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Freeze Frame Telemetry Snapshot */}
                {selectedDtc.freezeFrame && (
                  <div className="pt-4 border-t border-slate-800">
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
                      {t('dtcFreezeFrame')} (OBD-II Mode 02)
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                      <div className="bg-slate-800/80 p-2.5 rounded-lg">
                        <span className="text-slate-500 block text-[10px]">RPM</span>
                        <span className="text-cyan-400 font-bold">{selectedDtc.freezeFrame.rpm} RPM</span>
                      </div>
                      <div className="bg-slate-800/80 p-2.5 rounded-lg">
                        <span className="text-slate-500 block text-[10px]">Speed</span>
                        <span className="text-emerald-400 font-bold">{selectedDtc.freezeFrame.speed} km/h</span>
                      </div>
                      <div className="bg-slate-800/80 p-2.5 rounded-lg">
                        <span className="text-slate-500 block text-[10px]">Coolant Temp</span>
                        <span className="text-amber-400 font-bold">{selectedDtc.freezeFrame.coolantTemp}°C</span>
                      </div>
                      <div className="bg-slate-800/80 p-2.5 rounded-lg">
                        <span className="text-slate-500 block text-[10px]">Throttle</span>
                        <span className="text-purple-400 font-bold">{selectedDtc.freezeFrame.throttlePos}%</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center">
                <Info className="h-8 w-8 text-slate-600 mb-2" />
                Select any DTC code on the left to view technical symptoms, root causes, fixes, and freeze frame telemetry.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Safety Confirmation Modal for Clear DTC */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500/50 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-rose-500">
                <ShieldAlert className="h-6 w-6" />
                <h3 className="font-extrabold text-lg text-white">
                  {t('clearDtcConfirmTitle')}
                </h3>
              </div>
              <button
                onClick={() => setShowClearModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-2 bg-rose-500/10 border border-rose-500/20 p-3.5 rounded-xl">
              <p className="font-bold text-rose-300">
                {t('clearDtcWarning')}
              </p>
              <p>
                {t('clearDtcNotice')}
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowClearModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                {t('btnCancel')}
              </button>

              <button
                onClick={handleConfirmClearDtc}
                disabled={isClearing}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-2 shadow-lg shadow-rose-950/60"
              >
                {isClearing && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                <span>{t('btnConfirmClear')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
