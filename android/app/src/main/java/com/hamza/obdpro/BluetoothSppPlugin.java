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

private static final String TAG = "BluetoothSppPlugin";
private static final UUID SPP_UUID =
        UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

private BluetoothAdapter bluetoothAdapter;
private volatile BluetoothSocket socket;
private volatile InputStream inputStream;
private volatile OutputStream outputStream;
private Thread readThread;

private final AtomicBoolean isConnected = new AtomicBoolean(false);
private final AtomicBoolean disconnectEventSent = new AtomicBoolean(false);

private BroadcastReceiver discoveryReceiver;
private boolean isReceiverRegistered;

@Override
public void load() {
    Log.d(TAG, "Bluetooth SPP plugin initialized");
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
        // Cleanup must not interrupt plugin destruction.
    }
}

private boolean hasBluetoothPermissions() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        return ActivityCompat.checkSelfPermission(
                getContext(),
                Manifest.permission.BLUETOOTH_SCAN
        ) == PackageManager.PERMISSION_GRANTED
                && ActivityCompat.checkSelfPermission(
                getContext(),
                Manifest.permission.BLUETOOTH_CONNECT
        ) == PackageManager.PERMISSION_GRANTED;
    }

    boolean hasBluetoothPermission =
            ActivityCompat.checkSelfPermission(
                    getContext(),
                    Manifest.permission.BLUETOOTH
            ) == PackageManager.PERMISSION_GRANTED;

    boolean hasBluetoothAdminPermission =
            ActivityCompat.checkSelfPermission(
                    getContext(),
                    Manifest.permission.BLUETOOTH_ADMIN
            ) == PackageManager.PERMISSION_GRANTED;

    boolean hasLocationPermission =
            ActivityCompat.checkSelfPermission(
                    getContext(),
                    Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
                    || ActivityCompat.checkSelfPermission(
                    getContext(),
                    Manifest.permission.ACCESS_COARSE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED;

    return hasBluetoothPermission
            && hasBluetoothAdminPermission
            && hasLocationPermission;
}

@PluginMethod
public void startDiscovery(PluginCall call) {
    if (bluetoothAdapter == null) {
        call.reject("Bluetooth is not supported on this device.");
        return;
    }

    if (!bluetoothAdapter.isEnabled()) {
        call.reject("Bluetooth is disabled. Please enable Bluetooth and try again.");
        return;
    }

    if (!hasBluetoothPermissions()) {
        requestPermissionForAlias(
                "bluetooth",
                call,
                "discoveryPermissionsCallback"
        );
        return;
    }

    executeStartDiscovery(call);
}

@PermissionCallback
private void discoveryPermissionsCallback(PluginCall call) {
    if (hasBluetoothPermissions()) {
        executeStartDiscovery(call);
    } else {
        call.reject("Bluetooth scan and connection permissions were denied.");
    }
}

private void executeStartDiscovery(PluginCall call) {
    try {
        if (bluetoothAdapter.isDiscovering()) {
            bluetoothAdapter.cancelDiscovery();
        }

        registerDiscoveryReceiver();

        boolean started = bluetoothAdapter.startDiscovery();

        if (!started) {
            unregisterDiscoveryReceiver();
            call.reject("Unable to start Bluetooth discovery.");
            return;
        }

        JSObject result = new JSObject();
        result.put("started", true);
        call.resolve(result);

    } catch (SecurityException exception) {
        Log.e(TAG, "Security error while starting discovery", exception);
        call.reject("Unable to start discovery due to a security restriction.");

    } catch (Exception exception) {
        Log.e(TAG, "Unexpected error while starting discovery", exception);
        call.reject("Unable to start Bluetooth discovery: " + exception.getMessage());
    }
}

@PluginMethod
public void stopDiscovery(PluginCall call) {
    try {
        if (bluetoothAdapter != null && bluetoothAdapter.isDiscovering()) {
            bluetoothAdapter.cancelDiscovery();
        }

        unregisterDiscoveryReceiver();

        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);

    } catch (Exception exception) {
        Log.e(TAG, "Error while stopping discovery", exception);
        call.reject("Unable to stop Bluetooth discovery: " + exception.getMessage());
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
                BluetoothDevice device;

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
                    // Device name may be unavailable without permission.
                }

                String deviceType = "CLASSIC_SPP";
                int bluetoothType = device.getType();

                if (bluetoothType == BluetoothDevice.DEVICE_TYPE_LE) {
                    deviceType = "BLE";
                } else if (bluetoothType == BluetoothDevice.DEVICE_TYPE_DUAL) {
                    deviceType = "DUAL";
                }

                JSObject deviceObject = new JSObject();
                deviceObject.put(
                        "name",
                        name != null && !name.trim().isEmpty()
                                ? name
                                : "Unknown"
                );
                deviceObject.put("address", device.getAddress());
                deviceObject.put(
                        "bonded",
                        device.getBondState() == BluetoothDevice.BOND_BONDED
                );
                deviceObject.put(
                        "rssi",
                        (int) intent.getShortExtra(
                                BluetoothDevice.EXTRA_RSSI,
                                Short.MIN_VALUE
                        )
                );
                deviceObject.put("type", deviceType);

                notifyListeners("onBluetoothDeviceFound", deviceObject);

            } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
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
        getContext().registerReceiver(discoveryReceiver, filter);
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
        // Receiver may already have been unregistered.
    }

    isReceiverRegistered = false;
    discoveryReceiver = null;
}

@PluginMethod
public void getPairedDevices(PluginCall call) {
    if (bluetoothAdapter == null) {
        call.reject("Bluetooth is not supported on this device.");
        return;
    }

    if (!hasBluetoothPermissions()) {
        requestPermissionForAlias(
                "bluetooth",
                call,
                "pairedDevicesPermissionsCallback"
        );
        return;
    }

    executeGetPairedDevices(call);
}

@PermissionCallback
private void pairedDevicesPermissionsCallback(PluginCall call) {
    if (hasBluetoothPermissions()) {
        executeGetPairedDevices(call);
    } else {
        call.reject("Bluetooth permissions were denied.");
    }
}

private void executeGetPairedDevices(PluginCall call) {
    try {
        Set<BluetoothDevice> pairedDevices =
                bluetoothAdapter.getBondedDevices();

        JSArray devices = new JSArray();

        if (pairedDevices != null) {
            for (BluetoothDevice device : pairedDevices) {
                String name = device.getName();

                JSObject deviceObject = new JSObject();
                deviceObject.put(
                        "name",
                        name != null && !name.trim().isEmpty()
                                ? name
                                : "Unknown"
                );
                deviceObject.put("address", device.getAddress());
                deviceObject.put("bonded", true);
                deviceObject.put("type", "CLASSIC_SPP");

                devices.put(deviceObject);
            }
        }

        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);

    } catch (SecurityException exception) {
        call.reject("Unable to access paired devices due to a security restriction.");

    } catch (Exception exception) {
        Log.e(TAG, "Error while retrieving paired devices", exception);
        call.reject("Unable to retrieve paired devices: " + exception.getMessage());
    }
}

@PluginMethod
public void connect(PluginCall call) {
    String address = call.getString("address");

    if (address == null || address.trim().isEmpty()) {
        call.reject("A Bluetooth MAC address is required.");
        return;
    }

    if (bluetoothAdapter == null) {
        call.reject("Bluetooth is not supported on this device.");
        return;
    }

    if (!hasBluetoothPermissions()) {
        requestPermissionForAlias(
                "bluetooth",
                call,
                "connectPermissionsCallback"
        );
        return;
    }

    executeConnect(call, address.trim().toUpperCase());
}

@PermissionCallback
private void connectPermissionsCallback(PluginCall call) {
    String address = call.getString("address");

    if (address != null && hasBluetoothPermissions()) {
        executeConnect(call, address.trim().toUpperCase());
    } else {
        call.reject("Bluetooth connection permission was denied.");
    }
}

private void executeConnect(PluginCall call, String address) {
    disconnectInternal(false);

    if (bluetoothAdapter.isDiscovering()) {
        bluetoothAdapter.cancelDiscovery();
    }

    Log.d(TAG, "Starting Bluetooth connection: " + address);

    new Thread(() -> {
        BluetoothSocket candidateSocket = null;
        Exception lastException = null;

        try {
            BluetoothDevice device =
                    bluetoothAdapter.getRemoteDevice(address);

            if (device == null) {
                call.reject("No Bluetooth device was found for address: " + address);
                return;
            }

            try {
                candidateSocket =
                        device.createRfcommSocketToServiceRecord(SPP_UUID);
                candidateSocket.connect();

            } catch (Exception exception) {
                lastException = exception;
                closeQuietly(candidateSocket);
                candidateSocket = null;
            }

            if (candidateSocket == null || !candidateSocket.isConnected()) {
                try {
                    candidateSocket =
                            device.createInsecureRfcommSocketToServiceRecord(
                                    SPP_UUID
                            );
                    candidateSocket.connect();

                } catch (Exception exception) {
                    lastException = exception;
                    closeQuietly(candidateSocket);
                    candidateSocket = null;
                }
            }

            if (candidateSocket == null || !candidateSocket.isConnected()) {
                try {
                    java.lang.reflect.Method method =
                            device.getClass().getMethod(
                                    "createRfcommSocket",
                                    int.class
                            );

                    candidateSocket =
                            (BluetoothSocket) method.invoke(device, 1);

                    if (candidateSocket != null) {
                        candidateSocket.connect();
                    }

                } catch (Exception exception) {
                    lastException = exception;
                    closeQuietly(candidateSocket);
                    candidateSocket = null;
                }
            }

            if (candidateSocket == null || !candidateSocket.isConnected()) {
                String message = lastException != null
                        ? lastException.getMessage()
                        : "RFCOMM connection failed.";

                Log.e(TAG, "Bluetooth connection failed: " + message);
                closeQuietly(candidateSocket);
                call.reject("Unable to connect to the Bluetooth device: " + message);
                return;
            }

            socket = candidateSocket;
            inputStream = candidateSocket.getInputStream();
            outputStream = candidateSocket.getOutputStream();

            disconnectEventSent.set(false);
            isConnected.set(true);

            startReadThread();

            JSObject result = new JSObject();
            result.put("connected", true);
            result.put("address", address);
            call.resolve(result);

            Log.d(TAG, "Bluetooth connection established successfully.");

        } catch (Exception exception) {
            Log.e(TAG, "Unexpected Bluetooth connection error", exception);
            closeQuietly(candidateSocket);
            disconnectInternal(false);
            call.reject("Unable to connect to the Bluetooth device: "
                    + exception.getMessage());
        }
    }, "BluetoothSpp-Connect").start();
}

private void startReadThread() {
    if (readThread != null && readThread.isAlive()) {
        return;
    }

    readThread = new Thread(() -> {
        byte[] buffer = new byte[1024];

        try {
            while (isConnected.get()) {
                InputStream stream = inputStream;

                if (stream == null) {
                    break;
                }

                int bytesRead = stream.read(buffer);

                if (bytesRead < 0) {
                    break;
                }

                if (bytesRead == 0) {
                    continue;
                }

                JSArray data = new JSArray();

                for (int index = 0; index < bytesRead; index++) {
                    data.put(buffer[index] & 0xFF);
                }

                JSObject result = new JSObject();
                result.put("data", data);
                notifyListeners("onBluetoothData", result);
            }

        } catch (Exception exception) {
            if (isConnected.get()) {
                Log.e(TAG, "Bluetooth read error", exception);
                sendDisconnectEvent("Bluetooth disconnected: "
                        + exception.getMessage());
            }

        } finally {
            if (isConnected.get()) {
                sendDisconnectEvent("Bluetooth input stream closed.");
            }

            isConnected.set(false);
        }
    }, "BluetoothSpp-Read");

    readThread.start();
}

private void sendDisconnectEvent(String message) {
    if (!disconnectEventSent.compareAndSet(false, true)) {
        return;
    }

    JSObject result = new JSObject();
    result.put(
            "error",
            message != null ? message : "Bluetooth disconnected."
    );

    notifyListeners("onBluetoothDisconnect", result);
}

@PluginMethod
public void write(PluginCall call) {
    if (!isConnected.get()) {
        call.reject("No active Bluetooth connection.");
        return;
    }

    OutputStream stream = outputStream;

    if (stream == null) {
        call.reject("Bluetooth output stream is unavailable.");
        return;
    }

    JSArray data = call.getArray("data");

    if (data == null) {
        call.reject("No data was provided.");
        return;
    }

    if (data.length() == 0) {
        call.resolve();
        return;
    }

    try {
        byte[] buffer = new byte[data.length()];

        for (int index = 0; index < data.length(); index++) {
            int value = data.getInt(index);

            if (value < 0 || value > 255) {
                call.reject("Invalid byte value at index " + index
                        + ". Values must be between 0 and 255.");
                return;
            }

            buffer[index] = (byte) value;
        }

        stream.write(buffer);
        stream.flush();
        call.resolve();

    } catch (Exception exception) {
        Log.e(TAG, "Bluetooth write error", exception);

        isConnected.set(false);
        sendDisconnectEvent("Bluetooth write failed: "
                + exception.getMessage());

        call.reject("Unable to write Bluetooth data: "
                + exception.getMessage());
    }
}

@PluginMethod
public void disconnect(PluginCall call) {
    disconnectInternal(true);
    Log.d(TAG, "Bluetooth RFCOMM connection closed.");
    call.resolve();
}

private synchronized void disconnectInternal(boolean notify) {
    boolean wasConnected = isConnected.getAndSet(false);

    if (notify && wasConnected) {
        sendDisconnectEvent("Bluetooth disconnected.");
    }

    InputStream currentInputStream = inputStream;
    OutputStream currentOutputStream = outputStream;
    BluetoothSocket currentSocket = socket;

    inputStream = null;
    outputStream = null;
    socket = null;
    readThread = null;

    closeQuietly(currentInputStream);
    closeQuietly(currentOutputStream);
    closeQuietly(currentSocket);
}

private void closeQuietly(BluetoothSocket target) {
    if (target == null) {
        return;
    }

    try {
        target.close();
    } catch (Exception ignored) {
        // Ignore cleanup failures.
    }
}

private void closeQuietly(InputStream target) {
    if (target == null) {
        return;
    }

    try {
        target.close();
    } catch (Exception ignored) {
        // Ignore cleanup failures.
    }
}

private void closeQuietly(OutputStream target) {
    if (target == null) {
        return;
    }

    try {
        target.close();
    } catch (Exception ignored) {
        // Ignore cleanup failures.
    }
}

}
