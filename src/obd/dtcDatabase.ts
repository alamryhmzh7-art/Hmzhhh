import { DiagnosticTroubleCode, DtcStatus } from '../types';

export const DTC_DATABASE: Record<string, { en: string; ar: string; sys: 'Powertrain (P)' | 'Chassis (C)' | 'Body (B)' | 'Network (U)' | string; sev: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }> = {
  'P0300': {
    en: 'Random/Multiple Cylinder Misfire Detected',
    ar: 'اكتشاف فقد إشعال عشوائي / في عدة أسطوانات (ميس فاير)',
    sys: 'POWERTRAIN',
    sev: 'HIGH'
  },
  'P0301': {
    en: 'Cylinder 1 Misfire Detected',
    ar: 'فقد إشعال في الأسطوانة رقم 1',
    sys: 'POWERTRAIN',
    sev: 'HIGH'
  },
  'P0302': {
    en: 'Cylinder 2 Misfire Detected',
    ar: 'فقد إشعال في الأسطوانة رقم 2',
    sys: 'POWERTRAIN',
    sev: 'HIGH'
  },
  'P0171': {
    en: 'System Too Lean (Bank 1) - Fuel Trim / Vacuum Leak',
    ar: 'خليط وقود فقير جداً (بنك 1) - تسريب هواء أو نقص وقود',
    sys: 'POWERTRAIN',
    sev: 'MEDIUM'
  },
  'P0172': {
    en: 'System Too Rich (Bank 1)',
    ar: 'خليط وقود غني جداً (بنك 1)',
    sys: 'POWERTRAIN',
    sev: 'MEDIUM'
  },
  'P0420': {
    en: 'Catalyst System Efficiency Below Threshold (Bank 1)',
    ar: 'كفاءة دبة التلوث / المحفز أقل من الحد المسموح (بنك 1)',
    sys: 'POWERTRAIN',
    sev: 'MEDIUM'
  },
  'P0113': {
    en: 'Intake Air Temperature Sensor 1 Circuit High Input',
    ar: 'إشارة مرتفعة في دائرة حساس حرارة هواء السحب (IAT)',
    sys: 'POWERTRAIN',
    sev: 'LOW'
  },
  'P0102': {
    en: 'Mass Air Flow (MAF) Circuit Low Input',
    ar: 'إشارة منخفضة في دائرة حساس تدفق الهواء (MAF)',
    sys: 'POWERTRAIN',
    sev: 'MEDIUM'
  },
  'P0128': {
    en: 'Coolant Thermostat (Coolant Temp Below Regulating Temp)',
    ar: 'خلل في بلف الحرارة (ثرموستات سائل التبريد)',
    sys: 'POWERTRAIN',
    sev: 'LOW'
  },
  'P0500': {
    en: 'Vehicle Speed Sensor "A" Malfunction',
    ar: 'عطل في حساس سرعة المركبة (VSS)',
    sys: 'POWERTRAIN',
    sev: 'HIGH'
  },
  'P0135': {
    en: 'O2 Sensor Heater Circuit Malfunction (Bank 1 Sensor 1)',
    ar: 'عطل في دائرة سخان حساس الأكسجين (بنك 1 حساس 1)',
    sys: 'POWERTRAIN',
    sev: 'LOW'
  },
  'P0442': {
    en: 'Evaporative Emission System Leak Detected (Small Leak)',
    ar: 'تسريب صغير في نظام تبخير الوقود (EVAP)',
    sys: 'POWERTRAIN',
    sev: 'LOW'
  },
  'U0100': {
    en: 'Lost Communication with ECM/PCM "A"',
    ar: 'فقدان الاتصال مع كمبيوتر المحرك الرئيسي (ECM)',
    sys: 'NETWORK',
    sev: 'CRITICAL'
  },
  'U0121': {
    en: 'Lost Communication with ABS Control Module',
    ar: 'فقدان الاتصال مع وحدة التحكم بالفرامل المانعة للانغلاق (ABS)',
    sys: 'NETWORK',
    sev: 'HIGH'
  },
  'C1201': {
    en: 'Engine Control System Malfunction / VSC Disabled',
    ar: 'خلل في نظام التحكم بالمحرك تسبب في تعطيل نظام الثبات VSC',
    sys: 'CHASSIS',
    sev: 'HIGH'
  },
  'C1241': {
    en: 'Low or High Power Supply Voltage (ABS/VSC)',
    ar: 'جهد التغذية الكهربائية غير طبيعي لوحدة الفرامل والثبات',
    sys: 'CHASSIS',
    sev: 'MEDIUM'
  },
  'B1000': {
    en: 'ECU Internal Electronic Malfunction',
    ar: 'عطل إلكتروني داخلي في وحدة التحكم',
    sys: 'BODY',
    sev: 'CRITICAL'
  }
};

export const initialDtcDatabase: DiagnosticTroubleCode[] = [
  {
    code: 'P0171',
    system: 'POWERTRAIN',
    descriptionEn: 'System Too Lean (Bank 1) - Fuel Trim / Vacuum Leak',
    descriptionAr: 'خليط وقود فقير جداً (بنك 1) - تسريب هواء أو نقص وقود',
    severity: 'MEDIUM',
    status: 'CONFIRMED',
    ecuAddressHex: '0x7E0',
    freezeFrameAvailable: true,
    possibleCauses: ['Vacuum Leak in Intake Manifold', 'Faulty MAF Sensor', 'Clogged Fuel Injector', 'Low Fuel Rail Pressure'],
    freezeFrameData: {
      engineRpm: 2150,
      vehicleSpeed: 64,
      coolantTempC: 89,
      calculatedLoadPercent: 42,
      shortTermFuelTrim1: 18.5,
      longTermFuelTrim1: 22.0
    }
  },
  {
    code: 'P0300',
    system: 'POWERTRAIN',
    descriptionEn: 'Random/Multiple Cylinder Misfire Detected',
    descriptionAr: 'اكتشاف فقد إشعال عشوائي أو متعدد في أسطوانات المحرك',
    severity: 'HIGH',
    status: 'PENDING',
    ecuAddressHex: '0x7E0',
    freezeFrameAvailable: true,
    possibleCauses: ['Worn Spark Plugs', 'Faulty Ignition Coil', 'Low Engine Compression', 'Fuel Delivery Issue']
  },
  {
    code: 'C1201',
    system: 'CHASSIS',
    descriptionEn: 'Engine Control System Malfunction (ABS / VSC Interlock)',
    descriptionAr: 'خلل في نظام التحكم بالمحرك تم تمريره إلى نظام مانع الانزلاق والفرامل ABS/VSC',
    severity: 'MEDIUM',
    status: 'CONFIRMED',
    ecuAddressHex: '0x7E2',
    freezeFrameAvailable: false,
    possibleCauses: ['Check Engine Light Triggered in ECM', 'VSC Disabled by ECM Request']
  }
];

export class DtcDecoder {
  public static decodeDtcBytes(byte1: number, byte2: number): string {
    const firstCharType = (byte1 & 0xC0) >> 6;
    let prefix = 'P';
    if (firstCharType === 0) prefix = 'P';
    else if (firstCharType === 1) prefix = 'C';
    else if (firstCharType === 2) prefix = 'B';
    else if (firstCharType === 3) prefix = 'U';

    const secondDigit = (byte1 & 0x30) >> 4;
    const thirdDigit = byte1 & 0x0F;
    const fourthDigit = (byte2 & 0xF0) >> 4;
    const fifthDigit = byte2 & 0x0F;

    return `${prefix}${secondDigit.toString(16).toUpperCase()}${thirdDigit.toString(16).toUpperCase()}${fourthDigit.toString(16).toUpperCase()}${fifthDigit.toString(16).toUpperCase()}`;
  }

  public static parseDtcList(bytes: number[], status: DtcStatus, ecuName: string = 'Engine ECU (0x7E0)', ecuAddr: string = '0x7E0'): DiagnosticTroubleCode[] {
    const results: DiagnosticTroubleCode[] = [];
    for (let i = 0; i < bytes.length; i += 2) {
      if (i + 1 >= bytes.length) break;
      const b1 = bytes[i];
      const b2 = bytes[i + 1];
      if (b1 === 0 && b2 === 0) continue;

      const code = this.decodeDtcBytes(b1, b2);
      const entry = DTC_DATABASE[code];

      if (entry) {
        results.push({
          code,
          descriptionEn: entry.en,
          descriptionAr: entry.ar,
          ecu: ecuName,
          ecuAddressHex: ecuAddr,
          status,
          severity: entry.sev,
          system: entry.sys,
          freezeFrameAvailable: true,
        });
      } else {
        results.push({
          code,
          descriptionEn: 'Description not available in standard database.',
          descriptionAr: 'الوصف غير متوفر في قاعدة البيانات القياسية.',
          ecu: ecuName,
          ecuAddressHex: ecuAddr,
          status,
          severity: 'MEDIUM',
          system: code.startsWith('P') ? 'POWERTRAIN' : code.startsWith('C') ? 'CHASSIS' : code.startsWith('B') ? 'BODY' : 'NETWORK',
          freezeFrameAvailable: false,
        });
      }
    }
    return results;
  }
}
