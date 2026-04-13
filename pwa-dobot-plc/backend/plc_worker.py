"""
PLC Worker Thread - Clean Architecture

Single dedicated thread that:
1. Reads the main PLC DB and camera PLC DB in batch operations every 50-100ms
2. Updates shared cache (thread-safe)
3. Processes write queue (coalesced at end of cycle)
4. Implements proper vision handshake state machine
5. NO scattered sleep() delays - deterministic cycle timing

All application code reads from cache ONLY, never calls client.db_read() directly.
All writes go through queue_write(), executed in batch at cycle end.
"""

import time
import threading
import logging
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
from enum import Enum
import snap7
from snap7.util import get_bool, get_int, get_real, set_bool, set_real

logger = logging.getLogger(__name__)

MAIN_DB_DEFAULTS = {
    'hmi_start': {'byte': 0, 'bit': 0, 'kind': 'bool'},
    'hmi_stop': {'byte': 0, 'bit': 1, 'kind': 'bool'},
    'hmi_reset': {'byte': 0, 'bit': 2, 'kind': 'bool'},
    'material_type': {'byte': 2, 'kind': 'int'},
    'quarantined_count': {'byte': 4, 'kind': 'int'},
    'defect_count': {'byte': 6, 'kind': 'int'},
    'aluminum_count': {'byte': 8, 'kind': 'int'},
    'steel_count': {'byte': 10, 'kind': 'int'},
    'yellow_count': {'byte': 12, 'kind': 'int'},
    'white_count': {'byte': 14, 'kind': 'int'},
    'gantry_home': {'byte': 16, 'bit': 0, 'kind': 'bool'},
    'gantry_busy': {'byte': 16, 'bit': 1, 'kind': 'bool'},
    'gantry_move_done': {'byte': 16, 'bit': 2, 'kind': 'bool'},
    'gantry_pick_up': {'byte': 16, 'bit': 3, 'kind': 'bool'},
    'gantry_place_down': {'byte': 16, 'bit': 4, 'kind': 'bool'},
    'gantry_home_command': {'byte': 16, 'bit': 5, 'kind': 'bool'},
    'gantry_power_ok': {'byte': 16, 'bit': 6, 'kind': 'bool'},
    'gantry_current_position': {'byte': 18, 'kind': 'real'},
    'gantry_target_position': {'byte': 22, 'kind': 'real'},
    'gantry_velocity': {'byte': 26, 'kind': 'real'},
    'gantry_position1': {'byte': 30, 'kind': 'real'},
    'gantry_position2': {'byte': 34, 'kind': 'real'},
    'gantry_home_error': {'byte': 38, 'bit': 0, 'kind': 'bool'},
    'gantry_home_error_fix': {'byte': 38, 'bit': 1, 'kind': 'bool'},
    'system_safety_ok': {'byte': 40, 'bit': 0, 'kind': 'bool'},
    'system_no_faults': {'byte': 40, 'bit': 1, 'kind': 'bool'},
    'system_active_fault': {'byte': 40, 'bit': 2, 'kind': 'bool'},
    'system_state': {'byte': 42, 'kind': 'int'},
    'system_startup_completed': {'byte': 44, 'bit': 0, 'kind': 'bool'},
    'cube_in_quarantine': {'byte': 44, 'bit': 1, 'kind': 'bool'},
    'pickup_location_x': {'byte': 46, 'kind': 'int'},
    'pickup_location_y': {'byte': 48, 'kind': 'int'},
    'pickup_location_z': {'byte': 50, 'kind': 'int'},
    'quarantine_location_x': {'byte': 52, 'kind': 'int'},
    'quarantine_location_y': {'byte': 54, 'kind': 'int'},
    'quarantine_location_z': {'byte': 56, 'kind': 'int'},
    'pallet_home_x': {'byte': 58, 'kind': 'int'},
    'pallet_home_y': {'byte': 60, 'kind': 'int'},
    'pallet_home_z': {'byte': 62, 'kind': 'int'},
    'pallet_row1': {'byte': 64, 'kind': 'row', 'width': 3},
    'pallet_row2': {'byte': 66, 'kind': 'row', 'width': 3},
    'pallet_row3': {'byte': 68, 'kind': 'row', 'width': 3},
    'pallet_row4': {'byte': 70, 'kind': 'row', 'width': 3},
    'pallet_full': {'byte': 72, 'bit': 0, 'kind': 'bool'},
    'conveyor1_override': {'byte': 74, 'bit': 0, 'kind': 'bool'},
    'conveyor2_override': {'byte': 74, 'bit': 1, 'kind': 'bool'},
    'linear_override': {'byte': 74, 'bit': 2, 'kind': 'bool'},
    'confirm_reset': {'byte': 74, 'bit': 3, 'kind': 'bool'},
}

CAMERA_DB_DEFAULTS = {
    'start': {'byte': 0, 'bit': 0, 'kind': 'bool'},
    'connected': {'byte': 0, 'bit': 1, 'kind': 'bool'},
    'busy': {'byte': 0, 'bit': 2, 'kind': 'bool'},
    'completed': {'byte': 0, 'bit': 3, 'kind': 'bool'},
    'defect_detected': {'byte': 0, 'bit': 6, 'kind': 'bool'},
    'reject_command_from_plc': {'byte': 0, 'bit': 5, 'kind': 'bool'},
    'yellow_cube_detected': {'byte': 0, 'bit': 6, 'kind': 'bool'},
    'white_cube_detected': {'byte': 0, 'bit': 7, 'kind': 'bool'},
    'metal_cube_detected': {'byte': 1, 'bit': 0, 'kind': 'bool'},
}

ROBOT_DB_DEFAULTS = {
    'connected':              {'byte': 0,  'bit': 0, 'kind': 'bool'},
    'busy':                   {'byte': 0,  'bit': 1, 'kind': 'bool'},
    'move_complete':          {'byte': 0,  'bit': 2, 'kind': 'bool'},
    'at_home':                {'byte': 0,  'bit': 3, 'kind': 'bool'},
    'at_pickup_position':     {'byte': 0,  'bit': 4, 'kind': 'bool'},
    'at_pallet_position':     {'byte': 0,  'bit': 5, 'kind': 'bool'},
    'at_quarantine_position': {'byte': 0,  'bit': 6, 'kind': 'bool'},
    'gripper_active':         {'byte': 0,  'bit': 7, 'kind': 'bool'},
    'cycle_complete':         {'byte': 1,  'bit': 0, 'kind': 'bool'},
    'invalid_target':         {'byte': 1,  'bit': 1, 'kind': 'bool'},
    'any_moving':             {'byte': 2,  'bit': 0, 'kind': 'bool'},
    'any_overload':           {'byte': 2,  'bit': 1, 'kind': 'bool'},
    'any_undervoltage':       {'byte': 2,  'bit': 2, 'kind': 'bool'},
    'any_overtemp':           {'byte': 2,  'bit': 3, 'kind': 'bool'},
    'max_temperature':        {'byte': 2,  'bit': 4, 'kind': 'bool'},
    'min_voltage':            {'byte': 2,  'bit': 5, 'kind': 'bool'},
    'max_load_pct':           {'byte': 2,  'bit': 6, 'kind': 'bool'},
    'x_position':             {'byte': 4,  'kind': 'int'},
    'y_position':             {'byte': 6,  'kind': 'int'},
    'z_position':             {'byte': 8,  'kind': 'int'},
    'home_command':           {'byte': 10, 'bit': 0, 'kind': 'bool'},
    'pickup_command':         {'byte': 10, 'bit': 1, 'kind': 'bool'},
    'speed':                  {'byte': 12, 'kind': 'int'},
    'target_x':               {'byte': 14, 'kind': 'int'},
    'target_y':               {'byte': 16, 'kind': 'int'},
    'target_z':               {'byte': 18, 'kind': 'int'},
}


# ============================================================================
# Vision Handshake State Machine
# ============================================================================

class VisionState(Enum):
    """Vision system state machine states"""
    IDLE = "idle"                    # Waiting for PLC start signal
    REQUESTED = "requested"          # PLC set start=TRUE, waiting for Pi to acknowledge
    PROCESSING = "processing"        # Pi processing vision (busy=TRUE)
    COMPLETED = "completed"          # Pi finished (completed=TRUE), waiting for PLC to clear start


@dataclass
class VisionHandshakeState:
    """Vision handshake state tracking"""
    state: VisionState = VisionState.IDLE
    last_start_bit: bool = False
    processing_thread: Optional[threading.Thread] = None


# ============================================================================
# Write Queue Entry
# ============================================================================

@dataclass
class PLCWrite:
    """Queued PLC write operation"""
    db: int
    offset: int
    data: bytearray
    description: str = ""


# ============================================================================
# PLC Worker Class
# ============================================================================

class PLCWorker:
    """
    Single-threaded PLC communication worker with clean architecture.

    Architecture principles:
    - One worker thread, one snap7 client
    - Deterministic cycle time (configurable, default 100ms)
    - Batch reads at cycle start from the main DB and camera DB
    - Batch writes at cycle end (coalesced from queue)
    - All app code reads from cache, never touches snap7 client
    - All app code writes via queue, never touches snap7 client
    """

    def __init__(
        self,
        plc_ip: str = '192.168.7.2',
        rack: int = 0,
        slot: int = 1,
        cycle_time_ms: int = 100,
        main_db_config: Optional[Dict[str, Any]] = None,
        camera_db_config: Optional[Dict[str, Any]] = None,
        robot_db_config: Optional[Dict[str, Any]] = None,
        camera_service=None,
        vision_processor_callback=None
    ):
        """
        Initialize PLC worker.

        Args:
            plc_ip: PLC IP address
            rack: PLC rack (0 for S7-1200)
            slot: PLC slot (1 for S7-1200)
            cycle_time_ms: Target cycle time in milliseconds (50-200ms recommended)
            main_db_config: Runtime main DB mapping config
            camera_db_config: Runtime camera DB mapping config
            camera_service: Camera service instance for connected status
            vision_processor_callback: Callback function(cache_snapshot) to process vision
        """
        self.plc_ip = plc_ip
        self.rack = rack
        self.slot = slot
        self.cycle_time_ms = cycle_time_ms
        self.cycle_time_sec = cycle_time_ms / 1000.0
        self.main_db_number = 123
        self.main_db_total_size = 75
        self.main_db_tags = {}
        self.camera_db_number = 124
        self.camera_db_total_size = 2
        self.camera_db_tags = {}
        self.robot_db_number = 125
        self.robot_db_total_size = 20
        self.robot_db_tags = {}

        self.camera_service = camera_service
        self.vision_processor_callback = vision_processor_callback
        self.update_db_configs(main_db_config or {}, camera_db_config or {}, robot_db_config or {})

        # Snap7 client (owned exclusively by worker thread)
        self.client: Optional[snap7.client.Client] = None
        self.connected = False
        self.last_connection_attempt = 0
        self.connection_retry_interval = 5.0  # seconds

        # Shared cache (read by all, written only by worker)
        self.cache_lock = threading.Lock()
        self.cache: Dict[str, Any] = self._create_empty_cache()

        # Write queue (written by all, read only by worker)
        self.write_queue_lock = threading.Lock()
        self.write_queue: List[PLCWrite] = []

        # Vision handshake state
        self.vision_state = VisionHandshakeState()

        # Worker thread control
        self.worker_thread: Optional[threading.Thread] = None
        self.running = False
        self.stop_event = threading.Event()

        # Called with no args whenever the PLC reconnects after a dropout
        self.on_plc_reconnect = None
        self.robot_connected_provider = None

        # Statistics
        self.stats = {
            'cycles': 0,
            'read_errors': 0,
            'write_errors': 0,
            'avg_cycle_time_ms': 0.0,
            'max_cycle_time_ms': 0.0,
        }

    def update_db_configs(self, main_db_config: Dict[str, Any], camera_db_config: Dict[str, Any], robot_db_config: Dict[str, Any]):
        """Update runtime DB mappings used by the worker."""
        main_db_config = main_db_config or {}
        camera_db_config = camera_db_config or {}
        robot_db_config = robot_db_config or {}
        self.main_db_number = int(main_db_config.get('db_number', 123))
        self.main_db_total_size = max(1, int(main_db_config.get('total_size', 75)))
        self.main_db_tags = self._build_tag_config(main_db_config.get('tags', {}), MAIN_DB_DEFAULTS)
        self.camera_db_number = int(camera_db_config.get('db_number', 124))
        self.camera_db_total_size = max(1, int(camera_db_config.get('total_size', 2)))
        self.camera_db_tags = self._build_tag_config(camera_db_config.get('tags', {}), CAMERA_DB_DEFAULTS)
        self.robot_db_number = int(robot_db_config.get('db_number', 125))
        self.robot_db_total_size = max(20, int(robot_db_config.get('total_size', 20)))
        self.robot_db_tags = self._build_tag_config(robot_db_config.get('tags', {}), ROBOT_DB_DEFAULTS)
        logger.info(
            "Updated PLC mappings: main DB%s size=%s, camera DB%s size=%s, robot DB%s size=%s",
            self.main_db_number,
            self.main_db_total_size,
            self.camera_db_number,
            self.camera_db_total_size,
            self.robot_db_number,
            self.robot_db_total_size,
        )

    def update_connection_settings(self, plc_ip: str, rack: int, slot: int):
        """Update PLC network settings and force the worker to reconnect."""
        new_ip = str(plc_ip or self.plc_ip)
        new_rack = int(rack)
        new_slot = int(slot)
        changed = (
            new_ip != self.plc_ip or
            new_rack != self.rack or
            new_slot != self.slot
        )

        self.plc_ip = new_ip
        self.rack = new_rack
        self.slot = new_slot

        if not changed:
            return

        logger.info(
            "PLC connection settings updated: ip=%s rack=%s slot=%s",
            self.plc_ip,
            self.rack,
            self.slot,
        )

        if self.client:
            try:
                self.client.disconnect()
            except Exception:
                pass

        self.connected = False
        self.last_connection_attempt = 0

    def update_db123_config(self, db123_config: Dict[str, Any]):
        """Backward-compatible shim: update camera mapping from a DB123-style config."""
        self.update_db_configs(
            {'db_number': self.main_db_number, 'total_size': self.main_db_total_size},
            db123_config,
            {'db_number': self.robot_db_number, 'total_size': self.robot_db_total_size}
        )

    def _build_tag_config(self, tags: Dict[str, Any], defaults: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, int]]:
        """Normalize configured DB tag offsets."""
        normalized = {}
        for tag_name, default in defaults.items():
            raw = tags.get(tag_name, {}) if isinstance(tags.get(tag_name, {}), dict) else {}
            entry = {'byte': int(raw.get('byte', default['byte']))}
            if 'bit' in default:
                entry['bit'] = int(raw.get('bit', default['bit']))
            entry['kind'] = default.get('kind')
            if 'width' in default:
                entry['width'] = int(raw.get('width', default['width']))
            normalized[tag_name] = entry
        return normalized

    def _main_bit(self, data: bytearray, tag_name: str, fallback: bool = False) -> bool:
        tag = self.main_db_tags.get(tag_name)
        if not tag or 'bit' not in tag:
            return fallback
        return get_bool(data, tag['byte'], tag['bit'])

    def _main_int(self, data: bytearray, tag_name: str, fallback: int = 0) -> int:
        tag = self.main_db_tags.get(tag_name)
        if not tag:
            return fallback
        return get_int(data, tag['byte'])

    def _main_real(self, data: bytearray, tag_name: str, fallback: float = 0.0) -> float:
        tag = self.main_db_tags.get(tag_name)
        if not tag:
            return fallback
        return get_real(data, tag['byte'])

    def _main_row(self, data: bytearray, tag_name: str) -> List[bool]:
        tag = self.main_db_tags.get(tag_name)
        if not tag:
            return [False, False, False]
        width = max(1, int(tag.get('width', 3)))
        return [get_bool(data, tag['byte'], i) for i in range(width)]

    def _camera_bit(self, data: bytearray, tag_name: str, fallback: bool = False) -> bool:
        tag = self.camera_db_tags.get(tag_name)
        if not tag or 'bit' not in tag:
            return fallback
        return get_bool(data, tag['byte'], tag['bit'])

    def _camera_int(self, data: bytearray, tag_name: str, fallback: int = 0) -> int:
        tag = self.camera_db_tags.get(tag_name)
        if not tag:
            return fallback
        return get_int(data, tag['byte'])

    def _robot_bit(self, data: bytearray, tag_name: str, fallback: bool = False) -> bool:
        tag = self.robot_db_tags.get(tag_name)
        if not tag or 'bit' not in tag:
            return fallback
        return get_bool(data, tag['byte'], tag['bit'])

    def _robot_int(self, data: bytearray, tag_name: str, fallback: int = 0) -> int:
        tag = self.robot_db_tags.get(tag_name)
        if not tag:
            return fallback
        return get_int(data, tag['byte'])

    def _create_empty_cache(self) -> Dict[str, Any]:
        """Create empty cache structure matching the combined main/camera PLC layout."""
        return {
            # Meta
            'connected': False,
            'last_update': 0.0,
            'cycle_count': 0,

            # HMI & Buttons (byte 0-1)
            'hmi_start': False,
            'hmi_stop': False,
            'hmi_reset': False,

            # Camera & Vision
            'camera_start': False,        # READ-ONLY (PLC → Pi)
            'camera_connected': False,
            'camera_busy': False,
            'camera_completed': False,
            'defect_detected': False,
            'reject_command_from_plc': False,
            'yellow_cube_detected': False,
            'white_cube_detected': False,
            'metal_cube_detected': False,

            # Robot arm PLC DB125
            'db125_connected': False,
            'db125_busy': False,
            'db125_move_complete': False,
            'db125_at_home': False,
            'db125_at_pickup_position': False,
            'db125_at_pallet_position': False,
            'db125_at_quarantine_position': False,
            'db125_gripper_active': False,
            'db125_cycle_complete': False,
            'db125_invalid_target': False,
            'db125_x_position': 0,
            'db125_y_position': 0,
            'db125_z_position': 0,
            'db125_home_command': False,
            'db125_pickup_command': False,
            'db125_speed': 0,
            'db125_target_x': 0,
            'db125_target_y': 0,
            'db125_target_z': 0,
            'db125_any_moving': False,
            'db125_any_overload': False,
            'db125_any_undervoltage': False,
            'db125_any_overtemp': False,
            'db125_max_temperature': False,
            'db125_min_voltage': False,
            'db125_max_load_pct': False,

            # Objects & Counters (byte 34-47)
            'material_type': 0,
            'quarantined_count': 0,
            'defect_count': 0,
            'aluminum_count': 0,
            'steel_count': 0,
            'yellow_count': 0,
            'white_count': 0,

            # Gantry (byte 48-71)
            'gantry_home': False,
            'gantry_busy': False,
            'gantry_move_done': False,
            'gantry_pick_up': False,       # READ-ONLY (PLC → Pi)
            'gantry_place_down': False,    # READ-ONLY (PLC → Pi)
            'gantry_home_command': False,  # READ-ONLY (PLC → Pi)
            'gantry_power_ok': False,
            'gantry_current_position': 0.0,
            'gantry_target_position': 0.0,
            'gantry_velocity': 0.0,
            'gantry_position1': 0.0,
            'gantry_position2': 0.0,
            'gantry_home_error': False,
            'gantry_home_error_fix': False,  # READ-ONLY (PLC → Pi)

            # System (byte 72-75)
            'system_safety_ok': False,
            'system_no_faults': False,
            'system_active_fault': False,
            'system_startup_completed': False,
            'system_state': 0,
            'cube_in_quarantine': False,
            'pickup_location_x': 0,
            'pickup_location_y': 0,
            'pickup_location_z': 0,
            'quarantine_location_x': 0,
            'quarantine_location_y': 0,
            'quarantine_location_z': 0,
            'pallet_home_x': 0,
            'pallet_home_y': 0,
            'pallet_home_z': 0,

            # Pallet (byte 76-85)
            'pallet_row1': [False] * 3,
            'pallet_row2': [False] * 3,
            'pallet_row3': [False] * 3,
            'pallet_row4': [False] * 3,
            'pallet_full': False,

            # HMI Overrides (byte 86-87)
            'conveyor1_override': False,  # READ-ONLY (PLC → Pi)
            'conveyor2_override': False,  # READ-ONLY (PLC → Pi)
            'linear_override': False,     # READ-ONLY (PLC → Pi)
            'confirm_reset': False,
        }

    def start(self):
        """Start the PLC worker thread"""
        if self.running:
            logger.warning("PLC worker already running")
            return

        logger.info(f"Starting PLC worker thread (cycle time: {self.cycle_time_ms}ms)")
        self.running = True
        self.stop_event.clear()
        self.worker_thread = threading.Thread(target=self._worker_loop, daemon=True, name="PLCWorker")
        self.worker_thread.start()

    def stop(self):
        """Stop the PLC worker thread"""
        if not self.running:
            return

        logger.info("Stopping PLC worker thread...")
        self.running = False
        self.stop_event.set()

        if self.worker_thread:
            self.worker_thread.join(timeout=5.0)

        if self.client:
            try:
                self.client.disconnect()
            except:
                pass

        logger.info("PLC worker stopped")

    def queue_write(self, db: int, offset: int, data: bytearray, description: str = ""):
        """
        Queue a write operation to be executed in the next PLC cycle.

        This is the ONLY way application code should write to the PLC.
        Never call snap7 client directly.

        Args:
            db: Data block number (usually 123)
            offset: Byte offset
            data: Data to write (bytearray)
            description: Human-readable description for logging
        """
        write = PLCWrite(db=db, offset=offset, data=data, description=description)
        with self.write_queue_lock:
            self.write_queue.append(write)

    def get_cache_snapshot(self) -> Dict[str, Any]:
        """
        Get a thread-safe copy of the current cache.

        This is the ONLY way application code should read PLC data.
        Never call snap7 client directly.

        Returns:
            Deep copy of cache dict
        """
        with self.cache_lock:
            return self.cache.copy()

    def get_cache_value(self, key: str, default=None):
        """Get a single value from cache (thread-safe)"""
        with self.cache_lock:
            return self.cache.get(key, default)

    def queue_vision_result(
        self,
        defect_detected: bool,
        yellow: bool = False,
        white: bool = False,
        steel: bool = False,
        aluminum: bool = False,
    ):
        """
        Helper method for vision callbacks to write results.

        This is the ONLY way vision callbacks should write to PLC.
        Never access worker.client directly!

        Args:
            defect_detected: Defect/reject detected
            yellow/white/steel/aluminum: Cube color flags
        """
        self._pending_vision_result = {
            'defect_detected': defect_detected,
            'yellow': yellow,
            'white': white,
            'steel': steel,
            'aluminum': aluminum,
        }

    def _finalize_vision_result(self):
        """
        Internal: Finalize pending vision result (called from worker thread only).
        Writes the current 2-byte DB124 status/color layout.
        """
        if not hasattr(self, '_pending_vision_result') or self._pending_vision_result is None:
            return

        result = self._pending_vision_result
        self._pending_vision_result = None

        try:
            status_byte_offset = self.camera_db_tags['busy']['byte']
            current_byte = self.client.db_read(self.camera_db_number, status_byte_offset, 1)
            status_byte = bytearray(current_byte)
            set_bool(status_byte, 0, self.camera_db_tags['busy']['bit'], False)
            set_bool(status_byte, 0, self.camera_db_tags['completed']['bit'], True)
            set_bool(status_byte, 0, self.camera_db_tags['defect_detected']['bit'], result['defect_detected'])
            set_bool(status_byte, 0, self.camera_db_tags['yellow_cube_detected']['bit'], result['yellow'])
            set_bool(status_byte, 0, self.camera_db_tags['white_cube_detected']['bit'], result['white'])
            self.queue_write(self.camera_db_number, status_byte_offset, status_byte, "Vision status")

            metal_byte_offset = self.camera_db_tags['metal_cube_detected']['byte']
            try:
                metal_byte = bytearray(self.client.db_read(self.camera_db_number, metal_byte_offset, 1))
            except Exception:
                metal_byte = bytearray(1)
            set_bool(
                metal_byte,
                0,
                self.camera_db_tags['metal_cube_detected']['bit'],
                bool(result['steel'] or result['aluminum'])
            )
            self.queue_write(self.camera_db_number, metal_byte_offset, metal_byte, "Vision metal status")

            logger.info(
                "Vision result finalized: defect=%s yellow=%s white=%s metal=%s",
                result['defect_detected'],
                result['yellow'],
                result['white'],
                bool(result['steel'] or result['aluminum'])
            )

        except Exception as e:
            logger.error(f"Error finalizing vision result: {e}", exc_info=True)

    def _connect(self) -> bool:
        """Attempt to connect to PLC (called by worker thread only)"""
        current_time = time.time()

        # Rate limiting
        if (current_time - self.last_connection_attempt) < self.connection_retry_interval:
            return self.connected

        self.last_connection_attempt = current_time

        try:
            # Create client if needed
            if self.client is None:
                self.client = snap7.client.Client()

            # Try to connect
            if not self.client.get_connected():
                logger.info(f"Connecting to PLC at {self.plc_ip}...")
                self.client.connect(self.plc_ip, self.rack, self.slot)

            # Verify connection
            if self.client.get_connected():
                if not self.connected:
                    logger.info(f"✅ Connected to PLC at {self.plc_ip}")
                self.connected = True
                return True
            else:
                self.connected = False
                return False

        except Exception as e:
            if self.connected:
                logger.error(f"PLC connection lost: {e}")
            self.connected = False
            return False

    def _drop_client(self):
        """Force the snap7 client into a clean disconnected state."""
        self.connected = False
        try:
            if self.client is not None:
                self.client.disconnect()
        except Exception:
            pass
        finally:
            self.client = None

    def _worker_loop(self):
        """Main worker loop - runs in dedicated thread"""
        logger.info(f"PLC worker loop started (target cycle: {self.cycle_time_ms}ms)")
        _prev_plc_connected = False

        while self.running and not self.stop_event.is_set():
            cycle_start = time.perf_counter()

            try:
                # 1. Check/establish connection
                if not self._connect():
                    _prev_plc_connected = False
                    with self.cache_lock:
                        self.cache['connected'] = False
                    time.sleep(1.0)  # Wait before retry
                    continue

                with self.cache_lock:
                    self.cache['connected'] = True

                # Fire reconnect callback on False→True transition
                if not _prev_plc_connected:
                    if callable(self.on_plc_reconnect):
                        try:
                            self.on_plc_reconnect()
                        except Exception as _cb_err:
                            logger.warning(f"on_plc_reconnect callback error: {_cb_err}")
                _prev_plc_connected = True

                # 2. BATCH READS - main DB, camera DB, and robot DB
                try:
                    main_data = self.client.db_read(self.main_db_number, 0, self.main_db_total_size)
                    camera_data = self.client.db_read(self.camera_db_number, 0, self.camera_db_total_size)
                    robot_data = self.client.db_read(self.robot_db_number, 0, self.robot_db_total_size)
                    self._decode_main_db(main_data)
                    self._decode_camera_db(camera_data)
                    self._decode_robot_db(robot_data)
                    with self.cache_lock:
                        self.cache['last_update'] = time.time()
                        self.cache['cycle_count'] += 1
                except Exception as e:
                    logger.error(f"PLC DB read error: {e}", exc_info=True)
                    self.stats['read_errors'] += 1
                    # Mark as disconnected so the reconnect callback fires when reads recover
                    _prev_plc_connected = False
                    self._drop_client()
                    with self.cache_lock:
                        self.cache['connected'] = False
                    time.sleep(0.5)
                    continue

                # 3. UPDATE CAMERA/ROBOT CONNECTED STATUS
                self._update_camera_connected()
                self._update_robot_connected()

                # 4. VISION HANDSHAKE STATE MACHINE
                self._process_vision_handshake()

                # 5. FINALIZE PENDING VISION RESULTS (if any)
                self._finalize_vision_result()

                # 6. BATCH WRITE - process all queued writes
                self._process_write_queue()

                # 6. UPDATE STATS
                cycle_end = time.perf_counter()
                cycle_time_ms = (cycle_end - cycle_start) * 1000.0
                self.stats['cycles'] += 1
                self.stats['avg_cycle_time_ms'] = (
                    (self.stats['avg_cycle_time_ms'] * (self.stats['cycles'] - 1) + cycle_time_ms)
                    / self.stats['cycles']
                )
                self.stats['max_cycle_time_ms'] = max(self.stats['max_cycle_time_ms'], cycle_time_ms)

                # Log slow cycles
                if cycle_time_ms > (self.cycle_time_ms * 1.5):
                    logger.warning(f"Slow PLC cycle: {cycle_time_ms:.1f}ms (target: {self.cycle_time_ms}ms)")

                # 7. SLEEP TO MAINTAIN DETERMINISTIC CYCLE TIME
                sleep_time = self.cycle_time_sec - (cycle_end - cycle_start)
                if sleep_time > 0:
                    time.sleep(sleep_time)
                else:
                    # Cycle overrun - no sleep
                    logger.debug(f"PLC cycle overrun by {-sleep_time*1000:.1f}ms")

            except Exception as e:
                logger.error(f"PLC worker loop error: {e}", exc_info=True)
                _prev_plc_connected = False
                self._drop_client()
                with self.cache_lock:
                    self.cache['connected'] = False
                time.sleep(0.5)  # Brief delay before retry

        logger.info("PLC worker loop exited")

    def _decode_main_db(self, data: bytearray):
        """Decode the main PLC DB into cache (called by worker thread only)."""
        with self.cache_lock:
            self.cache['hmi_start'] = self._main_bit(data, 'hmi_start')
            self.cache['hmi_stop'] = self._main_bit(data, 'hmi_stop')
            hmi_reset = self._main_bit(data, 'hmi_reset')
            self.cache['hmi_reset'] = hmi_reset

        # Notify fault manager of hmi_reset state (rising-edge detection inside)
        try:
            from plc_integration import on_hmi_reset
            on_hmi_reset(hmi_reset)
        except Exception:
            pass

        with self.cache_lock:

            self.cache['material_type'] = self._main_int(data, 'material_type')
            self.cache['quarantined_count'] = self._main_int(data, 'quarantined_count')
            self.cache['defect_count'] = self._main_int(data, 'defect_count')
            self.cache['aluminum_count'] = self._main_int(data, 'aluminum_count')
            self.cache['steel_count'] = self._main_int(data, 'steel_count')
            self.cache['yellow_count'] = self._main_int(data, 'yellow_count')
            self.cache['white_count'] = self._main_int(data, 'white_count')

            self.cache['gantry_home'] = self._main_bit(data, 'gantry_home')
            self.cache['gantry_busy'] = self._main_bit(data, 'gantry_busy')
            self.cache['gantry_move_done'] = self._main_bit(data, 'gantry_move_done')
            self.cache['gantry_pick_up'] = self._main_bit(data, 'gantry_pick_up')
            self.cache['gantry_place_down'] = self._main_bit(data, 'gantry_place_down')
            self.cache['gantry_home_command'] = self._main_bit(data, 'gantry_home_command')
            self.cache['gantry_power_ok'] = self._main_bit(data, 'gantry_power_ok')
            self.cache['gantry_current_position'] = self._main_real(data, 'gantry_current_position')
            self.cache['gantry_target_position'] = self._main_real(data, 'gantry_target_position')
            self.cache['gantry_velocity'] = self._main_real(data, 'gantry_velocity')
            self.cache['gantry_position1'] = self._main_real(data, 'gantry_position1')
            self.cache['gantry_position2'] = self._main_real(data, 'gantry_position2')
            self.cache['gantry_home_error'] = self._main_bit(data, 'gantry_home_error')
            self.cache['gantry_home_error_fix'] = self._main_bit(data, 'gantry_home_error_fix')

            self.cache['system_safety_ok'] = self._main_bit(data, 'system_safety_ok')
            self.cache['system_no_faults'] = self._main_bit(data, 'system_no_faults')
            self.cache['system_active_fault'] = self._main_bit(data, 'system_active_fault')
            self.cache['system_startup_completed'] = self._main_bit(data, 'system_startup_completed')
            self.cache['system_state'] = self._main_int(data, 'system_state')
            self.cache['cube_in_quarantine'] = self._main_bit(data, 'cube_in_quarantine')
            self.cache['pickup_location_x'] = self._main_int(data, 'pickup_location_x')
            self.cache['pickup_location_y'] = self._main_int(data, 'pickup_location_y')
            self.cache['pickup_location_z'] = self._main_int(data, 'pickup_location_z')
            self.cache['quarantine_location_x'] = self._main_int(data, 'quarantine_location_x')
            self.cache['quarantine_location_y'] = self._main_int(data, 'quarantine_location_y')
            self.cache['quarantine_location_z'] = self._main_int(data, 'quarantine_location_z')
            self.cache['pallet_home_x'] = self._main_int(data, 'pallet_home_x')
            self.cache['pallet_home_y'] = self._main_int(data, 'pallet_home_y')
            self.cache['pallet_home_z'] = self._main_int(data, 'pallet_home_z')

            self.cache['pallet_row1'] = self._main_row(data, 'pallet_row1')
            self.cache['pallet_row2'] = self._main_row(data, 'pallet_row2')
            self.cache['pallet_row3'] = self._main_row(data, 'pallet_row3')
            self.cache['pallet_row4'] = self._main_row(data, 'pallet_row4')
            self.cache['pallet_full'] = self._main_bit(data, 'pallet_full')

            self.cache['conveyor1_override'] = self._main_bit(data, 'conveyor1_override')
            self.cache['conveyor2_override'] = self._main_bit(data, 'conveyor2_override')
            self.cache['linear_override'] = self._main_bit(data, 'linear_override')
            self.cache['confirm_reset'] = self._main_bit(data, 'confirm_reset')

    def _decode_camera_db(self, data: bytearray):
        """Decode the camera PLC DB into cache (called by worker thread only)."""
        with self.cache_lock:
            self.cache['camera_start'] = self._camera_bit(data, 'start')
            self.cache['camera_connected'] = self._camera_bit(data, 'connected')
            self.cache['camera_busy'] = self._camera_bit(data, 'busy')
            self.cache['camera_completed'] = self._camera_bit(data, 'completed')
            self.cache['defect_detected'] = self._camera_bit(data, 'defect_detected')
            self.cache['reject_command_from_plc'] = self._camera_bit(data, 'reject_command_from_plc')
            self.cache['yellow_cube_detected'] = self._camera_bit(data, 'yellow_cube_detected')
            self.cache['white_cube_detected'] = self._camera_bit(data, 'white_cube_detected')
            self.cache['metal_cube_detected'] = self._camera_bit(data, 'metal_cube_detected')

    def _decode_robot_db(self, data: bytearray):
        """Decode the robot PLC DB into cache (called by worker thread only)."""
        with self.cache_lock:
            self.cache['db125_connected'] = self._robot_bit(data, 'connected')
            self.cache['db125_busy'] = self._robot_bit(data, 'busy')
            self.cache['db125_move_complete'] = self._robot_bit(data, 'move_complete')
            self.cache['db125_at_home'] = self._robot_bit(data, 'at_home')
            self.cache['db125_at_pickup_position'] = self._robot_bit(data, 'at_pickup_position')
            self.cache['db125_at_pallet_position'] = self._robot_bit(data, 'at_pallet_position')
            self.cache['db125_at_quarantine_position'] = self._robot_bit(data, 'at_quarantine_position')
            self.cache['db125_gripper_active'] = self._robot_bit(data, 'gripper_active')
            self.cache['db125_cycle_complete'] = self._robot_bit(data, 'cycle_complete')
            self.cache['db125_invalid_target'] = self._robot_bit(data, 'invalid_target')
            self.cache['db125_x_position'] = self._robot_int(data, 'x_position')
            self.cache['db125_y_position'] = self._robot_int(data, 'y_position')
            self.cache['db125_z_position'] = self._robot_int(data, 'z_position')
            self.cache['db125_home_command'] = self._robot_bit(data, 'home_command')
            self.cache['db125_pickup_command'] = self._robot_bit(data, 'pickup_command')
            self.cache['db125_speed'] = self._robot_int(data, 'speed')
            self.cache['db125_target_x'] = self._robot_int(data, 'target_x')
            self.cache['db125_target_y'] = self._robot_int(data, 'target_y')
            self.cache['db125_target_z'] = self._robot_int(data, 'target_z')
            self.cache['db125_any_moving'] = self._robot_bit(data, 'any_moving')
            self.cache['db125_any_overload'] = self._robot_bit(data, 'any_overload')
            self.cache['db125_any_undervoltage'] = self._robot_bit(data, 'any_undervoltage')
            self.cache['db125_any_overtemp'] = self._robot_bit(data, 'any_overtemp')
            self.cache['db125_max_temperature'] = self._robot_bit(data, 'max_temperature')
            self.cache['db125_min_voltage'] = self._robot_bit(data, 'min_voltage')
            self.cache['db125_max_load_pct'] = self._robot_bit(data, 'max_load_pct')

    def _update_camera_connected(self):
        """Update camera connected status in PLC"""
        if self.camera_service is None:
            return

        try:
            # Check actual camera status
            camera_connected = False
            if hasattr(self.camera_service, 'lock') and hasattr(self.camera_service, 'camera'):
                with self.camera_service.lock:
                    camera_connected = (
                        self.camera_service.camera is not None
                        and self.camera_service.camera.isOpened()
                    )

            # Only write if changed
            current_status = self.get_cache_value('camera_connected', False)
            if camera_connected != current_status:
                connected_tag = self.camera_db_tags['connected']
                byte_data = bytearray(1)
                try:
                    current_byte = self.client.db_read(self.camera_db_number, connected_tag['byte'], 1)
                    byte_data = bytearray(current_byte)
                except:
                    pass
                set_bool(byte_data, 0, connected_tag['bit'], camera_connected)
                self.queue_write(self.camera_db_number, connected_tag['byte'], byte_data, f"Camera connected={camera_connected}")

        except Exception as e:
            logger.debug(f"Error updating camera connected status: {e}")

    def _update_robot_connected(self):
        """Update robot bridge connected status in PLC."""
        try:
            provider = self.robot_connected_provider
            if not callable(provider):
                return

            robot_connected = bool(provider())
            current_status = self.get_cache_value('db125_connected', False)
            if robot_connected == current_status:
                return

            connected_tag = self.robot_db_tags.get('connected')
            if not connected_tag:
                return

            byte_data = bytearray(1)
            try:
                current_byte = self.client.db_read(self.robot_db_number, connected_tag['byte'], 1)
                byte_data = bytearray(current_byte)
            except Exception:
                pass

            set_bool(byte_data, 0, connected_tag['bit'], robot_connected)
            self.queue_write(
                self.robot_db_number,
                connected_tag['byte'],
                byte_data,
                f"Robot connected={robot_connected}"
            )

        except Exception as e:
            logger.debug(f"Error updating robot connected status: {e}")

    def _process_vision_handshake(self):
        """
        Implement proper vision handshake state machine.

        State transitions:
        IDLE → REQUESTED: PLC sets camera_start=TRUE
        REQUESTED → PROCESSING: Pi sets busy=TRUE, starts vision processing
        PROCESSING → COMPLETED: Pi finishes, sets completed=TRUE, busy=FALSE
        COMPLETED → IDLE: PLC clears camera_start=FALSE, Pi clears completed=FALSE
        """
        current_start = self.get_cache_value('camera_start', False)
        current_busy = self.get_cache_value('camera_busy', False)
        current_completed = self.get_cache_value('camera_completed', False)

        state = self.vision_state.state
        last_start = self.vision_state.last_start_bit

        # State machine
        if state == VisionState.IDLE:
            if current_start and not last_start:
                # Rising edge on start bit - PLC is requesting vision
                logger.info("📸 Vision IDLE → REQUESTED (PLC set start=TRUE)")
                self.vision_state.state = VisionState.REQUESTED

        elif state == VisionState.REQUESTED:
            # Pi should acknowledge and start processing
            if not current_busy:
                logger.info("📸 Vision REQUESTED → PROCESSING (Pi setting busy=True)")
                self._queue_vision_status(busy=True, completed=False)
                self.vision_state.state = VisionState.PROCESSING

                # Launch vision processing in background
                if self.vision_processor_callback:
                    cache_snapshot = self.get_cache_snapshot()
                    self.vision_state.processing_thread = threading.Thread(
                        target=self.vision_processor_callback,
                        args=(cache_snapshot, self),
                        daemon=True,
                        name="VisionProcessor"
                    )
                    self.vision_state.processing_thread.start()

        elif state == VisionState.PROCESSING:
            # Check if vision completed (callback should have set completed=TRUE)
            if current_completed and not current_busy:
                logger.info("📸 Vision PROCESSING → COMPLETED (Pi set completed=TRUE)")
                self.vision_state.state = VisionState.COMPLETED

        elif state == VisionState.COMPLETED:
            # Wait for PLC to clear start bit
            if not current_start and last_start:
                # Falling edge on start bit - PLC acknowledged completion
                logger.info("📸 Vision COMPLETED → IDLE (PLC cleared start=FALSE)")
                self._queue_vision_status(busy=False, completed=False)
                self.vision_state.state = VisionState.IDLE

        self.vision_state.last_start_bit = current_start

    def _queue_vision_status(self, busy: bool, completed: bool):
        """Queue a vision status update (busy/completed bits)"""
        status_tag = self.camera_db_tags['busy']
        try:
            current_byte = self.client.db_read(self.camera_db_number, status_tag['byte'], 1)
            byte_data = bytearray(current_byte)
        except:
            byte_data = bytearray(1)

        set_bool(byte_data, 0, self.camera_db_tags['busy']['bit'], busy)
        set_bool(byte_data, 0, self.camera_db_tags['completed']['bit'], completed)

        self.queue_write(self.camera_db_number, status_tag['byte'], byte_data, f"Vision busy={busy}, completed={completed}")

    def _process_write_queue(self):
        """Process all queued writes in batch (called by worker thread only)"""
        # Get all pending writes
        with self.write_queue_lock:
            writes = self.write_queue.copy()
            self.write_queue.clear()

        if not writes:
            return

        # Execute each write
        for write in writes:
            try:
                self.client.db_write(write.db, write.offset, write.data)
                if write.description:
                    logger.debug(f"✍️ PLC write: DB{write.db}.{write.offset} - {write.description}")
            except Exception as e:
                logger.error(f"PLC write error DB{write.db}.{write.offset}: {e}")
                self.stats['write_errors'] += 1
                self._drop_client()
                break

    def get_stats(self) -> Dict[str, Any]:
        """Get worker statistics"""
        return self.stats.copy()
