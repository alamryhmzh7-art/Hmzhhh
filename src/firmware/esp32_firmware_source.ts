/**
 * HAMZA OBD PRO - Production ESP32 Dual-Transport Firmware Source
 * 
 * Hardware: ESP32-WROOM-32 / ESP32-DevKitC
 * CAN Transceiver: SN65HVD230 / TJA1050 (3.3V)
 * CAN Pins: CAN_TX = GPIO22, CAN_RX = GPIO21
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
 *  - Bluetooth Classic SPP (BluetoothSerial: "ESP32-OBD-PRO")
 *  - Wi-Fi Access Point ("ESP32-OBD-PRO", 192.168.4.1) + TCP Server (Port 35000)
 *  - Unified HAMZA OBD Binary Framing Protocol (Magic: 0xAA 0x55)
 *  - Ultra-low memory footprint with zero-heap-fragmentation ring buffers
 *  - Real-time CAN RX interrupt forwarding to active transport
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

#define WIFI_AP_SSID              "ESP32-OBD-PRO"
#define WIFI_AP_PASS              "12345678"
#define TCP_SERVER_PORT           35000

#define BT_DEVICE_NAME            "ESP32-OBD-PRO"

#define STATUS_LED_PIN            2 // Built-in LED on most ESP32 boards

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

// Static Stream Parser Buffer for Transport RX (Protects ESP32 Heap)
#define RX_STREAM_BUF_SIZE 512
uint8_t wifiRxBuf[RX_STREAM_BUF_SIZE];
size_t wifiRxHead = 0;

uint8_t btRxBuf[RX_STREAM_BUF_SIZE];
size_t btRxHead = 0;

// Forward Declarations
void initCAN(uint32_t speedKbps);
void processStreamBuffer(uint8_t* buffer, size_t& head, bool fromBluetooth);
void handleParsedCommand(uint8_t cmd, uint16_t len, const uint8_t* payload, bool fromBluetooth);
void broadcastBinaryPacket(uint8_t cmd, const uint8_t* payload, uint16_t len);
void sendPong(bool toBluetooth);
void sendCanStatus(bool toBluetooth);
uint8_t calculateChecksum(uint8_t cmd, uint16_t len, const uint8_t* payload);

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
      Serial.printf("[CAN] TWAI Initialized successfully @ %d kbps\\n", speedKbps);
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

  Serial.println("\\n==================================================");
  Serial.println("HAMZA OBD PRO - Dual-Transport Firmware v2.5.0");
  Serial.println("==================================================");

  // 1. Initialize Native CAN Bus (TWAI)
  initCAN(CAN_DEFAULT_SPEED_KBPS);

  // 2. Initialize Bluetooth Classic SPP
  if (SerialBT.begin(BT_DEVICE_NAME)) {
    Serial.printf("[BT] Bluetooth Classic SPP Ready as '%s'\\n", BT_DEVICE_NAME);
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
    Serial.printf("[WiFi] SoftAP Created: SSID='%s', IP=192.168.4.1\\n", WIFI_AP_SSID);
    tcpServer.begin();
    tcpServer.setNoDelay(true);
    Serial.printf("[WiFi] TCP Server listening on port %d\\n", TCP_SERVER_PORT);
  } else {
    Serial.println("[WiFi] ERROR: Failed to create SoftAP!");
  }

  Serial.printf("[SYS] Free Heap: %d bytes\\n", ESP.getFreeHeap());
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
      Serial.printf("[WiFi] New client connected: %s\\n", tcpClient.remoteIP().toString().c_str());
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

  // D. Poll Incoming CAN Frames from Vehicle ECU (TWAI RX)
  if (stats.canInitialized) {
    twai_message_t rxMsg;
    while (twai_receive(&rxMsg, 0) == ESP_OK) {
      stats.messagesReceived++;

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
        esp_err_t err = twai_transmit(&txMsg, pdMS_TO_TICKS(20));
        if (err == ESP_OK) {
          stats.messagesSent++;
        } else {
          stats.txErrorCount++;
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
  uint32_t speed = 500000;
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
`;
