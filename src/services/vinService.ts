import { transportManager } from '../network/TransportManager';
import { VinDecoder } from '../obd/vinDecoder';
import { VinInfo } from '../types';

export interface VinResult {
  success: boolean;
  rawVin: string;
  decoded: VinInfo;
  source: 'MODE_09' | 'UDS_DID' | 'MANUAL';
  error?: string;
  errorAr?: string;
}

export class VinService {
  /**
   * Reads VIN from ECU using standard OBD-II Mode 09 PID 02 or UDS DID 0xF190.
   * Handles multi-frame ISO-TP reassembly, strips illegal characters (I, O, Q),
   * validates 17-character length, and guards against undefined .map errors.
   */
  public async readVinFromEcu(isMockMode: boolean = false): Promise<VinResult> {
    if (isMockMode) {
      const mockVin = '4T1BF1FK5NU123456';
      const decoded = VinDecoder.decode(mockVin);
      return {
        success: true,
        rawVin: mockVin,
        decoded,
        source: 'MODE_09'
      };
    }

    try {
      if (!transportManager.isConnected()) {
        return {
          success: false,
          rawVin: '',
          decoded: VinDecoder.decode(''),
          source: 'MODE_09',
          error: 'Not connected to vehicle adapter (ESP32)',
          errorAr: 'غير متصل بمحول السيارة (ESP32)'
        };
      }

      // Attempt 1: Standard OBD-II Mode 09 PID 02 via Physical Header 0x7E0
      console.log('[VIN-SERVICE] Requesting VIN via OBD-II Mode 09 PID 02...');
      const mode09Resp = await transportManager.sendRequest([0x09, 0x02], '0x7E0');

      if (mode09Resp && mode09Resp.status === 'SUCCESS' && mode09Resp.responseRaw) {
        const parsed = this.parseVinBytes(mode09Resp.responseRaw);
        if (parsed && parsed.length === 17) {
          const decoded = VinDecoder.decode(parsed);
          return {
            success: true,
            rawVin: parsed,
            decoded,
            source: 'MODE_09'
          };
        }
      }

      // Attempt 2: Fallback to UDS Read Data By Identifier (DID 0xF190)
      console.log('[VIN-SERVICE] Fallback: Requesting VIN via UDS DID 0xF190...');
      const udsResp = await transportManager.sendRequest([0x22, 0xF1, 0x90], '0x7E0');

      if (udsResp && udsResp.status === 'SUCCESS' && udsResp.responseRaw) {
        const parsed = this.parseVinBytes(udsResp.responseRaw);
        if (parsed && parsed.length === 17) {
          const decoded = VinDecoder.decode(parsed);
          return {
            success: true,
            rawVin: parsed,
            decoded,
            source: 'UDS_DID'
          };
        }
      }

      return {
        success: false,
        rawVin: '',
        decoded: VinDecoder.decode(''),
        source: 'MODE_09',
        error: 'Incomplete VIN received from vehicle (17 characters required).',
        errorAr: 'لم يتم استلام رقم شاسيه VIN كامل من وحدة التحكم (يتطلب 17 حرفاً).'
      };
    } catch (err: any) {
      console.error('[VIN-SERVICE] Error reading VIN from vehicle:', err);
      return {
        success: false,
        rawVin: '',
        decoded: VinDecoder.decode(''),
        source: 'MODE_09',
        error: err?.message || 'Error executing VIN diagnostic request',
        errorAr: 'حدث خطأ أثناء إرسال طلب قراءة رقم الشاسيه من السيارة'
      };
    }
  }

  /**
   * Parses raw hex response string into clean 17-char VIN.
   * Strips non-alphanumeric characters and illegal VIN chars (I, O, Q).
   * Safe against undefined data or map failures.
   */
  public parseVinBytes(rawHex: string): string {
    if (!rawHex || typeof rawHex !== 'string') return '';

    const hexTokens = (rawHex.trim().split(/\s+/) || []).filter(Boolean);
    const bytes = (hexTokens || []).map(token => parseInt(token, 16)).filter(num => !isNaN(num));

    if (bytes.length === 0) return '';

    // Find starting byte index (skipping header 0x49 0x02 or 0x62 0xF1 0x90)
    let startIndex = 0;

    if (bytes.length >= 20 && bytes[0] === 0x49 && bytes[1] === 0x02) {
      startIndex = 3; // Skip 49 02 01
    } else if (bytes.length >= 20 && bytes[0] === 0x62 && bytes[1] === 0xF1 && bytes[2] === 0x90) {
      startIndex = 3; // Skip 62 F1 90
    } else {
      // Locate first printable uppercase ASCII char (A-Z or 0-9)
      startIndex = bytes.findIndex(b => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5A));
      if (startIndex < 0) startIndex = 0;
    }

    const asciiChars: string[] = [];

    for (let i = startIndex; i < bytes.length && asciiChars.length < 17; i++) {
      const b = bytes[i];
      // ISO 3779: Printable ASCII digits 0-9 (0x30-0x39) & letters A-Z (0x41-0x5A)
      if ((b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5A)) {
        const char = String.fromCharCode(b);
        // Exclude illegal VIN characters: I (0x49), O (0x4F), Q (0x51)
        if (char !== 'I' && char !== 'O' && char !== 'Q') {
          asciiChars.push(char);
        }
      }
    }

    return asciiChars.join('');
  }

  /**
   * Decodes a manually entered or scanned VIN string safely.
   */
  public decodeManualVin(vinString: string): VinInfo {
    const safeVin = (vinString || '').trim().toUpperCase();
    return VinDecoder.decode(safeVin);
  }
}

export const vinService = new VinService();
