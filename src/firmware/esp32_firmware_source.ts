/**
 * HAMZA OBD PRO - Production ESP32 Dual-Transport Firmware Source
 * 
 * Hardware: ESP32-WROOM-32 / ESP32-DevKitC
 * CAN Transceiver: SN65HVD230 / TJA1050 (3.3V)
 * CAN Pins: CAN_TX = GPIO22, CAN_RX = GPIO21
 * K-Line Pins: KLINE_RX = GPIO16, KLINE_TX = GPIO17 (OBD Pin 7)
 * Transports:
 *   1. Bluetooth Classic SPP ("ESP32-OBD-PRO")
 *   2. Wi-Fi SoftAP ("ESP32-OBD-PRO") + TCP Server (Port 35000, 192.168.4.1)
 */

export const ESP32_DUAL_TRANSPORT_FIRMWARE_INO = `/*
 * ============================================================================
 * HAMZA OBD PRO - ESP32 Dual-Transport (Wi-Fi TCP + Bluetooth Classic SPP)
 * ============================================================================
 * Features:
 *  - Native TWAI (Two-Wire Automotive Interface / CAN 2.0B) @ 500kbps
 *  - CAN TX: GPIO22 | CAN RX: GPIO21 (ISO 15765-4 Standard)
 *  - K-Line RX: GPIO16 | K-Line TX: GPIO17 (ISO 9141-2 / ISO 14230-4 KWP2000)
 *  - Bluetooth Classic SPP (BluetoothSerial: "ESP32-OBD-PRO")
 *  - Wi-Fi Access Point ("ESP32-OBD-PRO", 192.168.4.1) + TCP Server (Port 35000)
 *  - Unified HAMZA OBD Binary Framing Protocol (Magic: 0xAA 0x55)
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

#define STATUS_LED_PIN            2

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

#define RX_STREAM_BUF_SIZE 512
uint8_t wifiRxBuf[RX_STREAM_BUF_SIZE];
size_t wifiRxHead = 0;

uint8_t btRxBuf[RX_STREAM_BUF_SIZE];
size_t btRxHead = 0;

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

bool checkKlineIdleState() {
  pinMode(KLINE_RX_PIN, INPUT_PULLUP);
  int lowCount = 0;
  for (int i = 0; i < 50; i++) {
    if (digitalRead(KLINE_RX_PIN) == LOW) lowCount++;
    delayMicroseconds(1000);
  }
  if (lowCount >= 40) return false;
  return true;
}

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
    for (size_t i = 0; i < txLen; i++) frameTx[3 + i] = txData[i];
    frameTxLen = 3 + txLen;

    uint8_t cs = 0;
    for (size_t i = 0; i < frameTxLen; i++) cs += frameTx[i];
    frameTx[frameTxLen++] = cs;
  } else {
    frameTx[0] = 0x80 | (txLen & 0x3F);
    frameTx[1] = 0x33;
    frameTx[2] = 0xF1;
    for (size_t i = 0; i < txLen; i++) frameTx[3 + i] = txData[i];
    frameTxLen = 3 + txLen;

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

void initCAN(uint32_t speedKbps) {
  twai_stop();
  twai_driver_uninstall();

  twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(CAN_TX_PIN, CAN_RX_PIN, TWAI_MODE_NORMAL);
  g_config.rx_queue_len = 32;
  g_config.tx_queue_len = 16;

  twai_timing_config_t t_config = TWAI_TIMING_CONFIG_500KBITS();
  if (speedKbps == 250) t_config = TWAI_TIMING_CONFIG_250KBITS();
  else if (speedKbps == 125) t_config = TWAI_TIMING_CONFIG_125KBITS();

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

void setup() {
  Serial.begin(115200);
  pinMode(STATUS_LED_PIN, OUTPUT);
  initCAN(CAN_DEFAULT_SPEED_KBPS);
  if (SerialBT.begin(BT_DEVICE_NAME)) {}
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
  if (tcpServer.hasClient()) {
    if (!tcpClient || !tcpClient.connected()) {
      if (tcpClient) tcpClient.stop();
      tcpClient = tcpServer.available();
      tcpClient.setNoDelay(true);
      stats.wifiClientConnected = true;
    }
  }

  if (tcpClient && tcpClient.connected()) {
    while (tcpClient.available()) {
      if (wifiRxHead < RX_STREAM_BUF_SIZE) wifiRxBuf[wifiRxHead++] = tcpClient.read();
      else wifiRxHead = 0;
    }
    if (wifiRxHead >= 7) processStreamBuffer(wifiRxBuf, wifiRxHead, false);
  }

  if (SerialBT.available()) {
    while (SerialBT.available()) {
      if (btRxHead < RX_STREAM_BUF_SIZE) btRxBuf[btRxHead++] = SerialBT.read();
      else btRxHead = 0;
    }
    if (btRxHead >= 7) processStreamBuffer(btRxBuf, btRxHead, true);
  }

  if (stats.canInitialized) {
    twai_message_t rxMsg;
    while (twai_receive(&rxMsg, 0) == ESP_OK) {
      stats.messagesReceived++;
      uint8_t payload[14];
      payload[0] = (rxMsg.identifier >> 24) & 0xFF;
      payload[1] = (rxMsg.identifier >> 16) & 0xFF;
      payload[2] = (rxMsg.identifier >> 8) & 0xFF;
      payload[3] = rxMsg.identifier & 0xFF;
      payload[4] = (rxMsg.extd ? 0x01 : 0x00) | (rxMsg.rtr ? 0x02 : 0x00);
      payload[5] = rxMsg.data_length_code;
      for (int i = 0; i < rxMsg.data_length_code && i < 8; i++) payload[6 + i] = rxMsg.data[i];
      broadcastBinaryPacket(CMD_CAN_FRAME, payload, 6 + rxMsg.data_length_code);
    }
  }
  yield();
}

uint8_t calculateChecksum(uint8_t cmd, uint16_t len, const uint8_t* payload) {
  uint8_t cs = cmd ^ ((len >> 8) & 0xFF) ^ (len & 0xFF);
  for (uint16_t i = 0; i < len; i++) cs ^= payload[i];
  return cs;
}

void processStreamBuffer(uint8_t* buffer, size_t& head, bool fromBluetooth) {
  size_t i = 0;
  while (i + 7 <= head) {
    if (buffer[i] == PROTOCOL_MAGIC_1 && buffer[i + 1] == PROTOCOL_MAGIC_2) {
      uint8_t cmd = buffer[i + 2];
      uint16_t len = (buffer[i + 3] << 8) | buffer[i + 4];
      size_t totalPacketLen = 2 + 1 + 2 + len + 1 + 2;
      if (i + totalPacketLen <= head) {
        const uint8_t* payload = &buffer[i + 5];
        uint8_t checksum = buffer[i + 5 + len];
        uint8_t tr1 = buffer[i + 5 + len + 1];
        uint8_t tr2 = buffer[i + 5 + len + 2];
        if (checksum == calculateChecksum(cmd, len, payload) && tr1 == PROTOCOL_TRAILER_1 && tr2 == PROTOCOL_TRAILER_2) {
          handleParsedCommand(cmd, len, payload, fromBluetooth);
          i += totalPacketLen;
          continue;
        }
      }
    }
    i++;
  }
  if (i > 0) {
    size_t remaining = head - i;
    for (size_t k = 0; k < remaining; k++) buffer[k] = buffer[i + k];
    head = remaining;
  }
}

void handleParsedCommand(uint8_t cmd, uint16_t len, const uint8_t* payload, bool fromBluetooth) {
  switch (cmd) {
    case CMD_CAN_FRAME: {
      if (len >= 6 && stats.canInitialized) {
        uint32_t canId = ((uint32_t)payload[0] << 24) | ((uint32_t)payload[1] << 16) | ((uint32_t)payload[2] << 8) | (uint32_t)payload[3];
        uint8_t flags = payload[4];
        uint8_t dlc = payload[5];
        twai_message_t txMsg;
        txMsg.identifier = canId;
        txMsg.extd = (flags & 0x01) ? 1 : 0;
        txMsg.rtr = (flags & 0x02) ? 1 : 0;
        txMsg.data_length_code = min((int)dlc, 8);
        for (int b = 0; b < txMsg.data_length_code; b++) txMsg.data[b] = payload[6 + b];
        esp_err_t err = twai_transmit(&txMsg, pdMS_TO_TICKS(20));
        if (err == ESP_OK) stats.messagesSent++;
        else {
          stats.txErrorCount++;
          twai_status_info_t s_info;
          if (twai_get_status_info(&s_info) == ESP_OK) {
            if (s_info.state == TWAI_STATE_BUS_OFF) twai_initiate_recovery();
            else if (s_info.state == TWAI_STATE_STOPPED) twai_start();
          }
        }
      }
      break;
    }
    case CMD_PING: { sendPong(fromBluetooth); break; }
    case CMD_CAN_STATUS_REQ: { sendCanStatus(fromBluetooth); break; }
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
      if (protoId == KLINE_PROTO_KWP2000_FAST) status = initKlineKwpFast();
      else if (protoId == KLINE_PROTO_ISO9141_SLOW || protoId == KLINE_PROTO_KWP2000_SLOW) status = initKlineIso9141();
      else {
        status = initKlineKwpFast();
        if (status != KLINE_STATUS_SUCCESS) status = initKlineIso9141();
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
    case CMD_KLINE_STATUS_REQ: { sendKlineStatus(fromBluetooth); break; }
    default: break;
  }
}

void broadcastBinaryPacket(uint8_t cmd, const uint8_t* payload, uint16_t len) {
  uint16_t totalLen = 2 + 1 + 2 + len + 1 + 2;
  uint8_t frame[256];
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
  broadcastBinaryPacket(CMD_PONG, pongPayload, 9);
}

void sendCanStatus(bool toBluetooth) {
  twai_status_info_t twai_status;
  twai_get_status_info(&twai_status);
  uint8_t statusPayload[21];
  statusPayload[0] = (twai_status.state == TWAI_STATE_RUNNING) ? 0 : (twai_status.state == TWAI_STATE_STOPPED) ? 1 : (twai_status.state == TWAI_STATE_BUS_OFF) ? 2 : 3;
  uint32_t speed = currentCanSpeedKbps * 1000;
  statusPayload[1] = (speed >> 24) & 0xFF;
  statusPayload[2] = (speed >> 16) & 0xFF;
  statusPayload[3] = (speed >> 8) & 0xFF;
  statusPayload[4] = speed & 0xFF;
  statusPayload[5] = twai_status.tx_error_counter;
  statusPayload[6] = twai_status.rx_error_counter;
  statusPayload[7] = (twai_status.rx_overrun_count >> 8) & 0xFF;
  statusPayload[8] = twai_status.rx_overrun_count & 0xFF;
  statusPayload[9] = twai_status.msgs_to_rx;
  statusPayload[10] = (stats.messagesSent >> 24) & 0xFF;
  statusPayload[11] = (stats.messagesSent >> 16) & 0xFF;
  statusPayload[12] = (stats.messagesSent >> 8) & 0xFF;
  statusPayload[13] = stats.messagesSent & 0xFF;
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
`;
