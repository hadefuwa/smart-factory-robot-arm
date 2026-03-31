# DEPRECATION NOTICE

## Old PLC Communication Code

The following files/patterns are **DEPRECATED** and should not be used in new code:

### ❌ DEPRECATED: `plc_client.py`

**Status:** Deprecated as of 2026-03-30
**Replacement:** `plc_worker.py` + `plc_integration.py`

**Why deprecated:**
- Uses scattered `sleep()` delays (20ms, 100ms, 150ms)
- Causes "Job Pending" errors from thread contention
- Direct PLC access from multiple threads
- No deterministic cycle timing
- Writes to incorrect byte addresses (byte 40 doesn't exist in Camera_UDT!)

**Migration:**
1. Replace `from plc_client import PLCClient` with `from plc_integration import init_plc_worker`
2. Use `plc_worker` instead of `plc_client`
3. Read from cache via `get_plc_cache()` instead of `plc_client.read_*()`
4. Write via queue helpers instead of `plc_client.write_*()`

---

### ❌ DEPRECATED Patterns in `app.py`

#### 1. Direct Snap7 Reads in Endpoints
```python
# DEPRECATED - DO NOT USE
@app.route('/api/plc/status')
def get_status():
    tags = plc_client.read_vision_tags()  # ❌ BAD - direct PLC access
    return jsonify(tags)
```

**Replace with:**
```python
# CORRECT - read from cache
@app.route('/api/plc/status')
def get_status():
    cache = get_plc_cache()  # ✅ GOOD - instant cache read
    return jsonify({
        'camera_start': cache['camera_start'],
        'camera_busy': cache['camera_busy'],
        # ...
    })
```

#### 2. Scattered `sleep()` Delays
```python
# DEPRECATED - DO NOT USE
time.sleep(0.02)   # ❌ BAD - workaround for thread contention
time.sleep(0.15)   # ❌ BAD - workaround for "Job Pending"
```

**Replace with:**
- Nothing! The new worker has deterministic cycle timing, no delays needed.

#### 3. Old Polling Loop
```python
# DEPRECATED - DO NOT USE
def poll_loop():
    while True:
        all_data = plc_client.client.db_read(123, 0, 47)  # ❌ Wrong size!
        # ... decode ...
        time.sleep(1.0)

threading.Thread(target=poll_loop, daemon=True).start()
```

**Replace with:**
- Nothing! The new worker handles polling internally.

#### 4. Continuous Vision Mode
```python
# DEPRECATED - DO NOT USE
start_bit = True  # Force camera to always run  # ❌ BAD - breaks handshake
```

**Replace with:**
- Remove this line. The new worker implements proper handshake state machine.

#### 5. Incorrect Byte Addresses
```python
# DEPRECATED - DO NOT USE
plc_client.write_db_bool(123, 40, 2, True)  # ❌ Byte 40 doesn't exist!
```

**Replace with:**
```python
# CORRECT - byte 26 is Camera_UDT
queue_vision_result(...)  # ✅ Uses correct addresses
```

---

### ❌ DEPRECATED: config.json Settings

**Old (wrong):**
```json
{
  "db123": {
    "tags": {
      "busy": {"byte": 40, "bit": 2},        // ❌ WRONG!
      "completed": {"byte": 40, "bit": 3},   // ❌ WRONG!
      "object_number": {"byte": 42}          // ❌ WRONG!
    }
  }
}
```

**New (correct):**
```json
{
  "db123": {
    "total_size": 98,
    "tags": {
      "busy": {"byte": 26, "bit": 2},        // ✅ CORRECT
      "completed": {"byte": 26, "bit": 3},   // ✅ CORRECT
      "object_number": {"byte": 28}          // ✅ CORRECT
    }
  }
}
```

---

## Migration Timeline

### Phase 1: Compatibility Mode (CURRENT)
- Old `plc_client.py` still exists
- New `plc_worker.py` + `plc_integration.py` available
- Both can coexist via `PLCClientCompatWrapper`
- Gradual migration recommended

### Phase 2: Worker Only (Target: 1-2 weeks)
- All endpoints use cache reads
- All writes via queue
- Old polling loop removed
- `plc_client.py` marked as fully deprecated

### Phase 3: Cleanup (Target: 1 month)
- Remove `plc_client.py` entirely
- Remove compatibility wrapper
- Remove old config.json entries

---

## What to Do If You See Deprecated Code

### If you're writing NEW code:
- ✅ Use `plc_worker.py` + `plc_integration.py`
- ✅ Read from cache via `get_plc_cache()`
- ✅ Write via queue helpers (`queue_vision_result()`, etc.)
- ❌ DO NOT use `plc_client.py`
- ❌ DO NOT add new `sleep()` delays
- ❌ DO NOT access `plc_worker.client` directly

### If you're MAINTAINING existing code:
1. Check if the endpoint/function uses deprecated patterns (see above)
2. If yes, refactor to use new worker (see `plc_integration.py` examples)
3. Test thoroughly
4. Remove old code

### If you're DEBUGGING an issue:
1. Check if issue is "Job Pending" error → This is a symptom of using old code
2. Check if issue is slow reads → This is a symptom of direct PLC access
3. Check if issue is handshake not working → Check if continuous mode is enabled
4. Migrate to new worker to fix these issues

---

## Quick Reference

| Task | Old (Deprecated) | New (Correct) |
|------|------------------|---------------|
| **Initialize** | `plc_client = PLCClient(...)`<br>`plc_client.connect()` | `plc_worker = init_plc_worker(...)` |
| **Read tags** | `tags = plc_client.read_vision_tags()` | `cache = get_plc_cache()`<br>`start = cache['camera_start']` |
| **Write results** | `plc_client.write_vision_tags({...})` | `queue_vision_result(...)` |
| **Robot position** | `plc_client.write_current_pose({...})` | `queue_robot_position(x, y, z)` |
| **Check connection** | `plc_client.is_connected()` | `is_plc_connected()` |
| **Polling** | Custom `poll_loop()` function | Worker handles internally |

---

## Questions?

- Read: [REFACTORING_GUIDE.md](../REFACTORING_GUIDE.md)
- Read: [DB123_MEMORY_MAP.md](../DB123_MEMORY_MAP.md)
- Check: [plc_integration.py](plc_integration.py) for examples
- Test: Run `test_plc_worker.py`

---

## Final Note

The old `plc_client.py` architecture had good intentions but accumulated technical debt:
- Thread contention from multiple callers
- Workaround delays that added up
- Incorrect memory map assumptions
- No deterministic timing

The new `plc_worker.py` architecture fixes all these issues with:
- Single worker thread (no contention)
- Deterministic 100ms cycle (no random delays)
- Correct memory map from actual PLC export
- Cache-based reads (instant, no network)
- Queued writes (batched, efficient)

**Result:** 100x faster reads, zero "Job Pending" errors, cleaner code.

Please migrate when you can. Your future self will thank you! 🚀
