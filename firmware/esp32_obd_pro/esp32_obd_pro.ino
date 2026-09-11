/*
 * ============================================================================
 * HAMZA OBD PRO - ESP32 Dual-Transport (Wi-Fi TCP + Bluetooth Classic SPP)
 * ============================================================================
 * Features:
 *  - Native TWAI (Two-Wire Automotive Interface / CAN 2.0B) @ 500kbps
 *  - CAN TX: GPIO22 | CAN RX: GPIO21 (ISO 15765-4 Standard)
 *  - Bluetooth Classic SPP (BluetoothSerial: "ESP32-OBD-PRO")
 *  - Wi-Fi Access Point ("ESP32-OBD-PRO", 192.168.4.1) + TCP Server (Port 35000)
 *  - Unified HAMZA OBD Binary Framing Protocol (Magic: 0xAA 0x55)
 *  - Ultra-low memory footprint with zero-heap-fragmentation ring buffers
 *  - Real-time CAN RX interrupt forwarding to active transport
 *  - Automatic TWAI Bus-Off recovery
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include "BluetoothSerial.h"
#include "driver/twai.h"
#include "esp_system.h"

// ----------------------------------------------------------------------------
// Configuration & Pin Definitions
// ----------------------------------------------------------------------------
#define CAN_TX_PIN                GPIO_NUM_22
#define CAN_RX_PIN                GPIO_NUM_21
#define CAN_DEFAULT_SPEED_KBPS    500

#define KLINE_RX_PIN              GPIO_NUM_16
#define KLINE_TX_PIN              GPIO_NUM_17
#define KLINE_BAUDRATE            10400

#define WIFI_AP_SSID              "ESP32-OBD-PRO"
#define WIFI_AP_PASS              "12345678"
#define TCP_SERVER_PORT           35000

#define BT_DEVICE_NAME            "ESP32-OBD-PRO"

#define STATUS_LED_PIN            2 // Built-in LED on most ESP32 boards

uint32_t currentCanSpeedKbps = CAN_DEFAULT_SPEED_KBPS;
bool enableRawCanLogging = false;

// K-Line Protocol IDs
#define KLINE_PROTO_AUTO          0x00
#define KLINE_PROTO_CAN_11_500    0x01
#define KLINE_PROTO_CAN_29_500    0x02
#define KLINE_PROTO_CAN_11_250    0x03
#define KLINE_PROTO_CAN_29_250    0x04
#define KLINE_PROTO_ISO9141_SLOW  0x05
#define KLINE_PROTO_KWP2000_FAST  0x06
#define KLINE_PROTO_KWP2000_SLOW  0x07

// K-Line Status Codes
#define KLINE_STATUS_SUCCESS            0x00
#define KLINE_STATUS_NO_VOLTAGE         0x01
#define KLINE_STATUS_INIT_FAILED        0x02
#define KLINE_STATUS_KEYBYTE_MISMATCH   0x03
#define KLINE_STATUS_ECU_NO_RESPONSE    0x04
#define KLINE_STATUS_CHECKSUM_ERROR     0x05

// Binary Protocol Constants
#define PROTOCOL_MAGIC_1          0xAA
#define PROTOCOL_MAGIC_2          0x55
#define PROTOCOL_TRAILER_1        0x0D
#define PROTOCOL_TRAILER_2        0x0A

#define CMD_CAN_FRAME             0x01
#define CMD_PING                  0x02
#define CMD_PONG                  0x03
#define CMD_CAN_STATUS_REQ        0x04
#define CMD_CAN_STATUS_RESP       0x05
#define CMD_CONFIG_CAN            0x06
#define CMD_HEARTBEAT             0x07
#define CMD_CONFIG_PROTOCOL       0x08
#define CMD_KLINE_INIT            0x09
#define CMD_KLINE_INIT_RESP       0x0A
#define CMD_KLINE_FRAME           0x0B
#define CMD_KLINE_STATUS_REQ      0x0C
#define CMD_KLINE_STATUS_RESP     0x0D

// ----------------------------------------------------------------------------
// Global Instances & Buffers
// ----------------------------------------------------------------------------
#if !defined(CONFIG_BT_ENABLED) || !defined(CONFIG_BLUEDROID_ENABLED)
#error "Bluetooth is not enabled in this ESP32 board definition!"
#endif

BluetoothSerial SerialBT;
WiFiServer tcpServer(TCP_SERVER_PORT);
WiFiClient tcpClient;

// Statistics & Status Counters
struct SystemStats {
  uint32_t messagesSent;
  uint32_t messagesReceived;
  uint32_t txErrorCount;
  uint32_t rxErrorCount;
  uint32_t busOverruns;
  bool canInitialized;
  bool btConnected;
  bool wifiClientConnected;
} stats = {0, 0, 0, 0, 0, false, false, false};

// K-Line Physical Layer State Machine
struct KlineState {
  bool initialized;
  uint8_t activeProtocol; // 0x05 = 9141, 0x06 = KWP Fast, 0x07 = KWP Slow
  uint8_t keyByte1;
  uint8_t keyByte2;
  uint16_t rxErrorCount;
  uint16_t txErrorCount;
  uint8_t lastErrorCode;
} klineState = {false, KLINE_PROTO_ISO9141_SLOW, 0x00, 0x00, 0, 0, KLINE_STATUS_SUCCESS};

// Static Stream Parser Buffer for Transport RX (Protects ESP32 Heap)
#define RX_STREAM_BUF_SIZE 512
uint8_t wifiRxBuf[RX_STREAM_BUF_SIZE];
size_t wifiRxHead = 0;

uint8_t btRxBuf[RX_STREAM_BUF_SIZE];
size_t btRxHead = 0;

// Forward Declarations
void initCAN(uint32_t speedKbps);
bool checkKlineVoltage();
void klineFlushRxEcho(size_t expectedEchoCount);
uint8_t initKlineIso9141();
uint8_t initKlineKwpFast();
uint8_t transceiveKlineFrame(const uint8_t* txData, size_t txLen, uint8_t* rxBuf, size_t& rxLen, uint32_t timeoutMs);
void processStreamBuffer(uint8_t* buffer, size_t& head, bool fromBluetooth);
void handleParsedCommand(uint8_t cmd, uint16_t len, const uint8_t* payload, bool fromBluetooth);
void broadcastBinaryPacket(uint8_t cmd, const uint8_t* payload, uint16_t len);
void sendPong(bool toBluetooth);
void sendCanStatus(bool toBluetooth);
void sendKlineStatus(bool toBluetooth);
uint8_t calculateChecksum(uint8_t cmd, uint16_t len, const uint8_t* payload);
void runObdTest();
void printTwaiStatus();

// Check if K-Line is in IDLE HIGH state (GPIO16 RX2)
// On a passive OBD-II K-Line, the line is pulled HIGH to Vbatt (~12V) through a pull-up resistor.
// If the line is stuck LOW (GND), line is either shorted or disconnected.
bool checkKlineIdleState() {
  pinMode(KLINE_RX_PIN, INPUT_PULLUP);
  int lowCount = 0;
  for (int i = 0; i < 50; i++) {
    if (digitalRead(KLINE_RX_PIN) == LOW) lowCount++;
    delayMicroseconds(1000);
  }
  if (lowCount >= 40) {
    Serial.println("[KLINE-HW] ERROR: K-Line stuck LOW! Check line pull-up or GND short.");
    return false;
  }
  return true;
}

// Strip single-wire transceiver loopback echo from RX buffer
size_t stripTxEcho(const uint8_t* txBuf, size_t txLen, const uint8_t* rawRxBuf, size_t rawRxLen, uint8_t* cleanRxBuf) {
  size_t echoCount = 0;
  while (echoCount < txLen && echoCount < rawRxLen) {
    if (rawRxBuf[echoCount] == txBuf[echoCount]) {
      echoCount++;
    } else {
      break;
    }
  }
  size_t cleanLen = 0;
  for (size_t i = echoCount; i < rawRxLen; i++) {
    cleanRxBuf[cleanLen++] = rawRxBuf[i];
  }
  return cleanLen;
}

// Legacy helper retained for backward compatibility
void klineFlushRxEcho(size_t expectedEchoCount) {
  unsigned long start = millis();
  size_t readCount = 0;
  while (readCount < expectedEchoCount && (millis() - start) < 100) {
    if (Serial2.available()) {
      Serial2.read();
      readCount++;
    } else {
      delay(1);
    }
  }
}

// ISO 9141-2 5-Baud Slow Initialization (Target address 0x33)
uint8_t initKlineIso9141() {
  Serial.println("[KLINE-INIT] Starting ISO 9141-2 5-Baud Slow Initialization...");
  if (!checkKlineIdleState()) {
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = KLINE_STATUS_NO_VOLTAGE;
    return KLINE_STATUS_NO_VOLTAGE;
  }

  Serial2.end();
  pinMode(KLINE_TX_PIN, OUTPUT);
  digitalWrite(KLINE_TX_PIN, HIGH);
  delay(300); // Tidle >= 300ms

  // 5-baud address 0x33 = 0b00110011
  // Start bit (0), LSB first: 1, 1, 0, 0, 1, 1, 0, 0, Stop bit (1)
  uint8_t addrBits[10] = {0, 1, 1, 0, 0, 1, 1, 0, 0, 1};
  for (int i = 0; i < 10; i++) {
    digitalWrite(KLINE_TX_PIN, addrBits[i] ? HIGH : LOW);
    delay(200); // 200ms per bit = 5 baud
  }
  digitalWrite(KLINE_TX_PIN, HIGH);

  // Switch to HardwareSerial2 @ 10400 bps 8N1
  Serial2.begin(KLINE_BAUDRATE, SERIAL_8N1, KLINE_RX_PIN, KLINE_TX_PIN);

  // Wait W1 (up to 300ms) for Sync byte 0x55
  unsigned long t0 = millis();
  uint8_t syncByte = 0;
  while ((millis() - t0) < 300) {
    if (Serial2.available()) {
      syncByte = Serial2.read();
      break;
    }
    delay(1);
  }

  if (syncByte != 0x55) {
    Serial.printf("[KLINE-INIT] FAIL: Expected Sync Byte 0x55, got 0x%02X\n", syncByte);
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = KLINE_STATUS_INIT_FAILED;
    return KLINE_STATUS_INIT_FAILED;
  }

  // Read KeyByte 1 and KeyByte 2 within W2/W3 (up to 300ms)
  uint8_t kb1 = 0, kb2 = 0;
  t0 = millis();
  while ((millis() - t0) < 300 && !Serial2.available()) delay(1);
  if (Serial2.available()) kb1 = Serial2.read();

  t0 = millis();
  while ((millis() - t0) < 300 && !Serial2.available()) delay(1);
  if (Serial2.available()) kb2 = Serial2.read();

  Serial.printf("[KLINE-INIT] ISO 9141 Sync OK (0x55). KeyBytes: KB1=0x%02X, KB2=0x%02X\n", kb1, kb2);

  delay(30); // W4 delay (20..50ms)

  // Transmit inverted KB2 (~KB2) back to ECU
  uint8_t invKb2 = ~kb2;
  Serial2.write(invKb2);

  // Strip self-echo of ~KB2
  t0 = millis();
  while ((millis() - t0) < 50) {
    if (Serial2.available()) {
      uint8_t echo = Serial2.read();
      if (echo == invKb2) break;
    }
    delay(1);
  }

  // Wait W5 (up to 300ms) for ECU confirmation byte 0xCC (~0x33)
  uint8_t invAddrResp = 0;
  t0 = millis();
  while ((millis() - t0) < 300) {
    if (Serial2.available()) {
      invAddrResp = Serial2.read();
      break;
    }
    delay(1);
  }

  if (invAddrResp != 0xCC) {
    Serial.printf("[KLINE-INIT] FAIL: Expected ECU Confirmation 0xCC (~0x33), got 0x%02X\n", invAddrResp);
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = KLINE_STATUS_INIT_FAILED;
    return KLINE_STATUS_INIT_FAILED;
  }

  // Distinguish protocol based on KeyBytes
  if ((kb1 == 0x8F && kb2 == 0x27) || ((kb2 & 0x80) && kb2 != 0xEA)) {
    klineState.activeProtocol = KLINE_PROTO_KWP2000_SLOW;
    Serial.println("[KLINE-INIT] Detected Protocol: ISO 14230-4 KWP2000 (Slow Init)");
  } else {
    klineState.activeProtocol = KLINE_PROTO_ISO9141_SLOW;
    Serial.println("[KLINE-INIT] Detected Protocol: ISO 9141-2 (5-Baud Slow Init)");
  }

  klineState.initialized = true;
  klineState.keyByte1 = kb1;
  klineState.keyByte2 = kb2;
  klineState.lastErrorCode = KLINE_STATUS_SUCCESS;
  Serial.println("[KLINE-INIT] Slow Initialization SUCCESSFUL!");
  return KLINE_STATUS_SUCCESS;
}

// ISO 14230-4 KWP2000 Fast Initialization
uint8_t initKlineKwpFast() {
  Serial.println("[KLINE-INIT] Starting ISO 14230-4 KWP2000 Fast Initialization...");
  if (!checkKlineIdleState()) {
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = KLINE_STATUS_NO_VOLTAGE;
    return KLINE_STATUS_NO_VOLTAGE;
  }

  Serial2.end();
  pinMode(KLINE_TX_PIN, OUTPUT);
  digitalWrite(KLINE_TX_PIN, HIGH);
  delay(300); // Tidle >= 300ms

  // Fast Init Pulse: Tini_low = 25ms LOW, Tini_high = 25ms HIGH
  digitalWrite(KLINE_TX_PIN, LOW);
  delay(25);
  digitalWrite(KLINE_TX_PIN, HIGH);
  delay(25);

  // Switch to HardwareSerial2 @ 10400 bps 8N1
  Serial2.begin(KLINE_BAUDRATE, SERIAL_8N1, KLINE_RX_PIN, KLINE_TX_PIN);

  // KWP2000 Start Communication Frame: 0xC1 0x33 0xF1 0x81 0x66
  // Format = 0xC1, Target = 0x33, Source = 0xF1, Service = 0x81, CS = 0x66
  uint8_t startCommReq[5] = {0xC1, 0x33, 0xF1, 0x81, 0x66};
  
  uint32_t tStart = millis();
  Serial.printf("[KLINE-TX] [+%04ums] C1 33 F1 81 66\n", tStart);
  Serial2.write(startCommReq, 5);

  // Read raw response from UART2
  uint8_t rawRx[32];
  size_t rawRxLen = 0;
  unsigned long t0 = millis();
  while ((millis() - t0) < 300 && rawRxLen < 32) {
    if (Serial2.available()) {
      rawRx[rawRxLen++] = Serial2.read();
      t0 = millis();
    } else {
      delay(2);
    }
  }

  // Strip single-wire loopback echo
  uint8_t cleanRx[32];
  size_t cleanRxLen = stripTxEcho(startCommReq, 5, rawRx, rawRxLen, cleanRx);

  if (cleanRxLen < 5) {
    Serial.printf("[KLINE-INIT] KWP Fast Init TIMEOUT / NO RESPONSE (Clean RX len=%u)\n", cleanRxLen);
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = KLINE_STATUS_ECU_NO_RESPONSE;
    return KLINE_STATUS_ECU_NO_RESPONSE;
  }

  // Verify response checksum
  uint8_t cs = 0;
  for (size_t i = 0; i < cleanRxLen - 1; i++) cs += cleanRx[i];

  if (cs != cleanRx[cleanRxLen - 1]) {
    Serial.printf("[KLINE-INIT] KWP Fast Init CHECKSUM ERROR (Calc 0x%02X != Recv 0x%02X)\n", cs, cleanRx[cleanRxLen - 1]);
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = KLINE_STATUS_CHECKSUM_ERROR;
    return KLINE_STATUS_CHECKSUM_ERROR;
  }

  // Log raw RX with timestamp
  Serial.printf("[KLINE-RX] [+%04ums] ", millis() - tStart);
  for (size_t i = 0; i < cleanRxLen; i++) Serial.printf("%02X ", cleanRx[i]);
  Serial.println();

  Serial.printf("[KLINE-INIT] KWP2000 Fast Init SUCCESS! Response RX len=%u\n", cleanRxLen);

  klineState.initialized = true;
  klineState.activeProtocol = KLINE_PROTO_KWP2000_FAST;
  klineState.keyByte1 = cleanRxLen >= 6 ? cleanRx[4] : 0x8F;
  klineState.keyByte2 = cleanRxLen >= 7 ? cleanRx[5] : 0xEA;
  klineState.lastErrorCode = KLINE_STATUS_SUCCESS;
  return KLINE_STATUS_SUCCESS;
}

// Transceive K-Line diagnostic frame
uint8_t transceiveKlineFrame(const uint8_t* txData, size_t txLen, uint8_t* rxBuf, size_t& rxLen, uint32_t timeoutMs) {
  if (!klineState.initialized) {
    if (initKlineKwpFast() != KLINE_STATUS_SUCCESS) {
      if (initKlineIso9141() != KLINE_STATUS_SUCCESS) {
        return klineState.lastErrorCode;
      }
    }
  }

  uint8_t frameTx[64];
  size_t frameTxLen = 0;

  if (klineState.activeProtocol == KLINE_PROTO_ISO9141_SLOW) {
    // ISO 9141-2 Header: 0x68 0x6A 0xF1 + txData + CS
    frameTx[0] = 0x68;
    frameTx[1] = 0x6A;
    frameTx[2] = 0xF1;
    for (size_t i = 0; i < txLen; i++) frameTx[3 + i] = txData[i];
    frameTxLen = 3 + txLen;

    uint8_t cs = 0;
    for (size_t i = 0; i < frameTxLen; i++) cs += frameTx[i];
    frameTx[frameTxLen++] = cs;
  } else {
    // KWP2000 Header: (0x80 | (txLen & 0x3F)) 0x33 0xF1 + txData + CS
    frameTx[0] = 0x80 | (txLen & 0x3F);
    frameTx[1] = 0x33;
    frameTx[2] = 0xF1;
    for (size_t i = 0; i < txLen; i++) frameTx[3 + i] = txData[i];
    frameTxLen = 3 + txLen;

    uint8_t cs = 0;
    for (size_t i = 0; i < frameTxLen; i++) cs += frameTx[i];
    frameTx[frameTxLen++] = cs;
  }

  uint32_t tStart = millis();
  Serial.printf("[KLINE-TX] [+%04ums] ", tStart);
  for (size_t i = 0; i < frameTxLen; i++) Serial.printf("%02X ", frameTx[i]);
  Serial.println();

  // Send to physical UART2
  Serial2.write(frameTx, frameTxLen);

  // Read raw RX bytes from single-wire bus
  uint8_t rawRx[128];
  size_t rawRxLen = 0;
  unsigned long startT = millis();
  while ((millis() - startT) < timeoutMs && rawRxLen < 128) {
    if (Serial2.available()) {
      rawRx[rawRxLen++] = Serial2.read();
      startT = millis();
    } else {
      delay(1);
    }
  }

  // Strip single-wire loopback echo
  uint8_t cleanRx[128];
  size_t cleanRxLen = stripTxEcho(frameTx, frameTxLen, rawRx, rawRxLen, cleanRx);

  if (cleanRxLen == 0) {
    Serial.printf("[KLINE-RX] [+%04ums] ERROR: ECU No Response (Timeout)\n", millis() - tStart);
    klineState.rxErrorCount++;
    klineState.lastErrorCode = KLINE_STATUS_ECU_NO_RESPONSE;
    return KLINE_STATUS_ECU_NO_RESPONSE;
  }

  // Validate response checksum
  uint8_t rxCs = 0;
  for (size_t i = 0; i < cleanRxLen - 1; i++) rxCs += cleanRx[i];

  if (rxCs != cleanRx[cleanRxLen - 1]) {
    Serial.printf("[KLINE-RX] [+%04ums] ERROR: Checksum Mismatch (Calc 0x%02X != Recv 0x%02X)\n", millis() - tStart, rxCs, cleanRx[cleanRxLen - 1]);
    klineState.rxErrorCount++;
    klineState.lastErrorCode = KLINE_STATUS_CHECKSUM_ERROR;
    return KLINE_STATUS_CHECKSUM_ERROR;
  }

  Serial.printf("[KLINE-RX] [+%04ums] ", millis() - tStart);
  for (size_t i = 0; i < cleanRxLen; i++) Serial.printf("%02X ", cleanRx[i]);
  Serial.println();

  rxLen = cleanRxLen;
  for (size_t i = 0; i < cleanRxLen; i++) rxBuf[i] = cleanRx[i];

  klineState.lastErrorCode = KLINE_STATUS_SUCCESS;
  return KLINE_STATUS_SUCCESS;
}

// ----------------------------------------------------------------------------
// CAN (TWAI) Initialization & Driver Management
// ----------------------------------------------------------------------------
void initCAN(uint32_t speedKbps) {
  // Uninstall if already running
  twai_stop();
  twai_driver_uninstall();

  twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(CAN_TX_PIN, CAN_RX_PIN, TWAI_MODE_NORMAL);
  g_config.rx_queue_len = 32;
  g_config.tx_queue_len = 16;

  twai_timing_config_t t_config;
  switch (speedKbps) {
    case 1000: t_config = TWAI_TIMING_CONFIG_1MBITS(); break;
    case 250:  t_config = TWAI_TIMING_CONFIG_250KBITS(); break;
    case 125:  t_config = TWAI_TIMING_CONFIG_125KBITS(); break;
    case 500:
    default:   t_config = TWAI_TIMING_CONFIG_500KBITS(); break;
  }

  twai_filter_config_t f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();

  if (twai_driver_install(&g_config, &t_config, &f_config) == ESP_OK) {
    if (twai_start() == ESP_OK) {
      stats.canInitialized = true;
      currentCanSpeedKbps = speedKbps;

      twai_status_info_t s_info;
      twai_get_status_info(&s_info);
      Serial.printf("[CAN-INIT] Bitrate=%d kbps | TX_GPIO=%d | RX_GPIO=%d | State=%d | TX_Err=%d | RX_Err=%d | Overruns=%d | MsgsToRx=%d\n",
        speedKbps, (int)CAN_TX_PIN, (int)CAN_RX_PIN, (int)s_info.state, s_info.tx_error_counter, s_info.rx_error_counter, s_info.rx_overrun_count, s_info.msgs_to_rx);
      return;
    }
  }

  stats.canInitialized = false;
  Serial.println("[CAN] ERROR: Failed to install or start TWAI driver!");
}

// ----------------------------------------------------------------------------
// Arduino Setup
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  Serial.println("\n==================================================");
  Serial.println("HAMZA OBD PRO - Dual-Transport Firmware v2.5.0");
  Serial.println("==================================================");

  // 1. Initialize Native CAN Bus (TWAI)
  initCAN(CAN_DEFAULT_SPEED_KBPS);

  // 2. Initialize Bluetooth Classic SPP
  if (SerialBT.begin(BT_DEVICE_NAME)) {
    Serial.printf("[BT] Bluetooth Classic SPP Ready as '%s'\n", BT_DEVICE_NAME);
  } else {
    Serial.println("[BT] ERROR: BluetoothSerial initialization failed!");
  }

  // 3. Initialize Wi-Fi SoftAP & TCP Server
  IPAddress local_ip(192, 168, 4, 1);
  IPAddress gateway(192, 168, 4, 1);
  IPAddress subnet(255, 255, 255, 0);

  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(local_ip, gateway, subnet);
  if (WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASS)) {
    Serial.printf("[WiFi] SoftAP Created: SSID='%s', IP=192.168.4.1\n", WIFI_AP_SSID);
    tcpServer.begin();
    tcpServer.setNoDelay(true);
    Serial.printf("[WiFi] TCP Server listening on port %d\n", TCP_SERVER_PORT);
  } else {
    Serial.println("[WiFi] ERROR: Failed to create SoftAP!");
  }

  Serial.printf("[SYS] Free Heap: %d bytes\n", ESP.getFreeHeap());
  Serial.println("[SYS] System Ready for Diagnostic Connections.");
}

// ----------------------------------------------------------------------------
// Main Loop (Non-blocking multiplexer for CAN, Wi-Fi TCP & Bluetooth SPP)
// ----------------------------------------------------------------------------
void loop() {
  // A. Check for incoming Wi-Fi TCP Connections
  if (tcpServer.hasClient()) {
    if (!tcpClient || !tcpClient.connected()) {
      if (tcpClient) tcpClient.stop();
      tcpClient = tcpServer.available();
      tcpClient.setNoDelay(true);
      stats.wifiClientConnected = true;
      Serial.printf("[WiFi] New client connected: %s\n", tcpClient.remoteIP().toString().c_str());
    }
  }

  // B. Poll Data from Wi-Fi TCP Client
  if (tcpClient && tcpClient.connected()) {
    while (tcpClient.available()) {
      if (wifiRxHead < RX_STREAM_BUF_SIZE) {
        wifiRxBuf[wifiRxHead++] = tcpClient.read();
      } else {
        // Buffer full - reset to avoid hang
        wifiRxHead = 0;
      }
    }
    if (wifiRxHead >= 7) {
      processStreamBuffer(wifiRxBuf, wifiRxHead, false);
    }
  }

  // C. Poll Data from Bluetooth Classic SPP
  if (SerialBT.available()) {
    while (SerialBT.available()) {
      if (btRxHead < RX_STREAM_BUF_SIZE) {
        btRxBuf[btRxHead++] = SerialBT.read();
      } else {
        btRxHead = 0;
      }
    }
    if (btRxHead >= 7) {
      processStreamBuffer(btRxBuf, btRxHead, true);
    }
  }

  // Check for Serial Monitor commands ('r' to toggle raw logging, 'o' to run OBD test, 's' to print status)
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'r' || c == 'R') {
      enableRawCanLogging = !enableRawCanLogging;
      Serial.printf("[SYS] Raw CAN Logging is now %s (Press 'r' to toggle)\n", enableRawCanLogging ? "ENABLED" : "DISABLED");
    } else if (c == 'o' || c == 'O') {
      runObdTest();
    } else if (c == 's' || c == 'S') {
      printTwaiStatus();
    }
  }

  // D. Poll Incoming CAN Frames from Vehicle ECU (TWAI RX)
  if (stats.canInitialized) {
    twai_message_t rxMsg;
    while (twai_receive(&rxMsg, 0) == ESP_OK) {
      if (enableRawCanLogging) {
        Serial.printf("[CAN-RX-RAW] ID=0x%08X EXT=%d RTR=%d DLC=%d DATA=", rxMsg.identifier, rxMsg.extd ? 1 : 0, rxMsg.rtr ? 1 : 0, rxMsg.data_length_code);
        for (int i = 0; i < rxMsg.data_length_code && i < 8; i++) {
          Serial.printf("%02X ", rxMsg.data[i]);
        }
        Serial.println();
      }

      // Construct Binary CAN Frame Payload
      // Format: [CAN_ID (4B)] [FLAGS (1B)] [DLC (1B)] [DATA (0..8B)]
      uint8_t payload[14];
      payload[0] = (rxMsg.identifier >> 24) & 0xFF;
      payload[1] = (rxMsg.identifier >> 16) & 0xFF;
      payload[2] = (rxMsg.identifier >> 8) & 0xFF;
      payload[3] = rxMsg.identifier & 0xFF;

      payload[4] = (rxMsg.extd ? 0x01 : 0x00) | (rxMsg.rtr ? 0x02 : 0x00);
      payload[5] = rxMsg.data_length_code;

      for (int i = 0; i < rxMsg.data_length_code && i < 8; i++) {
        payload[6 + i] = rxMsg.data[i];
      }

      uint16_t payloadLen = 6 + rxMsg.data_length_code;
      broadcastBinaryPacket(CMD_CAN_FRAME, payload, payloadLen);

      stats.messagesReceived++;

      // Flash status LED on active bus traffic
      digitalWrite(STATUS_LED_PIN, !digitalRead(STATUS_LED_PIN));
    }
  }

  // Small non-blocking yield to background watchdog
  yield();
}

// ----------------------------------------------------------------------------
// Checksum & Packet Processing Functions
// ----------------------------------------------------------------------------
uint8_t calculateChecksum(uint8_t cmd, uint16_t len, const uint8_t* payload) {
  uint8_t cs = cmd ^ ((len >> 8) & 0xFF) ^ (len & 0xFF);
  for (uint16_t i = 0; i < len; i++) {
    cs ^= payload[i];
  }
  return cs;
}

void processStreamBuffer(uint8_t* buffer, size_t& head, bool fromBluetooth) {
  size_t i = 0;
  while (i + 7 <= head) {
    if (buffer[i] == PROTOCOL_MAGIC_1 && buffer[i + 1] == PROTOCOL_MAGIC_2) {
      uint8_t cmd = buffer[i + 2];
      uint16_t len = (buffer[i + 3] << 8) | buffer[i + 4];

      size_t totalPacketLen = 2 + 1 + 2 + len + 1 + 2; // Magic(2) + Cmd(1) + Len(2) + Payload(N) + CS(1) + Trailer(2)

      if (i + totalPacketLen <= head) {
        const uint8_t* payload = &buffer[i + 5];
        uint8_t checksum = buffer[i + 5 + len];
        uint8_t tr1 = buffer[i + 5 + len + 1];
        uint8_t tr2 = buffer[i + 5 + len + 2];

        if (checksum == calculateChecksum(cmd, len, payload) &&
            tr1 == PROTOCOL_TRAILER_1 && tr2 == PROTOCOL_TRAILER_2) {
          handleParsedCommand(cmd, len, payload, fromBluetooth);
          i += totalPacketLen;
          continue;
        }
      }
    }
    i++;
  }

  // Shift remaining bytes
  if (i > 0) {
    size_t remaining = head - i;
    for (size_t k = 0; k < remaining; k++) {
      buffer[k] = buffer[i + k];
    }
    head = remaining;
  }
}

void handleParsedCommand(uint8_t cmd, uint16_t len, const uint8_t* payload, bool fromBluetooth) {
  switch (cmd) {
    case CMD_CAN_FRAME: {
      if (len >= 6 && stats.canInitialized) {
        uint32_t canId = ((uint32_t)payload[0] << 24) |
                         ((uint32_t)payload[1] << 16) |
                         ((uint32_t)payload[2] << 8)  |
                         (uint32_t)payload[3];
        uint8_t flags = payload[4];
        uint8_t dlc = payload[5];

        twai_message_t txMsg;
        txMsg.identifier = canId;
        txMsg.extd = (flags & 0x01) ? 1 : 0;
        txMsg.rtr = (flags & 0x02) ? 1 : 0;
        txMsg.data_length_code = min((int)dlc, 8);

        for (int b = 0; b < txMsg.data_length_code; b++) {
          txMsg.data[b] = payload[6 + b];
        }

        // Transmit frame to CAN Transceiver
        esp_err_t err = twai_transmit(&txMsg, pdMS_TO_TICKS(50));
        if (err == ESP_OK) {
          stats.messagesSent++;
          Serial.printf("[OBD-TX] ID=0x%X DLC=%d DATA=", txMsg.identifier, txMsg.data_length_code);
          for (int i = 0; i < txMsg.data_length_code; i++) {
            Serial.printf("%02X ", txMsg.data[i]);
          }
          Serial.println();
        } else {
          stats.txErrorCount++;
          twai_status_info_t s_info;
          twai_get_status_info(&s_info);
          Serial.printf("[TWAI-ERR] twai_transmit failed! err=0x%x | State=%d | TX_Err=%d | RX_Err=%d | BusOff=%d\n", 
            err, s_info.state, s_info.tx_error_counter, s_info.rx_error_counter, (s_info.state == TWAI_STATE_BUS_OFF));
          if (s_info.state == TWAI_STATE_BUS_OFF) {
            Serial.println("[TWAI-RECOVERY] Bus-off detected. Initiating recovery...");
            twai_initiate_recovery();
          } else if (s_info.state == TWAI_STATE_STOPPED) {
            Serial.println("[TWAI-RECOVERY] TWAI stopped. Restarting...");
            twai_start();
          }
        }
      }
      break;
    }

    case CMD_PING: {
      sendPong(fromBluetooth);
      break;
    }

    case CMD_CAN_STATUS_REQ: {
      sendCanStatus(fromBluetooth);
      break;
    }

    case CMD_CONFIG_CAN: {
      if (len >= 2) {
        uint16_t speedKbps = ((uint16_t)payload[0] << 8) | payload[1];
        initCAN(speedKbps);
      }
      break;
    }

    case CMD_CONFIG_PROTOCOL: {
      if (len >= 1) {
        uint8_t protoId = payload[0];
        Serial.printf("[CONFIG-PROTO] Protocol requested: 0x%02X\n", protoId);
        if (protoId >= KLINE_PROTO_CAN_11_500 && protoId <= KLINE_PROTO_CAN_29_250) {
          uint32_t speed = (protoId == KLINE_PROTO_CAN_11_250 || protoId == KLINE_PROTO_CAN_29_250) ? 250 : 500;
          initCAN(speed);
        } else if (protoId == KLINE_PROTO_KWP2000_FAST) {
          initKlineKwpFast();
        } else if (protoId == KLINE_PROTO_ISO9141_SLOW || protoId == KLINE_PROTO_KWP2000_SLOW) {
          initKlineIso9141();
        }
      }
      break;
    }

    case CMD_KLINE_INIT: {
      uint8_t protoId = (len >= 1) ? payload[0] : KLINE_PROTO_AUTO;
      uint8_t status = KLINE_STATUS_INIT_FAILED;
      if (protoId == KLINE_PROTO_KWP2000_FAST) {
        status = initKlineKwpFast();
      } else if (protoId == KLINE_PROTO_ISO9141_SLOW || protoId == KLINE_PROTO_KWP2000_SLOW) {
        status = initKlineIso9141();
      } else {
        // Auto mode: try KWP Fast first, then ISO 9141 Slow
        status = initKlineKwpFast();
        if (status != KLINE_STATUS_SUCCESS) {
          status = initKlineIso9141();
        }
      }

      uint8_t respPayload[4];
      respPayload[0] = status;
      respPayload[1] = klineState.activeProtocol;
      respPayload[2] = klineState.keyByte1;
      respPayload[3] = klineState.keyByte2;
      broadcastBinaryPacket(CMD_KLINE_INIT_RESP, respPayload, 4);
      break;
    }

    case CMD_KLINE_FRAME: {
      if (len >= 1) {
        uint8_t rxBuf[64];
        size_t rxLen = 0;
        uint8_t status = transceiveKlineFrame(payload, len, rxBuf, rxLen, 500);

        uint8_t respBuf[65];
        respBuf[0] = status;
        for (size_t i = 0; i < rxLen; i++) respBuf[1 + i] = rxBuf[i];
        broadcastBinaryPacket(CMD_KLINE_FRAME, respBuf, 1 + rxLen);
      }
      break;
    }

    case CMD_KLINE_STATUS_REQ: {
      sendKlineStatus(fromBluetooth);
      break;
    }

    default:
      break;
  }
}

// ----------------------------------------------------------------------------
// Outbound Packet Builders
// ----------------------------------------------------------------------------
void broadcastBinaryPacket(uint8_t cmd, const uint8_t* payload, uint16_t len) {
  uint16_t totalLen = 2 + 1 + 2 + len + 1 + 2;
  uint8_t frame[256];
  if (totalLen > sizeof(frame)) return;

  frame[0] = PROTOCOL_MAGIC_1;
  frame[1] = PROTOCOL_MAGIC_2;
  frame[2] = cmd;
  frame[3] = (len >> 8) & 0xFF;
  frame[4] = len & 0xFF;

  for (uint16_t i = 0; i < len; i++) {
    frame[5 + i] = payload[i];
  }

  uint8_t cs = calculateChecksum(cmd, len, payload);
  frame[5 + len] = cs;
  frame[5 + len + 1] = PROTOCOL_TRAILER_1;
  frame[5 + len + 2] = PROTOCOL_TRAILER_2;

  // Send to Wi-Fi TCP Client if connected
  if (tcpClient && tcpClient.connected()) {
    tcpClient.write(frame, totalLen);
  }

  // Send to Bluetooth Serial Client if connected
  if (SerialBT.hasClient()) {
    SerialBT.write(frame, totalLen);
  }
}

void sendPong(bool toBluetooth) {
  uint8_t pongPayload[9];
  uint32_t uptime = millis();
  uint32_t freeHeap = ESP.getFreeHeap();

  pongPayload[0] = (uptime >> 24) & 0xFF;
  pongPayload[1] = (uptime >> 16) & 0xFF;
  pongPayload[2] = (uptime >> 8) & 0xFF;
  pongPayload[3] = uptime & 0xFF;

  pongPayload[4] = stats.canInitialized ? 0x01 : 0x00;

  pongPayload[5] = (freeHeap >> 24) & 0xFF;
  pongPayload[6] = (freeHeap >> 16) & 0xFF;
  pongPayload[7] = (freeHeap >> 8) & 0xFF;
  pongPayload[8] = freeHeap & 0xFF;

  broadcastBinaryPacket(CMD_PONG, pongPayload, 9);
}

void sendCanStatus(bool toBluetooth) {
  twai_status_info_t twai_status;
  twai_get_status_info(&twai_status);

  uint8_t statusPayload[21];
  // 0: State code
  statusPayload[0] = (twai_status.state == TWAI_STATE_RUNNING) ? 0 :
                     (twai_status.state == TWAI_STATE_STOPPED) ? 1 :
                     (twai_status.state == TWAI_STATE_BUS_OFF) ? 2 : 3;

  // 1-4: Speed
  uint32_t speed = currentCanSpeedKbps * 1000;
  statusPayload[1] = (speed >> 24) & 0xFF;
  statusPayload[2] = (speed >> 16) & 0xFF;
  statusPayload[3] = (speed >> 8) & 0xFF;
  statusPayload[4] = speed & 0xFF;

  // 5: Tx Err
  statusPayload[5] = twai_status.tx_error_counter;
  // 6: Rx Err
  statusPayload[6] = twai_status.rx_error_counter;
  // 7-8: Overrun
  statusPayload[7] = (twai_status.rx_overrun_count >> 8) & 0xFF;
  statusPayload[8] = twai_status.rx_overrun_count & 0xFF;
  // 9: Queue size
  statusPayload[9] = twai_status.msgs_to_rx;

  // 10-13: Sent
  statusPayload[10] = (stats.messagesSent >> 24) & 0xFF;
  statusPayload[11] = (stats.messagesSent >> 16) & 0xFF;
  statusPayload[12] = (stats.messagesSent >> 8) & 0xFF;
  statusPayload[13] = stats.messagesSent & 0xFF;

  // 14-17: Received
  statusPayload[14] = (stats.messagesReceived >> 24) & 0xFF;
  statusPayload[15] = (stats.messagesReceived >> 16) & 0xFF;
  statusPayload[16] = (stats.messagesReceived >> 8) & 0xFF;
  statusPayload[17] = stats.messagesReceived & 0xFF;

  broadcastBinaryPacket(CMD_CAN_STATUS_RESP, statusPayload, 21);
}

void sendKlineStatus(bool toBluetooth) {
  uint8_t statusPayload[8];
  statusPayload[0] = checkKlineIdleState() ? 0x01 : 0x00;
  statusPayload[1] = klineState.activeProtocol;
  statusPayload[2] = klineState.initialized ? 0x01 : 0x00;
  statusPayload[3] = (klineState.rxErrorCount >> 8) & 0xFF;
  statusPayload[4] = klineState.rxErrorCount & 0xFF;
  statusPayload[5] = (klineState.txErrorCount >> 8) & 0xFF;
  statusPayload[6] = klineState.txErrorCount & 0xFF;
  statusPayload[7] = klineState.lastErrorCode;

  broadcastBinaryPacket(CMD_KLINE_STATUS_RESP, statusPayload, 8);
}

// ----------------------------------------------------------------------------
// Independent OBD-II Connection & Response Test Function
// ----------------------------------------------------------------------------
void runObdTest() {
  Serial.println("\n--------------------------------------------------");
  Serial.println("[OBD-TEST] Starting manual OBD-II standard RPM request (0x7DF)...");
  
  twai_message_t txMsg;
  txMsg.identifier = 0x7DF;
  txMsg.extd = 0; // 11-bit standard ID
  txMsg.rtr = 0;
  txMsg.data_length_code = 8;
  txMsg.data[0] = 0x02;
  txMsg.data[1] = 0x01;
  txMsg.data[2] = 0x0C;
  txMsg.data[3] = 0x00;
  txMsg.data[4] = 0x00;
  txMsg.data[5] = 0x00;
  txMsg.data[6] = 0x00;
  txMsg.data[7] = 0x00;

  Serial.printf("[OBD-TX] ID=0x%X DLC=%d DATA=", txMsg.identifier, txMsg.data_length_code);
  for (int i = 0; i < 8; i++) {
    Serial.printf("%02X ", txMsg.data[i]);
  }
  Serial.println();

  esp_err_t err = twai_transmit(&txMsg, pdMS_TO_TICKS(50));
  if (err != ESP_OK) {
    stats.txErrorCount++;
    twai_status_info_t s_info;
    twai_get_status_info(&s_info);
    Serial.printf("[OBD-RESULT] FAIL: twai_transmit error 0x%X | State=%d TX_Err=%d RX_Err=%d\n", 
      err, s_info.state, s_info.tx_error_counter, s_info.rx_error_counter);
    if (s_info.state == TWAI_STATE_BUS_OFF) {
      twai_initiate_recovery();
    }
    Serial.println("--------------------------------------------------\n");
    return;
  }

  stats.messagesSent++;
  twai_status_info_t tx_s_info;
  twai_get_status_info(&tx_s_info);
  Serial.printf("[OBD-TX-STATUS] Transmit queued OK | State=%d | TX_Err=%d | RX_Err=%d | MsgsToTx=%d\n",
    tx_s_info.state, tx_s_info.tx_error_counter, tx_s_info.rx_error_counter, tx_s_info.msgs_to_tx);

  Serial.println("[OBD-WAIT] Waiting for response from ECU (0x7E8 - 0x7EF) with data matching 41 0C...");

  unsigned long startWait = millis();
  bool received = false;

  while (millis() - startWait < 1000) {
    twai_message_t rxMsg;
    if (twai_receive(&rxMsg, pdMS_TO_TICKS(50)) == ESP_OK) {
      stats.messagesReceived++;
      bool isIdMatch = (rxMsg.identifier >= 0x7E8 && rxMsg.identifier <= 0x7EF);
      
      // Check if data contains 41 0C for PID 0x0C response
      bool isDataMatch = false;
      if (rxMsg.data_length_code >= 3 && rxMsg.data[1] == 0x41 && rxMsg.data[2] == 0x0C) {
        isDataMatch = true;
      } else if (rxMsg.data_length_code >= 2 && rxMsg.data[0] == 0x41 && rxMsg.data[1] == 0x0C) {
        isDataMatch = true;
      }

      Serial.printf("[OBD-RX] ID=0x%03X EXT=%d RTR=%d DLC=%d DATA=", rxMsg.identifier, rxMsg.extd ? 1 : 0, rxMsg.rtr ? 1 : 0, rxMsg.data_length_code);
      for (int i = 0; i < rxMsg.data_length_code && i < 8; i++) {
        Serial.printf("%02X ", rxMsg.data[i]);
      }
      Serial.println();

      if (isIdMatch && isDataMatch) {
        received = true;
        Serial.printf("[OBD-RESULT] SUCCESS: Received valid OBD response (41 0C) from ID=0x%03X within %ldms\n", rxMsg.identifier, millis() - startWait);
        
        // Broadcast packet over binary protocol
        uint8_t payload[14];
        payload[0] = (rxMsg.identifier >> 24) & 0xFF;
        payload[1] = (rxMsg.identifier >> 16) & 0xFF;
        payload[2] = (rxMsg.identifier >> 8) & 0xFF;
        payload[3] = rxMsg.identifier & 0xFF;
        payload[4] = (rxMsg.extd ? 0x01 : 0x00) | (rxMsg.rtr ? 0x02 : 0x00);
        payload[5] = rxMsg.data_length_code;
        for (int i = 0; i < rxMsg.data_length_code && i < 8; i++) {
          payload[6 + i] = rxMsg.data[i];
        }
        broadcastBinaryPacket(CMD_CAN_FRAME, payload, 6 + rxMsg.data_length_code);
        break;
      } else {
        Serial.println("[OBD-WAIT] Frame received does not match OBD 0x7E8-0x7EF and 41 0C pattern. Continuing wait...");
      }
    }
    yield();
  }

  if (!received) {
    twai_status_info_t s_info;
    twai_get_status_info(&s_info);
    Serial.printf("[OBD-RESULT] TIMEOUT: No response received from 0x7E8-0x7EF within 1000ms | State=%d TX_Err=%d RX_Err=%d BusOverruns=%d\n",
      s_info.state, s_info.tx_error_counter, s_info.rx_error_counter, s_info.rx_overrun_count);
  }
  Serial.println("--------------------------------------------------\n");
}

void printTwaiStatus() {
  twai_status_info_t s_info;
  twai_get_status_info(&s_info);
  Serial.println("--------------------------------------------------");
  Serial.printf("[TWAI-STATUS] Speed=%d kbps | TX_PIN=%d | RX_PIN=%d | Mode=NORMAL\n", (int)currentCanSpeedKbps, (int)CAN_TX_PIN, (int)CAN_RX_PIN);
  Serial.printf("  State: %d (%s)\n", s_info.state, 
    s_info.state == TWAI_STATE_RUNNING ? "RUNNING" :
    s_info.state == TWAI_STATE_STOPPED ? "STOPPED" :
    s_info.state == TWAI_STATE_BUS_OFF ? "BUS_OFF" : "RECOVERING");
  Serial.printf("  TX Error Counter: %u\n", s_info.tx_error_counter);
  Serial.printf("  RX Error Counter: %u\n", s_info.rx_error_counter);
  Serial.printf("  RX Overrun Count: %u\n", s_info.rx_overrun_count);
  Serial.printf("  Messages to TX: %u\n", s_info.msgs_to_tx);
  Serial.printf("  Messages to RX: %u\n", s_info.msgs_to_rx);
  Serial.printf("  Raw Logging: %s (Press 'r' to toggle, 'o' for OBD test, 's' for status)\n", enableRawCanLogging ? "ENABLED" : "DISABLED");
  Serial.println("--------------------------------------------------");
}
