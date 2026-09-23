import React, { useState, useEffect } from 'react';
import logoImg from '../assets/images/hamza_obd_logo_1789331768510.jpg';
import { useI18n } from '../i18n/I18nContext';
import { ConnectionConfig, ConnectionStatus, TransportType, BluetoothDeviceInfo, CanBusStatus } from '../types';
import { transportManager } from '../network/TransportManager';
import { Wifi, Bluetooth, Activity, RefreshCw, CheckCircle2, XCircle, AlertTriangle, ShieldCheck, Radio, Server, Cpu, Zap, X, ExternalLink } from 'lucide-react';

interface ConnectionManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ConnectionConfig;
  status: ConnectionStatus;
  onUpdateConfig: (newConfig: Partial<ConnectionConfig>) => void;
}

export const ConnectionManagerModal: React.FC<ConnectionManagerModalProps> = ({
  isOpen,
  onClose,
  config,
  status,
  onUpdateConfig
}) => {
  const { t, isRtl } = useI18n();

  const [selectedTransport, setSelectedTransport] = useState<TransportType>(config.transportType || 'WIFI_TCP');
  const [ip, setIp] = useState<string>(config.ip || '192.168.4.1');
  const [port, setPort] = useState<number>(config.port || 35000);
  const [btDeviceName, setBtDeviceName] = useState<string>(config.bluetoothDeviceName || '');
  const [btMac, setBtMac] = useState<string>(config.bluetoothMacAddress || '');
  const [isScanningBt, setIsScanningBt] = useState<boolean>(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<BluetoothDeviceInfo[]>([]);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);

  // Ping & Diagnostic Test Results
  const [pingResult, setPingResult] = useState<{ success: boolean; latencyMs: number; info?: string } | null>(null);
  const [isPinging, setIsPinging] = useState<boolean>(false);
  const [canBusStatus, setCanBusStatus] = useState<CanBusStatus | null>(null);
  const [isTestingCan, setIsTestingCan] = useState<boolean>(false);
  const [klineStatus, setKlineStatus] = useState<{ voltagePresent?: boolean; activeProtocol?: number; initialized?: boolean; rxErrorCount?: number } | null>(null);
  const [isTestingKline, setIsTestingKline] = useState<boolean>(false);

  const loadInitialDevices = () => {
    let savedList: BluetoothDeviceInfo[] = [];
    try {
      const savedRaw = localStorage.getItem('hamza_obd_custom_bt_devices');
      if (savedRaw) savedList = JSON.parse(savedRaw);
    } catch (e) {}

    const listMap = new Map<string, BluetoothDeviceInfo>();
    savedList.forEach(d => {
      if (d.address) listMap.set(d.address.toUpperCase(), d);
    });

    if (config.bluetoothDeviceName && config.bluetoothMacAddress) {
      listMap.set(config.bluetoothMacAddress.toUpperCase(), {
        name: config.bluetoothDeviceName,
        address: config.bluetoothMacAddress,
        bonded: true,
        type: 'CLASSIC_SPP'
      });
    }

    setDiscoveredDevices(Array.from(listMap.values()));
  };

  useEffect(() => {
    if (isOpen) {
      setSelectedTransport(config.transportType || 'WIFI_TCP');
      setIp(config.ip || '192.168.4.1');
      setPort(config.port || 35000);
      setBtDeviceName(config.bluetoothDeviceName || 'ESP32-OBD-PRO');
      setBtMac(config.bluetoothMacAddress || '30:AE:A4:07:0B:42');
      loadInitialDevices();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const saveCustomDevice = (name: string, address: string) => {
    if (!name || !address) return;
    try {
      const savedRaw = localStorage.getItem('hamza_obd_custom_bt_devices');
      const savedList: BluetoothDeviceInfo[] = savedRaw ? JSON.parse(savedRaw) : [];
      if (!savedList.some(d => d.address.toUpperCase() === address.toUpperCase())) {
        savedList.push({
          name,
          address,
          bonded: true,
          rssi: -50,
          type: 'CLASSIC_SPP'
        });
        localStorage.setItem('hamza_obd_custom_bt_devices', JSON.stringify(savedList));
      }
    } catch (e) {
      console.warn('Failed to save custom device to localStorage:', e);
    }
  };

  const handleScanBtDevices = async () => {
    setIsScanningBt(true);
    try {
      if (btDeviceName && btMac) {
        saveCustomDevice(btDeviceName, btMac);
      }
      const devices = await transportManager.scanBluetoothDevices((newDev) => {
        setDiscoveredDevices(prev => {
          const idx = prev.findIndex(d => d.address.toUpperCase() === newDev.address.toUpperCase());
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = newDev;
            return updated;
          }
          return [...prev, newDev];
        });
      });
      if (devices && devices.length > 0) {
        setDiscoveredDevices(prev => {
          const map = new Map<string, BluetoothDeviceInfo>();
          prev.forEach(d => map.set(d.address.toUpperCase(), d));
          devices.forEach(d => map.set(d.address.toUpperCase(), d));
          return Array.from(map.values());
        });
      }
    } catch (err) {
      console.warn('[BT-SCAN] Error:', err);
    } finally {
      setIsScanningBt(false);
    }
  };

  const handleApplyTransportSwitch = async (type: TransportType) => {
    setSelectedTransport(type);
    onUpdateConfig({ transportType: type });
    await transportManager.setTransportType(type);
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    console.log('[BT-FLOW-v2] CONNECT BUTTON PRESSED');
    try {
      const newCfg: Partial<ConnectionConfig> = {
        transportType: selectedTransport,
        ip,
        port,
        bluetoothDeviceName: btDeviceName,
        bluetoothMacAddress: btMac
      };
      onUpdateConfig(newCfg);
      await transportManager.connect(newCfg);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await transportManager.disconnect();
    setPingResult(null);
    setCanBusStatus(null);
  };

  const handleRunPing = async () => {
    setIsPinging(true);
    try {
      const res = await transportManager.ping();
      setPingResult({
        success: res.success,
        latencyMs: res.latencyMs,
        info: res.info
      });
    } catch (e: any) {
      setPingResult({ success: false, latencyMs: 0, info: e?.message || 'Error' });
    } finally {
      setIsPinging(false);
    }
  };

  const handleTestCanBus = async () => {
    setIsTestingCan(true);
    try {
      const statusRes = await transportManager.getCanStatus();
      setCanBusStatus(statusRes);
    } catch {
      setCanBusStatus(null);
    } finally {
      setIsTestingCan(false);
    }
  };

  const handleTestKline = async () => {
    setIsTestingKline(true);
    try {
      const initRes = await transportManager.initKline(0x00);
      const statusRes = await transportManager.getKlineStatus();
      setKlineStatus(statusRes || { initialized: initRes.success, activeProtocol: initRes.activeProtocol });
    } catch {
      setKlineStatus(null);
    } finally {
      setIsTestingKline(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div 
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl overflow-hidden border border-cyan-500/30 bg-slate-900 shrink-0 shadow-md shadow-cyan-500/10">
              <img src={logoImg} alt="Hamza OBD Pro" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                Connection Manager
                <span className="text-xs font-normal px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  ESP32 Dual-Transport
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                {isRtl ? 'إدارة اتصالات Wi-Fi TCP و Bluetooth Classic SPP' : 'Manage Wi-Fi TCP and Bluetooth Classic SPP connections'}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
          
          {/* 1. Live Connection Status Banner */}
          <div className="space-y-2">
            <div className={`p-4 rounded-xl border flex items-center justify-between ${
              status === 'CONNECTED'
                ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                : status === 'CONNECTING'
                ? 'bg-amber-950/30 border-amber-500/40 text-amber-300'
                : status === 'ERROR'
                ? 'bg-rose-950/30 border-rose-500/40 text-rose-300'
                : 'bg-slate-800/60 border-slate-700 text-slate-300'
            }`}>
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full ${
                  status === 'CONNECTED' ? 'bg-emerald-400 animate-ping' :
                  status === 'CONNECTING' ? 'bg-amber-400 animate-pulse' :
                  status === 'ERROR' ? 'bg-rose-400' : 'bg-slate-500'
                }`} />
                <div>
                  <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
                    {isRtl ? 'حالة الاتصال الحالية' : 'Current Connection Status'}
                  </div>
                  <div className="text-base font-bold flex items-center gap-2">
                    {status}
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-900/80 font-mono text-cyan-400 border border-slate-700">
                      {selectedTransport === 'BLUETOOTH_SPP' ? 'Bluetooth SPP' : 'Wi-Fi TCP'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {status === 'CONNECTED' ? (
                  <button
                    onClick={handleDisconnect}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-lg"
                  >
                    {t('btnDisconnect')}
                  </button>
                ) : (
                  <button
                    onClick={handleConnect}
                    disabled={isConnecting}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all shadow-lg flex items-center gap-1.5"
                  >
                    {isConnecting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    {t('btnConnect')}
                  </button>
                )}
              </div>
            </div>

            {/* Error detail banner */}
            {status === 'ERROR' && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <div>
                    <div className="font-bold mb-0.5">
                      {isRtl ? 'تفاصيل الخطأ في الاتصال' : 'Connection Error Detail'}
                    </div>
                    <p className="text-[11px] text-rose-300 leading-relaxed font-mono">
                      {transportManager.getTransport().getRawConnectionState?.()?.error || (
                        isRtl ? 'تعذر الاتصال بالجهاز. تأكد من تشغيل القطعة أو فتح التطبيق في تبويب جديد.' : 'Failed to connect. Ensure device is powered or open app in new tab.'
                      )}
                    </p>
                  </div>

                  {/* Quick action buttons for user convenience */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-rose-900/50">
                    <button
                      type="button"
                      onClick={() => window.open(window.location.href, '_blank')}
                      className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[11px] transition-all flex items-center gap-1.5 shadow"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      {isRtl ? 'فتح التطبيق في تبويب جديد (Open in New Tab)' : 'Open in New Tab'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleApplyTransportSwitch('WIFI_TCP')}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-[11px] border border-slate-600 transition-all flex items-center gap-1"
                    >
                      <Wifi className="w-3.5 h-3.5 text-cyan-400" />
                      {isRtl ? 'التحويل إلى Wi-Fi TCP (192.168.4.1)' : 'Switch to Wi-Fi TCP'}
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        onUpdateConfig({ isMockMode: true });
                        transportManager.updateConfig({ isMockMode: true });
                        await transportManager.connect();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition-all flex items-center gap-1 shadow"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      {isRtl ? 'تفعيل الوضع المحاكي (Mock Mode)' : 'Enable Mock Mode'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 2. Connection Type Selector (Radio Pills) */}
          <div>
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block mb-2">
              {isRtl ? 'نوع وسيلة الاتصال (Connection Type)' : 'Connection Type'}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleApplyTransportSwitch('WIFI_TCP')}
                className={`p-3.5 rounded-xl border flex items-center gap-3 transition-all text-start ${
                  selectedTransport === 'WIFI_TCP'
                    ? 'bg-cyan-500/15 border-cyan-500 text-cyan-300 ring-1 ring-cyan-500'
                    : 'bg-slate-800/40 border-slate-700/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <div className={`p-2 rounded-lg ${selectedTransport === 'WIFI_TCP' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-500'}`}>
                  <Wifi className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                    Wi-Fi TCP Socket
                  </div>
                  <div className="text-xs text-slate-400 font-mono">192.168.4.1:35000</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleApplyTransportSwitch('BLUETOOTH_SPP')}
                className={`p-3.5 rounded-xl border flex items-center gap-3 transition-all text-start ${
                  selectedTransport === 'BLUETOOTH_SPP'
                    ? 'bg-blue-500/15 border-blue-500 text-blue-300 ring-1 ring-blue-500'
                    : 'bg-slate-800/40 border-slate-700/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <div className={`p-2 rounded-lg ${selectedTransport === 'BLUETOOTH_SPP' ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800 text-slate-500'}`}>
                  <Bluetooth className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                    Bluetooth Classic SPP
                  </div>
                  <div className="text-xs text-slate-400 font-mono">ESP32-OBD-PRO</div>
                </div>
              </button>
            </div>
          </div>

          {/* 3. Transport Specific Settings */}
          {selectedTransport === 'WIFI_TCP' ? (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-4 animate-in fade-in">
              <div className="flex items-center gap-2 text-xs font-bold text-cyan-400 uppercase tracking-wider">
                <Server className="w-4 h-4" />
                {isRtl ? 'إعدادات مقبس Wi-Fi TCP' : 'Wi-Fi TCP Socket Configuration'}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1.5">
                    ESP32 IP Address
                  </label>
                  <input
                    type="text"
                    value={ip}
                    onChange={(e) => setIp(e.target.value)}
                    placeholder="192.168.4.1"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1.5">
                    TCP Port
                  </label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    placeholder="35000"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                {isRtl ? 'افتراضيًا، يقوم ESP32 بإنشاء نقطة وصول SSID باسم ESP32-OBD-PRO وكلمة مرور 12345678' : 'By default, ESP32 creates Access Point SSID: ESP32-OBD-PRO (Pass: 12345678)'}
              </p>

              {typeof window !== 'undefined' && window.location && window.location.protocol === 'https:' && (
                <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-800/60 text-amber-300 text-[11px] leading-relaxed">
                  {isRtl
                    ? 'تنويه: الصفحة تعمل ببروتوكول HTTPS. إذا رفض المتصفح الاتصال اللاسلكي ws:// المباشر بسبب سياسات الأمان، يمكنك استخدام خيار البلوتوث (Web Serial/SPP) أو استخدام وضع المحاكاة.'
                    : 'Note: Page loaded over HTTPS. If browser blocks raw ws:// WebSocket, please use Bluetooth SPP / Web Serial or Mock Mode.'}
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-blue-400 uppercase tracking-wider">
                  <Bluetooth className="w-4 h-4" />
                  {isRtl ? 'أجهزة البلوتوث المكتشفة والمقترنة' : 'Discovered & Paired Bluetooth Devices'}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof navigator === 'undefined' || !('serial' in navigator)) {
                        alert(isRtl ? "متصفحك لا يدعم Web Serial API. استخدم Chrome أو Edge على الكمبيوتر." : "Your browser doesn't support Web Serial API. Use Chrome or Edge on Desktop.");
                        return;
                      }
                      alert(isRtl ? "للاتصال عبر الويب، الرجاء اختيار منفذ 'COM' الخاص بقطعة البلوتوث (OBD2) المقترنة مسبقاً بجهازك من النافذة التالية." : "To connect on the web, please select the 'COM' port of your paired Bluetooth OBD2 device from the next popup.");
                      handleConnect();
                    }}
                    className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"
                  >
                    <Radio className="w-3.5 h-3.5 animate-pulse" />
                    {isRtl ? 'اتصال الويب (Web Serial)' : 'WEB SERIAL'}
                  </button>
                  <button
                    type="button"
                    onClick={handleScanBtDevices}
                    disabled={isScanningBt}
                    className="px-3 py-1 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isScanningBt ? 'animate-spin' : ''}`} />
                    SCAN DEVICES
                  </button>
                </div>
              </div>

              {/* Devices List */}
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {(Array.isArray(discoveredDevices) ? discoveredDevices : []).length === 0 ? (
                  <div className="p-4 text-center rounded-lg bg-slate-900/40 border border-slate-800/80 text-xs text-slate-500">
                    {isRtl ? 'لم يتم العثور على أجهزة بلوتوث مقترنة. يرجى البحث أو الإدخال اليدوي أدناه.' : 'No Bluetooth devices discovered yet. Tap SCAN or use manual inputs below.'}
                  </div>
                ) : (
                  (Array.isArray(discoveredDevices) ? discoveredDevices : []).map((dev, idx) => {
                    const isSelected = btDeviceName === dev.name || btMac === dev.address;
                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          setBtDeviceName(dev.name);
                          setBtMac(dev.address);
                          onUpdateConfig({ bluetoothDeviceName: dev.name, bluetoothMacAddress: dev.address });
                        }}
                        className={`p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-blue-500/20 border-blue-500 text-blue-200'
                            : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Bluetooth className={`w-4 h-4 ${isSelected ? 'text-blue-400' : 'text-slate-500'}`} />
                          <div>
                            <div className="text-xs font-bold font-mono">{dev.name}</div>
                            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
                              <span>{dev.address}</span>
                              {dev.rssi !== undefined && dev.rssi !== -128 && (
                                <span className="text-[10px] text-slate-500 font-mono">({dev.rssi} dBm)</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30 font-mono">
                            {dev.type || 'CLASSIC_SPP'}
                          </span>
                          {dev.bonded ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-mono">
                              PAIRED
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 font-mono">
                              NEARBY
                            </span>
                          )}
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-blue-400" />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Manual Device overrides */}
              <div className="pt-3 border-t border-slate-800/80 space-y-3">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {isRtl ? 'إدخال يدوي لعنوان الماك والاسم (ESP32 / OBD)' : 'Manual Hardware Configurations (ESP32 / OBD)'}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 block mb-1">
                      Bluetooth Name
                    </label>
                    <input
                      type="text"
                      value={btDeviceName}
                      onChange={(e) => {
                        setBtDeviceName(e.target.value);
                        onUpdateConfig({ bluetoothDeviceName: e.target.value });
                      }}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 block mb-1">
                      MAC Address
                    </label>
                    <input
                      type="text"
                      value={btMac}
                      onChange={(e) => {
                        setBtMac(e.target.value);
                        onUpdateConfig({ bluetoothMacAddress: e.target.value });
                      }}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      saveCustomDevice(btDeviceName, btMac);
                      handleScanBtDevices();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1.5 transition-all"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {isRtl ? 'حفظ وإضافة جهازك الحقيقي للقائمة' : 'Save & Register Real Device'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 4. Hardware Diagnostic Test Matrix */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-400" />
              {isRtl ? 'مصفوفة اختبار الهاردوير (CAN + K-Line)' : 'Hardware Diagnostic Test Matrix (CAN + K-Line)'}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Ping Test Button */}
              <button
                type="button"
                onClick={handleRunPing}
                disabled={isPinging}
                className="p-3 rounded-xl bg-slate-900 border border-slate-700 hover:border-slate-600 text-start flex items-center justify-between transition-all"
              >
                <div>
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-cyan-400" />
                    PING TEST
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {pingResult ? `${pingResult.latencyMs}ms (${pingResult.info || 'OK'})` : 'Measure Latency'}
                  </div>
                </div>
                {isPinging ? (
                  <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />
                ) : pingResult?.success ? (
                  <span className="text-xs font-bold text-emerald-400 font-mono">{pingResult.latencyMs}ms</span>
                ) : (
                  <span className="text-xs text-slate-500 font-mono">Run</span>
                )}
              </button>

              {/* CAN Bus Status Test Button */}
              <button
                type="button"
                onClick={handleTestCanBus}
                disabled={isTestingCan}
                className="p-3 rounded-xl bg-slate-900 border border-slate-700 hover:border-slate-600 text-start flex items-center justify-between transition-all"
              >
                <div>
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                    CAN BUS
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {canBusStatus ? `CAN: ${canBusStatus.state} @ ${canBusStatus.speed / 1000}k` : 'Query TWAI State'}
                  </div>
                </div>
                {isTestingCan ? (
                  <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />
                ) : canBusStatus ? (
                  <span className="text-xs font-bold text-emerald-400 font-mono">READY</span>
                ) : (
                  <span className="text-xs text-slate-500 font-mono">Query</span>
                )}
              </button>

              {/* K-Line Hardware Test Button */}
              <button
                type="button"
                onClick={handleTestKline}
                disabled={isTestingKline}
                className="p-3 rounded-xl bg-slate-900 border border-slate-700 hover:border-slate-600 text-start flex items-center justify-between transition-all"
              >
                <div>
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    K-LINE BUS
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {klineStatus ? `K-Line: ${klineStatus.initialized ? 'INIT OK' : 'NO LINK'}` : 'ISO 9141 / KWP2000'}
                  </div>
                </div>
                {isTestingKline ? (
                  <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
                ) : klineStatus?.initialized ? (
                  <span className="text-xs font-bold text-amber-400 font-mono">READY</span>
                ) : (
                  <span className="text-xs text-slate-500 font-mono">Init</span>
                )}
              </button>
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/50">
          <div className="text-xs text-slate-400 font-mono">
            {selectedTransport === 'BLUETOOTH_SPP' ? `BT: ${btDeviceName}` : `TCP: ${ip}:${port}`}
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors"
          >
            {t('btnConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
};
