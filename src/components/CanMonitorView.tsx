import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { CanFrame, ConnectionStatus } from '../types';
import { canManager } from '../can/canManager';
import { transportManager } from '../network/TransportManager';
import { 
  Radio, 
  Play, 
  Pause, 
  Trash2, 
  Filter, 
  Send, 
  Download, 
  Layers, 
  Terminal,
  Activity,
  ArrowDownLeft,
  ArrowUpRight
} from 'lucide-react';

interface CanMonitorViewProps {
  status: ConnectionStatus;
}

export const CanMonitorView: React.FC<CanMonitorViewProps> = ({ status }) => {
  const { t, isRtl } = useI18n();
  const [frames, setFrames] = useState<CanFrame[]>([]);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [filterId, setFilterId] = useState<string>('');
  const [sendCanId, setSendCanId] = useState<string>('0x7DF');
  const [sendDataHex, setSendDataHex] = useState<string>('02 01 0C 00 00 00 00 00');
  const streamEndRef = useRef<HTMLDivElement>(null);
  const [isSniffing, setIsSniffing] = useState<boolean>(false);
  const [sniffResult, setSniffResult] = useState<string | null>(null);

  const runRawCanSniffTest = () => {
    setIsSniffing(true);
    setSniffResult('Sniffing CAN bus for 5 seconds...');
    const startCount = frames.length;
    const startTime = Date.now();

    const timer = setTimeout(() => {
      const endCount = frames.filter(f => f.direction === 'Rx' && f.timestamp && f.timestamp >= startTime).length;
      if (endCount > 0) {
        setSniffResult(`SUCCESS: Received ${endCount} RAW CAN RX frames during 5s window.`);
        console.log(`[CAN-RX-RAW] Sniff completed: ${endCount} frames received.`);
      } else {
        setSniffResult(`[CAN-RX-RAW] NO FRAME received during 5s window. Check ECU ignition, wiring (TX=GPIO22, RX=GPIO21), or transceiver.`);
        console.log(`[CAN-RX-RAW] NO FRAME`);
      }
      setIsSniffing(false);
    }, 5000);
  };

  useEffect(() => {
    const unsubscribe = canManager.subscribe((frame) => {
      if (!isPaused) {
        setFrames((prev) => [...prev.slice(-300), frame]);
      }
    });

    return () => unsubscribe();
  }, [isPaused]);

  useEffect(() => {
    if (!isPaused) {
      streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [frames, isPaused]);

  const handleSendFrame = async () => {
    if (!sendCanId || !sendDataHex) return;

    const rawBytes = sendDataHex
      .trim()
      .split(/\s+/)
      .map(h => parseInt(h, 16) || 0);

    const newFrame: CanFrame = {
      id: sendCanId.toUpperCase(),
      dlc: rawBytes.length,
      dataHex: sendDataHex.toUpperCase(),
      dataBytes: rawBytes,
      direction: 'Tx',
      isExtended: sendCanId.length > 5,
      description: 'Manual Frame Injection'
    };

    canManager.addFrame(newFrame);
    await transportManager.sendRequest(rawBytes, sendCanId);
  };

  const clearFrames = () => {
    canManager.clear();
    setFrames([]);
  };

  const exportCanLog = async () => {
    const text = frames
      .map(f => `[${f.timestamp}] ${f.direction} ${f.id} [${f.dlc}] ${f.dataHex} | ${f.description || ''}`)
      .join('\n');
    const fileName = `HAMZA_CAN_BUS_LOG_${Date.now()}.txt`;

    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Toast } = await import('@capacitor/toast');
    const { Capacitor } = await import('@capacitor/core');

    if (Capacitor.isNativePlatform()) {
      try {
        await Filesystem.writeFile({
          path: fileName,
          data: text,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        await Toast.show({ text: `تم حفظ سجل CAN: ${fileName}` });
      } catch (e: any) {
        await Toast.show({ text: `فشل الحفظ: ${e.message}` });
      }
    } else {
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
    }
  };

  const filteredFrames = filterId
    ? frames.filter(f => f.id.toLowerCase().includes(filterId.toLowerCase()) || f.dataHex.toLowerCase().includes(filterId.toLowerCase()))
    : frames;

  return (
    <div className="space-y-6 pb-12">
      {/* Action Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-white">
              {t('canMonitorTitle')}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-mono font-bold">
              {frames.length} Frames
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time ISO 11898 CAN Bus 2.0A / 2.0B Frame Sniffer & Injector
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              isPaused 
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white' 
                : 'bg-amber-600 hover:bg-amber-500 text-white'
            }`}
          >
            {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            <span>{isPaused ? t('resume') : t('pause')}</span>
          </button>

          <button
            onClick={runRawCanSniffTest}
            disabled={isSniffing}
            className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              isSniffing 
                ? 'bg-cyan-800 text-cyan-200 cursor-wait' 
                : 'bg-cyan-600 hover:bg-cyan-500 text-white'
            }`}
          >
            <Activity className="h-3.5 w-3.5 animate-pulse" />
            <span>{isSniffing ? 'Sniffing (5s)...' : 'Run Raw CAN Sniff Test'}</span>
          </button>

          <button
            onClick={clearFrames}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t('clear')}</span>
          </button>

          <button
            onClick={exportCanLog}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 flex items-center gap-1.5 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t('exportCsv')}</span>
          </button>
        </div>
      </div>

      {sniffResult && (
        <div className={`p-3 rounded-xl border text-xs font-mono flex items-center justify-between ${
          sniffResult.includes('SUCCESS') 
            ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' 
            : sniffResult.includes('NO FRAME')
            ? 'bg-rose-950/40 border-rose-800 text-rose-300'
            : 'bg-cyan-950/40 border-cyan-800 text-cyan-300'
        }`}>
          <span>{sniffResult}</span>
          <button onClick={() => setSniffResult(null)} className="text-slate-400 hover:text-white font-bold ml-2">×</button>
        </div>
      )}

      {/* Manual CAN Frame Injector */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
          Manual CAN Frame Injector (Transmit Tx)
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-32">
            <input
              type="text"
              placeholder="0x7DF"
              value={sendCanId}
              onChange={(e) => setSendCanId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-cyan-400 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="02 01 0C 00 00 00 00 00"
              value={sendDataHex}
              onChange={(e) => setSendDataHex(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500 tracking-wider uppercase"
            />
          </div>
          <button
            onClick={handleSendFrame}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-1.5 shadow-md transition-all"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Transmit Frame</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5">
        <Filter className="h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder={t('filterCanId')}
          value={filterId}
          onChange={(e) => setFilterId(e.target.value)}
          className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
        />
        {filterId && (
          <button onClick={() => setFilterId('')} className="text-xs text-slate-400 hover:text-white">
            Clear
          </button>
        )}
      </div>

      {/* Stream Terminal Table */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl font-mono text-xs">
        {/* Table Header */}
        <div className="grid grid-cols-12 bg-slate-900/90 px-4 py-2.5 text-[11px] font-bold text-slate-400 border-b border-slate-800">
          <div className="col-span-2">Timestamp</div>
          <div className="col-span-1 text-center">Dir</div>
          <div className="col-span-2">CAN ID</div>
          <div className="col-span-1 text-center">DLC</div>
          <div className="col-span-4">DATA (HEX BYTES)</div>
          <div className="col-span-2 text-right">Description</div>
        </div>

        {/* Frames List */}
        <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-900 p-2 space-y-0.5">
          {filteredFrames.length === 0 ? (
            <div className="text-center py-12 text-slate-600 text-xs">
              No CAN frames received yet. Ensure ESP32 is connected and CAN bus traffic is active.
            </div>
          ) : (
            filteredFrames.map((frame, idx) => {
              const isTx = frame.direction === 'Tx';
              return (
                <div
                  key={idx}
                  className={`grid grid-cols-12 px-2.5 py-1.5 rounded transition-colors hover:bg-slate-900/80 items-center ${
                    isTx ? 'bg-cyan-950/20 text-cyan-300' : 'text-slate-300'
                  }`}
                >
                  <div className="col-span-2 text-slate-500 text-[10px]">
                    {frame.timestamp}
                  </div>

                  <div className="col-span-1 flex justify-center">
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                        isTx ? 'bg-cyan-900/60 text-cyan-300 border border-cyan-700/60' : 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60'
                      }`}
                    >
                      {isTx ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownLeft className="h-2.5 w-2.5" />}
                      {frame.direction}
                    </span>
                  </div>

                  <div className="col-span-2 font-bold text-cyan-400">
                    {frame.id}
                  </div>

                  <div className="col-span-1 text-center text-slate-400">
                    [{frame.dlc}]
                  </div>

                  <div className="col-span-4 font-extrabold text-white tracking-wider">
                    {frame.dataHex}
                  </div>

                  <div className="col-span-2 text-right text-[10px] text-slate-400 truncate">
                    {frame.description || '-'}
                  </div>
                </div>
              );
            })
          )}
          <div ref={streamEndRef} />
        </div>
      </div>
    </div>
  );
};
