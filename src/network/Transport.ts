/**

* HAMZA OBD PRO - Unified Transport Layer Interface
* 
* Transport layer is completely decoupled from diagnostic logic:
* OBD-II, ISO-TP, UDS, CAN and K-Line must not depend on
* Bluetooth/Wi-Fi implementation details.
* 
* Supported transports:
* - Wi-Fi TCP
* - Bluetooth Classic SPP
* 
* The interface intentionally contains no diagnostic decoding logic.
  */

import {
ConnectionConfig,
ConnectionStatus,
CanFrame,
CanBusStatus,
TransportType,
BluetoothDeviceInfo,
KlineStatus
} from '../types';

import { DecodedBinaryPacket } from './binaryProtocol';

export interface PingResult {
success: boolean;
latencyMs: number;

/** ESP32 CAN controller state */
canReady?: boolean;

/** ESP32 uptime, when reported by firmware */
uptimeMs?: number;

/** ESP32 free heap, when reported by firmware */
freeHeapBytes?: number;

/** Human-readable diagnostic information */
info?: string;

/** Raw transmitted diagnostic data, when available */
txHex?: string;

/** Raw received diagnostic data, when available */
rxHex?: string;
}

export interface ITransport {
/**

* Transport implementation identifier.
  */
  readonly type: TransportType;

/**

* Normalized connection state used by the application.
  */
  getState(): ConnectionStatus;

/**

* Optional low-level connection state.
* Useful for debugging native Bluetooth/Wi-Fi failures.
  */
  getRawConnectionState?(): {
  state?: ConnectionStatus;
  rawState: string;
  lastError?: string | null;
  error: string | null;
  stackTrace?: string | null;
  };

/**

* Returns true only when the transport considers the connection usable.
  */
  isConnected(): boolean;

/**

* Update transport configuration without creating diagnostic logic here.
  */
  updateConfig(config: ConnectionConfig): void;

/**

* Establish the underlying transport connection.
  */
  connect(config?: Partial<ConnectionConfig>): Promise<boolean>;

/**

* Close the underlying transport connection.
  */
  disconnect(): Promise<void>;

/**

* Send an already encoded raw binary packet.
* 
* This method must NOT add OBD/UDS/CAN application semantics.
  */
  sendRaw(data: Uint8Array | number[]): Promise<boolean>;

/**

* Send a CAN frame through the ESP32 transport.
* 
* canId:
* 11-bit standard ID or 29-bit extended ID.
* 
* isExtended:
* true  = 29-bit CAN ID
* false = 11-bit CAN ID
  */
  sendCanFrame(
  canId: number,
  data: number[],
  isExtended?: boolean
  ): Promise<boolean>;

/**

* Initialize K-Line communication.
* 
* Optional because not every transport/firmware configuration
* exposes K-Line functionality.
  */
  sendKlineInit?(
  protocolId?: number
  ): Promise<{
  success: boolean;
  activeProtocol: number;
  keyByte1: number;
  keyByte2: number;
  }>;

/**

* Send a K-Line diagnostic frame.
  */
  sendKlineFrame?(
  payload: number[]
  ): Promise<{
  status: number;
  data: number[];
  }>;

/**

* Return current K-Line state when supported.
  */
  getKlineStatus?(): Promise<KlineStatus | null>;

/**

* Transport-level connectivity/health test.
  */
  ping(): Promise<PingResult>;

/**

* Return current CAN controller/bus state when available.
  */
  getCanStatus(): Promise<CanBusStatus | null>;

/**

* Raw binary data listener.
* 
* Returns an unsubscribe function.
  */
  onData(callback: (data: Uint8Array) => void): () => void;

/**

* Decoded CAN frame listener.
* 
* This is the critical RX path used by diagnostic logic.
  */
  onCanFrame(callback: (frame: CanFrame) => void): () => void;

/**

* K-Line packet listener when supported.
  */
  onKlinePacket?(
  callback: (pkt: DecodedBinaryPacket) => void
  ): () => void;

/**

* Connection state listener.
* 
* Returns an unsubscribe function.
  */
  onStateChange(
  callback: (
  state: ConnectionStatus,
  error?: string
  ) => void
  ): () => void;

/**

* Bluetooth device discovery.
* 
* Only Bluetooth transports are expected to implement this.
  */
  scanDevices?(
  onDeviceFound?: (dev: BluetoothDeviceInfo) => void
  ): Promise<BluetoothDeviceInfo[]>;
  }

/**

* Safe default connection configuration.
* 
* Important:
* This configuration selects the initial/default CAN profile only.
* It does NOT mean that the project supports only this protocol.
* Actual protocol support must be verified in the transport,
* firmware and diagnostic layers.
  */
  export const defaultConnectionConfig: ConnectionConfig = {
  transportType: 'WIFI_TCP',

ip: '192.168.4.1',
port: 35000,

bluetoothDeviceName: 'ESP32-OBD-PRO',
bluetoothMacAddress: '',
bluetoothSppUuid:
'00001101-0000-1000-8000-00805F9B34FB',

connectionTimeoutMs: 5000,

/**

* Keep this consistent with the normal short-request timeout
* used by TransportManager.
* 
* Long ISO-TP requests must still be handled by the diagnostic
* layer/TransportManager rather than by this default alone.
  */
  responseTimeoutMs: 3500,

/**

* Default CAN profile.
* 
* This is only the startup profile. It must not be interpreted
* as the complete list of supported OBD-II protocols.
  */
  canSpeed: '500K',
  canMode: '11-bit',
  protocol: 'ISO 15765-4 (CAN 11/500)',

autoReconnect: true,

/**

* Real hardware mode by default.
* Demo/mock communication must be explicitly enabled.
  */
  isMockMode: false
  };
