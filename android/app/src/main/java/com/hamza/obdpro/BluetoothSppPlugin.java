package com.hamza.obdpro;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.PermissionState;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(
    name = "BluetoothSpp",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = {
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN
            }
        )
    }
)
public class BluetoothSppPlugin extends Plugin {

    private static final String TAG = "HamzaBT";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private BluetoothAdapter bluetoothAdapter;
    private BluetoothSocket socket;
    private InputStream inputStream;
    private OutputStream outputStream;
    private Thread readThread;
    private boolean isConnected = false;

    @Override
    public void load() {
        Log.d(TAG, "[BT-NATIVE] PLUGIN INITIALIZED");
        bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
    }

    // Check for Android 12+ Bluetooth Connect Permission
    private boolean hasBluetoothConnectPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    @PluginMethod
    public void getPairedDevices(PluginCall call) {
        if (bluetoothAdapter == null) {
            call.reject("Bluetooth is not supported on this hardware.");
            return;
        }

        Log.d(TAG, "[BT-NATIVE] PERMISSION CHECK");
        if (getPermissionState("bluetooth") != PermissionState.GRANTED || !hasBluetoothConnectPermission()) {
            call.reject("Bluetooth permission denied by user (BLUETOOTH_CONNECT).");
            return;
        }

        try {
            @SuppressLint("MissingPermission")
            Set<BluetoothDevice> pairedDevices = bluetoothAdapter.getBondedDevices();
            
            Log.d(TAG, "[BT-NATIVE] PAIRED DEVICES COUNT: " + (pairedDevices != null ? pairedDevices.size() : 0));

            JSArray devicesArray = new JSArray();
            if (pairedDevices != null) {
                for (BluetoothDevice device : pairedDevices) {
                    JSObject devObj = new JSObject();
                    @SuppressLint("MissingPermission") String name = device.getName();
                    String address = device.getAddress();
                    devObj.put("name", name != null ? name : "Unknown");
                    devObj.put("address", address);
                    devicesArray.put(devObj);
                }
            }

            JSObject result = new JSObject();
            result.put("devices", devicesArray);
            call.resolve(result);
        } catch (SecurityException e) {
            call.reject("SecurityException: " + e.getMessage());
        }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String address = call.getString("address");
        if (address == null) {
            call.reject("Must provide MAC address");
            return;
        }

        address = address.trim().toUpperCase();

        if (bluetoothAdapter == null) {
            call.reject("Bluetooth not supported");
            return;
        }

        Log.d(TAG, "[BT-NATIVE] PERMISSION CHECK");
        if (getPermissionState("bluetooth") != PermissionState.GRANTED || !hasBluetoothConnectPermission()) {
            call.reject("Bluetooth permission denied by user (BLUETOOTH_CONNECT).");
            return;
        }

        if (isConnected) {
            disconnectInternal();
        }

        try {
            Log.d(TAG, "[BT-NATIVE] TARGET MAC: " + address);
            
            @SuppressLint("MissingPermission")
            @SuppressLint("MissingPermission")
            Set<BluetoothDevice> pairedDevices = bluetoothAdapter.getBondedDevices();
            BluetoothDevice device = null;
            if (pairedDevices != null) {
                for (BluetoothDevice d : pairedDevices) {
                    if (d.getAddress().equals(address)) {
                        device = d;
                        break;
                    }
                }
            }
            if (device == null) {
                Log.d(TAG, "[BT-NATIVE] TARGET FOUND: FALSE");
                call.reject("Target " + address + " not found (TARGET_NOT_PAIRED)");
                return;
            }
            
            Log.d(TAG, "[BT-NATIVE] TARGET FOUND: TRUE");
            Log.d(TAG, "[BT-NATIVE] RFCOMM CONNECT START");
            Log.d(TAG, "[BT-NATIVE] SPP UUID: " + SPP_UUID.toString());
            
            @SuppressLint("MissingPermission")
            BluetoothSocket tmp = device.createRfcommSocketToServiceRecord(SPP_UUID);
            socket = tmp;

            @SuppressLint("MissingPermission")
            boolean wasDiscovering = bluetoothAdapter.isDiscovering();
            if (wasDiscovering) {
                @SuppressLint("MissingPermission")
                boolean canceled = bluetoothAdapter.cancelDiscovery();
            }

            socket.connect();
            isConnected = true;
            inputStream = socket.getInputStream();
            outputStream = socket.getOutputStream();

            Log.d(TAG, "[BT-NATIVE] STREAMS OPEN");
            Log.d(TAG, "[BT-NATIVE] RFCOMM CONNECT SUCCESS");

            startReadThread();

            call.resolve();

        } catch (Exception e) {
            Log.e(TAG, "Connection failed: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            call.reject("Connection failed: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private void startReadThread() {
        Log.d(TAG, "[BT-NATIVE] READ THREAD STARTED");
        readThread = new Thread(() -> {
            byte[] buffer = new byte[1024];
            int bytes;

            while (isConnected && inputStream != null) {
                try {
                    bytes = inputStream.read(buffer);
                    if (bytes > 0) {
                        byte[] readBuf = new byte[bytes];
                        System.arraycopy(buffer, 0, readBuf, 0, bytes);
                        
                        StringBuilder hexStr = new StringBuilder();
                        JSArray jsArr = new JSArray();
                        for (int i = 0; i < bytes; i++) {
                            int v = readBuf[i] & 0xFF;
                            jsArr.put(v);
                            hexStr.append(String.format("%02X ", v));
                        }
                        
                        String hexOutput = hexStr.toString().trim();
                        Log.d(TAG, "[BT-NATIVE] RX: " + hexOutput);
                        
                        if (bytes >= 8 && readBuf[0] == (byte)0xAA && readBuf[1] == (byte)0x55 && readBuf[2] == (byte)0x03) {
                            Log.d(TAG, "[BT-NATIVE] PONG SUCCESS");
                        }

                        JSObject ret = new JSObject();
                        ret.put("data", jsArr);
                        notifyListeners("onBluetoothData", ret);
                    }
                } catch (Exception e) {
                    isConnected = false;
                    JSObject err = new JSObject();
                    err.put("error", "Disconnected: " + e.getMessage());
                    notifyListeners("onBluetoothDisconnect", err);
                    break;
                }
            }
        });
        readThread.start();
    }

    @PluginMethod
    public void write(PluginCall call) {
        if (!isConnected || outputStream == null) {
            call.reject("Not connected");
            return;
        }
        
        JSArray dataArr = call.getArray("data");
        if (dataArr == null) {
            call.reject("No data provided");
            return;
        }

        try {
            byte[] buffer = new byte[dataArr.length()];
            StringBuilder hexStr = new StringBuilder();
            for (int i = 0; i < dataArr.length(); i++) {
                int v = dataArr.getInt(i);
                buffer[i] = (byte) v;
                hexStr.append(String.format("%02X ", v));
            }
            
            Log.d(TAG, "[BT-NATIVE] TX: " + hexStr.toString().trim());
            
            if (buffer.length >= 8 && buffer[0] == (byte)0xAA && buffer[1] == (byte)0x55 && buffer[2] == (byte)0x02) {
                 Log.d(TAG, "[BT-NATIVE] PING TX");
            }

            outputStream.write(buffer);
            outputStream.flush();
            call.resolve();
        } catch (Exception e) {
            call.reject("Write failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        disconnectInternal();
        Log.d(TAG, "[BT-NATIVE] RFCOMM DISCONNECT");
        call.resolve();
    }

    private void disconnectInternal() {
        isConnected = false;
        try {
            if (inputStream != null) inputStream.close();
            if (outputStream != null) outputStream.close();
            if (socket != null) socket.close();
        } catch (Exception ignored) { }
    }
}
