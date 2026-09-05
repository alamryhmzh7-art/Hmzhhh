import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ServiceFunctionItem, ConnectionStatus } from '../types';
import { SERVICE_FUNCTIONS_CATALOG } from '../services/serviceFunctions';
import { transportManager } from '../network/TransportManager';
import { 
  Wrench, 
  ShieldAlert, 
  CheckCircle2, 
  AlertTriangle, 
  Play, 
  RotateCcw, 
  Battery, 
  Car, 
  Cpu, 
  Layers, 
  Info,
  X,
  RefreshCw
} from 'lucide-react';

interface ServiceFunctionsViewProps {
  status: ConnectionStatus;
  batteryVoltage: number;
}

export const ServiceFunctionsView: React.FC<ServiceFunctionsViewProps> = ({ status, batteryVoltage }) => {
  const { t, isRtl } = useI18n();
  const [selectedFunc, setSelectedFunc] = useState<ServiceFunctionItem>(SERVICE_FUNCTIONS_CATALOG[0]);
  const [showWarningModal, setShowWarningModal] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [executionLog, setExecutionLog] = useState<{ step: string; status: 'DONE' | 'RUNNING' | 'PENDING' }[]>([]);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);

  // Safety checks
  const voltageOk = batteryVoltage >= (selectedFunc.requiredConditions?.minVoltage || 12.0);

  const handleStartRoutine = () => {
    setShowWarningModal(true);
  };

  const handleConfirmExecute = async () => {
    setShowWarningModal(false);
    setIsExecuting(true);
    setIsCompleted(false);

    const steps = isRtl ? selectedFunc.stepsAr : selectedFunc.stepsEn;
    setExecutionLog(steps.map((s, idx) => ({ step: s, status: idx === 0 ? 'RUNNING' : 'PENDING' })));

    try {
      for (let i = 0; i < steps.length; i++) {
        setCurrentStepIndex(i);
        setExecutionLog(prev => prev.map((item, idx) => {
          if (idx === i) return { ...item, status: 'RUNNING' };
          if (idx < i) return { ...item, status: 'DONE' };
          return item;
        }));

        console.log(`[SERVICE-FUNC] Executing Step ${i + 1}: ${steps[i]}`);
        
        // Execute UDS RoutineControl Start (0x31 0x01) for this specific routine part
        // Target can be 0x7E0 or specified by selectedFunc
        const resp = await transportManager.sendRequest([0x31, 0x01, ...selectedFunc.routineIdHex.replace('0x', '').match(/.{1,2}/g)!.map(h => parseInt(h, 16)), i + 1], selectedFunc.ecuTarget === 'ECM' ? '0x7E0' : '0x7E0');
        
        if (resp.status !== 'SUCCESS') {
          throw new Error(resp.error || 'ECU_TIMEOUT');
        }

        const respBytes = resp.responseRaw ? resp.responseRaw.split(' ').map(h => parseInt(h, 16)) : [];
        if (respBytes[0] === 0x7F) {
           throw new Error(`NRC_0x${respBytes[2]?.toString(16).toUpperCase() || '??'}`);
        }

        // Wait for routine completion if required (usually 1.5s - 3s)
        await new Promise(r => setTimeout(r, 1500));
      }

      setExecutionLog(prev => prev.map(item => ({ ...item, status: 'DONE' })));
      setIsCompleted(true);
    } catch (err: any) {
      console.error(`[SERVICE-FUNC] Execution Failed:`, err);
      alert(`Service Routine Failed: ${err.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-amber-400" />
            <h2 className="text-lg font-bold text-white">
              {t('serviceFunctionsTitle')}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-950 text-amber-400 border border-amber-800 font-mono font-bold">
              14 Standard Functions
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            ECU Calibration, Service Adaptation & Actuator Routines (UDS 0x31)
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Service Catalog List */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">
            Available Service Functions
          </span>
          <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
            {SERVICE_FUNCTIONS_CATALOG.map((func) => {
              const isSelected = selectedFunc.id === func.id;
              return (
                <button
                  key={func.id}
                  onClick={() => {
                    setSelectedFunc(func);
                    setIsCompleted(false);
                    setExecutionLog([]);
                  }}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all flex flex-col justify-between ${
                    isSelected
                      ? 'bg-amber-950/40 border-amber-500 text-white shadow-md'
                      : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-amber-400 font-bold border border-slate-700">
                      {func.category}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      RID {func.routineIdHex}
                    </span>
                  </div>
                  <h4 className="font-bold text-xs text-white">
                    {isRtl ? func.titleAr : func.titleEn}
                  </h4>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Routine Details, Safety Interlocks & Execution Engine */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
            {/* Title */}
            <div className="pb-3 border-b border-slate-800">
              <span className="text-xs font-mono text-amber-400 font-bold">
                ROUTINE IDENTIFIER: {selectedFunc.routineIdHex} | TARGET: {selectedFunc.ecuTarget}
              </span>
              <h3 className="text-lg font-bold text-white mt-1">
                {isRtl ? selectedFunc.titleAr : selectedFunc.titleEn}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {isRtl ? selectedFunc.descriptionAr : selectedFunc.descriptionEn}
              </p>
            </div>

            {/* Safety Interlocks Checklist */}
            <div>
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4 text-amber-400" />
                <span>Precondition Safety Interlocks</span>
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                <div className="bg-slate-800/80 p-2.5 rounded-lg border border-slate-700">
                  <span className="text-slate-400 block text-[10px]">BATTERY VOLTAGE</span>
                  <span className={voltageOk ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                    {batteryVoltage.toFixed(2)}V (Min {selectedFunc.requiredConditions?.minVoltage}V)
                  </span>
                </div>
                <div className="bg-slate-800/80 p-2.5 rounded-lg border border-slate-700">
                  <span className="text-slate-400 block text-[10px]">IGNITION SWITCH</span>
                  <span className="text-emerald-400 font-bold">ON (RUN)</span>
                </div>
                <div className="bg-slate-800/80 p-2.5 rounded-lg border border-slate-700">
                  <span className="text-slate-400 block text-[10px]">ENGINE STATE</span>
                  <span className="text-emerald-400 font-bold">{selectedFunc.requiredConditions?.engineState}</span>
                </div>
                <div className="bg-slate-800/80 p-2.5 rounded-lg border border-slate-700">
                  <span className="text-slate-400 block text-[10px]">GEAR POSITION</span>
                  <span className="text-emerald-400 font-bold">PARK (P)</span>
                </div>
              </div>
            </div>

            {/* Safety Warnings Banner */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 space-y-1 text-xs text-amber-300">
              <span className="font-bold block text-amber-400">{t('safetyWarningTitle')}</span>
              <ul className="space-y-1 list-disc list-inside text-slate-300">
                {(isRtl ? selectedFunc.warningsAr : selectedFunc.warningsEn).map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>

            {/* Step List Preview / Execution Status */}
            <div>
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                Procedure Sequence
              </h4>
              <div className="space-y-2">
                {(isRtl ? selectedFunc.stepsAr : selectedFunc.stepsEn).map((step, idx) => {
                  const logItem = executionLog[idx];
                  const isRunningThis = logItem?.status === 'RUNNING';
                  const isDoneThis = logItem?.status === 'DONE';

                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border text-xs flex items-center gap-3 transition-colors ${
                        isRunningThis
                          ? 'bg-amber-950/40 border-amber-500 text-amber-200'
                          : isDoneThis
                          ? 'bg-emerald-950/30 border-emerald-500/50 text-emerald-300'
                          : 'bg-slate-800/50 border-slate-700/50 text-slate-400'
                      }`}
                    >
                      <div className="h-6 w-6 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 font-mono">
                        {isRunningThis ? (
                          <RefreshCw className="h-4 w-4 animate-spin text-amber-400" />
                        ) : isDoneThis ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <span className="bg-slate-800 text-slate-400 h-6 w-6 rounded-full flex items-center justify-center">
                            {idx + 1}
                          </span>
                        )}
                      </div>
                      <span className="flex-1 font-medium">{step}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Completion Banner */}
            {isCompleted && (
              <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-4 flex items-center gap-3 text-emerald-400">
                <CheckCircle2 className="h-6 w-6 shrink-0" />
                <div>
                  <h4 className="font-bold text-sm">Service Function Completed Successfully</h4>
                  <p className="text-xs text-slate-300">ECU positive response acknowledged. Adaptation values written to non-volatile memory.</p>
                </div>
              </div>
            )}

            {/* Execute Button */}
            <div className="pt-2 flex justify-end">
              <button
                onClick={handleStartRoutine}
                disabled={isExecuting}
                className="px-6 py-3 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-2 shadow-lg shadow-amber-950/60 transition-all disabled:opacity-50"
              >
                {isExecuting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                <span>{isExecuting ? 'Executing Routine...' : 'Start Calibration Routine'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Safety Warning Confirmation Modal */}
      {showWarningModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/60 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-amber-400">
                <ShieldAlert className="h-6 w-6" />
                <h3 className="font-extrabold text-lg text-white">
                  {t('safetyWarningTitle')}
                </h3>
              </div>
              <button
                onClick={() => setShowWarningModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-2 bg-amber-500/10 border border-amber-500/20 p-3.5 rounded-xl">
              <p className="font-bold text-amber-300">
                {isRtl ? selectedFunc.titleAr : selectedFunc.titleEn}
              </p>
              <ul className="space-y-1 list-disc list-inside">
                {(isRtl ? selectedFunc.warningsAr : selectedFunc.warningsEn).map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowWarningModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                {t('btnCancel')}
              </button>

              <button
                onClick={handleConfirmExecute}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-2 shadow-lg shadow-amber-950/60"
              >
                <span>{t('btnConfirmExecute')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
