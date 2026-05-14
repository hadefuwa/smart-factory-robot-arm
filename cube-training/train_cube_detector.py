"""
YOLOv11n Training Script - Cube Detection
Trains a model to detect yellow, white, and metal cubes on the factory conveyor.
Run this on your Windows PC (or a machine with a decent GPU for speed).

Requirements:
    pip install ultralytics

Before running:
    1. Capture images:   python capture_cube_images.py
    2. Annotate images:  see CUBE_TRAINING_GUIDE.md
    3. Organise dataset: python organize_cube_dataset.py
    4. Run this script:  python train_cube_detector.py
"""

from ultralytics import YOLO
import os
import shutil

MODEL_BASE  = "yolo11n.pt"       # Pretrained base — auto-downloaded (~6MB)
DATA_YAML   = "cube-data.yaml"
PROJECT_DIR = "runs/detect"
RUN_NAME    = "cube_train"
OUTPUT_DIR  = os.path.join(PROJECT_DIR, RUN_NAME, "weights")

print("=" * 55)
print("  Smart Factory — Cube Detector Training")
print("=" * 55)
print(f"  Base model  : {MODEL_BASE}")
print(f"  Dataset     : {DATA_YAML}")
print(f"  Output      : {OUTPUT_DIR}/best.pt")
print()
print("  Classes: 0=yellow_cube  1=white_cube  2=metal_cube")
print()

# Load base model
model = YOLO(MODEL_BASE)

# Train
results = model.train(
    data=DATA_YAML,
    epochs=100,
    imgsz=640,
    batch=8,
    device="cpu",       # Change to "0" if you have an NVIDIA GPU
    project=PROJECT_DIR,
    name=RUN_NAME,
    patience=20,        # Stop early if no improvement for 20 epochs
    save=True,
    plots=True,
    # Augmentation — helps generalise with limited data
    hsv_h=0.015,        # Hue shift (helps with lighting variation)
    hsv_s=0.5,          # Saturation shift
    hsv_v=0.3,          # Brightness shift
    fliplr=0.5,         # Horizontal flip
    degrees=5.0,        # Slight rotation
    translate=0.1,      # Small crop offset
    scale=0.3,          # Scale jitter
    mosaic=0.5,         # Mosaic augmentation
)

# Copy best.pt to a clearly named file for easy deployment
best_src  = os.path.join(OUTPUT_DIR, "best.pt")
best_dest = os.path.join(OUTPUT_DIR, "cube_detector.pt")
if os.path.exists(best_src):
    shutil.copy2(best_src, best_dest)
    print(f"\n  Copied best.pt -> {best_dest}")

print()
print("=" * 55)
print("  Training complete!")
print("=" * 55)
print(f"\n  Best model : {best_dest}")
print(f"  Copy this file to the Pi:")
print(f"    scp {best_dest} pi@192.168.7.5:/home/pi/cube_detector.pt")
print()
print("  Then restart the smart-factory service on the Pi.")
