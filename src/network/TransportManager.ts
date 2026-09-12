/**
 * HAMZA OBD PRO - Unified Transport Manager
 *
 * Responsibilities:
 * - Select and control Wi-Fi TCP / Bluetooth SPP transport.
 * - Own the single RX -> canManager path.
 * - Handle OBD-II over CAN.
 * - Handle ISO-TP segmentation/reassembly.
 * - Handle basic UDS/OBD diagnostic responses.
 * - Handle K-Line routing.
 *
 * Architecture:
 *
 * ESP32
 *   ↓
 * BinaryProtocol
 *   ↓
 * WifiTcpTransport / BluetoothSppTransport
 *   ↓
 * onCanFrame()
 *   ↓
 * TransportManager
 *   ↓
 * canManager
 *   ↓
 * UI / Diagnostics
 *
 * IMPORTANT:
 * Transports must NOT call canManager.addFrame().
 * TransportManager is the single owner of CAN RX insertion.
 */

import {
  ConnectionConfig,
  ConnectionStatus,
  CanFrame,
  CanBusStatus,
  TransportType,
  BluetoothDeviceInfo,
  CommunicationPacket
} from '../types';

import {
  ITransport,
  PingResult,
  defaultConnectionConfig
} from './Transport';

import { WifiTcpTransport } from './WifiTcpTransport';
import { BluetoothSppTransport } from './BluetoothSppTransport';

import {
  commLogger,
  AppLogger
} from '../logging/logger';

import { canManager } from '../can/canManager';

import {
  IsoTpProtocol,
  IsoTpFrameType,
  FlowStatus
} from '../isotp/isoTpProtocol';


interface AuditFrame {
  direction: 'TX' | 'RX';
  id: number;
  data: number[];
  timestamp: number;
  type?: string;
}


interface PendingDiagnosticRequest {
  resolve: (data: {
    payload: number[];
    auditFrames: AuditFrame[];
  }) => void;

  reject: (err: Error) => void;

  canId: number;

  requestBytes: number[];

  expectedResponseId?: number;

  actualResponseId?: number;

  timer: ReturnType<typeof setTimeout>;

  isoTpTimer?: ReturnType<typeof setTimeout>;

  correlationId: string;

  isExtended: boolean;

  auditFrames: AuditFrame[];

  // RX ISO-TP state
  isoTpBuffer?: {
    totalLength: number;
    receivedBytes: number[];
    expectedSequence: number;
  };

  // TX ISO-TP state
  txState?: {
    remainingBytes: number[];
    nextSequence: number;
    blockSize: number;
    stMin: number;
    framesInBlock: number;
  };
}


export interface DiagnosticResult {
  status: 'SUCCESS' | 'TIMEOUT' | 'ERROR' | 'NRC';

  responseRaw?: string;

  data?: number[];

  auditFrames?: AuditFrame[];
}


export class TransportManager {

  private config: ConnectionConfig;

  private wifiTransport: WifiTcpTransport;

  private btTransport: BluetoothSppTransport;

  private activeTransport: ITransport;

  private statusListeners: Array<
    (status: ConnectionStatus, type: TransportType) => void
  > = [];

  private sequenceId = 0;

  private pendingRequests: {
    [seq: number]: PendingDiagnosticRequest;
  } = {};

  /**
   * Diagnostic requests are strictly serialized.
   */
  private requestQueue: Promise<void> = Promise.resolve();


  constructor(initialConfig: ConnectionConfig) {

    this.config = initialConfig;

    this.wifiTransport = new WifiTcpTransport(this.config);

    this.btTransport = new BluetoothSppTransport(this.config);


    this.activeTransport =
      this.config.transportType === 'BLUETOOTH_SPP'
        ? this.btTransport
        : this.wifiTransport;


    console.log(
      `[MANAGER] Active Transport: ${this.activeTransport.type}`
    );


    /*
     * Wi-Fi state listener
     */
    this.wifiTransport.onStateChange((state) => {

      if (this.activeTransport.type !== 'WIFI_TCP') {
        return;
      }

      console.log(
        `[MANAGER] Wi-Fi Transport State Change: ${state}`
      );

      this.notifyStatus(state);
    });


    /*
     * Bluetooth state listener
     */
    this.btTransport.onStateChange((state, error) => {

      if (this.activeTransport.type !== 'BLUETOOTH_SPP') {
        return;
      }

      console.log(
        `[MANAGER] BT SPP Transport State Change: ${state}` +
        ` (Error: ${error || 'none'})`
      );

      this.notifyStatus(state);
    });


    /*
     * SINGLE CAN RX OWNER
     *
     * Transports only decode and emit CanFrame.
     * This function inserts the RX frame into canManager.
     */
    const handleCanFrame = (frame: CanFrame) => {

      /*
       * Validate the incoming frame before touching
       * diagnostic matching or UI storage.
       */
      const frameIdNum = this.parseCanId(frame.id);

      if (frameIdNum === null) {
        console.warn(
          `[TM-CAN-RX] Invalid CAN ID: ${frame.id}`
        );
        return;
      }


      const data = Array.isArray(frame.dataBytes)
        ? frame.dataBytes.map(b => b & 0xFF)
        : [];


      /*
       * SINGLE INSERTION POINT.
       *
       * BluetoothTcp/WiFi transports must NOT insert
       * the same frame again.
       */
      canManager.addFrame({
        ...frame,
        id: `0x${frameIdNum.toString(16).toUpperCase()}`,
        dataBytes: data,
        dataHex: data
          .map(b =>
            b.toString(16)
              .padStart(2, '0')
              .toUpperCase()
          )
          .join(' '),
        dlc: Math.min(
          Number.isFinite(frame.dlc)
            ? frame.dlc
            : data.length,
          8
        )
      });


      /*
       * Nothing to match if there are no diagnostic requests.
       */
      const pendingSeqs = Object.keys(this.pendingRequests);

      if (pendingSeqs.length === 0) {
        return;
      }


      /*
       * Process diagnostic sessions.
       */
      for (const seqNumStr of pendingSeqs) {

        const seq = Number(seqNumStr);

        const req = this.pendingRequests[seq];

        if (!req) {
          continue;
        }


        /*
         * Determine whether this CAN ID belongs
         * to the current diagnostic request.
         */
        const isMatch = this.matchesDiagnosticResponse(
          req,
          frameIdNum
        );


        if (!isMatch) {
          continue;
        }


        /*
         * We need at least enough bytes to inspect
         * ISO-TP PCI.
         */
        if (data.length === 0) {
          continue;
        }


        const pciType =
          data[0] & 0xF0;


        /*
         * Handle Flow Control separately.
         *
         * IMPORTANT:
         * FC is only meaningful while transmitting
         * a multi-frame request.
         */
        if (pciType === IsoTpFrameType.FLOW_CONTROL) {

          if (!req.txState) {
            /*
             * Do not lock actualResponseId for a random FC.
             */
            continue;
          }


          if (data.length < 3) {
            console.warn(
              `[ISO-TP] Invalid Flow Control frame`
            );
            continue;
          }


          req.actualResponseId = frameIdNum;


          req.auditFrames.push({
            direction: 'RX',
            id: frameIdNum,
            data: [...data],
            timestamp: Date.now(),
            type: 'ISO-TP FC'
          });


          this.handleFlowControl(
            req,
            frameIdNum,
            data,
            seq
          );

          /*
           * A single FC belongs to one diagnostic request.
           */
          break;
        }


        /*
         * Consecutive Frame belongs only to an
         * already established RX ISO-TP session.
         */
        if (
          pciType === IsoTpFrameType.CONSECUTIVE_FRAME
        ) {

          if (!req.isoTpBuffer) {
            continue;
          }


          if (data.length < 2) {
            continue;
          }


          req.actualResponseId = frameIdNum;


          req.auditFrames.push({
            direction: 'RX',
            id: frameIdNum,
            data: [...data],
            timestamp: Date.now(),
            type: 'ISO-TP CF'
          });


          this.handleConsecutiveFrame(
            req,
            frameIdNum,
            data,
            seq
          );

          break;
        }


        /*
         * A diagnostic response must start as
         * Single Frame or First Frame.
         */
        if (
          pciType !== IsoTpFrameType.SINGLE_FRAME &&
          pciType !== IsoTpFrameType.FIRST_FRAME
        ) {
          continue;
        }


        /*
         * Validate the diagnostic payload before
         * locking actualResponseId.
         *
         * This prevents an unrelated frame with the
         * same CAN ID from becoming the session response ID.
         */
        const payloadStart =
          this.extractInitialIsoTpPayload(
            data,
            pciType
          );


        if (payloadStart.length === 0) {
          continue;
        }


        const validation =
          this.validateDiagnosticStart(
            req.requestBytes,
            payloadStart
          );


        if (!validation.valid) {

          /*
           * Negative Response 0x7F is valid even though
           * it does not equal request SID + 0x40.
           */
          if (payloadStart[0] !== 0x7F) {

            console.warn(
              `[TM-CAN-RX] Ignoring mismatched diagnostic response ` +
              `ID=0x${frameIdNum.toString(16).toUpperCase()} ` +
              `PAYLOAD=${payloadStart
                .map(b =>
                  b.toString(16)
                    .padStart(2, '0')
                    .toUpperCase()
                )
                .join(' ')}`
            );

            continue;
          }
        }


        /*
         * Response is now confirmed.
         */
        req.actualResponseId = frameIdNum;


        req.auditFrames.push({
          direction: 'RX',
          id: frameIdNum,
          data: [...data],
          timestamp: Date.now(),
          type:
            pciType === IsoTpFrameType.SINGLE_FRAME
              ? 'ISO-TP SF'
              : 'ISO-TP FF'
        });


        /*
         * Single Frame
         */
        if (
          pciType === IsoTpFrameType.SINGLE_FRAME
        ) {

          this.handleSingleFrame(
            req,
            frameIdNum,
            data,
            seq
          );

          break;
        }


        /*
         * First Frame
         */
        if (
          pciType === IsoTpFrameType.FIRST_FRAME
        ) {

          this.handleFirstFrame(
            req,
            frameIdNum,
            data,
            seq
          );

          break;
        }
      }
    };


    /*
     * Both transports emit to the SAME manager.
     *
     * The active transport is selected for sending,
     * but both listeners are kept for receiving.
     */
    this.wifiTransport.onCanFrame(handleCanFrame);

    this.btTransport.onCanFrame(handleCanFrame);
  }


  private notifyStatus(status: ConnectionStatus) {

    for (const listener of this.statusListeners) {
      listener(
        status,
        this.activeTransport.type
      );
    }
  }


  /**
   * Parse a CAN ID safely.
   */
  private parseCanId(id: string | number): number | null {

    if (typeof id === 'number') {

      if (
        !Number.isInteger(id) ||
        id < 0 ||
        id > 0x1FFFFFFF
      ) {
        return null;
      }

      return id >>> 0;
    }


    const normalized =
      id
        .trim()
        .replace(/^0x/i, '');


    if (!/^[0-9a-fA-F]+$/.test(normalized)) {
      return null;
    }


    const value =
      parseInt(normalized, 16);


    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value > 0x1FFFFFFF
    ) {
      return null;
    }


    return value >>> 0;
  }


  /**
   * Determine whether a CAN response belongs
   * to a diagnostic request.
   *
   * Supports:
   * - 11-bit physical OBD
   * - 11-bit functional OBD
   * - 29-bit physical ISO-TP
   * - 29-bit functional ISO-TP
   */
  private matchesDiagnosticResponse(
    req: PendingDiagnosticRequest,
    responseId: number
  ): boolean {

    if (
      req.actualResponseId !== undefined
    ) {
      return responseId === req.actualResponseId;
    }


    if (!req.isExtended) {

      /*
       * Functional OBD request:
       * 0x7DF -> 0x7E8 ... 0x7EF
       */
      if (req.canId === 0x7DF) {

        return (
          responseId >= 0x7E8 &&
          responseId <= 0x7EF
        );
      }


      /*
       * Physical OBD:
       * 0x7E0 -> 0x7E8
       * 0x7E1 -> 0x7E9
       * ...
       */
      return responseId === req.canId + 8;
    }


    return this.isExtendedMatch(
      req.canId,
      responseId
    );
  }


  /**
   * ISO 15765-4 / OBD 29-bit matching.
   *
   * Examples:
   *
   * Physical:
   *   Request  18DA10F1
   *   Response 18DAF110
   *
   * Functional:
   *   Request  18DB33F1
   *   Response 18DAF110
   *
   * Functional responses can originate from
   * different ECU source addresses.
   */
  private isExtendedMatch(
    reqId: number,
    resId: number
  ): boolean {

    const req = reqId >>> 0;
    const res = resId >>> 0;


    /*
     * ISO-TP 29-bit OBD response uses 18DAxxxx.
     */
    const resPrefix =
      (res >>> 16) & 0xFFFF;


    if (resPrefix !== 0x18DA) {
      return false;
    }


    const reqPrefix =
      (req >>> 16) & 0xFFFF;


    const reqTarget =
      (req >>> 8) & 0xFF;


    const reqSource =
      req & 0xFF;


    const resTarget =
      (res >>> 8) & 0xFF;


    const resSource =
      res & 0xFF;


    /*
     * Functional request:
     *
     * 18DB33F1
     *
     * ECU:
     * 18DAF110
     * 18DAF118
     * etc.
     *
     * Destination is 0xF1.
     */
    if (
      reqPrefix === 0x18DB &&
      reqTarget === 0x33 &&
      reqSource === 0xF1
    ) {

      return resTarget === 0xF1;
    }


    /*
     * Physical request:
     *
     * 18DA10F1 -> 18DAF110
     *
     * Request destination becomes
     * response source.
     *
     * Request source becomes
     * response destination.
     */
    if (
      reqPrefix === 0x18DA
    ) {

      return (
        resTarget === reqSource &&
        resSource === reqTarget
      );
    }


    /*
     * Generic swapped-address fallback.
     */
    return (
      resSource === reqTarget &&
      resTarget === reqSource
    );
  }


  public isConnected(): boolean {
    return (
      this.activeTransport.getState() === 'CONNECTED'
    );
  }


  public getTransport(
    type?: TransportType
  ): ITransport {

    if (type === 'WIFI_TCP') {
      return this.wifiTransport;
    }

    if (type === 'BLUETOOTH_SPP') {
      return this.btTransport;
    }

    return this.activeTransport;
  }


  public subscribeStatus(
    listener: (
      status: ConnectionStatus,
      type: TransportType
    ) => void
  ) {

    this.statusListeners.push(listener);

    return () => {
      this.statusListeners =
        this.statusListeners.filter(
          l => l !== listener
        );
    };
  }


  public updateConfig(
    newConfig: Partial<ConnectionConfig>
  ) {

    this.config = {
      ...this.config,
      ...newConfig
    };


    this.wifiTransport.updateConfig(
      this.config
    );

    this.btTransport.updateConfig(
      this.config
    );


    if (newConfig.transportType) {

      this.activeTransport =
        newConfig.transportType === 'BLUETOOTH_SPP'
          ? this.btTransport
          : this.wifiTransport;


      console.log(
        `[MANAGER] Switched to ${this.activeTransport.type}`
      );


      this.notifyStatus(
        this.activeTransport.getState()
      );
    }
  }


  public getConfig(): ConnectionConfig {
    return this.config;
  }


  public async connect(
    config?: Partial<ConnectionConfig>
  ): Promise<boolean> {

    if (config) {
      this.updateConfig(config);
    }

    return this.activeTransport.connect(
      config
    );
  }


  public async disconnect(): Promise<void> {
    return this.activeTransport.disconnect();
  }


  public async scanBluetoothDevices(
    onDeviceFound?: (
      dev: BluetoothDeviceInfo
    ) => void
  ): Promise<BluetoothDeviceInfo[]> {

    if (this.btTransport.scanDevices) {

      return this.btTransport.scanDevices(
        onDeviceFound
      );
    }

    return [];
  }


  public async ping(): Promise<PingResult> {
    return this.activeTransport.ping();
  }


  /**
   * Check whether configured protocol is K-Line.
   */
  public isKlineProtocol(): boolean {

    const protocol =
      (this.config.protocol || '')
        .toUpperCase();


    return (
      protocol.includes('ISO 9141') ||
      protocol.includes('KWP2000') ||
      protocol.includes('ISO 14230')
    );
  }


  public async initKline(
    protocolId?: number
  ): Promise<{
    success: boolean;
    activeProtocol: number;
    keyByte1: number;
    keyByte2: number;
  }> {

    return this.activeTransport.sendKlineInit(
      protocolId
    );
  }


  public async sendKlineInit(
    protocolId?: number
  ): Promise<{
    success: boolean;
    activeProtocol: number;
    keyByte1: number;
    keyByte2: number;
  }> {

    return this.initKline(protocolId);
  }


  public async sendKlineFrame(
    payload: number[]
  ): Promise<{
    status: number;
    data: number[];
  }> {

    return this.activeTransport.sendKlineFrame(
      payload
    );
  }


  public async getKlineStatus(): Promise<any | null> {
    return this.activeTransport.getKlineStatus();
  }


  /**
   * ECU link test.
   *
   * Order:
   * 1. Explicit K-Line configuration
   * 2. Configured CAN mode
   * 3. CAN fallback
   * 4. K-Line auto initialization
   */
  public async checkCarEcuLink(): Promise<boolean> {

    if (!this.isConnected()) {
      return false;
    }


    try {

      /*
       * Explicit K-Line configuration.
       */
      if (this.isKlineProtocol()) {

        console.log(
          `[TM] Checking ECU Link on K-Line ` +
          `protocol (${this.config.protocol})...`
        );


        const klineResp =
          await this.activeTransport.sendKlineFrame?.(
            [0x01, 0x00]
          );


        if (
          klineResp &&
          klineResp.status === 0 &&
          klineResp.data.length > 0
        ) {

          console.log(
            `[TM] K-Line ECU Link SUCCESS:`,
            klineResp.data
          );

          return true;
        }
      }


      /*
       * CAN configured mode.
       */
      const is29Bit =
        this.config.canMode === '29-bit';


      const targetId =
        is29Bit
          ? '0x18DB33F1'
          : '0x7DF';


      console.log(
        `[TM] Checking ECU Link using ` +
        `${targetId} (${this.config.canMode})...`
      );


      const response =
        await this.sendRequest(
          [0x01, 0x00],
          targetId
        );


      if (
        response.status === 'SUCCESS' ||
        response.status === 'NRC'
      ) {

        console.log(
          `[TM] ECU Link SUCCESS with ${targetId}`
        );

        return true;
      }


      /*
       * CAN fallback.
       */
      const fallbackId =
        is29Bit
          ? '0x7DF'
          : '0x18DB33F1';


      console.log(
        `[TM] ECU link failed with ${targetId}. ` +
        `Trying fallback ${fallbackId}...`
      );


      const fallbackResponse =
        await this.sendRequest(
          [0x01, 0x00],
          fallbackId
        );


      if (
        fallbackResponse.status === 'SUCCESS' ||
        fallbackResponse.status === 'NRC'
      ) {

        console.log(
          `[TM] ECU Link SUCCESS with fallback ` +
          `${fallbackId}`
        );


        this.updateConfig({
          canMode:
            is29Bit
              ? '11-bit'
              : '29-bit'
        });


        return true;
      }


      /*
       * K-Line auto fallback.
       */
      console.log(
        `[TM] CAN ECU link failed. ` +
        `Trying K-Line auto-init fallback...`
      );


      const klineInit =
        await this.initKline(0x00);


      if (klineInit.success) {

        console.log(
          `[TM] K-Line Auto-Init SUCCESS! ` +
          `Protocol 0x${klineInit.activeProtocol
            .toString(16)
            .toUpperCase()}`
        );


        const newProto =
          klineInit.activeProtocol === 0x06
            ? 'ISO 14230-4 (KWP2000 Fast)'
            : 'ISO 9141-2';


        this.updateConfig({
          protocol: newProto
        });


        return true;
      }


      return false;

    } catch (err) {

      console.warn(
        '[TM] Car ECU link check failed:',
        err
      );

      return false;
    }
  }


  /**
   * Real battery voltage using OBD-II PID 42.
   *
   * 11-bit:
   *   7DF
   *
   * 29-bit:
   *   18DB33F1
   */
  public async getBatteryVoltage(): Promise<number> {

    if (!this.isConnected()) {
      return 0.0;
    }


    try {

      const targetId =
        this.config.canMode === '29-bit'
          ? '0x18DB33F1'
          : '0x7DF';


      const response =
        await this.sendRequest(
          [0x01, 0x42],
          targetId
        );


      if (
        response.status === 'SUCCESS' &&
        response.responseRaw
      ) {

        const bytes =
          response.responseRaw
            .split(/\s+/)
            .map(h =>
              parseInt(h, 16)
            )
            .filter(n =>
              Number.isFinite(n)
            );


        /*
         * 41 42 A B
         */
        if (
          bytes.length >= 4 &&
          bytes[0] === 0x41 &&
          bytes[1] === 0x42
        ) {

          const a = bytes[2];

          const b = bytes[3];

          const voltage =
            ((a * 256) + b) / 1000.0;


          if (
            Number.isFinite(voltage) &&
            voltage > 0 &&
            voltage < 100
          ) {

            return Number(
              voltage.toFixed(2)
            );
          }
        }
      }


      return 0.0;

    } catch (err) {

      console.warn(
        '[TM] Failed to fetch battery voltage:',
        err
      );

      return 0.0;
    }
  }


  public async getCanStatus(): Promise<CanBusStatus> {
    return this.activeTransport.getCanStatus();
  }


  public setTransportType(
    type: TransportType
  ) {

    this.updateConfig({
      transportType: type
    });
  }


  private cleanupRequest(seq: number) {

    const req =
      this.pendingRequests[seq];


    if (!req) {
      return;
    }


    if (req.timer) {
      clearTimeout(req.timer);
    }


    if (req.isoTpTimer) {
      clearTimeout(req.isoTpTimer);
    }


    delete this.pendingRequests[seq];
  }


  /**
   * Extract the first diagnostic payload bytes
   * from ISO-TP SF/FF.
   */
  private extractInitialIsoTpPayload(
    data: number[],
    pciType: number
  ): number[] {

    if (
      pciType === IsoTpFrameType.SINGLE_FRAME
    ) {

      if (data.length < 2) {
        return [];
      }


      const length =
        data[0] & 0x0F;


      if (
        length <= 0 ||
        length > 7 ||
        data.length < 1 + length
      ) {

        return [];
      }


      return data.slice(
        1,
        1 + Math.min(length, 2)
      );
    }


    if (
      pciType === IsoTpFrameType.FIRST_FRAME
    ) {

      if (data.length < 4) {
        return [];
      }


      return data.slice(2, 4);
    }


    return [];
  }


  /**
   * Validate OBD / UDS response start.
   *
   * OBD:
   *   01 0C -> 41 0C
   *
   * UDS:
   *   22 F1 90 -> 62 F1 90
   *
   * Negative response:
   *   7F <SID> <NRC>
   */
  private validateDiagnosticStart(
    requestBytes: number[],
    payloadStart: number[]
  ): {
    valid: boolean;
    negativeResponse: boolean;
  } {

    if (
      requestBytes.length === 0 ||
      payloadStart.length === 0
    ) {

      return {
        valid: false,
        negativeResponse: false
      };
    }


    /*
     * Negative response.
     */
    if (payloadStart[0] === 0x7F) {

      return {
        valid: true,
        negativeResponse: true
      };
    }


    const requestSid =
      requestBytes[0];


    /*
     * Standard positive response.
     */
    const expectedSid =
      (requestSid + 0x40) & 0xFF;


    if (
      payloadStart[0] !== expectedSid
    ) {

      return {
        valid: false,
        negativeResponse: false
      };
    }


    /*
     * PID/sub-function validation.
     */
    if (requestBytes.length >= 2) {

      if (
        payloadStart.length < 2 ||
        payloadStart[1] !== requestBytes[1]
      ) {

        return {
          valid: false,
          negativeResponse: false
        };
      }
    }


    return {
      valid: true,
      negativeResponse: false
    };
  }


  private handleConsecutiveFrame(
    req: PendingDiagnosticRequest,
    frameIdNum: number,
    data: number[],
    seq: number
  ) {

    if (!req.isoTpBuffer) {

      console.warn(
        `[ISO-TP] Unexpected Consecutive Frame ` +
        `from 0x${frameIdNum
          .toString(16)
          .toUpperCase()}`
      );

      return;
    }


    if (data.length < 2) {
      return;
    }


    if (req.isoTpTimer) {
      clearTimeout(req.isoTpTimer);
      req.isoTpTimer = undefined;
    }


    const cfSeq =
      data[0] & 0x0F;


    if (
      cfSeq !==
      req.isoTpBuffer.expectedSequence
    ) {

      console.error(
        `[ISO-TP-RX] SEQUENCE ERROR: ` +
        `Expected ${req.isoTpBuffer.expectedSequence}, ` +
        `got ${cfSeq}`
      );


      this.cleanupRequest(seq);


      req.reject(
        new Error(
          'ISO_TP_SEQUENCE_MISMATCH'
        )
      );

      return;
    }


    const remaining =
      req.isoTpBuffer.totalLength -
      req.isoTpBuffer.receivedBytes.length;


    const take =
      Math.min(
        7,
        remaining,
        data.length - 1
      );


    for (let i = 0; i < take; i++) {

      req.isoTpBuffer.receivedBytes.push(
        data[1 + i]
      );
    }


    req.isoTpBuffer.expectedSequence =
      (
        req.isoTpBuffer.expectedSequence + 1
      ) & 0x0F;


    /*
     * Complete.
     */
    if (
      req.isoTpBuffer.receivedBytes.length >=
      req.isoTpBuffer.totalLength
    ) {

      const fullPayload =
        req.isoTpBuffer.receivedBytes.slice(
          0,
          req.isoTpBuffer.totalLength
        );


      console.log(
        `[ISO-TP-RX] REASSEMBLY SUCCESS: ` +
        `ID=0x${frameIdNum
          .toString(16)
          .toUpperCase()} ` +
        `LEN=${req.isoTpBuffer.totalLength}`
      );


      const auditFrames =
        [...req.auditFrames];


      this.cleanupRequest(seq);


      req.resolve({
        payload: fullPayload,
        auditFrames
      });


      return;
    }


    /*
     * Wait for next CF.
     */
    req.isoTpTimer =
      setTimeout(() => {

        console.error(
          `[ISO-TP-RX] N_Cr TIMEOUT: ` +
          `Waiting for CF ` +
          `${req.isoTpBuffer?.expectedSequence}`
        );


        this.cleanupRequest(seq);


        req.reject(
          new Error(
            'ISO_TP_N_Cr_TIMEOUT'
          )
        );

      }, 1500);
  }


  private handleSingleFrame(
    req: PendingDiagnosticRequest,
    frameIdNum: number,
    data: number[],
    seq: number
  ) {

    if (data.length < 2) {
      return;
    }


    const sfLength =
      data[0] & 0x0F;


    if (
      sfLength === 0 ||
      sfLength > 7 ||
      sfLength > data.length - 1
    ) {

      console.warn(
        `[ISO-TP] Invalid SF Length: ${sfLength}`
      );

      return;
    }


    const payload =
      data.slice(
        1,
        1 + sfLength
      );


    console.log(
      `[ISO-TP-RX] Single Frame: ` +
      `ID=0x${frameIdNum
        .toString(16)
        .toUpperCase()} ` +
      `Len=${sfLength} ` +
      `Payload=[${payload
        .map(b =>
          b.toString(16)
            .padStart(2, '0')
            .toUpperCase()
        )
        .join(' ')}]`
    );


    const auditFrames =
      [...req.auditFrames];


    this.cleanupRequest(seq);


    req.resolve({
      payload,
      auditFrames
    });
  }


  private handleFirstFrame(
    req: PendingDiagnosticRequest,
    frameIdNum: number,
    data: number[],
    seq: number
  ) {

    if (data.length < 8) {

      console.error(
        `[ISO-TP-RX] Invalid First Frame DLC`
      );

      return;
    }


    const totalLength =
      (
        (data[0] & 0x0F) << 8
      ) |
      data[1];


    if (
      totalLength <= 7 ||
      totalLength > 4095
    ) {

      console.error(
        `[ISO-TP-RX] INVALID FF LENGTH: ${totalLength}`
      );


      this.cleanupRequest(seq);


      req.reject(
        new Error(
          'ISO_TP_INVALID_FF_LENGTH'
        )
      );

      return;
    }


    console.log(
      `[ISO-TP-RX] FIRST FRAME RECEIVED: ` +
      `ID=0x${frameIdNum
        .toString(16)
        .toUpperCase()} ` +
      `TotalLen=${totalLength}`
    );


    const initialData =
      data.slice(2, 8);


    req.isoTpBuffer = {
      totalLength,
      receivedBytes: [...initialData],
      expectedSequence: 1
    };


    const fcTargetId =
      this.resolveIsoTpFlowControlId(
        req.canId,
        frameIdNum,
        req.isExtended
      );


    if (fcTargetId === null) {

      console.error(
        `[ISO-TP] ADDRESSING ERROR: ` +
        `Cannot resolve FC ID for ` +
        `0x${frameIdNum
          .toString(16)
          .toUpperCase()}`
      );


      this.cleanupRequest(seq);


      req.reject(
        new Error(
          'ISO_TP_FC_ID_RESOLUTION_FAILED'
        )
      );

      return;
    }


    /*
     * Start N_Cr/N_Br protection.
     */
    if (req.isoTpTimer) {
      clearTimeout(req.isoTpTimer);
    }


    req.isoTpTimer =
      setTimeout(() => {

        console.error(
          `[ISO-TP-RX] N_Cr TIMEOUT: ` +
          `Waiting for first CF`
        );


        this.cleanupRequest(seq);


        req.reject(
          new Error(
            'ISO_TP_N_Cr_TIMEOUT'
          )
        );

      }, 1500);


    /*
     * Flow Control:
     *
     * FS = CTS
     * BS = 0 => unlimited
     * STmin = 0
     */
    const fcFrame = [
      0x30,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00
    ];


    console.log(
      `[ISO-TP-TX] SENDING FLOW CONTROL: ` +
      `TARGET=0x${fcTargetId
        .toString(16)
        .toUpperCase()}`
    );


    /*
     * DO NOT insert into canManager before
     * actual transmission succeeds.
     */
    this.activeTransport
      .sendCanFrame(
        fcTargetId,
        fcFrame,
        req.isExtended
      )
      .then((ok) => {

        if (!ok) {

          console.error(
            `[ISO-TP-TX] FC SEND FAILED`
          );


          this.cleanupRequest(seq);


          req.reject(
            new Error(
              'ISO_TP_FC_TRANSMIT_ERROR'
            )
          );

          return;
        }


        req.auditFrames.push({
          direction: 'TX',
          id: fcTargetId,
          data: [...fcFrame],
          timestamp: Date.now(),
          type: 'ISO-TP FC'
        });


        canManager.addFrame({
          id:
            `0x${fcTargetId
              .toString(16)
              .toUpperCase()}`,

          dlc: 8,

          dataHex:
            fcFrame
              .map(b =>
                b.toString(16)
                  .padStart(2, '0')
                  .toUpperCase()
              )
              .join(' '),

          dataBytes: [...fcFrame],

          direction: 'Tx',

          isExtended:
            req.isExtended,

          description:
            'ISO-TP Flow Control (CTS)'
        });

      })
      .catch((err) => {

        console.error(
          `[ISO-TP-TX] FC SEND ERROR:`,
          err
        );


        this.cleanupRequest(seq);


        req.reject(
          new Error(
            'ISO_TP_FC_TRANSMIT_ERROR'
          )
        );
      });
  }


  private handleFlowControl(
    req: PendingDiagnosticRequest,
    frameIdNum: number,
    data: number[],
    seq: number
  ) {

    if (!req.txState) {

      console.warn(
        `[ISO-TP] SPURIOUS FLOW CONTROL ` +
        `from 0x${frameIdNum
          .toString(16)
          .toUpperCase()}`
      );

      return;
    }


    if (data.length < 3) {
      return;
    }


    if (req.isoTpTimer) {
      clearTimeout(req.isoTpTimer);
      req.isoTpTimer = undefined;
    }


    const flowStatus =
      data[0] & 0x0F;


    const blockSize =
      data[1];


    const stMin =
      data[2];


    console.log(
      `[ISO-TP-RX] FLOW CONTROL RECEIVED: ` +
      `STATUS=${flowStatus} ` +
      `BS=${blockSize} ` +
      `STmin=0x${stMin
        .toString(16)
        .padStart(2, '0')
        .toUpperCase()}`
    );


    /*
     * WAIT
     */
    if (
      flowStatus === FlowStatus.WAIT
    ) {

      console.log(
        `[ISO-TP] ECU REQUESTED WAIT`
      );


      req.isoTpTimer =
        setTimeout(() => {

          this.cleanupRequest(seq);


          req.reject(
            new Error(
              'ISO_TP_TIMEOUT_AFTER_WAIT'
            )
          );

        }, 5000);


      return;
    }


    /*
     * OVERFLOW
     */
    if (
      flowStatus === FlowStatus.OVERFLOW
    ) {

      console.error(
        `[ISO-TP] ECU REPORTED OVERFLOW`
      );


      this.cleanupRequest(seq);


      req.reject(
        new Error(
          'ISO_TP_BUFFER_OVERFLOW'
        )
      );


      return;
    }


    /*
     * CONTINUE TO SEND
     */
    if (
      flowStatus ===
      FlowStatus.CONTINUE_TO_SEND
    ) {

      req.txState.blockSize =
        blockSize;

      req.txState.stMin =
        stMin;

      req.txState.framesInBlock =
        0;


      this.sendNextConsecutiveFrames(
        req,
        seq
      );

      return;
    }


    console.warn(
      `[ISO-TP] Unknown Flow Status: ${flowStatus}`
    );
  }


  /**
   * Decode ISO-TP STmin.
   *
   * 00-7F = milliseconds
   * F1-F9 = 100-900 microseconds
   *
   * JavaScript timers cannot reliably schedule
   * sub-millisecond CAN timing, therefore F1-F9
   * are rounded to the minimum practical timer
   * resolution.
   */
  private decodeStMinToMilliseconds(
    stMin: number
  ): number {

    if (
      stMin >= 0x00 &&
      stMin <= 0x7F
    ) {

      return stMin;
    }


    if (
      stMin >= 0xF1 &&
      stMin <= 0xF9
    ) {

      /*
       * 0xF1 = 100 us
       * 0xF9 = 900 us
       *
       * setTimeout cannot guarantee 0.1-0.9 ms,
       * so use 1 ms as the practical lower bound.
       */
      return 1;
    }


    /*
     * Reserved/invalid values.
     */
    return 0;
  }


  private async sendNextConsecutiveFrames(
    req: PendingDiagnosticRequest,
    seq: number
  ) {

    if (!req.txState) {
      return;
    }


    if (
      req.txState.remainingBytes.length === 0
    ) {
      return;
    }


    const blockSize =
      req.txState.blockSize;


    /*
     * BS=0 means unlimited.
     */
    let framesToSend =
      blockSize === 0
        ? Number.MAX_SAFE_INTEGER
        : blockSize;


    const stMinMs =
      this.decodeStMinToMilliseconds(
        req.txState.stMin
      );


    while (
      framesToSend > 0 &&
      req.txState.remainingBytes.length > 0
    ) {

      /*
       * Verify request is still alive.
       */
      if (!this.pendingRequests[seq]) {
        return;
      }


      const take =
        Math.min(
          7,
          req.txState.remainingBytes.length
        );


      const payload =
        req.txState.remainingBytes.slice(
          0,
          take
        );


      req.txState.remainingBytes =
        req.txState.remainingBytes.slice(
          take
        );


      const sequence =
        req.txState.nextSequence & 0x0F;


      const cfFrame = [
        0x20 | sequence,
        ...payload
      ];


      while (cfFrame.length < 8) {
        cfFrame.push(0x00);
      }


      console.log(
        `[ISO-TP-TX] CF ` +
        `SN=${sequence} ` +
        `ID=0x${req.canId
          .toString(16)
          .toUpperCase()}`
      );


      /*
       * Actual send first.
       */
      const ok =
        await this.activeTransport.sendCanFrame(
          req.canId,
          cfFrame,
          req.isExtended
        );


      if (!ok) {

        console.error(
          `[ISO-TP-TX] CF SEND FAILED`
        );


        this.cleanupRequest(seq);


        req.reject(
          new Error(
            'CF_SEND_FAILED'
          )
        );


        return;
      }


      /*
       * Only record successful physical transmission.
       */
      req.auditFrames.push({
        direction: 'TX',
        id: req.canId,
        data: [...cfFrame],
        timestamp: Date.now(),
        type:
          `ISO-TP CF ${sequence}`
      });


      canManager.addFrame({
        id:
          `0x${req.canId
            .toString(16)
            .toUpperCase()}`,

        dlc: 8,

        dataHex:
          cfFrame
            .map(b =>
              b.toString(16)
                .padStart(2, '0')
                .toUpperCase()
            )
            .join(' '),

        dataBytes: [...cfFrame],

        direction: 'Tx',

        isExtended:
          req.isExtended,

        description:
          `ISO-TP Consecutive Frame ${sequence}`
      });


      req.txState.nextSequence =
        (
          req.txState.nextSequence + 1
        ) & 0x0F;


      req.txState.framesInBlock++;

      framesToSend--;


      /*
       * Respect STmin between CF frames.
       */
      if (
        stMinMs > 0 &&
        req.txState.remainingBytes.length > 0
      ) {

        await new Promise<void>(
          resolve =>
            setTimeout(
              resolve,
              stMinMs
            )
        );
      }
    }


    /*
     * If bytes remain and BS > 0,
     * wait for the next Flow Control.
     */
    if (
      req.txState.remainingBytes.length > 0 &&
      req.txState.blockSize > 0
    ) {

      req.isoTpTimer =
        setTimeout(() => {

          console.error(
            `[ISO-TP-TX] N_Bs TIMEOUT: ` +
            `Waiting for next Flow Control`
          );


          this.cleanupRequest(seq);


          req.reject(
            new Error(
              'ISO_TP_N_Bs_TIMEOUT'
            )
          );

        }, 1000);
    }
  }


  /**
   * Resolve the CAN ID where Flow Control must be sent.
   */
  public resolveIsoTpFlowControlId(
    requestCanId: number,
    responseCanId: number,
    isExtended: boolean
  ): number | null {

    if (!isExtended) {

      /*
       * Functional response:
       * 7E8..7EF
       *
       * FC goes to the corresponding
       * physical request ID.
       */
      if (
        responseCanId >= 0x7E8 &&
        responseCanId <= 0x7EF
      ) {

        if (requestCanId === 0x7DF) {
          return responseCanId - 8;
        }


        if (
          requestCanId ===
          responseCanId - 8
        ) {

          return requestCanId;
        }
      }


      /*
       * Physical request:
       * 7E0 -> 7E8
       */
      if (
        responseCanId ===
        requestCanId + 8
      ) {

        return requestCanId;
      }


      return null;
    }


    const request =
      requestCanId >>> 0;

    const response =
      responseCanId >>> 0;


    const reqPrefix =
      (request >>> 16) & 0xFFFF;


    const resPrefix =
      (response >>> 16) & 0xFFFF;


    const reqDA =
      (request >>> 8) & 0xFF;


    const reqSA =
      request & 0xFF;


    const resDA =
      (response >>> 8) & 0xFF;


    const resSA =
      response & 0xFF;


    /*
     * Functional request:
     *
     * 18DB33F1
     *
     * Response:
     * 18DAF110
     *
     * FC:
     * 18DA10F1
     */
    if (
      reqPrefix === 0x18DB &&
      reqDA === 0x33 &&
      reqSA === 0xF1 &&
      resPrefix === 0x18DA &&
      resDA === 0xF1
    ) {

      return (
        0x18DA0000 |
        (resSA << 8) |
        0xF1
      ) >>> 0;
    }


    /*
     * Physical:
     *
     * 18DA10F1
     * 18DAF110
     *
     * FC goes back to 18DA10F1.
     */
    if (
      reqPrefix === 0x18DA &&
      resPrefix === 0x18DA &&
      resDA === reqSA &&
      resSA === reqDA
    ) {

      return request;
    }


    /*
     * Generic ISO-TP address swap.
     */
    if (
      resPrefix === 0x18DA &&
      resDA === reqSA &&
      resSA === reqDA
    ) {

      return request;
    }


    return null;
  }


  /**
   * Strictly serialized diagnostic requests.
   */
  public async sendRequest(
    requestBytes: number[],
    targetCanId: string = '0x7E0'
  ): Promise<CommunicationPacket> {

    const correlationId =
      `REQ-${++this.sequenceId}`;


    const sanitizedRequest =
      requestBytes.map(
        b => b & 0xFF
      );


    const reqHex =
      sanitizedRequest
        .map(b =>
          b.toString(16)
            .padStart(2, '0')
            .toUpperCase()
        )
        .join(' ');


    console.log(
      `[APP-TX] [${correlationId}] QUEUED: ` +
      `ID=${targetCanId} ` +
      `PAYLOAD=[${reqHex}]`
    );


    return new Promise(
      (resolve) => {

        this.requestQueue =
          this.requestQueue.then(
            async () => {

              try {

                console.log(
                  `[APP-TX] [${correlationId}] ` +
                  `STARTING EXECUTION`
                );


                const result =
                  await this.executeRequest(
                    sanitizedRequest,
                    targetCanId,
                    correlationId
                  );


                resolve(result);

              } catch (err: any) {

                console.error(
                  `[APP-TX] [${correlationId}] ` +
                  `CRITICAL ERROR:`,
                  err
                );


                resolve(
                  commLogger.logPacket({
                    direction: '[OBD TX]',
                    protocol:
                      this.config.protocol,
                    canIdHex:
                      targetCanId,
                    requestRaw:
                      reqHex,
                    error:
                      err?.message ||
                      'Critical Queue Error',
                    durationMs: 0,
                    status: 'ERROR'
                  })
                );
              }
            }
          );
      }
    );
  }


  private async executeRequest(
    requestBytes: number[],
    targetCanId: string = '0x7E0',
    correlationId: string
  ): Promise<CommunicationPacket> {

    const startTime =
      performance.now();


    const reqHex =
      requestBytes
        .map(b =>
          b.toString(16)
            .padStart(2, '0')
            .toUpperCase()
        )
        .join(' ');


    /*
     * Parse CAN ID correctly.
     */
    const parsedCanId =
      this.parseCanId(targetCanId);


    if (parsedCanId === null) {

      return commLogger.logPacket({
        direction: '[OBD TX]',
        protocol:
          this.config.protocol,
        canIdHex:
          targetCanId,
        requestRaw:
          reqHex,
        error:
          'INVALID_CAN_ID',
        durationMs: 0,
        status: 'ERROR'
      });
    }


    const numCanId =
      parsedCanId;


    /*
     * Extended ID is determined by numeric range,
     * not string length.
     */
    const isExtended =
      numCanId > 0x7FF;


    console.log(
      `[OBD-TX] [${correlationId}] ` +
      `ID=${targetCanId} ` +
      `PAYLOAD=[${reqHex}]`
    );


    /*
     * Empty diagnostic request is invalid.
     */
    if (requestBytes.length === 0) {

      return commLogger.logPacket({
        direction: '[OBD TX]',
        protocol:
          this.config.protocol,
        canIdHex:
          targetCanId,
        requestRaw:
          reqHex,
        error:
          'EMPTY_REQUEST',
        durationMs: 0,
        status: 'ERROR'
      });
    }


    /*
     * DEMO MODE is explicitly isolated.
     */
    if (this.config.isMockMode) {

      const {
        mockEcuServer
      } = await import(
        './mockEcuServer'
      );


      const responseBytes =
        await mockEcuServer.handleRequest(
          requestBytes
        );


      const durationMs =
        Math.round(
          performance.now() -
          startTime
        );


      const resHex =
        responseBytes
          .map(b =>
            b.toString(16)
              .padStart(2, '0')
              .toUpperCase()
          )
          .join(' ');


      const actualResponseIdNum =
        isExtended
          ? numCanId
          : numCanId + 8;


      const actualResponseIdHex =
        '0x' +
        actualResponseIdNum
          .toString(16)
          .toUpperCase();


      return commLogger.logPacket({
        direction: '[OBD-RX]',
        protocol:
          this.config.protocol,
        canIdHex:
          actualResponseIdHex,
        requestRaw:
          reqHex,
        responseRaw:
          resHex,
        durationMs,
        status:
          responseBytes[0] === 0x7F
            ? 'NRC'
            : 'SUCCESS'
      });
    }


    /*
     * REAL MODE:
     * No hardware = no command.
     */
    if (!this.isConnected()) {

      const errPkt =
        commLogger.logPacket({
          direction: '[OBD TX]',
          protocol:
            this.config.protocol,
          canIdHex:
            targetCanId,
          requestRaw:
            reqHex,
          error:
            'ESP32 NOT CONNECTED',
          durationMs: 0,
          status: 'ERROR'
        });


      AppLogger.warn(
        'NETWORK',
        'RealModeCheck',
        `[${correlationId}] ` +
        `Command blocked: ESP32 NOT CONNECTED`,
        'تم حظر الأمر: ESP32 غير متصل'
      );


      return errPkt;
    }


    /*
     * K-LINE ROUTE
     */
    if (this.isKlineProtocol()) {

      if (
        !this.activeTransport.sendKlineFrame
      ) {

        return commLogger.logPacket({
          direction: '[KLINE-ERR]',
          protocol:
            this.config.protocol,
          canIdHex:
            'K-LINE',
          requestRaw:
            reqHex,
          error:
            'K-Line protocol requested but active transport does not support K-Line',
          durationMs: 0,
          status: 'ERROR'
        });
      }


      console.log(
        `[KLINE-TX] [${correlationId}] ` +
        `PAYLOAD=[${reqHex}] ` +
        `PROTOCOL=${this.config.protocol}`
      );


      const klineResult =
        await this.activeTransport.sendKlineFrame(
          requestBytes
        );


      const durationMs =
        Math.round(
          performance.now() -
          startTime
        );


      if (
        klineResult.status === 0 &&
        klineResult.data.length > 0
      ) {

        const resHex =
          klineResult.data
            .map(b =>
              b.toString(16)
                .padStart(2, '0')
                .toUpperCase()
            )
            .join(' ');


        console.log(
          `[KLINE-RX] [${correlationId}] ` +
          `PAYLOAD=[${resHex}] ` +
          `(${durationMs}ms)`
        );


        const pkt =
          commLogger.logPacket({
            direction: '[KLINE-RX]',
            protocol:
              this.config.protocol,
            canIdHex:
              'K-LINE',
            requestRaw:
              reqHex,
            responseRaw:
              resHex,
            durationMs,
            status:
              klineResult.data[0] === 0x7F
                ? 'NRC'
                : 'SUCCESS'
          });


        return {
          ...pkt,
          data:
            klineResult.data,
          auditFrames: []
        };
      }


      const errStr =
        klineResult.status === 0x01
          ? 'NO_VOLTAGE'
          : klineResult.status === 0x04
            ? 'ECU_NO_RESPONSE'
            : klineResult.status === 0x05
              ? 'CHECKSUM_ERROR'
              : 'KLINE_TX_ERROR';


      console.warn(
        `[KLINE-ERR] [${correlationId}] ` +
        `Status=0x${klineResult.status
          .toString(16)
          .toUpperCase()} ` +
        `(${errStr})`
      );


      return commLogger.logPacket({
        direction: '[KLINE-ERR]',
        protocol:
          this.config.protocol,
        canIdHex:
          'K-LINE',
        requestRaw:
          reqHex,
        error:
          errStr,
        durationMs,
        status:
          klineResult.status === 0x04
            ? 'TIMEOUT'
            : 'ERROR'
      });
    }


    /*
     * CAN / ISO-TP ROUTE
     */
    try {

      let frames: number[][] = [];

      let multiFrameTx = false;


      /*
       * Detect already formatted ISO-TP.
       *
       * A valid 8-byte frame:
       * SF / FF / CF / FC.
       */
      const pci =
        requestBytes[0] & 0xFF;


      const pciType =
        pci & 0xF0;


      const isAlreadyIsoTp =
        requestBytes.length === 8 &&
        (
          pciType === 0x00 ||
          pciType === 0x10 ||
          pciType === 0x20 ||
          pciType === 0x30
        );


      if (isAlreadyIsoTp) {

        console.log(
          `[OBD-TX] [${correlationId}] ` +
          `Pre-formatted ISO-TP frame`
        );


        frames = [
          [...requestBytes]
        ];

      } else {

        frames =
          IsoTpProtocol.encodePayload(
            requestBytes,
            isExtended
          );
      }


      if (
        frames.length === 0 ||
        !frames[0] ||
        frames[0].length === 0
      ) {

        throw new Error(
          'ISO_TP_ENCODING_FAILED'
        );
      }


      const firstFrame =
        [...frames[0]];


      multiFrameTx =
        frames.length > 1;


      /*
       * For a normal FF:
       *
       * FF carries first 6 payload bytes.
       *
       * The remaining payload starts at byte 6.
       */
      const remainingBytes =
        multiFrameTx
          ? requestBytes.slice(6)
          : [];


      const seq =
        ++this.sequenceId;


      let actualResponseIdNum =
        isExtended
          ? 0
          : numCanId + 8;


      /*
       * For 29-bit functional requests,
       * response ID is discovered dynamically.
       */
      if (
        isExtended &&
        numCanId === 0x18DB33F1
      ) {

        actualResponseIdNum = 0;
      }


      const responsePromise =
        new Promise<{
          payload: number[];
          auditFrames: AuditFrame[];
        }>(
          (resolve, reject) => {

            const timeoutMs =
              multiFrameTx
                ? 7000
                : 3500;


            const timer =
              setTimeout(() => {

                this.cleanupRequest(seq);


                const expectedIdHex =
                  numCanId === 0x7DF
                    ? '0x7E8-0x7EF'
                    : isExtended
                      ? '29-bit response'
                      : `0x${(
                          numCanId + 8
                        )
                          .toString(16)
                          .toUpperCase()}`;


                console.warn(
                  `[OBD-TIMEOUT] ` +
                  `[${correlationId}] ` +
                  `NO RESPONSE from ECU. ` +
                  `Expected ID: ${expectedIdHex}`
                );


                commLogger.logPacket({
                  direction:
                    '[OBD-TIMEOUT]',
                  protocol:
                    this.config.protocol,
                  canIdHex:
                    `0x${numCanId
                      .toString(16)
                      .toUpperCase()}`,
                  requestRaw:
                    reqHex,
                  error:
                    `TIMEOUT: No response from ${expectedIdHex}`,
                  durationMs:
                    timeoutMs,
                  status:
                    'TIMEOUT'
                });


                reject(
                  new Error(
                    'TIMEOUT_WAITING_FOR_ECU_RESPONSE'
                  )
                );

              }, timeoutMs);


            this.pendingRequests[seq] = {

              resolve: (result) => {

                const current =
                  this.pendingRequests[seq];


                if (
                  current &&
                  current.actualResponseId !==
                    undefined
                ) {

                  actualResponseIdNum =
                    current.actualResponseId;
                }


                resolve(result);
              },


              reject,


              canId:
                numCanId,


              requestBytes:
                [...requestBytes],


              isExtended,


              correlationId,


              timer,


              auditFrames: [],


              txState:
                multiFrameTx
                  ? {
                      remainingBytes:
                        [...remainingBytes],

                      nextSequence: 1,

                      blockSize: 0,

                      stMin: 0,

                      framesInBlock: 0
                    }
                  : undefined
            };
          }
        );


      /*
       * Audit TX frame, but DO NOT insert into
       * canManager until actual transport send succeeds.
       */
      this.pendingRequests[seq]
        .auditFrames.push({
          direction: 'TX',
          id: numCanId,
          data: [...firstFrame],
          timestamp: Date.now(),
          type:
            multiFrameTx
              ? 'ISO-TP FF'
              : 'ISO-TP SF'
        });


      console.log(
        `[CAN-TX] [${correlationId}] ` +
        `ID=0x${numCanId
          .toString(16)
          .toUpperCase()} ` +
        `DATA=[${firstFrame
          .map(b =>
            b.toString(16)
              .padStart(2, '0')
              .toUpperCase()
          )
          .join(' ')}]`
      );


      /*
       * ACTUAL physical transmission.
       */
      const ok =
        await this.activeTransport.sendCanFrame(
          numCanId,
          firstFrame,
          isExtended
        );


      if (!ok) {

        this.cleanupRequest(seq);


        console.error(
          `[CAN-TX] [${correlationId}] ` +
          `FAILED to send to transport`
        );


        throw new Error(
          'CAN_TRANSPORT_SEND_FAILED'
        );
      }


      /*
       * Only now add TX frame to CAN Monitor.
       *
       * This prevents fake TX entries when
       * the ESP32 transport rejected the frame.
       */
      canManager.addFrame({

        id:
          `0x${numCanId
            .toString(16)
            .toUpperCase()}`,

        dlc:
          firstFrame.length,

        dataHex:
          firstFrame
            .map(b =>
              b.toString(16)
                .padStart(2, '0')
                .toUpperCase()
            )
            .join(' '),

        dataBytes:
          [...firstFrame],

        direction:
          'Tx',

        isExtended,

        description:
          multiFrameTx
            ? 'ISO-TP First Frame'
            : 'ISO-TP Single Frame'
      });


      /*
       * Successful physical TX log.
       */
      commLogger.logPacket({
        direction:
          '[CAN-TX]',
        protocol:
          this.config.protocol,
        canIdHex:
          `0x${numCanId
            .toString(16)
            .toUpperCase()}`,
        dlc:
          firstFrame.length,
        requestRaw:
          firstFrame
            .map(b =>
              b.toString(16)
                .padStart(2, '0')
                .toUpperCase()
            )
            .join(' '),
        durationMs: 0,
        status:
          'SUCCESS'
      });


      /*
       * If FF was transmitted, wait for FC.
       *
       * N_Bs is approximately 1 second here.
       */
      if (multiFrameTx) {

        const request =
          this.pendingRequests[seq];


        if (request) {

          request.isoTpTimer =
            setTimeout(() => {

              if (
                !this.pendingRequests[seq]
              ) {
                return;
              }


              console.error(
                `[ISO-TP-TX] ` +
                `N_Bs TIMEOUT: ` +
                `No Flow Control received`
              );


              this.cleanupRequest(seq);


              request.reject(
                new Error(
                  'ISO_TP_N_Bs_TIMEOUT'
                )
              );

            }, 1000);
        }
      }


      console.log(
        `[CAN-TX] [${correlationId}] ` +
        `SENT SUCCESS`
      );


      /*
       * Wait for ECU diagnostic response.
       */
      const resultData =
        await responsePromise;


      const responseBytes =
        resultData.payload;


      const auditFrames =
        resultData.auditFrames;


      const durationMs =
        Math.round(
          performance.now() -
          startTime
        );


      const resHex =
        responseBytes
          .map(b =>
            b.toString(16)
              .padStart(2, '0')
              .toUpperCase()
          )
          .join(' ');


      const actualResponseIdHex =
        actualResponseIdNum > 0
          ? `0x${actualResponseIdNum
              .toString(16)
              .toUpperCase()}`
          : 'UNKNOWN';


      console.log(
        `[OBD-RX] [${correlationId}] ` +
        `CAN=${actualResponseIdHex} ` +
        `PAYLOAD=[${resHex}] ` +
        `(${durationMs}ms)`
      );


      const finalPacket =
        commLogger.logPacket({

          direction:
            '[OBD-RX]',

          protocol:
            this.config.protocol,

          canIdHex:
            actualResponseIdHex,

          requestRaw:
            reqHex,

          responseRaw:
            resHex,

          durationMs,

          status:
            responseBytes[0] === 0x7F
              ? 'NRC'
              : 'SUCCESS'
        });


      return {
        ...finalPacket,

        data:
          responseBytes,

        auditFrames
      };


    } catch (err: any) {

      const durationMs =
        Math.round(
          performance.now() -
          startTime
        );


      console.error(
        `[OBD-ERROR] [${correlationId}] ` +
        `${err?.message || err} ` +
        `(${durationMs}ms)`
      );


      /*
       * Do not call every transmission error a TIMEOUT.
       */
      const message =
        err?.message ||
        'Unknown diagnostic error';


      const isTimeout =
        message.includes('TIMEOUT') ||
        message.includes('N_Cr') ||
        message.includes('N_Bs');


      return commLogger.logPacket({

        direction:
          isTimeout
            ? '[OBD-TIMEOUT]'
            : '[OBD-ERROR]',

        protocol:
          this.config.protocol,

        canIdHex:
          targetCanId,

        requestRaw:
          reqHex,

        error:
          message,

        durationMs,

        status:
          isTimeout
            ? 'TIMEOUT'
            : 'ERROR'
      });
    }
  }
}


export {
  defaultConnectionConfig
} from './Transport';


export const transportManager =
  new TransportManager(
    defaultConnectionConfig
  );
