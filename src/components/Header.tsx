import React from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ConnectionStatus, ConnectionConfig, EcuLinkStatus } from '../types';
import { useAuth } from '../services/AuthContext';
import { 
  Activity, 
  Wifi, 
  Bluetooth, 
  ShieldAlert, 
  Languages, 
  Wrench, 
  RefreshCw, 
  Radio, 
  Terminal, 
  Cpu, 
  Settings2,
  LogIn,
  LogOut,
  User as UserIcon
} from 'lucide-react';

interface HeaderProps {
  status: ConnectionStatus;
  config: ConnectionConfig;
  ecuLinkStatus?: EcuLinkStatus;
  batteryVoltage?: number;
  activeTab?: string;
  setActiveTab?: (tab: string) => void;
  onToggleConnect?: () => void;
  onToggleMockMode?: () => void;
  onPing?: () => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onOpenConnectionManager?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  config,
  ecuLinkStatus = 'DISCONNECTED',
  batteryVoltage = 14.15,
  activeTab,
  setActiveTab,
  onToggleConnect,
  onToggleMockMode,
  onPing,
  onConnect,
  onDisconnect,
  onOpenConnectionManager
}) => {
  const { language, setLanguage, isRtl, t } = useI18n();

  const handleConnectToggle = () => {
    if (onToggleConnect) {
      onToggleConnect();
    } else if (status === 'CONNECTED') {
      onDisconnect?.();
    } else {
      onConnect?.();
    }
  };

  const handlePing = () => {
    if (onPing) {
      onPing();
    }
  };

  const handleMockToggle = () => {
    if (onToggleMockMode) {
      onToggleMockMode();
    }
  };

  const getStatusColor = (s: ConnectionStatus) => {
    switch (s) {
      case 'CONNECTED':
        return 'bg-emerald-500 text-emerald-950 border-emerald-400 shadow-emerald-500/20';
      case 'CONNECTING':
        return 'bg-amber-500 text-amber-950 border-amber-400 animate-pulse';
      case 'ERROR':
        return 'bg-rose-600 text-white border-rose-400 shadow-rose-600/20';
      case 'DISCONNECTED':
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const getStatusText = (s: ConnectionStatus) => {
    return t(s);
  };

  const isBluetooth = config.transportType === 'BLUETOOTH_SPP';

  return (
    <header className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 py-2.5 shadow-xl">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Brand & Subtitle */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 border border-cyan-400/40">
            <Activity className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-extrabold text-xl tracking-wider text-white font-['Chakra_Petch',sans-serif]">
                HAMZA <span className="text-cyan-400">OBD PRO</span>
              </h1>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60 font-mono font-bold">
                v2.5 PRO
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              {t('appSubtitle')}
            </p>
          </div>
        </div>

        {/* Status Badges & Quick Action Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Connection Manager Quick Trigger */}
          <button
            onClick={onOpenConnectionManager}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-cyan-500/50 transition-all shadow-sm"
            title="فتح مدير الاتصال (Wi-Fi TCP / Bluetooth Classic SPP)"
          >
            {isBluetooth ? (
              <Bluetooth className="h-3.5 w-3.5 text-blue-400" />
            ) : (
              <Wifi className="h-3.5 w-3.5 text-cyan-400" />
            )}
            <span className="font-mono text-[11px] text-slate-300 font-bold bg-slate-900/60 px-2 py-0.5 rounded border border-slate-700/60 flex items-center gap-1">
              <span className="text-cyan-400">
                {isBluetooth ? (language === 'ar' ? 'بلوتوث' : 'BT') : (language === 'ar' ? 'واي فاي' : 'Wi-Fi')}:
              </span>
              <span className="text-slate-100 font-extrabold truncate max-w-[120px]">
                {status === 'CONNECTED' || status === 'CONNECTING'
                  ? (isBluetooth ? (config.bluetoothDeviceName || 'OBD Device') : (config.ip || '192.168.0.10'))
                  : (language === 'ar' ? 'غير متصل' : 'Not Connected')}
              </span>
            </span>
            <Settings2 className="h-3 w-3 text-slate-400" />
          </button>

          {/* Connection Status Pill */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${getStatusColor(status)}`}>
            <span className={`h-2 w-2 rounded-full ${status === 'CONNECTED' ? 'bg-emerald-400 animate-ping' : status === 'CONNECTING' ? 'bg-amber-400' : 'bg-slate-400'}`} />
            <span>{getStatusText(status)}</span>
          </div>

          {/* Car Link Status Badge */}
          {status === 'CONNECTED' && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm transition-all ${
              ecuLinkStatus === 'LINKED'
                ? 'bg-cyan-500 text-cyan-950 border-cyan-400 shadow-cyan-500/20' 
                : ecuLinkStatus === 'CHECKING'
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                : ecuLinkStatus === 'ERROR'
                ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}>
              <Cpu className={`h-3.5 w-3.5 ${ecuLinkStatus === 'CHECKING' ? 'animate-spin' : ecuLinkStatus === 'LINKED' ? 'animate-pulse' : ''}`} />
              <span>
                {ecuLinkStatus === 'LINKED' 
                  ? (language === 'ar' ? 'كمبيوتر السيارة: متصل' : 'Car ECU: Linked')
                  : ecuLinkStatus === 'CHECKING'
                  ? (language === 'ar' ? 'جاري الفحص...' : 'Checking ECU...')
                  : ecuLinkStatus === 'ERROR'
                  ? (language === 'ar' ? 'خطأ في الاتصال' : 'Link Error')
                  : (language === 'ar' ? 'لا يوجد اتصال بالسيارة' : 'Car ECU: No Link')}
              </span>
            </div>
          )}

          {/* Connect / Disconnect Action Button */}
          <button
            onClick={handleConnectToggle}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md flex items-center gap-1.5 ${
              status === 'CONNECTED'
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-600/20'
            }`}
          >
            {isBluetooth ? <Bluetooth className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
            <span>{status === 'CONNECTED' ? t('btnDisconnect') : t('btnConnect')}</span>
          </button>

          {/* Ping / Refresh Link Button */}
          {status === 'CONNECTED' && (
            <button
              onClick={handlePing}
              disabled={ecuLinkStatus === 'CHECKING'}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all ${
                ecuLinkStatus === 'CHECKING'
                  ? 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 hover:border-cyan-500/50'
              }`}
              title={language === 'ar' ? 'تحديث الاتصال بكمبيوتر السيارة' : 'Refresh Car ECU Link'}
            >
              <RefreshCw className={`h-3.5 w-3.5 text-cyan-400 ${ecuLinkStatus === 'CHECKING' ? 'animate-spin' : ''}`} />
              <span>{language === 'ar' ? 'فحص الرابط' : 'Check Link'}</span>
            </button>
          )}

          {/* Language Toggle */}
          <button
            onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition-colors"
          >
            <Languages className="h-3.5 w-3.5" />
            <span>{language === 'ar' ? 'English (EN)' : 'العربية (AR)'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
