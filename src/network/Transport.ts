/**
 * HAMZA OBD PRO - Unified Transport Layer Interface
 * 
 * Abstract Transport interface decoupled completely from diagnostic logic (OBD-II, ISO-TP, UDS, CAN).
 * Enables seamless switching between Wi-Fi TCP and Bluetooth Classic SPP without changing diagnostic code.
 */

import { ConnectionConfig, ConnectionStatus, CanFrame, CanBusStatus, TransportType, BluetoothDeviceInfo } from '../types';

export interface PingResult {
  success: boolean;
  latencyMs: number;
  canReady?: boolean;
  uptimeMs?: number;
  freeHeapBytes?: number;
  info?: string;
  txHex?: string;
  rxHex?: string;
}

export interface ITransport {
  readonly type: TransportType;
  
  getState(): ConnectionStatus;
  isConnected(): boolean;
  
  connect(config?: Partial<ConnectionConfig>): Promise<boolean>;
  disconnect(): Promise<void>;
  
  sendRaw(data: Uint8Array | number[]): Promise<boolean>;
  sendCanFrame(canId: number, data: number[], isExtended?: boolean): Promise<boolean>;
  
  ping(): Promise<PingResult>;
  getCanStatus(): Promise<CanBusStatus | null>;
  
  onData(callback: (data: Uint8Array) => void): () => void;
  onCanFrame(callback: (frame: CanFrame) => void): () => void;
  onStateChange(callback: (state: ConnectionStatus, error?: string) => void): () => void;
  
  scanDevices?(): Promise<BluetoothDeviceInfo[]>;
}

export const defaultConnectionConfig: ConnectionConfig = {
  transportType: 'WIFI_TCP',
  ip: '192.168.4.1',
  port: 35000,
  bluetoothDeviceName: 'ESP32-OBD-PRO',
  bluetoothMacAddress: '24:6F:28:B4:7A:1C',
  bluetoothSppUuid: '00001101-0000-1000-8000-00805F9B34FB',
  connectionTimeoutMs: 5000,
  responseTimeoutMs: 2500,
  canSpeed: '500K',
  canMode: '11-bit',
  protocol: 'ISO 15765-4 (CAN 11/500)',
  autoReconnect: true,
  isMockMode: false // Defaults to Real Connection mode, no automatic Demo mode on startup
};
