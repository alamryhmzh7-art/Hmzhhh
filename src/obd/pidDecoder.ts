import { ObdPid } from '../types';

export const standardPids: ObdPid[] = [
  {
    id: '0C',
    pidHex: '0C',
    mode: 1,
    name: 'Engine RPM',
    nameAr: 'سرعة دوران المحرك (RPM)',
    shortName: 'RPM',
    unit: 'RPM',
    min: 0,
    max: 8000,
    currentValue: 0,
    formula: '((A * 256) + B) / 4',
    bytesCount: 2,
    category: 'engine',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 2) return 0;
      return Math.round(((bytes[0] * 256) + bytes[1]) / 4);
    }
  },
  {
    id: '0D',
    pidHex: '0D',
    mode: 1,
    name: 'Vehicle Speed',
    nameAr: 'سرعة المركبة',
    shortName: 'Speed',
    unit: 'km/h',
    min: 0,
    max: 260,
    currentValue: 0,
    formula: 'A',
    bytesCount: 1,
    category: 'speed',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 1) return 0;
      return bytes[0];
    }
  },
  {
    id: '05',
    pidHex: '05',
    mode: 1,
    name: 'Engine Coolant Temperature',
    nameAr: 'حرارة سائل التبريد (Coolant)',
    shortName: 'ECT',
    unit: '°C',
    min: -40,
    max: 150,
    currentValue: 0,
    formula: 'A - 40',
    bytesCount: 1,
    category: 'temperature',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 1) return 0;
      return bytes[0] - 40;
    }
  },
  {
    id: '11',
    pidHex: '11',
    mode: 1,
    name: 'Throttle Position',
    nameAr: 'موضع الخانق (Throttle)',
    shortName: 'TPS',
    unit: '%',
    min: 0,
    max: 100,
    currentValue: 0,
    formula: '(A * 100) / 255',
    bytesCount: 1,
    category: 'engine',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 1) return 0;
      return Math.round((bytes[0] * 100) / 255);
    }
  },
  {
    id: '04',
    pidHex: '04',
    mode: 1,
    name: 'Calculated Engine Load',
    nameAr: 'حمل المحرك المحسوب',
    shortName: 'Load',
    unit: '%',
    min: 0,
    max: 100,
    currentValue: 0,
    formula: '(A * 100) / 255',
    bytesCount: 1,
    category: 'engine',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 1) return 0;
      return Math.round((bytes[0] * 100) / 255);
    }
  },
  {
    id: '0A',
    pidHex: '0A',
    mode: 1,
    name: 'Fuel Pressure (Gauge)',
    nameAr: 'ضغط الوقود',
    shortName: 'Fuel Press',
    unit: 'kPa',
    min: 0,
    max: 765,
    currentValue: 0,
    formula: 'A * 3',
    bytesCount: 1,
    category: 'fuel',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 1) return 0;
      return bytes[0] * 3;
    }
  },
  {
    id: '0F',
    pidHex: '0F',
    mode: 1,
    name: 'Intake Air Temperature',
    nameAr: 'حرارة هواء السحب (IAT)',
    shortName: 'IAT',
    unit: '°C',
    min: -40,
    max: 120,
    currentValue: 0,
    formula: 'A - 40',
    bytesCount: 1,
    category: 'temperature',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 1) return 0;
      return bytes[0] - 40;
    }
  },
  {
    id: '10',
    pidHex: '10',
    mode: 1,
    name: 'Mass Air Flow Rate (MAF)',
    nameAr: 'تدفق الهواء الكتلي (MAF)',
    shortName: 'MAF',
    unit: 'g/s',
    min: 0,
    max: 300,
    currentValue: 0,
    formula: '((A * 256) + B) / 100',
    bytesCount: 2,
    category: 'air',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 2) return 0;
      return parseFloat((((bytes[0] * 256) + bytes[1]) / 100).toFixed(2));
    }
  },
  {
    id: '06',
    pidHex: '06',
    mode: 1,
    name: 'Short Term Fuel Trim (Bank 1)',
    nameAr: 'تصحيح الوقود اللحظي (STFT B1)',
    shortName: 'STFT1',
    unit: '%',
    min: -100,
    max: 99.2,
    currentValue: 0,
    formula: '(A - 128) * 100 / 128',
    bytesCount: 1,
    category: 'fuel',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 1) return 0;
      return parseFloat(((bytes[0] - 128) * (100 / 128)).toFixed(1));
    }
  },
  {
    id: '07',
    pidHex: '07',
    mode: 1,
    name: 'Long Term Fuel Trim (Bank 1)',
    nameAr: 'تصحيح الوقود طويل الأمد (LTFT B1)',
    shortName: 'LTFT1',
    unit: '%',
    min: -100,
    max: 99.2,
    currentValue: 0,
    formula: '(A - 128) * 100 / 128',
    bytesCount: 1,
    category: 'fuel',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 1) return 0;
      return parseFloat(((bytes[0] - 128) * (100 / 128)).toFixed(1));
    }
  },
  {
    id: '0E',
    pidHex: '0E',
    mode: 1,
    name: 'Ignition Timing Advance',
    nameAr: 'توقيت تقديم الإشعال (Timing)',
    shortName: 'Timing',
    unit: '°',
    min: -64,
    max: 63.5,
    currentValue: 0,
    formula: '(A - 128) / 2',
    bytesCount: 1,
    category: 'engine',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 1) return 0;
      return parseFloat(((bytes[0] - 128) / 2).toFixed(1));
    }
  },
  {
    id: '42',
    pidHex: '42',
    mode: 1,
    name: 'Control Module Voltage',
    nameAr: 'جهد وحدة التحكم (ECU Voltage)',
    shortName: 'Voltage',
    unit: 'V',
    min: 0,
    max: 25,
    currentValue: 0,
    formula: '((A * 256) + B) / 1000',
    bytesCount: 2,
    category: 'electrical',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 2) return 0;
      return parseFloat((((bytes[0] * 256) + bytes[1]) / 1000).toFixed(2));
    }
  },
  {
    id: '2F',
    pidHex: '2F',
    mode: 1,
    name: 'Fuel Tank Level Input',
    nameAr: 'مستوى خزان الوقود',
    shortName: 'Fuel Level',
    unit: '%',
    min: 0,
    max: 100,
    currentValue: 0,
    formula: '(A * 100) / 255',
    bytesCount: 1,
    category: 'fuel',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 1) return 0;
      return Math.round((bytes[0] * 100) / 255);
    }
  },
  {
    id: '1F',
    pidHex: '1F',
    mode: 1,
    name: 'Run Time Since Engine Start',
    nameAr: 'مدة تشغيل المحرك',
    shortName: 'Run Time',
    unit: 'sec',
    min: 0,
    max: 65535,
    currentValue: 0,
    formula: '(A * 256) + B',
    bytesCount: 2,
    category: 'engine',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 2) return 0;
      return (bytes[0] * 256) + bytes[1];
    }
  },
  {
    id: '33',
    pidHex: '33',
    mode: 1,
    name: 'Absolute Barometric Pressure',
    nameAr: 'الضغط الجوي المطلق',
    shortName: 'Baro',
    unit: 'kPa',
    min: 0,
    max: 255,
    currentValue: 0,
    formula: 'A',
    bytesCount: 1,
    category: 'air',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 1) return 0;
      return bytes[0];
    }
  },
  {
    id: '46',
    pidHex: '46',
    mode: 1,
    name: 'Ambient Air Temperature',
    nameAr: 'درجة حرارة الهواء المحيط',
    shortName: 'Ambient',
    unit: '°C',
    min: -40,
    max: 85,
    currentValue: 0,
    formula: 'A - 40',
    bytesCount: 1,
    category: 'temperature',
    history: [],
    decode: (bytes: number[]) => {
      if (bytes.length < 1) return 0;
      return bytes[0] - 40;
    }
  }
];

export class ObdPidDecoder {
  public static decodeRpm(bytes: number[]): number {
    if (bytes.length < 2) return 0;
    return Math.round(((bytes[0] * 256) + bytes[1]) / 4);
  }

  public static decodeSpeed(bytes: number[]): number {
    if (bytes.length < 1) return 0;
    return bytes[0];
  }

  public static decodeVoltage(bytes: number[]): number {
    if (bytes.length < 2) return 0;
    return parseFloat((((bytes[0] * 256) + bytes[1]) / 1000).toFixed(2));
  }

  public static decodeResponse(pidHex: string, rawBytes: number[]): number | null {
    const pid = standardPids.find(p => p.pidHex.toUpperCase() === pidHex.toUpperCase());
    if (!pid) return null;
    return pid.decode(rawBytes);
  }

  public static getPid(pidHex: string): ObdPid | undefined {
    return standardPids.find(p => p.pidHex.toUpperCase() === pidHex.toUpperCase());
  }
}
