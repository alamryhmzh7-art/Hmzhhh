/**
 * HAMZA OBD PRO - Unified Binary Frame Protocol
 *
 * Wire format:
 *
 *   [0xAA 0x55]
 *   [CMD       1B]
 *   [LEN       2B, Big Endian]
 *   [PAYLOAD   N Bytes]
 *   [CHECKSUM  1B, XOR]
 *   [0x0D 0x0A]
 *
 * Checksum:
 *   CMD ^ LEN_HIGH ^ LEN_LOW ^ PAYLOAD[0] ^ ... ^ PAYLOAD[N-1]
 *
 * CAN payload:
 *   [ID 4B][FLAGS 1B][DLC 1B][DATA 0..8B]
 *
 * FLAGS:
 *   bit 0 = Extended CAN ID
 *   bit 1 = RTR
 *
 * IMPORTANT:
 * - This file remains wire-compatible with the current ESP32 firmware.
 * - The parser is stream-safe: partial frames are preserved.
 * - Multiple frames in one read are supported.
 * - Corrupted frames are resynchronized without dropping valid
 *   following frames.
 * - No synthetic CAN data is generated here.
 */

import {
  CanFrame,
  CanBusStatus,
  KlineStatus,
  ProtocolType
} from '../types';

export function decodeFirmwareStatusCode(statusCode: number): {
  codeName: string;
  descriptionEn: string;
  descriptionAr: string;
} {
  switch (statusCode) {
    case 0x00:
      return {
        codeName: 'SUCCESS',
        descriptionEn: 'Operation completed successfully',
        descriptionAr: 'تمت العملية بنجاح'
      };
    case 0x01:
      return {
        codeName: 'NO_VOLTAGE',
        descriptionEn: 'No voltage detected on bus or OBD pin',
        descriptionAr: 'لم يتم اكتشاف جهد كهربائي على المنفذ'
      };
    case 0x02:
      return {
        codeName: 'INIT_FAILED',
        descriptionEn: 'Bus initialization failed',
        descriptionAr: 'فشلت عملية تهيئة الناقل'
      };
    case 0x03:
      return {
        codeName: 'KEYBYTE_MISMATCH',
        descriptionEn: 'Key byte mismatch during initialization',
        descriptionAr: 'خطأ في تطابق البايتات الافتتاحية'
      };
    case 0x04:
      return {
        codeName: 'ECU_NO_RESPONSE',
        descriptionEn: 'No response received from target ECU',
        descriptionAr: 'لم يتم استلام أي رد من كمبيوتر السيارة'
      };
    case 0x05:
      return {
        codeName: 'CHECKSUM_ERROR',
        descriptionEn: 'Checksum error in received packet',
        descriptionAr: 'خطأ في المجموع التفاسري للبيانات'
      };
    case 0x06:
      return {
        codeName: 'CAN_ERROR',
        descriptionEn: 'CAN bus transmission error or BUS_OFF state',
        descriptionAr: 'خطأ في ناقل CAN أو حالة توقف الناقل (BUS_OFF)'
      };
    case 0x07:
      return {
        codeName: 'BUSY',
        descriptionEn: 'CAN transceiver or hardware bus is busy or recovering',
        descriptionAr: 'ناقل البيانات مشغول أو جاري التعافي'
      };
    default:
      return {
        codeName: `UNKNOWN_ERROR_0x${statusCode.toString(16).toUpperCase()}`,
        descriptionEn: `Unknown firmware error code: 0x${statusCode.toString(16).toUpperCase()}`,
        descriptionAr: `كود خطأ مجهول من الفريموير: 0x${statusCode.toString(16).toUpperCase()}`
      };
  }
}

export enum BinaryCommand {
  CMD_CAN_FRAME = 0x01,
  CMD_PING = 0x02,
  CMD_PONG = 0x03,
  CMD_CAN_STATUS_REQ = 0x04,
  CMD_CAN_STATUS_RESP = 0x05,
  CMD_CONFIG_CAN = 0x06,
  CMD_HEARTBEAT = 0x07,
  CMD_CONFIG_PROTOCOL = 0x08,
  CMD_KLINE_INIT = 0x09,
  CMD_KLINE_INIT_RESP = 0x0A,
  CMD_KLINE_FRAME = 0x0B,
  CMD_KLINE_STATUS_REQ = 0x0C,
  CMD_KLINE_STATUS_RESP = 0x0D,
  CMD_ERROR_RESP = 0x0E,
  CMD_ERROR = 0xFF
}

export interface DecodedBinaryPacket {
  cmd: BinaryCommand;
  payload: Uint8Array;
  rawFrame: Uint8Array;
  isValid: boolean;

  canFrame?: CanFrame;
  canStatus?: CanBusStatus;
  klineStatus?: KlineStatus;

  errorResp?: {
    failedCmd: number;
    statusCode: number;
    statusText: string;
    descriptionEn: string;
    descriptionAr: string;
  };

  klineInitResp?: {
    statusCode: number;
    statusText: string;
    activeProtocol: ProtocolType;
    keyBytes?: [number, number];
  };

  klineInitResult?: {
    success: boolean;
    activeProtocol: number;
    keyByte1: number;
    keyByte2: number;
  };

  klineFrame?: {
    statusCode: number;
    dataBytes: number[];
    rawHex: string;
  };

  klineFrameResult?: {
    status: number;
    data: number[];
  };

  pongInfo?: {
    uptimeMs: number;
    canReady: boolean;
    freeHeapBytes: number;
  };
}

export class BinaryProtocol {
  public static readonly MAGIC_BYTE_1 = 0xAA;
  public static readonly MAGIC_BYTE_2 = 0x55;

  public static readonly TRAILER_BYTE_1 = 0x0D;
  public static readonly TRAILER_BYTE_2 = 0x0A;

  /**
   * Maximum payload accepted by the current binary transport.
   *
   * The current ESP32 implementation uses a 256-byte temporary
   * packet buffer, therefore payloads above 256 bytes must not
   * be emitted by this protocol implementation.
   */
  public static readonly MAX_PAYLOAD_SIZE = 256;

  public static readonly CAN_MIN_PAYLOAD_SIZE = 6;
  public static readonly CAN_MAX_DLC = 8;

  /**
   * Protocol debugging is intentionally disabled by default.
   *
   * Logging every CAN frame from the binary parser can severely
   * reduce UI performance when the CAN bus is busy.
   */
  private static debugEnabled = false;

  public static setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  public static isDebugEnabled(): boolean {
    return this.debugEnabled;
  }

  private static debug(message: string): void {
    if (this.debugEnabled) {
      console.debug(message);
    }
  }

  private static warn(message: string): void {
    console.warn(message);
  }

  /**
   * Compute XOR checksum.
   *
   * ESP32 uses exactly:
   *
   *   cmd ^ LEN_HIGH ^ LEN_LOW ^ every payload byte
   */
  public static computeChecksum(
    cmd: number,
    len: number,
    payload: Uint8Array | number[]
  ): number {
    if (
      !Number.isInteger(cmd) ||
      cmd < 0 ||
      cmd > 0xFF
    ) {
      throw new Error(
        `[PROTO] Invalid command byte: ${cmd}`
      );
    }

    if (
      !Number.isInteger(len) ||
      len < 0 ||
      len > 0xFFFF
    ) {
      throw new Error(
        `[PROTO] Invalid payload length: ${len}`
      );
    }

    if (payload.length !== len) {
      throw new Error(
        `[PROTO] Checksum payload length mismatch: ` +
        `declared=${len}, actual=${payload.length}`
      );
    }

    let checksum =
      (cmd & 0xFF) ^
      ((len >>> 8) & 0xFF) ^
      (len & 0xFF);

    for (let i = 0; i < payload.length; i++) {
      checksum ^= payload[i] & 0xFF;
    }

    return checksum & 0xFF;
  }

  /**
   * Validate and normalize a CAN identifier.
   *
   * CAN ID range:
   *   Standard = 0x000 .. 0x7FF
   *   Extended = 0x00000000 .. 0x1FFFFFFF
   */
  private static normalizeCanId(canId: number): number {
    if (!Number.isFinite(canId)) {
      throw new Error('[PROTO] Invalid CAN ID');
    }

    if (!Number.isInteger(canId)) {
      throw new Error(
        `[PROTO] CAN ID must be an integer: ${canId}`
      );
    }

    if (
      canId < 0 ||
      canId > 0x1FFFFFFF
    ) {
      throw new Error(
        `[PROTO] CAN ID out of range: 0x${canId
          .toString(16)
          .toUpperCase()}`
      );
    }

    return canId >>> 0;
  }

  /**
   * Validate one byte.
   */
  private static normalizeByte(
    value: number,
    fieldName: string
  ): number {
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value > 0xFF
    ) {
      throw new Error(
        `[PROTO] ${fieldName} must be a byte (0..255): ${value}`
      );
    }

    return value;
  }

  /**
   * Validate a CAN data field.
   */
  private static normalizeCanData(
    data: number[] | Uint8Array
  ): number[] {
    if (
      !Array.isArray(data) &&
      !(data instanceof Uint8Array)
    ) {
      throw new Error(
        '[PROTO] CAN data must be number[] or Uint8Array'
      );
    }

    if (data.length > this.CAN_MAX_DLC) {
      throw new Error(
        `[PROTO] CAN data length exceeds DLC 8: ${data.length}`
      );
    }

    const result: number[] = [];

    for (let i = 0; i < data.length; i++) {
      result.push(
        this.normalizeByte(
          Number(data[i]),
          `CAN data[${i}]`
        )
      );
    }

    return result;
  }

  /**
   * Encode CAN frame.
   *
   * Payload:
   *   [ID 4B][FLAGS 1B][DLC 1B][DATA 0..8B]
   *
   * FLAGS:
   *   bit 0 = Extended CAN ID
   *   bit 1 = RTR
   */
  public static encodeCanFrame(
    canId: number,
    data: number[] | Uint8Array,
    isExtended: boolean = false,
    isRtr: boolean = false
  ): Uint8Array {
    if (typeof isExtended !== 'boolean') {
      throw new Error(
        '[PROTO] isExtended must be boolean'
      );
    }

    if (typeof isRtr !== 'boolean') {
      throw new Error(
        '[PROTO] isRtr must be boolean'
      );
    }

    const normalizedId =
      this.normalizeCanId(canId);

    if (
      !isExtended &&
      normalizedId > 0x7FF
    ) {
      throw new Error(
        `[PROTO] Standard 11-bit CAN ID exceeds 0x7FF: ` +
        `0x${normalizedId
          .toString(16)
          .toUpperCase()}`
      );
    }

    const normalizedData =
      this.normalizeCanData(data);

    const dlc =
      normalizedData.length;

    const flags =
      (isExtended ? 0x01 : 0x00) |
      (isRtr ? 0x02 : 0x00);

    const payload =
      new Uint8Array(
        this.CAN_MIN_PAYLOAD_SIZE + dlc
      );

    payload[0] =
      (normalizedId >>> 24) & 0xFF;

    payload[1] =
      (normalizedId >>> 16) & 0xFF;

    payload[2] =
      (normalizedId >>> 8) & 0xFF;

    payload[3] =
      normalizedId & 0xFF;

    payload[4] =
      flags;

    payload[5] =
      dlc;

    for (let i = 0; i < dlc; i++) {
      payload[6 + i] =
        normalizedData[i];
    }

    return this.wrapPacket(
      BinaryCommand.CMD_CAN_FRAME,
      payload
    );
  }

  /**
   * Encode PING request.
   *
   * Current ESP32 firmware accepts CMD_PING regardless of
   * the payload. We preserve the existing 8-byte timestamp
   * for compatibility.
   */
  public static encodePing(): Uint8Array {
    const timestamp =
      BigInt(Date.now());

    const payload =
      new Uint8Array(8);

    for (let i = 0; i < 8; i++) {
      payload[7 - i] =
        Number(
          (timestamp >> BigInt(i * 8)) &
          0xFFn
        );
    }

    return this.wrapPacket(
      BinaryCommand.CMD_PING,
      payload
    );
  }

  /**
   * Encode PONG response.
   */
  public static encodePong(
    uptimeMs: number,
    canReady: boolean,
    freeHeapBytes: number
  ): Uint8Array {
    if (
      !Number.isFinite(uptimeMs) ||
      uptimeMs < 0 ||
      uptimeMs > 0xFFFFFFFF
    ) {
      throw new Error(
        `[PROTO] Invalid uptimeMs: ${uptimeMs}`
      );
    }

    if (
      !Number.isFinite(freeHeapBytes) ||
      freeHeapBytes < 0 ||
      freeHeapBytes > 0xFFFFFFFF
    ) {
      throw new Error(
        `[PROTO] Invalid freeHeapBytes: ${freeHeapBytes}`
      );
    }

    const payload =
      new Uint8Array(9);

    const uptime =
      Math.trunc(uptimeMs) >>> 0;

    const heap =
      Math.trunc(freeHeapBytes) >>> 0;

    payload[0] =
      (uptime >>> 24) & 0xFF;

    payload[1] =
      (uptime >>> 16) & 0xFF;

    payload[2] =
      (uptime >>> 8) & 0xFF;

    payload[3] =
      uptime & 0xFF;

    payload[4] =
      canReady ? 0x01 : 0x00;

    payload[5] =
      (heap >>> 24) & 0xFF;

    payload[6] =
      (heap >>> 16) & 0xFF;

    payload[7] =
      (heap >>> 8) & 0xFF;

    payload[8] =
      heap & 0xFF;

    return this.wrapPacket(
      BinaryCommand.CMD_PONG,
      payload
    );
  }

  /**
   * CAN status request.
   */
  public static encodeCanStatusReq(): Uint8Array {
    return this.wrapPacket(
      BinaryCommand.CMD_CAN_STATUS_REQ,
      new Uint8Array(0)
    );
  }

  /**
   * Configure CAN speed and hardware filter.
   *
   * Current ESP32 firmware expects:
   *
   *   payload[0..1] = speed in kbps
   *   payload[2..5] = filter ID
   *   payload[6..9] = filter mask
   *
   * NOTE:
   * The current ESP32 firmware shown earlier only consumes
   * the speed bytes. The filter fields are retained for
   * protocol compatibility and future firmware support.
   */
  public static encodeConfigCan(
    speedKbps: number,
    filterId: number = 0,
    filterMask: number = 0
  ): Uint8Array {
    if (
      !Number.isFinite(speedKbps) ||
      !Number.isInteger(speedKbps) ||
      speedKbps < 0 ||
      speedKbps > 0xFFFF
    ) {
      throw new Error(
        `[PROTO] Invalid CAN speed: ${speedKbps}`
      );
    }

    const normalizedFilterId =
      this.normalizeCanId(filterId);

    if (
      !Number.isInteger(filterMask) ||
      filterMask < 0 ||
      filterMask > 0xFFFFFFFF
    ) {
      throw new Error(
        `[PROTO] Invalid CAN filter mask: ${filterMask}`
      );
    }

    const normalizedFilterMask =
      filterMask >>> 0;

    const payload =
      new Uint8Array(10);

    payload[0] =
      (speedKbps >>> 8) & 0xFF;

    payload[1] =
      speedKbps & 0xFF;

    payload[2] =
      (normalizedFilterId >>> 24) & 0xFF;

    payload[3] =
      (normalizedFilterId >>> 16) & 0xFF;

    payload[4] =
      (normalizedFilterId >>> 8) & 0xFF;

    payload[5] =
      normalizedFilterId & 0xFF;

    payload[6] =
      (normalizedFilterMask >>> 24) & 0xFF;

    payload[7] =
      (normalizedFilterMask >>> 16) & 0xFF;

    payload[8] =
      (normalizedFilterMask >>> 8) & 0xFF;

    payload[9] =
      normalizedFilterMask & 0xFF;

    return this.wrapPacket(
      BinaryCommand.CMD_CONFIG_CAN,
      payload
    );
  }

  /**
   * Wrap a binary packet using the exact wire format.
   */
  public static wrapPacket(
    cmd: BinaryCommand,
    payload: Uint8Array
  ): Uint8Array {
    if (
      !Number.isInteger(cmd) ||
      cmd < 0 ||
      cmd > 0xFF
    ) {
      throw new Error(
        `[PROTO] Invalid command: ${cmd}`
      );
    }

    if (!(payload instanceof Uint8Array)) {
      throw new Error(
        '[PROTO] Payload must be Uint8Array'
      );
    }

    const len =
      payload.length;

    if (
      len < 0 ||
      len > this.MAX_PAYLOAD_SIZE
    ) {
      throw new Error(
        `[PROTO] Payload too large: ${len} > ${this.MAX_PAYLOAD_SIZE}`
      );
    }

    const packetLength =
      2 +       // MAGIC
      1 +       // CMD
      2 +       // LEN
      len +     // PAYLOAD
      1 +       // CHECKSUM
      2;        // TRAILER

    const packet =
      new Uint8Array(packetLength);

    packet[0] =
      this.MAGIC_BYTE_1;

    packet[1] =
      this.MAGIC_BYTE_2;

    packet[2] =
      cmd & 0xFF;

    packet[3] =
      (len >>> 8) & 0xFF;

    packet[4] =
      len & 0xFF;

    packet.set(
      payload,
      5
    );

    const checksum =
      this.computeChecksum(
        cmd,
        len,
        payload
      );

    packet[5 + len] =
      checksum;

    packet[5 + len + 1] =
      this.TRAILER_BYTE_1;

    packet[5 + len + 2] =
      this.TRAILER_BYTE_2;

    this.debug(
      `[PROTO-TX] CMD=0x${cmd
        .toString(16)
        .padStart(2, '0')
        .toUpperCase()} LEN=${len}`
    );

    return packet;
  }

  /**
   * Parse a continuous byte stream.
   *
   * Handles:
   * - partial frames
   * - multiple frames in one read
   * - garbage before AA55
   * - corrupted frames
   * - a trailing single 0xAA byte
   * - a frame split at any byte boundary
   *
   * IMPORTANT:
   * This function does not mutate the supplied buffer.
   */
  public static parseStream(
    streamBuffer: Uint8Array
  ): {
    packets: DecodedBinaryPacket[];
    remainingBuffer: Uint8Array;
  } {
    const packets:
      DecodedBinaryPacket[] = [];

    if (
      !streamBuffer ||
      streamBuffer.length === 0
    ) {
      return {
        packets,
        remainingBuffer:
          new Uint8Array(0)
      };
    }

    let i = 0;

    while (i < streamBuffer.length) {
      /*
       * We need two bytes to decide whether this is
       * the AA55 synchronization header.
       *
       * If only AA remains at the end, preserve it.
       */
      if (
        i + 1 >=
        streamBuffer.length
      ) {
        break;
      }

      /*
       * Search for AA55.
       */
      if (
        streamBuffer[i] !==
          this.MAGIC_BYTE_1 ||
        streamBuffer[i + 1] !==
          this.MAGIC_BYTE_2
      ) {
        i++;
        continue;
      }

      /*
       * We have AA55, but need CMD + LEN(2).
       */
      if (
        i + 5 >
        streamBuffer.length
      ) {
        break;
      }

      const cmd =
        streamBuffer[i + 2] as BinaryCommand;

      const len =
        (
          (streamBuffer[i + 3] << 8) |
          streamBuffer[i + 4]
        ) >>> 0;

      /*
       * Reject impossible payload sizes.
       *
       * Move only one byte forward so another AA55
       * sequence can be found without destroying data.
       */
      if (
        len >
        this.MAX_PAYLOAD_SIZE
      ) {
        this.warn(
          `[PROTO-RX] Invalid payload length=${len}; resynchronizing`
        );

        i++;
        continue;
      }

      const totalExpectedLength =
        2 +       // MAGIC
        1 +       // CMD
        2 +       // LEN
        len +     // PAYLOAD
        1 +       // CHECKSUM
        2;        // TRAILER

      /*
       * Complete frame has not arrived.
       *
       * DO NOT advance i.
       *
       * This is essential for Bluetooth SPP/TCP because
       * one binary packet can be split across multiple
       * transport reads.
       */
      if (
        i + totalExpectedLength >
        streamBuffer.length
      ) {
        break;
      }

      const payloadStart =
        i + 5;

      const payloadEnd =
        payloadStart + len;

      const payload =
        streamBuffer.slice(
          payloadStart,
          payloadEnd
        );

      const checksum =
        streamBuffer[payloadEnd];

      const trailer1 =
        streamBuffer[payloadEnd + 1];

      const trailer2 =
        streamBuffer[payloadEnd + 2];

      let expectedChecksum: number;

      try {
        expectedChecksum =
          this.computeChecksum(
            cmd,
            len,
            payload
          );
      } catch (error) {
        this.warn(
          `[PROTO-RX] Checksum calculation failed: ${String(error)}`
        );

        /*
         * Move one byte only and continue resynchronization.
         */
        i++;
        continue;
      }

      const checksumValid =
        checksum ===
        expectedChecksum;

      const trailerValid =
        trailer1 ===
          this.TRAILER_BYTE_1 &&
        trailer2 ===
          this.TRAILER_BYTE_2;

      if (
        !checksumValid ||
        !trailerValid
      ) {
        this.warn(
          `[PROTO-RX] CORRUPTED_PACKET ` +
          `offset=${i} ` +
          `CMD=0x${cmd
            .toString(16)
            .padStart(2, '0')
            .toUpperCase()} ` +
          `LEN=${len} ` +
          `CS_RX=0x${checksum
            .toString(16)
            .padStart(2, '0')
            .toUpperCase()} ` +
          `CS_EXPECTED=0x${expectedChecksum
            .toString(16)
            .padStart(2, '0')
            .toUpperCase()} ` +
          `TRAILER=0x${trailer1
            .toString(16)
            .padStart(2, '0')
            .toUpperCase()} ` +
          `0x${trailer2
            .toString(16)
            .padStart(2, '0')
            .toUpperCase()}`
        );

        /*
         * Do not discard the whole buffer.
         *
         * Search for another AA55 sequence.
         */
        i++;
        continue;
      }

      const rawFrame =
        streamBuffer.slice(
          i,
          i + totalExpectedLength
        );

      const decoded =
        this.decodePacket(
          cmd,
          payload,
          rawFrame
        );

      if (decoded.isValid) {
        packets.push(decoded);
      } else {
        this.warn(
          `[PROTO-RX] INVALID_PACKET ` +
          `CMD=0x${cmd
            .toString(16)
            .padStart(2, '0')
            .toUpperCase()} ` +
          `LEN=${len}`
        );
      }

      /*
       * This complete frame has been consumed.
       */
      i +=
        totalExpectedLength;
    }

    /*
     * Preserve every byte that has not been completely
     * processed.
     *
     * Especially important:
     * - partial AA55 header
     * - partial CMD/LEN
     * - partial payload
     * - partial checksum/trailer
     */
    const remainingBuffer =
      streamBuffer.slice(i);

    return {
      packets,
      remainingBuffer
    };
  }

  /**
   * Decode one already validated binary packet.
   *
   * Framing checksum/trailer validation has already happened
   * inside parseStream().
   */
  private static decodePacket(
    cmd: BinaryCommand,
    payload: Uint8Array,
    rawFrame: Uint8Array
  ): DecodedBinaryPacket {
    const result:
      DecodedBinaryPacket = {
        cmd,
        payload,
        rawFrame,
        isValid: true
      };

    // ==========================================================
    // CAN FRAME
    // ==========================================================
    if (
      cmd ===
      BinaryCommand.CMD_CAN_FRAME
    ) {
      if (
        payload.length <
        this.CAN_MIN_PAYLOAD_SIZE
      ) {
        this.warn(
          `[CAN-RX] Invalid CAN payload length=${payload.length}`
        );

        result.isValid = false;
        return result;
      }

      const canId =
        (
          (payload[0] << 24) |
          (payload[1] << 16) |
          (payload[2] << 8) |
          payload[3]
        ) >>> 0;

      const flags =
        payload[4];

      const dlc =
        payload[5];

      /*
       * Only two flag bits are currently defined:
       *
       * bit 0 = EXT
       * bit 1 = RTR
       *
       * Bits 2..7 must remain zero for the current protocol.
       */
      if (
        (flags & 0xFC) !== 0
      ) {
        this.warn(
          `[CAN-RX] Invalid CAN flags=0x${flags
            .toString(16)
            .padStart(2, '0')
            .toUpperCase()}`
        );

        result.isValid = false;
        return result;
      }

      if (
        dlc >
        this.CAN_MAX_DLC
      ) {
        this.warn(
          `[CAN-RX] Invalid CAN DLC=${dlc}`
        );

        result.isValid = false;
        return result;
      }

      const requiredLength =
        this.CAN_MIN_PAYLOAD_SIZE +
        dlc;

      /*
       * The current protocol does not allow a declared DLC
       * to exceed the bytes actually present.
       */
      if (
        payload.length <
        requiredLength
      ) {
        this.warn(
          `[CAN-RX] CAN DLC/data mismatch: ` +
          `DLC=${dlc}, ` +
          `payload=${payload.length}, ` +
          `required=${requiredLength}`
        );

        result.isValid = false;
        return result;
      }

      const isExtended =
        (flags & 0x01) !== 0;

      const isRtr =
        (flags & 0x02) !== 0;

      /*
       * Standard CAN identifier must be 11-bit.
       */
      if (
        !isExtended &&
        canId > 0x7FF
      ) {
        this.warn(
          `[CAN-RX] Invalid standard CAN ID=0x${canId
            .toString(16)
            .toUpperCase()}`
        );

        result.isValid = false;
        return result;
      }

      /*
       * Extended CAN identifier must be <= 29-bit.
       */
      if (
        isExtended &&
        canId > 0x1FFFFFFF
      ) {
        this.warn(
          `[CAN-RX] Invalid extended CAN ID=0x${canId
            .toString(16)
            .toUpperCase()}`
        );

        result.isValid = false;
        return result;
      }

      const dataBytes =
        Array.from(
          payload.slice(
            6,
            6 + dlc
          )
        );

      const dataHex =
        dataBytes
          .map(
            byte =>
              byte
                .toString(16)
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

      /*
       * Preserve the current CanFrame shape for compatibility.
       *
       * RTR is part of the binary frame flags, but the current
       * CanFrame type/API shown in this project does not expose
       * an isRtr property. We therefore do NOT invent a new
       * field here. The next types/protocol revision should add
       * it properly.
       */
      result.canFrame = {
        id: idHex,
        dlc,
        dataHex,
        dataBytes,
        direction: 'Rx',
        isExtended
      };

      /*
       * Do not log every received CAN frame by default.
       * CAN traffic can be hundreds/thousands of frames per
       * second and console logging can itself cause UI lag.
       */
      this.debug(
        `[CAN-RX-PACKET] ` +
        `ID=${idHex} ` +
        `EXT=${isExtended ? 1 : 0} ` +
        `RTR=${isRtr ? 1 : 0} ` +
        `DLC=${dlc} ` +
        `DATA=[${dataHex}]`
      );

      return result;
    }

    // ==========================================================
    // PONG
    // ==========================================================
    if (
      cmd ===
      BinaryCommand.CMD_PONG
    ) {
      if (
        payload.length < 9
      ) {
        this.warn(
          `[PONG] Invalid payload length=${payload.length}`
        );

        result.isValid = false;
        return result;
      }

      const uptimeMs =
        (
          (payload[0] << 24) |
          (payload[1] << 16) |
          (payload[2] << 8) |
          payload[3]
        ) >>> 0;

      const canReady =
        payload[4] === 0x01;

      const freeHeapBytes =
        (
          (payload[5] << 24) |
          (payload[6] << 16) |
          (payload[7] << 8) |
          payload[8]
        ) >>> 0;

      result.pongInfo = {
        uptimeMs,
        canReady,
        freeHeapBytes
      };

      return result;
    }

    // ==========================================================
    // CAN STATUS
    // ==========================================================
    if (
      cmd ===
      BinaryCommand.CMD_CAN_STATUS_RESP
    ) {
      /*
       * Current ESP32 firmware sends:
       *
       * 0       State
       * 1..4    Speed
       * 5       TX error
       * 6       RX error
       * 7..8    RX overrun
       * 9       RX queue
       * 10..13  Messages sent
       * 14..17  Messages received
       * 18..20  Currently unused/reserved
       */
      if (
        payload.length < 21
      ) {
        this.warn(
          `[CAN-STATUS] Invalid payload length=${payload.length}, expected >=21`
        );

        result.isValid = false;
        return result;
      }

      const stateCode =
        payload[0];

      const speed =
        (
          (payload[1] << 24) |
          (payload[2] << 16) |
          (payload[3] << 8) |
          payload[4]
        ) >>> 0;

      const txErrorCount =
        payload[5];

      const rxErrorCount =
        payload[6];

      const busOverrunCount =
        (
          (payload[7] << 8) |
          payload[8]
        ) >>> 0;

      const queueSize =
        payload[9];

      const messagesSent =
        (
          (payload[10] << 24) |
          (payload[11] << 16) |
          (payload[12] << 8) |
          payload[13]
        ) >>> 0;

      const messagesReceived =
        (
          (payload[14] << 24) |
          (payload[15] << 16) |
          (payload[16] << 8) |
          payload[17]
        ) >>> 0;

      let stateStr:
        CanBusStatus['state'] =
        'READY';

      if (
        stateCode === 1
      ) {
        stateStr = 'STOPPED';
      } else if (
        stateCode === 2
      ) {
        stateStr = 'BUS_OFF';
      } else if (
        stateCode === 3
      ) {
        stateStr = 'ERROR';
      } else if (
        stateCode === 4
      ) {
        stateStr = 'RECOVERING';
      }

      /*
       * IMPORTANT:
       *
       * The current ESP32 status payload contains no field
       * describing whether the configured CAN addressing is
       * standard 11-bit or extended 29-bit.
       *
       * Therefore there is no legitimate way to derive the
       * mode from this packet.
       *
       * The current CanBusStatus type/API requires a mode
       * value, so the legacy value is retained solely for
       * TypeScript/API compatibility. The actual CAN frame
       * itself remains authoritative through canFrame.isExtended.
       *
       * This must be corrected at the type/protocol level in
       * the next coordinated firmware revision.
       */
      result.canStatus = {
        state: stateStr,
        speed,
        mode: '11-BIT',
        txErrorCount,
        rxErrorCount,
        busOverrunCount,
        queueSize,
        messagesSent,
        messagesReceived
      };

      return result;
    }

    // ==========================================================
    // K-LINE INIT RESPONSE
    // ==========================================================
    if (
      cmd ===
      BinaryCommand.CMD_KLINE_INIT_RESP
    ) {
      if (
        payload.length < 2
      ) {
        this.warn(
          `[KLINE-INIT] Invalid payload length=${payload.length}`
        );

        result.isValid = false;
        return result;
      }

      const statusCode =
        payload[0];

      const protoByte =
        payload[1];

      const kb1 =
        payload.length >= 3
          ? payload[2]
          : 0;

      const kb2 =
        payload.length >= 4
          ? payload[3]
          : 0;

      let protoText: ProtocolType = 'ISO 9141-2';
      if (protoByte === 0x01) protoText = 'ISO 9141-2';
      else if (protoByte === 0x02) protoText = 'ISO 14230-4 (KWP2000 Slow)';
      else if (protoByte === 0x04) protoText = 'ISO 14230-4 (KWP2000 Fast)';
      else if (protoByte === 0x05) protoText = 'ISO 14230-4 (KWP2000 Slow)';
      else if (protoByte === 0x06) protoText = 'ISO 15765-4 (CAN 11/500)';
      else if (protoByte === 0x07) protoText = 'ISO 15765-4 (CAN 29/500)';
      else if (protoByte === 0x08) protoText = 'ISO 15765-4 (CAN 11/250)';
      else if (protoByte === 0x09) protoText = 'ISO 15765-4 (CAN 29/250)';

      let statusText = 'SUCCESS';
      if (statusCode === 0x01) statusText = 'NO_KLINE_VOLTAGE';
      else if (statusCode === 0x02) statusText = 'INIT_FAILED';
      else if (statusCode === 0x03) statusText = 'KEYBYTE_MISMATCH';
      else if (statusCode === 0x04) statusText = 'ECU_NO_RESPONSE';
      else if (statusCode === 0x05) statusText = 'CHECKSUM_ERROR';
      else if (statusCode === 0x06) statusText = 'CAN_ERROR';
      else if (statusCode === 0x07) statusText = 'BUSY';

      result.klineInitResp = {
        statusCode,
        statusText,
        activeProtocol: protoText,
        keyBytes: [kb1, kb2]
      };

      result.klineInitResult = {
        success:
          statusCode === 0x00,
        activeProtocol:
          protoByte,
        keyByte1:
          kb1,
        keyByte2:
          kb2
      };

      return result;
    }

    // ==========================================================
    // K-LINE FRAME RESPONSE
    // ==========================================================
    if (
      cmd ===
      BinaryCommand.CMD_KLINE_FRAME
    ) {
      if (
        payload.length < 1
      ) {
        this.warn(
          `[KLINE-FRAME] Invalid empty response`
        );

        result.isValid = false;
        return result;
      }

      const statusCode =
        payload[0];

      const dataBytes =
        Array.from(
          payload.slice(1)
        );

      const rawHex =
        dataBytes
          .map(
            byte =>
              byte
                .toString(16)
                .padStart(2, '0')
                .toUpperCase()
          )
          .join(' ');

      result.klineFrame = {
        statusCode,
        dataBytes,
        rawHex
      };

      result.klineFrameResult = {
        status:
          statusCode,
        data:
          dataBytes
      };

      return result;
    }

    // ==========================================================
    // K-LINE STATUS
    // ==========================================================
    if (
      cmd ===
      BinaryCommand.CMD_KLINE_STATUS_RESP
    ) {
      if (
        payload.length < 7
      ) {
        this.warn(
          `[KLINE-STATUS] Invalid payload length=${payload.length}`
        );

        result.isValid = false;
        return result;
      }

      const voltageOk =
        payload[0] === 0x01;

      const protoByte =
        payload[1];

      const initialized =
        payload[2] === 0x01;

      const rxErrorCount =
        (
          (payload[3] << 8) |
          payload[4]
        ) >>> 0;

      const txErrorCount =
        (
          (payload[5] << 8) |
          payload[6]
        ) >>> 0;

      const errCodeByte =
        payload.length >= 8
          ? payload[7]
          : 0;

      let protoText: ProtocolType = 'ISO 9141-2';
      if (protoByte === 0x01) protoText = 'ISO 9141-2';
      else if (protoByte === 0x02) protoText = 'ISO 14230-4 (KWP2000 Slow)';
      else if (protoByte === 0x04) protoText = 'ISO 14230-4 (KWP2000 Fast)';
      else if (protoByte === 0x05) protoText = 'ISO 14230-4 (KWP2000 Slow)';
      else if (protoByte === 0x06) protoText = 'ISO 15765-4 (CAN 11/500)';
      else if (protoByte === 0x07) protoText = 'ISO 15765-4 (CAN 29/500)';
      else if (protoByte === 0x08) protoText = 'ISO 15765-4 (CAN 11/250)';
      else if (protoByte === 0x09) protoText = 'ISO 15765-4 (CAN 29/250)';

      let lastErr:
        KlineStatus['lastErrorCode'] =
        'KLINE_OK';

      if (
        errCodeByte === 0x01
      ) {
        lastErr =
          'NO_KLINE_VOLTAGE';
      } else if (
        errCodeByte === 0x02
      ) {
        lastErr =
          'INIT_FAILED';
      } else if (
        errCodeByte === 0x03
      ) {
        lastErr =
          'NO_ECU_RESPONSE';
      } else if (
        errCodeByte === 0x04
      ) {
        lastErr =
          'CHECKSUM_ERROR';
      } else if (
        errCodeByte === 0x05
      ) {
        lastErr =
          'TIMEOUT';
      }

      result.klineStatus = {
        voltageOk,
        activeProtocol:
          protoText,
        initialized,
        rxErrorCount,
        txErrorCount,
        lastErrorCode:
          lastErr
      };

      return result;
    }

    // ==========================================================
    // ERROR RESPONSE (CMD_ERROR_RESP = 0x0E)
    // ==========================================================
    if (cmd === BinaryCommand.CMD_ERROR_RESP) {
      const failedCmd = payload.length >= 1 ? payload[0] : 0;
      const statusCode = payload.length >= 2 ? payload[1] : 0x02;
      const statusInfo = decodeFirmwareStatusCode(statusCode);

      result.errorResp = {
        failedCmd,
        statusCode,
        statusText: statusInfo.codeName,
        descriptionEn: statusInfo.descriptionEn,
        descriptionAr: statusInfo.descriptionAr
      };

      this.warn(
        `[CMD_ERROR_RESP] Failed CMD=0x${failedCmd.toString(16).padStart(2, '0').toUpperCase()}, ` +
        `Status=0x${statusCode.toString(16).padStart(2, '0').toUpperCase()} (${statusInfo.codeName}: ${statusInfo.descriptionEn})`
      );

      return result;
    }

    // ==========================================================
    // UNKNOWN COMMAND
    // ==========================================================
    /*
     * Framing was valid, therefore unknown commands are still
     * valid binary packets.
     *
     * This allows newer firmware to add commands without
     * breaking older application versions.
     */
    return result;
  }

  /**
   * Configure protocol.
   *
   * ESP32 Firmware V7 protocol IDs:
   *
   * 0x00 = AUTO
   * 0x01 = ISO9141 (ISO 9141-2)
   * 0x02 = KWP 5-Baud (ISO 14230-4 KWP2000 5-Baud)
   * 0x04 = KWP Fast (ISO 14230-4 KWP2000 Fast)
   * 0x05 = KWP Slow (ISO 14230-4 KWP2000 Slow)
   * 0x06 = CAN 11-bit / 500k
   * 0x07 = CAN 29-bit / 500k
   * 0x08 = CAN 11-bit / 250k
   * 0x09 = CAN 29-bit / 250k
   */
  public static encodeConfigProtocol(
    protocolId: number
  ): Uint8Array {
    if (
      !Number.isInteger(protocolId) ||
      protocolId < 0 ||
      protocolId > 0xFF
    ) {
      throw new Error(
        `[PROTO] Invalid protocol ID: ${protocolId}`
      );
    }

    return this.wrapPacket(
      BinaryCommand.CMD_CONFIG_PROTOCOL,
      new Uint8Array([
        protocolId
      ])
    );
  }

  /**
   * K-Line initialization.
   */
  public static encodeKlineInit(
    protocolId: number = 0x00
  ): Uint8Array {
    if (
      !Number.isInteger(protocolId) ||
      protocolId < 0 ||
      protocolId > 0xFF
    ) {
      throw new Error(
        `[PROTO] Invalid K-Line protocol ID: ${protocolId}`
      );
    }

    return this.wrapPacket(
      BinaryCommand.CMD_KLINE_INIT,
      new Uint8Array([
        protocolId
      ])
    );
  }

  /**
   * K-Line diagnostic frame.
   */
  public static encodeKlineFrame(
    frameBytes: number[]
  ): Uint8Array {
    if (
      !Array.isArray(frameBytes)
    ) {
      throw new Error(
        '[PROTO] K-Line frame must be an array'
      );
    }

    if (
      frameBytes.length === 0
    ) {
      throw new Error(
        '[PROTO] K-Line frame cannot be empty'
      );
    }

    /*
     * MAX_PAYLOAD_SIZE applies to the binary packet payload.
     * K-Line frame is itself the payload here.
     */
    if (
      frameBytes.length >
      this.MAX_PAYLOAD_SIZE
    ) {
      throw new Error(
        `[PROTO] Invalid K-Line frame length=${frameBytes.length}`
      );
    }

    const payload =
      new Uint8Array(
        frameBytes.length
      );

    for (
      let i = 0;
      i < frameBytes.length;
      i++
    ) {
      payload[i] =
        this.normalizeByte(
          frameBytes[i],
          `K-Line frame[${i}]`
        );
    }

    return this.wrapPacket(
      BinaryCommand.CMD_KLINE_FRAME,
      payload
    );
  }

  /**
   * K-Line status request.
   */
  public static encodeKlineStatusReq(): Uint8Array {
    return this.wrapPacket(
      BinaryCommand.CMD_KLINE_STATUS_REQ,
      new Uint8Array(0)
    );
  }
}
