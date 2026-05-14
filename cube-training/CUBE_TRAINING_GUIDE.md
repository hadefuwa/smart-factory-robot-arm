# Cube Detector Training Guide

Train a YOLOv11n model to detect **yellow_cube**, **white_cube**, and **metal_cube** on the factory conveyor using the M5Stack PoE CAM-W.

---

## Overview of steps

1. Install requirements (Windows PC)
2. Capture training images
3. Annotate images (Roboflow)
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

Make sure the PoE CAM is live at `192.168.7.6` (or your configured IP), then:

```
python capture_cube_images.py
```

Optional flags:
```
python capture_cube_images.py --ip 192.168.7.6   # default
python capture_cube_images.py --usb               # use USB camera instead
```

Controls in the OpenCV window:
| Key | Action |
|-----|--------|
| `SPACE` | Save current frame |
| `R` | Refresh (re-fetch from PoE CAM) |
| `Q` | Quit |

Images are saved to `cube-training/cube_images/` as `cube_0001.jpg`, `cube_0002.jpg`, etc.

**Tips for good data:**
- Aim for **50+ images per cube class** (more = better accuracy)
- Capture from multiple angles and distances
- Include different lighting conditions (bright, dim, shadows)
- Mix single cubes and multiple cubes in the same frame
- Put the conveyor background in most shots — that is what the model will see in production

---

## 3 — Annotate images (Roboflow)

This is the most important step. Each image needs bounding boxes drawn around every cube.

1. Go to [roboflow.com](https://roboflow.com) and create a free account
2. Create a new project: **Object Detection**
3. Upload all images from `cube-training/cube_images/`
4. For each image, draw bounding boxes and assign these class names **exactly**:
   - `yellow_cube` → class ID **0**
   - `white_cube`  → class ID **1**
   - `metal_cube`  → class ID **2**
5. When done, click **Export Dataset**
6. Choose format: **YOLOv8** (compatible with YOLOv11)
7. Download the ZIP, extract it, and copy the `.txt` label files into:
   ```
   cube-training/cube_labels/
   ```
   Each `.txt` file must have the same base name as its image (e.g. `cube_0001.txt` for `cube_0001.jpg`).

> **Important:** The class IDs in `cube-data.yaml` are fixed at 0/1/2. Make sure Roboflow's class order matches (yellow=0, white=1, metal=2). If it doesn't, rename them in Roboflow's class manager.

**Alternative: LabelImg (offline)**

```
pip install labelImg
labelImg cube_images/ cube_labels/
```

Select YOLO format in the tool and save labels to `cube_labels/`.

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
ssh pi@192.168.7.5
sudo systemctl restart smart-factory
```

The backend (`poe_vision_service.py`) searches for the model in this order:
1. `~/cube_detector.pt` ← **this is where you just copied it**
2. `./cube_detector.pt` (backend dir)
3. `../../cube-training/runs/detect/cube_train/weights/best.pt`
4. `../../cube-training/runs/detect/cube_train/weights/cube_detector.pt`

---

## 7 — Test in the browser

1. Open `vision-system-new.html`
2. Switch source to **PoE Cam** (toggle top-right of Camera Feed panel)
3. In the **PoE CAM — AI Cube Detection** panel, press **Detect Cubes**
4. The annotated image appears on the left, detected cubes listed on the right
5. Use the **Auto** button to run detection every 2 seconds continuously

The **confidence slider** (10–90%) controls the detection threshold — lower = more detections but more false positives; higher = fewer but more confident.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Model not trained yet" warning | Complete steps 3–6 above |
| Low accuracy on cubes | Add more varied training images; re-annotate carefully |
| Wrong class predicted | Check class order in Roboflow matches 0=yellow, 1=white, 2=metal |
| `ultralytics` not found | `pip install ultralytics` in the backend Python environment |
| Camera unreachable | Check PoE CAM is at `192.168.7.6`, power is on, Ethernet connected |

---

## File layout

```
cube-training/
├── cube_images/               ← captured training images (you fill this)
├── cube_labels/               ← YOLO .txt annotations from Roboflow (you fill this)
├── dataset/                   ← auto-generated by organize_cube_dataset.py
│   ├── images/train|val/
│   └── labels/train|val/
├── runs/detect/cube_train/    ← auto-generated by train_cube_detector.py
│   └── weights/
│       ├── best.pt
│       └── cube_detector.pt   ← deploy this to the Pi
├── cube-data.yaml             ← dataset config (do not edit class IDs)
├── capture_cube_images.py     ← step 2
├── organize_cube_dataset.py   ← step 4
├── train_cube_detector.py     ← step 5
└── CUBE_TRAINING_GUIDE.md     ← this file
```
