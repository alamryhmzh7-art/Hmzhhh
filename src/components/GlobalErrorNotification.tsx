import React, { useState, useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { diagnosticErrorNotifier, DiagnosticErrorEvent } from '../services/DiagnosticErrorNotifier';
import { ViewTab } from '../types';
import { 
  AlertTriangle, 
  X, 
  Copy, 
  Check, 
  Bug, 
  ChevronRight, 
  FileText,
  ShieldAlert,
  Terminal
} from 'lucide-react';

interface GlobalErrorNotificationProps {
  onNavigateToLogs?: (tab: ViewTab) => void;
}

export const GlobalErrorNotification: React.FC<GlobalErrorNotificationProps> = ({ onNavigateToLogs }) => {
  const { isRtl } = useI18n();
  const [events, setEvents] = useState<DiagnosticErrorEvent[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);

  useEffect(() => {
    const unsub = diagnosticErrorNotifier.subscribe((newEvents) => {
      setEvents(newEvents);
    });
    return () => unsub();
  }, []);

  if (events.length === 0) return null;

  const currentEvent = events[0];

  const handleCopyDiagnosticData = (event: DiagnosticErrorEvent) => {
    const payload = {
      timestamp: event.timestamp,
      severity: event.severity,
      category: event.category,
      correlationId: event.correlationId,
      messageAr: event.titleAr,
      messageEn: event.titleEn,
      technicalDetails: event.technicalDetails,
      stackTrace: event.stackTrace,
      appVersion: 'v2.5 PRO',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'
    };

    const textToCopy = JSON.stringify(payload, null, 2);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(textToCopy);
      setCopiedId(event.id);
      setTimeout(() => setCopiedId(null), 2500);
    }
  };

  const handleDismissCurrent = () => {
    diagnosticErrorNotifier.dismissEvent(currentEvent.id);
  };

  const handleOpenLogs = () => {
    if (onNavigateToLogs) {
      onNavigateToLogs('error_log');
    }
    handleDismissCurrent();
  };

  return (
    <div className={`fixed bottom-4 ${isRtl ? 'left-4' : 'right-4'} z-50 max-w-md w-full px-2 sm:px-0 transition-all duration-300`}>
      <div className="bg-slate-900/95 backdrop-blur-md border border-rose-500/60 rounded-2xl shadow-2xl shadow-rose-950/40 p-4 text-slate-100 font-sans border-l-4 border-l-rose-500 animate-in fade-in slide-in-from-bottom-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-2.5 pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400">
              <AlertTriangle className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-rose-400">
                  {isRtl ? 'تم التقاط خطأ في النظام' : 'System Error Intercepted'}
                </span>
                <span className="px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 font-mono text-[10px] font-bold border border-rose-800">
                  {events.length} {events.length === 1 ? 'Event' : 'Events'}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-mono">
                {currentEvent.category} • ID: {currentEvent.correlationId || currentEvent.id}
              </p>
            </div>
          </div>

          <button
            onClick={handleDismissCurrent}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title={isRtl ? 'إغلاق التنبيه' : 'Dismiss Alert'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Error Details */}
        <div className="mb-3 space-y-1 bg-slate-950/80 p-3 rounded-xl border border-slate-800/80">
          <p className="text-xs font-bold text-white leading-relaxed">
            {isRtl ? currentEvent.titleAr : currentEvent.titleEn}
          </p>
          {currentEvent.details && (
            <pre className="text-[10px] font-mono text-rose-300/90 whitespace-pre-wrap max-h-24 overflow-y-auto mt-1 custom-scrollbar">
              {typeof currentEvent.details === 'string'
                ? currentEvent.details
                : JSON.stringify(currentEvent.details, null, 2)}
            </pre>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            onClick={() => handleCopyDiagnosticData(currentEvent)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-all"
          >
            {copiedId === currentEvent.id ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-400">{isRtl ? 'تم نسخ التقرير' : 'Report Copied'}</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-cyan-400" />
                <span>{isRtl ? 'نسخ تقرير الخطأ' : 'Copy Diagnostic Log'}</span>
              </>
            )}
          </button>

          <button
            onClick={handleOpenLogs}
            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-rose-950/50 transition-all"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>{isRtl ? 'سجل الأعطال' : 'View Error Log'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
