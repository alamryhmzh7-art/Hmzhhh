import React, { useState, useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ObdPid, ConnectionStatus } from '../types';
import { standardPids } from '../obd/pidDecoder';
import { transportManager } from '../network/TransportManager';
import { 
  Gauge, 
  Play, 
  Pause, 
  Download, 
  RotateCcw, 
  Sliders, 
  Flame, 
  Zap, 
  Activity, 
  CheckCircle,
  Thermometer,
  Percent,
  BatteryCharging
} from 'lucide-react';

interface LiveDataViewProps {
  status: ConnectionStatus;
  isMockMode?: boolean; // Kept for prop signature but ignored for logic
}

export const LiveDataView: React.FC<LiveDataViewProps> = ({ status }) => {
  const { t, isRtl } = useI18n();
  const [pids, setPids] = useState<ObdPid[]>(standardPids);
  const [isStreaming, setIsStreaming] = useState<boolean>(true);
  const [history, setHistory] = useState<{ timestamp: string; rpm: number; speed: number; voltage: number }[]>([]);

  useEffect(() => {
    if (!isStreaming) return;

    let isPolling = false;

    const interval = setInterval(async () => {
      if (isPolling) return; // Prevent overlapping poll cycles
      isPolling = true;

      const now = new Date().toLocaleTimeString();
      
      let currentRpm: number | null = null;
      let currentSpeed: number | null = null;
      let currentVolt: number | null = null;
      let currentCoolant: number | null = null;
      let currentTps: number | null = null;
      let currentLoad: number | null = null;

      const updatedValues: { [key: string]: number | null } = {};

      if (status === 'CONNECTED') {
        try {
          for (const p of standardPids) {
            if (!isStreaming) break;
            
            const targetCanId = '0x7DF';
            const requestBytes = [0x01, parseInt(p.pidHex, 16)];

            try {
              // Sequential request with explicit 250ms timeout per PID for REAL mode
              const requestPromise = transportManager.sendRequest(requestBytes, targetCanId);
              const timeoutPromise = new Promise<any>((_, reject) => 
                setTimeout(() => reject(new Error('PID_TIMEOUT')), 300)
              );
              
              const resp = await Promise.race([requestPromise, timeoutPromise]);
              if (resp && resp.status === 'SUCCESS' && resp.responseRaw) {
                const rxBytes = resp.responseRaw.split(' ').map((b: string) => parseInt(b, 16));
                
                if (rxBytes.length >= 2 && rxBytes[0] === 0x41 && rxBytes[1] === parseInt(p.pidHex, 16)) {
                  const val = p.decode(rxBytes);
                  updatedValues[p.pidHex] = val;
                  
                  // Strict proof chain logging
                  console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    pid: p.pidHex,
                    canTxId: targetCanId,
                    txData: requestBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
                    canRxId: resp.rxCanId || 'UNKNOWN',
                    rxData: resp.responseRaw,
                    decodedValue: val,
                    source: 'REAL_CAN_RX'
                  }));
                } else {
                  throw new Error('INVALID_RX_DATA');
                }
              } else {
                throw new Error(resp?.status || 'NO_DATA');
              }
            } catch (pidErr: any) {
              // Individual PID timeout or error
              updatedValues[p.pidHex] = null;
              
              console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                pid: p.pidHex,
                canTxId: targetCanId,
                txData: requestBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
                status: 'FAIL',
                error: pidErr.message,
                source: 'REAL_CAN_RX'
              }));
            }
            
            // Throttling delay between PIDs to prevent CAN bus flooding and UI frame drops
            await new Promise(r => setTimeout(r, 40));
          }
          currentRpm = updatedValues['0C'] !== undefined ? updatedValues['0C'] : null;
          currentSpeed = updatedValues['0D'] !== undefined ? updatedValues['0D'] : null;
          currentVolt = updatedValues['42'] !== undefined ? updatedValues['42'] : null;
          currentCoolant = updatedValues['05'] !== undefined ? updatedValues['05'] : null;
          currentTps = updatedValues['11'] !== undefined ? updatedValues['11'] : null;
          currentLoad = updatedValues['04'] !== undefined ? updatedValues['04'] : null;
        } catch (e: any) {
          console.error(`[POLL-ERROR] Cycle failed: ${e?.message}`);
        }
      }

      setPids(prev => prev.map(p => {
        const hasValue = updatedValues[p.pidHex] !== undefined && updatedValues[p.pidHex] !== null;
        const currentRetry = p.retryCount || 0;
        
        let newStatus = p.status || 'UNKNOWN';
        let newRetry = currentRetry;
        let val = p.currentValue;

        if (status === 'CONNECTED') {
          if (hasValue) {
            val = updatedValues[p.pidHex];
            newStatus = 'SUPPORTED';
            newRetry = 0;
          } else {
            newRetry = currentRetry + 1;
            if (newRetry >= 3) {
              newStatus = 'NOT_SUPPORTED';
              val = null;
            }
          }
        } else {
          val = null;
        }

        const numVal = typeof val === 'number' ? val : 0;

        return {
          ...p,
          currentValue: val,
          status: newStatus as any,
          retryCount: newRetry,
          minValue: val !== null ? Math.min(p.minValue, numVal) : p.minValue,
          maxValue: val !== null ? Math.max(p.maxValue, numVal) : p.maxValue
        };
      }));

      if (currentRpm !== null && currentSpeed !== null && currentVolt !== null) {
        setHistory(h => [...h.slice(-25), {
          timestamp: now,
          rpm: currentRpm as number,
          speed: currentSpeed as number,
          voltage: currentVolt as number
        }]);
      }
      
      isPolling = false;
    }, 1000); // Polling cycle every 1000ms

    return () => clearInterval(interval);
  }, [isStreaming, status]);

  const exportCsv = async () => {
    const headers = 'Timestamp,RPM,Speed(km/h),Voltage(V)\n';
    const rows = history.map(h => `${h.timestamp},${h.rpm},${h.speed},${h.voltage}`).join('\n');
    const csvData = headers + rows;
    
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
    const fileName = `HAMZA_OBD_PRO_LOG_${dateStr}_${timeStr}.csv`;

    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Toast } = await import('@capacitor/toast');
    const { Capacitor } = await import('@capacitor/core');

    if (Capacitor.isNativePlatform()) {
      try {
        const result = await Filesystem.writeFile({
          path: fileName,
          data: csvData,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
          recursive: true
        });
        await Toast.show({ 
          text: `تم حفظ سجل البيانات بنجاح: Documents/${fileName}`,
          duration: 'long'
        });
        console.log('File saved at:', result.uri);
      } catch (e: any) {
        await Toast.show({ 
          text: `فشل الحفظ: ${e.message}`,
          duration: 'long'
        });
      }
    } else {
      const blob = new Blob([csvData], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const resetMinMax = () => {
    setPids(prev => prev.map(p => ({
      ...p,
      minValue: p.currentValue,
      maxValue: p.currentValue
    })));
  };

  const rpmPid = pids.find(p => p.pidHex === '0C') || pids[0];
  const speedPid = pids.find(p => p.pidHex === '0D') || pids[1];
  const coolantPid = pids.find(p => p.pidHex === '05') || pids[2];
  const voltagePid = pids.find(p => p.pidHex === '42') || pids[5];

  const rpmVal = typeof rpmPid?.currentValue === 'number' && !isNaN(rpmPid.currentValue) ? rpmPid.currentValue : null;
  const rpmMin = typeof rpmPid?.minValue === 'number' && !isNaN(rpmPid.minValue) ? rpmPid.minValue : 0;
  const rpmMax = typeof rpmPid?.maxValue === 'number' && !isNaN(rpmPid.maxValue) ? rpmPid.maxValue : 8000;

  const speedVal = typeof speedPid?.currentValue === 'number' && !isNaN(speedPid.currentValue) ? speedPid.currentValue : null;
  const speedMin = typeof speedPid?.minValue === 'number' && !isNaN(speedPid.minValue) ? speedPid.minValue : 0;
  const speedMax = typeof speedPid?.maxValue === 'number' && !isNaN(speedPid.maxValue) ? speedPid.maxValue : 260;

  return (
    <div className="space-y-6 pb-12">
      {/* Action Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Gauge className="h-5 w-5 text-cyan-400" />
            {t('liveDataTitle')}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {isRtl ? 'استعلام تسلسلي لحساسات ECU بروتوكول (ISO 15765-4)' : 'Sequential ECU PID Polling (ISO 15765-4)'}
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <button
            onClick={() => setIsStreaming(!isStreaming)}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all shadow-md ${
              isStreaming 
                ? 'bg-amber-600 hover:bg-amber-500 text-white' 
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {isStreaming ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span>{isStreaming ? t('pauseStream') : t('startStream')}</span>
          </button>

          <button
            onClick={resetMinMax}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{t('resetMinMax')}</span>
          </button>

          <button
            onClick={exportCsv}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 flex items-center gap-1.5 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t('exportCsv')}</span>
          </button>
        </div>
      </div>

      {/* Primary Automotive Tachometer & Speedometer Gauges */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* RPM Tachometer */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider font-mono">
              PID 0x0C — {isRtl ? 'عدّاد دوران المحرك (Tachometer)' : 'ENGINE TACHOMETER'}
            </span>
            <span className="text-xs text-slate-400 font-mono">0 - 8000 RPM</span>
          </div>

          <div className="mt-4 flex flex-col items-center justify-center">
            <div className="relative w-48 h-48 flex items-center justify-center">
              {/* Circular Gauge Ring */}
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  className="stroke-slate-800"
                  strokeWidth="8"
                  fill="none"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  className="stroke-cyan-500 transition-all duration-300 ease-out"
                  strokeWidth="8"
                  strokeDasharray={`${(rpmVal !== null ? (rpmVal / 8000) * 264 : 0)} 264`}
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-3xl font-extrabold text-white font-['Chakra_Petch',sans-serif] tracking-wider">
                  {rpmVal !== null ? Math.round(rpmVal) : 'N/A'}
                </span>
                <span className="text-xs text-cyan-400 font-bold tracking-widest mt-1">
                  RPM
                </span>
              </div>
            </div>

            <div className="w-full grid grid-cols-3 gap-2 mt-4 text-center text-xs pt-3 border-t border-slate-800/80 font-mono">
              <div>
                <span className="text-slate-500 block">{t('minVal')}</span>
                <span className="text-slate-300 font-bold">{Math.round(rpmMin)}</span>
              </div>
              <div>
                <span className="text-slate-500 block">{t('currentVal')}</span>
                <span className="text-cyan-400 font-bold">{rpmVal !== null ? Math.round(rpmVal) : 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">{t('maxVal')}</span>
                <span className="text-slate-300 font-bold">{Math.round(rpmMax)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Speedometer */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider font-mono">
              PID 0x0D — {isRtl ? 'عدّاد سرعة المركبة (Speedometer)' : 'VEHICLE SPEED'}
            </span>
            <span className="text-xs text-slate-400 font-mono">0 - 260 km/h</span>
          </div>

          <div className="mt-4 flex flex-col items-center justify-center">
            <div className="relative w-48 h-48 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  className="stroke-slate-800"
                  strokeWidth="8"
                  fill="none"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  className="stroke-emerald-500 transition-all duration-300 ease-out"
                  strokeWidth="8"
                  strokeDasharray={`${(speedVal !== null ? (speedVal / 260) * 264 : 0)} 264`}
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-3xl font-extrabold text-white font-['Chakra_Petch',sans-serif] tracking-wider">
                  {speedVal !== null ? Math.round(speedVal) : 'N/A'}
                </span>
                <span className="text-xs text-emerald-400 font-bold tracking-widest mt-1">
                  km/h
                </span>
              </div>
            </div>

            <div className="w-full grid grid-cols-3 gap-2 mt-4 text-center text-xs pt-3 border-t border-slate-800/80 font-mono">
              <div>
                <span className="text-slate-500 block">{t('minVal')}</span>
                <span className="text-slate-300 font-bold">{Math.round(speedMin)}</span>
              </div>
              <div>
                <span className="text-slate-500 block">{t('currentVal')}</span>
                <span className="text-emerald-400 font-bold">{speedVal !== null ? Math.round(speedVal) : 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">{t('maxVal')}</span>
                <span className="text-slate-300 font-bold">{Math.round(speedMax)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* All Monitored PIDs Grid */}
      <div>
        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3">
          {isRtl ? 'جميع حساسات وقراءات OBD-II القياسية (Mode 01)' : 'All Standard Monitored PIDs (Mode 01)'}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {pids.map((pid) => (
            <div
              key={pid.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-300">
                  {isRtl ? pid.nameAr : pid.name}
                </span>
                <span className="font-mono text-[10px] text-cyan-400 bg-slate-800 px-1.5 py-0.5 rounded">
                  0x{pid.pidHex}
                </span>
              </div>

              <div className="my-3 flex items-baseline justify-between">
                {pid.status === 'NOT_SUPPORTED' ? (
                  <span className="text-xs font-bold text-amber-400 bg-amber-950/40 px-2 py-1 rounded border border-amber-800/50 font-mono">
                    {isRtl ? 'غير مدعوم من السيارة' : 'Not Supported'}
                  </span>
                ) : (
                  <span className="text-2xl font-extrabold text-white font-mono tracking-tight">
                    {pid.currentValue !== null 
                      ? (typeof pid.currentValue === 'number' 
                          ? pid.currentValue.toFixed(pid.unit === 'V' ? 2 : 0) 
                          : pid.currentValue) 
                      : 'N/A'}
                  </span>
                )}
                <span className="text-xs font-bold text-slate-400 font-mono">
                  {pid.unit}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-[11px] font-mono text-slate-400">
                <div>Min: <span className="text-slate-300">{pid.minValue}</span></div>
                <div className="text-right">Max: <span className="text-slate-300">{pid.maxValue}</span></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
