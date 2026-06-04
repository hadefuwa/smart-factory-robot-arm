"""
PoE CAM Vision Service
Runs YOLO cube detection on frames pulled from the M5Stack PoE CAM-W.

This service is separate from the USB-camera HSV colour detection pipeline.
It is activated when the frontend switches to PoE CAM mode.

Classes detected:
    0 = yellow_cube
    1 = purple_cube
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

CUBE_CLASSES = {0: "yellow_cube", 1: "purple_cube", 2: "metal_cube"}
CUBE_COLOURS = {
    "yellow_cube": (0,   200, 255),   # BGR
    "purple_cube": (240, 32,  160),
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


def apply_crop(frame, crop_cfg):
    """Trim percentages off each edge of `frame` and return the cropped view.

    `crop_cfg` is an optional dict of the form
        {"enabled": True, "top_pct": 20, "bottom_pct": 0, "left_pct": 0, "right_pct": 20}
    Percentages are of the corresponding dimension; missing keys default to 0.
    Returns the original frame unchanged when crop_cfg is falsy or disabled,
    or when the resulting region would be empty.

    Cropping happens BEFORE inference so YOLO never sees the trimmed region —
    cleaner than relying on the model to learn to ignore it. The cropped
    frame also flows through to /api/poe-vision/annotated and
    /api/poe-camera/capture, so training data captured via the page is
    automatically in the same field of view as production inference.
    """
    if not crop_cfg or not crop_cfg.get('enabled'):
        return frame
    h, w = frame.shape[:2]
    top    = max(0.0, min(100.0, float(crop_cfg.get('top_pct',    0))))
    bottom = max(0.0, min(100.0, float(crop_cfg.get('bottom_pct', 0))))
    left   = max(0.0, min(100.0, float(crop_cfg.get('left_pct',   0))))
    right  = max(0.0, min(100.0, float(crop_cfg.get('right_pct',  0))))
    y1 = int(h * top    / 100.0)
    y2 = int(h * (1.0 - bottom / 100.0))
    x1 = int(w * left   / 100.0)
    x2 = int(w * (1.0 - right  / 100.0))
    if y2 - y1 < 8 or x2 - x1 < 8:
        # Crop would collapse the frame — bail out and use the full view.
        return frame
    return frame[y1:y2, x1:x2]


def apply_mask(frame, mask_cfg):
    """Paint solid-colour rectangles over the edges of `frame` IN PLACE.

    Unlike apply_crop this preserves the original frame dimensions, so a YOLO
    model trained on full-resolution frames sees the same aspect ratio at
    inference. The masked region is replaced with `color_bgr` (default black,
    which YOLO tends to handle cleanly because it resembles letterbox padding
    common in training augmentation).

    `mask_cfg` shape:
        {"enabled": True, "color_bgr": [0,0,0],
         "top_pct": 0, "bottom_pct": 0, "left_pct": 0, "right_pct": 30}
    Returns the frame unchanged when mask_cfg is falsy or disabled.
    """
    if not mask_cfg or not mask_cfg.get('enabled'):
        return frame
    h, w = frame.shape[:2]
    top    = max(0.0, min(100.0, float(mask_cfg.get('top_pct',    0))))
    bottom = max(0.0, min(100.0, float(mask_cfg.get('bottom_pct', 0))))
    left   = max(0.0, min(100.0, float(mask_cfg.get('left_pct',   0))))
    right  = max(0.0, min(100.0, float(mask_cfg.get('right_pct',  0))))
    raw_color = mask_cfg.get('color_bgr', [0, 0, 0])
    try:
        color = tuple(int(c) for c in raw_color)
        if len(color) != 3:
            color = (0, 0, 0)
    except Exception:
        color = (0, 0, 0)

    # Copy so we don't mutate the caller's frame array.
    result = frame.copy()
    if top > 0:
        y = int(h * top / 100.0)
        result[:y, :] = color
    if bottom > 0:
        y = int(h * (1.0 - bottom / 100.0))
        result[y:, :] = color
    if left > 0:
        x = int(w * left / 100.0)
        result[:, :x] = color
    if right > 0:
        x = int(w * (1.0 - right / 100.0))
        result[:, x:] = color
    return result


def keep_box_from_mask(frame_shape, mask_cfg):
    """Return (x_min, y_min, x_max, y_max) of the un-masked region, or None.

    Used to filter out detections whose centre falls inside the masked area
    after apply_mask has zeroed it — YOLO sometimes hallucinates a box at
    the hard mask boundary because the high-contrast edge looks like an
    object edge.
    """
    if not mask_cfg or not mask_cfg.get('enabled'):
        return None
    h, w = frame_shape[:2]
    top    = max(0.0, min(100.0, float(mask_cfg.get('top_pct',    0))))
    bottom = max(0.0, min(100.0, float(mask_cfg.get('bottom_pct', 0))))
    left   = max(0.0, min(100.0, float(mask_cfg.get('left_pct',   0))))
    right  = max(0.0, min(100.0, float(mask_cfg.get('right_pct',  0))))
    return (
        int(w * left   / 100.0),
        int(h * top    / 100.0),
        int(w * (1.0 - right  / 100.0)),
        int(h * (1.0 - bottom / 100.0)),
    )


def draw_detections(frame, detections):
    """Draw bounding boxes for a list of detections onto a copy of `frame`.

    Each detection is expected to look like the dicts returned by
    detect_cubes: keys x, y, width, height, class, confidence. Used by the
    frame-pump thread to overlay the most-recent inference result onto each
    freshly-pulled raw frame, so the HMI stream updates at pump cadence
    even while inference cadence stays at POE_LOOP_INTERVAL_S.
    """
    import cv2
    out = frame.copy()
    if not detections:
        return out
    for d in detections:
        x1 = int(d.get('x', 0))
        y1 = int(d.get('y', 0))
        x2 = x1 + int(d.get('width', 0))
        y2 = y1 + int(d.get('height', 0))
        label = str(d.get('class', ''))
        conf_v = float(d.get('confidence', 0.0))
        colour = CUBE_COLOURS.get(label, (0, 255, 0))
        cv2.rectangle(out, (x1, y1), (x2, y2), colour, 2)
        text = f"{label} {conf_v:.0%}"
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        cv2.rectangle(out, (x1, y1 - th - 6), (x1 + tw + 4, y1), colour, -1)
        cv2.putText(out, text, (x1 + 2, y1 - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 1)
    return out


# ── Inference ─────────────────────────────────────────────────────────────────
def detect_cubes(frame, conf: float = DEFAULT_CONF, iou: float = DEFAULT_IOU, keep_box=None, class_conf=None, draw_on=None):
    """
    Run YOLO inference on a frame (numpy BGR array).
    Returns a dict with detections and an annotated frame.

    keep_box: optional (x_min, y_min, x_max, y_max). Detections whose centre
    falls outside this region are dropped from both the detections list and
    the drawn annotation — used to ignore mask-edge hallucinations.

    class_conf: optional dict {class_name: min_confidence} for per-class
    thresholds (e.g. {"yellow_cube": 0.35, "purple_cube": 0.50,
    "metal_cube": 0.60}). Lets you be permissive on a class the model
    consistently under-confidently detects and strict on a class that
    produces frequent false positives. When given, YOLO's own `conf`
    floor is set to the LOWEST per-class threshold so every candidate
    gets through to the post-filter; detections whose confidence is
    below their class's threshold are then dropped.

    draw_on: optional numpy BGR array of the same shape as `frame`. When
    provided, bounding boxes are drawn onto a copy of this image instead
    of the inference frame — used to hide the preprocessing mask from
    the cached annotated JPEG that feeds the PLC HMI stream.
    """
    if not _model_ready:
        return {"ok": False, "error": "model_not_loaded", "detections": []}

    import cv2

    # Use the lowest per-class threshold as YOLO's floor so we don't reject
    # candidates we want to keep for a class with a low threshold.
    yolo_floor = conf
    if class_conf:
        try:
            yolo_floor = min(min(class_conf.values()), conf)
        except ValueError:
            pass

    with _model_lock:
        results = _model.predict(
            source=frame,
            conf=yolo_floor,
            iou=iou,
            verbose=False,
        )

    detections = []
    if draw_on is not None and draw_on.shape == frame.shape:
        annotated = draw_on.copy()
    else:
        annotated = frame.copy()

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

            # Per-class confidence filter (post-NMS).
            if class_conf is not None:
                class_threshold = float(class_conf.get(label, conf))
                if conf_v < class_threshold:
                    continue

            # Drop detections whose centre is outside the un-masked region.
            if keep_box is not None:
                kx1, ky1, kx2, ky2 = keep_box
                if not (kx1 <= cx < kx2 and ky1 <= cy < ky2):
                    continue

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
