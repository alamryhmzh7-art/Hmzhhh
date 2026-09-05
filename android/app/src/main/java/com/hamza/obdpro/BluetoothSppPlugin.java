package com.hamza.obdpro;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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
import com.getcapacitor.annotation.PermissionCallback;
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
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN,
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        )
    }
)
@SuppressLint("MissingPermission")
public class BluetoothSppPlugin extends Plugin {

    private static final String TAG = "HamzaBT";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private BluetoothAdapter bluetoothAdapter;
    private BluetoothSocket socket;
    private InputStream inputStream;
    private OutputStream outputStream;
    private Thread readThread;
    private boolean isConnected = false;

    private BroadcastReceiver discoveryReceiver = null;
    private boolean isReceiverRegistered = false;

    @Override
    public void load() {
        Log.d(TAG, "[BT-NATIVE] PLUGIN INITIALIZED");
        bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        try {
            if (bluetoothAdapter != null && bluetoothAdapter.isDiscovering()) {
                bluetoothAdapter.cancelDiscovery();
            }
            unregisterDiscoveryReceiver();
            disconnectInternal();
        } catch (Exception ignored) {}
    }

    private boolean checkBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            boolean hasScan = ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED;
            boolean hasConnect = ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
            return hasScan && hasConnect;
        } else {
            boolean hasBt = ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED;
            boolean hasBtAdmin = ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_ADMIN) == PackageManager.PERMISSION_GRANTED;
            boolean hasLocation = ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    || ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            return hasBt && hasBtAdmin && hasLocation;
        }
    }

    @PluginMethod
    public void startDiscovery(PluginCall call) {
        if (bluetoothAdapter == null) {
            call.reject("Bluetooth is not supported on this device.");
            return;
        }

        if (!bluetoothAdapter.isEnabled()) {
            call.reject("Bluetooth is turned off. Please turn on Bluetooth.");
            return;
        }

        if (!checkBluetoothPermissions()) {
            requestPermissionForAlias("bluetooth", call, "discoveryPermsCallback");
            return;
        }

        executeStartDiscovery(call);
    }

    @PermissionCallback
    private void discoveryPermsCallback(PluginCall call) {
        if (checkBluetoothPermissions()) {
            executeStartDiscovery(call);
        } else {
            Log.e(TAG, "[BT-SCAN] Bluetooth permissions denied by user");
            call.reject("Bluetooth scan / connect permissions denied by user.");
        }
    }

    private void executeStartDiscovery(PluginCall call) {
        try {
            if (bluetoothAdapter.isDiscovering()) {
                bluetoothAdapter.cancelDiscovery();
            }

            registerDiscoveryReceiver();

            Log.d(TAG, "[BT-SCAN] START");
            boolean started = bluetoothAdapter.startDiscovery();
            if (!started) {
                Log.e(TAG, "[BT-SCAN] Failed to initiate startDiscovery");
                unregisterDiscoveryReceiver();
                call.reject("Failed to initiate Bluetooth discovery");
                return;
            }

            JSObject res = new JSObject();
            res.put("started", true);
            call.resolve(res);
        } catch (SecurityException se) {
            Log.e(TAG, "[BT-SCAN] SecurityException: " + se.getMessage());
            call.reject("SecurityException starting discovery: " + se.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "[BT-SCAN] Error: " + e.getMessage());
            call.reject("Error starting discovery: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        try {
            if (bluetoothAdapter != null && bluetoothAdapter.isDiscovering()) {
                bluetoothAdapter.cancelDiscovery();
            }
            unregisterDiscoveryReceiver();
            Log.d(TAG, "[BT-SCAN] FINISHED");
            JSObject res = new JSObject();
            res.put("stopped", true);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Error stopping discovery: " + e.getMessage());
        }
    }

    private synchronized void registerDiscoveryReceiver() {
        if (isReceiverRegistered && discoveryReceiver != null) {
            return;
        }

        discoveryReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (BluetoothDevice.ACTION_FOUND.equals(action)) {
                    BluetoothDevice device = null;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class);
                    } else {
                        device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    }

                    if (device != null) {
                        String name = null;
                        try {
                            name = device.getName();
                        } catch (SecurityException ignored) {}

                        String address = device.getAddress();
                        boolean bonded = (device.getBondState() == BluetoothDevice.BOND_BONDED);
                        short rssi = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE);

                        int btType = device.getType();
                        String typeStr = "CLASSIC_SPP";
                        if (btType == BluetoothDevice.DEVICE_TYPE_LE) {
                            typeStr = "BLE";
                        } else if (btType == BluetoothDevice.DEVICE_TYPE_DUAL) {
                            typeStr = "DUAL";
                        }

                        Log.d(TAG, "[BT-SCAN] DEVICE_FOUND name=" + (name != null ? name : "Unknown") + " address=" + address);

                        JSObject devObj = new JSObject();
                        devObj.put("name", name != null && !name.trim().isEmpty() ? name : "Unknown");
                        devObj.put("address", address);
                        devObj.put("bonded", bonded);
                        devObj.put("rssi", (int) rssi);
                        devObj.put("type", typeStr);

                        notifyListeners("onBluetoothDeviceFound", devObj);
                    }
                } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                    Log.d(TAG, "[BT-SCAN] FINISHED");
                    JSObject finObj = new JSObject();
                    notifyListeners("onBluetoothDiscoveryFinished", finObj);
                }
            }
        };

        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_STARTED);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);

        getContext().registerReceiver(discoveryReceiver, filter);
        isReceiverRegistered = true;
    }

    private synchronized void unregisterDiscoveryReceiver() {
        if (isReceiverRegistered && discoveryReceiver != null) {
            try {
                getContext().unregisterReceiver(discoveryReceiver);
            } catch (Exception ignored) {}
            isReceiverRegistered = false;
            discoveryReceiver = null;
        }
    }

    @PluginMethod
    public void getPairedDevices(PluginCall call) {
        if (bluetoothAdapter == null) {
            call.reject("Bluetooth is not supported on this hardware.");
            return;
        }

        if (!checkBluetoothPermissions()) {
            requestPermissionForAlias("bluetooth", call, "pairedPermsCallback");
            return;
        }

        executeGetPairedDevices(call);
    }

    @PermissionCallback
    private void pairedPermsCallback(PluginCall call) {
        if (checkBluetoothPermissions()) {
            executeGetPairedDevices(call);
        } else {
            call.reject("Bluetooth permission denied by user.");
        }
    }

    private void executeGetPairedDevices(PluginCall call) {
        try {
            Set<BluetoothDevice> pairedDevices = bluetoothAdapter.getBondedDevices();
            JSArray devicesArray = new JSArray();
            if (pairedDevices != null) {
                for (BluetoothDevice device : pairedDevices) {
                    JSObject devObj = new JSObject();
                    String name = device.getName();
                    String address = device.getAddress();
                    devObj.put("name", name != null && !name.trim().isEmpty() ? name : "Unknown");
                    devObj.put("address", address);
                    devObj.put("bonded", true);
                    devObj.put("type", "CLASSIC_SPP");
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
        if (address == null || address.trim().isEmpty()) {
            call.reject("Must provide MAC address");
            return;
        }

        if (bluetoothAdapter == null) {
            call.reject("Bluetooth not supported");
            return;
        }

        if (!checkBluetoothPermissions()) {
            requestPermissionForAlias("bluetooth", call, "connectPermsCallback");
            return;
        }

        executeConnect(call, address.trim().toUpperCase());
    }

    @PermissionCallback
    private void connectPermsCallback(PluginCall call) {
        String address = call.getString("address");
        if (address != null && checkBluetoothPermissions()) {
            executeConnect(call, address.trim().toUpperCase());
        } else {
            Log.e(TAG, "[BT-CONNECT] FAILED error=Permission denied (BLUETOOTH_CONNECT)");
            call.reject("Bluetooth permission denied by user (BLUETOOTH_CONNECT).");
        }
    }

    private void executeConnect(PluginCall call, String address) {
        if (isConnected) {
            disconnectInternal();
        }

        if (bluetoothAdapter.isDiscovering()) {
            bluetoothAdapter.cancelDiscovery();
        }

        Log.d(TAG, "[BT-CONNECT] START address=" + address);

        new Thread(() -> {
            BluetoothSocket tmpSocket = null;
            Exception lastException = null;

            try {
                BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
                if (device == null) {
                    Log.e(TAG, "[BT-CONNECT] FAILED error=Device not found for " + address);
                    call.reject("Device not found for address: " + address);
                    return;
                }

                // 1. Try standard RFCOMM socket
                try {
                    tmpSocket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    tmpSocket.connect();
                } catch (Exception e1) {
                    lastException = e1;
                    if (tmpSocket != null) {
                        try { tmpSocket.close(); } catch (Exception ignored) {}
                        tmpSocket = null;
                    }
                }

                // 2. Try insecure RFCOMM socket fallback
                if (tmpSocket == null || !tmpSocket.isConnected()) {
                    try {
                        tmpSocket = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                        tmpSocket.connect();
                    } catch (Exception e2) {
                        lastException = e2;
                        if (tmpSocket != null) {
                            try { tmpSocket.close(); } catch (Exception ignored) {}
                            tmpSocket = null;
                        }
                    }
                }

                // 3. Try reflection channel 1 fallback
                if (tmpSocket == null || !tmpSocket.isConnected()) {
                    try {
                        java.lang.reflect.Method m = device.getClass().getMethod("createRfcommSocket", new Class[]{int.class});
                        tmpSocket = (BluetoothSocket) m.invoke(device, 1);
                        if (tmpSocket != null) {
                            tmpSocket.connect();
                        }
                    } catch (Exception e3) {
                        lastException = e3;
                        if (tmpSocket != null) {
                            try { tmpSocket.close(); } catch (Exception ignored) {}
                            tmpSocket = null;
                        }
                    }
                }

                if (tmpSocket == null || !tmpSocket.isConnected()) {
                    String errorMsg = lastException != null ? lastException.getMessage() : "RFCOMM connection failed";
                    Log.e(TAG, "[BT-CONNECT] FAILED error=" + errorMsg);
                    disconnectInternal();
                    call.reject("Connection failed: " + errorMsg);
                    return;
                }

                socket = tmpSocket;
                isConnected = true;
                inputStream = socket.getInputStream();
                outputStream = socket.getOutputStream();

                Log.d(TAG, "[BT-CONNECT] SUCCESS");
                startReadThread();

                JSObject res = new JSObject();
                res.put("connected", true);
                res.put("address", address);
                call.resolve(res);

            } catch (Exception e) {
                Log.e(TAG, "[BT-CONNECT] FAILED error=" + e.getMessage());
                disconnectInternal();
                call.reject("Connection failed: " + e.getMessage());
            }
        }).start();
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

                        JSArray jsArr = new JSArray();
                        for (int i = 0; i < bytes; i++) {
                            jsArr.put(readBuf[i] & 0xFF);
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
            for (int i = 0; i < dataArr.length(); i++) {
                buffer[i] = (byte) dataArr.getInt(i);
            }

            outputStream.write(buffer);
            outputStream.flush();
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "[BT-WRITE] Error: " + e.getMessage());
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
        } catch (Exception ignored) {}
        inputStream = null;
        outputStream = null;
        socket = null;
    }
}
