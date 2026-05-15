# RobotArmv3 Pi Service

This folder is the Raspberry Pi Node.js service used by the web app migration.

## What it does

- Opens I2C connections to joint controllers
- Exposes a WebSocket server for robot commands
- Returns simple robot status data

## Files

- `server.js` - WebSocket server and command handler
- `robotArmI2C.js` - I2C communication helper class
- `test-i2c.js` - simple I2C read test
- `package.json` - dependencies and scripts

## Commands

```bash
npm install
sudo npm run server
```

Test I2C:

```bash
sudo npm test
```

## Environment variables

- `ROBOT_ARM_PORT` (default `8080`)
- `ROBOT_ARM_I2C_BUS` (default `/dev/i2c-1`)
- `ROBOT_ARM_ADDRESSES` (default `0x22,0x23`)

Example:

```bash
export ROBOT_ARM_PORT=8080
export ROBOT_ARM_I2C_BUS=/dev/i2c-1
export ROBOT_ARM_ADDRESSES=0x22,0x23,0x24
sudo npm run server
```

## Command queue semantics

All incoming WebSocket commands run through a single global queue in `server.js`
(`commandQueue`, processed by `processCommandQueue`). Only one command is in
flight at a time, which serialises serial-bus access across every connected
client. The queue has four behaviours worth knowing about:

1. **getStatus coalescing.** A `getStatus` from any client rides on an
   already-pending status read instead of enqueuing its own. The primary
   read broadcasts its result to every waiter. Prevents the queue saturating
   when several clients poll concurrently.
2. **moveToXYZ coalescing (latest-wins).** When a new `moveToXYZ` is queued,
   any earlier still-queued `moveToXYZ` commands are dropped and their
   callers receive a `{ type: 'superseded' }` response. The arm only cares
   about the most recent target; intermediate ones are throwaway. The
   in-flight move is **not** interrupted — it runs to completion (or to its
   `STALL_TIMEOUT_MS` deadline) before the coalesced latest target starts.
   Controlled by `COALESCABLE_COMMAND_TYPES`.
3. **In-flight watchdog** (`COMMAND_WATCHDOG_MS`, default 20s). If a single
   in-flight command does not resolve within the watchdog window the queue
   is freed so other clients can recover — without this, a hung serial read
   on one servo would lock the bridge until the service is restarted (we
   hit this exact failure mode in practice). The underlying promise keeps
   running in the background and any late settlement is logged and swallowed.
   `COMMAND_WATCHDOG_MS` must exceed `STALL_TIMEOUT_MS` plus IK/poll overhead,
   otherwise normal stalled moves will trip the watchdog.
3a. **USB-disconnect auto-recovery.** The serialport `'close'` event fires
    when the USB-to-RS485 adapter physically disappears (cable wiggle,
    re-enumeration, adapter brownout). When that happens our open file
    handle is dead and every servo silently goes unavailable. The handler
    logs the event and calls `process.exit(1)`; systemd
    (`Restart=always RestartSec=5`) restarts the service, which re-runs the
    bus wake-up and servo ping init from scratch. `intentionalSerialClose`
    is set while `maybeReopenPort()` is cycling the port so a planned
    close doesn't trigger the exit.
4. **Everything else is FIFO.** `stopAllJoints`, `homeAll`, `setTorqueAll`,
   `moveJoint`, etc. are queued in order and never dropped. Coalescing
   discrete or safety-critical commands would risk losing them, so they are
   deliberately excluded from the coalescable set.

If you add a new "streamed target" command in future, add its type name to
`COALESCABLE_COMMAND_TYPES` at the top of `server.js`. Do **not** add stop
or torque-toggle commands to that set.

## PLC auto-move bridge (Flask side)

The Flask backend (`pwa-dobot-plc/backend/app.py`,
`plc_auto_backend_loop`) continuously reads `db125_target_x/y/z/speed` from
the PLC cache and sends the active target to this service over WebSocket. To
avoid hammering the bridge when something goes wrong, it applies four
guards:

- **Resend interval** (`PLC_AUTO_RESEND_INTERVAL_S`, 2.0s): the same target
  is not re-sent more often than this.
- **Active target dedup** (`active_target_key`): once a successful
  `moveToXYZ` is in progress, no further sends happen for the same target
  until completion or a target change from the PLC.
- **Exponential error backoff** (`PLC_AUTO_ERROR_BACKOFF_BASE_S` 2.0s →
  `PLC_AUTO_ERROR_BACKOFF_MAX_S` 30s): if a send returns `error`/`ikFailed`
  or raises an exception, retries are suppressed for a growing backoff
  window (2s, 4s, 8s, 16s, capped at 30s). The counter resets on a
  successful response or when the PLC changes the target.
- **Stale-target watchdog** (`PLC_AUTO_ACTIVE_TARGET_TIMEOUT_S`, 15s):
  once the bridge accepts a move (response `success`/`moving`/`ikResult`)
  the loop waits for cached XYZ feedback to come within
  `PLC_AUTO_TARGET_TOLERANCE_MM`. If it doesn't within the timeout — IK
  best-effort landed off-target, a joint stalled silently, the move
  finished but the TCP isn't where the PLC asked — the watchdog declares
  the target unreachable, clears the active marker, calls
  `queue_invalid_target(True)` so the PLC sees DB125 `invalid_target=1`,
  and applies the same exponential backoff. Must stay larger than the
  Node bridge's `STALL_TIMEOUT_MS` (default 8s) so a real stall response
  wins the race.

Together with the Node-side coalescing above, this stops a stalled or
unreachable move from filling the bridge queue, busy-looping in Flask, or
locking out other operations such as `/api/robot-arm/status`.
