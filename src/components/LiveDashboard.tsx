import React, { useState, useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ConnectionStatus } from '../types';
import { transportManager } from '../network/TransportManager';
import { standardPids } from '../obd/pidDecoder';
import { Gauge } from './Gauge';
import { Activity, Zap, Thermometer, Flame, Wind, GaugeCircle } from 'lucide-react';

interface LiveDashboardProps {
  status: ConnectionStatus;
  isMockMode?: boolean;
}

export const LiveDashboard: React.FC<LiveDashboardProps> = ({ status }) => {
  const { t } = useI18n();
  const [rpm, setRpm] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [coolant, setCoolant] = useState<number | null>(null);
  const [load, setLoad] = useState<number | null>(null);
  const [throttle, setThrottle] = useState<number | null>(null);
  const [maf, setMaf] = useState<number | null>(null);
  const [intakeTemp, setIntakeTemp] = useState<number | null>(null);
  const [voltage, setVoltage] = useState<number | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    const pollInterval = setInterval(async () => {
      if (!isMounted || isPolling) return;
      setIsPolling(true);

      if (status === 'CONNECTED') {
        try {
          for (const p of standardPids) {
            if (!isMounted) break;
            const targetCanId = '0x7DF';
            const requestBytes = [0x01, parseInt(p.pidHex, 16)];
            
            try {
              const requestPromise = transportManager.sendRequest(requestBytes, targetCanId);
              const timeoutPromise = new Promise<any>((_, reject) => 
                setTimeout(() => reject(new Error('ECU_TIMEOUT')), 300)
              );
              
              const resp = await Promise.race([requestPromise, timeoutPromise]);

              if (resp.status === 'SUCCESS' && resp.responseRaw) {
                const rxBytes = resp.responseRaw.split(' ').map((x: string) => parseInt(x, 16));
                if (rxBytes.length >= 2 && rxBytes[0] === 0x41 && rxBytes[1] === parseInt(p.pidHex, 16)) {
                  const val = p.decode(rxBytes);
                  
                  // Proof chain logging
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
                } else {
                  throw new Error('INVALID_RX_DATA');
                }
              } else {
                throw new Error(resp.status || 'NO_DATA');
              }
            } catch (err: any) {
              console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                pid: p.pidHex,
                canTxId: targetCanId,
                txData: requestBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
                status: 'FAIL',
                error: err.message,
                source: 'REAL_CAN_RX'
              }));

              if (p.pidHex === '0C') setRpm(null);
              else if (p.pidHex === '0D') setSpeed(null);
              else if (p.pidHex === '05') setCoolant(null);
              else if (p.pidHex === '04') setLoad(null);
              else if (p.pidHex === '11') setThrottle(null);
              else if (p.pidHex === '10') setMaf(null);
              else if (p.pidHex === '0F') setIntakeTemp(null);
              else if (p.pidHex === '42') setVoltage(null);
            }
            // Add a short delay to prevent CAN bus overload
            await new Promise(r => setTimeout(r, 40));
          }
        } catch (e) {
          console.error('[LIVE-DASH] Polling error:', e);
        }
      } else {
        setRpm(null);
        setSpeed(null);
        setCoolant(null);
        setLoad(null);
        setThrottle(null);
        setMaf(null);
        setIntakeTemp(null);
        setVoltage(null);
      }

      if (isMounted) setIsPolling(false);
    }, 1000); // 800ms polling cycle to balance responsiveness and ECU bus load

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [status, isPolling]);

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
            status === 'CONNECTED'
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' 
              : 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400'
          }`}>
            <span className={`w-2 h-2 rounded-full ${status === 'CONNECTED' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            {status === 'CONNECTED' ? 'متصل بالسيارة (Real CAN Data)' : 'غير متصل (Disconnected)'}
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
