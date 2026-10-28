"""
Build per-class envelopes for the two-stage defect detector.

Walks the YOLO training labels, crops each positive bbox, learns the
HSV envelope that identifies clean cube pixels, and runs the same
detect() the inference loop uses against each clean training crop. The
worst defect_pct seen on the clean data becomes train_max_defect_pct —
the noise floor — so the inference auto-threshold can sit above it.

Run after every retrain (envelopes adapt to the dataset):
    python compute_defect_references.py

Output: defect_references.json next to this script.
"""

import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from defect_detector import detect, _centre_crop  # noqa: E402

CLASS_NAMES = {0: 'yellow_cube', 1: 'purple_cube', 2: 'metal_cube'}

CANDIDATE_ROOTS = [
    os.path.normpath(os.path.join(HERE, '..', '..', 'cube-training')),
    os.path.normpath(os.path.join(HERE, '..', 'cube-training')),
]

OUTPUT_PATH = os.path.join(HERE, 'defect_references.json')

# Hue-range margins added to the p5-p95 of training hues so single
# crops with hue drift don't fall outside the envelope.
HUE_MARGIN = 10
# Floor / cap absolute defaults so envelopes never collapse to nonsense
# on small / noisy training sets.
MIN_V_FLOOR = 5
DEFAULT_DARK_FACTOR = 0.55


def find_training_root():
    for root in CANDIDATE_ROOTS:
        if (os.path.isdir(os.path.join(root, 'cube_images')) and
                os.path.isdir(os.path.join(root, 'cube_labels'))):
            return root
    return None


def crop_from_label_line(img, line):
    parts = line.strip().split()
    if len(parts) != 5:
        return None
    try:
        cls = int(parts[0])
        cx, cy, w, h = [float(p) for p in parts[1:]]
    except ValueError:
        return None
    H, W = img.shape[:2]
    x0 = int(max(0, (cx - w / 2) * W))
    y0 = int(max(0, (cy - h / 2) * H))
    x1 = int(min(W, (cx + w / 2) * W))
    y1 = int(min(H, (cy + h / 2) * H))
    if x1 <= x0 or y1 <= y0:
        return None
    return cls, img[y0:y1, x0:x1]


def build_envelope_from_pixels(all_h, all_s, all_v):
    """Decide chromatic vs low-sat from the saturation distribution,
    then derive envelope thresholds with margins applied."""
    median_sat = float(np.median(all_s))
    if median_sat < 60:
        # Metal: low saturation defines the cube surface.
        s_max = float(np.percentile(all_s, 95)) + 10.0
        v_min = max(MIN_V_FLOOR, float(np.percentile(all_v, 2)) - 10.0)
        # Coloured-tape defect signal: anything more saturated than this
        # is foreign. Sits well above the cube's own s_max.
        defect_s_min = s_max + 40.0
        return {
            'kind': 'low_sat',
            's_max': round(s_max, 1),
            'v_min': round(v_min, 1),
            'defect_s_min': round(defect_s_min, 1),
            'dark_factor': DEFAULT_DARK_FACTOR,
            'median_sat_train': round(median_sat, 1),
        }
    # Chromatic: hue range + S floor + V floor.
    h_low = max(0.0, float(np.percentile(all_h, 5)) - HUE_MARGIN)
    h_high = min(179.0, float(np.percentile(all_h, 95)) + HUE_MARGIN)
    s_min = max(40.0, float(np.percentile(all_s, 10)) - 20.0)
    v_min = max(MIN_V_FLOOR, float(np.percentile(all_v, 2)) - 10.0)
    return {
        'kind': 'hue_range',
        'h_low': round(h_low, 1),
        'h_high': round(h_high, 1),
        's_min': round(s_min, 1),
        'v_min': round(v_min, 1),
        'dark_factor': DEFAULT_DARK_FACTOR,
        'median_sat_train': round(median_sat, 1),
    }


def main():
    root = find_training_root()
    if root is None:
        print("ERROR: couldn't find cube-training/{cube_images,cube_labels}")
        sys.exit(1)

    images_dir = os.path.join(root, 'cube_images')
    labels_dir = os.path.join(root, 'cube_labels')
    print(f"Using training root: {root}")

    per_class_crops = {name: [] for name in CLASS_NAMES.values()}
    processed = 0
    skipped = 0
    for fname in sorted(os.listdir(labels_dir)):
        if not fname.lower().endswith('.txt'):
            continue
        label_path = os.path.join(labels_dir, fname)
        img_name = os.path.splitext(fname)[0] + '.jpg'
        img_path = os.path.join(images_dir, img_name)
        if not os.path.exists(img_path):
            continue
        with open(label_path, 'r') as f:
            lines = [ln for ln in f.read().splitlines() if ln.strip()]
        if not lines:
            continue
        img = cv2.imread(img_path)
        if img is None:
            skipped += 1
            continue
        for line in lines:
            parsed = crop_from_label_line(img, line)
            if parsed is None:
                skipped += 1
                continue
            cls_id, crop = parsed
            cls_name = CLASS_NAMES.get(cls_id)
            if cls_name is None:
                skipped += 1
                continue
            per_class_crops[cls_name].append(crop)
            processed += 1

    print(f"\nProcessed {processed} crops; skipped {skipped}.")
    for name, crops in per_class_crops.items():
        print(f"  {name:13s}: {len(crops)} crops")

    output = {}
    print("\nClass envelopes + training-data defect %:")
    for cls_name, crops in per_class_crops.items():
        if len(crops) < 2:
            print(f"  {cls_name:13s}: skipped ({len(crops)} crops)")
            continue

        # Aggregate HSV pixels across all crops to learn the envelope.
        all_h = []
        all_s = []
        all_v = []
        for c in crops:
            patch = _centre_crop(c)
            hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
            all_h.append(hsv[..., 0].ravel())
            all_s.append(hsv[..., 1].ravel())
            all_v.append(hsv[..., 2].ravel())
        all_h = np.concatenate(all_h)
        all_s = np.concatenate(all_s)
        all_v = np.concatenate(all_v)

        envelope = build_envelope_from_pixels(all_h, all_s, all_v)

        # Run the actual two-stage detect() against each clean crop.
        # Worst (max) defect_pct = the noise floor; the inference path
        # uses 2× this as the auto-threshold so clean cubes are safe.
        defect_pcts = []
        for c in crops:
            pct, _ = detect(c, envelope)
            defect_pcts.append(pct)
        worst = float(max(defect_pcts))
        mean = float(np.mean(defect_pcts))

        output[cls_name] = {
            'envelope': envelope,
            'train_max_defect_pct': worst,
            'train_mean_defect_pct': mean,
            'crop_count': len(crops),
        }

        if envelope['kind'] == 'low_sat':
            print(f"  {cls_name:13s}: low-sat s<={envelope['s_max']:.0f} v>={envelope['v_min']:.0f}  "
                  f"defect %: mean={mean:.2f} worst={worst:.2f}  "
                  f"-> auto-threshold={2*worst:.2f}")
        else:
            print(f"  {cls_name:13s}: hue[{envelope['h_low']:.0f},{envelope['h_high']:.0f}] "
                  f"s>={envelope['s_min']:.0f} v>={envelope['v_min']:.0f}  "
                  f"defect %: mean={mean:.2f} worst={worst:.2f}  "
                  f"-> auto-threshold={2*worst:.2f}")

    if not output:
        print("ERROR: no envelopes built.")
        sys.exit(1)

    with open(OUTPUT_PATH, 'w') as f:
        json.dump(output, f, indent=2)
    print(f"\nSaved -> {OUTPUT_PATH}")
    print("Restart smart-factory.service to pick up the new envelopes.")


if __name__ == '__main__':
    main()
