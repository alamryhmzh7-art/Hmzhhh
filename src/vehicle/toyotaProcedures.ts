export interface ToyotaProcedure {
  id: string;
  nameEn: string;
  nameAr: string;
  targetEcu: string;
  targetEcuAddrHex: string;
  descriptionEn: string;
  descriptionAr: string;
  prerequisitesEn: string[];
  prerequisitesAr: string[];
  stepsEn: string[];
  stepsAr: string[];
  commandSequence: {
    stepIndex: number;
    requestHex: string;
    expectedResponseHexPrefix: string;
    delayMs: number;
    description: string;
  }[];
}

export const TOYOTA_OEM_PROCEDURES: ToyotaProcedure[] = [
  {
    id: 'toyota-zero-point-cal',
    nameEn: 'Zero Point Calibration (Deceleration & Yaw Rate Sensors)',
    nameAr: 'معايرة النقطة الصفرية لحساس التسارع والياو (Zero Point Calibration)',
    targetEcu: 'ABS / VSC / Skid Control ECU',
    targetEcuAddrHex: '0x7E2',
    descriptionEn: 'Calibrates yaw-rate, lateral acceleration, and steering angle neutral points after wheel alignment, ABS replacement, or battery disconnection.',
    descriptionAr: 'معايرة مستشعرات زاوية التوجيه والانعطاف ومستشعر G-Sensor عند استبدال قطع نظام الفرامل، ضبط زوايا العجلات، أو مسح الذاكرة العشوائية.',
    prerequisitesEn: [
      'Park the vehicle on a level, flat surface (inclination < 1 degree).',
      'Keep the steering wheel centered and straight ahead.',
      'Shift gear to PARK (P) and release the parking brake.',
      'Ignition Switch ON (Engine OFF). Do not shake or vibrate the vehicle during calibration.',
      'Battery voltage must be above 12.2V.'
    ],
    prerequisitesAr: [
      'إيقاف المركبة على أرضية مستوية تماماً (نسبة الميلان أقل من 1 درجة).',
      'تثبيت عجلة القيادة (الدركسون) في المنتصف بوضع مستقيم للأمام.',
      'وضع ناقل الحركة في وضع التوقف (P) وتحرير فرامل اليد.',
      'فتح السويتش على وضع التشغيل ON (والمحرك متوقف OFF). تجنب هز أو تحريك السيارة أثناء المعايرة.',
      'جهد البطارية 12.2 فولت على الأقل.'
    ],
    stepsEn: [
      'Clear existing calibration memory from Skid Control ECU.',
      'Send routine activation request (Routine ID 0x0211).',
      'Wait for 4 seconds while sensors settle.',
      'Verify positive acknowledge from 0x7E2 and check ABS/VSC warning light flashing.'
    ],
    stepsAr: [
      'مسح بيانات المعايرة السابقة من كمبيوتر ABS/VSC.',
      'إرسال أمر تفعيل روتين المعايرة (Routine ID 0x0211).',
      'الانتظار لمدة 4 ثوانٍ حتى تثبيت قراءات الحساسات.',
      'التحقق من رد التأكيد الإيجابي من الوحدة وملاحظة وميض لمبة ABS/VSC في الطبلون.'
    ],
    commandSequence: [
      { stepIndex: 1, requestHex: '10 03', expectedResponseHexPrefix: '50 03', delayMs: 500, description: 'Enter Extended Diagnostic Session' },
      { stepIndex: 2, requestHex: '31 01 02 11', expectedResponseHexPrefix: '71 01 02 11', delayMs: 3500, description: 'Execute Zero Point Calibration Routine' },
      { stepIndex: 3, requestHex: '31 03 02 11', expectedResponseHexPrefix: '71 03 02 11 00', delayMs: 500, description: 'Request Routine Results (Status Complete)' }
    ]
  },
  {
    id: 'toyota-abs-bleeding',
    nameEn: 'Hydraulic ABS Brake Bleeding Routine',
    nameAr: 'تنسيم ونزف هواء نظام الفرامل الهيدروليكي (ABS Bleeding)',
    targetEcu: 'ABS / VSC ECU',
    targetEcuAddrHex: '0x7E2',
    descriptionEn: 'Cycles the internal ABS solenoid valves and motor pump to purge trapped air bubbles from the brake actuator unit.',
    descriptionAr: 'تشغيل صمامات ومضخة نظام ABS إلكترونياً لطرد فقاعات الهواء العالقة داخل وحدة التحكم الهيدروليكية (Actuator).',
    prerequisitesEn: [
      'Brake fluid reservoir filled to MAX line with DOT 3 / DOT 4 fluid.',
      'Connect clear vinyl hose and container to brake bleeder plug.',
      'Depress and hold brake pedal when prompted.',
      'Ignition ON (Engine OFF), Battery support charger connected (> 12.4V).'
    ],
    prerequisitesAr: [
      'تعبئة علبة زيت الفرامل إلى علامة الحد الأقصى MAX بزيت DOT3 أو DOT4 مناسب.',
      'توصيل خرطوم شفاف ببرغي التنسيم مع وعاء التجميع.',
      'الضغط المستمر على دواسة الفرامل عند طلب التطبيق.',
      'فتح السويتش ON (المحرك مطفأ)، مع توفير شاحن تغذية للبطارية (> 12.4V).'
    ],
    stepsEn: [
      'Activate Front Left Solenoid and Pump for 3 seconds.',
      'Open bleeder valve until air bubbles stop.',
      'Repeat for Front Right, Rear Left, and Rear Right circuits.',
      'Complete routine and restore normal braking mode.'
    ],
    stepsAr: [
      'تفعيل صمامات ومضخة العجلة الأمامية اليسرى لمدة 3 ثوانٍ.',
      'فتح صمام التنسيم حتى انقطاع فقاعات الهواء ثم إغلاقه.',
      'تكرار الخطوة للدوائر: الأمامية اليمنى، الخلفية اليسرى، والخلفية اليمنى.',
      'إنهاء الروتين وإعادة النظام للوضع الطبيعي.'
    ],
    commandSequence: [
      { stepIndex: 1, requestHex: '10 03', expectedResponseHexPrefix: '50 03', delayMs: 400, description: 'Extended Session' },
      { stepIndex: 2, requestHex: '31 01 02 45 01', expectedResponseHexPrefix: '71 01 02 45', delayMs: 4000, description: 'Motor & Solenoid Cycle Pump ON' },
      { stepIndex: 3, requestHex: '31 02 02 45', expectedResponseHexPrefix: '71 02 02 45', delayMs: 500, description: 'Stop Bleed Routine' }
    ]
  },
  {
    id: 'toyota-idle-relearn',
    nameEn: 'Engine Idle Air Volume Relearn / Throttle Reset',
    nameAr: 'إعادة تعلّم خمول المحرك وضبط الثروتل (Idle Air Relearn)',
    targetEcu: 'Engine ECM',
    targetEcuAddrHex: '0x7E0',
    descriptionEn: 'Resets learned electronic throttle body memory and relearns the base idle air volume after throttle body cleaning or replacement.',
    descriptionAr: 'إعادة تهيئة ذاكرة بوابة الهواء (الثروتل) وتعلّم كمية هواء الخمول الأساسية بعد تنظيف أو استبدال الثروتل أو فصل البطارية.',
    prerequisitesEn: [
      'Engine coolant temperature reached normal operating temp (80°C - 95°C).',
      'All electrical loads (A/C, headlights, blower, defogger) turned OFF.',
      'Shift lever in PARK (P) or NEUTRAL (N).',
      'Steering wheel centered.'
    ],
    prerequisitesAr: [
      'وصول حرارة المحرك لدرجة حرارة التشغيل الطبيعية (80°C - 95°C).',
      'إطفاء جميع الأحمال الكهربائية (المكيف، الأنوار، مروحة المقصورة، مانع الضباب).',
      'القير في وضع التوقف (P) أو الفاضي (N).',
      'عجلة القيادة في وضع مستقيم.'
    ],
    stepsEn: [
      'Erase throttle learned values from ECM EEPROM.',
      'Run engine at idle for 10 minutes without touching accelerator pedal.',
      'Confirm idle RPM settles within specification (650 - 750 RPM).'
    ],
    stepsAr: [
      'مسح القيم المتعلّمة القديمة من ذاكرة كمبيوتر المحرك.',
      'ترك المحرك يعمل في وضع الخمول لمدة 10 دقائق دون لمس دواسة الوقود.',
      'التأكد من استقرار دورات الخمول ضمن المعدل الطبيعي (650 - 750 RPM).'
    ],
    commandSequence: [
      { stepIndex: 1, requestHex: '10 03', expectedResponseHexPrefix: '50 03', delayMs: 500, description: 'Extended Session' },
      { stepIndex: 2, requestHex: '31 01 01 A0', expectedResponseHexPrefix: '71 01 01 A0', delayMs: 2000, description: 'Clear Throttle Adaptation Memory' },
      { stepIndex: 3, requestHex: '22 F1 05', expectedResponseHexPrefix: '62 F1 05', delayMs: 500, description: 'Read Target Idle Status' }
    ]
  },
  {
    id: 'toyota-atf-temp-check',
    nameEn: 'A/T Fluid Temperature Inspection Mode',
    nameAr: 'وضع فحص حرارة زيت القير (A/T Fluid Temp Check Mode)',
    targetEcu: 'Transmission TCM / ECM',
    targetEcuAddrHex: '0x7E1',
    descriptionEn: 'Puts the transmission ECU in oil level inspection mode to verify ATF temperature is within the correct check window (42°C - 49°C).',
    descriptionAr: 'تفعيل وضع فحص مستوى زيت ناقل الحركة الأوتوماتيكي والتأكد من وجود درجة الحرارة في النطاق الصحيح للمعايرة (42°C - 49°C).',
    prerequisitesEn: [
      'Vehicle on level lift/ground.',
      'Engine running at idle.',
      'A/C OFF.'
    ],
    prerequisitesAr: [
      'السيارة مرفوعة بشكل أفقي مستوٍ.',
      'المحرك يعمل في وضع الخمول.',
      'المكيف مطفأ.'
    ],
    stepsEn: [
      'Activate ATF temperature check mode on TCM.',
      'Observe live ATF temperature until it reaches exactly 42°C - 49°C.',
      'Remove overflow plug to adjust fluid level.'
    ],
    stepsAr: [
      'تفعيل وضع فحص حرارة سائل ناقل الحركة في كمبيوتر القير.',
      'مراقبة قراءة حرارة الزيت المباشرة حتى وصولها للنطاق (42°C - 49°C).',
      'فك صرة الفائض وتعديل مستوى الزيت حتى يبدأ الزيت بالتقطير الخفيف.'
    ],
    commandSequence: [
      { stepIndex: 1, requestHex: '10 03', expectedResponseHexPrefix: '50 03', delayMs: 400, description: 'Extended Diagnostic Session' },
      { stepIndex: 2, requestHex: '22 1E 02', expectedResponseHexPrefix: '62 1E 02', delayMs: 500, description: 'Read Live ATF Temp DID' }
    ]
  }
];
