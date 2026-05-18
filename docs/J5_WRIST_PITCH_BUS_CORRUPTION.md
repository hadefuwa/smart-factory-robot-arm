# J5 (wrist_pitch) — RS-485 Bus Corruption Investigation

**Status:** open / mitigated in software (2026-05-18). Underlying cause is hardware-side bus signal integrity. This document is the canonical reference for what we know, what we've tried, and what to check next.

**Affected joint:** J5 / `wrist_pitch` / ST3215 servo ID 5 on the daisy-chained RS-485 bus driven by the SC-B1 board on `/dev/ttyACM0`.

---

## Summary

J5 intermittently drops off the RS-485 bus with `Communication error: -7` (checksum corruption). The other five joints on the same daisy chain are stable. Symptom escalates in software to "joint offline" — moves either fall back to 5-joint IK or fail outright. Pattern looks like a regular ~30 s cadence at idle plus extra noise during motion.

The bridge runs at `pwa-dobot-plc/robotarmv3-pi-service/server.js`; J5 corresponds to slot index 4 in `SERVO_IDS = [1, 2, 3, 4, 5, 6]`.

---

## What the user observes

- The joint card on [robot-arm.html](../pwa-dobot-plc/frontend/robot-arm.html) flickers between **Online**, **Degraded** (amber) and **Offline** (red) every few seconds.
- The comms log shows repeating sequences like:
  - `JOINT DEGRADED J5 reason=comm-corrupt polls=1/6`
  - `JOINT DEGRADED J5 reason=comm-corrupt polls=2/6`
  - `JOINT OFFLINE J5 reason=comm-corrupt source=status-read msg: Communication error: -7`
  - `JOINT BUS-OK J5` / `JOINT RECOVERED J5`
- XYZ moves attempted while J5 is in the offline window fall back to 5-joint IK; positions that need J5 to contribute pitch end up short, with `(closest=N mm)` on the comms log row.
- Live status JSON contains either:
  - `"available": true, "degraded": true, "degradedReason": "comm-corrupt", "degradedConsecutivePolls": 3, "error": "Communication error: -7"` — under threshold, keeping last-known data.
  - `"available": false, "consecutiveFailedPolls": 6, "offlineReason": "comm-corrupt", "offlineSource": "status-read"` — over threshold, slot nulled.

---

## What the journal shows

Filter: `sudo journalctl -u robotarmv3-pi.service --since '2 hours ago' --no-pager | grep -iE 'J5|servo 5|Communication error|comm-corrupt'`

### Quiet-idle cadence (most diagnostic)

Right after the [3ecc6d1](https://github.com/hadefuwa/smart-factory-robot-arm/commit/3ecc6d1) deploy, with no PLC commands and arm stationary:

```
22:08:44 Error reading status from servo 5: Communication error: -7
22:09:16 Error reading status from servo 5: Communication error: -7  (+32s)
22:09:48 Error reading status from servo 5: Communication error: -7  (+32s)
22:10:20 Error reading status from servo 5: Communication error: -7  (+32s)
22:10:52 Error reading status from servo 5: Communication error: -7  (+32s)
22:11:25 Error reading status from servo 5: Communication error: -7  (+33s)
22:11:57 Error reading status from servo 5: Communication error: -7  (+32s)
22:12:29 Error reading status from servo 5: Communication error: -7  (+32s)
```

A **32-second beat** at idle with the arm stationary. That regularity is the strongest single clue we have. It is not load-correlated and not concurrent with any code-side periodic timer the bridge runs (`startKeepAlive` fires every 500 ms; `maybeReopenPort` fires every 300 s — neither matches 32 s).

### Bursts during motion

When J5 is moving, the corruption rate increases and the bursts get longer (often crossing the offline threshold). Example burst:

```
[STALL] poll#1 J5:pos=2111 tgt=2624 err=513 mv=?
[STALL] Stuck joints (consec=1/8): J5 moved=0steps errToTarget=513steps
...
[STALL] CONFIRMED — holding position. Cause: J5 moved=0steps errToTarget=513steps
PLC auto-move backend: failure #205 (response type=stall) — backing off 30.0s
PLC auto-move backend: sent target x=100 y=200 z=200 speed=1000 -> stall
```

Here J5 didn't actually receive the goal-position write because the bus reply for that write got eaten by a checksum error; the bridge re-tried but the queue moved on.

### What `-7` means

Defined in [`robotArmST3215.js:39`](../pwa-dobot-plc/robotarmv3-pi-service/robotArmST3215.js):

```js
const COMM_RX_TIMEOUT = -6;
const COMM_RX_CORRUPT = -7;
```

A `-7` is raised when the bridge received a reply packet **but its bytes didn't parse cleanly** (header sequence wrong, length byte inconsistent, or checksum mismatch). It is distinct from `-6` (no reply at all). For J5 the dominant fault is `-7`, not `-6` — i.e. data is reaching us but is being corrupted in flight.

---

## Root cause

This is **RS-485 bus signal-integrity** at the J5 branch of the daisy chain. Evidence:

1. **Regular 32 s cadence at idle.** Software has no 32 s timer. Most likely candidate: an electrical phenomenon — periodic disturbance, ground-loop pulse, EMI from a nearby periodic load (lighting, switching power supply, fan PWM). The exact source matters less than the fact that the period is deterministic.
2. **Affects one joint only.** J1-J4 and J6 share the same SC-B1, the same USB-to-RS485 chip, the same firmware, the same power rail. They do not show the same -7 cadence at idle. So the problem is downstream of the SC-B1, at the J5 branch / cable / connector / servo.
3. **The bus IS responding** — pings to J5 succeed, position reads succeed for most polls. We're seeing **occasional corruption**, not silence.
4. **`-7` not `-6`.** Replies are arriving; their bytes are wrong. That's classic for marginal signal levels (under-driven differential, intermittent termination, partial cable shield) rather than a missing connection.

---

## What was happening BEFORE the 2026-05-18 patches

The pre-patch bridge code in [`server.js`](../pwa-dobot-plc/robotarmv3-pi-service/server.js) treated **any** single status-read failure as fatal to the slot:

```js
try { status = await servo.readQuickStatus(); }
catch (error) {
    removeServoController(servo);
    servos[i] = null;   // ← slot nulled on FIRST failure
    statuses.push({ available: false, ..., error: error.message });
}
```

So a single `-7` would:
1. Null `servos[4]`.
2. The next `getAllServoStatus` call would call `tryReviveServoSlot(4)`, which sleeps 5 s before re-pinging.
3. During those 5 s J5 was reported `available: false`.
4. Revive ping succeeded (servo IS alive on the bus). Slot was restored.
5. The very next read often succeeded.

Net effect: J5 appeared "offline" for ~5 seconds every time a single `-7` landed, even though it was responsive on the bus the whole time. With a 32 s `-7` cadence at idle that translated to roughly 5 s of "offline" out of every 32 s, or ~16% downtime on a perfectly stationary arm. Worse during motion.

Additional pathology: once the underlying ST3215 latched its OVERLOAD bit (status byte 0x08, observed on J2), the pre-patch code **also** rejected on the non-zero status byte. The latched bit kept failing every read forever; the revive loop kept failing forever (because ping also rejected on non-zero status byte). Joint stuck offline indefinitely until physical power-cycle.

---

## Software mitigations applied (2026-05-18)

Committed in [`f32a033`](https://github.com/hadefuwa/smart-factory-robot-arm/commit/f32a033) and [`2026e9d`](https://github.com/hadefuwa/smart-factory-robot-arm/commit/2026e9d). All live in `server.js`, `robotArmST3215.js`, `kinematics.js`, and the frontend.

### 1. In-poll read retry — 1 attempt → up to 3 with 25 ms gaps

[`server.js`](../pwa-dobot-plc/robotarmv3-pi-service/server.js) `getAllServoStatus`:

```js
const READ_RETRY_COUNT = 2;     // 1 initial + 2 retries = 3 attempts per poll
const READ_RETRY_GAP_MS = 25;
```

A single `-7` is now retried twice on the same poll before being counted as a failed poll. From the journal, this catches the vast majority of idle-cadence `-7`s in-place.

### 2. N-consecutive-poll threshold before nulling

```js
const OFFLINE_FAIL_THRESHOLD = 6;   // started at 3, raised to 6
```

The slot is no longer nulled on first failure. It enters a `degraded: true` state with last-known angles, and is only nulled after `OFFLINE_FAIL_THRESHOLD` consecutive failed polls (after in-poll retries). The page surfaces the degraded state with an amber **Degraded** badge and shows the current `polls=N/6` count in the comms log.

This was originally 3, raised to 6 after J5 was still flickering. Increasing further (to 10+) would smooth the experience further at the cost of slower detection of a truly dead servo.

### 3. Servo "status byte" / fault byte handling

[`robotArmST3215.js`](../pwa-dobot-plc/robotarmv3-pi-service/robotArmST3215.js):

```js
// Old behaviour: reject on any non-zero error byte → slot nulled forever.
// New behaviour: stash the fault byte, RESOLVE with the data anyway.
if (result.error !== 0) {
    this.lastReadFaultByte = result.error;
    console.warn(`Servo ${this.servoId}: read returned with fault byte 0x${...} (${describeServoFaultByte(...)})...`);
}
```

`describeServoFaultByte()` translates the bitmask to `OVERLOAD | OVERTEMP | VOLTAGE | ...`. The bridge then:
- Surfaces `faulted: true, faultByte, faultDescription` on the joint status.
- Throttled-writes `STS_TORQUE_ENABLE = 1` once per 5 s per joint to clear the latched bit on ST3215.

`ping()` likewise no longer rejects on non-zero status byte — the servo is considered alive if its ID matches the reply, regardless of fault bits.

These changes are not directly about `-7`, but they're in the same code path and important for understanding the full set of mitigations.

### 4. moveToXYZ pre-flight torque re-enable

Old code only wrote torque-enable when the register read 0. ST3215 servos with a latched OVERLOAD leave the register reading 1 while internally cutting drive. New code also re-writes torque-enable whenever the fault byte is non-zero:

```js
const needsTorqueReset = (xyzTorqueStates[ji] === false) || (xyzFaultBytes[ji] !== 0);
if (needsTorqueReset) await servos[ji].holdCurrentPosition();
```

### 5. IK wrist-lock fallback

When the wrist-roll-locked solver can't reach the target, retry once with the lock released. Restores the reachable workspace that was implicitly reduced by [`3ecc6d1`](https://github.com/hadefuwa/smart-factory-robot-arm/commit/3ecc6d1).

### 6. Diagnostics added

- `[OFFLINE J5]` / `[ONLINE J5]` journal lines on every transition.
- Per-joint `offlineReason`, `offlineSource`, `offlineSince`, `error`, `consecutiveFailedPolls`, `degradedReason`, `degradedConsecutivePolls`, `faultByte`, `faultDescription` exposed on every status payload.
- Comms log on the page emits synthetic `EVT` rows for every joint transition (offline / online / degraded / bus-ok / faulted / fault-cleared).

---

## Hardware diagnostic checklist

This is what to physically check now that the software mitigations are exhausted. Do these in order — each takes minutes and rules out the easy wins.

### A. Cable and connector (most likely)

1. With the arm powered off, unplug the bus cable at J5 and re-seat it firmly. Same for the upstream connector (the one going from J4 to J5).
2. Visually inspect both ends for pin damage, debris, or partial pin retraction.
3. Check the cable strain along its run from J4 to J5 — any tight bend, kink, pinch, or chafe.
4. Wiggle test: with `journalctl -fu robotarmv3-pi.service | grep -E 'servo 5|Communication'` running, gently flex the J5 branch of the cable. If `-7` rate spikes with cable motion, the cable or one of the connectors is the culprit.

### B. Swap test

5. Swap J5's bus cable with a known-good one (e.g. take J6's cable, swap them). If the problem follows the cable, it's the cable. If the problem stays on J5 (now connected via J6's previously-good cable), it's the servo or its branch.

### C. Termination and biasing

6. The SC-B1 should have RS-485 termination on one end. Check the termination jumper / DIP switch and ensure it's enabled. If the bus is unterminated or terminated on the wrong end, signal reflections cause exactly this kind of intermittent checksum corruption.
7. Confirm the bus has bias resistors (idle state should not float). If the SC-B1 doesn't provide them, idle bytes can flip and break the first byte of a reply.

### D. Servo itself

8. Try J5 in isolation: connect just J1 → J5 (skip J2/J3/J4/J6 if your harness allows), and run a long-idle test. If the `-7` cadence persists, the J5 servo's onboard RS-485 transceiver is marginal.
9. If you have a spare ST3215, swap J5 with the spare and re-test.

### E. Power / EMI

10. Measure the bus VCC at J5 with a multimeter. If it sags below ~6.5 V under load the servo's transceiver may drop bias.
11. Note any equipment switching on/off near the arm at 32 s intervals — overhead lighting controller, an LED driver, anything PWM. EMI coupling through poorly-shielded cable could explain the cadence.
12. Check the bus cable shield is connected to chassis ground at exactly one end (not both, not neither).

---

## How to monitor

### Live tail focused on J5

```bash
ssh pi@192.168.7.5 "sudo journalctl -fu robotarmv3-pi.service | grep --line-buffered -iE 'servo 5|J5|Communication error|comm-corrupt'"
```

### One-shot health check

```bash
ssh pi@192.168.7.5 "curl -sk https://localhost:8080/api/robot-arm/status" \
  | python3 -c "import json,sys; j=json.load(sys.stdin)['status']['joints'][4]; print(j)"
```

Look for `available`, `degraded`, `degradedConsecutivePolls`, `consecutiveFailedPolls`, `faultByte`.

### Rate of `-7` per minute

```bash
ssh pi@192.168.7.5 "sudo journalctl -u robotarmv3-pi.service --since '10 minutes ago' --no-pager \
  | grep -c 'Error reading status from servo 5: Communication error: -7'"
```

A healthy bus should be 0. The user's environment was seeing 1-2 per minute at idle (the 32 s cadence) before patches. With in-poll retries swallowing most, this drops to near 0 in the cooked logs — but `Servo 5: Failed to read quick status` lines still appear on each `-7` and are a reasonable raw counter.

---

## Why not just raise the threshold to 100?

Tempting, but it trades off the bridge's ability to detect a truly dead servo. If J5 fails physically (cable comes out, servo dies), we want the bridge to declare it offline within a few seconds so the rest of the system stops sending it commands and the operator gets a clear signal. A threshold of 6 with a ~1 s poll cadence means a ~6 s detection delay — already on the upper edge of comfortable. Going beyond 10 starts to feel like hiding the problem rather than working around it.

The right answer is to fix the bus signal integrity. The threshold is a band-aid.

---

## Open work

- [ ] Physical inspection of J5 cable and connector (Section A above).
- [ ] Cable swap test (Section B).
- [ ] Verify SC-B1 termination and biasing (Section C).
- [ ] Identify the source of the 32 s cadence. If it tracks a periodic external event (HVAC, lighting, conveyor cycle) we can confirm EMI; if it doesn't, the source is internal to the bus.
- [ ] Optional software follow-up: differentiate `comm-corrupt` (signal-integrity, keep degraded) from `read-timeout` (silence, allow null). Right now both treat the same threshold. Treating `-7` more leniently than `-6` would let J5 stay "degraded" indefinitely and only null on true silence.

---

## File pointers

- Bridge: [`pwa-dobot-plc/robotarmv3-pi-service/server.js`](../pwa-dobot-plc/robotarmv3-pi-service/server.js) — `getAllServoStatus`, `markServoOffline`, `tryReviveServoSlot`, `OFFLINE_FAIL_THRESHOLD`, `READ_RETRY_COUNT`.
- Servo protocol: [`pwa-dobot-plc/robotarmv3-pi-service/robotArmST3215.js`](../pwa-dobot-plc/robotarmv3-pi-service/robotArmST3215.js) — `readData` response handler, `ping`, `describeServoFaultByte`.
- IK: [`pwa-dobot-plc/robotarmv3-pi-service/kinematics.js`](../pwa-dobot-plc/robotarmv3-pi-service/kinematics.js) — `inverseKinematics`, the `_allowUnlocked` fallback retry.
- UI: [`pwa-dobot-plc/frontend/assets/js/robot-arm-v3-page.js`](../pwa-dobot-plc/frontend/assets/js/robot-arm-v3-page.js) — `detectJointTransitions`, `commsEntrySummary`, joint card rendering.
- Service: `robotarmv3-pi.service` on `pi@192.168.7.5`, working dir `/home/pi/sf2/pwa-dobot-plc/robotarmv3-pi-service/`, `Restart=always`.

---

*Last updated 2026-05-18 after the OFFLINE_FAIL_THRESHOLD 3→6 + local-since deploy. Update this file if any new failure mode appears or a hardware fix lands.*
