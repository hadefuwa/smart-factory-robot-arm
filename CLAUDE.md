# CLAUDE.md — Smart Factory Robot Arm

This file gives Claude Code the context needed to work effectively in this repo.

## Project overview

Industrial smart factory automation system. A Raspberry Pi 5 (`192.168.7.5`) acts as the central controller, communicating with a Siemens S7-1200 PLC, a 6-DOF Waveshare ST3215 robot arm, an IO-Link master, and an M5Stack PoE CAM-W. A Flask backend serves a PWA web UI on port 8080 (HTTPS).

The final production setup has **no Windows PC** — only Pi, PLC, arm, IO-Link, and camera, all on the `192.168.7.x` network. The web UI is for engineering / monitoring; the actual production control loops (cube detection → PLC bits, PLC target → arm motion) run on the Pi regardless of whether a browser is open.

## Network topology

| Device | IP | Notes |
|--------|-----|-------|
| Raspberry Pi 5 | 192.168.7.5 | Backend, web UI, all control logic |
| Siemens S7-1200 PLC | 192.168.7.2 | Rack 0, Slot 1 |
| IO-Link Master | 192.168.7.4 | HTTP polling, port 80 |
| M5Stack PoE CAM-W | 192.168.7.6 | MJPEG + /capture HTTP, static IP |
| GS105 Switch | — | Unmanaged, no PoE (camera takes 5 V via G5V pin) |

## Repository layout

```
smart-factory-robot-arm/
├── pwa-dobot-plc/
│   ├── backend/
│   │   ├── app.py                  # Flask entry point (HTTPS, port 8080).
│   │   │                           # Owns the always-on YOLO detection loop +
│   │   │                           # the PLC auto-move backend.
│   │   ├── config.json             # All hardware config — single source of truth
│   │   ├── plc_integration.py      # PLC write-side helpers (idempotent)
│   │   ├── plc_worker.py           # snap7 worker thread, DB + PE/PA reads,
│   │   │                           # batched writes, raw I/O snapshot
│   │   ├── poe_vision_service.py   # YOLO load + inference, crop / mask /
│   │   │                           # keep-box / per-class threshold helpers
│   │   ├── dobot_client.py         # Dobot Magician (legacy, USB camera +
│   │   │                           # dobot wiring is commented out)
│   │   ├── camera_service.py       # USB camera service (DISABLED — left
│   │   │                           # intact so legacy routes return 503)
│   │   ├── vision_service.py       # Legacy HSV colour-voting (DISABLED)
│   │   └── ssl/                    # Self-signed certs (not in git)
│   ├── frontend/
│   │   ├── vision.html             # PRODUCTION vision page. Polls
│   │   │                           # /api/poe-vision/latest-result + the
│   │   │                           # /api/plc/io/read sensor cache. Capture
│   │   │                           # Training Image button serves /api/poe-
│   │   │                           # camera/capture (cached raw JPEG).
│   │   ├── plc-setup.html          # DB editors + Raw I/O tab (PE/PA reads)
│   │   ├── robot-arm.html, rfid.html, io-link.html, dobot.html,
│   │   ├── edge-device-stats.html, hotspot-status.html,
│   │   ├── color-voting-test.html  # legacy test tool, kept under Utilities
│   │   └── assets/js/app-shell.js  # Sidebar nav + per-page enhancements
│   └── robotarmv3-pi-service/      # Node.js service for ST3215 arm (port 8090)
│       ├── server.js               # WebSocket, command queue, USB recovery
│       ├── kinematics.js           # 3-DOF analytic IK
│       └── README.md               # Queue/watchdog/auto-recovery details
├── poe-camera-firmware/
│   ├── M5PoECAM_SmartFactory/
│   │   └── M5PoECAM_SmartFactory.ino  # v1.1.0 — ETH.h, static 192.168.7.6,
│   │                                  # SVGA 800x600, JPEG quality 12
│   └── FIRMWARE_CHANGELOG.md       # Root cause + flash procedure
├── cube-training/                  # Local-only training workflow (gitignored)
│   ├── CUBE_TRAINING_GUIDE.md      # Capture → CVAT → organise → train
│   ├── capture_cube_images.py
│   ├── organize_cube_dataset.py
│   ├── train_cube_detector.py
│   └── cube-data.yaml              # 0=yellow_cube, 1=purple_cube, 2=metal_cube
├── archive/                        # Historic Dobot / USB-camera / old docs.
│                                   # Not the active code path — reference only.
├── raspberry-pi-control-st3215/    # Servo/joint control code (low-level)
├── docs/                           # Active guides + investigations
├── CLAUDE.md                       # This file
└── README.md
```

## Key config file

`pwa-dobot-plc/backend/config.json` is the single source of truth for hardware addresses, PLC DB numbers, the vision pipeline knobs, and feature flags. Changes take effect on `sudo systemctl restart smart-factory`.

Important blocks:
- `plc.ip` — PLC address
- `poe_camera.ip` — PoE camera address (`192.168.7.6`)
- `poe_camera.conf` — global default confidence (fallback when no per-class value, default 0.5)
- `poe_camera.class_conf` — per-class confidence thresholds:
  `{"yellow_cube": 0.35, "purple_cube": 0.5, "metal_cube": 0.6}`.
  The vision page's three sliders POST back to this block.
- `poe_camera.crop` — pre-inference edge trim (changes aspect ratio)
- `poe_camera.mask` — pre-inference solid-colour block (preserves aspect ratio).
  Currently used in preference to crop because it keeps the trained model's
  expected 800×600 input shape. Default: `right_pct=30`, black fill.
- `io_link.master_ip` — IO-Link master address
- `enable_digital_twin_stream` — set `false` to reduce CPU load

## Deployment workflow

**Never SSH in and edit files directly on the Pi.** The correct workflow is:

1. Edit files on Windows
2. Commit to git
3. `git pull` on Pi — OR — `scp` individual files when a git pull isn't practical

The Pi has no internet access. File transfers use SCP over the local network. The Pi's hostname is `rpi` in most setups; the static IP `192.168.7.5` is the canonical fallback (use it when DNS / mDNS resolution is flaky).

```bash
# SCP a file to Pi
scp pwa-dobot-plc/backend/config.json pi@192.168.7.5:/home/pi/sf2/pwa-dobot-plc/backend/config.json

# Restart services on Pi
ssh pi@192.168.7.5 'sudo systemctl restart smart-factory'           # Flask backend
ssh pi@192.168.7.5 'sudo systemctl restart robotarmv3-pi.service'   # Node arm bridge

# Check logs
ssh pi@192.168.7.5 'sudo journalctl -u smart-factory -n 50'
ssh pi@192.168.7.5 'sudo journalctl -u robotarmv3-pi.service -n 50'

# Deploy trained YOLO model (cube_detector.pt)
scp cube-training/runs/detect/cube_train/weights/cube_detector.pt \
    pi@192.168.7.5:/home/pi/cube_detector.pt
ssh pi@192.168.7.5 'sudo systemctl restart smart-factory'
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
Model on Pi:       ~/cube_detector.pt  (SCP'd manually after each retrain)
```

## PoE camera firmware

- **Board**: M5Stack PoE CAM-W V1.1 (ESP32-D0WDQ6-V3 + OV3660 + W5500)
- **Firmware**: v1.1.0 — uses `ETH.h` (arduino-esp32 3.3.7 built-in)
- **Resolution**: SVGA 800×600, JPEG quality 12. OV3660 can do up to 2048×1536 — the SVGA setting is a deliberate choice for stream throughput; bumping requires a firmware recompile + reflash.
- **Why ETH.h**: W5500 RST pin is not wired on this board. `M5_Ethernet`'s `W5100.init()` returned 0 silently. `ETH.h` with `IRQ/RST=-1` (polling mode) handles this correctly.
- **Board FQBN**: `esp32:esp32:m5stack_poe_cam`
- **Arduino CLI** (on Windows dev box): typically under `%LOCALAPPDATA%\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe` or `C:\Program Files\E-Blocks 3 Companion\resources\resources\arduino-cli\win32\x64\arduino-cli.exe`. ESP32 core may need installing via `arduino-cli core install esp32:esp32`.
- **Camera power**: USB 5V charger → G5V pin (GS105 has no PoE)
- **HTTP server is single-client.** Only one HTTP connection at a time on the M5Stack. The backend detection loop owns the slot; `/api/poe-camera/capture` and `/api/poe-vision/annotated` serve cached frames rather than racing the loop.
- **Flash via**: Raspberry Pi GPIO UART (`/dev/ttyAMA0`) — see `poe-camera-firmware/FIRMWARE_CHANGELOG.md` for full procedure.

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
| DB124 | Camera/vision result bits (`yellow_cube_detected` 0.6, `purple_cube_detected` 0.7, `metal_cube_detected` 1.0, plus handshake bits) |
| DB125 | Robot arm bridge (status bytes 0-21, commands bytes 22-31) |
| DB126 | Edge device stats |
| DB127 | IO-Link PLC telemetry |

Full tag map: `pwa-dobot-plc/DB123_MEMORY_MAP.md` and `pwa-dobot-plc/PLC_PLC_READ_WRITE_MAP.md`. **Note the rename**: the DB124 bit previously named `white_cube_detected` is now `purple_cube_detected` in our Python/JS code — the byte/bit offset (0/7) is unchanged so the TIA project doesn't need updating.

### Raw I/O (PE / PA areas)

The PLC worker also reads `%I0.0..%I1.5` (digital inputs), `%IW64` and `%IW66` (analog inputs), and `%Q0.0..%Q1.1` (digital outputs) directly via `snap7.read_area(Areas.PE / Areas.PA, ...)`. Refreshed every 500 ms inside the main worker cycle (snap7 isn't thread-safe). Cached in `plc_worker.io_cache` and exposed at `GET /api/plc/io/read` with TIA-project friendly names attached (EStop Channel 1, Light Sensor 1, Inductive Proxy, Reject, Conveyor 1, etc.). Surfaced in the **Raw I/O** tab on `plc-setup.html` and in the **Light Sensor 1 (%I0.5)** badge on `vision.html` (used as a cross-check against the AI — when the sensor sees something and YOLO doesn't, an "AI missed the object" warning lights up).

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

## PoE vision pipeline (`app.py` + `poe_vision_service.py`)

Always-on YOLO cube detection. Runs whether or not the web UI is open. Defined in `app.py:_poe_detection_loop`, started as a daemon thread at app startup via `start_poe_detection_loop()`.

Per cycle (`POE_LOOP_INTERVAL_S = 1.0` second):

1. **Fetch raw frame** via `poe_vision_service.fetch_frame()` → single HTTP GET to `http://192.168.7.6/capture`. Returns a numpy BGR array. The loop owns the M5Stack's single-client HTTP slot, so other handlers don't touch the camera directly.
2. **Cache raw JPEG** → `/api/poe-camera/capture` serves this on demand for the Capture Training Image button. Frame is at most ~1 s old.
3. **Crop** (`apply_crop`) — currently disabled. Tunable via `config.poe_camera.crop`.
4. **Mask** (`apply_mask`) — paints solid colour over edges. Default: right 30% black. Lives at `config.poe_camera.mask`. **Preserves the original 800×600 aspect ratio**, which matters because the trained model expects that shape.
5. **YOLO inference** (`detect_cubes`) with:
   - **YOLO `conf` floor** set to `min(class_conf.values())` so every candidate passes through to the post-filter.
   - **Per-class confidence post-filter** drops detections whose confidence is below their class's threshold. Yellow=0.35 (permissive — model under-detects), Purple=0.5, Metal=0.6 (strict — model over-detects).
   - **`keep_box`** computed from the mask config — drops detections whose centre falls in the masked region. Kills mask-edge hallucinations.
6. **Cache annotated JPEG** → `/api/poe-vision/annotated` serves this.
7. **N-consecutive-cycles debounce** (`POE_DEBOUNCE_CYCLES = 2`) on the dominant class. The PLC bit only changes after the same class has been the dominant for N cycles in a row. Single-cycle blips never reach the PLC. `None` is a valid streak key so removing the cube also takes N cycles to confirm.
8. **Write PLC bits** via `queue_cube_detection_bits(yellow=..., purple=..., metal=...)` (idempotent — skips no-op writes).

Endpoints:
- `GET /api/poe-vision/latest-result` — JSON of latest result (includes `confirmed_dominant`, `streak`, `debounce_cycles`)
- `GET /api/poe-vision/annotated` — latest annotated JPEG
- `POST /api/poe-vision/detect` — returns the cached result (no longer triggers fresh inference)
- `GET /api/poe-vision/status` — model load status
- `GET /api/poe-camera/capture` — cached raw JPEG (training data)
- `GET /api/poe-camera/status` — camera reachability
- `GET /api/poe-camera/stream` — proxied MJPEG stream from the camera

`vision.html` is a passive monitor that polls `/latest-result` and `/api/plc/io/read` once a second. Detection itself never depends on the browser. The page-side `Live` / `Pause display` button only toggles the page poll, not the backend loop.

The legacy USB camera pipeline (HSV colour voting in `camera_service.py` + `vision_service.py`) is preserved in the repo but **all of its routes are commented out** (`# DISABLED (USB / color-voting retired)`). `camera_service` is never instantiated; the old DB124 vision-handshake callback is wired to `vision_callback=None`. The files stay for reference only.

## PLC worker write path

`plc_integration.py` mediates all writes to DB123/DB124/DB125 via the `plc_worker.queue_write` queue. The helpers that the bridge polls into frequently (`queue_robot_status`, `queue_robot_position`, `queue_robot_faults`, `queue_cube_detection_bits`) are **idempotent** — they track last-written values in module state and skip enqueueing when the value hasn't changed. Without this, periodic telemetry from the bridge re-enqueued ~7 PLC writes per poll, saturating the worker's queue and dragging cycle time from ~150 ms to 1500-2000 ms. Any new helper that gets called on a periodic poller should follow the same pattern.

## Cube detector training

Local workflow in `cube-training/` — Windows-side, never on the Pi.

1. **Capture** — vision.html has a Capture Training Image button that downloads the loop's most recent raw JPEG (already cropped/masked the same as production inference, which is what you want). Save into `cube-training/cube_images/`.
2. **Annotate** — CVAT (self-hosted Docker or app.cvat.ai). Export as **Ultralytics YOLO Detection 1.0**. Class order must be `yellow_cube` (0), `purple_cube` (1), `metal_cube` (2). Drop the `.txt` files into `cube_labels/`.
3. **Organise** — `python organize_cube_dataset.py` splits 80/20 into `dataset/images/{train,val}` and `dataset/labels/{train,val}`. Re-runnable.
4. **Train** — `python train_cube_detector.py`. CPU-only by default (no NVIDIA GPU on the dev box). YOLO11n base downloads on first run. Stops early on `patience=20`. Output: `runs/detect/cube_train/weights/cube_detector.pt`.
5. **Deploy** — `scp cube-training/runs/detect/cube_train/weights/cube_detector.pt pi@192.168.7.5:/home/pi/cube_detector.pt` + `sudo systemctl restart smart-factory`. The backend's `poe_vision_service.resolve_model_path()` searches `~/cube_detector.pt` first.

See `cube-training/CUBE_TRAINING_GUIDE.md` for the full procedure including CVAT setup.

## Common tasks

### Rebuild and flash camera firmware
```powershell
# Adjust path to whichever arduino-cli your machine has
$cli = "$env:LOCALAPPDATA\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"
$fqbn = "esp32:esp32:m5stack_poe_cam"
$src = "poe-camera-firmware\M5PoECAM_SmartFactory"
$out = "$src\build\esp32.esp32.m5stack_poe_cam"
& $cli compile --fqbn $fqbn --output-dir $out $src
# Then merge and SCP — see FIRMWARE_CHANGELOG.md
```

### Update backend config and restart
```bash
scp pwa-dobot-plc/backend/config.json pi@192.168.7.5:/home/pi/sf2/pwa-dobot-plc/backend/config.json
ssh pi@192.168.7.5 'sudo systemctl restart smart-factory'
```

### Check camera is up
```bash
ssh pi@192.168.7.5 'curl -s http://192.168.7.6/status'
```

### Push frontend changes to Pi (no git pull available)
```bash
scp pwa-dobot-plc/frontend/vision.html pi@192.168.7.5:/home/pi/sf2/pwa-dobot-plc/frontend/
```

### Smoke-test the vision pipeline
```bash
ssh pi@192.168.7.5 'curl -sk https://localhost:8080/api/poe-vision/status'
ssh pi@192.168.7.5 'curl -sk https://localhost:8080/api/poe-vision/latest-result'
ssh pi@192.168.7.5 'curl -sk -o /tmp/anno.jpg https://localhost:8080/api/poe-vision/annotated && file /tmp/anno.jpg'
```

### Watch the Pi's health
```bash
ssh pi@192.168.7.5 'vcgencmd measure_temp && vcgencmd get_throttled && uptime'
```
