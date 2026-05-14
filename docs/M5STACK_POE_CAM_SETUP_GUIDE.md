# M5Stack PoE CAM-W (OV3660) — Setup Guide

Complete guide for getting the M5Stack PoE CAM-W V1.1 running as an Ethernet camera server.
Covers hardware, toolchain, firmware, flashing via Raspberry Pi GPIO UART, and integration.

---

## Hardware

| Component | Detail |
|-----------|--------|
| Board | M5Stack PoE CAM-W V1.1 |
| MCU | ESP32-D0WDQ6-V3 rev 3.1 |
| Camera sensor | OV3660 (3 MP, JPEG output) |
| Ethernet chip | WIZnet W5500 (SPI) |
| Flash | 4 MB |
| Power input | USB 5 V (G5V pin) **or** real PoE injector |

### Critical hardware fact — W5500 RST pin

The W5500's RST and INT pins are **not connected** to any ESP32 GPIO on this board (confirmed from schematic). This means:

- The `M5_Ethernet` library silently fails — its internal `W5100.init()` returns `0` without error because it cannot reset the chip to a known state.
- The fix is to use the arduino-esp32 built-in `ETH.h` driver which operates the W5500 in **polling mode** (`IRQ=-1, RST=-1`), tolerating the unconnected pins via the Espressif `esp_eth` layer.

> **Do not use `M5_Ethernet`.** You will get IP `0.0.0.0` regardless of delays or retries.

---

## Toolchain setup (Windows)

### 1. Arduino CLI

This project uses the Arduino CLI bundled with the eblocks Companion App, but any Arduino CLI ≥ 1.0 works.

```powershell
# Path used in this project:
$cli = "C:\Users\Hamed\Documents\eblocks-companion-app\resources\arduino-cli\win32\x64\arduino-cli.exe"

# Or install standalone:
winget install ArduinoSA.ArduinoCLI
$cli = "arduino-cli"
```

### 2. Install esp32 platform (arduino-esp32 3.3.7)

```powershell
& $cli core update-index
& $cli core install esp32:esp32@3.3.7
```

> `ETH.h` W5500 support requires arduino-esp32 **3.0.0 or later**. Version 3.3.7 is tested and working.

### 3. Install required libraries

```powershell
& $cli lib install "M5PoECAM"
```

The `M5PoECAM` library provides:
- `PoECAM.begin()` — initialises the OV3660 camera and LED
- `PoECAM.Camera.begin()` / `.get()` / `.free()` — camera frame buffer management
- `PoECAM.setLed()` — status LED on the board
- Pin macros: `M5_POE_CAM_ETH_CLK_PIN`, `M5_POE_CAM_ETH_MISO_PIN`, `M5_POE_CAM_ETH_MOSI_PIN`, `M5_POE_CAM_ETH_CS_PIN`

---

## Firmware

### Board FQBN

```
esp32:esp32:m5stack_poe_cam
```

### Key includes

```cpp
#include "M5PoECAM.h"    // camera + board BSP
#include <ETH.h>          // W5500 Ethernet (arduino-esp32 built-in, v3.x)
#include <SPI.h>
#include <WiFi.h>         // WiFiServer / WiFiClient (shared lwIP stack in v3.x)
```

### Ethernet initialisation (the critical part)

```cpp
// IRQ and RST are not wired on this board — must be -1
#define ETH_PHY_IRQ  -1
#define ETH_PHY_RST  -1

SPIClass ethSPI(VSPI);  // W5500 is on VSPI bus

// Inside setup():
delay(2000);  // Allow PoE/USB power rail to stabilise BEFORE touching SPI

ethSPI.begin(M5_POE_CAM_ETH_CLK_PIN, M5_POE_CAM_ETH_MISO_PIN,
             M5_POE_CAM_ETH_MOSI_PIN, M5_POE_CAM_ETH_CS_PIN);

// MUST register event handler BEFORE ETH.begin()
Network.onEvent(onEthEvent);

ETH.begin(ETH_PHY_W5500, 1, M5_POE_CAM_ETH_CS_PIN,
          ETH_PHY_IRQ, ETH_PHY_RST, ethSPI);

ETH.config(staticIP, gw, sn, dnsIP);  // Set static IP after begin()
```

### Static IP configuration

```cpp
IPAddress staticIP(192, 168, 7,   6);   // camera IP
IPAddress gw      (192, 168, 7,   1);   // gateway
IPAddress sn      (255, 255, 255, 0);   // subnet mask
IPAddress dnsIP   (192, 168, 7,   1);   // DNS (gateway doubles as DNS)
```

### Ethernet event handler

```cpp
bool ethUp = false;

void onEthEvent(arduino_event_id_t event, arduino_event_info_t info) {
    switch (event) {
        case ARDUINO_EVENT_ETH_START:
            ETH.setHostname("poe-cam");
            break;
        case ARDUINO_EVENT_ETH_GOT_IP:
            ethUp = true;
            Serial.printf("[ETH] IP: %s\n", ETH.localIP().toString().c_str());
            break;
        case ARDUINO_EVENT_ETH_DISCONNECTED:
        case ARDUINO_EVENT_ETH_STOP:
            ethUp = false;
            break;
        default: break;
    }
}
```

### Camera configuration

```cpp
PoECAM.Camera.sensor->set_pixformat(PoECAM.Camera.sensor, PIXFORMAT_JPEG);
PoECAM.Camera.sensor->set_framesize(PoECAM.Camera.sensor, FRAMESIZE_SVGA); // 800×600
PoECAM.Camera.sensor->set_quality  (PoECAM.Camera.sensor, 12);             // 0=best, 63=worst
PoECAM.Camera.sensor->set_vflip    (PoECAM.Camera.sensor, 1);              // flip if mounted upside-down
PoECAM.Camera.sensor->set_hmirror  (PoECAM.Camera.sensor, 0);
```

Available frame sizes (smaller = faster stream):

| Constant | Resolution |
|----------|-----------|
| `FRAMESIZE_QVGA` | 320×240 |
| `FRAMESIZE_VGA` | 640×480 |
| `FRAMESIZE_SVGA` | 800×600 |
| `FRAMESIZE_XGA` | 1024×768 |
| `FRAMESIZE_UXGA` | 1600×1200 |

### HTTP endpoints to implement

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | HTML status page (useful for quick verify) |
| `/stream` | GET | MJPEG multipart stream |
| `/capture` | GET | Single JPEG frame |
| `/status` | GET | JSON health check |

MJPEG stream uses `multipart/x-mixed-replace` content type. Each frame is:
```
--<boundary>\r\n
Content-Type: image/jpeg\r\n
Content-Length: <bytes>\r\n
\r\n
<jpeg bytes>
```

Write frames in 2048-byte chunks — `client->write()` can fail on large single writes.

### W5500 SPI pin assignments (for reference)

| Signal | ESP32 GPIO |
|--------|-----------|
| SCK (CLK) | GPIO 23 |
| MISO | GPIO 38 |
| MOSI | GPIO 13 |
| CS | GPIO 4 |

These are provided automatically via the `M5_POE_CAM_ETH_*` macros from the `M5PoECAM` library.

---

## Building

```powershell
$cli  = "C:\Users\Hamed\Documents\eblocks-companion-app\resources\arduino-cli\win32\x64\arduino-cli.exe"
$fqbn = "esp32:esp32:m5stack_poe_cam"
$src  = "poe-camera-firmware\M5PoECAM_SmartFactory"
$out  = "$src\build\esp32.esp32.m5stack_poe_cam"

& $cli compile --fqbn $fqbn --output-dir $out $src
```

After a successful build, the output directory contains:
- `M5PoECAM_SmartFactory.ino.bootloader.bin`
- `M5PoECAM_SmartFactory.ino.partitions.bin`
- `M5PoECAM_SmartFactory.ino.bin`

### Merge all segments into one binary (required for UART flash)

```powershell
$esptool = "C:\Users\Hamed\AppData\Local\Arduino15\packages\esp32\tools\esptool_py\5.1.0\esptool.exe"
$boot_app0 = "C:\Users\Hamed\AppData\Local\Arduino15\packages\esp32\hardware\esp32\3.3.7\tools\partitions\boot_app0.bin"

& $esptool --chip esp32 merge-bin --output "$out\merged.bin" `
    --flash-mode dio --flash-freq 80m --flash-size 4MB `
    0x1000  "$out\M5PoECAM_SmartFactory.ino.bootloader.bin" `
    0x8000  "$out\M5PoECAM_SmartFactory.ino.partitions.bin" `
    0xe000  $boot_app0 `
    0x10000 "$out\M5PoECAM_SmartFactory.ino.bin"
```

> The esptool version number (`5.1.0`) and arduino-esp32 version (`3.3.7`) in the paths will change if you upgrade. Check `C:\Users\Hamed\AppData\Local\Arduino15\packages\esp32\tools\esptool_py\` for the correct version folder.

---

## Flashing via Raspberry Pi GPIO UART

The camera has no USB-serial chip. The only flash route without specialist hardware is the ESP32's UART0 pins, wired to the Raspberry Pi's GPIO UART.

### Raspberry Pi UART setup

1. SSH into the Pi and edit `/boot/firmware/cmdline.txt`:
   - Remove `console=serial0,115200` (or any `console=ttyAMA*,...`) from the line.
   - Do **not** remove `console=tty1`.
   - Save and reboot.

2. Verify the UART is free:
   ```bash
   ls -la /dev/ttyAMA0   # should exist and not be in use
   ```

3. Install esptool on the Pi:
   ```bash
   pip3 install esptool
   ```

### Flash wiring

Wire the camera to the Pi's 40-pin GPIO header **before** powering the camera.

| Camera pin | Signal | Pi GPIO | Pi pin |
|-----------|--------|---------|--------|
| G1 | UART0 TX (camera → Pi) | GPIO 15 (RX) | Pin 10 |
| G3 | UART0 RX (Pi → camera) | GPIO 14 (TX) | Pin 8 |
| G  | GND | GND | Pin 6 |
| G0 | Boot mode (hold LOW) | GND | any GND pin |
| EN | Reset (pulse LOW) | — | manual wire to GND |

> **UART device**: always use `/dev/ttyAMA0`. Do **not** use `/dev/serial0` or `/dev/ttyAMA10` — these are aliases or the debug mini-UART and are unreliable at 115200 baud.

> **TX/RX are crossed**: Pi TX → Camera RX, Camera TX → Pi RX. This is standard but easy to get wrong.

### SCP the merged binary to the Pi

On Windows:
```powershell
scp "$out\merged.bin" pi@rpi:/home/pi/poe_cam_merged.bin
```

### Entering bootloader mode

1. With G0 already wired to GND, power the camera.
2. Briefly short EN to GND (about 0.5 s) — this resets the ESP32 while G0 is LOW, which puts it into serial bootloader mode.
3. The camera LED will stay off.

### Flashing script (run on Pi)

Save this as `/home/pi/flash_poe_cam.py` and run it, then pulse EN:

```python
import serial, subprocess, time, sys

s = serial.Serial("/dev/ttyAMA0", 115200, timeout=60)
s.flushInput()
buf = b""
deadline = time.time() + 60

print("Waiting for bootloader prompt — pulse EN to GND now...")
while time.time() < deadline:
    d = s.read(s.in_waiting or 1)
    if d:
        buf += d
        if b"waiting for download" in buf:
            s.close()
            time.sleep(0.3)
            print("Bootloader ready — flashing...")
            result = subprocess.run([
                "python3", "-m", "esptool",
                "--port", "/dev/ttyAMA0", "--baud", "115200",
                "--before", "no-reset", "--connect-attempts", "3",
                "write-flash", "--flash-mode", "keep",
                "--flash-freq", "keep", "--flash-size", "keep",
                "0x0", "/home/pi/poe_cam_merged.bin"
            ])
            sys.exit(result.returncode)

print("Timeout — bootloader prompt not received. Check wiring and try again.")
s.close()
sys.exit(1)
```

```bash
python3 /home/pi/flash_poe_cam.py
```

### After flashing

1. Disconnect G0 from GND.
2. Power-cycle the camera (unplug USB, wait 2 s, plug back in).
3. Wait about 5 s for boot.
4. Verify from the Pi:

```bash
curl http://192.168.7.6/status
```

Expected response:
```json
{"device":"SmartFactory-PoECAM","version":"1.1.0","ip":"192.168.7.6","uptime_s":12,"stream_url":"http://192.168.7.6/stream","capture_url":"http://192.168.7.6/capture","camera":"OV3660","ok":true}
```

If the IP is `0.0.0.0`, the W5500 did not initialise. Check:
- Are you using `ETH.h` with `IRQ=-1, RST=-1`? (Not `M5_Ethernet`)
- Is `delay(2000)` present at the top of `setup()` before any SPI calls?
- Is the Ethernet cable plugged into the camera's RJ45 and into a switch or Pi port?

---

## Power

The board is called **PoE CAM** but the GS105 switch used in this project has no PoE. Power the camera via USB:

- Connect a USB 5 V charger (at least 1 A) to the **G5V pin** via the USB-C port on the board.
- Do **not** try to power it from the Pi's USB — Pi USB ports are limited and the camera draws a spike on boot.

If you have a real PoE injector or PoE-capable switch, connect via the RJ45 and omit USB power entirely.

---

## Backend integration (Flask / Python)

### Proxy routes

The Pi backend proxies the camera to serve it over HTTPS (avoiding mixed-content browser errors):

```python
import requests, threading
from flask import Response, jsonify

POE_CAM_IP = "192.168.7.6"

@app.route('/api/poe-camera/stream')
def poe_camera_stream():
    def generate():
        with requests.get(f"http://{POE_CAM_IP}/stream", stream=True, timeout=10) as r:
            for chunk in r.iter_content(chunk_size=4096):
                yield chunk
    return Response(generate(), content_type='multipart/x-mixed-replace; boundary=123456789000000000000987654321')

@app.route('/api/poe-camera/capture')
def poe_camera_capture():
    r = requests.get(f"http://{POE_CAM_IP}/capture", timeout=5)
    return Response(r.content, content_type='image/jpeg')

@app.route('/api/poe-camera/status')
def poe_camera_status():
    try:
        r = requests.get(f"http://{POE_CAM_IP}/status", timeout=3)
        return jsonify(r.json())
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 503
```

### Frontend (JavaScript)

```javascript
// MJPEG stream — just set the img src
document.getElementById('cameraImg').src = '/api/poe-camera/stream';

// Single frame capture
async function captureFrame() {
    const r = await fetch('/api/poe-camera/capture');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    document.getElementById('cameraImg').src = url;
}

// Health check
async function checkCamera() {
    const r = await fetch('/api/poe-camera/status');
    const data = await r.json();
    console.log(data.ok ? 'Camera online' : 'Camera offline');
}
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| IP `0.0.0.0` after boot | Using `M5_Ethernet` (W5500 init fails due to unconnected RST) | Switch to `ETH.h` with `IRQ=-1, RST=-1` |
| IP `0.0.0.0` with `ETH.h` | Ethernet cable unplugged or switch not forwarding | Check cable, check switch power/link LED |
| Flash fails immediately | G0 not held LOW, or EN not pulsed | Re-check wiring; pulse EN firmly for ~0.5 s while G0 is grounded |
| "Timeout — bootloader not received" | Serial console still on `/dev/ttyAMA0` | Remove `console=serial0,...` from `/boot/firmware/cmdline.txt` and reboot Pi |
| Camera init FAILED (LED flashes rapidly) | Camera hardware fault or library mismatch | Verify `M5PoECAM` library version; power-cycle camera |
| Stream choppy / drops frames | Frame size too large for network or chunk size | Reduce `FRAMESIZE_*` or increase chunk size in stream loop |
| `curl` works but browser blocks stream | Mixed content (HTTP camera behind HTTPS Flask) | Use the proxy routes — never expose camera directly to browser from HTTPS page |

---

## Adapting for a new project

1. **Change the static IP** — edit `staticIP`, `gw`, `sn`, `dnsIP` at the top of the sketch.
2. **Change resolution** — `set_framesize(... FRAMESIZE_VGA ...)` for faster stream, `FRAMESIZE_UXGA` for higher quality.
3. **Add authentication** — parse HTTP headers in `loop()` and check a `?token=` query param or `Authorization:` header before calling the serve functions.
4. **Different subnet** — update `staticIP` and `gw` to match your network. No other changes needed.
5. **WiFi instead of Ethernet** — if you need WiFi on a future project use the standard `WiFi.h` and a camera-only board like the M5Stack Unit Cam or AI Cam. The PoE CAM-W's WiFi antenna is minimal; Ethernet is far more reliable for a fixed industrial installation.

---

## File reference (this project)

```
poe-camera-firmware/
├── M5PoECAM_SmartFactory/
│   ├── M5PoECAM_SmartFactory.ino   ← complete working firmware
│   └── build/                      ← compiler output (gitignored)
└── FIRMWARE_CHANGELOG.md           ← root cause analysis of v1.0.0 W5500 failure
```

Backend integration: `pwa-dobot-plc/backend/camera_service.py`  
Frontend use: `pwa-dobot-plc/frontend/vision-system-new.html`
