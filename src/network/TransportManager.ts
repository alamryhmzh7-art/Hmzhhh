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
  requestBytes: number[];
  expectedResponseId?: number;
  actualResponseId?: number;
  timer: any;
  isoTpTimer?: any;
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
  private requestQueue: Promise<any> = Promise.resolve();

  constructor(initialConfig: ConnectionConfig) {
    this.config = initialConfig;
    this.wifiTransport = new WifiTcpTransport(this.config);
    this.btTransport = new BluetoothSppTransport(this.config);
    
    // Select default transport
    this.activeTransport = this.config.transportType === 'BLUETOOTH_SPP' 
      ? this.btTransport 
      : this.wifiTransport;

    console.log(`[MANAGER] Active Transport: ${this.activeTransport.type}`);
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
      
      // Log EVERY incoming CAN frame at the transport manager level
      console.log(`[TM-CAN-RX] CAN=0x${frameIdNum.toString(16).toUpperCase()} EXT=${frame.isExtended} DLC=${frame.dlc} DATA=[${frame.dataHex}]`);
      
      for (const seqNumStr in this.pendingRequests) {
        const seq = parseInt(seqNumStr);
        const req = this.pendingRequests[seq];
        
        let isMatch = false;
        if (req.actualResponseId !== undefined) {
          isMatch = (frameIdNum === req.actualResponseId);
        } else {
          if (!req.isExtended) {
            if (req.canId === 0x7DF) {
              isMatch = (frameIdNum >= 0x7E8 && frameIdNum <= 0x7EF);
            } else {
              isMatch = (frameIdNum === req.canId + 8);
            }
          } else {
            isMatch = this.isExtendedMatch(req.canId, frameIdNum);
          }
        }

        if (!isMatch) continue;

        const data = frame.dataBytes;
        if (!data || data.length < 2) continue;

        // Lock actual response ID once found
        if (req.actualResponseId === undefined) {
          req.actualResponseId = frameIdNum;
        }

        const pciType = data[0] & 0xF0;

        // Strict PID matching check for start of response
        if (!req.isoTpBuffer) {
          let payloadStart: number[] = [];
          if (pciType === 0x00) payloadStart = data.slice(1, 3);
          else if (pciType === 0x10) payloadStart = data.slice(2, 4);
          
          if (payloadStart.length >= 1) {
            const expectedMode = req.requestBytes[0] + 0x40;
            const hasPid = req.requestBytes.length >= 2;
            const expectedPid = hasPid ? req.requestBytes[1] : null;
            
            const modeMatch = payloadStart[0] === expectedMode;
            const pidMatch = !hasPid || (payloadStart.length >= 2 && payloadStart[1] === expectedPid);

            if (!modeMatch || !pidMatch) {
               if (payloadStart[0] !== 0x7F) {
                 console.warn(`[TM-CAN-RX] Mismatched PID: Expected 0x${expectedMode.toString(16)}${hasPid ? ` 0x${expectedPid?.toString(16)}` : ''}, got 0x${payloadStart[0].toString(16)}${payloadStart[1] ? ` 0x${payloadStart[1].toString(16)}` : ''}`);
                 continue;
               }
            }
          }
        }

        // ISO-TP Reassembly
        if (req.isoTpBuffer) {
           if (pciType === 0x20) {
              if (req.isoTpTimer) clearTimeout(req.isoTpTimer);
              const cfSeq = data[0] & 0x0F;
              if (cfSeq === req.isoTpBuffer.expectedSequence) {
                const remaining = req.isoTpBuffer.totalLength - req.isoTpBuffer.receivedBytes.length;
                const take = Math.min(7, remaining);
                for (let i = 0; i < take; i++) req.isoTpBuffer.receivedBytes.push(data[1 + i]);
                req.isoTpBuffer.expectedSequence = (req.isoTpBuffer.expectedSequence + 1) & 0x0F;

                if (req.isoTpBuffer.receivedBytes.length >= req.isoTpBuffer.totalLength) {
                  const fullPayload = req.isoTpBuffer.receivedBytes.slice(0, req.isoTpBuffer.totalLength);
                  this.cleanupRequest(seq);
                  req.resolve(fullPayload);
                } else {
                  req.isoTpTimer = setTimeout(() => {
                    this.cleanupRequest(seq);
                    req.reject(new Error('ISO_TP_CONSECUTIVE_FRAME_TIMEOUT'));
                  }, 1500);
                }
              } else {
                this.cleanupRequest(seq);
                req.reject(new Error('ISO_TP_SEQUENCE_MISMATCH'));
              }
           }
           break;
        }

        if (pciType === 0x00) {
           this.handleSingleFrame(req, frameIdNum, data, seq);
        } else if (pciType === 0x10) {
           this.handleFirstFrame(req, frameIdNum, data, seq);
        }
        break;
      }
    };
    this.wifiTransport.onCanFrame(handleCanFrame);
    this.btTransport.onCanFrame(handleCanFrame);
  }

  private notifyStatus(status: ConnectionStatus) {
    this.statusListeners.forEach(l => l(status, this.activeTransport.type));
  }

  private isExtendedMatch(reqId: number, resId: number): boolean {
    const reqDA = (reqId >>> 8) & 0xFF;
    const reqSA = reqId & 0xFF;
    const resDA = (resId >>> 8) & 0xFF;
    const resSA = resId & 0xFF;
    return (resSA === reqDA && resDA === reqSA);
  }

  public isConnected(): boolean {
    return this.activeTransport.getState() === 'CONNECTED';
  }

  public getTransport(type?: TransportType): ITransport {
    if (type === 'WIFI_TCP') return this.wifiTransport;
    if (type === 'BLUETOOTH_SPP') return this.btTransport;
    return this.activeTransport;
  }

  public subscribeStatus(listener: (status: ConnectionStatus, type: TransportType) => void) {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== listener);
    };
  }

  public updateConfig(newConfig: Partial<ConnectionConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.wifiTransport.updateConfig(this.config);
    this.btTransport.updateConfig(this.config);
    
    if (newConfig.transportType) {
      this.activeTransport = newConfig.transportType === 'BLUETOOTH_SPP' 
        ? this.btTransport 
        : this.wifiTransport;
      console.log(`[MANAGER] Switched to ${this.activeTransport.type}`);
      this.notifyStatus(this.activeTransport.getState());
    }
  }

  public async connect(config?: Partial<ConnectionConfig>): Promise<boolean> {
    return this.activeTransport.connect(config);
  }

  public async disconnect(): Promise<void> {
    return this.activeTransport.disconnect();
  }

  public async scanBluetoothDevices(onDeviceFound?: (dev: BluetoothDeviceInfo) => void): Promise<BluetoothDeviceInfo[]> {
    if (this.btTransport.scanDevices) {
       return this.btTransport.scanDevices(onDeviceFound);
    }
    return [];
  }

  public async ping(): Promise<PingResult> {
    return this.activeTransport.ping();
  }

  public async getCanStatus(): Promise<CanBusStatus> {
    return this.activeTransport.getCanStatus();
  }

  public setTransportType(type: TransportType) {
    this.updateConfig({ transportType: type });
  }

  private cleanupRequest(seq: number) {
    const req = this.pendingRequests[seq];
    if (req) {
      if (req.timer) clearTimeout(req.timer);
      if (req.isoTpTimer) clearTimeout(req.isoTpTimer);
      delete this.pendingRequests[seq];
    }
  }

  private handleSingleFrame(req: PendingDiagnosticRequest, frameIdNum: number, data: number[], seq: number) {
    const sfLength = data[0] & 0x0F;
    if (sfLength === 0 || sfLength > 7) return;
    const payload = data.slice(1, 1 + sfLength);
    this.cleanupRequest(seq);
    req.resolve(payload);
  }

  private handleFirstFrame(req: PendingDiagnosticRequest, frameIdNum: number, data: number[], seq: number) {
    const totalLength = ((data[0] & 0x0F) << 8) | data[1];
    if (totalLength <= 6 || totalLength > 4095) {
       this.cleanupRequest(seq);
       req.reject(new Error('ISO_TP_INVALID_LENGTH'));
       return;
    }
    req.isoTpBuffer = {
      totalLength,
      receivedBytes: [...data.slice(2, 8)],
      expectedSequence: 1
    };

    const fcTargetId = this.resolveIsoTpFlowControlId(req.canId, frameIdNum, req.isExtended);
    if (fcTargetId === null) {
      this.cleanupRequest(seq);
      req.reject(new Error('ISO_TP_ADDRESSING_ERROR'));
      return;
    }

    req.isoTpTimer = setTimeout(() => {
      this.cleanupRequest(seq);
      req.reject(new Error('ISO_TP_CONSECUTIVE_FRAME_TIMEOUT'));
    }, 1500);

    const fcFrame = [0x30, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    this.activeTransport.sendCanFrame(fcTargetId, fcFrame, req.isExtended).catch(err => {
      this.cleanupRequest(seq);
      req.reject(new Error('FLOW_CONTROL_SEND_FAILED'));
    });
  }

  public resolveIsoTpFlowControlId(requestCanId: number, responseCanId: number, isExtended: boolean): number | null {
    if (!isExtended) {
      if (responseCanId >= 0x7E8 && responseCanId <= 0x7EF) {
        if (requestCanId === 0x7DF) return responseCanId - 8;
        if (requestCanId === responseCanId - 8) return requestCanId;
      }
      if (responseCanId === requestCanId + 8) return requestCanId;
    } else {
      const reqDA = (requestCanId >>> 8) & 0xFF;
      const reqSA = requestCanId & 0xFF;
      const resDA = (responseCanId >>> 8) & 0xFF;
      const resSA = responseCanId & 0xFF;
      if (resSA === reqDA && resDA === reqSA) return requestCanId;
      if (requestCanId === 0x18DB33F1 && resDA === 0xF1) return (0x18DA0000 | (resSA << 8) | 0xF1) >>> 0;
    }
    return null;
  }
  /**
   * Uses a mutex queue to ensure diagnostic requests are strictly sequential.
   */
  public async sendRequest(requestBytes: number[], targetCanId: string = '0x7E0'): Promise<CommunicationPacket> {
    // Enqueue the request to ensure serial execution
    return new Promise((resolve) => {
      this.requestQueue = this.requestQueue.then(async () => {
        try {
          const result = await this.executeRequest(requestBytes, targetCanId);
          resolve(result);
        } catch (err: any) {
          // This should generally not happen as executeRequest catches its own errors 
          // and returns a packet, but for safety:
          resolve(commLogger.logPacket({
            direction: '[OBD TX]',
            protocol: this.config.protocol,
            canIdHex: targetCanId,
            requestRaw: requestBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
            error: err?.message || 'Critical Queue Error',
            durationMs: 0,
            status: 'ERROR'
          }));
        }
      });
    });
  }

  private async executeRequest(requestBytes: number[], targetCanId: string = '0x7E0'): Promise<CommunicationPacket> {
    this.sequenceId++;
    const startTime = performance.now();
    const reqHex = requestBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    const numCanId = parseInt(targetCanId.replace('0x', ''), 16) || 0x7E0;
    const isExtended = targetCanId.length > 5;
    const correlationId = `OBD-${this.sequenceId}`;
    
    console.log(`[OBD] [${correlationId}] REQ TO ${targetCanId}: [${reqHex}]`);

    // Guard: Mock vs Real Mode strict isolation
    if (this.config.isMockMode) {
      const { mockEcuServer } = await import('./mockEcuServer');
      const responseBytes = await mockEcuServer.handleRequest(requestBytes);
      const durationMs = Math.round(performance.now() - startTime);
      const resHex = responseBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      
      const actualResponseIdNum = numCanId + 8;
      const actualResponseIdHex = '0x' + actualResponseIdNum.toString(16).toUpperCase();

      return commLogger.logPacket({
        direction: '[OBD-RX]',
        protocol: this.config.protocol,
        canIdHex: actualResponseIdHex,
        requestRaw: reqHex,
        responseRaw: resHex,
        durationMs,
        status: responseBytes[0] === 0x7F ? 'NRC' : 'SUCCESS'
      });
    }

    // REAL MODE logic below
    if (!this.isConnected()) {
      const errPkt = commLogger.logPacket({
        direction: '[OBD TX]',
        protocol: this.config.protocol,
        canIdHex: targetCanId,
        requestRaw: reqHex,
        error: 'ESP32 NOT CONNECTED',
        durationMs: 0,
        status: 'ERROR'
      });
      AppLogger.warn('NETWORK', 'RealModeCheck', `[${correlationId}] Command blocked: ESP32 NOT CONNECTED`, 'تم حظر الأمر: ESP32 غير متصل');
      return errPkt;
    }

    try {
      let canPayload: number[];
      if (requestBytes.length <= 7) {
        canPayload = [requestBytes.length, ...requestBytes];
        while (canPayload.length < 8) canPayload.push(0x00);
      } else {
        // Multi-frame request initialization (ISO-TP First Frame)
        canPayload = [0x10, requestBytes.length >> 8, requestBytes.length & 0xFF, ...requestBytes.slice(0, 5)];
      }

      const seq = this.sequenceId;
      let actualResponseIdNum = numCanId + 8;

      const responsePromise = new Promise<number[]>((resolve, reject) => {
        const timeoutMs = requestBytes.length > 7 ? 5000 : 2500; // Longer timeout for multi-frame
        const timer = setTimeout(() => {
          this.cleanupRequest(seq);
          const expectedRange = (numCanId === 0x7DF) ? '0x7E8-0x7EF' : '0x' + (numCanId + 8).toString(16).toUpperCase();
          console.warn(`[OBD-TIMEOUT] [${correlationId}] expected=${expectedRange}`);
          
          commLogger.logPacket({
            direction: '[OBD-TIMEOUT]',
            protocol: this.config.protocol,
            canIdHex: `0x${numCanId.toString(16).toUpperCase()}`,
            requestRaw: reqHex,
            error: `TIMEOUT: Expected ${expectedRange}`,
            durationMs: timeoutMs,
            status: 'TIMEOUT'
          });
          reject(new Error('TIMEOUT_WAITING_FOR_ECU_RESPONSE'));
        }, timeoutMs);

        this.pendingRequests[seq] = {
          resolve: (data) => {
            const req = this.pendingRequests[seq];
            if (req && req.actualResponseId !== undefined) actualResponseIdNum = req.actualResponseId;
            resolve(data);
          },
          reject,
          canId: numCanId,
          requestBytes: [...requestBytes],
          isExtended,
          correlationId,
          timer
        };
      });

      // Send the frame
      console.log(`[CAN-TX] [${correlationId}] ID=0x${numCanId.toString(16).toUpperCase()} DATA=[${canPayload.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}]`);
      commLogger.logPacket({
        direction: '[TX]',
        protocol: this.config.protocol,
        canIdHex: `0x${numCanId.toString(16).toUpperCase()}`,
        dlc: canPayload.length,
        requestRaw: canPayload.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
        durationMs: 0,
        status: 'SUCCESS'
      });

      const ok = await this.activeTransport.sendCanFrame(numCanId, canPayload, isExtended);
      if (!ok) {
        this.cleanupRequest(seq);
        throw new Error('Failed to send packet over transport');
      }

      // If we sent a First Frame, we need to handle Consecutive Frames here or via the receiver.
      // Current architecture handles Flow Control and CF reassembly in handleCanFrame.
      
      const responseBytes = await responsePromise;
      const durationMs = Math.round(performance.now() - startTime);
      const resHex = responseBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      const actualResponseIdHex = '0x' + actualResponseIdNum.toString(16).toUpperCase();

      console.log(`[OBD-RX] [${correlationId}] CAN=${actualResponseIdHex} PAYLOAD=[${resHex}] (${durationMs}ms)`);

      return commLogger.logPacket({
        direction: '[OBD-RX]',
        protocol: this.config.protocol,
        canIdHex: actualResponseIdHex,
        requestRaw: reqHex,
        responseRaw: resHex,
        durationMs,
        status: responseBytes[0] === 0x7F ? 'NRC' : 'SUCCESS'
      });

    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      return commLogger.logPacket({
        direction: '[OBD TX]',
        protocol: this.config.protocol,
        canIdHex: targetCanId,
        requestRaw: reqHex,
        error: err?.message || 'Response Timeout',
        durationMs,
        status: 'TIMEOUT'
      });
    }
  }
}

export { defaultConnectionConfig } from './Transport';

export const transportManager = new TransportManager(defaultConnectionConfig);
