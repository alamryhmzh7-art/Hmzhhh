import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ConnectionStatus } from '../types';
import { UdsService, STANDARD_UDS_SERVICES, NRC_DICTIONARY } from '../uds/udsService';
import { transportManager } from '../network/TransportManager';
import { 
  Cpu, 
  Send, 
  CheckCircle2, 
  AlertOctagon, 
  Terminal, 
  Layers, 
  ShieldCheck,
  Zap,
  Info,
  Clock
} from 'lucide-react';

interface UdsViewProps {
  status: ConnectionStatus;
}

export const UdsView: React.FC<UdsViewProps> = ({ status }) => {
  const { t, isRtl } = useI18n();
  const [selectedServiceSid, setSelectedServiceSid] = useState<number>(0x22);
  const [targetCanId, setTargetCanId] = useState<string>('0x7E0');
  const [paramHex, setParamHex] = useState<string>('F1 90');
  const [udsConsoleLogs, setUdsConsoleLogs] = useState<{
    timestamp: string;
    targetCanId: string;
    requestHex: string;
    responseHex: string;
    isPositive: boolean;
    decodedText: string;
  }[]>([]);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);

  const selectedService = STANDARD_UDS_SERVICES.find(s => s.sid === selectedServiceSid) || STANDARD_UDS_SERVICES[0];

  const handleExecuteUds = async () => {
    setIsExecuting(true);
    const now = new Date().toLocaleTimeString();

    const paramBytes = paramHex
      .trim()
      .split(/\s+/)
      .filter(s => s.length > 0)
      .map(h => parseInt(h, 16) || 0);

    const fullRequestBytes = [selectedServiceSid, ...paramBytes];
    const reqHex = fullRequestBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

    try {
      const pkt = await transportManager.sendRequest(fullRequestBytes, targetCanId);
      const resBytes = pkt.responseRaw ? pkt.responseRaw.split(' ').map(h => parseInt(h, 16)) : [];
      const isPositive = resBytes.length > 0 && resBytes[0] !== 0x7F;

      let decoded = '';
      if (!isPositive && resBytes.length >= 3) {
        const nrcHex = resBytes[2].toString(16).padStart(2, '0').toUpperCase();
        const nrc = UdsService.decodeNrc(nrcHex);
        decoded = `[NRC 0x${nrcHex}] ${isRtl ? nrc.nameAr : nrc.nameEn}: ${isRtl ? nrc.descriptionAr : nrc.descriptionEn}`;
      } else {
        decoded = `Positive Response: Service 0x${selectedServiceSid.toString(16).toUpperCase()} Completed OK`;
        if (pkt.decodedData) {
          decoded += ` | Data: "${pkt.decodedData}"`;
        }
      }

      setUdsConsoleLogs(prev => [
        {
          timestamp: now,
          targetCanId,
          requestHex: reqHex,
          responseHex: pkt.responseRaw || 'NO RESPONSE',
          isPositive,
          decodedText: decoded
        },
        ...prev.slice(0, 40)
      ]);
    } catch (err: any) {
      setUdsConsoleLogs(prev => [
        {
          timestamp: now,
          targetCanId,
          requestHex: reqHex,
          responseHex: 'ERROR',
          isPositive: false,
          decodedText: err?.message || 'Execution failed'
        },
        ...prev.slice(0, 40)
      ]);
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
            <Cpu className="h-5 w-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white">
              {t('udsTitle')}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-400 border border-indigo-800 font-mono font-bold">
              ISO 14229 / ISO 15765
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Unified Diagnostic Services Command Builder & Negative Response Code (NRC) Decoder
          </p>
        </div>
      </div>

      {/* Control Panel Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Standard UDS Services List */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">
            ISO 14229 Standard Services
          </span>
          <div className="space-y-1.5 max-h-[460px] overflow-y-auto pr-1">
            {STANDARD_UDS_SERVICES.map((srv) => {
              const isSelected = selectedServiceSid === srv.sid;
              return (
                <button
                  key={srv.sid}
                  onClick={() => {
                    setSelectedServiceSid(srv.sid);
                    if (srv.sid === 0x10) setParamHex('03'); // Extended Session
                    if (srv.sid === 0x11) setParamHex('01'); // Hard Reset
                    if (srv.sid === 0x22) setParamHex('F1 90'); // Read VIN
                    if (srv.sid === 0x27) setParamHex('01'); // Request Seed
                    if (srv.sid === 0x31) setParamHex('01 02 11'); // Start Routine
                    if (srv.sid === 0x3E) setParamHex('00'); // TesterPresent
                  }}
                  className={`w-full text-left p-3 rounded-lg border transition-all flex items-center justify-between ${
                    isSelected
                      ? 'bg-indigo-950/60 border-indigo-500 text-white shadow-md'
                      : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-extrabold text-indigo-400">
                        0x{srv.sid.toString(16).padStart(2, '0').toUpperCase()}
                      </span>
                      <span className="text-xs font-bold truncate">
                        {isRtl ? srv.nameAr : srv.nameEn}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      {srv.subFunctions ? `${srv.subFunctions.length} Sub-functions` : 'Direct Payload'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Execution Form & Terminal */}
        <div className="lg:col-span-2 space-y-4">
          {/* Active Service Configuration Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
              <div>
                <span className="text-xs font-bold text-indigo-400 font-mono">
                  SERVICE 0x{selectedService.sid.toString(16).padStart(2, '0').toUpperCase()}
                </span>
                <h3 className="text-base font-bold text-white">
                  {isRtl ? selectedService.nameAr : selectedService.nameEn}
                </h3>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {selectedService.descriptionEn}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">
                  Target CAN Address (Tx ID)
                </label>
                <select
                  value={targetCanId}
                  onChange={(e) => setTargetCanId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="0x7E0">0x7E0 — Engine ECM</option>
                  <option value="0x7E1">0x7E1 — Transmission TCM</option>
                  <option value="0x7E2">0x7E2 — ABS / VSC / ESP</option>
                  <option value="0x7E3">0x7E3 — Airbag / SRS</option>
                  <option value="0x7E4">0x7E4 — Body Control BCM</option>
                  <option value="0x7E5">0x7E5 — Instrument Cluster</option>
                  <option value="0x720">0x720 — Steering EPS</option>
                  <option value="0x7DF">0x7DF — Functional Broadcast</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-400 block mb-1">
                  Sub-Function / DID / Parameter Bytes (HEX)
                </label>
                <input
                  type="text"
                  value={paramHex}
                  onChange={(e) => setParamHex(e.target.value)}
                  placeholder="e.g. 03 or F1 90"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-indigo-300 focus:outline-none focus:border-indigo-500 uppercase tracking-wider"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="text-xs font-mono text-slate-400">
                Payload Preview: <span className="text-white font-bold">0x{selectedService.sid.toString(16).toUpperCase()} {paramHex}</span>
              </div>

              <button
                onClick={handleExecuteUds}
                disabled={isExecuting}
                className="px-5 py-2.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-2 shadow-md shadow-indigo-950/60 transition-all disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{isExecuting ? t('connecting') : 'Send UDS Request'}</span>
              </button>
            </div>
          </div>

          {/* UDS Response Log Console */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs shadow-xl">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
              <span className="text-slate-400 font-bold flex items-center gap-2">
                <Terminal className="h-4 w-4 text-indigo-400" />
                UDS Exchange Console & NRC Diagnostic Monitor
              </span>
              <button
                onClick={() => setUdsConsoleLogs([])}
                className="text-[11px] text-slate-500 hover:text-white"
              >
                Clear
              </button>
            </div>

            <div className="max-h-[320px] overflow-y-auto space-y-2">
              {udsConsoleLogs.length === 0 ? (
                <div className="text-center py-8 text-slate-600 text-xs">
                  No UDS requests executed yet. Select a service above and click Send.
                </div>
              ) : (
                udsConsoleLogs.map((log, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                      log.isPositive
                        ? 'bg-slate-900 border-emerald-500/30 text-slate-200'
                        : 'bg-rose-950/20 border-rose-500/40 text-rose-300'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>[{log.timestamp}] Target: <strong className="text-white">{log.targetCanId}</strong></span>
                      <span className={`px-1.5 py-0.2 rounded font-bold ${log.isPositive ? 'text-emerald-400 bg-emerald-950' : 'text-rose-400 bg-rose-950'}`}>
                        {log.isPositive ? 'POS_ACK' : 'NEG_RESP (NRC)'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <div><span className="text-slate-500">TX:</span> <span className="text-indigo-400">{log.requestHex}</span></div>
                      <div><span className="text-slate-500">RX:</span> <span className="text-white font-bold">{log.responseHex}</span></div>
                    </div>
                    <div className="text-xs text-slate-300 pt-1 border-t border-slate-800">
                      {log.decodedText}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
