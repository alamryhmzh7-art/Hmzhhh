import React, { useState, useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { ErrorLogEntry, LogSeverity, LogCategory, ConnectionStatus } from '../types';
import { errorLogRepo, AppLogger } from '../logging/logger';
import { ReportGenerator } from '../reports/reportGenerator';
import { 
  ShieldCheck, 
  Trash2, 
  Download, 
  Filter, 
  AlertTriangle, 
  AlertOctagon, 
  Info, 
  Bug, 
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  FileArchive,
  RefreshCw
} from 'lucide-react';

interface ErrorLogViewProps {
  status: ConnectionStatus;
}

export const ErrorLogView: React.FC<ErrorLogViewProps> = ({ status }) => {
  const { t, isRtl } = useI18n();
  const [logs, setLogs] = useState<ErrorLogEntry[]>(errorLogRepo.getLogs());
  const [selectedSeverity, setSelectedSeverity] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = errorLogRepo.subscribe((newLog) => {
      setLogs((prev) => [newLog, ...prev.slice(0, 300)]);
    });
    return () => unsubscribe();
  }, []);

  const handleClear = () => {
    errorLogRepo.clear();
    setLogs([]);
  };

  const handleExportBundle = () => {
    ReportGenerator.exportDiagnosticBundleJson('Toyota Camry (2022)', '4T1BF1FK5NU123456');
  };

  const filteredLogs = logs.filter((log) => {
    if (selectedSeverity !== 'ALL' && log.severity !== selectedSeverity) return false;
    if (selectedCategory !== 'ALL' && log.category !== selectedCategory) return false;
    return true;
  });

  const getSeverityStyle = (s: LogSeverity) => {
    switch (s) {
      case 'CRITICAL':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/40';
      case 'ERROR':
        return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      case 'WARNING':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'INFO':
        return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
      case 'DEBUG':
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  const criticalCount = logs.filter(l => l.severity === 'CRITICAL' || l.severity === 'ERROR').length;
  const warningCount = logs.filter(l => l.severity === 'WARNING').length;

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-orange-400" />
            <h2 className="text-lg font-bold text-white">
              {t('errorLogTitle')}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono font-bold">
              {logs.length} Events
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            System Event & Technical Diagnostics Audit Logger with PII Data Redaction
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <button
            onClick={handleExportBundle}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-500 text-white flex items-center gap-2 transition-all shadow-md shadow-orange-950/50"
          >
            <FileArchive className="h-4 w-4" />
            <span>{t('exportBundle')}</span>
          </button>

          <button
            onClick={handleClear}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t('clear')}</span>
          </button>
        </div>
      </div>

      {/* Audit Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
          <span className="text-[10px] text-slate-500 uppercase font-mono block">Critical & Errors</span>
          <span className={`text-xl font-bold font-mono ${criticalCount > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
            {criticalCount}
          </span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
          <span className="text-[10px] text-slate-500 uppercase font-mono block">Warnings</span>
          <span className={`text-xl font-bold font-mono ${warningCount > 0 ? 'text-amber-400' : 'text-slate-300'}`}>
            {warningCount}
          </span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
          <span className="text-[10px] text-slate-500 uppercase font-mono block">PII Redaction</span>
          <span className="text-xl font-bold font-mono text-emerald-400">ACTIVE</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
          <span className="text-[10px] text-slate-500 uppercase font-mono block">Retention Limit</span>
          <span className="text-xl font-bold font-mono text-cyan-400">500 Entries</span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Filter className="h-4 w-4" />
          <span>Filters:</span>
        </div>

        <select
          value={selectedSeverity}
          onChange={(e) => setSelectedSeverity(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none font-mono"
        >
          <option value="ALL">All Severities</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="ERROR">ERROR</option>
          <option value="WARNING">WARNING</option>
          <option value="INFO">INFO</option>
          <option value="DEBUG">DEBUG</option>
        </select>

        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none font-mono"
        >
          <option value="ALL">All Categories</option>
          <option value="SYSTEM">SYSTEM</option>
          <option value="NETWORK">NETWORK</option>
          <option value="PROTOCOL">PROTOCOL</option>
          <option value="OBD">OBD</option>
          <option value="SECURITY">SECURITY</option>
          <option value="STORAGE">STORAGE</option>
        </select>
      </div>

      {/* Logs Accordion Stream */}
      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {filteredLogs.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-500 text-xs">
            No system events matching the selected filters.
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isExpanded = expandedLogId === log.id;

            return (
              <div
                key={log.id}
                className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden transition-colors hover:border-slate-700"
              >
                <div
                  onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                  className="p-3.5 flex items-center justify-between cursor-pointer gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border font-mono ${getSeverityStyle(log.severity)}`}>
                      {log.severity}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 font-bold bg-slate-800 px-1.5 py-0.5 rounded">
                      {log.category}
                    </span>
                    <span className="text-xs font-bold text-white truncate">
                      {isRtl ? log.messageAr : log.messageEn}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-slate-500 text-[11px] font-mono">
                    <span>{log.timestamp}</span>
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>

                {/* Expanded Technical Details */}
                {isExpanded && (
                  <div className="p-4 bg-slate-950/80 border-t border-slate-800 text-xs font-mono space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-400 text-[11px]">
                      <div>Operation: <strong className="text-white">{log.operation}</strong></div>
                      <div>Correlation ID: <strong className="text-cyan-400">{log.correlationId}</strong></div>
                    </div>

                    {log.rawPacket && (
                      <div>
                        <span className="text-slate-500 block text-[10px]">RAW PACKET DATA:</span>
                        <code className="text-indigo-400 block bg-slate-900 p-2 rounded border border-slate-800 mt-1">
                          {log.rawPacket}
                        </code>
                      </div>
                    )}

                    {log.technicalDetails && (
                      <div>
                        <span className="text-slate-500 block text-[10px]">TECHNICAL CONTEXT:</span>
                        <pre className="text-slate-300 text-[10px] bg-slate-900 p-2 rounded border border-slate-800 mt-1 overflow-x-auto">
                          {JSON.stringify(log.technicalDetails, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
