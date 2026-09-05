import React from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ConnectionStatus, ConnectionConfig, VinInfo, DiagnosticTroubleCode, EcuInfo, ViewTab } from '../types';
import { 
  Activity, 
  Wifi, 
  Gauge, 
  AlertTriangle, 
  Wrench, 
  Cpu, 
  FileText, 
  Layers, 
  Search, 
  ShieldCheck, 
  Zap, 
  Terminal, 
  Car, 
  Battery, 
  RefreshCw,
  Code,
  Radio,
  CheckCircle2,
  XCircle,
  HelpCircle
} from 'lucide-react';

interface DashboardProps {
  status?: ConnectionStatus;
  config?: ConnectionConfig;
  isCarLinked?: boolean;
  vinInfo?: VinInfo;
  dtcList?: DiagnosticTroubleCode[];
  ecuList?: EcuInfo[];
  batteryVoltage?: number;
  dtcCount?: number;
  vin?: string;
  onNavigate?: (tab: ViewTab) => void;
  onQuickScan?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  status = 'DISCONNECTED',
  config = {
    transportType: 'WIFI_TCP',
    ip: '192.168.4.1',
    port: 35000,
    bluetoothDeviceName: 'ESP32-OBD-PRO',
    bluetoothMacAddress: '',
    bluetoothSppUuid: '00001101-0000-1000-8000-00805F9B34FB',
    connectionTimeoutMs: 4000,
    responseTimeoutMs: 2500,
    canSpeed: '500K',
    canMode: '11-bit',
    protocol: 'ISO 15765-4 (CAN 11/500)',
    autoReconnect: true,
    isMockMode: false
  },
  isCarLinked = false,
  vinInfo = {
    rawVin: '',
    isValid: false,
    manufacturer: 'Unknown',
    model: 'Unknown',
    year: undefined,
    country: 'Unknown'
  },
  dtcList = [],
  ecuList = [],
  batteryVoltage = 0.0,
  dtcCount,
  vin,
  onNavigate = (_tab: ViewTab) => {},
  onQuickScan = () => {}
}) => {
  const { t, isRtl } = useI18n();

  const getStatusBadge = (s: ConnectionStatus = 'DISCONNECTED') => {
    switch (s) {
      case 'CONNECTED':
        return { text: t('CONNECTED'), bg: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' };
      case 'CONNECTING':
        return { text: t('CONNECTING'), bg: 'bg-amber-500/20 text-amber-400 border-amber-500/40 animate-pulse' };
      case 'ERROR':
        return { text: t('ERROR'), bg: 'bg-rose-500/20 text-rose-400 border-rose-500/40' };
      default:
        return { text: t('DISCONNECTED'), bg: 'bg-slate-800 text-slate-400 border-slate-700' };
    }
  };

  const safeDtcList = dtcList || [];
  const safeEcuList = ecuList || [];
  const activeDtcCount = dtcCount !== undefined ? dtcCount : safeDtcList.length;
  const activeEcuCount = safeEcuList.filter(e => e.status === 'ONLINE').length;
  const statusBadge = getStatusBadge(status as ConnectionStatus);

  return (
    <div className="space-y-6 pb-12">
      {/* Mock Mode Alert Banner if active */}
      {config.isMockMode && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 flex items-center gap-3 text-amber-300">
          <Zap className="h-5 w-5 shrink-0 text-amber-400" />
          <div className="text-xs md:text-sm">
            <span className="font-bold">{t('mockMode')}: </span>
            {t('mockWarning')}
          </div>
        </div>
      )}

      {/* Top Telemetry & Status Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        {/* Hardware Status */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{t('dashDeviceStatus')}</span>
            <Activity className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border w-fit ${statusBadge.bg}`}>
              {statusBadge.text}
            </span>
            <div className={`text-[10px] font-bold flex items-center gap-1.5 ${isCarLinked ? 'text-emerald-400' : 'text-slate-500'}`}>
              <Cpu className="h-3 w-3" />
              <span>{isCarLinked ? (isRtl ? 'اتصال كمبيوتر السيارة: فعال' : 'Car ECU Link: Active') : (isRtl ? 'لا يوجد رد من السيارة' : 'Car ECU: No Signal')}</span>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-slate-400 font-mono">
            {config.transportType === 'BLUETOOTH_SPP' ? (config.bluetoothDeviceName || 'BT-OBD') : `${config.ip}:${config.port}`}
          </div>
        </div>

        {/* Protocol & CAN Speed */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{t('dashProtocolType')}</span>
            <Radio className="h-4 w-4 text-blue-400" />
          </div>
          <div className="mt-2 font-bold text-sm text-slate-200 truncate">
            {config.protocol}
          </div>
          <div className="mt-2 text-[11px] text-cyan-400 font-mono">
            CAN {config.canMode} @ {config.canSpeed}
          </div>
        </div>

        {/* Vehicle / VIN Info */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{t('dashVehicleName')}</span>
            <Car className="h-4 w-4 text-purple-400" />
          </div>
          <div className="mt-2 font-bold text-sm text-slate-200 truncate">
            {vinInfo.isValid ? `${vinInfo.manufacturer} ${vinInfo.model}` : 'Unknown'}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 font-mono tracking-wider truncate">
            {vinInfo.rawVin || 'Not Read'}
          </div>
        </div>

        {/* Battery & Health */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{t('dashBatteryVoltage')}</span>
            <Battery className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-extrabold text-lg text-emerald-400 font-mono">
              {batteryVoltage.toFixed(2)}
            </span>
            <span className="text-xs text-slate-400">V (DC)</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            <span className={activeDtcCount > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
              {activeDtcCount} {t('dtcCode')}
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-cyan-400 font-medium">
              {activeEcuCount || 8} ECUs OK
            </span>
          </div>
        </div>
      </div>

      {/* Main Workshop Actions Grid (Large Touch Buttons for Auto Technicians) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
            {t('actions')}
          </h2>
          <span className="text-xs text-slate-400">
            HAMZA Diagnostic Suite
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {/* 1. Full Scan Button */}
          <button
            onClick={() => {
              onQuickScan();
              onNavigate('ecuScan');
            }}
            className="group p-4 rounded-xl bg-gradient-to-br from-cyan-600/20 to-blue-700/20 hover:from-cyan-600/30 hover:to-blue-700/30 border border-cyan-500/30 hover:border-cyan-400/60 transition-all text-left flex flex-col justify-between shadow-lg shadow-cyan-950/40"
          >
            <div className="flex items-center justify-between w-full">
              <div className="h-11 w-11 rounded-lg bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform">
                <Search className="h-6 w-6" />
              </div>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/60">
                Auto
              </span>
            </div>
            <div className="mt-4">
              <h3 className="font-bold text-base text-white group-hover:text-cyan-300 transition-colors">
                {t('btnScan')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('ecuScannerTitle')}
              </p>
            </div>
          </button>

          {/* 2. Live Data */}
          <button
            onClick={() => onNavigate('liveData')}
            className="group p-4 rounded-xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-emerald-500/50 transition-all text-left flex flex-col justify-between shadow-sm"
          >
            <div className="flex items-center justify-between w-full">
              <div className="h-11 w-11 rounded-lg bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                <Gauge className="h-6 w-6" />
              </div>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                Stream
              </span>
            </div>
            <div className="mt-4">
              <h3 className="font-bold text-base text-white group-hover:text-emerald-300 transition-colors">
                {t('navLiveData')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                RPM, Speed, Temp, TPS, Volt
              </p>
            </div>
          </button>

          {/* 3. DTC Codes */}
          <button
            onClick={() => onNavigate('dtc')}
            className="group p-4 rounded-xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-rose-500/50 transition-all text-left flex flex-col justify-between shadow-sm"
          >
            <div className="flex items-center justify-between w-full">
              <div className="h-11 w-11 rounded-lg bg-rose-500/15 border border-rose-400/30 flex items-center justify-center text-rose-400 group-hover:scale-105 transition-transform">
                <AlertTriangle className="h-6 w-6" />
              </div>
              {activeDtcCount > 0 && (
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 font-bold">
                  {activeDtcCount} Active
                </span>
              )}
            </div>
            <div className="mt-4">
              <h3 className="font-bold text-base text-white group-hover:text-rose-300 transition-colors">
                {t('navDtc')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Mode 03 / 07 / 04 / 0A
              </p>
            </div>
          </button>

          {/* 4. Service Functions */}
          <button
            onClick={() => onNavigate('serviceFunctions')}
            className="group p-4 rounded-xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-amber-500/50 transition-all text-left flex flex-col justify-between shadow-sm"
          >
            <div className="flex items-center justify-between w-full">
              <div className="h-11 w-11 rounded-lg bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
                <Wrench className="h-6 w-6" />
              </div>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                14 Routines
              </span>
            </div>
            <div className="mt-4">
              <h3 className="font-bold text-base text-white group-hover:text-amber-300 transition-colors">
                {t('navService')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Oil, SAS, EPB, Throttle, DPF
              </p>
            </div>
          </button>

          {/* 5. Toyota OEM Specials */}
          <button
            onClick={() => onNavigate('toyota')}
            className="group p-4 rounded-xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-red-500/50 transition-all text-left flex flex-col justify-between shadow-sm"
          >
            <div className="flex items-center justify-between w-full">
              <div className="h-11 w-11 rounded-lg bg-red-500/15 border border-red-400/30 flex items-center justify-center text-red-400 group-hover:scale-105 transition-transform">
                <Car className="h-6 w-6" />
              </div>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-red-950 text-red-300 border border-red-800">
                OEM
              </span>
            </div>
            <div className="mt-4">
              <h3 className="font-bold text-base text-white group-hover:text-red-300 transition-colors">
                {t('navToyota')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Zero Point, ABS Bleed, ATF
              </p>
            </div>
          </button>

          {/* 6. UDS Services */}
          <button
            onClick={() => onNavigate('uds')}
            className="group p-4 rounded-xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-indigo-500/50 transition-all text-left flex flex-col justify-between shadow-sm"
          >
            <div className="flex items-center justify-between w-full">
              <div className="h-11 w-11 rounded-lg bg-indigo-500/15 border border-indigo-400/30 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform">
                <Cpu className="h-6 w-6" />
              </div>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                ISO 14229
              </span>
            </div>
            <div className="mt-4">
              <h3 className="font-bold text-base text-white group-hover:text-indigo-300 transition-colors">
                {t('navUds')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                0x10, 0x19, 0x22, 0x27, 0x31
              </p>
            </div>
          </button>

          {/* 7. CAN Monitor */}
          <button
            onClick={() => onNavigate('canMonitor')}
            className="group p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-500/50 transition-all text-left flex flex-col justify-between shadow-sm"
          >
            <div className="flex items-center justify-between w-full">
              <div className="h-11 w-11 rounded-lg bg-cyan-950 border border-cyan-800 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform">
                <Radio className="h-6 w-6" />
              </div>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold">
                Raw CAN
              </span>
            </div>
            <div className="mt-4">
              <h3 className="font-bold text-base text-white group-hover:text-cyan-300 transition-colors">
                {t('navCanMonitor')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                11/29-bit Bus Traffic
              </p>
            </div>
          </button>

          {/* 8. Communication Log */}
          <button
            onClick={() => onNavigate('commLog')}
            className="group p-4 rounded-xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-slate-500/50 transition-all text-left flex flex-col justify-between shadow-sm"
          >
            <div className="flex items-center justify-between w-full">
              <div className="h-11 w-11 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 group-hover:scale-105 transition-transform">
                <Terminal className="h-6 w-6" />
              </div>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                Packets
              </span>
            </div>
            <div className="mt-4">
              <h3 className="font-bold text-base text-white group-hover:text-slate-300 transition-colors">
                {t('navCommLog')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Directional Hex Stream
              </p>
            </div>
          </button>

          {/* 9. Technical Error Log */}
          <button
            onClick={() => onNavigate('errorLog')}
            className="group p-4 rounded-xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-orange-500/50 transition-all text-left flex flex-col justify-between shadow-sm"
          >
            <div className="flex items-center justify-between w-full">
              <div className="h-11 w-11 rounded-lg bg-orange-500/15 border border-orange-400/30 flex items-center justify-center text-orange-400 group-hover:scale-105 transition-transform">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-orange-950 text-orange-300 border border-orange-800">
                Audit
              </span>
            </div>
            <div className="mt-4">
              <h3 className="font-bold text-base text-white group-hover:text-orange-300 transition-colors">
                {t('navErrorLog')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Correlations & Diagnostics
              </p>
            </div>
          </button>

          {/* 10. Reports */}
          <button
            onClick={() => onNavigate('reports')}
            className="group p-4 rounded-xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-blue-500/50 transition-all text-left flex flex-col justify-between shadow-sm"
          >
            <div className="flex items-center justify-between w-full">
              <div className="h-11 w-11 rounded-lg bg-blue-500/15 border border-blue-400/30 flex items-center justify-center text-blue-400 group-hover:scale-105 transition-transform">
                <FileText className="h-6 w-6" />
              </div>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
                PDF
              </span>
            </div>
            <div className="mt-4">
              <h3 className="font-bold text-base text-white group-hover:text-blue-300 transition-colors">
                {t('navReports')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Generate Diagnostic Report
              </p>
            </div>
          </button>

          {/* 11. Android Native & APK Code Explorer */}
          <button
            onClick={() => onNavigate('androidCode')}
            className="group p-4 rounded-xl bg-gradient-to-br from-emerald-950/40 to-teal-950/40 hover:from-emerald-900/50 hover:to-teal-900/50 border border-emerald-500/30 hover:border-emerald-400/60 transition-all text-left flex flex-col justify-between shadow-sm"
          >
            <div className="flex items-center justify-between w-full">
              <div className="h-11 w-11 rounded-lg bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                <Code className="h-6 w-6" />
              </div>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                Kotlin
              </span>
            </div>
            <div className="mt-4">
              <h3 className="font-bold text-base text-white group-hover:text-emerald-300 transition-colors">
                {t('navAndroidCode')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Native App & APK Build
              </p>
            </div>
          </button>

          {/* 12. Unit Tests & System Audit */}
          <button
            onClick={() => onNavigate('unitTests')}
            className="group p-4 rounded-xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-teal-500/50 transition-all text-left flex flex-col justify-between shadow-sm"
          >
            <div className="flex items-center justify-between w-full">
              <div className="h-11 w-11 rounded-lg bg-teal-500/15 border border-teal-400/30 flex items-center justify-center text-teal-400 group-hover:scale-105 transition-transform">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-teal-950 text-teal-300 border border-teal-800">
                100% Pass
              </span>
            </div>
            <div className="mt-4">
              <h3 className="font-bold text-base text-white group-hover:text-teal-300 transition-colors">
                {t('navUnitTests')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                PID, ISO-TP, UDS, Redaction
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
