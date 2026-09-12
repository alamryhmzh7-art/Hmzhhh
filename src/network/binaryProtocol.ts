/**
 * HAMZA OBD PRO - Unified Binary Frame Protocol
 *
 * Wire format:
 * [0xAA 0x55]
 * [CMD (1B)]
 * [LEN (2B, Big Endian)]
 * [PAYLOAD (N Bytes)]
 * [CHECKSUM (1B, XOR)]
 * [0x0D 0x0A]
 *
 * IMPORTANT:
 * This implementation is kept compatible with the current
 * ESP32 firmware protocol.
 */

import {
  CanFrame,
  CanBusStatus,
  KlineStatus,
  ProtocolType
} from '../types';

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
   * Maximum payload currently supported by the ESP32
   * binary transport frame.
   *
   * Normal CAN packet payload is only 6..14 bytes.
   */
  public static readonly MAX_PAYLOAD_SIZE = 256;

  public static readonly CAN_MIN_PAYLOAD_SIZE = 6;
  public static readonly CAN_MAX_DLC = 8;

  /**
   * Compute XOR checksum.
   *
   * ESP32 uses exactly:
   * cmd ^ LEN_HIGH ^ LEN_LOW ^ every payload byte
   */
  public static computeChecksum(
    cmd: number,
    len: number,
    payload: Uint8Array | number[]
  ): number {
    let checksum =
      (cmd & 0xFF) ^
      ((len >> 8) & 0xFF) ^
      (len & 0xFF);

    for (let i = 0; i < payload.length; i++) {
      checksum ^= payload[i] & 0xFF;
    }

    return checksum & 0xFF;
  }

  /**
   * Convert CAN ID to unsigned 32-bit value.
   */
  private static normalizeCanId(canId: number): number {
    if (!Number.isFinite(canId)) {
      throw new Error('[PROTO] Invalid CAN ID');
    }

    if (!Number.isInteger(canId)) {
      throw new Error('[PROTO] CAN ID must be an integer');
    }

    if (canId < 0 || canId > 0x1FFFFFFF) {
      throw new Error(
        `[PROTO] CAN ID out of range: 0x${canId.toString(16)}`
      );
    }

    return canId >>> 0;
  }

  /**
   * Encode CAN frame.
   *
   * Payload:
   * [ID 4B][FLAGS 1B][DLC 1B][DATA 0..8B]
   *
   * FLAGS:
   * bit 0 = Extended CAN ID
   * bit 1 = RTR
   */
  public static encodeCanFrame(
    canId: number,
    data: number[] | Uint8Array,
    isExtended: boolean = false,
    isRtr: boolean = false
  ): Uint8Array {
    const normalizedId = this.normalizeCanId(canId);

    if (!isExtended && normalizedId > 0x7FF) {
      throw new Error(
        `[PROTO] Standard 11-bit CAN ID exceeds 0x7FF: 0x${normalizedId
          .toString(16)
          .toUpperCase()}`
      );
    }

    const dlc = Math.min(
      this.CAN_MAX_DLC,
      Math.max(0, data.length)
    );

    const flags =
      (isExtended ? 0x01 : 0x00) |
      (isRtr ? 0x02 : 0x00);

    const payload = new Uint8Array(6 + dlc);

    payload[0] = (normalizedId >>> 24) & 0xFF;
    payload[1] = (normalizedId >>> 16) & 0xFF;
    payload[2] = (normalizedId >>> 8) & 0xFF;
    payload[3] = normalizedId & 0xFF;

    payload[4] = flags;
    payload[5] = dlc;

    for (let i = 0; i < dlc; i++) {
      payload[6 + i] = data[i] & 0xFF;
    }

    return this.wrapPacket(
      BinaryCommand.CMD_CAN_FRAME,
      payload
    );
  }

  /**
   * Encode PING request.
   *
   * Current ESP32 firmware only requires the command itself,
   * but keeps compatibility with the existing 8-byte timestamp.
   */
  public static encodePing(): Uint8Array {
    const timestamp = BigInt(Date.now());
    const payload = new Uint8Array(8);

    for (let i = 0; i < 8; i++) {
      payload[7 - i] = Number(
        (timestamp >> BigInt(i * 8)) & 0xFFn
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
    const payload = new Uint8Array(9);

    const uptime = uptimeMs >>> 0;
    const heap = freeHeapBytes >>> 0;

    payload[0] = (uptime >>> 24) & 0xFF;
    payload[1] = (uptime >>> 16) & 0xFF;
    payload[2] = (uptime >>> 8) & 0xFF;
    payload[3] = uptime & 0xFF;

    payload[4] = canReady ? 0x01 : 0x00;

    payload[5] = (heap >>> 24) & 0xFF;
    payload[6] = (heap >>> 16) & 0xFF;
    payload[7] = (heap >>> 8) & 0xFF;
    payload[8] = heap & 0xFF;

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
   * Configure CAN speed.
   *
   * Compatible with ESP32 firmware:
   * payload[0..1] = speed in kbps
   * payload[2..5] = filter ID
   * payload[6..9] = filter mask
   */
  public static encodeConfigCan(
    speedKbps: number,
    filterId: number = 0,
    filterMask: number = 0
  ): Uint8Array {
    if (
      !Number.isFinite(speedKbps) ||
      speedKbps < 0 ||
      speedKbps > 0xFFFF
    ) {
      throw new Error(
        `[PROTO] Invalid CAN speed: ${speedKbps}`
      );
    }

    const normalizedFilterId =
      this.normalizeCanId(filterId);

    const normalizedFilterMask =
      filterMask >>> 0;

    const payload = new Uint8Array(10);

    payload[0] = (speedKbps >>> 8) & 0xFF;
    payload[1] = speedKbps & 0xFF;

    payload[2] = (normalizedFilterId >>> 24) & 0xFF;
    payload[3] = (normalizedFilterId >>> 16) & 0xFF;
    payload[4] = (normalizedFilterId >>> 8) & 0xFF;
    payload[5] = normalizedFilterId & 0xFF;

    payload[6] = (normalizedFilterMask >>> 24) & 0xFF;
    payload[7] = (normalizedFilterMask >>> 16) & 0xFF;
    payload[8] = (normalizedFilterMask >>> 8) & 0xFF;
    payload[9] = normalizedFilterMask & 0xFF;

    return this.wrapPacket(
      BinaryCommand.CMD_CONFIG_CAN,
      payload
    );
  }

  /**
   * Wrap packet using the exact ESP32 wire format.
   */
  public static wrapPacket(
    cmd: BinaryCommand,
    payload: Uint8Array
  ): Uint8Array {
    const len = payload.length;

    if (len > this.MAX_PAYLOAD_SIZE) {
      throw new Error(
        `[PROTO] Payload too large: ${len} > ${this.MAX_PAYLOAD_SIZE}`
      );
    }

    const packetLength =
      2 + 1 + 2 + len + 1 + 2;

    const packet = new Uint8Array(packetLength);

    packet[0] = this.MAGIC_BYTE_1;
    packet[1] = this.MAGIC_BYTE_2;

    packet[2] = cmd & 0xFF;

    packet[3] = (len >>> 8) & 0xFF;
    packet[4] = len & 0xFF;

    packet.set(payload, 5);

    const checksum =
      this.computeChecksum(cmd, len, payload);

    packet[5 + len] = checksum;

    packet[5 + len + 1] =
      this.TRAILER_BYTE_1;

    packet[5 + len + 2] =
      this.TRAILER_BYTE_2;

    console.log(
      `[PROTO-TX] CMD=0x${cmd
        .toString(16)
        .padStart(2, '0')
        .toUpperCase()} LEN=${len}`
    );

    return packet;
  }

  /**
   * Parse a continuous transport stream.
   *
   * Supports:
   * - partial frames
   * - multiple frames in one read
   * - corrupted frames
   * - garbage bytes before a valid AA55 header
   */
  public static parseStream(
    streamBuffer: Uint8Array
  ): {
    packets: DecodedBinaryPacket[];
    remainingBuffer: Uint8Array;
  } {
    const packets: DecodedBinaryPacket[] = [];

    if (!streamBuffer || streamBuffer.length === 0) {
      return {
        packets,
        remainingBuffer: new Uint8Array(0)
      };
    }

    let i = 0;

    while (i < streamBuffer.length) {
      /*
       * We need at least:
       * AA 55 CMD LEN_H LEN_L CS 0D 0A
       * = 8 bytes for an empty payload.
       *
       * The old parser used 7 here, which was one byte short.
       */
      if (i + 5 > streamBuffer.length) {
        break;
      }

      if (
        streamBuffer[i] !== this.MAGIC_BYTE_1 ||
        streamBuffer[i + 1] !== this.MAGIC_BYTE_2
      ) {
        i++;
        continue;
      }

      const cmd =
        streamBuffer[i + 2] as BinaryCommand;

      const len =
        ((streamBuffer[i + 3] << 8) |
          streamBuffer[i + 4]) >>> 0;

      if (len > this.MAX_PAYLOAD_SIZE) {
        console.warn(
          `[PROTO-RX] Invalid payload length=${len}; resynchronizing`
        );

        i++;
        continue;
      }

      const totalExpectedLength =
        2 + 1 + 2 + len + 1 + 2;

      /*
       * Complete frame has not arrived yet.
       * Keep everything from AA55 onward.
       */
      if (
        i + totalExpectedLength >
        streamBuffer.length
      ) {
        break;
      }

      const payloadStart = i + 5;
      const payloadEnd = payloadStart + len;

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

      const expectedChecksum =
        this.computeChecksum(
          cmd,
          len,
          payload
        );

      const checksumValid =
        checksum === expectedChecksum;

      const trailerValid =
        trailer1 === this.TRAILER_BYTE_1 &&
        trailer2 === this.TRAILER_BYTE_2;

      if (!checksumValid || !trailerValid) {
        console.warn(
          `[PROTO-RX] CORRUPTED_PACKET offset=${i} ` +
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
            .toUpperCase()}`
        );

        /*
         * Do not discard everything.
         * Move one byte forward and search for the next AA55.
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

      /*
       * decodePacket can mark malformed payloads
       * invalid. Do not expose malformed CAN packets
       * as valid packets.
       */
      if (decoded.isValid) {
        packets.push(decoded);
      } else {
        console.warn(
          `[PROTO-RX] INVALID_PACKET CMD=0x${cmd
            .toString(16)
            .padStart(2, '0')
            .toUpperCase()} LEN=${len}`
        );
      }

      i += totalExpectedLength;
    }

    /*
     * Keep only unprocessed bytes.
     *
     * If the parser stopped at a partial AA55 frame,
     * those bytes remain for the next transport read.
     */
    const remainingBuffer =
      streamBuffer.slice(i);

    return {
      packets,
      remainingBuffer
    };
  }

  /**
   * Decode one validated binary packet.
   */
  private static decodePacket(
    cmd: BinaryCommand,
    payload: Uint8Array,
    rawFrame: Uint8Array
  ): DecodedBinaryPacket {
    const result: DecodedBinaryPacket = {
      cmd,
      payload,
      rawFrame,
      isValid: true
    };

    // ----------------------------------------------------------
    // CAN FRAME
    // ----------------------------------------------------------
    if (cmd === BinaryCommand.CMD_CAN_FRAME) {
      if (
        payload.length <
        this.CAN_MIN_PAYLOAD_SIZE
      ) {
        console.warn(
          `[CAN-RX] Invalid CAN payload length=${payload.length}`
        );

        result.isValid = false;
        return result;
      }

      const canId =
        (((payload[0] << 24) |
          (payload[1] << 16) |
          (payload[2] << 8) |
          payload[3]) >>> 0);

      const flags = payload[4];
      const dlc = payload[5];

      /*
       * Only bits 0 and 1 are currently defined:
       * bit0 = EXT
       * bit1 = RTR
       */
      if ((flags & 0xFC) !== 0) {
        console.warn(
          `[CAN-RX] Invalid CAN flags=0x${flags
            .toString(16)
            .padStart(2, '0')}`
        );

        result.isValid = false;
        return result;
      }

      if (dlc > this.CAN_MAX_DLC) {
        console.warn(
          `[CAN-RX] Invalid CAN DLC=${dlc}`
        );

        result.isValid = false;
        return result;
      }

      const requiredLength = 6 + dlc;

      if (payload.length < requiredLength) {
        console.warn(
          `[CAN-RX] CAN DLC/data mismatch: ` +
          `DLC=${dlc}, payload=${payload.length}, ` +
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
       * Validate identifier according to frame type.
       */
      if (
        (!isExtended && canId > 0x7FF) ||
        (isExtended && canId > 0x1FFFFFFF)
      ) {
        console.warn(
          `[CAN-RX] Invalid CAN ID=0x${canId
            .toString(16)
            .toUpperCase()} EXT=${isExtended}`
        );

        result.isValid = false;
        return result;
      }

      const dataBytes =
        Array.from(
          payload.slice(6, 6 + dlc)
        );

      const dataHex =
        dataBytes
          .map(b =>
            b.toString(16)
              .padStart(2, '0')
              .toUpperCase()
          )
          .join(' ');

      const idHex = isExtended
        ? `0x${canId
            .toString(16)
            .padStart(8, '0')
            .toUpperCase()}`
        : `0x${canId
            .toString(16)
            .padStart(3, '0')
            .toUpperCase()}`;

      result.canFrame = {
        id: idHex,
        dlc,
        dataHex,
        dataBytes,
        direction: 'Rx',
        isExtended
      };

      console.log(
        `[CAN-RX-PACKET] ID=${idHex} ` +
        `EXT=${isExtended ? 1 : 0} ` +
        `RTR=${isRtr ? 1 : 0} ` +
        `DLC=${dlc} ` +
        `DATA=[${dataHex}]`
      );

      return result;
    }

    // ----------------------------------------------------------
    // PONG
    // ----------------------------------------------------------
    if (cmd === BinaryCommand.CMD_PONG) {
      if (payload.length < 9) {
        console.warn(
          `[PONG] Invalid payload length=${payload.length}`
        );

        result.isValid = false;
        return result;
      }

      const uptimeMs =
        (((payload[0] << 24) |
          (payload[1] << 16) |
          (payload[2] << 8) |
          payload[3]) >>> 0);

      const canReady =
        payload[4] === 0x01;

      const freeHeapBytes =
        (((payload[5] << 24) |
          (payload[6] << 16) |
          (payload[7] << 8) |
          payload[8]) >>> 0);

      result.pongInfo = {
        uptimeMs,
        canReady,
        freeHeapBytes
      };

      return result;
    }

    // ----------------------------------------------------------
    // CAN STATUS
    // ----------------------------------------------------------
    if (
      cmd === BinaryCommand.CMD_CAN_STATUS_RESP
    ) {
      /*
       * Current ESP32 firmware sends exactly 21 bytes.
       *
       * Used fields:
       * 0      State
       * 1..4   Speed
       * 5      TX error
       * 6      RX error
       * 7..8   RX overrun
       * 9      RX queue
       * 10..13 Messages sent
       * 14..17 Messages received
       *
       * Bytes 18..20 are currently reserved/unused.
       */
      if (payload.length < 21) {
        console.warn(
          `[CAN-STATUS] Invalid payload length=${payload.length}, expected >=21`
        );

        result.isValid = false;
        return result;
      }

      const stateCode = payload[0];

      const speed =
        (((payload[1] << 24) |
          (payload[2] << 16) |
          (payload[3] << 8) |
          payload[4]) >>> 0);

      const txErrorCount =
        payload[5];

      const rxErrorCount =
        payload[6];

      const busOverrunCount =
        ((payload[7] << 8) |
          payload[8]) >>> 0;

      const queueSize =
        payload[9];

      const messagesSent =
        (((payload[10] << 24) |
          (payload[11] << 16) |
          (payload[12] << 8) |
          payload[13]) >>> 0);

      const messagesReceived =
        (((payload[14] << 24) |
          (payload[15] << 16) |
          (payload[16] << 8) |
          payload[17]) >>> 0);

      let stateStr: CanBusStatus['state'] =
        'READY';

      if (stateCode === 1) {
        stateStr = 'STOPPED';
      } else if (stateCode === 2) {
        stateStr = 'BUS_OFF';
      } else if (stateCode === 3) {
        stateStr = 'ERROR';
      } else if (stateCode === 4) {
        stateStr = 'RECOVERING';
      }

      /*
       * IMPORTANT:
       * The current ESP32 status packet does NOT contain
       * a CAN extended/standard mode field.
       *
       * Therefore we must not invent 29-bit/11-bit information.
       * Keep the existing type-compatible default until the
       * protocol is extended properly.
       */
      result.canStatus = {
        state: stateStr,
        speed: speed || 500000,
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

    // ----------------------------------------------------------
    // K-LINE INIT RESPONSE
    // ----------------------------------------------------------
    if (
      cmd === BinaryCommand.CMD_KLINE_INIT_RESP
    ) {
      if (payload.length < 2) {
        console.warn(
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

      let protoText: ProtocolType =
        'ISO 9141-2';

      if (protoByte === 0x01) {
        protoText =
          'ISO 15765-4 (CAN 11/500)';
      } else if (protoByte === 0x02) {
        protoText =
          'ISO 15765-4 (CAN 29/500)';
      } else if (protoByte === 0x03) {
        protoText =
          'ISO 15765-4 (CAN 11/250)';
      } else if (protoByte === 0x04) {
        protoText =
          'ISO 15765-4 (CAN 29/250)';
      } else if (protoByte === 0x06) {
        protoText =
          'ISO 14230-4 (KWP2000 Fast)';
      } else if (protoByte === 0x07) {
        protoText =
          'ISO 14230-4 (KWP2000 Slow)';
      } else if (protoByte === 0x05) {
        protoText =
          'ISO 9141-2';
      }

      let statusText = 'SUCCESS';

      if (statusCode === 0x01) {
        statusText = 'NO_KLINE_VOLTAGE';
      } else if (statusCode === 0x02) {
        statusText = 'INIT_FAILED';
      } else if (statusCode === 0x03) {
        statusText = 'KEYBYTE_MISMATCH';
      } else if (statusCode === 0x04) {
        statusText = 'ECU_NO_RESPONSE';
      } else if (statusCode === 0x05) {
        statusText = 'CHECKSUM_ERROR';
      }

      result.klineInitResp = {
        statusCode,
        statusText,
        activeProtocol: protoText,
        keyBytes: [kb1, kb2]
      };

      result.klineInitResult = {
        success: statusCode === 0x00,
        activeProtocol: protoByte,
        keyByte1: kb1,
        keyByte2: kb2
      };

      return result;
    }

    // ----------------------------------------------------------
    // K-LINE FRAME RESPONSE
    // ----------------------------------------------------------
    if (
      cmd === BinaryCommand.CMD_KLINE_FRAME
    ) {
      if (payload.length < 1) {
        console.warn(
          `[KLINE-FRAME] Invalid empty response`
        );

        result.isValid = false;
        return result;
      }

      const statusCode =
        payload[0];

      const dataBytes =
        Array.from(payload.slice(1));

      const rawHex =
        dataBytes
          .map(b =>
            b.toString(16)
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
        status: statusCode,
        data: dataBytes
      };

      return result;
    }

    // ----------------------------------------------------------
    // K-LINE STATUS
    // ----------------------------------------------------------
    if (
      cmd === BinaryCommand.CMD_KLINE_STATUS_RESP
    ) {
      if (payload.length < 7) {
        console.warn(
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
        ((payload[3] << 8) |
          payload[4]) >>> 0;

      const txErrorCount =
        ((payload[5] << 8) |
          payload[6]) >>> 0;

      const errCodeByte =
        payload.length >= 8
          ? payload[7]
          : 0;

      let protoText: ProtocolType =
        'ISO 9141-2';

      if (protoByte === 0x01) {
        protoText =
          'ISO 15765-4 (CAN 11/500)';
      } else if (protoByte === 0x02) {
        protoText =
          'ISO 15765-4 (CAN 29/500)';
      } else if (protoByte === 0x03) {
        protoText =
          'ISO 15765-4 (CAN 11/250)';
      } else if (protoByte === 0x04) {
        protoText =
          'ISO 15765-4 (CAN 29/250)';
      } else if (protoByte === 0x06) {
        protoText =
          'ISO 14230-4 (KWP2000 Fast)';
      } else if (protoByte === 0x07) {
        protoText =
          'ISO 14230-4 (KWP2000 Slow)';
      }

      let lastErr:
        KlineStatus['lastErrorCode'] =
        'KLINE_OK';

      if (errCodeByte === 0x01) {
        lastErr =
          'NO_KLINE_VOLTAGE';
      } else if (errCodeByte === 0x02) {
        lastErr =
          'INIT_FAILED';
      } else if (errCodeByte === 0x03) {
        lastErr =
          'NO_ECU_RESPONSE';
      } else if (errCodeByte === 0x04) {
        lastErr =
          'CHECKSUM_ERROR';
      } else if (errCodeByte === 0x05) {
        lastErr =
          'TIMEOUT';
      }

      result.klineStatus = {
        voltageOk,
        activeProtocol: protoText,
        initialized,
        rxErrorCount,
        txErrorCount,
        lastErrorCode: lastErr
      };

      return result;
    }

    /*
     * Unknown commands are still considered valid at the
     * binary framing level. This preserves forward compatibility.
     */
    return result;
  }

  /**
   * Configure protocol.
   *
   * ESP32 IDs:
   * 0x00 = AUTO
   * 0x01 = CAN 11/500
   * 0x02 = CAN 29/500
   * 0x03 = CAN 11/250
   * 0x04 = CAN 29/250
   * 0x05 = ISO9141
   * 0x06 = KWP Fast
   * 0x07 = KWP Slow
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
      new Uint8Array([protocolId])
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
      new Uint8Array([protocolId])
    );
  }

  /**
   * K-Line diagnostic frame.
   */
  public static encodeKlineFrame(
    frameBytes: number[]
  ): Uint8Array {
    if (!Array.isArray(frameBytes)) {
      throw new Error(
        '[PROTO] K-Line frame must be an array'
      );
    }

    if (
      frameBytes.length === 0 ||
      frameBytes.length > this.MAX_PAYLOAD_SIZE
    ) {
      throw new Error(
        `[PROTO] Invalid K-Line frame length=${frameBytes.length}`
      );
    }

    const payload =
      new Uint8Array(frameBytes.length);

    for (let i = 0; i < frameBytes.length; i++) {
      payload[i] = frameBytes[i] & 0xFF;
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
