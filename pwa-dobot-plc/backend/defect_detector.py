"""
Two-stage per-class defect detector for cube QC.

Pipeline:
    USB frame --> YOLO detect --> for each cube crop:
      stage 1:  build a "cube surface" mask using the class envelope
                (chromatic: hue + S/V floors; metal: S cap + V floor)
                then erode it to drop cube edges + shadow halos
      stage 2:  inside that mask, look for dark blobs (V below an
                adaptive threshold = mean cube V × dark_factor). For
                metal we ALSO flag highly-saturated patches because a
                coloured stain on grey metal disrupts saturation rather
                than brightness.
      stage 3:  morphological opening + closing on the candidate blob
                mask to drop noise pixels and join close-together pixels
      stage 4:  defect_pct = blob area / cube area × 100. Defective if
                this exceeds the configured threshold.

Why this design (from a domain reviewer):
  * Hue is unreliable for dark pixels — a dark stain still has noisy
    "yellow-ish" H values, which fooled the earlier hue-only check.
    Looking at V *relative to the cube's own mean V* is robust to both
    contamination and lighting drift.
  * Eroding the cube mask before the blob check kills the "halo of
    dark pixels along the rounded cube edge" problem that would
    otherwise false-positive on every clean cube.
  * Morphological open + close removes single-pixel noise but keeps any
    real contamination blob intact, so the metric (blob area %) tracks
    actual defects rather than noise.

Class envelopes are still learned at training-time from clean YOLO
positives (see compute_defect_references.py). The dark_factor and
max_defect_pct sit in config.json so an operator can tune them per
class from the page sliders without retraining.

Lightweight: ~2 ms per crop on Pi 5. cv2 + numpy only.
"""

import logging
import os
from typing import Dict, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Fraction of the bbox to keep for analysis (centred). YOLO bboxes often
# have ~15-25% background around the cube; the centre patch keeps us
# inside the cube proper. Combined with mask erosion below, edges and
# shadow halos are reliably excluded.
CENTRE_FRACTION = 0.75

# Morphology kernel for mask erosion + open/close. 5x5 is large enough
# to drop single-pixel noise on a 480x640 frame.
KERNEL_SIZE = 5

# Default dark threshold = cube_mean_v × this. 0.55 means "anything
# darker than 55% of the cube's average brightness is a candidate
# defect". Per-class override lives in the envelope.
DEFAULT_DARK_FACTOR = 0.55

# Minimum cube-mask pixel count before we trust the analysis. If the
# cube mask is tiny, the bbox probably didn't catch the cube cleanly
# (e.g. cube partially out of frame) — return "not defective" rather
# than guessing.
MIN_CUBE_PIXELS = 200


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


def _build_cube_mask(hsv: np.ndarray, envelope: dict) -> np.ndarray:
    """Build a binary mask of pixels that look like this cube class.

    Returns a uint8 mask, 255 = cube surface, 0 = anything else.
    """
    h_ch, s_ch, v_ch = hsv[..., 0], hsv[..., 1], hsv[..., 2]

    if envelope.get('kind') == 'low_sat':
        # Metal: low saturation + reasonable brightness identifies the
        # cube surface. Highlights (V > 245) and shadows (V < v_min)
        # are excluded.
        s_max = envelope['s_max']
        v_min = envelope['v_min']
        mask = (
            (s_ch <= s_max) &
            (v_ch >= v_min) &
            (v_ch <= 245)
        ).astype(np.uint8) * 255
    else:
        # Chromatic: right hue, enough saturation, enough brightness.
        h_low = envelope['h_low']
        h_high = envelope['h_high']
        s_min = envelope['s_min']
        v_min = envelope['v_min']
        mask = (
            (h_ch >= h_low) & (h_ch <= h_high) &
            (s_ch >= s_min) &
            (v_ch >= v_min) & (v_ch <= 245)
        ).astype(np.uint8) * 255

    return mask


def detect(crop_bgr: np.ndarray, envelope: dict) -> Tuple[float, dict]:
    """Run the two-stage defect detector on a single cube crop.

    Returns (defect_pct, debug). defect_pct is 0..100. The caller
    decides defective-or-not based on the configured threshold.

    debug holds intermediate measurements useful for logging / HMI:
        cube_pixels:   int   pixels in the eroded cube mask
        cube_mean_v:   float average brightness of the cube surface
        dark_threshold:float V cutoff used for blob detection
        defect_pixels: int   pixels in the cleaned defect mask
    """
    if crop_bgr is None or crop_bgr.size == 0:
        return 0.0, {'reason': 'empty_crop'}
    if crop_bgr.ndim != 3 or crop_bgr.shape[2] != 3:
        return 0.0, {'reason': 'bad_shape'}

    patch = _centre_crop(crop_bgr)
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)

    # Stage 1: cube surface mask. We need two views of the cube:
    #   * cube_inner: tightly-eroded STRICT mask. Represents the
    #     definitely-clean cube surface; used to compute baseline V.
    #   * cube_area:  the convex hull of the strict mask. A dark stain
    #     on the cube creates a "hole" in the strict mask (the pixels
    #     fail v_min). Morphological closing can fill small holes but
    #     not large ones — the convex hull works regardless of stain
    #     size, giving us the cube's full outline as a solid polygon
    #     so the defect search can see every pixel of the cube.
    cube_mask = _build_cube_mask(hsv, envelope)
    kernel = np.ones((KERNEL_SIZE, KERNEL_SIZE), np.uint8)
    cube_inner = cv2.erode(cube_mask, kernel, iterations=2)
    cube_pixels = int(cv2.countNonZero(cube_inner))
    if cube_pixels < MIN_CUBE_PIXELS:
        return 0.0, {
            'reason': 'cube_mask_too_small',
            'cube_pixels': cube_pixels,
        }
    cube_area = np.zeros_like(cube_mask)
    contours, _ = cv2.findContours(cube_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        # Largest contour = cube body. Convex hull fills any stain holes.
        largest = max(contours, key=cv2.contourArea)
        hull = cv2.convexHull(largest)
        cv2.drawContours(cube_area, [hull], 0, 255, -1)
    else:
        cube_area = cube_mask  # degenerate, fall back to raw mask

    # Stage 2: dark-blob candidate mask inside the cube area (the
    # dilated mask). mean_v comes only from cube_inner so it reflects
    # the clean cube's brightness, not the dragged-down mean a stain
    # would produce if included.
    v_ch = hsv[..., 2]
    s_ch = hsv[..., 1]
    cube_mean_v = float(cv2.mean(v_ch, mask=cube_inner)[0])
    dark_factor = float(envelope.get('dark_factor', DEFAULT_DARK_FACTOR))
    dark_threshold = cube_mean_v * dark_factor

    candidate = np.zeros_like(v_ch, dtype=np.uint8)
    candidate[(cube_area > 0) & (v_ch < dark_threshold)] = 255

    # Metal also flags highly-saturated patches: a coloured tape /
    # sticker on a grey cube barely changes brightness but spikes
    # saturation. Skip for chromatic classes (their cube mask already
    # rejects out-of-range hues / low S).
    if envelope.get('kind') == 'low_sat':
        defect_s_min = float(
            envelope.get('defect_s_min', envelope.get('s_max', 100) + 30)
        )
        candidate[(cube_area > 0) & (s_ch >= defect_s_min)] = 255

    # Stage 3: morphology cleanup. Open removes noise pixels, close
    # joins near-adjacent ones into a single blob.
    cleaned = cv2.morphologyEx(candidate, cv2.MORPH_OPEN, kernel)
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel)
    defect_pixels = int(cv2.countNonZero(cleaned))

    defect_pct = (defect_pixels / cube_pixels) * 100.0
    return defect_pct, {
        'cube_pixels': cube_pixels,
        'cube_mean_v': round(cube_mean_v, 1),
        'dark_threshold': round(dark_threshold, 1),
        'defect_pixels': defect_pixels,
    }


class DefectDetector:
    """Holds per-class envelopes + thresholds, runs the defect check."""

    def __init__(self):
        self.envelopes: Dict[str, dict] = {}
        # Per-class "max defect % before rejecting". Higher = more
        # forgiving.
        self.thresholds: Dict[str, float] = {}
        self.training_max_defect: Dict[str, float] = {}
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
        self.training_max_defect = {}
        for cls, entry in data.items():
            self.envelopes[cls] = entry.get('envelope', {})
            self.training_max_defect[cls] = float(entry.get('train_max_defect_pct', 1.0))

        self.thresholds = dict(thresholds) if thresholds else {}
        self.enabled = bool(self.envelopes)
        logger.info(
            "DefectDetector loaded envelopes for %s; thresholds=%s; train_max_defect_pct=%s",
            list(self.envelopes.keys()), self.thresholds, self.training_max_defect
        )
        return self.enabled

    def check(self, crop_bgr: np.ndarray, class_name: str) -> Tuple[bool, float, dict]:
        """Return (is_defective, defect_pct, debug) for one cube crop.

        is_defective = defect_pct > class threshold (max defect %).
        """
        if not self.enabled:
            return (False, 0.0, {'reason': 'disabled'})
        envelope = self.envelopes.get(class_name)
        if envelope is None:
            return (False, 0.0, {'reason': 'unknown_class'})
        defect_pct, debug = detect(crop_bgr, envelope)
        thr = self.thresholds.get(class_name)
        if thr is None:
            # Auto-threshold: max of (1.5%, 2× worst clean-training
            # defect %). The 1.5% floor stops yellow (which scores 0%
            # on its clean training data) from flagging every speck of
            # sensor noise as a defect.
            thr = max(1.5, 2.0 * self.training_max_defect.get(class_name, 1.0))
        return (defect_pct > thr, defect_pct, debug)


_singleton = DefectDetector()


def get_singleton() -> DefectDetector:
    return _singleton
