import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { CommunicationPacket, ConnectionStatus } from '../types';
import { commLogger } from '../logging/logger';
import { 
  Terminal, 
  Trash2, 
  Download, 
  Copy, 
  Check, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Search, 
  Filter,
  CheckCircle2,
  AlertOctagon,
  Clock
} from 'lucide-react';

interface CommLogViewProps {
  status: ConnectionStatus;
}

export const CommLogView: React.FC<CommLogViewProps> = ({ status }) => {
  const { t, isRtl } = useI18n();
  const [packets, setPackets] = useState<CommunicationPacket[]>(commLogger.getPackets());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filterText, setFilterText] = useState<string>('');
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = commLogger.subscribe((pkt) => {
      setPackets((prev) => [...prev.slice(-400), pkt]);
    });
    return () => unsubscribe();
  }, []);

  const handleCopyHex = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleClear = () => {
    commLogger.clear();
    setPackets([]);
  };

  const handleExportTxt = () => {
    const lines = packets.map(p => 
      `[${p.timestamp}] (${p.durationMs}ms) [${p.status}] ${p.direction} | CAN: ${p.canIdHex || '-'} | TX: ${p.requestRaw || '-'} | RX: ${p.responseRaw || '-'} | Decoded: ${p.decodedData || '-'}`
    ).join('\n');

    const blob = new Blob([lines], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Hamza_OBD_Comm_Packets_${Date.now()}.txt`;
    a.click();
  };

  const filteredPackets = filterText
    ? packets.filter(p => 
        (p.canIdHex && p.canIdHex.toLowerCase().includes(filterText.toLowerCase())) ||
        (p.requestRaw && p.requestRaw.toLowerCase().includes(filterText.toLowerCase())) ||
        (p.responseRaw && p.responseRaw.toLowerCase().includes(filterText.toLowerCase())) ||
        (p.decodedData && p.decodedData.toLowerCase().includes(filterText.toLowerCase()))
      )
    : packets;

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-white">
              {t('commLogTitle')}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono font-bold">
              {packets.length} Packets
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Directional Telemetry Packet Exchange Trace (APP &lt;-&gt; ESP32 &lt;-&gt; ECU)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t('clear')}</span>
          </button>

          <button
            onClick={handleExportTxt}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 flex items-center gap-1.5 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t('exportCsv')}</span>
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5">
        <Filter className="h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="Filter packets by CAN ID, HEX bytes, or decoded keyword..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
        />
        {filterText && (
          <button onClick={() => setFilterText('')} className="text-xs text-slate-400 hover:text-white">
            Clear
          </button>
        )}
      </div>

      {/* Packets Stream List */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs shadow-2xl max-h-[540px] overflow-y-auto space-y-2">
        {filteredPackets.length === 0 ? (
          <div className="text-center py-12 text-slate-600 text-xs">
            No communication packets logged yet.
          </div>
        ) : (
          filteredPackets.map((pkt) => {
            const isAppToEsp = pkt.direction.startsWith('APP');
            const isSuccess = pkt.status === 'SUCCESS';
            const isNrc = pkt.status === 'NRC';

            return (
              <div
                key={pkt.id}
                className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-3 hover:border-slate-700 transition-colors space-y-2"
              >
                {/* Meta Line */}
                <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">[{pkt.timestamp}]</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${
                        isAppToEsp
                          ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60'
                          : 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                      }`}
                    >
                      {isAppToEsp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                      {pkt.direction}
                    </span>
                    <span className="font-bold text-slate-300">
                      CAN: {pkt.canIdHex || '0x7E0'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-slate-500 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {pkt.durationMs}ms
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        isSuccess
                          ? 'bg-emerald-950 text-emerald-400'
                          : isNrc
                          ? 'bg-amber-950 text-amber-400'
                          : 'bg-rose-950 text-rose-400'
                      }`}
                    >
                      {pkt.status}
                    </span>
                  </div>
                </div>

                {/* Hex Stream Data */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-slate-950/80 p-2.5 rounded border border-slate-900">
                  {pkt.requestRaw && (
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-slate-500 text-[10px] block">REQUEST (TX):</span>
                        <span className="text-cyan-400 font-bold tracking-wider">{pkt.requestRaw}</span>
                      </div>
                      <button
                        onClick={() => handleCopyHex(pkt.id + '-req', pkt.requestRaw!)}
                        className="text-slate-500 hover:text-slate-300 p-1"
                        title="Copy Request HEX"
                      >
                        {copiedId === pkt.id + '-req' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  )}

                  {pkt.responseRaw && (
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-slate-500 text-[10px] block">RESPONSE (RX):</span>
                        <span className="text-emerald-400 font-bold tracking-wider">{pkt.responseRaw}</span>
                      </div>
                      <button
                        onClick={() => handleCopyHex(pkt.id + '-res', pkt.responseRaw!)}
                        className="text-slate-500 hover:text-slate-300 p-1"
                        title="Copy Response HEX"
                      >
                        {copiedId === pkt.id + '-res' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  )}
                </div>

                {pkt.decodedData && (
                  <div className="text-[11px] text-slate-300 bg-slate-950/40 px-2 py-1 rounded">
                    <span className="text-slate-500 font-bold">DECODED: </span>
                    {pkt.decodedData}
                  </div>
                )}

                {pkt.stackTrace && (
                  <div className="text-[10px] text-rose-300 bg-rose-950/40 border border-rose-900/50 p-2 rounded font-mono overflow-x-auto whitespace-pre-wrap">
                    <span className="font-bold block text-rose-400 mb-0.5">ERROR CAUSE & STACK TRACE:</span>
                    {pkt.stackTrace}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
};
