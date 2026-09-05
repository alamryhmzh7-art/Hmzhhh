import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { CommunicationPacket, ConnectionStatus } from '../types';
import { commLogger } from '../logging/logger';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Clipboard } from '@capacitor/clipboard';
import { Toast } from '@capacitor/toast';
import { Capacitor } from '@capacitor/core';
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
  Clock,
  Share2,
  FileText,
  CopyPlus
} from 'lucide-react';

interface CommLogViewProps {
  status: ConnectionStatus;
}

export const CommLogView: React.FC<CommLogViewProps> = ({ status }) => {
  const { t, isRtl } = useI18n();
  const [packets, setPackets] = useState<CommunicationPacket[]>(commLogger.getPackets());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filterText, setFilterText] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = commLogger.subscribe((pkt) => {
      setPackets((prev) => {
        const next = [...prev, pkt];
        return next.slice(-1000); // Keep last 1000 in UI for performance
      });
    });
    return () => unsubscribe();
  }, []);

  const handleCopyHex = (id: string, text: string) => {
    if (Capacitor.isNativePlatform()) {
      Clipboard.write({ string: text });
    } else {
      navigator.clipboard.writeText(text);
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleClear = () => {
    commLogger.clear();
    setPackets([]);
  };

  const generateCsv = () => {
    const header = 'timestamp,direction,type,CAN ID,DLC,data,sequence,status,error,durationMs\n';
    const rows = packets.map(p => {
      const timestamp = p.timestamp;
      const direction = p.direction;
      let type = 'LOG';
      if (p.direction.includes('[TX]')) type = 'TX';
      else if (p.direction.includes('[CAN-RX]')) type = 'CAN-RX';
      else if (p.direction.includes('[OBD-RX]')) type = 'OBD-RX';
      else if (p.direction.includes('TIMEOUT')) type = 'TIMEOUT';
      else if (p.status === 'ERROR') type = 'ERROR';
      else if (p.direction.includes('TX')) type = 'TX'; 
      else if (p.direction.includes('RX')) type = 'RX';
      const canId = p.canIdHex || '';
      const dlc = p.dlc !== undefined ? p.dlc : '';
      const data = p.requestRaw || p.responseRaw || p.decodedData || '';
      const sequence = p.sequenceId || '';
      const status = p.status;
      const error = (p.error || '').replace(/,/g, ';');
      const duration = p.durationMs;

      return `${timestamp},"${direction}","${type}","${canId}",${dlc},"${data}",${sequence},"${status}","${error}",${duration}`;
    }).join('\n');

    return header + rows;
  };

  const getFileName = () => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
    return `HAMZA_OBD_PRO_LOG_${dateStr}_${timeStr}.csv`;
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      const csvData = generateCsv();
      const fileName = getFileName();

      if (Capacitor.isNativePlatform()) {
        const result = await Filesystem.writeFile({
          path: fileName,
          data: csvData,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        
        await Toast.show({
          text: `تم حفظ سجل التشخيص: ${fileName}`,
          duration: 'long'
        });
        console.log('File saved:', result.uri);
      } else {
        const blob = new Blob([csvData], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
      }
    } catch (err: any) {
      console.error('Export failed', err);
      await Toast.show({
        text: `فشل حفظ السجل: ${err.message}`,
        duration: 'long'
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleShareCsv = async () => {
    try {
      const csvData = generateCsv();
      const fileName = getFileName();

      if (Capacitor.isNativePlatform()) {
        // We need to write it to a cache or temporary directory first to share it
        const writeResult = await Filesystem.writeFile({
          path: fileName,
          data: csvData,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });

        await Share.share({
          title: 'HAMZA OBD PRO Log Export',
          text: 'Diagnostic session logs from Hamza OBD Pro',
          url: writeResult.uri,
          dialogTitle: 'Share Diagnostic Logs',
        });
      } else {
        const blob = new Blob([csvData], { type: 'text/csv' });
        const file = new File([blob], fileName, { type: 'text/csv' });
        
        if (navigator.share) {
          await navigator.share({
            title: 'HAMZA OBD PRO Log Export',
            files: [file]
          });
        } else {
          handleExportCsv();
        }
      }
    } catch (err: any) {
      console.error('Share failed', err);
      await Toast.show({
        text: `فشل مشاركة السجل: ${err.message}`,
        duration: 'long'
      });
    }
  };

  const handleCopyLast200 = async () => {
    const last200 = packets.slice(-200);
    const text = last200.map(p => 
      `[${p.timestamp}] ${p.direction} CAN=${p.canIdHex || '-'} DATA=${p.requestRaw || p.responseRaw || p.decodedData || '-'} Status=${p.status}`
    ).join('\n');

    if (Capacitor.isNativePlatform()) {
      await Clipboard.write({ string: text });
      await Toast.show({ text: 'تم نسخ آخر 200 سجل' });
    } else {
      await navigator.clipboard.writeText(text);
      alert('تم نسخ آخر 200 سجل');
    }
  };

  const filteredPackets = filterText
    ? packets.filter(p => 
        (p.canIdHex && p.canIdHex.toLowerCase().includes(filterText.toLowerCase())) ||
        (p.requestRaw && p.requestRaw.toLowerCase().includes(filterText.toLowerCase())) ||
        (p.responseRaw && p.responseRaw.toLowerCase().includes(filterText.toLowerCase())) ||
        (p.decodedData && p.decodedData.toLowerCase().includes(filterText.toLowerCase())) ||
        (p.direction && p.direction.toLowerCase().includes(filterText.toLowerCase()))
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
            Full Diagnostic Trace: [TX] -&gt; [CAN-RX] -&gt; [OBD-RX]
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleClear}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t('clear')}</span>
          </button>

          <button
            onClick={handleCopyLast200}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 flex items-center gap-1.5 transition-colors"
            title="Copy last 200 logs to clipboard"
          >
            <CopyPlus className="h-3.5 w-3.5" />
            <span>نسخ 200</span>
          </button>

          <button
            onClick={handleExportCsv}
            disabled={isExporting}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t('exportCsv')}</span>
          </button>

          <button
            onClick={handleShareCsv}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-cyan-900 hover:bg-cyan-800 text-cyan-100 border border-cyan-700 flex items-center gap-1.5 transition-colors"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span>مشاركة</span>
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5">
        <Filter className="h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search by CAN ID, Payload, or Log Type ([TX], [CAN-RX], [OBD-RX])..."
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

      <div className="flex items-center gap-2">
         <button 
           onClick={() => setFilterText('')}
           className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${!filterText ? 'bg-slate-200 text-slate-900 border-slate-200' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
         >
           Full Log
         </button>
         <button 
           onClick={() => setFilterText('[TX]')}
           className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${filterText === '[TX]' ? 'bg-cyan-500 text-white border-cyan-500' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
         >
           [TX]
         </button>
         <button 
           onClick={() => setFilterText('[CAN-RX]')}
           className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${filterText === '[CAN-RX]' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
         >
           [CAN-RX]
         </button>
         <button 
           onClick={() => setFilterText('[OBD-RX]')}
           className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${filterText === '[OBD-RX]' ? 'bg-purple-500 text-white border-purple-500' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
         >
           [OBD-RX]
         </button>
         <button 
           onClick={() => setFilterText('TIMEOUT')}
           className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${filterText === 'TIMEOUT' ? 'bg-rose-500 text-white border-rose-500' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
         >
           TIMEOUT
         </button>
      </div>

      {/* Packets Stream List */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs shadow-2xl max-h-[600px] overflow-y-auto space-y-2">
        {filteredPackets.length === 0 ? (
          <div className="text-center py-12 text-slate-600 text-xs">
            No communication packets matching your criteria.
          </div>
        ) : (
          filteredPackets.map((pkt) => {
            const isTx = pkt.direction.includes('[TX]') || pkt.direction.includes('APP ->');
            const isCanRx = pkt.direction.includes('[CAN-RX]');
            const isObdRx = pkt.direction.includes('[OBD RX]') || pkt.direction.includes('[OBD-RX]');
            const isTimeout = pkt.status === 'TIMEOUT';
            const isError = pkt.status === 'ERROR';

            let badgeColor = 'bg-slate-800 text-slate-300';
            if (isTx) badgeColor = 'bg-cyan-950 text-cyan-300 border-cyan-800/60';
            if (isCanRx) badgeColor = 'bg-emerald-950 text-emerald-300 border-emerald-800/60';
            if (isObdRx) badgeColor = 'bg-purple-950 text-purple-300 border-purple-800/60';
            if (isTimeout || isError) badgeColor = 'bg-rose-950 text-rose-300 border-rose-800/60';

            return (
              <div
                key={pkt.id}
                className={`bg-slate-900/90 border rounded-lg p-3 hover:border-slate-600 transition-colors space-y-2 ${isTimeout ? 'border-rose-900/40' : 'border-slate-800/80'}`}
              >
                {/* Meta Line */}
                <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">[{pkt.timestamp}]</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 border ${badgeColor}`}
                    >
                      {isTx ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                      {pkt.direction}
                    </span>
                    <span className="font-bold text-slate-300">
                      ID: {pkt.canIdHex || '-'} {pkt.dlc !== undefined && `(DLC:${pkt.dlc})`}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    {pkt.durationMs > 0 && (
                      <span className="text-slate-500 flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {pkt.durationMs}ms
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        pkt.status === 'SUCCESS'
                          ? 'bg-emerald-950 text-emerald-400'
                          : 'bg-rose-950 text-rose-400'
                      }`}
                    >
                      {pkt.status}
                    </span>
                  </div>
                </div>

                {/* Hex Stream Data */}
                <div className="bg-slate-950/80 p-2.5 rounded border border-slate-900 flex items-center justify-between">
                  <div className="flex-1">
                    <span className="text-slate-500 text-[10px] block mb-0.5">PAYLOAD / DATA:</span>
                    <span className={`font-bold tracking-wider break-all ${isTx ? 'text-cyan-400' : isCanRx ? 'text-emerald-400' : 'text-purple-400'}`}>
                      {pkt.requestRaw || pkt.responseRaw || pkt.decodedData || (isTimeout ? 'TIMEOUT_WAITING' : '-')}
                    </span>
                  </div>
                  <button
                    onClick={() => handleCopyHex(pkt.id, pkt.requestRaw || pkt.responseRaw || pkt.decodedData || '')}
                    className="text-slate-500 hover:text-slate-300 p-1 ml-2"
                  >
                    {copiedId === pkt.id ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {pkt.error && (
                  <div className="text-[11px] text-rose-400 bg-rose-950/20 px-2 py-1 rounded border border-rose-900/30">
                    <span className="font-bold">ERROR: </span>
                    {pkt.error}
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

