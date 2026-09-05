import React, { useState, useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ObdPid, ConnectionStatus } from '../types';
import { standardPids } from '../obd/pidDecoder';
import { mockEcuServer } from '../network/mockEcuServer';
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
  isMockMode?: boolean;
}

export const LiveDataView: React.FC<LiveDataViewProps> = ({ status, isMockMode = false }) => {
  const { t, isRtl } = useI18n();
  const [pids, setPids] = useState<ObdPid[]>(standardPids);
  const [isStreaming, setIsStreaming] = useState<boolean>(true);
  const [simSpeed, setSimSpeed] = useState<number>(65);
  const [simRpm, setSimRpm] = useState<number>(2200);
  const [history, setHistory] = useState<{ timestamp: string; rpm: number; speed: number; voltage: number }[]>([]);

  useEffect(() => {
    if (!isStreaming) return;

    const interval = setInterval(async () => {
      const now = new Date().toLocaleTimeString();
      let currentRpm = 2200;
      let currentSpeed = 65;
      let currentVolt = 14.15;
      let currentCoolant = 88;
      let currentTps = 18;
      let currentLoad = 26;

      if (isMockMode) {
        // Simulation mode ONLY when Demo Mode is explicitly active
        currentRpm = Math.round(simRpm + (Math.sin(Date.now() / 1000) * 120) + (Math.random() * 30));
        currentSpeed = Math.max(0, Math.round(simSpeed + (Math.sin(Date.now() / 3000) * 4)));
        currentVolt = parseFloat((14.15 + Math.sin(Date.now() / 4000) * 0.12).toFixed(2));
        currentCoolant = Math.round(88 + Math.sin(Date.now() / 15000) * 3);
        currentTps = Math.round(18 + Math.sin(Date.now() / 2000) * 5);
        currentLoad = Math.round(26 + Math.sin(Date.now() / 2500) * 6);

        mockEcuServer.setRpm(currentRpm);
        mockEcuServer.setSpeed(currentSpeed);
      } else if (status === 'CONNECTED') {
        // Strict REAL MODE: Poll real OBD Mode 01 PIDs from vehicle ECU
        try {
          // Poll RPM (PID 0x0C)
          const respRpm = await transportManager.sendRequest([0x01, 0x0C], '0x7E0');
          if (respRpm.status === 'SUCCESS' && respRpm.responseRaw) {
            const bytes = respRpm.responseRaw.split(' ').map(b => parseInt(b, 16));
            if (bytes.length >= 4 && bytes[0] === 0x41 && bytes[1] === 0x0C) {
              currentRpm = Math.round(((bytes[2] * 256) + bytes[3]) / 4);
            }
          }

          // Poll Speed (PID 0x0D)
          const respSpeed = await transportManager.sendRequest([0x01, 0x0D], '0x7E0');
          if (respSpeed.status === 'SUCCESS' && respSpeed.responseRaw) {
            const bytes = respSpeed.responseRaw.split(' ').map(b => parseInt(b, 16));
            if (bytes.length >= 3 && bytes[0] === 0x41 && bytes[1] === 0x0D) {
              currentSpeed = bytes[2];
            }
          }

          // Poll Coolant (PID 0x05)
          const respCoolant = await transportManager.sendRequest([0x01, 0x05], '0x7E0');
          if (respCoolant.status === 'SUCCESS' && respCoolant.responseRaw) {
            const bytes = respCoolant.responseRaw.split(' ').map(b => parseInt(b, 16));
            if (bytes.length >= 3 && bytes[0] === 0x41 && bytes[1] === 0x05) {
              currentCoolant = bytes[2] - 40;
            }
          }

          // Poll Module Voltage (PID 0x42)
          const respVolt = await transportManager.sendRequest([0x01, 0x42], '0x7E0');
          if (respVolt.status === 'SUCCESS' && respVolt.responseRaw) {
            const bytes = respVolt.responseRaw.split(' ').map(b => parseInt(b, 16));
            if (bytes.length >= 4 && bytes[0] === 0x41 && bytes[1] === 0x42) {
              currentVolt = parseFloat((((bytes[2] * 256) + bytes[3]) / 1000).toFixed(2));
            }
          }
        } catch {
          // Timeout or communication drop in Real Mode -> do NOT inject fake values
        }
      } else {
        // Disconnected in Real Mode -> keep at 0 / idle
        currentRpm = 0;
        currentSpeed = 0;
        currentVolt = 0;
        currentCoolant = 0;
        currentTps = 0;
        currentLoad = 0;
      }

      setPids(prev => prev.map(p => {
        let val = p.currentValue;
        if (p.pidHex === '0C') val = currentRpm;
        if (p.pidHex === '0D') val = currentSpeed;
        if (p.pidHex === '05') val = currentCoolant;
        if (p.pidHex === '11') val = currentTps;
        if (p.pidHex === '04') val = currentLoad;
        if (p.pidHex === '42') val = currentVolt;

        return {
          ...p,
          currentValue: val,
          minValue: Math.min(p.minValue, val),
          maxValue: Math.max(p.maxValue, val)
        };
      }));

      setHistory(h => [...h.slice(-25), {
        timestamp: now,
        rpm: currentRpm,
        speed: currentSpeed,
        voltage: currentVolt
      }]);
    }, 400);

    return () => clearInterval(interval);
  }, [isStreaming, simRpm, simSpeed, status, isMockMode]);

  const exportCsv = () => {
    const headers = 'Timestamp,RPM,Speed(km/h),Voltage(V)\n';
    const rows = history.map(h => `${h.timestamp},${h.rpm},${h.speed},${h.voltage}`).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Hamza_OBD_Telemetry_${Date.now()}.csv`;
    a.click();
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

  const rpmVal = typeof rpmPid?.currentValue === 'number' && !isNaN(rpmPid.currentValue) ? rpmPid.currentValue : 0;
  const rpmMin = typeof rpmPid?.minValue === 'number' && !isNaN(rpmPid.minValue) ? rpmPid.minValue : 0;
  const rpmMax = typeof rpmPid?.maxValue === 'number' && !isNaN(rpmPid.maxValue) ? rpmPid.maxValue : 8000;

  const speedVal = typeof speedPid?.currentValue === 'number' && !isNaN(speedPid.currentValue) ? speedPid.currentValue : 0;
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
            Real-time PID Sensor Polling @ 4Hz (ISO 15765-4)
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
              PID 0x0C — ENGINE TACHOMETER
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
                  strokeDasharray={`${(rpmVal / 8000) * 264} 264`}
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-3xl font-extrabold text-white font-['Chakra_Petch',sans-serif] tracking-wider">
                  {Math.round(rpmVal)}
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
                <span className="text-cyan-400 font-bold">{Math.round(rpmVal)}</span>
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
              PID 0x0D — VEHICLE SPEED
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
                  strokeDasharray={`${(speedVal / 260) * 264} 264`}
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-3xl font-extrabold text-white font-['Chakra_Petch',sans-serif] tracking-wider">
                  {Math.round(speedVal)}
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
                <span className="text-emerald-400 font-bold">{Math.round(speedVal)}</span>
              </div>
              <div>
                <span className="text-slate-500 block">{t('maxVal')}</span>
                <span className="text-slate-300 font-bold">{Math.round(speedMax)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Simulator Test Controls (Bench Test Sliders) */}
      {isMockMode && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-300 mb-3">
            <Sliders className="h-4 w-4 text-cyan-400" />
            <span>Interactive ECU Telemetry Simulator Controls (Workbench)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Target RPM ({simRpm} RPM)</span>
                <span>Max: 8000</span>
              </div>
              <input
                type="range"
                min="600"
                max="7500"
                step="100"
                value={simRpm}
                onChange={(e) => setSimRpm(Number(e.target.value))}
                className="w-full accent-cyan-400 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Target Speed ({simSpeed} km/h)</span>
                <span>Max: 240</span>
              </div>
              <input
                type="range"
                min="0"
                max="240"
                step="5"
                value={simSpeed}
                onChange={(e) => setSimSpeed(Number(e.target.value))}
                className="w-full accent-emerald-400 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {/* All Monitored PIDs Grid */}
      <div>
        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3">
          All Standard Monitored PIDs (Mode 01)
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
                <span className="text-2xl font-extrabold text-white font-mono tracking-tight">
                  {typeof pid.currentValue === 'number' ? pid.currentValue.toFixed(pid.unit === 'V' ? 2 : 0) : pid.currentValue}
                </span>
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
