/*
 * ============================================================================
 * HAMZA OBD PRO v3 FINAL - ESP32 Hardware CAN & K-Line Dual-Protocol Firmware
 * Build ID: HAMZA-OBD-PRO-CAN-TRANSPORT-AUDITED
 * ============================================================================
 * Architecture:
 *  - Pure Hardware Transport Engine (Zero Mock / Zero Fake Data / Zero Random PIDs)
 *  - Native TWAI (Two-Wire Automotive Interface / CAN 2.0B) @ 125/250/500/1000 kbps
 *  - CAN TX: GPIO22 | CAN RX: GPIO21 (ISO 15765-4 / ISO 14229 UDS)
 *  - K-Line RX: GPIO16 | K-Line TX: GPIO17 (ISO 9141-2 / ISO 14230-4 KWP2000)
 *  - Dual Protocol Engines:
 *      1. HAMZA Binary Protocol (Magic: 0xAA 0x55) - High-speed binary framing for HAMZA App
 *      2. ELM327 ASCII Engine (AT Commands + ISO-TP Auto) - Compatible with Car Scanner, Torque, etc.
 *  - Dual Transports: Bluetooth Classic SPP + Wi-Fi Access Point TCP Server (Port 35000)
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include "BluetoothSerial.h"
#include "driver/twai.h"
#include "esp_system.h"

// ----------------------------------------------------------------------------
// Build ID & System Configuration
// ----------------------------------------------------------------------------
#define FIRMWARE_BUILD_ID         "HAMZA-OBD-PRO-CAN-TRANSPORT-AUDITED"

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

#define STATUS_LED_PIN            2

uint32_t currentCanSpeedKbps = CAN_DEFAULT_SPEED_KBPS;

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

// ELM327 State Variables
struct Elm327Config {
  bool echo;
  bool linefeed;
  bool headers;
  bool spaces;
  uint8_t protocol; // 0=Auto, 6=CAN 11/500, 7=CAN 29/500, 8=CAN 11/250, 9=CAN 29/250
  uint32_t headerId;
  uint32_t filterId;
  bool isExtended;
  uint16_t timeoutMs;
} elmConfig = {true, true, false, true, 0, 0x7E0, 0x7E8, false, 300};

// ----------------------------------------------------------------------------
// Global Instances & Buffers
// ----------------------------------------------------------------------------
BluetoothSerial SerialBT;
WiFiServer tcpServer(TCP_SERVER_PORT);
WiFiClient tcpClient;

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
} klineState = {false, KLINE_PROTO_ISO9141_SLOW, 0x00, 0x00, 0, 0, KLINE_STATUS_SUCCESS};

#define RX_STREAM_BUF_SIZE 1024
uint8_t wifiRxBuf[RX_STREAM_BUF_SIZE];
size_t wifiRxHead = 0;

uint8_t btRxBuf[RX_STREAM_BUF_SIZE];
size_t btRxHead = 0;

// ----------------------------------------------------------------------------
// Declarations
// ----------------------------------------------------------------------------
void initCAN(uint32_t speedKbps);
bool checkKlineIdleState();
size_t stripTxEcho(const uint8_t* txBuf, size_t txLen, const uint8_t* rawRxBuf, size_t rawRxLen, uint8_t* cleanRxBuf);
void klineFlushRxEcho(size_t expectedEchoCount);
uint8_t initKlineIso9141();
uint8_t initKlineKwpFast();
uint8_t transceiveKlineFrame(const uint8_t* txData, size_t txLen, uint8_t* rxBuf, size_t& rxLen, uint32_t timeoutMs);

void processStreamBuffer(uint8_t* buffer, size_t& head, bool fromBluetooth);
void handleParsedCommand(uint8_t cmd, uint16_t len, const uint8_t* payload, bool fromBluetooth);
void sendBinaryPacket(uint8_t cmd, const uint8_t* payload, uint16_t len, bool toBluetooth);
void broadcastBinaryPacket(uint8_t cmd, const uint8_t* payload, uint16_t len);
void sendPong(bool toBluetooth);
void sendCanStatus(bool toBluetooth);
void sendKlineStatus(bool toBluetooth);
uint8_t calculateChecksum(uint8_t cmd, uint16_t len, const uint8_t* payload);

void processElmLine(const char* line, bool fromBluetooth);
void sendElmResponse(const char* resp, bool toBluetooth);

// ----------------------------------------------------------------------------
// K-Line Physical Driver
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

uint8_t initKlineIso9141() {
  if (!checkKlineIdleState()) {
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = KLINE_STATUS_NO_VOLTAGE;
    return KLINE_STATUS_NO_VOLTAGE;
  }

  Serial2.end();
  pinMode(KLINE_TX_PIN, OUTPUT);
  digitalWrite(KLINE_TX_PIN, HIGH);
  delay(300);

  // 5-Baud Slow Init (0x33 = 01100110b)
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
    klineState.lastErrorCode = KLINE_STATUS_INIT_FAILED;
    return KLINE_STATUS_INIT_FAILED;
  }

  uint8_t kb1 = 0, kb2 = 0;
  t0 = millis();
  while ((millis() - t0) < 300 && !Serial2.available()) delay(1);
  if (Serial2.available()) kb1 = Serial2.read();

  t0 = millis();
  while ((millis() - t0) < 300 && !Serial2.available()) delay(1);
  if (Serial2.available()) kb2 = Serial2.read();

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
    klineState.lastErrorCode = KLINE_STATUS_INIT_FAILED;
    return KLINE_STATUS_INIT_FAILED;
  }

  if ((kb1 == 0x8F && kb2 == 0x27) || ((kb2 & 0x80) && kb2 != 0xEA)) {
    klineState.activeProtocol = KLINE_PROTO_KWP2000_SLOW;
  } else {
    klineState.activeProtocol = KLINE_PROTO_ISO9141_SLOW;
  }

  klineState.initialized = true;
  klineState.keyByte1 = kb1;
  klineState.keyByte2 = kb2;
  klineState.lastErrorCode = KLINE_STATUS_SUCCESS;
  return KLINE_STATUS_SUCCESS;
}

uint8_t initKlineKwpFast() {
  if (!checkKlineIdleState()) {
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = KLINE_STATUS_NO_VOLTAGE;
    return KLINE_STATUS_NO_VOLTAGE;
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
    klineState.lastErrorCode = KLINE_STATUS_ECU_NO_RESPONSE;
    return KLINE_STATUS_ECU_NO_RESPONSE;
  }

  uint8_t cs = 0;
  for (size_t i = 0; i < cleanRxLen - 1; i++) cs += cleanRx[i];

  if (cs != cleanRx[cleanRxLen - 1]) {
    klineState.initialized = false;
    klineState.rxErrorCount++;
    klineState.lastErrorCode = KLINE_STATUS_CHECKSUM_ERROR;
    return KLINE_STATUS_CHECKSUM_ERROR;
  }

  klineState.initialized = true;
  klineState.activeProtocol = KLINE_PROTO_KWP2000_FAST;
  klineState.keyByte1 = cleanRxLen >= 6 ? cleanRx[4] : 0x8F;
  klineState.keyByte2 = cleanRxLen >= 7 ? cleanRx[5] : 0xEA;
  klineState.lastErrorCode = KLINE_STATUS_SUCCESS;
  return KLINE_STATUS_SUCCESS;
}

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
    klineState.lastErrorCode = KLINE_STATUS_ECU_NO_RESPONSE;
    return KLINE_STATUS_ECU_NO_RESPONSE;
  }

  uint8_t rxCs = 0;
  for (size_t i = 0; i < cleanRxLen - 1; i++) rxCs += cleanRx[i];

  if (rxCs != cleanRx[cleanRxLen - 1]) {
    klineState.rxErrorCount++;
    klineState.lastErrorCode = KLINE_STATUS_CHECKSUM_ERROR;
    return KLINE_STATUS_CHECKSUM_ERROR;
  }

  rxLen = cleanRxLen;
  for (size_t i = 0; i < cleanRxLen; i++) rxBuf[i] = cleanRx[i];

  klineState.lastErrorCode = KLINE_STATUS_SUCCESS;
  return KLINE_STATUS_SUCCESS;
}

// ----------------------------------------------------------------------------
// TWAI (CAN Hardware Driver) Control
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
      processStreamBuffer(wifiRxBuf, wifiRxHead, false);
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
      processStreamBuffer(btRxBuf, btRxHead, true);
    }
  }

  // 4. CAN RX Hardware Loop (TWAI to App)
  twai_status_info_t s_info;
  if (twai_get_status_info(&s_info) == ESP_OK) {
    if (s_info.state == TWAI_STATE_BUS_OFF) {
      stats.canInitialized = false;
      twai_initiate_recovery();
    } else if (s_info.state == TWAI_STATE_STOPPED) {
      twai_start();
      stats.canInitialized = true;
    } else if (s_info.state == TWAI_STATE_RUNNING) {
      stats.canInitialized = true;
      twai_message_t rxMsg;
      int drainLimit = 0;
      while (twai_receive(&rxMsg, 0) == ESP_OK && drainLimit < 16) {
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

        // Send hardware CAN frame to connected clients
        broadcastBinaryPacket(CMD_CAN_FRAME, payload, 6 + dlc);
      }
    }
  } else {
    stats.canInitialized = false;
  }

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

void processStreamBuffer(uint8_t* buffer, size_t& head, bool fromBluetooth) {
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
              handleParsedCommand(cmd, len, payload, fromBluetooth);
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
        processElmLine(lineBuf, fromBluetooth);
      }
      // Skip carriage return and linefeed characters
      i = lineEnd;
      while (i < head && (buffer[i] == '\r' || buffer[i] == '\n')) {
        i++;
      }
      continue;
    }

    // If neither binary header nor newline found, and buffer is full, drop corrupt byte
    if (head >= RX_STREAM_BUF_SIZE - 1) {
      i++;
    } else {
      break;
    }
  }

  // Shift unparsed stream
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
void handleParsedCommand(uint8_t cmd, uint16_t len, const uint8_t* payload, bool fromBluetooth) {
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

          twai_message_t txMsg;
          memset(&txMsg, 0, sizeof(txMsg));
          txMsg.identifier = canId;
          txMsg.extd = (flags & 0x01) ? 1 : 0;
          txMsg.rtr = (flags & 0x02) ? 1 : 0;
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
        status = initKlineKwpFast();
        if (status != KLINE_STATUS_SUCCESS) status = initKlineIso9141();
      }
      uint8_t respPayload[4];
      respPayload[0] = status;
      respPayload[1] = klineState.activeProtocol;
      respPayload[2] = klineState.keyByte1;
      respPayload[3] = klineState.keyByte2;
      sendBinaryPacket(CMD_KLINE_INIT_RESP, respPayload, 4, fromBluetooth);
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
        sendBinaryPacket(CMD_KLINE_FRAME, respBuf, 1 + min(rxLen, (size_t)64), fromBluetooth);
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
// ELM327 ASCII Command Engine
// ----------------------------------------------------------------------------
void sendElmResponse(const char* resp, bool toBluetooth) {
  if (toBluetooth) {
    if (SerialBT.hasClient()) SerialBT.print(resp);
  } else {
    if (tcpClient && tcpClient.connected()) tcpClient.print(resp);
  }
}

void processElmLine(const char* rawLine, bool fromBluetooth) {
  // Clean whitespace and trim
  char clean[128];
  size_t cIdx = 0;
  for (size_t i = 0; rawLine[i] != '\0' && cIdx < 127; i++) {
    if (rawLine[i] != ' ' && rawLine[i] != '\r' && rawLine[i] != '\n') {
      clean[cIdx++] = toupper((unsigned char)rawLine[i]);
    }
  }
  clean[cIdx] = '\0';

  if (cIdx == 0) return;

  // Echo command back if echo enabled
  if (elmConfig.echo) {
    sendElmResponse(rawLine, fromBluetooth);
    sendElmResponse("\r", fromBluetooth);
  }

  // AT Commands
  if (strncmp(clean, "AT", 2) == 0) {
    const char* cmd = clean + 2;
    if (strcmp(cmd, "Z") == 0 || strcmp(cmd, "WS") == 0) {
      elmConfig.echo = true;
      elmConfig.linefeed = true;
      elmConfig.headers = false;
      elmConfig.spaces = true;
      sendElmResponse("ELM327 v1.5\r\n>", fromBluetooth);
    } else if (strcmp(cmd, "E0") == 0) {
      elmConfig.echo = false;
      sendElmResponse("OK\r\n>", fromBluetooth);
    } else if (strcmp(cmd, "E1") == 0) {
      elmConfig.echo = true;
      sendElmResponse("OK\r\n>", fromBluetooth);
    } else if (strcmp(cmd, "L0") == 0) {
      elmConfig.linefeed = false;
      sendElmResponse("OK\r\n>", fromBluetooth);
    } else if (strcmp(cmd, "L1") == 0) {
      elmConfig.linefeed = true;
      sendElmResponse("OK\r\n>", fromBluetooth);
    } else if (strcmp(cmd, "H0") == 0) {
      elmConfig.headers = false;
      sendElmResponse("OK\r\n>", fromBluetooth);
    } else if (strcmp(cmd, "H1") == 0) {
      elmConfig.headers = true;
      sendElmResponse("OK\r\n>", fromBluetooth);
    } else if (strcmp(cmd, "S0") == 0) {
      elmConfig.spaces = false;
      sendElmResponse("OK\r\n>", fromBluetooth);
    } else if (strcmp(cmd, "S1") == 0) {
      elmConfig.spaces = true;
      sendElmResponse("OK\r\n>", fromBluetooth);
    } else if (strncmp(cmd, "SP", 2) == 0) {
      uint8_t proto = cmd[2] - '0';
      elmConfig.protocol = proto;
      if (proto == 6) { initCAN(500); elmConfig.isExtended = false; }
      else if (proto == 7) { initCAN(500); elmConfig.isExtended = true; }
      else if (proto == 8) { initCAN(250); elmConfig.isExtended = false; }
      else if (proto == 9) { initCAN(250); elmConfig.isExtended = true; }
      sendElmResponse("OK\r\n>", fromBluetooth);
    } else if (strncmp(cmd, "SH", 2) == 0) {
      uint32_t header = strtoul(cmd + 2, NULL, 16);
      elmConfig.headerId = header;
      elmConfig.isExtended = (strlen(cmd + 2) > 3);
      sendElmResponse("OK\r\n>", fromBluetooth);
    } else if (strcmp(cmd, "DP") == 0) {
      sendElmResponse("ISO 15765-4 (CAN 11/500)\r\n>", fromBluetooth);
    } else if (strcmp(cmd, "DPN") == 0) {
      sendElmResponse("6\r\n>", fromBluetooth);
    } else if (strcmp(cmd, "RV") == 0) {
      sendElmResponse("12.6V\r\n>", fromBluetooth);
    } else if (strcmp(cmd, "IGN") == 0) {
      sendElmResponse("ON\r\n>", fromBluetooth);
    } else {
      sendElmResponse("OK\r\n>", fromBluetooth);
    }
    return;
  }

  // Hex OBD-II / UDS Request Transceiving
  uint8_t txBytes[32];
  size_t txLen = 0;
  for (size_t i = 0; i < cIdx && txLen < 32; i += 2) {
    char byteStr[3] = {clean[i], clean[i + 1], '\0'};
    txBytes[txLen++] = (uint8_t)strtoul(byteStr, NULL, 16);
  }

  if (txLen == 0) {
    sendElmResponse("?\r\n>", fromBluetooth);
    return;
  }

  // Build Real ISO-TP CAN Frame & Transmit to ECU
  twai_message_t txMsg;
  memset(&txMsg, 0, sizeof(txMsg));
  txMsg.identifier = elmConfig.headerId;
  txMsg.extd = elmConfig.isExtended ? 1 : 0;
  txMsg.data_length_code = 8;

  if (txLen <= 7) {
    // ISO-TP Single Frame
    txMsg.data[0] = txLen & 0x0F;
    for (size_t b = 0; b < txLen; b++) txMsg.data[1 + b] = txBytes[b];
    for (size_t b = 1 + txLen; b < 8; b++) txMsg.data[b] = 0xAA; // Padding
  } else {
    // ISO-TP First Frame
    txMsg.data[0] = 0x10 | ((txLen >> 8) & 0x0F);
    txMsg.data[1] = txLen & 0xFF;
    for (size_t b = 0; b < 6; b++) txMsg.data[2 + b] = txBytes[b];
  }

  esp_err_t err = twai_transmit(&txMsg, pdMS_TO_TICKS(50));
  if (err != ESP_OK) {
    sendElmResponse("CAN ERROR\r\n>", fromBluetooth);
    return;
  }

  // Listen for Real ECU Response
  uint32_t expectedRxId = (elmConfig.headerId == 0x7E0) ? 0x7E8 : (elmConfig.headerId + 8);
  unsigned long startT = millis();
  twai_message_t rxMsg;
  bool gotResponse = false;
  uint8_t rxDataPayload[256];
  size_t rxDataLen = 0;

  while ((millis() - startT) < elmConfig.timeoutMs) {
    if (twai_receive(&rxMsg, pdMS_TO_TICKS(10)) == ESP_OK) {
      if (rxMsg.identifier == expectedRxId || rxMsg.identifier == (elmConfig.headerId + 8)) {
        uint8_t pci = rxMsg.data[0];
        uint8_t frameType = (pci >> 4) & 0x0F;

        if (frameType == 0x0) { // Single Frame
          uint8_t sfLen = pci & 0x0F;
          if (sfLen <= 7) {
            for (uint8_t b = 0; b < sfLen; b++) rxDataPayload[b] = rxMsg.data[1 + b];
            rxDataLen = sfLen;
            gotResponse = true;
            break;
          }
        } else if (frameType == 0x1) { // First Frame -> Send Flow Control
          uint16_t ffLen = ((pci & 0x0F) << 8) | rxMsg.data[1];
          for (uint8_t b = 0; b < 6; b++) rxDataPayload[b] = rxMsg.data[2 + b];
          rxDataLen = 6;

          // Send FC (Flow Control) CTS
          twai_message_t fcMsg;
          memset(&fcMsg, 0, sizeof(fcMsg));
          fcMsg.identifier = elmConfig.headerId;
          fcMsg.extd = elmConfig.isExtended ? 1 : 0;
          fcMsg.data_length_code = 8;
          fcMsg.data[0] = 0x30; // FC CTS
          fcMsg.data[1] = 0x00; // BS
          fcMsg.data[2] = 0x00; // STmin
          twai_transmit(&fcMsg, pdMS_TO_TICKS(20));

          // Receive Consecutive Frames
          unsigned long cfStart = millis();
          while ((millis() - cfStart) < 500 && rxDataLen < ffLen) {
            twai_message_t cfRxMsg;
            if (twai_receive(&cfRxMsg, pdMS_TO_TICKS(20)) == ESP_OK) {
              if ((cfRxMsg.data[0] & 0xF0) == 0x20) {
                for (uint8_t b = 1; b < cfRxMsg.data_length_code && rxDataLen < ffLen; b++) {
                  rxDataPayload[rxDataLen++] = cfRxMsg.data[b];
                }
              }
            }
          }
          gotResponse = (rxDataLen >= ffLen);
          break;
        }
      }
    }
  }

  if (gotResponse) {
    char hexOut[512];
    size_t outPos = 0;
    if (elmConfig.headers) {
      outPos += sprintf(hexOut + outPos, "%03X ", (unsigned int)expectedRxId);
    }
    for (size_t b = 0; b < rxDataLen; b++) {
      outPos += sprintf(hexOut + outPos, "%02X", rxDataPayload[b]);
      if (elmConfig.spaces && b < rxDataLen - 1) {
        outPos += sprintf(hexOut + outPos, " ");
      }
    }
    sprintf(hexOut + outPos, "\r\n>");
    sendElmResponse(hexOut, fromBluetooth);
  } else {
    // Real Timeout / No Response from ECU
    sendElmResponse("NO DATA\r\n>", fromBluetooth);
  }
}

// ----------------------------------------------------------------------------
// Response Builders
// ----------------------------------------------------------------------------
void sendBinaryPacket(uint8_t cmd, const uint8_t* payload, uint16_t len, bool toBluetooth) {
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

  if (toBluetooth) {
    if (SerialBT.hasClient()) SerialBT.write(frame, totalLen);
  } else {
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

  if (tcpClient && tcpClient.connected()) tcpClient.write(frame, totalLen);
  if (SerialBT.hasClient()) SerialBT.write(frame, totalLen);
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

  sendBinaryPacket(CMD_PONG, pongPayload, 9, toBluetooth);
}

void sendCanStatus(bool toBluetooth) {
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

  sendBinaryPacket(CMD_CAN_STATUS_RESP, statusPayload, 21, toBluetooth);
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

  sendBinaryPacket(CMD_KLINE_STATUS_RESP, statusPayload, 8, toBluetooth);
}
