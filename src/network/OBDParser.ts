/**
 * HAMZA OBD PRO - Strict OBD-II Mode 01 Frame Parser & Validation Engine
 */

export interface PidParseResult {
  pidHex: string;
  value: number | null;
  status: 'SUPPORTED' | 'NOT_SUPPORTED' | 'UNKNOWN';
  retryCount: number;
}

export class OBDParser {
  private retryMap: Map<string, number> = new Map();

  /**
   * Strictly validates incoming CAN frame bytes against expected Mode 01 PID.
   * Expected response format for Mode 01 PID XX:
   * Bytes should start with [0x41, PID_HEX_BYTE, ...data]
   */
  public validateAndParse(pidHex: string, rawBytes: number[], decodeFn: (bytes: number[]) => number): number | null {
    if (!rawBytes || rawBytes.length < 2) {
      return this.handleFailure(pidHex);
    }

    const modeByte = rawBytes[0];

    // Check for negative response or NRC 0x7F
    if (modeByte === 0x7F) {
      return this.handleFailure(pidHex);
    }

    const pidByte = rawBytes[1];
    const expectedPidNum = parseInt(pidHex, 16);

    // Strict validation: Mode must be 0x41 and PID must match requested PID
    if (modeByte !== 0x41 || pidByte !== expectedPidNum) {
      return this.handleFailure(pidHex);
    }

    // Success -> Reset retry count and decode
    this.retryMap.set(pidHex, 0);
    try {
      return decodeFn(rawBytes);
    } catch (e) {
      return this.handleFailure(pidHex);
    }
  }

  private handleFailure(pidHex: string): null {
    const current = this.retryMap.get(pidHex) || 0;
    const next = current + 1;
    this.retryMap.set(pidHex, next);
    return null;
  }

  public getRetryCount(pidHex: string): number {
    return this.retryMap.get(pidHex) || 0;
  }

  public isNotSupported(pidHex: string): boolean {
    return (this.retryMap.get(pidHex) || 0) >= 3;
  }

  public reset(): void {
    this.retryMap.clear();
  }
}

export const obdParser = new OBDParser();
