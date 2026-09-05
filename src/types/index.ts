/**
 * HAMZA OBD PRO - Core Type Definitions
 * Professional Automotive Diagnostic System
 */

export type ConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

export type TransportType = 'WIFI_TCP' | 'BLUETOOTH_SPP';

export interface BluetoothDeviceInfo {
  name: string;
  address: string;
  bonded: boolean;
  rssi?: number;
  type?: 'CLASSIC_SPP' | 'BLE';
}

export interface CanBusStatus {
  state: 'READY' | 'STOPPED' | 'BUS_OFF' | 'ERROR' | 'RECOVERING';
  speed: number;
  mode: '11-BIT' | '29-BIT' | 'DUAL';
  txErrorCount: number;
  rxErrorCount: number;
  busOverrunCount: number;
  queueSize: number;
  messagesSent: number;
  messagesReceived: number;
}

export type ProtocolType = 
  | 'ISO 15765-4 (CAN 11/500)' 
  | 'ISO 15765-4 (CAN 29/500)' 
  | 'ISO 15765-4 (CAN 11/250)' 
  | 'ISO 15765-4 (CAN 29/250)'
  | 'ISO 14230-4 (KWP2000)'
  | 'ISO 9141-2'
  | 'SAE J1850 PWM'
  | 'SAE J1850 VPW'
  | 'AUTO';

export type CanSpeed = '125K' | '250K' | '500K' | '1M';
export type CanIdType = '11-bit' | '29-bit';

export interface ConnectionConfig {
  transportType: TransportType;
  // Wi-Fi Configuration
  ip: string;
  port: number;
  // Bluetooth Classic Configuration
  bluetoothDeviceName: string;
  bluetoothMacAddress: string;
  bluetoothSppUuid: string;
  // Timeouts and bus parameters
  connectionTimeoutMs: number;
  responseTimeoutMs: number;
  canSpeed: CanSpeed;
  canMode: CanIdType;
  protocol: ProtocolType;
  autoReconnect: boolean;
  isMockMode: boolean;
}

export type Language = 'ar' | 'en';
export type AppTheme = 'dark' | 'light' | 'automotive-night';
export type UnitsSystem = 'metric' | 'imperial';

export type ViewTab = 
  | 'dashboard'
  | 'liveData'
  | 'dtc'
  | 'vin'
  | 'ecuScan'
  | 'canMonitor'
  | 'uds'
  | 'serviceFunctions'
  | 'toyota'
  | 'reports'
  | 'commLog'
  | 'errorLog'
  | 'devMode'
  | 'ota'
  | 'androidCode'
  | 'unitTests'
  | 'settings';

export interface AppSettings extends ConnectionConfig {
  language: Language;
  theme: AppTheme;
  units: UnitsSystem;
  enableLogging: boolean;
  logLevel: LogSeverity;
  logRetentionDays: number;
  maxLogSizeMb: number;
  includeRawPackets: boolean;
  includeTechnicalDetails: boolean;
  autoExportOnCritical: boolean;
  developerMode: boolean;
  soundFeedback: boolean;
}

export interface ObdPid {
  id?: string;
  pidHex: string;
  mode: number;
  name: string;
  nameAr: string;
  shortName: string;
  unit: string;
  min: number;
  max: number;
  currentValue: number;
  formula: string;
  bytesCount: number;
  category: 'engine' | 'fuel' | 'air' | 'electrical' | 'temperature' | 'speed';
  history: { timestamp: number; value: number }[];
  decode: (bytes: number[]) => number;
}

export type DtcStatus = 'CONFIRMED' | 'PENDING' | 'PERMANENT';

export interface FreezeFrameRecord {
  engineRpm?: number;
  vehicleSpeed?: number;
  coolantTempC?: number;
  calculatedLoadPercent?: number;
  shortTermFuelTrim1?: number;
  longTermFuelTrim1?: number;
  fuelPressureKpa?: number;
  intakeManifoldPressureKpa?: number;
  timingAdvanceDeg?: number;
}

export interface DiagnosticTroubleCode {
  code: string;
  descriptionEn: string;
  descriptionAr: string;
  ecu?: string;
  ecuAddressHex: string;
  status: DtcStatus;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  system: 'POWERTRAIN' | 'CHASSIS' | 'BODY' | 'NETWORK' | string;
  freezeFrameAvailable?: boolean;
  freezeFrameData?: FreezeFrameRecord;
  possibleCauses?: string[];
}

export interface VinInfo {
  rawVin: string;
  wmi?: string;
  vds?: string;
  vis?: string;
  manufacturer: string;
  model: string;
  year: number;
  plant?: string;
  sequentialNumber?: string;
  country: string;
  engineType?: string;
  transmission?: string;
  bodyType?: string;
  plantCode?: string;
  isValid: boolean;
}

export interface EcuInfo {
  id: string;
  nameEn: string;
  nameAr: string;
  addressHex: string;
  txIdHex: string;
  rxIdHex: string;
  protocol: string;
  status: 'ONLINE' | 'OFFLINE' | 'UNRESPONSIVE' | 'SCANNING';
  dtcCount: number;
  softwareVersion?: string;
  hardwareVersion?: string;
  partNumber?: string;
  supportedPidsCount: number;
}

export interface CanFrame {
  id: string;
  dlc: number;
  dataHex: string;
  dataBytes: number[];
  timestamp?: number | string;
  direction: 'Rx' | 'Tx';
  isExtended: boolean;
  description?: string;
}

export type CommDirection = 'APP -> ESP32' | 'ESP32 -> ECU' | 'ECU -> ESP32' | 'ESP32 -> APP';

export interface CommunicationPacket {
  id: string;
  sequenceId?: number;
  timestamp: string | number;
  direction: string;
  protocol: string;
  canIdHex?: string;
  dlc?: number;
  requestRaw?: string;
  responseRaw?: string;
  decodedData?: string;
  error?: string;
  durationMs: number;
  status: 'SUCCESS' | 'TIMEOUT' | 'ERROR' | 'NRC';
  stackTrace?: string;
}

export type LogSeverity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
export type LogCategory = 'NETWORK' | 'OBD' | 'CAN' | 'ISOTP' | 'UDS' | 'ECU' | 'SERVICE' | 'SYSTEM' | 'SECURITY' | 'STORAGE' | 'UI' | 'PROTOCOL';

export interface LogEntry {
  id: string;
  correlationId: string;
  timestamp: string | number;
  severity: LogSeverity;
  category: LogCategory;
  source?: string;
  operation: string;
  messageEn: string;
  messageAr: string;
  technicalDetails?: any;
  rawPacket?: string;
  requestHex?: string;
  responseHex?: string;
  protocol?: string;
  canId?: string;
  sequenceId?: number;
  durationMs?: number;
  deviceState?: ConnectionStatus;
  vehicleContext?: {
    vin?: string;
    model?: string;
    batteryVoltage?: number;
    ignitionState?: 'ON' | 'OFF' | 'CRANK';
  };
  stackTrace?: string;
}

export type ErrorLogEntry = LogEntry;

export interface ServiceFunctionItem {
  id: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  category: 'ENGINE' | 'BRAKES' | 'STEERING' | 'BATTERY' | 'TRANSMISSION' | 'EXHAUST' | string;
  ecuTarget: string;
  routineIdHex: string;
  supportedVehicles?: string[];
  requiredConditions?: {
    minVoltage?: number;
    ignitionState?: 'ON' | 'OFF' | 'RUNNING';
    engineState?: 'STOPPED' | 'IDLE';
    gearPosition?: 'PARK' | 'NEUTRAL' | 'ANY';
    parkingBrake?: 'ENGAGED' | 'RELEASED' | 'ANY';
  };
  warningsEn: string[];
  warningsAr: string[];
  stepsEn: string[];
  stepsAr: string[];
}

export interface UdsResponse {
  serviceId: number;
  isPositive: boolean;
  rawHex: string;
  decoded: string;
  nrcCode?: number;
  nrcDescriptionEn?: string;
  nrcDescriptionAr?: string;
}
