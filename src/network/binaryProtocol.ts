/**
 * HAMZA OBD PRO - Unified Binary Frame Protocol
 * 
 * Standard binary framing protocol used identically over both Wi-Fi TCP and Bluetooth SPP.
 * Eliminates protocol discrepancies and enables unified parsing across all transport layers.
 * 
 * Frame Format:
 * [0xAA 0x55] [CMD (1B)] [LEN (2B)] [PAYLOAD (N Bytes)] [CHECKSUM (1B)] [0x0D 0x0A]
 */

import { CanFrame, CanBusStatus } from '../types';

export enum BinaryCommand {
  CMD_CAN_FRAME = 0x01,
  CMD_PING = 0x02,
  CMD_PONG = 0x03,
  CMD_CAN_STATUS_REQ = 0x04,
  CMD_CAN_STATUS_RESP = 0x05,
  CMD_CONFIG_CAN = 0x06,
  CMD_HEARTBEAT = 0x07,
  CMD_ERROR = 0xFF
}

export interface DecodedBinaryPacket {
  cmd: BinaryCommand;
  payload: Uint8Array;
  rawFrame: Uint8Array;
  isValid: boolean;
  canFrame?: CanFrame;
  canStatus?: CanBusStatus;
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
   * Compute XOR checksum over byte stream
   */
  public static computeChecksum(cmd: number, len: number, payload: Uint8Array | number[]): number {
    let cs = cmd ^ ((len >> 8) & 0xFF) ^ (len & 0xFF);
    for (let i = 0; i < payload.length; i++) {
      cs ^= payload[i];
    }
    return cs & 0xFF;
  }

  /**
   * Encode a standard CAN frame (11-bit or 29-bit) into a binary packet
   */
  public static encodeCanFrame(canId: number, data: number[] | Uint8Array, isExtended: boolean = false, isRtr: boolean = false): Uint8Array {
    const dlc = Math.min(8, data.length);
    const flags = (isExtended ? 0x01 : 0x00) | (isRtr ? 0x02 : 0x00);
    
    // Payload: [ID_3, ID_2, ID_1, ID_0, FLAGS, DLC, DATA_0..DATA_N]
    const payloadLen = 4 + 1 + 1 + dlc;
    const payload = new Uint8Array(payloadLen);

    // 4-byte CAN ID (Big Endian)
    payload[0] = (canId >> 24) & 0xFF;
    payload[1] = (canId >> 16) & 0xFF;
    payload[2] = (canId >> 8) & 0xFF;
    payload[3] = canId & 0xFF;
    
    payload[4] = flags;
    payload[5] = dlc;

    for (let i = 0; i < dlc; i++) {
      payload[6 + i] = data[i];
    }

    return this.wrapPacket(BinaryCommand.CMD_CAN_FRAME, payload);
  }

  /**
   * Encode a PING request
   */
  public static encodePing(): Uint8Array {
    const timestamp = Date.now();
    const payload = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      payload[7 - i] = Number((BigInt(timestamp) >> BigInt(i * 8)) & 0xFFn);
    }
    return this.wrapPacket(BinaryCommand.CMD_PING, payload);
  }

  /**
   * Encode a PONG response (used by ESP32 or Mock)
   */
  public static encodePong(uptimeMs: number, canReady: boolean, freeHeapBytes: number): Uint8Array {
    const payload = new Uint8Array(9);
    // Uptime 4 bytes
    payload[0] = (uptimeMs >> 24) & 0xFF;
    payload[1] = (uptimeMs >> 16) & 0xFF;
    payload[2] = (uptimeMs >> 8) & 0xFF;
    payload[3] = uptimeMs & 0xFF;
    // CAN state 1 byte
    payload[4] = canReady ? 0x01 : 0x00;
    // Free heap 4 bytes
    payload[5] = (freeHeapBytes >> 24) & 0xFF;
    payload[6] = (freeHeapBytes >> 16) & 0xFF;
    payload[7] = (freeHeapBytes >> 8) & 0xFF;
    payload[8] = freeHeapBytes & 0xFF;
    return this.wrapPacket(BinaryCommand.CMD_PONG, payload);
  }

  /**
   * Encode a CAN Status Request
   */
  public static encodeCanStatusReq(): Uint8Array {
    return this.wrapPacket(BinaryCommand.CMD_CAN_STATUS_REQ, new Uint8Array(0));
  }

  /**
   * Encode CAN Bus Configuration (Speed & Mode)
   */
  public static encodeConfigCan(speedKbps: number, filterId: number = 0, filterMask: number = 0): Uint8Array {
    const payload = new Uint8Array(10);
    payload[0] = (speedKbps >> 8) & 0xFF;
    payload[1] = speedKbps & 0xFF;
    // Filter ID 4 bytes
    payload[2] = (filterId >> 24) & 0xFF;
    payload[3] = (filterId >> 16) & 0xFF;
    payload[4] = (filterId >> 8) & 0xFF;
    payload[5] = filterId & 0xFF;
    // Filter Mask 4 bytes
    payload[6] = (filterMask >> 24) & 0xFF;
    payload[7] = (filterMask >> 16) & 0xFF;
    payload[8] = (filterMask >> 8) & 0xFF;
    payload[9] = filterMask & 0xFF;
    return this.wrapPacket(BinaryCommand.CMD_CONFIG_CAN, payload);
  }

  public static readonly MAX_PAYLOAD_SIZE = 256;

  /**
   * Wrap payload with magic bytes, length, checksum and trailer
   */
  public static wrapPacket(cmd: BinaryCommand, payload: Uint8Array): Uint8Array {
    const len = payload.length;
    const packet = new Uint8Array(2 + 1 + 2 + len + 1 + 2); // Magic(2) + Cmd(1) + Len(2) + Payload(N) + CS(1) + Trailer(2)
    
    packet[0] = this.MAGIC_BYTE_1;
    packet[1] = this.MAGIC_BYTE_2;
    packet[2] = cmd;
    packet[3] = (len >> 8) & 0xFF;
    packet[4] = len & 0xFF;

    packet.set(payload, 5);

    const cs = this.computeChecksum(cmd, len, payload);
    packet[5 + len] = cs;
    packet[5 + len + 1] = this.TRAILER_BYTE_1;
    packet[5 + len + 2] = this.TRAILER_BYTE_2;

    const hex = Array.from(packet).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    console.log(`[PROTO-TX] CMD=0x${cmd.toString(16).padStart(2, '0').toUpperCase()} LEN=${len} HEX=${hex}`);

    return packet;
  }

  /**
   * Parse incoming continuous byte stream and extract valid frames.
   * Accurately preserves partial frames until subsequent data arrives.
   */
  public static parseStream(streamBuffer: Uint8Array): { packets: DecodedBinaryPacket[]; remainingBuffer: Uint8Array } {
    const packets: DecodedBinaryPacket[] = [];
    let i = 0;

    while (i <= streamBuffer.length - 7) {
      if (streamBuffer[i] === this.MAGIC_BYTE_1 && streamBuffer[i + 1] === this.MAGIC_BYTE_2) {
        const cmd = streamBuffer[i + 2] as BinaryCommand;
        const len = (streamBuffer[i + 3] << 8) | streamBuffer[i + 4];

        // Sanity check for corrupt or oversized payload lengths
        if (len > this.MAX_PAYLOAD_SIZE) {
          // Corrupted length, skip this magic and continue search
          i++;
          continue;
        }

        const totalExpectedLength = 2 + 1 + 2 + len + 1 + 2;
        if (i + totalExpectedLength <= streamBuffer.length) {
          const payload = streamBuffer.slice(i + 5, i + 5 + len);
          const checksum = streamBuffer[i + 5 + len];
          const tr1 = streamBuffer[i + 5 + len + 1];
          const tr2 = streamBuffer[i + 5 + len + 2];

          const expectedCs = this.computeChecksum(cmd, len, payload);
          const isValid = checksum === expectedCs && tr1 === this.TRAILER_BYTE_1 && tr2 === this.TRAILER_BYTE_2;

          if (isValid) {
            const rawFrame = streamBuffer.slice(i, i + totalExpectedLength);
            const hex = Array.from(rawFrame).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
            console.log(`[PROTO-RX] CMD=0x${cmd.toString(16).padStart(2, '0').toUpperCase()} LEN=${len} HEX=${hex}`);

            const decoded = this.decodePacket(cmd, payload, rawFrame);
            packets.push(decoded);
            i += totalExpectedLength;
            continue;
          } else {
            // Checksum or trailer mismatch, corrupted packet
            console.warn(`[PROTO-RX] CORRUPTED_PACKET at offset ${i} (expected CS=0x${expectedCs.toString(16)}, got=0x${checksum.toString(16)})`);
          }
        } else {
          // Partial packet detected! We have found the start of a valid frame header
          // but the complete payload + trailer hasn't arrived yet.
          // Stop parsing and keep remainingBuffer from offset i.
          break;
        }
      }
      i++;
    }

    const remainingBuffer = streamBuffer.slice(i);
    return { packets, remainingBuffer };
  }

  /**
   * Decode parsed packet by command type
   */
  private static decodePacket(cmd: BinaryCommand, payload: Uint8Array, rawFrame: Uint8Array): DecodedBinaryPacket {
    const result: DecodedBinaryPacket = {
      cmd,
      payload,
      rawFrame,
      isValid: true
    };

    if (cmd === BinaryCommand.CMD_CAN_FRAME && payload.length >= 6) {
      const canId = ((payload[0] << 24) | (payload[1] << 16) | (payload[2] << 8) | payload[3]) >>> 0;
      const flags = payload[4];
      const dlc = payload[5];
      const isExtended = (flags & 0x01) !== 0;
      const dataBytes = Array.from(payload.slice(6, 6 + dlc));
      const dataHex = dataBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      const idHex = isExtended 
        ? '0x' + canId.toString(16).padStart(8, '0').toUpperCase()
        : '0x' + canId.toString(16).padStart(3, '0').toUpperCase();

      result.canFrame = {
        id: idHex,
        dlc,
        dataHex,
        dataBytes,
        direction: 'Rx',
        isExtended
      };
    } else if (cmd === BinaryCommand.CMD_PONG && payload.length >= 9) {
      const uptimeMs = ((payload[0] << 24) | (payload[1] << 16) | (payload[2] << 8) | payload[3]) >>> 0;
      const canReady = payload[4] === 0x01;
      const freeHeapBytes = ((payload[5] << 24) | (payload[6] << 16) | (payload[7] << 8) | payload[8]) >>> 0;
      result.pongInfo = { uptimeMs, canReady, freeHeapBytes };
    } else if (cmd === BinaryCommand.CMD_CAN_STATUS_RESP && payload.length >= 21) {
      const stateCode = payload[0];
      const speed = ((payload[1] << 24) | (payload[2] << 16) | (payload[3] << 8) | payload[4]) >>> 0;
      const txErrorCount = payload[5];
      const rxErrorCount = payload[6];
      const busOverrunCount = (payload[7] << 8) | payload[8];
      const queueSize = payload[9];
      const messagesSent = ((payload[10] << 24) | (payload[11] << 16) | (payload[12] << 8) | payload[13]) >>> 0;
      const messagesReceived = ((payload[14] << 24) | (payload[15] << 16) | (payload[16] << 8) | payload[17]) >>> 0;

      let stateStr: CanBusStatus['state'] = 'READY';
      if (stateCode === 1) stateStr = 'STOPPED';
      else if (stateCode === 2) stateStr = 'BUS_OFF';
      else if (stateCode === 3) stateStr = 'ERROR';
      else if (stateCode === 4) stateStr = 'RECOVERING';

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
    }

    return result;
  }
}
