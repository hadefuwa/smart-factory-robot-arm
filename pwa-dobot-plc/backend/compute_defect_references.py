"""
Build per-class purity envelopes for the defect detector.

Walks the YOLO training labels in cube-training/, crops each positive
bbox from its source image, learns the expected HSV envelope per class,
and records the worst clean-training purity seen so the inference path
has a sensible auto-threshold floor.

Run after every retrain (envelopes change with the dataset):
    python compute_defect_references.py

Output: defect_references.json next to this script. Plain JSON so you
can eyeball envelopes and tune by hand if needed.
"""

import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from defect_detector import collect_cube_pixels, build_envelope, purity_index  # noqa: E402

# Project class order: 0=yellow_cube, 1=purple_cube, 2=metal_cube.
CLASS_NAMES = {0: 'yellow_cube', 1: 'purple_cube', 2: 'metal_cube'}

CANDIDATE_ROOTS = [
    os.path.normpath(os.path.join(HERE, '..', '..', 'cube-training')),
    os.path.normpath(os.path.join(HERE, '..', 'cube-training')),
]

OUTPUT_PATH = os.path.join(HERE, 'defect_references.json')


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


def main():
    root = find_training_root()
    if root is None:
        print("ERROR: couldn't find cube-training/{cube_images,cube_labels}")
        sys.exit(1)

    images_dir = os.path.join(root, 'cube_images')
    labels_dir = os.path.join(root, 'cube_labels')
    print(f"Using training root: {root}")

    per_class_pixels = {name: [] for name in CLASS_NAMES.values()}
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
            pixels = collect_cube_pixels(crop)
            if pixels is None or len(pixels) == 0:
                skipped += 1
                continue
            per_class_pixels[cls_name].append(pixels)
            per_class_crops[cls_name].append(crop)
            processed += 1

    print(f"\nProcessed {processed} crops; skipped {skipped}.")
    for name, pix_list in per_class_pixels.items():
        print(f"  {name:13s}: {len(pix_list)} crops")

    output = {}
    print("\nClass envelopes + training-data purity:")
    for cls_name, pix_list in per_class_pixels.items():
        if len(pix_list) < 2:
            print(f"  {cls_name:13s}: skipped (only {len(pix_list)} crops)")
            continue

        envelope = build_envelope(pix_list)
        purities = [purity_index(c, envelope) for c in per_class_crops[cls_name]]
        worst = float(min(purities))
        mean = float(np.mean(purities))

        output[cls_name] = {
            'envelope': envelope,
            'train_min_purity': worst,
            'train_mean_purity': mean,
            'crop_count': len(pix_list),
        }

        if envelope['kind'] == 'low_sat':
            print(f"  {cls_name:13s}: low-sat envelope s<={envelope['s_max']:.0f}  "
                  f"train mean purity={mean:.3f}  worst={worst:.3f}  "
                  f"-> suggested threshold={0.5*worst:.3f}")
        else:
            print(f"  {cls_name:13s}: hue [{envelope['h_low']:.0f},{envelope['h_high']:.0f}] "
                  f"sat>={envelope['s_min']:.0f}  "
                  f"train mean purity={mean:.3f}  worst={worst:.3f}  "
                  f"-> suggested threshold={0.5*worst:.3f}")

    if not output:
        print("ERROR: no envelopes built.")
        sys.exit(1)

    with open(OUTPUT_PATH, 'w') as f:
        json.dump(output, f, indent=2)
    print(f"\nSaved -> {OUTPUT_PATH}")
    print("Restart smart-factory.service to pick up the new envelopes.")


if __name__ == '__main__':
    main()
