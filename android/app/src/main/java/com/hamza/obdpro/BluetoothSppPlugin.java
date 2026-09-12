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

import java.io.InputStream;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

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

private static final UUID SPP_UUID =
        UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

private BluetoothAdapter bluetoothAdapter;

private volatile BluetoothSocket socket;
private volatile InputStream inputStream;
private volatile OutputStream outputStream;

private Thread readThread;

private final AtomicBoolean isConnected = new AtomicBoolean(false);
private final AtomicBoolean disconnectEventSent = new AtomicBoolean(false);

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
        disconnectInternal(false);
    } catch (Exception ignored) {
    }
}

private boolean checkBluetoothPermissions() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        boolean hasScan =
                ActivityCompat.checkSelfPermission(
                        getContext(),
                        Manifest.permission.BLUETOOTH_SCAN
                ) == PackageManager.PERMISSION_GRANTED;

        boolean hasConnect =
                ActivityCompat.checkSelfPermission(
                        getContext(),
                        Manifest.permission.BLUETOOTH_CONNECT
                ) == PackageManager.PERMISSION_GRANTED;

        return hasScan && hasConnect;
    }

    boolean hasBt =
            ActivityCompat.checkSelfPermission(
                    getContext(),
                    Manifest.permission.BLUETOOTH
            ) == PackageManager.PERMISSION_GRANTED;

    boolean hasBtAdmin =
            ActivityCompat.checkSelfPermission(
                    getContext(),
                    Manifest.permission.BLUETOOTH_ADMIN
            ) == PackageManager.PERMISSION_GRANTED;

    boolean hasLocation =
            ActivityCompat.checkSelfPermission(
                    getContext(),
                    Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
            ||
            ActivityCompat.checkSelfPermission(
                    getContext(),
                    Manifest.permission.ACCESS_COARSE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED;

    return hasBt && hasBtAdmin && hasLocation;
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
        requestPermissionForAlias(
                "bluetooth",
                call,
                "discoveryPermsCallback"
        );
        return;
    }

    executeStartDiscovery(call);
}

@PermissionCallback
private void discoveryPermsCallback(PluginCall call) {
    if (checkBluetoothPermissions()) {
        executeStartDiscovery(call);
    } else {
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
            unregisterDiscoveryReceiver();
            call.reject("Failed to initiate Bluetooth discovery");
            return;
        }

        JSObject res = new JSObject();
        res.put("started", true);
        call.resolve(res);

    } catch (SecurityException e) {
        Log.e(TAG, "[BT-SCAN] SecurityException: " + e.getMessage());
        call.reject("SecurityException starting discovery: " + e.getMessage());

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
                    device = intent.getParcelableExtra(
                            BluetoothDevice.EXTRA_DEVICE,
                            BluetoothDevice.class
                    );
                } else {
                    device = intent.getParcelableExtra(
                            BluetoothDevice.EXTRA_DEVICE
                    );
                }

                if (device == null) {
                    return;
                }

                String name = null;

                try {
                    name = device.getName();
                } catch (SecurityException ignored) {
                }

                String address = device.getAddress();

                boolean bonded =
                        device.getBondState() == BluetoothDevice.BOND_BONDED;

                short rssi =
                        intent.getShortExtra(
                                BluetoothDevice.EXTRA_RSSI,
                                Short.MIN_VALUE
                        );

                int btType = device.getType();

                String typeStr = "CLASSIC_SPP";

                if (btType == BluetoothDevice.DEVICE_TYPE_LE) {
                    typeStr = "BLE";
                } else if (btType == BluetoothDevice.DEVICE_TYPE_DUAL) {
                    typeStr = "DUAL";
                }

                JSObject devObj = new JSObject();

                devObj.put(
                        "name",
                        name != null && !name.trim().isEmpty()
                                ? name
                                : "Unknown"
                );

                devObj.put("address", address);
                devObj.put("bonded", bonded);
                devObj.put("rssi", (int) rssi);
                devObj.put("type", typeStr);

                notifyListeners(
                        "onBluetoothDeviceFound",
                        devObj
                );

            } else if (
                    BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)
            ) {

                notifyListeners(
                        "onBluetoothDiscoveryFinished",
                        new JSObject()
                );
            }
        }
    };

    IntentFilter filter = new IntentFilter();

    filter.addAction(BluetoothDevice.ACTION_FOUND);
    filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_STARTED);
    filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        getContext().registerReceiver(
                discoveryReceiver,
                filter,
                Context.RECEIVER_NOT_EXPORTED
        );
    } else {
        getContext().registerReceiver(
                discoveryReceiver,
                filter
        );
    }

    isReceiverRegistered = true;
}

private synchronized void unregisterDiscoveryReceiver() {
    if (!isReceiverRegistered || discoveryReceiver == null) {
        return;
    }

    try {
        getContext().unregisterReceiver(discoveryReceiver);
    } catch (Exception ignored) {
    }

    isReceiverRegistered = false;
    discoveryReceiver = null;
}

@PluginMethod
public void getPairedDevices(PluginCall call) {

    if (bluetoothAdapter == null) {
        call.reject("Bluetooth is not supported on this hardware.");
        return;
    }

    if (!checkBluetoothPermissions()) {
        requestPermissionForAlias(
                "bluetooth",
                call,
                "pairedPermsCallback"
        );
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

        Set<BluetoothDevice> pairedDevices =
                bluetoothAdapter.getBondedDevices();

        JSArray devicesArray = new JSArray();

        if (pairedDevices != null) {

            for (BluetoothDevice device : pairedDevices) {

                JSObject devObj = new JSObject();

                String name = device.getName();
                String address = device.getAddress();

                devObj.put(
                        "name",
                        name != null && !name.trim().isEmpty()
                                ? name
                                : "Unknown"
                );

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

    } catch (Exception e) {
        call.reject("Failed to get paired devices: " + e.getMessage());
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
        requestPermissionForAlias(
                "bluetooth",
                call,
                "connectPermsCallback"
        );
        return;
    }

    executeConnect(
            call,
            address.trim().toUpperCase()
    );
}

@PermissionCallback
private void connectPermsCallback(PluginCall call) {

    String address = call.getString("address");

    if (address != null && checkBluetoothPermissions()) {

        executeConnect(
                call,
                address.trim().toUpperCase()
        );

    } else {

        call.reject(
                "Bluetooth permission denied by user (BLUETOOTH_CONNECT)."
        );
    }
}

private void executeConnect(
        PluginCall call,
        String address
) {

    disconnectInternal(false);

    if (bluetoothAdapter.isDiscovering()) {
        bluetoothAdapter.cancelDiscovery();
    }

    Log.d(
            TAG,
            "[BT-CONNECT] START address=" + address
    );

    new Thread(() -> {

        BluetoothSocket tmpSocket = null;
        Exception lastException = null;

        try {

            BluetoothDevice device =
                    bluetoothAdapter.getRemoteDevice(address);

            if (device == null) {
                call.reject(
                        "Device not found for address: " + address
                );
                return;
            }

            /*
             * Attempt 1:
             * Standard authenticated RFCOMM SPP.
             */
            try {

                tmpSocket =
                        device.createRfcommSocketToServiceRecord(
                                SPP_UUID
                        );

                tmpSocket.connect();

            } catch (Exception e1) {

                lastException = e1;

                closeQuietly(tmpSocket);
                tmpSocket = null;
            }

            /*
             * Attempt 2:
             * Insecure RFCOMM SPP.
             */
            if (tmpSocket == null || !tmpSocket.isConnected()) {

                try {

                    tmpSocket =
                            device.createInsecureRfcommSocketToServiceRecord(
                                    SPP_UUID
                            );

                    tmpSocket.connect();

                } catch (Exception e2) {

                    lastException = e2;

                    closeQuietly(tmpSocket);
                    tmpSocket = null;
                }
            }

            /*
             * Attempt 3:
             * Channel 1 fallback for older adapters.
             */
            if (tmpSocket == null || !tmpSocket.isConnected()) {

                try {

                    java.lang.reflect.Method method =
                            device.getClass().getMethod(
                                    "createRfcommSocket",
                                    int.class
                            );

                    tmpSocket =
                            (BluetoothSocket) method.invoke(
                                    device,
                                    1
                            );

                    if (tmpSocket != null) {
                        tmpSocket.connect();
                    }

                } catch (Exception e3) {

                    lastException = e3;

                    closeQuietly(tmpSocket);
                    tmpSocket = null;
                }
            }

            if (tmpSocket == null || !tmpSocket.isConnected()) {

                String errorMsg =
                        lastException != null
                                ? lastException.getMessage()
                                : "RFCOMM connection failed";

                Log.e(
                        TAG,
                        "[BT-CONNECT] FAILED error=" + errorMsg
                );

                closeQuietly(tmpSocket);

                call.reject(
                        "Connection failed: " + errorMsg
                );

                return;
            }

            InputStream newInputStream =
                    tmpSocket.getInputStream();

            OutputStream newOutputStream =
                    tmpSocket.getOutputStream();

            socket = tmpSocket;
            inputStream = newInputStream;
            outputStream = newOutputStream;

            disconnectEventSent.set(false);
            isConnected.set(true);

            Log.d(
                    TAG,
                    "[BT-CONNECT] SUCCESS"
            );

            startReadThread();

            JSObject res = new JSObject();

            res.put("connected", true);
            res.put("address", address);

            call.resolve(res);

        } catch (Exception e) {

            Log.e(
                    TAG,
                    "[BT-CONNECT] FAILED error=" + e.getMessage()
            );

            closeQuietly(tmpSocket);

            disconnectInternal(false);

            call.reject(
                    "Connection failed: " + e.getMessage()
            );
        }

    }, "HamzaBT-Connect").start();
}

private void startReadThread() {

    if (readThread != null && readThread.isAlive()) {
        return;
    }

    Log.d(
            TAG,
            "[BT-NATIVE] READ THREAD STARTED"
    );

    readThread =
            new Thread(
                    () -> {

                        byte[] buffer = new byte[1024];

                        try {

                            while (isConnected.get()) {

                                InputStream stream =
                                        inputStream;

                                if (stream == null) {
                                    break;
                                }

                                int bytes =
                                        stream.read(buffer);

                                if (bytes < 0) {
                                    break;
                                }

                                if (bytes == 0) {
                                    continue;
                                }

                                byte[] readBuf =
                                        new byte[bytes];

                                System.arraycopy(
                                        buffer,
                                        0,
                                        readBuf,
                                        0,
                                        bytes
                                );

                                /*
                                 * IMPORTANT:
                                 * Do not convert binary traffic
                                 * to String before sending it.
                                 *
                                 * The OBD/CAN protocol is binary.
                                 */
                                JSArray jsArr =
                                        new JSArray();

                                for (int i = 0; i < bytes; i++) {
                                    jsArr.put(
                                            readBuf[i] & 0xFF
                                    );
                                }

                                JSObject ret =
                                        new JSObject();

                                ret.put(
                                        "data",
                                        jsArr
                                );

                                notifyListeners(
                                        "onBluetoothData",
                                        ret
                                );
                            }

                        } catch (Exception e) {

                            if (isConnected.get()) {

                                Log.e(
                                        TAG,
                                        "[BT-RX] READ ERROR: "
                                                + e.getMessage()
                                );

                                sendDisconnectEvent(
                                        "Disconnected: "
                                                + e.getMessage()
                                );
                            }

                        } finally {

                            if (isConnected.get()) {

                                sendDisconnectEvent(
                                        "Bluetooth input stream closed"
                                );
                            }

                            isConnected.set(false);
                        }

                    },
                    "HamzaBT-Read"
            );

    readThread.start();
}

private void sendDisconnectEvent(String error) {

    if (!disconnectEventSent.compareAndSet(false, true)) {
        return;
    }

    JSObject err =
            new JSObject();

    err.put(
            "error",
            error != null
                    ? error
                    : "Bluetooth disconnected"
    );

    notifyListeners(
            "onBluetoothDisconnect",
            err
    );
}

@PluginMethod
public void write(PluginCall call) {

    if (!isConnected.get()) {
        call.reject("Not connected");
        return;
    }

    OutputStream stream =
            outputStream;

    if (stream == null) {
        call.reject("Bluetooth output stream is unavailable");
        return;
    }

    JSArray dataArr =
            call.getArray("data");

    if (dataArr == null) {
        call.reject("No data provided");
        return;
    }

    if (dataArr.length() == 0) {
        call.resolve();
        return;
    }

    try {

        byte[] buffer =
                new byte[dataArr.length()];

        for (int i = 0; i < dataArr.length(); i++) {

            int value =
                    dataArr.getInt(i);

            if (value < 0 || value > 255) {
                call.reject(
                        "Invalid byte at index "
                                + i
                );
                return;
            }

            buffer[i] =
                    (byte) value;
        }

        /*
         * Do not generate a hex String for every packet.
         * Heavy logging can contribute to freezes during
         * high-rate CAN traffic.
         */
        stream.write(buffer);
        stream.flush();

        call.resolve();

    } catch (Exception e) {

        Log.e(
                TAG,
                "[BT-WRITE] Error: "
                        + e.getMessage()
        );

        isConnected.set(false);

        sendDisconnectEvent(
                "Write failed: " + e.getMessage()
        );

        call.reject(
                "Write failed: "
                        + e.getMessage()
        );
    }
}

@PluginMethod
public void disconnect(PluginCall call) {

    disconnectInternal(true);

    Log.d(
            TAG,
            "[BT-NATIVE] RFCOMM DISCONNECT"
    );

    call.resolve();
}

private synchronized void disconnectInternal(
        boolean notify
) {

    boolean wasConnected =
            isConnected.getAndSet(false);

    if (notify && wasConnected) {

        sendDisconnectEvent(
                "Bluetooth disconnected"
        );
    }

    InputStream in = inputStream;
    OutputStream out = outputStream;
    BluetoothSocket currentSocket = socket;

    inputStream = null;
    outputStream = null;
    socket = null;

    closeQuietly(in);
    closeQuietly(out);
    closeQuietly(currentSocket);

    readThread = null;
}

private void closeQuietly(
        BluetoothSocket target
) {
    if (target == null) {
        return;
    }

    try {
        target.close();
    } catch (Exception ignored) {
    }
}

private void closeQuietly(
        InputStream target
) {
    if (target == null) {
        return;
    }

    try {
        target.close();
    } catch (Exception ignored) {
    }
}

private void closeQuietly(
        OutputStream target
) {
    if (target == null) {
        return;
    }

    try {
        target.close();
    } catch (Exception ignored) {
    }
}

}
