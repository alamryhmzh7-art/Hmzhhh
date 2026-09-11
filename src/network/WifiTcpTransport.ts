/**
 * HAMZA OBD PRO - Wi-Fi TCP Transport Implementation
 * 
 * Direct TCP Socket client to ESP32 SoftAP (Default 192.168.4.1:35000).
 * Implements non-blocking frame streaming, automatic keep-alive/heartbeat, and binary packet framing.
 */

import { ConnectionConfig, ConnectionStatus, CanFrame, CanBusStatus, TransportType } from '../types';
import { ITransport, PingResult } from './Transport';
import { BinaryProtocol, BinaryCommand, DecodedBinaryPacket } from './binaryProtocol';
import { commLogger, AppLogger } from '../logging/logger';
import { canManager, CanManager } from '../can/canManager';
import { mockEcuServer } from './mockEcuServer';

export class WifiTcpTransport implements ITransport {
  public readonly type: TransportType = 'WIFI_TCP';

  private config: ConnectionConfig;
  private status: ConnectionStatus = 'DISCONNECTED';
  private socket: WebSocket | null = null;
  private rxBuffer: Uint8Array = new Uint8Array(0);

  private stateListeners: ((state: ConnectionStatus, error?: string) => void)[] = [];
  private dataListeners: ((data: Uint8Array) => void)[] = [];
  private canFrameListeners: ((frame: CanFrame) => void)[] = [];

  private pingResolver: ((res: PingResult) => void) | null = null;
  private canStatusResolver: ((status: CanBusStatus | null) => void) | null = null;
  private klineInitResolver: ((res: { success: boolean; activeProtocol: number; keyByte1: number; keyByte2: number }) => void) | null = null;
  private klineStatusResolver: ((status: any) => void) | null = null;
  private klineFrameResolver: ((res: { status: number; data: number[] }) => void) | null = null;
  private klinePacketListeners: ((pkt: DecodedBinaryPacket) => void)[] = [];
  private heartbeatInterval: any = null;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  public getState(): ConnectionStatus {
    return this.status;
  }

  public isConnected(): boolean {
    return this.status === 'CONNECTED';
  }

  public updateConfig(config: ConnectionConfig) {
    this.config = config;
  }

  public onStateChange(callback: (state: ConnectionStatus, error?: string) => void): () => void {
    this.stateListeners.push(callback);
    callback(this.status);
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== callback);
    };
  }

  public onData(callback: (data: Uint8Array) => void): () => void {
    this.dataListeners.push(callback);
    return () => {
      this.dataListeners = this.dataListeners.filter(l => l !== callback);
    };
  }

  public onCanFrame(callback: (frame: CanFrame) => void): () => void {
    this.canFrameListeners.push(callback);
    return () => {
      this.canFrameListeners = this.canFrameListeners.filter(l => l !== callback);
    };
  }

  private setStatus(newStatus: ConnectionStatus, errorMsg?: string) {
    this.status = newStatus;
    this.stateListeners.forEach(l => l(newStatus, errorMsg));
  }

  public async connect(overrideConfig?: Partial<ConnectionConfig>): Promise<boolean> {
    if (overrideConfig) {
      this.config = { ...this.config, ...overrideConfig };
    }

    if (this.status === 'CONNECTED') return true;

    this.setStatus('CONNECTING');
    AppLogger.info(
      'NETWORK',
      'WifiConnect',
      `Connecting to ESP32 Wi-Fi TCP at ${this.config.ip}:${this.config.port}`,
      `محاولة الاتصال بمقبس Wi-Fi TCP في ESP32 عبر ${this.config.ip}:${this.config.port}`,
      undefined,
      { deviceState: 'CONNECTING' }
    );

    if (this.config.isMockMode) {
      // Mock simulation mode
      await new Promise(r => setTimeout(r, 400));
      mockEcuServer.start();
      this.setStatus('CONNECTED');
      this.startHeartbeat();
      return true;
    }

    // Real Hardware Wi-Fi TCP Connection
    return new Promise((resolve) => {
      const timeoutTimer = setTimeout(() => {
        if (this.status === 'CONNECTING') {
          this.setStatus('ERROR', 'Wi-Fi Connection Timeout');
          AppLogger.error(
            'NETWORK',
            'WifiTimeout',
            `Wi-Fi TCP connection timed out after ${this.config.connectionTimeoutMs}ms`,
            `انتهت مهلة اتصال Wi-Fi TCP بعد ${this.config.connectionTimeoutMs} ملي ثانية`,
            undefined,
            { deviceState: 'ERROR' }
          );
          resolve(false);
        }
      }, this.config.connectionTimeoutMs);

      try {
        // Standard WebSocket/TCP bridge endpoint for browser/webview environments
        const wsUrl = `ws://${this.config.ip}:${this.config.port}`;
        this.socket = new WebSocket(wsUrl);
        this.socket.binaryType = 'arraybuffer';

        this.socket.onopen = () => {
          clearTimeout(timeoutTimer);
          this.setStatus('CONNECTED');
          this.startHeartbeat();
          AppLogger.info(
            'NETWORK',
            'WifiConnected',
            `[WiFi] Connected to ESP32 at ${this.config.ip}:${this.config.port}`,
            `[WiFi] تم فتح اتصال Wi-Fi TCP بنجاح مع ESP32`,
            undefined,
            { deviceState: 'CONNECTED' }
          );
          resolve(true);
        };

        this.socket.onerror = (err) => {
          clearTimeout(timeoutTimer);
          this.setStatus('ERROR', 'Socket Error');
          AppLogger.error(
            'NETWORK',
            'WifiSocketError',
            `Failed to establish a Wi-Fi TCP connection to ${this.config.ip}:${this.config.port}. Check if you are connected to the ESP32 network (ESP32-OBD-PRO).`,
            `لم نتمكن من الوصول لقطعة ESP32 عبر الواي فاي على العنوان ${this.config.ip}:${this.config.port}. يرجى التأكد من أنك متصل بشبكة الواي فاي الخاصة بالقطعة (ESP32-OBD-PRO) وليس شبكة أخرى، وأن القطعة قيد التشغيل.`,
            undefined,
            { deviceState: 'ERROR', error: err }
          );
          resolve(false);
        };

        this.socket.onclose = () => {
          this.stopHeartbeat();
          if (this.status === 'CONNECTED') {
            this.setStatus('DISCONNECTED', 'Connection Closed');
            AppLogger.warn(
              'NETWORK',
              'WifiClosed',
              '[WiFi] Connection to ESP32 was abruptly closed or lost',
              '[WiFi] انقطع الاتصال اللاسلكي بشكل مفاجئ مع قطعة ESP32. قد تكون القطعة أعادت التشغيل أو ابتعدت عن النطاق.',
              undefined,
              { deviceState: 'DISCONNECTED' }
            );
          }
        };

        this.socket.onmessage = (event) => {
          this.handleIncomingData(event.data);
        };
      } catch (err: any) {
        clearTimeout(timeoutTimer);
        const errMessage = err?.message || 'Initialization Failed';
        this.setStatus('ERROR', errMessage);
        AppLogger.error(
          'NETWORK',
          'WifiConnectException',
          `System exception while attempting Wi-Fi TCP connection. Details: ${errMessage}`,
          `حدث استثناء برمجي أو حظر من النظام أثناء محاولة فتح مقبس واي فاي. التفاصيل: ${errMessage}`,
          err instanceof Error ? err.stack : undefined,
          { deviceState: 'ERROR', error: err }
        );
        resolve(false);
      }
    });
  }

  public async disconnect(): Promise<void> {
    this.stopHeartbeat();
    if (this.config.isMockMode) {
      mockEcuServer.stop();
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
    this.rxBuffer = new Uint8Array(0);
    this.setStatus('DISCONNECTED');
  }

  public async sendRaw(data: Uint8Array | number[]): Promise<boolean> {
    if (!this.isConnected() && !this.config.isMockMode) {
      AppLogger.warn('NETWORK', 'WifiSendRaw', 'Cannot send data: Wi-Fi TCP disconnected', 'لا يمكن إرسال البيانات: اتصال Wi-Fi TCP غير متصل');
      return false;
    }

    const byteArr = data instanceof Uint8Array ? data : new Uint8Array(data);
    const hex = Array.from(byteArr).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

    commLogger.logPacket({
      direction: '[WiFi TX]',
      protocol: 'Binary Frame',
      requestRaw: hex,
      durationMs: 0,
      status: 'SUCCESS'
    });

    if (this.config.isMockMode) {
      // Mock loopback handle
      return true;
    }

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(byteArr.buffer);
      return true;
    }

    return false;
  }

  public async sendCanFrame(canId: number, data: number[], isExtended: boolean = false): Promise<boolean> {
    const packet = BinaryProtocol.encodeCanFrame(canId, data, isExtended);
    const hexData = data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    const idHex = isExtended ? '0x' + canId.toString(16).padStart(8, '0').toUpperCase() : '0x' + canId.toString(16).padStart(3, '0').toUpperCase();

    commLogger.logPacket({
      direction: '[WiFi TX]',
      protocol: isExtended ? 'CAN 29-bit' : 'CAN 11-bit',
      canIdHex: idHex,
      requestRaw: hexData,
      durationMs: 0,
      status: 'SUCCESS'
    });

    // Mirror to CAN Manager
    canManager.addFrame({
      id: idHex,
      dlc: data.length,
      dataHex: hexData,
      dataBytes: data,
      direction: 'Tx',
      isExtended,
      description: 'App Wi-Fi Outbound'
    });

    if (this.config.isMockMode) {
      setTimeout(async () => {
        const responseBytes = await mockEcuServer.handleRequest(data);
        if (responseBytes && responseBytes.length > 0) {
          const respHex = responseBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
          const respId = (canId === 0x7DF || canId === 0x7E0) ? '0x7E8' : '0x7E9';

          commLogger.logPacket({
            direction: '[WiFi RX]',
            protocol: 'CAN 11-bit',
            canIdHex: respId,
            requestRaw: hexData,
            responseRaw: respHex,
            durationMs: 25,
            status: responseBytes[0] === 0x7F ? 'NRC' : 'SUCCESS'
          });

          canManager.addFrame({
            id: respId,
            dlc: responseBytes.length,
            dataHex: respHex,
            dataBytes: responseBytes,
            direction: 'Rx',
            isExtended: false,
            description: 'Simulated ECU Response'
          });

          const mockRxFrame: CanFrame = {
            id: respId,
            dlc: responseBytes.length,
            dataHex: respHex,
            dataBytes: responseBytes,
            direction: 'Rx',
            isExtended: false
          };
          this.canFrameListeners.forEach(l => l(mockRxFrame));
        }
      }, 30);
      return true;
    }

    return this.sendRaw(packet);
  }

  public async ping(): Promise<PingResult> {
    const startTime = performance.now();

    if (this.config.isMockMode) {
      await new Promise(r => setTimeout(r, 20));
      return {
        success: true,
        latencyMs: Math.round(performance.now() - startTime),
        canReady: true,
        uptimeMs: 124500,
        freeHeapBytes: 184500,
        info: 'ESP32 Wi-Fi Ready (Mock)'
      };
    }

    if (!this.isConnected()) {
      return { success: false, latencyMs: 0, info: 'ESP32 Wi-Fi Not Connected' };
    }

    return new Promise((resolve) => {
      const pingPacket = BinaryProtocol.encodePing();
      const txHex = Array.from(pingPacket).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

      const pingTimeout = setTimeout(() => {
        this.pingResolver = null;
        resolve({ success: false, latencyMs: Math.round(performance.now() - startTime), info: 'Ping Timeout', txHex });
      }, 2000);

      this.pingResolver = (res) => {
        clearTimeout(pingTimeout);
        this.pingResolver = null;
        resolve({ ...res, txHex });
      };

      this.sendRaw(pingPacket);
    });
  }

  public async getCanStatus(): Promise<CanBusStatus | null> {
    if (this.config.isMockMode) {
      return {
        state: 'READY',
        speed: 500000,
        mode: '11-BIT',
        txErrorCount: 0,
        rxErrorCount: 0,
        busOverrunCount: 0,
        queueSize: 0,
        messagesSent: 1420,
        messagesReceived: 2890
      };
    }

    if (!this.isConnected()) return null;

    return new Promise((resolve) => {
      const statusTimeout = setTimeout(() => {
        this.canStatusResolver = null;
        resolve(null);
      }, 2000);

      this.canStatusResolver = (status) => {
        clearTimeout(statusTimeout);
        this.canStatusResolver = null;
        resolve(status);
      };

      const reqPacket = BinaryProtocol.encodeCanStatusReq();
      this.sendRaw(reqPacket);
    });
  }

  private handleIncomingData(data: ArrayBuffer | string) {
    let newBytes: Uint8Array;
    if (typeof data === 'string') {
      const encoder = new TextEncoder();
      newBytes = encoder.encode(data);
    } else {
      newBytes = new Uint8Array(data);
    }

    // Append to continuous streaming buffer
    const merged = new Uint8Array(this.rxBuffer.length + newBytes.length);
    merged.set(this.rxBuffer);
    merged.set(newBytes, this.rxBuffer.length);
    this.rxBuffer = merged;

    // Parse packets from byte stream
    const { packets, remainingBuffer } = BinaryProtocol.parseStream(this.rxBuffer);
    this.rxBuffer = remainingBuffer;

    if (packets.length > 0) {
      packets.forEach(pkt => this.processDecodedPacket(pkt));
    } else if (this.rxBuffer.length > 0) {
      this.checkAndParseAsciiLines();
    }
  }

  private checkAndParseAsciiLines() {
    if (this.rxBuffer.length === 0) return;
    let str = '';
    for (let i = 0; i < this.rxBuffer.length; i++) {
      str += String.fromCharCode(this.rxBuffer[i]);
    }

    if (str.includes('\r') || str.includes('\n') || str.includes('>')) {
      const lines = str.split(/[\r\n>]+/);
      const endsWithDelim = str.endsWith('\r') || str.endsWith('\n') || str.endsWith('>');
      
      for (let i = 0; i < lines.length - (endsWithDelim ? 0 : 1); i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cleanHex = line.replace(/[^0-9A-Fa-f]/g, '');
        if (cleanHex.length >= 4 && cleanHex.length % 2 === 0) {
          const hexBytes: number[] = [];
          for (let k = 0; k < cleanHex.length; k += 2) {
            hexBytes.push(parseInt(cleanHex.substring(k, k + 2), 16));
          }

          const modeByte = hexBytes[0];
          if (modeByte === 0x41 || modeByte === 0x43 || modeByte === 0x47 || modeByte === 0x4A || modeByte === 0x44 || modeByte === 0x59 || modeByte === 0x7F) {
            const frame: CanFrame = {
              id: '0x7E8',
              dlc: hexBytes.length,
              dataHex: hexBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
              dataBytes: hexBytes,
              direction: 'Rx',
              isExtended: false
            };
            console.log(`[ELM-WIFI-ASCII-RX] Line: "${line}" -> CAN DATA: [${frame.dataHex}]`);
            canManager.addFrame(frame);
            this.canFrameListeners.forEach(l => l(frame));
          }
        }
      }

      if (endsWithDelim) {
        this.rxBuffer = new Uint8Array(0);
      }
    }
  }

  public onKlinePacket(callback: (pkt: DecodedBinaryPacket) => void): () => void {
    this.klinePacketListeners.push(callback);
    return () => {
      this.klinePacketListeners = this.klinePacketListeners.filter(l => l !== callback);
    };
  }

  public async sendKlineInit(protocolId?: number): Promise<{ success: boolean; activeProtocol: number; keyByte1: number; keyByte2: number }> {
    if (this.config.isMockMode) {
      return { success: true, activeProtocol: protocolId || 0x06, keyByte1: 0x8F, keyByte2: 0xEA };
    }
    if (!this.isConnected()) {
      return { success: false, activeProtocol: 0, keyByte1: 0, keyByte2: 0 };
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.klineInitResolver = null;
        resolve({ success: false, activeProtocol: 0, keyByte1: 0, keyByte2: 0 });
      }, 3000);

      this.klineInitResolver = (res) => {
        clearTimeout(timeout);
        this.klineInitResolver = null;
        resolve(res);
      };

      const pkt = BinaryProtocol.encodeKlineInit(protocolId);
      this.sendRaw(pkt);
    });
  }

  public async sendKlineFrame(payload: number[]): Promise<{ status: number; data: number[] }> {
    if (this.config.isMockMode) {
      // Return simulated ECU response for standard OBD-II PID 01 00 (41 00 BE 3E 28 10)
      if (payload[0] === 0x01 && payload[1] === 0x00) {
        return { status: 0, data: [0x41, 0x00, 0xBE, 0x3E, 0x28, 0x10] };
      }
      return { status: 0, data: [payload[0] + 0x40, payload[1] || 0x00, 0x00, 0x00] };
    }
    if (!this.isConnected()) {
      return { status: 0x04, data: [] };
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.klineFrameResolver = null;
        resolve({ status: 0x04, data: [] });
      }, 2500);

      this.klineFrameResolver = (res) => {
        clearTimeout(timeout);
        this.klineFrameResolver = null;
        resolve(res);
      };

      const pkt = BinaryProtocol.encodeKlineFrame(payload);
      this.sendRaw(pkt);
    });
  }

  public async getKlineStatus(): Promise<any | null> {
    if (this.config.isMockMode) {
      return {
        voltagePresent: true,
        activeProtocol: 6,
        initialized: true,
        rxErrorCount: 0,
        txErrorCount: 0,
        lastErrorCode: 0
      };
    }
    if (!this.isConnected()) return null;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.klineStatusResolver = null;
        resolve(null);
      }, 2000);

      this.klineStatusResolver = (status) => {
        clearTimeout(timeout);
        this.klineStatusResolver = null;
        resolve(status);
      };

      const pkt = BinaryProtocol.encodeKlineStatusReq();
      this.sendRaw(pkt);
    });
  }

  private processDecodedPacket(pkt: DecodedBinaryPacket) {
    this.klinePacketListeners.forEach(l => l(pkt));

    if (pkt.cmd === BinaryCommand.CMD_CAN_FRAME && pkt.canFrame) {
      commLogger.logPacket({
        direction: '[WiFi RX]',
        protocol: pkt.canFrame.isExtended ? 'CAN 29-bit' : 'CAN 11-bit',
        canIdHex: pkt.canFrame.id,
        responseRaw: pkt.canFrame.dataHex,
        durationMs: 0,
        status: 'SUCCESS'
      });

      canManager.addFrame(pkt.canFrame);
      this.canFrameListeners.forEach(l => l(pkt.canFrame!));
    } else if (pkt.cmd === BinaryCommand.CMD_PONG && pkt.pongInfo) {
      if (this.pingResolver) {
        const rxHex = Array.from(pkt.rawFrame).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        this.pingResolver({
          success: true,
          latencyMs: 15,
          canReady: pkt.pongInfo.canReady,
          uptimeMs: pkt.pongInfo.uptimeMs,
          freeHeapBytes: pkt.pongInfo.freeHeapBytes,
          rxHex: rxHex,
          info: `ESP32 Wi-Fi Up: ${(pkt.pongInfo.uptimeMs / 1000).toFixed(1)}s | Heap: ${(pkt.pongInfo.freeHeapBytes / 1024).toFixed(0)}KB`
        });
      }
    } else if (pkt.cmd === BinaryCommand.CMD_CAN_STATUS_RESP && pkt.canStatus) {
      if (this.canStatusResolver) {
        this.canStatusResolver(pkt.canStatus);
      }
    } else if (pkt.cmd === BinaryCommand.CMD_KLINE_INIT_RESP && pkt.klineInitResult) {
      commLogger.logPacket({
        direction: '[KLINE RX]',
        protocol: pkt.klineInitResp?.activeProtocol || 'K-LINE',
        decodedData: 'KLINE_INIT',
        responseRaw: `Status=${pkt.klineInitResult.success ? 'SUCCESS' : 'FAILED'} KB1=0x${pkt.klineInitResult.keyByte1.toString(16).padStart(2, '0').toUpperCase()} KB2=0x${pkt.klineInitResult.keyByte2.toString(16).padStart(2, '0').toUpperCase()}`,
        durationMs: 0,
        status: pkt.klineInitResult.success ? 'SUCCESS' : 'ERROR'
      });
      if (this.klineInitResolver) {
        this.klineInitResolver(pkt.klineInitResult);
      }
    } else if (pkt.cmd === BinaryCommand.CMD_KLINE_FRAME && pkt.klineFrameResult) {
      commLogger.logPacket({
        direction: '[KLINE RX]',
        protocol: 'K-LINE',
        decodedData: 'KLINE_FRAME',
        responseRaw: pkt.klineFrame?.rawHex || '',
        durationMs: 0,
        status: pkt.klineFrameResult.status === 0 ? 'SUCCESS' : 'ERROR'
      });
      if (this.klineFrameResolver) {
        this.klineFrameResolver(pkt.klineFrameResult);
      }
    } else if (pkt.cmd === BinaryCommand.CMD_KLINE_STATUS_RESP && pkt.klineStatus) {
      if (this.klineStatusResolver) {
        this.klineStatusResolver(pkt.klineStatus);
      }
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected() && !this.config.isMockMode) {
        const pingPkt = BinaryProtocol.encodePing();
        this.sendRaw(pingPkt).catch(() => {});
      }
    }, 5000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}
