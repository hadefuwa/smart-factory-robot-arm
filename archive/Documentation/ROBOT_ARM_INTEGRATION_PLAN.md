# Robot Arm (ST3215) Integration Plan

## Overview

Connect the Robot Arm Raspberry Pi (running the ST3215 WebSocket server) to the main Pi (running the Flask backend), then expose joint data and control to the Siemens PLC via snap7.

```
[Robot Arm Pi]          [Main Pi]              [Siemens PLC]
 Node.js WS Server  -->  Python WS Client  -->  snap7 / DB
 port 8080               in app.py              192.168.7.2
 (ST3215 servos)         (bridge layer)         DB123 / DB125
```

---

## Prerequisites

### Find the Robot Arm Pi's IP

SSH in from the main Pi:
```bash
ssh ben@<robot-arm-pi-ip>
# Password: robotarm123
```

Or scan the local subnet:
```bash
nmap -sn 192.168.x.0/24   # replace with your subnet
```

Once found, note it — you'll set it in `config.json`.

### Confirm the ST3215 server is running on the Robot Arm Pi

```bash
ssh ben@<robot-arm-pi-ip>
cd ~/raspberry-pi-control-st3215   # or wherever it lives
node server.js
```

The server should log: `WebSocket server running on port 8080`

---

## Step 1 — Add a Python WebSocket Client (`robot_arm_client.py`)

Create `pwa-dobot-plc/backend/robot_arm_client.py`.

This module:
- Connects to the Robot Arm Pi's WebSocket server
- Sends commands (moveJoint, getStatus, stopAllJoints, etc.)
- Receives status updates and keeps a thread-safe local cache of joint states
- Reconnects automatically if the connection drops

### Key class: `RobotArmClient`

```python
import asyncio, threading, json, logging
import websockets

class RobotArmClient:
    def __init__(self, uri):
        self.uri = uri            # e.g. "ws://192.168.x.y:8080"
        self._cache = {}          # latest joint status keyed by joint id
        self._lock = threading.Lock()
        self._ws = None
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def get_status(self):
        with self._lock:
            return dict(self._cache)

    def send_command(self, payload: dict):
        asyncio.run_coroutine_threadsafe(self._send(json.dumps(payload)), self._loop)

    # async internals: connect, receive loop, auto-reconnect
```

**Install dependency:**
```bash
pip install websockets
```

Add `websockets` to `requirements.txt`.

---

## Step 2 — Add Config Entry

In `pwa-dobot-plc/backend/config.json`, add a new top-level key:

```json
"robot_arm": {
  "enabled": true,
  "host": "192.168.x.y",
  "port": 8080,
  "reconnect_interval_s": 5
}
```

Replace `192.168.x.y` with the actual Robot Arm Pi IP.

---

## Step 3 — Add PLC Data Block for Robot Arm (DB125)

Create a new DB in the PLC program for robot arm joint data.

### Suggested DB125 Layout (per joint × 6 joints = ~48 bytes)

| Offset | Type  | Name                    | Description              |
|--------|-------|-------------------------|--------------------------|
| 0.0    | BOOL  | joint_1_torque_enabled  |                          |
| 1.0    | INT   | joint_1_angle_x10       | angle × 10 (e.g. 450 = 45.0°) |
| 3.0    | INT   | joint_1_speed           |                          |
| 5.0    | INT   | joint_1_load            |                          |
| 7.0    | BYTE  | joint_1_temperature     |                          |
| ...    | ...   | (repeat for joints 2-6) |                          |
| 42.0   | BOOL  | arm_connected           | WS connection status     |
| 43.0   | BOOL  | arm_fault               | Error flag               |

Adjust offsets/types to match your PLC environment.

### PLC Writes from Main Pi

Add a new queue function in `plc_integration.py`:

```python
def queue_robot_arm_joints(joint_states: dict):
    """Write ST3215 joint data to DB125."""
    ...
```

---

## Step 4 — Wire It Into `app.py`

1. **On startup** — initialise the `RobotArmClient` alongside the existing Dobot and PLC workers:
   ```python
   from robot_arm_client import RobotArmClient
   robot_arm = RobotArmClient(f"ws://{cfg['robot_arm']['host']}:{cfg['robot_arm']['port']}")
   ```

2. **Add REST endpoints:**
   ```
   GET  /api/robot-arm/status          → return cached joint states
   POST /api/robot-arm/move            → { joint, angle, speed }
   POST /api/robot-arm/stop            → stop all joints
   POST /api/robot-arm/torque          → enable/disable torque
   ```

3. **PLC write cycle** — in the existing PLC polling loop (or a new background thread), periodically push joint states to DB125:
   ```python
   joint_states = robot_arm.get_status()
   queue_robot_arm_joints(joint_states)
   ```

---

## Step 5 — Test End-to-End

### 1. Connectivity test (from main Pi terminal)
```bash
python3 -c "
import asyncio, websockets, json
async def t():
    async with websockets.connect('ws://<robot-arm-pi-ip>:8080') as ws:
        await ws.send(json.dumps({'command':'getStatus'}))
        print(await ws.recv())
asyncio.run(t())
"
```

### 2. PLC write test
Use the existing `/api/plc/read` endpoint to verify DB125 values update when joints move.

### 3. Smoke test via REST
```bash
# From your dev machine
curl http://<main-pi-ip>:8080/api/robot-arm/status
curl -X POST http://<main-pi-ip>:8080/api/robot-arm/move \
     -H "Content-Type: application/json" \
     -d '{"joint":1,"angle":30,"speed":1500}'
```

---

## Step 6 — Autostart on Boot

On the **Robot Arm Pi**, ensure the Node.js server starts on boot.

```bash
# On the Robot Arm Pi
sudo nano /etc/systemd/system/robot-arm.service
```

```ini
[Unit]
Description=ST3215 Robot Arm WebSocket Server
After=network.target

[Service]
User=ben
WorkingDirectory=/home/ben/raspberry-pi-control-st3215
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable robot-arm
sudo systemctl start robot-arm
```

The main Pi's `app.py` already has autostart via its existing service — `RobotArmClient` will auto-reconnect when the Robot Arm Pi comes online.

---

## File Checklist

| File | Action |
|------|--------|
| `pwa-dobot-plc/backend/robot_arm_client.py` | **Create** — WebSocket client |
| `pwa-dobot-plc/backend/config.json` | **Edit** — add `robot_arm` section |
| `pwa-dobot-plc/backend/plc_integration.py` | **Edit** — add `queue_robot_arm_joints()` |
| `pwa-dobot-plc/backend/app.py` | **Edit** — init client, add REST routes, add to PLC loop |
| `pwa-dobot-plc/backend/requirements.txt` | **Edit** — add `websockets` |
| PLC program | **Edit** — add DB125 data block |
| Robot Arm Pi | **Configure** — systemd service for autostart |

---

## Network Assumption

Both Pis must be on the same local network (or connected via Ethernet). The WebSocket connection is unencrypted — this is fine for a closed factory/lab network. If they're on different subnets, add a static route or put them on the same VLAN.
