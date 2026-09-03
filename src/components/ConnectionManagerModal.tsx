import React, { useState, useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ConnectionConfig, ConnectionStatus, TransportType, BluetoothDeviceInfo, CanBusStatus } from '../types';
import { transportManager } from '../network/TransportManager';
import { Wifi, Bluetooth, Activity, RefreshCw, CheckCircle2, XCircle, AlertTriangle, ShieldCheck, Radio, Server, Cpu, Zap, X } from 'lucide-react';

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
  const [btDeviceName, setBtDeviceName] = useState<string>(config.bluetoothDeviceName || 'ESP32-OBD-PRO');
  const [btMac, setBtMac] = useState<string>(config.bluetoothMacAddress || '24:6F:28:B4:7A:1C');
  const [isScanningBt, setIsScanningBt] = useState<boolean>(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<BluetoothDeviceInfo[]>([]);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);

  // Ping & Diagnostic Test Results
  const [pingResult, setPingResult] = useState<{ success: boolean; latencyMs: number; info?: string } | null>(null);
  const [isPinging, setIsPinging] = useState<boolean>(false);
  const [canBusStatus, setCanBusStatus] = useState<CanBusStatus | null>(null);
  const [isTestingCan, setIsTestingCan] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedTransport(config.transportType || 'WIFI_TCP');
      setIp(config.ip || '192.168.4.1');
      setPort(config.port || 35000);
      setBtDeviceName(config.bluetoothDeviceName || 'ESP32-OBD-PRO');
      setBtMac(config.bluetoothMacAddress || '24:6F:28:B4:7A:1C');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const saveCustomDevice = (name: string, address: string) => {
    if (!name || !address) return;
    try {
      const savedRaw = localStorage.getItem('hamza_obd_custom_bt_devices');
      const savedList: BluetoothDeviceInfo[] = savedRaw ? JSON.parse(savedRaw) : [];
      if (!savedList.some(d => d.address === address)) {
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
    setDiscoveredDevices([]);
    try {
      // If we have manual inputs, make sure they are saved so they appear in this search!
      saveCustomDevice(btDeviceName, btMac);
      // Simulate/perform active scanning delay to let the spinner rotate and show real "Searching..."
      await new Promise(resolve => setTimeout(resolve, 2000));
      const devices = await transportManager.scanBluetoothDevices();
      setDiscoveredDevices(devices);
    } catch {
      setDiscoveredDevices([]);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div 
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Radio className="w-5 h-5" />
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
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-blue-400 uppercase tracking-wider">
                  <Bluetooth className="w-4 h-4" />
                  {isRtl ? 'أجهزة البلوتوث الكلاسيكي المقترنة' : 'Paired Bluetooth Classic Devices'}
                </div>
                <div className="flex items-center gap-2">
                  {typeof navigator !== 'undefined' && (navigator as any).bluetooth && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const device = await (navigator as any).bluetooth.requestDevice({
                            acceptAllDevices: true,
                            optionalServices: ['00001101-0000-1000-8000-00805f9b34fb']
                          });
                          if (device) {
                            const newDev: BluetoothDeviceInfo = {
                              name: device.name || 'Web Bluetooth Device',
                              address: device.id || 'Web-Device-ID',
                              bonded: true,
                              rssi: -50,
                              type: 'CLASSIC_SPP'
                            };
                            setDiscoveredDevices(prev => {
                              const exists = prev.some(d => d.address === newDev.address);
                              return exists ? prev : [newDev, ...prev];
                            });
                            setBtDeviceName(newDev.name);
                            setBtMac(newDev.address);
                            onUpdateConfig({ bluetoothDeviceName: newDev.name, bluetoothMacAddress: newDev.address });
                          }
                        } catch (err) {
                          console.warn('Web Bluetooth selection cancelled/failed:', err);
                        }
                      }}
                      className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"
                    >
                      <Radio className="w-3.5 h-3.5 animate-pulse" />
                      WEB BT
                    </button>
                  )}
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
                {discoveredDevices.length === 0 ? (
                  <div className="p-4 text-center rounded-lg bg-slate-900/40 border border-slate-800/80 text-xs text-slate-500">
                    {isRtl ? 'لم يتم العثور على أجهزة بلوتوث مقترنة. يرجى البحث أو الإدخال اليدوي أدناه.' : 'No Bluetooth devices discovered yet. Tap SCAN or use manual inputs below.'}
                  </div>
                ) : (
                  discoveredDevices.map((dev, idx) => {
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
                            <div className="text-[11px] text-slate-400 font-mono">{dev.address}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {dev.bonded && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-mono">
                              PAIRED
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
              {isRtl ? 'مصفوفة اختبار الاتصال والـ CAN (Test Matrix)' : 'Hardware & CAN Diagnostic Test Matrix'}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    {pingResult ? `${pingResult.latencyMs}ms (${pingResult.info || 'OK'})` : 'Measure Round-Trip Latency'}
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
                    CAN STATUS
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {canBusStatus ? `CAN: ${canBusStatus.state} @ ${canBusStatus.speed / 1000}k` : 'Query TWAI Controller State'}
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
