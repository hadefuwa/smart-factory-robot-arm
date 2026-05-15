# CLAUDE.md — Smart Factory Robot Arm

This file gives Claude Code the context needed to work effectively in this repo.

## Project overview

Industrial smart factory automation system. A Raspberry Pi 5 (`192.168.7.5`) acts as the central controller, communicating with a Siemens S7-1200 PLC, a Dobot Magician robot arm, an IO-Link master, and an M5Stack PoE CAM-W. A Flask backend serves a PWA web UI on port 8080 (HTTPS).

The final production setup has **no Windows PC** — only Pi, PLC, robot, IO-Link, and camera, all on the `192.168.7.x` network.

## Network topology

| Device | IP | Notes |
|--------|-----|-------|
| Raspberry Pi 5 | 192.168.7.5 | Backend, web UI, all control logic |
| Siemens S7-1200 PLC | 192.168.7.2 | Rack 0, Slot 1 |
| IO-Link Master | 192.168.7.4 | HTTP polling, port 80 |
| M5Stack PoE CAM-W | 192.168.7.6 | MJPEG stream at `/stream`, static IP |
| GS105 Switch | — | Unmanaged, no PoE |

## Repository layout

```
smart-factory-robot-arm/
├── pwa-dobot-plc/
│   ├── backend/
│   │   ├── app.py                  # Flask entry point (HTTPS, port 8080)
│   │   ├── config.json             # All hardware config — edit this for IP/port changes
│   │   ├── plc_integration.py      # PLC polling thread, DB read/write
│   │   ├── plc_client.py           # snap7 wrapper
│   │   ├── dobot_client.py         # Dobot Magician USB control
│   │   ├── camera_service.py       # USB camera + PoE CAM proxy routes
│   │   ├── vision_service.py       # YOLO + HSV cube detection
│   │   └── ssl/                    # Self-signed certs (not in git)
│   ├── frontend/
│   │   ├── vision-system-new.html  # Active vision page (USB↔PoE toggle)
│   │   └── ...                     # Other pages (robot-arm, plc-setup, io-link, etc.)
│   └── robotarmv3-pi-service/      # Node.js service for ST3215 robot arm (port 8090)
│       ├── server.js               # WebSocket server, command queue, USB-disconnect recovery
│       ├── kinematics.js           # FK/IK, joint-lock pinning (wrist_roll → 0°)
│       └── README.md               # Queue/watchdog/auto-recovery details
├── poe-camera-firmware/
│   ├── M5PoECAM_SmartFactory/
│   │   └── M5PoECAM_SmartFactory.ino  # v1.1.0 — ETH.h, static 192.168.7.6
│   └── FIRMWARE_CHANGELOG.md       # Root cause analysis + flash procedure
├── raspberry-pi-control-st3215/    # Servo/joint control code
├── docs/                           # Guides, API docs, solutions
└── Documentation/                  # Older deployment and troubleshooting docs
```

## Key config file

`pwa-dobot-plc/backend/config.json` is the single source of truth for all hardware addresses, PLC DB numbers, camera crop/ROI, and feature flags. Changes here take effect on service restart.

Important keys:
- `plc.ip` — PLC address
- `poe_camera.ip` — PoE camera address (currently `192.168.7.6`)
- `io_link.master_ip` — IO-Link master address
- `enable_digital_twin_stream` — set `false` to reduce CPU load

## Deployment workflow

**Never SSH in and edit files directly on the Pi.** The correct workflow is:

1. Edit files on Windows
2. Commit to git
3. `git pull` on Pi — OR — `scp` individual files when a git pull isn't practical

The Pi has no internet access. File transfers use SCP over the local network.

```bash
# SCP a file to Pi
scp pwa-dobot-plc/backend/config.json pi@rpi:/home/pi/sf2/pwa-dobot-plc/backend/config.json

# Restart service on Pi
ssh pi@rpi 'sudo systemctl restart smart-factory'

# Check logs
ssh pi@rpi 'sudo journalctl -u smart-factory -n 50'
```

## Pi service

```
Service name:    smart-factory
Working dir:     /home/pi/sf2/pwa-dobot-plc/backend
Exec:            /home/pi/sf2/pwa-dobot-plc/backend/venv/bin/python app.py
Repo on Pi:      ~/sf2/   (cloned from GitHub)
```

## PoE camera firmware

- **Board**: M5Stack PoE CAM-W V1.1 (ESP32-D0WDQ6-V3 rev 3.1 + OV3660 + W5500)
- **Firmware**: v1.1.0 — uses `ETH.h` (arduino-esp32 3.3.7 built-in)
- **Why ETH.h**: W5500 RST pin is not wired on this board. `M5_Ethernet`'s `W5100.init()` returned 0 silently. `ETH.h` with `IRQ/RST=-1` (polling mode) handles this correctly.
- **Board FQBN**: `esp32:esp32:m5stack_poe_cam`
- **Arduino CLI**: `C:\Users\Hamed\Documents\eblocks-companion-app\resources\arduino-cli\win32\x64\arduino-cli.exe`
- **Camera power**: USB 5V charger → G5V pin (GS105 has no PoE)
- **Flash via**: Raspberry Pi GPIO UART (`/dev/ttyAMA0`) — see `poe-camera-firmware/FIRMWARE_CHANGELOG.md` for full procedure

### Flash wiring (GPIO UART)

| Camera | Pi GPIO | Pi Pin |
|--------|---------|--------|
| G1 (UART0 TX) | GPIO15 RX | Pin 10 |
| G3 (UART0 RX) | GPIO14 TX | Pin 8 |
| G (GND) | GND | Pin 6 |
| G0 | GND | any (bootloader mode only) |

Pi UART: `/dev/ttyAMA0` — NOT `serial0`/`ttyAMA10`.
Serial console must be absent from `/boot/firmware/cmdline.txt`.

## PLC data blocks

| DB | Purpose |
|----|---------|
| DB123 | Main process state (HMI bits, robot, conveyors, gantry, pallet, counts) |
| DB124 | Camera/vision handshake bits |
| DB125 | Robot arm bridge (status bytes 0-21, commands bytes 22-31) |
| DB126 | Edge device stats |
| DB127 | IO-Link PLC telemetry |

Full tag map: `pwa-dobot-plc/DB123_MEMORY_MAP.md` and `pwa-dobot-plc/PLC_PLC_READ_WRITE_MAP.md`

## Robot-arm bridge

The 6-DOF ST3215 arm is driven by a separate Node.js service on the Pi (`robotarmv3-pi.service`, port 8090, serial via USB→RS485). Flask talks to it over WebSocket and translates `DB125.target_xyz` from the PLC into `moveToXYZ` commands.

Key behaviours documented in `pwa-dobot-plc/robotarmv3-pi-service/README.md` (read this before touching the bridge):

- **Command queue**: single global queue serialises serial-bus access. `getStatus` and `moveToXYZ` coalesce (latest-wins). Safety commands (`stopAllJoints`, `homeAll`, `setTorqueAll`) are FIFO and never dropped.
- **In-flight watchdog** (`COMMAND_WATCHDOG_MS`, 20s): a hung serial read can't permanently wedge the bridge.
- **USB-disconnect auto-recovery**: serialport `'close'` handler exits the process when the CH343 adapter re-enumerates; systemd (`Restart=always`) restarts and re-runs servo init.
- **Flask side guards**: resend interval, active-target dedup, exponential error backoff (2→30s), stale-target watchdog (15s) that surfaces `DB125.invalid_target` to the PLC.

Kinematics (`kinematics.js`): position-only IK is the default. Orientation is opt-in — passing `orientation` constrains the TCP direction. **`wrist_roll` (J4) is locked to 0°** during `moveToXYZ` to keep the TCP pointing down. Locked joints are configured by name pattern in `LOCKED_JOINT_NAME_PATTERNS`.

## Vision system

- Active page: `vision-system-new.html`
- Supports USB camera (index 0) and PoE CAM (`http://192.168.7.6/stream`) — toggled in UI
- Detection: HSV color (yellow/white/metal cubes) + YOLO object detection
- 10-vote majority voting cycle, results written to DB124 bits
- PoE CAM proxy routes in `camera_service.py`: `/api/poe-camera/stream`, `/api/poe-camera/capture`, `/api/poe-camera/status`

## Common tasks

### Rebuild and flash camera firmware
```powershell
$cli = "C:\Users\Hamed\Documents\eblocks-companion-app\resources\arduino-cli\win32\x64\arduino-cli.exe"
$fqbn = "esp32:esp32:m5stack_poe_cam"
$src = "poe-camera-firmware\M5PoECAM_SmartFactory"
$out = "$src\build\esp32.esp32.m5stack_poe_cam"
& $cli compile --fqbn $fqbn --output-dir $out $src
# Then merge and SCP — see FIRMWARE_CHANGELOG.md
```

### Update backend config and restart
```bash
scp pwa-dobot-plc/backend/config.json pi@rpi:/home/pi/sf2/pwa-dobot-plc/backend/config.json
ssh pi@rpi 'sudo systemctl restart smart-factory'
```

### Check camera is up
```bash
ssh pi@rpi 'curl -s http://192.168.7.6/status'
```

### Push frontend changes to Pi (no git pull available)
```bash
scp pwa-dobot-plc/frontend/vision-system-new.html pi@rpi:/home/pi/sf2/pwa-dobot-plc/frontend/
```
