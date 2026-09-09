import React, { useState, useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ConnectionStatus } from '../types';
import { transportManager } from '../network/TransportManager';
import { mockEcuServer } from '../network/mockEcuServer';
import { standardPids } from '../obd/pidDecoder';
import { Gauge } from './Gauge';
import { Activity, Zap, Thermometer, Flame, Wind, GaugeCircle } from 'lucide-react';

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
          for (const p of standardPids) {
            if (!isMounted) break;
            const resp = await transportManager.sendRequest([0x01, parseInt(p.pidHex, 16)], '0x7DF');
            if (resp.status === 'SUCCESS' && resp.responseRaw) {
              const bytes = resp.responseRaw.split(' ').map(x => parseInt(x, 16));
              if (bytes.length >= 2 && bytes[0] === 0x41 && bytes[1] === parseInt(p.pidHex, 16)) {
                const val = p.decode(bytes);
                if (val !== null) {
                  if (p.pidHex === '0C') setRpm(val);
                  else if (p.pidHex === '0D') setSpeed(val);
                  else if (p.pidHex === '05') setCoolant(val);
                  else if (p.pidHex === '04') setLoad(val);
                  else if (p.pidHex === '11') setThrottle(val);
                  else if (p.pidHex === '10') setMaf(val);
                  else if (p.pidHex === '0F') setIntakeTemp(val);
                  else if (p.pidHex === '42') setVoltage(val);
                }
              }
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
        <Gauge
          label="سرعة المحرك (RPM)"
          value={rpm}
          min={0}
          max={8000}
          unit="RPM"
          color="stroke-blue-500"
          textColor="text-blue-400"
          warningThreshold={6000}
          criticalThreshold={7200}
          icon={<Activity className="w-5 h-5 text-blue-400" />}
        />

        {/* Vehicle Speed Gauge Card */}
        <Gauge
          label="سرعة المركبة (Speed)"
          value={speed}
          min={0}
          max={260}
          unit="km/h"
          color="stroke-emerald-500"
          textColor="text-emerald-400"
          warningThreshold={140}
          criticalThreshold={200}
          icon={<GaugeCircle className="w-5 h-5 text-emerald-400" />}
        />

        {/* Engine Load Gauge Card */}
        <Gauge
          label="حمل المحرك (Engine Load)"
          value={load}
          min={0}
          max={100}
          unit="%"
          color="stroke-cyan-500"
          textColor="text-cyan-400"
          warningThreshold={80}
          criticalThreshold={95}
          icon={<Flame className="w-5 h-5 text-cyan-400" />}
        />

        {/* Coolant Temp Card */}
        <Gauge
          label="حرارة التبريد (ECT)"
          value={coolant}
          min={-40}
          max={150}
          unit="°C"
          color="stroke-amber-500"
          textColor="text-amber-400"
          warningThreshold={100}
          criticalThreshold={115}
          icon={<Thermometer className="w-5 h-5 text-amber-400" />}
        />

      </div>

      {/* Secondary Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        
        {/* Battery Voltage */}
        <Gauge
          label="جهد البطارية (Voltage)"
          value={voltage}
          min={8}
          max={18}
          unit="V"
          color="stroke-purple-500"
          textColor="text-purple-400"
          warningThreshold={15.0}
          criticalThreshold={16.2}
          icon={<Zap className="w-5 h-5 text-purple-400" />}
        />

        {/* Throttle Position */}
        <Gauge
          label="موضع الخانق (Throttle)"
          value={throttle}
          min={0}
          max={100}
          unit="%"
          color="stroke-indigo-500"
          textColor="text-indigo-400"
          icon={<Activity className="w-5 h-5 text-indigo-400" />}
        />

        {/* Mass Air Flow */}
        <Gauge
          label="تدفق الهواء (MAF)"
          value={maf}
          min={0}
          max={200}
          unit="g/s"
          color="stroke-teal-500"
          textColor="text-teal-400"
          icon={<Wind className="w-5 h-5 text-teal-400" />}
        />

        {/* Intake Air Temp */}
        <Gauge
          label="حرارة هواء السحب (IAT)"
          value={intakeTemp}
          min={-40}
          max={120}
          unit="°C"
          color="stroke-rose-500"
          textColor="text-rose-400"
          icon={<Thermometer className="w-5 h-5 text-rose-400" />}
        />

      </div>
    </div>
  );
};
