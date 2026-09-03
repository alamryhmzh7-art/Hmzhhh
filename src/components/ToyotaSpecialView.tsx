import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ToyotaProcedure, TOYOTA_OEM_PROCEDURES } from '../vehicle/toyotaProcedures';
import { ConnectionStatus } from '../types';
import { defaultTcpClient } from '../network/TcpClient';
import { 
  Car, 
  Play, 
  CheckCircle2, 
  ShieldAlert, 
  RefreshCw, 
  Zap, 
  Info, 
  Thermometer, 
  RotateCcw,
  Sliders,
  X
} from 'lucide-react';

interface ToyotaSpecialViewProps {
  status: ConnectionStatus;
  batteryVoltage: number;
}

export const ToyotaSpecialView: React.FC<ToyotaSpecialViewProps> = ({ status, batteryVoltage }) => {
  const { t, isRtl } = useI18n();
  const [selectedProc, setSelectedProc] = useState<ToyotaProcedure>(TOYOTA_OEM_PROCEDURES[0]);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [currentStepIdx, setCurrentStepIdx] = useState<number>(-1);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [showWarningModal, setShowWarningModal] = useState<boolean>(false);

  const handleStartProcedure = () => {
    setShowWarningModal(true);
  };

  const handleConfirmExecute = async () => {
    setShowWarningModal(false);
    setIsExecuting(true);
    setIsCompleted(false);

    for (let i = 0; i < selectedProc.commandSequence.length; i++) {
      setCurrentStepIdx(i);
      const cmd = selectedProc.commandSequence[i];
      const bytes = cmd.requestHex.split(' ').map(h => parseInt(h, 16));

      await defaultTcpClient.sendRequest(bytes, selectedProc.targetEcuAddrHex);
      await new Promise(r => setTimeout(r, cmd.delayMs));
    }

    setIsExecuting(false);
    setIsCompleted(true);
    setCurrentStepIdx(-1);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Car className="h-5 w-5 text-red-500" />
            <h2 className="text-lg font-bold text-white">
              {t('toyotaTitle')}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-950 text-red-400 border border-red-800 font-mono font-bold">
              Toyota & Lexus Techstream OEM
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Specialized OEM Service Routines for Toyota / Lexus ECUs (Camry, Land Cruiser, Corolla, ES350, Prado)
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Procedures List */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">
            Toyota OEM Special Routines
          </span>
          <div className="space-y-2">
            {TOYOTA_OEM_PROCEDURES.map((proc) => {
              const isSelected = selectedProc.id === proc.id;
              return (
                <button
                  key={proc.id}
                  onClick={() => {
                    setSelectedProc(proc);
                    setIsCompleted(false);
                  }}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all flex flex-col justify-between ${
                    isSelected
                      ? 'bg-red-950/40 border-red-500 text-white shadow-md'
                      : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <span className="text-[10px] font-mono text-red-400 font-bold mb-1 block">
                    {proc.targetEcu} ({proc.targetEcuAddrHex})
                  </span>
                  <h4 className="font-bold text-xs text-white">
                    {isRtl ? proc.nameAr : proc.nameEn}
                  </h4>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Procedure Guide & Execution */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
            <div className="pb-3 border-b border-slate-800">
              <span className="text-xs font-mono text-red-400 font-bold">
                TARGET ECU: {selectedProc.targetEcu} ({selectedProc.targetEcuAddrHex})
              </span>
              <h3 className="text-lg font-bold text-white mt-1">
                {isRtl ? selectedProc.nameAr : selectedProc.nameEn}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {isRtl ? selectedProc.descriptionAr : selectedProc.descriptionEn}
              </p>
            </div>

            {/* Prerequisites */}
            <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-2">
              <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <Info className="h-4 w-4" />
                <span>Strict Workshop Prerequisites</span>
              </h4>
              <ul className="space-y-1.5 text-xs text-slate-300">
                {(isRtl ? selectedProc.prerequisitesAr : selectedProc.prerequisitesEn).map((prereq, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-cyan-400 font-bold">•</span>
                    <span>{prereq}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Execution Sequence & Status */}
            <div>
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                Command Execution Pipeline
              </h4>
              <div className="space-y-2">
                {selectedProc.commandSequence.map((cmd, idx) => {
                  const isRunningThis = currentStepIdx === idx;
                  const isDoneThis = currentStepIdx > idx || isCompleted;

                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
                        isRunningThis
                          ? 'bg-red-950/40 border-red-500 text-red-200'
                          : isDoneThis
                          ? 'bg-emerald-950/30 border-emerald-500/50 text-emerald-300'
                          : 'bg-slate-800/40 border-slate-700/40 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {isRunningThis ? (
                          <RefreshCw className="h-4 w-4 animate-spin text-red-400" />
                        ) : isDoneThis ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <span className="h-5 w-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-mono">
                            {idx + 1}
                          </span>
                        )}
                        <span className="font-medium">{cmd.description}</span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-400">
                        HEX: {cmd.requestHex}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Completed */}
            {isCompleted && (
              <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-4 flex items-center gap-3 text-emerald-400">
                <CheckCircle2 className="h-6 w-6 shrink-0" />
                <div>
                  <h4 className="font-bold text-sm">Toyota Procedure Completed Successfully</h4>
                  <p className="text-xs text-slate-300">Calibration data saved in Skid Control / ECM memory. Cycle ignition switch OFF and ON.</p>
                </div>
              </div>
            )}

            {/* Execute Button */}
            <div className="pt-2 flex justify-end">
              <button
                onClick={handleStartProcedure}
                disabled={isExecuting}
                className="px-6 py-3 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-500 text-white flex items-center gap-2 shadow-lg shadow-red-950/60 transition-all disabled:opacity-50"
              >
                {isExecuting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                <span>{isExecuting ? 'Running Procedure...' : 'Execute Toyota Routine'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Safety Warning Modal */}
      {showWarningModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-500/60 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-red-400">
                <ShieldAlert className="h-6 w-6" />
                <h3 className="font-extrabold text-lg text-white">
                  Confirm Toyota OEM Calibration
                </h3>
              </div>
              <button
                onClick={() => setShowWarningModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-2 bg-red-500/10 border border-red-500/20 p-3.5 rounded-xl">
              <p className="font-bold text-red-300">
                {isRtl ? selectedProc.nameAr : selectedProc.nameEn}
              </p>
              <p>
                Ensure vehicle is on level ground, steering is centered, and no shaking occurs during sensor zero-point calibration.
              </p>
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
                className="px-4 py-2 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-500 text-white flex items-center gap-2 shadow-lg shadow-red-950/60"
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
