import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { EcuInfo, ConnectionStatus } from '../types';
import { KNOWN_ECU_NODES } from '../ecu/ecuScanner';
import { transportManager } from '../network/TransportManager';
import { 
  Search, 
  Cpu, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  RefreshCw, 
  Layers, 
  ShieldCheck,
  Terminal,
  Activity
} from 'lucide-react';

interface EcuScanViewProps {
  status: ConnectionStatus;
  ecuList?: EcuInfo[];
  setEcuList?: React.Dispatch<React.SetStateAction<EcuInfo[]>>;
  isMockMode?: boolean;
}

export const EcuScanView: React.FC<EcuScanViewProps> = ({ 
  status, 
  ecuList: propEcuList, 
  setEcuList: propSetEcuList,
  isMockMode = false
}) => {
  const { t, isRtl } = useI18n();
  const [internalEcuList, setInternalEcuList] = useState<EcuInfo[]>(() =>
    KNOWN_ECU_NODES.map(node => ({
      ...node,
      status: isMockMode ? 'ONLINE' : 'UNKNOWN',
      dtcCount: 0,
      supportedPidsCount: 0
    }))
  );

  const ecuList = propEcuList || internalEcuList;
  const setEcuList = propSetEcuList || setInternalEcuList;

  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [activeAddress, setActiveAddress] = useState<string>('');

  const runFullEcuScan = async () => {
    setIsScanning(true);
    setProgress(0);

    const initialNodes: EcuInfo[] = KNOWN_ECU_NODES.map(node => ({
      ...node,
      status: 'OFFLINE',
      dtcCount: 0,
      supportedPidsCount: 0
    }));

    setEcuList(initialNodes);

    for (let i = 0; i < initialNodes.length; i++) {
      const node = initialNodes[i];
      setActiveAddress(node.addressHex);
      setProgress(Math.round(((i + 1) / initialNodes.length) * 100));

      try {
        // Send TesterPresent / Diagnostic Session request to address via transportManager
        const resp = await transportManager.sendRequest([0x3E, 0x00], node.txIdHex);
        const isOnline = resp.status === 'SUCCESS';

        if (isOnline) {
          setEcuList(prev => prev.map((item, idx) => {
            if (idx === i) {
              return {
                ...item,
                status: 'ONLINE',
                dtcCount: isMockMode && item.id === 'ecu-engine' ? 3 : 0,
                supportedPidsCount: isMockMode && item.id === 'ecu-engine' ? 48 : 0
              };
            }
            return item;
          }));
        }
      } catch {
        // Node remained OFFLINE
      }
    }

    setIsScanning(false);
    setActiveAddress('');
  };

  const onlineCount = ecuList.filter(e => e.status === 'ONLINE').length;

  return (
    <div className="space-y-6 pb-12">
      {/* Action Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-white">
              {t('ecuScannerTitle')}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-bold font-mono">
              {onlineCount} / {ecuList.length} Online
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            CAN Bus Multi-ECU Topology Auto-Discovery & Health Diagnostic
          </p>
        </div>

        <button
          onClick={runFullEcuScan}
          disabled={isScanning}
          className="px-5 py-2.5 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-2 transition-all shadow-md shadow-cyan-950/50"
        >
          <Search className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />
          <span>{isScanning ? t('scanningEcus') : t('startFullScan')}</span>
        </button>
      </div>

      {/* Live Scan Progress Bar */}
      {isScanning && (
        <div className="bg-slate-900 border border-cyan-500/40 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-cyan-400 font-bold">
              Querying CAN Target: <span className="text-white">{activeAddress}</span>
            </span>
            <span className="text-slate-400">{progress}%</span>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* ECU Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ecuList.map((ecu) => {
          const isOnline = ecu.status === 'ONLINE';

          return (
            <div
              key={ecu.id}
              className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
                isOnline
                  ? 'bg-slate-900 border-slate-700/80 shadow-sm'
                  : 'bg-slate-900/40 border-slate-800/60 opacity-60'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs font-bold text-cyan-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                    Tx: {ecu.txIdHex} | Rx: {ecu.rxIdHex}
                  </span>
                  <span
                    className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded border font-bold flex items-center gap-1 ${
                      isOnline
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {isOnline ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {isOnline ? t('online') : t('offline')}
                  </span>
                </div>

                <h3 className="font-bold text-sm text-white mt-1">
                  {isRtl ? ecu.nameAr : ecu.nameEn}
                </h3>
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                  Protocol: {ecu.protocol}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800 space-y-1.5 text-xs font-mono">
                <div className="flex justify-between text-slate-400">
                  <span>Part No:</span>
                  <span className="text-slate-200">{ecu.partNumber}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Software ID:</span>
                  <span className="text-slate-200">{ecu.softwareVersion}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>DTC Faults:</span>
                  <span className={ecu.dtcCount > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                    {ecu.dtcCount} Faults
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
