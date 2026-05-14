"""
Organize cube dataset into YOLO train/val split (80/20).

Run this AFTER annotating your images in Roboflow or LabelImg and
exporting labels in YOLO format (.txt files) into the cube_labels/ folder.

Expected input:
    cube_images/   - JPEG frames captured with capture_cube_images.py
    cube_labels/   - YOLO .txt annotation files (same basename as images)

Output:
    dataset/images/train/
    dataset/images/val/
    dataset/labels/train/
    dataset/labels/val/
"""

import os
import shutil
import random

IMAGES_SRC = "cube_images"
LABELS_SRC = "cube_labels"
TRAIN_IMG  = "dataset/images/train"
VAL_IMG    = "dataset/images/val"
TRAIN_LBL  = "dataset/labels/train"
VAL_LBL    = "dataset/labels/val"
SPLIT      = 0.8

print("=" * 50)
print("  Cube Dataset Organiser")
print("=" * 50)

for folder in [IMAGES_SRC, LABELS_SRC]:
    if not os.path.exists(folder):
        print(f"ERROR: '{folder}' not found. Check you have both cube_images/ and cube_labels/")
        raise SystemExit(1)

images = [f for f in os.listdir(IMAGES_SRC)
          if f.lower().endswith(('.jpg', '.jpeg', '.png'))]

pairs, missing = [], []
for img in images:
    lbl = os.path.splitext(img)[0] + '.txt'
    if os.path.exists(os.path.join(LABELS_SRC, lbl)):
        pairs.append((img, lbl))
    else:
        missing.append(img)

print(f"  Images found   : {len(images)}")
print(f"  Labelled pairs : {len(pairs)}")
if missing:
    print(f"  Missing labels : {len(missing)} (these will be skipped)")
    for m in missing[:5]:
        print(f"    - {m}")
    if len(missing) > 5:
        print(f"    ... and {len(missing)-5} more")

if not pairs:
    print("\nERROR: No labelled image-label pairs found.")
    print("Annotate your images first, then export YOLO .txt labels to cube_labels/")
    raise SystemExit(1)

random.seed(42)
random.shuffle(pairs)
split_at   = int(len(pairs) * SPLIT)
train_set  = pairs[:split_at]
val_set    = pairs[split_at:]

print(f"\n  Train : {len(train_set)} images ({SPLIT*100:.0f}%)")
print(f"  Val   : {len(val_set)} images ({(1-SPLIT)*100:.0f}%)")

for folder in [TRAIN_IMG, VAL_IMG, TRAIN_LBL, VAL_LBL]:
    os.makedirs(folder, exist_ok=True)
    for f in os.listdir(folder):
        fp = os.path.join(folder, f)
        if os.path.isfile(fp):
            os.remove(fp)

def copy_set(pairs, img_dst, lbl_dst):
    for img, lbl in pairs:
        shutil.copy2(os.path.join(IMAGES_SRC, img), os.path.join(img_dst, img))
        shutil.copy2(os.path.join(LABELS_SRC, lbl), os.path.join(lbl_dst, lbl))

copy_set(train_set, TRAIN_IMG, TRAIN_LBL)
copy_set(val_set,   VAL_IMG,   VAL_LBL)

print("\n  Dataset ready. Run: python train_cube_detector.py")
