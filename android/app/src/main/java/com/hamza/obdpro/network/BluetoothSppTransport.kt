package com.hamza.obdpro.network

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID

class BluetoothSppTransport(
    private val context: Context,
    private val targetDeviceName: String = "ESP32-OBD-PRO",
    private val targetMacAddress: String? = null,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
) : ITransport {

    override val type: TransportType = TransportType.BLUETOOTH_SPP

    private val _connectionState = MutableStateFlow(ConnectionStatus.DISCONNECTED)
    override val connectionState: StateFlow<ConnectionStatus> = _connectionState.asStateFlow()

    private val _incomingData = MutableSharedFlow<ByteArray>(replay = 0, extraBufferCapacity = 64)
    val incomingData: SharedFlow<ByteArray> = _incomingData.asSharedFlow()

    private var bluetoothSocket: BluetoothSocket? = null
    private var inputStream: InputStream? = null
    private var outputStream: OutputStream? = null

    companion object {
        private const val TAG = "BluetoothSppTransport"
        val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }

    override fun isConnected(): Boolean = _connectionState.value == ConnectionStatus.CONNECTED

    private fun hasRequiredPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
                    ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    override suspend fun connect(): Boolean = withContext(Dispatchers.IO) {
        if (isConnected()) {
            Log.i(TAG, "Already connected to Bluetooth SPP device.")
            return@withContext true
        }

        _connectionState.value = ConnectionStatus.CONNECTING
        Log.i(TAG, "=== STAGE 1: Pre-connection checks & permissions ===")

        if (!hasRequiredPermissions()) {
            val err = "SecurityException: Missing required Bluetooth permissions on Android 12+"
            Log.e(TAG, err)
            _connectionState.value = ConnectionStatus.ERROR
            return@withContext false
        }

        val adapter = BluetoothAdapter.getDefaultAdapter()
        if (adapter == null || !adapter.isEnabled) {
            val err = "DeviceError: Bluetooth adapter is null or disabled."
            Log.e(TAG, err)
            _connectionState.value = ConnectionStatus.ERROR
            return@withContext false
        }

        var currentStage = "Device Discovery"
        try {
            Log.i(TAG, "=== STAGE 2: Device Discovery (Target: $targetDeviceName / $targetMacAddress) ===")
            adapter.cancelDiscovery()

            try { bluetoothSocket?.close() } catch (e: Exception) { }
            bluetoothSocket = null

            val device: BluetoothDevice? = if (!targetMacAddress.isNullOrBlank()) {
                Log.i(TAG, "Using provided MAC address directly: $targetMacAddress")
                adapter.getRemoteDevice(targetMacAddress)
            } else {
                Log.i(TAG, "Searching bonded devices for name: $targetDeviceName")
                val bonded = adapter.bondedDevices ?: emptySet()
                bonded.find { it.name.equals(targetDeviceName, ignoreCase = true) }
                    ?: bonded.find { it.name?.contains("OBD", ignoreCase = true) == true }
                    ?: bonded.firstOrNull()
            }

            if (device == null) {
                val err = "DeviceDiscoveryError: Target device '$targetDeviceName' not found among bonded devices."
                Log.e(TAG, err)
                _connectionState.value = ConnectionStatus.ERROR
                return@withContext false
            }

            Log.i(TAG, "Selected device -> Name: ${device.name}, MAC: ${device.address}")

            currentStage = "Socket Creation & Connection with Fallback"
            Log.i(TAG, "=== STAGE 3 & 4: Establishing RFCOMM Socket with ESP32 Fallback ===")

            val tmpSocket: BluetoothSocket? = try {
                device.createRfcommSocketToServiceRecord(SPP_UUID)
            } catch (e: Exception) {
                device.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
            }
            bluetoothSocket = tmpSocket

            try {
                bluetoothSocket?.connect()
            } catch (e: IOException) {
                Log.w(TAG, "Standard connect failed, attempting Reflection fallback for ESP32...")
                val m = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
                bluetoothSocket = m.invoke(device, 1) as BluetoothSocket
                adapter.cancelDiscovery()
                bluetoothSocket?.connect()
            }

            Log.i(TAG, "Socket connect successful!")

            currentStage = "Stream Initialization"
            Log.i(TAG, "=== STAGE 5: Initializing Input & Output Streams ===")
            inputStream = bluetoothSocket?.inputStream
            outputStream = bluetoothSocket?.outputStream

            _connectionState.value = ConnectionStatus.CONNECTED
            Log.i(TAG, "=== Bluetooth SPP Connection Established Successfully ===")
            startListenLoop()
            true

        } catch (e: Exception) {
            val errorDetails = buildString {
                append("Failed at stage: [$currentStage]\n")
                append("Exception Class: ${e.javaClass.name}\n")
                append("Message: ${e.message}\n")
            }
            Log.e(TAG, errorDetails, e)
            _connectionState.value = ConnectionStatus.ERROR
            disconnect()
            false
        }
    }

    override suspend fun disconnect() = withContext(Dispatchers.IO) {
        Log.i(TAG, "Disconnecting Bluetooth SPP transport...")
        try { inputStream?.close() } catch (e: Exception) { }
        try { outputStream?.close() } catch (e: Exception) { }
        try { bluetoothSocket?.close() } catch (e: Exception) { }

        inputStream = null
        outputStream = null
        bluetoothSocket = null
        _connectionState.value = ConnectionStatus.DISCONNECTED
        Log.i(TAG, "Bluetooth SPP disconnected successfully.")
    }

    override suspend fun sendRaw(bytes: ByteArray): Boolean = withContext(Dispatchers.IO) {
        if (!isConnected()) {
            Log.w(TAG, "Cannot send raw bytes: Not connected")
            return@withContext false
        }
        try {
            outputStream?.write(bytes)
            outputStream?.flush()
            true
        } catch (e: Exception) {
            Log.e(TAG, "Error writing to Bluetooth output stream: ${e.message}", e)
            _connectionState.value = ConnectionStatus.ERROR
            disconnect()
            false
        }
    }

    override suspend fun sendCanFrame(canId: Long, data: ByteArray, isExtended: Boolean): Boolean {
        val payload = ByteArray(6 + data.size)
        payload[0] = ((canId shr 24) and 0xFF).toByte()
        payload[1] = ((canId shr 16) and 0xFF).toByte()
        payload[2] = ((canId shr 8) and 0xFF).toByte()
        payload[3] = (canId and 0xFF).toByte()
        payload[4] = (if (isExtended) 0x01 else 0x00).toByte()
        payload[5] = data.size.toByte()
        System.arraycopy(data, 0, payload, 6, data.size)
        val frame = wrapBinaryPacket(0x01.toByte(), payload)
        return sendRaw(frame)
    }

    override suspend fun ping(): Long = withContext(Dispatchers.IO) {
        val start = System.currentTimeMillis()
        val pingPkt = wrapBinaryPacket(0x02.toByte(), ByteArray(0))
        val ok = sendRaw(pingPkt)
        if (ok) System.currentTimeMillis() - start else -1L
    }

    private fun wrapBinaryPacket(cmd: Byte, payload: ByteArray): ByteArray {
        val len = payload.size
        val packet = ByteArray(8 + len)
        packet[0] = 0xAA.toByte()
        packet[1] = 0x55.toByte()
        packet[2] = cmd
        packet[3] = ((len shr 8) and 0xFF).toByte()
        packet[4] = (len and 0xFF).toByte()
        System.arraycopy(payload, 0, packet, 5, len)
        var cs = cmd.toInt() xor ((len shr 8) and 0xFF) xor (len and 0xFF)
        for (b in payload) cs = cs xor b.toInt()
        packet[5 + len] = (cs and 0xFF).toByte()
        packet[5 + len + 1] = 0x0D.toByte()
        packet[5 + len + 2] = 0x0A.toByte()
        return packet
    }

    private fun startListenLoop() {
        scope.launch {
            val buf = ByteArray(1024)
            while (isActive && isConnected()) {
                try {
                    val count = inputStream?.read(buf) ?: -1
                    if (count == -1) {
                        Log.w(TAG, "Read stream reached EOF (-1). Disconnecting...")
                        break
                    }
                    if (count > 0) {
                        val packet = buf.copyOfRange(0, count)
                        _incomingData.emit(packet)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error in Bluetooth listen loop: ${e.message}", e)
                    break
                }
            }
            if (_connectionState.value == ConnectionStatus.CONNECTED) {
                disconnect()
            }
        }
    }
}
