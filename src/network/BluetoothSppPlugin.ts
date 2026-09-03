import { registerPlugin } from '@capacitor/core';

export interface BluetoothSppPlugin {
  getPairedDevices(): Promise<{ devices: { name: string; address: string }[] }>;
  connect(options: { address: string }): Promise<void>;
  disconnect(): Promise<void>;
  write(options: { data: number[] }): Promise<void>;
  checkPermissions(): Promise<{ bluetooth: string }>;
  requestPermissions(): Promise<{ bluetooth: string }>;
}

export const BluetoothSpp = registerPlugin<BluetoothSppPlugin>('BluetoothSpp');
