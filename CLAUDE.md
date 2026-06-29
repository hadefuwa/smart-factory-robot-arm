# CLAUDE.md — Smart Factory Robot Arm

This file gives Claude Code the context needed to work effectively in this repo.

## Project overview

Industrial smart factory automation system. A Raspberry Pi 5 (`192.168.7.5`) acts as the central controller, communicating with a Siemens S7-1200 PLC, a 6-DOF Waveshare ST3215 robot arm, an IO-Link master, and a USB camera. A Flask backend serves a PWA web UI on port 8080 (HTTPS).

The final production setup has **no Windows PC** — only Pi, PLC, arm, IO-Link, and camera, all on the `192.168.7.x` network. The web UI is for engineering / monitoring; the actual production control loops (cube detection → PLC bits, PLC target → arm motion) run on the Pi regardless of whether a browser is open.

## Network topology

| Device | IP | Notes |
|--------|-----|-------|
| Raspberry Pi 5 | 192.168.7.5 | Backend, web UI, all control logic |
| Siemens S7-1200 PLC | 192.168.7.2 | Rack 0, Slot 1 |
| IO-Link Master | 192.168.7.4 | HTTP polling, port 80 |
| USB camera (IMX179) | — | UVC on `/dev/video0`, controlled via `v4l2-ctl` |
| M5Stack PoE CAM-W | 192.168.7.6 | **Legacy** — disconnected; the production vision path is the USB camera |
| GS105 Switch | — | Unmanaged, no PoE |

## Repository layout

```
smart-factory-robot-arm/
├── pwa-dobot-plc/
│   ├── backend/
│   │   ├── app.py                  # Flask entry point (HTTPS, port 8080).
│   │   │                           # Owns the always-on YOLO detection loop +
│   │   │                           # the PLC auto-move backend.
│   │   ├── config.json             # All hardware config — single source of truth
│   │   │                           # MERGED with ~/.sf2/config.local.json at
│   │   │                           # runtime (operator overrides survive resets)
│   │   ├── plc_integration.py      # PLC write-side helpers (idempotent)
│   │   ├── plc_worker.py           # snap7 worker thread, DB + PE/PA reads,
│   │   │                           # batched writes, raw I/O snapshot
│   │   ├── poe_vision_service.py   # YOLO load + inference + draw_detections
│   │   │                           # (filename is legacy from the M5Stack era;
│   │   │                           # USB now feeds the same module)
│   │   ├── defect_detector.py      # Two-stage QC: trust YOLO bbox, then look
│   │   │                           # for dark blobs / high-sat patches inside.
│   │   │                           # Per-class envelopes loaded from
│   │   │                           # defect_references.json
│   │   ├── compute_defect_references.py
│   │   │                           # Builds defect_references.json from
│   │   │                           # cube_labels/ training crops. Re-run after
│   │   │                           # every YOLO retrain.
│   │   ├── defect_references.json  # Per-class HSV envelopes + clean-training
│   │   │                           # noise floor. Loaded at startup.
│   │   ├── camera_service.py       # USB camera + v4l2-ctl integration
│   │   │                           # (focus, brightness, contrast, exposure,
│   │   │                           # white balance)
│   │   ├── dobot_client.py         # Dobot Magician (legacy, wiring commented)
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

`pwa-dobot-plc/backend/config.json` is the source-controlled defaults; `~/.sf2/config.local.json` (created at runtime by the `/api/config` POST handler) layers operator overrides on top. `load_config()` does the merge. Any slider change (per-class confidence, defect threshold, camera focus, v4l2 controls) lands in the local override so resets / git pulls don't lose tuning.

Important blocks:
- `plc.ip` — PLC address
- `poe_camera.conf` — global YOLO confidence floor (fallback)
- `poe_camera.class_conf` — per-class YOLO confidence thresholds, e.g.
  `{"yellow_cube": 0.35, "purple_cube": 0.5, "metal_cube": 0.6}`. Live-tunable from the vision page sliders.
- `poe_camera.max_detections` — cap on cubes per frame after YOLO. Default `1`. The conveyor glass produces a mirror reflection that YOLO scores as a second lower-confidence cube; sorting by confidence and keeping top-N drops it.
- `poe_camera.min_class_match` — fraction of bbox-centre pixels that must match the class's HSV envelope (default `0.10`). Drops YOLO mis-classifications where the cube colour doesn't match the predicted class — e.g. a red cube being labelled `yellow_cube`.
- `poe_camera.defect_detection.enabled` — master toggle, default `false`. When OFF the per-cube histogram check is skipped entirely; rejection rests on the classification-only path (red/green/unrecognised → hue-mismatch filter drops detection → defect pulse via "sensor sees something but YOLO recognises nothing"). When ON the histogram check runs on top to catch tape/marker/dirt on a correctly-classified cube. Live-tunable from a toggle in the vision page controls row.
- `poe_camera.defect_detection.thresholds` — per-class max defect % (raw percent, e.g. `2.0`). Only consulted when the master toggle above is ON. Above this, `defect_detected` pulses on DB124. Live-tunable from the vision page sliders.
- `poe_camera.crop` / `poe_camera.mask` — pre-inference geometric edits. Both currently disabled because the USB camera training data is unmasked / uncropped; re-enabling either would create a distribution shift YOLO never saw.
- `camera.focus` — `{"autofocus": bool, "value": int}`, applied via `v4l2-ctl` after every camera open. IMX179 manual focus range is 0–1023; default 550.
- `camera.v4l2_controls` — arbitrary `{name: int}` map applied via `v4l2-ctl` after every camera open. Populated by the page sliders. Whitelist lives in `camera_service.CameraService.V4L2_CONTROL_WHITELIST` (brightness, contrast, saturation, hue, gain, sharpness, gamma, backlight_compensation, white_balance, exposure, power_line_frequency).
- `io_link.master_ip` — IO-Link master address
- `enable_digital_twin_stream` — `false` to reduce CPU load

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

## USB camera (production)

UVC webcam on `/dev/video0` (typically a Sony IMX179 module). OpenCV `VideoCapture` for raw frames, `v4l2-ctl` shell-out for controls that OpenCV's `CAP_PROP_*` round-tripping is flaky on:

- **Focus** — `focus_automatic_continuous` (modern) / `focus_auto` (legacy) for AF, `focus_absolute` 0–1023 for manual. Always re-applied after camera open.
- **Brightness / contrast / saturation / hue / gain / sharpness / gamma / backlight_compensation / white_balance / exposure / power_line_frequency** — exposed via `/api/camera/controls`. Whitelist in `camera_service.CameraService.V4L2_CONTROL_WHITELIST`. The page builds sliders dynamically from `v4l2-ctl --list-ctrls` output so any camera-specific control range is correct.

For QC stability you want to **lock exposure (`exposure_auto = manual`) and white balance (`white_balance_temperature_auto = false`)** so the defect detector's `cube_mean_v` baseline doesn't drift with bench lighting changes.

## PoE camera firmware (legacy)

The M5Stack PoE CAM-W is **no longer in the active production path** — the USB camera replaced it. The firmware and flashing notes below are kept for reference.

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
| DB124 | Camera/vision result bits (see byte 0 map below) |
| DB125 | Robot arm bridge (status bytes 0-21, commands bytes 22-31) |
| DB126 | Edge device stats |
| DB127 | IO-Link PLC telemetry |

### DB124 byte 0 — vision result bits

| Bit | Tag | Owner | Notes |
|-----|-----|-------|-------|
| 0.0 | `start` | PLC | READ-ONLY for Pi. Handshake trigger. |
| 0.1 | `connected` | Pi | Camera reachable + frame fresh |
| 0.2 | `busy` | Pi | Inference in progress |
| 0.3 | `completed` | Pi | Latest cycle finished |
| 0.4 | **`defect_detected`** | Pi | **Edge-pulse: 800 ms HIGH per defective cube** (see Defect detection below). PLC should edge-count, not level-gate. |
| 0.5 | `reject_command_from_plc` | PLC | PLC-owned; Pi never writes this. |
| 0.6 | `yellow_cube_detected` | Pi | Suppressed when cube is defective — only fires on clean cubes. |
| 0.7 | `purple_cube_detected` | Pi | Same suppression rule. |
| 1.0 | `metal_cube_detected` | Pi | Same suppression rule. |

The colour-bit suppression means a defective cube produces ONLY `defect_detected` (no colour bit) — so a PLC routine that latches the colour first will fall through to the reject branch instead of binning a tape-covered yellow as clean yellow.

Atomic single-bit writes (`plc_worker.queue_bit_write`) are used for `defect_detected` so the surrounding PLC-owned bits in byte 0 (`start`, `reject_command_from_plc`) survive the write. The colour-bit helper still writes a full byte but with the four Pi-owned bits set correctly.

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

## Vision pipeline (`app.py` + `poe_vision_service.py` + `defect_detector.py`)

The file is called `poe_vision_service.py` for historic reasons; the actual frame source is the USB camera, not the M5Stack. Two daemon threads do the work:

- **Pump** (`_poe_pump_loop`, ~7 Hz) — pulls frames out of `CameraService.read_frame()`, applies crop / mask / 90° CCW rotation, caches the raw JPEG (for the Capture Training Image button) and an annotated JPEG (for the HMI MJPEG stream). Runs faster than YOLO so the on-screen feed feels live.
- **Inference** (`_poe_detection_loop`, 1 Hz) — owns YOLO + the defect detector. Publishes detections back to the pump for overlay, writes PLC bits.

### Pump cadence

`_poe_pump_loop` reads the latest USB frame each iteration. The frame goes through:

1. **Rotate** 90° CCW (`cv2.ROTATE_90_COUNTERCLOCKWISE`). The training data was captured rotated, so YOLO + the defect detector need the same orientation.
2. **Crop** (currently disabled — `config.poe_camera.crop.enabled = false`).
3. Hand `frame_unmasked` to the inference thread via `_poe_latest_unmasked`.
4. Cache `frame_unmasked` as `_poe_loop_raw_jpeg` for `/api/poe-camera/capture` (training-data button serves this).
5. Draw the latest cached detections on `frame_unmasked` → `_poe_loop_anno_jpeg`.
6. **REJECT overlay** — if I0.5 sensor is HIGH and the cached detection list is empty, paint a large red "REJECT" badge centred on the annotated frame. Pump owns this so it appears at ~7 Hz even when YOLO hasn't run yet.

### Inference cadence

`_poe_detection_loop` runs every `POE_LOOP_INTERVAL_S = 1.0` second:

1. **Mask** is applied here (after the pump's unmasked handoff) and YOLO sees only the masked frame. Currently mask is disabled too.
2. **YOLO inference** (`poe_vision_service.detect_cubes`) with the per-class confidence floor.
3. **Cap to top-N detections** (`config.poe_camera.max_detections`, default `1`). Sorts by confidence and trims; drops the conveyor-glass mirror reflection that YOLO scores as a phantom second cube.
4. **Hue-mismatch filter** (`defect_detector.class_match_fraction`). For each remaining detection, compute the fraction of bbox-centre pixels that pass the class's HSV envelope. If `< config.poe_camera.min_class_match` (default `0.10`), drop it — handles untrained colours (red, green) that YOLO snaps to the nearest known class.
5. **Defect detection** (per detection — see below). Gated on the live `poe_camera.defect_detection.enabled` flag; when OFF, each detection is tagged `defect_pct=0`, `is_defective=False`, `defect_debug={'reason': 'defect_detection_disabled'}` and the histogram check is skipped.
6. **N-cycle debounce** (`POE_DEBOUNCE_CYCLES = 2`) on the dominant class.
7. **Write colour bits** via `queue_cube_detection_bits` — but only if `sensor_present AND not any_defective`. Defective cubes write all colour bits FALSE.
8. **Publish JSON state** to `_poe_loop_result` for `/api/poe-vision/latest-result` and the defect watcher.

### Defect detection (`defect_detector.py`)

Anomaly-detection downstream of YOLO. **No labelled defect training data needed** — flags any visual disruption (tape, marker, sticker, dirt, contamination) by analysing cube crops in HSV space.

**Currently OFF by default.** Production mode is classification-only rejection: yellow/purple/metal pass via the colour bits, anything else (red, green, foreign objects) gets dropped by the hue-mismatch filter and pulses the defect bit through the "no detection while sensor present" path. Flip the page toggle ON to additionally catch contaminated cubes that DO classify correctly.

Per crop (when the master toggle is ON):

1. **Centre-crop** the bbox at 75% (skips ~25% of background near bbox edges).
2. **Clean reference** = mean V of the top-half of patch V values (the brightest 50% — almost always the clean cube surface, even on heavily contaminated cubes).
3. **Adaptive dark threshold** = `cube_mean_v × dark_factor` (per-class `dark_factor` lives in `defect_references.json`; defaults: yellow 0.55, purple 0.55, metal 0.40 — lower for metal because brushed metal has natural shadows).
4. **Candidate defect mask** = pixels in the patch with `V < dark_threshold`. For metal, ALSO pixels with `S >= envelope.defect_s_min` (catches coloured tape on grey metal).
5. **Morphology** — open then close with a 5×5 kernel. Drops noise pixels, joins near-adjacent ones into a single blob.
6. **defect_pct** = `defect_pixels / patch_pixels × 100`.

`compute_defect_references.py` builds the per-class envelopes (`h_low`, `h_high`, `s_min`, `v_min`, `s_max`, `dark_factor`, `defect_s_min`) + the worst-clean-training defect % from `cube_labels/`. The runtime `DefectDetector` falls back to `max(1.5, 2 × train_max_defect_pct)` if no explicit threshold is configured.

The inference loop smooths each detection's `defect_pct` over the last `DEFECT_SMOOTH_WINDOW = 5` frames per class. `is_defective` uses the smoothed value, so a single-frame flutter doesn't fire the PLC pulse.

### Defect bit on DB124.DBX0.4 (edge-pulse)

Driven by `_defect_watcher_loop` (100 ms tick) — separate from the 1 Hz YOLO cycle. State machine:

```
IDLE     defective rising edge -> fire 800 ms HIGH pulse, state=PULSING
PULSING  hold HIGH until pulse_until, then state=HELD (write LOW)
HELD     hold LOW until either
           (a) defective condition clears -> IDLE
           (b) 1.8 s of continuous defect elapsed -> assume next cube
               flowed in behind the first; fire another pulse
```

Pulse duration (800 ms) is comfortably longer than the observed worst PLC-worker cycle time (~550 ms) so the TRUE write and FALSE write always land in DIFFERENT worker cycles. Without the gap, both writes could batch into one cycle and the PLC scan would never see the TRUE.

The "defective condition" the watcher reads is `sensor_present AND (dominant is None OR any_defective)`. So defect fires for both:
- Unrecognised object (sensor sees something, YOLO returns nothing or got hue-filtered)
- Recognised cube with contamination

### Vision page (`vision.html`)

Passive monitor — polls `/api/poe-vision/latest-result` (~5 Hz) and `/api/plc/io/read`. Detection itself never depends on the browser. Page layout:

- **Controls row** (always visible) — Detect Cubes / Live / Capture buttons + the **Defect detection master toggle** (red switch, POSTs `poe_camera.defect_detection.enabled`).
- **Camera feed + Detection results panel** — always visible at top of the AI section.
- **Collapsible settings** below:
  - Per-class YOLO confidence sliders (POST to `poe_camera.class_conf`)
  - Max defect % sliders (POST to `poe_camera.defect_detection.thresholds`) — pre-tune while defect is off, takes effect when toggle goes on
  - Camera focus (autofocus toggle + 0–1023 slider)
  - Camera settings — dynamically populated from `/api/camera/controls` (brightness, contrast, exposure, white balance, etc.)
- Debug Console collapsed at the bottom.

All collapsibles are native `<details>`/`<summary>` with a `sf-collapsible` CSS class for the explicit chevron + hover styling.

### On-stream annotations (`draw_detections`)

The pump's annotated JPEG includes:
- **Class label + confidence** at the top-left of each bbox. Pretty-printed: `metal_cube` → `Metal Cube`. Internal class names elsewhere (PLC bits, config keys, training labels, JSON API) keep the underscore form.
- **OK / DEFECT badge** at the bottom-right of each bbox — but **only when defect detection is enabled**. With the master toggle OFF the badge is hidden entirely (every cube would just read `OK 0.0%` otherwise, which is visual noise).
- **REJECT overlay** centred on the frame when sensor is HIGH but detection list is empty (unrecognised object). Painted by the pump so it appears at pump cadence (~7 Hz) without waiting for the next YOLO inference cycle.

### Endpoints

- `GET /api/poe-vision/latest-result` — JSON of latest result (`detections[]` includes `defect_pct`, `defect_pct_raw`, `is_defective`, `class_match`, `defect_debug`)
- `GET /api/poe-vision/annotated` — latest annotated JPEG (with `?stream=1` for MJPEG)
- `GET /api/poe-vision/status` — model load status
- `GET /api/poe-camera/capture` — cached raw JPEG (training data)
- `GET /api/camera/stream` — USB camera MJPEG passthrough
- `GET /api/camera/controls`, `POST /api/camera/controls` — v4l2 control list / set
- `GET /api/camera/focus`, `POST /api/camera/focus` — focus settings
- `GET /api/vision/annotated-result?stream=1` — legacy alias forwards to the PoE annotated handler so the HMI iframe URL never changed
- `POST /api/config` — operator overrides; handles `vision`, `plc`, `camera`, and `poe_camera` keys with deep-merge into `~/.sf2/config.local.json`

The legacy USB colour-voting pipeline (`vision_service.py`) is still in the repo but **all its routes are commented out**. `CameraService` is now active again (it was disabled in the PoE era) and feeds the YOLO loop directly.

## PLC worker write path

`plc_integration.py` mediates all writes to DB123/DB124/DB125 via the `plc_worker.queue_write` queue. The helpers that the bridge polls into frequently (`queue_robot_status`, `queue_robot_position`, `queue_robot_faults`, `queue_cube_detection_bits`) are **idempotent** — they track last-written values in module state and skip enqueueing when the value hasn't changed. Without this, periodic telemetry from the bridge re-enqueued ~7 PLC writes per poll, saturating the worker's queue and dragging cycle time from ~150 ms to 1500-2000 ms. Any new helper that gets called on a periodic poller should follow the same pattern.

## Cube detector training

Local workflow in `cube-training/` — Windows-side, never on the Pi.

1. **Capture** — vision.html has a Capture Training Image button that downloads the pump's most recent raw frame (already rotated 90° CCW the same as production inference). Save into `cube-training/cube_images/`.
2. **Annotate** — CVAT (self-hosted Docker or app.cvat.ai). Export as **Ultralytics YOLO Detection 1.0**. Class order must be `yellow_cube` (0), `purple_cube` (1), `metal_cube` (2). Drop the `.txt` files into `cube_labels/`. **CVAT's class order often disagrees with the project's** — the export uses whichever order you set up in CVAT (often `metal=0`, `yellow=1`, `purple=2`). A remap step is required: rewrite each .txt to swap class IDs back into project order. See the previous training cycle commits for the script.
3. **Add negative examples** — heavily impacts model quality on small datasets. ~20% of images should be empty-bench frames with empty `.txt` files. Without negatives, the model fires confidently on every plausible blob.
4. **Organise** — `python organize_cube_dataset.py` splits 80/20 into `dataset/images/{train,val}` and `dataset/labels/{train,val}`. Re-runnable.
5. **Train** — `python train_cube_detector.py`. CPU-only by default. YOLO11n base downloads on first run. Augmentation is cranked up (`mosaic=1.0`, `mixup`, `copy_paste`, `erasing`, wider `degrees`/`scale`/`translate`) — necessary because the dataset is small (<70 images). The script reads `results.save_dir` so it picks the actual Ultralytics-versioned output dir (cube_train, cube_train2, ...).
6. **Rebuild defect envelopes** — `python pwa-dobot-plc/backend/compute_defect_references.py`. Reads the same `cube_labels/`, produces `defect_references.json`. Re-run after every retrain so the per-class HSV envelopes match the new dataset.
7. **Deploy** — `scp cube-training/runs/detect/cube_train*/weights/cube_detector.pt pi@192.168.7.5:/home/pi/cube_detector.pt` and `scp pwa-dobot-plc/backend/defect_references.json pi@192.168.7.5:/home/pi/sf2/pwa-dobot-plc/backend/`. Then `sudo systemctl restart smart-factory`. `poe_vision_service.resolve_model_path()` searches `~/cube_detector.pt` first.

See `cube-training/Guides/CUBE_TRAINING_GUIDE.md` for the full procedure including CVAT setup.

### Lessons hard-won the painful way

- **Negative examples matter more than positive ones for small datasets.** Adding 10 empty-bench frames took confidence from 11% wrong-class to 99% right-class on a 33-image set.
- **Mask state must be consistent between training and inference.** Training captures unmasked, inference applying mask = distribution shift = catastrophic confidence drop.
- **Rotation state must be consistent too.** Same trap: training captured pre-rotation, inference rotated = model never saw this orientation.
- **The script's hard-coded output path won't match Ultralytics' auto-versioned run dir** (it makes `cube_train2`, `cube_train3` if `cube_train` exists). Use `results.save_dir` from the train() return value.
- **CVAT class order is per-project**, not standardised. Check `data.yaml` in the export and remap to project order (yellow=0, purple=1, metal=2) before placing in `cube_labels/`.

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
