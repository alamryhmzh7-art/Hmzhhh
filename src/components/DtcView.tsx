import React, { useState, useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { DiagnosticTroubleCode, ConnectionStatus, VinInfo } from '../types';
import { initialDtcDatabase, DtcDecoder } from '../obd/dtcDatabase';
import { DtcCacheService, DtcCacheEntry } from '../obd/dtcCacheService';
import { transportManager } from '../network/TransportManager';
import { AppLogger } from '../logging/logger';
import { useAuth } from '../services/AuthContext';
import { 
  AlertTriangle, 
  Trash2, 
  RefreshCw, 
  ShieldAlert, 
  CheckCircle2, 
  Info, 
  Search, 
  Database,
  HardDrive,
  Download,
  RotateCcw,
  Plus,
  WifiOff,
  Copy,
  Check,
  X,
  Filter,
  BookOpen
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

  // Mode tab: 'LIVE' (connected / active scan) vs 'CACHE' (offline dictionary)
  const [activeTab, setActiveTab] = useState<'LIVE' | 'CACHE'>('LIVE');

  // Live Scan state
  const [selectedDtc, setSelectedDtc] = useState<DiagnosticTroubleCode | null>(null);
  const [showClearModal, setShowClearModal] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [scanStep, setScanStep] = useState<string>('');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [clearSuccessMessage, setClearSuccessMessage] = useState<string | null>(null);
  const [cacheNotification, setCacheNotification] = useState<string | null>(null);

  // Local Storage Cache State
  const [cachedDtcs, setCachedDtcs] = useState<DtcCacheEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSystemFilter, setSelectedSystemFilter] = useState<string>('ALL');
  const [selectedCachedItem, setSelectedCachedItem] = useState<DtcCacheEntry | null>(null);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  // Add Custom DTC Modal state
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newCode, setNewCode] = useState<string>('');
  const [newDescEn, setNewDescEn] = useState<string>('');
  const [newDescAr, setNewDescAr] = useState<string>('');
  const [newSystem, setNewSystem] = useState<string>('POWERTRAIN');
  const [newSeverity, setNewSeverity] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('MEDIUM');
  const [newSymptomsAr, setNewSymptomsAr] = useState<string>('');
  const [newCausesAr, setNewCausesAr] = useState<string>('');
  const [newFixesAr, setNewFixesAr] = useState<string>('');

  // Load DTC Cache on mount
  useEffect(() => {
    const cache = DtcCacheService.getCachedDtcList();
    setCachedDtcs(cache);
    if (cache.length > 0) {
      setSelectedCachedItem(cache[0]);
    }
  }, []);

  const handleReadDtc = async () => {
    setIsScanning(true);
    setClearSuccessMessage(null);
    setConnectionError(null);
    setCacheNotification(null);
    setScanProgress(0);
    setScanStep(isRtl ? 'جاري تهيئة قناة الاتصال ومقبس OBD-II...' : 'Initializing OBD-II interface...');

    try {
      if (!transportManager.isConnected() && !isMockMode) {
        await transportManager.connect({ isMockMode: true });
      }

      setScanStep(isRtl ? 'جاري طلب أكواد الأعطال المخزنة والمعلقة (Mode 03 & 07 & 0A)...' : 'Querying Stored, Pending & Permanent DTCs (Mode 03, 07, 0A)...');
      setScanProgress(30);

      if (isMockMode) {
        await new Promise(r => setTimeout(r, 800));
        const results = initialDtcDatabase.slice(0, 3);
        setDtcList(results);
        setScanProgress(100);

        // Cache scanned DTCs into local storage
        DtcCacheService.cacheScannedDtcs(results);
        const updatedCache = DtcCacheService.getCachedDtcList();
        setCachedDtcs(updatedCache);
        setCacheNotification(isRtl 
          ? 'تم حفظ رموز الأعطال المفحوصة في الذاكرة المحلية (LocalStorage) تلقائياً.' 
          : 'Scanned DTC definitions cached to Local Storage for offline viewing.'
        );
        return;
      }

      const allDtcResults: DiagnosticTroubleCode[] = [];

      // 1. Query Mode 03 (Stored DTCs)
      try {
        const resp03 = await transportManager.sendRequest([0x03], '0x7DF');
        if (resp03.status === 'SUCCESS' && resp03.responseRaw) {
          const bytes = resp03.responseRaw.split(' ').map(b => parseInt(b, 16));
          let dtcBytes: number[] = [];
          if (bytes[0] === 0x43) dtcBytes = bytes.slice(2);
          else dtcBytes = bytes;
          const dtcs = DtcDecoder.parseDtcList(dtcBytes, 'CONFIRMED');
          allDtcResults.push(...dtcs);
        }
      } catch (e) {
        console.warn('Mode 03 read warning:', e);
      }

      setScanProgress(60);

      // 2. Query Mode 07 (Pending DTCs)
      try {
        const resp07 = await transportManager.sendRequest([0x07], '0x7DF');
        if (resp07.status === 'SUCCESS' && resp07.responseRaw) {
          const bytes = resp07.responseRaw.split(' ').map(b => parseInt(b, 16));
          let dtcBytes: number[] = [];
          if (bytes[0] === 0x47) dtcBytes = bytes.slice(2);
          else dtcBytes = bytes;
          const dtcs = DtcDecoder.parseDtcList(dtcBytes, 'PENDING');
          dtcs.forEach(d => {
            if (!allDtcResults.some(existing => existing.code === d.code)) {
              allDtcResults.push(d);
            }
          });
        }
      } catch (e) {
        console.warn('Mode 07 read warning:', e);
      }

      setScanProgress(80);

      // 3. Query Mode 0A (Permanent DTCs)
      try {
        const resp0A = await transportManager.sendRequest([0x0A], '0x7DF');
        if (resp0A.status === 'SUCCESS' && resp0A.responseRaw) {
          const bytes = resp0A.responseRaw.split(' ').map(b => parseInt(b, 16));
          let dtcBytes: number[] = [];
          if (bytes[0] === 0x4A) dtcBytes = bytes.slice(2);
          else dtcBytes = bytes;
          const dtcs = DtcDecoder.parseDtcList(dtcBytes, 'PERMANENT');
          dtcs.forEach(d => {
            if (!allDtcResults.some(existing => existing.code === d.code)) {
              allDtcResults.push(d);
            }
          });
        }
      } catch (e) {
        console.warn('Mode 0A read warning:', e);
      }

      setScanProgress(100);
      setDtcList(allDtcResults);

      // Save scanned DTCs to LocalStorage cache for offline usage
      if (allDtcResults.length > 0) {
        DtcCacheService.cacheScannedDtcs(allDtcResults);
        const updatedCache = DtcCacheService.getCachedDtcList();
        setCachedDtcs(updatedCache);
        setCacheNotification(isRtl 
          ? 'تم حفظ وتحديث رموز الأعطال في الذاكرة المحلية (LocalStorage) تلقائياً.' 
          : 'Diagnostic codes saved to local storage for offline retrieval.'
        );
      }

      if (allDtcResults.length === 0) {
        setClearSuccessMessage(isRtl ? 'تم فحص جميع الأنظمة: لا توجد أكواد أعطال مسجلة في السيارة.' : 'All modes checked: No diagnostic trouble codes detected in ECU.');
      } else if (user) {
        saveDiagnosticReport({
          id: `scan_${Date.now()}`,
          rawVin: vinInfo?.rawVin || 'UNKNOWN_VIN',
          manufacturer: vinInfo?.manufacturer || 'Generic',
          model: vinInfo?.model || 'OBD-II Vehicle',
          year: vinInfo?.year || new Date().getFullYear(),
          country: vinInfo?.country || 'Unknown',
          batteryVoltage: batteryVoltage || 12.0,
          dtcCodes: allDtcResults.map(d => d.code),
          status: 'Completed'
        }).catch(err => {
          console.error("Failed to save scan to cloud history:", err);
        });
      }
    } catch (err: any) {
      setDtcList([]);
      const errMsgEn = err?.message || 'An error occurred during DTC scan. Check OBD-II link.';
      const errMsgAr = err?.message === 'NOT_CONNECTED' 
        ? 'تنبيه: جهاز Hamza OBD Pro غير متصل بالسيارة. يمكنك تصفح الأعطال المحفوظة محلياً.'
        : 'حدث خطأ أثناء فحص الأعطال. تحقق من اتصال مقبس OBD-II.';

      AppLogger.error('OBD', 'DTC_SCAN_FAIL', errMsgEn, errMsgAr, JSON.stringify(err), { error: err });

      if (err?.message === 'NOT_CONNECTED') {
        setConnectionError(isRtl 
          ? 'تنبيه: محول OBD غير متصل بالسيارة. يمكنك الانتقال إلى "قاموس الأعطال المحفوظ" لتصفح جميع الكودات والحلول بدون اتصال.' 
          : 'Notice: OBD device disconnected. Switch to "Offline DTC Dictionary" tab to view cached trouble code definitions.'
        );
      } else {
        setConnectionError(errMsgAr);
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleConfirmClearDtc = async () => {
    setIsClearing(true);
    setConnectionError(null);
    try {
      if (status !== 'CONNECTED' && !isMockMode) {
        throw new Error('NOT_CONNECTED');
      }

      if (isMockMode) {
        setDtcList([]);
        setShowClearModal(false);
        setClearSuccessMessage(isRtl ? 'تم مسح الأعطال في وضع المحاكاة بنجاح.' : 'DTCs cleared in Demo Mode.');
        return;
      }

      const resp = await transportManager.sendRequest([0x04], '0x7DF');
      const isPositive = resp.status === 'SUCCESS' && (
        !resp.responseRaw || 
        resp.responseRaw.includes('44') || 
        resp.responseRaw.startsWith('01 44')
      );

      if (isPositive) {
        setDtcList([]);
        setShowClearModal(false);
        setClearSuccessMessage(isRtl ? 'تم إرسال أمر مسح الأعطال (Mode 04) وتأكيد الاستجابة (0x44) بنجاح.' : 'DTCs Cleared and positive response (0x44) received from ECU (Mode 04).');
      } else {
        setShowClearModal(false);
        setConnectionError(isRtl ? 'فشل مسح الأعطال: لم تستجب وحدة التحكم أو رفضت الطلب (NRC)' : 'Clear failed: ECU rejected request or did not respond (NRC / Timeout)');
      }
    } catch (err: any) {
      setShowClearModal(false);
      setConnectionError(err?.message || (isRtl ? 'فشل الاتصال أثناء مسح الأعطال' : 'Communication failure during DTC clear'));
    } finally {
      setIsClearing(false);
    }
  };

  // Local Storage Cache Management Actions
  const handleResetCache = () => {
    const fresh = DtcCacheService.resetToDefaultCache();
    setCachedDtcs(fresh);
    if (fresh.length > 0) setSelectedCachedItem(fresh[0]);
    setCacheNotification(isRtl ? 'تم إعادة ضبط الذاكرة المحلية لقاعدة البيانات القياسية.' : 'Local Storage DTC cache reset to standard dictionary.');
  };

  const handleExportCache = () => {
    const jsonStr = DtcCacheService.exportCacheJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hamza_obd_dtc_cache_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveCustomCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim()) return;

    const entry: DtcCacheEntry = {
      code: newCode.trim().toUpperCase(),
      descriptionEn: newDescEn.trim() || 'Custom user defined DTC',
      descriptionAr: newDescAr.trim() || 'كود عطل مخصص ومحفوظ محلياً',
      system: newSystem,
      severity: newSeverity,
      symptomsEn: [newDescEn || 'Custom code symptom'],
      symptomsAr: newSymptomsAr.split('\n').filter(s => s.trim().length > 0),
      causesEn: ['Custom cause'],
      causesAr: newCausesAr.split('\n').filter(c => c.trim().length > 0),
      fixesEn: ['Custom repair procedure'],
      fixesAr: newFixesAr.split('\n').filter(f => f.trim().length > 0),
      source: 'CUSTOM'
    };

    const updated = DtcCacheService.addCustomDtc(entry);
    setCachedDtcs(updated);
    setSelectedCachedItem(entry);
    setShowAddModal(false);

    // Reset form
    setNewCode('');
    setNewDescEn('');
    setNewDescAr('');
    setNewSymptomsAr('');
    setNewCausesAr('');
    setNewFixesAr('');
    setCacheNotification(isRtl ? `تم حفظ الكود ${entry.code} بنجاح في الذاكرة المحلية.` : `Code ${entry.code} saved to Local Storage.`);
  };

  const handleCopyCachedDetail = (item: DtcCacheEntry) => {
    const text = `DTC: ${item.code}
System: ${item.system} (${item.severity})
English: ${item.descriptionEn}
Arabic: ${item.descriptionAr}
Symptoms: ${item.symptomsAr?.join(', ')}
Causes: ${item.causesAr?.join(', ')}
Fixes: ${item.fixesAr?.join(', ')}`;
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Filtered cached DTCs
  const filteredCachedDtcs = cachedDtcs.filter(item => {
    const query = searchQuery.trim().toLowerCase();
    const matchesQuery = !query || (
      item.code.toLowerCase().includes(query) ||
      item.descriptionEn.toLowerCase().includes(query) ||
      item.descriptionAr.includes(query) ||
      (item.symptomsAr && item.symptomsAr.some(s => s.includes(query))) ||
      (item.causesAr && item.causesAr.some(c => c.includes(query)))
    );

    const matchesSystem = selectedSystemFilter === 'ALL' || item.system.toUpperCase() === selectedSystemFilter;
    return matchesQuery && matchesSystem;
  });

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

  const getSourceBadge = (source?: string) => {
    switch (source) {
      case 'SCANNED':
        return <span className="text-[10px] bg-cyan-950 text-cyan-400 border border-cyan-800 px-1.5 py-0.5 rounded font-mono">{t('dtcSourceScanned')}</span>;
      case 'CUSTOM':
        return <span className="text-[10px] bg-purple-950 text-purple-400 border border-purple-800 px-1.5 py-0.5 rounded font-mono">{t('dtcSourceCustom')}</span>;
      default:
        return <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 px-1.5 py-0.5 rounded font-mono">{t('dtcSourceDefault')}</span>;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Navigation Mode Switcher: Live OBD Scan vs Offline LocalStorage Cache */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 w-full sm:w-auto">
          <button
            onClick={() => setActiveTab('LIVE')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-md text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'LIVE'
                ? 'bg-cyan-600 text-white shadow-md shadow-cyan-950/60'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <RefreshCw className="h-4 w-4" />
            <span>{t('dtcModeLive')}</span>
            {dtcList.length > 0 && (
              <span className="bg-rose-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-mono">
                {dtcList.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('CACHE')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-md text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'CACHE'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-950/60'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Database className="h-4 w-4 text-purple-300" />
            <span>{t('dtcModeCache')}</span>
            <span className="bg-purple-950 text-purple-300 border border-purple-800 text-[10px] px-2 py-0.5 rounded-full font-mono font-bold">
              {cachedDtcs.length}
            </span>
          </button>
        </div>

        {/* Status indicator badge */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-400">
          <HardDrive className="h-4 w-4 text-emerald-400" />
          <span>{t('dtcOfflineBadge')}: <strong className="text-white">{cachedDtcs.length} {isRtl ? 'كود' : 'Codes'}</strong></span>
        </div>
      </div>

      {/* Cache Notification Toast */}
      {cacheNotification && (
        <div className="bg-purple-950/50 border border-purple-500/40 rounded-xl p-3.5 flex items-center justify-between gap-3 text-purple-200 text-xs font-medium">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-purple-400 shrink-0" />
            <span>{cacheNotification}</span>
          </div>
          <button onClick={() => setCacheNotification(null)} className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 1: LIVE OBD SCAN MODE                                 */}
      {/* ========================================================= */}
      {activeTab === 'LIVE' && (
        <div className="space-y-6">
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
                OBD-II Service 0x03 (Stored), 0x07 (Pending), 0x04 (Clear) & Auto Local Storage Cache
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

          {/* Connection Error or Disconnection Alert */}
          {connectionError && (
            <div className="bg-rose-950/40 border border-rose-500/30 rounded-xl p-4 flex items-start gap-3 text-rose-300">
              <WifiOff className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" />
              <div className="text-xs md:text-sm font-medium space-y-2">
                <p>{connectionError}</p>
                <button
                  onClick={() => setActiveTab('CACHE')}
                  className="px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors shadow"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>{isRtl ? 'الانتقال إلى قاموس الأعطال المحفوظ محلياً' : 'Open Offline DTC Dictionary'}</span>
                </button>
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
              <button
                onClick={() => setActiveTab('CACHE')}
                className="mt-4 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-purple-300 text-xs font-bold border border-purple-500/30 flex items-center gap-2 transition-all"
              >
                <Database className="h-4 w-4" />
                <span>{t('dtcModeCache')} ({cachedDtcs.length} {isRtl ? 'كود محفوظ' : 'Codes'})</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column: DTC Cards */}
              <div className="lg:col-span-1 space-y-3">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                  Active Scanned Codes
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
                        {((isRtl ? selectedDtc.symptomsAr : selectedDtc.symptomsEn) || ['DTC logged in ECU memory.']).map((sym, idx) => (
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
                        {((isRtl ? selectedDtc.causesAr : selectedDtc.causesEn) || selectedDtc.possibleCauses || ['Requires diagnostic inspection.']).map((cause, idx) => (
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
                        {((isRtl ? selectedDtc.fixesAr : selectedDtc.fixesEn) || ['Inspect wiring and sensor signals.']).map((fix, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-emerald-500 font-bold">•</span>
                            <span>{fix}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center">
                    <Info className="h-8 w-8 text-slate-600 mb-2" />
                    {t('dtcSelectNotice')}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: OFFLINE DTC LOCAL STORAGE CACHE DICTIONARY         */}
      {/* ========================================================= */}
      {activeTab === 'CACHE' && (
        <div className="space-y-6">
          {/* Controls & Search Toolbar */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-purple-400" />
                  <h2 className="text-lg font-bold text-white">
                    {t('dtcCacheTitle')}
                  </h2>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t('dtcCacheSubtitle')}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowAddModal(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white flex items-center gap-1.5 transition-all shadow"
                >
                  <Plus className="h-4 w-4" />
                  <span>{t('dtcAddCustom')}</span>
                </button>

                <button
                  onClick={handleExportCache}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-all"
                >
                  <Download className="h-4 w-4 text-cyan-400" />
                  <span>{t('dtcExportCache')}</span>
                </button>

                <button
                  onClick={handleResetCache}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-300 border border-slate-700 flex items-center gap-1.5 transition-all"
                  title="Reset cache to built-in default dictionary"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>{t('dtcResetCache')}</span>
                </button>
              </div>
            </div>

            {/* Search Input & System Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 relative">
                <Search className={`absolute top-2.5 ${isRtl ? 'right-3' : 'left-3'} h-4 w-4 text-slate-400`} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('dtcSearchPlaceholder')}
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg py-2 ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'} text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-all font-mono`}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className={`absolute top-2.5 ${isRtl ? 'left-3' : 'right-3'} text-slate-500 hover:text-white`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
                {['ALL', 'POWERTRAIN', 'CHASSIS', 'BODY', 'NETWORK'].map((sys) => (
                  <button
                    key={sys}
                    onClick={() => setSelectedSystemFilter(sys)}
                    className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold font-mono transition-all whitespace-nowrap ${
                      selectedSystemFilter === sys
                        ? 'bg-purple-600 text-white shadow'
                        : 'bg-slate-950 text-slate-400 hover:bg-slate-800 border border-slate-800'
                    }`}
                  >
                    {sys === 'ALL' ? t('dtcFilterAll') : sys}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Offline Cache Results Grid */}
          {filteredCachedDtcs.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-xs">
              <Search className="h-8 w-8 text-slate-600 mx-auto mb-2" />
              <p className="font-bold text-white text-sm">No DTC definitions match your search query.</p>
              <p className="mt-1">Try clearing filters or search terms, or add a custom code to local storage.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column: Cached Code List */}
              <div className="lg:col-span-1 space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
                <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-mono">
                  <span>{t('dtcTotalCached')}: {filteredCachedDtcs.length}</span>
                  <span>LocalStorage V2</span>
                </div>

                {filteredCachedDtcs.map((item) => {
                  const isSelected = selectedCachedItem?.code === item.code;
                  return (
                    <div
                      key={item.code}
                      onClick={() => setSelectedCachedItem(item)}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-slate-800 border-purple-500 shadow-md shadow-purple-950/40'
                          : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-black text-base text-rose-400 font-mono tracking-wider">
                          {item.code}
                        </span>
                        <div className="flex items-center gap-1">
                          {getSourceBadge(item.source)}
                          <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border font-bold ${getSeverityBadge(item.severity)}`}>
                            {item.severity}
                          </span>
                        </div>
                      </div>

                      <h4 className="font-bold text-xs text-slate-200 line-clamp-1">
                        {isRtl ? item.descriptionAr : item.descriptionEn}
                      </h4>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1.5 font-mono">
                        <span>{item.system}</span>
                        {item.cachedAt && (
                          <span className="text-slate-500">
                            {new Date(item.cachedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Right Column: Cached DTC In-Depth Detail */}
              <div className="lg:col-span-2">
                {selectedCachedItem ? (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
                    {/* Header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-black text-rose-400 font-mono tracking-wider">
                            {selectedCachedItem.code}
                          </span>
                          <span className={`text-xs uppercase font-mono px-2.5 py-0.5 rounded border font-bold ${getSeverityBadge(selectedCachedItem.severity)}`}>
                            {selectedCachedItem.severity}
                          </span>
                          {getSourceBadge(selectedCachedItem.source)}
                        </div>
                        <h3 className="text-base font-bold text-white mt-1">
                          {isRtl ? selectedCachedItem.descriptionAr : selectedCachedItem.descriptionEn}
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5 font-mono">
                          {selectedCachedItem.descriptionEn}
                        </p>
                      </div>

                      <button
                        onClick={() => handleCopyCachedDetail(selectedCachedItem)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-bold flex items-center gap-1.5 border border-slate-700 transition-all"
                      >
                        {copiedCode ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4 text-cyan-400" />}
                        <span>{copiedCode ? (isRtl ? 'تم النسخ' : 'Copied') : (isRtl ? 'نسخ التفاصيل' : 'Copy')}</span>
                      </button>
                    </div>

                    {/* Symptoms */}
                    <div>
                      <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-2">
                        {t('dtcSymptoms')}
                      </h4>
                      <ul className="space-y-1.5 text-xs text-slate-300 bg-slate-950 p-3 rounded-lg border border-slate-800">
                        {((isRtl ? selectedCachedItem.symptomsAr : selectedCachedItem.symptomsEn) || ['No symptoms logged.']).map((sym, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-cyan-400 font-bold">•</span>
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
                      <ul className="space-y-1.5 text-xs text-slate-300 bg-slate-950 p-3 rounded-lg border border-slate-800">
                        {((isRtl ? selectedCachedItem.causesAr : selectedCachedItem.causesEn) || ['Requires diagnostic inspection.']).map((cause, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-amber-400 font-bold">•</span>
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
                      <ul className="space-y-1.5 text-xs text-slate-300 bg-slate-950 p-3 rounded-lg border border-slate-800">
                        {((isRtl ? selectedCachedItem.fixesAr : selectedCachedItem.fixesEn) || ['Inspect sensor wiring & harness.']).map((fix, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-emerald-400 font-bold">•</span>
                            <span>{fix}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Offline note */}
                    <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                      <span>LocalStorage Key: HAMZA_OBD_DTC_CACHE_V2</span>
                      <span>Offline Access Guaranteed</span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-xs">
                    <Info className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                    {t('dtcSelectNotice')}
                  </div>
                )}
              </div>
            </div>
          )}
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

      {/* Add Custom DTC Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-purple-500/50 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-purple-400">
                <Plus className="h-5 w-5" />
                <h3 className="font-extrabold text-lg text-white">
                  {t('dtcAddCustom')}
                </h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomCode} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1">DTC Code (e.g. P1234)</label>
                  <input
                    type="text"
                    required
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    placeholder="P1234"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono uppercase focus:border-purple-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-bold mb-1">System</label>
                  <select
                    value={newSystem}
                    onChange={(e) => setNewSystem(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white focus:border-purple-500 outline-none"
                  >
                    <option value="POWERTRAIN">POWERTRAIN (P)</option>
                    <option value="CHASSIS">CHASSIS (C)</option>
                    <option value="BODY">BODY (B)</option>
                    <option value="NETWORK">NETWORK (U)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">Severity</label>
                <select
                  value={newSeverity}
                  onChange={(e) => setNewSeverity(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white focus:border-purple-500 outline-none"
                >
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">Arabic Description (الوصف بالعربي)</label>
                <input
                  type="text"
                  required
                  value={newDescAr}
                  onChange={(e) => setNewDescAr(e.target.value)}
                  placeholder="وصف العطل باللغة العربية..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white focus:border-purple-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">English Description</label>
                <input
                  type="text"
                  required
                  value={newDescEn}
                  onChange={(e) => setNewDescEn(e.target.value)}
                  placeholder="English DTC Description..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white focus:border-purple-500 outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">Symptoms (الأعراض - سطر لكل عرض)</label>
                <textarea
                  rows={2}
                  value={newSymptomsAr}
                  onChange={(e) => setNewSymptomsAr(e.target.value)}
                  placeholder="إضاءة لمبة المحرك&#10;ضعف في عزم السيارة"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white focus:border-purple-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">Causes (الأسباب - سطر لكل سبب)</label>
                <textarea
                  rows={2}
                  value={newCausesAr}
                  onChange={(e) => setNewCausesAr(e.target.value)}
                  placeholder="انسداد الحساس&#10;تلف في الضفيرة"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white focus:border-purple-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1">Fixes (الحلول والتصليح - سطر لكل حل)</label>
                <textarea
                  rows={2}
                  value={newFixesAr}
                  onChange={(e) => setNewFixesAr(e.target.value)}
                  placeholder="تنظيف الحساس بمُنظف الكترونيات&#10;استبدال الجزء التالف"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white focus:border-purple-500 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg font-bold bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  {t('btnCancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg font-bold bg-purple-600 hover:bg-purple-500 text-white shadow"
                >
                  {t('btnSave')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
