import { CanFrame, DiagnosticTroubleCode, ObdPid } from '../types';
import { canManager } from '../can/canManager';
import { commLogger } from '../logging/logger';
import { IsoTpProtocol } from '../isotp/isoTpProtocol';
import { standardPids } from '../obd/pidDecoder';

export class MockEcuServer {
  private isRunning: boolean = false;
  private timerId: any = null;
  private currentRpm: number = 780;
  private currentSpeed: number = 0;
  private currentCoolant: number = 88;
  private currentThrottle: number = 14;
  private currentLoad: number = 22;
  private currentVoltage: number = 14.15;
  private dtcCodes: string[] = ['P0300', 'P0171', 'P0420'];
  private isoTp = new IsoTpProtocol();

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Emit periodic CAN bus background traffic to simulate alive bus
    this.timerId = setInterval(() => {
      if (!this.isRunning) return;
      this.simulateCanTraffic();
    }, 200);
  }

  public stop() {
    this.isRunning = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private simulateCanTraffic() {
    // Oscillate engine parameters smoothly
    this.currentRpm = Math.floor(750 + Math.sin(Date.now() / 1500) * 150 + (Math.random() * 20));
    this.currentCoolant = Math.floor(88 + Math.sin(Date.now() / 10000) * 4);
    this.currentVoltage = parseFloat((14.1 + Math.sin(Date.now() / 3000) * 0.15).toFixed(2));
    this.currentThrottle = Math.floor(13 + Math.sin(Date.now() / 2000) * 3);
    this.currentLoad = Math.floor(21 + Math.sin(Date.now() / 2000) * 4);

    // Periodic broadcast frame: RPM and Speed (e.g., CAN ID 0x201)
    const rpmVal = this.currentRpm * 4;
    const rpmA = (rpmVal >> 8) & 0xFF;
    const rpmB = rpmVal & 0xFF;
    const speedA = this.currentSpeed & 0xFF;

    const rawBytes = [rpmA, rpmB, speedA, 0x14, 0x00, 0x00, 0x55, 0xAA];
    canManager.addFrame({
      id: '0x201',
      dlc: 8,
      dataHex: rawBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
      dataBytes: rawBytes,
      direction: 'Rx',
      isExtended: false,
      description: 'Engine Broadcast (RPM & Speed)'
    });
  }

  /**
   * Process a diagnostic request (OBD-II / UDS) and return the simulated ECU response bytes
   */
  public async handleRequest(requestBytes: number[]): Promise<number[]> {
    if (!requestBytes || requestBytes.length === 0) {
      throw new Error('Empty request packet');
    }

    const serviceMode = requestBytes[0];

    // Standard OBD-II Mode 01: Request Current Powertrain Diagnostic Data
    if (serviceMode === 0x01) {
      const pidHex = requestBytes.length > 1 ? requestBytes[1].toString(16).padStart(2, '0').toUpperCase() : '00';
      return this.handleObdMode01(pidHex);
    }

    // OBD-II Mode 03: Request Stored DTCs
    if (serviceMode === 0x03) {
      // Return P0300 (0x03, 0x00), P0171 (0x01, 0x71), P0420 (0x04, 0x20)
      if (this.dtcCodes.length === 0) {
        return [0x43, 0x00]; // 0 DTCs
      }
      return [0x43, 0x03, 0x03, 0x00, 0x01, 0x71, 0x04, 0x20];
    }

    // OBD-II Mode 04: Clear DTCs
    if (serviceMode === 0x04) {
      this.dtcCodes = [];
      return [0x44];
    }

    // OBD-II Mode 07: Request Pending DTCs
    if (serviceMode === 0x07) {
      return [0x47, 0x01, 0x01, 0x13]; // P0113 Pending
    }

    // OBD-II Mode 09: Request Vehicle Information (VIN PID 0x02)
    if (serviceMode === 0x09) {
      const subPid = requestBytes.length > 1 ? requestBytes[1] : 0x00;
      if (subPid === 0x02) {
        // Return 17-char VIN: "4T1BF1FK5NU123456" (Toyota Camry)
        const vinStr = "4T1BF1FK5NU123456";
        const vinBytes = vinStr.split('').map(c => c.charCodeAt(0));
        return [0x49, 0x02, 0x01, ...vinBytes];
      }
      return [0x49, subPid, 0x00];
    }

    // UDS 0x10: DiagnosticSessionControl
    if (serviceMode === 0x10) {
      const subFunc = requestBytes.length > 1 ? requestBytes[1] : 0x01;
      return [0x50, subFunc, 0x00, 0x32, 0x01, 0xF4]; // P2 = 50ms, P2* = 5000ms
    }

    // UDS 0x11: ECUReset
    if (serviceMode === 0x11) {
      const subFunc = requestBytes.length > 1 ? requestBytes[1] : 0x01;
      return [0x51, subFunc];
    }

    // UDS 0x14: ClearDiagnosticInformation
    if (serviceMode === 0x14) {
      this.dtcCodes = [];
      return [0x54];
    }

    // UDS 0x19: ReadDTCInformation
    if (serviceMode === 0x19) {
      return [0x59, 0x02, 0xFF, 0x03, 0x00, 0x28, 0x01, 0x71, 0x2F];
    }

    // UDS 0x22: ReadDataByIdentifier
    if (serviceMode === 0x22) {
      if (requestBytes.length >= 3) {
        const didHi = requestBytes[1];
        const didLo = requestBytes[2];
        // DID F190 = VIN
        if (didHi === 0xF1 && didLo === 0x90) {
          const vinStr = "4T1BF1FK5NU123456";
          const vinBytes = vinStr.split('').map(c => c.charCodeAt(0));
          return [0x62, 0xF1, 0x90, ...vinBytes];
        }
        // DID F188 = Software ID
        if (didHi === 0xF1 && didLo === 0x88) {
          const swStr = "89663-33J4000";
          const swBytes = swStr.split('').map(c => c.charCodeAt(0));
          return [0x62, 0xF1, 0x88, ...swBytes];
        }
        // Generic DID response
        return [0x62, didHi, didLo, 0x12, 0x34, 0x56, 0x78];
      }
    }

    // UDS 0x27: SecurityAccess
    if (serviceMode === 0x27) {
      const subFunc = requestBytes.length > 1 ? requestBytes[1] : 0x01;
      if (subFunc === 0x01) {
        // Request Seed -> Return 4-byte seed
        return [0x67, 0x01, 0x4A, 0xB2, 0x9F, 0x11];
      } else if (subFunc === 0x02) {
        // Send Key -> Positive ACK
        return [0x67, 0x02];
      }
    }

    // UDS 0x31: RoutineControl
    if (serviceMode === 0x31) {
      const subFunc = requestBytes.length > 1 ? requestBytes[1] : 0x01;
      const rHi = requestBytes.length > 2 ? requestBytes[2] : 0x00;
      const rLo = requestBytes.length > 3 ? requestBytes[3] : 0x00;
      return [0x71, subFunc, rHi, rLo, 0x00];
    }

    // UDS 0x3E: TesterPresent
    if (serviceMode === 0x3E) {
      return [0x7E, 0x00];
    }

    // Fallback: Positive acknowledgment or echo
    return [serviceMode + 0x40, 0x00];
  }

  private handleObdMode01(pidHex: string): number[] {
    const pid = pidHex.toUpperCase();
    switch (pid) {
      case '0C': { // Engine RPM
        const val = this.currentRpm * 4;
        return [0x41, 0x0C, (val >> 8) & 0xFF, val & 0xFF];
      }
      case '0D': { // Vehicle Speed
        return [0x41, 0x0D, this.currentSpeed & 0xFF];
      }
      case '05': { // Coolant Temp
        return [0x41, 0x05, (this.currentCoolant + 40) & 0xFF];
      }
      case '11': { // Throttle Position
        const val = Math.round((this.currentThrottle * 255) / 100);
        return [0x41, 0x11, val & 0xFF];
      }
      case '04': { // Calculated Load
        const val = Math.round((this.currentLoad * 255) / 100);
        return [0x41, 0x04, val & 0xFF];
      }
      case '42': { // Control Module Voltage
        const val = Math.round(this.currentVoltage * 1000);
        return [0x41, 0x42, (val >> 8) & 0xFF, val & 0xFF];
      }
      case '10': { // MAF Flow Rate (e.g. 3.85 g/s -> 385)
        return [0x41, 0x10, 0x01, 0x81];
      }
      case '06': { // STFT1 (e.g. +2.3% -> 128 + 3 = 131)
        return [0x41, 0x06, 0x83];
      }
      case '07': { // LTFT1 (e.g. -1.5% -> 128 - 2 = 126)
        return [0x41, 0x07, 0x7E];
      }
      case '0E': { // Timing Advance (e.g. 14 deg -> 14*2 + 128 = 156)
        return [0x41, 0x0E, 0x9C];
      }
      case '0F': { // Intake Air Temp (32°C -> 32 + 40 = 72)
        return [0x41, 0x0F, 0x48];
      }
      case '2F': { // Fuel Tank Level (65% -> 166)
        return [0x41, 0x2F, 0xA6];
      }
      default:
        return [0x41, parseInt(pid, 16) || 0x00, 0x00];
    }
  }

  public setSpeed(speed: number) {
    this.currentSpeed = Math.max(0, Math.min(260, speed));
  }

  public setRpm(rpm: number) {
    this.currentRpm = Math.max(0, Math.min(8000, rpm));
  }
}

export const mockEcuServer = new MockEcuServer();
