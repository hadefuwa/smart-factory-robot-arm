"""
YOLOv11n Training Script - Cube Detection
Trains a model to detect yellow, purple, and metal cubes on the factory conveyor.
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
print("  Classes: 0=yellow_cube  1=purple_cube  2=metal_cube")
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
    # Augmentation — cranked up because 33 images per train run is way
    # too few. Without this the model memorises a handful of features
    # from training frames and produces garbage at inference time.
    hsv_h=0.05,         # More hue jitter
    hsv_s=0.7,          # Stronger saturation jitter
    hsv_v=0.5,          # Stronger brightness jitter (handles lighting drift)
    fliplr=0.5,         # Horizontal flip
    flipud=0.2,         # Vertical flip — cubes have no canonical "up"
    degrees=20.0,       # Wider rotation range
    translate=0.2,      # More position variation
    scale=0.5,          # More scale jitter
    shear=5.0,          # Shear distortion
    perspective=0.001,  # Mild perspective warp
    mosaic=1.0,         # Always mosaic — synthesises new layouts from the 33 images
    mixup=0.2,          # Blend pairs of images
    copy_paste=0.3,     # Paste annotated objects between images
    erasing=0.4,        # Random erasing
)

# Copy best.pt to a clearly named file for easy deployment.
# Ultralytics auto-versions the run dir when RUN_NAME already exists
# (cube_train -> cube_train2 -> ...), so the hard-coded OUTPUT_DIR
# above can point at the wrong run. Use results.save_dir, which is
# always the actual directory this training wrote to.
actual_dir = os.path.join(str(results.save_dir), "weights") if results and getattr(results, "save_dir", None) else OUTPUT_DIR
best_src  = os.path.join(actual_dir, "best.pt")
best_dest = os.path.join(actual_dir, "cube_detector.pt")
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
