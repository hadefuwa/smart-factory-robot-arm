"""
Structured JSONL event log for sf2.

One line per event, written to /home/pi/sf2/logs/events-YYYY-MM-DD.jsonl.
Daily rotation, 30-day retention. Thread-safe (file append under lock).
Also tees to the standard Python logger so events appear in journalctl too.

The goal is durable, queryable history of state transitions that matter:
camera bit flips, robot bridge connect/disconnect, auto-move arrivals
and timeouts, PLC connection drops, slow cycles, manual override events.
Vision detections are intentionally NOT logged here (too high volume) —
they go to the existing PLC handshake bits.

Read back via:
  - tail -f /home/pi/sf2/logs/events-$(date +%Y-%m-%d).jsonl
  - GET /api/events?since=...&category=...&limit=...
"""
import os
import json
import threading
import time
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

EVENT_LOG_DIR = '/home/pi/sf2/logs'
EVENT_LOG_RETENTION_DAYS = 30

# Allowed severities — keeping the schema disciplined so dashboards/queries
# can rely on a small enum.
SEVERITY_INFO = 'info'
SEVERITY_WARN = 'warn'
SEVERITY_ERROR = 'error'

# Allowed categories — same reason. Add new categories deliberately.
CATEGORIES = {
    'system',     # service start/stop, config reload
    'plc',        # PLC connection state, slow cycles
    'camera',     # PoE camera reachability transitions
    'robot',      # bridge connection, joint offline/online, USB recovery
    'auto_move',  # PLC target dispatch, arrival, timeout, invalid_target
    'safety',     # interlock activations, torque-off events
    'manual',     # manual override on/off
}

_log_lock = threading.Lock()
_last_cleanup_ts = 0.0


def _ensure_log_dir() -> None:
    try:
        os.makedirs(EVENT_LOG_DIR, exist_ok=True)
    except Exception as e:
        logger.warning(f'event log dir create failed: {e}')


def _current_log_path() -> str:
    return os.path.join(EVENT_LOG_DIR, f"events-{datetime.now().strftime('%Y-%m-%d')}.jsonl")


def _maybe_cleanup_old_logs() -> None:
    """Drop event files older than EVENT_LOG_RETENTION_DAYS. Runs at most
    once per hour (cheap stat-only loop, but no need to scan more often)."""
    global _last_cleanup_ts
    now = time.time()
    if now - _last_cleanup_ts < 3600:
        return
    _last_cleanup_ts = now
    try:
        cutoff = datetime.now() - timedelta(days=EVENT_LOG_RETENTION_DAYS)
        for fname in os.listdir(EVENT_LOG_DIR):
            if not fname.startswith('events-') or not fname.endswith('.jsonl'):
                continue
            date_part = fname[len('events-'):-len('.jsonl')]
            try:
                file_date = datetime.strptime(date_part, '%Y-%m-%d')
            except ValueError:
                continue
            if file_date < cutoff:
                try:
                    os.remove(os.path.join(EVENT_LOG_DIR, fname))
                    logger.info(f'event log: deleted old file {fname}')
                except Exception as e:
                    logger.warning(f'event log cleanup failed for {fname}: {e}')
    except FileNotFoundError:
        pass
    except Exception as e:
        logger.warning(f'event log cleanup scan failed: {e}')


def log_event(
    category: str,
    event: str,
    message: str = '',
    severity: str = SEVERITY_INFO,
    **fields: Any,
) -> None:
    """Append one structured event to today's JSONL file. Thread-safe.
    Also tees to the standard logger (severity → log level) so the same
    information shows up in journalctl alongside its surrounding context.

    Args:
      category: one of CATEGORIES (loud warning if unknown)
      event:    short snake_case identifier, e.g. 'camera_disconnected'
      message:  human-readable one-line description
      severity: 'info' | 'warn' | 'error'
      **fields: arbitrary structured payload, JSON-serialisable
    """
    if category not in CATEGORIES:
        logger.warning(f'event log: unknown category {category!r} for event {event!r}')

    record: Dict[str, Any] = {
        'ts': datetime.now().isoformat(timespec='milliseconds'),
        'ts_epoch': round(time.time(), 3),
        'category': category,
        'severity': severity,
        'event': event,
        'message': message,
    }
    if fields:
        record['fields'] = fields

    line = json.dumps(record, default=str, separators=(',', ':')) + '\n'

    with _log_lock:
        _ensure_log_dir()
        _maybe_cleanup_old_logs()
        try:
            with open(_current_log_path(), 'a', encoding='utf-8') as f:
                f.write(line)
        except Exception as e:
            logger.warning(f'event log write failed: {e}')

    # Tee to standard logger so journal keeps it too.
    log_msg = f'[{category}] {event}: {message}' if message else f'[{category}] {event}'
    if fields:
        log_msg += f' | {fields}'
    if severity == SEVERITY_ERROR:
        logger.error(log_msg)
    elif severity == SEVERITY_WARN:
        logger.warning(log_msg)
    else:
        logger.info(log_msg)


def read_recent_events(
    limit: int = 200,
    since_epoch: Optional[float] = None,
    category: Optional[str] = None,
    severity: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Read recent events from today's file (and yesterday's if needed).
    Returns newest first. Filter args are applied after reading."""
    files: List[str] = []
    today = datetime.now()
    for offset in range(0, 2):  # today and yesterday is enough for "recent"
        d = today - timedelta(days=offset)
        p = os.path.join(EVENT_LOG_DIR, f"events-{d.strftime('%Y-%m-%d')}.jsonl")
        if os.path.exists(p):
            files.append(p)

    rows: List[Dict[str, Any]] = []
    for path in files:
        try:
            with open(path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except Exception:
                        continue
                    if since_epoch is not None and rec.get('ts_epoch', 0) < since_epoch:
                        continue
                    if category is not None and rec.get('category') != category:
                        continue
                    if severity is not None and rec.get('severity') != severity:
                        continue
                    rows.append(rec)
        except Exception as e:
            logger.warning(f'event log read failed for {path}: {e}')

    rows.sort(key=lambda r: r.get('ts_epoch', 0), reverse=True)
    return rows[:limit]
