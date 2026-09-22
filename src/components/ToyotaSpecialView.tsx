import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ToyotaProcedure, TOYOTA_OEM_PROCEDURES } from '../vehicle/toyotaProcedures';
import { ConnectionStatus } from '../types';
import { transportManager } from '../network/TransportManager';
import { AppLogger } from '../logging/logger';
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

import { toyotaService, TOYOTA_ROUTINES, TOYOTA_DIDS, ToyotaRoutine, ToyotaDid } from '../services/toyotaService';

interface ToyotaSpecialViewProps {
  status: ConnectionStatus;
  batteryVoltage: number;
}

export const ToyotaSpecialView: React.FC<ToyotaSpecialViewProps> = ({ status, batteryVoltage }) => {
  const { t, isRtl } = useI18n();
  const [selectedRoutine, setSelectedRoutine] = useState<ToyotaRoutine>(TOYOTA_ROUTINES[0]);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [currentStepIdx, setCurrentStepIdx] = useState<number>(-1);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [showWarningModal, setShowWarningModal] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'ROUTINES' | 'DIDS'>('ROUTINES');
  const [didReadings, setDidReadings] = useState<Record<string, string>>({});
  const [readingDidId, setReadingDidId] = useState<string | null>(null);

  const handleStartProcedure = () => {
    setShowWarningModal(true);
  };

  const handleConfirmExecute = async () => {
    setShowWarningModal(false);
    setIsExecuting(true);
    setIsCompleted(false);
    setCurrentStepIdx(-1);

    try {
      const res = await toyotaService.executeRoutine(selectedRoutine);
      if (res.success) {
        setIsCompleted(true);
      } else {
        AppLogger.error(
          'PROTOCOL',
          'TOYOTA_PROCEDURE_FAIL',
          res.errorEn || 'Toyota routine failed',
          res.errorAr || 'فشلت عملية تنفيذ روتين تويوتا',
          `Routine: ${selectedRoutine.idHex}`
        );
      }
    } catch (err: any) {
      console.error('[TOYOTA-VIEW] Execution error:', err);
    } finally {
      setIsExecuting(false);
      setCurrentStepIdx(-1);
    }
  };

  const handleReadDid = async (did: ToyotaDid) => {
    setReadingDidId(did.idHex);
    try {
      const res = await toyotaService.readDid(did, '0x7E0');
      if (res.success) {
        setDidReadings(prev => ({
          ...prev,
          [did.idHex]: res.ascii || res.payloadHex || 'OK'
        }));
      } else {
        setDidReadings(prev => ({
          ...prev,
          [did.idHex]: isRtl ? 'لا توجد استجابة (Timeout)' : 'No Response'
        }));
      }
    } catch (err) {
      console.error('[TOYOTA-VIEW] DID read error:', err);
    } finally {
      setReadingDidId(null);
    }
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

      {/* Tabs */}
      <div className="flex border-b border-slate-800 gap-4">
        <button
          onClick={() => setActiveTab('ROUTINES')}
          className={`pb-2 text-xs font-bold transition-all border-b-2 ${
            activeTab === 'ROUTINES'
              ? 'border-red-500 text-red-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          {isRtl ? 'الروتينات والإجراءات القسرية (UDS 0x31)' : 'Special Routines (UDS 0x31)'}
        </button>
        <button
          onClick={() => setActiveTab('DIDS')}
          className={`pb-2 text-xs font-bold transition-all border-b-2 ${
            activeTab === 'DIDS'
              ? 'border-red-500 text-red-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          {isRtl ? 'قراءة المعرفات المخصصة DIDs (0x22)' : 'Special Toyota DIDs (0x22)'}
        </button>
      </div>

      {activeTab === 'ROUTINES' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Routines List */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">
              Toyota OEM Special Routines
            </span>
            <div className="space-y-2">
              {(TOYOTA_ROUTINES || []).map((routine) => {
                const isSelected = selectedRoutine.idHex === routine.idHex;
                return (
                  <button
                    key={routine.idHex}
                    onClick={() => {
                      setSelectedRoutine(routine);
                      setIsCompleted(false);
                    }}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'bg-red-950/40 border-red-500 text-white shadow-md'
                        : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <span className="text-[10px] font-mono text-red-400 font-bold mb-1 block">
                      {routine.targetEcuName} ({routine.targetEcuAddrHex})
                    </span>
                    <h4 className="font-bold text-xs text-white">
                      {isRtl ? routine.nameAr : routine.nameEn}
                    </h4>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Routine Details & 7-Step Sequence */}
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
              <div className="pb-3 border-b border-slate-800">
                <span className="text-xs font-mono text-red-400 font-bold">
                  TARGET ECU: {selectedRoutine.targetEcuName} ({selectedRoutine.targetEcuAddrHex})
                </span>
                <h3 className="text-lg font-bold text-white mt-1">
                  {isRtl ? selectedRoutine.nameAr : selectedRoutine.nameEn}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  {isRtl ? selectedRoutine.descriptionAr : selectedRoutine.descriptionEn}
                </p>
              </div>

              {/* Prerequisites */}
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-2">
                <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Info className="h-4 w-4" />
                  <span>Strict Workshop Prerequisites</span>
                </h4>
                <ul className="space-y-1.5 text-xs text-slate-300">
                  {((isRtl ? selectedRoutine.prerequisitesAr : selectedRoutine.prerequisitesEn) || []).map((prereq, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-cyan-400 font-bold">•</span>
                      <span>{prereq}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* 7-Step OEM Pipeline Sequence */}
              <div>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  7-Step OEM Command Execution Pipeline
                </h4>
                <div className="space-y-2 text-xs font-mono">
                  <div className="p-2.5 rounded bg-slate-800/80 border border-slate-700 flex justify-between items-center text-slate-300">
                    <span>1. Diagnostic Session Control</span>
                    <span className="text-indigo-400 font-bold">10 03 (Extended)</span>
                  </div>
                  {selectedRoutine.requiresSecurityAccess && (
                    <>
                      <div className="p-2.5 rounded bg-slate-800/80 border border-slate-700 flex justify-between items-center text-slate-300">
                        <span>2. Security Access Seed Request</span>
                        <span className="text-amber-400 font-bold">27 01</span>
                      </div>
                      <div className="p-2.5 rounded bg-slate-800/80 border border-slate-700 flex justify-between items-center text-slate-300">
                        <span>3. Security Access Key Unlock</span>
                        <span className="text-amber-400 font-bold">27 02 [KEY]</span>
                      </div>
                    </>
                  )}
                  <div className="p-2.5 rounded bg-slate-800/80 border border-slate-700 flex justify-between items-center text-slate-300">
                    <span>4. Disable DTC Logging</span>
                    <span className="text-purple-400 font-bold">85 02</span>
                  </div>
                  <div className="p-2.5 rounded bg-slate-900 border border-red-500/50 flex justify-between items-center text-red-300 font-bold">
                    <span>5. Routine Control Execute</span>
                    <span className="text-red-400">31 01 {selectedRoutine.idHex.replace('0x', '')}</span>
                  </div>
                  <div className="p-2.5 rounded bg-slate-800/80 border border-slate-700 flex justify-between items-center text-slate-300">
                    <span>6. Enable DTC Logging</span>
                    <span className="text-purple-400 font-bold">85 01</span>
                  </div>
                  <div className="p-2.5 rounded bg-slate-800/80 border border-slate-700 flex justify-between items-center text-slate-300">
                    <span>7. Clear Memory DTCs</span>
                    <span className="text-emerald-400 font-bold">14 FF FF FF</span>
                  </div>
                </div>
              </div>

              {/* Completed */}
              {isCompleted && (
                <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-4 flex items-center gap-3 text-emerald-400">
                  <CheckCircle2 className="h-6 w-6 shrink-0" />
                  <div>
                    <h4 className="font-bold text-sm">Toyota Routine Completed Successfully</h4>
                    <p className="text-xs text-slate-300">Calibration data saved in ECU EEPROM memory. Cycle ignition switch OFF and ON.</p>
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
      ) : (
        /* DIDs Tab */
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            {isRtl ? 'قراءة المعرفات الخاصة بتويوتا (Toyota Custom DIDs)' : 'Toyota Custom Data Identifiers (DIDs)'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(TOYOTA_DIDS || []).map((did) => {
              const isReadingThis = readingDidId === did.idHex;
              const val = didReadings[did.idHex];

              return (
                <div key={did.idHex} className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-red-400 font-extrabold">{did.idHex}</span>
                    <button
                      onClick={() => handleReadDid(did)}
                      disabled={isReadingThis}
                      className="px-3 py-1 rounded text-[11px] font-bold bg-red-600 hover:bg-red-500 text-white flex items-center gap-1.5"
                    >
                      {isReadingThis ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                      <span>{isRtl ? 'قراءة' : 'Read'}</span>
                    </button>
                  </div>
                  <div>
                    <h4 className="font-bold text-xs text-white">{isRtl ? did.nameAr : did.nameEn}</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">{isRtl ? did.descriptionAr : did.descriptionEn}</p>
                  </div>
                  {val && (
                    <div className="mt-2 p-2 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-emerald-400 font-bold">
                      Value: {val}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                {isRtl ? selectedRoutine.nameAr : selectedRoutine.nameEn}
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
