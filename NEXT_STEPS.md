# What To Do Next

Get the cube detector live on the Pi. Follow these steps in order.

---

## Step 1 — Push to GitHub and pull on the Pi

**On your Windows PC:**
```
cd C:\Users\Hamed\Documents\smart-factory-robot-arm
git push
```

**SSH into the Pi and pull:**
```
ssh pi@192.168.7.5
cd ~/sf2
git pull
sudo systemctl restart smart-factory
exit
```

This gets the new backend code (`poe_vision_service.py`, updated `app.py`) onto the Pi.

---

## Step 2 — Capture training images

Make sure the PoE CAM is powered and reachable at `192.168.7.6`.

On your Windows PC, open a terminal in the `cube-training/` folder:
```
cd C:\Users\Hamed\Documents\smart-factory-robot-arm\cube-training
pip install ultralytics opencv-python
python capture_cube_images.py
```

An OpenCV window opens showing the camera feed.

- Press `SPACE` to save a frame
- Press `R` to refresh the image
- Press `Q` to quit

**What to capture:**
- Place each cube type on the conveyor under normal lighting
- Save 50+ images per cube type (yellow, white, metal) — more is better
- Vary the angle, distance, and position
- Capture single cubes and multiple cubes together
- Include some frames with no cubes at all

Images save to `cube-training/cube_images/`.

---

## Step 3 — Annotate images with Roboflow

1. Go to [roboflow.com](https://roboflow.com) and sign in (free account)
2. Create a new project → choose **Object Detection**
3. Upload everything from `cube-training/cube_images/`
4. For each image, draw bounding boxes around every cube and label them:
   - `yellow_cube`
   - `white_cube`
   - `metal_cube`
5. When all images are annotated, click **Export Dataset**
6. Choose format: **YOLOv8**
7. Download the ZIP, open it, and copy all the `.txt` files into:
   ```
   cube-training/cube_labels/
   ```

> Each `.txt` file must have the same name as its image (e.g. `cube_0001.txt` goes with `cube_0001.jpg`).

> In Roboflow's class manager, make sure the order is exactly:
> `yellow_cube` = 0, `white_cube` = 1, `metal_cube` = 2

---

## Step 4 — Organise the dataset

Back in the `cube-training/` folder:
```
python organize_cube_dataset.py
```

This creates the train/val folders under `cube-training/dataset/`. You should see output like:
```
Train : 80 images (80%)
Val   : 20 images (20%)
Dataset ready.
```

---

## Step 5 — Train the model

```
python train_cube_detector.py
```

This will take a while (1–3 hours on CPU, 10–15 min with a GPU).

When it finishes you will see:
```
Best model : runs/detect/cube_train/weights/cube_detector.pt
Copy this file to the Pi:
  scp runs/detect/cube_train/weights/cube_detector.pt pi@192.168.7.5:/home/pi/cube_detector.pt
```

> **Optional — speed up training with GPU:**
> Edit `train_cube_detector.py` and change `device="cpu"` to `device="0"` if you have an NVIDIA GPU.

---

## Step 6 — Deploy the model to the Pi

Run the SCP command printed at the end of training:
```
scp cube-training\runs\detect\cube_train\weights\cube_detector.pt pi@192.168.7.5:/home/pi/cube_detector.pt
```

Then restart the service:
```
ssh pi@192.168.7.5 "sudo systemctl restart smart-factory"
```

---

## Step 7 — Test it in the browser

1. Open the vision page: `https://192.168.7.5:8080/vision-system-new.html`
2. Toggle the camera source to **PoE Cam**
3. The **PoE CAM — AI Cube Detection** panel appears
4. Press **Detect Cubes** — the annotated image should appear with bounding boxes
5. Press **Auto** to run detection continuously every 2 seconds

If you see a yellow **"Model not trained yet"** warning, the Pi can't find `cube_detector.pt` — check Step 6.

---

## Quick reference — SCP and restart

```
# Copy model to Pi
scp cube-training\runs\detect\cube_train\weights\cube_detector.pt pi@192.168.7.5:/home/pi/cube_detector.pt

# Copy updated backend files (if needed)
scp pwa-dobot-plc\backend\app.py pi@192.168.7.5:/home/pi/sf2/pwa-dobot-plc/backend/app.py
scp pwa-dobot-plc\backend\poe_vision_service.py pi@192.168.7.5:/home/pi/sf2/pwa-dobot-plc/backend/poe_vision_service.py

# Copy updated frontend (if needed)
scp pwa-dobot-plc\frontend\vision-system-new.html pi@192.168.7.5:/home/pi/sf2/pwa-dobot-plc/frontend/vision-system-new.html

# Restart service
ssh pi@192.168.7.5 "sudo systemctl restart smart-factory"

# Check logs
ssh pi@192.168.7.5 "sudo journalctl -u smart-factory -n 50"
```

---

## Summary checklist

- [ ] `git push` on Windows, `git pull` on Pi, restart service
- [ ] Capture 50+ images per cube type with `capture_cube_images.py`
- [ ] Annotate in Roboflow, export YOLOv8, copy `.txt` files to `cube_labels/`
- [ ] Run `organize_cube_dataset.py`
- [ ] Run `train_cube_detector.py` (wait for it to finish)
- [ ] SCP `cube_detector.pt` to Pi home directory
- [ ] Restart smart-factory service
- [ ] Test in browser — PoE Cam mode → Detect Cubes
