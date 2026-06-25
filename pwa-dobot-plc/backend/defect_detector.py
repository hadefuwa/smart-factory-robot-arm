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
# Absolute hard floor for v_min — pixels below this are basically black
# and never represent the cube's intended colour, regardless of how dark
# the class is. Set low enough that genuinely-dark classes (like the
# purple-cube training set which has V medians of 24-33) still pass.
DEFAULT_MIN_VALUE = 8
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
      * For chromatic classes (yellow / purple), constrain by hue range
        AND a brightness floor learned from training data. Dark stains /
        ink / tape on a brightly-coloured cube fall in the right hue but
        with low V, so the floor catches them.
      * For low-saturation classes (metal), hue is unstable so we use a
        saturation cap + brightness floor instead — anything more
        saturated than the cap is "foreign", anything darker than the
        floor is dirt / tape.
    """
    all_h = np.concatenate([p[:, 0] for p in pixels_per_crop])
    all_s = np.concatenate([p[:, 1] for p in pixels_per_crop])
    all_v = np.concatenate([p[:, 2] for p in pixels_per_crop])

    median_sat = float(np.median(all_s))

    # Per-class V floor: 2nd percentile of training V minus 10. This
    # adapts to the actual brightness distribution of the class. Bright
    # yellow ends up with a floor around 100 (so a dark ink stain on
    # yellow at V≈50 reads as out-of-envelope = defective). Darker
    # purple ends up around 10 (purple has V medians of 24-33 in the
    # training data — its floor catches near-black stains only).
    v_min = max(DEFAULT_MIN_VALUE, float(np.percentile(all_v, 2)) - 10.0)

    if median_sat < 60:
        s_cap = float(np.percentile(all_s, 95)) + 5.0
        return {
            'kind': 'low_sat',
            's_max': s_cap,
            'v_min': v_min,
            'median_sat_train': median_sat,
        }

    # Hue range with generous margins. The raw p5-p95 envelope was too
    # narrow on purple (~7 H values) — individual training crops with
    # hue 8-10 units outside the per-pixel distribution fell entirely
    # out of range and tanked clean purity. Adding ±10 margin makes the
    # envelope cover the natural between-crop variance without being so
    # wide it lets defective hues sneak in (yellow is ~20 wide after
    # margin, still far from green or red).
    h_low = max(0.0, float(np.percentile(all_h, 5)) - 10.0)
    h_high = min(179.0, float(np.percentile(all_h, 95)) + 10.0)
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
        # Metal: low saturation AND non-black. Black tape / ink on a
        # metal cube is "low sat" too, so the v_min floor is what calls
        # it defective.
        in_range = (v >= v_min) & (s <= envelope['s_max'])
    else:
        # Chromatic (yellow / purple): right hue AND bright enough.
        # Without the v_min check, dark-yellow stains (e.g. ink that's
        # technically still in the yellow hue range but dim) would
        # register as clean yellow and miss the defect. The brightness
        # floor is learned per class, so it adapts to purple being
        # naturally darker than yellow.
        in_range = (
            (h >= envelope['h_low']) &
            (h <= envelope['h_high']) &
            (v >= v_min)
        )

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
