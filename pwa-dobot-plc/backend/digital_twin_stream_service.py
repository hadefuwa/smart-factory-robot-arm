"""
Digital Twin Stream Service - Renders the 3D view on the Pi and streams as MJPEG.

The HMI (Basic Panel) cannot run WebGL/Three.js. This service:
1. Runs headless Chromium with the digital-twin-embed page
2. Captures screenshots of the rendered 3D view
3. Serves them as MJPEG - same format as the camera stream

The HMI displays the video feed (which it can do) instead of rendering 3D.
"""

import logging
import threading
import time
import io
import os
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)

# Try to import Playwright
PLAYWRIGHT_AVAILABLE = False
try:
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    logger.warning("Playwright not installed. Digital twin stream disabled. Run: pip install playwright && playwright install chromium")


class DigitalTwinStreamService:
    """Captures digital twin page in headless browser and provides JPEG frames for streaming."""

    def __init__(self, port: int = 8080, width: int = 320, height: int = 240, fps: int = 2, quality: int = 65):
        self.port = port
        self.width = width
        self.height = height
        self.fps = fps
        self.quality = quality
        self._lock = threading.Lock()
        self._latest_frame: Optional[bytes] = None
        self._frame_time = 0.0
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._playwright = None
        self._browser = None
        self._page = None
        self._error: Optional[str] = None

    def start(self) -> bool:
        """Start the capture thread."""
        if not PLAYWRIGHT_AVAILABLE:
            self._error = "Playwright not installed. Run: pip install playwright && playwright install chromium"
            return False

        with self._lock:
            if self._running:
                return True
            self._running = True

        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()
        logger.info("Digital twin stream service started (capture thread)")
        return True

    def stop(self):
        """Stop the capture thread."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None

    def get_frame_jpeg(self, quality: int = 70) -> Optional[bytes]:
        """Get the latest captured frame as JPEG bytes."""
        with self._lock:
            return self._latest_frame

    def _capture_loop(self):
        """Background loop: launch browser, load page, capture screenshots."""
        try:
            # Wait for Flask server to be ready
            logger.info(f"Digital twin capture loop: Waiting 10s for Flask server...")
            time.sleep(10)
            # Capture the embed page - cleaner view for HMI without UI controls
            url = f"https://127.0.0.1:{self.port}/digital-twin-embed.html"
            logger.info(f"Digital twin capture loop: Launching Playwright for {url}")

            with sync_playwright() as p:
                self._playwright = p
                logger.info("Digital twin: Playwright context created")

                self._browser = p.chromium.launch(
                    headless=True,
                    args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
                )
                logger.info("Digital twin: Chromium browser launched")

                # Lower priority of Chromium processes to prioritize vision system
                try:
                    result = subprocess.run(
                        ["pgrep", "-f", "headless_shell"],
                        capture_output=True,
                        text=True
                    )
                    pids = result.stdout.strip().split('\n')
                    for pid in pids:
                        if pid:
                            try:
                                subprocess.run(["renice", "-n", "10", "-p", pid], check=False)
                                logger.info(f"Digital twin: Reduced priority of Chromium process {pid} (nice +10)")
                            except Exception as e:
                                logger.debug(f"Could not renice PID {pid}: {e}")
                except Exception as e:
                    logger.debug(f"Could not adjust Chromium process priority: {e}")

                self._page = self._browser.new_page(
                    viewport={"width": self.width, "height": self.height},
                    ignore_https_errors=True
                )
                logger.info(f"Digital twin: Browser page created ({self.width}x{self.height})")

                self._page.goto(url, wait_until="networkidle", timeout=30000)
                logger.info(f"Digital twin: Page loaded successfully - {url}")

                # Wait for Three.js to render - give it a moment
                time.sleep(2)
                logger.info(f"Digital twin: Starting capture loop ({self.fps} FPS target, quality={self.quality})")

                capture_interval = 1.0 / self.fps  # Calculate interval from FPS
                last_capture = 0.0
                frame_count = 0

                while self._running:
                    now = time.time()
                    if now - last_capture >= capture_interval:
                        try:
                            screenshot_bytes = self._page.screenshot(type="jpeg", quality=self.quality)
                            if screenshot_bytes:
                                with self._lock:
                                    self._latest_frame = screenshot_bytes
                                    self._frame_time = now
                                frame_count += 1
                                if frame_count == 1:
                                    logger.info(f"Digital twin: First frame captured ({len(screenshot_bytes)} bytes)")
                                elif frame_count % 100 == 0:
                                    logger.debug(f"Digital twin: Frame {frame_count} captured")
                            last_capture = now
                        except Exception as e:
                            logger.warning(f"Digital twin screenshot error: {e}")
                            time.sleep(0.5)

                    time.sleep(0.05)

        except Exception as e:
            self._error = str(e)
            logger.error(f"Digital twin stream FATAL error: {e}", exc_info=True)
        finally:
            logger.info("Digital twin capture loop exiting - cleaning up browser")
            try:
                if self._browser:
                    self._browser.close()
                    logger.info("Digital twin: Browser closed")
            except Exception as cleanup_error:
                logger.warning(f"Digital twin cleanup error: {cleanup_error}")

    @property
    def is_available(self) -> bool:
        return PLAYWRIGHT_AVAILABLE
