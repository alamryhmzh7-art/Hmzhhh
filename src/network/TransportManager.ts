/**
 * HAMZA OBD PRO - Unified Transport Manager
 * 
 * Orchestrates dual transports (Wi-Fi TCP & Bluetooth Classic SPP) without duplicating
 * any diagnostic logic (CAN, ISO-TP, UDS, OBD-II PIDs, DTCs, VIN).
 * 
 * Enforces strict REAL MODE vs DEMO MODE boundaries:
 * In REAL MODE: If hardware is disconnected, rejects requests with "ESP32 NOT CONNECTED".
 */

import { ConnectionConfig, ConnectionStatus, CanFrame, CanBusStatus, TransportType, BluetoothDeviceInfo, CommunicationPacket } from '../types';
import { ITransport, PingResult, defaultConnectionConfig } from './Transport';
import { WifiTcpTransport } from './WifiTcpTransport';
import { BluetoothSppTransport } from './BluetoothSppTransport';
import { commLogger, AppLogger } from '../logging/logger';
import { canManager } from '../can/canManager';
import { PacketParser } from './TcpClient';

interface PendingDiagnosticRequest {
  resolve: (data: number[]) => void;
  reject: (err: Error) => void;
  canId: number;
  timer: any;
  correlationId: string;
  isExtended: boolean;
  isoTpBuffer?: {
    totalLength: number;
    receivedBytes: number[];
    expectedSequence: number;
  };
}

export class TransportManager {
  private config: ConnectionConfig;
  private wifiTransport: WifiTcpTransport;
  private btTransport: BluetoothSppTransport;
  private activeTransport: ITransport;
  private statusListeners: ((status: ConnectionStatus, type: TransportType) => void)[] = [];
  private sequenceId: number = 0;
  private pendingRequests: { [seq: number]: PendingDiagnosticRequest } = {};

  constructor(initialConfig: ConnectionConfig) {
    this.config = initialConfig;
    this.wifiTransport = new WifiTcpTransport(this.config);
    this.btTransport = new BluetoothSppTransport(this.config);
    
    // Select default transport
    this.activeTransport = this.config.transportType === 'BLUETOOTH_SPP' 
      ? this.btTransport 
      : this.wifiTransport;

    console.log(`[MANAGER] Active Transport: ${this.activeTransport.type}`);
    console.log(`[MANAGER] Transport Instance: ${this.activeTransport.constructor.name}`);
    console.log(`[MANAGER] Transport State: ${this.activeTransport.getState()}`);
    console.log(`[MANAGER] isConnected: ${this.activeTransport.isConnected()}`);

    // Attach listeners
    this.wifiTransport.onStateChange((state) => {
      if (this.activeTransport.type === 'WIFI_TCP') {
        console.log(`[MANAGER] Wi-Fi Transport State Change: ${state}`);
        this.notifyStatus(state);
      }
    });

    this.btTransport.onStateChange((state, error) => {
      if (this.activeTransport.type === 'BLUETOOTH_SPP') {
        console.log(`[MANAGER] BT SPP Transport State Change: ${state} (Error: ${error || 'none'})`);
        this.notifyStatus(state);
      }
    });

    const handleCanFrame = (frame: CanFrame) => {
      const frameIdNum = parseInt(frame.id.replace('0x', ''), 16);
      for (const seq in this.pendingRequests) {
        const req = this.pendingRequests[seq];
        const expectedResponseId = req.canId + 8;
        // Strict matching: 0x7DF matches any ECU response 0x7E8-0x7EF; targeted IDs match exact req.canId + 8
        const isMatch = (req.canId === 0x7DF && frameIdNum >= 0x7E8 && frameIdNum <= 0x7EF) ||
                        (frameIdNum === expectedResponseId);
        if (!isMatch) continue;

        const data = frame.dataBytes;
        if (!data || data.length === 0) continue;

        const pciType = data[0] & 0xF0;

        // Case 1: ISO-TP Single Frame (0x00 - 0x0F)
        if (pciType === 0x00) {
          const sfLength = data[0] & 0x0F;
          const payload = (sfLength > 0 && sfLength <= 7) ? data.slice(1, 1 + sfLength) : data.slice(1);
          clearTimeout(req.timer);
          delete this.pendingRequests[seq];
          console.log(`[CAN-RX] [${req.correlationId}] Single Frame from 0x${frameIdNum.toString(16).toUpperCase()}: Payload=[${payload.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}]`);
          req.resolve(payload);
          break;
        }

        // Case 2: ISO-TP First Frame (0x10) -> Multi-frame starts
        if (pciType === 0x10 && data.length >= 8) {
          const totalLength = ((data[0] & 0x0F) << 8) | data[1];
          const initialBytes = data.slice(2, 8);
          req.isoTpBuffer = {
            totalLength,
            receivedBytes: [...initialBytes],
            expectedSequence: 1
          };
          console.log(`[CAN-RX] [${req.correlationId}] First Frame from 0x${frameIdNum.toString(16).toUpperCase()}: TotalLen=${totalLength}, InitialBytes=${initialBytes.length}`);

          // Send ISO-TP Flow Control (FC) frame back to ECU
          const fcFrame = [0x30, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
          this.activeTransport.sendCanFrame(req.canId, fcFrame, req.isExtended).catch(err => {
            console.error(`[CAN-TX] [${req.correlationId}] Failed to send Flow Control:`, err);
          });
          console.log(`[CAN-TX] [${req.correlationId}] Sent Flow Control (FC) to 0x${req.canId.toString(16).toUpperCase()}`);
          break;
        }

        // Case 3: ISO-TP Consecutive Frame (0x20)
        if (pciType === 0x20 && req.isoTpBuffer) {
          const seqNum = data[0] & 0x0F;
          if (seqNum === req.isoTpBuffer.expectedSequence) {
            const remaining = req.isoTpBuffer.totalLength - req.isoTpBuffer.receivedBytes.length;
            const take = Math.min(7, remaining);
            for (let i = 0; i < take; i++) {
              req.isoTpBuffer.receivedBytes.push(data[1 + i]);
            }
            req.isoTpBuffer.expectedSequence = (req.isoTpBuffer.expectedSequence + 1) & 0x0F;

            if (req.isoTpBuffer.receivedBytes.length >= req.isoTpBuffer.totalLength) {
              const fullPayload = [...req.isoTpBuffer.receivedBytes];
              clearTimeout(req.timer);
              delete this.pendingRequests[seq];
              console.log(`[CAN-RX] [${req.correlationId}] Multi-frame complete (${fullPayload.length} bytes): Payload=[${fullPayload.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}]`);
              req.resolve(fullPayload);
            }
          } else {
            console.warn(`[CAN-RX] [${req.correlationId}] ISO-TP Sequence mismatch: expected ${req.isoTpBuffer.expectedSequence}, got ${seqNum}`);
          }
          break;
        }

        // Case 4: Non-ISO-TP raw frame fallback
        clearTimeout(req.timer);
        delete this.pendingRequests[seq];
        req.resolve(data);
        break;
      }
    };
    this.wifiTransport.onCanFrame(handleCanFrame);
    this.btTransport.onCanFrame(handleCanFrame);
  }

  public subscribeStatus(listener: (status: ConnectionStatus, type: TransportType) => void): () => void {
    this.statusListeners.push(listener);
    listener(this.activeTransport.getState(), this.activeTransport.type);
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== listener);
    };
  }

  private notifyStatus(state: ConnectionStatus) {
    console.log(`[MANAGER] notifyStatus -> State: ${state}, Type: ${this.activeTransport.type}, isConnected: ${this.activeTransport.isConnected()}`);
    this.statusListeners.forEach(l => l(state, this.activeTransport.type));
  }

  public getStatus(): ConnectionStatus {
    return this.activeTransport.getState();
  }

  public isConnected(): boolean {
    const connected = this.activeTransport.isConnected();
    console.log(`[MANAGER] isConnected called -> Active: ${this.activeTransport.type}, Result: ${connected}`);
    return connected;
  }

  public getActiveTransportType(): TransportType {
    return this.activeTransport.type;
  }

  public getConfig(): ConnectionConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<ConnectionConfig>) {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.transportType && newConfig.transportType !== this.activeTransport.type) {
      this.setTransportType(newConfig.transportType);
    }
  }

  public async setTransportType(type: TransportType): Promise<void> {
    if (this.activeTransport.type === type) return;

    // Disconnect previous transport before switching
    if (this.activeTransport.isConnected()) {
      await this.activeTransport.disconnect();
    }

    this.config.transportType = type;
    this.activeTransport = type === 'BLUETOOTH_SPP' ? this.btTransport : this.wifiTransport;
    
    console.log(`[MANAGER] Active Transport: ${this.activeTransport.type}`);
    console.log(`[MANAGER] Transport Instance: ${this.activeTransport.constructor.name}`);
    console.log(`[MANAGER] Transport State: ${this.activeTransport.getState()}`);
    console.log(`[MANAGER] isConnected: ${this.activeTransport.isConnected()}`);

    AppLogger.info(
      'NETWORK',
      'TransportSwitch',
      `Switched active transport to: ${type === 'BLUETOOTH_SPP' ? 'Bluetooth Classic SPP' : 'Wi-Fi TCP'}`,
      `تم تحويل وسيلة الاتصال النشطة إلى: ${type === 'BLUETOOTH_SPP' ? 'بلوتوث SPP' : 'واي فاي TCP'}`
    );

    this.notifyStatus(this.activeTransport.getState());
  }

  public async connect(overrideConfig?: Partial<ConnectionConfig>): Promise<boolean> {
    console.log('[BT-FLOW-v2] TransportManager.connect START');
    if (overrideConfig) {
      this.updateConfig(overrideConfig);
    }
    console.log(`[MANAGER] Connecting via Active Transport: ${this.activeTransport.type} (Instance: ${this.activeTransport.constructor.name})`);
    const ok = await this.activeTransport.connect(this.config);
    console.log(`[MANAGER] Connect result for ${this.activeTransport.type}: ${ok}, State: ${this.activeTransport.getState()}, isConnected: ${this.activeTransport.isConnected()}`);
    return ok;
  }

  public async disconnect(): Promise<void> {
    console.log(`[MANAGER] Disconnecting active transport: ${this.activeTransport.type}`);
    await this.activeTransport.disconnect();
    console.log(`[MANAGER] Disconnected. State: ${this.activeTransport.getState()}, isConnected: ${this.activeTransport.isConnected()}`);
  }

  public async scanBluetoothDevices(onDeviceFound?: (dev: BluetoothDeviceInfo) => void): Promise<BluetoothDeviceInfo[]> {
    if (this.btTransport.scanDevices) {
      return this.btTransport.scanDevices(onDeviceFound);
    }
    return [];
  }

  public async ping(): Promise<PingResult> {
    console.log(`[MANAGER] Active Transport: ${this.activeTransport.type}`);
    console.log(`[MANAGER] Transport Instance: ${this.activeTransport.constructor.name}`);
    console.log(`[MANAGER] Transport State: ${this.activeTransport.getState()}`);
    console.log(`[MANAGER] isConnected: ${this.activeTransport.isConnected()}`);
    console.log(`[MANAGER] PING START`);

    if (!this.activeTransport.isConnected() && !this.config.isMockMode) {
      console.log(`[MANAGER] PING RESULT: FAILED - ESP32 Bluetooth SPP Not Connected`);
      console.log(`[MANAGER] PING RX: None (Transport Not Connected)`);
      return { success: false, latencyMs: 0, info: 'ESP32 Bluetooth SPP Not Connected' };
    }

    try {
      const res = await this.activeTransport.ping();
      console.log(`[MANAGER] PING RESULT: ${res.success ? 'SUCCESS' : 'FAILED'}, Latency: ${res.latencyMs}ms`);
      console.log(`[MANAGER] PING RX: ${JSON.stringify(res)}`);
      return res;
    } catch (err: any) {
      console.log(`[MANAGER] PING RESULT: ERROR - ${err?.message}`);
      console.log(`[MANAGER] PING RX: Error: ${err?.message}`);
      return { success: false, latencyMs: 0, info: err?.message || 'Ping Error' };
    }
  }

  public async getCanStatus(): Promise<CanBusStatus | null> {
    return this.activeTransport.getCanStatus();
  }

  public getTransport(type: TransportType): ITransport {
    return type === 'WIFI_TCP' ? this.wifiTransport : this.btTransport;
  }

  public async sendCanFrame(canId: number, data: number[], isExtended: boolean = false): Promise<boolean> {
    if (!this.isConnected() && !this.config.isMockMode) {
      AppLogger.warn('NETWORK', 'SendFrame', 'ESP32 NOT CONNECTED - Frame aborted', 'ESP32 غير متصل - تم إلغاء إرسال الإطار');
      return false;
    }
    return this.activeTransport.sendCanFrame(canId, data, isExtended);
  }

  public getDiagnosticReport() {
    const btRaw = typeof (this.btTransport as any).getRawConnectionState === 'function'
      ? (this.btTransport as any).getRawConnectionState()
      : null;
    return {
      activeTransportType: this.activeTransport.type,
      transportInstance: this.activeTransport.constructor.name,
      status: this.activeTransport.getState(),
      isConnected: this.activeTransport.isConnected(),
      btRawConnectionState: btRaw,
      config: this.getConfig()
    };
  }

  /**
   * Unified Request / Response dispatcher with strict Real Mode vs Demo Mode enforcement
   */
  public async sendRequest(requestBytes: number[], targetCanId: string = '0x7E0'): Promise<CommunicationPacket> {
    this.sequenceId++;
    const startTime = performance.now();
    const reqHex = requestBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    const numCanId = parseInt(targetCanId.replace('0x', ''), 16) || 0x7E0;
    const isExtended = targetCanId.length > 5;
    const correlationId = `CORR-${this.sequenceId}-${Date.now()}`;
    const transportPrefix = this.activeTransport.type === 'BLUETOOTH_SPP' ? '[BT TX]' : '[WiFi TX]';
    const rxPrefix = this.activeTransport.type === 'BLUETOOTH_SPP' ? '[BT RX]' : '[WiFi RX]';

    // In REAL MODE: verify physical connection
    if (!this.isConnected() && !this.config.isMockMode) {
      const errPkt = commLogger.logPacket({
        direction: rxPrefix,
        protocol: this.config.protocol,
        canIdHex: targetCanId,
        requestRaw: reqHex,
        error: 'ESP32 NOT CONNECTED',
        durationMs: 0,
        status: 'ERROR'
      });
      AppLogger.warn(
        'NETWORK',
        'RealModeCheck',
        `[${correlationId}] Command blocked: ESP32 is NOT CONNECTED in Real Mode`,
        'تم حظر الأمر: جهاز ESP32 غير متصل في الوضع الحقيقي',
        reqHex
      );
      return errPkt;
    }

    try {
      let responseBytes: number[] = [];

      // Format diagnostic CAN frame: ISO-TP Single Frame if payload <= 7 bytes
      let canPayload: number[];
      if (requestBytes.length <= 7) {
        canPayload = [requestBytes.length, ...requestBytes];
        while (canPayload.length < 8) {
          canPayload.push(0x00);
        }
      } else {
        canPayload = [...requestBytes];
      }

      console.log(`[DIAG-REQ] [${correlationId}] CAN ID=0x${numCanId.toString(16).toUpperCase()} DATA=[${canPayload.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}]`);

      if (this.config.isMockMode) {
        // Send through active transport mock pipeline
        await this.activeTransport.sendCanFrame(numCanId, canPayload, isExtended);
        // Wait for mock pipeline
        await new Promise(r => setTimeout(r, 25));
        const { mockEcuServer } = await import('./mockEcuServer');
        responseBytes = await mockEcuServer.handleRequest(requestBytes);
      } else {
        // Real hardware send
        const ok = await this.activeTransport.sendCanFrame(numCanId, canPayload, isExtended);
        if (!ok) throw new Error('Failed to send packet over transport');
        // Real response is picked up via stream listeners
        const seq = this.sequenceId;
        responseBytes = await new Promise<number[]>((resolve, reject) => {
           const timer = setTimeout(() => {
              delete this.pendingRequests[seq];
              console.warn(`[DIAG-TIMEOUT] [${correlationId}] No CAN response from ECU on 0x${numCanId.toString(16).toUpperCase()}`);
              reject(new Error('TIMEOUT_WAITING_FOR_ECU_RESPONSE'));
           }, 2500);
           this.pendingRequests[seq] = { resolve, reject, canId: numCanId, isExtended, correlationId, timer };
        });
      }

      const durationMs = Math.round(performance.now() - startTime);
      const resHex = responseBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      const parsed = PacketParser.parse(responseBytes);
      console.log(`[DIAG-RESP] [${correlationId}] Latency=${durationMs}ms Status=${responseBytes[0] === 0x7F ? 'NRC' : 'SUCCESS'} DATA=[${resHex}]`);

      const respPkt = commLogger.logPacket({
        direction: rxPrefix,
        protocol: this.config.protocol,
        canIdHex: (numCanId === 0x7DF || numCanId === 0x7E0) ? '0x7E8' : '0x7E9',
        requestRaw: reqHex,
        responseRaw: resHex,
        decodedData: parsed.asciiString,
        durationMs,
        status: responseBytes[0] === 0x7F ? 'NRC' : 'SUCCESS'
      });

      return respPkt;
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      console.warn(`[DIAG-FAIL] [${correlationId}] Error: ${err?.message || 'Response Timeout'}`);
      const errPkt = commLogger.logPacket({
        direction: rxPrefix,
        protocol: this.config.protocol,
        canIdHex: targetCanId,
        requestRaw: reqHex,
        error: err?.message || 'Response Timeout',
        durationMs,
        status: 'TIMEOUT'
      });

      return errPkt;
    }
  }
}

export { defaultConnectionConfig } from './Transport';

export const transportManager = new TransportManager(defaultConnectionConfig);
