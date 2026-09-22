export interface NrcInfo {
  codeHex: string;
  codeNum: number;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  suggestedSolutionEn: string;
  suggestedSolutionAr: string;
  isPendingResponse?: boolean;
}

export const NRC_CODES: Record<number, NrcInfo> = {
  0x10: {
    codeHex: '0x10',
    codeNum: 0x10,
    nameEn: 'General Reject',
    nameAr: 'رفض عام من وحدة التحكم',
    descriptionEn: 'The action was rejected by the ECU for an unspecified reason.',
    descriptionAr: 'رفضت وحدة التحكم (ECU) تنفيذ الطلب لسبب غير محدد.',
    suggestedSolutionEn: 'Verify vehicle ignition state (IGN ON) and re-try command after clearing active session.',
    suggestedSolutionAr: 'تأكد من وضع تشغيل السويتش (IGN ON) وأعد تشغيل الجلسة التشخيصية (0x10 0x01).'
  },
  0x11: {
    codeHex: '0x11',
    codeNum: 0x11,
    nameEn: 'Service Not Supported',
    nameAr: 'الخدمة غير مدعومة',
    descriptionEn: 'The requested service ID is not implemented on this ECU.',
    descriptionAr: 'خدمة التشخيص المطلوبة غير مدعومة أو غير متاحة في كمبيوتر هذه السيارة.',
    suggestedSolutionEn: 'Check if this service requires standard OBD-II (0x01-0x09) instead of UDS (0x22 / 0x31).',
    suggestedSolutionAr: 'تحقق مما إذا كانت الميزة تتطلب أوامر OBD-II القياسية بدلاً من UDS أو جرب وحدة تحكم أخرى.'
  },
  0x12: {
    codeHex: '0x12',
    codeNum: 0x12,
    nameEn: 'Sub-Function Not Supported',
    nameAr: 'الوظيفة الفرعية غير مدعومة',
    descriptionEn: 'The service is recognized, but the specific sub-function ID is not supported.',
    descriptionAr: 'تم التعرف على الخدمة الأساسية، لكن الوظيفة الفرعية المحددة غير مدعومة.',
    suggestedSolutionEn: 'Use supported sub-functions (e.g. 0x01 for default, 0x03 for extended session).',
    suggestedSolutionAr: 'استخدم الوظائف الفرعية المدعومة (مثل 0x01 للجلسة الافتراضية، أو 0x03 للجلسة الموسعة).'
  },
  0x13: {
    codeHex: '0x13',
    codeNum: 0x13,
    nameEn: 'Incorrect Message Length Or Invalid Format',
    nameAr: 'طول الرسالة غير صحيح أو التنسيق غير صالح',
    descriptionEn: 'The length of the request does not match the payload schema required by ISO 14229.',
    descriptionAr: 'طول أمر الطلب أو عدد البايتات المرسلة لا يطابق المواصفات المطلوبة.',
    suggestedSolutionEn: 'Verify parameter bytes, DID length, or byte padding in the message.',
    suggestedSolutionAr: 'تحقق من عدد البايتات المرسلة وعناوين المعرفات (DIDs).'
  },
  0x21: {
    codeHex: '0x21',
    codeNum: 0x21,
    nameEn: 'Busy - Repeat Request',
    nameAr: 'الوحدة مشغولة - كرر الطلب',
    descriptionEn: 'The ECU is executing another task and cannot process the command immediately.',
    descriptionAr: 'وحدة التحكم مشغولة حالياً في تنفيذ مهمة أخرى ولا تستطيع معالجة الأمر فوراً.',
    suggestedSolutionEn: 'Wait 500ms to 2000ms and re-transmit request.',
    suggestedSolutionAr: 'انتظر من 0.5 إلى 2 ثانية ثم أعد إرسال الطلب.'
  },
  0x22: {
    codeHex: '0x22',
    codeNum: 0x22,
    nameEn: 'Conditions Not Correct',
    nameAr: 'شروط التنفيذ غير متوفرة',
    descriptionEn: 'Vehicle conditions are not satisfied (e.g. engine running, speed > 0, gear not in PARK).',
    descriptionAr: 'شروط الأمان والسلامة غير مستوفاة في المركبة (مثل المحرك يعمل، السرعة > 0، أو القير ليس في P).',
    suggestedSolutionEn: 'Turn engine OFF, ignition ON, shift gear to PARK, and apply parking brake.',
    suggestedSolutionAr: 'أطفئ المحرك، شغل السويتش IGN ON، اضع القير في وضع التوقف P، وارفع فرامل اليد.'
  },
  0x24: {
    codeHex: '0x24',
    codeNum: 0x24,
    nameEn: 'Request Sequence Error',
    nameAr: 'خطأ في تسلسل خطوات الطلب',
    descriptionEn: 'Commands were executed out of order (e.g. key sent before seed requested).',
    descriptionAr: 'تم إرسال الأوامر بترتيب غير صحيح (مثل إرسال المفتاح قبل طلب البذرة Security Seed).',
    suggestedSolutionEn: 'Re-run full sequence starting from Diagnostic Session Control (0x10 0x03).',
    suggestedSolutionAr: 'أعد تنفيذ خطوات السلسلة بترتيبها الصحيح بدءاً من فتح الجلسة الموسعة (0x10 0x03).'
  },
  0x31: {
    codeHex: '0x31',
    codeNum: 0x31,
    nameEn: 'Request Out Of Range',
    nameAr: 'القيمة المطلوبة خارج النطاق المسموح',
    descriptionEn: 'The target DID, routine ID, or parameter value is outside supported range.',
    descriptionAr: 'معرف البيانات (DID) أو قيمة المعامل المدخل خارج النطاق المدعوم في ECU.',
    suggestedSolutionEn: 'Check OEM documentation for valid DID addresses or input parameters.',
    suggestedSolutionAr: 'تأكد من صحة عناوين البيانات أو قيم المعاملات من وثائق الصنع القياسية.'
  },
  0x33: {
    codeHex: '0x33',
    codeNum: 0x33,
    nameEn: 'Security Access Denied',
    nameAr: 'تم رفض الوصول الأمني (الوحدة مقفلة)',
    descriptionEn: 'The request requires security authorization before execution.',
    descriptionAr: 'العملية مطلوبة تتطلب فك التشفير والوصول الأمني Security Access أولاً.',
    suggestedSolutionEn: 'Execute Security Access (0x27 0x01 / 0x02) to unlock the ECU.',
    suggestedSolutionAr: 'قم بتنفيذ طلب فك التشفير والوصول الأمني (0x27 0x01/0x02) لفتح صلاحيات الكتابة.'
  },
  0x35: {
    codeHex: '0x35',
    codeNum: 0x35,
    nameEn: 'Invalid Key',
    nameAr: 'مفتاح الأمان غير صحيح',
    descriptionEn: 'The security key sent to the ECU does not match the computed algorithm result.',
    descriptionAr: 'مفتاح التشفير المرسل لوحدة التحكم لا يطابق خوارزمية التشفير الخاصة بالصانع.',
    suggestedSolutionEn: 'Verify Seed-Key calculation algorithm or security unlock level.',
    suggestedSolutionAr: 'تحقق من خوارزمية حساب المفتاح أو مستوى حماية الأمن.'
  },
  0x36: {
    codeHex: '0x36',
    codeNum: 0x36,
    nameEn: 'Exceed Number Of Attempts',
    nameAr: 'تجاوزت الحد الأقصى لمحاولات التشفير',
    descriptionEn: 'Too many incorrect key attempts were submitted.',
    descriptionAr: 'تم إدخال مفاتيح غير صحيحة عدة مرات متتالية مما أدى لقفل الوحدة مؤقتاً.',
    suggestedSolutionEn: 'Leave ignition ON for 10-15 minutes to allow ECU timeout lockout to expire.',
    suggestedSolutionAr: 'اترك السويتش في وضع التشغيل IGN ON لمدة 10-15 دقيقة حتى ينتهي القفل المؤقت.'
  },
  0x37: {
    codeHex: '0x37',
    codeNum: 0x37,
    nameEn: 'Required Time Delay Not Expired',
    nameAr: 'مهلة الانتظار الإلزامية لم تنتهِ بعد',
    descriptionEn: 'ECU is enforcing a mandatory wait period before accepting new security requests.',
    descriptionAr: 'كمبيوتر السيارة يفرض فترة انتظار إلزامية قبل استقبال محاولات أمان جديدة.',
    suggestedSolutionEn: 'Wait until time delay expires before re-sending Security Access request.',
    suggestedSolutionAr: 'انتظر انتهاء فترة التأخير الزمنية المحددة قبل إعادة محاولة فك التشفير.'
  },
  0x78: {
    codeHex: '0x78',
    codeNum: 0x78,
    nameEn: 'Response Pending',
    nameAr: 'الطلب قيد المعالجة - استجابة معلقة',
    descriptionEn: 'The ECU correctly received the request and is processing a long calculation.',
    descriptionAr: 'تم استقبال الطلب بنجاح، ووحدة التحكم تبدأ معالجة حسابية أو إجراءً طويلاً.',
    suggestedSolutionEn: 'Do not abort. Keep session active and wait 5-10 seconds for final response frame.',
    suggestedSolutionAr: 'لا تلغِ الطلب. ابقَ متصلاً وانتظر 5-10 ثوانٍ لاستلام الاستجابة النهائية.',
    isPendingResponse: true
  },
  0x7E: {
    codeHex: '0x7E',
    codeNum: 0x7E,
    nameEn: 'Sub-Function Not Supported In Active Session',
    nameAr: 'الوظيفة الفرعية غير مدعومة في الجلسة الحالية',
    descriptionEn: 'The requested sub-function cannot be executed in the current session mode.',
    descriptionAr: 'لا يمكن تنفيذ الوظيفة الفرعية في الجلسة التشخيصية الحالية.',
    suggestedSolutionEn: 'Switch to Extended Session (0x10 0x03) or Programming Session (0x10 0x02).',
    suggestedSolutionAr: 'انتقل إلى الجلسة الموسعة (0x10 0x03) أو جلسة البرمجة (0x10 0x02) أولاً.'
  },
  0x7F: {
    codeHex: '0x7F',
    codeNum: 0x7F,
    nameEn: 'Service Not Supported In Active Session',
    nameAr: 'الخدمة غير مدعومة في الجلسة الحالية',
    descriptionEn: 'The entire service cannot be executed in the current session mode.',
    descriptionAr: 'الخدمة بأكملها غير مسموح بتنفيذها في الجلسة التشخيصية النشطة.',
    suggestedSolutionEn: 'Switch to Extended Session (0x10 0x03) first.',
    suggestedSolutionAr: 'انتقل إلى الجلسة الموسعة (0x10 0x03) أولاً قبل تنفيذ الخدمة.'
  }
};

export function getNrcInfo(nrcByte: number): NrcInfo {
  return NRC_CODES[nrcByte] || {
    codeHex: `0x${nrcByte.toString(16).toUpperCase()}`,
    codeNum: nrcByte,
    nameEn: `Vendor Specific Error (0x${nrcByte.toString(16).toUpperCase()})`,
    nameAr: `رمز استجابة سلبية خاص بالمصنع (0x${nrcByte.toString(16).toUpperCase()})`,
    descriptionEn: `ECU returned vendor-specific negative response code 0x${nrcByte.toString(16).toUpperCase()}`,
    descriptionAr: `أعادت وحدة التحكم رمز خطأ سلبي خاص من الشركة المصنعة 0x${nrcByte.toString(16).toUpperCase()}`,
    suggestedSolutionEn: 'Check OEM technical documentation or scan with factory diagnostic tool.',
    suggestedSolutionAr: 'راجع دليل الصيانة أو جرب أجهزة الفحص المعتمدة من المصنع.'
  };
}
