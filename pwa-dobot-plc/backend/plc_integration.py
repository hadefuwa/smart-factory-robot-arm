"""Worker-backed PLC integration helpers used by app.py."""

import logging
import time
import snap7
from snap7.util import set_bool, set_int
from plc_worker import PLCWorker

logger = logging.getLogger(__name__)

# Global worker instance (initialized by init_plc_worker)
plc_worker: PLCWorker = None


def init_plc_worker(
    plc_ip: str,
    camera_service,
    vision_callback,
    cycle_time_ms: int = 100,
    db123_config=None,
    db124_config=None
) -> PLCWorker:
    """
    Initialize the PLC worker.

    Args:
        plc_ip: PLC IP address
        camera_service: Camera service instance
        vision_callback: Vision processing callback function
        cycle_time_ms: Worker cycle time (default 100ms)
        db123_config: Runtime main DB mapping config
        db124_config: Runtime camera DB mapping config

    Returns:
        PLCWorker instance
    """
    global plc_worker

    logger.info(f"Initializing PLC worker (cycle: {cycle_time_ms}ms)")

    plc_worker = PLCWorker(
        plc_ip=plc_ip,
        rack=0,
        slot=1,
        cycle_time_ms=cycle_time_ms,
        main_db_config=db123_config,
        camera_db_config=db124_config,
        camera_service=camera_service,
        vision_processor_callback=vision_callback
    )

    plc_worker.start()

    logger.info("PLC worker started")

    return plc_worker


def shutdown_plc_worker():
    """Shutdown the PLC worker (call on app shutdown)"""
    global plc_worker
    if plc_worker:
        logger.info("Shutting down PLC worker...")
        plc_worker.stop()
        plc_worker = None


# ============================================================================
# Helper Functions
# ============================================================================

def get_plc_cache():
    """
    Get current PLC cache snapshot.
    """
    if plc_worker is None:
        logger.warning("PLC worker not initialized")
        return {}

    return plc_worker.get_cache_snapshot()


def queue_vision_result(
    object_detected: bool,
    object_ok: bool,
    defect_detected: bool,
    yellow: bool = False,
    white: bool = False,
    steel: bool = False,
    aluminum: bool = False
):
    """
    Queue vision detection results.
    """
    if plc_worker is None:
        logger.warning("PLC worker not initialized")
        return

    plc_worker.queue_vision_result(
        object_detected=object_detected,
        object_ok=object_ok,
        defect_detected=defect_detected,
        yellow=yellow,
        white=white,
        steel=steel,
        aluminum=aluminum
    )


def queue_robot_position(x: int, y: int, z: int):
    """
    Queue robot current position write.

    Args:
        x, y, z: Current position (INT values, not REAL!)
    """
    if plc_worker is None:
        logger.warning("PLC worker not initialized")
        return

    # Robot current position is at bytes 10, 12, 14 (INT)
    data = bytearray(6)
    set_int(data, 0, int(x))
    set_int(data, 2, int(y))
    set_int(data, 4, int(z))

    plc_worker.queue_write(plc_worker.main_db_number, 10, data, f"Robot position: ({x}, {y}, {z})")


def queue_robot_status(connected: bool = None, busy: bool = None):
    """
    Queue robot status bits write.

    Args:
        connected: Robot connected to Pi (DBX2.0)
        busy: Robot executing movement (DBX2.1)
    """
    if plc_worker is None:
        logger.warning("PLC worker not initialized")
        return

    # Read-modify-write byte 2
    try:
        cache = get_plc_cache()
        status_byte = bytearray(1)

        # Preserve existing bits
        if connected is None:
            connected = cache.get('robot_connected', False)
        if busy is None:
            busy = cache.get('robot_busy', False)

        set_bool(status_byte, 0, 0, connected)
        set_bool(status_byte, 0, 1, busy)
        # Bit 2 (cycle_complete) is READ-ONLY - don't touch

        plc_worker.queue_write(plc_worker.main_db_number, 2, status_byte, f"Robot status: connected={connected}, busy={busy}")

    except Exception as e:
        logger.error(f"Error queueing robot status: {e}")


def queue_cube_color_bits(yellow: bool = False, white: bool = False, steel: bool = False, aluminum: bool = False):
    """
    Queue cube color detection bits write.

    Args:
        yellow: Yellow cube detected (DBX32.0)
        white: White cube detected (DBX32.1)
        steel: Steel cube detected (DBX32.2)
        aluminum: Aluminum cube detected (DBX32.3)
    """
    if plc_worker is None:
        logger.warning("PLC worker not initialized")
        return

    color_offset = plc_worker.camera_db_tags['yellow_cube']['byte']
    cache = get_plc_cache()
    color_byte = bytearray(1)
    set_bool(color_byte, 0, plc_worker.camera_db_tags['yellow_cube']['bit'], yellow)
    set_bool(color_byte, 0, plc_worker.camera_db_tags['white_cube']['bit'], white)
    set_bool(color_byte, 0, plc_worker.camera_db_tags['steel_cube']['bit'], steel)
    set_bool(color_byte, 0, plc_worker.camera_db_tags['aluminum_cube']['bit'], aluminum)
    set_bool(
        color_byte,
        0,
        plc_worker.camera_db_tags['counter_exceeded']['bit'],
        cache.get('counter_exceeded', False)
    )

    plc_worker.queue_write(plc_worker.camera_db_number, color_offset, color_byte, "Cube colors")


def get_plc_stats():
    """Get PLC worker statistics"""
    if plc_worker is None:
        return {}
    return plc_worker.get_stats()


def is_plc_connected():
    """Check if PLC is connected"""
    if plc_worker is None:
        return False

    cache = get_plc_cache()
    return cache.get('connected', False)


# ============================================================================
# Wrapper
# ============================================================================

class PLCClientCompatWrapper:
    """
    Worker-backed wrapper exposing the subset of PLC client methods still used by app.py.
    """

    def __init__(self, worker: PLCWorker):
        self.worker = worker
        self.ip = worker.plc_ip if worker else 'unknown'
        self.rack = worker.rack if worker else 0
        self.slot = worker.slot if worker else 1
        # Keep client unset for runtime guards; all access should go via cache/queue.
        self.client = None
        self.last_error = ""

    def connect(self) -> bool:
        """Connect to PLC (no-op, worker handles connection automatically)"""
        if not self.worker:
            return False
        # Worker connects automatically, just return status
        cache = self.worker.get_cache_snapshot()
        return cache.get('connected', False)

    def disconnect(self):
        """Disconnect from PLC (no-op, worker manages connection)"""
        # Worker manages connection lifecycle, no manual disconnect needed
        return None

    def is_connected(self) -> bool:
        """Check if connected (reads from cache)"""
        cache = self.worker.get_cache_snapshot()
        return cache.get('connected', False)

    def read_vision_tags(self, *args, **kwargs):
        """Read vision tags (from cache, not PLC!)"""
        cache = self.worker.get_cache_snapshot()
        return {
            'start': cache.get('camera_start', False),
            'connected': cache.get('camera_connected', False),
            'busy': cache.get('camera_busy', False),
            'completed': cache.get('camera_completed', False),
            'object_detected': cache.get('object_detected', False),
            'object_ok': cache.get('object_ok', False),
            'defect_detected': cache.get('defect_detected', False),
            'object_number': cache.get('object_number', 0),
            'defect_number': cache.get('defect_number', 0),
            'yellow_cube_detected': cache.get('yellow_cube', False),
            'white_cube_detected': cache.get('white_cube', False),
            'steel_cube_detected': cache.get('steel_cube', False),
            'alluminium_cube_detected': cache.get('aluminum_cube', False),
        }

    def read_target_pose(self, *args, **kwargs):
        """Read target pose (from cache)"""
        cache = self.worker.get_cache_snapshot()
        return {
            'x': cache.get('robot_target_x', 0),
            'y': cache.get('robot_target_y', 0),
            'z': cache.get('robot_target_z', 0),
        }

    def read_current_pose(self, *args, **kwargs):
        """Read current pose (from cache)"""
        cache = self.worker.get_cache_snapshot()
        return {
            'x': cache.get('robot_current_x', 0),
            'y': cache.get('robot_current_y', 0),
            'z': cache.get('robot_current_z', 0),
        }

    def read_robot_status(self, *args, **kwargs):
        """Read robot status (from cache)"""
        cache = self.worker.get_cache_snapshot()
        return {
            'connected': cache.get('robot_connected', False),
            'busy': cache.get('robot_busy', False),
            'cycle_complete': cache.get('robot_cycle_complete', False),
            'status_code': cache.get('robot_status_code', 0),
            'error_code': cache.get('robot_error_code', 0),
        }

    def write_vision_tags(self, tags, *args, **kwargs):
        """Write vision tags through the worker-backed API."""
        logger.warning("write_vision_tags() is not implemented; use queue_vision_result() instead")
        pass

    def write_current_pose(self, pose, *args, **kwargs):
        """Write current pose (via queue)"""
        queue_robot_position(
            x=int(pose.get('x', 0)),
            y=int(pose.get('y', 0)),
            z=int(pose.get('z', 0))
        )
        return True

    def get_status(self):
        """Get PLC status"""
        cache = self.worker.get_cache_snapshot()
        return {
            'connected': cache.get('connected', False),
            'ip': self.worker.plc_ip,
            'rack': self.worker.rack,
            'slot': self.worker.slot,
            'last_error': ''
        }

    def read_control_bits(self):
        """Return the control-bit view expected by the current app endpoints."""
        cache = self.worker.get_cache_snapshot()
        return {
            'start': cache.get('hmi_start', False),
            'stop': cache.get('hmi_stop', False),
            'home': cache.get('gantry_home_command', False),
            'estop': not cache.get('system_safety_ok', True),
            'suction': False,
            'ready': cache.get('camera_connected', False),
            'busy': (
                cache.get('robot_busy', False)
                or cache.get('gantry_busy', False)
                or cache.get('camera_busy', False)
            ),
            'error': (
                cache.get('system_active_fault', False)
                or bool(cache.get('robot_error_code', 0))
            )
        }

    def write_control_bit(self, bit_name: str, value: bool) -> bool:
        """M-bit writes are not supported in worker mode."""
        logger.warning(f"write_control_bit({bit_name}, {value}) not supported in new worker")
        return False

    def write_vision_fault_bit(self, defects_found: bool, byte_offset: int = 1, bit_offset: int = 0):
        """Vision fault M-bit writes are not supported in worker mode."""
        logger.warning(
            f"write_vision_fault_bit({defects_found}, {byte_offset}, {bit_offset}) "
            "not supported in new worker"
        )
        return {'written': False, 'reason': 'unsupported_in_worker_mode'}

    def read_db_bool(self, db: int, byte_offset: int, bit_offset: int):
        """Read a bool from DB (from cache if possible)"""
        # Try to find in cache, otherwise return None
        cache = self.worker.get_cache_snapshot()

        # Map known addresses to cache keys
        if db == self.worker.camera_db_number:
            camera_status_byte = self.worker.camera_db_tags['start']['byte']
            camera_color_byte = self.worker.camera_db_tags['yellow_cube']['byte']
            if byte_offset == camera_status_byte:
                bit_map = {
                    self.worker.camera_db_tags['start']['bit']: 'camera_start',
                    self.worker.camera_db_tags['connected']['bit']: 'camera_connected',
                    self.worker.camera_db_tags['busy']['bit']: 'camera_busy',
                    self.worker.camera_db_tags['completed']['bit']: 'camera_completed',
                    self.worker.camera_db_tags['object_detected']['bit']: 'object_detected',
                    self.worker.camera_db_tags['object_ok']['bit']: 'object_ok',
                    self.worker.camera_db_tags['defect_detected']['bit']: 'defect_detected'
                }
                if bit_offset in bit_map:
                    return cache.get(bit_map[bit_offset], False)
            elif byte_offset == camera_color_byte:
                bit_map = {
                    self.worker.camera_db_tags['yellow_cube']['bit']: 'yellow_cube',
                    self.worker.camera_db_tags['white_cube']['bit']: 'white_cube',
                    self.worker.camera_db_tags['steel_cube']['bit']: 'steel_cube',
                    self.worker.camera_db_tags['aluminum_cube']['bit']: 'aluminum_cube',
                    self.worker.camera_db_tags['counter_exceeded']['bit']: 'counter_exceeded',
                }
                if bit_offset in bit_map:
                    return cache.get(bit_map[bit_offset], False)
        elif db == self.worker.main_db_number:
            if byte_offset == 2:
                bit_map = {
                    0: 'robot_connected',
                    1: 'robot_busy',
                    2: 'robot_cycle_complete'
                }
                if bit_offset in bit_map:
                    return cache.get(bit_map[bit_offset], False)

        return None

    def write_db_bool(self, db: int, byte_offset: int, bit_offset: int, value: bool) -> bool:
        """Write a bool to DB through the worker-backed API."""
        logger.warning("write_db_bool() is not implemented; use plc_integration helpers instead")
        return False

    def read_db_int(self, db: int, offset: int):
        """Read INT from DB (from cache if possible)"""
        cache = self.worker.get_cache_snapshot()

        if db == self.worker.main_db_number:
            int_map = {
                4: 'robot_target_x',
                6: 'robot_target_y',
                8: 'robot_target_z',
                10: 'robot_current_x',
                12: 'robot_current_y',
                14: 'robot_current_z',
                16: 'robot_status_code',
                18: 'robot_error_code',
                20: 'cube_type',
                34: 'material_type'
            }
            if offset in int_map:
                return cache.get(int_map[offset], 0)
        elif db == self.worker.camera_db_number:
            int_map = {
                self.worker.camera_db_tags['object_number']['byte']: 'object_number',
                self.worker.camera_db_tags['defect_number']['byte']: 'defect_number',
            }
            if offset in int_map:
                return cache.get(int_map[offset], 0)

        return None

    def write_db_int(self, db: int, offset: int, value: int) -> bool:
        """Write INT to DB through the worker-backed API."""
        logger.warning("write_db_int() is not implemented; use plc_integration helpers instead")
        return False
