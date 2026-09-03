import React from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ConnectionStatus, ConnectionConfig } from '../types';
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
  const { user, signInWithGoogle, signOut } = useAuth();

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
                {isBluetooth ? (config.bluetoothDeviceName || 'ESP32') : (config.ip || '192.168.0.10')}
              </span>
            </span>
            <Settings2 className="h-3 w-3 text-slate-400" />
          </button>

          {/* Mode Switcher Pill */}
          <button
            onClick={handleMockToggle}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
              config.isMockMode
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
            }`}
            title="تبديل بين الوضع الحقيقي مع ESP32 ووضع المحاكاة"
          >
            <Cpu className="h-3.5 w-3.5" />
            <span>{config.isMockMode ? t('mockMode') : t('realMode')}</span>
          </button>

          {/* Connection Status Pill */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${getStatusColor(status)}`}>
            <span className={`h-2 w-2 rounded-full ${status === 'CONNECTED' ? 'bg-emerald-400 animate-ping' : status === 'CONNECTING' ? 'bg-amber-400' : 'bg-slate-400'}`} />
            <span>{getStatusText(status)}</span>
          </div>

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

          {/* Ping Button */}
          {status === 'CONNECTED' && (
            <button
              onClick={handlePing}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1 transition-colors"
              title={t('btnPing')}
            >
              <Radio className="h-3.5 w-3.5 text-cyan-400" />
              <span>Ping</span>
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

          {/* Firebase Authentication */}
          {user ? (
            <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg p-1 pr-2.5 shadow-md">
              {user.photoURL ? (
                <img 
                  src={user.photoURL} 
                  alt={user.displayName || 'User'} 
                  referrerPolicy="no-referrer"
                  className="w-6 h-6 rounded-full border border-cyan-500/50"
                  id="user-profile-img"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center border border-cyan-500/50" id="user-profile-avatar">
                  <UserIcon className="h-3.5 w-3.5 text-cyan-400" />
                </div>
              )}
              <div className="hidden sm:flex flex-col text-left">
                <span className="text-[9px] font-bold text-slate-200 truncate max-w-[90px] leading-tight">
                  {user.displayName || 'User'}
                </span>
                <span className="text-[7px] text-slate-400 truncate max-w-[90px] leading-none">
                  {user.email || ''}
                </span>
              </div>
              <button
                onClick={() => signOut()}
                className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-rose-400 transition-colors"
                title={language === 'ar' ? 'تسجيل الخروج' : 'Sign Out'}
                id="btn-sign-out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => signInWithGoogle()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-md transition-all shadow-cyan-950/40"
              id="btn-sign-in"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>{language === 'ar' ? 'تسجيل الدخول' : 'Sign In'}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
