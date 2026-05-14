# PoE CAM Firmware Changelog

## v1.1.0 — ETH.h rewrite (fix static IP 0.0.0.0)

### Problem

After flashing v1.0.0, the camera always reported IP `0.0.0.0` instead of `192.168.7.6`.

Root cause: the **W5500 RST pin is not connected** on the M5Stack PoE CAM-W V1.1 board.
The `M5_Ethernet` library calls `W5100.init()` internally during `Ethernet.begin()`.
Without a hardware reset, the W5500 can power on in an undefined state, causing
`W5100.init()` to return `0` silently — the library then does nothing and the IP
stays at `0.0.0.0`. A `delay()` before `begin()` reduces the failure rate but does
not reliably fix it because there is simply no reset signal to bring the chip to a
known state.

### Fix

Replaced `M5_Ethernet` with the **arduino-esp32 built-in `ETH.h`** (W5500 driver,
available since arduino-esp32 v3.0.0). The `ETH.h` driver uses the Espressif
`esp_eth` layer which handles SPI Ethernet chips in **polling mode** when IRQ and RST
are both set to `-1`. This correctly tolerates the unconnected RST pin and reliably
initialises the W5500 on every boot.

### Changes

| Area | v1.0.0 | v1.1.0 |
|------|--------|--------|
| Ethernet library | `M5_Ethernet` 4.0.0 | arduino-esp32 `ETH.h` (built-in, 3.3.7) |
| Static IP method | `Ethernet.begin(mac, ip, dns, gw, sn)` | `ETH.config(ip, gw, sn, dns)` after `ETH.begin()` |
| HTTP server type | `EthernetServer` / `EthernetClient` | `WiFiServer` / `WiFiClient` (shared lwIP stack) |
| IP event handling | polled via `Ethernet.localIP()` | event-driven via `Network.onEvent()` |
| RST pin handling | not handled — silent failure | IRQ/RST both `-1`, handled by `esp_eth` driver |
| Power stabilisation | none | `delay(2000)` at top of `setup()` |
| Link wait | none | waits up to 8 s for `ARDUINO_EVENT_ETH_GOT_IP` |

### Key code (Ethernet init)

```cpp
// Register event handler BEFORE ETH.begin()
ethSPI.begin(M5_POE_CAM_ETH_CLK_PIN, M5_POE_CAM_ETH_MISO_PIN,
             M5_POE_CAM_ETH_MOSI_PIN, M5_POE_CAM_ETH_CS_PIN);
Network.onEvent(onEthEvent);
ETH.begin(ETH_PHY_W5500, 1, M5_POE_CAM_ETH_CS_PIN,
          -1, -1, ethSPI);   // IRQ=-1, RST=-1 (not wired)
ETH.config(staticIP, gw, sn, dnsIP);
```

### Hardware notes (PoE CAM-W V1.1)

- **W5500 RST** — not connected to any ESP32 GPIO (confirmed from board schematic)
- **W5500 INT** — not connected to any ESP32 GPIO
- **W5500 SPI pins**: SCK=GPIO23, MISO=GPIO38, MOSI=GPIO13, CS=GPIO4
- **Camera**: OV3660 — unchanged, still initialised via `M5PoECAM` library
- **Static IP**: `192.168.7.6` on industrial subnet `192.168.7.0/24`
- **Gateway / DNS**: `192.168.7.1`

### Flashing procedure (Raspberry Pi GPIO UART)

#### Wiring

| Camera pin | Pi pin | Signal |
|-----------|--------|--------|
| G1 (GPIO1, UART0 TX) | Pin 10 (GPIO15, RX) | Camera → Pi |
| G3 (GPIO3, UART0 RX) | Pin 8  (GPIO14, TX) | Pi → Camera |
| G  (GND)             | Pin 6  (GND)        | Common ground |
| G0 (GPIO0)           | GND (any)           | Hold LOW for bootloader |
| EN                   | Pulse LOW (~0.5 s)  | Trigger bootloader entry |

Pi UART device: `/dev/ttyAMA0` (NOT `/dev/ttyAMA10` / `serial0`).
Serial console must be removed from `/boot/firmware/cmdline.txt`.

#### Build (Windows)

```powershell
$cli = "C:\Users\Hamed\Documents\eblocks-companion-app\resources\arduino-cli\win32\x64\arduino-cli.exe"
& $cli compile --fqbn esp32:esp32:m5stack_poe_cam `
    --output-dir "poe-camera-firmware\M5PoECAM_SmartFactory\build\esp32.esp32.m5stack_poe_cam" `
    "poe-camera-firmware\M5PoECAM_SmartFactory"

$esptool = "C:\Users\Hamed\AppData\Local\Arduino15\packages\esp32\tools\esptool_py\5.1.0\esptool.exe"
$bd = "poe-camera-firmware\M5PoECAM_SmartFactory\build\esp32.esp32.m5stack_poe_cam"
& $esptool --chip esp32 merge-bin --output "$bd\merged.bin" `
    --flash-mode dio --flash-freq 80m --flash-size 4MB `
    0x1000  "$bd\M5PoECAM_SmartFactory.ino.bootloader.bin" `
    0x8000  "$bd\M5PoECAM_SmartFactory.ino.partitions.bin" `
    0xe000  "C:\Users\Hamed\AppData\Local\Arduino15\packages\esp32\hardware\esp32\3.3.7\tools\partitions\boot_app0.bin" `
    0x10000 "$bd\M5PoECAM_SmartFactory.ino.bin"

scp "$bd\merged.bin" pi@rpi:/home/pi/poe_cam_merged.bin
```

#### Flash (Pi — auto-detect script)

With G0 grounded, run this on the Pi then pulse EN to GND for ~0.5 s:

```python
import serial, subprocess, time, sys
s = serial.Serial("/dev/ttyAMA0", 115200, timeout=60)
s.flushInput()
buf = b""
deadline = time.time() + 60
while time.time() < deadline:
    d = s.read(s.in_waiting or 1)
    if d:
        buf += d
        if b"waiting for download" in buf:
            s.close()
            time.sleep(0.3)
            result = subprocess.run([
                "python3", "-m", "esptool",
                "--port", "/dev/ttyAMA0", "--baud", "115200",
                "--before", "no-reset", "--connect-attempts", "3",
                "write-flash", "--flash-mode", "keep",
                "--flash-freq", "keep", "--flash-size", "keep",
                "0x0", "/home/pi/poe_cam_merged.bin"
            ])
            sys.exit(result.returncode)
```

After flash: disconnect G0, power-cycle camera. Verify with:

```bash
curl http://192.168.7.6/status
```

---

## v1.0.0 — Initial release

- M5_Ethernet static IP (broken — W5500 init silently fails due to unconnected RST)
- MJPEG stream, single capture, JSON status, HTML status page
- Baud 115200 via Pi UART flash
