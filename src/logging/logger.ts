import { LogEntry, LogSeverity, LogCategory, CommunicationPacket, ConnectionStatus } from '../types';

class ErrorLogRepository {
  private logs: LogEntry[] = [];
  private maxLogs: number = 1000;
  private listeners: ((log: LogEntry) => void)[] = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem('hamza_obd_error_logs');
      if (stored) {
        this.logs = JSON.parse(stored);
      }
    } catch {
      this.logs = [];
    }
  }

  private saveToStorage() {
    try {
      if (this.logs.length > this.maxLogs) {
        this.logs = this.logs.slice(0, this.maxLogs);
      }
      localStorage.setItem('hamza_obd_error_logs', JSON.stringify(this.logs));
    } catch {
      // ignore
    }
  }

  public subscribe(listener: (log: LogEntry) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public addLog(entry: Omit<LogEntry, 'id' | 'timestamp'> & { timestamp?: string | number }): LogEntry {
    const fullEntry: LogEntry = {
      ...entry,
      id: 'ERR-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6).toUpperCase(),
      timestamp: entry.timestamp || new Date().toLocaleTimeString(),
    };

    this.logs.unshift(fullEntry);
    this.saveToStorage();
    this.listeners.forEach(l => l(fullEntry));
    return fullEntry;
  }

  public getLogs(): LogEntry[] {
    return [...this.logs];
  }

  public clear() {
    this.logs = [];
    localStorage.removeItem('hamza_obd_error_logs');
  }

  public clearLogs() {
    this.clear();
  }

  public getRecurringErrors(): { message: string; count: number; lastOccurred: number | string; category: LogCategory; sampleId: string }[] {
    const map = new Map<string, { count: number; lastOccurred: number | string; category: LogCategory; sampleId: string }>();
    this.logs.forEach(log => {
      if (log.severity === 'ERROR' || log.severity === 'CRITICAL') {
        const key = `${log.category}:${log.operation}:${log.messageEn}`;
        const existing = map.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          map.set(key, { count: 1, lastOccurred: log.timestamp, category: log.category, sampleId: log.id });
        }
      }
    });

    return Array.from(map.entries())
      .map(([msg, data]) => ({ message: msg, ...data }))
      .filter(item => item.count >= 2)
      .sort((a, b) => b.count - a.count);
  }
}

export const errorLogRepo = new ErrorLogRepository();

class CommunicationLogger {
  private packets: CommunicationPacket[] = [];
  private maxPackets: number = 2000;
  private sequenceCounter: number = 1000;
  private listeners: ((packet: CommunicationPacket) => void)[] = [];

  public subscribe(listener: (packet: CommunicationPacket) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public logPacket(packet: Omit<CommunicationPacket, 'id' | 'sequenceId' | 'timestamp'> & { timestamp?: string | number }): CommunicationPacket {
    this.sequenceCounter++;
    const fullPacket: CommunicationPacket = {
      ...packet,
      id: 'PKT-' + this.sequenceCounter,
      sequenceId: this.sequenceCounter,
      timestamp: packet.timestamp || new Date().toLocaleTimeString(),
    };

    this.packets.push(fullPacket);
    if (this.packets.length > this.maxPackets) {
      this.packets = this.packets.slice(-this.maxPackets);
    }
    this.listeners.forEach(l => l(fullPacket));
    return fullPacket;
  }

  public getPackets(): CommunicationPacket[] {
    return [...this.packets];
  }

  public clear() {
    this.packets = [];
  }

  public clearPackets() {
    this.clear();
  }
}

export const commLogger = new CommunicationLogger();

export class AppLogger {
  public static redactSensitiveData(data: string | object): string {
    const str = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return str
      .replace(/(password|passwd|pwd|token|secret|key)["']?\s*[:= ]\s*["']?([^"',\s]+)/gi, (match, p1, p2) => {
        return `${p1}: [REDACTED_TOKEN]`;
      })
      .replace(/(\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b)/g, (match) => {
        if (match.startsWith('192.168.') || match === '127.0.0.1') return match;
        return 'xxx.xxx.xxx.xxx';
      });
  }

  public static debug(category: LogCategory, operation: string, msgEn: string, msgAr: string, details?: string, context?: any) {
    return errorLogRepo.addLog({
      correlationId: 'CORR-' + Date.now().toString(36),
      severity: 'DEBUG',
      category,
      source: 'AppEngine',
      operation,
      messageEn: msgEn,
      messageAr: msgAr,
      technicalDetails: details,
      deviceState: context?.deviceState || 'DISCONNECTED',
      vehicleContext: context?.vehicleContext
    });
  }

  public static info(category: LogCategory, operation: string, msgEn: string, msgAr: string, details?: string, context?: any) {
    return errorLogRepo.addLog({
      correlationId: 'CORR-' + Date.now().toString(36),
      severity: 'INFO',
      category,
      source: 'AppEngine',
      operation,
      messageEn: msgEn,
      messageAr: msgAr,
      technicalDetails: details,
      deviceState: context?.deviceState || 'DISCONNECTED',
      vehicleContext: context?.vehicleContext
    });
  }

  public static warn(category: LogCategory, operation: string, msgEn: string, msgAr: string, details?: string, context?: any) {
    return errorLogRepo.addLog({
      correlationId: 'CORR-' + Date.now().toString(36),
      severity: 'WARNING',
      category,
      source: 'AppEngine',
      operation,
      messageEn: msgEn,
      messageAr: msgAr,
      technicalDetails: details,
      deviceState: context?.deviceState || 'DISCONNECTED',
      vehicleContext: context?.vehicleContext
    });
  }

  public static error(category: LogCategory, operation: string, msgEn: string, msgAr: string, details?: string, context?: any) {
    return errorLogRepo.addLog({
      correlationId: 'CORR-' + Date.now().toString(36),
      severity: 'ERROR',
      category,
      source: 'AppEngine',
      operation,
      messageEn: msgEn,
      messageAr: msgAr,
      technicalDetails: details,
      deviceState: context?.deviceState || 'DISCONNECTED',
      vehicleContext: context?.vehicleContext,
      stackTrace: context?.error instanceof Error ? context.error.stack : undefined
    });
  }

  public static critical(category: LogCategory, operation: string, msgEn: string, msgAr: string, details?: string, context?: any) {
    return errorLogRepo.addLog({
      correlationId: 'CORR-' + Date.now().toString(36),
      severity: 'CRITICAL',
      category,
      source: 'AppEngine',
      operation,
      messageEn: msgEn,
      messageAr: msgAr,
      technicalDetails: details,
      deviceState: context?.deviceState || 'ERROR',
      vehicleContext: context?.vehicleContext,
      stackTrace: context?.error instanceof Error ? context.error.stack : undefined
    });
  }
}

export class DiagnosticBundleExporter {
  public static generateBundle(deviceStatus: ConnectionStatus, vehicleInfo?: any): string {
    const rawBundle = {
      bundleVersion: '1.0.0',
      app: 'HAMZA OBD PRO',
      generatedAt: new Date().toISOString(),
      systemInfo: {
        platform: 'Android / Web Runtime',
        deviceState: deviceStatus,
        targetFirmware: 'v2.5.0-ESP32-TWAI',
        protocol: 'ISO 15765-4 CAN 11-bit 500kbps',
      },
      vehicle: vehicleInfo || { vin: 'NOT_READ', model: 'Toyota Camry' },
      errorLogs: errorLogRepo.getLogs().slice(0, 100),
      commLogs: commLogger.getPackets().slice(0, 200),
    };

    return AppLogger.redactSensitiveData(JSON.stringify(rawBundle, null, 2));
  }
}
