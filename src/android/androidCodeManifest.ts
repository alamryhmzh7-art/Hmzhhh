/**
 * Complete Android Native (Kotlin + Jetpack Compose) Architecture Manifest
 * Ready for Gradle compilation into a production Android APK.
 */

export interface AndroidCodeFile {
  path: string;
  category: 'core' | 'network' | 'diagnostic' | 'ui' | 'viewmodel' | 'gradle' | 'res';
  description: string;
  descriptionAr: string;
  code: string;
}

export const ANDROID_PROJECT_FILES: AndroidCodeFile[] = [
  {
    path: 'app/src/main/AndroidManifest.xml',
    category: 'core',
    description: 'Android Manifest with Wi-Fi, Bluetooth Classic SPP & Network permissions',
    descriptionAr: 'ملف بيان التطبيق وتصاريح شبكة الواي فاي والبلوتوث الكلاسيكي SPP',
    code: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools"
    package="com.hamza.obdpro">

    <!-- Permissions for ESP32 Wi-Fi Socket communication -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />
    <uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />
    <uses-permission android:name="android.permission.NEARBY_WIFI_DEVICES" android:usesPermissionFlags="neverForLocation" />

    <!-- Permissions for ESP32 Bluetooth Classic SPP communication -->
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" android:maxSdkVersion="30" />

    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />

    <application
        android:name=".HamzaObdApplication"
        android:allowBackup="true"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:fullBackupContent="@xml/backup_rules"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.HamzaObdPro"
        android:usesCleartextTraffic="true"
        tools:targetApi="34">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:label="@string/app_name"
            android:screenOrientation="portrait"
            android:theme="@style/Theme.HamzaObdPro">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <service
            android:name=".network.DiagnosticService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="connectedDevice" />
    </application>
</manifest>`
  },
  {
    path: 'app/src/main/java/com/hamza/obdpro/network/Transport.kt',
    category: 'network',
    description: 'Kotlin Unified Diagnostic Transport Interface for Dual-Transport',
    descriptionAr: 'واجهة الاتصال الموحدة لدعم Wi-Fi TCP و Bluetooth Classic SPP في Kotlin',
    code: `package com.hamza.obdpro.network

import kotlinx.coroutines.flow.StateFlow

enum class TransportType {
    WIFI_TCP,
    BLUETOOTH_SPP
}

enum class ConnectionStatus {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    ERROR
}

data class BluetoothDeviceInfo(
    val name: String,
    val address: String,
    val isBonded: Boolean
)

interface ITransport {
    val type: TransportType
    val connectionState: StateFlow<ConnectionStatus>
    fun isConnected(): Boolean
    suspend fun connect(): Boolean
    suspend fun disconnect()
    suspend fun sendRaw(bytes: ByteArray): Boolean
    suspend fun sendCanFrame(canId: Long, data: ByteArray, isExtended: Boolean = false): Boolean
    suspend fun ping(): Long
}`
  },
  {
    path: 'app/src/main/java/com/hamza/obdpro/network/BluetoothSppTransport.kt',
    category: 'network',
    description: 'Kotlin Bluetooth Classic RFCOMM SPP implementation for ESP32 with robust diagnostics and detailed error logging',
    descriptionAr: 'تنفيذ اتصال البلوتوث الكلاسيكي SPP RFCOMM المحدث مع تشخيص الأخطاء المفصل وتسجيل المراحل',
    code: `package com.hamza.obdpro.network

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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
            val err = "SecurityException: Missing required Bluetooth permissions (BLUETOOTH_CONNECT / BLUETOOTH_SCAN) on Android 12+"
            Log.e(TAG, err)
            _connectionState.value = ConnectionStatus.ERROR
            return@withContext false
        }

        val adapter = BluetoothAdapter.getDefaultAdapter()
        if (adapter == null) {
            val err = "DeviceError: BluetoothAdapter is null (device does not support Bluetooth)"
            Log.e(TAG, err)
            _connectionState.value = ConnectionStatus.ERROR
            return@withContext false
        }

        if (!adapter.isEnabled) {
            val err = "DeviceError: Bluetooth adapter is disabled by user"
            Log.e(TAG, err)
            _connectionState.value = ConnectionStatus.ERROR
            return@withContext false
        }

        var currentStage = "Device Discovery"
        try {
            Log.i(TAG, "=== STAGE 2: Device Discovery (Target MAC: $targetMacAddress, Target Name: $targetDeviceName) ===")
            
            // Cancel discovery to improve connection speed and reliability
            adapter.cancelDiscovery()

            // Close any existing stale socket
            try {
                bluetoothSocket?.close()
            } catch (e: Exception) {
                Log.w(TAG, "Warning closing stale socket: \${e.message}")
            }
            bluetoothSocket = null

            val device: BluetoothDevice? = if (!targetMacAddress.isNullOrBlank()) {
                Log.i(TAG, "Using provided MAC address directly: $targetMacAddress")
                adapter.getRemoteDevice(targetMacAddress)
            } else {
                Log.i(TAG, "Searching paired devices for name: $targetDeviceName")
                val bonded = adapter.bondedDevices ?: emptySet()
                Log.i(TAG, "Total bonded devices found: \${bonded.size}")
                for (d in bonded) {
                    Log.i(TAG, "Bonded device -> Name: \${d.name}, MAC: \${d.address}")
                }
                // Try exact match first, then partial match, then fallback to first available OBD device
                bonded.find { it.name.equals(targetDeviceName, ignoreCase = true) }
                    ?: bonded.find { it.name?.contains("OBD", ignoreCase = true) == true }
                    ?: bonded.firstOrNull()
            }

            if (device == null) {
                val err = "DeviceDiscoveryError: Target device '$targetDeviceName' not found among bonded devices and no MAC provided."
                Log.e(TAG, err)
                _connectionState.value = ConnectionStatus.ERROR
                return@withContext false
            }

            Log.i(TAG, "Selected device for connection -> Name: \${device.name}, MAC: \${device.address}")

            currentStage = "Socket Creation"
            Log.i(TAG, "=== STAGE 3: Socket Creation using RFCOMM SPP UUID: $SPP_UUID ===")
            val socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
            bluetoothSocket = socket

            currentStage = "socket.connect()"
            Log.i(TAG, "=== STAGE 4: Executing socket.connect() (Blocking RFCOMM handshake) ===")
            socket.connect()
            Log.i(TAG, "Socket connect successful!")

            currentStage = "Stream Initialization"
            Log.i(TAG, "=== STAGE 5: Initializing Input & Output Streams ===")
            inputStream = socket.inputStream
            outputStream = socket.outputStream

            _connectionState.value = ConnectionStatus.CONNECTED
            Log.i(TAG, "=== Bluetooth SPP Connection Established Successfully ===")
            startListenLoop()
            true

        } catch (e: Exception) {
            val errorDetails = buildString {
                append("Failed at stage: [$currentStage]\\n")
                append("Exception Class: \${e.javaClass.name}\\n")
                append("Message: \${e.message}\\n")
                append("Stack Trace:\\n")
                e.stackTrace.take(15).forEach { ste -> append("  at \${ste}\\n") }
            }
            Log.e(TAG, errorDetails, e)
            _connectionState.value = ConnectionStatus.ERROR
            disconnect()
            false
        }
    }

    override suspend fun disconnect() = withContext(Dispatchers.IO) {
        Log.i(TAG, "Disconnecting Bluetooth SPP transport...")
        try {
            inputStream?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing inputStream: \${e.message}")
        }
        try {
            outputStream?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing outputStream: \${e.message}")
        }
        try {
            bluetoothSocket?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing bluetoothSocket: \${e.message}")
        }
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
            Log.e(TAG, "Error writing to Bluetooth output stream: \${e.message}", e)
            _connectionState.value = ConnectionStatus.ERROR
            disconnect()
            false
        }
    }

    override suspend fun sendCanFrame(canId: Long, data: ByteArray, isExtended: Boolean): Boolean {
        // Binary Protocol framing AA 55 + CMD + LEN + PAYLOAD + CHECKSUM + CRLF
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
                        // Received bytes from ESP32 Bluetooth SPP
                        // Binary protocol packets or responses can be parsed here
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error in Bluetooth listen loop: \${e.message}", e)
                    break
                }
            }
            if (_connectionState.value == ConnectionStatus.CONNECTED) {
                disconnect()
            }
        }
    }
}
`
  },
  {
    path: 'app/build.gradle.kts',
    category: 'gradle',
    description: 'Gradle configuration with Jetpack Compose, Coroutines & Material 3',
    descriptionAr: 'ملف بناء Gradle متضمنًا Jetpack Compose ومكتبات Coroutines وMaterial 3',
    code: `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.hamza.obdpro"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.hamza.obdpro"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "2.5.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.navigation.compose)
    
    // Coroutines & StateFlow
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")
    
    // Lifecycle & ViewModel
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.0")

    // Testing
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}`
  },
  {
    path: 'app/src/main/java/com/hamza/obdpro/network/TcpClient.kt',
    category: 'network',
    description: 'Kotlin Coroutine-based Non-blocking TCP Socket Client for ESP32',
    descriptionAr: 'عميل TCP Socket غير حاجب مبني على Coroutines للاتصال بـ ESP32',
    code: `package com.hamza.obdpro.network

import com.hamza.obdpro.logging.AppLogger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException

enum class ConnectionStatus {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    ERROR
}

data class ConnectionConfig(
    val ip: String = "192.168.4.1",
    val port: Int = 35000,
    val connectionTimeoutMs: Int = 5000,
    val responseTimeoutMs: Int = 3000
)

class TcpClient(
    private var config: ConnectionConfig = ConnectionConfig(),
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
) {
    private var socket: Socket? = null
    private var inputStream: InputStream? = null
    private var outputStream: OutputStream? = null

    private val _connectionState = MutableStateFlow(ConnectionStatus.DISCONNECTED)
    val connectionState: StateFlow<ConnectionStatus> = _connectionState.asStateFlow()

    suspend fun connect(): Boolean = withContext(Dispatchers.IO) {
        if (_connectionState.value == ConnectionStatus.CONNECTED) return@withContext true
        _connectionState.value = ConnectionStatus.CONNECTING

        try {
            socket = Socket().apply {
                soTimeout = config.responseTimeoutMs
                connect(InetSocketAddress(config.ip, config.port), config.connectionTimeoutMs)
            }
            inputStream = socket?.getInputStream()
            outputStream = socket?.getOutputStream()

            _connectionState.value = ConnectionStatus.CONNECTED
            AppLogger.info("NETWORK", "Connect", "Connected to ESP32 at \${config.ip}:\${config.port}")
            true
        } catch (e: Exception) {
            _connectionState.value = ConnectionStatus.ERROR
            AppLogger.error("NETWORK", "ConnectFailed", "TCP connection failed: \${e.message}", e)
            disconnect()
            false
        }
    }

    suspend fun sendRequest(requestBytes: ByteArray): ByteArray? = withContext(Dispatchers.IO) {
        if (_connectionState.value != ConnectionStatus.CONNECTED) {
            AppLogger.warn("NETWORK", "Send", "Cannot send request: device is disconnected")
            return@withContext null
        }

        try {
            outputStream?.write(requestBytes)
            outputStream?.flush()

            val buffer = ByteArray(256)
            val bytesRead = inputStream?.read(buffer) ?: -1
            if (bytesRead > 0) {
                buffer.copyOf(bytesRead)
            } else {
                null
            }
        } catch (e: SocketTimeoutException) {
            AppLogger.error("NETWORK", "Timeout", "Response timeout from ESP32", e)
            null
        } catch (e: Exception) {
            AppLogger.error("NETWORK", "SendError", "Error exchanging packets: \${e.message}", e)
            disconnect()
            null
        }
    }

    fun disconnect() {
        try {
            inputStream?.close()
            outputStream?.close()
            socket?.close()
        } catch (_: Exception) {}
        socket = null
        inputStream = null
        outputStream = null
        _connectionState.value = ConnectionStatus.DISCONNECTED
    }
}`
  },
  {
    path: 'app/src/main/java/com/hamza/obdpro/isotp/IsoTpProtocol.kt',
    category: 'diagnostic',
    description: 'Kotlin ISO-TP (ISO 15765-2) Multi-frame segmentation & reassembly',
    descriptionAr: 'طبقة معالجة بروتوكول ISO-TP وتجميع الإطارات المتعددة في Kotlin',
    code: `package com.hamza.obdpro.isotp

class IsoTpProtocol {
    companion object {
        const val PCI_SINGLE_FRAME = 0x00
        const val PCI_FIRST_FRAME = 0x10
        const val PCI_CONSECUTIVE_FRAME = 0x20
        const val PCI_FLOW_CONTROL = 0x30

        fun encodePayload(payload: ByteArray): List<ByteArray> {
            val len = payload.size
            if (len <= 7) {
                // Single Frame (SF)
                val frame = ByteArray(8)
                frame[0] = (PCI_SINGLE_FRAME or (len and 0x0F)).toByte()
                System.arraycopy(payload, 0, frame, 1, len)
                return listOf(frame)
            }

            val frames = mutableListOf<ByteArray>()
            // First Frame (FF)
            val ff = ByteArray(8)
            ff[0] = (PCI_FIRST_FRAME or ((len shr 8) and 0x0F)).toByte()
            ff[1] = (len and 0xFF).toByte()
            System.arraycopy(payload, 0, ff, 2, 6)
            frames.add(ff)

            // Consecutive Frames (CF)
            var sequence = 1
            var offset = 6
            while (offset < len) {
                val cf = ByteArray(8)
                cf[0] = (PCI_CONSECUTIVE_FRAME or (sequence and 0x0F)).toByte()
                val chunk = Math.min(7, len - offset)
                System.arraycopy(payload, offset, cf, 1, chunk)
                frames.add(cf)
                offset += chunk
                sequence = (sequence + 1) and 0x0F
            }
            return frames
        }
    }
}`
  },
  {
    path: 'app/src/main/java/com/hamza/obdpro/obd/ObdPidDecoder.kt',
    category: 'diagnostic',
    description: 'Kotlin OBD-II PID decoder for RPM, Speed, Voltage, Coolant, Load, Fuel Trim',
    descriptionAr: 'مفكك ترميز حساسات OBD-II القياسية في لغة Kotlin',
    code: `package com.hamza.obdpro.obd

data class ObdPidResult(
    val pidHex: String,
    val nameEn: String,
    val nameAr: String,
    val value: Float,
    val unit: String
)

object ObdPidDecoder {
    fun decode(pidHex: String, data: ByteArray): ObdPidResult? {
        if (data.isEmpty()) return null
        return when (pidHex.uppercase()) {
            "0C" -> { // Engine RPM
                if (data.size < 2) return null
                val a = data[0].toInt() and 0xFF
                val b = data[1].toInt() and 0xFF
                val rpm = ((a * 256) + b) / 4f
                ObdPidResult("0C", "Engine RPM", "سرعة دوران المحرك", rpm, "RPM")
            }
            "0D" -> { // Vehicle Speed
                val speed = (data[0].toInt() and 0xFF).toFloat()
                ObdPidResult("0D", "Vehicle Speed", "سرعة المركبة", speed, "km/h")
            }
            "05" -> { // Coolant Temperature
                val temp = (data[0].toInt() and 0xFF) - 40f
                ObdPidResult("05", "Coolant Temp", "حرارة سائل التبريد", temp, "°C")
            }
            "11" -> { // Throttle Position
                val tps = ((data[0].toInt() and 0xFF) * 100) / 255f
                ObdPidResult("11", "Throttle Position", "موضع الخانق", tps, "%")
            }
            "42" -> { // Control Module Voltage
                if (data.size < 2) return null
                val a = data[0].toInt() and 0xFF
                val b = data[1].toInt() and 0xFF
                val v = ((a * 256) + b) / 1000f
                ObdPidResult("42", "ECU Voltage", "جهد وحدة التحكم", v, "V")
            }
            else -> null
        }
    }
}`
  },
  {
    path: 'app/src/main/res/values/strings.xml',
    category: 'res',
    description: 'English Strings Resource',
    descriptionAr: 'ملف الموارد والنصوص الإنجليزية',
    code: `<resources>
    <string name="app_name">HAMZA OBD PRO</string>
    <string name="dashboard">Dashboard</string>
    <string name="live_data">Live Data</string>
    <string name="dtc_codes">DTC Trouble Codes</string>
    <string name="ecu_scan">ECU Scan</string>
    <string name="connected">CONNECTED</string>
    <string name="disconnected">DISCONNECTED</string>
    <string name="connecting">CONNECTING...</string>
    <string name="btn_connect">Connect</string>
    <string name="btn_scan">Full Scan</string>
    <string name="btn_clear_dtc">Clear Codes</string>
</resources>`
  },
  {
    path: 'app/src/main/res/values-ar/strings.xml',
    category: 'res',
    description: 'Arabic Strings Resource with RTL compatibility',
    descriptionAr: 'ملف الموارد والنصوص العربية مع دعم تخطيط RTL',
    code: `<resources>
    <string name="app_name">HAMZA OBD PRO</string>
    <string name="dashboard">الرئيسية</string>
    <string name="live_data">البيانات الحية</string>
    <string name="dtc_codes">رموز الأعطال DTC</string>
    <string name="ecu_scan">فحص وحدات ECU</string>
    <string name="connected">متصل</string>
    <string name="disconnected">غير متصل</string>
    <string name="connecting">جارٍ الاتصال...</string>
    <string name="btn_connect">اتصال</string>
    <string name="btn_scan">فحص شامل</string>
    <string name="btn_clear_dtc">مسح الأعطال</string>
</resources>`
  }
];
