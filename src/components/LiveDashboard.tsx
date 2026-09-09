import React, { useState, useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ConnectionStatus } from '../types';
import { transportManager } from '../network/TransportManager';
import { mockEcuServer } from '../network/mockEcuServer';
import { Gauge, Activity, Zap, Thermometer, Flame, Wind, GaugeCircle, AlertCircle } from 'lucide-react';

interface LiveDashboardProps {
  status: ConnectionStatus;
  isMockMode?: boolean;
}

export const LiveDashboard: React.FC<LiveDashboardProps> = ({ status, isMockMode = false }) => {
  const { t } = useI18n();
  const [rpm, setRpm] = useState<number | null>(isMockMode ? 2200 : 0);
  const [speed, setSpeed] = useState<number | null>(isMockMode ? 65 : 0);
  const [coolant, setCoolant] = useState<number | null>(isMockMode ? 88 : 0);
  const [load, setLoad] = useState<number | null>(isMockMode ? 28 : 0);
  const [throttle, setThrottle] = useState<number | null>(isMockMode ? 18 : 0);
  const [maf, setMaf] = useState<number | null>(isMockMode ? 4.2 : 0);
  const [intakeTemp, setIntakeTemp] = useState<number | null>(isMockMode ? 32 : 0);
  const [voltage, setVoltage] = useState<number | null>(isMockMode ? 14.2 : 0);
  const [isPolling, setIsPolling] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    const pollInterval = setInterval(async () => {
      if (!isMounted || isPolling) return;
      setIsPolling(true);

      if (isMockMode) {
        const mockR = Math.round(2200 + Math.sin(Date.now() / 1000) * 300);
        const mockS = Math.max(0, Math.round(65 + Math.sin(Date.now() / 3000) * 10));
        setRpm(mockR);
        setSpeed(mockS);
        setCoolant(89);
        setLoad(32);
        setThrottle(20);
        setMaf(4.8);
        setIntakeTemp(33);
        setVoltage(14.1);
        mockEcuServer.setRpm(mockR);
        mockEcuServer.setSpeed(mockS);
      } else if (status === 'CONNECTED') {
        try {
          // Sequential PID requests with timeout
          const reqs = [
            { pid: [0x01, 0x0C], setter: setRpm, decode: (b: number[]) => (b.length >= 4 && b[0] === 0x41 && b[1] === 0x0C) ? Math.round(((b[2] * 256) + b[3]) / 4) : null },
            { pid: [0x01, 0x0D], setter: setSpeed, decode: (b: number[]) => (b.length >= 3 && b[0] === 0x41 && b[1] === 0x0D) ? b[2] : null },
            { pid: [0x01, 0x05], setter: setCoolant, decode: (b: number[]) => (b.length >= 3 && b[0] === 0x41 && b[1] === 0x05) ? b[2] - 40 : null },
            { pid: [0x01, 0x04], setter: setLoad, decode: (b: number[]) => (b.length >= 3 && b[0] === 0x41 && b[1] === 0x04) ? Math.round((b[2] * 100) / 255) : null },
            { pid: [0x01, 0x11], setter: setThrottle, decode: (b: number[]) => (b.length >= 3 && b[0] === 0x41 && b[1] === 0x11) ? Math.round((b[2] * 100) / 255) : null },
            { pid: [0x01, 0x42], setter: setVoltage, decode: (b: number[]) => (b.length >= 4 && b[0] === 0x41 && b[1] === 0x42) ? parseFloat((((b[2] * 256) + b[3]) / 1000).toFixed(2)) : null },
          ];

          for (const item of reqs) {
            if (!isMounted) break;
            const resp = await transportManager.sendRequest(item.pid, '0x7DF');
            if (resp.status === 'SUCCESS' && resp.responseRaw) {
              const bytes = resp.responseRaw.split(' ').map(x => parseInt(x, 16));
              const val = item.decode(bytes);
              if (val !== null) item.setter(val);
            }
          }
        } catch (e) {
          console.error('[LIVE-DASH] Polling error:', e);
        }
      }

      if (isMounted) setIsPolling(false);
    }, 800); // 800ms polling cycle to balance responsiveness and ECU bus load

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [status, isMockMode, isPolling]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Gauge className="w-7 h-7 text-blue-600" />
            لوحة القيادة الحية المتقدمة (Live Dashboard)
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            مراقبة فورية لأهم مؤشرات المحرك والأداء ديناميكياً مع فصل الترددات لتجنب حمل الناقل.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
            status === 'CONNECTED' || isMockMode 
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' 
              : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
          }`}>
            <span className={`w-2 h-2 rounded-full ${status === 'CONNECTED' || isMockMode ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
            {isMockMode ? 'وضع المحاكاة (Demo Mode)' : status === 'CONNECTED' ? 'متصل بالسيارة (Connected)' : 'غير متصل (Disconnected)'}
          </span>
        </div>
      </div>

      {/* Primary Instrument Cluster */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        
        {/* RPM Gauge Card */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="absolute top-4 left-4 text-slate-400">
            <Activity className="w-5 h-5 text-blue-500" />
          </div>
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">سرعة المحرك (RPM)</span>
          <div className="my-3 flex items-baseline gap-1">
            <span className="text-5xl font-black text-slate-900 dark:text-white tracking-tight">
              {rpm !== null ? rpm : '---'}
            </span>
            <span className="text-sm font-bold text-blue-600 dark:text-blue-400">RPM</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden mt-2">
            <div 
              className="bg-blue-600 h-full transition-all duration-300 rounded-full"
              style={{ width: `${Math.min(100, ((rpm || 0) / 7000) * 100)}%` }}
            />
          </div>
          <div className="flex justify-between w-full text-xs text-slate-400 mt-1">
            <span>0</span>
            <span>3500</span>
            <span>7000+</span>
          </div>
        </div>

        {/* Vehicle Speed Gauge Card */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="absolute top-4 left-4 text-slate-400">
            <GaugeCircle className="w-5 h-5 text-emerald-500" />
          </div>
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">سرعة المركبة (Speed)</span>
          <div className="my-3 flex items-baseline gap-1">
            <span className="text-5xl font-black text-slate-900 dark:text-white tracking-tight">
              {speed !== null ? speed : '---'}
            </span>
            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">km/h</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden mt-2">
            <div 
              className="bg-emerald-500 h-full transition-all duration-300 rounded-full"
              style={{ width: `${Math.min(100, ((speed || 0) / 240) * 100)}%` }}
            />
          </div>
          <div className="flex justify-between w-full text-xs text-slate-400 mt-1">
            <span>0</span>
            <span>120</span>
            <span>240</span>
          </div>
        </div>

        {/* Coolant Temp Card */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="absolute top-4 left-4 text-slate-400">
            <Thermometer className="w-5 h-5 text-amber-500" />
          </div>
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">حرارة التبريد (ECT)</span>
          <div className="my-3 flex items-baseline gap-1">
            <span className="text-5xl font-black text-slate-900 dark:text-white tracking-tight">
              {coolant !== null ? coolant : '---'}
            </span>
            <span className="text-sm font-bold text-amber-600 dark:text-amber-400">°C</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden mt-2">
            <div 
              className={`h-full transition-all duration-300 rounded-full ${(coolant || 0) > 105 ? 'bg-red-500' : 'bg-amber-500'}`}
              style={{ width: `${Math.min(100, (((coolant || 0) + 40) / 160) * 100)}%` }}
            />
          </div>
          <div className="flex justify-between w-full text-xs text-slate-400 mt-1">
            <span>-40°C</span>
            <span>90°C (Normal)</span>
            <span>120°C+</span>
          </div>
        </div>

        {/* Battery Voltage Card */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="absolute top-4 left-4 text-slate-400">
            <Zap className="w-5 h-5 text-purple-500" />
          </div>
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">جهد البطارية (Voltage)</span>
          <div className="my-3 flex items-baseline gap-1">
            <span className="text-5xl font-black text-slate-900 dark:text-white tracking-tight">
              {voltage !== null ? voltage : '---'}
            </span>
            <span className="text-sm font-bold text-purple-600 dark:text-purple-400">V</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden mt-2">
            <div 
              className="bg-purple-500 h-full transition-all duration-300 rounded-full"
              style={{ width: `${Math.min(100, (((voltage || 0) - 10) / 6) * 100)}%` }}
            />
          </div>
          <div className="flex justify-between w-full text-xs text-slate-400 mt-1">
            <span>10V</span>
            <span>12.6V</span>
            <span>16V</span>
          </div>
        </div>

      </div>

      {/* Secondary Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">حمل المحرك (Engine Load)</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{load !== null ? `${load} %` : '---'}</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600">
            <Flame className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">موضع الخانق (Throttle)</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{throttle !== null ? `${throttle} %` : '---'}</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600">
            <Activity className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">تدفق الهواء (MAF)</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{maf !== null ? `${maf} g/s` : '---'}</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center text-amber-600">
            <Wind className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">حرارة هواء السحب (IAT)</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{intakeTemp !== null ? `${intakeTemp} °C` : '---'}</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center text-purple-600">
            <Thermometer className="w-6 h-6" />
          </div>
        </div>

      </div>
    </div>
  );
};
