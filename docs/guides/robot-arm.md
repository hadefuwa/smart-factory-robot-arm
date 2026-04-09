# Robot Arm — Smart Factory Integration Guide

Last updated: 2026-04-09  
Status: **Working** — joints 1–5 operational, joint 6 hardware not yet wired

---

## Overview

The robot arm uses **Feetech ST3215 serial bus servos** driven by a **Waveshare SC-B1 USB driver board**, connected to the Raspberry Pi that hosts the Smart Factory web app. Control flows from the browser through Flask to a Node.js WebSocket service that owns the serial bus.

---

## Architecture

```
Browser (robot-arm.html)
    │  HTTP fetch /api/robot-arm/*  (500ms poll for status)
    ▼
Flask app.py  —  port 8080 HTTPS
    │  WebSocket  ws://localhost:8090
    ▼
Node.js server.js  —  port 8090
    │  Serial 1 Mbps
    ▼
Waveshare SC-B1  —  /dev/ttyACM0  (USB CDC-ACM)
    │  internal forwarding at 1 Mbps
    ▼
ST3215 servo bus  —  IDs 1–5 daisy-chained
```

The browser never talks to Node.js directly. Flask holds the persistent WebSocket connection and acts as a proxy for all commands.

---

## Hardware

### Waveshare SC-B1 Driver Board

- Appears on the Pi as **`/dev/ttyACM0`** (USB CDC-ACM class — NOT ttyUSB/FTDI).
- Operates as a serial forwarder: the Pi sends ST3215 packets at 1 Mbps; the SC-B1 forwards them to the servo bus at 1 Mbps.
- **Session timeout**: the SC-B1 stops forwarding approximately 6 seconds after the serial port is first opened. The Node.js service handles this by closing and reopening the port every 5.2 seconds (`maybeReopenPort()` in `server.js`).
- **Keep-alive**: a PING packet is queued every ~1 second when the bus is idle, to keep the SC-B1 session active between renewals.
- The SC-B1 has a **separate 7.4V power connector** for the servo bus. If servos don't respond, check this connector first.

### ST3215 Servos

- Protocol: Feetech STS3215 half-duplex UART — packets start with `0xFF 0xFF`.
- **Status Return Level = 0** (factory default): write commands receive no ACK. `writeData()` in the driver uses fire-and-forget with an 8ms drain delay.
- Position register: address `0x38` (56 decimal), 2 bytes, little-endian.
- Position range: 0–4095 steps. Center = 2048 (0°).
- Angle conversion: `angleDegrees = (position - 2048) / (2048 / 180)`
- Servo IDs 1–5 are active. Servo ID 6 is not yet physically connected.

#### Torque Enable (register 40)

`TORQUE_ENABLE = 1` powers the motor and commands it to hold its **last written goal position** — it does not automatically hold the current physical position. If the arm has been moved by hand while torque was off, enabling torque naively will cause the servo to snap toward the stale goal angle.

The correct hold sequence (implemented in `holdCurrentPosition()`):
1. Read the present position register.
2. Write that position back as the goal.
3. Enable torque.

This locks the joint exactly where it sits without any movement. The **Torque On** button in the UI calls `holdAllJoints`, which does this for all joints simultaneously.

---

## Services on the Pi

Both services run on the Raspberry Pi (`pi@rpi`).

| Service | Process manager | Port | Config file |
|---------|----------------|------|-------------|
| Flask (`app.py`) | **systemd** (`smart-factory.service`) | 8080 HTTPS | `/etc/systemd/system/smart-factory.service` |
| Node.js (`server.js`) | **systemd** (`robotarmv3-pi.service`) | 8090 WS | `/etc/systemd/system/robotarmv3-pi.service` |

**Important:** Flask must only be managed by systemd. PM2 must not manage Flask. If PM2 has a `pwa-dobot-plc` entry, it will crash-loop (port 8080 already in use) and its repeated Dobot client startup calls will corrupt the SC-B1 serial session, putting all joints offline. See the [Crash Loop](#7-pm2-crash-loop-all-joints-go-offline-discovered-2026-04-09) troubleshooting entry.

### systemd service for Node.js (`/etc/systemd/system/robotarmv3-pi.service`)

```ini
[Unit]
Description=RobotArmv3 Pi WebSocket Service
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/sf2/pwa-dobot-plc/robotarmv3-pi-service
Environment=ROBOT_ARM_PORT=8090
ExecStart=/usr/bin/node /home/pi/sf2/pwa-dobot-plc/robotarmv3-pi-service/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Useful service commands

```bash
# Node.js robot arm service
sudo systemctl status robotarmv3-pi.service
sudo systemctl restart robotarmv3-pi.service
sudo journalctl -u robotarmv3-pi.service -n 50 -f

# Flask app
sudo systemctl status smart-factory.service
sudo systemctl restart smart-factory.service

# Check what is on each port
ss -tlnp | grep -E '8080|8090'
```

---

## Startup Sequence

On boot:

1. Systemd starts `robotarmv3-pi.service` → Node.js loads the URDF, opens `/dev/ttyACM0`, pings servos 1–6, initialises whichever respond.
2. Systemd starts `smart-factory.service` → Flask starts on port 8080. A background thread (3s delay) calls `open_robot_arm_bridge('localhost', 8090)` to connect the WebSocket bridge.
3. Browser opens `robot-arm.html` → JS polls `/api/robot-arm/status` every 500ms.

If Flask restarts, the bridge auto-reconnects. If Node.js restarts, the Flask bridge connection dies and Flask will return 503 until the bridge is manually reconnected or Flask also restarts.

---

## Inverse Kinematics

The arm supports Cartesian XYZ control via a numeric Jacobian-transpose IK solver ported from BenMatrixTSL's Electron app (same physical arm).

### Files

| File | Purpose |
|------|---------|
| `pwa-dobot-plc/robotarmv3-pi-service/kinematics.js` | IK solver (`RobotKinematics` class). Sourced from BenMatrixTSL/RobotArmv3. |
| `pwa-dobot-plc/robotarmv3-pi-service/urdfParser.js` | URDF XML parser. Sourced from BenMatrixTSL/RobotArmv3. |
| `pwa-dobot-plc/robotarmv3-pi-service/demo-kinematics.urdf` | Arm geometry (link lengths, joint limits, axis definitions). |

### Arm Geometry (from URDF)

| Segment | Length |
|---------|--------|
| Base height (floor → J1) | 122 mm |
| Upper arm (J2 → J3) | 161.78 mm |
| Forearm (J3 → J4) | 148.20 mm |
| Wrist (J4 → J5) | 30 mm |
| Tool offset (J5 → tip) | 42 mm |
| **Approximate max reach** | **~529 mm** |

Joint 2 (shoulder pitch) has `zero_offset_degrees="-90"` — when the app commands 0°, the physical joint sits at -90° from the URDF zero. This is applied automatically by `kinematics.js`.

### Algorithm

Numeric Jacobian-transpose iterative solver:
- Runs up to 400 iterations with adaptive step sizing.
- Convergence threshold: 1–10 mm XYZ error.
- Returns `null` if the pose is unreachable or outside the workspace (~529 mm radius).
- Geometry is loaded from `demo-kinematics.urdf` once at Node.js startup.

### Node.js Dependencies

`@xmldom/xmldom` is required (added to `package.json`) to run the URDF parser in Node.js — `DOMParser` is a browser-only API not present in Node.

```bash
# On the Pi, after pulling new code:
cd ~/sf2/pwa-dobot-plc/robotarmv3-pi-service && npm install
```

---

## Codebase Files

| File | Purpose |
|------|---------|
| `pwa-dobot-plc/robotarmv3-pi-service/server.js` | Node.js WebSocket server. Owns the serial port, command queue, `maybeReopenPort()`, keep-alive, FK/IK integration, and all command handlers. |
| `pwa-dobot-plc/robotarmv3-pi-service/robotArmST3215.js` | ST3215 servo driver. Packet encoding/decoding, ping, readData, writeData, readQuickStatus, `holdCurrentPosition()`. |
| `pwa-dobot-plc/robotarmv3-pi-service/kinematics.js` | Numeric Jacobian-transpose IK solver (`RobotKinematics` class). Sourced from BenMatrixTSL/RobotArmv3. |
| `pwa-dobot-plc/robotarmv3-pi-service/urdfParser.js` | URDF XML parser. Sourced from BenMatrixTSL/RobotArmv3. |
| `pwa-dobot-plc/robotarmv3-pi-service/demo-kinematics.urdf` | Arm geometry (link lengths, joint axes, limits). |
| `pwa-dobot-plc/backend/app.py` | Flask app. Robot arm bridge state, `open_robot_arm_bridge()`, `send_robot_arm_command()`, all `/api/robot-arm/*` endpoints, auto-connect startup thread. |
| `pwa-dobot-plc/frontend/robot-arm.html` | Browser UI — 4 tabs: Joint Control (includes XYZ section), Live Status, Settings, Debug. |
| `pwa-dobot-plc/frontend/assets/js/robot-arm-v3-page.js` | Frontend JS — status polling, joint card rendering, XYZ readout, PLC DB125 variable display, all button event handlers. |

---

## Flask API Endpoints

All endpoints are relative to the Flask base URL (e.g. `https://<pi-ip>:8080`).

| Method | URL | Body / notes |
|--------|-----|--------------|
| `GET` | `/api/robot-arm/status` | Returns bridge state and live joint status (including `currentXYZ`) |
| `POST` | `/api/robot-arm/connect` | `{"host":"localhost","port":8090}` — opens WS bridge |
| `POST` | `/api/robot-arm/disconnect` | Closes WS bridge |
| `POST` | `/api/robot-arm/move` | `{"joint":1,"angle":45.0,"speed":1500}` — move one joint by angle |
| `POST` | `/api/robot-arm/move-xyz` | `{"x":300,"y":0,"z":250,"speed":1500}` — IK then move all joints |
| `POST` | `/api/robot-arm/stop` | Stops all joints (disables torque) |
| `POST` | `/api/robot-arm/command` | Generic passthrough — body is any WS command + optional `"_recvTimeout":N` (seconds) |
| `POST` | `/api/robot-arm/scan` | `{"maxId":6}` — scan servo bus for responding IDs |

The passthrough endpoint lets you send any Node.js WebSocket command directly from the browser without a dedicated Flask route.

---

## Node.js WebSocket Command Reference

WebSocket URL (internal, not browser-accessible): `ws://localhost:8090`

### getStatus
```json
{ "command": "getStatus" }
```
Response includes live joint data and the current end-effector XYZ position computed via forward kinematics:
```json
{
  "type": "status",
  "joints": [
    {
      "joint": 1,
      "available": true,
      "angleDegrees": -27.4,
      "position": 1736,
      "stepPosition": 1736,
      "speed": 0,
      "load": 0,
      "voltage": 7.4,
      "temperature": 35,
      "isMoving": false,
      "torqueEnabled": true
    }
  ],
  "currentXYZ": { "x": 305.1, "y": 1.4, "z": -21.4 }
}
```
`available: false` means the servo did not respond to its initial ping at startup.  
`currentXYZ` is `null` if fewer than 5 joints are available (FK cannot be computed).

### moveJoint
```json
{ "command": "moveJoint", "joint": 1, "angle": 45.0, "speed": 1500 }
```
Speed range: 0–3400 steps/s. Angle range: -180–180°.

### moveToXYZ
```json
{ "command": "moveToXYZ", "x": 300, "y": 0, "z": 250, "speed": 1500 }
```
Runs inverse kinematics then issues `moveToAngle` for all joints. `speed` is optional (default 1500 steps/s). `orientation` is an optional tool direction vector `{"x":0,"y":0,"z":-1}`.

Response on success:
```json
{ "type": "moving", "angles": [0.0, 30.8, -56.1, -0.0, 14.4], "x": 300, "y": 0, "z": 250 }
```
Response if unreachable:
```json
{ "type": "error", "message": "moveToXYZ: position unreachable" }
```

### inverseKinematics (IK only, no movement)
```json
{ "command": "inverseKinematics", "x": 300, "y": 0, "z": 250 }
```
Returns the computed joint angles without moving the arm. Useful for validating a target before committing.

Response:
```json
{ "type": "ikResult", "angles": [0.0, 30.8, -56.1, -0.0, 14.4] }
```

### holdAllJoints
```json
{ "command": "holdAllJoints" }
```
Reads the present position of each joint and writes it back as the goal position, then enables torque. Joints lock in place at exactly where they are — no snapping to a stale commanded angle. This is what the **Torque On** button calls.

Response:
```json
{
  "type": "success",
  "message": "Holding all joints at current position",
  "results": [
    { "joint": 1, "held": true },
    { "joint": 2, "held": true }
  ]
}
```

### holdJoint
```json
{ "command": "holdJoint", "joint": 1 }
```
Same as `holdAllJoints` but for a single joint.

### stopJoint / stopAllJoints
```json
{ "command": "stopJoint", "joint": 1 }
{ "command": "stopAllJoints" }
```
Disables torque — joint becomes free to move by hand.

### setSpeed / setAcceleration
```json
{ "command": "setSpeed", "joint": 1, "speed": 2000 }
{ "command": "setAcceleration", "joint": 1, "acceleration": 100 }
```
Acceleration range: 0–254 (units: 100 step/s²).

### homeAll
```json
{ "command": "homeAll" }
```
Moves all initialised joints to 0°.

### rawPing
```json
{ "command": "rawPing", "id": 1 }
```
Sends a PING packet to a servo ID. `responded: true` means the servo is reachable on the bus.

### readRegister
```json
{ "command": "readRegister", "id": 1, "register": 56, "length": 2 }
```
Reads raw bytes from a servo register. Register 56 (0x38) = present position, 2 bytes LE.

### scanServos
```json
{ "command": "scanServos", "maxId": 6, "baudRates": [1000000], "timeout": 100, "_recvTimeout": 15 }
```
Quick scan tests IDs 1–6. Full scan tests all 253 IDs (set `maxId: 253`, `_recvTimeout: 180`).

### Debug commands
```json
{ "command": "echo" }
{ "command": "getPortInfo" }
{ "command": "getLogs", "count": 60 }
{ "command": "setDebug", "enabled": true }
```
All accessible from the Debug tab in the UI.

---

## Root Causes Found and Fixed

A record of every problem that was diagnosed and resolved during integration.

### 1. Wrong serial port

The SC-B1 is a USB CDC-ACM device, not an FTDI chip. It appears as `/dev/ttyACM0`, not `/dev/ttyUSB*`. The serial port path in `server.js` was corrected.

### 2. Port conflict between Node.js and Flask

Node.js defaulted to port 8080, which clashed with Flask. Fixed by reading `ROBOT_ARM_PORT` from the environment (default 8090 in the systemd service file).

### 3. Write timeouts blocking commands

`writeData()` was waiting for an ACK that ST3215 servos never send (Status Return Level = 0). Changed to fire-and-forget with an 8ms drain delay.

### 4. SC-B1 6-second session timeout

The SC-B1 stops forwarding servo packets ~6 seconds after the serial port is opened. Fixed with:
- `maybeReopenPort()` — closes and reopens the port every 5.2 seconds, called before every queued command.
- A keep-alive PING routed through `queueCommand()` every ~1 second when the bus is idle.

### 5. Keep-alive racing with reads

An early implementation sent keep-alive pings outside the command queue, racing with concurrent reads and corrupting the serial bus. Fixed by routing keep-alives through `queueCommand()`.

### 6. Bridge not auto-connecting after Flask restart

After Flask restarts, the WebSocket bridge to Node.js was not established until the user manually clicked Connect. Fixed with a 3-second deferred startup thread in `app.py` that calls `open_robot_arm_bridge('localhost', 8090)`.

### 7. PM2 crash loop killing all joints (discovered 2026-04-09)

**Symptom:** All 6 joints show `available: false` and `angle: 0` despite servos responding to a scan.

**Cause:** PM2 had a saved `pwa-dobot-plc` entry that also tried to start Flask. Since systemd already had Flask running on port 8080, the PM2 instance failed immediately, and PM2 restarted it in a tight loop (376 restarts in ~40 minutes). Each restart attempt called `dobot_client.connect()`, which briefly opened `/dev/ttyACM0`. This serial bus disruption occurred during the Node.js startup window when `initializeServos()` was pinging servos, causing all pings to fail. With all pings failing, all servo slots were initialised as `null` (offline) and stayed that way.

**Fix:**
1. `pm2 stop pwa-dobot-plc && pm2 delete pwa-dobot-plc && pm2 save` — remove Flask from PM2 permanently.
2. `sudo systemctl restart robotarmv3-pi.service` — restart Node.js so `initializeServos()` runs cleanly.
3. `POST /api/robot-arm/connect {"host":"localhost","port":8090}` — re-establish the Flask bridge.

**Prevention:** Flask must only be managed by systemd (`smart-factory.service`). Never re-add it to PM2.

### 8. Torque On snapping joints to stale angle

**Symptom:** Pressing Torque On causes joints to jerk to an unexpected position.

**Cause:** `TORQUE_ENABLE = 1` commands the servo to reach its last written goal position, not its current physical position. If the arm was moved by hand while torque was off, the stale goal is now different from where the joint sits.

**Fix:** `holdCurrentPosition()` in `robotArmST3215.js` reads the present position register and writes it back as the goal before enabling torque. The **Torque On** button now calls `holdAllJoints` which does this for all joints.

---

## Troubleshooting

### All joints offline / status returns `available: false`

1. Check for PM2 crash loop: `pm2 list`. If `pwa-dobot-plc` appears, delete it.
2. Check Node.js service: `sudo systemctl status robotarmv3-pi.service`.
3. Restart Node.js and reconnect the bridge:
   ```bash
   sudo systemctl restart robotarmv3-pi.service
   sleep 6
   curl -sk https://localhost:8080/api/robot-arm/connect \
     -X POST -H 'Content-Type: application/json' \
     -d '{"host":"localhost","port":8090}'
   ```
4. Run Quick Scan from the Settings tab to confirm servos are reachable on the bus.

### Robot shows Offline / 503 on status

Flask bridge not connected to Node.js.
- Check Node.js is running: `sudo systemctl status robotarmv3-pi.service`
- Manually connect via Settings tab or:
  ```bash
  curl -sk https://localhost:8080/api/robot-arm/connect \
    -X POST -H 'Content-Type: application/json' \
    -d '{"host":"localhost","port":8090}'
  ```

### Torque On causes joints to jerk or snap

The stale goal position in the servo doesn't match the current physical position. Use the **Torque On** button (which now calls `holdAllJoints`) rather than sending `startServo` directly. If calling the WS API manually, use `holdAllJoints` instead of `startServo`.

### IK returns unreachable / move-xyz returns 400

- The target XYZ is outside the arm's workspace (~529 mm radius from base origin).
- Z must be above the base plane — very low Z values are mechanically unreachable.
- Try a position closer to the centre of the workspace (e.g. `x=250, y=0, z=200`).

### Read timeouts (READ TIMEOUT in logs)

SC-B1 session expired mid-command. This should be handled automatically. If persistent:
- Check `getLogs` debug command for `PORT SESSION` entries — renewals should appear every ~5 seconds.
- Restart the Node.js service.

### Servo not responding to ping during init

- Check the SC-B1 7.4V servo power connector.
- Run Quick Scan from Settings tab to test servos outside the init window.
- If a servo responds to scan but was offline at init, restart the Node.js service.

### Serial port locked (EBUSY / EADDRINUSE)

```bash
sudo fuser /dev/ttyACM0
sudo kill <PID>
sudo systemctl restart robotarmv3-pi.service
```

### Dobot client logs errors about `/dev/ttyACM0`

The Dobot client in Flask tries to connect to `/dev/ttyACM0` at startup. This is expected to fail because the robot arm owns that port. The Dobot errors are harmless as long as the crash loop is not active.

---

## Deployment (updating the Pi)

The Pi pulls code from the same git repo. After pushing changes from your workstation:

```bash
ssh pi@rpi "cd ~/sf2 && git pull"
```

To restart both services after a code update:

```bash
ssh pi@rpi "sudo systemctl restart robotarmv3-pi.service && sudo systemctl restart smart-factory.service"
```

Node.js dependencies (only needed if `package.json` changes, e.g. when `@xmldom/xmldom` was added):

```bash
ssh pi@rpi "cd ~/sf2/pwa-dobot-plc/robotarmv3-pi-service && npm install"
```
