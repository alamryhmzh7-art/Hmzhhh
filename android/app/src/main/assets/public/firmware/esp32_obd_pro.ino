/*
 * ============================================================================
 * HAMZA OBD PRO - ESP32 Dual-Transport Firmware
 * ============================================================================
 *
 * Real hardware firmware:
 *   - TWAI / CAN 2.0B
 *   - Bluetooth Classic SPP
 *   - Wi-Fi SoftAP + TCP
 *   - HAMZA OBD Binary Protocol
 *
 * Binary frame:
 *   AA 55 CMD LEN_H LEN_L PAYLOAD CHECKSUM 0D 0A
 *
 * Checksum:
 *   CMD ^ LEN_H ^ LEN_L ^ every PAYLOAD byte
 *
 * CAN payload:
 *   [ID 4B][FLAGS 1B][DLC 1B][DATA 0..8B]
 *
 * FLAGS:
 *   bit 0 = Extended 29-bit CAN ID
 *   bit 1 = RTR
 *
 * IMPORTANT:
 *   - No synthetic CAN frames.
 *   - No ELM327 ASCII parsing.
 *   - CAN data comes only from real TWAI hardware.
 *   - Responses are returned only to the transport that requested them.
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include "BluetoothSerial.h"
#include "driver/twai.h"
#include "esp_system.h"

// ============================================================================
// Hardware / Network Configuration
// ============================================================================

#define CAN_TX_PIN                GPIO_NUM_22
#define CAN_RX_PIN                GPIO_NUM_21

#define CAN_DEFAULT_SPEED_KBPS    500

#define WIFI_AP_SSID              "ESP32-OBD-PRO"
#define WIFI_AP_PASS              "12345678"
#define TCP_SERVER_PORT           35000

#define BT_DEVICE_NAME            "ESP32-OBD-PRO"

#define STATUS_LED_PIN            2

// ============================================================================
// Binary Protocol
// ============================================================================

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

/*
 * Firmware transmit buffer is 256 bytes.
 *
 * Total frame size:
 *   2 magic + 1 cmd + 2 length + payload + 1 checksum + 2 trailer
 *   = payload + 8
 *
 * Therefore the maximum safe payload is 248 bytes.
 */
#define MAX_PAYLOAD_SIZE          248

#define RX_STREAM_BUF_SIZE        512

// ============================================================================
// Global Hardware Instances
// ============================================================================

#if !defined(CONFIG_BT_ENABLED) || !defined(CONFIG_BLUEDROID_ENABLED)
#error "Bluetooth Classic is not enabled in this ESP32 board definition!"
#endif

BluetoothSerial SerialBT;

WiFiServer tcpServer(TCP_SERVER_PORT);
WiFiClient tcpClient;

// ============================================================================
// Runtime Statistics
// ============================================================================

struct SystemStats {
  uint32_t messagesSent;
  uint32_t messagesReceived;

  uint32_t txErrorCount;
  uint32_t rxErrorCount;

  uint32_t busOverruns;

  bool canInitialized;
  bool btConnected;
  bool wifiClientConnected;
};

SystemStats stats = {
  0,
  0,
  0,
  0,
  0,
  false,
  false,
  false
};

// ============================================================================
// CAN Runtime Configuration
// ============================================================================

uint32_t currentCanSpeedKbps = CAN_DEFAULT_SPEED_KBPS;

// ============================================================================
// Transport RX Buffers
// ============================================================================

uint8_t wifiRxBuf[RX_STREAM_BUF_SIZE];
size_t wifiRxHead = 0;

uint8_t btRxBuf[RX_STREAM_BUF_SIZE];
size_t btRxHead = 0;

// ============================================================================
// Forward Declarations
// ============================================================================

void initCAN(uint32_t speedKbps);

void processStreamBuffer(
  uint8_t* buffer,
  size_t& head,
  bool fromBluetooth
);

void handleParsedCommand(
  uint8_t cmd,
  uint16_t len,
  const uint8_t* payload,
  bool fromBluetooth
);

bool sendBinaryPacket(
  bool toBluetooth,
  uint8_t cmd,
  const uint8_t* payload,
  uint16_t len
);

void broadcastCanFrame(
  const uint8_t* payload,
  uint16_t len
);

void sendPong(bool toBluetooth);
void sendCanStatus(bool toBluetooth);

uint8_t calculateChecksum(
  uint8_t cmd,
  uint16_t len,
  const uint8_t* payload
);

bool isValidCanPayload(
  uint16_t len,
  const uint8_t* payload
);

// ============================================================================
// CAN Initialization
// ============================================================================

void initCAN(uint32_t speedKbps) {

  // Stop/uninstall previous driver if present.
  twai_stop();
  twai_driver_uninstall();

  twai_general_config_t g_config =
    TWAI_GENERAL_CONFIG_DEFAULT(
      CAN_TX_PIN,
      CAN_RX_PIN,
      TWAI_MODE_NORMAL
    );

  g_config.rx_queue_len = 32;
  g_config.tx_queue_len = 16;

  twai_timing_config_t t_config;

  switch (speedKbps) {

    case 1000:
      t_config = TWAI_TIMING_CONFIG_1MBITS();
      break;

    case 250:
      t_config = TWAI_TIMING_CONFIG_250KBITS();
      break;

    case 125:
      t_config = TWAI_TIMING_CONFIG_125KBITS();
      break;

    case 500:
      t_config = TWAI_TIMING_CONFIG_500KBITS();
      break;

    default:
      Serial.printf(
        "[CAN] Unsupported speed: %lu kbps. Using 500 kbps.\n",
        (unsigned long)speedKbps
      );

      speedKbps = 500;
      t_config = TWAI_TIMING_CONFIG_500KBITS();
      break;
  }

  /*
   * Current firmware deliberately accepts all CAN IDs.
   *
   * Filtering can be added later, but it must be implemented as a real
   * TWAI hardware filter rather than merely stored in the application.
   */
  twai_filter_config_t f_config =
    TWAI_FILTER_CONFIG_ACCEPT_ALL();

  esp_err_t installResult =
    twai_driver_install(
      &g_config,
      &t_config,
      &f_config
    );

  if (installResult != ESP_OK) {

    stats.canInitialized = false;

    Serial.printf(
      "[CAN] Driver install failed: 0x%X\n",
      installResult
    );

    return;
  }

  esp_err_t startResult = twai_start();

  if (startResult != ESP_OK) {

    stats.canInitialized = false;

    Serial.printf(
      "[CAN] Driver start failed: 0x%X\n",
      startResult
    );

    twai_driver_uninstall();
    return;
  }

  currentCanSpeedKbps = speedKbps;
  stats.canInitialized = true;

  Serial.printf(
    "[CAN] TWAI initialized @ %lu kbps\n",
    (unsigned long)currentCanSpeedKbps
  );
}

// ============================================================================
// Setup
// ============================================================================

void setup() {

  Serial.begin(115200);

  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  Serial.println();
  Serial.println("==================================================");
  Serial.println("HAMZA OBD PRO - ESP32 Firmware");
  Serial.println("REAL CAN / BT SPP / Wi-Fi TCP");
  Serial.println("==================================================");

  // --------------------------------------------------------------------------
  // CAN
  // --------------------------------------------------------------------------

  initCAN(CAN_DEFAULT_SPEED_KBPS);

  // --------------------------------------------------------------------------
  // Bluetooth Classic SPP
  // --------------------------------------------------------------------------

  if (SerialBT.begin(BT_DEVICE_NAME)) {

    Serial.printf(
      "[BT] SPP ready: %s\n",
      BT_DEVICE_NAME
    );

  } else {

    Serial.println(
      "[BT] ERROR: BluetoothSerial initialization failed!"
    );
  }

  // --------------------------------------------------------------------------
  // Wi-Fi Access Point
  // --------------------------------------------------------------------------

  IPAddress local_ip(192, 168, 4, 1);
  IPAddress gateway(192, 168, 4, 1);
  IPAddress subnet(255, 255, 255, 0);

  WiFi.mode(WIFI_AP);

  WiFi.softAPConfig(
    local_ip,
    gateway,
    subnet
  );

  if (WiFi.softAP(
        WIFI_AP_SSID,
        WIFI_AP_PASS
      )) {

    Serial.printf(
      "[WiFi] AP ready: %s\n",
      WIFI_AP_SSID
    );

    Serial.println(
      "[WiFi] IP: 192.168.4.1"
    );

    tcpServer.begin();
    tcpServer.setNoDelay(true);

    Serial.printf(
      "[WiFi] TCP port: %d\n",
      TCP_SERVER_PORT
    );

  } else {

    Serial.println(
      "[WiFi] ERROR: SoftAP creation failed!"
    );
  }

  Serial.printf(
    "[SYS] Free heap: %u bytes\n",
    ESP.getFreeHeap()
  );

  Serial.println(
    "[SYS] ESP32 OBD PRO ready."
  );
}

// ============================================================================
// Main Loop
// ============================================================================

void loop() {

  // ==========================================================================
  // A. Wi-Fi connection
  // ==========================================================================

  if (tcpServer.hasClient()) {

    WiFiClient newClient = tcpServer.available();

    if (newClient) {

      if (tcpClient &&
          tcpClient.connected()) {

        /*
         * Current firmware supports one Wi-Fi diagnostic client.
         * Reject/close the extra client rather than silently replacing
         * an active diagnostic session.
         */
        newClient.stop();

      } else {

        tcpClient.stop();

        tcpClient = newClient;
        tcpClient.setNoDelay(true);

        stats.wifiClientConnected = true;

        Serial.printf(
          "[WiFi] Client connected: %s\n",
          tcpClient.remoteIP().toString().c_str()
        );
      }
    }
  }

  // ==========================================================================
  // B. Wi-Fi RX
  // ==========================================================================

  if (tcpClient &&
      tcpClient.connected()) {

    while (tcpClient.available()) {

      if (wifiRxHead < RX_STREAM_BUF_SIZE) {

        int value = tcpClient.read();

        if (value >= 0) {
          wifiRxBuf[wifiRxHead++] =
            (uint8_t)value;
        }

      } else {

        /*
         * Do not allow malformed input to lock the parser.
         */
        Serial.println(
          "[WiFi] RX buffer overflow - resetting parser."
        );

        wifiRxHead = 0;
        break;
      }
    }

    if (wifiRxHead >= 7) {

      processStreamBuffer(
        wifiRxBuf,
        wifiRxHead,
        false
      );
    }

  } else {

    if (stats.wifiClientConnected) {

      stats.wifiClientConnected = false;

      Serial.println(
        "[WiFi] Client disconnected."
      );
    }

    wifiRxHead = 0;
  }

  // ==========================================================================
  // C. Bluetooth RX
  // ==========================================================================

  if (SerialBT.hasClient()) {

    stats.btConnected = true;

    while (SerialBT.available()) {

      if (btRxHead < RX_STREAM_BUF_SIZE) {

        int value = SerialBT.read();

        if (value >= 0) {
          btRxBuf[btRxHead++] =
            (uint8_t)value;
        }

      } else {

        Serial.println(
          "[BT] RX buffer overflow - resetting parser."
        );

        btRxHead = 0;
        break;
      }
    }

    if (btRxHead >= 7) {

      processStreamBuffer(
        btRxBuf,
        btRxHead,
        true
      );
    }

  } else {

    stats.btConnected = false;
    btRxHead = 0;
  }

  // ==========================================================================
  // D. Real CAN RX
  // ==========================================================================

  if (stats.canInitialized) {

    twai_message_t rxMsg;

    while (twai_receive(
      &rxMsg,
      0
    ) == ESP_OK) {

      stats.messagesReceived++;

      /*
       * CAN payload:
       *
       * [0..3] ID
       * [4]    FLAGS
       * [5]    DLC
       * [6..]  DATA
       */

      uint8_t payload[14];

      payload[0] =
        (rxMsg.identifier >> 24) & 0xFF;

      payload[1] =
        (rxMsg.identifier >> 16) & 0xFF;

      payload[2] =
        (rxMsg.identifier >> 8) & 0xFF;

      payload[3] =
        rxMsg.identifier & 0xFF;

      payload[4] =
        (rxMsg.extd ? 0x01 : 0x00) |
        (rxMsg.rtr  ? 0x02 : 0x00);

      uint8_t dlc =
        min(
          (int)rxMsg.data_length_code,
          8
        );

      payload[5] = dlc;

      for (uint8_t i = 0; i < dlc; i++) {
        payload[6 + i] =
          rxMsg.data[i];
      }

      uint16_t payloadLen =
        6 + dlc;

      /*
       * Real CAN frame only.
       * No synthetic values.
       */
      broadcastCanFrame(
        payload,
        payloadLen
      );

      digitalWrite(
        STATUS_LED_PIN,
        !digitalRead(STATUS_LED_PIN)
      );
    }
  }

  // ==========================================================================
  // Background processing
  // ==========================================================================

  yield();
}

// ============================================================================
// Checksum
// ============================================================================

uint8_t calculateChecksum(
  uint8_t cmd,
  uint16_t len,
  const uint8_t* payload
) {

  uint8_t checksum =
    cmd ^
    ((len >> 8) & 0xFF) ^
    (len & 0xFF);

  for (uint16_t i = 0; i < len; i++) {
    checksum ^= payload[i];
  }

  return checksum;
}

// ============================================================================
// Validate CAN Payload
// ============================================================================

bool isValidCanPayload(
  uint16_t len,
  const uint8_t* payload
) {

  if (payload == nullptr) {
    return false;
  }

  /*
   * Minimum:
   * ID 4 + FLAGS 1 + DLC 1
   */
  if (len < 6) {
    return false;
  }

  uint8_t flags = payload[4];
  uint8_t dlc   = payload[5];

  /*
   * Only:
   * bit 0 = Extended
   * bit 1 = RTR
   */
  if (flags & 0xFC) {
    return false;
  }

  if (dlc > 8) {
    return false;
  }

  /*
   * Exact protocol size:
   * 6 header bytes + DLC data bytes.
   */
  uint16_t expectedLen =
    6 + dlc;

  if (len != expectedLen) {

    Serial.printf(
      "[CAN] Invalid payload length: len=%u DLC=%u expected=%u\n",
      len,
      dlc,
      expectedLen
    );

    return false;
  }

  uint32_t canId =
    ((uint32_t)payload[0] << 24) |
    ((uint32_t)payload[1] << 16) |
    ((uint32_t)payload[2] << 8)  |
    (uint32_t)payload[3];

  bool extended =
    (flags & 0x01) != 0;

  if (!extended) {

    if (canId > 0x7FF) {
      return false;
    }

  } else {

    if (canId > 0x1FFFFFFF) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Stream Parser
// ============================================================================

void processStreamBuffer(
  uint8_t* buffer,
  size_t& head,
  bool fromBluetooth
) {

  if (buffer == nullptr ||
      head == 0) {
    return;
  }

  size_t i = 0;

  while (i + 7 <= head) {

    // ------------------------------------------------------------------------
    // Search for magic
    // ------------------------------------------------------------------------

    if (buffer[i] != PROTOCOL_MAGIC_1 ||
        buffer[i + 1] != PROTOCOL_MAGIC_2) {

      i++;
      continue;
    }

    uint8_t cmd =
      buffer[i + 2];

    uint16_t len =
      ((uint16_t)buffer[i + 3] << 8) |
      buffer[i + 4];

    /*
     * Reject lengths that cannot fit into the firmware protocol frame.
     */
    if (len > MAX_PAYLOAD_SIZE) {

      Serial.printf(
        "[PROTO] Invalid payload length: %u\n",
        len
      );

      i++;
      continue;
    }

    size_t totalPacketLen =
      2 + 1 + 2 + len + 1 + 2;

    // ------------------------------------------------------------------------
    // Wait for complete packet
    // ------------------------------------------------------------------------

    if (i + totalPacketLen > head) {
      break;
    }

    const uint8_t* payload =
      &buffer[i + 5];

    uint8_t receivedChecksum =
      buffer[i + 5 + len];

    uint8_t trailer1 =
      buffer[i + 5 + len + 1];

    uint8_t trailer2 =
      buffer[i + 5 + len + 2];

    uint8_t calculatedChecksum =
      calculateChecksum(
        cmd,
        len,
        payload
      );

    // ------------------------------------------------------------------------
    // Validate packet
    // ------------------------------------------------------------------------

    if (receivedChecksum != calculatedChecksum ||
        trailer1 != PROTOCOL_TRAILER_1 ||
        trailer2 != PROTOCOL_TRAILER_2) {

      /*
       * Corrupt packet.
       * Advance one byte and search again.
       */
      i++;
      continue;
    }

    // ------------------------------------------------------------------------
    // Valid packet
    // ------------------------------------------------------------------------

    handleParsedCommand(
      cmd,
      len,
      payload,
      fromBluetooth
    );

    i += totalPacketLen;
  }

  // ==========================================================================
  // Preserve incomplete tail
  // ==========================================================================

  if (i > 0) {

    size_t remaining =
      head - i;

    if (remaining > 0) {

      memmove(
        buffer,
        buffer + i,
        remaining
      );
    }

    head = remaining;
  }
}

// ============================================================================
// Command Handler
// ============================================================================

void handleParsedCommand(
  uint8_t cmd,
  uint16_t len,
  const uint8_t* payload,
  bool fromBluetooth
) {

  switch (cmd) {

    // ========================================================================
    // CAN TX
    // ========================================================================

    case CMD_CAN_FRAME: {

      if (!stats.canInitialized) {

        Serial.println(
          "[CAN-TX] Rejected: CAN is not initialized."
        );

        break;
      }

      if (!isValidCanPayload(
            len,
            payload
          )) {

        Serial.println(
          "[CAN-TX] Rejected: invalid CAN payload."
        );

        break;
      }

      uint32_t canId =
        ((uint32_t)payload[0] << 24) |
        ((uint32_t)payload[1] << 16) |
        ((uint32_t)payload[2] << 8)  |
        (uint32_t)payload[3];

      uint8_t flags =
        payload[4];

      uint8_t dlc =
        payload[5];

      twai_message_t txMsg = {};

      txMsg.identifier =
        canId;

      txMsg.extd =
        (flags & 0x01) ? 1 : 0;

      txMsg.rtr =
        (flags & 0x02) ? 1 : 0;

      txMsg.data_length_code =
        dlc;

      for (uint8_t i = 0; i < dlc; i++) {
        txMsg.data[i] =
          payload[6 + i];
      }

      esp_err_t result =
        twai_transmit(
          &txMsg,
          pdMS_TO_TICKS(20)
        );

      if (result == ESP_OK) {

        stats.messagesSent++;

      } else {

        stats.txErrorCount++;

        Serial.printf(
          "[CAN-TX] twai_transmit failed: 0x%X\n",
          result
        );

        twai_status_info_t status;

        if (twai_get_status_info(
              &status
            ) == ESP_OK) {

          if (status.state ==
              TWAI_STATE_BUS_OFF) {

            Serial.println(
              "[CAN] BUS-OFF -> initiating recovery."
            );

            twai_initiate_recovery();

          } else if (
            status.state ==
            TWAI_STATE_STOPPED
          ) {

            Serial.println(
              "[CAN] STOPPED -> restarting."
            );

            twai_start();
          }
        }
      }

      break;
    }

    // ========================================================================
    // PING
    // ========================================================================

    case CMD_PING: {

      /*
       * PING does not require a payload.
       */
      if (len != 0) {
        Serial.printf(
          "[PING] Unexpected payload length: %u\n",
          len
        );
      }

      sendPong(
        fromBluetooth
      );

      break;
    }

    // ========================================================================
    // CAN STATUS
    // ========================================================================

    case CMD_CAN_STATUS_REQ: {

      if (len != 0) {
        Serial.printf(
          "[CAN-STATUS] Unexpected payload length: %u\n",
          len
        );
      }

      sendCanStatus(
        fromBluetooth
      );

      break;
    }

    // ========================================================================
    // CAN CONFIG
    // ========================================================================

    case CMD_CONFIG_CAN: {

      /*
       * Current BinaryProtocol.ts sends:
       *
       *   2 bytes speed
       *   4 bytes filter ID
       *   4 bytes filter mask
       *
       * = 10 bytes.
       *
       * Firmware currently implements speed configuration only.
       * Filter values are deliberately NOT claimed as supported.
       */

      if (len != 10) {

        Serial.printf(
          "[CAN-CONFIG] Invalid payload length: %u (expected 10)\n",
          len
        );

        break;
      }

      uint16_t speedKbps =
        ((uint16_t)payload[0] << 8) |
        payload[1];

      switch (speedKbps) {

        case 125:
        case 250:
        case 500:
        case 1000:
          break;

        default:

          Serial.printf(
            "[CAN-CONFIG] Unsupported speed: %u kbps\n",
            speedKbps
          );

          break;
      }

      if (speedKbps == 125 ||
          speedKbps == 250 ||
          speedKbps == 500 ||
          speedKbps == 1000) {

        initCAN(
          speedKbps
        );
      }

      break;
    }

    // ========================================================================
    // Heartbeat
    // ========================================================================

    case CMD_HEARTBEAT: {

      /*
       * No synthetic diagnostic data is generated here.
       * Heartbeat is currently accepted and ignored.
       */

      break;
    }

    // ========================================================================
    // Unknown command
    // ========================================================================

    default: {

      Serial.printf(
        "[PROTO] Unknown command: 0x%02X len=%u\n",
        cmd,
        len
      );

      break;
    }
  }
}

// ============================================================================
// Send Packet To One Transport
// ============================================================================

bool sendBinaryPacket(
  bool toBluetooth,
  uint8_t cmd,
  const uint8_t* payload,
  uint16_t len
) {

  if (len > MAX_PAYLOAD_SIZE) {
    return false;
  }

  if (len > 0 &&
      payload == nullptr) {
    return false;
  }

  uint16_t totalLen =
    2 + 1 + 2 + len + 1 + 2;

  uint8_t frame[
    MAX_PAYLOAD_SIZE + 8
  ];

  frame[0] =
    PROTOCOL_MAGIC_1;

  frame[1] =
    PROTOCOL_MAGIC_2;

  frame[2] =
    cmd;

  frame[3] =
    (len >> 8) & 0xFF;

  frame[4] =
    len & 0xFF;

  if (len > 0) {

    memcpy(
      &frame[5],
      payload,
      len
    );
  }

  frame[5 + len] =
    calculateChecksum(
      cmd,
      len,
      payload
    );

  frame[5 + len + 1] =
    PROTOCOL_TRAILER_1;

  frame[5 + len + 2] =
    PROTOCOL_TRAILER_2;

  // --------------------------------------------------------------------------
  // Bluetooth
  // --------------------------------------------------------------------------

  if (toBluetooth) {

    if (!SerialBT.hasClient()) {
      return false;
    }

    size_t written =
      SerialBT.write(
        frame,
        totalLen
      );

    return written == totalLen;
  }

  // --------------------------------------------------------------------------
  // Wi-Fi
  // --------------------------------------------------------------------------

  if (!tcpClient ||
      !tcpClient.connected()) {

    return false;
  }

  size_t written =
    tcpClient.write(
      frame,
      totalLen
    );

  return written == totalLen;
}

// ============================================================================
// Broadcast Real CAN RX Frame
// ============================================================================

void broadcastCanFrame(
  const uint8_t* payload,
  uint16_t len
) {

  /*
   * CAN RX is a bus event, not a response to one command.
   *
   * Therefore a real CAN frame may be forwarded to every currently
   * connected diagnostic transport.
   */

  if (tcpClient &&
      tcpClient.connected()) {

    sendBinaryPacket(
      false,
      CMD_CAN_FRAME,
      payload,
      len
    );
  }

  if (SerialBT.hasClient()) {

    sendBinaryPacket(
      true,
      CMD_CAN_FRAME,
      payload,
      len
    );
  }
}

// ============================================================================
// PONG
// ============================================================================

void sendPong(
  bool toBluetooth
) {

  uint8_t pongPayload[9] = {};

  uint32_t uptime =
    millis();

  uint32_t freeHeap =
    ESP.getFreeHeap();

  // Uptime
  pongPayload[0] =
    (uptime >> 24) & 0xFF;

  pongPayload[1] =
    (uptime >> 16) & 0xFF;

  pongPayload[2] =
    (uptime >> 8) & 0xFF;

  pongPayload[3] =
    uptime & 0xFF;

  // CAN initialized
  pongPayload[4] =
    stats.canInitialized ? 0x01 : 0x00;

  // Free heap
  pongPayload[5] =
    (freeHeap >> 24) & 0xFF;

  pongPayload[6] =
    (freeHeap >> 16) & 0xFF;

  pongPayload[7] =
    (freeHeap >> 8) & 0xFF;

  pongPayload[8] =
    freeHeap & 0xFF;

  sendBinaryPacket(
    toBluetooth,
    CMD_PONG,
    pongPayload,
    sizeof(pongPayload)
  );
}

// ============================================================================
// CAN STATUS
// ============================================================================

void sendCanStatus(
  bool toBluetooth
) {

  twai_status_info_t twaiStatus = {};

  esp_err_t result =
    twai_get_status_info(
      &twaiStatus
    );

  if (result != ESP_OK) {

    Serial.printf(
      "[CAN-STATUS] twai_get_status_info failed: 0x%X\n",
      result
    );

    return;
  }

  /*
   * Status payload remains 21 bytes to preserve compatibility with
   * BinaryProtocol.ts.
   *
   * Bytes:
   *
   * 0      State
   * 1..4   Speed (bps)
   * 5      TX error counter
   * 6      RX error counter
   * 7..8   RX overrun count
   * 9      Messages waiting in RX queue
   * 10..13 Messages sent
   * 14..17 Messages received
   * 18..20 Reserved = 0
   */

  uint8_t statusPayload[21] = {};

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  switch (twaiStatus.state) {

    case TWAI_STATE_RUNNING:
      statusPayload[0] = 0;
      break;

    case TWAI_STATE_STOPPED:
      statusPayload[0] = 1;
      break;

    case TWAI_STATE_BUS_OFF:
      statusPayload[0] = 2;
      break;

    default:
      statusPayload[0] = 3;
      break;
  }

  // --------------------------------------------------------------------------
  // Current CAN speed in bits/sec
  // --------------------------------------------------------------------------

  uint32_t speed =
    currentCanSpeedKbps * 1000UL;

  statusPayload[1] =
    (speed >> 24) & 0xFF;

  statusPayload[2] =
    (speed >> 16) & 0xFF;

  statusPayload[3] =
    (speed >> 8) & 0xFF;

  statusPayload[4] =
    speed & 0xFF;

  // --------------------------------------------------------------------------
  // Error counters
  // --------------------------------------------------------------------------

  statusPayload[5] =
    twaiStatus.tx_error_counter;

  statusPayload[6] =
    twaiStatus.rx_error_counter;

  // --------------------------------------------------------------------------
  // RX overrun
  // --------------------------------------------------------------------------

  statusPayload[7] =
    (twaiStatus.rx_overrun_count >> 8) & 0xFF;

  statusPayload[8] =
    twaiStatus.rx_overrun_count & 0xFF;

  // --------------------------------------------------------------------------
  // RX queue
  // --------------------------------------------------------------------------

  statusPayload[9] =
    twaiStatus.msgs_to_rx;

  // --------------------------------------------------------------------------
  // Sent counter
  // --------------------------------------------------------------------------

  statusPayload[10] =
    (stats.messagesSent >> 24) & 0xFF;

  statusPayload[11] =
    (stats.messagesSent >> 16) & 0xFF;

  statusPayload[12] =
    (stats.messagesSent >> 8) & 0xFF;

  statusPayload[13] =
    stats.messagesSent & 0xFF;

  // --------------------------------------------------------------------------
  // Received counter
  // --------------------------------------------------------------------------

  statusPayload[14] =
    (stats.messagesReceived >> 24) & 0xFF;

  statusPayload[15] =
    (stats.messagesReceived >> 16) & 0xFF;

  statusPayload[16] =
    (stats.messagesReceived >> 8) & 0xFF;

  statusPayload[17] =
    stats.messagesReceived & 0xFF;

  // --------------------------------------------------------------------------
  // Reserved bytes
  // --------------------------------------------------------------------------

  statusPayload[18] = 0;
  statusPayload[19] = 0;
  statusPayload[20] = 0;

  sendBinaryPacket(
    toBluetooth,
    CMD_CAN_STATUS_RESP,
    statusPayload,
    sizeof(statusPayload)
  );
}
