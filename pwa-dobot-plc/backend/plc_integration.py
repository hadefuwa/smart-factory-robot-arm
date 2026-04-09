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
    db124_config=None,
    db125_config=None
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
        db125_config: Runtime robot DB mapping config

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
        robot_db_config=db125_config,
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

    for field_name, value in (
        ('x_position', x),
        ('y_position', y),
        ('z_position', z),
    ):
        offset = plc_worker.robot_db_tags[field_name]['byte']
        data = bytearray(2)
        set_int(data, 0, int(value))
        plc_worker.queue_write(plc_worker.robot_db_number, offset, data, f"{field_name}={value}")


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

    # Read-modify-write the DB125 status bytes
    try:
        cache = get_plc_cache()
        if connected is None:
            connected = cache.get('db125_connected', False)
        if busy is None:
            busy = cache.get('db125_busy', False)

        byte_writes = {}
        for field_name, value in (
            ('connected', connected),
            ('busy', busy),
        ):
            tag = plc_worker.robot_db_tags[field_name]
            entry = byte_writes.setdefault(tag['byte'], bytearray(1))
            set_bool(entry, 0, tag['bit'], value)

        cycle_tag = plc_worker.robot_db_tags.get('cycle_complete')
        if cycle_tag:
            entry = byte_writes.setdefault(cycle_tag['byte'], bytearray(1))
            set_bool(entry, 0, cycle_tag['bit'], cache.get('db125_cycle_complete', False))

        for byte_offset, byte_data in byte_writes.items():
            plc_worker.queue_write(plc_worker.robot_db_number, byte_offset, byte_data, f"Robot status byte {byte_offset}")

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

    status_offset = plc_worker.camera_db_tags['yellow_cube_detected']['byte']
    status_byte = bytearray(1)
    set_bool(status_byte, 0, plc_worker.camera_db_tags['yellow_cube_detected']['bit'], yellow)
    set_bool(status_byte, 0, plc_worker.camera_db_tags['white_cube_detected']['bit'], white)
    plc_worker.queue_write(plc_worker.camera_db_number, status_offset, status_byte, "Cube colors")

    metal_offset = plc_worker.camera_db_tags['metal_cube_detected']['byte']
    metal_byte = bytearray(1)
    set_bool(metal_byte, 0, plc_worker.camera_db_tags['metal_cube_detected']['bit'], bool(steel or aluminum))
    plc_worker.queue_write(plc_worker.camera_db_number, metal_offset, metal_byte, "Metal cube bit")


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
            'defect_detected': cache.get('defect_detected', False),
            'reject_command_from_plc': cache.get('reject_command_from_plc', False),
            'yellow_cube_detected': cache.get('yellow_cube_detected', False),
            'white_cube_detected': cache.get('white_cube_detected', False),
            'metal_cube_detected': cache.get('metal_cube_detected', False),
        }

    def read_target_pose(self, *args, **kwargs):
        """Read target pose (from cache)"""
        cache = self.worker.get_cache_snapshot()
        return {
            'x': cache.get('db125_target_x', 0),
            'y': cache.get('db125_target_y', 0),
            'z': cache.get('db125_target_z', 0),
        }

    def read_current_pose(self, *args, **kwargs):
        """Read current pose (from cache)"""
        cache = self.worker.get_cache_snapshot()
        return {
            'x': cache.get('db125_x_position', 0),
            'y': cache.get('db125_y_position', 0),
            'z': cache.get('db125_z_position', 0),
        }

    def read_robot_status(self, *args, **kwargs):
        """Read robot status (from cache)"""
        cache = self.worker.get_cache_snapshot()
        return {
            'connected': cache.get('db125_connected', False),
            'busy': cache.get('db125_busy', False),
            'cycle_complete': cache.get('db125_cycle_complete', False),
            'status_code': cache.get('db125_robot_status_code', 0),
            'error_code': cache.get('db125_error_code', 0),
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
                cache.get('db125_busy', False)
                or cache.get('gantry_busy', False)
                or cache.get('camera_busy', False)
            ),
            'error': (
                cache.get('system_active_fault', False)
                or bool(cache.get('db125_error_code', 0))
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
            camera_metal_byte = self.worker.camera_db_tags['metal_cube_detected']['byte']
            if byte_offset == camera_status_byte:
                bit_map = {
                    self.worker.camera_db_tags['start']['bit']: 'camera_start',
                    self.worker.camera_db_tags['connected']['bit']: 'camera_connected',
                    self.worker.camera_db_tags['busy']['bit']: 'camera_busy',
                    self.worker.camera_db_tags['completed']['bit']: 'camera_completed',
                    self.worker.camera_db_tags['defect_detected']['bit']: 'defect_detected',
                    self.worker.camera_db_tags['reject_command_from_plc']['bit']: 'reject_command_from_plc',
                    self.worker.camera_db_tags['yellow_cube_detected']['bit']: 'yellow_cube_detected',
                    self.worker.camera_db_tags['white_cube_detected']['bit']: 'white_cube_detected',
                }
                if bit_offset in bit_map:
                    return cache.get(bit_map[bit_offset], False)
            elif byte_offset == camera_metal_byte:
                bit_map = {
                    self.worker.camera_db_tags['metal_cube_detected']['bit']: 'metal_cube_detected',
                }
                if bit_offset in bit_map:
                    return cache.get(bit_map[bit_offset], False)
        elif db == self.worker.main_db_number:
            for tag_name, tag in self.worker.main_db_tags.items():
                if tag.get('kind') == 'bool' and tag['byte'] == byte_offset and tag['bit'] == bit_offset:
                    return cache.get(tag_name, False)
                if tag.get('kind') == 'row' and tag['byte'] == byte_offset and 0 <= bit_offset < int(tag.get('width', 3)):
                    row = cache.get(tag_name, [False, False, False])
                    return row[bit_offset] if bit_offset < len(row) else False

        return None

    def write_db_bool(self, db: int, byte_offset: int, bit_offset: int, value: bool) -> bool:
        """Write a bool to DB through the worker-backed API."""
        logger.warning("write_db_bool() is not implemented; use plc_integration helpers instead")
        return False

    def read_db_int(self, db: int, offset: int):
        """Read INT from DB (from cache if possible)"""
        cache = self.worker.get_cache_snapshot()

        if db == self.worker.main_db_number:
            for tag_name, tag in self.worker.main_db_tags.items():
                if tag.get('kind') == 'int' and tag['byte'] == offset:
                    return cache.get(tag_name, 0)
        return None

    def write_db_int(self, db: int, offset: int, value: int) -> bool:
        """Write INT to DB through the worker-backed API."""
        logger.warning("write_db_int() is not implemented; use plc_integration helpers instead")
        return False
