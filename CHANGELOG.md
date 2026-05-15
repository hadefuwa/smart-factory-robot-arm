# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **DB126/DB127 in `config.json` and writers**: `plc.db126` (edge device telemetry) and `plc.db127` (IO-Link supervision) blocks mirror `docs/DB126.txt` and `docs/DB127.txt`. New `_resolve_db_layout()` helper in `app.py` reads `db_number` and per-tag byte offsets from config so renumbering or shifting a byte in `config.json` is now picked up by the writers (`_write_edge_device_stats_to_plc`, `_write_iolink_to_plc`) instead of needing a code change.
- **Robot-arm bridge command queue — `moveToXYZ` coalescing**: `COALESCABLE_COMMAND_TYPES` in `server.js`. New `moveToXYZ` commands now drop earlier still-queued `moveToXYZ` commands and resolve them with `{ type: 'superseded' }`. Safety/discrete commands (`stopAllJoints`, `homeAll`, `setTorqueAll`, `moveJoint`) are deliberately excluded.
- **Robot-arm bridge — in-flight watchdog** (`COMMAND_WATCHDOG_MS`, 20s): a hung serial read on one servo can no longer permanently wedge the bridge's command queue. After the watchdog fires the slot is freed, other commands proceed, and the offending promise's late settlement is logged and swallowed. Must stay above `STALL_TIMEOUT_MS` plus poll overhead so healthy stalled moves still resolve normally.
- **Robot-arm bridge — USB-disconnect auto-recovery**: serialport `'close'` handler detects when the USB-to-RS485 adapter physically drops (the CH343 re-enumerating on its own counts), logs `[USB] Serial port closed unexpectedly...`, and calls `process.exit(1)`. `systemd Restart=always RestartSec=5` brings Node back, which re-runs bus wake-up and servo ping init. Intentional closes from `maybeReopenPort()` are gated by an `intentionalSerialClose` flag so planned port-session refreshes don't trigger the exit.
- **Flask PLC auto-move — exponential error backoff**: `consecutive_errors` + `error_backoff_until` state plus `_trigger_auto_move_backoff()` in `app.py`. After a failed send (`error`, `ikFailed`, exception) the loop backs off 2s → 4s → 8s → 16s → 30s, resetting on success or PLC target change. Prevents busy-looping on a stuck target which was previously saturating the bridge command queue.
- **Flask PLC auto-move — stale-target watchdog** (`PLC_AUTO_ACTIVE_TARGET_TIMEOUT_S`, 15s): if the bridge accepts a `moveToXYZ` (`success`/`moving`/`ikResult`) but the cached XYZ feedback never reaches within `PLC_AUTO_TARGET_TOLERANCE_MM` of the target, the watchdog declares the target unreachable, calls `queue_invalid_target(True)` so the PLC sees DB125 `invalid_target=1`, and applies the same exponential backoff. Must exceed the Node bridge's `STALL_TIMEOUT_MS` so a real stall response wins the race.
- **Kinematics — joint locking during XYZ IK**: `LOCKED_JOINT_NAME_PATTERNS` in `kinematics.js` matches joint names (`wrist_roll` → 0°) and pins those joints to a fixed angle for the duration of a position-only IK solve. Solver is effectively 5-DOF for position while keeping the wrist down, matching how the 5-joint arm behaved before joint 6 was added. Manual joint commands still drive the locked joints — only XYZ IK forces them.

### Changed
- **Default down-orientation removed from `moveToXYZ`**: previously both `server.js` and `app.py` forced `DEFAULT_TCP_DOWN_ORIENTATION = {x:0, y:0, z:-1}` into every `moveToXYZ`/`inverseKinematics` payload when the caller didn't supply one. With the 6th joint added, the IK then chased that orientation cost (weight 10×) by swinging J4 ~70-80° off-seed and the TCP ended up sideways. Orientation is now opt-in: pass `orientation` explicitly if you need a constrained pose. The constant is still exported for callers that want to opt in.
- **Stall detection — `STALL_POLLS` 4 → 8**: gives a joint 1.6s of grace (at 200ms poll cadence) to start moving before the bridge declares it stalled, instead of 800ms. Reduces false positives on slow-starting moves without changing the underlying delta/timeout thresholds.
- **Vision page layout (`vision-system-new.html`)**: PoE CAM — AI Cube Detection section moved below the live Camera Feed row so the Camera Feed sits top-left. Live PoE feed is rotated 180° (existing) to match the physical camera mount.

### Fixed
- **Robot-arm "bridge offline" recovery loop**: the PLC auto-move loop used to retry a failing target every 2s, saturating the Node command queue (`Command queue full (100 items)...rejecting`) which then made `/api/robot-arm/status` time out and the robot-arm page show `Bridge Offline (INTERNAL SERVER ERROR)`. The combination of Node coalescing + watchdog and Flask backoff + stale-target watchdog eliminates the cascade.
- **Vision page browser console**: `ERR_EMPTY_RESPONSE` and intermittent 503s on `/api/poe-camera/stream` traced to MJPEG chunk-size buffering in the Flask proxy (`iter_content(chunk_size=4096)` can stall before any chunk lands). Symptom documented; left untouched for now as it was a nothing-burger in practice.


  - Vision system now waits for Start command (DB123.DBX40.0) from PLC before processing
  - Automatically processes vision detection when Start command is received
  - Sets Completed flag (DB123.DBX40.3) when processing is finished
  - Resets Completed flag when Start command is released
  - Processing runs in background thread to avoid blocking PLC polling

- **Unified PLC Communication Module**: Consolidated all S7 communication into `plc_client.py`
  - All PLC read/write operations now centralized in one module
  - Added `read_vision_start_command()` method to read Start command from PLC
  - Added `write_vision_detection_results()` high-level method for vision results
  - Added `write_vision_fault_bit()` method for fault status reporting
  - Improved code organization and maintainability

- **DB123 Vision Tags Support**: Full support for vision system tags in DB123
  - Added `read_vision_tags()` method to read all vision tags from DB123
  - Added `write_vision_tags()` method to write vision tags with retry logic
  - Support for all DB123 tags: Start, Connected, Busy, Completed, Object_Detected, Object_OK, Defect_Detected, Object_Number, Defect_Number

- **Retry Logic for PLC Communication**: Implemented automatic retry mechanism
  - Handles "Job pending" errors from S7-1200 PLC automatically
  - 3 retry attempts with 200ms delay between retries
  - Prevents communication failures due to transient PLC busy states
  - Applied to all read/write operations (BOOL, INT, REAL, M bits)

- **Completed Flag**: New tag at DB123.DBX40.3
  - Indicates when vision processing cycle is complete
  - Automatically set after object detection, image saving, and defect checking
  - Automatically reset when Start command goes low

### Changed
- **Address Mapping Updates**: Updated DB123 tag addresses to accommodate Completed flag
  - Completed: 40.3 (NEW)
  - Object_Detected: 40.4 (was 40.3)
  - Object_OK: 40.5 (was 40.4)
  - Defect_Detected: 40.6 (was 40.5)
  - Object_Number: 42.0 (unchanged)
  - Defect_Number: 44.0 (unchanged)

- **PLC Communication Architecture**: Refactored to use unified PLC client
  - All S7 communication now goes through `plc_client.py`
  - `app.py` wrapper functions call unified PLC client methods
  - Improved error handling and logging
  - Better separation of concerns

- **Vision Detection Flow**: Updated to support handshaking
  - Vision processing now triggered by PLC Start command
  - Automatic image saving and defect detection during handshake cycle
  - Results automatically written to PLC tags
  - Busy flag properly managed during processing

- **Default DB Number**: Changed from DB1 to DB123
  - All PLC operations now default to DB123
  - Configurable via `config.json`
  - Prevents "Address out of range" errors

- **Network Configuration**: Updated PLC IP address
  - Default PLC IP: 192.168.7.2
  - Raspberry Pi IP: 192.168.7.5
  - Network routing configured for PLC subnet access

### Fixed
- **"Job pending" Errors**: Fixed frequent PLC communication errors
  - Added retry logic with delays
  - Added small delays between consecutive writes
  - Prevents overwhelming S7-1200 PLC with rapid requests

- **"Address out of range" Errors**: Fixed DB1 access errors
  - Changed default DB number to DB123
  - Made DB number configurable
  - Suppressed errors when DB1 is not available

- **Duplicate Method Definitions**: Removed duplicate `write_vision_detection_results()` method
  - Consolidated into single implementation
  - Improved code clarity

- **Frontend JavaScript Errors**: Fixed undefined function errors
  - Fixed `handleStreamError` and `handleStreamLoad` event handlers
  - Fixed `plc_client` undefined error in frontend
  - Updated to use proper API endpoints

### Technical Details

#### PLC Communication Methods (`plc_client.py`)
- **Connection Management**:
  - `connect()` - Connect to PLC with retry logic
  - `disconnect()` - Disconnect from PLC
  - `is_connected()` - Check connection status
  - `get_status()` - Get connection status info

- **Low-Level Data Block Operations**:
  - `read_db_real()` - Read REAL (float) values
  - `write_db_real()` - Write REAL values
  - `read_db_bool()` - Read BOOL values
  - `write_db_bool()` - Write BOOL values
  - `read_db_int()` - Read INT values
  - `write_db_int()` - Write INT values

- **Memory (M) Operations**:
  - `read_m_bit()` - Read Merker bit
  - `write_m_bit()` - Write Merker bit

- **Robot Control Methods**:
  - `read_target_pose()` - Read target X, Y, Z position
  - `read_current_pose()` - Read current X, Y, Z position
  - `write_current_pose()` - Write current position
  - `read_control_bits()` - Read all control bits (M0.0-M0.7)
  - `write_control_bit()` - Write single control bit

- **Vision System Methods**:
  - `read_vision_tags()` - Read all DB123 vision tags
  - `write_vision_tags()` - Write DB123 vision tags (with retry logic)
  - `read_vision_start_command()` - Read Start command from PLC
  - `write_vision_detection_results()` - High-level method for vision results
  - `write_vision_fault_bit()` - Write vision fault bit to M memory

#### Handshaking Flow
1. PLC sets Start (DB123.DBX40.0) = True
2. Raspberry Pi detects rising edge in polling loop
3. Pi sets Busy (DB123.DBX40.2) = True
4. Pi processes vision:
   - Detects objects using YOLO
   - Saves counter images
   - Checks for defects
   - Writes results to PLC tags
5. Pi sets Completed (DB123.DBX40.3) = True, Busy = False
6. PLC reads Completed = True
7. PLC resets Start = False
8. Pi detects falling edge and resets Completed = False

#### Configuration (`config.json`)
```json
{
  "plc": {
    "ip": "192.168.7.2",
    "db_number": 123,
    "db123": {
      "enabled": true,
      "db_number": 123,
      "tags": {
        "start": {"byte": 40, "bit": 0},
        "connected": {"byte": 40, "bit": 1},
        "busy": {"byte": 40, "bit": 2},
        "completed": {"byte": 40, "bit": 3},
        "object_detected": {"byte": 40, "bit": 4},
        "object_ok": {"byte": 40, "bit": 5},
        "defect_detected": {"byte": 40, "bit": 6},
        "object_number": {"byte": 42},
        "defect_number": {"byte": 44}
      }
    }
  }
}
```

## Notes
- All S7 communication is now centralized in `plc_client.py` for better code organization
- Handshaking runs automatically in the background polling loop
- Vision processing is triggered by PLC Start command, ensuring synchronization
- Retry logic prevents communication failures due to transient PLC states
- Address mappings updated to accommodate new Completed flag

