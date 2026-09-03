/**
 * Unified Diagnostic Services (ISO 14229 - UDS) Implementation
 * High-reliability automotive service handling and NRC decoding.
 */

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
    descriptionEn: 'Enables specific diagnostic sessions (Default, Extended, Programming)',
    descriptionAr: 'تفعيل جلسات التشخيص المختلفة (الافتراضية، الموسعة، أو جلسة البرمجة)',
    subfunctions: [
      { id: 0x01, nameEn: 'Default Session (0x01)', nameAr: 'الجلسة الافتراضية (0x01)' },
      { id: 0x02, nameEn: 'Programming Session (0x02)', nameAr: 'جلسة البرمجة (0x02)' },
      { id: 0x03, nameEn: 'Extended Diagnostic Session (0x03)', nameAr: 'الجلسة التشخيصية الموسعة (0x03)' },
      { id: 0x04, nameEn: 'Safety System Diagnostic Session (0x04)', nameAr: 'جلسة أنظمة الأمان (0x04)' },
    ],
    subFunctions: [
      { id: 0x01, nameEn: 'Default Session (0x01)', nameAr: 'الجلسة الافتراضية (0x01)' },
      { id: 0x02, nameEn: 'Programming Session (0x02)', nameAr: 'جلسة البرمجة (0x02)' },
      { id: 0x03, nameEn: 'Extended Diagnostic Session (0x03)', nameAr: 'الجلسة التشخيصية الموسعة (0x03)' },
      { id: 0x04, nameEn: 'Safety System Diagnostic Session (0x04)', nameAr: 'جلسة أنظمة الأمان (0x04)' },
    ],
    defaultPayloadHex: '10 03'
  },
  {
    idHex: '0x11',
    sid: 0x11,
    serviceId: 0x11,
    nameEn: 'ECU Reset',
    nameAr: 'إعادة تشغيل وحدة التحكم (ECU Reset)',
    descriptionEn: 'Commands the target ECU to perform a hardware or software reboot',
    descriptionAr: 'إصدار أمر إعادة إقلاع عتادي أو برمجي لكمبيوتر السيارة',
    subfunctions: [
      { id: 0x01, nameEn: 'Hard Reset (0x01)', nameAr: 'إعادة تشغيل عتادية صلبة (0x01)' },
      { id: 0x02, nameEn: 'Key Off/On Reset (0x02)', nameAr: 'محاكاة قفل وفتح السويتش (0x02)' },
      { id: 0x03, nameEn: 'Soft Reset (0x03)', nameAr: 'إعادة تشغيل برمجية خفيفة (0x03)' },
    ],
    subFunctions: [
      { id: 0x01, nameEn: 'Hard Reset (0x01)', nameAr: 'إعادة تشغيل عتادية صلبة (0x01)' },
      { id: 0x02, nameEn: 'Key Off/On Reset (0x02)', nameAr: 'محاكاة قفل وفتح السويتش (0x02)' },
      { id: 0x03, nameEn: 'Soft Reset (0x03)', nameAr: 'إعادة تشغيل برمجية خفيفة (0x03)' },
    ],
    defaultPayloadHex: '11 01'
  },
  {
    idHex: '0x14',
    sid: 0x14,
    serviceId: 0x14,
    nameEn: 'Clear Diagnostic Information',
    nameAr: 'مسح معلومات وذاكرة الأعطال (Clear DTC)',
    descriptionEn: 'Clears all stored DTCs, Freeze Frame, and status history across all groups',
    descriptionAr: 'مسح جميع رموز الأعطال المخزنة وبيانات التجميد لجميع المجموعات',
    defaultPayloadHex: '14 FF FF FF'
  },
  {
    idHex: '0x19',
    sid: 0x19,
    serviceId: 0x19,
    nameEn: 'Read DTC Information',
    nameAr: 'قراءة تفاصيل ومعلومات الأعطال',
    descriptionEn: 'Reads DTCs filtered by status mask, snapshot records, or extended data',
    descriptionAr: 'استرجاع رموز الأعطال حسب قناع الحالة وسجلات التجميد',
    subfunctions: [
      { id: 0x01, nameEn: 'Report Number Of DTC By Status Mask (0x01)', nameAr: 'تقرير عدد الأعطال حسب القناع (0x01)' },
      { id: 0x02, nameEn: 'Report DTC By Status Mask (0x02)', nameAr: 'تقرير رموز الأعطال حسب القناع (0x02)' },
      { id: 0x04, nameEn: 'Report DTC Snapshot Record (0x04)', nameAr: 'تقرير بيانات لقطة التجميد (0x04)' },
      { id: 0x06, nameEn: 'Report DTC Extended Data Record (0x06)', nameAr: 'تقرير البيانات الموسعة للعطل (0x06)' },
    ],
    subFunctions: [
      { id: 0x01, nameEn: 'Report Number Of DTC By Status Mask (0x01)', nameAr: 'تقرير عدد الأعطال حسب القناع (0x01)' },
      { id: 0x02, nameEn: 'Report DTC By Status Mask (0x02)', nameAr: 'تقرير رموز الأعطال حسب القناع (0x02)' },
      { id: 0x04, nameEn: 'Report DTC Snapshot Record (0x04)', nameAr: 'تقرير بيانات لقطة التجميد (0x04)' },
      { id: 0x06, nameEn: 'Report DTC Extended Data Record (0x06)', nameAr: 'تقرير البيانات الموسعة للعطل (0x06)' },
    ],
    defaultPayloadHex: '19 02 08'
  },
  {
    idHex: '0x22',
    sid: 0x22,
    serviceId: 0x22,
    nameEn: 'Read Data By Identifier (RDBI)',
    nameAr: 'قراءة البيانات بواسطة المعرّف (DID)',
    descriptionEn: 'Requests internal ECU data elements referenced by a 2-byte Data Identifier',
    descriptionAr: 'استعلام عن قيم وبيانات محددة داخل وحدة التحكم عبر معرّف DID ذي بايتين',
    defaultPayloadHex: '22 F1 90'
  },
  {
    idHex: '0x27',
    sid: 0x27,
    serviceId: 0x27,
    nameEn: 'Security Access',
    nameAr: 'الوصول الأمني وفك التشفير (Security Access)',
    descriptionEn: 'Performs cryptographic Seed-Key authorization before secured operations',
    descriptionAr: 'تنفيذ بروتوكول التوثيق وتوليد المفتاح الأمني قبل العمليات الحساسة',
    subfunctions: [
      { id: 0x01, nameEn: 'Request Seed (Level 1) (0x01)', nameAr: 'طلب البذرة الأمنية (المستوى 1)' },
      { id: 0x02, nameEn: 'Send Key (Level 1) (0x02)', nameAr: 'إرسال المفتاح المحسوب (المستوى 1)' },
    ],
    subFunctions: [
      { id: 0x01, nameEn: 'Request Seed (Level 1) (0x01)', nameAr: 'طلب البذرة الأمنية (المستوى 1)' },
      { id: 0x02, nameEn: 'Send Key (Level 1) (0x02)', nameAr: 'إرسال المفتاح المحسوب (المستوى 1)' },
    ],
    defaultPayloadHex: '27 01'
  },
  {
    idHex: '0x2E',
    sid: 0x2E,
    serviceId: 0x2E,
    nameEn: 'Write Data By Identifier (WDBI)',
    nameAr: 'كتابة البيانات بواسطة المعرّف (DID)',
    descriptionEn: 'Writes configuration or calibration data into ECU memory by identifier',
    descriptionAr: 'كتابة بيانات التكوين والمعايرة في ذاكرة وحدة التحكم',
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
      { id: 0x03, nameEn: 'Request Routine Results (0x03)', nameAr: 'استعلام نتائج الإجراء (0x03)' },
    ],
    subFunctions: [
      { id: 0x01, nameEn: 'Start Routine (0x01)', nameAr: 'بدء تنفيذ الإجراء (0x01)' },
      { id: 0x02, nameEn: 'Stop Routine (0x02)', nameAr: 'إيقاف تنفيذ الإجراء (0x02)' },
      { id: 0x03, nameEn: 'Request Routine Results (0x03)', nameAr: 'استعلام نتائج الإجراء (0x03)' },
    ],
    defaultPayloadHex: '31 01 02 03'
  },
  {
    idHex: '0x3E',
    sid: 0x3E,
    serviceId: 0x3E,
    nameEn: 'Tester Present',
    nameAr: 'إبقاء الاتصال نشطاً (Tester Present)',
    descriptionEn: 'Periodically sent to prevent the ECU from reverting to default session',
    descriptionAr: 'إرسال إشارة دورية لمنع كمبيوتر السيارة من إنهاء الجلسة التشخيصية النشطة',
    defaultPayloadHex: '3E 00'
  },
  {
    idHex: '0x85',
    sid: 0x85,
    serviceId: 0x85,
    nameEn: 'Control DTC Setting',
    nameAr: 'التحكم في تسجيل وتخزين الأعطال',
    descriptionEn: 'Enables or disables DTC detection and logging during flashing/calibration',
    descriptionAr: 'تفعيل أو تعطيل تخزين الأعطال مؤقتاً أثناء البرمجة أو الفحص',
    subfunctions: [
      { id: 0x01, nameEn: 'DTC Setting ON (0x01)', nameAr: 'تفعيل تسجيل الأعطال (0x01)' },
      { id: 0x02, nameEn: 'DTC Setting OFF (0x02)', nameAr: 'إيقاف تسجيل الأعطال مؤقتاً (0x02)' },
    ],
    subFunctions: [
      { id: 0x01, nameEn: 'DTC Setting ON (0x01)', nameAr: 'تفعيل تسجيل الأعطال (0x01)' },
      { id: 0x02, nameEn: 'DTC Setting OFF (0x02)', nameAr: 'إيقاف تسجيل الأعطال مؤقتاً (0x02)' },
    ],
    defaultPayloadHex: '85 01'
  }
];

export const STANDARD_UDS_SERVICES = UDS_SERVICES;

export const NRC_DICTIONARY: Record<number, { en: string; ar: string }> = {
  0x10: { en: 'General Reject', ar: 'رفض عام من وحدة التحكم' },
  0x11: { en: 'Service Not Supported', ar: 'الخدمة غير مدعومة في وحدة التحكم هذه' },
  0x12: { en: 'Sub-Function Not Supported', ar: 'الوظيفة الفرعية غير مدعومة' },
  0x13: { en: 'Incorrect Message Length Or Invalid Format', ar: 'طول الرسالة غير صحيح أو تنسيق غير صالح' },
  0x14: { en: 'Response Too Long', ar: 'الاستجابة أطول من سعة المخزن المؤقت' },
  0x21: { en: 'Busy Repeat Request', ar: 'الوحدة مشغولة، يرجى إعادة الطلب' },
  0x22: { en: 'Conditions Not Correct', ar: 'شروط التنفيذ غير متوفرة (مثل وضع القير، السرعة أو الجهد)' },
  0x24: { en: 'Request Sequence Error', ar: 'خطأ في تسلسل خطوات الطلب' },
  0x31: { en: 'Request Out Of Range', ar: 'المعامل أو القيمة خارج النطاق المسموح' },
  0x33: { en: 'Security Access Denied', ar: 'تم رفض الوصول الأمني (الوحدة مقفلة)' },
  0x35: { en: 'Invalid Key', ar: 'مفتاح الأمان غير صحيح' },
  0x36: { en: 'Exceeded Number Of Attempts', ar: 'تجاوزت الحد الأقصى لمحاولات الأمان المسموح بها' },
  0x37: { en: 'Required Time Delay Not Expired', ar: 'مهلة الانتظار الإلزامية لم تنتهِ بعد' },
  0x70: { en: 'Upload / Download Not Accepted', ar: 'عملية التحميل أو الرفع غير مقبولة' },
  0x71: { en: 'Transfer Data Suspended', ar: 'تم تعليق نقل البيانات' },
  0x72: { en: 'General Programming Failure', ar: 'فشل عام أثناء البرمجة أو الكتابة' },
  0x78: { en: 'Request Correctly Received - Response Pending', ar: 'تم استقبال الطلب بنجاح - الاستجابة معلقة قيد المعالجة' },
  0x7E: { en: 'Sub-Function Not Supported In Active Session', ar: 'الوظيفة الفرعية غير مسموحة في الجلسة الحالية' },
  0x7F: { en: 'Service Not Supported In Active Session', ar: 'الخدمة غير مسموحة في الجلسة التشخيصية الحالية' },
};

export class UdsService {
  public static decodeNrc(nrcHex: string): {
    nameEn: string;
    nameAr: string;
    descriptionEn: string;
    descriptionAr: string;
  } {
    const code = parseInt(nrcHex, 16);
    const item = NRC_DICTIONARY[code] || {
      en: `NRC 0x${nrcHex.toUpperCase()}`,
      ar: `رمز خطأ سلبي 0x${nrcHex.toUpperCase()}`
    };

    return {
      nameEn: item.en.replace(/\s+/g, ''),
      nameAr: item.ar,
      descriptionEn: item.en,
      descriptionAr: item.ar
    };
  }

  /**
   * Decode raw UDS response bytes into structured object
   */
  public static decodeResponse(bytes: number[]): {
    serviceId: number;
    isPositive: boolean;
    rawHex: string;
    decoded: string;
    decodedAr: string;
    nrcCode?: number;
    nrcDescriptionEn?: string;
    nrcDescriptionAr?: string;
  } {
    const rawHex = bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

    if (!bytes || bytes.length === 0) {
      return {
        serviceId: 0,
        isPositive: false,
        rawHex: '',
        decoded: 'Empty Response',
        decodedAr: 'استجابة فارغة'
      };
    }

    // Negative Response format: 0x7F [ServiceId] [NRC]
    if (bytes[0] === 0x7F) {
      const requestedSid = bytes.length > 1 ? bytes[1] : 0x00;
      const nrc = bytes.length > 2 ? bytes[2] : 0x10;
      const nrcInfo = NRC_DICTIONARY[nrc] || {
        en: `Vendor Specific NRC (0x${nrc.toString(16).toUpperCase()})`,
        ar: `رمز استجابة سلبية خاص بالمصنع (0x${nrc.toString(16).toUpperCase()})`
      };

      return {
        serviceId: requestedSid,
        isPositive: false,
        rawHex,
        decoded: `Negative Response (NRC 0x${nrc.toString(16).toUpperCase()}): ${nrcInfo.en}`,
        decodedAr: `استجابة سلبية (NRC 0x${nrc.toString(16).toUpperCase()}): ${nrcInfo.ar}`,
        nrcCode: nrc,
        nrcDescriptionEn: nrcInfo.en,
        nrcDescriptionAr: nrcInfo.ar
      };
    }

    // Positive Response: SID + 0x40
    const responseSid = bytes[0];
    const originalSid = responseSid >= 0x40 ? responseSid - 0x40 : responseSid;
    const sDef = UDS_SERVICES.find(s => s.serviceId === originalSid);

    let decodedEn = `Positive Response for Service 0x${originalSid.toString(16).toUpperCase()}`;
    let decodedAr = `استجابة إيجابية للخدمة 0x${originalSid.toString(16).toUpperCase()}`;

    if (originalSid === 0x22 && bytes.length >= 3) {
      // ReadDataByIdentifier: [0x62] [DID_HI] [DID_LO] [DATA...]
      const didHex = `0x${bytes[1].toString(16).padStart(2, '0')}${bytes[2].toString(16).padStart(2, '0')}`.toUpperCase();
      const payloadBytes = bytes.slice(3);
      const asciiVal = payloadBytes.map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
      decodedEn = `DID ${didHex} Data: [${rawHex.substring(9)}] | ASCII: "${asciiVal}"`;
      decodedAr = `بيانات المعرّف ${didHex}: [${rawHex.substring(9)}] | نص ASCII: "${asciiVal}"`;
    } else if (originalSid === 0x10 && bytes.length >= 2) {
      decodedEn = `Session 0x${bytes[1].toString(16).padStart(2, '0')} activated successfully`;
      decodedAr = `تم تفعيل الجلسة 0x${bytes[1].toString(16).padStart(2, '0')} بنجاح`;
    } else if (sDef) {
      decodedEn = `${sDef.nameEn} Positive Acknowledge`;
      decodedAr = `تأكيد نجاح ${sDef.nameAr}`;
    }

    return {
      serviceId: originalSid,
      isPositive: true,
      rawHex,
      decoded: decodedEn,
      decodedAr
    };
  }
}
