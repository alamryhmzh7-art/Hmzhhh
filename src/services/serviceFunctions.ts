import { ServiceFunctionItem } from '../types';

export const SERVICE_FUNCTIONS_CATALOG: ServiceFunctionItem[] = [
  {
    id: 'srv-oil-reset',
    titleEn: 'Oil Service Interval Reset',
    titleAr: 'إعادة ضبط مؤشر تغيير الزيت والصيانة (Oil Reset)',
    descriptionEn: 'Resets the oil life indicator and maintenance warning counter in the instrument cluster / ECU.',
    descriptionAr: 'تصفير عداد عمر الزيت ومسح تنبيه الصيانة الدورية من شاشة السائق وكمبيوتر المحرك.',
    category: 'ENGINE',
    ecuTarget: 'Instrument Cluster (0x7E5) / ECM (0x7E0)',
    routineIdHex: '0x0110',
    supportedVehicles: ['Toyota', 'Lexus', 'Nissan', 'Hyundai', 'Kia', 'Ford', 'BMW', 'Mercedes'],
    requiredConditions: {
      minVoltage: 12.0,
      ignitionState: 'ON',
      engineState: 'STOPPED',
      gearPosition: 'PARK',
      parkingBrake: 'ANY'
    },
    warningsEn: [
      'Only perform this procedure after physically changing the engine oil and filter.',
      'Ensure the engine is completely stopped and ignition is in ON (Run) position.'
    ],
    warningsAr: [
      'لا تقم بهذا الإجراء إلا بعد استبدال زيت وفلتر المحرك فعلياً.',
      'تأكد أن المحرك متوقف تماماً وأن السويتش في وضع التشغيل ON.'
    ],
    stepsEn: [
      'Connect to Instrument Cluster / ECM via UDS Session 0x03.',
      'Send Reset Routine command 0x31 01 01 10.',
      'Confirm indicator resets to 100% / 10,000 km.'
    ],
    stepsAr: [
      'الاتصال بكمبيوتر لوحة العدادات / المحرك عبر جلسة UDS رقم 0x03.',
      'إرسال أمر تصفير عداد الصيانة 0x31 01 01 10.',
      'التحقق من إعادة ضبط المؤشر إلى 100% أو 10,000 كم.'
    ]
  },
  {
    id: 'srv-throttle-adapt',
    titleEn: 'Electronic Throttle Body Adaptation & Relearn',
    titleAr: 'تكييف وإعادة تعلّم بوابة الهواء (Throttle Adaptation)',
    descriptionEn: 'Calibrates the zero position and full span of electronic throttle body potentiometer sensors.',
    descriptionAr: 'معايرة النطاق الكهربائي وموضع الإغلاق التام لبوابة الخانق الإلكتروني بعد التنظيف أو الاستبدال.',
    category: 'ENGINE',
    ecuTarget: 'Engine ECM (0x7E0)',
    routineIdHex: '0x01A0',
    supportedVehicles: ['Toyota', 'Nissan', 'Hyundai', 'Kia', 'Ford', 'BMW'],
    requiredConditions: {
      minVoltage: 12.4,
      ignitionState: 'ON',
      engineState: 'STOPPED',
      gearPosition: 'PARK',
      parkingBrake: 'ENGAGED'
    },
    warningsEn: [
      'Do not touch the accelerator pedal during calibration.',
      'Coolant temperature must be between 10°C and 90°C.'
    ],
    warningsAr: [
      'لا تضغط على دواسة الوقود مطلقاً أثناء عملية المعايرة.',
      'يجب أن تكون حرارة سائل التبريد بين 10 و90 درجة مئوية.'
    ],
    stepsEn: [
      'Verify battery voltage >= 12.4V.',
      'Clear existing throttle adaptive memory (0x31 01 01 A0).',
      'Actuator tests min/max positions.',
      'Cycle ignition OFF then ON.'
    ],
    stepsAr: [
      'التحقق من جهد البطارية أعلى من 12.4 فولت.',
      'مسح قيم التكييف السابقة من الذاكرة (0x31 01 01 A0).',
      'يقوم المشغل بفتح وإغلاق البوابة آلياً لاختبار الحدين الأدنى والأقصى.',
      'إطفاء السويتش ثم إعادة فتحه.'
    ]
  },
  {
    id: 'srv-epb-service',
    titleEn: 'EPB Brake Pad Replacement (Service Mode)',
    titleAr: 'وضع صيانة فرامل التوقف الإلكترونية (EPB Service)',
    descriptionEn: 'Retracts the electronic rear caliper parking brake motors into service position for pad replacement.',
    descriptionAr: 'فتح وترجيع محركات كليبرات الفرامل الإلكترونية الخلفية لوضع الصيانة لتمكين استبدال الفحمات/الأقمشة بأمان.',
    category: 'BRAKES',
    ecuTarget: 'ABS / EPB ECU (0x7E2)',
    routineIdHex: '0x0280',
    supportedVehicles: ['Toyota', 'Lexus', 'Hyundai', 'Kia', 'Ford', 'BMW', 'Mercedes'],
    requiredConditions: {
      minVoltage: 12.5,
      ignitionState: 'ON',
      engineState: 'STOPPED',
      gearPosition: 'PARK',
      parkingBrake: 'RELEASED'
    },
    warningsEn: [
      'Keep fingers completely clear of rear calipers while motors are moving.',
      'Do not press the brake pedal while calipers are in service mode.'
    ],
    warningsAr: [
      'أبعد يديك وأصابعك تماماً عن الكليبرات الخلفية أثناء حركة المحركات الكهربائية.',
      'لا تضغط على دواسة الفرامل أثناء وجود النظام في وضع الصيانة.'
    ],
    stepsEn: [
      'Send EPB Open/Retract routine command (0x31 01 02 80 01).',
      'Wait for piston motor retraction to complete (approx 8 seconds).',
      'Replace mechanical brake pads.',
      'Send EPB Close/Calibration routine (0x31 01 02 80 02) to clamp.'
    ],
    stepsAr: [
      'إرسال أمر فتح وإرجاع محركات EPB لوضع الصيانة (0x31 01 02 80 01).',
      'الانتظار حتى انتهاء سحب البستم تماماً (حوالي 8 ثوانٍ).',
      'استبدال الفحمات الميكانيكية بأمان.',
      'إرسال أمر إغلاق ومعايرة الشد (0x31 01 02 80 02).'
    ]
  },
  {
    id: 'srv-sas-cal',
    titleEn: 'Steering Angle Sensor (SAS) Calibration',
    titleAr: 'معايرة مستشعر زاوية عجلة القيادة (SAS Calibration)',
    descriptionEn: 'Re-zeros the Steering Angle Sensor optical encoder on the steering column.',
    descriptionAr: 'إعادة ضبط نقطة الصفر لمستشعر زاوية الدركسون بعد ضبط الميزان أو تغيير الدودة ومقصات التوجيه.',
    category: 'STEERING',
    ecuTarget: 'Electric Power Steering (0x720) / ABS (0x7E2)',
    routineIdHex: '0x0320',
    supportedVehicles: ['Toyota', 'Lexus', 'Nissan', 'Hyundai', 'Kia', 'Ford', 'BMW'],
    requiredConditions: {
      minVoltage: 12.2,
      ignitionState: 'ON',
      engineState: 'STOPPED',
      gearPosition: 'PARK',
      parkingBrake: 'ENGAGED'
    },
    warningsEn: [
      'Steering wheel must be aligned dead center before initiating.',
      'Vehicle must be on level ground.'
    ],
    warningsAr: [
      'يجب تثبيت طارة الدركسون في المنتصف بشكل مستقيم تماماً قبل البدء.',
      'يجب أن تكون السيارة على أرضية مستوية تماماً.'
    ],
    stepsEn: [
      'Center steering wheel manually.',
      'Send SAS Zero Calibration command (0x31 01 03 20).',
      'Turn wheel 90 degrees left then right and back to center.',
      'Verify live angle reads 0.0 degrees.'
    ],
    stepsAr: [
      'توسيط عجلة القيادة يدوياً.',
      'إرسال أمر معايرة الصفر (0x31 01 03 20).',
      'لف الدركسون 90 درجة لليسار ثم لليمين ثم العودة للمنتصف.',
      'التأكد من أن القراءة الحية للزاوية أصبحت 0.0 درجة.'
    ]
  },
  {
    id: 'srv-battery-reg',
    titleEn: 'Battery Registration & BMS Reset',
    titleAr: 'تسجيل البطارية الجديدة وضبط نظام الشحن (Battery Registration)',
    descriptionEn: 'Registers a newly installed 12V AGM/EFB/Lead-Acid battery into the Battery Management System.',
    descriptionAr: 'تسجيل سعة وتاريخ البطارية الجديدة في كمبيوتر إدارة الشحن BMS لمنع الشحن الزائد وإطالة عمرها.',
    category: 'BATTERY',
    ecuTarget: 'Body Control Module (0x7E4) / Gateway',
    routineIdHex: '0x0410',
    supportedVehicles: ['BMW', 'Ford', 'Mercedes', 'Toyota Hybrid', 'Hyundai', 'Kia'],
    requiredConditions: {
      minVoltage: 12.3,
      ignitionState: 'ON',
      engineState: 'STOPPED',
      gearPosition: 'PARK',
      parkingBrake: 'ANY'
    },
    warningsEn: [
      'Ensure the new battery Ah rating matches or update the coding value accordingly.'
    ],
    warningsAr: [
      'تأكد من أن سعة البطارية الجديدة (أمبير/ساعة) متطابقة مع المواصفات المسجلة.'
    ],
    stepsEn: [
      'Read current battery state-of-charge statistics.',
      'Send Battery Replacement Registration command (0x31 01 04 10).',
      'Clear BMS aging counter and reset alternator charge map.'
    ],
    stepsAr: [
      'قراءة إحصائيات الشحن وعمر البطارية السابقة.',
      'إرسال أمر تسجيل استبدال البطارية (0x31 01 04 10).',
      'تصفير عداد الشيخوخة وإعادة معايرة دينامو الشحن.'
    ]
  },
  {
    id: 'srv-dpf-regen',
    titleEn: 'DPF Regeneration (Forced Service Regen)',
    titleAr: 'تجديد وحرق فلتر الديزل (DPF Forced Service Regeneration)',
    descriptionEn: 'Initiates a stationary forced regeneration to burn accumulated soot in the Diesel Particulate Filter.',
    descriptionAr: 'بدء عملية الحرق الذاتي القسري لسناج الكربون المتراكم في فلتر جزيئات الديزل (DPF).',
    category: 'EXHAUST',
    ecuTarget: 'Engine ECM (0x7E0)',
    routineIdHex: '0x0550',
    supportedVehicles: ['Toyota Land Cruiser Diesel', 'Ford PowerStroke', 'Hyundai/Kia CRDi', 'BMW Diesel', 'Mercedes BlueTEC'],
    requiredConditions: {
      minVoltage: 12.5,
      ignitionState: 'RUNNING',
      engineState: 'IDLE',
      gearPosition: 'PARK',
      parkingBrake: 'ENGAGED'
    },
    warningsEn: [
      'DANGER: Exhaust tailpipe will reach extreme temperatures (> 600°C).',
      'Keep clear of combustible materials and do not run inside enclosed spaces without extraction.'
    ],
    warningsAr: [
      'خطر شديد: ستصل حرارة الشكمان والعادم إلى درجات مرتفعة جداً (> 600°C).',
      'تأكد من إبعاد السيارة عن أي مواد قابلة للاشتعال وعدم التشغيل في ورشة مغلقة بدون تهوية.'
    ],
    stepsEn: [
      'Check fuel level (> 50%) and coolant temperature (> 70°C).',
      'Send DPF Forced Regen command (0x31 01 05 50).',
      'ECM raises RPM automatically to 2000 RPM for 15-25 minutes.',
      'Cool down period at idle.'
    ],
    stepsAr: [
      'التحقق من مستوى الوقود (> 50%) وحرارة المحرك (> 70°C).',
      'إرسال أمر بدء الحرق القسري لفلتر الديزل (0x31 01 05 50).',
      'يقوم كمبيوتر المحرك برفع السرعة تلقائياً إلى 2000 دورة لمدة 15-25 دقيقة.',
      'فترة تبريد تدريجية في وضع الخمول.'
    ]
  },
  {
    id: 'srv-injector-coding',
    titleEn: 'Fuel Injector Quantity Adjustment Coding (IMA)',
    titleAr: 'ترميز بخاخات الوقود وحقن الديزل/البنزين (Injector Coding)',
    descriptionEn: 'Programs individual 16-30 digit calibration alphanumeric codes for common rail injectors.',
    descriptionAr: 'برمجة الرموز الدقيقة لكل بخاخ في كمبيوتر المحرك لضبط كمية وتوقيت الحقن بدقة متناهية.',
    category: 'ENGINE',
    ecuTarget: 'Engine ECM (0x7E0)',
    routineIdHex: '0x0620',
    supportedVehicles: ['Toyota', 'Ford', 'Hyundai', 'Kia', 'BMW', 'Mercedes'],
    requiredConditions: {
      minVoltage: 12.4,
      ignitionState: 'ON',
      engineState: 'STOPPED',
      gearPosition: 'PARK',
      parkingBrake: 'ENGAGED'
    },
    warningsEn: [
      'Entering an incorrect injector code can cause engine knocking or rough idle.'
    ],
    warningsAr: [
      'إدخال كود بخاخ غير صحيح قد يسبب خشونة في دوران المحرك أو احتراق غير منتظم.'
    ],
    stepsEn: [
      'Read existing cylinder injector calibration codes.',
      'Enter new code printed on injector top.',
      'Send Write Data By Identifier (0x2E F1 95) with checksum.',
      'Verify ECU accepts new calibration.'
    ],
    stepsAr: [
      'قراءة أكواد البخاخات المسجلة حالياً لكل أسطوانة.',
      'إدخال الكود الجديد المطبوع على رأس البخاخ.',
      'إرسال أمر الكتابة (0x2E F1 95) مع كود التحقق.',
      'التحقق من قبول كمبيوتر المحرك للكود الجديد.'
    ]
  },
  {
    id: 'srv-trans-adapt',
    titleEn: 'Transmission Adaptive Shift Learning Reset',
    titleAr: 'إعادة ضبط تكييف وتعلم ناقل الحركة (Transmission Reset)',
    descriptionEn: 'Clears shift timing, clutch fill pressures, and driver adaptation tables from the TCM.',
    descriptionAr: 'مسح جداول تعلم توقيت التبديل وضغوط الكلتشات من كمبيوتر القير بعد التوضيب أو تغيير الزيت.',
    category: 'TRANSMISSION',
    ecuTarget: 'Transmission TCM (0x7E1)',
    routineIdHex: '0x0710',
    supportedVehicles: ['Toyota', 'Lexus', 'Nissan', 'Hyundai', 'Kia', 'Ford', 'BMW'],
    requiredConditions: {
      minVoltage: 12.3,
      ignitionState: 'ON',
      engineState: 'STOPPED',
      gearPosition: 'PARK',
      parkingBrake: 'ENGAGED'
    },
    warningsEn: [
      'Transmission will exhibit slight shift roughness during the first 20 km while relearning.'
    ],
    warningsAr: [
      'قد تلاحظ تبديلات خشنة قليلاً خلال أول 20 كم حتى يكتمل تعلم القير للضغوط المثالية.'
    ],
    stepsEn: [
      'Send Clear Adaptation Routine (0x31 01 07 10).',
      'Wait for TCM EEPROM write acknowledge.',
      'Perform road test drive cycle.'
    ],
    stepsAr: [
      'إرسال أمر مسح قيم التعلم (0x31 01 07 10).',
      'انتظار تأكيد كتابة الذاكرة من كمبيوتر القير.',
      'القيام بجولة تجريبية لإكمال دورة التعلم.'
    ]
  }
];
