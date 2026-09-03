/**
 * ISO 15765-2 (ISO-TP) Transport Layer Protocol Implementation
 * Encapsulates multi-frame segmentation, reassembly, and flow control.
 */

export enum IsoTpFrameType {
  SINGLE_FRAME = 0x00,
  FIRST_FRAME = 0x10,
  CONSECUTIVE_FRAME = 0x20,
  FLOW_CONTROL = 0x30,
}

export enum FlowStatus {
  CONTINUE_TO_SEND = 0x00,
  WAIT = 0x01,
  OVERFLOW = 0x02,
}

export interface IsoTpReassemblyBuffer {
  totalLength: number;
  receivedBytes: number[];
  expectedSequence: number;
  blockSize: number;
  stMin: number;
  lastTimestamp: number;
}

export class IsoTpProtocol {
  private buffers: Map<string, IsoTpReassemblyBuffer> = new Map();

  public encodePayload(payload: number[], isExtended: boolean = false): number[][] {
    return IsoTpProtocol.encodePayload(payload, isExtended);
  }

  /**
   * Encode an application payload (e.g. UDS/OBD message) into a list of 8-byte CAN frames
   */
  public static encodePayload(payload: number[], isExtended: boolean = false): number[][] {
    const frames: number[][] = [];
    const len = payload.length;

    if (len <= 7) {
      // Single Frame (SF)
      const frame = new Array(8).fill(0x00);
      frame[0] = (IsoTpFrameType.SINGLE_FRAME) | (len & 0x0F);
      for (let i = 0; i < len; i++) {
        frame[1 + i] = payload[i];
      }
      frames.push(frame);
      return frames;
    }

    // First Frame (FF)
    const ff = new Array(8).fill(0x00);
    ff[0] = (IsoTpFrameType.FIRST_FRAME) | ((len >> 8) & 0x0F);
    ff[1] = len & 0xFF;
    for (let i = 0; i < 6; i++) {
      ff[2 + i] = payload[i];
    }
    frames.push(ff);

    // Consecutive Frames (CF)
    let sequence = 1;
    let offset = 6;
    while (offset < len) {
      const cf = new Array(8).fill(0x00);
      cf[0] = (IsoTpFrameType.CONSECUTIVE_FRAME) | (sequence & 0x0F);
      const chunkSize = Math.min(7, len - offset);
      for (let i = 0; i < chunkSize; i++) {
        cf[1 + i] = payload[offset + i];
      }
      frames.push(cf);
      offset += chunkSize;
      sequence = (sequence + 1) & 0x0F;
    }

    return frames;
  }

  /**
   * Process incoming CAN frame bytes and return full reassembled message when complete
   */
  public processIncomingFrame(sourceId: string, frameBytes: number[]): { complete: boolean; payload: number[] | null; error?: string } {
    if (!frameBytes || frameBytes.length < 8) {
      return { complete: false, payload: null, error: 'Invalid frame length (< 8 bytes)' };
    }

    const pciType = frameBytes[0] & 0xF0;

    switch (pciType) {
      case IsoTpFrameType.SINGLE_FRAME: {
        const length = frameBytes[0] & 0x0F;
        if (length > 7) {
          return { complete: false, payload: null, error: 'SF data length exceeds 7 bytes' };
        }
        const payload = frameBytes.slice(1, 1 + length);
        this.buffers.delete(sourceId);
        return { complete: true, payload };
      }

      case IsoTpFrameType.FIRST_FRAME: {
        const length = ((frameBytes[0] & 0x0F) << 8) | frameBytes[1];
        const initialData = frameBytes.slice(2, 8);
        this.buffers.set(sourceId, {
          totalLength: length,
          receivedBytes: [...initialData],
          expectedSequence: 1,
          blockSize: 0,
          stMin: 10,
          lastTimestamp: Date.now()
        });
        return { complete: false, payload: null };
      }

      case IsoTpFrameType.CONSECUTIVE_FRAME: {
        const buffer = this.buffers.get(sourceId);
        if (!buffer) {
          return { complete: false, payload: null, error: 'Unexpected Consecutive Frame (no active FF session)' };
        }

        const seq = frameBytes[0] & 0x0F;
        if (seq !== buffer.expectedSequence) {
          this.buffers.delete(sourceId);
          return { complete: false, payload: null, error: `Sequence error: expected ${buffer.expectedSequence}, got ${seq}` };
        }

        const remaining = buffer.totalLength - buffer.receivedBytes.length;
        const take = Math.min(7, remaining);
        for (let i = 0; i < take; i++) {
          buffer.receivedBytes.push(frameBytes[1 + i]);
        }

        buffer.expectedSequence = (buffer.expectedSequence + 1) & 0x0F;
        buffer.lastTimestamp = Date.now();

        if (buffer.receivedBytes.length >= buffer.totalLength) {
          const fullPayload = [...buffer.receivedBytes];
          this.buffers.delete(sourceId);
          return { complete: true, payload: fullPayload };
        }

        return { complete: false, payload: null };
      }

      case IsoTpFrameType.FLOW_CONTROL: {
        return { complete: false, payload: null };
      }

      default:
        return { complete: false, payload: null, error: `Unknown ISO-TP PCI type: 0x${pciType.toString(16)}` };
    }
  }

  /**
   * Create Flow Control (FC) frame
   */
  public static createFlowControlFrame(status: FlowStatus = FlowStatus.CONTINUE_TO_SEND, blockSize: number = 0, stMinMs: number = 10): number[] {
    const frame = new Array(8).fill(0x00);
    frame[0] = IsoTpFrameType.FLOW_CONTROL | (status & 0x0F);
    frame[1] = blockSize & 0xFF;
    frame[2] = stMinMs & 0xFF;
    return frame;
  }
}
