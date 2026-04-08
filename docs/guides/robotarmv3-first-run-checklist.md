# RobotArmv3 First Run Checklist (MVP)

This checklist helps you run the new web integration step by step.

## 1) Raspberry Pi setup (one-time)

On Raspberry Pi:

```bash
sudo raspi-config
# Interface Options -> I2C -> Enable
sudo reboot
```

After reboot:

```bash
sudo apt update
sudo apt install -y nodejs npm
```

Optional but recommended:

```bash
sudo hostnamectl set-hostname robot-arm
sudo apt install -y avahi-daemon
sudo systemctl enable avahi-daemon
```

## 2) Copy Pi service folder to Raspberry Pi

Copy this folder from your project to your Pi:

- `pwa-dobot-plc/robotarmv3-pi-service`

For example, with SCP from your computer:

```bash
scp -r pwa-dobot-plc/robotarmv3-pi-service pi@YOUR_PI_IP:/home/pi/
```

Then on Pi:

```bash
cd ~/robotarmv3-pi-service
npm install
```

## 3) Configure I2C bus and addresses

Defaults in the service:

- I2C bus: `/dev/i2c-1`
- addresses: `0x22,0x23`
- port: `8080`

If needed, set environment variables:

```bash
export ROBOT_ARM_I2C_BUS=/dev/i2c-1
export ROBOT_ARM_ADDRESSES=0x22,0x23
export ROBOT_ARM_PORT=8080
```

## 4) Test I2C communication on Pi

```bash
sudo i2cdetect -y 1
```

You should see your joint addresses in the table.

Then run:

```bash
cd ~/robotarmv3-pi-service
sudo npm test
```

## 5) Start Pi service

```bash
cd ~/robotarmv3-pi-service
sudo npm run server
```

Expected log includes:

- service listening on `ws://0.0.0.0:8080`
- configured I2C bus
- configured addresses

## 6) Start your Flask backend

On your app host:

```bash
cd pwa-dobot-plc/backend
pip install -r requirements.txt
python app.py
```

## 7) Open web UI and connect

Open:

- `http://<app-host>:8080/robot-arm.html`

In the page:

1. Enter Pi host (for example `robot-arm.local` or Pi IP)
2. Keep port `8080`
3. Click **Connect**
4. Click **Move Joint** (safe test angle)
5. Click **Stop All** to verify emergency command path

## 8) Quick API smoke tests (optional)

```bash
curl -X POST http://<app-host>:8080/api/robot-arm/connect -H "Content-Type: application/json" -d "{\"host\":\"robot-arm.local\",\"port\":8080}"
curl http://<app-host>:8080/api/robot-arm/status
curl -X POST http://<app-host>:8080/api/robot-arm/move -H "Content-Type: application/json" -d "{\"joint\":1,\"angle\":30}"
curl -X POST http://<app-host>:8080/api/robot-arm/stop
curl -X POST http://<app-host>:8080/api/robot-arm/disconnect
```

## 9) Common issues

- `Robot arm bridge not connected`
  - Click connect first, or check Pi host/port.
- Timeout/connect error
  - Verify Pi service is running and reachable on port 8080.
- I2C permission error
  - Run with `sudo`, or add user to `i2c` group and re-login.
- No joints available
  - Confirm I2C addresses match your controller firmware.
