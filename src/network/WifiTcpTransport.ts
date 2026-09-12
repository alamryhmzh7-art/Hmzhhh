/**
 * HAMZA OBD PRO - Wi-Fi TCP Transport Implementation
 *
 * Direct TCP/WebSocket client to ESP32 SoftAP.
 *
 * Architecture:
 *
 *   ESP32
 *      ↓ BinaryProtocol
 *   WifiTcpTransport
 *      ↓ CanFrame / status / K-Line packets
 *   TransportManager
 *      ↓
 *   CanManager / ISO-TP / OBD / UDS / UI
 *
 * IMPORTANT:
 * WifiTcpTransport MUST NOT write CAN frames directly into canManager.
 * TransportManager is the single owner of CAN frame insertion.
 */

import {
  ConnectionConfig,
  ConnectionStatus,
  CanFrame,
  CanBusStatus,
  TransportType
} from '../types';

import { ITransport, PingResult } from './Transport';

import {
  BinaryProtocol,
  BinaryCommand,
  DecodedBinaryPacket
} from './binaryProtocol';

import { commLogger, AppLogger } from '../logging/logger';

import { mockEcuServer } from './mockEcuServer';

export class WifiTcpTransport implements ITransport {
  public readonly type: TransportType = 'WIFI_TCP';

  private config: ConnectionConfig;

  private status: ConnectionStatus = 'DISCONNECTED';

  private socket: WebSocket | null = null;

  /**
   * Binary receive stream buffer.
   *
   * IMPORTANT:
   * Never feed incomplete BinaryProtocol data into the ASCII parser.
   */
  private rxBuffer: Uint8Array = new Uint8Array(0);

  /**
   * Connection/session generation.
   *
   * Every connect/disconnect creates a new generation.
   * Old socket callbacks are ignored.
   */
  private connectionGeneration = 0;

  private connectPromiseActive = false;

  private stateListeners: Array<
    (state: ConnectionStatus, error?: string) => void
  > = [];

  private dataListeners: Array<
    (data: Uint8Array) => void
  > = [];

  private canFrameListeners: Array<
    (frame: CanFrame) => void
  > = [];

  private pingResolver:
    ((res: PingResult) => void) | null = null;

  private canStatusResolver:
    ((status: CanBusStatus | null) => void) | null = null;

  private klineInitResolver:
    ((res: {
      success: boolean;
      activeProtocol: number;
      keyByte1: number;
      keyByte2: number;
    }) => void) | null = null;

  private klineStatusResolver:
    ((status: any) => void) | null = null;

  private klineFrameResolver:
    ((res: {
      status: number;
      data: number[];
    }) => void) | null = null;

  private klinePacketListeners: Array<
    (pkt: DecodedBinaryPacket) => void
  > = [];

  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  public getState(): ConnectionStatus {
    return this.status;
  }

  public isConnected(): boolean {
    return (
      this.status === 'CONNECTED' &&
      (
        this.config.isMockMode ||
        (
          this.socket !== null &&
          this.socket.readyState === WebSocket.OPEN
        )
      )
    );
  }

  public updateConfig(config: ConnectionConfig) {
    this.config = config;
  }

  public onStateChange(
    callback: (state: ConnectionStatus, error?: string) => void
  ): () => void {
    this.stateListeners.push(callback);

    callback(this.status);

    return () => {
      this.stateListeners = this.stateListeners.filter(
        listener => listener !== callback
      );
    };
  }

  public onData(
    callback: (data: Uint8Array) => void
  ): () => void {
    this.dataListeners.push(callback);

    return () => {
      this.dataListeners = this.dataListeners.filter(
        listener => listener !== callback
      );
    };
  }

  public onCanFrame(
    callback: (frame: CanFrame) => void
  ): () => void {
    this.canFrameListeners.push(callback);

    return () => {
      this.canFrameListeners = this.canFrameListeners.filter(
        listener => listener !== callback
      );
    };
  }

  private setStatus(
    newStatus: ConnectionStatus,
    errorMsg?: string
  ) {
    this.status = newStatus;

    const listeners = [...this.stateListeners];

    listeners.forEach(listener => {
      try {
        listener(newStatus, errorMsg);
      } catch (error) {
        console.error('[WifiTcpTransport] State listener error:', error);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Connect
  // ---------------------------------------------------------------------------

  public async connect(
    overrideConfig?: Partial<ConnectionConfig>
  ): Promise<boolean> {
    if (overrideConfig) {
      this.config = {
        ...this.config,
        ...overrideConfig
      };
    }

    if (this.config.isMockMode) {
      if (this.status === 'CONNECTED') {
        return true;
      }

      this.setStatus('CONNECTING');

      await new Promise(resolve => setTimeout(resolve, 100));

      mockEcuServer.start();

      this.setStatus('CONNECTED');

      this.startHeartbeat();

      return true;
    }

    if (this.status === 'CONNECTED') {
      return true;
    }

    if (this.connectPromiseActive) {
      return this.status === 'CONNECTED';
    }

    this.connectPromiseActive = true;

    const generation = ++this.connectionGeneration;

    this.stopHeartbeat();

    this.cleanupSocket();

    this.rxBuffer = new Uint8Array(0);

    this.clearPendingResolvers();

    this.setStatus('CONNECTING');

    AppLogger.info(
      'NETWORK',
      'WifiConnect',
      `Connecting to ESP32 Wi-Fi TCP at ${this.config.ip}:${this.config.port}`,
      `محاولة الاتصال بمقبس Wi-Fi TCP في ESP32 عبر ${this.config.ip}:${this.config.port}`,
      undefined,
      {
        deviceState: 'CONNECTING',
        generation
      }
    );

    return new Promise<boolean>((resolve) => {
      let settled = false;

      const finish = (result: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        this.connectPromiseActive = false;

        resolve(result);
      };

      const timeoutMs =
        Number.isFinite(this.config.connectionTimeoutMs) &&
        this.config.connectionTimeoutMs > 0
          ? this.config.connectionTimeoutMs
          : 5000;

      const timeoutTimer = setTimeout(() => {
        if (generation !== this.connectionGeneration) {
          finish(false);
          return;
        }

        if (this.status === 'CONNECTING') {
          this.setStatus(
            'ERROR',
            'Wi-Fi Connection Timeout'
          );

          AppLogger.error(
            'NETWORK',
            'WifiTimeout',
            `Wi-Fi TCP connection timed out after ${timeoutMs}ms`,
            `انتهت مهلة اتصال Wi-Fi TCP بعد ${timeoutMs} ملي ثانية`,
            undefined,
            {
              deviceState: 'ERROR',
              generation
            }
          );

          this.cleanupSocket();

          finish(false);
        }
      }, timeoutMs);

      try {
        const wsUrl =
          `ws://${this.config.ip}:${this.config.port}`;

        const socket = new WebSocket(wsUrl);

        socket.binaryType = 'arraybuffer';

        this.socket = socket;

        socket.onopen = () => {
          if (generation !== this.connectionGeneration) {
            try {
              socket.close();
            } catch {}

            return;
          }

          clearTimeout(timeoutTimer);

          this.socket = socket;

          this.setStatus('CONNECTED');

          this.startHeartbeat(generation);

          AppLogger.info(
            'NETWORK',
            'WifiConnected',
            `[WiFi] Connected to ESP32 at ${this.config.ip}:${this.config.port}`,
            `[WiFi] تم فتح اتصال Wi-Fi TCP بنجاح مع ESP32`,
            undefined,
            {
              deviceState: 'CONNECTED',
              generation
            }
          );

          finish(true);
        };

        socket.onerror = (event) => {
          if (generation !== this.connectionGeneration) {
            return;
          }

          clearTimeout(timeoutTimer);

          AppLogger.error(
            'NETWORK',
            'WifiSocketError',
            `Failed to establish a Wi-Fi TCP connection to ${this.config.ip}:${this.config.port}.`,
            `تعذر إنشاء اتصال Wi-Fi TCP مع ESP32 على ${this.config.ip}:${this.config.port}.`,
            undefined,
            {
              deviceState: 'ERROR',
              generation,
              error: event
            }
          );

          if (this.status === 'CONNECTING') {
            this.setStatus(
              'ERROR',
              'Socket Error'
            );
          }

          finish(false);
        };

        socket.onclose = (event) => {
          if (generation !== this.connectionGeneration) {
            return;
          }

          clearTimeout(timeoutTimer);

          this.stopHeartbeat();

          if (this.socket === socket) {
            this.socket = null;
          }

          this.rxBuffer = new Uint8Array(0);

          this.clearPendingResolvers();

          if (this.status !== 'DISCONNECTED') {
            this.setStatus(
              'DISCONNECTED',
              `Connection Closed (${event.code})`
            );

            AppLogger.warn(
              'NETWORK',
              'WifiClosed',
              `[WiFi] Connection to ESP32 closed. Code=${event.code}`,
              `[WiFi] انقطع اتصال ESP32. رمز الإغلاق=${event.code}`,
              undefined,
              {
                deviceState: 'DISCONNECTED',
                generation,
                closeCode: event.code,
                reason: event.reason
              }
            );
          }

          finish(false);
        };

        socket.onmessage = (event) => {
          if (generation !== this.connectionGeneration) {
            return;
          }

          this.handleIncomingData(event.data);
        };

      } catch (error: any) {
        clearTimeout(timeoutTimer);

        const message =
          error?.message ||
          'Initialization Failed';

        if (generation === this.connectionGeneration) {
          this.setStatus(
            'ERROR',
            message
          );

          this.cleanupSocket();
        }

        AppLogger.error(
          'NETWORK',
          'WifiConnectException',
          `System exception while opening Wi-Fi socket: ${message}`,
          `حدث استثناء أثناء فتح اتصال Wi-Fi: ${message}`,
          error instanceof Error
            ? error.stack
            : undefined,
          {
            deviceState: 'ERROR',
            generation
          }
        );

        finish(false);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Disconnect
  // ---------------------------------------------------------------------------

  public async disconnect(): Promise<void> {
    this.connectionGeneration++;

    this.connectPromiseActive = false;

    this.stopHeartbeat();

    this.clearPendingResolvers();

    this.rxBuffer = new Uint8Array(0);

    if (this.config.isMockMode) {
      mockEcuServer.stop();
    }

    this.cleanupSocket();

    this.setStatus('DISCONNECTED');
  }

  private cleanupSocket() {
    const socket = this.socket;

    this.socket = null;

    if (!socket) {
      return;
    }

    try {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
    } catch {}

    try {
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // Raw TX
  // ---------------------------------------------------------------------------

  public async sendRaw(
    data: Uint8Array | number[]
  ): Promise<boolean> {
    const byteArr =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(data);

    if (byteArr.length === 0) {
      return false;
    }

    if (this.config.isMockMode) {
      return true;
    }

    if (
      this.status !== 'CONNECTED' ||
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      AppLogger.warn(
        'NETWORK',
        'WifiSendRaw',
        'Cannot send data: Wi-Fi TCP disconnected',
        'لا يمكن إرسال البيانات: اتصال Wi-Fi TCP غير متصل'
      );

      return false;
    }

    const socket = this.socket;

    try {
      socket.send(byteArr.buffer);

      const hex = Array.from(byteArr)
        .map(b =>
          b.toString(16)
            .padStart(2, '0')
            .toUpperCase()
        )
        .join(' ');

      commLogger.logPacket({
        direction: '[WiFi TX]',
        protocol: 'Binary Frame',
        requestRaw: hex,
        durationMs: 0,
        status: 'SUCCESS'
      });

      return true;

    } catch (error: any) {
      AppLogger.error(
        'NETWORK',
        'WifiSendRawError',
        `Wi-Fi send failed: ${error?.message || 'Unknown error'}`,
        `فشل إرسال البيانات عبر Wi-Fi: ${error?.message || 'خطأ غير معروف'}`,
        error instanceof Error
          ? error.stack
          : undefined
      );

      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // CAN TX
  // ---------------------------------------------------------------------------

  public async sendCanFrame(
    canId: number,
    data: number[],
    isExtended: boolean = false
  ): Promise<boolean> {
    if (!Number.isInteger(canId)) {
      return false;
    }

    const normalizedData = Array.isArray(data)
      ? data.map(byte => byte & 0xFF)
      : [];

    if (normalizedData.length > 8) {
      AppLogger.warn(
        'CAN',
        'WifiCanTxDlc',
        `CAN 2.0 frame cannot contain ${normalizedData.length} bytes`,
        `إطار CAN 2.0 لا يمكن أن يحتوي على ${normalizedData.length} بايت`
      );

      return false;
    }

    const maxId =
      isExtended
        ? 0x1FFFFFFF
        : 0x7FF;

    if (canId < 0 || canId > maxId) {
      AppLogger.warn(
        'CAN',
        'WifiCanTxId',
        `Invalid CAN ID: 0x${canId.toString(16)}`,
        `معرف CAN غير صالح: 0x${canId.toString(16)}`
      );

      return false;
    }

    const packet = BinaryProtocol.encodeCanFrame(
      canId,
      normalizedData,
      isExtended
    );

    const hexData = normalizedData
      .map(b =>
        b.toString(16)
          .padStart(2, '0')
          .toUpperCase()
      )
      .join(' ');

    const idHex =
      isExtended
        ? `0x${canId
            .toString(16)
            .padStart(8, '0')
            .toUpperCase()}`
        : `0x${canId
            .toString(16)
            .padStart(3, '0')
            .toUpperCase()}`;

    if (this.config.isMockMode) {
      setTimeout(async () => {
        try {
          const responseBytes =
            await mockEcuServer.handleRequest(
              normalizedData
            );

          if (
            !responseBytes ||
            responseBytes.length === 0
          ) {
            return;
          }

          const respHex = responseBytes
            .map(b =>
              b.toString(16)
                .padStart(2, '0')
                .toUpperCase()
            )
            .join(' ');

          const respId =
            canId === 0x7DF ||
            canId === 0x7E0
              ? '0x7E8'
              : '0x7E9';

          const mockRxFrame: CanFrame = {
            id: respId,
            dlc: Math.min(
              responseBytes.length,
              8
            ),
            dataHex: respHex,
            dataBytes: responseBytes.slice(0, 8),
            direction: 'Rx',
            isExtended: false,
            description: 'Simulated ECU Response'
          };

          commLogger.logPacket({
            direction: '[WiFi RX]',
            protocol: 'CAN 11-bit',
            canIdHex: respId,
            responseRaw: respHex,
            durationMs: 25,
            status:
              responseBytes[0] === 0x7F
                ? 'NRC'
                : 'SUCCESS'
          });

          /*
           * IMPORTANT:
           * Do NOT call canManager.addFrame() here.
           *
           * TransportManager owns CAN frame insertion.
           */
          this.canFrameListeners.forEach(listener => {
            try {
              listener(mockRxFrame);
            } catch (error) {
              console.error(
                '[WifiTcpTransport] CAN listener error:',
                error
              );
            }
          });

        } catch (error) {
          console.error(
            '[WifiTcpTransport] Mock CAN response error:',
            error
          );
        }
      }, 30);

      return true;
    }

    const sent = await this.sendRaw(packet);

    if (!sent) {
      return false;
    }

    commLogger.logPacket({
      direction: '[WiFi TX]',
      protocol:
        isExtended
          ? 'CAN 29-bit'
          : 'CAN 11-bit',
      canIdHex: idHex,
      requestRaw: hexData,
      durationMs: 0,
      status: 'SUCCESS'
    });

    /*
     * IMPORTANT:
     * No canManager.addFrame() here.
     *
     * TransportManager receives/records TX centrally.
     */

    return true;
  }

  // ---------------------------------------------------------------------------
  // Ping
  // ---------------------------------------------------------------------------

  public async ping(): Promise<PingResult> {
    const startTime = performance.now();

    if (this.config.isMockMode) {
      await new Promise(resolve =>
        setTimeout(resolve, 20)
      );

      return {
        success: true,
        latencyMs: Math.round(
          performance.now() - startTime
        ),
        canReady: true,
        uptimeMs: 124500,
        freeHeapBytes: 184500,
        info: 'ESP32 Wi-Fi Ready (Mock)'
      };
    }

    if (!this.isConnected()) {
      return {
        success: false,
        latencyMs: 0,
        info: 'ESP32 Wi-Fi Not Connected'
      };
    }

    if (this.pingResolver) {
      return {
        success: false,
        latencyMs: 0,
        info: 'Ping request already pending'
      };
    }

    return new Promise(resolve => {
      const pingPacket =
        BinaryProtocol.encodePing();

      const txHex = Array.from(pingPacket)
        .map(b =>
          b.toString(16)
            .padStart(2, '0')
            .toUpperCase()
        )
        .join(' ');

      const pingTimeout = setTimeout(() => {
        if (this.pingResolver) {
          this.pingResolver = null;
        }

        resolve({
          success: false,
          latencyMs: Math.round(
            performance.now() - startTime
          ),
          info: 'Ping Timeout',
          txHex
        });
      }, 2000);

      this.pingResolver = (res) => {
        clearTimeout(pingTimeout);

        this.pingResolver = null;

        resolve({
          ...res,
          latencyMs: Math.round(
            performance.now() - startTime
          ),
          txHex
        });
      };

      this.sendRaw(pingPacket).then(sent => {
        if (sent) {
          return;
        }

        clearTimeout(pingTimeout);

        this.pingResolver = null;

        resolve({
          success: false,
          latencyMs: Math.round(
            performance.now() - startTime
          ),
          info: 'Ping Send Failed',
          txHex
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // CAN Status
  // ---------------------------------------------------------------------------

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
        messagesSent: 0,
        messagesReceived: 0
      };
    }

    if (!this.isConnected()) {
      return null;
    }

    if (this.canStatusResolver) {
      return null;
    }

    return new Promise(resolve => {
      const statusTimeout = setTimeout(() => {
        this.canStatusResolver = null;
        resolve(null);
      }, 2000);

      this.canStatusResolver = status => {
        clearTimeout(statusTimeout);

        this.canStatusResolver = null;

        resolve(status);
      };

      const reqPacket =
        BinaryProtocol.encodeCanStatusReq();

      this.sendRaw(reqPacket).then(sent => {
        if (sent) {
          return;
        }

        clearTimeout(statusTimeout);

        this.canStatusResolver = null;

        resolve(null);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Incoming data
  // ---------------------------------------------------------------------------

  private handleIncomingData(
    data: ArrayBuffer | string
  ) {
    let newBytes: Uint8Array;

    if (typeof data === 'string') {
      /*
       * WebSocket should normally be configured for binary data.
       *
       * If a server nevertheless sends text, preserve the text bytes.
       */
      const encoder = new TextEncoder();
      newBytes = encoder.encode(data);
    } else {
      newBytes = new Uint8Array(data);
    }

    if (newBytes.length === 0) {
      return;
    }

    /*
     * Raw-data subscribers receive the actual received bytes.
     */
    const rawCopy = new Uint8Array(newBytes);

    this.dataListeners.forEach(listener => {
      try {
        listener(rawCopy);
      } catch (error) {
        console.error(
          '[WifiTcpTransport] Data listener error:',
          error
        );
      }
    });

    /*
     * Append to binary streaming buffer.
     */
    const merged = new Uint8Array(
      this.rxBuffer.length +
      newBytes.length
    );

    merged.set(this.rxBuffer, 0);
    merged.set(newBytes, this.rxBuffer.length);

    this.rxBuffer = merged;

    /*
     * Parse BinaryProtocol.
     */
    const result =
      BinaryProtocol.parseStream(
        this.rxBuffer
      );

    this.rxBuffer =
      result.remainingBuffer;

    if (result.packets.length > 0) {
      result.packets.forEach(packet => {
        this.processDecodedPacket(packet);
      });

      /*
       * If binary packets were found, DO NOT run ASCII
       * parsing on the remaining buffer blindly.
       *
       * The remaining bytes may simply be the beginning
       * of the next binary packet.
       */
      return;
    }

    /*
     * Only attempt ASCII parsing when the remaining
     * bytes clearly look like an ASCII ELM-style response.
     */
    if (this.looksLikeAsciiResponse(this.rxBuffer)) {
      this.checkAndParseAsciiLines();
    }
  }

  // ---------------------------------------------------------------------------
  // ASCII fallback
  // ---------------------------------------------------------------------------

  private looksLikeAsciiResponse(
    buffer: Uint8Array
  ): boolean {
    if (buffer.length === 0) {
      return false;
    }

    /*
     * Never treat a BinaryProtocol header as ASCII.
     */
    if (
      buffer.length >= 2 &&
      buffer[0] === 0xAA &&
      buffer[1] === 0x55
    ) {
      return false;
    }

    let printable = 0;

    for (let i = 0; i < buffer.length; i++) {
      const b = buffer[i];

      if (
        b === 0x0A ||
        b === 0x0D ||
        b === 0x3E ||
        (b >= 0x20 && b <= 0x7E)
      ) {
        printable++;
      }
    }

    return printable === buffer.length;
  }

  private checkAndParseAsciiLines() {
    if (this.rxBuffer.length === 0) {
      return;
    }

    /*
     * Find a complete ELM-style line first.
     *
     * Do NOT clear the entire buffer if the line is incomplete.
     */
    let delimiterIndex = -1;

    for (
      let i = 0;
      i < this.rxBuffer.length;
      i++
    ) {
      const byte = this.rxBuffer[i];

      if (
        byte === 0x0D ||
        byte === 0x0A ||
        byte === 0x3E
      ) {
        delimiterIndex = i;
        break;
      }
    }

    if (delimiterIndex < 0) {
      return;
    }

    const lineBytes =
      this.rxBuffer.slice(
        0,
        delimiterIndex
      );

    const remaining =
      this.rxBuffer.slice(
        delimiterIndex + 1
      );

    this.rxBuffer = remaining;

    let line = '';

    for (const byte of lineBytes) {
      line += String.fromCharCode(byte);
    }

    line = line.trim();

    if (line.length === 0) {
      /*
       * There may be another complete line after it.
       */
      if (this.rxBuffer.length > 0) {
        this.checkAndParseAsciiLines();
      }

      return;
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
      if (this.rxBuffer.length > 0) {
        this.checkAndParseAsciiLines();
      }

      return;
    }

    const hexBytes: number[] = [];

    for (
      let i = 0;
      i < cleanHex.length;
      i += 2
    ) {
      const value =
        parseInt(
          cleanHex.substring(i, i + 2),
          16
        );

      if (!Number.isNaN(value)) {
        hexBytes.push(value);
      }
    }

    if (hexBytes.length === 0) {
      return;
    }

    /*
     * Standard OBD response modes:
     *
     * 41 = Mode 01 response
     * 43 = Mode 03 response
     * 44 = Mode 04 response
     * 47 = Mode 07 response
     * 4A = Mode 0A response
     * 7F = Negative response
     *
     * 59 is Mode 19/UDS-style data seen in some
     * gateway/diagnostic contexts.
     */
    const modeByte = hexBytes[0];

    const isDiagnosticResponse =
      modeByte === 0x41 ||
      modeByte === 0x43 ||
      modeByte === 0x44 ||
      modeByte === 0x47 ||
      modeByte === 0x4A ||
      modeByte === 0x59 ||
      modeByte === 0x7F;

    if (isDiagnosticResponse) {
      const dataHex = hexBytes
        .map(byte =>
          byte.toString(16)
            .padStart(2, '0')
            .toUpperCase()
        )
        .join(' ');

      const frame: CanFrame = {
        id: '0x7E8',
        dlc: Math.min(
          hexBytes.length,
          8
        ),
        dataHex,
        dataBytes: hexBytes.slice(0, 8),
        direction: 'Rx',
        isExtended: false,
        description: 'ELM ASCII Response'
      };

      commLogger.logPacket({
        direction: '[ELM-WIFI-ASCII-RX]',
        protocol: 'ELM327 ASCII',
        canIdHex: frame.id,
        responseRaw: frame.dataHex,
        durationMs: 0,
        status:
          modeByte === 0x7F
            ? 'NRC'
            : 'SUCCESS'
      });

      /*
       * Central ownership:
       * Transport emits the frame.
       * TransportManager decides whether/how to insert it.
       */
      this.canFrameListeners.forEach(listener => {
        try {
          listener(frame);
        } catch (error) {
          console.error(
            '[WifiTcpTransport] ASCII CAN listener error:',
            error
          );
        }
      });
    }

    /*
     * Process additional complete ASCII lines.
     */
    if (this.rxBuffer.length > 0) {
      this.checkAndParseAsciiLines();
    }
  }

  // ---------------------------------------------------------------------------
  // K-Line
  // ---------------------------------------------------------------------------

  public onKlinePacket(
    callback: (pkt: DecodedBinaryPacket) => void
  ): () => void {
    this.klinePacketListeners.push(callback);

    return () => {
      this.klinePacketListeners =
        this.klinePacketListeners.filter(
          listener => listener !== callback
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
    if (this.config.isMockMode) {
      return {
        success: true,
        activeProtocol:
          protocolId ?? 0x06,
        keyByte1: 0x8F,
        keyByte2: 0xEA
      };
    }

    if (!this.isConnected()) {
      return {
        success: false,
        activeProtocol: 0,
        keyByte1: 0,
        keyByte2: 0
      };
    }

    if (this.klineInitResolver) {
      return {
        success: false,
        activeProtocol: 0,
        keyByte1: 0,
        keyByte2: 0
      };
    }

    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        this.klineInitResolver = null;

        resolve({
          success: false,
          activeProtocol: 0,
          keyByte1: 0,
          keyByte2: 0
        });
      }, 3000);

      this.klineInitResolver = res => {
        clearTimeout(timeout);

        this.klineInitResolver = null;

        resolve(res);
      };

      const packet =
        BinaryProtocol.encodeKlineInit(
          protocolId
        );

      this.sendRaw(packet).then(sent => {
        if (sent) {
          return;
        }

        clearTimeout(timeout);

        this.klineInitResolver = null;

        resolve({
          success: false,
          activeProtocol: 0,
          keyByte1: 0,
          keyByte2: 0
        });
      });
    });
  }

  public async sendKlineFrame(
    payload: number[]
  ): Promise<{
    status: number;
    data: number[];
  }> {
    if (!Array.isArray(payload)) {
      return {
        status: 0x04,
        data: []
      };
    }

    if (this.config.isMockMode) {
      if (
        payload.length >= 2 &&
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
          (payload[0] ?? 0) + 0x40,
          payload[1] ?? 0x00,
          0x00,
          0x00
        ]
      };
    }

    if (!this.isConnected()) {
      return {
        status: 0x04,
        data: []
      };
    }

    if (this.klineFrameResolver) {
      return {
        status: 0x04,
        data: []
      };
    }

    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        this.klineFrameResolver = null;

        resolve({
          status: 0x04,
          data: []
        });
      }, 2500);

      this.klineFrameResolver = res => {
        clearTimeout(timeout);

        this.klineFrameResolver = null;

        resolve(res);
      };

      const packet =
        BinaryProtocol.encodeKlineFrame(
          payload
        );

      this.sendRaw(packet).then(sent => {
        if (sent) {
          return;
        }

        clearTimeout(timeout);

        this.klineFrameResolver = null;

        resolve({
          status: 0x04,
          data: []
        });
      });
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

    if (!this.isConnected()) {
      return null;
    }

    if (this.klineStatusResolver) {
      return null;
    }

    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        this.klineStatusResolver = null;
        resolve(null);
      }, 2000);

      this.klineStatusResolver = status => {
        clearTimeout(timeout);

        this.klineStatusResolver = null;

        resolve(status);
      };

      const packet =
        BinaryProtocol.encodeKlineStatusReq();

      this.sendRaw(packet).then(sent => {
        if (sent) {
          return;
        }

        clearTimeout(timeout);

        this.klineStatusResolver = null;

        resolve(null);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Binary packet processing
  // ---------------------------------------------------------------------------

  private processDecodedPacket(
    pkt: DecodedBinaryPacket
  ) {
    /*
     * Notify generic packet listeners first.
     */
    const packetListeners =
      [...this.klinePacketListeners];

    packetListeners.forEach(listener => {
      try {
        listener(pkt);
      } catch (error) {
        console.error(
          '[WifiTcpTransport] Packet listener error:',
          error
        );
      }
    });

    // -------------------------------------------------------------------------
    // CAN RX
    // -------------------------------------------------------------------------

    if (
      pkt.cmd === BinaryCommand.CMD_CAN_FRAME &&
      pkt.canFrame
    ) {
      const frame = pkt.canFrame;

      commLogger.logPacket({
        direction: '[WiFi RX]',
        protocol:
          frame.isExtended
            ? 'CAN 29-bit'
            : 'CAN 11-bit',
        canIdHex: frame.id,
        responseRaw: frame.dataHex,
        durationMs: 0,
        status: 'SUCCESS'
      });

      /*
       * CRITICAL:
       *
       * DO NOT call:
       *
       *   canManager.addFrame(frame)
       *
       * here.
       *
       * TransportManager is the single CAN insertion owner.
       */
      this.canFrameListeners.forEach(listener => {
        try {
          listener(frame);
        } catch (error) {
          console.error(
            '[WifiTcpTransport] CAN RX listener error:',
            error
          );
        }
      });

      return;
    }

    // -------------------------------------------------------------------------
    // PONG
    // -------------------------------------------------------------------------

    if (
      pkt.cmd === BinaryCommand.CMD_PONG &&
      pkt.pongInfo
    ) {
      if (this.pingResolver) {
        const rxHex =
          Array.from(pkt.rawFrame)
            .map(b =>
              b.toString(16)
                .padStart(2, '0')
                .toUpperCase()
            )
            .join(' ');

        this.pingResolver({
          success: true,
          latencyMs: 0,
          canReady:
            pkt.pongInfo.canReady,
          uptimeMs:
            pkt.pongInfo.uptimeMs,
          freeHeapBytes:
            pkt.pongInfo.freeHeapBytes,
          rxHex,
          info:
            `ESP32 Wi-Fi Up: ` +
            `${(
              pkt.pongInfo.uptimeMs / 1000
            ).toFixed(1)}s | ` +
            `Heap: ` +
            `${(
              pkt.pongInfo.freeHeapBytes / 1024
            ).toFixed(0)}KB`
        });
      }

      return;
    }

    // -------------------------------------------------------------------------
    // CAN STATUS
    // -------------------------------------------------------------------------

    if (
      pkt.cmd ===
        BinaryCommand.CMD_CAN_STATUS_RESP &&
      pkt.canStatus
    ) {
      if (this.canStatusResolver) {
        this.canStatusResolver(
          pkt.canStatus
        );
      }

      return;
    }

    // -------------------------------------------------------------------------
    // K-Line INIT
    // -------------------------------------------------------------------------

    if (
      pkt.cmd ===
        BinaryCommand.CMD_KLINE_INIT_RESP &&
      pkt.klineInitResult
    ) {
      commLogger.logPacket({
        direction: '[KLINE RX]',
        protocol:
          pkt.klineInitResp?.activeProtocol ||
          'K-LINE',
        decodedData: 'KLINE_INIT',
        responseRaw:
          `Status=${
            pkt.klineInitResult.success
              ? 'SUCCESS'
              : 'FAILED'
          } ` +
          `KB1=0x${
            pkt.klineInitResult.keyByte1
              .toString(16)
              .padStart(2, '0')
              .toUpperCase()
          } ` +
          `KB2=0x${
            pkt.klineInitResult.keyByte2
              .toString(16)
              .padStart(2, '0')
              .toUpperCase()
          }`,
        durationMs: 0,
        status:
          pkt.klineInitResult.success
            ? 'SUCCESS'
            : 'ERROR'
      });

      if (this.klineInitResolver) {
        this.klineInitResolver(
          pkt.klineInitResult
        );
      }

      return;
    }

    // -------------------------------------------------------------------------
    // K-Line FRAME
    // -------------------------------------------------------------------------

    if (
      pkt.cmd ===
        BinaryCommand.CMD_KLINE_FRAME &&
      pkt.klineFrameResult
    ) {
      commLogger.logPacket({
        direction: '[KLINE RX]',
        protocol: 'K-LINE',
        decodedData: 'KLINE_FRAME',
        responseRaw:
          pkt.klineFrame?.rawHex || '',
        durationMs: 0,
        status:
          pkt.klineFrameResult.status === 0
            ? 'SUCCESS'
            : 'ERROR'
      });

      if (this.klineFrameResolver) {
        this.klineFrameResolver(
          pkt.klineFrameResult
        );
      }

      return;
    }

    // -------------------------------------------------------------------------
    // K-Line STATUS
    // -------------------------------------------------------------------------

    if (
      pkt.cmd ===
        BinaryCommand.CMD_KLINE_STATUS_RESP &&
      pkt.klineStatus
    ) {
      if (this.klineStatusResolver) {
        this.klineStatusResolver(
          pkt.klineStatus
        );
      }

      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  private startHeartbeat(
    generation: number = this.connectionGeneration
  ) {
    this.stopHeartbeat();

    this.heartbeatInterval =
      setInterval(() => {
        if (
          generation !==
          this.connectionGeneration
        ) {
          return;
        }

        if (
          !this.isConnected() ||
          this.config.isMockMode
        ) {
          return;
        }

        const pingPacket =
          BinaryProtocol.encodePing();

        this.sendRaw(pingPacket)
          .catch(() => {});
      }, 5000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval !== null) {
      clearInterval(
        this.heartbeatInterval
      );

      this.heartbeatInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Pending request cleanup
  // ---------------------------------------------------------------------------

  private clearPendingResolvers() {
    this.pingResolver = null;
    this.canStatusResolver = null;
    this.klineInitResolver = null;
    this.klineStatusResolver = null;
    this.klineFrameResolver = null;
  }
}
