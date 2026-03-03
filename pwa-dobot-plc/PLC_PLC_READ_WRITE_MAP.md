## PLC Read/Write Map (Simple)

### Reads

- **DB123**
  - `DB123.DBX26.0` – Start
  - `DB123.DBX26.1` – Connected
  - `DB123.DBX26.2` – Busy
  - `DB123.DBX26.3` – Completed
  - `DB123.DBX26.4` – Object_Detected
  - `DB123.DBX26.5` – Object_OK
  - `DB123.DBX26.6` – Defect_Detected
  - `DB123.DBW28` – Object_Number
  - `DB123.DBW30` – Defect_Number
  - `DB123.DBX32.0` – yellow_cube_detected
  - `DB123.DBX32.1` – white_cube_detected
  - `DB123.DBX32.2` – steel_cube_detected
  - `DB123.DBX32.3` – alluminium_cube_detected
  - `DB123.DBX4.0` – Robot connected
  - `DB123.DBX4.1` – Robot busy
  - `DB123.DBX4.2` – Robot cycle_complete
  - `DB123.DBD6` – Robot target_x
  - `DB123.DBD10` – Robot target_y
  - `DB123.DBD14` – Robot target_z
  - `DB123.DBD18` – Robot current_x
  - `DB123.DBD22` – Robot current_y
  - `DB123.DBD26` – Robot current_z
  - `DB123.DBW30` – Robot status_code
  - `DB123.DBW34` – Robot error_code

- **DB4**
  - `DB4.DBD6` – Target X
  - `DB4.DBD10` – Target Y
  - `DB4.DBD14` – Target Z

- **DB123 (Robot current pose)**
  - `DB123.DBW10` – Current X
  - `DB123.DBW12` – Current Y
  - `DB123.DBW14` – Current Z
  - `DB123.DBX4.0` – Robot connected
  - `DB123.DBX4.1` – Robot busy
  - `DB123.DBX4.2` – Robot cycle_complete
  - `DB123.DBW30` – Robot status_code
  - `DB123.DBW34` – Robot error_code

- **Merker (M)**
  - `M1000.0` – Start
  - `M1000.1` – Stop
  - `M1000.2` – Home
  - `M1000.3` – E‑stop
  - `M1000.4` – Suction
  - `M1000.5` – Ready
  - `M1000.6` – Busy
  - `M1000.7` – Error
  - `M1.0` – Vision fault flag

### Writes

- **DB123**
  - `DB123.DBX26.2` – Busy
  - `DB123.DBX26.3` – Completed
  - `DB123.DBX26.4` – Object_Detected
  - `DB123.DBX26.5` – Object_OK
  - `DB123.DBX26.6` – Defect_Detected
  - `DB123.DBX[connected_byte].[connected_bit]` – Camera connected
  - `DB123.DBX32.0` – yellow_cube_detected
  - `DB123.DBX32.1` – white_cube_detected
  - `DB123.DBX32.2` – steel_cube_detected
  - `DB123.DBX32.3` – alluminium_cube_detected

- **DB123 (Robot current pose)**
  - `DB123.DBW10` – Current X
  - `DB123.DBW12` – Current Y
  - `DB123.DBW14` – Current Z

- **Merker (M)**
  - `M0.0` – Start
  - `M0.1` – Stop
  - `M0.2` – Home
  - `M0.3` – E‑stop
  - `M0.4` – Suction
  - `M0.5` – Ready
  - `M0.6` – Busy
  - `M0.7` – Error
  - `M1.0` – Vision fault flag

## PLC Read/Write Map (Current Behaviour)

This document lists how your app currently **reads from** and **writes to** the Siemens PLC.

Addresses are written in standard Siemens format like `DB123.DBX40.2` (bit), `DB123.DBW42` (word), or `DB4.DBD6` (REAL).

---

### 1. Vision system – DB123

#### 1.1 Reads (from PLC)

- **Function**: `PLCClient.read_vision_tags` (`backend/plc_client.py`)
  - **DB123.DBX26.0** (configurable): **Start command**
    - Read as: `start`  
    - Default: byte `26`, bit `0`
  - **DB123.DBX[connected_byte].[connected_bit]** (configurable): **Camera connected**
    - Read as: `connected`  
    - Defaults in config to byte `26`, bit `1` unless changed.
  - **DB123.DBX40.2**: **Busy**
  - **DB123.DBX40.3**: **Completed**
  - **DB123.DBX40.4**: **Object_Detected**
  - **DB123.DBX40.5**: **Object_OK**
  - **DB123.DBX40.6**: **Defect_Detected**
  - **DB123.DBW42**: **Object_Number** (16‑bit INT)
  - **DB123.DBW44**: **Defect_Number** (16‑bit INT)
  - **DB123.DBX32.0**: **yellow_cube_detected**
  - **DB123.DBX32.1**: **white_cube_detected**
  - **DB123.DBX32.2**: **steel_cube_detected**
  - **DB123.DBX32.3**: **alluminium_cube_detected**

- **Function**: `read_vision_start_command` (`backend/plc_client.py`)
  - **DB123.DBX26.0**: Start command (simple, direct read)

- **Function**: `read_db40_start_bit` (`backend/plc_client.py`)
  - **DB123.DBX26.0**: Start command (debug/diagnostics style read)

- **Function**: PLC polling loop (`backend/app.py`)
  - Reads **DB123 bytes 0–46** in one block:
    - **DB123.DBX[StartByte].[StartBit]** (configurable): cached as `plc_cache['db123']['start']`
    - **DB123.DBX40.2**: cached as `busy`
    - **DB123.DBX40.3**: cached as `complete`
    - **DB123.DBX40.6**: cached as `fault`
    - **DB123.DBW42**: cached as `plc_cache['db123']['counter']`

#### 1.2 Writes (to PLC)

- **Function**: `PLCClient.write_vision_tags` (`backend/plc_client.py`)
  - **DB123.DBX40.1**: **Connected**
  - **DB123.DBX40.2**: **Busy**
  - **DB123.DBX40.3**: **Completed**
  - **DB123.DBX40.4**: **Object_Detected**
  - **DB123.DBX40.5**: **Object_OK**
  - **DB123.DBX40.6**: **Defect_Detected**
  - **Note**: `Object_Number` / `Defect_Number` writes to `DB123.DBW42/DBW44` are **currently disabled** in code.

- **Function**: `PLCClient.write_vision_detection_results` (`backend/plc_client.py`)
  - High‑level helper that **calls `write_vision_tags`**, so it uses the same addresses as above.

- **Function**: `write_vision_to_plc` (`backend/app.py`)
  - Uses **queued writes** executed in the polling loop.
  - Writes **only bits 2–6** of the camera status byte; Start (bit 0) and Connected (bit 1) are preserved.
  - **DB123.DBX26.2**: Busy
  - **DB123.DBX26.3**: Completed
  - **DB123.DBX26.4**: Object_Detected
  - **DB123.DBX26.5**: Object_OK
  - **DB123.DBX26.6**: Defect_Detected
  - **DB123.DBX[connected_byte].[connected_bit]** (configurable): Camera connected
  - **DB123.DBX32.0–32.3**: One‑hot cube color bits (color code)
  - **Note**: The queued writes to `DB123.DBW42` and `DB123.DBW44` (object/defect INTs) are **commented out / disabled**, so they are not active.

- **Function**: PLC polling loop write queue (`backend/app.py`)
  - Executes queued byte and bit writes using:
    - `plc_client.client.db_write(write_op['db'], write_op['offset'], ...)`
    - For bits: it first reads `DBx.DBXbyte` then sets a single bit and writes back.
  - Current queued operations are:
    - Vision status bits (DB123 byte 40)
    - Camera connected configurable bit
    - Cube color bits at DB123.DBX32.0–32.3

---

### 2. Robot (Dobot) – DB4 (mapped into DB123 layout)

These are **logically “DB4”** in the app, but in your newer layout they are actually **read from DB123** bytes and then mapped into a `plc_cache['db4']` structure.

#### 2.1 Reads (from PLC)

- **Function**: `PLCClient.read_target_pose` (`backend/plc_client.py`)
  - Default `db_number = 4`:
    - **DB4.DBD6**: Target X (REAL)
    - **DB4.DBD10**: Target Y (REAL)
    - **DB4.DBD14**: Target Z (REAL)

- **Function**: `PLCClient.read_current_pose` (`backend/plc_client.py`)
  - Default `db_number = 4`:
    - **DB4.DBD18**: Current X (REAL)
    - **DB4.DBD22**: Current Y (REAL)
    - **DB4.DBD26**: Current Z (REAL)

- **Function**: `PLCClient.read_robot_status` (`backend/plc_client.py`)
  - Default `db_number = 4`:
    - **DB4.DBX4.0**: Connected
    - **DB4.DBX4.1**: Busy
    - **DB4.DBX4.2**: Cycle complete
    - **DB4.DBW30**: Status code (INT)
    - **DB4.DBW32**: Error code (INT)

- **Function**: PLC polling loop (`backend/app.py`)
  - Reads data from **DB123** and maps into `plc_cache['db4']`:
    - **DB123.DBX4.0** → `db4.connected`
    - **DB123.DBX4.1** → `db4.busy`
    - **DB123.DBX4.2** → `db4.cycle_complete`
    - **DB123.DBD6** → `db4.target_x`
    - **DB123.DBD10** → `db4.target_y`
    - **DB123.DBD14** → `db4.target_z`
    - **DB123.DBD18** → `db4.current_x`
    - **DB123.DBD22** → `db4.current_y`
    - **DB123.DBD26** → `db4.current_z`
    - **DB123.DBW30** → `db4.status_code`
    - **DB123.DBW34** → `db4.error_code` (status/error cache)

#### 2.2 Writes (to PLC)

- **Function**: `PLCClient.write_current_pose` (`backend/plc_client.py`)
  - Default `db_number = 4`:
    - **DB4.DBD18**: Current X (REAL)
    - **DB4.DBD22**: Current Y (REAL)
    - **DB4.DBD26**: Current Z (REAL)

---

### 3. Control bits – Merker (M) memory

#### 3.1 Reads (from PLC)

- **Function**: `PLCClient.read_control_bits` (`backend/plc_client.py`)
  - Reads **M0 byte** and breaks out bits:
    - **M0.0**: Start
    - **M0.1**: Stop
    - **M0.2**: Home
    - **M0.3**: E‑stop
    - **M0.4**: Suction
    - **M0.5**: Ready
    - **M0.6**: Busy
    - **M0.7**: Error

#### 3.2 Writes (to PLC)

- **Function**: `PLCClient.write_control_bit` (`backend/plc_client.py`)
  - Uses `write_m_bit` to write individual control bits:
    - **M0.0**: Start
    - **M0.1**: Stop
    - **M0.2**: Home
    - **M0.3**: E‑stop
    - **M0.4**: Suction
    - **M0.5**: Ready
    - **M0.6**: Busy
    - **M0.7**: Error

- **Function**: `write_vision_fault_bit` (`backend/plc_client.py`)
  - Default address:
    - **M1.0**: Vision fault flag (`defects_found`)

---

### 4. Summary (high level)

- **DB123**:
  - Reads: Start, vision status bits, object/defect counters, color bits, robot status/pose (remapped).
  - Writes: Vision handshake bits (busy/completed/etc.), camera connected bit, color bits.
  - **Object_Number / Defect_Number writes to DBW42 / DBW44 are currently disabled.**
- **DB4**:
  - Reads: Robot pose and status (in older layout or via remap).
  - Writes: Current pose when needed.
- **Merker M**:
  - Reads/Writes: Control bits on `M0.x` and a vision fault flag on `M1.0`.

