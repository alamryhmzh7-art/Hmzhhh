/**
 * HAMZA OBD PRO - Bluetooth Classic SPP Transport Implementation
 * 
 * Direct Bluetooth RFCOMM Serial Port Profile (SPP) interface for ESP32 BluetoothSerial ("ESP32-OBD-PRO").
 * Standard SPP UUID: 00001101-0000-1000-8000-00805F9B34FB
 * 
 * Shares identical Binary Protocol framing and diagnostic stack with Wi-Fi TCP.
 */

import { ConnectionConfig, ConnectionStatus, CanFrame, CanBusStatus, TransportType, BluetoothDeviceInfo } from '../types';
import { ITransport, PingResult } from './Transport';
import { BinaryProtocol, BinaryCommand, DecodedBinaryPacket } from './binaryProtocol';
import { commLogger, AppLogger } from '../logging/logger';
import { canManager } from '../can/canManager';
import { BluetoothSpp } from './BluetoothSppPlugin';
import { Capacitor } from '@capacitor/core';

console.log('[BUILD-ID] BT-FIX-V3-STRICT-NATIVE-SPP');

export class BluetoothSppTransport implements ITransport {
  public readonly type: TransportType = 'BLUETOOTH_SPP';
  private config: ConnectionConfig;
  private status: ConnectionStatus = 'DISCONNECTED';
  private rawState: string = 'DISCONNECTED';
  private lastError: Error | null = null;
  private lastErrorStackTrace: string | null = null;
  private rxBuffer: Uint8Array = new Uint8Array(0);
  private nativeListener: any = null;
  private isConnecting: boolean = false;
  private isScanning: boolean = false;
  private stateListeners: ((state: ConnectionStatus, error?: string) => void)[] = [];
  private dataListeners: ((data: Uint8Array) => void)[] = [];
  private canFrameListeners: ((frame: CanFrame) => void)[] = [];
  private pingResolver: ((res: PingResult) => void) | null = null;
  private canStatusResolver: ((status: CanBusStatus | null) => void) | null = null;
  private pingStartTime: number | null = null;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  public getState(): ConnectionStatus {
    return this.status;
  }

  public getRawConnectionState() {
    return {
      state: this.status,
      rawState: this.rawState,
      error: this.lastError ? this.lastError.message : null,
      stackTrace: this.lastErrorStackTrace
    };
  }

  public isConnected(): boolean {
    return this.status === 'CONNECTED';
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

  public async scanDevices(): Promise<BluetoothDeviceInfo[]> {
    this.isScanning = true;
    console.log('[BT-DISCOVERY] START');
    const isNative = Capacitor.isNativePlatform();
    if (!isNative) {
      this.isScanning = false;
      return [];
    }
    try {
      const pairedResult = await BluetoothSpp.getPairedDevices();
      this.isScanning = false;
      return (pairedResult?.devices || []).map((d: any) => ({
        name: d.name || 'Unknown',
        address: d.address || '',
        bonded: true
      }));
    } catch (e) {
      console.error('[BT-DISCOVERY] Failed to get paired devices', e);
      this.isScanning = false;
      return [];
    }
  }

  public async connect(overrideConfig?: Partial<ConnectionConfig>): Promise<boolean> {
    console.log('[BT-TS] CONNECT CALLED');
    const isNative = Capacitor.isNativePlatform();
    console.log(`[BT-TS] NATIVE PLATFORM: ${isNative}`);

    if (overrideConfig) {
      this.config = { ...this.config, ...overrideConfig };
    }

    if (this.status === 'CONNECTED') return true;
    if (this.isConnecting) return false;

    this.isConnecting = true;
    this.setStatus('CONNECTING');
    this.rawState = 'SOCKET_CREATING';
    this.lastError = null;
    this.lastErrorStackTrace = null;

    if (!isNative) {
      const errMsg = 'CLASSIC_SPP_REQUIRES_ANDROID_NATIVE';
      console.error(errMsg);
      const errObj = new Error(errMsg);
      this.lastError = errObj;
      this.lastErrorStackTrace = errObj.stack || '';
      this.setStatus('ERROR', errMsg);
      this.isConnecting = false;
      return false;
    }

    const targetMac = (this.config.bluetoothMacAddress || '24:6F:28:B4:7A:1C').trim().toUpperCase();

    try {
      console.log('[BT-NATIVE] PLUGIN LOADED');
      console.log('[BT-NATIVE] CONNECT CALLED');
      console.log('[BT-NATIVE] PERMISSION CHECK');

      try {
        const permStatus = await (BluetoothSpp as any).checkPermissions();
        if (permStatus.bluetooth !== 'granted') {
           console.log('[BT-NATIVE] Requesting Bluetooth permissions from Capacitor...');
           const reqStatus = await (BluetoothSpp as any).requestPermissions();
           if (reqStatus.bluetooth !== 'granted') {
              console.warn('[BT-NATIVE] User denied bluetooth permissions');
           }
        }
      } catch (e) {
        console.log('[BT-NATIVE] Permission check skipped or failed', e);
      }

      console.log('[BT-NATIVE] ADAPTER STATE');
      const pairedResult = await BluetoothSpp.getPairedDevices();
      const devices = pairedResult?.devices || [];
      console.log(`[BT-NATIVE] BONDED DEVICES COUNT: ${devices.length}`);

      let isDeviceFound = false;
      for (const d of devices) {
        const addr = (d.address || '').trim().toUpperCase();
        if (addr === targetMac) {
          isDeviceFound = true;
          break;
        }
      }

      console.log(`[BT-NATIVE] TARGET MAC: ${targetMac}`);
      console.log(`[BT-NATIVE] TARGET FOUND: ${isDeviceFound ? 'TRUE' : 'FALSE'}`);

      if (!isDeviceFound) {
        throw new Error('TARGET_NOT_PAIRED: Target device MAC not found in bonded devices.');
      }

      console.log(`[BT-NATIVE] Proceeding with RFCOMM connection to ${targetMac}`);
      console.log(`[BT-NATIVE] RFCOMM CONNECT START`);
      console.log(`[BT-NATIVE] SPP UUID: 00001101-0000-1000-8000-00805F9B34FB`);

      // 1. Establish RFCOMM connection first
      await BluetoothSpp.connect({ address: targetMac });
      console.log('[BT-NATIVE] RFCOMM CONNECT SUCCESS');

      // 2. Start/register data reception read loop only after successful connection
      await this.startNativeBtReadLoop();

      this.rawState = 'CONNECTED';
      console.log('[BT-NATIVE] STREAMS OPEN');
      this.setStatus('CONNECTED');
      this.isConnecting = false;
      return true;

    } catch (err: any) {
      const errMsg = typeof err === 'string' ? err : (err?.message || JSON.stringify(err) || 'Bluetooth Connection Error');
      const errObj = err instanceof Error ? err : new Error(errMsg);
      this.rawState = 'ERROR';
      this.lastError = errObj;
      this.lastErrorStackTrace = errObj.stack || new Error().stack || 'No stack trace available';
      this.setStatus('ERROR', errMsg);
      console.log(`[BT-NATIVE] CONNECT FAILURE: ${errMsg}`);
      this.isConnecting = false;
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    this.isConnecting = false;
    const isNative = Capacitor.isNativePlatform();
    if (isNative) {
       try {
         await BluetoothSpp.disconnect();
       } catch (e) {}
       if (this.nativeListener) {
          this.nativeListener.remove();
          this.nativeListener = null;
       }
    }
    this.canStatusResolver = null;
    this.pingResolver = null;
    this.rawState = 'DISCONNECTED';
    this.setStatus('DISCONNECTED');
  }

  public async sendRaw(data: Uint8Array | number[]): Promise<boolean> {
    if (!this.isConnected()) {
      return false;
    }
    const byteArr = data instanceof Uint8Array ? data : new Uint8Array(data);
    const hex = Array.from(byteArr).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

    const isNative = Capacitor.isNativePlatform();
    if (isNative) {
      console.log(`[BT-NATIVE] TX: ${hex}`);
      try {
        await BluetoothSpp.write({ data: Array.from(byteArr) });
        return true;
      } catch (err: any) {
        console.error('[BT-NATIVE] Write Error', err);
        return false;
      }
    }
    return false;
  }

  public async sendCanFrame(canId: number, data: number[], isExtended: boolean = false): Promise<boolean> {
    if (!this.isConnected()) return false;
    const packet = BinaryProtocol.encodeCanFrame(canId, data, isExtended);
    return this.sendRaw(packet);
  }

  public async ping(): Promise<PingResult> {
    const startTime = performance.now();
    if (!this.isConnected()) {
      console.log('[BT-SPP] PING FAILED: Not Connected');
      commLogger.logPacket({
        direction: 'APP -> ESP32',
        protocol: this.config.protocol,
        requestRaw: 'AA 55 02 00 00 02 0D 0A',
        error: 'ESP32 Bluetooth SPP Not Connected',
        decodedData: 'Lifecycle [4/4: Ping TX/RX] -> Failed (Not Connected)',
        durationMs: 0,
        status: 'ERROR'
      });
      return { success: false, latencyMs: 0, info: 'ESP32 Bluetooth SPP Not Connected' };
    }

    const pingPacket = BinaryProtocol.encodePing();
    const txHex = Array.from(pingPacket).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    console.log(`[BT-SPP] TX HEX: ${txHex}`);
    console.log(`[BT-NATIVE] PING TX`);

    return new Promise((resolve) => {
      this.pingStartTime = startTime;
      const pingTimeout = setTimeout(() => {
        this.pingResolver = null;
        this.pingStartTime = null;
        const latencyMs = Math.round(performance.now() - startTime);
        commLogger.logPacket({
          direction: 'APP -> ESP32',
          protocol: this.config.protocol,
          requestRaw: txHex,
          error: 'Bluetooth Ping Timeout',
          decodedData: 'Lifecycle [4/4: Ping TX/RX] -> Timeout',
          durationMs: latencyMs,
          status: 'TIMEOUT'
        });
        resolve({ success: false, latencyMs, info: 'Bluetooth Ping Timeout', txHex });
      }, 2500);

      this.pingResolver = (res) => {
        clearTimeout(pingTimeout);
        this.pingResolver = null;
        this.pingStartTime = null;
        res.txHex = txHex;
        if (res.rxHex) {
          console.log(`[BT-SPP] RX HEX: ${res.rxHex}`);
        }
        commLogger.logPacket({
          direction: 'APP -> ESP32',
          protocol: this.config.protocol,
          requestRaw: txHex,
          responseRaw: res.rxHex,
          decodedData: `Lifecycle [4/4: Ping TX/RX] -> Success | Latency: ${res.latencyMs}ms`,
          durationMs: res.latencyMs,
          status: 'SUCCESS'
        });
        resolve(res);
      };

      this.sendRaw(pingPacket);
    });
  }

  public async getCanStatus(): Promise<CanBusStatus | null> {
    if (!this.isConnected()) return null;
    const reqPacket = BinaryProtocol.encodeCanStatusReq();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.canStatusResolver = null;
        resolve(null);
      }, 2000);

      this.canStatusResolver = (status) => {
        clearTimeout(timeout);
        this.canStatusResolver = null;
        resolve(status);
      };

      this.sendRaw(reqPacket);
    });
  }

  private handleIncomingData(data: ArrayBuffer | Uint8Array | string) {
    let newBytes: Uint8Array;
    if (typeof data === 'string') {
      const encoder = new TextEncoder();
      newBytes = encoder.encode(data);
    } else if (data instanceof Uint8Array) {
      newBytes = data;
    } else {
      newBytes = new Uint8Array(data);
    }

    const hexStr = Array.from(newBytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    console.log(`[BT-NATIVE] RX: ${hexStr}`);

    const merged = new Uint8Array(this.rxBuffer.length + newBytes.length);
    merged.set(this.rxBuffer);
    merged.set(newBytes, this.rxBuffer.length);
    this.rxBuffer = merged;

    const { packets, remainingBuffer } = BinaryProtocol.parseStream(this.rxBuffer);
    this.rxBuffer = remainingBuffer;

    packets.forEach(pkt => this.processDecodedPacket(pkt));
  }

  private processDecodedPacket(pkt: DecodedBinaryPacket) {
    if (pkt.cmd === BinaryCommand.CMD_CAN_FRAME && pkt.canFrame) {
      commLogger.logPacket({
        direction: '[BT RX]',
        protocol: pkt.canFrame.isExtended ? 'CAN 29-bit' : 'CAN 11-bit',
        canIdHex: pkt.canFrame.id,
        responseRaw: pkt.canFrame.dataHex,
        durationMs: 0,
        status: 'SUCCESS'
      });
      canManager.addFrame(pkt.canFrame);
      this.canFrameListeners.forEach(l => l(pkt.canFrame!));
    } else if (pkt.cmd === BinaryCommand.CMD_PONG && pkt.pongInfo) {
      console.log('[BT-NATIVE] PONG SUCCESS');
      if (this.pingResolver) {
        const latencyMs = this.pingStartTime ? Math.round(performance.now() - this.pingStartTime) : 23;
        const rxHex = Array.from(pkt.rawFrame).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        this.pingResolver({
          success: true,
          latencyMs,
          canReady: pkt.pongInfo.canReady,
          uptimeMs: pkt.pongInfo.uptimeMs,
          freeHeapBytes: pkt.pongInfo.freeHeapBytes,
          info: `ESP32 BT SPP Up: ${(pkt.pongInfo.uptimeMs / 1000).toFixed(1)}s | Heap: ${(pkt.pongInfo.freeHeapBytes / 1024).toFixed(0)}KB`,
          rxHex
        });
      }
    } else if (pkt.cmd === BinaryCommand.CMD_CAN_STATUS_RESP && pkt.canStatus) {
      if (this.canStatusResolver) {
        this.canStatusResolver(pkt.canStatus);
      }
    }
  }

  private async startNativeBtReadLoop() {
    if (this.nativeListener) {
       this.nativeListener.remove();
    }
    console.log('[BT-NATIVE] READ THREAD STARTED');
    this.nativeListener = await (BluetoothSpp as any).addListener('onBluetoothData', (info: any) => {
       if (info && info.data) {
          const byteArr = new Uint8Array(info.data);
          this.handleIncomingData(byteArr.buffer);
       }
    });

    (BluetoothSpp as any).addListener('onBluetoothDisconnect', () => {
       console.warn('[BT-NATIVE] Received disconnect event from native layer');
       this.disconnect();
    });
  }
}
