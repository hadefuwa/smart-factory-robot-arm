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
from snap7.util import get_bool, get_int, get_real, set_bool, set_int, set_real

logger = logging.getLogger(__name__)

MAIN_DB_DEFAULTS = {
    'hmi_start': {'byte': 0, 'bit': 0, 'kind': 'bool'},
    'hmi_stop': {'byte': 0, 'bit': 1, 'kind': 'bool'},
    'hmi_reset': {'byte': 0, 'bit': 2, 'kind': 'bool'},
    'robot_connected': {'byte': 2, 'bit': 0, 'kind': 'bool'},
    'robot_busy': {'byte': 2, 'bit': 1, 'kind': 'bool'},
    'robot_cycle_complete': {'byte': 2, 'bit': 2, 'kind': 'bool'},
    'robot_target_x': {'byte': 4, 'kind': 'int'},
    'robot_target_y': {'byte': 6, 'kind': 'int'},
    'robot_target_z': {'byte': 8, 'kind': 'int'},
    'robot_current_x': {'byte': 10, 'kind': 'int'},
    'robot_current_y': {'byte': 12, 'kind': 'int'},
    'robot_current_z': {'byte': 14, 'kind': 'int'},
    'robot_status_code': {'byte': 16, 'kind': 'int'},
    'robot_error_code': {'byte': 18, 'kind': 'int'},
    'cube_type': {'byte': 20, 'kind': 'int'},
    'conveyor1_start': {'byte': 22, 'bit': 0, 'kind': 'bool'},
    'conveyor1_stop': {'byte': 22, 'bit': 1, 'kind': 'bool'},
    'conveyor2_start': {'byte': 24, 'bit': 0, 'kind': 'bool'},
    'conveyor2_stop': {'byte': 24, 'bit': 1, 'kind': 'bool'},
    'material_type': {'byte': 26, 'kind': 'int'},
    'quarantined_count': {'byte': 28, 'kind': 'int'},
    'defect_count': {'byte': 30, 'kind': 'int'},
    'aluminum_count': {'byte': 32, 'kind': 'int'},
    'steel_count': {'byte': 34, 'kind': 'int'},
    'yellow_count': {'byte': 36, 'kind': 'int'},
    'white_count': {'byte': 38, 'kind': 'int'},
    'gantry_home': {'byte': 40, 'bit': 0, 'kind': 'bool'},
    'gantry_busy': {'byte': 40, 'bit': 1, 'kind': 'bool'},
    'gantry_move_done': {'byte': 40, 'bit': 2, 'kind': 'bool'},
    'gantry_pick_up': {'byte': 40, 'bit': 3, 'kind': 'bool'},
    'gantry_place_down': {'byte': 40, 'bit': 4, 'kind': 'bool'},
    'gantry_home_command': {'byte': 40, 'bit': 5, 'kind': 'bool'},
    'gantry_power_ok': {'byte': 40, 'bit': 6, 'kind': 'bool'},
    'gantry_current_position': {'byte': 42, 'kind': 'real'},
    'gantry_target_position': {'byte': 46, 'kind': 'real'},
    'gantry_velocity': {'byte': 50, 'kind': 'real'},
    'gantry_position1': {'byte': 54, 'kind': 'real'},
    'gantry_position2': {'byte': 58, 'kind': 'real'},
    'gantry_home_error': {'byte': 62, 'bit': 0, 'kind': 'bool'},
    'gantry_home_error_fix': {'byte': 62, 'bit': 1, 'kind': 'bool'},
    'system_safety_ok': {'byte': 64, 'bit': 0, 'kind': 'bool'},
    'system_no_faults': {'byte': 64, 'bit': 1, 'kind': 'bool'},
    'system_active_fault': {'byte': 64, 'bit': 2, 'kind': 'bool'},
    'system_startup_completed': {'byte': 64, 'bit': 3, 'kind': 'bool'},
    'system_state': {'byte': 66, 'kind': 'int'},
    'pallet_row1': {'byte': 68, 'kind': 'row4'},
    'pallet_row2': {'byte': 70, 'kind': 'row4'},
    'pallet_row3': {'byte': 72, 'kind': 'row4'},
    'pallet_row4': {'byte': 74, 'kind': 'row4'},
    'pallet_full': {'byte': 76, 'bit': 0, 'kind': 'bool'},
    'conveyor1_override': {'byte': 78, 'bit': 0, 'kind': 'bool'},
    'conveyor2_override': {'byte': 78, 'bit': 1, 'kind': 'bool'},
    'linear_override': {'byte': 78, 'bit': 2, 'kind': 'bool'},
}

CAMERA_DB_DEFAULTS = {
    'start': {'byte': 0, 'bit': 0, 'kind': 'bool'},
    'connected': {'byte': 0, 'bit': 1, 'kind': 'bool'},
    'busy': {'byte': 0, 'bit': 2, 'kind': 'bool'},
    'completed': {'byte': 0, 'bit': 3, 'kind': 'bool'},
    'object_detected': {'byte': 0, 'bit': 4, 'kind': 'bool'},
    'object_ok': {'byte': 0, 'bit': 5, 'kind': 'bool'},
    'defect_detected': {'byte': 0, 'bit': 6, 'kind': 'bool'},
    'object_number': {'byte': 2, 'kind': 'int'},
    'defect_number': {'byte': 4, 'kind': 'int'},
    'yellow_cube': {'byte': 6, 'bit': 0, 'kind': 'bool'},
    'white_cube': {'byte': 6, 'bit': 1, 'kind': 'bool'},
    'steel_cube': {'byte': 6, 'bit': 2, 'kind': 'bool'},
    'aluminum_cube': {'byte': 6, 'bit': 3, 'kind': 'bool'},
    'counter_exceeded': {'byte': 6, 'bit': 4, 'kind': 'bool'},
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
        self.main_db_total_size = 80
        self.main_db_tags = {}
        self.camera_db_number = 124
        self.camera_db_total_size = 8
        self.camera_db_tags = {}

        self.camera_service = camera_service
        self.vision_processor_callback = vision_processor_callback
        self.update_db_configs(main_db_config or {}, camera_db_config or {})

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

        # Statistics
        self.stats = {
            'cycles': 0,
            'read_errors': 0,
            'write_errors': 0,
            'avg_cycle_time_ms': 0.0,
            'max_cycle_time_ms': 0.0,
        }

    def update_db_configs(self, main_db_config: Dict[str, Any], camera_db_config: Dict[str, Any]):
        """Update runtime DB mappings used by the worker."""
        main_db_config = main_db_config or {}
        camera_db_config = camera_db_config or {}
        self.main_db_number = int(main_db_config.get('db_number', 123))
        self.main_db_total_size = max(80, int(main_db_config.get('total_size', 80)))
        self.main_db_tags = self._build_tag_config(main_db_config.get('tags', {}), MAIN_DB_DEFAULTS)
        self.camera_db_number = int(camera_db_config.get('db_number', 124))
        self.camera_db_total_size = max(8, int(camera_db_config.get('total_size', 8)))
        self.camera_db_tags = self._build_tag_config(camera_db_config.get('tags', {}), CAMERA_DB_DEFAULTS)
        logger.info(
            "Updated PLC mappings: main DB%s size=%s, camera DB%s size=%s",
            self.main_db_number,
            self.main_db_total_size,
            self.camera_db_number,
            self.camera_db_total_size,
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
            db123_config
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
            return [False, False, False, False]
        return [get_bool(data, tag['byte'], i) for i in range(4)]

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

            # Robot (byte 2-21)
            'robot_connected': False,
            'robot_busy': False,
            'robot_cycle_complete': False,
            'robot_target_x': 0,
            'robot_target_y': 0,
            'robot_target_z': 0,
            'robot_current_x': 0,
            'robot_current_y': 0,
            'robot_current_z': 0,
            'robot_status_code': 0,
            'robot_error_code': 0,
            'cube_type': 0,

            # Conveyors (byte 22-25)
            'conveyor1_start': False,
            'conveyor1_stop': False,
            'conveyor2_start': False,
            'conveyor2_stop': False,

            # Camera & Vision (byte 26-33)
            'camera_start': False,        # READ-ONLY (PLC → Pi)
            'camera_connected': False,
            'camera_busy': False,
            'camera_completed': False,
            'object_detected': False,
            'object_ok': False,
            'defect_detected': False,
            'object_number': 0,
            'defect_number': 0,
            'yellow_cube': False,
            'white_cube': False,
            'steel_cube': False,
            'aluminum_cube': False,
            'counter_exceeded': False,

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

            # Pallet (byte 76-85)
            'pallet_row1': [False] * 4,
            'pallet_row2': [False] * 4,
            'pallet_row3': [False] * 4,
            'pallet_row4': [False] * 4,
            'pallet_full': False,

            # HMI Overrides (byte 86-87)
            'conveyor1_override': False,  # READ-ONLY (PLC → Pi)
            'conveyor2_override': False,  # READ-ONLY (PLC → Pi)
            'linear_override': False,     # READ-ONLY (PLC → Pi)
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
        object_detected: bool,
        object_ok: bool,
        defect_detected: bool,
        yellow: bool = False,
        white: bool = False,
        steel: bool = False,
        aluminum: bool = False,
        object_number: int = None,
        defect_number: int = None
    ):
        """
        Helper method for vision callbacks to write results.

        This is the ONLY way vision callbacks should write to PLC.
        Never access worker.client directly!

        Args:
            object_detected: Object found in frame
            object_ok: Object passed quality check
            defect_detected: Defect/reject detected
            yellow/white/steel/aluminum: Cube color flags
            object_number: Total object count (None = auto-increment)
            defect_number: Total defect count (None = auto-increment)
        """
        # Auto-increment counters if not specified
        if object_number is None:
            object_number = self.get_cache_value('object_number', 0)
            if object_detected:
                object_number += 1

        if defect_number is None:
            defect_number = self.get_cache_value('defect_number', 0)
            if defect_detected:
                defect_number += 1

        # This method can be called from vision callback thread
        # We need to do read-modify-write for byte 26, but we can't access client here
        # Solution: Store the values and let _queue_vision_status handle the RMW
        self._pending_vision_result = {
            'object_detected': object_detected,
            'object_ok': object_ok,
            'defect_detected': defect_detected,
            'yellow': yellow,
            'white': white,
            'steel': steel,
            'aluminum': aluminum,
            'object_number': object_number,
            'defect_number': defect_number,
        }

        # Queue the writes (will be processed by worker thread)
        # Note: The actual byte 26 RMW happens in _finalize_vision_result()
        # which is called from worker thread

    def _finalize_vision_result(self):
        """
        Internal: Finalize pending vision result (called from worker thread only).
        Does the actual read-modify-write for byte 26.
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
            set_bool(status_byte, 0, self.camera_db_tags['object_detected']['bit'], result['object_detected'])
            set_bool(status_byte, 0, self.camera_db_tags['object_ok']['bit'], result['object_ok'])
            set_bool(status_byte, 0, self.camera_db_tags['defect_detected']['bit'], result['defect_detected'])
            self.queue_write(self.camera_db_number, status_byte_offset, status_byte, "Vision status")

            object_number_tag = self.camera_db_tags['object_number']
            defect_number_tag = self.camera_db_tags['defect_number']
            if defect_number_tag['byte'] == object_number_tag['byte'] + 2:
                counter_data = bytearray(4)
                set_int(counter_data, 0, result['object_number'])
                set_int(counter_data, 2, result['defect_number'])
                self.queue_write(
                    self.camera_db_number,
                    object_number_tag['byte'],
                    counter_data,
                    f"Counters: {result['object_number']}/{result['defect_number']}"
                )
            else:
                object_data = bytearray(2)
                defect_data = bytearray(2)
                set_int(object_data, 0, result['object_number'])
                set_int(defect_data, 0, result['defect_number'])
                self.queue_write(self.camera_db_number, object_number_tag['byte'], object_data, f"Object counter: {result['object_number']}")
                self.queue_write(self.camera_db_number, defect_number_tag['byte'], defect_data, f"Defect counter: {result['defect_number']}")

            color_tag_names = ['yellow_cube', 'white_cube', 'steel_cube', 'aluminum_cube']
            color_values = {
                'yellow_cube': result['yellow'],
                'white_cube': result['white'],
                'steel_cube': result['steel'],
                'aluminum_cube': result['aluminum'],
            }
            for color_byte_offset in sorted({self.camera_db_tags[name]['byte'] for name in color_tag_names}):
                try:
                    color_byte = bytearray(self.client.db_read(self.camera_db_number, color_byte_offset, 1))
                except Exception:
                    color_byte = bytearray(1)
                for tag_name in color_tag_names:
                    tag = self.camera_db_tags[tag_name]
                    if tag['byte'] == color_byte_offset:
                        set_bool(color_byte, 0, tag['bit'], color_values[tag_name])
                self.queue_write(self.camera_db_number, color_byte_offset, color_byte, "Cube colors")

            logger.info(f"✅ Vision result finalized: obj={result['object_number']}, def={result['defect_number']}")

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

    def _worker_loop(self):
        """Main worker loop - runs in dedicated thread"""
        logger.info(f"PLC worker loop started (target cycle: {self.cycle_time_ms}ms)")

        while self.running and not self.stop_event.is_set():
            cycle_start = time.perf_counter()

            try:
                # 1. Check/establish connection
                if not self._connect():
                    with self.cache_lock:
                        self.cache['connected'] = False
                    time.sleep(1.0)  # Wait before retry
                    continue

                with self.cache_lock:
                    self.cache['connected'] = True

                # 2. BATCH READS - main DB and camera DB
                try:
                    main_data = self.client.db_read(self.main_db_number, 0, self.main_db_total_size)
                    camera_data = self.client.db_read(self.camera_db_number, 0, self.camera_db_total_size)
                    self._decode_main_db(main_data)
                    self._decode_camera_db(camera_data)
                    with self.cache_lock:
                        self.cache['last_update'] = time.time()
                        self.cache['cycle_count'] += 1
                except Exception as e:
                    logger.error(f"PLC DB read error: {e}", exc_info=True)
                    self.stats['read_errors'] += 1
                    continue

                # 3. UPDATE CAMERA CONNECTED STATUS
                self._update_camera_connected()

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
                time.sleep(0.5)  # Brief delay before retry

        logger.info("PLC worker loop exited")

    def _decode_main_db(self, data: bytearray):
        """Decode the main PLC DB into cache (called by worker thread only)."""
        with self.cache_lock:
            self.cache['hmi_start'] = self._main_bit(data, 'hmi_start')
            self.cache['hmi_stop'] = self._main_bit(data, 'hmi_stop')
            self.cache['hmi_reset'] = self._main_bit(data, 'hmi_reset')

            self.cache['robot_connected'] = self._main_bit(data, 'robot_connected')
            self.cache['robot_busy'] = self._main_bit(data, 'robot_busy')
            self.cache['robot_cycle_complete'] = self._main_bit(data, 'robot_cycle_complete')
            self.cache['robot_target_x'] = self._main_int(data, 'robot_target_x')
            self.cache['robot_target_y'] = self._main_int(data, 'robot_target_y')
            self.cache['robot_target_z'] = self._main_int(data, 'robot_target_z')
            self.cache['robot_current_x'] = self._main_int(data, 'robot_current_x')
            self.cache['robot_current_y'] = self._main_int(data, 'robot_current_y')
            self.cache['robot_current_z'] = self._main_int(data, 'robot_current_z')
            self.cache['robot_status_code'] = self._main_int(data, 'robot_status_code')
            self.cache['robot_error_code'] = self._main_int(data, 'robot_error_code')
            self.cache['cube_type'] = self._main_int(data, 'cube_type')

            self.cache['conveyor1_start'] = self._main_bit(data, 'conveyor1_start')
            self.cache['conveyor1_stop'] = self._main_bit(data, 'conveyor1_stop')
            self.cache['conveyor2_start'] = self._main_bit(data, 'conveyor2_start')
            self.cache['conveyor2_stop'] = self._main_bit(data, 'conveyor2_stop')

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

            self.cache['pallet_row1'] = self._main_row(data, 'pallet_row1')
            self.cache['pallet_row2'] = self._main_row(data, 'pallet_row2')
            self.cache['pallet_row3'] = self._main_row(data, 'pallet_row3')
            self.cache['pallet_row4'] = self._main_row(data, 'pallet_row4')
            self.cache['pallet_full'] = self._main_bit(data, 'pallet_full')

            self.cache['conveyor1_override'] = self._main_bit(data, 'conveyor1_override')
            self.cache['conveyor2_override'] = self._main_bit(data, 'conveyor2_override')
            self.cache['linear_override'] = self._main_bit(data, 'linear_override')

    def _decode_camera_db(self, data: bytearray):
        """Decode the camera PLC DB into cache (called by worker thread only)."""
        with self.cache_lock:
            self.cache['camera_start'] = self._camera_bit(data, 'start')
            self.cache['camera_connected'] = self._camera_bit(data, 'connected')
            self.cache['camera_busy'] = self._camera_bit(data, 'busy')
            self.cache['camera_completed'] = self._camera_bit(data, 'completed')
            self.cache['object_detected'] = self._camera_bit(data, 'object_detected')
            self.cache['object_ok'] = self._camera_bit(data, 'object_ok')
            self.cache['defect_detected'] = self._camera_bit(data, 'defect_detected')
            self.cache['object_number'] = self._camera_int(data, 'object_number')
            self.cache['defect_number'] = self._camera_int(data, 'defect_number')
            self.cache['yellow_cube'] = self._camera_bit(data, 'yellow_cube')
            self.cache['white_cube'] = self._camera_bit(data, 'white_cube')
            self.cache['steel_cube'] = self._camera_bit(data, 'steel_cube')
            self.cache['aluminum_cube'] = self._camera_bit(data, 'aluminum_cube')
            self.cache['counter_exceeded'] = self._camera_bit(data, 'counter_exceeded')

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

    def get_stats(self) -> Dict[str, Any]:
        """Get worker statistics"""
        return self.stats.copy()
