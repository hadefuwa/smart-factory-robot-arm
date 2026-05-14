/**
 * M5Stack PoE CAM-W - Smart Factory Vision System Firmware v1.1.0
 *
 * Connects via PoE Ethernet (W5500). Serves MJPEG stream on port 80.
 *
 * Endpoints:
 *   GET /        -> HTML status page (IP, uptime, firmware version)
 *   GET /stream  -> MJPEG continuous stream
 *   GET /capture -> single JPEG frame
 *   GET /status  -> JSON status (for backend health check)
 *
 * Hardware: M5Stack PoE CAM-W v1.1 (ESP32-D0WDQ6-V3 + OV3660 + W5500)
 * Board FQBN: esp32:esp32:m5stack_poe_cam (arduino-esp32 3.3.7)
 *
 * v1.1.0 change: replaced M5_Ethernet with arduino-esp32 built-in ETH.h.
 * Root cause of the v1.0.0 0.0.0.0 IP bug: W5500 RST pin is not wired on
 * this board, so M5_Ethernet's W5100.init() returned 0 silently.
 * ETH.h uses W5500 in polling mode (IRQ/RST = -1) and handles the
 * unconnected RST pin correctly via the esp_eth driver.
 */

#include "M5PoECAM.h"
#include <ETH.h>
#include <SPI.h>
#include <WiFi.h>   // provides WiFiServer / WiFiClient (unified lwIP stack in v3.x)

// ── Firmware metadata ─────────────────────────────────────────────────────────
#define FW_VERSION  "1.1.0"
#define DEVICE_NAME "SmartFactory-PoECAM"

// ── MJPEG stream boundary ─────────────────────────────────────────────────────
#define PART_BOUNDARY "123456789000000000000987654321"
static const char* STREAM_CONTENT_TYPE =
    "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* STREAM_BOUNDARY = "--" PART_BOUNDARY "\r\n";
static const char* STREAM_PART     =
    "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

// ── W5500 config (RST and IRQ are not wired on PoE CAM-W) ────────────────────
#define ETH_PHY_IRQ  -1
#define ETH_PHY_RST  -1

// ── Static IP (192.168.7.x industrial network) ────────────────────────────────
IPAddress staticIP(192, 168, 7,   6);
IPAddress gw      (192, 168, 7,   1);
IPAddress sn      (255, 255, 255, 0);
IPAddress dnsIP   (192, 168, 7,   1);

// ── Use VSPI bus for W5500 ────────────────────────────────────────────────────
SPIClass ethSPI(VSPI);

// WiFiServer works with ETH.h in arduino-esp32 v3.x (shared lwIP stack)
WiFiServer    server(80);
unsigned long bootMs = 0;
bool          ethUp  = false;

// ─────────────────────────────────────────────────────────────────────────────
// Forward declarations
void serveStream (WiFiClient* client);
void serveCapture(WiFiClient* client);
void serveStatus (WiFiClient* client);
void serveRoot   (WiFiClient* client);

// ── Ethernet event handler ────────────────────────────────────────────────────
void onEthEvent(arduino_event_id_t event, arduino_event_info_t info) {
    switch (event) {
        case ARDUINO_EVENT_ETH_START:
            Serial.println("[ETH] Started");
            ETH.setHostname("poe-cam");
            break;
        case ARDUINO_EVENT_ETH_CONNECTED:
            Serial.println("[ETH] Link UP");
            break;
        case ARDUINO_EVENT_ETH_GOT_IP:
            ethUp = true;
            Serial.printf("[ETH] IP: %s  MAC: %s\n",
                ETH.localIP().toString().c_str(),
                ETH.macAddress().c_str());
            break;
        case ARDUINO_EVENT_ETH_DISCONNECTED:
            Serial.println("[ETH] Link DOWN");
            ethUp = false;
            break;
        case ARDUINO_EVENT_ETH_STOP:
            Serial.println("[ETH] Stopped");
            ethUp = false;
            break;
        default: break;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
void setup() {
    delay(2000);  // Allow PoE/USB power rail to stabilise before touching SPI

    Serial.begin(115200);
    Serial.println("\n[PoECAM] Booting " DEVICE_NAME " v" FW_VERSION);

    // Camera init
    PoECAM.begin();
    if (!PoECAM.Camera.begin()) {
        Serial.println("[PoECAM] Camera init FAILED");
        while (true) {
            PoECAM.setLed(true);  delay(200);
            PoECAM.setLed(false); delay(200);
        }
    }
    Serial.println("[PoECAM] Camera OK");

    PoECAM.Camera.sensor->set_pixformat(PoECAM.Camera.sensor, PIXFORMAT_JPEG);
    PoECAM.Camera.sensor->set_framesize(PoECAM.Camera.sensor, FRAMESIZE_SVGA);
    PoECAM.Camera.sensor->set_quality(PoECAM.Camera.sensor, 12);
    PoECAM.Camera.sensor->set_vflip(PoECAM.Camera.sensor, 1);
    PoECAM.Camera.sensor->set_hmirror(PoECAM.Camera.sensor, 0);

    // Ethernet: ETH.h W5500 driver — polling mode, RST/IRQ both -1
    // Must register event handler BEFORE ETH.begin()
    ethSPI.begin(M5_POE_CAM_ETH_CLK_PIN, M5_POE_CAM_ETH_MISO_PIN,
                 M5_POE_CAM_ETH_MOSI_PIN, M5_POE_CAM_ETH_CS_PIN);
    Network.onEvent(onEthEvent);
    ETH.begin(ETH_PHY_W5500, 1, M5_POE_CAM_ETH_CS_PIN,
              ETH_PHY_IRQ, ETH_PHY_RST, ethSPI);
    ETH.config(staticIP, gw, sn, dnsIP);

    // Wait up to 8 s for link + IP
    Serial.println("[ETH] Waiting for link (8s max)...");
    uint32_t t = millis();
    while (!ethUp && (millis() - t) < 8000) delay(100);

    if (!ethUp) {
        Serial.println("[ETH] WARNING: no link after 8s — starting server anyway");
    }

    server.begin();
    bootMs = millis();

    Serial.println("[PoECAM] ========================================");
    Serial.printf( "[PoECAM]  IP      : %s\n",  ETH.localIP().toString().c_str());
    Serial.printf( "[PoECAM]  Stream  : http://%s/stream\n",  ETH.localIP().toString().c_str());
    Serial.printf( "[PoECAM]  Capture : http://%s/capture\n", ETH.localIP().toString().c_str());
    Serial.printf( "[PoECAM]  Status  : http://%s/status\n",  ETH.localIP().toString().c_str());
    Serial.println("[PoECAM] ========================================");

    PoECAM.setLed(true); delay(500); PoECAM.setLed(false);  // ready signal
}

// ─────────────────────────────────────────────────────────────────────────────
void loop() {
    WiFiClient client = server.available();
    if (!client) return;

    Serial.println("[PoECAM] Client connected");

    // Read the HTTP request line (e.g. "GET /stream HTTP/1.1")
    String requestLine = "";
    while (client.connected()) {
        if (client.available()) {
            char c = client.read();
            requestLine += c;
            if (c == '\n') break;
        }
    }

    // Drain remaining headers
    while (client.connected() && client.available()) {
        String line = client.readStringUntil('\n');
        if (line == "\r") break;
    }

    Serial.printf("[PoECAM] Request: %s", requestLine.c_str());

    if      (requestLine.startsWith("GET /stream"))   serveStream(&client);
    else if (requestLine.startsWith("GET /capture"))  serveCapture(&client);
    else if (requestLine.startsWith("GET /status"))   serveStatus(&client);
    else                                               serveRoot(&client);

    client.stop();
    Serial.println("[PoECAM] Client disconnected");
}

// ── Serve MJPEG stream ────────────────────────────────────────────────────────
void serveStream(WiFiClient* client) {
    client->println("HTTP/1.1 200 OK");
    client->printf("Content-Type: %s\r\n", STREAM_CONTENT_TYPE);
    client->println("Access-Control-Allow-Origin: *");
    client->println("Cache-Control: no-cache, no-store, must-revalidate");
    client->println("Connection: close");
    client->println();

    Serial.println("[PoECAM] Streaming...");
    int64_t last_frame = esp_timer_get_time();
    int frameCount = 0;

    while (client->connected()) {
        if (PoECAM.Camera.get()) {
            PoECAM.setLed(true);

            client->print(STREAM_BOUNDARY);
            client->printf(STREAM_PART, PoECAM.Camera.fb->len);

            uint8_t* buf    = PoECAM.Camera.fb->buf;
            int32_t  remain = PoECAM.Camera.fb->len;
            while (remain > 0) {
                int32_t chunk = (remain > 2048) ? 2048 : remain;
                if (client->write(buf, chunk) == 0) {
                    PoECAM.Camera.free();
                    PoECAM.setLed(false);
                    return;
                }
                buf    += chunk;
                remain -= chunk;
            }

            int64_t now        = esp_timer_get_time();
            int64_t elapsed_ms = (now - last_frame) / 1000;
            last_frame = now;
            frameCount++;

            if (frameCount % 30 == 0) {
                Serial.printf("[PoECAM] Stream: frame %d, %luKB, %.1f fps\n",
                    frameCount,
                    (unsigned long)(PoECAM.Camera.fb->len / 1024),
                    elapsed_ms > 0 ? 1000.0f / elapsed_ms : 0.0f);
            }

            PoECAM.Camera.free();
            PoECAM.setLed(false);
        }
    }
    Serial.println("[PoECAM] Stream ended");
}

// ── Serve single JPEG capture ─────────────────────────────────────────────────
void serveCapture(WiFiClient* client) {
    if (!PoECAM.Camera.get()) {
        client->println("HTTP/1.1 503 Service Unavailable\r\n\r\nCamera not ready");
        return;
    }

    client->println("HTTP/1.1 200 OK");
    client->printf("Content-Type: image/jpeg\r\n");
    client->printf("Content-Length: %u\r\n", PoECAM.Camera.fb->len);
    client->println("Access-Control-Allow-Origin: *");
    client->println("Cache-Control: no-cache");
    client->println();

    uint8_t* buf    = PoECAM.Camera.fb->buf;
    int32_t  remain = PoECAM.Camera.fb->len;
    while (remain > 0) {
        int32_t chunk = (remain > 2048) ? 2048 : remain;
        client->write(buf, chunk);
        buf    += chunk;
        remain -= chunk;
    }

    PoECAM.Camera.free();
    Serial.printf("[PoECAM] Capture served: %luKB\n",
        (unsigned long)(PoECAM.Camera.fb->len / 1024));
}

// ── Serve JSON status ─────────────────────────────────────────────────────────
void serveStatus(WiFiClient* client) {
    unsigned long uptimeSec = (millis() - bootMs) / 1000;
    IPAddress ip = ETH.localIP();

    char body[512];
    snprintf(body, sizeof(body),
        "{"
        "\"device\":\"%s\","
        "\"version\":\"%s\","
        "\"ip\":\"%d.%d.%d.%d\","
        "\"uptime_s\":%lu,"
        "\"stream_url\":\"http://%d.%d.%d.%d/stream\","
        "\"capture_url\":\"http://%d.%d.%d.%d/capture\","
        "\"camera\":\"OV3660\","
        "\"ok\":true"
        "}",
        DEVICE_NAME, FW_VERSION,
        ip[0], ip[1], ip[2], ip[3],
        uptimeSec,
        ip[0], ip[1], ip[2], ip[3],
        ip[0], ip[1], ip[2], ip[3]
    );

    client->println("HTTP/1.1 200 OK");
    client->println("Content-Type: application/json");
    client->printf("Content-Length: %d\r\n", strlen(body));
    client->println("Access-Control-Allow-Origin: *");
    client->println();
    client->print(body);
}

// ── Serve HTML status page ────────────────────────────────────────────────────
void serveRoot(WiFiClient* client) {
    IPAddress ip = ETH.localIP();
    unsigned long uptimeSec = (millis() - bootMs) / 1000;

    char body[1024];
    snprintf(body, sizeof(body),
        "<!DOCTYPE html><html><head><title>PoE CAM</title></head><body>"
        "<h2>M5Stack PoE CAM-W - Smart Factory</h2>"
        "<p><b>IP:</b> %d.%d.%d.%d</p>"
        "<p><b>Uptime:</b> %lu s</p>"
        "<p><b>Version:</b> " FW_VERSION "</p>"
        "<p><a href='/stream'>MJPEG Stream</a> | "
        "<a href='/capture'>Single Capture</a> | "
        "<a href='/status'>JSON Status</a></p>"
        "<img src='/stream' style='max-width:640px'>"
        "</body></html>",
        ip[0], ip[1], ip[2], ip[3],
        uptimeSec
    );

    client->println("HTTP/1.1 200 OK");
    client->println("Content-Type: text/html");
    client->printf("Content-Length: %d\r\n", strlen(body));
    client->println();
    client->print(body);
}
