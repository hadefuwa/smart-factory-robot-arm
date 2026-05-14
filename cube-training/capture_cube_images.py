"""
Cube Image Capture Tool
Grabs frames from the M5Stack PoE CAM-W (or USB camera) for training data collection.

Usage:
    python capture_cube_images.py                    # PoE CAM at default 192.168.7.6
    python capture_cube_images.py --ip 192.168.7.6   # specify IP
    python capture_cube_images.py --usb              # use USB camera instead

Controls (OpenCV window):
    SPACE  - save current frame
    Q      - quit
    R      - refresh / re-fetch frame (PoE CAM mode)
"""

import argparse
import os
import time
import sys
import urllib.request

try:
    import cv2
except ImportError:
    print("ERROR: OpenCV not installed. Run: pip install opencv-python")
    sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────
OUTPUT_DIR = "cube_images"
DEFAULT_POE_IP = "192.168.7.6"
CAPTURE_URL_TEMPLATE = "http://{ip}/capture"

# ─────────────────────────────────────────────────────────────────────────────
def fetch_poe_frame(ip):
    """Fetch a single JPEG frame from the PoE CAM /capture endpoint."""
    url = CAPTURE_URL_TEMPLATE.format(ip=ip)
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            data = r.read()
        import numpy as np
        arr = np.frombuffer(data, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        return frame
    except Exception as e:
        print(f"  [WARN] Could not fetch frame from {url}: {e}")
        return None


def next_filename(output_dir):
    existing = [f for f in os.listdir(output_dir) if f.startswith("cube_") and f.endswith(".jpg")]
    nums = []
    for f in existing:
        try:
            nums.append(int(f.replace("cube_", "").replace(".jpg", "")))
        except ValueError:
            pass
    return os.path.join(output_dir, f"cube_{(max(nums) + 1) if nums else 1:04d}.jpg")


def run_poe_cam(ip):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    saved = 0
    print(f"\n  PoE CAM mode — fetching from http://{ip}/capture")
    print("  SPACE = save frame | R = refresh | Q = quit\n")

    frame = fetch_poe_frame(ip)
    if frame is None:
        print("  ERROR: Cannot reach camera. Check IP and power.")
        return

    while True:
        if frame is not None:
            display = frame.copy()
            count_label = f"Saved: {saved}  |  SPACE=save  R=refresh  Q=quit"
            cv2.putText(display, count_label, (10, 28),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            cv2.imshow("Cube Capture — PoE CAM", display)

        key = cv2.waitKey(100) & 0xFF
        if key == ord('q'):
            break
        elif key == ord(' ') and frame is not None:
            path = next_filename(OUTPUT_DIR)
            cv2.imwrite(path, frame)
            saved += 1
            print(f"  Saved: {os.path.basename(path)}  (total: {saved})")
        elif key == ord('r'):
            print("  Refreshing...")
            frame = fetch_poe_frame(ip)

    cv2.destroyAllWindows()
    print(f"\n  Done. {saved} images saved to '{OUTPUT_DIR}/'")


def run_usb_cam():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    saved = 0
    print("\n  USB camera mode")
    print("  SPACE = save frame | Q = quit\n")

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("  ERROR: Cannot open USB camera (index 0).")
        return

    while True:
        ret, frame = cap.read()
        if not ret:
            print("  ERROR: Lost camera feed.")
            break

        display = frame.copy()
        count_label = f"Saved: {saved}  |  SPACE=save  Q=quit"
        cv2.putText(display, count_label, (10, 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        cv2.imshow("Cube Capture — USB Camera", display)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
        elif key == ord(' '):
            path = next_filename(OUTPUT_DIR)
            cv2.imwrite(path, frame)
            saved += 1
            print(f"  Saved: {os.path.basename(path)}  (total: {saved})")

    cap.release()
    cv2.destroyAllWindows()
    print(f"\n  Done. {saved} images saved to '{OUTPUT_DIR}/'")


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Capture cube training images")
    parser.add_argument("--ip",  default=DEFAULT_POE_IP, help="PoE CAM IP address")
    parser.add_argument("--usb", action="store_true",    help="Use USB camera instead")
    args = parser.parse_args()

    print("=" * 55)
    print("  Smart Factory — Cube Training Image Capture")
    print("=" * 55)
    print(f"  Output folder : {os.path.abspath(OUTPUT_DIR)}")
    print(f"  Source        : {'USB camera' if args.usb else f'PoE CAM ({args.ip})'}")
    print()
    print("  Tips for good training data:")
    print("    - Capture each cube type from multiple angles")
    print("    - Include different lighting conditions")
    print("    - Capture with and without other cubes in frame")
    print("    - Aim for 50+ images per class (more = better)")
    print()

    if args.usb:
        run_usb_cam()
    else:
        run_poe_cam(args.ip)
