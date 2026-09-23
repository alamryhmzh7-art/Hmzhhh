import { transportManager } from '../network/TransportManager';
import { getNrcInfo, NrcInfo } from './nrc';

export interface ToyotaDid {
  idHex: string;
  did: number;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
}

export const TOYOTA_DIDS: ToyotaDid[] = [
  {
    idHex: '0xF190',
    did: 0xF190,
    nameEn: 'Vehicle Identification Number (VIN)',
    nameAr: 'رقم الشاسيه / الهيكل (VIN)',
    descriptionEn: 'Stored 17-character VIN identifier in ECM / Skid Control EEPROM',
    descriptionAr: 'رقم الهيكل (17 حرفاً) المخزن في ذاكرة وحدة تحكم المحرك أو الفرامل'
  },
  {
    idHex: '0xF18C',
    did: 0xF18C,
    nameEn: 'ECU Serial Number',
    nameAr: 'الرقم التسلسلي لوحدة التحكم (ECU Serial)',
    descriptionEn: 'Hardware production serial number assigned during manufacturing',
    descriptionAr: 'الرقم التسلسلي المصنعي للقطعة العتادية لوحدة التحكم'
  },
  {
    idHex: '0xF187',
    did: 0xF187,
    nameEn: 'Toyota OEM Part Number',
    nameAr: 'رقم قطعة تويوتا الأصلي (Part Number)',
    descriptionEn: 'Official Toyota 10-digit catalog part number (e.g. 89661-02X30)',
    descriptionAr: 'رقم القطعة المعتمد من تويوتا المكون من 10 أرقام (مثل 89661-02X30)'
  },
  {
    idHex: '0xF189',
    did: 0xF189,
    nameEn: 'Calibration Identification (Cal ID)',
    nameAr: 'معرّف البرمجية والمعايرة (Calibration ID)',
    descriptionEn: 'Software calibration version code flashed into the ECM',
    descriptionAr: 'رقم نسخة البرمجية والمعايرة المحملة على كمبيوتر المحرك'
  },
  {
    idHex: '0xF15A',
    did: 0xF15A,
    nameEn: 'Hybrid / 12V Battery Serial Number',
    nameAr: 'الرقم التسلسلي لبطارية الهايبرد / 12V',
    descriptionEn: 'Serial code assigned to the traction or auxiliary battery pack',
    descriptionAr: 'الشيفرة التسلسلية المسجلة لحزمة بطارية الجهد العالي أو المساعدة'
  },
  {
    idHex: '0xF14E',
    did: 0xF14E,
    nameEn: 'TPMS Tire Pressure Sensor Live Data',
    nameAr: 'بيانات ضغط الإطارات والمستشعرات (TPMS)',
    descriptionEn: 'Raw pressure and temperature metrics from 4/5 tire pressure valves',
    descriptionAr: 'قراءات الضغط والحرارة المباشرة المسجلة من صمامات الإطارات'
  }
];

export interface ToyotaRoutine {
  idHex: string;
  routineId: number;
  nameEn: string;
  nameAr: string;
  targetEcuAddrHex: string;
  targetEcuName: string;
  descriptionEn: string;
  descriptionAr: string;
  prerequisitesEn: string[];
  prerequisitesAr: string[];
  requiresSecurityAccess: boolean;
}

export const TOYOTA_ROUTINES: ToyotaRoutine[] = [
  {
    idHex: '0x0211',
    routineId: 0x0211,
    nameEn: 'Zero Point Calibration (Deceleration & Yaw Rate Sensors)',
    nameAr: 'معايرة النقطة الصفرية لحساس التسارع والياو (Zero Point Calibration)',
    targetEcuAddrHex: '0x7E2',
    targetEcuName: 'ABS / VSC / Skid Control ECU',
    descriptionEn: 'Calibrates yaw-rate, lateral acceleration, and steering angle neutral points in Skid Control ECU.',
    descriptionAr: 'معايرة مستشعرات زاوية التوجيه والانعطاف ومستشعر G-Sensor عند استبدال قطع نظام الفرامل، ضبط زوايا العجلات، أو مسح الذاكرة العشوائية.',
    prerequisitesEn: [
      'Park the vehicle on a level, flat surface (inclination < 1 degree).',
      'Keep the steering wheel centered and straight ahead.',
      'Shift gear to PARK (P) and release the parking brake.',
      'Ignition Switch ON (Engine OFF). Do not shake or vibrate the vehicle during calibration.',
      'Battery voltage > 12.2V.'
    ],
    prerequisitesAr: [
      'إيقاف المركبة على أرضية مستوية تماماً (نسبة الميلان أقل من 1 درجة).',
      'تثبيت عجلة القيادة (الدركسون) في المنتصف بوضع مستقيم للأمام.',
      'وضع ناقل الحركة في وضع التوقف (P) وتحرير فرامل اليد.',
      'فتح السويتش على وضع التشغيل ON (والمحرك متوقف OFF). تجنب هز أو تحريك السيارة أثناء المعايرة.',
      'جهد البطارية 12.2 فولت على الأقل.'
    ],
    requiresSecurityAccess: false
  },
  {
    idHex: '0x0245',
    routineId: 0x0245,
    nameEn: 'ABS Hydraulic Brake System Bleeding',
    nameAr: 'تنسيم ونزف هواء نظام الفرامل الهيدروليكي (ABS Bleeding)',
    targetEcuAddrHex: '0x7E2',
    targetEcuName: 'ABS / VSC / Brake Actuator ECU',
    descriptionEn: 'Cycles internal ABS solenoid valves and pump motor to purge trapped air from brake actuator unit.',
    descriptionAr: 'تشغيل صمامات ومضخة نظام ABS إلكترونياً لطرد فقاعات الهواء العالقة داخل وحدة التحكم الهيدروليكية (Actuator).',
    prerequisitesEn: [
      'Brake fluid reservoir filled to MAX line.',
      'Connect clear vinyl hose and container to bleeder screw.',
      'Ignition ON (Engine OFF), Battery charger connected.'
    ],
    prerequisitesAr: [
      'تعبئة علبة زيت الفرامل إلى علامة الحد الأقصى MAX.',
      'توصيل خرطوم شفاف ببرغي التنسيم مع وعاء التجميع.',
      'فتح السويتش ON (المحرك مطفأ)، مع توفير شاحن تغذية للبطارية.'
    ],
    requiresSecurityAccess: false
  },
  {
    idHex: '0x0110',
    routineId: 0x0110,
    nameEn: 'Toyota Hybrid HV Battery Control Unit Initialization',
    nameAr: 'تهيئة وإعادة ضبط كمبيوتر بطارية الهايبرد (HV Battery Initialization)',
    targetEcuAddrHex: '0x7E0',
    targetEcuName: 'Engine ECM / HV Battery ECU',
    descriptionEn: 'Initializes hybrid high-voltage battery SOC tracking algorithm and cell resistance maps after battery cell service.',
    descriptionAr: 'إعادة تهيئة خوارزميات تتبع مستوى الشحن ومقاومة الخلايا لكومبيوتر بطارية الهايبرد عالية الجهد بعد صيانة الخلايا.',
    prerequisitesEn: [
      'HV battery pack serviced or replaced.',
      'Ignition ON, Engine OFF.',
      'Battery voltage > 12.4V.'
    ],
    prerequisitesAr: [
      'إكمال صيانة أو استبدال خلايا بطارية الهايبرد HV.',
      'السويتش في وضع التشغيل IGN ON والمحرك متوقف.',
      'جهد البطارية أكبر من 12.4 فولت.'
    ],
    requiresSecurityAccess: true
  },
  {
    idHex: '0x0202',
    routineId: 0x0202,
    nameEn: 'Oil Maintenance Warning Indicator Reset',
    nameAr: 'تصفير مؤشر صيانة وزيت المحرك (Oil Maintenance Reset)',
    targetEcuAddrHex: '0x7C0',
    targetEcuName: 'Combination Meter / Instrument Cluster ECU',
    descriptionEn: 'Resets the instrument cluster oil change service interval and warning lamp.',
    descriptionAr: 'تصفير وإعادة ضبط عداد مسافة زيت المحرك وإطفاء لمبة التنبيه بالعدادات.',
    prerequisitesEn: [
      'Engine oil and filter change completed.',
      'Ignition ON, Engine OFF.',
      'Vehicle stationary.'
    ],
    prerequisitesAr: [
      'إكمال عملية تغيير زيت المحرك والفلتر.',
      'فتح السويتش IGN ON والمحرك متوقف.',
      'السيارة متوقفة تماماً.'
    ],
    requiresSecurityAccess: false
  },
  {
    idHex: '0x0203',
    routineId: 0x0203,
    nameEn: 'Engine Oil Degradation Counter Reset',
    nameAr: 'إعادة ضبط عداد تدهور واستهلاك الزيت (Engine Oil Reset)',
    targetEcuAddrHex: '0x7E0',
    targetEcuName: 'Engine ECM',
    descriptionEn: 'Clears calculated engine oil degradation percentage counter in ECM memory.',
    descriptionAr: 'مسح نسبة تدهور الزيت المحسوبة في ذاكرة كمبيوتر المحرك.',
    prerequisitesEn: [
      'Fresh engine oil filled.',
      'Ignition ON, Engine OFF.'
    ],
    prerequisitesAr: [
      'تعبئة زيت محرك جديد بجدة ممتازة.',
      'فتح السويتش IGN ON والمحرك مطفأ.'
    ],
    requiresSecurityAccess: true
  },
  {
    idHex: '0x0301',
    routineId: 0x0301,
    nameEn: 'Diesel Particulate Filter (DPF) Forced Regeneration',
    nameAr: 'التجديد الفعال القسري لفلتر البيئة/الديزل (DPF Regeneration)',
    targetEcuAddrHex: '0x7E0',
    targetEcuName: 'Diesel Engine ECM',
    descriptionEn: 'Triggers active exhaust thermal burn routine to clean soot accumulation from DPF.',
    descriptionAr: 'تفعيل الحرارة المرتفعة بالعادم لحرق وسخام الكربون المتراكم بفلتر الديزل.',
    prerequisitesEn: [
      'Vehicle outdoors in open well-ventilated area.',
      'Coolant temperature > 75°C.',
      'Fuel level > 25%.',
      'Hood open, gear in PARK.'
    ],
    prerequisitesAr: [
      'إيقاف السيارة في مكان مفتوح وجيد التهوية خارج الورشة.',
      'درجة حرارة السائل المبرد أصل من 75 درجة مئوية.',
      'مستوى الوقود أكثر من ربع التانكي (25%).',
      'فتح كبوت السيارة والقير بوضع P.'
    ],
    requiresSecurityAccess: true
  },
  {
    idHex: '0x0310',
    routineId: 0x0310,
    nameEn: 'Tire Pressure Monitoring (TPMS) ID Registration Reset',
    nameAr: 'إعادة تهيئة برمجة صمامات ضغط الإطارات (TPMS Reset)',
    targetEcuAddrHex: '0x7C4',
    targetEcuName: 'TPMS Receiver ECU',
    descriptionEn: 'Initiates learning routine for registered wheel sensor IDs.',
    descriptionAr: 'بدء روتين تعلّم وقراءة معرّفات مستشعرات وضغط الإطارات.',
    prerequisitesEn: [
      'All 4/5 tires inflated to rated placard pressure.',
      'Ignition ON.'
    ],
    prerequisitesAr: [
      'ضبط ضغط الهواء في جميع الإطارات حسب المعيار الموصى به.',
      'فتح السويتش IGN ON.'
    ],
    requiresSecurityAccess: false
  }
];

export interface ToyotaRoutineExecutionResult {
  success: boolean;
  routineIdHex: string;
  stepResults: {
    stepIndex: number;
    description: string;
    requestHex: string;
    responseHex: string;
    success: boolean;
    nrcInfo?: NrcInfo;
  }[];
  errorEn?: string;
  errorAr?: string;
}

export class ToyotaService {
  /**
   * Executes complete 7-step Toyota Routine sequence according to OEM spec:
   * 1. Extended Session (10 03)
   * 2. Security Access (27 01 / 27 02 if required)
   * 3. Control DTC Setting OFF (85 02)
   * 4. Execute Routine (31 01 XX XX)
   * 5. Control DTC Setting ON (85 01)
   * 6. Clear DTCs (14 FF FF FF)
   * 7. Default Session (10 01)
   */
  public async executeRoutine(
    routine: ToyotaRoutine,
    securityKeyHex?: string
  ): Promise<ToyotaRoutineExecutionResult> {
    const targetAddr = routine.targetEcuAddrHex || '0x7E0';
    const routineBytes = [0x31, 0x01, (routine.routineId >> 8) & 0xFF, routine.routineId & 0xFF];
    const routineHexStr = routineBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

    const steps = [
      { index: 1, desc: 'Enter Extended Diagnostic Session', reqBytes: [0x10, 0x03], delay: 400 },
      ...(routine.requiresSecurityAccess ? [
        { index: 2, desc: 'Security Access Seed Request', reqBytes: [0x27, 0x01], delay: 400 },
        { index: 3, desc: 'Security Access Key Unlock', reqBytes: securityKeyHex ? securityKeyHex.split(' ').map(h => parseInt(h, 16)) : [0x27, 0x02, 0x00, 0x00], delay: 400 }
      ] : []),
      { index: 4, desc: 'Disable DTC Storage During Routine', reqBytes: [0x85, 0x02], delay: 300 },
      { index: 5, desc: `Execute Toyota Routine (${routine.idHex})`, reqBytes: routineBytes, delay: 3500 },
      { index: 6, desc: 'Enable DTC Storage', reqBytes: [0x85, 0x01], delay: 300 },
      { index: 7, desc: 'Clear Stored Memory DTCs', reqBytes: [0x14, 0xFF, 0xFF, 0xFF], delay: 500 },
      { index: 8, desc: 'Return to Default Session', reqBytes: [0x10, 0x01], delay: 200 }
    ];

    const stepResults: ToyotaRoutineExecutionResult['stepResults'] = [];

    for (const step of steps) {
      console.log(`[TOYOTA-SERVICE] Running Routine Step ${step.index}: ${step.desc}`);
      let success = false;
      let respHex = '';
      let nrcInfo: NrcInfo | undefined = undefined;

      try {
        const resp = await transportManager.sendRequest(step.reqBytes, targetAddr);

        if (resp && (resp.status === 'SUCCESS' || resp.status === 'NRC') && resp.responseRaw) {
          respHex = resp.responseRaw;
          const respTokens = (respHex.trim().split(/\s+/) || []).filter(Boolean);
          const respBytes = (respTokens || []).map(h => parseInt(h, 16)).filter(n => !isNaN(n));

          if (respBytes.length > 0 && respBytes[0] === 0x7F) {
            const nrcCode = respBytes.length > 2 ? respBytes[2] : 0x10;
            nrcInfo = getNrcInfo(nrcCode);

            // If NRC 0x78 (Response Pending), wait and retry step once
            if (nrcCode === 0x78) {
              console.log(`[TOYOTA-SERVICE] Step ${step.index} returned NRC 0x78. Waiting 3000ms...`);
              await new Promise(r => setTimeout(r, 3000));
              const retryResp = await transportManager.sendRequest(step.reqBytes, targetAddr);
              if (retryResp && (retryResp.status === 'SUCCESS' || retryResp.status === 'NRC') && retryResp.responseRaw) {
                respHex = retryResp.responseRaw;
                success = true;
              }
            }
          } else {
            success = true;
          }
        }
      } catch (err) {
        console.warn(`[TOYOTA-SERVICE] Error at step ${step.index}:`, err);
      }

      stepResults.push({
        stepIndex: step.index,
        description: step.desc,
        requestHex: step.reqBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
        responseHex: respHex,
        success,
        nrcInfo
      });

      if (!success && step.index === 5) {
        // Main routine execution failed
        return {
          success: false,
          routineIdHex: routine.idHex,
          stepResults,
          errorEn: `Toyota routine ${routine.nameEn} failed during execution step.`,
          errorAr: `فشلت عملية تنفيذ روتين تويوتا ${routine.nameAr} أثناء مرحلة الإجراء.`
        };
      }

      if (step.delay > 0) {
        await new Promise(r => setTimeout(r, step.delay));
      }
    }

    return {
      success: true,
      routineIdHex: routine.idHex,
      stepResults
    };
  }

  /**
   * Reads a Toyota Data Identifier (DID)
   */
  public async readDid(did: ToyotaDid, targetAddrHex: string = '0x7E0') {
    const reqBytes = [0x22, (did.did >> 8) & 0xFF, did.did & 0xFF];
    try {
      const resp = await transportManager.sendRequest(reqBytes, targetAddrHex);
      if (resp && resp.status === 'SUCCESS' && resp.responseRaw) {
        const tokens = (resp.responseRaw.trim().split(/\s+/) || []).filter(Boolean);
        const bytes = (tokens || []).map(h => parseInt(h, 16)).filter(n => !isNaN(n));
        const payload = bytes.slice(3);
        const ascii = (payload || []).map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');
        return {
          success: true,
          rawHex: resp.responseRaw,
          payloadHex: payload.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
          ascii
        };
      }
    } catch (err: any) {
      console.error(`[TOYOTA-SERVICE] Failed reading DID ${did.idHex}:`, err);
    }

    return {
      success: false,
      rawHex: '',
      payloadHex: '',
      ascii: ''
    };
  }
}

export const toyotaService = new ToyotaService();
