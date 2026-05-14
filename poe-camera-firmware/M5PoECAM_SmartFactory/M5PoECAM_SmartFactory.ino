/**
 * M5Stack PoE CAM-W - Smart Factory Vision System Firmware
 *
 * Connects via PoE Ethernet (W5500). Serves MJPEG stream on port 80.
 *
 * Endpoints used by the Pi backend:
 *   GET /        -> status page (IP, uptime, firmware version)
 *   GET /stream  -> MJPEG continuous stream
 *   GET /capture -> single JPEG frame
 *   GET /status  -> JSON status (for backend health check)
 *
 * Hardware: M5Stack PoE CAM-W v1.1 (ESP32 + OV3660 + W5500)
 * Arduino Board: M5Stack (install from Board Manager with URL below)
 * Required libraries: M5PoECAM, M5_Ethernet (install via Library Manager)
 *
 * Board Manager URL:
 *   https://m5stack.oss-cn-shenzhen.aliyuncs.com/resource/arduino/package_m5stack_index.json
 */

#include "M5PoECAM.h"
#include <M5_Ethernet.h>
#include <SPI.h>

// ── Firmware metadata ─────────────────────────────────────────────────────────
#define FW_VERSION "1.0.0"
#define DEVICE_NAME "SmartFactory-PoECAM"

// ── MJPEG stream boundary (must match backend proxy) ─────────────────────────
#define PART_BOUNDARY "123456789000000000000987654321"
static const char* STREAM_CONTENT_TYPE =
    "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* STREAM_BOUNDARY = "--" PART_BOUNDARY "\r\n";
static const char* STREAM_PART     =
    "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

// ── Ethernet MAC (use camera's hardware MAC if known, else keep this default) ─
byte mac[] = {0x18, 0x7F, 0x88, 0x06, 0xA6, 0x26};  // matches 192.168.0.58

EthernetServer server(80);
unsigned long bootMs = 0;

// ─────────────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    Serial.println("\n[PoECAM] Booting " DEVICE_NAME " v" FW_VERSION);

    PoECAM.begin();

    // Camera init
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

    // Ethernet init (W5500 via SPI)
    SPI.begin(M5_POE_CAM_ETH_CLK_PIN, M5_POE_CAM_ETH_MISO_PIN,
              M5_POE_CAM_ETH_MOSI_PIN, -1);
    Ethernet.init(M5_POE_CAM_ETH_CS_PIN);

    Serial.println("[PoECAM] Waiting for DHCP...");
    int dhcpAttempts = 0;
    while (Ethernet.begin(mac) != 1) {
        dhcpAttempts++;
        Serial.printf("[PoECAM] DHCP attempt %d failed, retrying...\n", dhcpAttempts);
        delay(2000);
        if (dhcpAttempts > 10) {
            Serial.println("[PoECAM] DHCP failed after 10 attempts. Check PoE cable.");
        }
    }

    server.begin();
    bootMs = millis();

    Serial.println("[PoECAM] ========================================");
    Serial.printf( "[PoECAM]  IP       : %s\n", Ethernet.localIP().toString().c_str());
    Serial.printf( "[PoECAM]  Stream   : http://%s/stream\n", Ethernet.localIP().toString().c_str());
    Serial.printf( "[PoECAM]  Capture  : http://%s/capture\n", Ethernet.localIP().toString().c_str());
    Serial.printf( "[PoECAM]  Status   : http://%s/status\n", Ethernet.localIP().toString().c_str());
    Serial.println("[PoECAM] ========================================");

    PoECAM.setLed(true); delay(500); PoECAM.setLed(false);  // ready signal
}

// ─────────────────────────────────────────────────────────────────────────────
void loop() {
    Ethernet.maintain();  // renew DHCP lease if needed

    EthernetClient client = server.available();
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

    if (requestLine.startsWith("GET /stream")) {
        serveStream(&client);
    } else if (requestLine.startsWith("GET /capture")) {
        serveCapture(&client);
    } else if (requestLine.startsWith("GET /status")) {
        serveStatus(&client);
    } else {
        serveRoot(&client);
    }

    client.stop();
    Serial.println("[PoECAM] Client disconnected");
}

// ── Serve MJPEG stream ────────────────────────────────────────────────────────
void serveStream(EthernetClient* client) {
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

            int64_t now = esp_timer_get_time();
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
void serveCapture(EthernetClient* client) {
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
void serveStatus(EthernetClient* client) {
    unsigned long uptimeSec = (millis() - bootMs) / 1000;
    IPAddress ip = Ethernet.localIP();

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
void serveRoot(EthernetClient* client) {
    IPAddress ip = Ethernet.localIP();
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
