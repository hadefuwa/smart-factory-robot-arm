# Plan: bring Ben's October 2026 RobotArmv3 code into the Smart Factory

Written 2026-10-28. Upstream: `BenMatrixTSL/RobotArmv3`, commit `013a1a9` (2026-10-21).
Pristine copies of his folders are already in this repo (uncommitted at time of writing):
`raspberry-pi-control-st3215/`, `API Examples/`, `End Tool API ESP32/`, `electron-app/`.

## 1. What the investigation found

**Your earlier import was small.** The 2026-09-09 commit `21a0ac1` replaced the old USB bridge with
Ben's `raspberry-pi-control-st3215` code from **21-26 Aug 2026** (server.js = his `77f616d`,
servoWorker.js = his `aa98f22`; every other file is an exact copy of one of his commits).
Your own edits to his code are exactly two lines:

| File | Your edit |
|---|---|
| `server.js` | `PORT = process.env.PORT \|\| 8090` (his is hardcoded 8080, which is Flask) |
| `servoWorker.js` | `SERIAL_BAUDRATE = Number(process.env.SERIAL_BAUDRATE) \|\| 1000000` |

Local-only files: `robotarmv3-pi.service` (your systemd unit), `servo-pid-config.json` (output of
`servo-tuner.js`, read by servoWorker at startup), `API_DOCUMENTATION.md` (Ben deleted his on 2026-09-21).

**So "scrapping the previous import" = replacing the folder and re-applying those two edits.**

**Ben has made 45 commits to the folder since your base.** The ones that matter to you:

| Change | Why it matters here |
|---|---|
| URDF: link offsets updated 6 times, **joint 1 and joint 4 axes flipped** (Sep 25), servo-gripper TCP 130 mm (was 120.19) | Changes what XYZ means. Your PLC auto-move waypoints (incl. the "home waypoint" re-measured 2026-09-14) were measured on the old URDF and must be re-checked. |
| Removed the software joint-centering override (`setJointCenter`, `servo-joint-centers.json`) | **Safe for you**: no `servo-joint-centers.json` exists on the Pi, so your zeros already come from the servos' EEPROM. |
| servoWorker memory-leak fixes, serialport 12 -> 13, paused-mode port | Real stability gain for a 24/7 cell. Needs a rebuilt `node_modules` (see phase 2). |
| Bus reliability: 3-4 write attempts, implausible-sample filter, `JOINT_POLL_GAP_MS` | Fewer "Write timeout" faults and joint glitches. |
| Control lock + `verifyPassword`, status LED states, calibration/EEPROM commands, end-tool slew registers | New features; none are required by your backend. |
| `install-service.sh` now sets `dtoverlay=miniuart-bt` | **Do not run it.** Your Pi uses `dtoverlay=disable-bt` and the script also edits boot config. Keep your own unit file. |

**Protocol compatibility is good.** No command was removed or renamed upstream. Your backend sends
`takeControl, stopAll, setTorqueAll, scanServos, moveJoint, getStatus, inverseKinematics,
kinematicsForwardKinematics, executeLinearMove` and all still exist. One dead call: the backend sends
`setKinematicsConfig`, which neither the old nor the new server handles (pre-existing).

**Pi facts:** Node v20.19.2, serialport 12.0.0 installed, **no internet**, unit env
`PORT=8090 SERIAL_PORT=/dev/serial0 SERIAL_BAUDRATE=1000000`.

## 2. Keep / scrap proposal (please confirm - see section 6)

| Item | Proposal |
|---|---|
| `app/robotarmv3-pi-service/` (Ben's code from Aug) | **Scrap**: replace with his Oct 21 code + the two env edits |
| Your two env edits, unit file, `servo-pid-config.json` | **Keep** (re-apply on top of the new code) |
| Speed in **mm/s**: `PLC_AUTO_MOVE_SPEED_MIN/MAX_MM_PER_SEC`, PLC `db125_speed` -> `speedMmPerSec` on `executeLinearMove`, the "Speed (mm/s)" and PLC-target-speed fields in `robot-arm.html` | **Keep** |
| Backend: PLC auto-move via `executeLinearMove`, via-home routing, manual XYZ jog fix | **Keep** (re-validate after URDF change) |
| Backend: self-heal of a lost control session, status-backlog drain, `/api/robot-arm/command` fix | **Keep**, then review against the new 50 Hz push model (phase 3) |
| Home waypoint in `app.py` | **Keep the mechanism, re-measure the numbers** |
| Dashboard quick-actions layout fix | **Keep** (unrelated to Ben) |
| `setKinematicsConfig` call, the `setJointCenter` reply map in `app.py` | **Scrap** (dead against both versions) |
| Reject (Q0.6) button path | Already removed in `fa3bfee` |

## 3. Phases

### Phase 0 - Safety net (before touching anything)
1. Commit the current import of Ben's folders as its own commit; tag the current working state
   `pre-ben-oct21-update` and push.
2. On the Pi: copy `~/sf2/app/robotarmv3-pi-service` to `robotarmv3-pi-service.pre-update-<date>`
   (includes the working `node_modules`) and keep `robotarmv3-pi.service.bak`.
3. **Capture a baseline** at the home pose: `getStatus` joint angles and `currentXYZ`, plus the PLC
   waypoint values the backend uses. This is the number to compare after the URDF change.

### Phase 1 - Bring the bridge code in
1. Treat the root folders as a **pristine upstream mirror**; add `UPSTREAM.md` recording commit `013a1a9`.
2. Rebuild `app/robotarmv3-pi-service/` = mirror files + the two env edits (check whether upstream
   `server.js`/`servoWorker.js` still have the same two hardcoded lines; re-apply by hand) + keep
   `robotarmv3-pi.service` and `servo-pid-config.json`. Put the two edits in `LOCAL_PATCHES.md` so the
   next update is a 5-minute job.
3. Do **not** copy `install-service.sh`/`uninstall-service.sh`/`st3215-server.service` into `app/`.
4. Leave `JOINT_POLL_GAP_MS` at its default (4) first; Ben uses 1 (25 ms cycle) - tune later.

### Phase 2 - Dependencies without internet
serialport 13 is required. On Windows: `npm install --omit=dev` in the new service folder, confirm
`node_modules/@serialport/bindings-cpp/prebuilds/linux-arm64` exists, then copy `node_modules` to the Pi
with the code. Confirm Node 20.19 satisfies serialport 13's engine requirement. (If the prebuild is
missing, fall back to building on a spare Pi with internet.)

### Phase 3 - Backend review (Flask side, `app.py`)
1. **Frame/sign check:** search for anything that uses joint angles or XYZ with an assumed convention
   (waypoints, `_ik_and_move_to_xyz`, `_auto_move_gate_reason`, fault/limit code, PLC position write-back).
   J1 and J4 signs and link offsets changed.
2. **Re-measure** the home waypoint and any other stored XYZ in config/PLC against the new URDF.
3. **Push model:** the server now pushes ~50 status messages/s to every client. Re-check
   `send_robot_arm_command` and the backlog drain; ideally one reader thread caches the latest `status`
   (his guide: "do not poll `getStatus` in a loop").
4. **Control session:** it auto-releases after 5 min with no move command. Keep the self-heal; make sure
   a quiet cell re-takes control before the next auto-move.
5. Remove the dead `setKinematicsConfig` call and the `setJointCenter` reply entry.
6. Joint limits are **not** enforced by `moveJoint` (J2 -90..+40, J3 +-90, J4 +-90, J5 -5..+90, J6 +-90):
   confirm the backend clamps or only commands IK results.

### Phase 4 - Bench validation (arm unloaded, hand on E-stop, `DB123.DBX40.0` supervised)
1. Service up, **torque disabled**: FK sanity - compare `currentXYZ` at home with the Phase 0 baseline;
   quantify the difference. Hand-move the arm and watch XYZ change in the expected directions
   (especially base yaw and wrist roll, the axes that were flipped).
2. Small joint moves, then a small `moveJoint` stepped Cartesian move, then one `executeLinearMove`.
3. Auto-move **dry run**: PLC sets a target; backend moves via home at low mm/s; check speed clamps.
4. 30-minute soak watching `journalctl` for `Write timeout`, `servoWorkerCrashed` and memory growth.

### Phase 5 - Deploy to the Pi (per CLAUDE.md: scp + bundle, never git pull)
1. Copy the service folder (incl. `node_modules`) over a stopped service; keep the `.pre-update` copy.
2. Restart `robotarmv3-pi.service`, then `smart-factory.service`. Expect the safety interlock to disable
   torque until `DB123.DBX40.0` is set.
3. Re-run the Phase 4 checks on the real cell before handing back to production.

### Phase 6 - Optional features from Ben (separate, after the core update is stable)
Calibration/EEPROM tab, stored positions, end-tool servo slew / grip strength, status LED. Each would
be a separate small change to `robot-arm.html` / `robot-arm-v3-page.js` and the backend.

## 4. Rollback (about 2 minutes)
Stop `robotarmv3-pi.service`; swap `robotarmv3-pi-service` back with the `.pre-update` copy; start it;
`git checkout pre-ben-oct21-update` on Windows and redeploy any changed backend files.

## 5. Risks to keep in mind
- URDF/axis changes are the main risk: a wrong sign or offset could drive the arm somewhere unexpected.
  This is why Phase 4 starts with torque off and no PLC.
- serialport 13 native binary for the Pi (Phase 2).
- Pi boot config differs from Ben's (`disable-bt`, not `miniuart-bt`): never run his installer.
- The end-tool firmware version on your arm is unknown; check `toolGetIdentity` before using new tool commands.

## 6. Decisions needed
1. Is "scrap what we did" = the bridge import only (my reading), keeping the Flask PLC logic?
2. Which "additional features" besides mm/s do you want to keep? (Section 2 lists my proposals.)
3. Do you want Phase 6 features, or only the core update?
4. When can the cell be down for Phase 4/5, and is anyone on site with the E-stop?

## 7. Progress log and the URDF finding (2026-10-28)

Done: Phase 0 (tag `pre-ben-oct21-update`, upstream import commit `836ec3a`, Pi backup in
`~/robotarmv3-pi-service.pre-update-20261028`, baseline) and Phase 1/2 in the working tree
(`app/robotarmv3-pi-service` = Ben's 013a1a9 + the two env edits, `LOCAL_PATCHES.md`, serialport 13
`node_modules` built on Windows with the linux-arm64 prebuild). **Nothing deployed to the Pi yet.**

Baseline before the update (arm limp, torque off): XYZ (-134.5, -89.1, 193.2), joints
J1 12.39, J2 8.70, J3 -180.00, J4 80.77, J5 83.32, J6 -89.74. J3 reading exactly -180.00 is outside its
+-90 limit and suspicious; check it on the bench.

**Old vs new kinematics (same joint angles, run offline with both versions):**
- J1 and J4 are mirrored: J1 +30 gives Y = +80.7 (old) vs -80.7 (new); X and Z barely change.
- Link offsets and TCP lengths also changed (Z differs 4.7 mm at all-zeros with no tool, 9 mm with the
  vacuum tool, 14.5 mm with the servo gripper).
- Over 400 random in-limit poses, doing nothing changes the tool position by a median of 173 mm
  (no tool) to 275 mm (tool fitted), max about 830 mm. Mirroring Y alone still leaves a median error of
  36 mm (no tool) / 125 mm (tool): not a safe conversion, because J4 is flipped too.
- Poses with J4 = 0 mirror to within about 5 mm, so points taught with the wrist roll at zero convert
  closely; points that use J4 do not.

**Consequence:** every stored XYZ is invalid after the update and must be re-taught physically:
`PLC_AUTO_HOME_WAYPOINT` in app.py, and the PLC's `pickup_location_*`, `pallet_home_*`,
`quarantine_location_*` (DB125). Any Y offsets the PLC adds (pallet grid steps) flip sign.

Option A (recommended): take the new URDF, re-teach the points by hand-guiding the arm (torque off) and
reading the new `currentXYZ`. Option B: new code + the old URDF, keeps coordinates but keeps the
geometry Ben corrected; not recommended, and Ben's calibration/electron tools assume the new URDF.
