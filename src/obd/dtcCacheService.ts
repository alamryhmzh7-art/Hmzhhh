import { DiagnosticTroubleCode, DtcStatus } from '../types';

export interface DtcCacheEntry {
  code: string;
  descriptionEn: string;
  descriptionAr: string;
  system: 'POWERTRAIN' | 'CHASSIS' | 'BODY' | 'NETWORK' | string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  symptomsEn: string[];
  symptomsAr: string[];
  causesEn: string[];
  causesAr: string[];
  fixesEn: string[];
  fixesAr: string[];
  cachedAt?: number;
  source?: 'DEFAULT' | 'SCANNED' | 'CUSTOM';
}

export const LOCAL_STORAGE_CACHE_KEY = 'HAMZA_OBD_DTC_CACHE_V2';

export const DEFAULT_DTC_CACHE: DtcCacheEntry[] = [
  {
    code: 'P0171',
    descriptionEn: 'System Too Lean (Bank 1) - Fuel Trim / Vacuum Leak',
    descriptionAr: 'خليط وقود فقير جداً (بنك 1) - تسريب هواء أو نقص وقود',
    system: 'POWERTRAIN',
    severity: 'MEDIUM',
    symptomsEn: [
      'Check Engine Light illuminated',
      'Engine hesitation during acceleration',
      'Rough idling / engine misfires',
      'Increased fuel consumption'
    ],
    symptomsAr: [
      'إضاءة لمبة فحص المحرك (Check Engine)',
      'تردد وتقطيع في المحرك عند خروج السيارة والتسارع',
      'عدم استقرار سرعة الدوران الخاملة (تفتفة)',
      'ارتفاع ملاحظ في استهلاك الوقود'
    ],
    causesEn: [
      'Vacuum leak in intake manifold or vacuum hoses',
      'Faulty Mass Air Flow (MAF) sensor or dirty wire',
      'Clogged or weak fuel injectors',
      'Low fuel rail pressure / weak fuel pump',
      'Faulty upstream Oxygen (O2) Sensor'
    ],
    causesAr: [
      'تسريب هواء من مجمع السحب (الثلاجة) أو خراطيم الفراغ',
      'اتساخ أو عطل حساس تدفق الهواء (MAF Sensor)',
      'انسداد أو ضعف في بخاخات الوقود',
      'انخفاض ضغط طلمبة (مضخة) البنزين',
      'عطل حساس الأكسجين (اللمبادا) الأمامي'
    ],
    fixesEn: [
      'Inspect intake boot and vacuum hoses for cracks using smoke test',
      'Clean MAF sensor with dedicated electronic contact cleaner spray',
      'Test fuel pump pressure with fuel pressure gauge (standard 35-50 PSI)',
      'Inspect short-term & long-term fuel trim PID values',
      'Replace front oxygen sensor if signal is frozen below 0.2V'
    ],
    fixesAr: [
      'فحص خراطيم الفراغ ورباط الثلاجة لمنع تسريب الهواء غير المحسوب',
      'تنظيف حساس MAF بخاخ الكترونيات خاص خالي من الزيوت',
      'قياس ضغط طلمبة البنزين عند مسطرة البخاخات',
      'مراقبة قيم تعديل الوقود (Fuel Trim) عبر البيانات الحية',
      'استبدال حساس الأكسجين الأمامي في حال توقف قراءته'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'P0300',
    descriptionEn: 'Random/Multiple Cylinder Misfire Detected',
    descriptionAr: 'اكتشاف فقد إشعال عشوائي أو في عدة أسطوانات (ميس فاير)',
    system: 'POWERTRAIN',
    severity: 'HIGH',
    symptomsEn: [
      'Engine vibration and severe shaking',
      'Flashing Check Engine Light (Catalyst damage warning)',
      'Loss of engine power and acceleration',
      'Raw gasoline smell from exhaust'
    ],
    symptomsAr: [
      'اهتزاز ورجة شديدة في المحرك أثناء السير أو التوقف',
      'وميض مستمر للمبة الماكينة (تحذير لخطر دبة التلوث)',
      'ضعف كبير في عزم وتسارع السيارة',
      'رائحة بنزين نيء غير محترق تنبعث من الشكمان'
    ],
    causesEn: [
      'Worn or contaminated spark plugs',
      'Failing ignition coil(s) or damaged spark plug wires',
      'Low fuel pressure or clogged fuel filter',
      'Engine mechanical issue (Low cylinder compression)',
      'Major intake vacuum leak'
    ],
    causesAr: [
      'تلف أو اتساخ البواجي (شمعات الاحتراق)',
      'عطل الكويلات (مبينات الإشعال) أو أسلاك التوصيل',
      'ضعف ضغط الوقود أو انسداد فلتر البنزين',
      'ضعف انضغاط المحرك الميكانيكي في الأسطوانات',
      'تسريب هواء كبير في الثلاجة'
    ],
    fixesEn: [
      'Inspect and replace spark plugs with correctly gapped OEM plugs',
      'Check individual cylinder misfire counters in live data',
      'Test ignition coil secondary resistance & pulse signal',
      'Perform cylinder dry & wet compression test',
      'Check fuel delivery system pressure'
    ],
    fixesAr: [
      'فحص وتغيير البواجي (شمعات الاحتراق) بقطع أصيلة مع ضبط الفجوة',
      'متابعة عداد الميس فاير للأسطوانات في شاشة البيانات الحية',
      'فحص شرارة ونبض الكويلات وتغيير التالف منها',
      'إجراء فحص ضغط الأسطوانات بمقياس الضغط',
      'قياس ضغط البنزين للتأكد من طلمبة الوقود'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'P0301',
    descriptionEn: 'Cylinder 1 Misfire Detected',
    descriptionAr: 'فقد إشعال في الأسطوانة رقم 1',
    system: 'POWERTRAIN',
    severity: 'HIGH',
    symptomsEn: [
      'Misfire specifically traced to cylinder 1',
      'Engine jerking under load',
      'Rough idle speed'
    ],
    symptomsAr: [
      'تقطيع وفقد إشعال محدد في الأسطوانة رقم 1',
      'نتعة وتقطيع عند تسارع المركبة تحت الحمل',
      'اهتزاز المحرك في الوضع الخامل'
    ],
    causesEn: [
      'Fouled spark plug in cylinder 1',
      'Defective ignition coil on cylinder 1',
      'Clogged or failing cylinder 1 fuel injector',
      'Wiring harness or signal issue to cylinder 1 injector/coil'
    ],
    causesAr: [
      'تلف أو اتساخ بوجي الأسطوانة رقم 1',
      'عطل كويل الأسطوانة رقم 1',
      'انسداد أو عطل بخاخ الأسطوانة رقم 1',
      'مشكلة في ضفيرة أو إشارة التغذية لبخاخ/كويل 1'
    ],
    fixesEn: [
      'Swap coil 1 with coil 2; rescan to see if DTC shifts to P0302',
      'Replace cylinder 1 spark plug',
      'Test cylinder 1 injector circuit with noid light',
      'Check cylinder 1 valve clearance and compression'
    ],
    fixesAr: [
      'تبديل كويل الأسطوانة 1 مع الأسطوانة 2 وإعادة الفحص للتأكد',
      'تغيير بوجي الأسطوانة رقم 1',
      'فحص إشارة فيشة بخاخ الأسطوانة 1 بمصباح النبض (Noid Light)',
      'فحص ضغط الأسطوانة رقم 1'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'P0302',
    descriptionEn: 'Cylinder 2 Misfire Detected',
    descriptionAr: 'فقد إشعال في الأسطوانة رقم 2',
    system: 'POWERTRAIN',
    severity: 'HIGH',
    symptomsEn: [
      'Misfire in cylinder 2',
      'Reduced engine responsiveness',
      'Rough engine idling'
    ],
    symptomsAr: [
      'تقطيع وفقد إشعال في الأسطوانة رقم 2',
      'انخفاض استجابة وعزم المحرك',
      'رجة واهتزاز في السرعة الخاملة'
    ],
    causesEn: [
      'Defective cylinder 2 ignition coil or plug',
      'Faulty cylinder 2 fuel injector',
      'Loss of compression in cylinder 2'
    ],
    causesAr: [
      'عطل كويل أو بوجي الأسطوانة 2',
      'انسداد بخاخ الأسطوانة 2',
      'ضعف انضغاط المحرك في الأسطوانة 2'
    ],
    fixesEn: [
      'Swap cylinder 2 ignition components to verify defect',
      'Replace spark plugs / coils for cylinder 2'
    ],
    fixesAr: [
      'تبديل كويل وبوجي الأسطوانة 2 لتحديد العطل',
      'استبدال البواجي والكويلات التالفة'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'P0172',
    descriptionEn: 'System Too Rich (Bank 1)',
    descriptionAr: 'خليط وقود غني جداً (بنك 1) - زيادة بنزين أو نقص هواء',
    system: 'POWERTRAIN',
    severity: 'MEDIUM',
    symptomsEn: [
      'Black exhaust smoke',
      'Strong odor of unburnt fuel',
      'Engine stumbling or stalling',
      'High fuel consumption'
    ],
    symptomsAr: [
      'خروج دخان أسود من الشكمان',
      'رائحة بنزين قوية جداً حول السيارة',
      'انطفاء المحرك عند التوقف أو التباطؤ',
      'استهلاك مرتفع ومفرط للوقود'
    ],
    causesEn: [
      'Leaking or stuck-open fuel injector(s)',
      'Excessive fuel pressure (faulty pressure regulator)',
      'Contaminated / faulty MAF sensor',
      'Dirty air filter element restricting air intake',
      'Saturated EVAP canister purge valve stuck open'
    ],
    causesAr: [
      'تسريب أو علق بخاخات الوقود على الوضع المفتوح',
      'ارتفاع ضغط الوقود فوق المسموح (عطل منظم الضغط)',
      'اتساخ أو عطل حساس تدفق الهواء MAF',
      'انسداد شديد في فلتر هواء المحرك',
      'عقور صمام مبخر البنزين (EVAP Purge Valve) مفتوحاً'
    ],
    fixesEn: [
      'Replace clean air filter',
      'Clean MAF sensor wire carefully',
      'Inspect EVAP canister purge valve for vacuum leakage',
      'Test fuel pressure regulator for diaphragm leak'
    ],
    fixesAr: [
      'تنظيف أو تغيير فلتر الهواء',
      'تنظيف حساس MAF بخاخ خاص',
      'فحص صمام مبخر البنزين EVAP للتأكد من عدم شفطه للبنزين باستمرار',
      'فحص منظم ضغط الوقود'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'P0420',
    descriptionEn: 'Catalytic Converter System Efficiency Below Threshold (Bank 1)',
    descriptionAr: 'كفاءة دبة التلوث / المحفز أقل من الحد المسموح (بنك 1)',
    system: 'POWERTRAIN',
    severity: 'MEDIUM',
    symptomsEn: [
      'Check Engine Light constantly illuminated',
      'Slight reduction in high-speed engine performance',
      'Failed vehicle emissions inspection'
    ],
    symptomsAr: [
      'إضاءة لمبة فحص المحرك بشكل دائم',
      'انخفاض خفيف في عزم المحرك على السرعات العالية',
      'عدم اجتياز فحص الانبعاثات الدوري للسيارة'
    ],
    causesEn: [
      'Degraded or melted internal ceramic mesh in catalytic converter',
      'Faulty downstream (rear) Oxygen Sensor (O2 Sensor 2)',
      'Exhaust leak before or near catalytic converter',
      'Unresolved engine misfire damaging converter'
    ],
    causesAr: [
      'تدهور أو انسداد المادة الفخارية الداعمة بدبة التلوث',
      'عطل حساس الأكسجين الخلفي (Bank 1 Sensor 2)',
      'تسريب غازات العادم قبل أو بجوار دبة التلوث',
      'استمرار الميس فاير مما تسبب في حرق دبة التلوث'
    ],
    fixesEn: [
      'Inspect exhaust system for leaks before rear O2 sensor',
      'Graph rear O2 sensor voltage; should be stable around 0.6V-0.8V',
      'Repair any active misfire DTCs before replacing catalyst',
      'Replace catalytic converter assembly if internal structure is damaged'
    ],
    fixesAr: [
      'فحص تسريبات الشكمان قبل حساس الأكسجين الخلفي',
      'مراقبة إشارة حساس الأكسجين الخلفي عبر الرسم البياني (يجب أن تكون مستقرة عند 0.7V)',
      'إصلاح أي أعطال ميس فاير بالمحرك أولاً',
      'استبدال دبة التلوث في حال تلف الفلتر الداخلي'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'P0430',
    descriptionEn: 'Catalyst System Efficiency Below Threshold (Bank 2)',
    descriptionAr: 'كفاءة دبة التلوث / المحفز أقل من الحد المسموح (بنك 2)',
    system: 'POWERTRAIN',
    severity: 'MEDIUM',
    symptomsEn: [
      'Check Engine Light on',
      'Failed tailpipe emissions test'
    ],
    symptomsAr: [
      'إضاءة لمبة المحرك',
      'عدم اجتياز الفحص الدوري للعادم'
    ],
    causesEn: [
      'Failed Bank 2 catalytic converter',
      'Faulty downstream O2 sensor Bank 2',
      'Exhaust leak Bank 2'
    ],
    causesAr: [
      'تلف دبة التلوث بنك 2',
      'عطل حساس الأكسجين الخلفي بنك 2',
      'تسريب غازات العادم في اتجاه بنك 2'
    ],
    fixesEn: [
      'Check rear O2 sensor waveform Bank 2',
      'Replace Bank 2 catalytic converter if needed'
    ],
    fixesAr: [
      'فحص إشارة حساس الأكسجين الخلفي لبنك 2',
      'استبدال دبة التلوث بنك 2 عند الحاجة'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'P0113',
    descriptionEn: 'Intake Air Temperature Sensor 1 Circuit High Input',
    descriptionAr: 'إشارة مرتفعة في دائرة حساس حرارة هواء السحب (IAT)',
    system: 'POWERTRAIN',
    severity: 'LOW',
    symptomsEn: [
      'Hard starting during cold weather',
      'Slight engine hesitation',
      'Improper air-fuel mixture'
    ],
    symptomsAr: [
      'صعوبة تشغيل المحرك في الجو البارد',
      'تردد خفيف عند الدعس على البنزين',
      'عدم توازن نسبة البنزين والهواء'
    ],
    causesEn: [
      'Disconnnected IAT sensor electrical connector',
      'Open circuit in IAT signal line or ground wire',
      'Defective IAT sensor element'
    ],
    causesAr: [
      'فيشة حساس حرارة الهواء مفصولة أو غير محكمة',
      'قطع في سلك الإشارة أو سلك الأرضي الخاص بالحساس',
      'عطل وحرق في حساس IAT الداخلي'
    ],
    fixesEn: [
      'Verify IAT sensor harness connector is securely latched',
      'Measure IAT sensor resistance across terminals',
      'Check live IAT temperature reading (should match ambient)'
    ],
    fixesAr: [
      'التأكد من إحكام فيشة حساس حرارة الهواء',
      'قياس مقاومة الحساس بالملتيميتر مقارنة بالجدول الفني',
      'قراءة درجة حرارة الهواء الحية والتأكد من منطقيتها'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'P0102',
    descriptionEn: 'Mass Air Flow (MAF) Circuit Low Input',
    descriptionAr: 'إشارة منخفضة في دائرة حساس تدفق الهواء (MAF)',
    system: 'POWERTRAIN',
    severity: 'MEDIUM',
    symptomsEn: [
      'Engine stalls shortly after starting',
      'Lack of engine power during acceleration',
      'Black smoke or rich mix condition'
    ],
    symptomsAr: [
      'انطفاء المحرك فور التشغيل',
      'ضعف وقصور شديد في قوة المحرك',
      'تفتفة ودخان أسود'
    ],
    causesEn: [
      'Contaminated or broken hot wire inside MAF sensor',
      'Unplugged MAF sensor harness connector',
      'Damaged wiring or blown sensor fuse'
    ],
    causesAr: [
      'تلوث أو انقطاع السلك الحراري الداخلي لحساس MAF',
      'عدم توصيل فيشة الحساس بشكل جيد',
      'تلف في الضفيرة أو احتراق فيوز الحساس'
    ],
    fixesEn: [
      'Clean MAF hot wire carefully with aerosol MAF cleaner',
      'Verify 12V supply and ground at MAF harness connector',
      'Replace MAF sensor if voltage signal remains static near 0V'
    ],
    fixesAr: [
      'تنظيف السلك الحراري لحساس MAF بخاخ الكترونيات',
      'فحص تغذية 12 فولت والأرضي في الفيشة',
      'استبدال حساس MAF إذا كانت القراءة صفر فولت دائماً'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'P0128',
    descriptionEn: 'Coolant Thermostat (Coolant Temp Below Regulating Temp)',
    descriptionAr: 'خلل في بلف الحرارة (ثرموستات سائل التبريد معلق مفتوح)',
    system: 'POWERTRAIN',
    severity: 'LOW',
    symptomsEn: [
      'Engine takes abnormally long to reach operating temperature',
      'Temperature gauge remains low on highway driving',
      'Inadequate cabin heater warmth'
    ],
    symptomsAr: [
      'المحرك يستغرق وقتاً طويلاً جداً للوصول لدرجة الحرارة الطبيعية',
      'انخفاض مؤشر الحرارة أثناء القيادة على الطرق السريعة',
      'ضعف التدفئة في التكييف داخل المقصورة'
    ],
    causesEn: [
      'Thermostat stuck in the open position',
      'Low engine coolant level',
      'Faulty Engine Coolant Temperature (ECT) sensor'
    ],
    causesAr: [
      'بلف الحرارة (الثرموستات) معلق في الوضع المفتوح باستمرار',
      'انخفاض مستوى ماء الراديتر (سائل التبريد)',
      'عطل حساس درجة حرارة المحرك ECT'
    ],
    fixesEn: [
      'Replace engine coolant thermostat',
      'Refill and bleed air from cooling system',
      'Verify ECT sensor resistance curve'
    ],
    fixesAr: [
      'استبدال بلف الحرارة (الثرموستات) بقطعة جديدة أصيلة',
      'تعبئة سائل التبريد وتفريغ الهواء من الراديتر',
      'فحص قراءة حساس الحرارة ECT'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'P0500',
    descriptionEn: 'Vehicle Speed Sensor "A" Malfunction',
    descriptionAr: 'عطل في حساس سرعة المركبة (VSS)',
    system: 'POWERTRAIN',
    severity: 'HIGH',
    symptomsEn: [
      'Speedometer on dashboard drops to zero or bounces erratic',
      'Harsh or erratic automatic transmission gear shifting',
      'ABS / Traction Control warning lights turn on'
    ],
    symptomsAr: [
      'عداد السرعة في الطبلون لا يعمل أو يتذبذب عشوائياً',
      'نتعة وتأخير غير منتظم في غيارات القير الأوتوماتيك',
      'إضاءة لمبات الفرامل ABS ونظام الثبات'
    ],
    causesEn: [
      'Faulty Vehicle Speed Sensor (VSS)',
      'Damaged gear drive on sensor or transmission housing',
      'Chafed wiring harness / bad pin connection'
    ],
    causesAr: [
      'عطل حساس سرعة المركبة (VSS)',
      'تلف ترس الحساس الميكانيكي في ناقل الحركة',
      'قطع أو ارخاء في أسلاك الضفيرة وتوصيلات الحساس'
    ],
    fixesEn: [
      'Inspect VSS sensor pulse output with multimeter / scope',
      'Replace Vehicle Speed Sensor',
      'Check harness connector pins for corrosion'
    ],
    fixesAr: [
      'فحص نبضات الحساس عبر الملتيميتر أثناء تدوير العجلة',
      'استبدال حساس السرعة VSS',
      'فحص فيشة الحساس وتنظيف التمليح والتآكل'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'P0135',
    descriptionEn: 'O2 Sensor Heater Circuit Malfunction (Bank 1 Sensor 1)',
    descriptionAr: 'عطل في دائرة سخان حساس الأكسجين (بنك 1 حساس 1)',
    system: 'POWERTRAIN',
    severity: 'LOW',
    symptomsEn: [
      'Check Engine Light on during initial startup',
      'Increased emissions during warm-up phase',
      'Slight drop in cold fuel economy'
    ],
    symptomsAr: [
      'إضاءة لمبة فحص المحرك فور التشغيل الصباحي',
      'ارتفاع الانبعاثات والغازات في مرحلة تسخين المحرك',
      'انخفاض كفاءة استهلاك البنزين قبل وصول الحرارة للمعدل الطبيعي'
    ],
    causesEn: [
      'Blown oxygen sensor heater circuit fuse',
      'Burned out heating element inside O2 sensor',
      'High resistance in heater power wiring'
    ],
    causesAr: [
      'احتراق فيوز دائرة سخان حساس الأكسجين',
      'انقطاع سلك السخان الحراري الداخلي بالحساس',
      'ارتفاع المقاومة أو قطع في سلك التغذية بالسخان'
    ],
    fixesEn: [
      'Check oxygen sensor heater fuse in engine fuse box',
      'Measure resistance across O2 sensor heater pins (typical 4-15 ohms)',
      'Replace Bank 1 Sensor 1 oxygen sensor if heater element is open'
    ],
    fixesAr: [
      'فحص فيوز سخان الأكسجين في علبة الفيوزات الرئيسية',
      'قياس المقاومة الكهربائية لطرفي السخان بالفيشة (المعدل 4-15 أوم)',
      'استبدال حساس الأكسجين الأمامي في حال انقطاع السخان الداخلي'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'P0442',
    descriptionEn: 'Evaporative Emission System Leak Detected (Small Leak)',
    descriptionAr: 'تسريب صغير في نظام تبخير الوقود (EVAP)',
    system: 'POWERTRAIN',
    severity: 'LOW',
    symptomsEn: [
      'Check Engine Light illuminated',
      'Faint gasoline odor around fuel tank area'
    ],
    symptomsAr: [
      'إضاءة لمبة المحرك',
      'رائحة بنزين خفيفة حول خزان الوقود'
    ],
    causesEn: [
      'Loose, damaged, or improper gas cap seal',
      'Small crack in EVAP vacuum hose line',
      'Faulty EVAP canister vent valve or purge valve'
    ],
    causesAr: [
      'غطاء خزان البنزين غير محكم الإغلاق أو جلبيته تالفة',
      'تشقق خفيف في خراطيم تبخير الوقود EVAP',
      'عطل صمام تنفيس علبة الفحم (Canister Vent Valve)'
    ],
    fixesEn: [
      'Tighten or replace fuel filler gas cap with OEM seal',
      'Perform EVAP smoke machine leak diagnostic test',
      'Inspect purge valve for sealing integrity'
    ],
    fixesAr: [
      'إحكام إغلاق غطاء البنزين أو استبداله بغطاء جديد',
      'إجراء فحص آلة الدخان لتحديد موقع الفتحة الصغرى',
      'فحص صباب تبخير البنزين للتأكد من عدم التسريب'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'U0100',
    descriptionEn: 'Lost Communication with ECM/PCM "A"',
    descriptionAr: 'فقدان الاتصال مع كمبيوتر المحرك الرئيسي (ECM)',
    system: 'NETWORK',
    severity: 'CRITICAL',
    symptomsEn: [
      'Vehicle does not start or crank',
      'Multiple dashboard warning lights illuminated (ABS, Airbag, Power Steering)',
      'Diagnostic tool cannot communicate with Engine ECU'
    ],
    symptomsAr: [
      'المحرك لا يدور ولا يستجيب عند محاولة التشغيل',
      'إضاءة مجموعة كبيرة من لمبات التحذير بالطبلون',
      'جهاز الفحص لا يستطيع تأسيس اتصال مع كمبيوتر المحرك'
    ],
    causesEn: [
      'ECM main power relay failure',
      'Loose or corroded ECM chassis ground connection',
      'Blown main engine fuse (ECM / IGN fuse)',
      'CAN Bus High or Low signal shorted to ground / power'
    ],
    causesAr: [
      'عطل ريليه/كتاوت التغذية الرئيسية لكمبيوتر المحرك',
      'ارتخاء أو تآكل كابل الأرضي الخاص بـ ECM',
      'احتراق فيوز ECM الرئيسي في علبة الفيوزات',
      'شورت أو قطع في خطوط شبكة CAN Bus (High / Low)'
    ],
    fixesEn: [
      'Check ECM main relay and fuses in engine bay box',
      'Verify 12V supply and clean battery ground points for ECM',
      'Measure resistance across CAN High (Pin 6) and CAN Low (Pin 14) (Must be ~60 ohms)',
      'Inspect main engine harness for pinching or damage'
    ],
    fixesAr: [
      'فحص ريليه وفيوزات كمبيوتر المحرك في صندوق الفيوزات',
      'قياس وصول تغذية 12 فولت ونظافة كوابل الأرضي',
      'قياس مقاومة شبكة CAN بين الطرف 6 والطرف 14 في مقبس OBD-II (يجب أن تقتارب 60 أوم)',
      'فحص سلامة الضفيرة الرئيسية لكمبيوتر السيارة'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'U0121',
    descriptionEn: 'Lost Communication with ABS Control Module',
    descriptionAr: 'فقدان الاتصال مع وحدة التحكم بالفرامل المانعة للانغلاق (ABS)',
    system: 'NETWORK',
    severity: 'HIGH',
    symptomsEn: [
      'ABS, Brake, and Traction warning indicators lit on cluster',
      'Speedometer stopped functioning',
      'Steering feeling heavy or loss of power steering assist'
    ],
    symptomsAr: [
      'إضاءة لمبات تحذير الفرامل ABS و Handbrake ونظام التوازن',
      'توقف عداد السرعة في الطبلون عن العمل',
      'ثقل وتأثر في عجلة القيادة (الدركسون)'
    ],
    causesEn: [
      'Blown ABS module main fuse',
      'Corroded ABS module harness connector pin',
      'Internal hardware failure of ABS electronic module'
    ],
    causesAr: [
      'احتراق فيوز تغذية كمبيوتر الفرامل ABS الرئيسي',
      'تمليح أو تآكل في دبابيس فيشة كمبيوتر ABS',
      'عطل إلكتروني داخلي في وحدة كمبيوتر الفرامل'
    ],
    fixesEn: [
      'Check ABS fuse (typically 30A-50A high current fuse)',
      'Disconnect and clean ABS module multipin connector',
      'Verify CAN communications between Gateway and ABS'
    ],
    fixesAr: [
      'فحص فيوز كمبيوتر ABS الرئيسي (عادة 30-50 أمبير)',
      'فصل وتنظيف فيشة كمبيوتر الفرامل بمُنظف اتصالات',
      'فحص إشارات شبكة CAN الموجهة لوحدة الفرامل'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'C1201',
    descriptionEn: 'Engine Control System Malfunction / VSC Disabled',
    descriptionAr: 'خلل في نظام التحكم بالمحرك تسبب في تعطيل نظام الثبات VSC (تويوتا / لكزس)',
    system: 'CHASSIS',
    severity: 'HIGH',
    symptomsEn: [
      'VSC OFF, TRAC OFF, and Check Engine Light illuminated together (Toyota/Lexus)',
      'Vehicle Stability Control disabled as safety precaution'
    ],
    symptomsAr: [
      'إضاءة لمبات VSC OFF و TRAC OFF و Check Engine معاً (سيارات تويوتا ولكزس)',
      'تعطيل نظام الثبات والفرامل تلقائياً لحماية المركبة'
    ],
    causesEn: [
      'Triggered automatically by ECM when engine DTC (misfire, O2, fuel) occurs',
      'No actual fault in ABS/VSC hardware; secondary interlock code'
    ],
    causesAr: [
      'تفعيل تلقائي من كمبيوتر المحرك ECM عند تسجيل كود عطل بمحرك السيارة',
      'لا يوجد عطل حقيقي بفرامل ABS؛ الكود تحذيري تبعي فقط'
    ],
    fixesEn: [
      'Diagnose and fix the primary engine code (P-code) first',
      'Clear engine DTCs; C1201 will clear automatically'
    ],
    fixesAr: [
      'تشخيص وإصلاح كود عطل المحرك الرئيسي (أكواد P) أولاً',
      'مسح الأعطال من كمبيوتر المحرك وسيختفي كود C1201 تلقائياً'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'C1241',
    descriptionEn: 'Low or High Power Supply Voltage (ABS/VSC)',
    descriptionAr: 'جهد التغذية الكهربائية غير طبيعي لوحدة الفرامل والثبات',
    system: 'CHASSIS',
    severity: 'MEDIUM',
    symptomsEn: [
      'ABS and VSC warning lights turn on under heavy electrical load or cold start',
      'Erratic brake warning chime'
    ],
    symptomsAr: [
      'إضاءة لمبة ABS والثبات عند تشغيل المكيف أو الأنوار العالية',
      'صوت تحذير الفرامل في الطبلون'
    ],
    causesEn: [
      'Weak or failing 12V starter battery',
      'Faulty alternator / voltage regulator (undercharging < 13.0V or overcharging > 15.0V)',
      'Corroded battery terminal connectors or loose chassis ground'
    ],
    causesAr: [
      'ضعف أو انتهاء العمر الافتراضي لبطارية السيارة 12V',
      'عطل منظم شحن الدينامو (شحن ضعيف أقل من 13V أو شحن زائد فوق 15V)',
      'تآكل أصابع البطارية أو ارخاء أسلاك الأرضي'
    ],
    fixesEn: [
      'Perform battery CCA load test and rest voltage test',
      'Test alternator output voltage under load (13.5V to 14.5V ideal)',
      'Clean battery terminals and tighten ground cables'
    ],
    fixesAr: [
      'فحص جودة وسعة البطارية بمقياس الحمل',
      'قياس شحن الدينامو تحت الأحمال (المعدل المثالي 13.5V إلى 14.5V)',
      'تنظيف أصابع البطارية وإحكام ربط كوابل الأرضي'
    ],
    source: 'DEFAULT'
  },
  {
    code: 'B1000',
    descriptionEn: 'ECU Internal Electronic Malfunction',
    descriptionAr: 'عطل إلكتروني داخلي في وحدة التحكم (Body / Airbag ECU)',
    system: 'BODY',
    severity: 'CRITICAL',
    symptomsEn: [
      'Airbag warning light stays permanently lit',
      'Body functions (locks, windows, wipers) unresponsive',
      'Internal module memory checksum failure'
    ],
    symptomsAr: [
      'إضاءة لمبة الوسائد الهوائية (الأيرباج) بشكل دائم',
      'توقف استجابة بعض وظائف الهيكل (الأقفال، النوافذ، المساحات)',
      'عطل في ذاكرة قراءة الـ ECU'
    ],
    causesEn: [
      'Internal EEPROM / micro-controller memory corruption',
      'Damage caused by voltage surge or jump-starting vehicle incorrectly'
    ],
    causesAr: [
      'تلف أو خطأ في ذاكرة المعالج الداخلي EEPROM',
      'تلف الدائرة نتيجة شرارة كهربائية أو اشتراك خاطئ للبطارية'
    ],
    fixesEn: [
      'Perform hard system power reset (disconnect battery negative 15 mins)',
      'Reprogram or reflash module firmware',
      'Replace affected ECU if internal memory is unrecoverable'
    ],
    fixesAr: [
      'عمل إعادة ضبط بالكامل (فصل الكابل السلبي للبطارية 15 دقيقة)',
      'إعادة برمجة السوفتوير الخاص بالكمبيوتر',
      'استبدال كمبيوتر التحكم في حال تلف المعالج'
    ],
    source: 'DEFAULT'
  }
];

export class DtcCacheService {
  /**
   * Load all cached DTC entries from local storage.
   * If local storage is empty or uninitialized, populates with DEFAULT_DTC_CACHE.
   */
  public static getCachedDtcList(): DtcCacheEntry[] {
    try {
      const storedData = localStorage.getItem(LOCAL_STORAGE_CACHE_KEY);
      if (!storedData) {
        this.saveCacheToLocalStorage(DEFAULT_DTC_CACHE);
        return DEFAULT_DTC_CACHE;
      }
      const parsed: DtcCacheEntry[] = JSON.parse(storedData);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        this.saveCacheToLocalStorage(DEFAULT_DTC_CACHE);
        return DEFAULT_DTC_CACHE;
      }
      return parsed;
    } catch (e) {
      console.warn('Failed to read DTC cache from Local Storage:', e);
      return DEFAULT_DTC_CACHE;
    }
  }

  /**
   * Save array of DtcCacheEntry to local storage
   */
  private static saveCacheToLocalStorage(list: DtcCacheEntry[]): void {
    try {
      localStorage.setItem(LOCAL_STORAGE_CACHE_KEY, JSON.stringify(list));
    } catch (e) {
      console.error('Failed to save DTC cache to local storage:', e);
    }
  }

  /**
   * Lookup a specific DTC definition in local storage cache
   */
  public static lookupCode(code: string): DtcCacheEntry | undefined {
    const list = this.getCachedDtcList();
    const normalized = code.trim().toUpperCase();
    return list.find(item => item.code.toUpperCase() === normalized);
  }

  /**
   * Add or update DTC entries from active diagnostic scan results into local storage
   */
  public static cacheScannedDtcs(scannedDtcs: DiagnosticTroubleCode[]): void {
    if (!scannedDtcs || scannedDtcs.length === 0) return;

    const currentCache = this.getCachedDtcList();
    let updated = false;

    scannedDtcs.forEach(scanned => {
      const existingIdx = currentCache.findIndex(c => c.code.toUpperCase() === scanned.code.toUpperCase());
      const newEntry: DtcCacheEntry = {
        code: scanned.code,
        descriptionEn: scanned.descriptionEn,
        descriptionAr: scanned.descriptionAr,
        system: scanned.system || 'POWERTRAIN',
        severity: scanned.severity || 'MEDIUM',
        symptomsEn: scanned.symptomsEn || ['DTC recorded in vehicle ECU memory.'],
        symptomsAr: scanned.symptomsAr || ['عطل محدد مسجل في ذاكرة كمبيوتر السيارة.'],
        causesEn: scanned.causesEn || scanned.possibleCauses || ['Requires diagnostic inspection.'],
        causesAr: scanned.causesAr || ['يتطلب فحص ميكانيكي أو كهربائي دقيق.'],
        fixesEn: scanned.fixesEn || ['Check sensor signals & wiring.'],
        fixesAr: scanned.fixesAr || ['فحص قراءات الحساس والضفيرة.'],
        cachedAt: Date.now(),
        source: 'SCANNED'
      };

      if (existingIdx >= 0) {
        // Update existing cache entry with scanned info
        currentCache[existingIdx] = {
          ...currentCache[existingIdx],
          ...newEntry,
          // Keep rich symptoms/fixes if existing had them
          symptomsEn: (currentCache[existingIdx].symptomsEn?.length ?? 0) > 0 ? currentCache[existingIdx].symptomsEn : newEntry.symptomsEn,
          symptomsAr: (currentCache[existingIdx].symptomsAr?.length ?? 0) > 0 ? currentCache[existingIdx].symptomsAr : newEntry.symptomsAr,
          causesEn: (currentCache[existingIdx].causesEn?.length ?? 0) > 0 ? currentCache[existingIdx].causesEn : newEntry.causesEn,
          causesAr: (currentCache[existingIdx].causesAr?.length ?? 0) > 0 ? currentCache[existingIdx].causesAr : newEntry.causesAr,
          fixesEn: (currentCache[existingIdx].fixesEn?.length ?? 0) > 0 ? currentCache[existingIdx].fixesEn : newEntry.fixesEn,
          fixesAr: (currentCache[existingIdx].fixesAr?.length ?? 0) > 0 ? currentCache[existingIdx].fixesAr : newEntry.fixesAr,
          cachedAt: Date.now()
        };
      } else {
        currentCache.push(newEntry);
      }
      updated = true;
    });

    if (updated) {
      this.saveCacheToLocalStorage(currentCache);
    }
  }

  /**
   * Add a custom or new DTC definition manually to local storage
   */
  public static addCustomDtc(entry: DtcCacheEntry): DtcCacheEntry[] {
    const currentCache = this.getCachedDtcList();
    const existingIdx = currentCache.findIndex(c => c.code.toUpperCase() === entry.code.toUpperCase());
    
    const formatted: DtcCacheEntry = {
      ...entry,
      code: entry.code.trim().toUpperCase(),
      cachedAt: Date.now(),
      source: 'CUSTOM'
    };

    if (existingIdx >= 0) {
      currentCache[existingIdx] = formatted;
    } else {
      currentCache.unshift(formatted);
    }

    this.saveCacheToLocalStorage(currentCache);
    return currentCache;
  }

  /**
   * Reset DTC cache in local storage back to default dictionary
   */
  public static resetToDefaultCache(): DtcCacheEntry[] {
    this.saveCacheToLocalStorage(DEFAULT_DTC_CACHE);
    return DEFAULT_DTC_CACHE;
  }

  /**
   * Export cache as downloadable JSON file
   */
  public static exportCacheJson(): string {
    const data = this.getCachedDtcList();
    return JSON.stringify(data, null, 2);
  }

  /**
   * Import cache from JSON string
   */
  public static importCacheJson(jsonStr: string): DtcCacheEntry[] {
    try {
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) throw new Error('Invalid JSON format: Must be an array of DTC entries');
      this.saveCacheToLocalStorage(parsed);
      return parsed;
    } catch (err: any) {
      throw new Error(`Failed to import DTC cache: ${err.message}`);
    }
  }
}
