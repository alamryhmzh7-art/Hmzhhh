import { errorLogRepo, AppLogger } from '../logging/logger';
import { LogEntry, LogSeverity, LogCategory } from '../types';

export interface DiagnosticErrorEvent {
  id: string;
  timestamp: string;
  severity: LogSeverity;
  category: LogCategory;
  titleAr: string;
  titleEn: string;
  details?: string;
  technicalDetails?: any;
  stackTrace?: string;
  correlationId?: string;
}

type Listener = (events: DiagnosticErrorEvent[]) => void;

class DiagnosticErrorNotifierService {
  private activeEvents: DiagnosticErrorEvent[] = [];
  private listeners: Set<Listener> = new Set();
  private maxEvents = 20;

  constructor() {
    // Listen to global error repository updates
    errorLogRepo.subscribe((log) => {
      if (log.severity === 'ERROR' || log.severity === 'CRITICAL') {
        this.addEvent({
          id: log.id,
          timestamp: typeof log.timestamp === 'number' ? new Date(log.timestamp).toLocaleTimeString() : String(log.timestamp),
          severity: log.severity,
          category: log.category,
          titleAr: log.messageAr,
          titleEn: log.messageEn,
          details: log.technicalDetails,
          technicalDetails: log.technicalDetails,
          stackTrace: log.stackTrace,
          correlationId: log.correlationId,
        });
      }
    });

    // Global uncaught JS window errors
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        const errorMsg = event.message || 'Uncaught runtime error';
        AppLogger.critical(
          'SYSTEM',
          'WINDOW_UNCAUGHT_ERROR',
          `Uncaught Error: ${errorMsg}`,
          `خطأ غير معالج في النظام: ${errorMsg}`,
          event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
          { error: event.error }
        );
      });

      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason?.message || String(event.reason || 'Unhandled Promise Rejection');
        AppLogger.error(
          'SYSTEM',
          'UNHANDLED_PROMISE_REJECTION',
          `Unhandled Promise Rejection: ${reason}`,
          `خطأ وعد غير معالج: ${reason}`,
          undefined,
          { error: event.reason }
        );
      });
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener([...this.activeEvents]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public reportCustomError(
    titleAr: string,
    titleEn: string,
    err: any,
    category: LogCategory = 'SYSTEM',
    operation: string = 'USER_ACTION'
  ) {
    const errorMsgEn = err instanceof Error ? err.message : String(err || 'Unknown error');
    AppLogger.error(
      category,
      operation,
      `${titleEn}: ${errorMsgEn}`,
      `${titleAr}: ${errorMsgEn}`,
      JSON.stringify(err, null, 2),
      { error: err }
    );
  }

  public dismissEvent(id: string) {
    this.activeEvents = this.activeEvents.filter((e) => e.id !== id);
    this.notify();
  }

  public clearAll() {
    this.activeEvents = [];
    this.notify();
  }

  public getEvents(): DiagnosticErrorEvent[] {
    return [...this.activeEvents];
  }

  private addEvent(event: DiagnosticErrorEvent) {
    // Prevent duplicated immediate popups for the exact same message
    const isDuplicate = this.activeEvents.some(
      (e) => e.titleEn === event.titleEn && Date.now() - parseInt(e.id.split('-')[1] || '0', 36) < 2000
    );
    if (isDuplicate) return;

    this.activeEvents = [event, ...this.activeEvents.slice(0, this.maxEvents - 1)];
    this.notify();
  }

  private notify() {
    this.listeners.forEach((listener) => listener([...this.activeEvents]));
  }
}

export const diagnosticErrorNotifier = new DiagnosticErrorNotifierService();
