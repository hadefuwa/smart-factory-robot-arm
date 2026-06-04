# 🏭 Smart Factory

A comprehensive smart factory automation system featuring Dobot Magician robot control with PLC integration, real-time monitoring, and a modern web-based interface. Perfect for Industry 4.0 applications with automatic alarm clearing and seamless PLC communication.

## 📋 Table of Contents

- [Quick Start](#-quick-start)
- [Autostart on Boot](#-autostart-on-boot)
- [What This Project Does](#-what-this-project-does)
- [Project Structure](#-project-structure)
- [Installation](#-installation)
- [Usage](#-usage)
- [Key Features](#-key-features)
- [Recent: Robot Arm Latency Overhaul (2026-05-20)](#-recent-robot-arm-latency-overhaul-2026-05-20)
- [Recent: Vision Pipeline Overhaul (2026-06-04)](#-recent-vision-pipeline-overhaul-2026-06-04)
- [Documentation](#-documentation)
- [Testing](#-testing)
- [Troubleshooting](#-troubleshooting)
- [Deployment](#-deployment)
- [Support](#-support)

---

## 🚀 Quick Start

### Already set up — just restart

```bash
cd ~/sf2/pwa-dobot-plc/backend
source venv/bin/activate
python3 app.py
```

Open `http://your-pi-ip:8080` in your browser (or `https://` when SSL is enabled for WinCC).

---

### Fresh Raspberry Pi — full setup from scratch

Run these steps once on a new Pi. Internet is required for the initial install only.

#### 1. Clone the repo

```bash
cd ~
git clone https://github.com/hadefuwa/sf2 sf2
cd sf2
```

#### 2. Install system packages

```bash
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv build-essential

# USB serial access (needed for Dobot)
sudo usermod -a -G dialout $USER
```

#### 3. Install Snap7 (PLC communication)

```bash
cd ~
wget https://sourceforge.net/projects/snap7/files/1.4.2/snap7-full-1.4.2.tar.gz
tar -zxvf snap7-full-1.4.2.tar.gz
cd snap7-full-1.4.2/build/unix
make -f arm_v7_linux.mk
sudo cp ../bin/arm_v7-linux/libsnap7.so /usr/lib/
sudo ldconfig
```

#### 4. Set up the Python venv and install packages

```bash
cd ~/sf2/pwa-dobot-plc/backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

#### 5. Configure your hardware

Edit `config.json` in the backend folder — update `dobot.port` to match your USB device (`/dev/ttyACM0` or `/dev/ttyACM1` — run `ls /dev/ttyACM*` to check) and `plc.ip` to your PLC's IP address.

#### 6. Test it manually first

```bash
source venv/bin/activate
python3 app.py
```

If you see `Starting Flask server on 0.0.0.0:8080`, open `http://your-pi-ip:8080` and confirm everything works before setting up autostart.

#### 7. Set up autostart on boot

See the [Autostart on Boot](#-autostart-on-boot) section below — choose **systemd** (recommended, no extra software) or **PM2**.

---

### ⚡ Autostart on Boot

Two options. Pick one.

#### Option A — systemd (recommended)

No extra software needed. Create a single service file:

```bash
sudo nano /etc/systemd/system/smart-factory.service
```

Paste this content, then save and close:

```ini
[Unit]
Description=Smart Factory Backend
After=network.target

[Service]
User=pi
WorkingDirectory=/home/pi/sf2/pwa-dobot-plc/backend
ExecStart=/home/pi/sf2/pwa-dobot-plc/backend/venv/bin/python app.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable smart-factory
sudo systemctl start smart-factory

# Check it's running
sudo systemctl status smart-factory
```

If you also run the vision service separately, create a second service file at `/etc/systemd/system/vision-service.service` with the same structure but `ExecStart=/home/pi/sf2/pwa-dobot-plc/backend/venv/bin/python vision_service.py` and `Environment="VISION_PORT=5001"`.

**Useful commands:**
```bash
sudo systemctl status smart-factory      # check status / recent logs
sudo systemctl restart smart-factory     # restart
sudo systemctl stop smart-factory        # stop
sudo journalctl -u smart-factory -n 50   # last 50 log lines
```

#### Option B — PM2

Requires Node.js (`sudo apt-get install -y nodejs npm`).

```bash
npm install -g pm2

cd ~/sf2/pwa-dobot-plc
pm2 start deploy/ecosystem.config.js

# Save and enable on boot
pm2 save
pm2 startup
# Run the sudo command it prints out
```

Note: the `ecosystem.config.js` paths assume the repo is at `/home/pi/sf2`. Edit the file if your path is different.

**Access the web interface:** Open your browser and visit `http://your-pi-ip-address:8080`

#### HTTPS (for WinCC Unified HMI)

WinCC Unified requires HTTPS for embedded camera streams. Generate a self-signed certificate:

```bash
cd ~/sf2/pwa-dobot-plc
chmod +x deploy/generate_ssl_cert.sh
./deploy/generate_ssl_cert.sh 192.168.7.5   # use your Pi's IP
pm2 restart pwa-dobot-plc   # or systemctl restart smart-factory
```

Then use `https://192.168.7.5:8080/api/camera/stream` in WinCC. Accept the certificate warning on first load.

---

## 🌐 Network Topology

All devices run on the `192.168.7.x` industrial subnet. No Windows PC is required in production.

| Device | IP | Role |
|--------|-----|------|
| Raspberry Pi 5 | 192.168.7.5 | Backend, web UI, all control logic |
| Siemens S7-1200 PLC | 192.168.7.2 | Main automation controller |
| IO-Link Master | 192.168.7.4 | Sensor data, HTTP polling |
| M5Stack PoE CAM-W | 192.168.7.6 | MJPEG vision stream |

---

## 🎯 What This Project Does

This project allows you to:

- **Drive a 6-DOF ST3215 robot arm** from a Siemens S7-1200 PLC over the integrated Flask + Node.js bridge
- **Integrate with the PLC** for closed-loop conveyor / sort / pick-and-place control
- **Monitor robot position, raw I/O, and PLC bits** in real-time from a web UI
- **Run YOLO cube detection on the backend** every second, write classification bits straight to the PLC, no browser required
- **Use as a Progressive Web App (PWA)** — install it on your phone or desktop
- **Capture training data through the production camera pipeline** so the dataset and inference share the exact same field of view

---

## 📁 Project Structure

```
smart-factory-robot-arm/
├── pwa-dobot-plc/                  # Main application (robot, PLC, vision)
│   ├── backend/
│   │   ├── app.py                  # Flask entry point (HTTPS, port 8080).
│   │   │                           # Hosts the always-on YOLO detection loop +
│   │   │                           # the PLC auto-move backend.
│   │   ├── config.json             # All hardware config — single source of truth
│   │   ├── plc_worker.py           # snap7 worker (DB reads/writes + raw PE/PA)
│   │   ├── plc_integration.py      # Idempotent PLC write helpers
│   │   ├── poe_vision_service.py   # YOLO model load + inference helpers
│   │   ├── camera_service.py       # USB camera (legacy, disabled)
│   │   ├── vision_service.py       # HSV colour voting (legacy, disabled)
│   │   └── ssl/                    # Self-signed certs (generated, not in git)
│   ├── frontend/
│   │   ├── vision.html             # PRODUCTION vision page — polls the backend
│   │   ├── plc-setup.html          # DB editors + Raw I/O tab
│   │   ├── robot-arm.html, rfid.html, io-link.html, ...
│   │   └── assets/js/app-shell.js
│   ├── robotarmv3-pi-service/      # Node.js arm bridge (ST3215, port 8090)
│   └── deploy/
│       ├── ecosystem.config.js     # PM2 config
│       └── generate_ssl_cert.sh    # HTTPS certificate generator
├── poe-camera-firmware/
│   ├── M5PoECAM_SmartFactory/
│   │   └── M5PoECAM_SmartFactory.ino  # v1.1.0 — ETH.h, static 192.168.7.6
│   └── FIRMWARE_CHANGELOG.md
├── cube-training/                  # Local-only training workflow (gitignored)
│   ├── CUBE_TRAINING_GUIDE.md      # Capture → CVAT → organise → train → SCP
│   ├── capture_cube_images.py, organize_cube_dataset.py, train_cube_detector.py
│   └── cube-data.yaml              # 0=yellow_cube, 1=purple_cube, 2=metal_cube
├── archive/                        # Historic Dobot / USB-camera / old docs
├── raspberry-pi-control-st3215/    # Robot arm servo/joint control (low-level)
├── docs/                           # Active guides + investigations
├── CLAUDE.md                       # Claude Code / AI assistant context
└── README.md
```

---

## 💻 Installation

### Prerequisites

- Raspberry Pi (3 or 4 recommended)
- Dobot Magician robot connected via USB
- Siemens S7-1200 PLC (optional, for PLC integration)
- Python 3.7 or higher
- Internet connection (for initial setup)

### Step-by-Step Installation

#### 1. Clone or Download the Project

```bash
cd ~
git clone https://github.com/hadefuwa/sf2
cd sf2
```

#### 2. Install System Dependencies

```bash
# Update package list
sudo apt-get update

# Install Python and build tools
sudo apt-get install -y python3-pip python3-venv build-essential

# Install Snap7 library for PLC communication (if using PLC)
cd ~
wget https://sourceforge.net/projects/snap7/files/1.4.2/snap7-full-1.4.2.tar.gz
tar -zxvf snap7-full-1.4.2.tar.gz
cd snap7-full-1.4.2/build/unix
make -f arm_v7_linux.mk
sudo cp ../bin/arm_v7-linux/libsnap7.so /usr/lib/
sudo ldconfig
```

#### 3. Set Up Python Virtual Environment

```bash
cd ~/sf2/pwa-dobot-plc/backend

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Install Python packages
pip install -r requirements.txt
```

#### 4. Configure USB Permissions (for Dobot)

```bash
# Add your user to dialout group (allows USB access)
sudo usermod -a -G dialout $USER

# Log out and back in, or run:
newgrp dialout

# Find your Dobot device
ls -la /dev/ttyACM*
```

#### 5. Configure Settings

Edit `pwa-dobot-plc/backend/config.json`:

```json
{
  "dobot": {
    "port": "/dev/ttyACM0",
    "baudrate": 115200
  },
  "plc": {
    "ip": "192.168.1.150",
    "rack": 0,
    "slot": 1
  },
  "server": {
    "port": 8080,
    "host": "0.0.0.0"
  }
}
```

**Important:** Update the `dobot.port` to match your device (usually `/dev/ttyACM0` or `/dev/ttyACM1`)

#### 6. Test the Installation

```bash
# Make sure virtual environment is activated
source venv/bin/activate

# Run the application
python3 app.py
```

You should see:
```
INFO - Starting Flask server on 0.0.0.0:8080
INFO - PLC client initialized
INFO - Dobot client initialized
```

---

## 🎮 Usage

### Starting the Application

```bash
cd ~/sf2/pwa-dobot-plc/backend
source venv/bin/activate
python3 app.py
```

### Using the Web Interface

1. **Open your browser** and go to `http://your-pi-ip:8080`
2. **Check connections** - Green indicators show PLC and Dobot are connected
3. **Monitor data** - See real-time robot position and PLC status
4. **Control the robot**:
   - 🏠 **Home** - Send robot to home position
   - ▶️ **Move to Target** - Move robot to PLC target coordinates
   - 🛑 **Emergency Stop** - Immediately stop all movement
   - Manual position control via web interface

### Installing as PWA (Progressive Web App)

**On Mobile (iOS/Android):**
1. Open the app in Safari (iOS) or Chrome (Android)
2. Tap "Share" → "Add to Home Screen"
3. Launch like a native app!

**On Desktop:**
1. Open in Chrome browser
2. Click the install icon in the address bar
3. Use as a standalone app!

---

## ✨ Key Features

- ✅ **PLC-driven arm motion** — PLC sets `DB125.target_xyz`, backend dispatches to the ST3215 bridge with home-waypoint routing and 20 mm tolerance
- ✅ **Always-on YOLO cube detection** — runs on the backend every 1 s, writes `yellow_cube_detected` / `purple_cube_detected` / `metal_cube_detected` straight into DB124. No browser required.
- ✅ **N-consecutive-cycles debounce + per-class confidence thresholds** — single-cycle blips never reach the PLC; permissive thresholds for classes the model under-detects, strict for classes it over-detects
- ✅ **Raw `%I` / `%Q` PLC reads** exposed via `/api/plc/io/read` and surfaced in a dedicated tab on `plc-setup.html` (EStop, Light Sensors, Conveyor outputs, etc. with TIA-project names)
- ✅ **Light-sensor cross-check on the vision page** — when `%I0.5` reports an object but YOLO returned zero detections, an "AI missed it" warning lights up. Catches untrained classes (e.g. a green cube) and low-confidence misses.
- ✅ **Capture Training Image button** — downloads the loop's most recent raw JPEG so training data and inference always share the same field of view
- ✅ **PLC worker idempotency** — write-side helpers skip no-op writes, keeping the worker cycle around its 100 ms target
- ✅ **Progressive Web App** — installable on phone or desktop
- ✅ **HTTPS for WinCC** — self-signed SSL for embedding annotated frames in WinCC Unified HMI (run `deploy/generate_ssl_cert.sh`)

---

## 🤖 Recent: Robot Arm Latency Overhaul (2026-05-20)

Tagged as `v5.1.0`. The arm now responds to a PLC HMI target change in well under a second end-to-end; previously a 2-3 s lag accumulated at each stage.

### Where the latency was

| Stage | Before | After |
|-------|--------|-------|
| HMI press → PLC worker cache reflects new DB125 target | 1.5-2 s | ~150-180 ms |
| Cache change → bridge receives `moveToXYZ` | tick-bound | ~50 ms |
| Bridge response → next waypoint dispatched (via-home → final) | +1.5-2 s | < 200 ms |

### Root causes fixed

1. **PLC worker write queue saturation.** `queue_robot_position(x, y, z)` and `queue_robot_faults(...)` enqueued 7 PLC writes on every bridge telemetry poll regardless of whether values had changed. Queue length climbed to 28-60, dragging cycle time from a 150 ms baseline to 1500-2000 ms. **Fix:** both helpers now track last-written values in `plc_integration.py` and short-circuit on no-op writes. REAL fault metrics are quantised to 2dp so float noise can't force a write.
2. **Bridge post-move creep pass.** After every successful `moveToXYZ`, the Node bridge ran a hardcoded 1500 ms `setTimeout` to tighten per-joint error from 20 → 8 steps. Because the bridge command queue is one-at-a-time, that sleep blocked the *next* `moveToXYZ(final)` from being dispatched. **Fix:** creep pass removed in `server.js`. The PLC auto-move's existing 20 mm Euclidean tolerance is the acceptance criterion now.
3. **ST3215 bus fast-fail on dark bus.** When the SC-B1 serial adapter or a servo went silent, `getAllServoStatus()` polled every joint sequentially with full timeout per joint, taking seconds per status fetch and starving the queue. **Fix:** dark-bus short-circuit in `getAllServoStatus()` — after the first timeout, remaining servos are skipped this poll. `ALL_FAIL_RECOVERY_THRESHOLD` dropped from 5 → 2 polls so the auto-recovery (close + reopen + re-init) fires sooner.
4. **PLC worker idempotent status writes** — `queue_robot_status(connected, busy)` already had a cache-compare guard; the position/faults helpers above bring the rest of the robot-telemetry write path in line with it.
5. **Auto-move tick interval** dropped from 300 ms → 50 ms in `app.py` so the cache → bridge dispatch is bounded by `~one_tick + WS round-trip`, not by the operator-noticeable scan period.
6. **Home-waypoint routing** is now a one-time decision per operator target (stateful `home_visited_for_target_key` in `app.py`). Previously the router re-evaluated per tick, which caused the arm to flip-flop between "go home" and "go target" when it landed just outside tolerance.
7. **Stall behaviour** — the bridge no longer wipes servo goals on stall (`server.js`) and the PLC backend treats `stall` within tolerance as success (`app.py`). With the prototype's weak J2 and the EEPROM motor-protection lift (`raise-motor-limits.js`: UnloadCondition 47 → 7, OverloadTime 80 → 254), the joint crawls to the goal instead of being declared dead.
8. **Servo bus terminology corrected.** The ST3215 + SC-B1 path is a **single-wire TTL half-duplex bus** at 500 kbps (V+ / GND / SIGNAL, 5 V logic, idles HIGH), not RS-485. CLAUDE.md, `pwa-dobot-plc/robotarmv3-pi-service/README.md`, and `docs/J5_WRIST_PITCH_BUS_CORRUPTION.md` were corrected. Termination concepts that apply to RS-485 (120 Ω, A/B biasing, shield grounding) were replaced with the TTL-relevant checks (idle-line voltage, scope rise/fall edges, stub length, common-ground bounce, IR drop on V+).

### New diagnostic helpers (in `pwa-dobot-plc/robotarmv3-pi-service/`)

- `change-baud.js` — one-shot broadcast utility to walk the chain and lower the servo baud (used to drop from 1 Mbps → 500 kbps when J5 was marginal at 1 Mbps).
- `raise-motor-limits.js` — clears the OVERLOAD + MOTOR auto-unload bits and maxes `OverloadTime`. Keeps voltage / sensor / overtemp protection on.
- `read-protection.js` — dumps every protection-related EEPROM register on each servo.

### Live observability

`pwa-dobot-plc/backend/app.py` runs a background CSV logger that writes PLC target vs arm-current XYZ every 0.5 s to `/home/pi/sf2/logs/plc_vs_arm_positions.csv`. Arm XYZ is queried directly from the bridge so it stays fresh regardless of frontend polling. Columns: `iso_timestamp, tx, ty, tz, speed, ax, ay, az, dx, dy, dz, dist, plc_connected, bridge_connected, move_in_flight`.

---

## 🎯 Recent: Vision Pipeline Overhaul (2026-06-04)

The vision system has been fully rebuilt around the M5Stack PoE CAM-W + a custom-trained YOLO11n cube detector. The USB camera and the old HSV colour-voting cycle have been retired — they're left in the tree for reference but every route is commented out.

### What the production pipeline looks like

1. **Always-on backend loop** (`app.py:_poe_detection_loop`, daemon thread, 1 Hz). Runs whether or not the web UI is open.
2. **Fetch** a raw JPEG from `http://192.168.7.6/capture` via `poe_vision_service.fetch_frame()`.
3. **Cache** the raw frame for the Capture Training Image button (training data ≤ 1 s old).
4. **Crop** + **Mask** the frame via config-driven helpers. The mask paints solid black over the right 30% by default, preserving the original 800×600 aspect ratio so the trained model's input shape isn't disturbed.
5. **YOLO inference** with **per-class confidence thresholds** (`config.poe_camera.class_conf`): yellow 0.35 (permissive), purple 0.50, metal 0.60 (strict). YOLO's own `conf` floor is set to the minimum across classes so every candidate makes it through to the post-filter.
6. **Keep-box filter** drops detections whose centre falls in the masked region — kills the "object edge" hallucinations YOLO produces on the mask boundary.
7. **N-consecutive-cycles debounce** (default N=2). The PLC bit only changes after the same class has won the dominant slot for N cycles in a row. Single-cycle false positives never reach the PLC. `None` is a valid streak key so removing the cube also takes N cycles to confirm.
8. **PLC bit write** via `queue_cube_detection_bits(yellow, purple, metal)` — idempotent; skips no-op writes.

### DB124 cube bits (renamed)

| Tag | Address | Notes |
|---|---|---|
| `yellow_cube_detected` | `DB124.DBX0.6` | Set when YOLO confirms a yellow cube |
| `purple_cube_detected` | `DB124.DBX0.7` | **Renamed** from `white_cube_detected`. The TIA byte/bit offset is unchanged so the PLC project doesn't need editing. |
| `metal_cube_detected` | `DB124.DBX1.0` | Set when YOLO confirms a metal cube |

The factory cube set is now yellow / purple / metal. Anything else (e.g. a green cube) won't match a class and the AI-missed-it warning on `vision.html` lights up to flag the gap.

### Raw `%I` / `%Q` reads via snap7

`plc_worker._refresh_raw_io()` reads the PE and PA areas directly every 500 ms inside the main worker cycle (snap7 isn't thread-safe). Surfaced at `GET /api/plc/io/read` with TIA-project friendly names attached. The vision page polls it to drive the **Light Sensor 1 (%I0.5)** badge and the "AI missed the object" warning.

Available addresses: digital inputs `%I0.0..%I1.5` (EStops, Reset / Start / Stop buttons, Light Sensors 1–3, Inductive / Capacitive Proxies, Gantry Limit Switches, Quarantine Switch, Fault Override), analog inputs `%IW64` and `%IW66`, digital outputs `%Q0.0..%Q1.1` (Stepper Pulse / Direction, Plunger Down / Up, Pneumatic Vacuum, Gate, Reject, Reset Linear Actuator, Conveyor 1, Conveyor 2).

### Frontend (`vision.html`)

Now a passive monitor. It polls `/api/poe-vision/latest-result` and `/api/plc/io/read` once a second and renders. The page-side `Live` / `Pause display` button only toggles the display refresh — the backend loop and PLC bits keep running regardless.

Per-class confidence sliders write their values back to `/api/config` with a 400 ms debounce so the backend loop picks them up within the next cycle.

### Training pipeline (`cube-training/`)

Local-only workflow. Capture data via the Capture Training Image button on `vision.html` (gets the loop's cached raw JPEG, so training data and inference share the same field of view). Annotate in **CVAT** using the **Ultralytics YOLO Detection 1.0** export format with classes in order yellow_cube → purple_cube → metal_cube. Drop labels into `cube_labels/`. Run `python organize_cube_dataset.py` then `python train_cube_detector.py` (CPU-only by default, ~10 min for 20-ish images, more for larger sets). SCP the resulting `cube_detector.pt` to `pi@192.168.7.5:/home/pi/cube_detector.pt` and restart `smart-factory`.

See `cube-training/CUBE_TRAINING_GUIDE.md` for the full procedure.

### Camera firmware (unchanged)

M5Stack PoE CAM-W at `192.168.7.6`, firmware v1.1.0 (ETH.h driver, SVGA 800×600, JPEG quality 12, USB 5 V power via G5V pin). The HTTP server is single-client — the backend detection loop owns the slot; `/api/poe-camera/capture` and `/api/poe-vision/annotated` serve cached frames rather than racing the loop.

---

## 📚 Documentation

### Quick Start Guides

- **[Deployment Guide](docs/guides/DEPLOY_TO_PI.md)** - Full deployment instructions
- **[PLC Setup Guide](docs/guides/PLC_DB1_Setup_Guide.md)** - Setting up PLC communication
- **[PLC Robot Control](docs/guides/PLC_Robot_Control_Guide.md)** - Using PLC to control robot
- **[PLC Settings Guide](docs/guides/PLC_Settings_Guide.md)** - Configuring PLC settings

### Robot Arm

- **[J5 wrist-pitch bus corruption investigation](docs/J5_WRIST_PITCH_BUS_CORRUPTION.md)** — diagnosis + fix for the ST3215 bus issue that drove the 1 Mbps → 500 kbps baud drop.
- **[robotarmv3-pi-service README](pwa-dobot-plc/robotarmv3-pi-service/README.md)** — bridge queue, watchdog, USB-disconnect auto-recovery.

### Archive

Historic Dobot Magician fix notes and superseded migration plans live in [`archive/`](archive/). The current arm is the 6-DOF ST3215; the Dobot path is no longer in use.

---

## 🧪 Testing

There is no dedicated automated test harness for the live arm at the moment — verification is done end-to-end against the real PLC + arm rig.

### Smoke checks

```bash
# PLC reachable
ssh pi@192.168.7.5 'curl -sk https://localhost:8080/api/plc/db125/read | python3 -m json.tool'

# Arm bridge reachable and servos responding
ssh pi@192.168.7.5 'curl -sk https://localhost:8080/api/robot-arm/status | python3 -m json.tool'

# Both services up
ssh pi@192.168.7.5 'sudo systemctl is-active smart-factory.service robotarmv3-pi.service'

# Live log stream
ssh pi@192.168.7.5 'sudo journalctl -u smart-factory.service -u robotarmv3-pi.service -f'

# Position-vs-target CSV (writes every 0.5s)
ssh pi@192.168.7.5 'tail -f /home/pi/sf2/logs/plc_vs_arm_positions.csv'
```

### Archived Dobot tests

The earlier `tests/pydobot/` and `tests/official_api/` directories targeted the Dobot Magician and are kept under [`archive/tests/`](archive/tests/) for reference.

---

## 🔧 Troubleshooting

### Dobot Not Connecting

**Problem:** Robot doesn't connect or shows as disconnected

**Solutions:**

```bash
# Check USB device exists
ls -la /dev/ttyACM*

# Check permissions (should include 'dialout')
groups

# If not in dialout group:
sudo usermod -a -G dialout $USER
newgrp dialout

# Try different device path in config.json
# Common paths: /dev/ttyACM0, /dev/ttyACM1, /dev/ttyUSB0
```

**Check config.json:**
- Make sure `dobot.port` matches your actual device
- Verify `baudrate` is set to `115200`

### Robot Not Moving

**Problem:** Robot connects but doesn't move when commanded

**Solution:** This was the main issue fixed! The robot needs alarms cleared on startup. The fixed code (`dobot_client.py`) now does this automatically. Make sure you're using the updated version.

**Verify fix is applied:**
- Check that `dobot_client.py` includes alarm clearing in the `connect()` method
- Historical Dobot fix notes (no longer in use; current arm is the ST3215) live in [`archive/docs/solutions/`](archive/docs/solutions/).

### PLC Not Connecting

**Problem:** PLC shows as disconnected

**Solutions:**

```bash
# Test network connection
ping 192.168.1.150

# Check PLC IP in config.json
# Make sure IP matches your PLC's actual IP address

# Verify Snap7 library is installed
ldconfig -p | grep snap7
```

**Check config.json:**
- Verify `plc.ip` matches your PLC's IP address
- Check `plc.rack` and `plc.slot` are correct (usually 0 and 1)

### Port Already in Use

**Problem:** Error "Address already in use" on port 8080

**Solutions:**

```bash
# Find process using port 8080
sudo lsof -ti:8080

# Kill the process
sudo lsof -ti:8080 | xargs -r sudo kill -9

# Or change port in config.json
# Set "server.port" to a different number (e.g., 8081)
```

### Import Errors

**Problem:** Python import errors when running app.py

**Solutions:**

```bash
# Make sure virtual environment is activated
source venv/bin/activate

# Reinstall requirements
pip install -r requirements.txt

# Check Python version (needs 3.7+)
python3 --version
```

### Permission Denied Errors

**Problem:** Permission errors accessing USB device

**Solutions:**

```bash
# Add user to dialout group
sudo usermod -a -G dialout $USER

# Log out and back in, or:
newgrp dialout

# Check device permissions
ls -la /dev/ttyACM*
```

---

## 🚀 Deployment

### Standard deployment

The production setup runs both services under systemd (see the [Autostart on Boot](#-autostart-on-boot) section above). The day-to-day deploy flow is:

```bash
# From your dev machine — push code, then SCP individual files / git pull on the Pi
git push origin main
ssh pi@192.168.7.5 'cd ~/sf2 && git pull && sudo systemctl restart smart-factory.service robotarmv3-pi.service'
```

### PM2 (alternative)

If you prefer PM2 over systemd for the Flask backend:

```bash
npm install -g pm2
cd ~/sf2/pwa-dobot-plc
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup  # Follow instructions to enable auto-start on boot
```

Earlier Dobot-era deployment scripts (`FINAL_DEPLOYMENT.sh`, `setup.sh`, `deploy_official_api.sh`, etc.) live in [`archive/scripts/deployment/`](archive/scripts/deployment/).

### Manual PM2 Setup

```bash
# Navigate to project
cd ~/sf2/pwa-dobot-plc

# Start with PM2
pm2 start deploy/ecosystem.config.js

# Save PM2 configuration
pm2 save

# Set PM2 to start on boot
pm2 startup
# Run the command it gives you (with sudo)

# Check status
pm2 status
pm2 logs pwa-dobot-plc
```

---

### 📡 Raspberry Pi Wi‑Fi Hotspot (Access Point)

This lets your **phone or tablet connect directly to the Raspberry Pi** (no extra router).  
The Pi creates its own Wi‑Fi network and serves the web app at `http://192.168.4.1:8080`.

#### 1. Run the hotspot setup script (one time on the Pi)

```bash
cd ~/sf2
chmod +x scripts/setup_wifi_access_point.sh
./scripts/setup_wifi_access_point.sh
sudo reboot
```

What this does:

- Installs `hostapd` and `dnsmasq`
- Configures Wi‑Fi access point:
  - **SSID**: `SmartFactory`
  - **Password**: `matrix123`
  - **Pi IP on Wi‑Fi**: `192.168.4.1`
- Enables services on boot:
  - `hostapd` (Wi‑Fi AP)
  - `dnsmasq` (DHCP)

#### 2. Check hotspot from the web app (simple frontend page)

Once your backend is running on the Pi:

- Open: `http://<your-pi-ip>:8080/hotspot-status.html`
- When you are already on the Pi hotspot, `<your-pi-ip>` will usually be `192.168.4.1`

This page calls `GET /api/hotspot/status` and shows:

- `hostapd` active or not
- `dnsmasq` active or not
- Whether `wlan0` has IP `192.168.4.1`
- How many devices are connected (DHCP leases)

If everything is green, phones should be able to:

- Join Wi‑Fi network **SmartFactory** (password **matrix123**)
- Open `http://192.168.4.1:8080` to use the Smart Factory app

#### 3. Optional: CLI diagnostics / fix scripts

From the Pi terminal:

```bash
cd ~/sf2
chmod +x scripts/check_wifi_ap.sh scripts/fix_wifi_ap.sh

# See detailed status:
./scripts/check_wifi_ap.sh

# Try to repair and restart the hotspot:
./scripts/fix_wifi_ap.sh
```

---

## 📹 Vision System API

### Live result

- **`GET /api/poe-vision/latest-result`** — JSON of the most recent backend detection cycle. Fields: `ok`, `dominant`, `confirmed_dominant`, `count`, `detections[]`, `streak`, `debounce_cycles`, `timestamp`. The frontend polls this every second.
- **`GET /api/poe-vision/annotated`** — JPEG of the most recent annotated frame (bounding boxes drawn).
- **`GET /api/poe-vision/status`** — model load status (`model_ready`, `model_path`, class names, candidate search paths).
- **`POST /api/poe-vision/detect`** — returns the cached result (no longer triggers inference; kept for backwards compat with the previous JS).

### Camera

- **`GET /api/poe-camera/status`** — `{configured, connected, ip}`
- **`GET /api/poe-camera/capture`** — cached raw JPEG from the backend loop. Used by the Capture Training Image button.
- **`GET /api/poe-camera/stream`** — proxied MJPEG stream from the M5Stack. Note: opening this counts against the camera's single-client HTTP slot, so the backend detection loop will see `camera_unreachable` while the stream is open.

### Raw PLC I/O

- **`GET /api/plc/io/read`** — snapshot of `%I0.0..%I1.5`, `%Q0.0..%Q1.1`, `%IW64`, `%IW66` decoded into named bits + ints, with friendly TIA-project names attached. Driven by `plc_worker._refresh_raw_io()` every 500 ms.

### PLC DBs

- **`GET /api/plc/db123/read` / `/api/plc/main/read`** — DB123 (process state)
- **`GET /api/plc/db124/read` / `/api/plc/camera/read`** — DB124 (vision result bits)
- **`GET /api/plc/db125/read` / `/api/plc/robot/read`** — DB125 (robot arm bridge)
- **`GET /api/plc/status`** — connection state

### Config

- **`GET /api/config`** — full backend config (`config.json` contents)
- **`POST /api/config`** — partial merge; the vision page uses this to persist slider changes (`{poe_camera: {class_conf: {...}}}`)

---

## 📋 PLC Memory Map

| DB | Purpose |
|----|---------|
| DB123 | Main process state — HMI bits, conveyors, gantry, pallet, counters |
| DB124 | Vision result bits (`yellow_cube_detected` 0.6, `purple_cube_detected` 0.7, `metal_cube_detected` 1.0, plus handshake bits) |
| DB125 | Robot arm bridge (status bytes 0–21, commands bytes 22–31) |
| DB126 | Edge device stats (CPU / mem / temp / uptime) |
| DB127 | IO-Link PLC telemetry |

**Raw I/O** (no DB needed — read directly from PE / PA areas):

| Address | Tag |
|---|---|
| `%I0.0`, `%I0.1` | EStop Channel 1, 2 |
| `%I0.2` | Blue Reset Button [NO] |
| `%I0.3` | Green Start Button [NO] |
| `%I0.4` | Red Stop Button [NC] |
| `%I0.5..%I0.7` | Light Sensor 1, 2, 3 |
| `%I1.0`, `%I1.1` | Inductive Proxy, Capacitive Proxy |
| `%I1.2`, `%I1.3` | Gantry Limit Switch Low, High |
| `%I1.4`, `%I1.5` | Quarantine Switch, Fault Override |
| `%IW64`, `%IW66` | AnalogIn_0, AnalogIn_1 |
| `%Q0.0`, `%Q0.1` | Stepper Pulse, Direction |
| `%Q0.2`, `%Q0.3` | Plunger Down, Up |
| `%Q0.4` | Pneumatic Vacuum |
| `%Q0.5`, `%Q0.6`, `%Q0.7` | Gate, Reject, Reset Linear Actuator |
| `%Q1.0`, `%Q1.1` | Conveyor 1, Conveyor 2 |

Full tag map for the DBs lives in `pwa-dobot-plc/DB123_MEMORY_MAP.md` and `pwa-dobot-plc/PLC_PLC_READ_WRITE_MAP.md`.

---

## 🎯 Key Solution

The main issue (Dobot not moving) was solved by adding **automatic alarm clearing** to the initialization sequence. When the robot starts up, it may have alarms from previous sessions. These alarms prevent movement commands from working. The fix clears all alarms automatically when connecting.

**Historical Dobot fix details live in [`archive/docs/solutions/`](archive/docs/solutions/) — the Dobot Magician is no longer the active arm.**

---

## 📞 Support

### Quick Help

- **Connection issues:** See [Troubleshooting](#-troubleshooting) section above
- **Robot arm latency / behaviour:** See [Recent: Robot Arm Latency Overhaul (2026-05-20)](#-recent-robot-arm-latency-overhaul-2026-05-20)
- **Deployment:** See the [Deployment](#-deployment) section above

### Documentation Resources

- **[Deployment Guide](docs/guides/DEPLOY_TO_PI.md)** - Setup instructions
- **[J5 wrist-pitch bus corruption](docs/J5_WRIST_PITCH_BUS_CORRUPTION.md)** - ST3215 bus diagnosis
- **[robotarmv3-pi-service README](pwa-dobot-plc/robotarmv3-pi-service/README.md)** - Arm bridge internals
- **[archive/](archive/)** - Historic notes (Dobot fix, frontend cleanup plans, etc.)

### Common Questions

**Q: Why isn't my robot moving?**  
A: Make sure alarms are being cleared. Check that you're using the updated `dobot_client.py` with alarm clearing enabled.

**Q: How do I find my Dobot USB device?**  
A: Run `ls -la /dev/ttyACM*` and check which device appears when you plug/unplug the robot.

**Q: Can I use this without a PLC?**  
A: Yes! The web interface allows manual control without PLC integration.

**Q: How do I update the code?**  
A: Pull latest changes with `git pull origin main` and restart the application.

---

## 📊 Project Status

✅ **WORKING** - Dobot movement issue resolved with alarm clearing  
✅ **TESTED** - All core functionality verified  
✅ **DEPLOYED** - Production-ready on Raspberry Pi  
✅ **ORGANIZED** - Clean project structure for maintainability  
✅ **DOCUMENTED** - Comprehensive documentation available  
✅ **PoE CAMERA** - M5Stack PoE CAM-W on 192.168.7.6, firmware v1.1.0 (ETH.h)

---

## 📝 License

MIT License - Feel free to use and modify!

---

## 🙏 Credits

- **Flask** - Web framework and API/stream hosting
- **python-snap7** - PLC communication library
- **pydobot** - Dobot robot control library
- **OpenCV** - Camera and vision support

---

**Last Updated:** 2026-06-04
**Status:** Production Ready ✅
