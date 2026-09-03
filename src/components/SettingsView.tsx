import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ConnectionConfig, ConnectionStatus, TransportType } from '../types';
import { ESP32_DUAL_TRANSPORT_FIRMWARE_INO } from '../firmware/esp32_firmware_source';
import { useAuth } from '../services/AuthContext';
import { 
  Settings, 
  Wifi, 
  Bluetooth, 
  Radio, 
  Languages, 
  ShieldCheck, 
  Save, 
  RotateCcw, 
  Cpu,
  Clock,
  Zap,
  CheckCircle2,
  Code,
  Copy,
  Download
} from 'lucide-react';

interface SettingsViewProps {
  config: ConnectionConfig;
  setConfig: (config: ConnectionConfig) => void;
  status: ConnectionStatus;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ config, setConfig, status }) => {
  const { t, language, setLanguage, isRtl } = useI18n();
  const { user, savePreferences } = useAuth();
  const [formData, setFormData] = useState<ConnectionConfig>({ ...config });
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [copiedFirmware, setCopiedFirmware] = useState<boolean>(false);
  const [showFirmwareModal, setShowFirmwareModal] = useState<boolean>(false);

  const handleSave = () => {
    setConfig({ ...formData });
    setSavedSuccess(true);
    
    if (user) {
      savePreferences({
        transportType: formData.transportType,
        ip: formData.ip,
        port: formData.port,
        bluetoothDeviceName: formData.bluetoothDeviceName,
        bluetoothMacAddress: formData.bluetoothMacAddress,
        canSpeed: formData.canSpeed,
        canMode: formData.canMode,
        isMockMode: formData.isMockMode,
        language: language as 'ar' | 'en'
      }).catch(err => {
        console.error("Failed to sync settings to Firestore:", err);
      });
    }

    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleResetDefaults = () => {
    const defaults: ConnectionConfig = {
      transportType: 'WIFI_TCP',
      ip: '192.168.4.1',
      port: 35000,
      bluetoothDeviceName: 'ESP32-OBD-PRO',
      bluetoothMacAddress: '24:6F:28:B4:7A:1C',
      bluetoothSppUuid: '00001101-0000-1000-8000-00805F9B34FB',
      connectionTimeoutMs: 4000,
      responseTimeoutMs: 2500,
      canSpeed: '500K',
      canMode: '11-bit',
      protocol: 'ISO 15765-4 (CAN 11/500)',
      autoReconnect: true,
      isMockMode: config.isMockMode,
    };
    setFormData(defaults);
    setConfig(defaults);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleCopyFirmware = () => {
    navigator.clipboard.writeText(ESP32_DUAL_TRANSPORT_FIRMWARE_INO);
    setCopiedFirmware(true);
    setTimeout(() => setCopiedFirmware(false), 2000);
  };

  return (
    <div className="space-y-6 pb-12 max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-white">
              {t('settingsTitle')}
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            ESP32 Dual-Transport (Wi-Fi TCP & Bluetooth Classic SPP), CAN Baud, Protocol & Firmware
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFirmwareModal(true)}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-300 border border-cyan-800/60 flex items-center gap-1.5 transition-colors"
          >
            <Code className="h-3.5 w-3.5" />
            <span>ESP32 Firmware (.INO)</span>
          </button>

          <button
            onClick={handleResetDefaults}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset Defaults</span>
          </button>

          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-2 transition-all shadow-md shadow-cyan-950/50"
          >
            <Save className="h-4 w-4" />
            <span>{t('btnSaveSettings')}</span>
          </button>
        </div>
      </div>

      {savedSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-4 flex items-center gap-3 text-emerald-400">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span className="text-xs md:text-sm font-medium">{t('settingsSavedSuccess')}</span>
        </div>
      )}

      {/* Settings Sections Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Section 1: Transport & Network Configuration */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2">
              {formData.transportType === 'BLUETOOTH_SPP' ? <Bluetooth className="h-4 w-4 text-blue-400" /> : <Wifi className="h-4 w-4" />}
              <span>Dual-Transport Connection Layer</span>
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-cyan-400 border border-slate-700 font-mono font-bold">
              {formData.transportType}
            </span>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 block mb-1.5">
              Primary Transport Protocol
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, transportType: 'WIFI_TCP' })}
                className={`py-2 px-3 rounded-lg text-xs font-bold border flex items-center justify-center gap-1.5 transition-all ${
                  formData.transportType === 'WIFI_TCP'
                    ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                    : 'bg-slate-800/40 border-slate-700 text-slate-400'
                }`}
              >
                <Wifi className="w-3.5 h-3.5" />
                Wi-Fi TCP Socket
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, transportType: 'BLUETOOTH_SPP' })}
                className={`py-2 px-3 rounded-lg text-xs font-bold border flex items-center justify-center gap-1.5 transition-all ${
                  formData.transportType === 'BLUETOOTH_SPP'
                    ? 'bg-blue-500/20 border-blue-500 text-blue-300'
                    : 'bg-slate-800/40 border-slate-700 text-slate-400'
                }`}
              >
                <Bluetooth className="w-3.5 h-3.5" />
                Bluetooth Classic SPP
              </button>
            </div>
          </div>

          {formData.transportType === 'WIFI_TCP' ? (
            <>
              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">
                  ESP32 Access Point IP Address
                </label>
                <input
                  type="text"
                  value={formData.ip}
                  onChange={(e) => setFormData({ ...formData, ip: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">Default: 192.168.4.1</span>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">
                  TCP Socket Port
                </label>
                <input
                  type="number"
                  value={formData.port}
                  onChange={(e) => setFormData({ ...formData, port: Number(e.target.value) })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">Default: 35000</span>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">
                  Bluetooth SPP Device Name
                </label>
                <input
                  type="text"
                  value={formData.bluetoothDeviceName || 'ESP32-OBD-PRO'}
                  onChange={(e) => setFormData({ ...formData, bluetoothDeviceName: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">Default: ESP32-OBD-PRO</span>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">
                  Device MAC Address / UUID
                </label>
                <input
                  type="text"
                  value={formData.bluetoothMacAddress || '24:6F:28:B4:7A:1C'}
                  onChange={(e) => setFormData({ ...formData, bluetoothMacAddress: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">SPP UUID: 00001101-0000-1000-8000-00805F9B34FB</span>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-400 block mb-1">
                Connect Timeout (ms)
              </label>
              <input
                type="number"
                value={formData.connectionTimeoutMs}
                onChange={(e) => setFormData({ ...formData, connectionTimeoutMs: Number(e.target.value) })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 block mb-1">
                Response Timeout (ms)
              </label>
              <input
                type="number"
                value={formData.responseTimeoutMs}
                onChange={(e) => setFormData({ ...formData, responseTimeoutMs: Number(e.target.value) })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>
        </div>

        {/* Section 2: CAN Bus & Protocol Configuration */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
          <h3 className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center gap-2">
            <Radio className="h-4 w-4" />
            <span>{t('canConfigTitle')}</span>
          </h3>

          <div>
            <label className="text-xs font-bold text-slate-400 block mb-1">
              CAN Bus Baud Rate (Speed)
            </label>
            <select
              value={formData.canSpeed}
              onChange={(e) => setFormData({ ...formData, canSpeed: e.target.value as any })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
            >
              <option value="500K">500 kbps (High Speed CAN — Standard Modern)</option>
              <option value="250K">250 kbps (Medium Speed CAN)</option>
              <option value="125K">125 kbps (Low Speed CAN)</option>
              <option value="1M">1 Mbps (CAN-FD / Fast High Speed)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 block mb-1">
              CAN Addressing Mode
            </label>
            <select
              value={formData.canMode}
              onChange={(e) => setFormData({ ...formData, canMode: e.target.value as any })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
            >
              <option value="11-bit">Standard 11-bit CAN Identifier (ISO 15765-4)</option>
              <option value="29-bit">Extended 29-bit CAN Identifier (ISO 15765-4 Extended / J1939)</option>
            </select>
          </div>

          <div className="pt-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.autoReconnect}
                onChange={(e) => setFormData({ ...formData, autoReconnect: e.target.checked })}
                className="rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-0 h-4 w-4"
              />
              <span className="text-xs text-slate-300 font-medium">
                Automatic Reconnection upon packet drop
              </span>
            </label>
          </div>
        </div>

        {/* Section 3: Language & Localization */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg md:col-span-2">
          <h3 className="text-xs font-bold text-purple-400 uppercase tracking-wider flex items-center gap-2">
            <Languages className="h-4 w-4" />
            <span>{t('languageSettingsTitle')}</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div
              onClick={() => setLanguage('ar')}
              className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                language === 'ar'
                  ? 'bg-purple-950/40 border-purple-500 text-white shadow-md'
                  : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:border-slate-600'
              }`}
            >
              <div>
                <h4 className="font-bold text-sm text-white">العربية (Arabic)</h4>
                <p className="text-xs text-slate-400 mt-0.5">تفعيل واجهة كاملة باللغة العربية مع دعم RTL وتخطيط مناسب لليمين</p>
              </div>
              {language === 'ar' && <CheckCircle2 className="h-5 w-5 text-purple-400" />}
            </div>

            <div
              onClick={() => setLanguage('en')}
              className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                language === 'en'
                  ? 'bg-purple-950/40 border-purple-500 text-white shadow-md'
                  : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:border-slate-600'
              }`}
            >
              <div>
                <h4 className="font-bold text-sm text-white">English</h4>
                <p className="text-xs text-slate-400 mt-0.5">Full English interface with LTR layout and technical automotive standards</p>
              </div>
              {language === 'en' && <CheckCircle2 className="h-5 w-5 text-purple-400" />}
            </div>
          </div>
        </div>
      </div>

      {/* ESP32 Firmware Source Modal */}
      {showFirmwareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center gap-2">
                <Code className="h-5 w-5 text-cyan-400" />
                <h3 className="font-bold text-white text-base">
                  ESP32 Dual-Transport Firmware Source (Arduino / ESP-IDF C++)
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyFirmware}
                  className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>{copiedFirmware ? 'Copied!' : 'Copy Code'}</span>
                </button>
                <button
                  onClick={() => setShowFirmwareModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="p-4 overflow-y-auto flex-1 bg-slate-950 font-mono text-xs text-slate-300">
              <pre className="whitespace-pre overflow-x-auto">{ESP32_DUAL_TRANSPORT_FIRMWARE_INO}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
