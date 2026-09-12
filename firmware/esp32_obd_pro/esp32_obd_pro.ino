/**
 * HAMZA OBD PRO - Bluetooth Classic SPP Transport
 *
 * Real Bluetooth Classic SPP transport for the ESP32 OBD adapter.
 *
 * Responsibilities:
 * - Connect/disconnect Bluetooth SPP
 * - Send/receive binary transport frames
 * - Parse incoming BinaryProtocol frames
 * - Forward decoded CAN frames to diagnostic layers
 * - Handle ping/CAN-status/K-Line responses
 *
 * Diagnostic decoding (OBD-II / ISO-TP / UDS) remains outside
 * this transport layer.
 */

import {
  ConnectionConfig,
  ConnectionStatus,
  CanFrame,
  CanBusStatus,
  TransportType,
  BluetoothDeviceInfo
} from '../types';

import {
  ITransport,
  PingResult
} from './Transport';

import {
  BinaryProtocol,
  BinaryCommand,
  DecodedBinaryPacket
} from './binaryProtocol';

import {
  commLogger
} from '../logging/logger';

import {
  canManager
} from '../can/canManager';

import {
  mockEcuServer
} from './mockEcuServer';

import {
  BluetoothSpp
} from './BluetoothSppPlugin';

import {
  Capacitor
} from '@capacitor/core';

console.log(
  '[BUILD-ID] BT-TRANSPORT-AUDITED-V5-20260912'
);

export class BluetoothSppTransport implements ITransport {

  public readonly type: TransportType =
    'BLUETOOTH_SPP';

  private config: ConnectionConfig;

  private status: ConnectionStatus =
    'DISCONNECTED';

  private rawState: string =
    'DISCONNECTED';

  private lastError: Error | null = null;

  private lastErrorStackTrace:
    string | null = null;

  /**
   * Binary protocol RX stream buffer.
   *
   * Bluetooth SPP is a stream. One frame can arrive in several
   * chunks, or several frames can arrive in one chunk.
   */
  private rxBuffer: Uint8Array =
    new Uint8Array(0);

  /**
   * Kept isolated for legacy ELM-compatible ASCII parsing.
   *
   * IMPORTANT:
   * This buffer is NEVER mixed with rxBuffer.
   */
  private asciiRxBuffer: string = '';

  /**
   * Web Serial resources.
   */
  private serialPort: any = null;
  private reader: any = null;
  private writer: any = null;

  /**
   * Native Bluetooth listener handles.
   */
  private nativeDataListener: any = null;
  private nativeDisconnectListener: any = null;

  /**
   * State.
   */
  private isConnecting = false;
  private isScanning = false;

  /**
   * Serialize all physical writes.
   *
   * A Bluetooth SPP connection is a byte stream, therefore
   * concurrent writes must never be allowed to race.
   */
  private writeQueue:
    Promise<void> = Promise.resolve();

  /**
   * Raw traffic logging is disabled by default.
   *
   * High-rate CAN traffic can generate thousands of packets.
   * Logging every packet can freeze a WebView.
   */
  private readonly debugRawTraffic =
    false;

  /**
   * Application listeners.
   */
  private stateListeners:
    Array<
      (
        state: ConnectionStatus,
        error?: string
      ) => void
    > = [];

  private dataListeners:
    Array<
      (data: Uint8Array) => void
    > = [];

  private canFrameListeners:
    Array<
      (frame: CanFrame) => void
    > = [];

  private klinePacketListeners:
    Array<
      (pkt: DecodedBinaryPacket) => void
    > = [];

  /**
   * One outstanding request of each response type.
   */
  private pingResolver:
    ((res: PingResult) => void) | null =
    null;

  private pingStartTime:
    number | null = null;

  private pingTimeoutHandle:
    ReturnType<typeof setTimeout> | null =
    null;

  private canStatusResolver:
    ((status: CanBusStatus | null) => void) | null =
    null;

  private canStatusTimeoutHandle:
    ReturnType<typeof setTimeout> | null =
    null;

  private klineInitResolver:
    ((
      res: {
        success: boolean;
        activeProtocol: number;
        keyByte1: number;
        keyByte2: number;
      }
    ) => void) | null =
    null;

  private klineInitTimeoutHandle:
    ReturnType<typeof setTimeout> | null =
    null;

  private klineStatusResolver:
    ((status: any) => void) | null =
    null;

  private klineStatusTimeoutHandle:
    ReturnType<typeof setTimeout> | null =
    null;

  private klineFrameResolver:
    ((
      res: {
        status: number;
        data: number[];
      }
    ) => void) | null =
    null;

  private klineFrameTimeoutHandle:
    ReturnType<typeof setTimeout> | null =
    null;

  constructor(
    config: ConnectionConfig
  ) {
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------

  public getState():
    ConnectionStatus {
    return this.status;
  }

  public getRawConnectionState() {
    return {
      state: this.status,
      rawState: this.rawState,
      error: this.lastError
        ? this.lastError.message
        : null,
      stackTrace:
        this.lastErrorStackTrace
    };
  }

  public isConnected(): boolean {
    return (
      this.status === 'CONNECTED'
    );
  }

  public updateConfig(
    config: ConnectionConfig
  ): void {
    this.config = config;
  }

  public onStateChange(
    callback: (
      state: ConnectionStatus,
      error?: string
    ) => void
  ): () => void {

    this.stateListeners.push(
      callback
    );

    callback(this.status);

    return () => {
      this.stateListeners =
        this.stateListeners.filter(
          listener =>
            listener !== callback
        );
    };
  }

  public onData(
    callback:
      (data: Uint8Array) => void
  ): () => void {

    this.dataListeners.push(
      callback
    );

    return () => {
      this.dataListeners =
        this.dataListeners.filter(
          listener =>
            listener !== callback
        );
    };
  }

  public onCanFrame(
    callback:
      (frame: CanFrame) => void
  ): () => void {

    this.canFrameListeners.push(
      callback
    );

    return () => {
      this.canFrameListeners =
        this.canFrameListeners.filter(
          listener =>
            listener !== callback
        );
    };
  }

  private setStatus(
    newStatus: ConnectionStatus,
    errorMsg?: string
  ): void {

    this.status =
      newStatus;

    for (
      const listener of [
        ...this.stateListeners
      ]
    ) {
      try {
        listener(
          newStatus,
          errorMsg
        );
      } catch (error) {
        console.error(
          '[BT-STATE-LISTENER-ERROR]',
          error
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CONNECT
  // ---------------------------------------------------------------------------

  public async connect(
    overrideConfig?:
      Partial<ConnectionConfig>
  ): Promise<boolean> {

    if (overrideConfig) {
      this.config = {
        ...this.config,
        ...overrideConfig
      };
    }

    if (
      this.status === 'CONNECTED'
    ) {
      return true;
    }

    if (this.isConnecting) {
      console.warn(
        '[BT-CONNECT] Connection already in progress'
      );

      return false;
    }

    this.isConnecting = true;

    this.lastError = null;
    this.lastErrorStackTrace = null;

    this.rxBuffer =
      new Uint8Array(0);

    this.asciiRxBuffer = '';

    this.setStatus(
      'CONNECTING'
    );

    try {

      // ---------------------------------------------------------
      // MOCK
      // ---------------------------------------------------------

      if (
        this.config.isMockMode
      ) {

        console.log(
          '[BT-CONNECT] Mock mode explicitly enabled'
        );

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              300
            )
        );

        mockEcuServer.start();

        this.rawState =
          'CONNECTED';

        this.setStatus(
          'CONNECTED'
        );

        return true;
      }

      // ---------------------------------------------------------
      // WEB / SERIAL
      // ---------------------------------------------------------

      const isNative =
        Capacitor.isNativePlatform();

      if (!isNative) {

        console.log(
          '[BT-CONNECT] Non-native runtime'
        );

        if (
          typeof navigator ===
            'undefined' ||
          !('serial' in navigator)
        ) {
          throw new Error(
            'Native Bluetooth Classic SPP is required on Android. Web Serial is available only where supported.'
          );
        }

        const port =
          await (
            navigator as any
          ).serial.requestPort();

        await port.open({
          baudRate: 115200
        });

        this.serialPort =
          port;

        if (
          !port.writable
        ) {
          throw new Error(
            'Selected serial port has no writable stream.'
          );
        }

        this.writer =
          port.writable.getWriter();

        void this.startSerialReadLoop();

        this.rawState =
          'CONNECTED';

        this.setStatus(
          'CONNECTED'
        );

        return true;
      }

      // ---------------------------------------------------------
      // NATIVE ANDROID BLUETOOTH SPP
      // ---------------------------------------------------------

      const targetMac =
        (
          this.config
            .bluetoothMacAddress ||
          ''
        )
          .trim()
          .toUpperCase();

      if (!targetMac) {
        throw new Error(
          'No Bluetooth MAC address specified. Scan and select a real paired SPP device.'
        );
      }

      console.log(
        `[BT-CONNECT] START address=${targetMac}`
      );

      await BluetoothSpp.connect({
        address: targetMac
      });

      console.log(
        '[BT-CONNECT] SPP CONNECTED'
      );

      await this.startNativeBtReadLoop();

      this.rawState =
        'CONNECTED';

      this.setStatus(
        'CONNECTED'
      );

      return true;

    } catch (err: any) {

      const errMsg =
        typeof err === 'string'
          ? err
          : (
              err?.message ||
              'Bluetooth connection failed'
            );

      const errObj =
        err instanceof Error
          ? err
          : new Error(errMsg);

      this.lastError =
        errObj;

      this.lastErrorStackTrace =
        errObj.stack || null;

      this.rawState =
        'ERROR';

      this.setStatus(
        'ERROR',
        errMsg
      );

      console.error(
        `[BT-CONNECT] FAILED: ${errMsg}`,
        err
      );

      await this.cleanupConnectionResources(
        true
      );

      return false;

    } finally {

      this.isConnecting =
        false;
    }
  }

  // ---------------------------------------------------------------------------
  // SCAN
  // ---------------------------------------------------------------------------

  public async scanDevices(
    onDeviceDiscovered?:
      (
        dev: BluetoothDeviceInfo
      ) => void
  ): Promise<
    BluetoothDeviceInfo[]
  > {

    if (this.isScanning) {
      console.warn(
        '[BT-SCAN] Scan already running'
      );

      return [];
    }

    this.isScanning = true;

    const devicesMap =
      new Map<
        string,
        BluetoothDeviceInfo
      >();

    console.log(
      '[BT-SCAN] START'
    );

    try {

      // ---------------------------------------------------------
      // SAVED DEVICES
      // ---------------------------------------------------------

      try {

        if (
          typeof localStorage !==
          'undefined'
        ) {

          const savedRaw =
            localStorage.getItem(
              'hamza_obd_custom_bt_devices'
            );

          if (savedRaw) {

            const savedList:
              BluetoothDeviceInfo[] =
              JSON.parse(
                savedRaw
              );

            for (
              const device of savedList
            ) {

              const address =
                (
                  device.address ||
                  ''
                )
                  .trim()
                  .toUpperCase();

              if (!address) {
                continue;
              }

              devicesMap.set(
                address,
                {
                  ...device,
                  address
                }
              );
            }
          }
        }

      } catch (error) {

        console.warn(
          '[BT-SCAN] Failed loading saved devices',
          error
        );
      }

      const isNative =
        Capacitor.isNativePlatform();

      // ---------------------------------------------------------
      // NON-NATIVE
      // ---------------------------------------------------------

      if (!isNative) {

        console.log(
          '[BT-SCAN] Non-native scan finished'
        );

        return Array.from(
          devicesMap.values()
        );
      }

      // ---------------------------------------------------------
      // PAIRED DEVICES
      // ---------------------------------------------------------

      try {

        const pairedResult =
          await BluetoothSpp
            .getPairedDevices();

        const rawPaired =
          pairedResult?.devices || [];

        for (
          const device of rawPaired
        ) {

          const address =
            (
              device.address ||
              ''
            )
              .trim()
              .toUpperCase();

          if (!address) {
            continue;
          }

          const devInfo:
            BluetoothDeviceInfo = {

            name:
              device.name ||
              'Paired Bluetooth Device',

            address,

            bonded: true,

            type:
              'CLASSIC_SPP'
          };

          devicesMap.set(
            address,
            devInfo
          );

          onDeviceDiscovered?.(
            devInfo
          );
        }

      } catch (error) {

        console.warn(
          '[BT-SCAN] getPairedDevices failed',
          error
        );
      }

      // ---------------------------------------------------------
      // LIVE DISCOVERY
      // ---------------------------------------------------------

      let foundHandle:
        any = null;

      let finishHandle:
        any = null;

      let discoveryFinishedResolve:
        (() => void) | null = null;

      const discoveryFinishedPromise =
        new Promise<void>(
          resolve => {
            discoveryFinishedResolve =
              resolve;
          }
        );

      try {

        foundHandle =
          await (
            BluetoothSpp as any
          ).addListener(
            'onBluetoothDeviceFound',
            (device: any) => {

              const address =
                (
                  device?.address ||
                  ''
                )
                  .trim()
                  .toUpperCase();

              if (!address) {
                return;
              }

              const detectedType =
                device?.type;

              /**
               * Do not pretend BLE is SPP.
               *
               * Only Classic Bluetooth devices should be
               * presented as SPP-capable.
               */
              const type =
                detectedType === 'BLE'
                  ? 'BLE'
                  : 'CLASSIC_SPP';

              const devInfo:
                BluetoothDeviceInfo = {

                name:
                  device?.name ||
                  'Unknown Bluetooth Device',

                address,

                bonded:
                  Boolean(
                    device?.bonded
                  ),

                rssi:
                  typeof device?.rssi ===
                  'number'
                    ? device.rssi
                    : undefined,

                type
              };

              devicesMap.set(
                address,
                devInfo
              );

              onDeviceDiscovered?.(
                devInfo
              );
            }
          );

        finishHandle =
          await (
            BluetoothSpp as any
          ).addListener(
            'onBluetoothDiscoveryFinished',
            () => {
              discoveryFinishedResolve?.();
            }
          );

        await BluetoothSpp
          .startDiscovery();

        await Promise.race([
          discoveryFinishedPromise,

          new Promise<void>(
            resolve =>
              setTimeout(
                resolve,
                12000
              )
          )
        ]);

      } finally {

        try {
          await BluetoothSpp
            .stopDiscovery();
        } catch {}

        try {
          await foundHandle?.remove();
        } catch {}

        try {
          await finishHandle?.remove();
        } catch {}
      }

      return Array.from(
        devicesMap.values()
      );

    } finally {

      this.isScanning =
        false;

      console.log(
        '[BT-SCAN] FINISHED'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // DISCONNECT
  // ---------------------------------------------------------------------------

  public async disconnect():
    Promise<void> {

    this.isConnecting =
      false;

    await this.cleanupConnectionResources(
      true
    );

    this.rxBuffer =
      new Uint8Array(0);

    this.asciiRxBuffer =
      '';

    this.rawState =
      'DISCONNECTED';

    this.setStatus(
      'DISCONNECTED'
    );
  }

  /**
   * Clean resources.
   *
   * disconnectNative:
   * - true  = explicitly disconnect the native device.
   * - false = native device already disconnected; do not call
   *           BluetoothSpp.disconnect() again.
   */
  private async cleanupConnectionResources(
    disconnectNative = true
  ): Promise<void> {

    // ---------------------------------------------------------
    // Native listeners
    // ---------------------------------------------------------

    try {
      await this.nativeDataListener?.remove();
    } catch {}

    try {
      await this.nativeDisconnectListener?.remove();
    } catch {}

    this.nativeDataListener =
      null;

    this.nativeDisconnectListener =
      null;

    // ---------------------------------------------------------
    // Web Serial
    // ---------------------------------------------------------

    if (this.reader) {

      try {
        await this.reader.cancel();
      } catch {}

      try {
        this.reader.releaseLock();
      } catch {}

      this.reader = null;
    }

    if (this.writer) {

      try {
        this.writer.releaseLock();
      } catch {}

      this.writer = null;
    }

    if (this.serialPort) {

      try {
        await this.serialPort.close();
      } catch {}

      this.serialPort = null;
    }

    // ---------------------------------------------------------
    // Native Bluetooth
    // ---------------------------------------------------------

    if (
      disconnectNative &&
      Capacitor.isNativePlatform()
    ) {

      try {
        await BluetoothSpp
          .disconnect();
      } catch {}
    }

    /**
     * IMPORTANT:
     *
     * Resolve all pending requests before clearing their
     * resolver references. Otherwise promises can remain pending
     * forever after a Bluetooth disconnect.
     */
    this.clearPendingResolvers();

    /**
     * Reset the write chain.
     */
    this.writeQueue =
      Promise.resolve();
  }

  private clearPendingResolvers():
    void {

    // ---------------------------------------------------------
    // PING
    // ---------------------------------------------------------

    if (
      this.pingTimeoutHandle
    ) {
      clearTimeout(
        this.pingTimeoutHandle
      );
    }

    const pingResolver =
      this.pingResolver;

    const pingStart =
      this.pingStartTime;

    this.pingTimeoutHandle =
      null;

    this.pingResolver =
      null;

    this.pingStartTime =
      null;

    if (pingResolver) {

      const latencyMs =
        pingStart !== null
          ? Math.max(
              0,
              Math.round(
                performance.now() -
                pingStart
              )
            )
          : 0;

      pingResolver({
        success: false,
        latencyMs,
        info:
          'Bluetooth disconnected'
      });
    }

    // ---------------------------------------------------------
    // CAN STATUS
    // ---------------------------------------------------------

    if (
      this.canStatusTimeoutHandle
    ) {
      clearTimeout(
        this.canStatusTimeoutHandle
      );
    }

    const canStatusResolver =
      this.canStatusResolver;

    this.canStatusTimeoutHandle =
      null;

    this.canStatusResolver =
      null;

    if (canStatusResolver) {
      canStatusResolver(null);
    }

    // ---------------------------------------------------------
    // K-LINE INIT
    // ---------------------------------------------------------

    if (
      this.klineInitTimeoutHandle
    ) {
      clearTimeout(
        this.klineInitTimeoutHandle
      );
    }

    const klineInitResolver =
      this.klineInitResolver;

    this.klineInitTimeoutHandle =
      null;

    this.klineInitResolver =
      null;

    if (klineInitResolver) {

      klineInitResolver({
        success: false,
        activeProtocol: 0,
        keyByte1: 0,
        keyByte2: 0
      });
    }

    // ---------------------------------------------------------
    // K-LINE STATUS
    // ---------------------------------------------------------

    if (
      this.klineStatusTimeoutHandle
    ) {
      clearTimeout(
        this.klineStatusTimeoutHandle
      );
    }

    const klineStatusResolver =
      this.klineStatusResolver;

    this.klineStatusTimeoutHandle =
      null;

    this.klineStatusResolver =
      null;

    if (klineStatusResolver) {
      klineStatusResolver(null);
    }

    // ---------------------------------------------------------
    // K-LINE FRAME
    // ---------------------------------------------------------

    if (
      this.klineFrameTimeoutHandle
    ) {
      clearTimeout(
        this.klineFrameTimeoutHandle
      );
    }

    const klineFrameResolver =
      this.klineFrameResolver;

    this.klineFrameTimeoutHandle =
      null;

    this.klineFrameResolver =
      null;

    if (klineFrameResolver) {

      klineFrameResolver({
        status: 0x04,
        data: []
      });
    }
  }

  // ---------------------------------------------------------------------------
  // RAW SEND
  // ---------------------------------------------------------------------------

  public async sendRaw(
    data:
      Uint8Array | number[]
  ): Promise<boolean> {

    if (
      !this.isConnected() &&
      !this.config.isMockMode
    ) {
      return false;
    }

    /**
     * Always clone the data.
     *
     * The actual write may happen later because of writeQueue.
     */
    const byteArr =
      new Uint8Array(
        data instanceof Uint8Array
          ? data
          : data
      );

    if (
      byteArr.length === 0
    ) {
      return false;
    }

    // ---------------------------------------------------------
    // MOCK
    // ---------------------------------------------------------

    if (
      this.config.isMockMode
    ) {
      return true;
    }

    const hex =
      this.debugRawTraffic
        ? Array.from(byteArr)
            .map(
              b =>
                b.toString(16)
                  .padStart(2, '0')
                  .toUpperCase()
            )
            .join(' ')
        : '';

    /**
     * The queued operation itself re-checks the connection.
     * This prevents an old queued write from being sent after
     * disconnect/reconnect.
     */
    const operation =
      this.writeQueue.then(
        async () => {

          if (
            !this.isConnected()
          ) {
            throw new Error(
              'Transport disconnected before write'
            );
          }

          // -----------------------------------------------------
          // NATIVE
          // -----------------------------------------------------

          if (
            Capacitor.isNativePlatform()
          ) {

            if (
              this.debugRawTraffic
            ) {
              console.log(
                `[BT-TX] ${hex}`
              );
            }

            await BluetoothSpp.write({
              data:
                Array.from(
                  byteArr
                )
            });

            return;
          }

          // -----------------------------------------------------
          // WEB SERIAL
          // -----------------------------------------------------

          if (this.writer) {

            if (
              this.debugRawTraffic
            ) {
              console.log(
                `[SERIAL-TX] ${hex}`
              );
            }

            await this.writer.write(
              byteArr
            );

            return;
          }

          throw new Error(
            'No active Bluetooth/Serial writer'
          );
        }
      );

    /**
     * Never allow a rejected operation to poison the queue.
     */
    this.writeQueue =
      operation.then(
        () => undefined,
        () => undefined
      );

    try {

      await operation;

      return true;

    } catch (error) {

      console.error(
        '[BT-TX] Write Error',
        error
      );

      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // CAN
  // ---------------------------------------------------------------------------

  public async sendCanFrame(
    canId: number,
    data: number[],
    isExtended = false
  ): Promise<boolean> {

    // ---------------------------------------------------------
    // MOCK
    // ---------------------------------------------------------

    if (
      this.config.isMockMode
    ) {
      return true;
    }

    // ---------------------------------------------------------
    // CONNECTION
    // ---------------------------------------------------------

    if (
      !this.isConnected()
    ) {
      return false;
    }

    // ---------------------------------------------------------
    // CAN ID
    // ---------------------------------------------------------

    if (
      !Number.isInteger(canId) ||
      canId < 0 ||
      (
        !isExtended &&
        canId > 0x7FF
      ) ||
      (
        isExtended &&
        canId > 0x1FFFFFFF
      )
    ) {

      console.error(
        `[BT-CAN-TX] Invalid CAN ID: 0x${canId.toString(16)}`
      );

      return false;
    }

    // ---------------------------------------------------------
    // DLC
    // ---------------------------------------------------------

    if (
      !Array.isArray(data) ||
      data.length > 8
    ) {

      console.error(
        '[BT-CAN-TX] CAN data exceeds 8 bytes'
      );

      return false;
    }

    // ---------------------------------------------------------
    // DATA
    // ---------------------------------------------------------

    const cleanData =
      data.map(
        byte => {

          if (
            !Number.isInteger(byte) ||
            byte < 0 ||
            byte > 0xFF
          ) {
            throw new Error(
              `Invalid CAN data byte: ${byte}`
            );
          }

          return byte;
        }
      );

    try {

      const packet =
        BinaryProtocol.encodeCanFrame(
          canId,
          cleanData,
          isExtended
        );

      return this.sendRaw(
        packet
      );

    } catch (error) {

      console.error(
        '[BT-CAN-TX] Encode error',
        error
      );

      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // PING
  // ---------------------------------------------------------------------------

  public async ping():
    Promise<PingResult> {

    const startTime =
      performance.now();

    const pingPacket =
      BinaryProtocol.encodePing();

    const txHex =
      Array.from(pingPacket)
        .map(
          b =>
            b.toString(16)
              .padStart(2, '0')
              .toUpperCase()
        )
        .join(' ');

    // ---------------------------------------------------------
    // MOCK
    // ---------------------------------------------------------

    if (
      this.config.isMockMode
    ) {

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            22
          )
      );

      return {
        success: true,
        latencyMs:
          Math.round(
            performance.now() -
            startTime
          ),
        canReady: true,
        txHex
      };
    }

    // ---------------------------------------------------------
    // CONNECTION
    // ---------------------------------------------------------

    if (
      !this.isConnected()
    ) {

      return {
        success: false,
        latencyMs: 0,
        info:
          'Bluetooth SPP not connected',
        txHex
      };
    }

    // ---------------------------------------------------------
    // DUPLICATE REQUEST
    // ---------------------------------------------------------

    if (
      this.pingResolver
    ) {

      return {
        success: false,
        latencyMs: 0,
        info:
          'Another Bluetooth ping is already pending',
        txHex
      };
    }

    return new Promise(
      resolve => {

        this.pingStartTime =
          startTime;

        this.pingTimeoutHandle =
          setTimeout(
            () => {

              this.pingResolver =
                null;

              this.pingStartTime =
                null;

              this.pingTimeoutHandle =
                null;

              resolve({
                success: false,
                latencyMs:
                  Math.round(
                    performance.now() -
                    startTime
                  ),
                info:
                  'Bluetooth Ping Timeout',
                txHex
              });

            },
            2000
          );

        this.pingResolver =
          result => {

            if (
              this.pingTimeoutHandle
            ) {
              clearTimeout(
                this.pingTimeoutHandle
              );
            }

            this.pingTimeoutHandle =
              null;

            this.pingResolver =
              null;

            this.pingStartTime =
              null;

            result.txHex =
              result.txHex || txHex;

            resolve(result);
          };

        void this.sendRaw(
          pingPacket
        ).then(
          success => {

            if (
              success
            ) {
              return;
            }

            const resolver =
              this.pingResolver;

            this.pingResolver =
              null;

            if (
              this.pingTimeoutHandle
            ) {
              clearTimeout(
                this.pingTimeoutHandle
              );
            }

            this.pingTimeoutHandle =
              null;

            this.pingStartTime =
              null;

            if (resolver) {
              resolver({
                success: false,
                latencyMs:
                  Math.round(
                    performance.now() -
                    startTime
                  ),
                info:
                  'Bluetooth Ping Write Failed',
                txHex
              });
            }
          }
        );
      }
    );
  }

  // ---------------------------------------------------------------------------
  // CAN STATUS
  // ---------------------------------------------------------------------------

  public async getCanStatus():
    Promise<CanBusStatus | null> {

    // ---------------------------------------------------------
    // MOCK
    // ---------------------------------------------------------

    if (
      this.config.isMockMode
    ) {

      return {
        state: 'READY',
        speed: 500000,
        mode: '11-BIT',
        txErrorCount: 0,
        rxErrorCount: 0,
        busOverrunCount: 0,
        queueSize: 0,
        messagesSent: 0,
        messagesReceived: 0
      };
    }

    // ---------------------------------------------------------
    // CONNECTION
    // ---------------------------------------------------------

    if (
      !this.isConnected()
    ) {
      return null;
    }

    if (
      this.canStatusResolver
    ) {

      console.warn(
        '[BT-CAN-STATUS] Request already pending'
      );

      return null;
    }

    return new Promise(
      resolve => {

        this.canStatusTimeoutHandle =
          setTimeout(
            () => {

              this.canStatusResolver =
                null;

              this.canStatusTimeoutHandle =
                null;

              resolve(null);

            },
            2000
          );

        this.canStatusResolver =
          status => {

            if (
              this.canStatusTimeoutHandle
            ) {
              clearTimeout(
                this.canStatusTimeoutHandle
              );
            }

            this.canStatusTimeoutHandle =
              null;

            this.canStatusResolver =
              null;

            resolve(status);
          };

        void this.sendRaw(
          BinaryProtocol
            .encodeCanStatusReq()
        ).then(
          success => {

            if (
              success
            ) {
              return;
            }

            const resolver =
              this.canStatusResolver;

            this.canStatusResolver =
              null;

            if (
              this.canStatusTimeoutHandle
            ) {
              clearTimeout(
                this.canStatusTimeoutHandle
              );
            }

            this.canStatusTimeoutHandle =
              null;

            resolver?.(null);
          }
        );
      }
    );
  }

  // ---------------------------------------------------------------------------
  // RX
  // ---------------------------------------------------------------------------

  private handleIncomingData(
    data:
      ArrayBuffer |
      Uint8Array |
      string |
      number[]
  ): void {

    const newBytes =
      this.normalizeIncomingBytes(
        data
      );

    if (
      newBytes.length === 0
    ) {
      return;
    }

    if (
      this.debugRawTraffic
    ) {

      const rxHex =
        Array.from(newBytes)
          .map(
            b =>
              b.toString(16)
                .padStart(2, '0')
                .toUpperCase()
          )
          .join(' ');

      console.log(
        `[BT-RX-RAW] ${rxHex}`
      );
    }

    // ---------------------------------------------------------
    // RAW LISTENERS
    // ---------------------------------------------------------

    for (
      const listener of [
        ...this.dataListeners
      ]
    ) {
      try {
        listener(
          new Uint8Array(
            newBytes
          )
        );
      } catch (error) {
        console.error(
          '[BT-RX-DATA-LISTENER]',
          error
        );
      }
    }

    // ---------------------------------------------------------
    // BINARY STREAM
    // ---------------------------------------------------------

    const merged =
      new Uint8Array(
        this.rxBuffer.length +
        newBytes.length
      );

    merged.set(
      this.rxBuffer,
      0
    );

    merged.set(
      newBytes,
      this.rxBuffer.length
    );

    this.rxBuffer =
      merged;

    const parsed =
      BinaryProtocol.parseStream(
        this.rxBuffer
      );

    this.rxBuffer =
      parsed.remainingBuffer;

    // ---------------------------------------------------------
    // DECODED PACKETS
    // ---------------------------------------------------------

    for (
      const packet of parsed.packets
    ) {

      if (
        (packet as any).isValid === false
      ) {
        console.warn(
          '[BT-RX] Ignoring invalid binary packet'
        );

        continue;
      }

      if (
        this.debugRawTraffic
      ) {

        const pktHex =
          Array.from(
            packet.rawFrame
          )
            .map(
              b =>
                b.toString(16)
                  .padStart(2, '0')
                  .toUpperCase()
            )
            .join(' ');

        console.log(
          `[BT-RX-FRAME] CMD=0x${packet.cmd
            .toString(16)
            .padStart(2, '0')
            .toUpperCase()} ` +
          `LEN=${packet.payload.length} ` +
          `HEX=[${pktHex}]`
        );
      }

      this.processDecodedPacket(
        packet
      );
    }

    /**
     * IMPORTANT:
     *
     * Do NOT automatically call the ASCII parser here.
     *
     * Binary payloads can legitimately contain:
     * 0x0D
     * 0x0A
     * ASCII-looking bytes
     *
     * Feeding them to an ELM parser would corrupt rxBuffer.
     */
  }

  // ---------------------------------------------------------------------------
  // NORMALIZE NATIVE DATA
  // ---------------------------------------------------------------------------

  private normalizeIncomingBytes(
    data:
      ArrayBuffer |
      Uint8Array |
      string |
      number[] |
      ArrayBufferView
  ): Uint8Array {

    if (
      data instanceof Uint8Array
    ) {
      return new Uint8Array(
        data
      );
    }

    if (
      data instanceof ArrayBuffer
    ) {
      return new Uint8Array(
        data
      );
    }

    if (
      Array.isArray(data)
    ) {
      return new Uint8Array(
        data.map(
          byte =>
            Number(byte) & 0xFF
        )
      );
    }

    if (
      typeof ArrayBuffer !==
      'undefined' &&
      ArrayBuffer.isView(data)
    ) {

      const view =
        data as ArrayBufferView;

      return new Uint8Array(
        view.buffer,
        view.byteOffset,
        view.byteLength
      );
    }

    if (
      typeof data === 'string'
    ) {

      /**
       * IMPORTANT:
       *
       * We do not assume that a string is hexadecimal or Base64.
       * The actual plugin contract must determine that.
       *
       * For now it is treated as raw byte characters, preserving
       * the behavior of the previous implementation.
       */
      const bytes =
        new Uint8Array(
          data.length
        );

      for (
        let i = 0;
        i < data.length;
        i++
      ) {

        bytes[i] =
          data.charCodeAt(i) &
          0xFF;
      }

      return bytes;
    }

    return new Uint8Array(0);
  }

  // ---------------------------------------------------------------------------
  // OPTIONAL LEGACY ASCII API
  // ---------------------------------------------------------------------------

  /**
   * Legacy ELM-compatible parser.
   *
   * This function is intentionally NOT connected to the binary
   * RX stream.
   *
   * It must only be called by a transport that has explicitly
   * established that its source is ASCII ELM data.
   */
  private checkAndParseAsciiLines(
    text?: string
  ): void {

    if (
      typeof text === 'string'
    ) {
      this.asciiRxBuffer +=
        text;
    }

    if (
      !this.asciiRxBuffer
    ) {
      return;
    }

    const hasTerminator =
      this.asciiRxBuffer.includes('\r') ||
      this.asciiRxBuffer.includes('\n') ||
      this.asciiRxBuffer.includes('>');

    if (!hasTerminator) {
      return;
    }

    const lines =
      this.asciiRxBuffer
        .split(/[\r\n>]+/);

    const terminated =
      this.asciiRxBuffer.endsWith('\r') ||
      this.asciiRxBuffer.endsWith('\n') ||
      this.asciiRxBuffer.endsWith('>');

    const limit =
      terminated
        ? lines.length
        : lines.length - 1;

    for (
      let i = 0;
      i < limit;
      i++
    ) {

      const line =
        lines[i].trim();

      if (!line) {
        continue;
      }

      const cleanHex =
        line.replace(
          /[^0-9A-Fa-f]/g,
          ''
        );

      if (
        cleanHex.length < 4 ||
        cleanHex.length % 2 !== 0
      ) {
        continue;
      }

      const bytes: number[] =
        [];

      for (
        let k = 0;
        k < cleanHex.length;
        k += 2
      ) {

        bytes.push(
          parseInt(
            cleanHex.substring(
              k,
              k + 2
            ),
            16
          )
        );
      }

      const modeByte =
        bytes[0];

      const validElmResponse =
        modeByte === 0x41 ||
        modeByte === 0x43 ||
        modeByte === 0x47 ||
        modeByte === 0x4A ||
        modeByte === 0x44 ||
        modeByte === 0x59 ||
        modeByte === 0x7F;

      if (
        !validElmResponse
      ) {
        continue;
      }

      const frame:
        CanFrame = {

        id: '0x7E8',

        dlc:
          Math.min(
            bytes.length,
            8
          ),

        dataHex:
          bytes
            .slice(0, 8)
            .map(
              b =>
                b.toString(16)
                  .padStart(2, '0')
                  .toUpperCase()
            )
            .join(' '),

        dataBytes:
          bytes.slice(0, 8),

        direction: 'Rx',

        isExtended: false
      };

      canManager.addFrame(
        frame
      );

      for (
        const listener of [
          ...this.canFrameListeners
        ]
      ) {
        try {
          listener(frame);
        } catch (error) {
          console.error(
            '[BT-CAN-LISTENER]',
            error
          );
        }
      }
    }

    if (terminated) {
      this.asciiRxBuffer = '';
    }
  }

  // ---------------------------------------------------------------------------
  // K-LINE
  // ---------------------------------------------------------------------------

  public onKlinePacket(
    callback:
      (
        pkt: DecodedBinaryPacket
      ) => void
  ): () => void {

    this.klinePacketListeners.push(
      callback
    );

    return () => {
      this.klinePacketListeners =
        this.klinePacketListeners.filter(
          listener =>
            listener !== callback
        );
    };
  }

  public async sendKlineInit(
    protocolId?: number
  ): Promise<{
    success: boolean;
    activeProtocol: number;
    keyByte1: number;
    keyByte2: number;
  }> {

    // ---------------------------------------------------------
    // MOCK
    // ---------------------------------------------------------

    if (
      this.config.isMockMode
    ) {

      return {
        success: true,
        activeProtocol:
          protocolId ?? 0x06,
        keyByte1: 0x8F,
        keyByte2: 0xEA
      };
    }

    // ---------------------------------------------------------
    // CONNECTION
    // ---------------------------------------------------------

    if (
      !this.isConnected()
    ) {

      return {
        success: false,
        activeProtocol: 0,
        keyByte1: 0,
        keyByte2: 0
      };
    }

    if (
      this.klineInitResolver
    ) {

      return {
        success: false,
        activeProtocol: 0,
        keyByte1: 0,
        keyByte2: 0
      };
    }

    return new Promise(
      resolve => {

        this.klineInitTimeoutHandle =
          setTimeout(
            () => {

              this.klineInitResolver =
                null;

              this.klineInitTimeoutHandle =
                null;

              resolve({
                success: false,
                activeProtocol: 0,
                keyByte1: 0,
                keyByte2: 0
              });

            },
            3000
          );

        this.klineInitResolver =
          result => {

            if (
              this.klineInitTimeoutHandle
            ) {
              clearTimeout(
                this.klineInitTimeoutHandle
              );
            }

            this.klineInitTimeoutHandle =
              null;

            this.klineInitResolver =
              null;

            resolve(result);
          };

        void this.sendRaw(
          BinaryProtocol.encodeKlineInit(
            protocolId
          )
        ).then(
          success => {

            if (
              success
            ) {
              return;
            }

            const resolver =
              this.klineInitResolver;

            this.klineInitResolver =
              null;

            if (
              this.klineInitTimeoutHandle
            ) {
              clearTimeout(
                this.klineInitTimeoutHandle
              );
            }

            this.klineInitTimeoutHandle =
              null;

            resolver?.({
              success: false,
              activeProtocol: 0,
              keyByte1: 0,
              keyByte2: 0
            });
          }
        );
      }
    );
  }

  public async sendKlineFrame(
    payload: number[]
  ): Promise<{
    status: number;
    data: number[];
  }> {

    // ---------------------------------------------------------
    // MOCK
    // ---------------------------------------------------------

    if (
      this.config.isMockMode
    ) {

      if (
        payload[0] === 0x01 &&
        payload[1] === 0x00
      ) {

        return {
          status: 0,
          data: [
            0x41,
            0x00,
            0xBE,
            0x3E,
            0x28,
            0x10
          ]
        };
      }

      return {
        status: 0,
        data: [
          ((payload[0] ?? 0) +
            0x40) & 0xFF,
          payload[1] ?? 0x00,
          0x00,
          0x00
        ]
      };
    }

    // ---------------------------------------------------------
    // CONNECTION
    // ---------------------------------------------------------

    if (
      !this.isConnected()
    ) {

      return {
        status: 0x04,
        data: []
      };
    }

    if (
      this.klineFrameResolver
    ) {

      return {
        status: 0x04,
        data: []
      };
    }

    return new Promise(
      resolve => {

        this.klineFrameTimeoutHandle =
          setTimeout(
            () => {

              this.klineFrameResolver =
                null;

              this.klineFrameTimeoutHandle =
                null;

              resolve({
                status: 0x04,
                data: []
              });

            },
            2500
          );

        this.klineFrameResolver =
          result => {

            if (
              this.klineFrameTimeoutHandle
            ) {
              clearTimeout(
                this.klineFrameTimeoutHandle
              );
            }

            this.klineFrameTimeoutHandle =
              null;

            this.klineFrameResolver =
              null;

            resolve(result);
          };

        let packet:
          Uint8Array;

        try {

          packet =
            BinaryProtocol
              .encodeKlineFrame(
                payload
              );

        } catch (error) {

          const resolver =
            this.klineFrameResolver;

          this.klineFrameResolver =
            null;

          if (
            this.klineFrameTimeoutHandle
          ) {
            clearTimeout(
              this.klineFrameTimeoutHandle
            );
          }

          this.klineFrameTimeoutHandle =
            null;

          resolver?.({
            status: 0x04,
            data: []
          });

          return;
        }

        void this.sendRaw(
          packet
        ).then(
          success => {

            if (
              success
            ) {
              return;
            }

            const resolver =
              this.klineFrameResolver;

            this.klineFrameResolver =
              null;

            if (
              this.klineFrameTimeoutHandle
            ) {
              clearTimeout(
                this.klineFrameTimeoutHandle
              );
            }

            this.klineFrameTimeoutHandle =
              null;

            resolver?.({
              status: 0x04,
              data: []
            });
          }
        );
      }
    );
  }

  public async getKlineStatus():
    Promise<any | null> {

    // ---------------------------------------------------------
    // MOCK
    // ---------------------------------------------------------

    if (
      this.config.isMockMode
    ) {

      return {
        voltagePresent: true,
        activeProtocol: 6,
        initialized: true,
        rxErrorCount: 0,
        txErrorCount: 0,
        lastErrorCode: 0
      };
    }

    // ---------------------------------------------------------
    // CONNECTION
    // ---------------------------------------------------------

    if (
      !this.isConnected()
    ) {
      return null;
    }

    if (
      this.klineStatusResolver
    ) {
      return null;
    }

    return new Promise(
      resolve => {

        this.klineStatusTimeoutHandle =
          setTimeout(
            () => {

              this.klineStatusResolver =
                null;

              this.klineStatusTimeoutHandle =
                null;

              resolve(null);

            },
            2000
          );

        this.klineStatusResolver =
          status => {

            if (
              this.klineStatusTimeoutHandle
            ) {
              clearTimeout(
                this.klineStatusTimeoutHandle
              );
            }

            this.klineStatusTimeoutHandle =
              null;

            this.klineStatusResolver =
              null;

            resolve(status);
          };

        void this.sendRaw(
          BinaryProtocol
            .encodeKlineStatusReq()
        ).then(
          success => {

            if (
              success
            ) {
              return;
            }

            const resolver =
              this.klineStatusResolver;

            this.klineStatusResolver =
              null;

            if (
              this.klineStatusTimeoutHandle
            ) {
              clearTimeout(
                this.klineStatusTimeoutHandle
              );
            }

            this.klineStatusTimeoutHandle =
              null;

            resolver?.(null);
          }
        );
      }
    );
  }

  // ---------------------------------------------------------------------------
  // DECODED PACKET ROUTER
  // ---------------------------------------------------------------------------

  private processDecodedPacket(
    pkt: DecodedBinaryPacket
  ): void {

    /**
     * K-Line listeners are allowed to observe decoded packets.
     *
     * Existing application behavior is preserved here.
     */
    for (
      const listener of [
        ...this.klinePacketListeners
      ]
    ) {

      try {
        listener(pkt);
      } catch (error) {
        console.error(
          '[BT-KLINE-PACKET-LISTENER]',
          error
        );
      }
    }

    // ---------------------------------------------------------
    // CAN RX
    // ---------------------------------------------------------

    if (
      pkt.cmd ===
        BinaryCommand.CMD_CAN_FRAME &&
      pkt.canFrame
    ) {

      const frame =
        pkt.canFrame;

      /**
       * No raw console logging here by default.
       *
       * CAN traffic can be very high-rate.
       */
      if (
        this.debugRawTraffic
      ) {
        console.log(
          `[CAN-RX] ID=${frame.id} DLC=${frame.dlc} DATA=${frame.dataHex}`
        );
      }

      commLogger.logPacket({
        direction: '[BT RX]',
        protocol:
          frame.isExtended
            ? 'CAN 29-bit'
            : 'CAN 11-bit',
        canIdHex:
          frame.id,
        responseRaw:
          frame.dataHex,
        durationMs: 0,
        status: 'SUCCESS'
      });

      canManager.addFrame(
        frame
      );

      for (
        const listener of [
          ...this.canFrameListeners
        ]
      ) {

        try {
          listener(frame);
        } catch (error) {
          console.error(
            '[BT-CAN-LISTENER]',
            error
          );
        }
      }

      return;
    }

    // ---------------------------------------------------------
    // PONG
    // ---------------------------------------------------------

    if (
      pkt.cmd ===
        BinaryCommand.CMD_PONG &&
      pkt.pongInfo
    ) {

      if (
        this.pingResolver
      ) {

        const latencyMs =
          this.pingStartTime !==
          null
            ? Math.round(
                performance.now() -
                this.pingStartTime
              )
            : 0;

        const rxHex =
          this.debugRawTraffic
            ? Array.from(
                pkt.rawFrame
              )
                .map(
                  b =>
                    b.toString(16)
                      .padStart(2, '0')
                      .toUpperCase()
                )
                .join(' ')
            : undefined;

        this.pingResolver({
          success: true,
          latencyMs,
          canReady:
            pkt.pongInfo.canReady,
          uptimeMs:
            pkt.pongInfo.uptimeMs,
          freeHeapBytes:
            pkt.pongInfo.freeHeapBytes,
          info:
            `ESP32 BT SPP Ready | Uptime ${(pkt.pongInfo.uptimeMs / 1000).toFixed(1)}s`,
          rxHex
        });
      }

      return;
    }

    // ---------------------------------------------------------
    // CAN STATUS
    // ---------------------------------------------------------

    if (
      pkt.cmd ===
        BinaryCommand.CMD_CAN_STATUS_RESP &&
      pkt.canStatus
    ) {

      this.canStatusResolver?.(
        pkt.canStatus
      );

      return;
    }

    // ---------------------------------------------------------
    // K-LINE INIT
    // ---------------------------------------------------------

    if (
      pkt.cmd ===
        BinaryCommand.CMD_KLINE_INIT_RESP &&
      pkt.klineInitResult
    ) {

      commLogger.logPacket({
        direction: '[KLINE RX]',
        protocol:
          String(
            pkt.klineInitResp
              ?.activeProtocol ||
            'K-LINE'
          ),
        decodedData:
          'KLINE_INIT',
        responseRaw:
          `Status=${pkt.klineInitResult.success ? 'SUCCESS' : 'FAILED'} ` +
          `KB1=0x${pkt.klineInitResult.keyByte1.toString(16).padStart(2, '0').toUpperCase()} ` +
          `KB2=0x${pkt.klineInitResult.keyByte2.toString(16).padStart(2, '0').toUpperCase()}`,
        durationMs: 0,
        status:
          pkt.klineInitResult.success
            ? 'SUCCESS'
            : 'ERROR'
      });

      this.klineInitResolver?.(
        pkt.klineInitResult
      );

      return;
    }

    // ---------------------------------------------------------
    // K-LINE FRAME
    // ---------------------------------------------------------

    if (
      pkt.cmd ===
        BinaryCommand.CMD_KLINE_FRAME &&
      pkt.klineFrameResult
    ) {

      commLogger.logPacket({
        direction: '[KLINE RX]',
        protocol: 'K-LINE',
        decodedData:
          'KLINE_FRAME',
        responseRaw:
          pkt.klineFrame?.rawHex ||
          '',
        durationMs: 0,
        status:
          pkt.klineFrameResult.status ===
          0
            ? 'SUCCESS'
            : 'ERROR'
      });

      this.klineFrameResolver?.(
        pkt.klineFrameResult
      );

      return;
    }

    // ---------------------------------------------------------
    // K-LINE STATUS
    // ---------------------------------------------------------

    if (
      pkt.cmd ===
        BinaryCommand.CMD_KLINE_STATUS_RESP &&
      pkt.klineStatus
    ) {

      this.klineStatusResolver?.(
        pkt.klineStatus
      );

      return;
    }
  }

  // ---------------------------------------------------------------------------
  // WEB SERIAL RX LOOP
  // ---------------------------------------------------------------------------

  private async startSerialReadLoop():
    Promise<void> {

    while (
      this.serialPort &&
      this.serialPort.readable
    ) {

      try {

        this.reader =
          this.serialPort.readable
            .getReader();

        while (true) {

          const {
            value,
            done
          } =
            await this.reader.read();

          if (done) {
            break;
          }

          if (value) {
            this.handleIncomingData(
              value
            );
          }
        }

      } catch (error) {

        console.error(
          '[SERIAL-RX] Read loop error',
          error
        );

        break;

      } finally {

        if (this.reader) {

          try {
            this.reader.releaseLock();
          } catch {}

          this.reader = null;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // NATIVE BLUETOOTH RX LOOP
  // ---------------------------------------------------------------------------

  private async startNativeBtReadLoop():
    Promise<void> {

    /**
     * Remove previous listeners before creating new ones.
     */
    try {
      await this.nativeDataListener?.remove();
    } catch {}

    try {
      await this.nativeDisconnectListener?.remove();
    } catch {}

    this.nativeDataListener =
      null;

    this.nativeDisconnectListener =
      null;

    this.nativeDataListener =
      await (
        BluetoothSpp as any
      ).addListener(
        'onBluetoothData',
        (info: any) => {

          if (
            !info ||
            info.data == null
          ) {
            return;
          }

          try {

            const bytes =
              this.normalizeIncomingBytes(
                info.data
              );

            if (
              bytes.length === 0
            ) {
              return;
            }

            this.handleIncomingData(
              bytes
            );

          } catch (error) {

            console.error(
              '[BT-NATIVE-RX] Invalid data',
              error
            );
          }
        }
      );

    this.nativeDisconnectListener =
      await (
        BluetoothSpp as any
      ).addListener(
        'onBluetoothDisconnect',
        () => {

          console.warn(
            '[BT-NATIVE] Remote Bluetooth disconnect'
          );

          void this.handleNativeDisconnect();
        }
      );
  }

  private async handleNativeDisconnect():
    Promise<void> {

    if (
      this.status ===
      'DISCONNECTED'
    ) {
      return;
    }

    /**
     * false is critical here.
     *
     * The native side already told us that Bluetooth
     * disconnected. Calling BluetoothSpp.disconnect() again
     * can create recursion/errors in some plugins.
     */
    await this.cleanupConnectionResources(
      false
    );

    this.rxBuffer =
      new Uint8Array(0);

    this.asciiRxBuffer =
      '';

    this.rawState =
      'DISCONNECTED';

    this.setStatus(
      'DISCONNECTED',
      'Bluetooth device disconnected'
    );
  }
}
