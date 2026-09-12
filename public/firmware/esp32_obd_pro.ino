/*
 * ============================================================================
 * HAMZA OBD PRO - ESP32 Dual-Transport
 * Wi-Fi TCP + Bluetooth Classic SPP
 * ============================================================================
 *
 * Version: 2.6.0
 *
 * Features:
 *  - Native ESP32 TWAI / CAN 2.0B
 *  - CAN TX: GPIO22
 *  - CAN RX: GPIO21
 *  - Supported CAN bitrates:
 *      1000 / 500 / 250 / 125 kbps
 *  - Bluetooth Classic SPP
 *  - Wi-Fi SoftAP + TCP Server
 *  - HAMZA OBD Binary Protocol:
 *
 *      AA 55 | CMD | LEN(2) | PAYLOAD | CHECKSUM | 0D 0A
 *
 *  - Robust fragmented-stream parser
 *  - CAN RX forwarding
 *  - CAN TX
 *  - CAN status
 *  - PING / PONG
 *  - HEARTBEAT
 *  - CAN bus-off recovery
 *  - No fake CAN values
 *  - Deterministic status payload
 *  - Single active transport for unsolicited CAN frames
 *
 * IMPORTANT:
 *  This firmware provides physical CAN/TWAI only.
 *  K-Line / ISO9141 / KWP2000 / J1850 require appropriate hardware
 *  transceivers/controllers and are NOT created by software alone.
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include "BluetoothSerial.h"
#include "driver/twai.h"
#include "esp_system.h"

// ============================================================================
// Configuration
// ============================================================================

#define CAN_TX_PIN                 GPIO_NUM_22
#define CAN_RX_PIN                 GPIO_NUM_21

#define CAN_DEFAULT_SPEED_KBPS     500

#define WIFI_AP_SSID               "ESP32-OBD-PRO"
#define WIFI_AP_PASS               "12345678"
#define TCP_SERVER_PORT            35000

#define BT_DEVICE_NAME             "ESP32-OBD-PRO"

#define STATUS_LED_PIN             2

// ============================================================================
// Binary Protocol
// ============================================================================

#define PROTOCOL_MAGIC_1           0xAA
#define PROTOCOL_MAGIC_2           0x55

#define PROTOCOL_TRAILER_1         0x0D
#define PROTOCOL_TRAILER_2         0x0A

#define CMD_CAN_FRAME              0x01
#define CMD_PING                   0x02
#define CMD_PONG                   0x03
#define CMD_CAN_STATUS_REQ         0x04
#define CMD_CAN_STATUS_RESP        0x05
#define CMD_CONFIG_CAN             0x06
#define CMD_HEARTBEAT              0x07

#define MAX_PROTOCOL_PAYLOAD       256

// ============================================================================
// Transport
// ============================================================================

enum ActiveTransport : uint8_t {
  TRANSPORT_NONE = 0,
  TRANSPORT_WIFI = 1,
  TRANSPORT_BLUETOOTH = 2
};

volatile ActiveTransport activeTransport = TRANSPORT_NONE;

// ============================================================================
// Bluetooth / Wi-Fi
// ============================================================================

#if !defined(CONFIG_BT_ENABLED) || !defined(CONFIG_BLUEDROID_ENABLED)
#error "Bluetooth is not enabled in this ESP32 board definition!"
#endif

BluetoothSerial SerialBT;

WiFiServer tcpServer(TCP_SERVER_PORT);
WiFiClient tcpClient;

// ============================================================================
// Statistics
// ============================================================================

struct SystemStats {
  uint32_t messagesSent;
  uint32_t messagesReceived;

  uint32_t txErrorCount;
  uint32_t rxErrorCount;

  uint32_t busOverruns;

  uint32_t busErrorCount;
  uint32_t arbitrationLostCount;

  bool canInitialized;
  bool btConnected;
  bool wifiClientConnected;

  uint32_t canSpeedKbps;
};

SystemStats stats = {
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  false,
  false,
  false,
  CAN_DEFAULT_SPEED_KBPS
};

// ============================================================================
// Stream Buffers
// ============================================================================

#define RX_STREAM_BUF_SIZE 512

uint8_t wifiRxBuf[RX_STREAM_BUF_SIZE];
size_t wifiRxHead = 0;

uint8_t btRxBuf[RX_STREAM_BUF_SIZE];
size_t btRxHead = 0;

// ============================================================================
// Forward declarations
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

uint8_t calculateChecksum(
  uint8_t cmd,
  uint16_t len,
  const uint8_t* payload
);

bool sendBinaryPacket(
  ActiveTransport transport,
  uint8_t cmd,
  const uint8_t* payload,
  uint16_t len
);

void broadcastBinaryPacket(
  uint8_t cmd,
  const uint8_t* payload,
  uint16_t len
);

void sendPong(bool toBluetooth);

void sendCanStatus(bool toBluetooth);

void recoverCANIfNeeded();

void updateCanStatusCounters();

bool appendReceivedByte(
  uint8_t* buffer,
  size_t& head,
  uint8_t value
);

// ============================================================================
// CAN bitrate configuration
// ============================================================================

bool configureCanTiming(
  uint32_t speedKbps,
  twai_timing_config_t& config
) {
  switch (speedKbps) {

    case 1000:
      config = TWAI_TIMING_CONFIG_1MBITS();
      return true;

    case 500:
      config = TWAI_TIMING_CONFIG_500KBITS();
      return true;

    case 250:
      config = TWAI_TIMING_CONFIG_250KBITS();
      return true;

    case 125:
      config = TWAI_TIMING_CONFIG_125KBITS();
      return true;

    default:
      return false;
  }
}

// ============================================================================
// CAN initialization
// ============================================================================

void initCAN(uint32_t speedKbps) {

  Serial.printf(
    "[CAN] Requested initialization @ %lu kbps\n",
    (unsigned long)speedKbps
  );

  if (!configureCanTiming(speedKbps, *(new twai_timing_config_t()))) {
    Serial.printf(
      "[CAN] ERROR: Unsupported bitrate: %lu kbps\n",
      (unsigned long)speedKbps
    );

    stats.canInitialized = false;
    return;
  }

  // --------------------------------------------------------------------------
  // Stop existing driver
  // --------------------------------------------------------------------------

  twai_status_info_t oldStatus;

  if (twai_get_status_info(&oldStatus) == ESP_OK) {
    if (oldStatus.state != TWAI_STATE_STOPPED) {
      esp_err_t stopResult = twai_stop();

      if (stopResult != ESP_OK &&
          stopResult != ESP_ERR_INVALID_STATE) {

        Serial.printf(
          "[CAN] twai_stop() failed: %s\n",
          esp_err_to_name(stopResult)
        );
      }
    }
  }

  esp_err_t uninstallResult = twai_driver_uninstall();

  if (uninstallResult != ESP_OK &&
      uninstallResult != ESP_ERR_INVALID_STATE) {

    Serial.printf(
      "[CAN] twai_driver_uninstall() failed: %s\n",
      esp_err_to_name(uninstallResult)
    );
  }

  // --------------------------------------------------------------------------
  // TWAI configuration
  // --------------------------------------------------------------------------

  twai_general_config_t g_config =
    TWAI_GENERAL_CONFIG_DEFAULT(
      CAN_TX_PIN,
      CAN_RX_PIN,
      TWAI_MODE_NORMAL
    );

  g_config.rx_queue_len = 64;
  g_config.tx_queue_len = 32;

  twai_timing_config_t t_config;

  if (!configureCanTiming(speedKbps, t_config)) {

    Serial.printf(
      "[CAN] ERROR: Unsupported bitrate: %lu kbps\n",
      (unsigned long)speedKbps
    );

    stats.canInitialized = false;
    return;
  }

  twai_filter_config_t f_config =
    TWAI_FILTER_CONFIG_ACCEPT_ALL();

  // --------------------------------------------------------------------------
  // Install
  // --------------------------------------------------------------------------

  esp_err_t installResult =
    twai_driver_install(
      &g_config,
      &t_config,
      &f_config
    );

  if (installResult != ESP_OK) {

    Serial.printf(
      "[CAN] Driver install failed: %s\n",
      esp_err_to_name(installResult)
    );

    stats.canInitialized = false;
    return;
  }

  // --------------------------------------------------------------------------
  // Start
  // --------------------------------------------------------------------------

  esp_err_t startResult = twai_start();

  if (startResult != ESP_OK) {

    Serial.printf(
      "[CAN] Driver start failed: %s\n",
      esp_err_to_name(startResult)
    );

    twai_driver_uninstall();

    stats.canInitialized = false;
    return;
  }

  stats.canInitialized = true;
  stats.canSpeedKbps = speedKbps;

  Serial.printf(
    "[CAN] TWAI initialized successfully @ %lu kbps\n",
    (unsigned long)stats.canSpeedKbps
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
  Serial.println("HAMZA OBD PRO - ESP32 Firmware v2.6.0");
  Serial.println("==================================================");

  // --------------------------------------------------------------------------
  // CAN
  // --------------------------------------------------------------------------

  initCAN(CAN_DEFAULT_SPEED_KBPS);

  // --------------------------------------------------------------------------
  // Bluetooth Classic
  // --------------------------------------------------------------------------

  if (SerialBT.begin(BT_DEVICE_NAME)) {

    Serial.printf(
      "[BT] Bluetooth Classic SPP ready: '%s'\n",
      BT_DEVICE_NAME
    );

  } else {

    Serial.println(
      "[BT] ERROR: BluetoothSerial initialization failed!"
    );
  }

  // --------------------------------------------------------------------------
  // Wi-Fi AP
  // --------------------------------------------------------------------------

  IPAddress local_ip(
    192, 168, 4, 1
  );

  IPAddress gateway(
    192, 168, 4, 1
  );

  IPAddress subnet(
    255, 255, 255, 0
  );

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
      "[WiFi] SoftAP ready: %s\n",
      WIFI_AP_SSID
    );

    Serial.println(
      "[WiFi] IP: 192.168.4.1"
    );

    tcpServer.begin();
    tcpServer.setNoDelay(true);

    Serial.printf(
      "[WiFi] TCP server listening on port %d\n",
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
    "[SYS] System ready."
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

        // Only one Wi-Fi client is supported.
        // Reject additional connections instead of mixing streams.

        newClient.stop();

      } else {

        if (tcpClient) {
          tcpClient.stop();
        }

        tcpClient = newClient;
        tcpClient.setNoDelay(true);

        wifiRxHead = 0;

        stats.wifiClientConnected = true;

        Serial.printf(
          "[WiFi] Client connected: %s\n",
          tcpClient.remoteIP().toString().c_str()
        );
      }
    }
  }

  // ==========================================================================
  // B. Wi-Fi receive stream
  // ==========================================================================

  if (tcpClient &&
      tcpClient.connected()) {

    stats.wifiClientConnected = true;

    while (tcpClient.available()) {

      int incoming = tcpClient.read();

      if (incoming < 0) {
        break;
      }

      appendReceivedByte(
        wifiRxBuf,
        wifiRxHead,
        (uint8_t)incoming
      );
    }

    if (wifiRxHead > 0) {

      processStreamBuffer(
        wifiRxBuf,
        wifiRxHead,
        false
      );
    }

  } else {

    if (stats.wifiClientConnected) {

      Serial.println(
        "[WiFi] Client disconnected."
      );
    }

    stats.wifiClientConnected = false;

    if (tcpClient) {
      tcpClient.stop();
    }

    if (activeTransport == TRANSPORT_WIFI) {
      activeTransport = TRANSPORT_NONE;
    }

    wifiRxHead = 0;
  }

  // ==========================================================================
  // C. Bluetooth receive stream
  // ==========================================================================

  if (SerialBT.hasClient()) {

    stats.btConnected = true;

    while (SerialBT.available()) {

      int incoming = SerialBT.read();

      if (incoming < 0) {
        break;
      }

      appendReceivedByte(
        btRxBuf,
        btRxHead,
        (uint8_t)incoming
      );
    }

    if (btRxHead > 0) {

      processStreamBuffer(
        btRxBuf,
        btRxHead,
        true
      );
    }

  } else {

    stats.btConnected = false;

    if (activeTransport == TRANSPORT_BLUETOOTH) {
      activeTransport = TRANSPORT_NONE;
    }

    btRxHead = 0;
  }

  // ==========================================================================
  // D. CAN RX
  // ==========================================================================

  if (stats.canInitialized) {

    twai_message_t rxMsg;

    while (
      twai_receive(
        &rxMsg,
        0
      ) == ESP_OK
    ) {

      stats.messagesReceived++;

      uint8_t dlc =
        rxMsg.data_length_code;

      // TWAI classic CAN DLC must not exceed 8.
      if (dlc > 8) {
        stats.rxErrorCount++;
        continue;
      }

      // ----------------------------------------------------------------------
      // Payload:
      //
      // [0..3] CAN ID
      // [4]    FLAGS
      //        bit 0 = Extended
      //        bit 1 = RTR
      // [5]    DLC
      // [6..]  DATA
      // ----------------------------------------------------------------------

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
        (rxMsg.rtr ? 0x02 : 0x00);

      payload[5] = dlc;

      for (uint8_t i = 0; i < dlc; i++) {
        payload[6 + i] = rxMsg.data[i];
      }

      uint16_t payloadLen =
        (uint16_t)(6 + dlc);

      // ----------------------------------------------------------------------
      // Send unsolicited CAN RX only to the active transport.
      //
      // This prevents the same physical CAN frame from arriving twice in
      // the application when both Bluetooth and Wi-Fi are connected.
      // ----------------------------------------------------------------------

      if (activeTransport != TRANSPORT_NONE) {

        sendBinaryPacket(
          activeTransport,
          CMD_CAN_FRAME,
          payload,
          payloadLen
        );
      }

      // ----------------------------------------------------------------------
      // LED activity
      // ----------------------------------------------------------------------

      digitalWrite(
        STATUS_LED_PIN,
        !digitalRead(STATUS_LED_PIN)
      );
    }
  }

  // ==========================================================================
  // E. Check CAN status / recovery
  // ==========================================================================

  if (stats.canInitialized) {
    recoverCANIfNeeded();
  }

  // ==========================================================================
  // Background processing
  // ==========================================================================

  yield();
}

// ============================================================================
// Append byte safely to stream buffer
// ============================================================================

bool appendReceivedByte(
  uint8_t* buffer,
  size_t& head,
  uint8_t value
) {

  if (head < RX_STREAM_BUF_SIZE) {

    buffer[head++] = value;
    return true;
  }

  // Buffer full.
  //
  // Try parsing first. The caller normally parses after receiving a batch,
  // but this protects against a continuously growing stream.

  processStreamBuffer(
    buffer,
    head,
    false
  );

  if (head < RX_STREAM_BUF_SIZE) {

    buffer[head++] = value;
    return true;
  }

  // Still full.
  //
  // Preserve only a possible first magic byte.
  // Do not keep arbitrary garbage forever.

  if (buffer[RX_STREAM_BUF_SIZE - 1] ==
      PROTOCOL_MAGIC_1) {

    buffer[0] =
      PROTOCOL_MAGIC_1;

    head = 1;

  } else {

    head = 0;
  }

  buffer[head++] = value;

  return true;
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

  if (payload == nullptr && len > 0) {
    return checksum;
  }

  for (uint16_t i = 0; i < len; i++) {
    checksum ^= payload[i];
  }

  return checksum;
}

// ============================================================================
// Stream Parser
// ============================================================================
//
// Robust against:
//
//   AA
//   AA 55
//   AA 55 CMD
//   AA 55 CMD LEN
//   fragmented payload
//   fragmented checksum/trailer
//   corrupted frames
//   garbage before valid frames
//
// ============================================================================

void processStreamBuffer(
  uint8_t* buffer,
  size_t& head,
  bool fromBluetooth
) {

  if (buffer == nullptr || head == 0) {
    return;
  }

  size_t i = 0;

  while (true) {

    // ------------------------------------------------------------------------
    // Search for AA 55
    // ------------------------------------------------------------------------

    bool foundMagic = false;

    while (i + 1 < head) {

      if (buffer[i] == PROTOCOL_MAGIC_1 &&
          buffer[i + 1] == PROTOCOL_MAGIC_2) {

        foundMagic = true;
        break;
      }

      i++;
    }

    // ------------------------------------------------------------------------
    // No complete magic pair found.
    //
    // Preserve trailing AA because the next TCP/BT chunk may start with 55.
    // Everything else is garbage and can be discarded.
    // ------------------------------------------------------------------------

    if (!foundMagic) {

      if (head > 0 &&
          buffer[head - 1] == PROTOCOL_MAGIC_1) {

        buffer[0] =
          PROTOCOL_MAGIC_1;

        head = 1;

      } else {

        head = 0;
      }

      return;
    }

    // ------------------------------------------------------------------------
    // We have AA 55.
    //
    // Need at least:
    // AA 55 CMD LENH LENL
    // ------------------------------------------------------------------------

    if (head - i < 5) {

      if (i > 0) {

        size_t remaining =
          head - i;

        memmove(
          buffer,
          buffer + i,
          remaining
        );

        head = remaining;
      }

      return;
    }

    uint8_t cmd =
      buffer[i + 2];

    uint16_t len =
      ((uint16_t)buffer[i + 3] << 8) |
      buffer[i + 4];

    // ------------------------------------------------------------------------
    // Reject impossible payload length.
    // ------------------------------------------------------------------------

    if (len > MAX_PROTOCOL_PAYLOAD) {

      // Move one byte only.
      // A valid AA 55 sequence could exist inside the corrupted data.

      i++;
      continue;
    }

    // ------------------------------------------------------------------------
    // Full packet length
    //
    // AA55       = 2
    // CMD        = 1
    // LEN        = 2
    // PAYLOAD    = len
    // CHECKSUM   = 1
    // TRAILER    = 2
    //
    // Total = 8 + len
    // ------------------------------------------------------------------------

    size_t totalPacketLen =
      8 + (size_t)len;

    // ------------------------------------------------------------------------
    // Packet incomplete.
    //
    // VERY IMPORTANT:
    // Do not advance i.
    // The AA 55 must remain in the buffer for the next TCP/BT chunk.
    // ------------------------------------------------------------------------

    if (head - i < totalPacketLen) {

      if (i > 0) {

        size_t remaining =
          head - i;

        memmove(
          buffer,
          buffer + i,
          remaining
        );

        head = remaining;
      }

      return;
    }

    // ------------------------------------------------------------------------
    // Packet complete
    // ------------------------------------------------------------------------

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

    bool valid =
      (receivedChecksum == calculatedChecksum) &&
      (trailer1 == PROTOCOL_TRAILER_1) &&
      (trailer2 == PROTOCOL_TRAILER_2);

    if (valid) {

      handleParsedCommand(
        cmd,
        len,
        payload,
        fromBluetooth
      );

      i += totalPacketLen;

    } else {

      // Corrupt frame.
      //
      // Do not skip the whole frame because another valid AA55 could be
      // embedded in the corrupted stream.

      i++;
    }

    if (i >= head) {

      head = 0;
      return;
    }
  }
}

// ============================================================================
// Parsed Command Handler
// ============================================================================

void handleParsedCommand(
  uint8_t cmd,
  uint16_t len,
  const uint8_t* payload,
  bool fromBluetooth
) {

  // --------------------------------------------------------------------------
  // Mark source of the latest valid application command.
  //
  // This determines where unsolicited CAN RX frames are sent.
  // --------------------------------------------------------------------------

  activeTransport =
    fromBluetooth
      ? TRANSPORT_BLUETOOTH
      : TRANSPORT_WIFI;

  switch (cmd) {

    // ========================================================================
    // CAN FRAME TX
    // ========================================================================

    case CMD_CAN_FRAME: {

      // Minimum:
      // ID 4 + FLAGS 1 + DLC 1
      if (len < 6) {

        Serial.println(
          "[CAN] Reject TX frame: payload too short."
        );

        stats.txErrorCount++;
        break;
      }

      if (!stats.canInitialized) {

        Serial.println(
          "[CAN] Reject TX frame: CAN not initialized."
        );

        stats.txErrorCount++;
        break;
      }

      uint32_t canId =
        ((uint32_t)payload[0] << 24) |
        ((uint32_t)payload[1] << 16) |
        ((uint32_t)payload[2] << 8) |
        (uint32_t)payload[3];

      uint8_t flags =
        payload[4];

      uint8_t dlc =
        payload[5];

      bool extended =
        (flags & 0x01) != 0;

      bool rtr =
        (flags & 0x02) != 0;

      // ----------------------------------------------------------------------
      // Validate CAN ID
      // ----------------------------------------------------------------------

      if (canId > 0x1FFFFFFF) {

        Serial.println(
          "[CAN] Reject TX frame: invalid CAN ID."
        );

        stats.txErrorCount++;
        break;
      }

      if (!extended &&
          canId > 0x7FF) {

        Serial.println(
          "[CAN] Reject TX frame: standard CAN ID > 0x7FF."
        );

        stats.txErrorCount++;
        break;
      }

      // ----------------------------------------------------------------------
      // Validate DLC
      // ----------------------------------------------------------------------

      if (dlc > 8) {

        Serial.println(
          "[CAN] Reject TX frame: DLC > 8."
        );

        stats.txErrorCount++;
        break;
      }

      // ----------------------------------------------------------------------
      // Validate complete payload
      // ----------------------------------------------------------------------

      if (len < (uint16_t)(6 + dlc)) {

        Serial.println(
          "[CAN] Reject TX frame: missing CAN data bytes."
        );

        stats.txErrorCount++;
        break;
      }

      // ----------------------------------------------------------------------
      // Build TWAI frame
      // ----------------------------------------------------------------------

      twai_message_t txMsg = {};

      txMsg.identifier =
        canId;

      txMsg.extd =
        extended ? 1 : 0;

      txMsg.rtr =
        rtr ? 1 : 0;

      txMsg.data_length_code =
        dlc;

      // For RTR frames, the CAN controller does not transmit data bytes.
      // We still copy them safely because the TWAI structure may use the
      // buffer depending on driver behavior.
      for (uint8_t b = 0; b < dlc; b++) {

        txMsg.data[b] =
          payload[6 + b];
      }

      // ----------------------------------------------------------------------
      // TX
      // ----------------------------------------------------------------------

      esp_err_t result =
        twai_transmit(
          &txMsg,
          pdMS_TO_TICKS(50)
        );

      if (result == ESP_OK) {

        stats.messagesSent++;

      } else {

        stats.txErrorCount++;

        Serial.printf(
          "[CAN] TX failed: %s\n",
          esp_err_to_name(result)
        );

        recoverCANIfNeeded();
      }

      break;
    }

    // ========================================================================
    // PING
    // ========================================================================

    case CMD_PING: {

      sendPong(
        fromBluetooth
      );

      break;
    }

    // ========================================================================
    // CAN STATUS
    // ========================================================================

    case CMD_CAN_STATUS_REQ: {

      sendCanStatus(
        fromBluetooth
      );

      break;
    }

    // ========================================================================
    // CAN CONFIGURATION
    // ========================================================================

    case CMD_CONFIG_CAN: {

      if (len < 2) {

        Serial.println(
          "[CAN] CONFIG_CAN rejected: missing bitrate."
        );

        break;
      }

      uint16_t speedKbps =
        ((uint16_t)payload[0] << 8) |
        payload[1];

      if (!configureCanTiming(
            speedKbps,
            *(new twai_timing_config_t())
          )) {

        Serial.printf(
          "[CAN] Unsupported bitrate: %u kbps\n",
          speedKbps
        );

        break;
      }

      initCAN(
        speedKbps
      );

      break;
    }

    // ========================================================================
    // HEARTBEAT
    // ========================================================================

    case CMD_HEARTBEAT: {

      // Heartbeat itself does not require a response.
      //
      // We only mark the transport as active.
      //
      // This is intentionally lightweight because heartbeat packets can
      // arrive frequently.

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
// Send Binary Packet
// ============================================================================

bool sendBinaryPacket(
  ActiveTransport transport,
  uint8_t cmd,
  const uint8_t* payload,
  uint16_t len
) {

  // --------------------------------------------------------------------------
  // Validate payload
  // --------------------------------------------------------------------------

  if (len > MAX_PROTOCOL_PAYLOAD) {
    return false;
  }

  if (len > 0 &&
      payload == nullptr) {
    return false;
  }

  // --------------------------------------------------------------------------
  // Validate destination
  // --------------------------------------------------------------------------

  if (transport == TRANSPORT_NONE) {
    return false;
  }

  // --------------------------------------------------------------------------
  // Build frame
  // --------------------------------------------------------------------------

  uint16_t totalLen =
    (uint16_t)(8 + len);

  uint8_t frame[
    8 + MAX_PROTOCOL_PAYLOAD
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

  frame[6 + len] =
    PROTOCOL_TRAILER_1;

  frame[7 + len] =
    PROTOCOL_TRAILER_2;

  // --------------------------------------------------------------------------
  // Wi-Fi
  // --------------------------------------------------------------------------

  if (transport == TRANSPORT_WIFI) {

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

  // --------------------------------------------------------------------------
  // Bluetooth
  // --------------------------------------------------------------------------

  if (transport == TRANSPORT_BLUETOOTH) {

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

  return false;
}

// ============================================================================
// Broadcast helper
// ============================================================================
//
// This function is retained for compatibility.
//
// For CAN RX, the main loop now deliberately uses sendBinaryPacket() with
// activeTransport to prevent duplicate CAN frames.
//
// broadcastBinaryPacket() sends to every currently connected transport.
// Use it only when duplication is intentionally desired.
// ============================================================================

void broadcastBinaryPacket(
  uint8_t cmd,
  const uint8_t* payload,
  uint16_t len
) {

  if (len > MAX_PROTOCOL_PAYLOAD) {
    return;
  }

  if (tcpClient &&
      tcpClient.connected()) {

    sendBinaryPacket(
      TRANSPORT_WIFI,
      cmd,
      payload,
      len
    );
  }

  if (SerialBT.hasClient()) {

    sendBinaryPacket(
      TRANSPORT_BLUETOOTH,
      cmd,
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

  // --------------------------------------------------------------------------
  // 0..3 uptime
  // --------------------------------------------------------------------------

  pongPayload[0] =
    (uptime >> 24) & 0xFF;

  pongPayload[1] =
    (uptime >> 16) & 0xFF;

  pongPayload[2] =
    (uptime >> 8) & 0xFF;

  pongPayload[3] =
    uptime & 0xFF;

  // --------------------------------------------------------------------------
  // 4 CAN ready
  // --------------------------------------------------------------------------

  pongPayload[4] =
    stats.canInitialized
      ? 0x01
      : 0x00;

  // --------------------------------------------------------------------------
  // 5..8 free heap
  // --------------------------------------------------------------------------

  pongPayload[5] =
    (freeHeap >> 24) & 0xFF;

  pongPayload[6] =
    (freeHeap >> 16) & 0xFF;

  pongPayload[7] =
    (freeHeap >> 8) & 0xFF;

  pongPayload[8] =
    freeHeap & 0xFF;

  ActiveTransport destination =
    toBluetooth
      ? TRANSPORT_BLUETOOTH
      : TRANSPORT_WIFI;

  sendBinaryPacket(
    destination,
    CMD_PONG,
    pongPayload,
    sizeof(pongPayload)
  );
}

// ============================================================================
// Update CAN counters from TWAI
// ============================================================================

void updateCanStatusCounters() {

  if (!stats.canInitialized) {
    return;
  }

  twai_status_info_t status;

  if (twai_get_status_info(&status) != ESP_OK) {
    return;
  }

  stats.rxErrorCount =
    status.rx_error_counter;

  stats.busErrorCount =
    status.bus_error_count;

  stats.arbitrationLostCount =
    status.arb_lost_count;

  stats.busOverruns =
    status.rx_overrun_count;
}

// ============================================================================
// CAN status
// ============================================================================
//
// Existing BinaryProtocol expects at least 21 bytes:
//
// 0       State
// 1..4    Speed
// 5       TX error
// 6       RX error
// 7..8    RX overrun
// 9       Messages in RX queue
// 10..13  Messages sent
// 14..17  Messages received
// 18..20  Reserved
//
// All 21 bytes are initialized.
// ============================================================================

void sendCanStatus(
  bool toBluetooth
) {

  uint8_t statusPayload[21] = {};

  twai_status_info_t twaiStatus = {};

  bool statusValid =
    stats.canInitialized &&
    twai_get_status_info(
      &twaiStatus
    ) == ESP_OK;

  // --------------------------------------------------------------------------
  // State
  //
  // 0 = RUNNING
  // 1 = STOPPED
  // 2 = BUS_OFF
  // 3 = ERROR
  // 4 = RECOVERING
  // --------------------------------------------------------------------------

  uint8_t stateCode = 1;

  if (statusValid) {

    switch (twaiStatus.state) {

      case TWAI_STATE_RUNNING:
        stateCode = 0;
        break;

      case TWAI_STATE_STOPPED:
        stateCode = 1;
        break;

      case TWAI_STATE_BUS_OFF:
        stateCode = 2;
        break;

      case TWAI_STATE_RECOVERING:
        stateCode = 4;
        break;

      default:
        stateCode = 3;
        break;
    }
  }

  statusPayload[0] =
    stateCode;

  // --------------------------------------------------------------------------
  // 1..4 actual configured speed
  // --------------------------------------------------------------------------

  uint32_t speed =
    stats.canSpeedKbps * 1000UL;

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

  if (statusValid) {

    statusPayload[5] =
      twaiStatus.tx_error_counter;

    statusPayload[6] =
      twaiStatus.rx_error_counter;

    uint32_t overrun =
      twaiStatus.rx_overrun_count;

    statusPayload[7] =
      (overrun >> 8) & 0xFF;

    statusPayload[8] =
      overrun & 0xFF;

    statusPayload[9] =
      (twaiStatus.msgs_to_rx > 255)
        ? 255
        : twaiStatus.msgs_to_rx;

  } else {

    statusPayload[5] = 0;
    statusPayload[6] = 0;
    statusPayload[7] = 0;
    statusPayload[8] = 0;
    statusPayload[9] = 0;
  }

  // --------------------------------------------------------------------------
  // 10..13 messages sent
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
  // 14..17 messages received
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
  // 18..20 reserved.
  //
  // Explicitly zeroed because the application currently does not define
  // these fields.
  // --------------------------------------------------------------------------

  statusPayload[18] = 0;
  statusPayload[19] = 0;
  statusPayload[20] = 0;

  ActiveTransport destination =
    toBluetooth
      ? TRANSPORT_BLUETOOTH
      : TRANSPORT_WIFI;

  sendBinaryPacket(
    destination,
    CMD_CAN_STATUS_RESP,
    statusPayload,
    sizeof(statusPayload)
  );
}

// ============================================================================
// CAN recovery
// ============================================================================

void recoverCANIfNeeded() {

  if (!stats.canInitialized) {
    return;
  }

  twai_status_info_t status;

  if (twai_get_status_info(&status) != ESP_OK) {
    return;
  }

  // --------------------------------------------------------------------------
  // Update counters from actual TWAI controller
  // --------------------------------------------------------------------------

  stats.rxErrorCount =
    status.rx_error_counter;

  stats.busErrorCount =
    status.bus_error_count;

  stats.arbitrationLostCount =
    status.arb_lost_count;

  stats.busOverruns =
    status.rx_overrun_count;

  // --------------------------------------------------------------------------
  // BUS OFF
  // --------------------------------------------------------------------------

  if (status.state == TWAI_STATE_BUS_OFF) {

    Serial.println(
      "[CAN] BUS OFF detected. Starting recovery..."
    );

    esp_err_t recoveryResult =
      twai_initiate_recovery();

    if (recoveryResult != ESP_OK &&
        recoveryResult != ESP_ERR_INVALID_STATE) {

      Serial.printf(
        "[CAN] Recovery request failed: %s\n",
        esp_err_to_name(recoveryResult)
      );
    }

    return;
  }

  // --------------------------------------------------------------------------
  // STOPPED
  // --------------------------------------------------------------------------

  if (status.state == TWAI_STATE_STOPPED) {

    Serial.println(
      "[CAN] TWAI stopped. Attempting restart..."
    );

    esp_err_t startResult =
      twai_start();

    if (startResult == ESP_OK) {

      Serial.println(
        "[CAN] TWAI restarted successfully."
      );

    } else if (
      startResult != ESP_ERR_INVALID_STATE
    ) {

      Serial.printf(
        "[CAN] TWAI restart failed: %s\n",
        esp_err_to_name(startResult)
      );
    }
  }
}
