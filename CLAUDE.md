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

# Restart services on Pi
ssh pi@rpi 'sudo systemctl restart smart-factory'           # Flask backend
ssh pi@rpi 'sudo systemctl restart robotarmv3-pi.service'   # Node arm bridge

# Check logs
ssh pi@rpi 'sudo journalctl -u smart-factory -n 50'
ssh pi@rpi 'sudo journalctl -u robotarmv3-pi.service -n 50'
```

## Pi services

Two systemd units run on the Pi:

```
smart-factory.service       (Flask backend + web UI, HTTPS port 8080)
  Working dir:     /home/pi/sf2/pwa-dobot-plc/backend
  Exec:            /home/pi/sf2/pwa-dobot-plc/backend/venv/bin/python app.py

robotarmv3-pi.service       (Node bridge to ST3215 arm, WebSocket port 8090)
  Working dir:     /home/pi/sf2/pwa-dobot-plc/robotarmv3-pi-service
  Exec:            node server.js
  Restart=always — so when /dev/ttyACM0 re-enumerates after a USB glitch
                   the process exits cleanly and systemd brings it back.

Repo on Pi:        ~/sf2/   (cloned from GitHub, no internet access from here)
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

The 6-DOF Waveshare ST3215 arm is driven by a separate Node.js service on the Pi (`robotarmv3-pi.service`, port 8090). The bus is a **single-wire TTL half-duplex serial bus** (3 wires: V+ / GND / SIGNAL, 5 V logic, idles HIGH, daisy-chained across all 6 servos) at **500 kbps** via the SC-B1 USB-to-TTL adapter on `/dev/ttyACM0`. This is **not RS-485** — termination concepts that apply to RS-485 (120 Ω, A/B biasing, shield grounding) don't translate; signal-integrity work on this bus is about idle-line voltage, scope rise/fall edges, stub length, common-ground bounce, and IR drop on V+. Baud was dropped from 1 Mbps after J5 corruption appeared at 1 Mbps — see `docs/J5_WRIST_PITCH_BUS_CORRUPTION.md`.

Flask talks to the bridge over WebSocket and translates `DB125.target_xyz` from the PLC into `moveToXYZ` commands.

Key behaviours documented in `pwa-dobot-plc/robotarmv3-pi-service/README.md` (read this before touching the bridge):

- **Command queue**: single global queue serialises serial-bus access. `moveToXYZ` coalesces latest-wins. Safety commands (`stopAllJoints`, `homeAll`, `setTorqueAll`) are FIFO and never dropped.
- **Dark-bus fast-fail** in `getAllServoStatus()`: after the first servo times out, the remaining servos in that poll are short-circuited to "unavailable" rather than each spending the full timeout. `ALL_FAIL_RECOVERY_THRESHOLD = 2` polls before close-reopen-reinit auto-recovery runs.
- **In-flight watchdog** (`COMMAND_WATCHDOG_MS`, 20s): a hung serial read can't permanently wedge the bridge.
- **USB-disconnect auto-recovery**: serialport `'close'` handler exits the process when the CH343 adapter re-enumerates; systemd (`Restart=always`) restarts and re-runs servo init.
- **`moveToXYZ` returns immediately on `allDone`** (per-joint within 20 steps, ~1.76°). There is no post-move creep pass — earlier versions blocked 1.5s tightening to 8 steps, which serialised back-to-back PLC waypoints; removed in commit 44b386e.
- **Stall handling**: when stuck-consec >= `STALL_POLLS` (30), the bridge declares `type: 'stall'` to the caller but leaves servo goals in place. The previous behaviour wrote current position into the goal, wiping the target. The PLC backend then treats `stall within tolerance` as success.
- **Motor protection lifted** by `raise-motor-limits.js` — UnloadCondition 47 → 7 (OVERLOAD + MOTOR auto-unload bits cleared), OverloadTime 80 → 254. Voltage / sensor / overtemp protection remain. With this, weak joints crawl toward goal under load instead of latching off.
- **Flask side guards**: resend interval, active-target dedup, exponential error backoff (2→30s, exponent capped to avoid int→float overflow), stale-target watchdog (15s) that surfaces `DB125.invalid_target` to the PLC.

Kinematics (`kinematics.js`): analytical 3-DOF closed-form solver for J1/J2/J3 that preserves J4/J5/J6 from the current joint angles. Position-only by default; orientation is opt-in. No joints are pinned by the solver — the wrist-roll / base-yaw locks that earlier versions used were dropped in commit 0ed8b99.

## PLC auto-move backend (`app.py`)

Owns the loop that turns `DB125.target_xyz` into bridge `moveToXYZ` commands. Runs every 50 ms (was 300 ms — dropped for snappier HMI response):

- **Home-waypoint routing**: en route to any operator target, the loop first drives the arm to `PLC_AUTO_HOME_WAYPOINT = (40, 260, 350)` (60 mm tolerance) for obstacle clearance, then continues to the final target. The decision is one-time per operator target via `home_visited_for_target_key` — without that, the arm would flip-flop between "go home" and "go target" when it landed just outside the final tolerance.
- **Tolerance**: `PLC_AUTO_TARGET_TOLERANCE_MM = 20` Euclidean. A stall response within this distance is treated as a successful arrival so the PLC doesn't retry indefinitely against a weak joint.
- **Position-logger thread** writes `/home/pi/sf2/logs/plc_vs_arm_positions.csv` every 0.5 s with target XYZ, arm current XYZ (queried directly from the bridge so it's fresh), and connection state. Useful for diagnosing remaining latency without enabling verbose journal logs.

## PLC worker write path

`plc_integration.py` mediates all writes to DB123/DB124/DB125 via the `plc_worker.queue_write` queue. The helpers that the bridge polls into frequently (`queue_robot_status`, `queue_robot_position`, `queue_robot_faults`) are **idempotent** — they track last-written values in module state and skip enqueueing when the value hasn't changed. Without this, periodic telemetry from the bridge re-enqueued ~7 PLC writes per poll, saturating the worker's queue and dragging cycle time from ~150 ms to 1500-2000 ms. Any new helper that gets called on a periodic poller should follow the same pattern.

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
