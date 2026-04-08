# RobotArmv3 Integration Contract (MVP)

This document defines the simple command and response contract between:

- Flask backend (`pwa-dobot-plc/backend/app.py`)
- Pi Node service (`pwa-dobot-plc/robotarmv3-pi-service/server.js`)
- New web page (`pwa-dobot-plc/frontend/robot-arm.html`)

## Work Progress Tracker

Last updated: 2026-04-08

### Completed

- Phase 1 split completed:
  - Old robot page copied to `pwa-dobot-plc/frontend/dobot.html`
  - New placeholder page created at `pwa-dobot-plc/frontend/robot-arm.html`
  - Navigation links updated from `/robot-arm.html` to `/dobot.html`
- Phase 2 scaffold completed:
  - Added `pwa-dobot-plc/robotarmv3-pi-service/` with:
    - `server.js`
    - `robotArmI2C.js`
    - `test-i2c.js`
    - `package.json`
    - `README.md`
- MVP transport decision applied:
  - Frontend -> Flask REST
  - Flask -> Pi WebSocket
  - Frontend status polling at 500 ms

### In Progress

- Phase 6 end-to-end validation:
  - Run first hardware smoke test using new checklist
  - Confirm connect, move, stop, and status polling on real Pi hardware

### Just Completed

- Phase 3 backend bridge:
  - Added Flask routes in `pwa-dobot-plc/backend/app.py`:
    - `POST /api/robot-arm/connect`
    - `POST /api/robot-arm/disconnect`
    - `POST /api/robot-arm/move`
    - `POST /api/robot-arm/stop`
    - `GET /api/robot-arm/status`
  - Added dependency in `pwa-dobot-plc/backend/requirements.txt`:
    - `websocket-client>=1.8.0`
- Phase 4 frontend MVP:
  - Replaced placeholder page with real MVP page at `pwa-dobot-plc/frontend/robot-arm.html`
  - Added `pwa-dobot-plc/frontend/assets/js/robot-arm-v3-page.js`
  - Implemented buttons and flows for:
    - connect
    - disconnect
    - move joint
    - stop all
    - status polling every 500 ms
- Phase 5 docs and runbook:
  - Added first-run guide: `docs/guides/robotarmv3-first-run-checklist.md`
  - Included exact setup, run, and smoke-test commands for Pi + Flask + UI

### Next

- Phase 4:
  - Replace placeholder `pwa-dobot-plc/frontend/robot-arm.html` with real controls
  - Add frontend JS file for new page logic
- Phase 5:
  - Final Pi deployment and service setup docs
- Phase 6:
  - End-to-end validation checklist

## Pi WebSocket commands

WebSocket URL (Pi): `ws://<pi-host>:8080`

### 1) Get status

Request:

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
      "isMoving": false,
      "stallDetected": false,
      "stepPosition": 0,
      "angleDegrees": 12.34
    }
  ]
}
```

### 2) Move one joint

Request:

```json
{ "command": "moveJoint", "joint": 1, "angle": 45.0 }
```

Response:

```json
{ "type": "success", "message": "Joint 1 moving" }
```

### 3) Stop one joint

Request:

```json
{ "command": "stopJoint", "joint": 1 }
```

### 4) Stop all joints

Request:

```json
{ "command": "stopAll" }
```

## Flask API contract for frontend (MVP)

Frontend uses only Flask endpoints.

- `POST /api/robot-arm/connect`
- `POST /api/robot-arm/disconnect`
- `POST /api/robot-arm/move`
- `POST /api/robot-arm/stop`
- `GET /api/robot-arm/status`

Polling interval: every 500 ms from frontend.

## Notes

- Keep payloads basic JSON.
- Keep command names exactly as listed here.
- Add advanced streaming (SSE or direct browser WebSocket) only after MVP works.
