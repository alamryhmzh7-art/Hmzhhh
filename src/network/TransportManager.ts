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
import { IsoTpProtocol, IsoTpFrameType, FlowStatus } from '../isotp/isoTpProtocol';

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
      for (const seqNumStr in this.pendingRequests) {
        const seq = parseInt(seqNumStr);
        const req = this.pendingRequests[seq];
        const expectedResponseId = req.canId + 8;
        
        // Matching logic
        const isMatch = (req.canId === 0x7DF && frameIdNum >= 0x7E8 && frameIdNum <= 0x7EF) ||
                        (frameIdNum === expectedResponseId) ||
                        (req.isExtended && this.isExtendedMatch(req.canId, frameIdNum));

        if (!isMatch) continue;

        const data = frame.dataBytes;
        if (!data || data.length === 0) continue;

        const pciType = data[0] & 0xF0;

        // Strict ISO-TP State Machine
        if (req.isoTpBuffer) {
           // Expecting Consecutive Frames (CF)
           if (pciType === 0x20) {
              const cfSeq = data[0] & 0x0F;
              if (cfSeq === req.isoTpBuffer.expectedSequence) {
                const remaining = req.isoTpBuffer.totalLength - req.isoTpBuffer.receivedBytes.length;
                if (remaining <= 0) {
                   console.warn(`[ISO-TP] [${req.correlationId}] Extra CF ignored.`);
                   break;
                }
                const take = Math.min(7, remaining);
                for (let i = 0; i < take; i++) {
                  req.isoTpBuffer.receivedBytes.push(data[1 + i]);
                }
                req.isoTpBuffer.expectedSequence = (req.isoTpBuffer.expectedSequence + 1) & 0x0F;

                if (req.isoTpBuffer.receivedBytes.length >= req.isoTpBuffer.totalLength) {
                  const fullPayload = req.isoTpBuffer.receivedBytes.slice(0, req.isoTpBuffer.totalLength);
                  clearTimeout(req.timer);
                  delete this.pendingRequests[seq];
                  console.log(`[ISO-TP] [${req.correlationId}] Reassembled ${fullPayload.length} bytes.`);
                  req.resolve(fullPayload);
                }
              } else {
                console.error(`[ISO-TP] [${req.correlationId}] SEQUENCE ERROR: Expected ${req.isoTpBuffer.expectedSequence}, got ${cfSeq}. Aborting.`);
                clearTimeout(req.timer);
                delete this.pendingRequests[seq];
                req.reject(new Error('ISO_TP_SEQUENCE_MISMATCH'));
              }
           } else if (pciType === 0x10) {
              // Restarting multi-frame session on same ID?
              console.warn(`[ISO-TP] [${req.correlationId}] Received new FF while session active. Resetting.`);
              this.handleFirstFrame(req, frameIdNum, data, seq);
           } else if (pciType === 0x00) {
              // Received SF while multi-frame session active? 
              console.warn(`[ISO-TP] [${req.correlationId}] Received SF while multi-frame active. Aborting multi-frame.`);
              this.handleSingleFrame(req, frameIdNum, data, seq);
           } else {
              console.warn(`[ISO-TP] [${req.correlationId}] Unexpected PCI 0x${pciType.toString(16)} during CF session.`);
           }
           break;
        }

        // No active multi-frame buffer
        if (pciType === 0x00) {
           this.handleSingleFrame(req, frameIdNum, data, seq);
        } else if (pciType === 0x10) {
           this.handleFirstFrame(req, frameIdNum, data, seq);
        } else {
           // Raw fallback only if explicitly not ISO-TP
           console.log(`[CAN-RX] [${req.correlationId}] Raw Frame: 0x${frameIdNum.toString(16).toUpperCase()}`);
           clearTimeout(req.timer);
           delete this.pendingRequests[seq];
           req.resolve(data);
        }
        break;
      }
    };
    this.wifiTransport.onCanFrame(handleCanFrame);
    this.btTransport.onCanFrame(handleCanFrame);
  }

  private handleSingleFrame(req: PendingDiagnosticRequest, frameIdNum: number, data: number[], seq: number) {
    const sfLength = data[0] & 0x0F;
    if (sfLength === 0 || sfLength > 7) {
       console.warn(`[ISO-TP] [${req.correlationId}] Invalid SF_DL: ${sfLength}`);
       return;
    }
    const payload = data.slice(1, 1 + sfLength);
    clearTimeout(req.timer);
    delete this.pendingRequests[seq];
    console.log(`[ISO-TP] [${req.correlationId}] Single Frame from 0x${frameIdNum.toString(16).toUpperCase()}: [${payload.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}]`);
    req.resolve(payload);
  }

  private handleFirstFrame(req: PendingDiagnosticRequest, frameIdNum: number, data: number[], seq: number) {
    const totalLength = ((data[0] & 0x0F) << 8) | data[1];
    if (totalLength <= 6 || totalLength > 4095) {
       console.error(`[ISO-TP] [${req.correlationId}] Invalid FF_DL: ${totalLength}. Aborting.`);
       clearTimeout(req.timer);
       delete this.pendingRequests[seq];
       req.reject(new Error('ISO_TP_INVALID_LENGTH'));
       return;
    }
    const initialBytes = data.slice(2, 8);
    req.isoTpBuffer = {
      totalLength,
      receivedBytes: [...initialBytes],
      expectedSequence: 1
    };
    console.log(`[ISO-TP] [${req.correlationId}] First Frame from 0x${frameIdNum.toString(16).toUpperCase()}: TotalLen=${totalLength}`);

    const fcTargetId = this.resolveIsoTpFlowControlId(req.canId, frameIdNum);
    if (fcTargetId === null) {
      console.error(`[ISO-TP] [${req.correlationId}] FAILED to determine Flow Control ID for response 0x${frameIdNum.toString(16).toUpperCase()}. Aborting.`);
      clearTimeout(req.timer);
      delete this.pendingRequests[seq];
      req.reject(new Error('ISO_TP_ADDRESSING_ERROR'));
      return;
    }

    // FC Frame: BS=0, STmin=0 (Standard)
    const fcFrame = [0x30, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    this.activeTransport.sendCanFrame(fcTargetId, fcFrame, req.isExtended).then(() => {
      console.log(`[ISO-TP] [${req.correlationId}] Sent Flow Control (FC) to 0x${fcTargetId.toString(16).toUpperCase()}`);
    }).catch(err => {
      console.error(`[ISO-TP] [${req.correlationId}] Failed to send Flow Control:`, err);
      clearTimeout(req.timer);
      delete this.pendingRequests[seq];
      req.reject(new Error('FLOW_CONTROL_SEND_FAILED'));
    });
  }

  /**
   * Resolve Flow Control (FC) Target ID based on ISO 15765-2 rules
   */
  public resolveIsoTpFlowControlId(requestCanId: number, responseCanId: number): number | null {
    // Standard 11-bit OBD Physical Addressing (0x7E0-0x7E7 Request -> 0x7E8-0x7EF Response)
    if (responseCanId >= 0x7E8 && responseCanId <= 0x7EF) {
      if (requestCanId === 0x7DF) return responseCanId - 8;
      if (requestCanId === responseCanId - 8) return requestCanId;
    }

    // Extended 29-bit Addressing (ISO 15765-2)
    // Req: 18 DA [Target] [Source] | Res: 18 DA [Source] [Target]
    if (requestCanId > 0x7FF && responseCanId > 0x7FF) {
      const reqPrefix = (requestCanId >>> 24) & 0xFF;
      const resPrefix = (responseCanId >>> 24) & 0xFF;
      if (reqPrefix === 0x18 && resPrefix === 0x18) {
        const reqDA = (requestCanId >>> 8) & 0xFF;
        const reqSA = requestCanId & 0xFF;
        const resDA = (responseCanId >>> 8) & 0xFF;
        const resSA = responseCanId & 0xFF;
        
        if (resSA === reqDA && resDA === reqSA) return requestCanId;
        if (requestCanId === 0x18DB33F1 && resDA === 0xF1) {
          // Functional 29-bit responded by physical ECU
          return (0x18DA0000 | (resSA << 8) | 0xF1) >>> 0;
        }
      }
    }

    // Fallback for custom 11-bit pairs (Req+8 = Res)
    if (responseCanId === requestCanId + 8) return requestCanId;

    return null;
  }

  private isExtendedMatch(reqId: number, resId: number): boolean {
    if (reqId === 0x18DB33F1) return ((resId >>> 24) === 0x18 && ((resId >>> 16) & 0xFF) === 0xDA && (resId & 0xFF) === 0xF1);
    const reqDA = (reqId >>> 8) & 0xFF;
    const reqSA = reqId & 0xFF;
    const resDA = (resId >>> 8) & 0xFF;
    const resSA = resId & 0xFF;
    return (resSA === reqDA && resDA === reqSA);
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
  public async sendRequest(requestBytes: number[], targetCanId: string = '0x7DF'): Promise<CommunicationPacket> {
    this.sequenceId++;
    const startTime = performance.now();
    const reqHex = requestBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    const numCanId = parseInt(targetCanId.replace('0x', ''), 16) || 0x7DF;
    const isExtended = targetCanId.length > 5;
    const correlationId = `OBD-${this.sequenceId}`;
    
    // Logging prefixes as requested
    const txLogPrefix = '[CAN-TX]';
    const rxLogPrefix = '[CAN-RX]';
    const obdPrefix = '[OBD]';

    console.log(`${obdPrefix} [${correlationId}] REQ TO ${targetCanId}: [${reqHex}]`);

    // In REAL MODE: verify physical connection
    if (!this.isConnected() && !this.config.isMockMode) {
      const errPkt = commLogger.logPacket({
        direction: '[OBD RX]',
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

      console.log(`${txLogPrefix} [${correlationId}] ID=0x${numCanId.toString(16).toUpperCase()} DATA=[${canPayload.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}]`);

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
        
        // Real response is picked up via stream listeners (ISO-TP reassembly handled in constructor)
        const seq = this.sequenceId;
        responseBytes = await new Promise<number[]>((resolve, reject) => {
           const timer = setTimeout(() => {
              delete this.pendingRequests[seq];
              console.warn(`[OBD] [${correlationId}] TIMEOUT waiting for ECU response on 0x${numCanId.toString(16).toUpperCase()}`);
              reject(new Error('TIMEOUT_WAITING_FOR_ECU_RESPONSE'));
           }, 2500);
           this.pendingRequests[seq] = { resolve, reject, canId: numCanId, isExtended, correlationId, timer };
        });
      }

      const durationMs = Math.round(performance.now() - startTime);
      const resHex = responseBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      const parsed = PacketParser.parse(responseBytes);
      
      console.log(`${obdPrefix} [${correlationId}] RESP FROM ECU: [${resHex}] (${durationMs}ms)`);

      const respPkt = commLogger.logPacket({
        direction: '[OBD RX]',
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
      console.warn(`[OBD-FAIL] [${correlationId}] Error: ${err?.message || 'Response Timeout'}`);
      const errPkt = commLogger.logPacket({
        direction: '[OBD RX]',
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
