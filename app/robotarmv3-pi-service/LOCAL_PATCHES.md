# Local changes to Ben's code

This folder is `BenMatrixTSL/RobotArmv3` `raspberry-pi-control-st3215/` (pristine copy in
`/raspberry-pi-control-st3215/`, see its UPSTREAM.md for the commit) plus the following.
To update: copy his files over, then re-apply these two edits.

| File | Upstream line | Ours |
|---|---|---|
| `server.js` | `const PORT = 8080;` | `const PORT = process.env.PORT \|\| 8090;` (8080 is the Flask HTTPS backend) |
| `servoWorker.js` | `const SERIAL_BAUDRATE = 1000000;` | `const SERIAL_BAUDRATE = Number(process.env.SERIAL_BAUDRATE) \|\| 1000000;` |

Our own files: `robotarmv3-pi.service` (systemd unit, port 8090) and `servo-pid-config.json`
(output of `servo-tuner.js`, applied by servoWorker at startup).

Not copied on purpose: `install-service.sh`, `uninstall-service.sh`, `st3215-server.service`. His
installer edits the Pi's boot config (`dtoverlay=miniuart-bt`); this Pi uses `dtoverlay=disable-bt`.
Deploy with scp (the Pi has no internet) and build `node_modules` on Windows (`npm install --omit=dev`,
serialport 13 ships linux-arm64 prebuilds).
