"""
PoE CAM Vision Service
Runs YOLO cube detection on frames pulled from the M5Stack PoE CAM-W.

This service is separate from the USB-camera HSV colour detection pipeline.
It is activated when the frontend switches to PoE CAM mode.

Classes detected:
    0 = yellow_cube
    1 = white_cube
    2 = metal_cube

Model search order (first found wins):
    1. ~/cube_detector.pt
    2. ./cube_detector.pt  (backend dir)
    3. ../../cube-training/runs/detect/cube_train/weights/best.pt
    4. ../../cube-training/runs/detect/cube_train/weights/cube_detector.pt
"""

import os
import threading
import logging
import time
import urllib.request

import numpy as np

logger = logging.getLogger(__name__)

# ── Model state ───────────────────────────────────────────────────────────────
_model       = None
_model_lock  = threading.Lock()
_model_path  = None
_model_ready = False

CUBE_CLASSES = {0: "yellow_cube", 1: "white_cube", 2: "metal_cube"}
CUBE_COLOURS = {
    "yellow_cube": (0,   200, 255),   # BGR
    "white_cube":  (255, 255, 255),
    "metal_cube":  (180, 180, 180),
}

DEFAULT_CONF = 0.30
DEFAULT_IOU  = 0.45


# ── Model loading ─────────────────────────────────────────────────────────────
def _candidate_model_paths():
    here = os.path.dirname(os.path.abspath(__file__))
    return [
        os.path.expanduser("~/cube_detector.pt"),
        os.path.join(here, "cube_detector.pt"),
        os.path.join(here, "..", "..", "cube-training", "runs", "detect",
                     "cube_train", "weights", "best.pt"),
        os.path.join(here, "..", "..", "cube-training", "runs", "detect",
                     "cube_train", "weights", "cube_detector.pt"),
    ]


def resolve_model_path():
    for p in _candidate_model_paths():
        norm = os.path.normpath(p)
        if os.path.exists(norm):
            return norm
    return None


def load_model():
    """Load the cube YOLO model. Safe to call multiple times."""
    global _model, _model_path, _model_ready
    with _model_lock:
        if _model_ready:
            return True
        path = resolve_model_path()
        if path is None:
            logger.warning(
                "Cube detector model not found. Train it first — see cube-training/CUBE_TRAINING_GUIDE.md"
            )
            return False
        try:
            from ultralytics import YOLO
            logger.info(f"Loading cube detector from {path}")
            _model = YOLO(path)
            _model_path = path
            _model_ready = True
            logger.info("Cube detector loaded OK")
            return True
        except Exception as e:
            logger.error(f"Failed to load cube detector: {e}")
            return False


def is_ready():
    return _model_ready


# ── Frame fetching ────────────────────────────────────────────────────────────
def fetch_frame(poe_ip: str, timeout: int = 4):
    """Pull a single JPEG from the PoE CAM /capture endpoint."""
    url = f"http://{poe_ip}/capture"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            data = r.read()
        arr = np.frombuffer(data, dtype=np.uint8)
        import cv2
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        return frame
    except Exception as e:
        logger.warning(f"PoE CAM frame fetch failed ({url}): {e}")
        return None


# ── Inference ─────────────────────────────────────────────────────────────────
def detect_cubes(frame, conf: float = DEFAULT_CONF, iou: float = DEFAULT_IOU):
    """
    Run YOLO inference on a frame (numpy BGR array).
    Returns a dict with detections and an annotated frame.
    """
    if not _model_ready:
        return {"ok": False, "error": "model_not_loaded", "detections": []}

    import cv2

    with _model_lock:
        results = _model.predict(
            source=frame,
            conf=conf,
            iou=iou,
            verbose=False,
        )

    detections = []
    annotated  = frame.copy()

    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            label  = CUBE_CLASSES.get(cls_id, f"class_{cls_id}")
            conf_v = float(box.conf[0])
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            w = x2 - x1
            h = y2 - y1
            cx = x1 + w // 2
            cy = y1 + h // 2
            colour = CUBE_COLOURS.get(label, (0, 255, 0))

            detections.append({
                "class":      label,
                "class_id":   cls_id,
                "confidence": round(conf_v, 4),
                "x": x1, "y": y1, "width": w, "height": h,
                "center":     [cx, cy],
                "area":       w * h,
            })

            # Draw bounding box + label
            cv2.rectangle(annotated, (x1, y1), (x2, y2), colour, 2)
            text = f"{label} {conf_v:.0%}"
            (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
            cv2.rectangle(annotated, (x1, y1 - th - 6), (x1 + tw + 4, y1), colour, -1)
            cv2.putText(annotated, text, (x1 + 2, y1 - 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 1)

    # Dominant class = highest-confidence detection
    dominant = None
    if detections:
        best = max(detections, key=lambda d: d["confidence"])
        dominant = best["class"]

    return {
        "ok":          True,
        "dominant":    dominant,
        "count":       len(detections),
        "detections":  detections,
        "annotated":   annotated,   # numpy BGR array
        "timestamp":   time.time(),
    }


# ── High-level: fetch + detect in one call ────────────────────────────────────
def run_on_poe_cam(poe_ip: str, conf: float = DEFAULT_CONF):
    """Fetch a frame from the PoE CAM and run cube detection. Returns result dict."""
    frame = fetch_frame(poe_ip)
    if frame is None:
        return {"ok": False, "error": "camera_unreachable", "detections": []}
    return detect_cubes(frame, conf=conf)


# ── Status ────────────────────────────────────────────────────────────────────
def status():
    return {
        "model_ready": _model_ready,
        "model_path":  _model_path,
        "classes":     CUBE_CLASSES,
        "candidates":  _candidate_model_paths(),
    }
