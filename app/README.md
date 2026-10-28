# Smart Factory app

The software that runs on the Raspberry Pi (`/home/pi/sf2/app` on the Pi). It links the Siemens S7-1200 PLC, the 6-DOF ST3215 robot arm, the IO-Link master and the USB camera, and serves the engineering web UI on port 8080 (HTTPS).

For the full picture (network, PLC data blocks, vision pipeline, deployment) read [CLAUDE.md](../CLAUDE.md) in the repo root. Deploying to the Pi: [git.txt](../git.txt).

## Layout

| Folder | What it is |
|---|---|
| `backend/` | Flask backend (`app.py`): PLC communication (`plc_integration.py`, `plc_worker.py`), USB camera and YOLO vision (`camera_service.py`, `poe_vision_service.py`, `defect_detector.py`), event log, `config.json` (source-controlled defaults) |
| `frontend/` | The web UI (HTML, JS, CSS). Served by the backend, installable as a PWA |
| `robotarmv3-pi-service/` | Node.js bridge for the ST3215 arm (WebSocket on port 8090). See its [README](robotarmv3-pi-service/README.md) |
| `raspi-edge-stats/` | Pi health stats for the edge-device page |
| `deploy/` | systemd units, install/start helpers, SSL certificate script, camera recovery |
| `DB123_MEMORY_MAP.md`, `PLC_PLC_READ_WRITE_MAP.md` | PLC data block maps |

## Services on the Pi

The backend, vision service and arm bridge run under systemd (not PM2):

| Unit | Runs | Unit file |
|---|---|---|
| `smart-factory.service` | `backend/app.py` | `deploy/smart-factory.service` |
| `vision.service` | `backend/vision_service.py` (port 5001) | `deploy/vision.service` |
| `robotarmv3-pi.service` | `robotarmv3-pi-service/server.js` (port 8090) | `robotarmv3-pi-service/robotarmv3-pi.service` |

```bash
sudo systemctl status smart-factory.service robotarmv3-pi.service vision.service
sudo journalctl -u smart-factory.service -f
sudo systemctl restart smart-factory.service
```

The unit files in `/etc/systemd/system/` live outside the repo and hardcode `/home/pi/sf2/app/...`; the copies here are for reference and for rebuilding a Pi.

## Setting up a Pi

```bash
cd ~/sf2/app/deploy
./install.sh        # venv + Python dependencies + serial permissions
```

Then install the three unit files (the script prints the commands) and enable them. Edit `backend/config.json` for the PLC address; operator overrides made in the UI are saved to `~/.sf2/config.local.json` and layered on top.

## Running the backend by hand

```bash
sudo systemctl stop smart-factory.service   # free port 8080
cd ~/sf2/app/deploy && ./start.sh
```

## Safety interlock

If the PLC bit `DB123.DBX40.0` (`system_safety_ok`) is FALSE when the backend (re)connects to the arm bridge, the backend logs a safety interlock and disables arm torque. This was seen after restarting the backend or the bridge; set the bit from the PLC/HMI before using the arm.
