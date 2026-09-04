import { ConnectionConfig, ConnectionStatus, CommunicationPacket } from '../types';
import { commLogger, errorLogRepo, AppLogger } from '../logging/logger';
import { canManager, CanManager } from '../can/canManager';
import { mockEcuServer } from './mockEcuServer';

export interface PacketParserResult {
  rawBytes: number[];
  hexString: string;
  asciiString: string;
  isPositiveResponse: boolean;
  serviceId?: number;
}

export class PacketParser {
  public static parse(data: number[]): PacketParserResult {
    const hex = data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    const ascii = data.map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');
    const serviceId = data.length > 0 ? data[0] : undefined;
    const isPositiveResponse = data.length > 0 && data[0] !== 0x7F;

    return {
      rawBytes: data,
      hexString: hex,
      asciiString: ascii,
      isPositiveResponse,
      serviceId
    };
  }
}

export class TCPClient {
  private config: ConnectionConfig;
  private status: ConnectionStatus = 'DISCONNECTED';
  private listeners: ((status: ConnectionStatus) => void)[] = [];
  private sequenceId: number = 0;
  private ws: WebSocket | null = null;
  private pendingRequests: Record<number, { resolve: (bytes: number[]) => void; reject: (err: any) => void; timer: any }> = {};

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  public subscribeStatus(listener: (status: ConnectionStatus) => void) {
    this.listeners.push(listener);
    listener(this.status);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private setStatus(newStatus: ConnectionStatus) {
    this.status = newStatus;
    this.listeners.forEach(l => l(newStatus));
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public updateConfig(newConfig: Partial<ConnectionConfig>) {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): ConnectionConfig {
    return { ...this.config };
  }

  /**
   * Connect to ESP32 TCP Server via WebSocket bridge or simulated internal socket in mock mode
   */
  public async connect(overrideConfig?: Partial<ConnectionConfig>): Promise<boolean> {
    if (overrideConfig) {
      this.config = { ...this.config, ...overrideConfig };
    }
    if (this.status === 'CONNECTED') return true;

    this.setStatus('CONNECTING');
    AppLogger.info('NETWORK', 'Connect', `Attempting connection to ESP32 at ${this.config.ip}:${this.config.port}`, `محاولة الاتصال بجهاز ESP32 عبر ${this.config.ip}:${this.config.port}`, undefined, { deviceState: 'CONNECTING' });

    if (this.config.isMockMode) {
      // Fast, reliable simulation startup
      await new Promise(r => setTimeout(r, 600));
      mockEcuServer.start();
      this.setStatus('CONNECTED');
      AppLogger.info('NETWORK', 'Connect', 'Connected to Simulated ESP32 Hardware (Mock Mode)', 'تم الاتصال بنجاح بجهاز ESP32 في وضع المحاكاة', undefined, { deviceState: 'CONNECTED' });
      return true;
    }

    // Real Hardware Connection Mode
    return new Promise((resolve) => {
      const timeoutTimer = setTimeout(() => {
        this.setStatus('ERROR');
        AppLogger.error('NETWORK', 'Connect', `Connection timed out after ${this.config.connectionTimeoutMs}ms`, `انتهت مهلة الاتصال بعد ${this.config.connectionTimeoutMs} ملي ثانية`, undefined, { deviceState: 'ERROR' });
        resolve(false);
      }, this.config.connectionTimeoutMs);

      try {
        // In browser context, connect via standard WebSocket proxy to ESP32 TCP port
        const wsUrl = `ws://${this.config.ip}:${this.config.port}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          clearTimeout(timeoutTimer);
          this.setStatus('CONNECTED');
          AppLogger.info('NETWORK', 'Connect', `TCP Socket Connected to ESP32 at ${this.config.ip}:${this.config.port}`, `تم فتح اتصال TCP Socket بنجاح مع ESP32`, undefined, { deviceState: 'CONNECTED' });
          resolve(true);
        };

        this.ws.onerror = (err) => {
          clearTimeout(timeoutTimer);
          this.setStatus('ERROR');
          AppLogger.error('NETWORK', 'SocketError', `TCP Socket Error on ${this.config.ip}:${this.config.port}`, `حدث خطأ في مقبس الاتصال مع ESP32`, undefined, { deviceState: 'ERROR', error: err });
          resolve(false);
        };

        this.ws.onclose = () => {
          if (this.status === 'CONNECTED') {
            this.setStatus('DISCONNECTED');
            AppLogger.warn('NETWORK', 'Disconnect', 'ESP32 Wi-Fi / TCP Socket connection closed', 'تم قطع اتصال شبكة Wi-Fi أو مقبس TCP بجهاز ESP32', undefined, { deviceState: 'DISCONNECTED' });
          }
        };

        this.ws.onmessage = (event) => {
          // Process raw frame stream from ESP32
          try {
            if (typeof event.data === 'string') {
              const parsed = JSON.parse(event.data);
              if (parsed.canId && parsed.data) {
                canManager.addFrame({
                  id: parsed.canId,
                  dlc: parsed.dlc || 8,
                  dataHex: parsed.data,
                  dataBytes: CanManager.parseHexStringToBytes(parsed.data),
                  direction: 'Rx',
                  isExtended: Boolean(parsed.isExtended),
                  description: parsed.description
                });

                // Check if this fulfills a pending request
                if (parsed.seq !== undefined && this.pendingRequests[parsed.seq]) {
                   const req = this.pendingRequests[parsed.seq];
                   clearTimeout(req.timer);
                   req.resolve(CanManager.parseHexStringToBytes(parsed.data));
                   delete this.pendingRequests[parsed.seq];
                } else {
                   const seqs = Object.keys(this.pendingRequests);
                   if (seqs.length > 0) {
                       const req = this.pendingRequests[parseInt(seqs[0])];
                       clearTimeout(req.timer);
                       req.resolve(CanManager.parseHexStringToBytes(parsed.data));
                       delete this.pendingRequests[parseInt(seqs[0])];
                   }
                }


              }
            }
          } catch {
            // raw binary or text
          }
        };
      } catch (err: any) {
        clearTimeout(timeoutTimer);
        this.setStatus('ERROR');
        AppLogger.critical('NETWORK', 'SocketInit', 'Failed to initialize TCP client', 'فشل في تهيئة عميل TCP', undefined, { deviceState: 'ERROR', error: err });
        resolve(false);
      }
    });
  }

  public async disconnect(): Promise<void> {
    if (this.config.isMockMode) {
      mockEcuServer.stop();
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.setStatus('DISCONNECTED');
    AppLogger.info('NETWORK', 'Disconnect', 'Device disconnected by user', 'تم قطع اتصال الجهاز من قِبل المستخدم', undefined, { deviceState: 'DISCONNECTED' });
  }

  public async ping(): Promise<{ success: boolean; roundTripMs: number }> {
    const startTime = performance.now();
    try {
      // Send standard Ping / TesterPresent (0x3E 0x00)
      const res = await this.sendRequest([0x3E, 0x00], '0x7E0');
      const rtt = Math.round(performance.now() - startTime);
      return { success: res.status === 'SUCCESS', roundTripMs: rtt };
    } catch {
      return { success: false, roundTripMs: 0 };
    }
  }

  /**
   * Primary Request/Response Handler with timeout and correlation logging
   */
  public async sendRequest(requestBytes: number[], targetCanId: string = '0x7E0'): Promise<CommunicationPacket> {
    this.sequenceId++;
    const reqSeq = this.sequenceId;
    const startTime = performance.now();
    const reqHex = requestBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

    // Log APP -> ESP32
    commLogger.logPacket({
      direction: 'APP -> ESP32',
      protocol: this.config.protocol,
      canIdHex: targetCanId,
      requestRaw: reqHex,
      durationMs: 0,
      status: 'SUCCESS'
    });

    if (this.status !== 'CONNECTED' && !this.config.isMockMode) {
      const errPkt = commLogger.logPacket({
        direction: 'ESP32 -> APP',
        protocol: this.config.protocol,
        canIdHex: targetCanId,
        requestRaw: reqHex,
        error: 'Device not connected',
        durationMs: 0,
        status: 'ERROR'
      });
      AppLogger.warn('NETWORK', 'SendRequest', 'Cannot send command while disconnected', 'لا يمكن إرسال الأوامر أثناء عدم وجود اتصال نشط', reqHex, { deviceState: this.status });
      return errPkt;
    }

    try {
      let responseBytes: number[] = [];

      if (this.config.isMockMode) {
        // Simulate real bus transmission delay (15ms - 45ms)
        await new Promise(r => setTimeout(r, 20 + Math.random() * 25));
        responseBytes = await mockEcuServer.handleRequest(requestBytes);
      } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Send JSON payload to ESP32 Bridge
        const payload = JSON.stringify({
          seq: reqSeq,
          canId: targetCanId,
          bytes: requestBytes
        });
        this.ws.send(payload);

        // Await response packet with response timeout
        responseBytes = await new Promise<number[]>((resolve, reject) => {
           const timer = setTimeout(() => reject(new Error('TIMEOUT_WAITING_FOR_ECU_RESPONSE')), 2500);
           this.pendingRequests[reqSeq] = { resolve, reject, timer };
        });
      }

      const durationMs = Math.round(performance.now() - startTime);
      const resHex = responseBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      const parsed = PacketParser.parse(responseBytes);

      // Log ESP32 -> APP
      const respPkt = commLogger.logPacket({
        direction: 'ESP32 -> APP',
        protocol: this.config.protocol,
        canIdHex: targetCanId,
        requestRaw: reqHex,
        responseRaw: resHex,
        decodedData: parsed.asciiString,
        durationMs,
        status: responseBytes[0] === 0x7F ? 'NRC' : 'SUCCESS'
      });

      return respPkt;
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      const errPkt = commLogger.logPacket({
        direction: 'ESP32 -> APP',
        protocol: this.config.protocol,
        canIdHex: targetCanId,
        requestRaw: reqHex,
        error: err?.message || 'Response Timeout',
        durationMs,
        status: 'TIMEOUT'
      });

      AppLogger.error('NETWORK', 'RequestTimeout', `Request to ${targetCanId} timed out or failed`, `انتهت مهلة استجابة الطلب إلى وحدة التحكم ${targetCanId}`, reqHex, { deviceState: this.status, error: err });
      return errPkt;
    }
  }
}

import { defaultConnectionConfig } from './Transport';

export const defaultTcpClient = new TCPClient(defaultConnectionConfig);
