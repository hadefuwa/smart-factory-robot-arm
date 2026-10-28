(function () {
  window.__robotArmPageInitialized = true;
  const themeCache = {};
  let pollInterval = null;
  let isPolling = false;

  function theme(name) {
    if (!themeCache[name]) {
      themeCache[name] = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
    }
    return themeCache[name];
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("Service Worker registered:", registration);
      })
      .catch((error) => {
        console.error("Service Worker registration failed:", error);
      });
  }

  function updateConnectionStatus(dotId, textId, connected) {
    const dot = document.getElementById(dotId);
    const text = document.getElementById(textId);
    if (!dot || !text) {
      return;
    }

    dot.classList.toggle("connected", connected);
    text.textContent = connected ? "Connected" : "Disconnected";
    text.style.color = theme(connected ? "--status-success" : "--status-danger");
  }

  function updatePLCStatus(connected) {
    updateConnectionStatus("plcDot", "plcStatus", connected);
  }

  function updateDobotStatus(connected) {
    updateConnectionStatus("dobotDot", "dobotStatus", connected);
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  function setBit(id, value, onColor, offColor) {
    const element = document.getElementById(id);
    if (!element) {
      return;
    }

    element.textContent = value ? "ON" : "OFF";
    element.style.color = theme(value ? onColor : offColor);
  }

  function formatPoseValue(value) {
    return typeof value === "number" ? value.toFixed(2) : "--";
  }

  async function fetchAllData() {
    try {
      const response = await fetch("/api/data");
      const data = await response.json();

      updatePLCStatus(Boolean(data.plc?.status?.connected));
      setText("targetX", formatPoseValue(data.plc?.pose?.x));
      setText("targetY", formatPoseValue(data.plc?.pose?.y));
      setText("targetZ", formatPoseValue(data.plc?.pose?.z));

      const bits = data.plc?.control || {};
      setBit("bitStart", bits.start, "--status-success", "--status-danger");
      setBit("bitStop", bits.stop, "--status-success", "--status-danger");
      setBit("bitHome", bits.home, "--status-success", "--status-danger");
      setBit("bitEstop", bits.estop, "--status-danger", "--status-success");
      setBit("bitSuction", bits.suction, "--status-success", "--status-danger");
      setBit("bitReady", bits.ready, "--status-success", "--status-danger");
      setBit("bitBusy", bits.busy, "--status-warning", "--status-success");
      setBit("bitError", bits.error, "--status-danger", "--status-success");

      const dobotConnected = Boolean(data.dobot?.status?.connected);
      updateDobotStatus(dobotConnected);
      setText("currentX", dobotConnected ? formatPoseValue(data.dobot?.pose?.x) : "--");
      setText("currentY", dobotConnected ? formatPoseValue(data.dobot?.pose?.y) : "--");
      setText("currentZ", dobotConnected ? formatPoseValue(data.dobot?.pose?.z) : "--");
      setText("currentR", dobotConnected ? formatPoseValue(data.dobot?.pose?.r) : "--");
      setText("lastUpdate", new Date().toLocaleTimeString());
    } catch (error) {
      console.error("Error fetching data:", error);
      updatePLCStatus(false);
      updateDobotStatus(false);
    }
  }

  async function pollData() {
    if (isPolling) {
      return;
    }

    isPolling = true;
    try {
      await fetchAllData();
    } finally {
      isPolling = false;
    }
  }

  function startPolling() {
    if (pollInterval) {
      return;
    }

    pollData();
    pollInterval = window.setInterval(pollData, 2000);
  }

  function stopPolling() {
    if (!pollInterval) {
      return;
    }

    window.clearInterval(pollInterval);
    pollInterval = null;
  }

  function addLog(message, type) {
    const logDiv = document.getElementById("debugLog");
    if (!logDiv) {
      return;
    }

    const timestamp = new Date().toLocaleTimeString();
    const varMap = {
      info: "--status-info",
      success: "--status-success",
      error: "--status-danger",
      warning: "--status-warning",
    };

    const entry = document.createElement("div");
    entry.style.color = theme(varMap[type] || varMap.info);
    entry.style.marginBottom = "6px";
    entry.textContent = `[${timestamp}] ${message}`;

    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;

    while (logDiv.children.length > 50) {
      logDiv.removeChild(logDiv.firstChild);
    }
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.json();
  }

  async function homeRobot() {
    try {
      addLog("Sending home command...", "info");
      const data = await postJson("/api/dobot/home");
      addLog(data.success ? "Home command sent." : `Home failed: ${data.error || "Unknown error"}`, data.success ? "success" : "error");
    } catch (error) {
      addLog(`Error: ${error.message}`, "error");
    }
  }

  async function moveToTarget() {
    const x = parseFloat(document.getElementById("targetX")?.textContent);
    const y = parseFloat(document.getElementById("targetY")?.textContent);
    const z = parseFloat(document.getElementById("targetZ")?.textContent);

    if ([x, y, z].some(Number.isNaN)) {
      addLog("Invalid target position values.", "error");
      return;
    }

    try {
      addLog(`Moving to (${x}, ${y}, ${z})...`, "info");
      const data = await postJson("/api/dobot/move", { x, y, z, r: 0 });
      addLog(data.success ? "Move command executed successfully." : `Move failed: ${data.error || "Unknown error"}`, data.success ? "success" : "error");
    } catch (error) {
      addLog(`Error: ${error.message}`, "error");
    }
  }

  async function moveToManual() {
    const x = parseFloat(document.getElementById("manualX")?.value);
    const y = parseFloat(document.getElementById("manualY")?.value);
    const z = parseFloat(document.getElementById("manualZ")?.value);
    const r = parseFloat(document.getElementById("manualR")?.value) || 0;

    if ([x, y, z].some(Number.isNaN)) {
      addLog("Please enter valid X, Y, Z coordinates.", "error");
      return;
    }

    if (Math.abs(x) > 500 || Math.abs(y) > 500 || z < 0 || z > 500) {
      addLog(`Warning: Position (${x}, ${y}, ${z}) may be outside safe range.`, "warning");
    }

    try {
      addLog(`Moving to manual position (${x}, ${y}, ${z}, ${r})...`, "info");
      const data = await postJson("/api/dobot/move", { x, y, z, r });
      addLog(data.success ? "Robot moved successfully." : `Move failed: ${data.error || "Unknown error"}`, data.success ? "success" : "error");
    } catch (error) {
      addLog(`Error: ${error.message}`, "error");
    }
  }

  function useCurrentPosition() {
    const x = document.getElementById("currentX")?.textContent;
    const y = document.getElementById("currentY")?.textContent;
    const z = document.getElementById("currentZ")?.textContent;
    const r = document.getElementById("currentR")?.textContent;

    if (x === "--" || y === "--" || z === "--") {
      addLog("No current position available. Connect to Dobot first.", "error");
      return;
    }

    document.getElementById("manualX").value = parseFloat(x);
    document.getElementById("manualY").value = parseFloat(y);
    document.getElementById("manualZ").value = parseFloat(z);
    document.getElementById("manualR").value = parseFloat(r);
    addLog("Current position loaded into manual controls.", "success");
  }

  async function suctionOn() {
    try {
      addLog("Turning pump ON...", "info");
      const data = await postJson("/api/dobot/suction", { enable: true });
      addLog(data.success ? "Pump activated." : "Failed to activate pump.", data.success ? "success" : "error");
    } catch (error) {
      addLog(`Error: ${error.message}`, "error");
    }
  }

  async function suctionOff() {
    try {
      addLog("Turning pump OFF...", "info");
      const data = await postJson("/api/dobot/suction", { enable: false });
      addLog(data.success ? "Pump deactivated." : "Failed to deactivate pump.", data.success ? "success" : "error");
    } catch (error) {
      addLog(`Error: ${error.message}`, "error");
    }
  }

  async function gripperOpen() {
    try {
      addLog("Opening gripper...", "info");
      const data = await postJson("/api/dobot/gripper", { open: true });
      addLog(data.success ? "Gripper opened." : data.message || "Gripper not available.", data.success ? "success" : "warning");
    } catch (error) {
      addLog(`Error: ${error.message}`, "error");
    }
  }

  async function gripperClose() {
    try {
      addLog("Closing gripper...", "info");
      const data = await postJson("/api/dobot/gripper", { open: false });
      addLog(data.success ? "Gripper closed." : data.message || "Gripper not available.", data.success ? "success" : "warning");
    } catch (error) {
      addLog(`Error: ${error.message}`, "error");
    }
  }

  async function moveToPreset(preset) {
    const presets = {
      safe: { x: 200, y: 0, z: 200, r: 0, name: "Safe Position" },
      pickup: { x: 250, y: 50, z: 50, r: 0, name: "Pickup Position" },
      dropoff: { x: 250, y: -50, z: 50, r: 0, name: "Dropoff Position" },
      inspect: { x: 200, y: 0, z: 100, r: 0, name: "Inspect Position" },
    };

    const position = presets[preset];
    if (!position) {
      return;
    }

    try {
      addLog(`Moving to ${position.name}...`, "info");
      const data = await postJson("/api/dobot/move", position);
      addLog(data.success ? `Moved to ${position.name}.` : "Move failed.", data.success ? "success" : "error");
    } catch (error) {
      addLog(`Error: ${error.message}`, "error");
    }
  }

  async function testRobot() {
    addLog("Starting robot test sequence...", "info");

    try {
      const response = await fetch("/api/dobot/test", { method: "POST" });
      const data = await response.json();

      if (Array.isArray(data.steps)) {
        data.steps.forEach((step) => {
          addLog(`Step ${step.step}: ${step.name} - ${step.message}`, step.success ? "success" : "error");
        });
      }

      addLog(
        data.success
          ? "All tests passed. Robot is responding."
          : "Some tests failed. Check the details above.",
        data.success ? "success" : "warning"
      );
    } catch (error) {
      addLog(`Test error: ${error.message}`, "error");
    }
  }

  async function emergencyStop() {
    try {
      addLog("Emergency stop triggered.", "error");
      const response = await fetch("/api/emergency-stop", { method: "POST" });
      const data = await response.json();
      if (data.success) {
        addLog("Emergency stop activated. All movement stopped.", "warning");
      }
    } catch (error) {
      addLog(`Error: ${error.message}`, "error");
    }
  }

  async function openSettings() {
    try {
      addLog("Loading settings...", "info");
      const response = await fetch("/api/settings");
      const settings = await response.json();

      const usbSelect = document.getElementById("settingDobotUSB");
      usbSelect.innerHTML = '<option value="">Auto-detect (recommended)</option>';

      if (Array.isArray(settings.available_usb_ports) && settings.available_usb_ports.length > 0) {
        addLog(`Found ${settings.available_usb_ports.length} USB devices.`, "success");
        settings.available_usb_ports.forEach((port) => {
          const option = document.createElement("option");
          option.value = port;
          option.textContent = port;
          usbSelect.appendChild(option);
        });
      } else {
        addLog("No USB devices detected.", "warning");
        const option = document.createElement("option");
        option.value = "/dev/ttyACM0";
        option.textContent = "/dev/ttyACM0 (fallback)";
        usbSelect.appendChild(option);
      }

      usbSelect.value = settings.dobot?.usb_path || "";
      document.getElementById("settingHomeX").value = settings.dobot?.home_position?.x;
      document.getElementById("settingHomeY").value = settings.dobot?.home_position?.y;
      document.getElementById("settingHomeZ").value = settings.dobot?.home_position?.z;
      document.getElementById("settingHomeR").value = settings.dobot?.home_position?.r;
      document.getElementById("settingPLCIP").value = settings.plc?.ip;
      document.getElementById("settingPLCRack").value = settings.plc?.rack;
      document.getElementById("settingPLCSlot").value = settings.plc?.slot;
      document.getElementById("settingPollInterval").value = settings.plc?.poll_interval;
      document.getElementById("settingsModal").style.display = "block";
    } catch (error) {
      addLog(`Error loading settings: ${error.message}`, "error");
      alert(`Error loading settings: ${error.message}`);
    }
  }

  function closeSettings() {
    const modal = document.getElementById("settingsModal");
    if (modal) {
      modal.style.display = "none";
    }
  }

  async function saveSettings() {
    try {
      const settings = {
        dobot: {
          usb_path: document.getElementById("settingDobotUSB").value || "/dev/ttyACM0",
          home_position: {
            x: parseFloat(document.getElementById("settingHomeX").value),
            y: parseFloat(document.getElementById("settingHomeY").value),
            z: parseFloat(document.getElementById("settingHomeZ").value),
            r: parseFloat(document.getElementById("settingHomeR").value),
          },
          use_usb: true,
        },
        plc: {
          ip: document.getElementById("settingPLCIP").value,
          rack: parseInt(document.getElementById("settingPLCRack").value, 10),
          slot: parseInt(document.getElementById("settingPLCSlot").value, 10),
          db_number: 1,
          poll_interval: parseFloat(document.getElementById("settingPollInterval").value),
        },
      };

      addLog("Saving settings...", "info");
      const result = await postJson("/api/settings", settings);

      if (result.success) {
        addLog("Settings saved. Restart server to apply.", "success");
        alert("Settings saved successfully.\n\nRestart the server for changes to take effect.");
        closeSettings();
      } else {
        addLog("Failed to save settings.", "error");
        alert(`Failed to save settings: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      addLog(`Error: ${error.message}`, "error");
      alert(`Error saving settings: ${error.message}`);
    }
  }

  async function restartServer() {
    if (!confirm("Are you sure you want to restart the server?")) {
      return;
    }

    try {
      addLog("Restarting server...", "info");
      const response = await fetch("/api/restart", { method: "POST" });
      const result = await response.json();

      if (result.success) {
        addLog(result.message, "success");
        alert(`${result.message}\n\nThe page will reload automatically.`);
        closeSettings();
        window.setTimeout(() => {
          window.location.reload();
        }, 3000);
      } else {
        addLog(`Restart failed: ${result.error || "Unknown error"}`, "error");
        alert(`Restart failed: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      addLog(`Error: ${error.message}`, "error");
      alert(`Error restarting server: ${error.message}`);
    }
  }

  async function debugDobot() {
    try {
      addLog("Getting Dobot debug information...", "info");
      const response = await fetch("/api/dobot/debug");
      const debug = await response.json();

      addLog("Dobot Debug Information:", "info");
      addLog(`pydobot available: ${debug.pydobot_available}`, debug.pydobot_available ? "success" : "error");
      addLog(`USB enabled: ${debug.use_usb}`, debug.use_usb ? "success" : "warning");
      addLog(`Configured port: ${debug.configured_port}`, "info");
      addLog(`Actual port: ${debug.actual_port || "None"}`, debug.actual_port ? "success" : "warning");
      addLog(`Connected: ${debug.connected}`, debug.connected ? "success" : "error");
      addLog(`Last error: ${debug.last_error || "None"}`, debug.last_error ? "error" : "success");

      const ports = Array.isArray(debug.available_ports) ? debug.available_ports : [];
      addLog(`Available ports: ${ports.length} found`, ports.length > 0 ? "success" : "error");
      ports.forEach((port) => addLog(`- ${port}`, "info"));

      const details = Array.isArray(debug.port_details) ? debug.port_details : [];
      details.forEach((port) => {
        if (port.exists) {
          addLog(
            `Port ${port.port}: permissions=${port.permissions}, readable=${port.readable}, writable=${port.writable}`,
            port.readable && port.writable ? "success" : "warning"
          );
        } else {
          addLog(`Port ${port.port}: ${port.error}`, "error");
        }
      });

      if (!debug.pydobot_available) {
        addLog("To fix: pip install pydobot", "info");
      }
      if (!debug.connected && ports.length === 0) {
        addLog("Check whether the Dobot is connected via USB.", "info");
      }
      if (!debug.connected && ports.length > 0) {
        addLog("Try: sudo chmod 666 /dev/ttyACM*", "info");
      }
    } catch (error) {
      addLog(`Debug error: ${error.message}`, "error");
    }
  }

  function clearLog() {
    const log = document.getElementById("debugLog");
    if (log) {
      log.innerHTML = '<div class="log-placeholder">Log cleared...</div>';
    }
  }

  window.homeRobot = homeRobot;
  window.moveToTarget = moveToTarget;
  window.moveToManual = moveToManual;
  window.useCurrentPosition = useCurrentPosition;
  window.suctionOn = suctionOn;
  window.suctionOff = suctionOff;
  window.gripperOpen = gripperOpen;
  window.gripperClose = gripperClose;
  window.moveToPreset = moveToPreset;
  window.testRobot = testRobot;
  window.emergencyStop = emergencyStop;
  window.openSettings = openSettings;
  window.closeSettings = closeSettings;
  window.saveSettings = saveSettings;
  window.restartServer = restartServer;
  window.debugDobot = debugDobot;
  window.clearLog = clearLog;

  registerServiceWorker();
  window.addEventListener("load", startPolling);
  window.addEventListener("beforeunload", stopPolling);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPolling();
    } else {
      startPolling();
    }
  });
})();
