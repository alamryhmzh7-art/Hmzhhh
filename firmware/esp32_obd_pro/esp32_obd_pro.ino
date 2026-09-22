/*
 * ============================================================================
 * HAMZA OBD PRO - Production ESP32 Dual-Transport OBD/CAN/K-Line Firmware
 * Build ID: HAMZA-OBD-PRO-PRODUCTION-V5-AUDITED
 * ============================================================================
 * Hardware & Pins:
 *  - ESP32 WROOM-32 / DevKitC
 *  - CAN TX: GPIO22 | CAN RX: GPIO21 (TWAI CAN 2.0B / ISO 15765-4)
 *  - K-Line RX: GPIO16 | K-Line TX: GPIO17 (ISO 9141-2 / ISO 14230-4 KWP2000)
 *  - Status LED: GPIO2
 *  - Analog Voltage Pin: GPIO34 (ADC1_CH6 with 10:1 voltage divider)
 * Transports:
 *  - Bluetooth Classic SPP ("ESP32-OBD-PRO")
 *  - Wi-Fi Access Point ("ESP32-OBD-PRO", 192.168.4.1) + TCP Server (Port 35000)
 * Protocols Supported:
 *  1. HAMZA Binary Protocol (Magic: 0xAA 0x55)
 *  2. ELM327 ASCII Engine (AT Commands + ISO-TP State Machine)
 * Architecture & Integrity:
 *  - Central CAN RX Dispatcher: Single twai_receive() entry point in loop().
 *  - Full ISO-TP Engine: SF, FF, FC (CTS/WAIT/OVERFLOW), CF with BS & STmin.
 *  - Strict Concurrency Lock: Single active ISO-TP transaction to prevent race conditions.
 *  - Zero Stack Overflows: Streaming responses instead of large stack arrays.
 *  - Per-Transport Routing: Direct response to origin transport (BT or Wi-Fi).
 *  - Zero Mock/Fake Data: Real ECU responses only, or NO DATA / CAN ERROR.
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include "BluetoothSerial.h"
#include "driver/twai.h"
#include "esp_system.h"
#include "driver/adc.h"

// ----------------------------------------------------------------------------
// Configuration & Definitions
// ----------------------------------------------------------------------------
#define FIRMWARE_BUILD_ID         "HAMZA-OBD-PRO-PRODUCTION-V5-AUDITED"

#define CAN_TX_PIN                GPIO_NUM_22
#define CAN_RX_PIN                GPIO_NUM_21
#define CAN_DEFAULT_SPEED_KBPS    500

#define KLINE_RX_PIN              GPIO_NUM_16
#define KLINE_TX_PIN              GPIO_NUM_17
#define KLINE_BAUDRATE            10400

#define VOLTAGE_ADC_PIN           34 // ADC pin for battery voltage divider (optional)

#define WIFI_AP_SSID              "ESP32-OBD-PRO"
#define WIFI_AP_PASS              "12345678"
#define TCP_SERVER_PORT           35000

#define BT_DEVICE_NAME            "ESP32-OBD-PRO"

#define STATUS_LED_PIN            2

// K-Line & CAN Protocol IDs
#define PROTO_AUTO                0x00
#define PROTO_ISO9141_SLOW        0x01
#define PROTO_KWP2000_5BAUD       0x02
#define PROTO_KWP2000_FAST        0x04
#define PROTO_KWP2000_SLOW        0x05
#define PROTO_CAN_11_500          0x06
#define PROTO_CAN_29_500          0x07
#define PROTO_CAN_11_250          0x08
#define PROTO_CAN_29_250          0x09

// Status Codes
#define STATUS_SUCCESS            0x00
#define STATUS_NO_VOLTAGE         0x01
#define STATUS_INIT_FAILED        0x02
#define STATUS_KEYBYTE_MISMATCH   0x03
#define STATUS_ECU_NO_RESPONSE    0x04
#define STATUS_CHECKSUM_ERROR     0x05

// Binary Protocol Framing
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

enum ActiveTransport {
  TRANSPORT_NONE = 0,
  TRANSPORT_BLUETOOTH = 1,
  TRANSPORT_WIFI = 2
};

// Global ELM327 State
struct Elm327Config {
  bool echo;
  bool linefeed;
  bool headers;
  bool spaces;
  uint8_t protocol;       // 0=Auto, 1=ISO9141, 4=KWP Fast, 5=KWP Slow, 6=CAN 11/500, 7=CAN 29/500, 8=CAN 11/250, 9=CAN 29/250
  uint8_t activeProtocol; // Currently resolved protocol
  bool protocolResolved;  // MUST only be true after real ECU response!
  uint32_t headerId;
  uint32_t filterId;
  bool isExtended;
  uint16_t timeoutMs;
  bool allowLongMsgs;
  bool autoFormatting;
} elmConfig = {true, true, false, true, 0, 6, false, 0x7E0, 0x7E8, false, 300, false, true};

// Global Hardware & Transport State
BluetoothSerial SerialBT;
WiFiServer tcpServer(TCP_SERVER_PORT);
WiFiClient tcpClient;

bool btSubscribedCan = false;
bool wifiSubscribedCan = false;

uint32_t currentCanSpeedKbps = CAN_DEFAULT_SPEED_KBPS;

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

struct KlineState {
  bool initialized;
  uint8_t activeProtocol;
  uint8_t keyByte1;
  uint8_t keyByte2;
  uint16_t rxErrorCount;
  uint16_t txErrorCount;
  uint8_t lastErrorCode;
} klineState = {false, PROTO_ISO9141_SLOW, 0x00, 0x00, 0, 0, STATUS_SUCCESS};

#define RX_STREAM_BUF_SIZE 1024
uint8_t wifiRxBuf[RX_STREAM_BUF_SIZE];
size_t wifiRxHead = 0;

uint8_t btRxBuf[RX_STREAM_BUF_SIZE];
size_t btRxHead = 0;

// ISO-TP Engine Definitions (Max ISO-TP standard length is 4095 bytes)
#define ISO_TP_MAX_BUF_SIZE 4095

struct IsoTpTransaction {
  bool active;
  ActiveTransport requestingTransport; // Track originating transport for responses
  bool isTx;                           // true if sending to ECU, false if receiving from ECU
  uint32_t reqHeaderId;
  uint32_t expectedRxId;
  bool isExtended;
  
  uint8_t buffer[ISO_TP_MAX_BUF_SIZE];
  size_t totalLen;
  size_t currentLen;
  
  uint8_t expectedSn;         // Sequence number expected (1..15, 0..15)
  uint8_t blockSize;          // Block Size requested
  uint8_t stMin;              // STmin requested
  uint8_t framesInCurrentBlock;
  uint8_t fcWaitCount;        // Count of FC WAIT frames (max 10)
  
  bool waitFc;                // Waiting for Flow Control frame
  uint8_t fcStatus;           // 0=CTS, 1=WAIT, 2=OVERFLOW
  bool gotFc;
  
  unsigned long startTime;
  uint32_t timeoutMs;
  
  bool completed;
  bool failed;
  const char* errorMsg;
} isoTp = {false, TRANSPORT_NONE, false, 0, 0, false, {0}, 0, 0, 1, 0, 0, 0, 0, false, 0, false, 0, 300, false, false, NULL};

// Function Declarations
void initCAN(uint32_t speedKbps);
void dispatchCanRx();
void processIsoTpRxFrame(const twai_message_t& rxMsg);
void executeIsoTpTransaction(const uint8_t* txBytes, size_t txLen, ActiveTransport transport);

bool checkKlineIdleState();
size_t stripTxEcho(const uint8_t* txBuf, size_t txLen, const uint8_t* rawRxBuf, size_t rawRxLen, uint8_t* cleanRxBuf);
uint8_t initKlineIso9141();
uint8_t initKlineKwpFast();
uint8_t transceiveKlineFrame(const uint8_t* txData, size_t txLen, uint8_t* rxBuf, size_t& rxLen, uint32_t timeoutMs);

void processStreamBuffer(uint8_t* buffer, size_t& head, ActiveTransport transport);
void handleParsedCommand(uint8_t cmd, uint16_t len, const uint8_t* payload, ActiveTransport transport);
void sendBinaryPacket(uint8_t cmd, const uint8_t* payload, uint16_t len, ActiveTransport transport);
void broadcastBinaryPacket(uint8_t cmd, const uint8_t* payload, uint16_t len);
void sendPong(ActiveTransport transport);
void sendCanStatus(ActiveTransport transport);
void sendKlineStatus(ActiveTransport transport);
uint8_t calculateChecksum(uint8_t cmd, uint16_t len, const uint8_t* payload);

void processElmLine(const char* line, ActiveTransport transport);
void sendElmResponse(const char* resp, ActiveTransport transport);
void sendElmResponseChunk(const char* chunk, ActiveTransport transport);

// ----------------------------------------------------------------------------
// K-Line Physical Driver (ISO 9141-2 / ISO 14230-4 KWP2000)
// ----------------------------------------------------------------------------
bool checkKlineIdleState() {
  pinMode(KLINE_RX_PIN, INPUT_PULLUP);
  int lowCount = 0;
  for (int i = 0; i < 50; i++) {
    if (digitalRead(KLINE_RX_PIN) == LOW) lowCount++;
    delayMicroseconds(1000);
  }
  return lowCount < 40;
}

size_t stripTxEcho(const uint8_t* txBuf, size_t txLen, const uint8_t* rawRxBuf, size_t rawRxLen, uint8_t* cleanRxBuf) {
  size_t echoCount = 0;
  while (echoCount < txLen && echoCount < rawRxLen) {
    if (rawRxBuf[echoCount] == txBuf[echoCount]) echoCount++;
    else break;
  }
  size_t cleanLen = 0;
  for (size_t i = echoCount; i < rawRxLen; i++) {
    cleanRxBuf[cleanLen++] = rawRxBuf[i];
  }
  return cleanLen;
}

uint8_t initKlineIso9141() {
  if (!checkKlineIdleState()) {
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = STATUS_NO_VOLTAGE;
    return STATUS_NO_VOLTAGE;
  }

  Serial2.end();
  pinMode(KLINE_TX_PIN, OUTPUT);
  digitalWrite(KLINE_TX_PIN, HIGH);
  delay(300);

  // 5-Baud Slow Init (0x33 = 01100110b with start/stop)
  uint8_t addrBits[10] = {0, 1, 1, 0, 0, 1, 1, 0, 0, 1};
  for (int i = 0; i < 10; i++) {
    digitalWrite(KLINE_TX_PIN, addrBits[i] ? HIGH : LOW);
    delay(200);
  }
  digitalWrite(KLINE_TX_PIN, HIGH);

  Serial2.begin(KLINE_BAUDRATE, SERIAL_8N1, KLINE_RX_PIN, KLINE_TX_PIN);

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
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = STATUS_INIT_FAILED;
    return STATUS_INIT_FAILED;
  }

  uint8_t kb1 = 0, kb2 = 0;
  t0 = millis();
  while ((millis() - t0) < 300 && !Serial2.available()) delay(1);
  if (Serial2.available()) kb1 = Serial2.read();

  t0 = millis();
  while ((millis() - t0) < 300 && !Serial2.available()) delay(1);
  if (Serial2.available()) kb2 = Serial2.read();

  if (kb1 == 0 || kb2 == 0) {
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = STATUS_ECU_NO_RESPONSE;
    return STATUS_ECU_NO_RESPONSE;
  }

  delay(30);

  uint8_t invKb2 = ~kb2;
  Serial2.write(invKb2);

  t0 = millis();
  while ((millis() - t0) < 50) {
    if (Serial2.available()) {
      uint8_t echo = Serial2.read();
      if (echo == invKb2) break;
    }
    delay(1);
  }

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
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = STATUS_INIT_FAILED;
    return STATUS_INIT_FAILED;
  }

  if ((kb1 == 0x8F && kb2 == 0x27) || ((kb2 & 0x80) && kb2 != 0xEA)) {
    klineState.activeProtocol = PROTO_KWP2000_SLOW;
  } else {
    klineState.activeProtocol = PROTO_ISO9141_SLOW;
  }

  klineState.initialized = true;
  klineState.keyByte1 = kb1;
  klineState.keyByte2 = kb2;
  klineState.lastErrorCode = STATUS_SUCCESS;
  elmConfig.activeProtocol = klineState.activeProtocol;
  elmConfig.protocolResolved = true;
  return STATUS_SUCCESS;
}

uint8_t initKlineKwpFast() {
  if (!checkKlineIdleState()) {
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = STATUS_NO_VOLTAGE;
    return STATUS_NO_VOLTAGE;
  }

  Serial2.end();
  pinMode(KLINE_TX_PIN, OUTPUT);
  digitalWrite(KLINE_TX_PIN, HIGH);
  delay(300);

  // Fast Init Pulse (25ms LOW, 25ms HIGH)
  digitalWrite(KLINE_TX_PIN, LOW);
  delay(25);
  digitalWrite(KLINE_TX_PIN, HIGH);
  delay(25);

  Serial2.begin(KLINE_BAUDRATE, SERIAL_8N1, KLINE_RX_PIN, KLINE_TX_PIN);

  uint8_t startCommReq[5] = {0xC1, 0x33, 0xF1, 0x81, 0x66};
  Serial2.write(startCommReq, 5);

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

  uint8_t cleanRx[32];
  size_t cleanRxLen = stripTxEcho(startCommReq, 5, rawRx, rawRxLen, cleanRx);

  if (cleanRxLen < 5) {
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = STATUS_ECU_NO_RESPONSE;
    return STATUS_ECU_NO_RESPONSE;
  }

  uint8_t cs = 0;
  for (size_t i = 0; i < cleanRxLen - 1; i++) cs += cleanRx[i];

  if (cs != cleanRx[cleanRxLen - 1]) {
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = STATUS_CHECKSUM_ERROR;
    return STATUS_CHECKSUM_ERROR;
  }

  klineState.initialized = true;
  klineState.activeProtocol = PROTO_KWP2000_FAST;
  klineState.keyByte1 = cleanRxLen >= 6 ? cleanRx[4] : 0x00;
  klineState.keyByte2 = cleanRxLen >= 7 ? cleanRx[5] : 0x00;
  klineState.lastErrorCode = STATUS_SUCCESS;
  elmConfig.activeProtocol = PROTO_KWP2000_FAST;
  elmConfig.protocolResolved = true;
  return STATUS_SUCCESS;
}

uint8_t transceiveKlineFrame(const uint8_t* txData, size_t txLen, uint8_t* rxBuf, size_t& rxLen, uint32_t timeoutMs) {
  if (!klineState.initialized) {
    if (initKlineKwpFast() != STATUS_SUCCESS) {
      if (initKlineIso9141() != STATUS_SUCCESS) {
        return klineState.lastErrorCode;
      }
    }
  }

  uint8_t frameTx[64];
  size_t frameTxLen = 0;

  if (klineState.activeProtocol == PROTO_ISO9141_SLOW) {
    frameTx[0] = 0x68;
    frameTx[1] = 0x6A;
    frameTx[2] = 0xF1;
    for (size_t i = 0; i < txLen && i < 58; i++) frameTx[3 + i] = txData[i];
    frameTxLen = 3 + min(txLen, (size_t)58);

    uint8_t cs = 0;
    for (size_t i = 0; i < frameTxLen; i++) cs += frameTx[i];
    frameTx[frameTxLen++] = cs;
  } else {
    frameTx[0] = 0x80 | (txLen & 0x3F);
    frameTx[1] = 0x33;
    frameTx[2] = 0xF1;
    for (size_t i = 0; i < txLen && i < 58; i++) frameTx[3 + i] = txData[i];
    frameTxLen = 3 + min(txLen, (size_t)58);

    uint8_t cs = 0;
    for (size_t i = 0; i < frameTxLen; i++) cs += frameTx[i];
    frameTx[frameTxLen++] = cs;
  }

  Serial2.write(frameTx, frameTxLen);

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

  uint8_t cleanRx[128];
  size_t cleanRxLen = stripTxEcho(frameTx, frameTxLen, rawRx, rawRxLen, cleanRx);

  if (cleanRxLen == 0) {
    klineState.rxErrorCount++;
    klineState.lastErrorCode = STATUS_ECU_NO_RESPONSE;
    return STATUS_ECU_NO_RESPONSE;
  }

  uint8_t rxCs = 0;
  for (size_t i = 0; i < cleanRxLen - 1; i++) rxCs += cleanRx[i];

  if (rxCs != cleanRx[cleanRxLen - 1]) {
    klineState.rxErrorCount++;
    klineState.lastErrorCode = STATUS_CHECKSUM_ERROR;
    return STATUS_CHECKSUM_ERROR;
  }

  rxLen = cleanRxLen;
  for (size_t i = 0; i < cleanRxLen; i++) rxBuf[i] = cleanRx[i];

  klineState.lastErrorCode = STATUS_SUCCESS;
  return STATUS_SUCCESS;
}

// ----------------------------------------------------------------------------
// TWAI (CAN Hardware Driver) & Recovery State Machine
// ----------------------------------------------------------------------------
void initCAN(uint32_t speedKbps) {
  twai_stop();
  twai_driver_uninstall();

  twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(CAN_TX_PIN, CAN_RX_PIN, TWAI_MODE_NORMAL);
  g_config.rx_queue_len = 64;
  g_config.tx_queue_len = 32;

  twai_timing_config_t t_config;
  if (speedKbps == 1000) {
    t_config = TWAI_TIMING_CONFIG_1MBITS();
  } else if (speedKbps == 250) {
    t_config = TWAI_TIMING_CONFIG_250KBITS();
  } else if (speedKbps == 125) {
    t_config = TWAI_TIMING_CONFIG_125KBITS();
  } else {
    t_config = TWAI_TIMING_CONFIG_500KBITS();
    speedKbps = 500;
  }

  // Acceptance Filter: promiscuous receive for diagnosis, software filtered in dispatch
  twai_filter_config_t f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();

  if (twai_driver_install(&g_config, &t_config, &f_config) == ESP_OK) {
    if (twai_start() == ESP_OK) {
      stats.canInitialized = true;
      currentCanSpeedKbps = speedKbps;
      return;
    }
  }
  stats.canInitialized = false;
}

// ----------------------------------------------------------------------------
// Central CAN RX Dispatcher & ISO-TP Decoder
// ----------------------------------------------------------------------------
void processIsoTpRxFrame(const twai_message_t& rxMsg) {
  if (!isoTp.active) return;

  // Filter matching CAN ID
  if (rxMsg.identifier != isoTp.expectedRxId) {
    // Check functional response range (0x7DF -> 0x7E8..0x7EF)
    if (!(isoTp.reqHeaderId == 0x7DF && rxMsg.identifier >= 0x7E8 && rxMsg.identifier <= 0x7EF)) {
      return;
    }
  }

  uint8_t dlc = rxMsg.data_length_code > 8 ? 8 : rxMsg.data_length_code;
  if (dlc < 1) return;

  uint8_t pci = rxMsg.data[0];
  uint8_t frameType = (pci >> 4) & 0x0F;

  // Case A: Waiting for Flow Control frame from ECU during TX
  if (isoTp.isTx && isoTp.waitFc) {
    if (frameType == 0x3) { // Flow Control Frame
      uint8_t fcStatus = pci & 0x0F;
      isoTp.fcStatus = fcStatus;
      if (fcStatus == 0x0) { // CTS - Continue To Send
        isoTp.blockSize = rxMsg.data[1];
        isoTp.stMin = rxMsg.data[2];
        isoTp.gotFc = true;
        isoTp.waitFc = false;
        isoTp.fcWaitCount = 0;
        isoTp.startTime = millis();
      } else if (fcStatus == 0x1) { // WAIT - Reset phase timer
        isoTp.fcWaitCount++;
        if (isoTp.fcWaitCount > 10) {
          isoTp.failed = true;
          isoTp.errorMsg = "TOO MANY WAIT";
          isoTp.active = false;
        } else {
          isoTp.startTime = millis();
        }
      } else if (fcStatus == 0x2) { // OVERFLOW
        isoTp.failed = true;
        isoTp.errorMsg = "OVERFLOW";
        isoTp.active = false;
      } else { // Invalid FC Status
        isoTp.failed = true;
        isoTp.errorMsg = "INVALID FC";
        isoTp.active = false;
      }
    }
    return;
  }

  // Case B: Receiving ISO-TP Payload from ECU (SF, FF, CF)
  if (!isoTp.isTx) {
    if (frameType == 0x0) { // Single Frame (SF)
      uint8_t sfLen = pci & 0x0F;
      if (sfLen > 0 && sfLen <= 7 && sfLen <= (dlc - 1)) {
        for (uint8_t b = 0; b < sfLen; b++) {
          isoTp.buffer[b] = rxMsg.data[1 + b];
        }
        isoTp.totalLen = sfLen;
        isoTp.currentLen = sfLen;
        isoTp.completed = true;
        isoTp.active = false;

        // Protocol resolved ONLY upon real ECU response!
        elmConfig.protocolResolved = true;
        if (elmConfig.protocol == 0) {
          elmConfig.activeProtocol = (isoTp.isExtended) ? PROTO_CAN_29_500 : PROTO_CAN_11_500;
        }
      } else {
        isoTp.failed = true;
        isoTp.errorMsg = "INVALID SF";
        isoTp.active = false;
      }
    } else if (frameType == 0x1) { // First Frame (FF)
      if (dlc < 8) return;
      uint16_t ffLen = ((uint16_t)(pci & 0x0F) << 8) | rxMsg.data[1];

      // Verify FF length limits (8..4095)
      if (ffLen < 8 || ffLen > ISO_TP_MAX_BUF_SIZE) {
        // Send FC OVERFLOW (0x32)
        uint32_t fcCanId = (isoTp.reqHeaderId == 0x7DF) ? (rxMsg.identifier - 8) : isoTp.reqHeaderId;
        twai_message_t fcMsg;
        memset(&fcMsg, 0, sizeof(fcMsg));
        fcMsg.identifier = fcCanId;
        fcMsg.extd = isoTp.isExtended ? 1 : 0;
        fcMsg.data_length_code = 8;
        fcMsg.data[0] = 0x32; // FC OVERFLOW
        fcMsg.data[1] = 0x00;
        fcMsg.data[2] = 0x00;
        for (int b = 3; b < 8; b++) fcMsg.data[b] = 0xCC;
        twai_transmit(&fcMsg, pdMS_TO_TICKS(20));

        isoTp.failed = true;
        isoTp.errorMsg = "INVALID FF LEN";
        isoTp.active = false;
        return;
      }

      // Copy first 6 payload bytes
      for (uint8_t b = 0; b < 6; b++) {
        isoTp.buffer[b] = rxMsg.data[2 + b];
      }
      isoTp.totalLen = ffLen;
      isoTp.currentLen = 6;
      isoTp.expectedSn = 1;
      isoTp.framesInCurrentBlock = 0;

      // Determine correct FC CAN ID
      uint32_t fcCanId = (isoTp.reqHeaderId == 0x7DF) ? (rxMsg.identifier - 8) : isoTp.reqHeaderId;

      // Send Flow Control CTS (0x30)
      twai_message_t fcMsg;
      memset(&fcMsg, 0, sizeof(fcMsg));
      fcMsg.identifier = fcCanId;
      fcMsg.extd = isoTp.isExtended ? 1 : 0;
      fcMsg.data_length_code = 8;
      fcMsg.data[0] = 0x30; // FC CTS
      fcMsg.data[1] = 0x00; // BS = 0 (Unlimited block size)
      fcMsg.data[2] = 0x00; // STmin = 0 ms
      for (int b = 3; b < 8; b++) fcMsg.data[b] = 0xCC;
      twai_transmit(&fcMsg, pdMS_TO_TICKS(20));

      isoTp.startTime = millis();
      
      // Protocol resolved ONLY upon real ECU response!
      elmConfig.protocolResolved = true;
      if (elmConfig.protocol == 0) {
        elmConfig.activeProtocol = (isoTp.isExtended) ? PROTO_CAN_29_500 : PROTO_CAN_11_500;
      }

    } else if (frameType == 0x2) { // Consecutive Frame (CF)
      if (isoTp.totalLen == 0) return;
      uint8_t sn = pci & 0x0F;

      // Verify Sequence Number
      if (sn != isoTp.expectedSn) {
        isoTp.failed = true;
        isoTp.errorMsg = "SEQ MISMATCH";
        isoTp.active = false;
        return;
      }

      // Next expected sequence number (1..F, 0..F...)
      isoTp.expectedSn = (isoTp.expectedSn + 1) & 0x0F;

      size_t copyBytes = dlc - 1;
      if (isoTp.currentLen + copyBytes > isoTp.totalLen) {
        copyBytes = isoTp.totalLen - isoTp.currentLen;
      }

      if (isoTp.currentLen + copyBytes > ISO_TP_MAX_BUF_SIZE) {
        isoTp.failed = true;
        isoTp.errorMsg = "BUF OVERFLOW";
        isoTp.active = false;
        return;
      }

      for (size_t b = 0; b < copyBytes; b++) {
        isoTp.buffer[isoTp.currentLen++] = rxMsg.data[1 + b];
      }

      isoTp.framesInCurrentBlock++;
      isoTp.startTime = millis();

      if (isoTp.currentLen >= isoTp.totalLen) {
        isoTp.completed = true;
        isoTp.active = false;
      } else if (isoTp.blockSize != 0 && isoTp.framesInCurrentBlock >= isoTp.blockSize) {
        // Block completed: send another FC CTS
        uint32_t fcCanId = (isoTp.reqHeaderId == 0x7DF) ? (rxMsg.identifier - 8) : isoTp.reqHeaderId;
        twai_message_t fcMsg;
        memset(&fcMsg, 0, sizeof(fcMsg));
        fcMsg.identifier = fcCanId;
        fcMsg.extd = isoTp.isExtended ? 1 : 0;
        fcMsg.data_length_code = 8;
        fcMsg.data[0] = 0x30; // FC CTS
        fcMsg.data[1] = isoTp.blockSize;
        fcMsg.data[2] = isoTp.stMin;
        for (int b = 3; b < 8; b++) fcMsg.data[b] = 0xCC;
        twai_transmit(&fcMsg, pdMS_TO_TICKS(20));

        isoTp.framesInCurrentBlock = 0;
      }
    }
  }
}

void dispatchCanRx() {
  twai_status_info_t s_info;
  esp_err_t statusErr = twai_get_status_info(&s_info);

  if (statusErr != ESP_OK) {
    stats.canInitialized = false;
    return;
  }

  // TWAI State Machine Bus-Off Recovery handling
  if (s_info.state == TWAI_STATE_BUS_OFF) {
    stats.canInitialized = false;
    twai_initiate_recovery();
    return;
  } else if (s_info.state == TWAI_STATE_RECOVERING) {
    // Hardware recovery in progress: wait for transition to TWAI_STATE_STOPPED, DO NOT call twai_start()
    stats.canInitialized = false;
    return;
  } else if (s_info.state == TWAI_STATE_STOPPED) {
    stats.canInitialized = false;
    if (twai_start() == ESP_OK) {
      stats.canInitialized = true;
    }
    return;
  } else if (s_info.state != TWAI_STATE_RUNNING) {
    stats.canInitialized = false;
    return;
  }

  stats.canInitialized = true;
  twai_message_t rxMsg;
  int drainLimit = 0;

  // Single central entry point for twai_receive()
  while (twai_receive(&rxMsg, 0) == ESP_OK && drainLimit < 32) {
    drainLimit++;
    stats.messagesReceived++;

    uint8_t dlc = (rxMsg.data_length_code > 8) ? 8 : rxMsg.data_length_code;
    uint8_t payload[14];
    payload[0] = (rxMsg.identifier >> 24) & 0xFF;
    payload[1] = (rxMsg.identifier >> 16) & 0xFF;
    payload[2] = (rxMsg.identifier >> 8) & 0xFF;
    payload[3] = rxMsg.identifier & 0xFF;
    payload[4] = (rxMsg.extd ? 0x01 : 0x00) | (rxMsg.rtr ? 0x02 : 0x00);
    payload[5] = dlc;

    for (uint8_t b = 0; b < dlc; b++) {
      payload[6 + b] = rxMsg.data[b];
    }

    // Broadcast raw CAN frame to binary protocol subscribers
    broadcastBinaryPacket(CMD_CAN_FRAME, payload, 6 + dlc);

    // Route frame to active ISO-TP transaction engine
    if (isoTp.active) {
      processIsoTpRxFrame(rxMsg);
    }
  }
}

// ----------------------------------------------------------------------------
// System Setup & Main Loop
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  // Initialize CAN Hardware (TWAI)
  initCAN(CAN_DEFAULT_SPEED_KBPS);

  // Initialize Bluetooth Classic SPP
  if (SerialBT.begin(BT_DEVICE_NAME)) {
    stats.btConnected = false;
  }

  // Initialize Wi-Fi Access Point & TCP Server
  IPAddress local_ip(192, 168, 4, 1);
  IPAddress gateway(192, 168, 4, 1);
  IPAddress subnet(255, 255, 255, 0);
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(local_ip, gateway, subnet);
  if (WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASS)) {
    tcpServer.begin();
    tcpServer.setNoDelay(true);
  }

  adc1_config_width(ADC_WIDTH_BIT_12);
  adc1_config_channel_atten(ADC1_CHANNEL_6, ADC_ATTEN_DB_11);
}

void loop() {
  // 1. Accept Wi-Fi Client
  if (tcpServer.hasClient()) {
    if (!tcpClient || !tcpClient.connected()) {
      if (tcpClient) tcpClient.stop();
      tcpClient = tcpServer.available();
      tcpClient.setNoDelay(true);
      stats.wifiClientConnected = true;
    }
  }

  // 2. Process Wi-Fi Data Stream
  if (tcpClient && tcpClient.connected()) {
    while (tcpClient.available()) {
      if (wifiRxHead < RX_STREAM_BUF_SIZE) {
        wifiRxBuf[wifiRxHead++] = tcpClient.read();
      } else {
        wifiRxHead = 0;
      }
    }
    if (wifiRxHead > 0) {
      processStreamBuffer(wifiRxBuf, wifiRxHead, TRANSPORT_WIFI);
    }
  } else {
    stats.wifiClientConnected = false;
  }

  // 3. Process Bluetooth SPP Data Stream
  if (SerialBT.available()) {
    while (SerialBT.available()) {
      if (btRxHead < RX_STREAM_BUF_SIZE) {
        btRxBuf[btRxHead++] = SerialBT.read();
      } else {
        btRxHead = 0;
      }
    }
    if (btRxHead > 0) {
      processStreamBuffer(btRxBuf, btRxHead, TRANSPORT_BLUETOOTH);
    }
  }

  // 4. Central CAN RX Dispatcher
  dispatchCanRx();

  yield();
}

// ----------------------------------------------------------------------------
// Protocol Parser Router (HAMZA Binary vs ELM327 ASCII)
// ----------------------------------------------------------------------------
uint8_t calculateChecksum(uint8_t cmd, uint16_t len, const uint8_t* payload) {
  uint8_t cs = cmd ^ ((len >> 8) & 0xFF) ^ (len & 0xFF);
  for (uint16_t i = 0; i < len; i++) cs ^= payload[i];
  return cs;
}

void processStreamBuffer(uint8_t* buffer, size_t& head, ActiveTransport transport) {
  size_t i = 0;

  while (i < head) {
    // A. HAMZA Binary Framing Protocol Check (Magic 0xAA 0x55)
    if (i + 8 <= head && buffer[i] == PROTOCOL_MAGIC_1 && buffer[i + 1] == PROTOCOL_MAGIC_2) {
      uint8_t cmd = buffer[i + 2];
      uint16_t len = ((uint16_t)buffer[i + 3] << 8) | buffer[i + 4];

      if (len <= 256) {
        size_t totalPacketLen = 2 + 1 + 2 + len + 1 + 2;
        if (i + totalPacketLen <= head) {
          const uint8_t* payload = &buffer[i + 5];
          uint8_t checksum = buffer[i + 5 + len];
          uint8_t tr1 = buffer[i + 5 + len + 1];
          uint8_t tr2 = buffer[i + 5 + len + 2];

          if (tr1 == PROTOCOL_TRAILER_1 && tr2 == PROTOCOL_TRAILER_2) {
            if (checksum == calculateChecksum(cmd, len, payload)) {
              handleParsedCommand(cmd, len, payload, transport);
              i += totalPacketLen;
              continue;
            }
          }
        } else {
          // Partial binary frame, wait for rest
          break;
        }
      }
    }

    // B. ELM327 ASCII / Text Line Check (Terminated by \r or \n)
    size_t lineEnd = i;
    bool foundLine = false;
    while (lineEnd < head) {
      if (buffer[lineEnd] == '\r' || buffer[lineEnd] == '\n') {
        foundLine = true;
        break;
      }
      lineEnd++;
    }

    if (foundLine) {
      size_t lineLen = lineEnd - i;
      if (lineLen > 0 && lineLen < 128) {
        char lineBuf[128];
        memcpy(lineBuf, &buffer[i], lineLen);
        lineBuf[lineLen] = '\0';
        processElmLine(lineBuf, transport);
      }
      i = lineEnd;
      while (i < head && (buffer[i] == '\r' || buffer[i] == '\n')) {
        i++;
      }
      continue;
    }

    if (head >= RX_STREAM_BUF_SIZE - 1) {
      i++;
    } else {
      break;
    }
  }

  if (i > 0) {
    size_t remaining = head - i;
    if (remaining > 0) {
      memmove(buffer, &buffer[i], remaining);
    }
    head = remaining;
  }
}

// ----------------------------------------------------------------------------
// HAMZA Binary Protocol Command Handler
// ----------------------------------------------------------------------------
void handleParsedCommand(uint8_t cmd, uint16_t len, const uint8_t* payload, ActiveTransport transport) {
  if (transport == TRANSPORT_BLUETOOTH) btSubscribedCan = true;
  if (transport == TRANSPORT_WIFI) wifiSubscribedCan = true;

  switch (cmd) {
    case CMD_CAN_FRAME: {
      if (len >= 6) {
        uint8_t dlc = payload[5];
        if (dlc <= 8 && len >= (uint16_t)(6 + dlc)) {
          twai_status_info_t s_info;
          if (twai_get_status_info(&s_info) == ESP_OK) {
            if (s_info.state == TWAI_STATE_BUS_OFF) {
              stats.canInitialized = false;
              stats.txErrorCount++;
              twai_initiate_recovery();
              break;
            } else if (s_info.state == TWAI_STATE_STOPPED) {
              twai_start();
              stats.canInitialized = true;
            }
          }

          uint32_t canId = ((uint32_t)payload[0] << 24) |
                           ((uint32_t)payload[1] << 16) |
                           ((uint32_t)payload[2] << 8)  |
                            (uint32_t)payload[3];
          uint8_t flags = payload[4];
          bool isExtended = (flags & 0x01) != 0;
          bool isRtr = (flags & 0x02) != 0;

          // Reject invalid CAN IDs or unsupported flags
          if (isExtended && canId > 0x1FFFFFFF) break;
          if (!isExtended && canId > 0x7FF) break;
          if (flags & 0xFC) break;

          twai_message_t txMsg;
          memset(&txMsg, 0, sizeof(txMsg));
          txMsg.identifier = canId;
          txMsg.extd = isExtended ? 1 : 0;
          txMsg.rtr = isRtr ? 1 : 0;
          txMsg.data_length_code = dlc;

          for (uint8_t b = 0; b < dlc; b++) {
            txMsg.data[b] = payload[6 + b];
          }

          esp_err_t err = twai_transmit(&txMsg, pdMS_TO_TICKS(20));
          if (err == ESP_OK) {
            stats.messagesSent++;
          } else {
            stats.txErrorCount++;
            if (twai_get_status_info(&s_info) == ESP_OK && s_info.state == TWAI_STATE_BUS_OFF) {
              stats.canInitialized = false;
              twai_initiate_recovery();
            }
          }
        }
      }
      break;
    }

    case CMD_PING: {
      sendPong(transport);
      break;
    }

    case CMD_CAN_STATUS_REQ: {
      sendCanStatus(transport);
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
        elmConfig.protocol = protoId;
        elmConfig.protocolResolved = false; // MUST NOT mark resolved until real ECU response
        if (protoId == PROTO_CAN_11_500 || protoId == PROTO_CAN_29_500) {
          initCAN(500);
          elmConfig.isExtended = (protoId == PROTO_CAN_29_500);
          elmConfig.activeProtocol = protoId;
        } else if (protoId == PROTO_CAN_11_250 || protoId == PROTO_CAN_29_250) {
          initCAN(250);
          elmConfig.isExtended = (protoId == PROTO_CAN_29_250);
          elmConfig.activeProtocol = protoId;
        } else if (protoId == PROTO_KWP2000_FAST) {
          initKlineKwpFast();
        } else if (protoId == PROTO_ISO9141_SLOW || protoId == PROTO_KWP2000_SLOW) {
          initKlineIso9141();
        }
      }
      break;
    }

    case CMD_KLINE_INIT: {
      uint8_t protoId = (len >= 1) ? payload[0] : PROTO_AUTO;
      uint8_t status = STATUS_INIT_FAILED;
      if (protoId == PROTO_KWP2000_FAST) {
        status = initKlineKwpFast();
      } else if (protoId == PROTO_ISO9141_SLOW || protoId == PROTO_KWP2000_SLOW) {
        status = initKlineIso9141();
      } else {
        status = initKlineKwpFast();
        if (status != STATUS_SUCCESS) status = initKlineIso9141();
      }
      uint8_t respPayload[4];
      respPayload[0] = status;
      respPayload[1] = klineState.activeProtocol;
      respPayload[2] = klineState.keyByte1;
      respPayload[3] = klineState.keyByte2;
      sendBinaryPacket(CMD_KLINE_INIT_RESP, respPayload, 4, transport);
      break;
    }

    case CMD_KLINE_FRAME: {
      if (len >= 1) {
        uint8_t rxBuf[64];
        size_t rxLen = 0;
        uint8_t status = transceiveKlineFrame(payload, len, rxBuf, rxLen, 500);
        uint8_t respBuf[65];
        respBuf[0] = status;
        for (size_t i = 0; i < rxLen && i < 64; i++) respBuf[1 + i] = rxBuf[i];
        sendBinaryPacket(CMD_KLINE_FRAME, respBuf, 1 + min(rxLen, (size_t)64), transport);
      }
      break;
    }

    case CMD_KLINE_STATUS_REQ: {
      sendKlineStatus(transport);
      break;
    }

    default:
      break;
  }
}

// ----------------------------------------------------------------------------
// ELM327 ASCII Command Engine & Streaming ISO-TP Multi-Frame Executor
// ----------------------------------------------------------------------------
void sendElmResponseChunk(const char* chunk, ActiveTransport transport) {
  if (transport == TRANSPORT_BLUETOOTH) {
    if (SerialBT.hasClient()) SerialBT.print(chunk);
  } else if (transport == TRANSPORT_WIFI) {
    if (tcpClient && tcpClient.connected()) tcpClient.print(chunk);
  }
}

void sendElmResponse(const char* resp, ActiveTransport transport) {
  sendElmResponseChunk(resp, transport);
}

void executeIsoTpTransaction(const uint8_t* txBytes, size_t txLen, ActiveTransport transport) {
  // Concurrency Lock: prevent race conditions if multiple clients send requests
  if (isoTp.active) {
    sendElmResponse("BUSY\r\n>", transport);
    return;
  }

  uint8_t activeP = (elmConfig.protocol == 0) ? elmConfig.activeProtocol : elmConfig.protocol;
  if (activeP == 1 || activeP == 4 || activeP == 5) {
    // K-Line execution
    uint8_t rxBuf[128];
    size_t rxLen = 0;
    uint8_t status = transceiveKlineFrame(txBytes, txLen, rxBuf, rxLen, elmConfig.timeoutMs);
    if (status == STATUS_SUCCESS && rxLen > 0) {
      elmConfig.protocolResolved = true;
      char chunk[128];
      size_t chunkPos = 0;
      for (size_t b = 0; b < rxLen; b++) {
        chunkPos += sprintf(chunk + chunkPos, "%02X", rxBuf[b]);
        if (elmConfig.spaces && b < rxLen - 1) chunkPos += sprintf(chunk + chunkPos, " ");
        if (chunkPos >= 100) {
          sendElmResponseChunk(chunk, transport);
          chunkPos = 0;
        }
      }
      if (chunkPos > 0) sendElmResponseChunk(chunk, transport);
      sendElmResponse("\r\n>", transport);
    } else {
      sendElmResponse("NO DATA\r\n>", transport);
    }
    return;
  }

  // CAN ISO-TP Execution
  twai_status_info_t s_info;
  if (twai_get_status_info(&s_info) != ESP_OK || s_info.state != TWAI_STATE_RUNNING) {
    sendElmResponse("CAN ERROR\r\n>", transport);
    return;
  }

  if (txLen == 0 || txLen > ISO_TP_MAX_BUF_SIZE) {
    sendElmResponse("?\r\n>", transport);
    return;
  }

  // Set up IsoTpTransaction
  isoTp.active = true;
  isoTp.requestingTransport = transport;
  isoTp.isTx = false;

  // Header selection logic:
  // Services 0x01-0x08 -> Functional broadcast (0x7DF or 0x18DB33F1)
  // Services 0x09+ (e.g. 09 02 VIN), Mode 0A, and UDS (0x10-0x87) -> Physical address (0x7E0 or 0x18DA10F1)
  if (elmConfig.isExtended) {
    if (txLen >= 1 && txBytes[0] <= 0x08) {
      isoTp.reqHeaderId = 0x18DB33F1;
    } else if (txLen >= 1) {
      isoTp.reqHeaderId = 0x18DA10F1;
    } else {
      isoTp.reqHeaderId = elmConfig.headerId;
    }
    uint32_t base = isoTp.reqHeaderId & 0xFFFF0000;
    uint8_t target = (isoTp.reqHeaderId >> 8) & 0xFF;
    uint8_t source = isoTp.reqHeaderId & 0xFF;
    isoTp.expectedRxId = base | ((uint32_t)source << 8) | target;
  } else {
    if (txLen >= 1 && txBytes[0] <= 0x08) {
      isoTp.reqHeaderId = 0x7DF;
    } else if (txLen >= 1) {
      isoTp.reqHeaderId = (elmConfig.headerId == 0x7DF) ? 0x7E0 : elmConfig.headerId;
    } else {
      isoTp.reqHeaderId = elmConfig.headerId;
    }
    isoTp.expectedRxId = (isoTp.reqHeaderId == 0x7DF) ? 0x7E8 : (isoTp.reqHeaderId + 8);
  }

  isoTp.isExtended = elmConfig.isExtended;
  isoTp.totalLen = 0;
  isoTp.currentLen = 0;
  isoTp.completed = false;
  isoTp.failed = false;
  isoTp.errorMsg = NULL;
  isoTp.fcWaitCount = 0;
  isoTp.startTime = millis();

  // UDS Service Timeout (5000ms for ISO 14229 services 0x10 - 0x87)
  if (txLen >= 1 && txBytes[0] >= 0x10 && txBytes[0] <= 0x87) {
    isoTp.timeoutMs = 5000;
  } else {
    isoTp.timeoutMs = elmConfig.timeoutMs;
  }

  if (txLen <= 7) {
    // Single Frame (SF)
    twai_message_t txMsg;
    memset(&txMsg, 0, sizeof(txMsg));
    txMsg.identifier = elmConfig.headerId;
    txMsg.extd = elmConfig.isExtended ? 1 : 0;
    txMsg.data_length_code = 8;
    txMsg.data[0] = txLen & 0x0F;
    for (size_t b = 0; b < txLen; b++) txMsg.data[1 + b] = txBytes[b];
    for (size_t b = 1 + txLen; b < 8; b++) txMsg.data[b] = 0xCC;

    esp_err_t err = twai_transmit(&txMsg, pdMS_TO_TICKS(50));
    if (err != ESP_OK) {
      isoTp.active = false;
      sendElmResponse("CAN ERROR\r\n>", transport);
      return;
    }
  } else {
    // Multi-frame TX: Send First Frame (FF)
    twai_message_t txMsg;
    memset(&txMsg, 0, sizeof(txMsg));
    txMsg.identifier = elmConfig.headerId;
    txMsg.extd = elmConfig.isExtended ? 1 : 0;
    txMsg.data_length_code = 8;
    txMsg.data[0] = 0x10 | ((txLen >> 8) & 0x0F);
    txMsg.data[1] = txLen & 0xFF;
    for (size_t b = 0; b < 6; b++) txMsg.data[2 + b] = txBytes[b];

    isoTp.isTx = true;
    isoTp.waitFc = true;
    isoTp.gotFc = false;

    esp_err_t err = twai_transmit(&txMsg, pdMS_TO_TICKS(50));
    if (err != ESP_OK) {
      isoTp.active = false;
      sendElmResponse("CAN ERROR\r\n>", transport);
      return;
    }

    // Wait for Flow Control (FC) from ECU via Dispatcher
    unsigned long fcStart = millis();
    while (isoTp.waitFc && !isoTp.failed && (millis() - fcStart < isoTp.timeoutMs)) {
      dispatchCanRx();
      yield();
    }

    if (!isoTp.gotFc || isoTp.failed) {
      isoTp.active = false;
      sendElmResponse("NO DATA\r\n>", transport);
      return;
    }

    // Send Consecutive Frames (CF)
    size_t bytesSent = 6;
    uint8_t seqNum = 1;
    uint8_t framesInBlock = 0;

    while (bytesSent < txLen && !isoTp.failed) {
      // Apply STmin delay
      if (isoTp.stMin <= 0x7F) {
        if (isoTp.stMin > 0) delay(isoTp.stMin);
      } else if (isoTp.stMin >= 0xF1 && isoTp.stMin <= 0xF9) {
        delayMicroseconds((isoTp.stMin & 0x0F) * 100);
      } else {
        delay(1);
      }

      // Check Block Size (BS)
      if (isoTp.blockSize != 0 && framesInBlock >= isoTp.blockSize) {
        isoTp.waitFc = true;
        isoTp.gotFc = false;
        unsigned long fcWait = millis();
        while (isoTp.waitFc && !isoTp.failed && (millis() - fcWait < isoTp.timeoutMs)) {
          dispatchCanRx();
          yield();
        }
        if (!isoTp.gotFc || isoTp.failed) break;
        framesInBlock = 0;
      }

      twai_message_t cfTx;
      memset(&cfTx, 0, sizeof(cfTx));
      cfTx.identifier = elmConfig.headerId;
      cfTx.extd = isoTp.isExtended ? 1 : 0;
      cfTx.data_length_code = 8;
      cfTx.data[0] = 0x20 | (seqNum & 0x0F);

      size_t chunk = min((size_t)7, txLen - bytesSent);
      for (size_t b = 0; b < chunk; b++) {
        cfTx.data[1 + b] = txBytes[bytesSent + b];
      }
      for (size_t b = 1 + chunk; b < 8; b++) {
        cfTx.data[b] = 0xCC;
      }

      twai_transmit(&cfTx, pdMS_TO_TICKS(20));
      bytesSent += chunk;
      seqNum = (seqNum + 1) & 0x0F;
      framesInBlock++;
    }

    // Switch to receiving ISO-TP payload from ECU
    isoTp.isTx = false;
    isoTp.startTime = millis();
  }

  // Loop waiting for ISO-TP RX Completion via Dispatcher
  while (isoTp.active && (millis() - isoTp.startTime < isoTp.timeoutMs)) {
    dispatchCanRx();
    yield();
  }

  isoTp.active = false;

  if (isoTp.completed && isoTp.currentLen > 0) {
    // Stream response chunk by chunk to avoid 12KB stack allocation
    if (elmConfig.headers) {
      char headerBuf[16];
      sprintf(headerBuf, "%03X ", (unsigned int)isoTp.expectedRxId);
      sendElmResponseChunk(headerBuf, transport);
    }

    char chunkBuf[128];
    size_t chunkPos = 0;

    for (size_t b = 0; b < isoTp.currentLen; b++) {
      chunkPos += sprintf(chunkBuf + chunkPos, "%02X", isoTp.buffer[b]);
      if (elmConfig.spaces && b < isoTp.currentLen - 1) {
        chunkPos += sprintf(chunkBuf + chunkPos, " ");
      }
      if (chunkPos >= 100) {
        sendElmResponseChunk(chunkBuf, transport);
        chunkPos = 0;
      }
    }
    if (chunkPos > 0) {
      sendElmResponseChunk(chunkBuf, transport);
    }
    sendElmResponse("\r\n>", transport);
  } else {
    sendElmResponse("NO DATA\r\n>", transport);
  }
}

void processElmLine(const char* rawLine, ActiveTransport transport) {
  char clean[128];
  size_t cIdx = 0;
  for (size_t i = 0; rawLine[i] != '\0' && cIdx < 127; i++) {
    if (rawLine[i] != ' ' && rawLine[i] != '\r' && rawLine[i] != '\n') {
      clean[cIdx++] = toupper((unsigned char)rawLine[i]);
    }
  }
  clean[cIdx] = '\0';

  if (cIdx == 0) return;

  if (elmConfig.echo) {
    sendElmResponse(rawLine, transport);
    sendElmResponse("\r", transport);
  }

  // AT Command Handling
  if (strncmp(clean, "AT", 2) == 0) {
    const char* cmd = clean + 2;
    if (strcmp(cmd, "Z") == 0 || strcmp(cmd, "WS") == 0) {
      elmConfig.echo = true;
      elmConfig.linefeed = true;
      elmConfig.headers = false;
      elmConfig.spaces = true;
      elmConfig.protocol = 0;
      elmConfig.activeProtocol = 6;
      elmConfig.protocolResolved = false;
      elmConfig.headerId = 0x7E0;
      elmConfig.isExtended = false;
      elmConfig.timeoutMs = 300;
      elmConfig.allowLongMsgs = false;
      elmConfig.autoFormatting = true;
      sendElmResponse("ELM327 v1.5\r\n>", transport);
    } else if (strcmp(cmd, "E0") == 0) {
      elmConfig.echo = false;
      sendElmResponse("OK\r\n>", transport);
    } else if (strcmp(cmd, "E1") == 0) {
      elmConfig.echo = true;
      sendElmResponse("OK\r\n>", transport);
    } else if (strcmp(cmd, "L0") == 0) {
      elmConfig.linefeed = false;
      sendElmResponse("OK\r\n>", transport);
    } else if (strcmp(cmd, "L1") == 0) {
      elmConfig.linefeed = true;
      sendElmResponse("OK\r\n>", transport);
    } else if (strcmp(cmd, "H0") == 0) {
      elmConfig.headers = false;
      sendElmResponse("OK\r\n>", transport);
    } else if (strcmp(cmd, "H1") == 0) {
      elmConfig.headers = true;
      sendElmResponse("OK\r\n>", transport);
    } else if (strcmp(cmd, "S0") == 0) {
      elmConfig.spaces = false;
      sendElmResponse("OK\r\n>", transport);
    } else if (strcmp(cmd, "S1") == 0) {
      elmConfig.spaces = true;
      sendElmResponse("OK\r\n>", transport);
    } else if (strcmp(cmd, "AL") == 0) {
      elmConfig.allowLongMsgs = true;
      sendElmResponse("OK\r\n>", transport);
    } else if (strcmp(cmd, "CAF0") == 0) {
      elmConfig.autoFormatting = false;
      sendElmResponse("OK\r\n>", transport);
    } else if (strcmp(cmd, "CAF1") == 0) {
      elmConfig.autoFormatting = true;
      sendElmResponse("OK\r\n>", transport);
    } else if (strncmp(cmd, "ST", 2) == 0) {
      if (strlen(cmd + 2) == 0) {
        sendElmResponse("?\r\n>", transport);
        return;
      }
      uint32_t val = strtoul(cmd + 2, NULL, 16);
      elmConfig.timeoutMs = (val == 0) ? 300 : (val * 4);
      sendElmResponse("OK\r\n>", transport);
    } else if (strncmp(cmd, "SP", 2) == 0) {
      const char* pStr = cmd + 2;
      if (strlen(pStr) != 1 || pStr[0] < '0' || pStr[0] > '9') {
        sendElmResponse("?\r\n>", transport);
        return;
      }
      uint8_t proto = pStr[0] - '0';
      elmConfig.protocol = proto;
      elmConfig.protocolResolved = false; // MUST NOT mark resolved until real ECU response
      if (proto == 6) { initCAN(500); elmConfig.isExtended = false; elmConfig.activeProtocol = 6; }
      else if (proto == 7) { initCAN(500); elmConfig.isExtended = true; elmConfig.activeProtocol = 7; }
      else if (proto == 8) { initCAN(250); elmConfig.isExtended = false; elmConfig.activeProtocol = 8; }
      else if (proto == 9) { initCAN(250); elmConfig.isExtended = true; elmConfig.activeProtocol = 9; }
      else if (proto == 1) { initKlineIso9141(); elmConfig.activeProtocol = 1; }
      else if (proto == 4) { initKlineKwpFast(); elmConfig.activeProtocol = 4; }
      else if (proto == 5) { initKlineIso9141(); elmConfig.activeProtocol = 5; }
      sendElmResponse("OK\r\n>", transport);
    } else if (strncmp(cmd, "SH", 2) == 0) {
      const char* hStr = cmd + 2;
      size_t hLen = strlen(hStr);
      if (hLen != 3 && hLen != 8) {
        sendElmResponse("?\r\n>", transport);
        return;
      }
      for (size_t k = 0; k < hLen; k++) {
        if (!isxdigit((unsigned char)hStr[k])) {
          sendElmResponse("?\r\n>", transport);
          return;
        }
      }
      uint32_t header = strtoul(hStr, NULL, 16);
      elmConfig.headerId = header;
      elmConfig.isExtended = (hLen == 8);
      sendElmResponse("OK\r\n>", transport);
    } else if (strcmp(cmd, "DP") == 0) {
      if (elmConfig.protocol == 0 && !elmConfig.protocolResolved) {
        sendElmResponse("AUTO, SEARCHING...\r\n>", transport);
      } else {
        uint8_t p = (elmConfig.protocol == 0) ? elmConfig.activeProtocol : elmConfig.protocol;
        char dpBuf[64];
        if (p == 6) strcpy(dpBuf, "ISO 15765-4 (CAN 11/500)");
        else if (p == 7) strcpy(dpBuf, "ISO 15765-4 (CAN 29/500)");
        else if (p == 8) strcpy(dpBuf, "ISO 15765-4 (CAN 11/250)");
        else if (p == 9) strcpy(dpBuf, "ISO 15765-4 (CAN 29/250)");
        else if (p == 1) strcpy(dpBuf, "ISO 9141-2");
        else if (p == 4) strcpy(dpBuf, "ISO 14230-4 (KWP FAST)");
        else if (p == 5) strcpy(dpBuf, "ISO 14230-4 (KWP SLOW)");
        else strcpy(dpBuf, "AUTO");

        if (elmConfig.protocol == 0) {
          char out[96];
          sprintf(out, "AUTO, %s\r\n>", dpBuf);
          sendElmResponse(out, transport);
        } else {
          char out[96];
          sprintf(out, "%s\r\n>", dpBuf);
          sendElmResponse(out, transport);
        }
      }
    } else if (strcmp(cmd, "DPN") == 0) {
      char dpnStr[16];
      uint8_t p = (elmConfig.protocol == 0) ? elmConfig.activeProtocol : elmConfig.protocol;
      if (elmConfig.protocol == 0) {
        if (!elmConfig.protocolResolved) sprintf(dpnStr, "A0\r\n>");
        else sprintf(dpnStr, "A%X\r\n>", p);
      } else {
        sprintf(dpnStr, "%X\r\n>", p);
      }
      sendElmResponse(dpnStr, transport);
    } else if (strcmp(cmd, "RV") == 0) {
      int rawAdc = adc1_get_raw(ADC1_CHANNEL_6);
      if (rawAdc > 100) {
        float volts = (rawAdc / 4095.0) * 3.3 * 11.0;
        char vStr[32];
        sprintf(vStr, "%.1fV\r\n>", volts);
        sendElmResponse(vStr, transport);
      } else {
        uint8_t pid42Req[2] = {0x01, 0x42};
        executeIsoTpTransaction(pid42Req, 2, transport);
      }
    } else if (strcmp(cmd, "IGN") == 0) {
      int rawAdc = adc1_get_raw(ADC1_CHANNEL_6);
      if (rawAdc > 100) {
        float volts = (rawAdc / 4095.0) * 3.3 * 11.0;
        sendElmResponse(volts > 11.0f ? "ON\r\n>" : "OFF\r\n>", transport);
      } else {
        uint8_t pid00Req[2] = {0x01, 0x00};
        executeIsoTpTransaction(pid00Req, 2, transport);
      }
    } else {
      sendElmResponse("?\r\n>", transport);
    }
    return;
  }

  // Hex Diagnostic Command Execution: Check even character length
  if (cIdx % 2 != 0) {
    sendElmResponse("?\r\n>", transport);
    return;
  }

  uint8_t txBytes[64];
  size_t txLen = 0;
  for (size_t i = 0; i < cIdx && txLen < 64; i += 2) {
    if (!isxdigit((unsigned char)clean[i]) || !isxdigit((unsigned char)clean[i + 1])) {
      sendElmResponse("?\r\n>", transport);
      return;
    }
    char byteStr[3] = {clean[i], clean[i + 1], '\0'};
    txBytes[txLen++] = (uint8_t)strtoul(byteStr, NULL, 16);
  }

  if (txLen == 0) {
    sendElmResponse("?\r\n>", transport);
    return;
  }

  executeIsoTpTransaction(txBytes, txLen, transport);
}

// ----------------------------------------------------------------------------
// Binary Response Helpers & Subscription Router
// ----------------------------------------------------------------------------
void sendBinaryPacket(uint8_t cmd, const uint8_t* payload, uint16_t len, ActiveTransport transport) {
  uint16_t totalLen = 2 + 1 + 2 + len + 1 + 2;
  uint8_t frame[280];
  if (totalLen > sizeof(frame)) return;

  frame[0] = PROTOCOL_MAGIC_1;
  frame[1] = PROTOCOL_MAGIC_2;
  frame[2] = cmd;
  frame[3] = (len >> 8) & 0xFF;
  frame[4] = len & 0xFF;

  for (uint16_t i = 0; i < len; i++) frame[5 + i] = payload[i];

  uint8_t cs = calculateChecksum(cmd, len, payload);
  frame[5 + len] = cs;
  frame[5 + len + 1] = PROTOCOL_TRAILER_1;
  frame[5 + len + 2] = PROTOCOL_TRAILER_2;

  if (transport == TRANSPORT_BLUETOOTH) {
    if (SerialBT.hasClient()) SerialBT.write(frame, totalLen);
  } else if (transport == TRANSPORT_WIFI) {
    if (tcpClient && tcpClient.connected()) tcpClient.write(frame, totalLen);
  }
}

void broadcastBinaryPacket(uint8_t cmd, const uint8_t* payload, uint16_t len) {
  uint16_t totalLen = 2 + 1 + 2 + len + 1 + 2;
  uint8_t frame[280];
  if (totalLen > sizeof(frame)) return;

  frame[0] = PROTOCOL_MAGIC_1;
  frame[1] = PROTOCOL_MAGIC_2;
  frame[2] = cmd;
  frame[3] = (len >> 8) & 0xFF;
  frame[4] = len & 0xFF;

  for (uint16_t i = 0; i < len; i++) frame[5 + i] = payload[i];

  uint8_t cs = calculateChecksum(cmd, len, payload);
  frame[5 + len] = cs;
  frame[5 + len + 1] = PROTOCOL_TRAILER_1;
  frame[5 + len + 2] = PROTOCOL_TRAILER_2;

  if (btSubscribedCan && SerialBT.hasClient()) {
    SerialBT.write(frame, totalLen);
  }
  if (wifiSubscribedCan && tcpClient && tcpClient.connected()) {
    tcpClient.write(frame, totalLen);
  }
}

void sendPong(ActiveTransport transport) {
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

  sendBinaryPacket(CMD_PONG, pongPayload, 9, transport);
}

void sendCanStatus(ActiveTransport transport) {
  twai_status_info_t twai_status;
  esp_err_t statusErr = twai_get_status_info(&twai_status);

  uint8_t statusPayload[21];
  memset(statusPayload, 0, sizeof(statusPayload));

  if (statusErr == ESP_OK && stats.canInitialized) {
    statusPayload[0] = (twai_status.state == TWAI_STATE_RUNNING) ? 0 :
                       (twai_status.state == TWAI_STATE_STOPPED) ? 1 :
                       (twai_status.state == TWAI_STATE_BUS_OFF) ? 2 : 3;

    if (twai_status.state != TWAI_STATE_RUNNING) stats.canInitialized = false;
  } else {
    statusPayload[0] = 3;
    stats.canInitialized = false;
  }

  uint32_t speed = currentCanSpeedKbps * 1000;
  statusPayload[1] = (speed >> 24) & 0xFF;
  statusPayload[2] = (speed >> 16) & 0xFF;
  statusPayload[3] = (speed >> 8) & 0xFF;
  statusPayload[4] = speed & 0xFF;

  if (statusErr == ESP_OK) {
    statusPayload[5] = twai_status.tx_error_counter & 0xFF;
    statusPayload[6] = twai_status.rx_error_counter & 0xFF;
    statusPayload[7] = (twai_status.rx_overrun_count >> 8) & 0xFF;
    statusPayload[8] = twai_status.rx_overrun_count & 0xFF;
    statusPayload[9] = twai_status.msgs_to_rx & 0xFF;
  }

  statusPayload[10] = (stats.messagesSent >> 24) & 0xFF;
  statusPayload[11] = (stats.messagesSent >> 16) & 0xFF;
  statusPayload[12] = (stats.messagesSent >> 8) & 0xFF;
  statusPayload[13] = stats.messagesSent & 0xFF;

  statusPayload[14] = (stats.messagesReceived >> 24) & 0xFF;
  statusPayload[15] = (stats.messagesReceived >> 16) & 0xFF;
  statusPayload[16] = (stats.messagesReceived >> 8) & 0xFF;
  statusPayload[17] = stats.messagesReceived & 0xFF;

  sendBinaryPacket(CMD_CAN_STATUS_RESP, statusPayload, 21, transport);
}

void sendKlineStatus(ActiveTransport transport) {
  uint8_t statusPayload[8];
  statusPayload[0] = checkKlineIdleState() ? 0x01 : 0x00;
  statusPayload[1] = klineState.activeProtocol;
  statusPayload[2] = klineState.initialized ? 0x01 : 0x00;
  statusPayload[3] = (klineState.rxErrorCount >> 8) & 0xFF;
  statusPayload[4] = klineState.rxErrorCount & 0xFF;
  statusPayload[5] = (klineState.txErrorCount >> 8) & 0xFF;
  statusPayload[6] = klineState.txErrorCount & 0xFF;
  statusPayload[7] = klineState.lastErrorCode;

  sendBinaryPacket(CMD_KLINE_STATUS_RESP, statusPayload, 8, transport);
}
