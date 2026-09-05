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
      const pingTimeout = setTimeout(() => {
        this.pingResolver = null;
        resolve({ success: false, latencyMs: Math.round(performance.now() - startTime), info: 'Ping Timeout' });
      }, 2000);

      this.pingResolver = (res) => {
        clearTimeout(pingTimeout);
        this.pingResolver = null;
        resolve(res);
      };

      const pingPacket = BinaryProtocol.encodePing();
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

    packets.forEach(pkt => this.processDecodedPacket(pkt));
  }

  private processDecodedPacket(pkt: DecodedBinaryPacket) {
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
        this.pingResolver({
          success: true,
          latencyMs: 15,
          canReady: pkt.pongInfo.canReady,
          uptimeMs: pkt.pongInfo.uptimeMs,
          freeHeapBytes: pkt.pongInfo.freeHeapBytes,
          info: `ESP32 Wi-Fi Up: ${(pkt.pongInfo.uptimeMs / 1000).toFixed(1)}s | Heap: ${(pkt.pongInfo.freeHeapBytes / 1024).toFixed(0)}KB`
        });
      }
    } else if (pkt.cmd === BinaryCommand.CMD_CAN_STATUS_RESP && pkt.canStatus) {
      if (this.canStatusResolver) {
        this.canStatusResolver(pkt.canStatus);
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
