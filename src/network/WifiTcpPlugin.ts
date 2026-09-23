import { registerPlugin } from '@capacitor/core';

export interface WifiTcpPluginInterface {
  connect(options: { ip: string; port: number; timeoutMs?: number }): Promise<{ connected: boolean; ip: string; port: number }>;
  disconnect(): Promise<{ disconnected: boolean }>;
  send(options: { dataBase64?: string; dataHex?: string }): Promise<{ sentBytes: number }>;
  isConnected(): Promise<{ connected: boolean }>;
  addListener(
    eventName: 'dataReceived',
    listenerFunc: (data: { dataBase64: string; bytesLength: number }) => void
  ): Promise<any>;
  addListener(
    eventName: 'connectionError',
    listenerFunc: (data: { error: string }) => void
  ): Promise<any>;
  removeAllListeners(): Promise<void>;
}

export const WifiTcpNativePlugin = registerPlugin<WifiTcpPluginInterface>('WifiTcpPlugin');
