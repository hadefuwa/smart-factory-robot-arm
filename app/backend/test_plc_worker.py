"""
Test script for new PLCWorker architecture.

This demonstrates how to use the clean PLC worker with:
- Cache-based reads (no direct PLC access)
- Queued writes (batched execution)
- Proper vision handshake

Run this to test PLC connectivity and worker performance.
"""

import time
import logging
import snap7
from plc_worker import PLCWorker

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def mock_vision_processor(cache_snapshot: dict, worker: PLCWorker):
    """
    Mock vision processing callback for testing.

    In real implementation, this would:
    1. Capture camera frame
    2. Run ML inference
    3. Write results back via worker.queue_vision_result()

    IMPORTANT: Never access worker.client directly!
    Use worker.queue_vision_result() instead.
    """
    logger.info("🎥 Vision processing started...")

    # Simulate processing time (50-200ms for real ML inference)
    time.sleep(0.15)

    # Get current counters from cache snapshot
    cycle_count = (
        cache_snapshot.get('yellow_count', 0)
        + cache_snapshot.get('white_count', 0)
        + cache_snapshot.get('steel_count', 0)
        + cache_snapshot.get('aluminum_count', 0)
    )

    # Simulate detection results
    defect = (cycle_count % 5 == 0)  # Every 5th object is a defect
    color = 'yellow' if not defect else 'reject'

    logger.info(f"🔍 Detection: {color}, cycles will be {cycle_count + 1}")

    # Queue result using helper method (NO direct worker.client access!)
    worker.queue_vision_result(
        defect_detected=defect,
        yellow=(color == 'yellow'),
        white=(color == 'white'),
        steel=(color == 'steel'),
        aluminum=(color == 'aluminum')
    )

    logger.info(f"✅ Vision processing completed")


def test_basic_connectivity():
    """Test 1: Basic PLC connectivity"""
    logger.info("=" * 60)
    logger.info("TEST 1: Basic PLC Connectivity")
    logger.info("=" * 60)

    worker = PLCWorker(
        plc_ip='192.168.7.2',
        rack=0,
        slot=1,
        cycle_time_ms=100,
        vision_processor_callback=None  # No vision for basic test
    )

    worker.start()

    # Wait for a few cycles
    time.sleep(3.0)

    # Check stats
    stats = worker.get_stats()
    cache = worker.get_cache_snapshot()

    logger.info(f"\n📊 Statistics after 3 seconds:")
    logger.info(f"  Cycles completed: {stats['cycles']}")
    logger.info(f"  Average cycle time: {stats['avg_cycle_time_ms']:.1f}ms")
    logger.info(f"  Max cycle time: {stats['max_cycle_time_ms']:.1f}ms")
    logger.info(f"  Read errors: {stats['read_errors']}")
    logger.info(f"  Write errors: {stats['write_errors']}")

    logger.info(f"\n📦 Sample cache data:")
    logger.info(f"  PLC connected: {cache['connected']}")
    logger.info(f"  Last update: {time.time() - cache['last_update']:.2f}s ago")
    logger.info(f"  Camera start: {cache['camera_start']}")
    logger.info(f"  Robot target: X={cache['db125_target_x']}, Y={cache['db125_target_y']}, Z={cache['db125_target_z']}")
    logger.info(f"  Yellow bit: {cache['yellow_cube_detected']}")

    worker.stop()

    # Validate
    assert stats['cycles'] >= 25, "Should complete ~30 cycles in 3 seconds (100ms each)"
    assert stats['avg_cycle_time_ms'] < 150, "Average cycle should be under 150ms"
    assert cache['connected'], "Should be connected to PLC"

    logger.info("\n✅ TEST 1 PASSED\n")


def test_read_performance():
    """Test 2: Read performance (cache vs direct)"""
    logger.info("=" * 60)
    logger.info("TEST 2: Read Performance (Cache)")
    logger.info("=" * 60)

    worker = PLCWorker(
        plc_ip='192.168.7.2',
        rack=0,
        slot=1,
        cycle_time_ms=100
    )

    worker.start()
    time.sleep(1.0)  # Let worker stabilize

    # Benchmark cache reads (should be < 1ms)
    iterations = 1000
    start = time.perf_counter()
    for _ in range(iterations):
        cache = worker.get_cache_snapshot()
        _ = cache['camera_start']
        _ = cache['db125_busy']
        _ = cache['yellow_cube_detected']
    end = time.perf_counter()

    cache_time_ms = ((end - start) / iterations) * 1000
    logger.info(f"\n⚡ Cache read performance:")
    logger.info(f"  {iterations} reads in {(end-start)*1000:.1f}ms")
    logger.info(f"  Average per read: {cache_time_ms:.3f}ms")
    logger.info(f"  Throughput: {iterations/(end-start):.0f} reads/sec")

    worker.stop()

    assert cache_time_ms < 0.1, "Cache reads should be < 0.1ms"

    logger.info("\n✅ TEST 2 PASSED\n")


def test_write_queue():
    """Test 3: Write queueing and execution"""
    logger.info("=" * 60)
    logger.info("TEST 3: Write Queue")
    logger.info("=" * 60)

    worker = PLCWorker(
        plc_ip='192.168.7.2',
        rack=0,
        slot=1,
        cycle_time_ms=100
    )

    worker.start()
    time.sleep(1.0)

    # Queue multiple writes
    logger.info("Queueing 10 test writes...")
    for i in range(10):
        byte_data = bytearray(1)
        snap7.util.set_bool(byte_data, 0, 2, i % 2 == 0)  # Alternate busy bit
        worker.queue_write(worker.camera_db_number, worker.camera_db_tags['start']['byte'], byte_data, f"Test write {i}")

    # Wait for execution (next cycle)
    time.sleep(0.2)

    stats = worker.get_stats()
    logger.info(f"\n📊 Write statistics:")
    logger.info(f"  Write errors: {stats['write_errors']}")

    worker.stop()

    assert stats['write_errors'] == 0, "Should have no write errors"

    logger.info("\n✅ TEST 3 PASSED\n")


def test_vision_handshake():
    """Test 4: Vision handshake state machine"""
    logger.info("=" * 60)
    logger.info("TEST 4: Vision Handshake")
    logger.info("=" * 60)

    logger.info("\n⚠️  This test requires PLC to set Camera_Start=TRUE")
    logger.info("    Please manually set DBX26.0 in TIA Portal or HMI")

    worker = PLCWorker(
        plc_ip='192.168.7.2',
        rack=0,
        slot=1,
        cycle_time_ms=100,
        vision_processor_callback=mock_vision_processor
    )

    worker.start()

    # Monitor for 30 seconds, waiting for handshake trigger
    logger.info("\nMonitoring for vision handshake (30 seconds)...")
    logger.info("Current state will be logged every 2 seconds...\n")

    for i in range(15):  # 15 x 2sec = 30sec
        time.sleep(2.0)

        cache = worker.get_cache_snapshot()
        state = worker.vision_state.state.value

        logger.info(
            f"[{i*2:2d}s] State={state:12s} | "
            f"Start={cache['camera_start']} | "
            f"Busy={cache['camera_busy']} | "
            f"Done={cache['camera_completed']} | "
            f"Yellow={cache['yellow_cube_detected']} | Metal={cache['metal_cube_detected']}"
        )

        # Check if we've completed at least one cycle
        if cache['camera_completed'] or cache['yellow_cube_detected'] or cache['metal_cube_detected']:
            logger.info("\n✅ Handshake completed successfully!")
            break
    else:
        logger.warning("\n⚠️  No handshake triggered (PLC didn't set start bit)")

    worker.stop()

    logger.info("\n✅ TEST 4 COMPLETED\n")


def test_stress():
    """Test 5: Stress test - rapid reads and writes"""
    logger.info("=" * 60)
    logger.info("TEST 5: Stress Test (60 seconds)")
    logger.info("=" * 60)

    worker = PLCWorker(
        plc_ip='192.168.7.2',
        rack=0,
        slot=1,
        cycle_time_ms=50,  # Fast cycle - 20 Hz
        vision_processor_callback=mock_vision_processor
    )

    worker.start()

    # Hammer the worker with reads and writes
    start_time = time.time()
    read_count = 0
    write_count = 0

    logger.info("\nRunning stress test...")

    while (time.time() - start_time) < 60:
        # Rapid cache reads
        for _ in range(100):
            cache = worker.get_cache_snapshot()
            _ = cache['camera_start']
            read_count += 1

        # Queue some writes
        for _ in range(5):
            byte_data = bytearray(1)
            worker.queue_write(worker.camera_db_number, worker.camera_db_tags['start']['byte'], byte_data, "Stress test")
            write_count += 1

        time.sleep(0.1)

    elapsed = time.time() - start_time
    stats = worker.get_stats()

    logger.info(f"\n📊 Stress test results ({elapsed:.1f}s):")
    logger.info(f"  PLC cycles: {stats['cycles']}")
    logger.info(f"  Cache reads: {read_count} ({read_count/elapsed:.0f}/sec)")
    logger.info(f"  Writes queued: {write_count} ({write_count/elapsed:.0f}/sec)")
    logger.info(f"  Avg cycle time: {stats['avg_cycle_time_ms']:.1f}ms")
    logger.info(f"  Max cycle time: {stats['max_cycle_time_ms']:.1f}ms")
    logger.info(f"  Read errors: {stats['read_errors']}")
    logger.info(f"  Write errors: {stats['write_errors']}")

    worker.stop()

    assert stats['cycles'] >= 1000, "Should complete ~1200 cycles at 50ms interval"
    assert stats['avg_cycle_time_ms'] < 100, "Average cycle should stay under 100ms"

    logger.info("\n✅ TEST 5 PASSED\n")


if __name__ == '__main__':
    logger.info("\n" + "=" * 60)
    logger.info("PLC WORKER TEST SUITE")
    logger.info("=" * 60 + "\n")

    try:
        # Run tests
        test_basic_connectivity()
        test_read_performance()
        test_write_queue()
        test_vision_handshake()
        test_stress()

        logger.info("\n" + "=" * 60)
        logger.info("🎉 ALL TESTS COMPLETED")
        logger.info("=" * 60 + "\n")

    except AssertionError as e:
        logger.error(f"\n❌ TEST FAILED: {e}\n")
        raise

    except KeyboardInterrupt:
        logger.info("\n\n⚠️  Tests interrupted by user\n")

    except Exception as e:
        logger.error(f"\n❌ UNEXPECTED ERROR: {e}\n", exc_info=True)
        raise
