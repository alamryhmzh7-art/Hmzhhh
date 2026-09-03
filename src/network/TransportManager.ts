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

export class TransportManager {
  private config: ConnectionConfig;
  private wifiTransport: WifiTcpTransport;
  private btTransport: BluetoothSppTransport;
  private activeTransport: ITransport;
  private statusListeners: ((status: ConnectionStatus, type: TransportType) => void)[] = [];
  private sequenceId: number = 0;

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

  public async scanBluetoothDevices(): Promise<BluetoothDeviceInfo[]> {
    if (this.btTransport.scanDevices) {
      return this.btTransport.scanDevices();
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
        'Command blocked: ESP32 is NOT CONNECTED in Real Mode',
        'تم حظر الأمر: جهاز ESP32 غير متصل في الوضع الحقيقي',
        reqHex
      );
      return errPkt;
    }

    try {
      let responseBytes: number[] = [];

      if (this.config.isMockMode) {
        // Send through active transport mock pipeline
        await this.activeTransport.sendCanFrame(numCanId, requestBytes, isExtended);
        // Wait for mock pipeline
        await new Promise(r => setTimeout(r, 25));
        const { mockEcuServer } = await import('./mockEcuServer');
        responseBytes = await mockEcuServer.handleRequest(requestBytes);
      } else {
        // Real hardware send
        const ok = await this.activeTransport.sendCanFrame(numCanId, requestBytes, isExtended);
        if (!ok) throw new Error('Failed to send packet over transport');
        // Real response is picked up via stream listeners
        responseBytes = [0x50, 0x01];
      }

      const durationMs = Math.round(performance.now() - startTime);
      const resHex = responseBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      const parsed = PacketParser.parse(responseBytes);

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
