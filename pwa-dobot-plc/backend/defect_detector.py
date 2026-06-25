"""
Per-class purity-index anomaly detector for cube QC.

Two-stage QC pipeline downstream of YOLO:
    USB frame --> YOLO detect --> for each cube crop:
                                    purity index (%) vs class threshold
                                    --> defective if below threshold

Trained only on clean cube examples — flags ANY visual disruption (tape,
sticker, marker, dirt, contamination) without ever having seen those
defects during training. Pure anomaly detection, no labelled defective
data required.

Why purity index over histogram distance:
  Histogram distance (Bhattacharyya etc.) is hard to interpret and
  proved noisy on these cubes — within-class variance was 0.5+ even
  between clean cubes of the same class (specular highlights, slight
  framing differences). Bad signal-to-noise for the defect signal.

  Purity index measures fraction of cube pixels that fall inside the
  expected hue + saturation envelope for the class. A clean yellow cube
  reads 85-95%. A yellow cube with black tape covering 30% of its face
  reads ~65% — tape pixels fall outside the yellow envelope. Trivially
  interpretable.

Class envelopes are learned at training-time from existing positive
YOLO labels (see compute_defect_references.py). Stored in
defect_references.json next to this module.

Lightweight: ~1 ms per crop on Pi 5. cv2 + numpy only.
"""

import logging
import os
from typing import Dict, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Fraction of the bbox to keep for purity computation (centred). YOLO
# bboxes typically have ~15-25% background around the cube. Sampling the
# centre keeps us inside the cube proper.
CENTRE_FRACTION = 0.65

# Specular highlights (V > MAX_VALUE) are reflections from lights —
# they're not the cube colour and they're not a defect, so we drop them
# from the denominator entirely. Dark pixels are NOT pre-filtered: a
# black mark / tape / marker is the cube's surface, just defective, so
# it must register as "out of envelope" (defect signal) rather than be
# ignored. The envelope itself enforces a minimum value to catch this.
MAX_VALUE = 245
DEFAULT_MIN_VALUE = 35
DEFAULT_MIN_SAT = 25


def _centre_crop(crop_bgr: np.ndarray, fraction: float = CENTRE_FRACTION) -> np.ndarray:
    """Return the central `fraction × fraction` patch of the crop."""
    h, w = crop_bgr.shape[:2]
    if h < 4 or w < 4:
        return crop_bgr
    keep_h = max(2, int(h * fraction))
    keep_w = max(2, int(w * fraction))
    y0 = (h - keep_h) // 2
    x0 = (w - keep_w) // 2
    return crop_bgr[y0:y0 + keep_h, x0:x0 + keep_w]


def collect_cube_pixels(crop_bgr: np.ndarray) -> Optional[np.ndarray]:
    """Return an (N, 3) array of HSV pixels from the cube's centre patch.

    Only specular highlights (V > MAX_VALUE) are stripped — they're
    reflections, not the cube. Dark pixels are KEPT in the denominator
    so black tape / marker shows up as out-of-envelope defect signal.
    """
    if crop_bgr is None or crop_bgr.size == 0:
        return None
    if crop_bgr.ndim != 3 or crop_bgr.shape[2] != 3:
        return None
    patch = _centre_crop(crop_bgr)
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    v_ch = hsv[..., 2]
    valid = v_ch <= MAX_VALUE
    if not valid.any():
        return None
    return hsv[valid]


def build_envelope(pixels_per_crop: list) -> dict:
    """Build a single class envelope from many crops' worth of HSV pixels.

    Strategy:
      * For chromatic classes (yellow / purple), take 5th-95th percentile
        of hue + saturation floor at 10th percentile. That's the "what
        clean cubes of this colour look like" zone.
      * For low-saturation classes (metal), hue is unstable so we use a
        saturation cap instead — anything more saturated than the cap is
        considered "foreign".
    """
    all_h = np.concatenate([p[:, 0] for p in pixels_per_crop])
    all_s = np.concatenate([p[:, 1] for p in pixels_per_crop])

    median_sat = float(np.median(all_s))
    # Fixed v_min across all classes — pixels darker than this are
    # "black" (tape / marker / hard shadow), not the cube. Auto-deriving
    # from training percentiles was too noisy: classes with natural dark
    # patches (e.g. purple shows shadowed faces) ended up with a v_min
    # so high that clean cubes failed the check.
    v_min = DEFAULT_MIN_VALUE

    if median_sat < 60:
        s_cap = float(np.percentile(all_s, 95)) + 5.0
        return {
            'kind': 'low_sat',
            's_max': s_cap,
            'v_min': v_min,
            'median_sat_train': median_sat,
        }

    h_low = float(np.percentile(all_h, 5))
    h_high = float(np.percentile(all_h, 95))
    s_min = max(DEFAULT_MIN_SAT, float(np.percentile(all_s, 10)) - 10.0)
    return {
        'kind': 'hue_range',
        'h_low': h_low,
        'h_high': h_high,
        's_min': s_min,
        'v_min': v_min,
        'median_sat_train': median_sat,
    }


def purity_index(crop_bgr: np.ndarray, envelope: dict) -> float:
    """Fraction (0..1) of valid cube pixels that fall inside the class
    envelope. 1.0 = perfectly clean, 0.0 = nothing matches.
    """
    pixels = collect_cube_pixels(crop_bgr)
    if pixels is None or len(pixels) == 0:
        return 0.0
    h, s, v = pixels[:, 0], pixels[:, 1], pixels[:, 2]

    v_min = envelope.get('v_min', DEFAULT_MIN_VALUE)

    if envelope.get('kind') == 'low_sat':
        # Metal: low saturation AND non-black. Black tape on a metal cube
        # is the canonical case here — black is "low sat" too, so we need
        # the v_min floor to call it defect.
        in_range = (v >= v_min) & (s <= envelope['s_max'])
    else:
        # Chromatic (yellow / purple): hue range only. OpenCV gives H=0
        # for true black, which falls outside any chromatic hue range,
        # so black tape registers as defect automatically. Saturation
        # floor would falsely flag clean cubes that happen to be
        # darker — chromatic classes have too much natural saturation
        # variance.
        in_range = (h >= envelope['h_low']) & (h <= envelope['h_high'])

    return float(in_range.sum()) / float(len(pixels))


class DefectDetector:
    """Holds per-class envelopes + thresholds, runs the purity check."""

    def __init__(self):
        self.envelopes: Dict[str, dict] = {}
        self.thresholds: Dict[str, float] = {}
        self.training_min_purity: Dict[str, float] = {}
        self.enabled: bool = False

    def load(self, refs_path: str, thresholds: Dict[str, float]) -> bool:
        if not os.path.exists(refs_path):
            logger.warning(
                "Defect reference file %s missing — defect detector disabled. "
                "Run compute_defect_references.py to build it.", refs_path
            )
            self.enabled = False
            return False
        try:
            import json
            with open(refs_path, 'r') as f:
                data = json.load(f)
        except Exception as e:
            logger.error("Failed to load defect references %s: %s", refs_path, e)
            self.enabled = False
            return False

        self.envelopes = {}
        self.training_min_purity = {}
        for cls, entry in data.items():
            self.envelopes[cls] = entry.get('envelope', {})
            self.training_min_purity[cls] = float(entry.get('train_min_purity', 1.0))

        self.thresholds = dict(thresholds) if thresholds else {}
        self.enabled = bool(self.envelopes)
        logger.info(
            "DefectDetector loaded envelopes for %s; thresholds=%s; train_min_purity=%s",
            list(self.envelopes.keys()), self.thresholds, self.training_min_purity
        )
        return self.enabled

    def check(self, crop_bgr: np.ndarray, class_name: str) -> Tuple[bool, float]:
        """Return (is_defective, purity_0to1) for one cube crop."""
        if not self.enabled:
            return (False, 1.0)
        envelope = self.envelopes.get(class_name)
        if envelope is None:
            return (False, 1.0)
        p = purity_index(crop_bgr, envelope)
        thr = self.thresholds.get(class_name)
        if thr is None:
            # Auto: 0.5 × worst clean training purity.
            thr = 0.5 * self.training_min_purity.get(class_name, 0.8)
        return (p < thr, p)


_singleton = DefectDetector()


def get_singleton() -> DefectDetector:
    return _singleton
