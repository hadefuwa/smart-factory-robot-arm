---
name: RobotArmv3 Web Migration
overview: Migrate robot-arm control from the external RobotArmv3 repo into your existing web app without Electron by running a separate Node service on Raspberry Pi and integrating a new web frontend page.
todos:
  - id: split-pages
    content: Clone existing robot page to dobot and retarget nav/routes safely.
    status: pending
  - id: extract-protocol
    content: Extract RobotArmv3 command/status protocol into a simple integration contract.
    status: pending
  - id: build-backend-bridge
    content: Add Flask proxy endpoints for connect/move/stop/status to Pi Node service.
    status: pending
  - id: create-new-robot-page
    content: Implement beginner-friendly new robot-arm UI + JS using bridge endpoints.
    status: pending
  - id: pi-setup-docs
    content: Add reproducible Raspberry Pi setup and service instructions.
    status: pending
  - id: verify-end-to-end
    content: Run manual E2E tests and lint checks; keep dobot page as fallback.
    status: pending
isProject: false
---

# RobotArmv3 Web-Only Integration Plan

## Goal

Keep your project web-based, rename current robot page to `dobot.html`, and build a new `robot-arm.html` in your app that talks to a Raspberry Pi Node service (RobotArmv3-style control logic) without introducing Electron.

## Confirmed Architecture

- Frontend in your current app (`pwa-dobot-plc/frontend`) remains the UI.
- Raspberry Pi runs a separate Node service (RobotArmv3 communication model).
- New web page calls your existing backend API or a small proxy layer, not Electron UI.

```mermaid
flowchart LR
webUI[WebUI robot-arm.html] --> flaskAPI[FlaskBackend app.py]
flaskAPI --> bridgeAPI[RobotArmBridge API routes]
bridgeAPI --> piNode[PiNodeService server.js]
piNode --> i2cBus[I2CBus]
i2cBus --> jointCtrls[JointControllers]
```

## Docs-Verified Assumptions (RobotArmv3)

- Raspberry Pi should run the Node control server (`server.js`), while the UI runs on your desktop/web app; Electron is optional and not required for robot control.
- The expected control transport is WebSocket (`ws`) from UI layer to Pi server (default port `8080`), with Pi handling I2C communication to joint controllers.
- For your beginner-friendly requirement, custom Node.js service is preferred over ROS due to lower complexity and easier debugging.
- We will reuse RobotArmv3 control ideas/modules — specifically adapting `electron-app/robotArmClient.js` as a plain browser JS module — but not copy Electron shell/process code.
- Pi setup checklist in this plan follows their documented flow: enable I2C, install Node.js v18+, set joint addresses, test with `i2cdetect`, run as process/service.

## Pi Server Code: Source of Truth

The `raspberry-pi-control/` folder from RobotArmv3 is copied into this repo at:

```
pwa-dobot-plc/robotarmv3-pi-service/
├── server.js          # WebSocket server entry point
├── robotArmI2C.js     # I2C communication logic
├── test-i2c.js        # I2C debug utility
└── package.json       # dependencies: i2c-bus, ws
```

This folder is the single source of truth for the Pi server. It is versioned in this repo and deployed to the Pi via SCP or git clone. Do not maintain a separate copy outside this folder.

## Transport Decision: MVP Locked

**MVP uses Flask REST proxy + polling only.** Direct WebSocket and SSE are deferred to a later phase.

| Layer | Transport | Notes |
|---|---|---|
| Browser → Flask | HTTP REST | All commands and status via Flask endpoints |
| Flask → Pi | WebSocket (port 8080) | Flask backend holds the persistent WS connection to Pi |
| Status updates | Frontend polls `GET /api/robot-arm/status` every 500ms | Simple, no browser WS needed for MVP |

SSE and direct browser WebSocket are documented in Phase 2.5 (post-MVP) below.

---

## Phase 1: Safe file/page split in current app

- Duplicate current page:
  - `pwa-dobot-plc/frontend/robot-arm.html` -> `pwa-dobot-plc/frontend/dobot.html`.
- Update navigation + route references so existing behavior continues to work from `dobot.html`:
  - `pwa-dobot-plc/frontend/assets/js/app-shell.js`
  - `pwa-dobot-plc/frontend/index.html`
  - `pwa-dobot-plc/frontend/vision-system.html`
  - `pwa-dobot-plc/frontend/hotspot-status.html`
  - `pwa-dobot-plc/frontend/io-link.html`
  - `pwa-dobot-plc/frontend/vision-system-new.html`
  - `pwa-dobot-plc/frontend/color-voting-test.html`
  - `pwa-dobot-plc/frontend/edge-device-stats.html`
  - `pwa-dobot-plc/frontend/plc-diagnostics.html`
  - `pwa-dobot-plc/frontend/rfid.html`
  - `pwa-dobot-plc/frontend/assets/js/dashboard-v2.js`
- Create a fresh `pwa-dobot-plc/frontend/robot-arm.html` as the new RobotArmv3-based page shell.

## Phase 2: Import RobotArmv3 control model (not Electron UI)

- Pull only relevant logic from RobotArmv3. The primary file to adapt is:
  - **`electron-app/robotArmClient.js`** — WebSocket client wrapping all protocol logic (connect, move, stop, status). Strip Electron-specific imports and convert to a plain browser ES module.
  - `pwa-dobot-plc/robotarmv3-pi-service/server.js` — versioned Pi service in this repo; deploy this folder to the Pi host.
  - Do not copy `electron-app` UI as-is, and do not copy `gcodeProcessor.js` or `kinematics.js` (G-code and kinematics are out of scope for MVP).
- Add a local project folder for integration code and docs:
  - `pwa-dobot-plc/robotarmv3-pi-service/` — versioned copy of the Pi server (see "Pi Server Code: Source of Truth" above)
  - `docs/guides/robotarmv3-integration.md`
  - Flask proxy routes live in `pwa-dobot-plc/backend/app.py` only — no separate bridge folder.
- Standardise a minimal command/status contract for frontend usage (derived from `robotArmClient.js`):
  - connect/disconnect
  - joint move command (joint index + angle + speed)
  - emergency stop
  - status polling/stream (joint angles, connection state)

## Phase 3: Backend bridge for web app compatibility

- Add simple Flask endpoints in `pwa-dobot-plc/backend/app.py` that proxy to the Pi Node service:
  - `POST /api/robot-arm/connect`
  - `POST /api/robot-arm/disconnect`
  - `POST /api/robot-arm/move`
  - `POST /api/robot-arm/stop`
  - `GET /api/robot-arm/status`
- Keep payloads straightforward JSON (no advanced abstractions).
- Add basic timeout + error messages so frontend always gets clear responses.
- **Status updates (MVP):** Frontend polls `GET /api/robot-arm/status` every 500ms. No SSE or direct WebSocket in MVP — see Phase 2.5 for upgrade path.

## Phase 4: Build new `robot-arm.html` page

- Create simple sections:
  - connection panel (Pi host/port + connect button; default host `robot-arm.local`, port `8080`)
  - manual joint controls (angle/speed per joint)
  - live status area
  - safety stop button
- Keep JS in a dedicated file (recommended):
  - `pwa-dobot-plc/frontend/assets/js/robot-arm-v3-page.js`
- Reuse your existing style system from:
  - `pwa-dobot-plc/frontend/assets/css/professional-theme.css`
- Ensure offline/local dependency behavior stays unchanged (no cloud dependencies).
- G-code processing and 3D visualisation are out of scope for this page (MVP only).

## Phase 5: Raspberry Pi deployment workflow

Exact commands from the RobotArmv3 setup guide:

### 1. Enable I2C
```bash
sudo raspi-config
# Interface Options → I2C → Enable
sudo reboot
```

### 2. Set hostname + mDNS (optional but recommended)
```bash
sudo hostnamectl set-hostname robot-arm
sudo apt update && sudo apt install -y avahi-daemon
sudo systemctl enable avahi-daemon
```
Pi will be reachable as `robot-arm.local` without needing a static IP. On Windows, install Apple Bonjour Print Services if `.local` resolution fails.

### 3. Install Node.js v18+
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # should show v18.x or higher
```

### 4. Transfer and install server
```bash
# Copy pwa-dobot-plc/robotarmv3-pi-service/ to Pi (SCP, USB, or git clone)
cd ~/robotarmv3-pi-service
npm install  # installs i2c-bus and ws
```

### 5. Configure I2C addresses
```bash
nano server.js  # update around line 34
```
Default addresses (one per joint):
```javascript
const addresses = [0x22, 0x23, 0x24, 0x25];
```
Adjust to match your physical PIC controllers.

### 6. Test I2C connection
```bash
sudo i2cdetect -y 1
```
Confirm joint controller addresses appear in the output grid.

### 7. Start the server (must use `sudo` for I2C access)
```bash
sudo node server.js
# or
sudo npm run server
```
Expected output:
```
Initializing joint controllers...
Joint 1 initialized at address 0x22
...
Server listening on port 8080
Waiting for clients to connect...
```

### 8. Run as systemd service (recommended for production)

**Preferred:** add the `pi` user to the `i2c` group so the service does not need to run as root:
```bash
sudo usermod -a -G i2c pi
# log out and back in (or reboot) for the group change to take effect
```

Create `/etc/systemd/system/robot-arm-server.service`:
```ini
[Unit]
Description=Robot Arm WebSocket Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/robotarmv3-pi-service
ExecStart=/usr/bin/node /home/pi/robotarmv3-pi-service/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

If I2C permission errors persist after adding the group, fall back to `User=root` as a temporary measure while diagnosing.
```bash
sudo systemctl daemon-reload
sudo systemctl enable robot-arm-server.service
sudo systemctl start robot-arm-server.service
sudo systemctl status robot-arm-server.service
```

### 9. Open firewall port (if needed)
```bash
sudo ufw allow 8080
```

## Phase 2.5: Post-MVP — Real-time Status Upgrade (deferred)

Do not start this phase until MVP (Phases 1–6) is working end-to-end.

Options in priority order:
1. **SSE (`GET /api/robot-arm/status/stream`)** — Flask streams events to the browser; minimal browser changes, no WebSocket needed.
2. **Direct browser WebSocket to Pi:8080** — lowest latency, but browser must reach the Pi directly; requires `sudo ufw allow 8080` on Pi and CORS is irrelevant for WS.

Choose one, implement, then remove the polling loop from `robot-arm-v3-page.js`.

## Phase 6: Validation checklist

- Verify old functionality remains accessible via `dobot.html`.
- Verify new `robot-arm.html` can:
  - connect to Pi service
  - move at least one joint
  - receive live status
  - stop safely
- Verify nav links and app-shell active states are correct.
- Run lint checks for edited frontend/backend files and fix introduced issues.

## Implementation Notes (from current codebase)

- Current robot page is tied into app-shell/nav and references `pwa-dobot-plc/frontend/assets/js/robot-arm-page.js`, so rename requires coordinated nav updates.
- Current Flask app serves frontend as static files via catch-all, so adding/renaming HTML pages is straightforward once links are updated.

## Risks and Mitigation

- Protocol mismatch between your current robot API and RobotArmv3 commands:
  - Mitigate with a small bridge contract in Flask before UI wiring.
- Hardware/I2C address mismatch on Pi:
  - Mitigate by running `sudo i2cdetect -y 1` and confirming addresses before UI testing.
- Flask HTTP proxy latency for real-time control:
  - Acceptable for MVP with 500ms polling. Upgrade to SSE or direct WebSocket in Phase 2.5 if latency is noticeable.
- `sudo` requirement for I2C access on Pi:
  - Preferred fix: add `pi` to the `i2c` group and run service as `User=pi`. Fall back to `User=root` only if group permissions do not resolve in time.
- Large one-shot UI port risk:
  - Mitigate by shipping in two pages (`dobot.html` stable + new `robot-arm.html` incremental).
