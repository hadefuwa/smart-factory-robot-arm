# DB123 Memory Map - AUTHORITATIVE SPECIFICATION

**Version:** 2.1 (Corrected from actual PLC export)
**Last Updated:** 2026-03-30
**Status:** ✅ CANONICAL - All code must match this specification

---

## Overview

DB123 is the **single source of truth** for all PLC communication in this system.

**Total Size:** 98 bytes (0-97)

---

## Complete Memory Layout

### Byte 0-1: HMI & Buttons (`HMI_UDT`)
| Address | Type | Name | Access | Description |
|---------|------|------|--------|-------------|
| `DBX0.0` | Bool | Start | PLC → Pi | System start command from HMI |
| `DBX0.1` | Bool | Stop | PLC → Pi | System stop command from HMI |
| `DBX0.2` | Bool | Reset | PLC → Pi | System reset command from HMI |

### Byte 2-21: Robot (`Robot_UDT`)
| Address | Type | Name | Access | Description |
|---------|------|------|--------|-------------|
| `DBX2.0` | Bool | Robot_Connected | Pi → PLC | Dobot/Robot connected |
| `DBX2.1` | Bool | Robot_Busy | Pi → PLC | Robot executing movement |
| `DBX2.2` | Bool | Robot_Cycle_Complete | PLC → Pi | **READ-ONLY** Robot cycle completed |
| `DBW4` | Int | Target_X | PLC → Pi | **READ-ONLY** Target X position |
| `DBW6` | Int | Target_Y | PLC → Pi | **READ-ONLY** Target Y position |
| `DBW8` | Int | Target_Z | PLC → Pi | **READ-ONLY** Target Z position |
| `DBW10` | Int | Current_X | Pi → PLC | Current X position |
| `DBW12` | Int | Current_Y | Pi → PLC | Current Y position |
| `DBW14` | Int | Current_Z | Pi → PLC | Current Z position |
| `DBW16` | Int | Robot_Status_Code | Pi → PLC | Status code |
| `DBW18` | Int | Robot_Error_Code | Pi → PLC | Error code |
| `DBW20` | Int | Cube_Type | Pi → PLC | 0=None, 1=Reject, 2=Yellow, 3=White, 4=Steel, 5=Aluminum |

### Byte 22-25: Conveyors
| Address | Type | Name | Access | Description |
|---------|------|------|--------|-------------|
| `DBX22.0` | Bool | Conveyor1_Start | PLC → Pi | **READ-ONLY** Conveyor 1 start |
| `DBX22.1` | Bool | Conveyor1_Stop | PLC → Pi | **READ-ONLY** Conveyor 1 stop |
| `DBX24.0` | Bool | Conveyor2_Start | PLC → Pi | **READ-ONLY** Conveyor 2 start |
| `DBX24.1` | Bool | Conveyor2_Stop | PLC → Pi | **READ-ONLY** Conveyor 2 stop |

### Byte 26-33: Camera & Vision (`Camera_UDT`) ⭐ CRITICAL
| Address | Type | Name | Access | Description |
|---------|------|------|--------|-------------|
| `DBX26.0` | Bool | Camera_Start | PLC → Pi | **READ-ONLY** PLC triggers vision |
| `DBX26.1` | Bool | Camera_Connected | Pi → PLC | Camera ready |
| `DBX26.2` | Bool | Camera_Busy | Pi → PLC | Processing in progress |
| `DBX26.3` | Bool | Camera_Completed | Pi → PLC | Cycle completed |
| `DBX26.4` | Bool | Object_Detected | Pi → PLC | Object found |
| `DBX26.5` | Bool | Object_OK | Pi → PLC | Quality check passed |
| `DBX26.6` | Bool | Defect_Detected | Pi → PLC | Reject detected |
| `DBW28` | Int | Object_Number | Pi → PLC | Total objects counter |
| `DBW30` | Int | Defect_Number | Pi → PLC | Total defects counter |
| `DBX32.0` | Bool | Yellow_Cube | Pi → PLC | Yellow detected |
| `DBX32.1` | Bool | White_Cube | Pi → PLC | White detected |
| `DBX32.2` | Bool | Steel_Cube | Pi → PLC | Steel detected |
| `DBX32.3` | Bool | Aluminum_Cube | Pi → PLC | Aluminum detected |
| `DBX32.4` | Bool | Counter_Exceeded | Pi → PLC | Limit reached |

### Byte 34-47: Objects & Counters (`Objects_UDT`)
| Address | Type | Name | Access | Description |
|---------|------|------|--------|-------------|
| `DBW34` | Int | Material | Pi → PLC | 0=Reject, 1=Inductive, 2=Capacitive, 3=Plastic |
| `DBW36` | Int | Quarantined_Count | Pi → PLC | Quarantine counter |
| `DBW38` | Int | Defect_Count | Pi → PLC | Defect counter |
| `DBW40` | Int | Aluminum_Count | Pi → PLC | Aluminum counter |
| `DBW42` | Int | Steel_Count | Pi → PLC | Steel counter |
| `DBW44` | Int | Yellow_Count | Pi → PLC | Yellow counter |
| `DBW46` | Int | White_Count | Pi → PLC | White counter |

### Byte 48-71: Gantry (`Gantry_UDT`)
| Address | Type | Name | Access | Description |
|---------|------|------|--------|-------------|
| `DBX48.0` | Bool | Home | Pi → PLC | At home position |
| `DBX48.1` | Bool | Busy | Pi → PLC | Moving |
| `DBX48.2` | Bool | Move_Done | Pi → PLC | Movement complete |
| `DBX48.3` | Bool | Pick_Up | PLC → Pi | **READ-ONLY** Pick command |
| `DBX48.4` | Bool | Place_Down | PLC → Pi | **READ-ONLY** Place command |
| `DBX48.5` | Bool | Home_Command | PLC → Pi | **READ-ONLY** Home command |
| `DBX48.6` | Bool | Power_OK | Pi → PLC | Power status |
| `DBD50` | Real | Current_Position | Pi → PLC | Current position (mm) |
| `DBD54` | Real | Target_Position | PLC → Pi | **READ-ONLY** Target (mm) |
| `DBD58` | Real | Velocity | PLC → Pi | **READ-ONLY** Velocity (mm/s) |
| `DBD62` | Real | Position1 | PLC → Pi | **READ-ONLY** Preset 1 |
| `DBD66` | Real | Position2 | PLC → Pi | **READ-ONLY** Preset 2 |
| `DBX70.0` | Bool | Home_Error | Pi → PLC | Homing error |
| `DBX70.1` | Bool | Home_Error_Fix | PLC → Pi | **READ-ONLY** Clear error |

### Byte 72-75: System (`System_UDT`)
| Address | Type | Name | Access | Description |
|---------|------|------|--------|-------------|
| `DBX72.0` | Bool | Safety_OK | Pi → PLC | Safety OK |
| `DBX72.1` | Bool | No_Faults | Pi → PLC | No faults |
| `DBX72.2` | Bool | Active_Fault | Pi → PLC | Fault present |
| `DBX72.3` | Bool | Startup_Completed | Pi → PLC | Init complete |
| `DBW74` | Int | State | Pi → PLC | State machine |

### Byte 76-85: Pallet (`Pallet_UDT`)
| Address | Type | Name | Access | Description |
|---------|------|------|--------|-------------|
| `DBX76.0-76.3` | Bool | Row_1[0-3] | Pi → PLC | Row 1 occupancy |
| `DBX78.0-78.3` | Bool | Row_2[0-3] | Pi → PLC | Row 2 occupancy |
| `DBX80.0-80.3` | Bool | Row_3[0-3] | Pi → PLC | Row 3 occupancy |
| `DBX82.0-82.3` | Bool | Row_4[0-3] | Pi → PLC | Row 4 occupancy |
| `DBX84.0` | Bool | Pallet_Full | Pi → PLC | All positions full |

### Byte 86-87: HMI Overrides
| Address | Type | Name | Access | Description |
|---------|------|------|--------|-------------|
| `DBX86.0` | Bool | Conveyor1_Override | PLC → Pi | **READ-ONLY** |
| `DBX86.1` | Bool | Conveyor2_Override | PLC → Pi | **READ-ONLY** |
| `DBX86.2` | Bool | Linear_Override | PLC → Pi | **READ-ONLY** |

---

## Vision Handshake Protocol (PROPER)

### State Machine

```
IDLE → REQUESTED → PROCESSING → COMPLETED → IDLE
```

### Step-by-Step

1. **IDLE STATE**
   - `Camera_Start = FALSE`
   - `Camera_Busy = FALSE`
   - `Camera_Completed = FALSE`

2. **PLC REQUESTS VISION** (IDLE → REQUESTED)
   - PLC sets `DBX26.0 (Camera_Start) = TRUE`

3. **PI ACKNOWLEDGES** (REQUESTED → PROCESSING)
   - Pi detects `Camera_Start == TRUE`
   - Pi sets `DBX26.2 (Camera_Busy) = TRUE`
   - Pi processes vision

4. **PI COMPLETES** (PROCESSING → COMPLETED)
   - Pi writes detection results:
     - `DBX26.4` (Object_Detected)
     - `DBX26.5` (Object_OK)
     - `DBX26.6` (Defect_Detected)
     - `DBX32.0-32.3` (Cube colors)
     - `DBW28` (Object_Number)
     - `DBW30` (Defect_Number)
   - Pi sets `DBX26.3 (Camera_Completed) = TRUE`
   - Pi sets `DBX26.2 (Camera_Busy) = FALSE`

5. **PLC ACKNOWLEDGES** (COMPLETED → IDLE)
   - PLC reads results
   - PLC sets `DBX26.0 (Camera_Start) = FALSE`

6. **PI RESETS** (back to IDLE)
   - Pi detects `Camera_Start == FALSE`
   - Pi sets `DBX26.3 (Camera_Completed) = FALSE`
   - Ready for next cycle

### Critical Rules

- **NEVER write to Camera_Start (DBX26.0)** from Pi - it's PLC-controlled
- **NEVER run vision continuously** unless explicitly in "free-running mode"
- **ALWAYS wait for Start before processing** (unless in free-running mode)
- **ALWAYS set Busy before processing**
- **ALWAYS clear Busy when setting Completed**
- **ALWAYS wait for Start to clear before clearing Completed**

---

## Read-Only Tags (PLC → Pi) ⚠️

Pi must **NEVER** write to these addresses:

```
DBX0.0-0.2    (HMI buttons)
DBX2.2        (Robot_Cycle_Complete)
DBW4,6,8      (Robot target position)
DBX22.0-22.1  (Conveyor1 commands)
DBX24.0-24.1  (Conveyor2 commands)
DBX26.0       (Camera_Start) ⭐ CRITICAL
DBX48.3-48.5  (Gantry commands)
DBD54,58,62,66 (Gantry setpoints)
DBX70.1       (Home_Error_Fix)
DBX86.0-86.2  (HMI overrides)
```

---

## Polling Strategy

### Option A: Single Batch Read (Recommended)
Read all 98 bytes in one operation every 50-100ms:
```python
all_data = plc_client.client.db_read(123, 0, 98)
```

### Option B: Split by Priority
**Fast (50ms):** Bytes 0-33 (HMI, Robot, Camera)
**Slow (500ms):** Bytes 34-97 (Counters, Gantry, System, Pallet)

---

## Implementation Checklist

- [ ] Update config.json byte addresses
- [ ] Update plc_client.py to read 98 bytes
- [ ] Implement proper handshake state machine
- [ ] Remove all direct db_read() calls from endpoints
- [ ] Remove all sleep() delays except in PLC worker
- [ ] Enforce READ-ONLY protection
- [ ] Create single PLC worker thread
- [ ] Implement write queue
- [ ] Add deterministic 50-100ms cycle
- [ ] Test handshake with real PLC

---

## Critical Fixes from Legacy Code

### ❌ OLD (WRONG):
```python
# Writing to byte 40 (doesn't exist in real PLC!)
plc_client.write_vision_tags(..., byte=40)

# Reading Camera_Start from byte 40
start = plc_client.read_db_bool(123, 40, 0)

# Using REAL for robot positions
DBD6, DBD10, DBD14  # Wrong data type!

# Continuous vision processing
if not vision_handshake_processing:
    threading.Thread(target=process_vision).start()
```

### ✅ NEW (CORRECT):
```python
# Camera status is at byte 26 (Camera_UDT)
plc_cache['camera_busy'] = snap7.util.get_bool(all_data, 26, 2)
plc_cache['camera_completed'] = snap7.util.get_bool(all_data, 26, 3)

# Camera_Start is at DBX26.0 (READ-ONLY!)
start = snap7.util.get_bool(all_data, 26, 0)

# Robot positions are INT, not REAL
target_x = snap7.util.get_int(all_data, 4)  # DBW4

# Proper handshake - only process on PLC request
if start and not last_start and not busy:
    # PLC requested vision, start processing
    process_vision()
```

---

## Version History

**v2.1 (2026-03-30):**
- Corrected from actual PLC export (DB123.txt)
- Fixed robot position data types (INT not REAL)
- Fixed byte addresses (Gantry at 48, System at 72, Pallet at 76)
- Added Objects_UDT counters (bytes 36-46)
- Updated total size to 98 bytes
- Added proper handshake protocol state machine

**v2.0:**
- Initial refactoring attempt (had errors)

**v1.0:**
- Legacy implementation (multiple inconsistencies)
