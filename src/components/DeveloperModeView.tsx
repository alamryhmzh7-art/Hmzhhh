import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ConnectionStatus } from '../types';
import { transportManager } from '../network/TransportManager';
import { 
  Terminal, 
  Send, 
  Trash2, 
  Bug, 
  Zap, 
  Cpu, 
  AlertTriangle, 
  ShieldAlert, 
  Layers,
  Clock
} from 'lucide-react';

interface DeveloperModeViewProps {
  status: ConnectionStatus;
}

export const DeveloperModeView: React.FC<DeveloperModeViewProps> = ({ status }) => {
  const { t, isRtl } = useI18n();
  const [commandText, setCommandText] = useState<string>('01 00');
  const [targetCanId, setTargetCanId] = useState<string>('0x7DF');
  const [consoleHistory, setConsoleHistory] = useState<{ timestamp: string; type: 'TX' | 'RX' | 'SYS' | 'ERR'; text: string }[]>([
    { timestamp: new Date().toLocaleTimeString(), type: 'SYS', text: 'HAMZA OBD PRO — Engineering Diagnostic Shell Initialized' },
    { timestamp: new Date().toLocaleTimeString(), type: 'SYS', text: 'Hardware: ESP32-WROOM-32 | CAN Controller: TWAI @ 500k | Driver: SN65HVD230' }
  ]);
  const [isInjecting, setIsInjecting] = useState<boolean>(false);

  const handleSendCommand = async () => {
    if (!commandText.trim()) return;
    const now = new Date().toLocaleTimeString();
    const cleanCmd = commandText.trim().toUpperCase();

    // Log TX
    setConsoleHistory(prev => [...prev, { timestamp: now, type: 'TX', text: `[${targetCanId}] > ${cleanCmd}` }]);

    // Check if AT command
    if (cleanCmd.startsWith('AT')) {
      let resp = 'OK';
      if (cleanCmd === 'ATZ') resp = 'ELM327 v1.5 / HAMZA PRO v2.5';
      if (cleanCmd === 'ATI') resp = 'HAMZA ESP32 OBD2 INTERFACE 2025';
      if (cleanCmd === 'ATDP') resp = 'ISO 15765-4 (CAN 11/500)';
      if (cleanCmd === 'ATRV') resp = '14.15V';

      setConsoleHistory(prev => [...prev, { timestamp: now, type: 'RX', text: resp }]);
      setCommandText('');
      return;
    }

    // Hex payload
    const bytes = cleanCmd.split(/\s+/).map(h => parseInt(h, 16) || 0);
    try {
      const pkt = await transportManager.sendRequest(bytes, targetCanId);
      setConsoleHistory(prev => [
        ...prev,
        {
          timestamp: new Date().toLocaleTimeString(),
          type: pkt.status === 'ERROR' ? 'ERR' : 'RX',
          text: `[${targetCanId}] < ${pkt.responseRaw || pkt.error || 'NO RESPONSE'} (${pkt.durationMs}ms)`
        }
      ]);
    } catch (err: any) {
      setConsoleHistory(prev => [
        ...prev,
        {
          timestamp: new Date().toLocaleTimeString(),
          type: 'ERR',
          text: `Error: ${err?.message || 'Execution failed'}`
        }
      ]);
    }
    setCommandText('');
  };

  const handleSimulateFault = async (faultType: string) => {
    setIsInjecting(true);
    const now = new Date().toLocaleTimeString();

    if (faultType === 'NRC_33') {
      setConsoleHistory(prev => [
        ...prev,
        { timestamp: now, type: 'SYS', text: 'Simulating SecurityAccessDenied (NRC 0x33) on ECU 0x7E0...' },
        { timestamp: now, type: 'RX', text: '[0x7E0] < 7F 27 33 (NRC 0x33: SecurityAccessDenied - Key authentication required)' }
      ]);
    } else if (faultType === 'NRC_22') {
      setConsoleHistory(prev => [
        ...prev,
        { timestamp: now, type: 'SYS', text: 'Simulating ConditionsNotCorrect (NRC 0x22) on ECU 0x7E2...' },
        { timestamp: now, type: 'RX', text: '[0x7E2] < 7F 31 22 (NRC 0x22: ConditionsNotCorrect - Vehicle speed > 0 or ignition OFF)' }
      ]);
    } else if (faultType === 'CAN_BUS_OFF') {
      setConsoleHistory(prev => [
        ...prev,
        { timestamp: now, type: 'ERR', text: 'ALERT: TWAI CAN Controller entered BUS-OFF State (Transmit Error Counter > 255)!' }
      ]);
    }

    setIsInjecting(false);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-purple-400" />
            <h2 className="text-lg font-bold text-white">
              {t('devModeTitle')}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-950 text-purple-400 border border-purple-800 font-mono font-bold">
              Engineering Console
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Raw AT / ELM327 Command Shell, Arbitrary HEX Packet Injector & Fault Simulation
          </p>
        </div>

        <button
          onClick={() => setConsoleHistory([])}
          className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Clear Shell</span>
        </button>
      </div>

      {/* Fault Simulator Buttons */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
          Diagnostic Fault & Exception Testing (Bench Validation)
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleSimulateFault('NRC_33')}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/40 transition-all flex items-center gap-1.5"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>Inject NRC 0x33 (Security Denied)</span>
          </button>

          <button
            onClick={() => handleSimulateFault('NRC_22')}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/40 transition-all flex items-center gap-1.5"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Inject NRC 0x22 (Conditions Not Correct)</span>
          </button>

          <button
            onClick={() => handleSimulateFault('CAN_BUS_OFF')}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 transition-all flex items-center gap-1.5"
          >
            <Zap className="h-3.5 w-3.5" />
            <span>Simulate CAN Bus-Off Error</span>
          </button>
        </div>
      </div>

      {/* Shell Terminal Window */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl font-mono text-xs">
        {/* Terminal Header */}
        <div className="bg-slate-900 px-4 py-2 flex items-center justify-between border-b border-slate-800 text-[11px] text-slate-400">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="ml-2 font-bold text-slate-300">ESP32 Raw Terminal (115200 baud)</span>
          </div>
          <span>ISO-TP / UDS Mode</span>
        </div>

        {/* Console Log Body */}
        <div className="p-4 max-h-[380px] overflow-y-auto space-y-1.5">
          {consoleHistory.map((item, idx) => {
            let style = 'text-slate-300';
            if (item.type === 'TX') style = 'text-cyan-400 font-bold';
            if (item.type === 'RX') style = 'text-emerald-400 font-bold';
            if (item.type === 'SYS') style = 'text-indigo-400 font-medium';
            if (item.type === 'ERR') style = 'text-rose-400 font-bold';

            return (
              <div key={idx} className="flex items-start gap-2">
                <span className="text-slate-600 text-[10px] select-none">[{item.timestamp}]</span>
                <span className={style}>{item.text}</span>
              </div>
            );
          })}
        </div>

        {/* Input Bar */}
        <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex flex-wrap items-center gap-2">
          <div className="w-28">
            <input
              type="text"
              value={targetCanId}
              onChange={(e) => setTargetCanId(e.target.value)}
              placeholder="0x7DF"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-cyan-400 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              value={commandText}
              onChange={(e) => setCommandText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendCommand()}
              placeholder="Enter AT command (e.g. ATZ, ATRV) or HEX bytes (e.g. 01 0C)..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500 uppercase tracking-wider"
            />
          </div>
          <button
            onClick={handleSendCommand}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-1.5 shadow-md transition-all"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Send</span>
          </button>
        </div>
      </div>
    </div>
  );
};
