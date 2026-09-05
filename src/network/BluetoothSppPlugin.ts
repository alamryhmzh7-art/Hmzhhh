import { registerPlugin, PluginListenerHandle } from '@capacitor/core';

export interface NativeDiscoveredDevice {
  name: string;
  address: string;
  bonded?: boolean;
  rssi?: number;
  type?: string;
}

export interface BluetoothSppPlugin {
  startDiscovery(): Promise<{ started: boolean }>;
  stopDiscovery(): Promise<{ stopped: boolean }>;
  getPairedDevices(): Promise<{ devices: NativeDiscoveredDevice[] }>;
  connect(options: { address: string }): Promise<{ connected: boolean; address: string } | void>;
  disconnect(): Promise<void>;
  write(options: { data: number[] }): Promise<void>;
  checkPermissions(): Promise<{ bluetooth: string }>;
  requestPermissions(): Promise<{ bluetooth: string }>;
  addListener(
    eventName: 'onBluetoothDeviceFound',
    listenerFunc: (device: NativeDiscoveredDevice) => void
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
  addListener(
    eventName: 'onBluetoothDiscoveryFinished',
    listenerFunc: () => void
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
  addListener(
    eventName: 'onBluetoothData',
    listenerFunc: (info: { data: number[] }) => void
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
  addListener(
    eventName: 'onBluetoothDisconnect',
    listenerFunc: (info: { error?: string }) => void
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
}

export const BluetoothSpp = registerPlugin<BluetoothSppPlugin>('BluetoothSpp');
