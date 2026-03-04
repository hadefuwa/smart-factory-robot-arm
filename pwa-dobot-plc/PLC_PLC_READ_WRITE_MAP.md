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


### DB123 Layout Reference (current PLC)

Static
- HMI (`HMI_UDT`) @ 0
- Buttons (`Struct`) @ 0
- Start (`Bool`) @ 0
- Stop (`Bool`) @ 0.1
- Reset (`Bool`) @ 0.2

Robot (`Robot_UDT`) @ 2
- Connected (`Bool`) @ 2
- Busy (`Bool`) @ 2.1
- Cycle_Complete (`Bool`) @ 2.2

Target (`Struct`) @ 4
- X_Position target (`Int`) @ 4
- Y_Position target (`Int`) @ 6
- Z_Position target (`Int`) @ 8

Current (`Struct`) @ 10
- X_Position current (`Int`) @ 10
- Y_Position current (`Int`) @ 12
- Z_Position current (`Int`) @ 14

- Robot_Status_Code (`Int`) @ 16
- Error_Code (`Int`) @ 18
- Cube_Type (`Int`) @ 20   (0 None, 1 Reject, 2 Yellow, 3 White, 4 Steel, 5 Alluminium)

Conveyor1 (`Conveyor_UDT`) @ 22
- Start_Command (`Bool`) @ 22
- Stop_Command (`Bool`) @ 22.1

Conveyor2 (`Conveyor_UDT`) @ 24
- Start_Command (`Bool`) @ 24
- Stop_Command (`Bool`) @ 24.1

Camera (`Camera_UDT`) @ 26
- Start (`Bool`) @ 26
- Connected (`Bool`) @ 26.1
- Busy (`Bool`) @ 26.2
- Completed (`Bool`) @ 26.3
- Object_Detected (`Bool`) @ 26.4
- Object_OK (`Bool`) @ 26.5
- Defect_Detected (`Bool`) @ 26.6
- Object_Number (`Int`) @ 28
- Defect_Number (`Int`) @ 30
- yellow_cube_detected (`Bool`) @ 32
- white_cube_detected (`Bool`) @ 32.1
- steel_cube_detected (`Bool`) @ 32.2
- alluminium_cube_detected (`Bool`) @ 32.3
- counter_type_exceeded (`Bool`) @ 32.4

Objects (`Objects_UDT`) @ 34
- Material (`Int`) @ 34   (0 Reject, 1 Inductive, 2 Capacitive, 3 Plastic)

Gantry (`Gantry_UDT`) @ 36
- Home (`Bool`) @ 36
- Busy (`Bool`) @ 36.1
- Move_Done (`Bool`) @ 36.2
- Pick_Up (`Bool`) @ 36.3
- Place_Down (`Bool`) @ 36.4
- Home_Command (`Bool`) @ 36.5
- Power_OK (`Bool`) @ 36.6
- Current_Position (`Real`) @ 38
- Target_Position (`Real`) @ 42
- Velocity (`Real`) @ 46
- Position1 (`Real`) @ 50
- Position2 (`Real`) @ 54
- Home_Error (`Bool`) @ 58
- Home_Error_Fix (`Bool`) @ 58.1

System (`System_UDT`) @ 60
- Safety_OK (`Bool`) @ 60
- No_Faults (`Bool`) @ 60.1
- Active_Fault (`Bool`) @ 60.2
- Startup_Completed (`Bool`) @ 60.3
- State (`Int`) @ 62

Sorted_Bay (`Pallet_UDT`) @ 64
- Row_1 (`Array[0..3] of Bool`) @ 64
  - Row_1[0] (`Bool`) @ 64
  - Row_1[1] (`Bool`) @ 64.1
  - Row_1[2] (`Bool`) @ 64.2
  - Row_1[3] (`Bool`) @ 64.3
- Row_2 (`Array[0..3] of Bool`) @ 66
  - Row_2[0] (`Bool`) @ 66
  - Row_2[1] (`Bool`) @ 66.1
  - Row_2[2] (`Bool`) @ 66.2
  - Row_2[3] (`Bool`) @ 66.3
- Row_3 (`Array[0..3] of Bool`) @ 68
  - Row_3[0] (`Bool`) @ 68
  - Row_3[1] (`Bool`) @ 68.1
  - Row_3[2] (`Bool`) @ 68.2
  - Row_3[3] (`Bool`) @ 68.3
- Row_4 (`Array[0..3] of Bool`) @ 70
  - Row_4[0] (`Bool`) @ 70
  - Row_4[1] (`Bool`) @ 70.1
  - Row_4[2] (`Bool`) @ 70.2
  - Row_4[3] (`Bool`) @ 70.3
- Pallet_Full (`Bool`) @ 72
