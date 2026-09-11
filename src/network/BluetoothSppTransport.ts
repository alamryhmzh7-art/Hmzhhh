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
  private klineInitResolver: ((res: { success: boolean; activeProtocol: number; keyByte1: number; keyByte2: number }) => void) | null = null;
  private klineStatusResolver: ((status: any) => void) | null = null;
  private klineFrameResolver: ((res: { status: number; data: number[] }) => void) | null = null;
  private klinePacketListeners: ((pkt: DecodedBinaryPacket) => void)[] = [];
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

  public updateConfig(config: ConnectionConfig) {
    this.config = config;
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

    if (this.config.isMockMode) {
      console.log('[BT-CONNECT] Mock Mode active - simulating successful connection');
      await new Promise(r => setTimeout(r, 300));
      mockEcuServer.start();
      this.rawState = 'CONNECTED';
      this.setStatus('CONNECTED');
      this.isConnecting = false;
      return true;
    }

    const isNative = Capacitor.isNativePlatform();
    const runtime = isNative ? 'ANDROID_NATIVE' : 'WEB_BROWSER';
    console.log(`[RUNTIME] ${runtime}`);

    if (!isNative) {
      console.log('[RUNTIME] WEB_BROWSER - Attempting Web Serial fallback');
      try {
        if (typeof navigator === 'undefined' || !('serial' in navigator)) {
          throw new Error('Web Serial API is not supported in this browser. Please use Chrome or Edge browser.');
        }
        
        // This requests the port from the user
        const port = await (navigator as any).serial.requestPort();
        await port.open({ baudRate: 115200 }); // Common ESP32 baudrate or OBD2
        
        this.serialPort = port;
        this.writer = port.writable.getWriter();

        this.startSerialReadLoop();

        this.rawState = 'CONNECTED';
        this.setStatus('CONNECTED');
        this.isConnecting = false;
        return true;
      } catch (err: any) {
        let errMsg = err?.message || 'Web Serial Connection Failed';
        if (
          err?.name === 'SecurityError' || 
          errMsg.includes('permissions policy') || 
          errMsg.includes('disallowed') ||
          err?.name === 'NotAllowedError'
        ) {
          errMsg = 'Web Serial hardware access is restricted inside the preview iframe. Click "Open in new tab" (top right) to connect real hardware, or toggle "Mock Mode" to test directly in preview.';
        } else if (err?.name === 'NotFoundError') {
          errMsg = 'No Serial COM port was selected.';
        }
        console.error('[WEB-SERIAL-ERR]', errMsg, err);
        this.rawState = 'ERROR';
        this.lastError = err instanceof Error ? err : new Error(errMsg);
        this.lastErrorStackTrace = err?.stack || new Error().stack || null;
        this.setStatus('ERROR', errMsg);
        this.isConnecting = false;
        return false;
      }
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

    const devicesMap = new Map<string, BluetoothDeviceInfo>();

    // 1. Populate custom saved devices from localStorage
    try {
      if (typeof localStorage !== 'undefined') {
        const savedRaw = localStorage.getItem('hamza_obd_custom_bt_devices');
        if (savedRaw) {
          const savedList: BluetoothDeviceInfo[] = JSON.parse(savedRaw);
          savedList.forEach(d => {
            const addr = (d.address || '').trim().toUpperCase();
            if (addr) devicesMap.set(addr, d);
          });
        }
      }
    } catch (e) {
      console.warn('[BT-SCAN] Failed loading custom devices:', e);
    }

    // 2. Add default popular OBD2 presets
    const presets: BluetoothDeviceInfo[] = [
      { name: 'ESP32-OBD-PRO', address: '30:AE:A4:07:0B:42', bonded: true, type: 'CLASSIC_SPP', rssi: -45 },
      { name: 'OBDII (v1.5 / v2.1)', address: '00:1D:A5:68:98:8B', bonded: true, type: 'CLASSIC_SPP', rssi: -52 },
      { name: 'V-LINK Bluetooth', address: 'AA:BB:CC:DD:EE:11', bonded: true, type: 'CLASSIC_SPP', rssi: -58 },
      { name: 'ELM327 Bluetooth', address: '11:22:33:44:55:66', bonded: true, type: 'CLASSIC_SPP', rssi: -60 },
      { name: 'Viecar OBD2', address: '12:34:56:78:9A:BC', bonded: true, type: 'CLASSIC_SPP', rssi: -65 }
    ];

    presets.forEach(p => {
      if (!devicesMap.has(p.address.toUpperCase())) {
        devicesMap.set(p.address.toUpperCase(), p);
      }
    });

    // Notify initial presets
    Array.from(devicesMap.values()).forEach(dev => {
      if (onDeviceDiscovered) onDeviceDiscovered(dev);
    });

    if (!isNative) {
      // If running on Web and browser supports Web Bluetooth API
      if (typeof navigator !== 'undefined' && 'bluetooth' in navigator) {
        try {
          console.log('[BT-SCAN] Web Bluetooth API detected, prompting selection...');
          const webDevice = await (navigator as any).bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: ['generic_access', 0x1101, '00001101-0000-1000-8000-00805f9b34fb']
          });
          if (webDevice) {
            const devInfo: BluetoothDeviceInfo = {
              name: webDevice.name || 'Web Bluetooth OBD',
              address: webDevice.id || '00:11:22:33:44:55',
              bonded: true,
              type: 'CLASSIC_SPP'
            };
            devicesMap.set(devInfo.address.toUpperCase(), devInfo);
            if (onDeviceDiscovered) onDeviceDiscovered(devInfo);
          }
        } catch (e: any) {
          if (
            e?.name === 'SecurityError' || 
            (e?.message && (e.message.includes('permissions policy') || e.message.includes('disallowed')))
          ) {
            console.warn('[BT-SCAN] Web Bluetooth blocked by permissions policy in iframe.');
          } else {
            console.log('[BT-SCAN] Web bluetooth prompt closed or error:', e);
          }
        }
      }

      this.isScanning = false;
      console.log('[BT-SCAN] FINISHED WEB');
      return Array.from(devicesMap.values());
    }

    // 3. Native Android Bluetooth SPP Scan
    try {
      const pairedResult = await BluetoothSpp.getPairedDevices();
      const rawPaired = pairedResult?.devices || [];
      for (const d of rawPaired) {
        const addr = (d.address || '').trim().toUpperCase();
        if (addr) {
          const devInfo: BluetoothDeviceInfo = {
            name: d.name || 'Paired OBD Device',
            address: addr,
            bonded: true,
            type: 'CLASSIC_SPP'
          };
          devicesMap.set(addr, devInfo);
          console.log(`[BT-SCAN] PAIRED_FOUND name=${devInfo.name} address=${devInfo.address}`);
          if (onDeviceDiscovered) {
            onDeviceDiscovered(devInfo);
          }
        }
      }
    } catch (e) {
      console.warn('[BT-SCAN] Failed to fetch paired devices:', e);
    }

    // Set up listeners for live discovered devices
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
          name: device.name || 'Unknown Device',
          address: addr,
          bonded: Boolean(device.bonded),
          rssi: typeof device.rssi === 'number' ? device.rssi : undefined,
          type: (device.type === 'BLE' ? 'BLE' : 'CLASSIC_SPP') as any
        };

        devicesMap.set(addr, devInfo);
        console.log(`[BT-SCAN] LIVE_FOUND name=${devInfo.name} address=${devInfo.address}`);
        if (onDeviceDiscovered) {
          onDeviceDiscovered(devInfo);
        }
      });

      finishHandle = await BluetoothSpp.addListener('onBluetoothDiscoveryFinished', () => {
        if (discoveryFinishedResolve) {
          discoveryFinishedResolve();
        }
      });

      // Initiate native discovery
      await BluetoothSpp.startDiscovery();

      // Wait up to 12 seconds
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

    if (this.writer) {
      try {
        this.writer.releaseLock();
      } catch (e) {}
      this.writer = null;
    }

    if (this.serialPort) {
      try {
        await this.serialPort.close();
      } catch (e) {}
      this.serialPort = null;
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
    } else if (this.writer) {
      console.log(`[SERIAL-TX] ${hex}`);
      try {
        await this.writer.write(byteArr);
        return true;
      } catch (err: any) {
        console.error('[SERIAL-TX] Write Error', err);
        return false;
      }
    }

    return false;
  }

  public async sendCanFrame(canId: number, data: number[], isExtended: boolean = false): Promise<boolean> {
    if (!this.isConnected()) return false;
    const hexData = data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    console.log(`[BT-TX] CAN_ID=0x${canId.toString(16).toUpperCase()} DLC=${data.length} DATA=[${hexData}]`);
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
       // WARNING: String conversion can mangle binary data if not carefully handled.
       // The native plugin is already updated to send JSArray (byte values).
       console.warn('[BT-RX-RAW] Received string data instead of byte array. Converting...');
       const bytes = new Uint8Array(data.length);
       for (let i = 0; i < data.length; i++) {
         bytes[i] = data.charCodeAt(i) & 0xFF;
       }
       newBytes = bytes;
    } else if (data instanceof Uint8Array) {
      newBytes = data;
    } else {
      newBytes = new Uint8Array(data);
    }

    const rxHex = Array.from(newBytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    console.log(`[BT-RX-RAW] ${rxHex}`);

    const merged = new Uint8Array(this.rxBuffer.length + newBytes.length);
    merged.set(this.rxBuffer);
    merged.set(newBytes, this.rxBuffer.length);
    this.rxBuffer = merged;

    const { packets, remainingBuffer } = BinaryProtocol.parseStream(this.rxBuffer);
    this.rxBuffer = remainingBuffer;

    if (packets.length > 0) {
      packets.forEach(pkt => {
        const pktHex = Array.from(pkt.rawFrame).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        console.log(`[BT-RX-FRAME] CMD=0x${pkt.cmd.toString(16).toUpperCase()} LEN=${pkt.payload.length} HEX=[${pktHex}]`);
        this.processDecodedPacket(pkt);
      });
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
            console.log(`[ELM-BT-ASCII-RX] Line: "${line}" -> CAN DATA: [${frame.dataHex}]`);
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
    this.nativeListener = await (BluetoothSpp as any).addListener('onBluetoothData', (info: any) => {
       if (info && info.data) {
          const byteArr = new Uint8Array(info.data);
          this.handleIncomingData(byteArr);
       }
    });

    (BluetoothSpp as any).addListener('onBluetoothDisconnect', () => {
       console.warn('[BT-NATIVE] Received disconnect event from native layer');
       this.disconnect();
    });
  }
}
