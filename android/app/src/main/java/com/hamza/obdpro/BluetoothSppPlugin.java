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
import java.lang.reflect.Method;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

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

    /**
     * Standard Bluetooth Classic SPP UUID.
     */
    private static final UUID SPP_UUID =
            UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private BluetoothAdapter bluetoothAdapter;

    /**
     * Current active connection resources.
     */
    private volatile BluetoothSocket socket;
    private volatile InputStream inputStream;
    private volatile OutputStream outputStream;

    /**
     * Current reader thread.
     */
    private volatile Thread readThread;

    /**
     * Connection lifecycle generation.
     *
     * Every new connection gets a new generation.
     * Old read/write operations are not allowed to affect a newer connection.
     */
    private final AtomicLong connectionGeneration = new AtomicLong(0);

    /**
     * Current connection state.
     */
    private final AtomicBoolean isConnected = new AtomicBoolean(false);

    /**
     * Prevent duplicate disconnect events for the same connection.
     */
    private final AtomicBoolean disconnectEventSent = new AtomicBoolean(false);

    /**
     * Synchronizes lifecycle operations such as connect/disconnect/resource replacement.
     */
    private final Object connectionLock = new Object();

    private BroadcastReceiver discoveryReceiver;
    private boolean isReceiverRegistered;

    // -------------------------------------------------------------------------
    // Capacitor lifecycle
    // -------------------------------------------------------------------------

    @Override
    public void load() {
        super.load();

        bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();

        Log.d(TAG, "Bluetooth SPP plugin initialized");
    }

    @Override
    protected void handleOnDestroy() {
        try {
            if (bluetoothAdapter != null && bluetoothAdapter.isDiscovering()) {
                bluetoothAdapter.cancelDiscovery();
            }

            unregisterDiscoveryReceiver();

            disconnectInternal(false);

        } catch (Exception exception) {
            Log.w(TAG, "Cleanup during plugin destruction failed", exception);
        }

        super.handleOnDestroy();
    }

    // -------------------------------------------------------------------------
    // Permissions
    // -------------------------------------------------------------------------

    private boolean hasBluetoothPermissions() {

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {

            return ActivityCompat.checkSelfPermission(
                    getContext(),
                    Manifest.permission.BLUETOOTH_SCAN
            ) == PackageManager.PERMISSION_GRANTED
                    &&
                    ActivityCompat.checkSelfPermission(
                            getContext(),
                            Manifest.permission.BLUETOOTH_CONNECT
                    ) == PackageManager.PERMISSION_GRANTED;
        }

        boolean bluetoothPermission =
                ActivityCompat.checkSelfPermission(
                        getContext(),
                        Manifest.permission.BLUETOOTH
                ) == PackageManager.PERMISSION_GRANTED;

        boolean bluetoothAdminPermission =
                ActivityCompat.checkSelfPermission(
                        getContext(),
                        Manifest.permission.BLUETOOTH_ADMIN
                ) == PackageManager.PERMISSION_GRANTED;

        boolean locationPermission =
                ActivityCompat.checkSelfPermission(
                        getContext(),
                        Manifest.permission.ACCESS_FINE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
                        ||
                        ActivityCompat.checkSelfPermission(
                                getContext(),
                                Manifest.permission.ACCESS_COARSE_LOCATION
                        ) == PackageManager.PERMISSION_GRANTED;

        return bluetoothPermission
                && bluetoothAdminPermission
                && locationPermission;
    }

    // -------------------------------------------------------------------------
    // Discovery
    // -------------------------------------------------------------------------

    @PluginMethod
    public void startDiscovery(PluginCall call) {

        if (bluetoothAdapter == null) {
            call.reject("Bluetooth is not supported on this device.");
            return;
        }

        if (!bluetoothAdapter.isEnabled()) {
            call.reject(
                    "Bluetooth is disabled. Please enable Bluetooth and try again."
            );
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
            call.reject(
                    "Bluetooth scan and connection permissions were denied."
            );
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

                call.reject(
                        "Unable to start Bluetooth discovery."
                );

                return;
            }

            JSObject result = new JSObject();
            result.put("started", true);

            call.resolve(result);

        } catch (SecurityException exception) {

            Log.e(
                    TAG,
                    "Security error while starting discovery",
                    exception
            );

            call.reject(
                    "Unable to start discovery due to a security restriction."
            );

        } catch (Exception exception) {

            Log.e(
                    TAG,
                    "Unexpected error while starting discovery",
                    exception
            );

            call.reject(
                    "Unable to start Bluetooth discovery: "
                            + safeMessage(exception)
            );
        }
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {

        try {

            if (bluetoothAdapter != null
                    && bluetoothAdapter.isDiscovering()) {

                bluetoothAdapter.cancelDiscovery();
            }

            unregisterDiscoveryReceiver();

            JSObject result = new JSObject();
            result.put("stopped", true);

            call.resolve(result);

        } catch (Exception exception) {

            Log.e(
                    TAG,
                    "Error while stopping Bluetooth discovery",
                    exception
            );

            call.reject(
                    "Unable to stop Bluetooth discovery: "
                            + safeMessage(exception)
            );
        }
    }

    private synchronized void registerDiscoveryReceiver() {

        if (isReceiverRegistered && discoveryReceiver != null) {
            return;
        }

        discoveryReceiver = new BroadcastReceiver() {

            @Override
            public void onReceive(
                    Context context,
                    Intent intent
            ) {

                if (intent == null) {
                    return;
                }

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
                        // Name may be unavailable without permission.
                    }

                    String deviceType = getDeviceType(device);

                    int rssi = intent.getShortExtra(
                            BluetoothDevice.EXTRA_RSSI,
                            Short.MIN_VALUE
                    );

                    JSObject deviceObject = new JSObject();

                    deviceObject.put(
                            "name",
                            name != null && !name.trim().isEmpty()
                                    ? name
                                    : "Unknown"
                    );

                    deviceObject.put(
                            "address",
                            device.getAddress()
                    );

                    deviceObject.put(
                            "bonded",
                            device.getBondState()
                                    == BluetoothDevice.BOND_BONDED
                    );

                    deviceObject.put(
                            "rssi",
                            rssi
                    );

                    deviceObject.put(
                            "type",
                            deviceType
                    );

                    notifyListeners(
                            "onBluetoothDeviceFound",
                            deviceObject
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

        filter.addAction(
                BluetoothDevice.ACTION_FOUND
        );

        filter.addAction(
                BluetoothAdapter.ACTION_DISCOVERY_STARTED
        );

        filter.addAction(
                BluetoothAdapter.ACTION_DISCOVERY_FINISHED
        );

        try {

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

        } catch (Exception exception) {

            discoveryReceiver = null;
            isReceiverRegistered = false;

            Log.e(
                    TAG,
                    "Unable to register Bluetooth discovery receiver",
                    exception
            );

            throw exception;
        }
    }

    private synchronized void unregisterDiscoveryReceiver() {

        if (!isReceiverRegistered || discoveryReceiver == null) {
            return;
        }

        try {

            getContext().unregisterReceiver(
                    discoveryReceiver
            );

        } catch (Exception exception) {

            Log.w(
                    TAG,
                    "Bluetooth discovery receiver was already unregistered",
                    exception
            );
        }

        isReceiverRegistered = false;
        discoveryReceiver = null;
    }

    private String getDeviceType(BluetoothDevice device) {

        try {

            int bluetoothType = device.getType();

            if (bluetoothType == BluetoothDevice.DEVICE_TYPE_LE) {
                return "BLE";
            }

            if (bluetoothType == BluetoothDevice.DEVICE_TYPE_DUAL) {
                return "DUAL";
            }

        } catch (Exception ignored) {
        }

        return "CLASSIC_SPP";
    }

    // -------------------------------------------------------------------------
    // Paired devices
    // -------------------------------------------------------------------------

    @PluginMethod
    public void getPairedDevices(PluginCall call) {

        if (bluetoothAdapter == null) {
            call.reject(
                    "Bluetooth is not supported on this device."
            );
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
    private void pairedDevicesPermissionsCallback(
            PluginCall call
    ) {

        if (hasBluetoothPermissions()) {

            executeGetPairedDevices(call);

        } else {

            call.reject(
                    "Bluetooth permissions were denied."
            );
        }
    }

    private void executeGetPairedDevices(
            PluginCall call
    ) {

        try {

            Set<BluetoothDevice> pairedDevices =
                    bluetoothAdapter.getBondedDevices();

            JSArray devices = new JSArray();

            if (pairedDevices != null) {

                for (BluetoothDevice device : pairedDevices) {

                    String name = null;

                    try {
                        name = device.getName();
                    } catch (SecurityException ignored) {
                    }

                    JSObject deviceObject = new JSObject();

                    deviceObject.put(
                            "name",
                            name != null && !name.trim().isEmpty()
                                    ? name
                                    : "Unknown"
                    );

                    deviceObject.put(
                            "address",
                            device.getAddress()
                    );

                    deviceObject.put(
                            "bonded",
                            true
                    );

                    deviceObject.put(
                            "type",
                            getDeviceType(device)
                    );

                    devices.put(deviceObject);
                }
            }

            JSObject result = new JSObject();

            result.put(
                    "devices",
                    devices
            );

            call.resolve(result);

        } catch (SecurityException exception) {

            call.reject(
                    "Unable to access paired devices due to a security restriction."
            );

        } catch (Exception exception) {

            Log.e(
                    TAG,
                    "Error while retrieving paired devices",
                    exception
            );

            call.reject(
                    "Unable to retrieve paired devices: "
                            + safeMessage(exception)
            );
        }
    }

    // -------------------------------------------------------------------------
    // Connect
    // -------------------------------------------------------------------------

    @PluginMethod
    public void connect(PluginCall call) {

        String address = call.getString("address");

        if (address == null || address.trim().isEmpty()) {

            call.reject(
                    "A Bluetooth MAC address is required."
            );

            return;
        }

        if (bluetoothAdapter == null) {

            call.reject(
                    "Bluetooth is not supported on this device."
            );

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

        executeConnect(
                call,
                address.trim().toUpperCase()
        );
    }

    @PermissionCallback
    private void connectPermissionsCallback(
            PluginCall call
    ) {

        String address = call.getString("address");

        if (address != null
                && !address.trim().isEmpty()
                && hasBluetoothPermissions()) {

            executeConnect(
                    call,
                    address.trim().toUpperCase()
            );

        } else {

            call.reject(
                    "Bluetooth connection permission was denied."
            );
        }
    }

    private void executeConnect(
            PluginCall call,
            String address
    ) {

        /*
         * Invalidate and close any previous connection first.
         *
         * This also invalidates every old read/write operation.
         */
        disconnectInternal(false);

        if (bluetoothAdapter.isDiscovering()) {

            try {
                bluetoothAdapter.cancelDiscovery();
            } catch (Exception ignored) {
            }
        }

        final long generation;

        synchronized (connectionLock) {

            generation =
                    connectionGeneration.incrementAndGet();

            disconnectEventSent.set(false);
        }

        Log.d(
                TAG,
                "Starting Bluetooth connection: "
                        + address
                        + " generation="
                        + generation
        );

        new Thread(
                () -> performConnection(
                        call,
                        address,
                        generation
                ),
                "BluetoothSpp-Connect"
        ).start();
    }

    private void performConnection(
            PluginCall call,
            String address,
            long generation
    ) {

        BluetoothSocket candidateSocket = null;

        Exception lastException = null;

        try {

            /*
             * Make sure this connection attempt is still current.
             */
            if (!isGenerationCurrent(generation)) {
                return;
            }

            BluetoothDevice device =
                    bluetoothAdapter.getRemoteDevice(address);

            if (device == null) {

                rejectIfCurrent(
                        call,
                        generation,
                        "No Bluetooth device was found for address: "
                                + address
                );

                return;
            }

            // -------------------------------------------------------------
            // Method 1: Secure RFCOMM with standard SPP UUID
            // -------------------------------------------------------------

            try {

                Log.d(
                        TAG,
                        "Trying secure RFCOMM SPP..."
                );

                candidateSocket =
                        device.createRfcommSocketToServiceRecord(
                                SPP_UUID
                        );

                candidateSocket.connect();

            } catch (Exception exception) {

                lastException = exception;

                Log.w(
                        TAG,
                        "Secure RFCOMM failed: "
                                + safeMessage(exception)
                );

                closeQuietly(candidateSocket);

                candidateSocket = null;
            }

            // -------------------------------------------------------------
            // Method 2: Insecure RFCOMM
            // -------------------------------------------------------------

            if (!isSocketConnected(candidateSocket)) {

                try {

                    Log.d(
                            TAG,
                            "Trying insecure RFCOMM SPP..."
                    );

                    candidateSocket =
                            device.createInsecureRfcommSocketToServiceRecord(
                                    SPP_UUID
                            );

                    candidateSocket.connect();

                } catch (Exception exception) {

                    lastException = exception;

                    Log.w(
                            TAG,
                            "Insecure RFCOMM failed: "
                                    + safeMessage(exception)
                    );

                    closeQuietly(candidateSocket);

                    candidateSocket = null;
                }
            }

            // -------------------------------------------------------------
            // Method 3: Legacy RFCOMM channel 1 fallback
            // -------------------------------------------------------------

            if (!isSocketConnected(candidateSocket)) {

                try {

                    Log.d(
                            TAG,
                            "Trying legacy RFCOMM channel 1 fallback..."
                    );

                    Method method =
                            device.getClass().getMethod(
                                    "createRfcommSocket",
                                    int.class
                            );

                    candidateSocket =
                            (BluetoothSocket) method.invoke(
                                    device,
                                    1
                            );

                    if (candidateSocket != null) {
                        candidateSocket.connect();
                    }

                } catch (Exception exception) {

                    lastException = exception;

                    Log.w(
                            TAG,
                            "Legacy RFCOMM fallback failed: "
                                    + safeMessage(exception)
                    );

                    closeQuietly(candidateSocket);

                    candidateSocket = null;
                }
            }

            // -------------------------------------------------------------
            // Verify connection
            // -------------------------------------------------------------

            if (!isSocketConnected(candidateSocket)) {

                String message =
                        lastException != null
                                ? safeMessage(lastException)
                                : "RFCOMM connection failed.";

                closeQuietly(candidateSocket);

                rejectIfCurrent(
                        call,
                        generation,
                        "Unable to connect to the Bluetooth device: "
                                + message
                );

                return;
            }

            /*
             * A newer connection may have started while connect() was
             * blocking. Do not install this socket if it is stale.
             */
            if (!isGenerationCurrent(generation)) {

                closeQuietly(candidateSocket);

                Log.d(
                        TAG,
                        "Discarding stale Bluetooth connection."
                );

                return;
            }

            InputStream newInputStream =
                    candidateSocket.getInputStream();

            OutputStream newOutputStream =
                    candidateSocket.getOutputStream();

            if (newInputStream == null
                    || newOutputStream == null) {

                closeQuietly(candidateSocket);

                rejectIfCurrent(
                        call,
                        generation,
                        "Bluetooth streams are unavailable."
                );

                return;
            }

            /*
             * Install the new resources atomically.
             */
            synchronized (connectionLock) {

                if (!isGenerationCurrent(generation)) {

                    closeQuietly(candidateSocket);

                    return;
                }

                socket = candidateSocket;

                inputStream = newInputStream;

                outputStream = newOutputStream;

                isConnected.set(true);

                disconnectEventSent.set(false);
            }

            /*
             * Start the reader using the exact InputStream belonging
             * to this connection.
             */
            startReadThread(
                    generation,
                    candidateSocket,
                    newInputStream
            );

            JSObject result = new JSObject();

            result.put(
                    "connected",
                    true
            );

            result.put(
                    "address",
                    address
            );

            call.resolve(result);

            Log.d(
                    TAG,
                    "Bluetooth connection established successfully. "
                            + "generation="
                            + generation
            );

        } catch (Exception exception) {

            Log.e(
                    TAG,
                    "Unexpected Bluetooth connection error",
                    exception
            );

            closeQuietly(candidateSocket);

            cleanupFailedConnection(
                    generation,
                    candidateSocket
            );

            rejectIfCurrent(
                    call,
                    generation,
                    "Unable to connect to the Bluetooth device: "
                            + safeMessage(exception)
            );
        }
    }

    // -------------------------------------------------------------------------
    // Reader
    // -------------------------------------------------------------------------

    private void startReadThread(
            final long generation,
            final BluetoothSocket connectionSocket,
            final InputStream connectionInputStream
    ) {

        Thread existingThread = readThread;

        if (existingThread != null
                && existingThread.isAlive()
                && isGenerationCurrent(generation)) {

            Log.w(
                    TAG,
                    "A reader thread is already active for current generation."
            );

            return;
        }

        Thread newReadThread =
                new Thread(
                        () -> readLoop(
                                generation,
                                connectionSocket,
                                connectionInputStream
                        ),
                        "BluetoothSpp-Read-" + generation
                );

        synchronized (connectionLock) {

            if (!isGenerationCurrent(generation)
                    || !isConnected.get()) {

                return;
            }

            readThread = newReadThread;
        }

        newReadThread.start();
    }

    private void readLoop(
            final long generation,
            final BluetoothSocket connectionSocket,
            final InputStream connectionInputStream
    ) {

        byte[] buffer = new byte[1024];

        try {

            while (true) {

                /*
                 * Stop immediately if this reader belongs to an old
                 * connection.
                 */
                if (!isGenerationCurrent(generation)
                        || !isConnected.get()) {

                    break;
                }

                int bytesRead =
                        connectionInputStream.read(buffer);

                if (bytesRead < 0) {

                    handleReaderDisconnect(
                            generation,
                            connectionSocket,
                            "Bluetooth input stream closed."
                    );

                    break;
                }

                if (bytesRead == 0) {
                    continue;
                }

                /*
                 * Verify again before delivering data.
                 *
                 * This prevents stale data from a previous connection
                 * reaching JavaScript after a reconnect.
                 */
                if (!isGenerationCurrent(generation)
                        || !isConnected.get()) {

                    break;
                }

                JSArray data = new JSArray();

                for (int index = 0; index < bytesRead; index++) {

                    /*
                     * & 0xFF is essential:
                     * Java byte is signed, JavaScript expects 0..255.
                     */
                    data.put(
                            buffer[index] & 0xFF
                    );
                }

                JSObject result = new JSObject();

                result.put(
                        "data",
                        data
                );

                notifyListeners(
                        "onBluetoothData",
                        result
                );
            }

        } catch (Exception exception) {

            /*
             * Socket closure during a deliberate disconnect is normal.
             */
            if (isGenerationCurrent(generation)
                    && isConnected.get()) {

                Log.e(
                        TAG,
                        "Bluetooth read error",
                        exception
                );

                handleReaderDisconnect(
                        generation,
                        connectionSocket,
                        "Bluetooth disconnected: "
                                + safeMessage(exception)
                );
            }

        } finally {

            /*
             * Never modify the state of a newer connection.
             */
            synchronized (connectionLock) {

                if (connectionGeneration.get() == generation
                        && readThread == Thread.currentThread()) {

                    readThread = null;
                }
            }
        }
    }

    private void handleReaderDisconnect(
            long generation,
            BluetoothSocket connectionSocket,
            String message
    ) {

        synchronized (connectionLock) {

            if (!isGenerationCurrent(generation)) {
                return;
            }

            if (!isConnected.get()) {
                return;
            }

            isConnected.set(false);

            closeQuietly(
                    connectionSocket
            );

            if (socket == connectionSocket) {
                socket = null;
                inputStream = null;
                outputStream = null;
            }
        }

        sendDisconnectEvent(
                message
        );
    }

    // -------------------------------------------------------------------------
    // Write
    // -------------------------------------------------------------------------

    @PluginMethod
    public void write(PluginCall call) {

        JSArray data = call.getArray("data");

        if (data == null) {

            call.reject(
                    "No data was provided."
            );

            return;
        }

        if (data.length() == 0) {

            call.resolve();

            return;
        }

        final long generation;
        final OutputStream stream;

        synchronized (connectionLock) {

            if (!isConnected.get()) {

                call.reject(
                        "No active Bluetooth connection."
                );

                return;
            }

            stream = outputStream;

            generation =
                    connectionGeneration.get();
        }

        if (stream == null) {

            call.reject(
                    "Bluetooth output stream is unavailable."
            );

            return;
        }

        byte[] buffer;

        try {

            buffer = new byte[data.length()];

            for (
                    int index = 0;
                    index < data.length();
                    index++
            ) {

                int value =
                        data.getInt(index);

                if (value < 0 || value > 255) {

                    call.reject(
                            "Invalid byte value at index "
                                    + index
                                    + ". Values must be between 0 and 255."
                    );

                    return;
                }

                buffer[index] =
                        (byte) value;
            }

        } catch (Exception exception) {

            call.reject(
                    "Invalid Bluetooth data: "
                            + safeMessage(exception)
            );

            return;
        }

        try {

            /*
             * The connection may have changed while the JSArray was
             * being converted.
             */
            if (!isGenerationCurrent(generation)
                    || !isConnected.get()) {

                call.reject(
                        "Bluetooth connection changed before write."
                );

                return;
            }

            synchronized (stream) {

                if (!isGenerationCurrent(generation)
                        || !isConnected.get()) {

                    call.reject(
                            "Bluetooth connection changed before write."
                    );

                    return;
                }

                stream.write(buffer);
                stream.flush();
            }

            call.resolve();

        } catch (Exception exception) {

            Log.e(
                    TAG,
                    "Bluetooth write error",
                    exception
            );

            /*
             * Only the connection that actually failed may be marked
             * disconnected.
             */
            handleWriteFailure(
                    generation,
                    stream,
                    "Bluetooth write failed: "
                            + safeMessage(exception)
            );

            call.reject(
                    "Unable to write Bluetooth data: "
                            + safeMessage(exception)
            );
        }
    }

    private void handleWriteFailure(
            long generation,
            OutputStream failedStream,
            String message
    ) {

        synchronized (connectionLock) {

            if (!isGenerationCurrent(generation)) {
                return;
            }

            if (outputStream != failedStream) {
                return;
            }

            isConnected.set(false);

            closeQuietly(inputStream);
            closeQuietly(outputStream);
            closeQuietly(socket);

            inputStream = null;
            outputStream = null;
            socket = null;
        }

        sendDisconnectEvent(
                message
        );
    }

    // -------------------------------------------------------------------------
    // Disconnect
    // -------------------------------------------------------------------------

    @PluginMethod
    public void disconnect(PluginCall call) {

        disconnectInternal(true);

        Log.d(
                TAG,
                "Bluetooth RFCOMM connection closed."
        );

        call.resolve();
    }

    /**
     * Fully invalidates the current connection.
     *
     * The generation is incremented before closing resources, so any old
     * reader/writer immediately becomes stale and can no longer affect
     * a future connection.
     */
    private void disconnectInternal(
            boolean notify
    ) {

        BluetoothSocket oldSocket;
        InputStream oldInputStream;
        OutputStream oldOutputStream;
        Thread oldReadThread;

        boolean wasConnected;

        synchronized (connectionLock) {

            /*
             * Invalidate old operations FIRST.
             */
            connectionGeneration.incrementAndGet();

            wasConnected =
                    isConnected.getAndSet(false);

            oldSocket = socket;
            oldInputStream = inputStream;
            oldOutputStream = outputStream;
            oldReadThread = readThread;

            socket = null;
            inputStream = null;
            outputStream = null;
            readThread = null;

            if (notify && wasConnected) {

                sendDisconnectEvent(
                        "Bluetooth disconnected."
                );
            }

            /*
             * Reset for the next connection.
             */
            disconnectEventSent.set(false);
        }

        /*
         * Close outside the lock so slow Bluetooth cleanup does not
         * block another lifecycle operation.
         */
        closeQuietly(oldInputStream);
        closeQuietly(oldOutputStream);
        closeQuietly(oldSocket);

        /*
         * Do NOT interrupt aggressively.
         *
         * Closing the InputStream/Socket above releases read().
         */
        if (oldReadThread != null
                && oldReadThread != Thread.currentThread()
                && oldReadThread.isAlive()) {

            try {
                oldReadThread.join(150);
            } catch (InterruptedException exception) {

                Thread.currentThread().interrupt();
            }
        }
    }

    private void cleanupFailedConnection(
            long generation,
            BluetoothSocket failedSocket
    ) {

        synchronized (connectionLock) {

            if (!isGenerationCurrent(generation)) {
                return;
            }

            if (socket == failedSocket) {

                isConnected.set(false);

                socket = null;
                inputStream = null;
                outputStream = null;
                readThread = null;
            }
        }

        closeQuietly(
                failedSocket
        );
    }

    // -------------------------------------------------------------------------
    // Disconnect event
    // -------------------------------------------------------------------------

    private void sendDisconnectEvent(
            String message
    ) {

        /*
         * Only one disconnect event per active connection.
         */
        if (!disconnectEventSent.compareAndSet(
                false,
                true
        )) {

            return;
        }

        JSObject result = new JSObject();

        result.put(
                "error",
                message != null
                        ? message
                        : "Bluetooth disconnected."
        );

        notifyListeners(
                "onBluetoothDisconnect",
                result
        );
    }

    // -------------------------------------------------------------------------
    // Connection state helpers
    // -------------------------------------------------------------------------

    private boolean isGenerationCurrent(
            long generation
    ) {

        return connectionGeneration.get()
                == generation;
    }

    private boolean isSocketConnected(
            BluetoothSocket target
    ) {

        try {

            return target != null
                    && target.isConnected();

        } catch (Exception ignored) {

            return false;
        }
    }

    private void rejectIfCurrent(
            PluginCall call,
            long generation,
            String message
    ) {

        if (isGenerationCurrent(generation)) {
            call.reject(message);
        }
    }

    // -------------------------------------------------------------------------
    // Resource cleanup
    // -------------------------------------------------------------------------

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

    private String safeMessage(
            Exception exception
    ) {

        if (exception == null) {
            return "Unknown error";
        }

        String message =
                exception.getMessage();

        if (message == null
                || message.trim().isEmpty()) {

            return exception.getClass().getSimpleName();
        }

        return message;
    }
}
