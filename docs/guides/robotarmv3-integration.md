# RobotArmv3 Integration — Implementation Reference

Last updated: 2026-04-09

## Status: Working

- 5 of 6 ST3215 servos operational (servo 6 not connected to bus)
- Reads, writes, moves all working
- Status polling at 500ms working
- Bridge auto-connects on Flask startup (no manual connect needed)

---

## Architecture

```
Browser (robot-arm.html)
    │ fetch /api/robot-arm/*
    ▼
Flask (app.py, port 8080 HTTPS)
    │ WebSocket ws://localhost:8090
    ▼
Node.js service (server.js, port 8090)
    │ serial 1Mbps
    ▼
Waveshare SC-B1 (USB CDC-ACM /dev/ttyACM0)
    │ internal 1Mbps forwarding
    ▼
ST3215 servo bus (IDs 1–5 active, daisy-chained)
```

---

## Key Hardware Notes

### Waveshare SC-B1 Driver Board
- Connects to Pi as `/dev/ttyACM0` (USB CDC-ACM, not ttyUSB)
- **Serial forwarding mode**: Pi talks to SC-B1 at **1 Mbps** — SC-B1 forwards internally at 1 Mbps to servo bus
- **Session timeout**: SC-B1 forwarding session expires after **~6 seconds** of port open time. The Node.js service handles this automatically by closing and reopening the port every 5.2 seconds (`maybeReopenPort()`).
- **Keep-alive**: A ping is sent every ~1 second to keep the servo bus responsive between session renewals.

### ST3215 Servos
- Protocol: Feetech STS3215 half-duplex UART (0xFF 0xFF header)
- Status Return Level = 0 (factory default): **write commands do NOT send an ACK**. `writeData()` uses fire-and-forget with 8ms drain.
- Position register: 0x38 (56), 2 bytes, little-endian. 0 = 0°, 2048 = center, 4095 = max.
- Angle conversion: `angle = (position - 2048) / (2048 / 180)`

---

## Services

| Service | Managed by | Port | Start cmd |
|---------|-----------|------|-----------|
| Flask (app.py) | PM2 (`pwa-dobot-plc`) | 8080 HTTPS | `pm2 restart pwa-dobot-plc` |
| Node.js (server.js) | systemd (`robotarmv3-pi.service`) | 8090 WS | `sudo systemctl restart robotarmv3-pi.service` |

Flask auto-connects the WebSocket bridge to `localhost:8090` on startup (3s deferred thread).

---

## Files

| File | Purpose |
|------|---------|
| `pwa-dobot-plc/robotarmv3-pi-service/server.js` | Node.js WebSocket server, serial port management, command handlers |
| `pwa-dobot-plc/robotarmv3-pi-service/robotArmST3215.js` | ST3215 servo controller class (ping, readData, writeData, readQuickStatus) |
| `pwa-dobot-plc/backend/app.py` | Flask REST API, WebSocket bridge, auto-connect logic |
| `pwa-dobot-plc/frontend/robot-arm.html` | Tabbed UI (Joint Control, Live Status, Settings, Debug) |
| `pwa-dobot-plc/frontend/assets/js/robot-arm-v3-page.js` | Frontend JS — polling, joint cards, tab system, all button handlers |

---

## Flask API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `GET` | `/api/robot-arm/status` | Get live servo status (calls `getStatus` over bridge) |
| `POST` | `/api/robot-arm/connect` | Connect bridge: `{"host":"localhost","port":8090}` |
| `POST` | `/api/robot-arm/disconnect` | Disconnect bridge |
| `POST` | `/api/robot-arm/move` | Move joint: `{"joint":1,"angle":45.0,"speed":1500}` |
| `POST` | `/api/robot-arm/stop` | Stop all joints |
| `POST` | `/api/robot-arm/command` | Generic passthrough — any WebSocket command |
| `POST` | `/api/robot-arm/scan` | Scan for servos |

The generic passthrough (`/api/robot-arm/command`) accepts any command documented in the WebSocket API below, plus an optional `_recvTimeout` (seconds) field.

---

## Node.js WebSocket Commands

WebSocket URL: `ws://localhost:8090`

### getStatus
```json
{ "command": "getStatus" }
```
Response:
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
  ]
}
```

### moveJoint
```json
{ "command": "moveJoint", "joint": 1, "angle": 45.0, "speed": 1500 }
```

### stopJoint / stopAllJoints
```json
{ "command": "stopJoint", "joint": 1 }
{ "command": "stopAllJoints" }
```

### setSpeed / setAcceleration
```json
{ "command": "setSpeed", "joint": 1, "speed": 2000 }
{ "command": "setAcceleration", "joint": 1, "acceleration": 100 }
```
Speed range: 0–3400 step/s. Acceleration range: 0–254 (units: 100 step/s²).

### homeAll
```json
{ "command": "homeAll" }
```
Moves all joints to 0°.

### echo / getPortInfo / getLogs / setDebug
Debug commands — use the Debug tab in the UI.

### rawPing
```json
{ "command": "rawPing", "id": 1 }
```
Sends a raw PING packet and waits up to 300ms for a response.

### readRegister
```json
{ "command": "readRegister", "id": 1, "register": 56, "length": 2 }
```
Reads raw bytes from a servo register. Register 56 (0x38) = present position (2 bytes LE).

### scanServos
```json
{ "command": "scanServos", "maxId": 6, "baudRates": [1000000], "timeout": 100, "_recvTimeout": 15 }
```

---

## Troubleshooting

### Robot shows Offline / 503 on status
Flask bridge not connected. This auto-connects 3s after Flask starts.
- Check Node.js service is running: `sudo systemctl status robotarmv3-pi.service`
- Manually connect: `POST /api/robot-arm/connect {"host":"localhost","port":8090}`

### Reads timeout (READ TIMEOUT in journalctl)
- Usually means the SC-B1 session has expired. The service handles this automatically with `maybeReopenPort()`.
- If persistent, check `sudo journalctl -u robotarmv3-pi.service -n 50` for `PORT SESSION` log entries.

### Servo not responding to ping during init
- Check servo is powered (SC-B1 has a separate 7.4V servo power connector)
- Servos will miss ping if the serial bus is busy — retry with Quick Scan from the Debug tab

### Serial port locked (EADDRINUSE)
If the service crashes and leaves the port locked:
```bash
sudo fuser /dev/ttyACM0
sudo kill <PID>
sudo systemctl restart robotarmv3-pi.service
```
