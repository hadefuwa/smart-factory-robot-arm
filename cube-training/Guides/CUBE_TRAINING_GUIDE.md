# Cube Detector Training Guide

Train a YOLO11n model to detect **yellow_cube**, **purple_cube**, and **metal_cube** on the factory conveyor using the M5Stack PoE CAM-W.

---

## Overview of steps

1. Install requirements (Windows PC)
2. Capture training images (vision.html Capture button)
3. Annotate images (CVAT)
4. Organise dataset
5. Train the model
6. Deploy to the Pi

Everything runs on your Windows PC. The trained `.pt` file is then SCP'd to the Pi.

---

## 1 — Install requirements

Open a terminal in the `cube-training/` folder:

```
pip install ultralytics opencv-python
```

`ultralytics` includes YOLO and will auto-download the `yolo11n.pt` base model on first run (~6 MB).

---

## 2 — Capture training images

Open the production vision page on the Pi:

```
https://192.168.7.5:8080/vision.html
```

Click the **Capture Training Image** button on the AI Cube Detection panel. The browser downloads the loop's most recent cached raw JPEG — already cropped and masked exactly the same way YOLO sees it in production.

Save the file into `cube-training/cube_images/` and rename it to describe what's in it. Suggested naming so they group cleanly when you scroll:
```
yellow_cube_01.jpg, yellow_cube_02.jpg, ...
purple_cube_01.jpg, purple_cube_02.jpg, ...
metal_cube_01.jpg, metal_cube_02.jpg, ...
no_cube_01.jpg, no_cube_02.jpg, ...
```

**Tips for good data:**
- Aim for **50+ images per cube class** (more = better accuracy)
- Capture from multiple angles and positions on the conveyor
- Include different lighting conditions (bright, dim, shadows)
- Mix single cubes and multiple cubes in the same frame
- **Capture plenty of empty-conveyor `no_cube` shots** — these become negative examples and are the single biggest lever for cutting false positives
- If you have an off-spec colour (e.g. green) the model should never classify, capture it as `no_cube_*` so the model learns to reject it

**Why the captured image has a black bar on the right:** the mask blanks out the sorted-cube row before YOLO inference so background cubes don't trigger detections. Training on masked images keeps your dataset consistent with production inference — keep the mask in the saved file.

---

## 3 — Annotate images (CVAT)

Each image needs bounding boxes drawn around every cube. We use [CVAT](https://www.cvat.ai/) (free, self-hosted Docker or `app.cvat.ai`).

1. Create a new project. Add three labels **in this exact order** (the order sets the class IDs):
   - `yellow_cube` (id 0)
   - `purple_cube` (id 1)
   - `metal_cube` (id 2)
2. Upload everything from `cube-training/cube_images/`.
3. Draw tight bounding boxes around every cube.
4. **Skip cubes inside the black masked region.** Those pixels are zero by the time YOLO sees them, so teaching the model to detect "cubes" there only causes hallucinations at the mask edge. If a cube straddles the mask line, clip the box to the visible side.
5. For `no_cube_*` images, leave them with zero boxes — CVAT will export an empty `.txt` for each, which is the correct way to feed negative examples to YOLO.
6. Once everything is annotated, **Export Dataset** → format **`Ultralytics YOLO Detection 1.0`** → download the ZIP.
7. Extract the ZIP and copy every `.txt` label file into:
   ```
   cube-training/cube_labels/
   ```
   Each `.txt` must have the same base name as its image (e.g. `purple_cube_01.txt` for `purple_cube_01.jpg`).

> **Class-ID check:** open one `.txt` and confirm the first number on each line matches the class you'd expect (0 yellow, 1 purple, 2 metal). If CVAT exported the IDs in a different order, fix the order in CVAT's label manager and re-export rather than rewriting files by hand.

---

## 4 — Organise the dataset

Once you have images in `cube_images/` and labels in `cube_labels/`, run:

```
python organize_cube_dataset.py
```

This splits the data 80/20 into:
```
dataset/images/train/     dataset/labels/train/
dataset/images/val/       dataset/labels/val/
```

You can re-run this any time after adding more images — it clears and rebuilds the folders.

---

## 5 — Train the model

```
python train_cube_detector.py
```

**What it does:**
- Downloads `yolo11n.pt` base weights (first run only)
- Trains for up to 100 epochs with early stopping at 20 epochs of no improvement
- Applies data augmentation (hue, saturation, brightness, flips, rotation, scale, mosaic)
- Saves the best checkpoint to `runs/detect/cube_train/weights/best.pt`
- Copies it as `cube_detector.pt` in the same folder

**GPU acceleration (optional):**
If your PC has an NVIDIA GPU, edit `train_cube_detector.py` and change:
```python
device="cpu"   →   device="0"
```
Training on GPU is ~10× faster.

**Typical training time:**
- CPU (no GPU): ~1–3 hours for 100 epochs at 100 images
- GPU (GTX/RTX): ~5–15 minutes

Training logs and plots are saved in `runs/detect/cube_train/`.

---

## 6 — Deploy to the Pi

After training, the model is at:
```
cube-training/runs/detect/cube_train/weights/cube_detector.pt
```

SCP it to the Pi's home directory:

```
scp runs/detect/cube_train/weights/cube_detector.pt pi@192.168.7.5:/home/pi/cube_detector.pt
```

Then restart the smart-factory backend service on the Pi:

```
ssh pi@192.168.7.5 'sudo systemctl restart smart-factory'
```

The backend (`poe_vision_service.py`) searches for the model in this order:
1. `~/cube_detector.pt` ← **this is where you just copied it**
2. `./cube_detector.pt` (backend dir)
3. `../../cube-training/runs/detect/cube_train/weights/best.pt`
4. `../../cube-training/runs/detect/cube_train/weights/cube_detector.pt`

---

## 7 — Test in the browser

1. Open `https://192.168.7.5:8080/vision.html`
2. The AI Cube Detection panel runs the always-on backend loop — annotated frames refresh automatically once a cube enters the conveyor.
3. The three confidence sliders (yellow / purple / metal) on the page POST back to `config.poe_camera.class_conf`. Per-class thresholds let you be permissive on a class the model under-detects and strict on a class that produces false positives — start at the current defaults (yellow 0.35, purple 0.50, metal 0.60) and tune from there.
4. The vision page shows the photoelectric sensor (%I0.5) state alongside the AI. If the sensor sees an object but the AI doesn't, an "AI missed the object" warning lights up — that's a sign you need more training data of whatever class was on the belt at that moment.

PLC bits are only asserted while %I0.5 is high — the AI's confirmed colour is the value, the sensor is the gate. Detection accuracy still shows in the JSON regardless.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Model not trained yet" warning | Complete steps 3–6 above |
| Low accuracy on a class | Capture 20–30 more images of that class in varied positions; re-annotate; retrain |
| Wrong class predicted | Open a `.txt` label file and confirm class IDs (0 yellow, 1 purple, 2 metal). If wrong, fix CVAT's label order and re-export |
| Lots of false positives on empty conveyor | Add more `no_cube_*` images and retrain |
| Phantom detection at the mask edge | The keep-box filter already drops these post-NMS, but if it persists, make sure you didn't annotate any cubes inside the masked region |
| `ultralytics` not found | `pip install ultralytics` in the training Python environment |
| Capture button downloads a stale image | The loop refreshes its cache every ~1 s. Wait a moment between captures, or check that the M5Stack camera is reachable |

---

## File layout

```
cube-training/
├── cube_images/               ← captured training images (you fill this)
├── cube_labels/               ← YOLO .txt annotations from CVAT (you fill this)
├── dataset/                   ← auto-generated by organize_cube_dataset.py
│   ├── images/train|val/
│   └── labels/train|val/
├── runs/detect/cube_train/    ← auto-generated by train_cube_detector.py
│   └── weights/
│       ├── best.pt
│       └── cube_detector.pt   ← deploy this to the Pi
├── cube-data.yaml             ← dataset config (do not edit class IDs)
├── organize_cube_dataset.py   ← step 4
├── train_cube_detector.py     ← step 5
└── CUBE_TRAINING_GUIDE.md     ← this file
```
