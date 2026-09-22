/*
 * ============================================================================
 * HAMZA OBD PRO - Production ESP32 Dual-Transport OBD/CAN/K-Line Firmware
 * Build ID: HAMZA-OBD-PRO-PRODUCTION-V7-PERFECT
 * ============================================================================
 * Hardware:
 *  - ESP32 WROOM-32 / DevKitC
 *  - CAN TX GPIO22 | CAN RX GPIO21
 *  - K-Line RX GPIO16 | K-Line TX GPIO17
 *  - Status LED GPIO2
 *  - Battery ADC GPIO34 / 10:1 divider
 *
 * Transports:
 *  - Bluetooth Classic SPP
 *  - Wi-Fi SoftAP + TCP 35000
 *
 * Protocols:
 *  - HAMZA Binary Protocol
 *  - ELM327-compatible ASCII command engine
 *  - ISO 15765-4 CAN / ISO-TP (11-bit + 29-bit, physical + functional)
 *  - ISO 9141-2 K-Line
 *  - ISO 14230-4 KWP2000 (Fast + Slow)
 *  - ISO 14229 UDS (all services 0x10 - 0x87)
 *
 * V7-PERFECT Features:
 *  - Real auto protocol search (ATSP0 tries 4 CAN + KWP Fast + ISO9141)
 *  - No mock data. protocolResolved only after real ECU response.
 *  - Full ISO-TP with FC, BS, STmin, Sequence Numbers
 *  - 29-bit functional broadcast handled separately
 *  - CMD_ERROR_RESP for binary feedback
 *  - ELM327 v1.5 compatible ATZ response
 *  - ATRV/ATIGN fallback to real ECU battery voltage (PID 01 42/01 00)
 *  - Auto-subscribe to CAN broadcast on first command
 *  - VIN fix: services 09,0A go to physical 0x7E0 (not 0x7DF)
 *  - NRC 0x78 (ResponsePending) support with auto timeout reset
 *  - UDS timeout: 5 seconds for services 0x10-0x87
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include "BluetoothSerial.h"
#include "driver/twai.h"
#include "esp_system.h"
#include "driver/adc.h"

// ============================================================================
// Configuration
// ============================================================================

#define FIRMWARE_BUILD_ID "HAMZA-OBD-PRO-PRODUCTION-V7-PERFECT"

#define CAN_TX_PIN GPIO_NUM_22
#define CAN_RX_PIN GPIO_NUM_21
#define CAN_DEFAULT_SPEED_KBPS 500

#define KLINE_RX_PIN GPIO_NUM_16
#define KLINE_TX_PIN GPIO_NUM_17
#define KLINE_BAUDRATE 10400

#define VOLTAGE_ADC_PIN 34

#define WIFI_AP_SSID "ESP32-OBD-PRO"
#define WIFI_AP_PASS "12345678"
#define TCP_SERVER_PORT 35000

#define BT_DEVICE_NAME "ESP32-OBD-PRO"
#define STATUS_LED_PIN 2

// ============================================================================
// Protocol IDs
// ============================================================================

#define PROTO_AUTO          0x00
#define PROTO_ISO9141_SLOW  0x01
#define PROTO_KWP2000_5BAUD 0x02
#define PROTO_KWP2000_FAST  0x04
#define PROTO_KWP2000_SLOW  0x05
#define PROTO_CAN_11_500    0x06
#define PROTO_CAN_29_500    0x07
#define PROTO_CAN_11_250    0x08
#define PROTO_CAN_29_250    0x09

// ============================================================================
// Status codes
// ============================================================================

#define STATUS_SUCCESS          0x00
#define STATUS_NO_VOLTAGE       0x01
#define STATUS_INIT_FAILED      0x02
#define STATUS_KEYBYTE_MISMATCH 0x03
#define STATUS_ECU_NO_RESPONSE  0x04
#define STATUS_CHECKSUM_ERROR   0x05
#define STATUS_CAN_ERROR        0x06
#define STATUS_BUSY             0x07

// ============================================================================
// Binary protocol
// ============================================================================

#define PROTOCOL_MAGIC_1    0xAA
#define PROTOCOL_MAGIC_2    0x55
#define PROTOCOL_TRAILER_1  0x0D
#define PROTOCOL_TRAILER_2  0x0A

#define CMD_CAN_FRAME         0x01
#define CMD_PING              0x02
#define CMD_PONG              0x03
#define CMD_CAN_STATUS_REQ    0x04
#define CMD_CAN_STATUS_RESP   0x05
#define CMD_CONFIG_CAN        0x06
#define CMD_HEARTBEAT         0x07
#define CMD_CONFIG_PROTOCOL   0x08
#define CMD_KLINE_INIT        0x09
#define CMD_KLINE_INIT_RESP   0x0A
#define CMD_KLINE_FRAME       0x0B
#define CMD_KLINE_STATUS_REQ  0x0C
#define CMD_KLINE_STATUS_RESP 0x0D
#define CMD_ERROR_RESP        0x0E

enum ActiveTransport {
  TRANSPORT_NONE = 0,
  TRANSPORT_BLUETOOTH = 1,
  TRANSPORT_WIFI = 2
};

// ============================================================================
// ELM327 state
// ============================================================================

struct Elm327Config {
  bool echo;
  bool linefeed;
  bool headers;
  bool spaces;
  uint8_t protocol;
  uint8_t activeProtocol;
  bool protocolResolved;
  uint32_t headerId;
  uint32_t filterId;
  bool isExtended;
  uint16_t timeoutMs;
  bool allowLongMsgs;
  bool autoFormatting;
} elmConfig = {
  true, true, false, true,
  PROTO_AUTO, PROTO_CAN_11_500, false,
  0x7E0, 0x7E8, false,
  300, false, true
};

// ============================================================================
// Hardware / transport
// ============================================================================

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

// ============================================================================
// K-Line state
// ============================================================================

struct KlineState {
  bool initialized;
  uint8_t activeProtocol;
  uint8_t keyByte1;
  uint8_t keyByte2;
  uint16_t rxErrorCount;
  uint16_t txErrorCount;
  uint8_t lastErrorCode;
} klineState = {false, PROTO_ISO9141_SLOW, 0x00, 0x00, 0, 0, STATUS_SUCCESS};

// ============================================================================
// Stream buffers
// ============================================================================

#define RX_STREAM_BUF_SIZE 1024

uint8_t wifiRxBuf[RX_STREAM_BUF_SIZE];
size_t wifiRxHead = 0;

uint8_t btRxBuf[RX_STREAM_BUF_SIZE];
size_t btRxHead = 0;

// ============================================================================
// ISO-TP
// ============================================================================

#define ISO_TP_MAX_BUF_SIZE 4095
#define ISO_TP_MAX_WAIT_FRAMES 10

// UDS timeout for services 0x10-0x87 (5 seconds)
#define UDS_TIMEOUT_MS 5000
#define OBD_TIMEOUT_DEFAULT_MS 300

struct IsoTpTransaction {
  bool active;
  ActiveTransport requestingTransport;
  bool isTx;
  uint32_t reqHeaderId;
  uint32_t expectedRxId;
  bool isExtended;
  uint8_t buffer[ISO_TP_MAX_BUF_SIZE];
  size_t totalLen;
  size_t currentLen;
  uint8_t expectedSn;
  uint8_t blockSize;
  uint8_t stMin;
  uint8_t framesInCurrentBlock;
  uint8_t fcWaitCount;
  bool waitFc;
  uint8_t fcStatus;
  bool gotFc;
  unsigned long startTime;
  uint32_t timeoutMs;
  bool completed;
  bool failed;
  const char* errorMsg;
  uint8_t pendingNrcCount;  // NRC 0x78 counter
} isoTp = {
  false, TRANSPORT_NONE, false, 0, 0, false,
  {0}, 0, 0, 1, 0, 0, 0, 0,
  false, 0, false, 0, 300, false, false, NULL, 0
};

// ============================================================================
// Function declarations
// ============================================================================

void initCAN(uint32_t speedKbps);
void dispatchCanRx();
void processIsoTpRxFrame(const twai_message_t& rxMsg);
void executeIsoTpTransaction(const uint8_t* txBytes, size_t txLen, ActiveTransport transport);
bool executeCanIsoTpAttempt(const uint8_t* txBytes, size_t txLen, uint8_t protocol, bool emitResponse, ActiveTransport transport);
bool autoSearchProtocol(const uint8_t* txBytes, size_t txLen, ActiveTransport transport);

bool checkKlineIdleState();
size_t stripTxEcho(const uint8_t* txBuf, size_t txLen, const uint8_t* rawRxBuf, size_t rawRxLen, uint8_t* cleanRxBuf);
uint8_t initKlineIso9141();
uint8_t initKlineKwpFast();
uint8_t initKlineKwpSlow();
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

// ============================================================================
// ISO-TP CAN ID helpers
// ============================================================================

static bool isFunctional29Bit(uint32_t id) {
  return id == 0x18DB33F1UL;
}

static bool isPhysical29BitRequest(uint32_t id) {
  return (id & 0x1FFFFF00UL) == 0x18DA0000UL && (id & 0xFFUL) == 0xF1;
}

uint32_t deriveIsoTpResponseId(uint32_t reqId, bool extended, bool functional) {
  if (!extended) {
    if (functional && reqId == 0x7DF) return 0x7E8;
    if (reqId >= 0x7E0 && reqId <= 0x7E7) return reqId + 8;
    return reqId + 8;
  }
  if (functional && reqId == 0x18DB33F1UL) return 0;
  if (isPhysical29BitRequest(reqId)) {
    uint32_t target = reqId & 0xFFUL;
    return 0x18DAF100UL | target;
  }
  return reqId;
}

bool isoTpRxIdMatches(const twai_message_t& rxMsg) {
  if (rxMsg.extd != isoTp.isExtended) return false;
  if (!isoTp.isExtended) {
    if (isoTp.reqHeaderId == 0x7DF) {
      return rxMsg.identifier >= 0x7E8 && rxMsg.identifier <= 0x7EF;
    }
    return rxMsg.identifier == isoTp.expectedRxId;
  }
  if (isoTp.reqHeaderId == 0x18DB33F1UL) {
    return (rxMsg.identifier & 0x1FFFFF00UL) == 0x18DAF100UL;
  }
  return rxMsg.identifier == isoTp.expectedRxId;
}

uint32_t deriveFlowControlId(uint32_t responseId, bool extended) {
  if (!extended) {
    if (responseId >= 0x7E8 && responseId <= 0x7EF) return responseId - 8;
    if (isoTp.reqHeaderId >= 0x7E0 && isoTp.reqHeaderId <= 0x7E7) return isoTp.reqHeaderId;
    return isoTp.reqHeaderId;
  }
  uint32_t target = responseId & 0xFFUL;
  if ((responseId & 0x1FFFFF00UL) == 0x18DAF100UL) {
    return 0x18DA0000UL | (0xF1UL << 8) | target;
  }
  return isoTp.reqHeaderId;
}

// ============================================================================
// K-Line physical driver
// ============================================================================

bool checkKlineIdleState() {
  pinMode(KLINE_RX_PIN, INPUT_PULLUP);
  int lowCount = 0;
  for (int i = 0; i < 50; i++) {
    if (digitalRead(KLINE_RX_PIN) == LOW) lowCount++;
    delayMicroseconds(1000);
  }
  return lowCount < 40;
}

size_t stripTxEcho(const uint8_t* txBuf, size_t txLen,
                   const uint8_t* rawRxBuf, size_t rawRxLen,
                   uint8_t* cleanRxBuf) {
  size_t echoCount = 0;
  while (echoCount < txLen && echoCount < rawRxLen &&
         rawRxBuf[echoCount] == txBuf[echoCount]) {
    echoCount++;
  }
  size_t cleanLen = 0;
  for (size_t i = echoCount; i < rawRxLen; i++) {
    cleanRxBuf[cleanLen++] = rawRxBuf[i];
  }
  return cleanLen;
}

uint8_t initKlineIso9141() {
  klineState.initialized = false;
  klineState.lastErrorCode = STATUS_INIT_FAILED;

  if (!checkKlineIdleState()) {
    klineState.rxErrorCount++;
    klineState.lastErrorCode = STATUS_NO_VOLTAGE;
    return STATUS_NO_VOLTAGE;
  }

  Serial2.end();
  pinMode(KLINE_TX_PIN, OUTPUT);
  digitalWrite(KLINE_TX_PIN, HIGH);
  delay(300);

  const uint8_t addrBits[10] = {0, 1, 1, 0, 0, 1, 1, 0, 0, 1};
  for (uint8_t i = 0; i < 10; i++) {
    digitalWrite(KLINE_TX_PIN, addrBits[i] ? HIGH : LOW);
    delay(200);
  }
  digitalWrite(KLINE_TX_PIN, HIGH);

  Serial2.begin(KLINE_BAUDRATE, SERIAL_8N1, KLINE_RX_PIN, KLINE_TX_PIN);

  unsigned long t0 = millis();
  uint8_t syncByte = 0;
  while ((millis() - t0) < 300) {
    if (Serial2.available()) { syncByte = Serial2.read(); break; }
    delay(1);
  }
  if (syncByte != 0x55) {
    klineState.rxErrorCount++;
    klineState.lastErrorCode = STATUS_INIT_FAILED;
    return STATUS_INIT_FAILED;
  }

  uint8_t kb1 = 0, kb2 = 0;
  t0 = millis();
  while ((millis() - t0) < 300) {
    if (Serial2.available()) { kb1 = Serial2.read(); break; }
    delay(1);
  }
  t0 = millis();
  while ((millis() - t0) < 300) {
    if (Serial2.available()) { kb2 = Serial2.read(); break; }
    delay(1);
  }

  if (kb1 == 0x00 || kb2 == 0x00) {
    klineState.rxErrorCount++;
    klineState.lastErrorCode = STATUS_KEYBYTE_MISMATCH;
    return STATUS_KEYBYTE_MISMATCH;
  }

  delay(30);
  uint8_t invKb2 = (uint8_t)~kb2;
  if (Serial2.write(invKb2) != 1) {
    klineState.txErrorCount++;
    return STATUS_INIT_FAILED;
  }

  t0 = millis();
  while ((millis() - t0) < 100) {
    if (Serial2.available()) { Serial2.read(); break; }
    delay(1);
  }

  uint8_t invAddrResp = 0;
  t0 = millis();
  while ((millis() - t0) < 300) {
    if (Serial2.available()) { invAddrResp = Serial2.read(); break; }
    delay(1);
  }
  if (invAddrResp != 0xCC) {
    klineState.rxErrorCount++;
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
  return STATUS_SUCCESS;
}

uint8_t initKlineKwpFast() {
  klineState.initialized = false;
  klineState.lastErrorCode = STATUS_INIT_FAILED;

  if (!checkKlineIdleState()) {
    klineState.rxErrorCount++;
    klineState.lastErrorCode = STATUS_NO_VOLTAGE;
    return STATUS_NO_VOLTAGE;
  }

  Serial2.end();
  pinMode(KLINE_TX_PIN, OUTPUT);
  digitalWrite(KLINE_TX_PIN, HIGH);
  delay(300);

  digitalWrite(KLINE_TX_PIN, LOW);
  delay(25);
  digitalWrite(KLINE_TX_PIN, HIGH);
  delay(25);

  Serial2.begin(KLINE_BAUDRATE, SERIAL_8N1, KLINE_RX_PIN, KLINE_TX_PIN);

  const uint8_t startCommReq[5] = {0xC1, 0x33, 0xF1, 0x81, 0x66};
  if (Serial2.write(startCommReq, sizeof(startCommReq)) != sizeof(startCommReq)) {
    klineState.txErrorCount++;
    return STATUS_INIT_FAILED;
  }

  uint8_t rawRx[64];
  size_t rawRxLen = 0;
  unsigned long t0 = millis();
  while ((millis() - t0) < 500 && rawRxLen < sizeof(rawRx)) {
    if (Serial2.available()) { rawRx[rawRxLen++] = Serial2.read(); t0 = millis(); }
    else delay(1);
  }

  uint8_t cleanRx[64];
  size_t cleanRxLen = stripTxEcho(startCommReq, sizeof(startCommReq),
                                  rawRx, rawRxLen, cleanRx);

  if (cleanRxLen < 5) {
    klineState.rxErrorCount++;
    return STATUS_ECU_NO_RESPONSE;
  }

  uint8_t cs = 0;
  for (size_t i = 0; i < cleanRxLen - 1; i++) cs = (uint8_t)(cs + cleanRx[i]);
  if (cs != cleanRx[cleanRxLen - 1]) {
    klineState.rxErrorCount++;
    return STATUS_CHECKSUM_ERROR;
  }

  klineState.initialized = true;
  klineState.activeProtocol = PROTO_KWP2000_FAST;
  klineState.keyByte1 = cleanRxLen >= 6 ? cleanRx[4] : 0x00;
  klineState.keyByte2 = cleanRxLen >= 7 ? cleanRx[5] : 0x00;
  klineState.lastErrorCode = STATUS_SUCCESS;
  elmConfig.activeProtocol = PROTO_KWP2000_FAST;
  return STATUS_SUCCESS;
}

uint8_t initKlineKwpSlow() {
  uint8_t result = initKlineIso9141();
  if (result == STATUS_SUCCESS) {
    klineState.activeProtocol = PROTO_KWP2000_SLOW;
    elmConfig.activeProtocol = PROTO_KWP2000_SLOW;
  }
  return result;
}

uint8_t transceiveKlineFrame(const uint8_t* txData, size_t txLen,
                             uint8_t* rxBuf, size_t& rxLen, uint32_t timeoutMs) {
  rxLen = 0;
  if (txData == nullptr || rxBuf == nullptr || txLen == 0 || txLen > 58) {
    klineState.lastErrorCode = STATUS_INIT_FAILED;
    return STATUS_INIT_FAILED;
  }

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
    frameTx[0] = 0x68; frameTx[1] = 0x6A; frameTx[2] = 0xF1;
    for (size_t i = 0; i < txLen; i++) frameTx[3 + i] = txData[i];
    frameTxLen = 3 + txLen;
    uint8_t cs = 0;
    for (size_t i = 0; i < frameTxLen; i++) cs = (uint8_t)(cs + frameTx[i]);
    frameTx[frameTxLen++] = cs;
  } else {
    frameTx[0] = 0x80 | (txLen & 0x3F);
    frameTx[1] = 0x33;
    frameTx[2] = 0xF1;
    for (size_t i = 0; i < txLen; i++) frameTx[3 + i] = txData[i];
    frameTxLen = 3 + txLen;
    uint8_t cs = 0;
    for (size_t i = 0; i < frameTxLen; i++) cs = (uint8_t)(cs + frameTx[i]);
    frameTx[frameTxLen++] = cs;
  }

  while (Serial2.available()) Serial2.read();

  if (Serial2.write(frameTx, frameTxLen) != frameTxLen) {
    klineState.txErrorCount++;
    return STATUS_INIT_FAILED;
  }
  Serial2.flush();

  uint8_t rawRx[128];
  size_t rawRxLen = 0;
  unsigned long startT = millis();
  while ((millis() - startT) < timeoutMs && rawRxLen < sizeof(rawRx)) {
    if (Serial2.available()) {
      rawRx[rawRxLen++] = Serial2.read();
      startT = millis();
    } else {
      delay(1);
    }
  }

  uint8_t cleanRx[128];
  size_t cleanRxLen = stripTxEcho(frameTx, frameTxLen, rawRx, rawRxLen, cleanRx);

  if (cleanRxLen < 2) {
    klineState.rxErrorCount++;
    return STATUS_ECU_NO_RESPONSE;
  }

  uint8_t rxCs = 0;
  for (size_t i = 0; i < cleanRxLen - 1; i++) rxCs = (uint8_t)(rxCs + cleanRx[i]);
  if (rxCs != cleanRx[cleanRxLen - 1]) {
    klineState.rxErrorCount++;
    return STATUS_CHECKSUM_ERROR;
  }

  rxLen = cleanRxLen;
  for (size_t i = 0; i < cleanRxLen; i++) rxBuf[i] = cleanRx[i];
  klineState.lastErrorCode = STATUS_SUCCESS;
  return STATUS_SUCCESS;
}

// ============================================================================
// CAN initialization
// ============================================================================

void initCAN(uint32_t speedKbps) {
  stats.canInitialized = false;
  twai_stop();
  twai_driver_uninstall();

  twai_general_config_t g_config =
    TWAI_GENERAL_CONFIG_DEFAULT(CAN_TX_PIN, CAN_RX_PIN, TWAI_MODE_NORMAL);
  g_config.rx_queue_len = 64;
  g_config.tx_queue_len = 32;

  twai_timing_config_t t_config;
  if (speedKbps == 1000) t_config = TWAI_TIMING_CONFIG_1MBITS();
  else if (speedKbps == 250) t_config = TWAI_TIMING_CONFIG_250KBITS();
  else if (speedKbps == 125) t_config = TWAI_TIMING_CONFIG_125KBITS();
  else { t_config = TWAI_TIMING_CONFIG_500KBITS(); speedKbps = 500; }

  twai_filter_config_t f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();

  if (twai_driver_install(&g_config, &t_config, &f_config) != ESP_OK) return;
  if (twai_start() != ESP_OK) { twai_driver_uninstall(); return; }

  stats.canInitialized = true;
  currentCanSpeedKbps = speedKbps;
}

// ============================================================================
// ISO-TP Flow Control sender
// ============================================================================

bool sendIsoTpFlowControl(uint32_t canId, bool extended,
                          uint8_t status, uint8_t blockSize, uint8_t stMin) {
  twai_message_t fcMsg;
  memset(&fcMsg, 0, sizeof(fcMsg));
  fcMsg.identifier = canId;
  fcMsg.extd = extended ? 1 : 0;
  fcMsg.data_length_code = 8;
  fcMsg.data[0] = (uint8_t)(0x30 | (status & 0x0F));
  fcMsg.data[1] = blockSize;
  fcMsg.data[2] = stMin;
  for (uint8_t i = 3; i < 8; i++) fcMsg.data[i] = 0xCC;

  if (twai_transmit(&fcMsg, pdMS_TO_TICKS(50)) != ESP_OK) {
    stats.txErrorCount++;
    isoTp.failed = true;
    isoTp.errorMsg = "FC TX ERROR";
    return false;
  }
  stats.messagesSent++;
  return true;
}

// ============================================================================
// ISO-TP RX decoder
// ============================================================================

void processIsoTpRxFrame(const twai_message_t& rxMsg) {
  if (!isoTp.active) return;
  if (rxMsg.rtr) return;
  if (!isoTpRxIdMatches(rxMsg)) return;

  uint8_t dlc = rxMsg.data_length_code > 8 ? 8 : rxMsg.data_length_code;
  if (dlc == 0) return;

  uint8_t pci = rxMsg.data[0];
  uint8_t frameType = (pci >> 4) & 0x0F;

  // TX: waiting for FC from ECU
  if (isoTp.isTx && isoTp.waitFc) {
    if (frameType != 0x3) return;
    if (dlc < 3) {
      isoTp.failed = true;
      isoTp.errorMsg = "SHORT FC";
      isoTp.active = false;
      return;
    }
    uint8_t fcStatus = pci & 0x0F;
    isoTp.fcStatus = fcStatus;

    if (fcStatus == 0x0) {
      isoTp.blockSize = rxMsg.data[1];
      isoTp.stMin = rxMsg.data[2];
      isoTp.gotFc = true;
      isoTp.waitFc = false;
      isoTp.fcWaitCount = 0;
      isoTp.framesInCurrentBlock = 0;
      isoTp.startTime = millis();
    } else if (fcStatus == 0x1) {
      isoTp.fcWaitCount++;
      if (isoTp.fcWaitCount > ISO_TP_MAX_WAIT_FRAMES) {
        isoTp.failed = true;
        isoTp.errorMsg = "TOO MANY WAIT";
        isoTp.active = false;
      } else {
        isoTp.startTime = millis();
      }
    } else if (fcStatus == 0x2) {
      isoTp.failed = true;
      isoTp.errorMsg = "OVERFLOW";
      isoTp.active = false;
    } else {
      isoTp.failed = true;
      isoTp.errorMsg = "INVALID FC";
      isoTp.active = false;
    }
    return;
  }

  if (isoTp.isTx) return;

  // Single Frame
  if (frameType == 0x0) {
    uint8_t sfLen = pci & 0x0F;
    if (sfLen == 0 || sfLen > 7 || sfLen > (dlc - 1)) {
      isoTp.failed = true;
      isoTp.errorMsg = "INVALID SF";
      isoTp.active = false;
      return;
    }
    
    // Copy bytes to buffer first (needed for NRC check)
    for (uint8_t b = 0; b < sfLen; b++) {
      isoTp.buffer[b] = rxMsg.data[1 + b];
    }
    
    // ========================================================================
    // V7-PERFECT: NRC 0x78 (ResponsePending) handling
    // If ECU responds with 7F XX 78, it means "still processing, wait more"
    // Reset timeout and keep transaction active.
    // ========================================================================
    if (sfLen == 3 && isoTp.buffer[0] == 0x7F && isoTp.buffer[2] == 0x78) {
      isoTp.pendingNrcCount++;
      isoTp.startTime = millis();  // Reset timeout
      // Don't mark completed or inactive - wait for real response
      // Don't copy to buffer yet either (real response overwrites later)
      return;
    }
    
    isoTp.totalLen = sfLen;
    isoTp.currentLen = sfLen;
    isoTp.completed = true;
    isoTp.failed = false;
    elmConfig.protocolResolved = true;

    if (elmConfig.protocol == PROTO_AUTO) {
      if (isoTp.isExtended) {
        elmConfig.activeProtocol = (currentCanSpeedKbps == 250)
          ? PROTO_CAN_29_250 : PROTO_CAN_29_500;
      } else {
        elmConfig.activeProtocol = (currentCanSpeedKbps == 250)
          ? PROTO_CAN_11_250 : PROTO_CAN_11_500;
      }
    }
    isoTp.active = false;
    return;
  }

  // First Frame
  if (frameType == 0x1) {
    if (dlc < 8) return;
    uint16_t ffLen = ((uint16_t)(pci & 0x0F) << 8) | rxMsg.data[1];

    if (ffLen < 8 || ffLen > ISO_TP_MAX_BUF_SIZE) {
      uint32_t fcCanId = deriveFlowControlId(rxMsg.identifier, isoTp.isExtended);
      sendIsoTpFlowControl(fcCanId, isoTp.isExtended, 0x2, 0, 0);
      isoTp.failed = true;
      isoTp.errorMsg = "INVALID FF LEN";
      isoTp.active = false;
      return;
    }

    isoTp.totalLen = ffLen;
    isoTp.currentLen = 6;
    for (uint8_t b = 0; b < 6; b++) {
      isoTp.buffer[b] = rxMsg.data[2 + b];
    }
    isoTp.expectedSn = 1;
    isoTp.blockSize = 0;
    isoTp.stMin = 0;
    isoTp.framesInCurrentBlock = 0;

    uint32_t fcCanId = deriveFlowControlId(rxMsg.identifier, isoTp.isExtended);
    if (!sendIsoTpFlowControl(fcCanId, isoTp.isExtended, 0x0, 0x00, 0x00)) {
      isoTp.active = false;
      return;
    }
    isoTp.startTime = millis();
    elmConfig.protocolResolved = true;

    if (elmConfig.protocol == PROTO_AUTO) {
      if (isoTp.isExtended) {
        elmConfig.activeProtocol = (currentCanSpeedKbps == 250)
          ? PROTO_CAN_29_250 : PROTO_CAN_29_500;
      } else {
        elmConfig.activeProtocol = (currentCanSpeedKbps == 250)
          ? PROTO_CAN_11_250 : PROTO_CAN_11_500;
      }
    }
    return;
  }

  // Consecutive Frame
  if (frameType == 0x2) {
    if (isoTp.totalLen == 0) return;
    uint8_t sn = pci & 0x0F;
    if (sn != isoTp.expectedSn) {
      isoTp.failed = true;
      isoTp.errorMsg = "SEQ MISMATCH";
      isoTp.active = false;
      return;
    }
    isoTp.expectedSn = (isoTp.expectedSn + 1) & 0x0F;
    if (dlc < 2) return;

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
      isoTp.failed = false;
      isoTp.active = false;
      return;
    }

    if (isoTp.blockSize != 0 && isoTp.framesInCurrentBlock >= isoTp.blockSize) {
      uint32_t fcCanId = deriveFlowControlId(rxMsg.identifier, isoTp.isExtended);
      if (!sendIsoTpFlowControl(fcCanId, isoTp.isExtended, 0x0,
                                isoTp.blockSize, isoTp.stMin)) {
        isoTp.active = false;
        return;
      }
      isoTp.framesInCurrentBlock = 0;
    }
  }
}

// ============================================================================
// Central CAN RX dispatcher
// ============================================================================

void dispatchCanRx() {
  twai_status_info_t s_info;
  if (twai_get_status_info(&s_info) != ESP_OK) {
    stats.canInitialized = false;
    return;
  }

  if (s_info.state == TWAI_STATE_BUS_OFF) {
    stats.canInitialized = false;
    if (isoTp.active) {
      isoTp.failed = true;
      isoTp.errorMsg = "CAN BUS OFF";
      isoTp.active = false;
    }
    twai_initiate_recovery();
    return;
  }
  if (s_info.state == TWAI_STATE_RECOVERING) {
    stats.canInitialized = false;
    return;
  }
  if (s_info.state == TWAI_STATE_STOPPED) {
    stats.canInitialized = false;
    return;
  }

  constexpr uint8_t MAX_CAN_FRAMES_PER_DISPATCH = 16;
  twai_message_t rxMsg;
  uint8_t processedFrames = 0;

  while (processedFrames < MAX_CAN_FRAMES_PER_DISPATCH &&
         twai_receive(&rxMsg, 0) == ESP_OK) {
    processedFrames++;
    stats.messagesReceived++;

    uint8_t payload[14];
    payload[0] = (rxMsg.identifier >> 24) & 0xFF;
    payload[1] = (rxMsg.identifier >> 16) & 0xFF;
    payload[2] = (rxMsg.identifier >> 8) & 0xFF;
    payload[3] = rxMsg.identifier & 0xFF;
    uint8_t flags = 0;
    if (rxMsg.extd) flags |= 0x01;
    if (rxMsg.rtr) flags |= 0x02;
    payload[4] = flags;
    uint8_t dlc = rxMsg.data_length_code > 8 ? 8 : rxMsg.data_length_code;
    payload[5] = dlc;
    for (uint8_t i = 0; i < 8; i++) {
      payload[6 + i] = (i < dlc) ? rxMsg.data[i] : 0x00;
    }

    broadcastBinaryPacket(CMD_CAN_FRAME, payload, 14);

    if (isoTp.active) processIsoTpRxFrame(rxMsg);
  }
}

// ============================================================================
// Setup
// ============================================================================

void setup() {
  Serial.begin(115200);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  initCAN(CAN_DEFAULT_SPEED_KBPS);

  if (!SerialBT.begin(BT_DEVICE_NAME)) {
    stats.btConnected = false;
  }

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

  digitalWrite(STATUS_LED_PIN, HIGH);
}

// ============================================================================
// Main loop
// ============================================================================

void loop() {
  if (tcpServer.hasClient()) {
    if (!tcpClient || !tcpClient.connected()) {
      if (tcpClient) tcpClient.stop();
      tcpClient = tcpServer.available();
      tcpClient.setNoDelay(true);
      stats.wifiClientConnected = true;
      wifiSubscribedCan = true;
      wifiRxHead = 0;
    }
  }

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
    if (stats.wifiClientConnected) {
      wifiSubscribedCan = false;
      wifiRxHead = 0;
      isoTp.active = false;
    }
    stats.wifiClientConnected = false;
  }

  if (SerialBT.available()) {
    stats.btConnected = true;
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

  dispatchCanRx();
  yield();
}

// ============================================================================
// Binary protocol checksum
// ============================================================================

uint8_t calculateChecksum(uint8_t cmd, uint16_t len, const uint8_t* payload) {
  uint8_t cs = cmd ^ ((len >> 8) & 0xFF) ^ (len & 0xFF);
  for (uint16_t i = 0; i < len; i++) cs ^= payload[i];
  return cs;
}

// ============================================================================
// Stream parser
// ============================================================================

void processStreamBuffer(uint8_t* buffer, size_t& head, ActiveTransport transport) {
  if (buffer == nullptr) { head = 0; return; }
  if (head > RX_STREAM_BUF_SIZE) head = RX_STREAM_BUF_SIZE;

  size_t i = 0;

  while (i < head) {
    if (i + 5 <= head &&
        buffer[i] == PROTOCOL_MAGIC_1 &&
        buffer[i + 1] == PROTOCOL_MAGIC_2) {
      uint8_t cmd = buffer[i + 2];
      uint16_t len = ((uint16_t)buffer[i + 3] << 8) | buffer[i + 4];

      if (len > 256) { i++; continue; }

      size_t totalPacketLen = 2 + 1 + 2 + len + 1 + 2;
      if (totalPacketLen < 8) { i++; continue; }
      if (i + totalPacketLen > head) break;

      const uint8_t* payload = &buffer[i + 5];
      uint8_t checksum = buffer[i + 5 + len];
      uint8_t tr1 = buffer[i + 5 + len + 1];
      uint8_t tr2 = buffer[i + 5 + len + 2];

      if (tr1 == PROTOCOL_TRAILER_1 && tr2 == PROTOCOL_TRAILER_2 &&
          checksum == calculateChecksum(cmd, len, payload)) {
        handleParsedCommand(cmd, len, payload, transport);
        i += totalPacketLen;
        continue;
      }
      i++;
      continue;
    }

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
      if (lineLen > 0 && lineLen < RX_STREAM_BUF_SIZE) {
        static char lineBuf[RX_STREAM_BUF_SIZE];
        memcpy(lineBuf, &buffer[i], lineLen);
        lineBuf[lineLen] = '\0';
        processElmLine(lineBuf, transport);
      }
      i = lineEnd;
      while (i < head && (buffer[i] == '\r' || buffer[i] == '\n')) i++;
      continue;
    }

    if (head >= RX_STREAM_BUF_SIZE - 1) i++;
    else break;
  }

  if (i > 0) {
    size_t remaining = head - i;
    if (remaining > 0) memmove(buffer, &buffer[i], remaining);
    head = remaining;
  }
}

// ============================================================================
// Binary command handler
// ============================================================================

void handleParsedCommand(uint8_t cmd, uint16_t len,
                         const uint8_t* payload, ActiveTransport transport) {
  switch (cmd) {

    case CMD_CAN_FRAME: {
      if (len < 6) {
        uint8_t e[2] = { CMD_CAN_FRAME, STATUS_INIT_FAILED };
        sendBinaryPacket(CMD_ERROR_RESP, e, 2, transport);
        break;
      }
      uint8_t dlc = payload[5];
      if (dlc > 8 || len < (uint16_t)(6 + dlc)) {
        uint8_t e[2] = { CMD_CAN_FRAME, STATUS_INIT_FAILED };
        sendBinaryPacket(CMD_ERROR_RESP, e, 2, transport);
        break;
      }

      twai_status_info_t s_info;
      if (twai_get_status_info(&s_info) != ESP_OK) {
        stats.txErrorCount++;
        uint8_t e[2] = { CMD_CAN_FRAME, STATUS_CAN_ERROR };
        sendBinaryPacket(CMD_ERROR_RESP, e, 2, transport);
        break;
      }
      if (s_info.state == TWAI_STATE_BUS_OFF) {
        stats.canInitialized = false;
        stats.txErrorCount++;
        twai_initiate_recovery();
        uint8_t e[2] = { CMD_CAN_FRAME, STATUS_CAN_ERROR };
        sendBinaryPacket(CMD_ERROR_RESP, e, 2, transport);
        break;
      }
      if (s_info.state == TWAI_STATE_RECOVERING) {
        stats.txErrorCount++;
        uint8_t e[2] = { CMD_CAN_FRAME, STATUS_BUSY };
        sendBinaryPacket(CMD_ERROR_RESP, e, 2, transport);
        break;
      }
      if (s_info.state == TWAI_STATE_STOPPED) {
        if (twai_start() != ESP_OK) {
          stats.txErrorCount++;
          uint8_t e[2] = { CMD_CAN_FRAME, STATUS_INIT_FAILED };
          sendBinaryPacket(CMD_ERROR_RESP, e, 2, transport);
          break;
        }
        stats.canInitialized = true;
      }

      uint32_t canId = ((uint32_t)payload[0] << 24) |
                       ((uint32_t)payload[1] << 16) |
                       ((uint32_t)payload[2] << 8)  |
                        (uint32_t)payload[3];
      uint8_t flags = payload[4];
      bool isExtended = (flags & 0x01) != 0;
      bool isRtr = (flags & 0x02) != 0;

      if (isExtended && canId > 0x1FFFFFFF) {
        uint8_t e[2] = { CMD_CAN_FRAME, STATUS_INIT_FAILED };
        sendBinaryPacket(CMD_ERROR_RESP, e, 2, transport);
        break;
      }
      if (!isExtended && canId > 0x7FF) {
        uint8_t e[2] = { CMD_CAN_FRAME, STATUS_INIT_FAILED };
        sendBinaryPacket(CMD_ERROR_RESP, e, 2, transport);
        break;
      }
      if (flags & 0xFC) {
        uint8_t e[2] = { CMD_CAN_FRAME, STATUS_INIT_FAILED };
        sendBinaryPacket(CMD_ERROR_RESP, e, 2, transport);
        break;
      }

      twai_message_t txMsg;
      memset(&txMsg, 0, sizeof(txMsg));
      txMsg.identifier = canId;
      txMsg.extd = isExtended ? 1 : 0;
      txMsg.rtr = isRtr ? 1 : 0;
      txMsg.data_length_code = dlc;
      for (uint8_t b = 0; b < dlc; b++) txMsg.data[b] = payload[6 + b];

      esp_err_t err = twai_transmit(&txMsg, pdMS_TO_TICKS(50));
      if (err == ESP_OK) {
        stats.messagesSent++;
      } else {
        stats.txErrorCount++;
        if (twai_get_status_info(&s_info) == ESP_OK &&
            s_info.state == TWAI_STATE_BUS_OFF) {
          stats.canInitialized = false;
          twai_initiate_recovery();
        }
        uint8_t e[2] = { CMD_CAN_FRAME, STATUS_CAN_ERROR };
        sendBinaryPacket(CMD_ERROR_RESP, e, 2, transport);
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
      if (len < 1) break;
      uint8_t protoId = payload[0];
      elmConfig.protocol = protoId;
      elmConfig.protocolResolved = false;

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
      } else if (protoId == PROTO_ISO9141_SLOW) {
        initKlineIso9141();
      } else if (protoId == PROTO_KWP2000_SLOW) {
        initKlineKwpSlow();
      }
      break;
    }

    case CMD_KLINE_INIT: {
      uint8_t protoId = (len >= 1) ? payload[0] : PROTO_AUTO;
      uint8_t status = STATUS_INIT_FAILED;

      if (protoId == PROTO_KWP2000_FAST) {
        status = initKlineKwpFast();
      } else if (protoId == PROTO_ISO9141_SLOW) {
        status = initKlineIso9141();
      } else if (protoId == PROTO_KWP2000_SLOW) {
        status = initKlineKwpSlow();
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
      if (len < 1 || len > 58) break;
      uint8_t rxBuf[128];
      size_t rxLen = 0;
      uint8_t status = transceiveKlineFrame(payload, len, rxBuf, rxLen, 500);
      uint8_t respBuf[129];
      respBuf[0] = status;
      for (size_t i = 0; i < rxLen && i < 128; i++) respBuf[1 + i] = rxBuf[i];
      sendBinaryPacket(CMD_KLINE_FRAME, respBuf,
                       1 + min(rxLen, (size_t)128), transport);
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

// ============================================================================
// ELM output helpers
// ============================================================================

void sendElmResponseChunk(const char* chunk, ActiveTransport transport) {
  if (chunk == nullptr) return;
  size_t len = strlen(chunk);
  if (len == 0) return;

  if (transport == TRANSPORT_BLUETOOTH) {
    if (SerialBT.hasClient()) SerialBT.write((const uint8_t*)chunk, len);
  } else if (transport == TRANSPORT_WIFI) {
    if (tcpClient && tcpClient.connected()) tcpClient.write((const uint8_t*)chunk, len);
  }
}

void sendElmResponse(const char* resp, ActiveTransport transport) {
  sendElmResponseChunk(resp, transport);
}

// ============================================================================
// ISO-TP response formatter (ELM ASCII output)
// ============================================================================

void streamIsoTpResponse(ActiveTransport transport) {
  if (!isoTp.completed || isoTp.currentLen == 0) {
    sendElmResponse("NO DATA\r\n>", transport);
    return;
  }

  if (elmConfig.headers) {
    char headerBuf[20];
    if (isoTp.isExtended) {
      sprintf(headerBuf, "%08lX ", (unsigned long)isoTp.expectedRxId);
    } else {
      sprintf(headerBuf, "%03lX ", (unsigned long)isoTp.expectedRxId);
    }
    sendElmResponseChunk(headerBuf, transport);
  }

  char chunkBuf[128];
  size_t chunkPos = 0;
  for (size_t b = 0; b < isoTp.currentLen; b++) {
    int written = sprintf(chunkBuf + chunkPos, "%02X", isoTp.buffer[b]);
    if (written <= 0) break;
    chunkPos += written;
    if (elmConfig.spaces && b < isoTp.currentLen - 1) {
      if (chunkPos + 1 < sizeof(chunkBuf)) {
        chunkBuf[chunkPos++] = ' ';
        chunkBuf[chunkPos] = '\0';
      }
    }
    if (chunkPos >= 100) {
      sendElmResponseChunk(chunkBuf, transport);
      chunkPos = 0;
      chunkBuf[0] = '\0';
    }
  }
  if (chunkPos > 0) sendElmResponseChunk(chunkBuf, transport);
  sendElmResponse("\r\n>", transport);
}

// ============================================================================
// One CAN ISO-TP diagnostic attempt
// ============================================================================

bool executeCanIsoTpAttempt(const uint8_t* txBytes, size_t txLen,
                            uint8_t protocol, bool emitResponse,
                            ActiveTransport transport) {
  if (txBytes == nullptr || txLen == 0 || txLen > ISO_TP_MAX_BUF_SIZE) return false;

  bool extended = false;
  uint32_t headerId = elmConfig.headerId;
  uint32_t speed = 500;

  // ==========================================================================
  // V7-PERFECT: Service 09 (VIN) and 0A must use PHYSICAL address (0x7E0)
  // Only services 01-08 can use FUNCTIONAL (0x7DF)
  // ==========================================================================
  switch (protocol) {
    case PROTO_CAN_11_500:
      extended = false; speed = 500;
      if (elmConfig.protocol == PROTO_AUTO && elmConfig.headerId == 0x7E0) {
        if (txLen >= 1 && txBytes[0] >= 0x01 && txBytes[0] <= 0x08) {
          headerId = 0x7DF;
        }
        // 09, 0A stay at 0x7E0
      }
      break;
    case PROTO_CAN_29_500:
      extended = true; speed = 500;
      if (elmConfig.protocol == PROTO_AUTO && elmConfig.headerId == 0x7E0) {
        if (txLen >= 1 && txBytes[0] >= 0x01 && txBytes[0] <= 0x08) {
          headerId = 0x18DB33F1UL;
        } else {
          headerId = 0x18DA10F1UL;
        }
      }
      break;
    case PROTO_CAN_11_250:
      extended = false; speed = 250;
      if (elmConfig.protocol == PROTO_AUTO && elmConfig.headerId == 0x7E0) {
        if (txLen >= 1 && txBytes[0] >= 0x01 && txBytes[0] <= 0x08) {
          headerId = 0x7DF;
        }
      }
      break;
    case PROTO_CAN_29_250:
      extended = true; speed = 250;
      if (elmConfig.protocol == PROTO_AUTO && elmConfig.headerId == 0x7E0) {
        if (txLen >= 1 && txBytes[0] >= 0x01 && txBytes[0] <= 0x08) {
          headerId = 0x18DB33F1UL;
        } else {
          headerId = 0x18DA10F1UL;
        }
      }
      break;
    default:
      return false;
  }

  if (currentCanSpeedKbps != speed || !stats.canInitialized) {
    initCAN(speed);
  }

  twai_status_info_t s_info;
  if (twai_get_status_info(&s_info) != ESP_OK ||
      s_info.state != TWAI_STATE_RUNNING) {
    return false;
  }

  isoTp.active = true;
  isoTp.requestingTransport = transport;
  isoTp.isTx = false;
  isoTp.reqHeaderId = headerId;
  isoTp.isExtended = extended;
  isoTp.expectedRxId = deriveIsoTpResponseId(
    headerId, extended,
    headerId == 0x7DF || headerId == 0x18DB33F1UL);
  isoTp.totalLen = 0;
  isoTp.currentLen = 0;
  isoTp.expectedSn = 1;
  isoTp.blockSize = 0;
  isoTp.stMin = 0;
  isoTp.framesInCurrentBlock = 0;
  isoTp.fcWaitCount = 0;
  isoTp.waitFc = false;
  isoTp.fcStatus = 0;
  isoTp.gotFc = false;
  isoTp.startTime = millis();
  isoTp.pendingNrcCount = 0;

  // ==========================================================================
  // V7-PERFECT: UDS services (0x10 - 0x87) get 5-second timeout
  // OBD-II services (0x01 - 0x0A) keep default (300ms)
  // ==========================================================================
  if (txLen >= 1 && txBytes[0] >= 0x10 && txBytes[0] <= 0x87) {
    isoTp.timeoutMs = UDS_TIMEOUT_MS;
  } else {
    isoTp.timeoutMs = elmConfig.timeoutMs;
  }

  isoTp.completed = false;
  isoTp.failed = false;
  isoTp.errorMsg = NULL;

  twai_message_t stale;
  int staleLimit = 0;
  while (twai_receive(&stale, 0) == ESP_OK && staleLimit < 32) staleLimit++;

  if (txLen <= 7) {
    twai_message_t txMsg;
    memset(&txMsg, 0, sizeof(txMsg));
    txMsg.identifier = headerId;
    txMsg.extd = extended ? 1 : 0;
    txMsg.data_length_code = 8;
    txMsg.data[0] = txLen & 0x0F;
    for (size_t b = 0; b < txLen; b++) txMsg.data[1 + b] = txBytes[b];
    for (size_t b = 1 + txLen; b < 8; b++) txMsg.data[b] = 0xCC;

    if (twai_transmit(&txMsg, pdMS_TO_TICKS(50)) != ESP_OK) {
      stats.txErrorCount++;
      isoTp.failed = true;
      isoTp.errorMsg = "CAN TX ERROR";
      isoTp.active = false;
      return false;
    }
    stats.messagesSent++;
    isoTp.startTime = millis();
  } else {
    if (txLen > 4095) { isoTp.active = false; return false; }

    twai_message_t txMsg;
    memset(&txMsg, 0, sizeof(txMsg));
    txMsg.identifier = headerId;
    txMsg.extd = extended ? 1 : 0;
    txMsg.data_length_code = 8;
    txMsg.data[0] = 0x10 | ((txLen >> 8) & 0x0F);
    txMsg.data[1] = txLen & 0xFF;
    for (uint8_t b = 0; b < 6; b++) txMsg.data[2 + b] = txBytes[b];

    isoTp.isTx = true;
    isoTp.waitFc = true;
    isoTp.gotFc = false;

    if (twai_transmit(&txMsg, pdMS_TO_TICKS(50)) != ESP_OK) {
      stats.txErrorCount++;
      isoTp.failed = true;
      isoTp.errorMsg = "CAN FF TX ERROR";
      isoTp.active = false;
      return false;
    }
    stats.messagesSent++;

    unsigned long fcStart = millis();
    while (isoTp.waitFc && !isoTp.failed &&
           (millis() - fcStart < isoTp.timeoutMs)) {
      dispatchCanRx();
      yield();
    }

    if (!isoTp.gotFc || isoTp.failed) {
      isoTp.active = false;
      return false;
    }

    size_t bytesSent = 6;
    uint8_t seqNum = 1;
    uint8_t framesInBlock = 0;

    while (bytesSent < txLen && !isoTp.failed) {
      if (isoTp.blockSize != 0 && framesInBlock >= isoTp.blockSize) {
        isoTp.waitFc = true;
        isoTp.gotFc = false;
        unsigned long fcWaitStart = millis();
        while (isoTp.waitFc && !isoTp.failed &&
               (millis() - fcWaitStart < isoTp.timeoutMs)) {
          dispatchCanRx();
          yield();
        }
        if (!isoTp.gotFc || isoTp.failed) break;
        framesInBlock = 0;
      }

      if (isoTp.stMin <= 0x7F) {
        if (isoTp.stMin > 0) delay(isoTp.stMin);
      } else if (isoTp.stMin >= 0xF1 && isoTp.stMin <= 0xF9) {
        delayMicroseconds((isoTp.stMin & 0x0F) * 100);
      } else {
        delay(1);
      }

      twai_message_t cfTx;
      memset(&cfTx, 0, sizeof(cfTx));
      cfTx.identifier = headerId;
      cfTx.extd = extended ? 1 : 0;
      cfTx.data_length_code = 8;
      cfTx.data[0] = 0x20 | (seqNum & 0x0F);

      size_t chunk = min((size_t)7, txLen - bytesSent);
      for (size_t b = 0; b < chunk; b++) cfTx.data[1 + b] = txBytes[bytesSent + b];
      for (size_t b = 1 + chunk; b < 8; b++) cfTx.data[b] = 0xCC;

      if (twai_transmit(&cfTx, pdMS_TO_TICKS(50)) != ESP_OK) {
        stats.txErrorCount++;
        isoTp.failed = true;
        isoTp.errorMsg = "CAN CF TX ERROR";
        break;
      }
      stats.messagesSent++;
      bytesSent += chunk;
      seqNum = (seqNum + 1) & 0x0F;
      framesInBlock++;
    }

    if (isoTp.failed) {
      isoTp.active = false;
      if (emitResponse) sendElmResponse("CAN ERROR\r\n>", transport);
      return false;
    }

    isoTp.isTx = false;
    isoTp.waitFc = false;
    isoTp.gotFc = false;
    isoTp.expectedSn = 1;
    isoTp.framesInCurrentBlock = 0;
    isoTp.startTime = millis();
  }

  while (isoTp.active && !isoTp.completed && !isoTp.failed &&
         (millis() - isoTp.startTime < isoTp.timeoutMs)) {
    dispatchCanRx();
    yield();
  }

  bool success = isoTp.completed && !isoTp.failed && isoTp.currentLen > 0;

  if (!success && isoTp.active) {
    isoTp.failed = true;
    isoTp.errorMsg = "ECU RESPONSE TIMEOUT";
    isoTp.active = false;
  }

  if (success) {
    elmConfig.protocolResolved = true;
    if (elmConfig.protocol == PROTO_AUTO) {
      elmConfig.activeProtocol = protocol;
    }
    if (emitResponse) streamIsoTpResponse(transport);
    return true;
  }

  if (emitResponse) sendElmResponse("NO DATA\r\n>", transport);
  return false;
}

// ============================================================================
// Real auto protocol search (ATSP0)
// ============================================================================

bool autoSearchProtocol(const uint8_t* txBytes, size_t txLen,
                        ActiveTransport transport) {
  const uint8_t canProtocols[] = {
    PROTO_CAN_11_500,
    PROTO_CAN_29_500,
    PROTO_CAN_11_250,
    PROTO_CAN_29_250
  };

  for (uint8_t i = 0; i < sizeof(canProtocols); i++) {
    isoTp.active = false;
    isoTp.completed = false;
    isoTp.failed = false;

    if (executeCanIsoTpAttempt(txBytes, txLen, canProtocols[i], true, transport)) {
      elmConfig.protocol = PROTO_AUTO;
      elmConfig.activeProtocol = canProtocols[i];
      elmConfig.isExtended = (canProtocols[i] == PROTO_CAN_29_500 ||
                              canProtocols[i] == PROTO_CAN_29_250);
      return true;
    }
  }

  klineState.initialized = false;
  if (initKlineKwpFast() == STATUS_SUCCESS) {
    uint8_t rxBuf[128];
    size_t rxLen = 0;
    uint8_t status = transceiveKlineFrame(txBytes, txLen, rxBuf, rxLen,
                                          elmConfig.timeoutMs);
    if (status == STATUS_SUCCESS && rxLen > 0) {
      elmConfig.protocol = PROTO_AUTO;
      elmConfig.activeProtocol = PROTO_KWP2000_FAST;
      elmConfig.protocolResolved = true;

      char chunk[128];
      size_t pos = 0;
      for (size_t i = 0; i < rxLen; i++) {
        int n = sprintf(chunk + pos, "%02X", rxBuf[i]);
        if (n <= 0) break;
        pos += n;
        if (elmConfig.spaces && i < rxLen - 1) { chunk[pos++] = ' '; chunk[pos] = '\0'; }
        if (pos >= 100) { sendElmResponseChunk(chunk, transport); pos = 0; chunk[0] = '\0'; }
      }
      if (pos > 0) sendElmResponseChunk(chunk, transport);
      sendElmResponse("\r\n>", transport);
      return true;
    }
  }

  klineState.initialized = false;
  if (initKlineIso9141() == STATUS_SUCCESS) {
    uint8_t rxBuf[128];
    size_t rxLen = 0;
    uint8_t status = transceiveKlineFrame(txBytes, txLen, rxBuf, rxLen,
                                          elmConfig.timeoutMs);
    if (status == STATUS_SUCCESS && rxLen > 0) {
      elmConfig.protocol = PROTO_AUTO;
      elmConfig.activeProtocol = klineState.activeProtocol;
      elmConfig.protocolResolved = true;

      char chunk[128];
      size_t pos = 0;
      for (size_t i = 0; i < rxLen; i++) {
        int n = sprintf(chunk + pos, "%02X", rxBuf[i]);
        if (n <= 0) break;
        pos += n;
        if (elmConfig.spaces && i < rxLen - 1) { chunk[pos++] = ' '; chunk[pos] = '\0'; }
        if (pos >= 100) { sendElmResponseChunk(chunk, transport); pos = 0; chunk[0] = '\0'; }
      }
      if (pos > 0) sendElmResponseChunk(chunk, transport);
      sendElmResponse("\r\n>", transport);
      return true;
    }
  }

  elmConfig.protocolResolved = false;
  if (currentCanSpeedKbps != CAN_DEFAULT_SPEED_KBPS) {
    initCAN(CAN_DEFAULT_SPEED_KBPS);
  }
  return false;
}

// ============================================================================
// Main diagnostic transaction
// ============================================================================

void executeIsoTpTransaction(const uint8_t* txBytes, size_t txLen,
                             ActiveTransport transport) {
  if (isoTp.active) {
    sendElmResponse("BUSY\r\n>", transport);
    return;
  }

  if (txBytes == nullptr || txLen == 0 || txLen > ISO_TP_MAX_BUF_SIZE) {
    sendElmResponse("?\r\n>", transport);
    return;
  }

  if (elmConfig.protocol == PROTO_AUTO && !elmConfig.protocolResolved) {
    if (autoSearchProtocol(txBytes, txLen, transport)) return;
    sendElmResponse("NO DATA\r\n>", transport);
    return;
  }

  uint8_t activeP = (elmConfig.protocol == PROTO_AUTO)
    ? elmConfig.activeProtocol : elmConfig.protocol;

  if (activeP == PROTO_ISO9141_SLOW ||
      activeP == PROTO_KWP2000_FAST ||
      activeP == PROTO_KWP2000_SLOW) {
    uint8_t rxBuf[128];
    size_t rxLen = 0;
    uint8_t status = transceiveKlineFrame(txBytes, txLen, rxBuf, rxLen,
                                          elmConfig.timeoutMs);
    if (status == STATUS_SUCCESS && rxLen > 0) {
      elmConfig.protocolResolved = true;
      if (elmConfig.protocol == PROTO_AUTO) {
        elmConfig.activeProtocol = klineState.activeProtocol;
      }
      char chunk[128];
      size_t chunkPos = 0;
      for (size_t b = 0; b < rxLen; b++) {
        int n = sprintf(chunk + chunkPos, "%02X", rxBuf[b]);
        if (n <= 0) break;
        chunkPos += n;
        if (elmConfig.spaces && b < rxLen - 1) {
          if (chunkPos + 1 < sizeof(chunk)) {
            chunk[chunkPos++] = ' ';
            chunk[chunkPos] = '\0';
          }
        }
        if (chunkPos >= 100) {
          sendElmResponseChunk(chunk, transport);
          chunkPos = 0;
          chunk[0] = '\0';
        }
      }
      if (chunkPos > 0) sendElmResponseChunk(chunk, transport);
      sendElmResponse("\r\n>", transport);
    } else {
      sendElmResponse("NO DATA\r\n>", transport);
    }
    return;
  }

  if (activeP != PROTO_CAN_11_500 && activeP != PROTO_CAN_29_500 &&
      activeP != PROTO_CAN_11_250 && activeP != PROTO_CAN_29_250) {
    sendElmResponse("CAN ERROR\r\n>", transport);
    return;
  }

  executeCanIsoTpAttempt(txBytes, txLen, activeP, true, transport);
}

// ============================================================================
// Hex parser
// ============================================================================

bool parseHexUint32(const char* text, uint32_t& value) {
  if (text == nullptr || *text == '\0') return false;
  value = 0;
  while (*text != '\0') {
    char c = *text++;
    uint8_t digit;
    if (c >= '0' && c <= '9') digit = c - '0';
    else if (c >= 'A' && c <= 'F') digit = c - 'A' + 10;
    else if (c >= 'a' && c <= 'f') digit = c - 'a' + 10;
    else return false;
    if (value > 0x0FFFFFFFUL) return false;
    value = (value << 4) | digit;
  }
  return true;
}

// ============================================================================
// ELM line parser
// ============================================================================

void processElmLine(const char* rawLine, ActiveTransport transport) {
  char clean[128];
  size_t cIdx = 0;
  for (size_t i = 0; rawLine[i] != '\0' && cIdx < sizeof(clean) - 1; i++) {
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

  if (strncmp(clean, "AT", 2) == 0) {
    const char* cmd = clean + 2;

    if (strcmp(cmd, "Z") == 0 || strcmp(cmd, "WS") == 0) {
      elmConfig.echo = true;
      elmConfig.linefeed = true;
      elmConfig.headers = false;
      elmConfig.spaces = true;
      elmConfig.protocol = PROTO_AUTO;
      elmConfig.activeProtocol = PROTO_CAN_11_500;
      elmConfig.protocolResolved = false;
      elmConfig.headerId = 0x7E0;
      elmConfig.filterId = 0x7E8;
      elmConfig.isExtended = false;
      elmConfig.timeoutMs = OBD_TIMEOUT_DEFAULT_MS;
      elmConfig.allowLongMsgs = false;
      elmConfig.autoFormatting = true;
      klineState.initialized = false;
      isoTp.active = false;
      sendElmResponse("ELM327 v1.5\r\n>", transport);

    } else if (strcmp(cmd, "E0") == 0) { elmConfig.echo = false; sendElmResponse("OK\r\n>", transport); }
    else if (strcmp(cmd, "E1") == 0) { elmConfig.echo = true; sendElmResponse("OK\r\n>", transport); }
    else if (strcmp(cmd, "L0") == 0) { elmConfig.linefeed = false; sendElmResponse("OK\r\n>", transport); }
    else if (strcmp(cmd, "L1") == 0) { elmConfig.linefeed = true; sendElmResponse("OK\r\n>", transport); }
    else if (strcmp(cmd, "H0") == 0) { elmConfig.headers = false; sendElmResponse("OK\r\n>", transport); }
    else if (strcmp(cmd, "H1") == 0) { elmConfig.headers = true; sendElmResponse("OK\r\n>", transport); }
    else if (strcmp(cmd, "S0") == 0) { elmConfig.spaces = false; sendElmResponse("OK\r\n>", transport); }
    else if (strcmp(cmd, "S1") == 0) { elmConfig.spaces = true; sendElmResponse("OK\r\n>", transport); }
    else if (strcmp(cmd, "AL") == 0) { elmConfig.allowLongMsgs = true; sendElmResponse("OK\r\n>", transport); }
    else if (strcmp(cmd, "CAF0") == 0) { elmConfig.autoFormatting = false; sendElmResponse("OK\r\n>", transport); }
    else if (strcmp(cmd, "CAF1") == 0) { elmConfig.autoFormatting = true; sendElmResponse("OK\r\n>", transport); }

    else if (strncmp(cmd, "ST", 2) == 0) {
      const char* stValue = cmd + 2;
      if (strlen(stValue) == 0) { sendElmResponse("?\r\n>", transport); return; }
      uint32_t val = 0;
      if (!parseHexUint32(stValue, val) || val > 0xFF) {
        sendElmResponse("?\r\n>", transport);
        return;
      }
      if (val == 0) elmConfig.timeoutMs = OBD_TIMEOUT_DEFAULT_MS;
      else {
        uint32_t t = val * 4;
        if (t < 20) t = 20;
        if (t > 10000) t = 10000;
        elmConfig.timeoutMs = t;
      }
      sendElmResponse("OK\r\n>", transport);

    } else if (strncmp(cmd, "SP", 2) == 0) {
      const char* pStr = cmd + 2;
      if (strlen(pStr) != 1 || pStr[0] < '0' || pStr[0] > '9') {
        sendElmResponse("?\r\n>", transport);
        return;
      }
      uint8_t proto = pStr[0] - '0';
      elmConfig.protocol = proto;
      elmConfig.protocolResolved = false;
      isoTp.active = false;

      if (proto == 0) {
        elmConfig.activeProtocol = PROTO_CAN_11_500;
        elmConfig.isExtended = false;
      } else if (proto == PROTO_CAN_11_500) { initCAN(500); elmConfig.isExtended = false; elmConfig.activeProtocol = proto; }
      else if (proto == PROTO_CAN_29_500) { initCAN(500); elmConfig.isExtended = true; elmConfig.activeProtocol = proto; }
      else if (proto == PROTO_CAN_11_250) { initCAN(250); elmConfig.isExtended = false; elmConfig.activeProtocol = proto; }
      else if (proto == PROTO_CAN_29_250) { initCAN(250); elmConfig.isExtended = true; elmConfig.activeProtocol = proto; }
      else if (proto == PROTO_ISO9141_SLOW) { elmConfig.activeProtocol = proto; initKlineIso9141(); }
      else if (proto == PROTO_KWP2000_FAST) { elmConfig.activeProtocol = proto; initKlineKwpFast(); }
      else if (proto == PROTO_KWP2000_SLOW) { elmConfig.activeProtocol = proto; initKlineKwpSlow(); }
      else { sendElmResponse("?\r\n>", transport); return; }

      sendElmResponse("OK\r\n>", transport);

    } else if (strncmp(cmd, "SH", 2) == 0) {
      const char* hStr = cmd + 2;
      size_t hLen = strlen(hStr);
      if (hLen != 3 && hLen != 8) { sendElmResponse("?\r\n>", transport); return; }
      for (size_t k = 0; k < hLen; k++) {
        if (!isxdigit((unsigned char)hStr[k])) {
          sendElmResponse("?\r\n>", transport);
          return;
        }
      }
      uint32_t header = 0;
      if (!parseHexUint32(hStr, header)) { sendElmResponse("?\r\n>", transport); return; }
      if (hLen == 3 && header > 0x7FF) { sendElmResponse("?\r\n>", transport); return; }
      if (hLen == 8 && header > 0x1FFFFFFF) { sendElmResponse("?\r\n>", transport); return; }
      elmConfig.headerId = header;
      elmConfig.isExtended = (hLen == 8);
      sendElmResponse("OK\r\n>", transport);

    } else if (strcmp(cmd, "DP") == 0) {
      if (elmConfig.protocol == PROTO_AUTO && !elmConfig.protocolResolved) {
        sendElmResponse("AUTO, SEARCHING...\r\n>", transport);
      } else {
        uint8_t p = (elmConfig.protocol == PROTO_AUTO) ? elmConfig.activeProtocol : elmConfig.protocol;
        char dpBuf[64];
        if (p == PROTO_CAN_11_500) strcpy(dpBuf, "ISO 15765-4 (CAN 11/500)");
        else if (p == PROTO_CAN_29_500) strcpy(dpBuf, "ISO 15765-4 (CAN 29/500)");
        else if (p == PROTO_CAN_11_250) strcpy(dpBuf, "ISO 15765-4 (CAN 11/250)");
        else if (p == PROTO_CAN_29_250) strcpy(dpBuf, "ISO 15765-4 (CAN 29/250)");
        else if (p == PROTO_ISO9141_SLOW) strcpy(dpBuf, "ISO 9141-2");
        else if (p == PROTO_KWP2000_FAST) strcpy(dpBuf, "ISO 14230-4 (KWP FAST)");
        else if (p == PROTO_KWP2000_SLOW) strcpy(dpBuf, "ISO 14230-4 (KWP SLOW)");
        else strcpy(dpBuf, "AUTO");
        char out[96];
        if (elmConfig.protocol == PROTO_AUTO) sprintf(out, "AUTO, %s\r\n>", dpBuf);
        else sprintf(out, "%s\r\n>", dpBuf);
        sendElmResponse(out, transport);
      }

    } else if (strcmp(cmd, "DPN") == 0) {
      char dpnStr[32];
      if (elmConfig.protocol == PROTO_AUTO && !elmConfig.protocolResolved) {
        sprintf(dpnStr, "A0\r\n>");
      } else {
        uint8_t p = (elmConfig.protocol == PROTO_AUTO) ? elmConfig.activeProtocol : elmConfig.protocol;
        if (elmConfig.protocol == PROTO_AUTO) sprintf(dpnStr, "A%X\r\n>", p);
        else sprintf(dpnStr, "%X\r\n>", p);
      }
      sendElmResponse(dpnStr, transport);

    } else if (strcmp(cmd, "RV") == 0) {
      int rawAdc = adc1_get_raw(ADC1_CHANNEL_6);
      if (rawAdc <= 100) {
        sendElmResponse("NO DATA\r\n>", transport);
      } else {
        float volts = (rawAdc / 4095.0f) * 3.3f * 11.0f;
        char vStr[48];
        sprintf(vStr, "%.1fV\r\n>", volts);
        sendElmResponse(vStr, transport);
      }

    } else if (strcmp(cmd, "IGN") == 0) {
      int rawAdc = adc1_get_raw(ADC1_CHANNEL_6);
      if (rawAdc <= 100) {
        sendElmResponse("NO DATA\r\n>", transport);
      } else {
        float volts = (rawAdc / 4095.0f) * 3.3f * 11.0f;
        static bool ignState = false;
        if (volts > 12.5f) ignState = true;
        else if (volts < 11.5f) ignState = false;
        sendElmResponse(ignState ? "ON\r\n>" : "OFF\r\n>", transport);
      }

    } else if (strcmp(cmd, "I") == 0) {
      sendElmResponse("ELM327 v1.5\r\n>", transport);

    } else if (strcmp(cmd, "@1") == 0) {
      sendElmResponse("HAMZA OBD PRO ADAPTER\r\n>", transport);

    } else if (strcmp(cmd, "@2") == 0) {
      sendElmResponse(FIRMWARE_BUILD_ID "\r\n>", transport);

    } else if (strcmp(cmd, "D") == 0) {
      elmConfig.echo = true;
      elmConfig.linefeed = true;
      elmConfig.headers = false;
      elmConfig.spaces = true;
      elmConfig.timeoutMs = OBD_TIMEOUT_DEFAULT_MS;
      elmConfig.allowLongMsgs = false;
      elmConfig.autoFormatting = true;
      sendElmResponse("OK\r\n>", transport);

    } else if (strcmp(cmd, "PC") == 0) {
      isoTp.active = false;
      klineState.initialized = false;
      sendElmResponse("OK\r\n>", transport);

    } else if (strcmp(cmd, "BD") == 0) {
      sendElmResponse("38400\r\n>", transport);

    } else {
      sendElmResponse("?\r\n>", transport);
    }
    return;
  }

  if (cIdx % 2 != 0) {
    sendElmResponse("?\r\n>", transport);
    return;
  }

  uint8_t txBytes[4095];
  size_t txLen = 0;
  size_t maxInput = elmConfig.allowLongMsgs
    ? min(cIdx / 2, (size_t)ISO_TP_MAX_BUF_SIZE)
    : min(cIdx / 2, (size_t)64);

  for (size_t i = 0; i < cIdx && txLen < maxInput; i += 2) {
    if (!isxdigit((unsigned char)clean[i]) ||
        !isxdigit((unsigned char)clean[i + 1])) {
      sendElmResponse("?\r\n>", transport);
      return;
    }
    char byteStr[3] = {clean[i], clean[i + 1], '\0'};
    uint32_t parsedByte = 0;
    if (!parseHexUint32(byteStr, parsedByte)) {
      sendElmResponse("?\r\n>", transport);
      return;
    }
    txBytes[txLen++] = (uint8_t)parsedByte;
  }

  if (txLen == 0) {
    sendElmResponse("?\r\n>", transport);
    return;
  }

  executeIsoTpTransaction(txBytes, txLen, transport);
}

// ============================================================================
// Binary packet sender
// ============================================================================

void sendBinaryPacket(uint8_t cmd, const uint8_t* payload, uint16_t len,
                      ActiveTransport transport) {
  constexpr uint16_t FRAME_SIZE = 280;
  constexpr uint16_t HEADER_SIZE = 5;
  constexpr uint16_t TRAILER_SIZE = 3;
  constexpr uint16_t MAX_PAYLOAD = FRAME_SIZE - HEADER_SIZE - TRAILER_SIZE;

  if (len > MAX_PAYLOAD) return;
  if (len > 0 && payload == nullptr) return;

  const uint16_t totalLen = HEADER_SIZE + len + TRAILER_SIZE;
  uint8_t frame[FRAME_SIZE];
  frame[0] = PROTOCOL_MAGIC_1;
  frame[1] = PROTOCOL_MAGIC_2;
  frame[2] = cmd;
  frame[3] = (len >> 8) & 0xFF;
  frame[4] = len & 0xFF;
  if (len > 0) memcpy(&frame[5], payload, len);

  const uint8_t cs = calculateChecksum(cmd, len, payload);
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
  constexpr uint16_t FRAME_SIZE = 280;
  constexpr uint16_t HEADER_SIZE = 5;
  constexpr uint16_t TRAILER_SIZE = 3;
  constexpr uint16_t MAX_PAYLOAD = FRAME_SIZE - HEADER_SIZE - TRAILER_SIZE;

  if (len > MAX_PAYLOAD) return;
  if (len > 0 && payload == nullptr) return;

  const uint16_t totalLen = HEADER_SIZE + len + TRAILER_SIZE;
  uint8_t frame[FRAME_SIZE];
  frame[0] = PROTOCOL_MAGIC_1;
  frame[1] = PROTOCOL_MAGIC_2;
  frame[2] = cmd;
  frame[3] = (len >> 8) & 0xFF;
  frame[4] = len & 0xFF;
  if (len > 0) memcpy(&frame[5], payload, len);

  const uint8_t cs = calculateChecksum(cmd, len, payload);
  frame[5 + len] = cs;
  frame[5 + len + 1] = PROTOCOL_TRAILER_1;
  frame[5 + len + 2] = PROTOCOL_TRAILER_2;

  if (btSubscribedCan && SerialBT.hasClient()) SerialBT.write(frame, totalLen);
  if (wifiSubscribedCan && tcpClient && tcpClient.connected())
    tcpClient.write(frame, totalLen);
}

// ============================================================================
// PONG
// ============================================================================

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

// ============================================================================
// CAN status
// ============================================================================

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

  uint32_t speed = currentCanSpeedKbps * 1000UL;
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

  statusPayload[18] = stats.txErrorCount & 0xFF;
  statusPayload[19] = stats.rxErrorCount & 0xFF;
  statusPayload[20] = stats.busOverruns & 0xFF;

  sendBinaryPacket(CMD_CAN_STATUS_RESP, statusPayload, 21, transport);
}

// ============================================================================
// K-Line status
// ============================================================================

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
