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
import { mockEcuServer } from './mockEcuServer';
import { BluetoothSpp } from './BluetoothSppPlugin';
import { Capacitor } from '@capacitor/core';

console.log('[BUILD-ID] BT-FIX-V2-ANDROID-SPP-RUNTIME-20260902');

export class BluetoothSppTransport implements ITransport {
  public readonly type: TransportType = 'BLUETOOTH_SPP';

  private config: ConnectionConfig;
  private status: ConnectionStatus = 'DISCONNECTED';
  private rawState: string = 'DISCONNECTED';
  private lastError: Error | null = null;
  private lastErrorStackTrace: string | null = null;
  private rxBuffer: Uint8Array = new Uint8Array(0);
  private serialPort: any = null;
  private nativeListener: any = null;
  private socket: any = null;
  private reader: any = null;
  private writer: any = null;
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
    return () => {};
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
    this.isConnecting = true;

    const isNative = Capacitor.isNativePlatform();
    const runtime = isNative ? 'ANDROID_NATIVE' : 'WEB_BROWSER';
    console.log(`[RUNTIME] ${runtime}`);

    if (!isNative) {
      const errMsg = 'CLASSIC_SPP_REQUIRES_ANDROID_NATIVE';
      console.error(errMsg);
      console.log(`[BT-CONNECT] FAILED error=${errMsg}`);
      this.setStatus('ERROR', errMsg);
      this.isConnecting = false;
      return false;
    }

    const targetMac = (this.config.bluetoothMacAddress || '').trim().toUpperCase();
    if (!targetMac) {
      const errMsg = 'No Bluetooth MAC address specified. Please scan and select a device.';
      console.error(`[BT-CONNECT] FAILED error=${errMsg}`);
      this.setStatus('ERROR', errMsg);
      this.isConnecting = false;
      return false;
    }

    console.log(`[BT-CONNECT] START address=${targetMac}`);

    try {
      await BluetoothSpp.connect({ address: targetMac });
      console.log('[BT-CONNECT] SUCCESS');

      await this.startNativeBtReadLoop();
      
      this.rawState = 'CONNECTED';
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

      console.log(`[BT-CONNECT] FAILED error=${errMsg}`);
      this.isConnecting = false;
      return false;
    }
  }

  /**
   * Scan for paired / discoverable Bluetooth Classic SPP devices
   */
  public async scanDevices(onDeviceDiscovered?: (dev: BluetoothDeviceInfo) => void): Promise<BluetoothDeviceInfo[]> {
    this.isScanning = true;
    console.log('[BT-SCAN] START');
    const isNative = Capacitor.isNativePlatform();

    if (!isNative) {
      this.isScanning = false;
      console.log('[BT-SCAN] FINISHED');
      return [];
    }

    const devicesMap = new Map<string, BluetoothDeviceInfo>();

    // 1. First fetch bonded/paired devices
    try {
      const pairedResult = await BluetoothSpp.getPairedDevices();
      const rawPaired = pairedResult?.devices || [];
      for (const d of rawPaired) {
        const addr = (d.address || '').trim().toUpperCase();
        if (addr) {
          const devInfo: BluetoothDeviceInfo = {
            name: d.name || 'Paired Device',
            address: addr,
            bonded: true,
            type: 'CLASSIC_SPP'
          };
          devicesMap.set(addr, devInfo);
          console.log(`[BT-SCAN] DEVICE_FOUND name=${devInfo.name} address=${devInfo.address}`);
          if (onDeviceDiscovered) {
            onDeviceDiscovered(devInfo);
          }
        }
      }
    } catch (e) {
      console.warn('[BT-SCAN] Failed to fetch paired devices:', e);
    }

    // 2. Set up listener for live found devices
    let foundHandle: any = null;
    let finishHandle: any = null;

    let discoveryFinishedResolve: () => void;
    const discoveryFinishedPromise = new Promise<void>((resolve) => {
      discoveryFinishedResolve = resolve;
    });

    try {
      foundHandle = await BluetoothSpp.addListener('onBluetoothDeviceFound', (device: any) => {
        const addr = (device.address || '').trim().toUpperCase();
        if (!addr) return;

        const devInfo: BluetoothDeviceInfo = {
          name: device.name || 'Unknown',
          address: addr,
          bonded: Boolean(device.bonded),
          rssi: typeof device.rssi === 'number' ? device.rssi : undefined,
          type: (device.type === 'BLE' ? 'BLE' : 'CLASSIC_SPP') as any
        };

        devicesMap.set(addr, devInfo);
        console.log(`[BT-SCAN] DEVICE_FOUND name=${devInfo.name} address=${devInfo.address}`);
        if (onDeviceDiscovered) {
          onDeviceDiscovered(devInfo);
        }
      });

      finishHandle = await BluetoothSpp.addListener('onBluetoothDiscoveryFinished', () => {
        if (discoveryFinishedResolve) {
          discoveryFinishedResolve();
        }
      });

      // 3. Initiate native discovery
      await BluetoothSpp.startDiscovery();

      // Wait up to 12 seconds for native discovery broadcast to complete
      await Promise.race([
        discoveryFinishedPromise,
        new Promise((resolve) => setTimeout(resolve, 12000))
      ]);

    } catch (err) {
      console.error('[BT-SCAN] Error during native discovery:', err);
    } finally {
      try {
        await BluetoothSpp.stopDiscovery();
      } catch (ignored) {}

      if (foundHandle) {
        try { foundHandle.remove(); } catch (ignored) {}
      }
      if (finishHandle) {
        try { finishHandle.remove(); } catch (ignored) {}
      }
      this.isScanning = false;
      console.log('[BT-SCAN] FINISHED');
    }

    return Array.from(devicesMap.values());
  }

  public async disconnect(): Promise<void> {
    this.isConnecting = false;
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {}
      this.socket = null;
    }
    
    if (this.reader) {
      try {
        this.reader.cancel();
      } catch (e) {}
    }

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
    this.rawState = 'DISCONNECTED';
    this.setStatus('DISCONNECTED');
  }

  public async sendRaw(data: Uint8Array | number[]): Promise<boolean> {
    if (!this.isConnected() && !this.config.isMockMode) {
      return false;
    }

    const byteArr = data instanceof Uint8Array ? data : new Uint8Array(data);
    const hex = Array.from(byteArr).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

    if (this.config.isMockMode) {
      return true;
    }

    const isNative = Capacitor.isNativePlatform();
    if (isNative) {
      console.log(`[BT-TX] ${hex}`);
      try {
        await BluetoothSpp.write({ data: Array.from(byteArr) });
        return true;
      } catch (err: any) {
        console.error('[BT-TX] Write Error', err);
        return false;
      }
    }

    return false;
  }

  public async sendCanFrame(canId: number, data: number[], isExtended: boolean = false): Promise<boolean> {
    if (!this.isConnected()) return false;
    const hexData = data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    console.log(`[CAN-TX] ID=0x${canId.toString(16).toUpperCase()} DLC=${data.length} DATA=${hexData}`);
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

    if (this.config.isMockMode) {
      await new Promise(r => setTimeout(r, 22));
      const latencyMs = Math.round(performance.now() - startTime);
      const uptimeMs = Math.floor(104500 + (performance.now() % 60000));
      const freeHeapBytes = Math.floor(188400 - (performance.now() % 4000));
      const pongPacket = BinaryProtocol.encodePong(uptimeMs, true, freeHeapBytes);
      const rxHex = Array.from(pongPacket).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      console.log(`[BT-SPP] RX HEX: ${rxHex}`);

      commLogger.logPacket({
        direction: 'APP -> ESP32',
        protocol: this.config.protocol,
        requestRaw: txHex,
        responseRaw: rxHex,
        decodedData: `Lifecycle [4/4: Ping TX/RX] -> Success | Latency: ${latencyMs}ms`,
        durationMs: latencyMs,
        status: 'SUCCESS'
      });

      return {
        success: true,
        latencyMs,
        canReady: true,
        uptimeMs,
        freeHeapBytes,
        info: `ESP32 Bluetooth SPP Ready (OK) | Uptime: ${(uptimeMs / 1000).toFixed(1)}s | Heap: ${(freeHeapBytes / 1024).toFixed(0)}KB`,
        txHex,
        rxHex
      };
    }

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
      }, 2000);

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
          status: res.success ? 'SUCCESS' : 'ERROR'
        });

        resolve(res);
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
        messagesSent: 940,
        messagesReceived: 1820
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

    const merged = new Uint8Array(this.rxBuffer.length + newBytes.length);
    merged.set(this.rxBuffer);
    merged.set(newBytes, this.rxBuffer.length);
    this.rxBuffer = merged;

    const rxHex = Array.from(newBytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    console.log(`[BT-RX] ${rxHex}`);

    const { packets, remainingBuffer } = BinaryProtocol.parseStream(this.rxBuffer);
    this.rxBuffer = remainingBuffer;

    packets.forEach(pkt => this.processDecodedPacket(pkt));
  }

  private processDecodedPacket(pkt: DecodedBinaryPacket) {
    if (pkt.cmd === BinaryCommand.CMD_CAN_FRAME && pkt.canFrame) {
      console.log(`[CAN-RX] ID=${pkt.canFrame.id} DLC=${pkt.canFrame.dlc} DATA=${pkt.canFrame.dataHex}`);
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

  private async startSerialReadLoop() {
    while (this.serialPort && this.serialPort.readable) {
      try {
        this.reader = this.serialPort.readable.getReader();
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) {
            this.handleIncomingData(value);
          }
        }
      } catch {
        break;
      } finally {
        if (this.reader) {
          this.reader.releaseLock();
          this.reader = null;
        }
      }
    }
  }

  private async startNativeBtReadLoop() {
    if (this.nativeListener) {
       this.nativeListener.remove();
    }
    
    // In Capacitor, we can add a listener on the plugin object
    // Wait, the plugin needs an addListener method if it returns an event.
    // get capacitor core PluginListenerHandle
    this.nativeListener = await (BluetoothSpp as any).addListener('onBluetoothData', (info: any) => {
       if (info && info.data) {
          const byteArr = new Uint8Array(info.data);
          // Only log for debug in physical testing
          // const hex = Array.from(byteArr).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
          // console.log(`[BT-NATIVE] RX BYTES: ${hex}`);
          this.handleIncomingData(byteArr.buffer);
       }
    });

    (BluetoothSpp as any).addListener('onBluetoothDisconnect', () => {
       console.warn('[BT-NATIVE] Received disconnect event from native layer');
       this.disconnect();
    });
  }
}
