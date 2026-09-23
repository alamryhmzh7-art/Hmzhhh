import { transportManager } from '../network/TransportManager';
import { getNrcInfo, NrcInfo } from './nrc';

export interface UdsServiceDefinition {
  idHex: string;
  sid: number;
  serviceId: number;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  subfunctions?: { id: number; nameEn: string; nameAr: string }[];
  subFunctions?: { id: number; nameEn: string; nameAr: string }[];
  defaultPayloadHex: string;
}

export const UDS_SERVICES: UdsServiceDefinition[] = [
  {
    idHex: '0x10',
    sid: 0x10,
    serviceId: 0x10,
    nameEn: 'Diagnostic Session Control',
    nameAr: 'التحكم في جلسة التشخيص',
    descriptionEn: 'Enables specific diagnostic sessions (Default 01, Programming 02, Extended 03)',
    descriptionAr: 'تفعيل جلسات التشخيص المختلفة (الافتراضية 01، البرمجة 02، أو التعديل والتشخيص الموسع 03)',
    subfunctions: [
      { id: 0x01, nameEn: 'Default Session (0x01)', nameAr: 'الجلسة الافتراضية (0x01)' },
      { id: 0x02, nameEn: 'Programming Session (0x02)', nameAr: 'جلسة البرمجة والتحديث (0x02)' },
      { id: 0x03, nameEn: 'Extended Diagnostic Session (0x03)', nameAr: 'الجلسة التشخيصية الموسعة (0x03)' },
      { id: 0x04, nameEn: 'Safety System Diagnostic Session (0x04)', nameAr: 'جلسة أنظمة السلامة والأمان (0x04)' }
    ],
    defaultPayloadHex: '10 03'
  },
  {
    idHex: '0x11',
    sid: 0x11,
    serviceId: 0x11,
    nameEn: 'ECU Reset',
    nameAr: 'إعادة تشغيل وحدة التحكم (ECU Reset)',
    descriptionEn: 'Commands target ECU to perform a hardware, key-cycle, or software reboot',
    descriptionAr: 'إصدار أمر إعادة إقلاع عتادي أو برمجي لكمبيوتر السيارة',
    subfunctions: [
      { id: 0x01, nameEn: 'Hard Reset (0x01)', nameAr: 'إعادة تشغيل عتادية صلبة (0x01)' },
      { id: 0x02, nameEn: 'Key Off/On Reset (0x02)', nameAr: 'محاكاة قفل وفتح السويتش (0x02)' },
      { id: 0x03, nameEn: 'Soft Reset (0x03)', nameAr: 'إعادة تشغيل برمجية خفيفة (0x03)' }
    ],
    defaultPayloadHex: '11 01'
  },
  {
    idHex: '0x14',
    sid: 0x14,
    serviceId: 0x14,
    nameEn: 'Clear Diagnostic Information',
    nameAr: 'مسح ذاكرة ومعلومات الأعطال (Clear DTC)',
    descriptionEn: 'Clears stored DTCs, Freeze Frame snapshots, and status history (0xFFFFFF)',
    descriptionAr: 'مسح جميع رموز الأعطال المخزنة وسجلات بيانات التجميد لجميع المجموعات',
    defaultPayloadHex: '14 FF FF FF'
  },
  {
    idHex: '0x19',
    sid: 0x19,
    serviceId: 0x19,
    nameEn: 'Read DTC Information',
    nameAr: 'قراءة تفاصيل ومعلومات الأعطال',
    descriptionEn: 'Reads DTCs filtered by status mask, snapshot records, or extended data',
    descriptionAr: 'استرجاع رموز الأعطال التفصيلية حسب قناع الحالة وسجلات التجميد',
    subfunctions: [
      { id: 0x01, nameEn: 'Report Number Of DTC By Status Mask (0x01)', nameAr: 'تقرير عدد الأعطال حسب القناع (0x01)' },
      { id: 0x02, nameEn: 'Report DTC By Status Mask (0x02)', nameAr: 'تقرير رموز الأعطال حسب القناع (0x02)' },
      { id: 0x04, nameEn: 'Report DTC Snapshot Record (0x04)', nameAr: 'تقرير بيانات لقطة التجميد (0x04)' },
      { id: 0x06, nameEn: 'Report DTC Extended Data Record (0x06)', nameAr: 'تقرير البيانات الموسعة للعطل (0x06)' },
      { id: 0x0A, nameEn: 'Report Supported DTCs (0x0A)', nameAr: 'تقرير كافة الأعطال المدعومة (0x0A)' }
    ],
    defaultPayloadHex: '19 02 08'
  },
  {
    idHex: '0x22',
    sid: 0x22,
    serviceId: 0x22,
    nameEn: 'Read Data By Identifier (RDBI)',
    nameAr: 'قراءة البيانات بواسطة المعرّف (DID)',
    descriptionEn: 'Requests internal ECU data elements referenced by a 2-byte Data Identifier (DID)',
    descriptionAr: 'استعلام عن قيم وبيانات محددة داخل وحدة التحكم عبر معرّف DID ذي بايتين (مثل 22 F1 90 لمود VIN)',
    defaultPayloadHex: '22 F1 90'
  },
  {
    idHex: '0x27',
    sid: 0x27,
    serviceId: 0x27,
    nameEn: 'Security Access',
    nameAr: 'الوصول الأمني وفك التشفير (Security Access)',
    descriptionEn: 'Performs cryptographic Seed-Key authorization before protected operations',
    descriptionAr: 'تنفيذ بروتوكول التوثيق وتوليد المفتاح الأمني قبل فتح صلاحيات الكتابة والبرمجة',
    subfunctions: [
      { id: 0x01, nameEn: 'Request Seed (Level 1) (0x01)', nameAr: 'طلب البذرة الأمنية (المستوى 1)' },
      { id: 0x02, nameEn: 'Send Key (Level 1) (0x02)', nameAr: 'إرسال المفتاح المحسوب (المستوى 1)' }
    ],
    defaultPayloadHex: '27 01'
  },
  {
    idHex: '0x2E',
    sid: 0x2E,
    serviceId: 0x2E,
    nameEn: 'Write Data By Identifier (WDBI)',
    nameAr: 'كتابة البيانات بواسطة المعرّف (DID)',
    descriptionEn: 'Writes configuration, VIN, or calibration data into ECU memory by identifier',
    descriptionAr: 'كتابة بيانات التكوين والشيفرة المعايرة في ذاكرة وحدة التحكم',
    defaultPayloadHex: '2E F1 98 01 02 03'
  },
  {
    idHex: '0x31',
    sid: 0x31,
    serviceId: 0x31,
    nameEn: 'Routine Control',
    nameAr: 'التحكم في الإجراءات والروتينات البرمجية',
    descriptionEn: 'Starts, stops, or polls self-tests and calibration routines on ECU',
    descriptionAr: 'بدء أو إيقاف أو فحص نتائج الاختبارات الذاتية وإجراءات المعايرة',
    subfunctions: [
      { id: 0x01, nameEn: 'Start Routine (0x01)', nameAr: 'بدء تنفيذ الإجراء (0x01)' },
      { id: 0x02, nameEn: 'Stop Routine (0x02)', nameAr: 'إيقاف تنفيذ الإجراء (0x02)' },
      { id: 0x03, nameEn: 'Request Routine Results (0x03)', nameAr: 'استعلام نتائج الإجراء (0x03)' }
    ],
    defaultPayloadHex: '31 01 02 11'
  },
  {
    idHex: '0x3E',
    sid: 0x3E,
    serviceId: 0x3E,
    nameEn: 'Tester Present',
    nameAr: 'إبقاء الاتصال نشطاً (Tester Present)',
    descriptionEn: 'Periodically sent to prevent ECU from reverting to default diagnostic session',
    descriptionAr: 'إرسال نبضة إشارة دورية لمنع كمبيوتر السيارة من إنهاء الجلسة التشخيصية النشطة',
    subfunctions: [
      { id: 0x00, nameEn: 'Zero Sub-Function / With Response (0x00)', nameAr: 'مع استجابة تأكيد (0x00)' },
      { id: 0x80, nameEn: 'Suppress Positive Response (0x80)', nameAr: 'بدون استجابة (0x80)' }
    ],
    defaultPayloadHex: '3E 00'
  },
  {
    idHex: '0x85',
    sid: 0x85,
    serviceId: 0x85,
    nameEn: 'Control DTC Setting',
    nameAr: 'التحكم في تسجيل وتخزين الأعطال',
    descriptionEn: 'Enables or disables DTC detection and logging during flashing/calibration routines',
    descriptionAr: 'تفعيل أو تعطيل تخزين الأعطال مؤقتاً أثناء تنفيذ العمليات الحساسة',
    subfunctions: [
      { id: 0x01, nameEn: 'DTC Setting ON (0x01)', nameAr: 'تفعيل تسجيل الأعطال (0x01)' },
      { id: 0x02, nameEn: 'DTC Setting OFF (0x02)', nameAr: 'إيقاف تسجيل الأعطال مؤقتاً (0x02)' }
    ],
    defaultPayloadHex: '85 01'
  }
];

export const STANDARD_UDS_SERVICES = UDS_SERVICES;

export interface UdsResponse {
  success: boolean;
  serviceId: number;
  isPositive: boolean;
  rawHex: string;
  decodedEn: string;
  decodedAr: string;
  nrcInfo?: NrcInfo;
  dataBytes: number[];
}

export class UdsService {
  /**
   * Sends a UDS command to the target ECU with NRC 0x78 (Response Pending) auto-polling.
   * Uses 5000ms timeout window as per ISO 14229 spec.
   * Safe against undefined map errors.
   */
  public async sendUdsRequest(
    payloadHex: string,
    targetEcuAddrHex: string = '0x7E0',
    timeoutMs: number = 5000
  ): Promise<UdsResponse> {
    const hexTokens = (payloadHex || '').trim().split(/\s+/).filter(Boolean);
    const reqBytes = (hexTokens || []).map(h => parseInt(h, 16)).filter(n => !isNaN(n));

    if (reqBytes.length === 0) {
      return {
        success: false,
        serviceId: 0,
        isPositive: false,
        rawHex: '',
        decodedEn: 'Invalid empty UDS payload input',
        decodedAr: 'مدخلات أمر UDS فارغة وغير صالحة',
        dataBytes: []
      };
    }

    const originalSid = reqBytes[0];
    let attempts = 0;
    const maxPendingRetries = 5;

    while (attempts <= maxPendingRetries) {
      attempts++;
      console.log(`[UDS-SERVICE] Executing UDS Request: "${payloadHex}" to ${targetEcuAddrHex} (Attempt ${attempts})...`);

      const resp = await transportManager.sendRequest(reqBytes, targetEcuAddrHex);

      if (resp && (resp.status === 'SUCCESS' || resp.status === 'NRC') && resp.responseRaw) {
        const rawHex = resp.responseRaw;
        const respTokens = (rawHex.trim().split(/\s+/) || []).filter(Boolean);
        const respBytes = (respTokens || []).map(h => parseInt(h, 16)).filter(n => !isNaN(n));

        if (respBytes.length > 0 && respBytes[0] === 0x7F) {
          const nrcCode = respBytes.length > 2 ? respBytes[2] : 0x10;
          const nrcInfo = getNrcInfo(nrcCode);

          // Special Handling for NRC 0x78 (Response Pending)
          if (nrcCode === 0x78) {
            console.log(`[UDS-SERVICE] Received NRC 0x78 (Response Pending). Waiting 3000ms before polling again...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            continue; // Re-poll for final positive/negative response frame
          }

          return {
            success: false,
            serviceId: originalSid,
            isPositive: false,
            rawHex,
            decodedEn: `Negative Response Code (NRC 0x${nrcCode.toString(16).toUpperCase()}): ${nrcInfo.nameEn} - ${nrcInfo.descriptionEn}`,
            decodedAr: `استجابة سلبية (NRC 0x${nrcCode.toString(16).toUpperCase()}): ${nrcInfo.nameAr} - ${nrcInfo.descriptionAr}`,
            nrcInfo,
            dataBytes: respBytes
          };
        }

        // Positive Response (Response SID = SID + 0x40)
        return this.parsePositiveResponse(originalSid, respBytes, rawHex);
      } else {
        // Timeout or Transport Error
        return {
          success: false,
          serviceId: originalSid,
          isPositive: false,
          rawHex: resp?.responseRaw || '',
          decodedEn: resp?.error || 'ECU Timeout / No response received from target ECU (5000ms limit).',
          decodedAr: 'انتهت مهلة الانتظار / لم تتلقَ استجابة من كمبيوتر السيارة خلال 5 ثوانٍ.',
          dataBytes: []
        };
      }
    }

    return {
      success: false,
      serviceId: originalSid,
      isPositive: false,
      rawHex: '',
      decodedEn: 'Max NRC 0x78 (Response Pending) retries exceeded without final frame.',
      decodedAr: 'تجاوزت المحاولات الحد الأقصى لاستجابات NRC 0x78 المعلقة بدون تلقي الإطار النهائي.',
      dataBytes: []
    };
  }

  private parsePositiveResponse(originalSid: number, respBytes: number[], rawHex: string): UdsResponse {
    const serviceDef = UDS_SERVICES.find(s => s.serviceId === originalSid);
    let decodedEn = `Positive Response for Service 0x${originalSid.toString(16).toUpperCase()}`;
    let decodedAr = `استجابة إيجابية للخدمة 0x${originalSid.toString(16).toUpperCase()}`;

    if (originalSid === 0x10 && respBytes.length >= 2) {
      decodedEn = `Session 0x${respBytes[1].toString(16).padStart(2, '0').toUpperCase()} activated successfully.`;
      decodedAr = `تم تفعيل الجلسة التشخيصية 0x${respBytes[1].toString(16).padStart(2, '0').toUpperCase()} بنجاح.`;
    } else if (originalSid === 0x22 && respBytes.length >= 3) {
      const didHex = `0x${respBytes[1].toString(16).padStart(2, '0')}${respBytes[2].toString(16).padStart(2, '0')}`.toUpperCase();
      const payloadBytes = respBytes.slice(3);
      const asciiVal = (payloadBytes || []).map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');
      decodedEn = `DID ${didHex} Data: [${payloadBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}] | ASCII: "${asciiVal}"`;
      decodedAr = `بيانات المعرف ${didHex}: [${payloadBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}] | ASCII: "${asciiVal}"`;
    } else if (serviceDef) {
      decodedEn = `${serviceDef.nameEn} Positive Acknowledge`;
      decodedAr = `تأكيد نجاح ${serviceDef.nameAr}`;
    }

    return {
      success: true,
      serviceId: originalSid,
      isPositive: true,
      rawHex,
      decodedEn,
      decodedAr,
      dataBytes: respBytes
    };
  }

  public static decodeNrc(nrcHex: string): NrcInfo {
    const code = parseInt(nrcHex, 16);
    return getNrcInfo(isNaN(code) ? 0x10 : code);
  }

  public static decodeResponse(bytes: number[]) {
    const safeBytes = bytes || [];
    const rawHex = safeBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

    if (safeBytes.length === 0) {
      return {
        serviceId: 0,
        isPositive: false,
        rawHex: '',
        decoded: 'Empty Response',
        decodedAr: 'استجابة فارغة'
      };
    }

    if (safeBytes[0] === 0x7F) {
      const requestedSid = safeBytes.length > 1 ? safeBytes[1] : 0x00;
      const nrc = safeBytes.length > 2 ? safeBytes[2] : 0x10;
      const nrcInfo = getNrcInfo(nrc);

      return {
        serviceId: requestedSid,
        isPositive: false,
        rawHex,
        decoded: `Negative Response (NRC 0x${nrc.toString(16).toUpperCase()}): ${nrcInfo.nameEn}`,
        decodedAr: `استجابة سلبية (NRC 0x${nrc.toString(16).toUpperCase()}): ${nrcInfo.nameAr}`,
        nrcCode: nrc,
        nrcDescriptionEn: nrcInfo.descriptionEn,
        nrcDescriptionAr: nrcInfo.descriptionAr
      };
    }

    const responseSid = safeBytes[0];
    const originalSid = responseSid >= 0x40 ? responseSid - 0x40 : responseSid;

    return {
      serviceId: originalSid,
      isPositive: true,
      rawHex,
      decoded: `Positive Acknowledge (0x${responseSid.toString(16).toUpperCase()})`,
      decodedAr: `تأكيد نجاح الاستجابة (0x${responseSid.toString(16).toUpperCase()})`
    };
  }
}

export const udsService = new UdsService();
