import React, { useState, useEffect } from 'react';
import { I18nProvider, useI18n } from './i18n/I18nContext';
import { ConnectionConfig, ConnectionStatus, EcuLinkStatus, DiagnosticTroubleCode, VinInfo, ViewTab, EcuInfo, TransportType } from './types';
import { KNOWN_ECU_NODES } from './ecu/ecuScanner';
import { transportManager, defaultConnectionConfig } from './network/TransportManager';
import { AuthProvider, useAuth } from './services/AuthContext';
import { Header } from './components/Header';
import { ConnectionManagerModal } from './components/ConnectionManagerModal';
import { Dashboard } from './components/Dashboard';
import { LiveDataView } from './components/LiveDataView';
import { DtcView } from './components/DtcView';
import { VinView } from './components/VinView';
import { EcuScanView } from './components/EcuScanView';
import { CanMonitorView } from './components/CanMonitorView';
import { UdsView } from './components/UdsView';
import { ServiceFunctionsView } from './components/ServiceFunctionsView';
import { ToyotaSpecialView } from './components/ToyotaSpecialView';
import { CommLogView } from './components/CommLogView';
import { ErrorLogView } from './components/ErrorLogView';
import { ReportsView } from './components/ReportsView';
import { DeveloperModeView } from './components/DeveloperModeView';
import { OtaView } from './components/OtaView';
import { AndroidProjectView } from './components/AndroidProjectView';
import { UnitTestsView } from './components/UnitTestsView';
import { SettingsView } from './components/SettingsView';
import { DiagnosticAuditView } from './components/DiagnosticAuditView';
import { 
  Gauge, 
  Activity, 
  AlertTriangle, 
  FileSearch, 
  Layers, 
  Radio, 
  Cpu, 
  Wrench, 
  Car, 
  Terminal, 
  ShieldCheck, 
  FileText, 
  Settings, 
  UploadCloud, 
  Smartphone, 
  CheckCircle2,
  Bug,
  ClipboardCheck
} from 'lucide-react';

const MainApp: React.FC = () => {
  const { t, isRtl, language } = useI18n();
  const { user, preferences, savePreferences } = useAuth();
  const [activeTab, setActiveTab] = useState<ViewTab>('dashboard');
  const [config, setConfig] = useState<ConnectionConfig>(defaultConnectionConfig);
  const [status, setStatus] = useState<ConnectionStatus>('DISCONNECTED');
  const [ecuLinkStatus, setEcuLinkStatus] = useState<EcuLinkStatus>('DISCONNECTED');
  const [isConnModalOpen, setIsConnModalOpen] = useState<boolean>(false);
  const [batteryVoltage, setBatteryVoltage] = useState<number>(0.0);

  useEffect(() => {
    let voltageTimer: any = null;

    if (status === 'CONNECTED') {
      // Initial checks
      transportManager.getBatteryVoltage().then(v => {
        if (v > 0) setBatteryVoltage(v);
      });
      
      // Auto check link status on first connection
      handleCheckCarLink();

      // Poll every 10 seconds for real voltage
      voltageTimer = setInterval(async () => {
        const v = await transportManager.getBatteryVoltage();
        if (v > 0) {
          setBatteryVoltage(v);
        }
      }, 10000);
    } else {
      setBatteryVoltage(0.0);
    }

    return () => {
      if (voltageTimer) clearInterval(voltageTimer);
    };
  }, [status]);

  useEffect(() => {
    // Subscribe to Transport Manager state changes
    const unsub = transportManager.subscribeStatus((newStatus, transportType) => {
      setStatus(newStatus);
      setConfig(prev => ({ ...prev, transportType }));
      
      // Reset telemetry if disconnected
      if (newStatus === 'DISCONNECTED') {
        setBatteryVoltage(0.0);
        setEcuLinkStatus('DISCONNECTED');
        setEcuList(prev => prev.map(e => ({ ...e, status: 'OFFLINE', dtcCount: 0 })));
      }
    });
    return () => {
      unsub();
    };
  }, []);

  // Extract primitive fields to prevent reference-based infinite re-render loops
  const prefTransport = preferences?.transportType;
  const prefIp = preferences?.ip;
  const prefPort = preferences?.port;
  const prefBtName = preferences?.bluetoothDeviceName;
  const prefBtMac = preferences?.bluetoothMacAddress;
  const prefCanSpeed = preferences?.canSpeed;
  const prefCanMode = preferences?.canMode;
  const prefIsMock = preferences?.isMockMode;
  const userId = user?.uid;

  // Synchronize local connection state when user preferences are loaded from Firestore
  useEffect(() => {
    if (userId && preferences) {
      const syncedConfig: ConnectionConfig = {
        transportType: preferences.transportType,
        ip: preferences.ip,
        port: preferences.port,
        bluetoothDeviceName: preferences.bluetoothDeviceName,
        bluetoothMacAddress: preferences.bluetoothMacAddress,
        bluetoothSppUuid: '00001101-0000-1000-8000-00805F9B34FB',
        connectionTimeoutMs: 5000,
        responseTimeoutMs: 2500,
        canSpeed: preferences.canSpeed,
        canMode: preferences.canMode,
        protocol: 'AUTO',
        autoReconnect: true,
        isMockMode: preferences.isMockMode !== undefined ? preferences.isMockMode : false,
      };
      setConfig(syncedConfig);
      transportManager.updateConfig(syncedConfig);
    }
  }, [userId, prefTransport, prefIp, prefPort, prefBtName, prefBtMac, prefCanSpeed, prefCanMode, prefIsMock]);

  const handleUpdateConfig = (newCfg: Partial<ConnectionConfig>) => {
    setConfig(prev => {
      const merged = { ...prev, ...newCfg };
      transportManager.updateConfig(merged);
      
      // Save changes to Firebase so the settings persist across reloads
      if (user && savePreferences) {
        savePreferences({
          transportType: merged.transportType,
          ip: merged.ip,
          port: merged.port,
          bluetoothDeviceName: merged.bluetoothDeviceName,
          bluetoothMacAddress: merged.bluetoothMacAddress,
          canSpeed: merged.canSpeed,
          canMode: merged.canMode,
          isMockMode: merged.isMockMode,
        }).catch(console.error);
      }
      
      return merged;
    });
  };

  const [vinInfo, setVinInfo] = useState<VinInfo>({
    rawVin: '',
    isValid: false,
    manufacturer: '',
    model: '',
    year: undefined,
    country: '',
    engineType: '',
    transmission: '',
    bodyType: '',
    plantCode: ''
  });

  const [ecuList, setEcuList] = useState<EcuInfo[]>(() =>
    KNOWN_ECU_NODES.map(node => ({
      ...node,
      status: 'OFFLINE',
      dtcCount: 0,
      supportedPidsCount: 0
    }))
  );

  const [dtcList, setDtcList] = useState<DiagnosticTroubleCode[]>([]);

  // Connect / Disconnect handlers
  const handleConnect = async () => {
    await transportManager.connect(config);
  };

  const handleDisconnect = async () => {
    await transportManager.disconnect();
    setEcuLinkStatus('DISCONNECTED');
  };

  const handleCheckCarLink = async () => {
    if (status !== 'CONNECTED') return;
    
    setEcuLinkStatus('CHECKING');
    try {
      const linked = await transportManager.checkCarEcuLink();
      setEcuLinkStatus(linked ? 'LINKED' : 'ERROR');
      return linked;
    } catch (err) {
      setEcuLinkStatus('ERROR');
      return false;
    }
  };

  const handleToggleMockMode = () => {
    handleUpdateConfig({ isMockMode: !config.isMockMode });
  };

  // Nav tabs config
  const navTabs = [
    { id: 'dashboard', label: t('tabDashboard'), icon: Gauge },
    { id: 'liveData', label: t('tabLiveData'), icon: Activity },
    { id: 'dtc', label: t('tabDtc'), icon: AlertTriangle, badge: (dtcList || []).length },
    { id: 'vin', label: t('tabVin'), icon: FileSearch },
    { id: 'ecuScan', label: t('tabEcuScan'), icon: Layers },
    { id: 'canMonitor', label: t('tabCanMonitor'), icon: Radio },
    { id: 'uds', label: t('tabUds'), icon: Cpu },
    { id: 'serviceFunctions', label: t('tabServiceFunctions'), icon: Wrench },
    { id: 'toyota', label: t('tabToyota'), icon: Car },
    { id: 'reports', label: t('tabReports'), icon: FileText },
    { id: 'commLog', label: t('tabCommLog'), icon: Terminal },
    { id: 'errorLog', label: t('tabErrorLog'), icon: ShieldCheck },
    { id: 'devMode', label: t('tabDevMode'), icon: Bug },
    { id: 'ota', label: t('tabOta'), icon: UploadCloud },
    { id: 'androidCode', label: t('tabAndroidCode'), icon: Smartphone },
    { id: 'unitTests', label: t('tabUnitTests'), icon: CheckCircle2 },
    { id: 'audit', label: isRtl ? 'تدقيق النظام' : 'System Audit', icon: ClipboardCheck },
    { id: 'settings', label: t('tabSettings'), icon: Settings }
  ];

  return (
    <div className={`min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans ${isRtl ? 'rtl' : 'ltr'}`}>
      {/* Top Header */}
      <Header
        status={status}
        config={config}
        ecuLinkStatus={ecuLinkStatus}
        batteryVoltage={batteryVoltage}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onToggleMockMode={handleToggleMockMode}
        onPing={handleCheckCarLink}
        onOpenConnectionManager={() => setIsConnModalOpen(true)}
      />

      {/* Connection Manager Dialog Modal */}
      <ConnectionManagerModal
        isOpen={isConnModalOpen}
        onClose={() => setIsConnModalOpen(false)}
        config={config}
        status={status}
        onUpdateConfig={handleUpdateConfig}
      />

      {/* Primary Tab Navigation Bar */}
      <div className="bg-slate-900/90 border-b border-slate-800 sticky top-0 z-40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-1 overflow-x-auto py-2 scrollbar-none">
            {navTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as ViewTab)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/40 shadow-sm shadow-cyan-950'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <span>{tab.label}</span>
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-950 text-rose-400 border border-rose-800 font-mono font-bold">
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main View Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6">
        {activeTab === 'dashboard' && (
          <Dashboard
            status={status}
            config={config}
            isCarLinked={ecuLinkStatus === 'LINKED'}
            vinInfo={vinInfo}
            dtcList={dtcList}
            ecuList={ecuList}
            batteryVoltage={batteryVoltage}
            onNavigate={(tab) => setActiveTab(tab as ViewTab)}
            onQuickScan={() => setActiveTab('ecuScan')}
          />
        )}

        {activeTab === 'liveData' && (
          <LiveDataView status={status} isMockMode={config.isMockMode} />
        )}

        {activeTab === 'dtc' && (
          <DtcView
            status={status}
            dtcList={dtcList}
            setDtcList={setDtcList}
            isMockMode={config.isMockMode}
            vinInfo={vinInfo}
            batteryVoltage={batteryVoltage}
          />
        )}

        {activeTab === 'vin' && (
          <VinView
            status={status}
            vinInfo={vinInfo}
            setVinInfo={setVinInfo}
            isMockMode={config.isMockMode}
          />
        )}

        {activeTab === 'ecuScan' && (
          <EcuScanView
            status={status}
            ecuList={ecuList}
            setEcuList={setEcuList}
            isMockMode={config.isMockMode}
          />
        )}

        {activeTab === 'canMonitor' && (
          <CanMonitorView status={status} />
        )}

        {activeTab === 'uds' && (
          <UdsView status={status} />
        )}

        {activeTab === 'serviceFunctions' && (
          <ServiceFunctionsView status={status} batteryVoltage={batteryVoltage} />
        )}

        {activeTab === 'toyota' && (
          <ToyotaSpecialView status={status} batteryVoltage={batteryVoltage} />
        )}

        {activeTab === 'reports' && (
          <ReportsView status={status} vinInfo={vinInfo} dtcList={dtcList} />
        )}

        {activeTab === 'commLog' && (
          <CommLogView status={status} />
        )}

        {activeTab === 'errorLog' && (
          <ErrorLogView status={status} />
        )}

        {activeTab === 'devMode' && (
          <DeveloperModeView status={status} />
        )}

        {activeTab === 'ota' && (
          <OtaView status={status} />
        )}

        {activeTab === 'androidCode' && (
          <AndroidProjectView />
        )}

        {activeTab === 'unitTests' && (
          <UnitTestsView />
        )}

        {activeTab === 'audit' && (
          <DiagnosticAuditView status={status} />
        )}

        {activeTab === 'settings' && (
          <SettingsView config={config} setConfig={setConfig} status={status} />
        )}
      </main>

      {/* Bottom Status Bar */}
      <footer className="bg-slate-900 border-t border-slate-800 px-4 py-2 text-[11px] text-slate-400 font-mono">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${status === 'CONNECTED' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
              <strong className={status === 'CONNECTED' ? 'text-emerald-400' : 'text-slate-400'}>
                {status}
              </strong>
            </span>
            <span>|</span>
            <span>
              Transport: {config.transportType === 'BLUETOOTH_SPP' ? `BT SPP (${config.bluetoothDeviceName})` : `WiFi TCP (${config.ip}:${config.port})`}
            </span>
            <span>|</span>
            <span>CAN: {config.canSpeed} ({config.canMode})</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-cyan-400 font-bold">HAMZA OBD PRO v2.5</span>
            <span>|</span>
            <span>Battery: {batteryVoltage.toFixed(2)}V</span>
            <span>|</span>
            <span>ISO 15765-4 CAN</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <MainApp />
      </AuthProvider>
    </I18nProvider>
  );
}
