(function () {
  var POLL_INTERVAL_MS = 500;

  var elements = {
    piHost: document.getElementById('piHost'),
    piPort: document.getElementById('piPort'),
    connectBtn: document.getElementById('connectBtn'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    scanBtn: document.getElementById('scanBtn'),
    scanFullBtn: document.getElementById('scanFullBtn'),
    jointNumber: document.getElementById('jointNumber'),
    jointAngle: document.getElementById('jointAngle'),
    moveBtn: document.getElementById('moveBtn'),
    stopBtn: document.getElementById('stopBtn'),
    copyStatusBtn: document.getElementById('copyStatusBtn'),
    connectionText: document.getElementById('connectionText'),
    statusBox: document.getElementById('statusBox')
  };

  var state = {
    pollTimer: null
  };

  function setConnectionText(text) {
    elements.connectionText.textContent = text;
  }

  function setStatusText(value) {
    elements.statusBox.textContent = value;
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  async function apiRequest(url, options) {
    var response = await fetch(url, options || {});
    var data = await response.json();
    if (!response.ok) {
      var errorMessage = 'Request failed';
      if (data) {
        if (data.error) {
          errorMessage = data.error;
        } else if (data.bridge_response && data.bridge_response.message) {
          errorMessage = data.bridge_response.message;
        }
      }
      throw new Error(errorMessage);
    }
    return data;
  }

  // Generic passthrough — sends any command payload to /api/robot-arm/command
  async function cmd(payload, recvTimeout) {
    var body = Object.assign({}, payload);
    if (recvTimeout) body._recvTimeout = recvTimeout;
    return apiRequest('/api/robot-arm/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  // Write result JSON into a debug output box
  function dbgOut(elId, data) {
    var el = document.getElementById(elId);
    if (el) el.textContent = JSON.stringify(data, null, 2);
  }

  // Disable/re-enable a button while async work runs
  async function withBtn(btn, fn) {
    btn.disabled = true;
    var orig = btn.textContent;
    btn.textContent = '…';
    try { await fn(); } catch (e) { /* swallowed — fn should handle */ }
    btn.textContent = orig;
    btn.disabled = false;
  }

  // ── main controls ─────────────────────────────────────────────────────────

  async function copyStatusToClipboard() {
    var text = elements.statusBox.textContent || '';
    if (!text) { setConnectionText('Status: Nothing to copy'); return; }
    try {
      await navigator.clipboard.writeText(text);
      setConnectionText('Status: Copied status JSON');
    } catch (_) {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setConnectionText('Status: Copied status JSON');
    }
  }

  async function connectRobotArm() {
    try {
      var host = elements.piHost.value.trim() || 'robot-arm.local';
      var port = Number(elements.piPort.value || 8090);
      var data = await apiRequest('/api/robot-arm/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: host, port: port })
      });
      setConnectionText(data.success ? ('Status: Connected to ' + host + ':' + port) : 'Status: Connect failed');
    } catch (e) {
      setConnectionText('Status: Connect error - ' + e.message);
    }
  }

  async function disconnectRobotArm() {
    try {
      await apiRequest('/api/robot-arm/disconnect', { method: 'POST' });
      setConnectionText('Status: Not connected');
    } catch (e) {
      setConnectionText('Status: Disconnect error - ' + e.message);
    }
  }

  async function moveJoint() {
    try {
      var joint = Number(elements.jointNumber.value);
      var angle = Number(elements.jointAngle.value);
      var data = await apiRequest('/api/robot-arm/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joint: joint, angle: angle })
      });
      setConnectionText(data.success ? 'Status: Move command sent' : 'Status: Move failed');
    } catch (e) {
      setConnectionText('Status: Move error - ' + e.message);
    }
  }

  async function scanServos(maxId) {
    try {
      setConnectionText('Status: Scanning servos (IDs 1-' + maxId + ')...');
      var data = await apiRequest('/api/robot-arm/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxId: maxId, baudRates: [1000000], timeout: 100 })
      });
      var r = data.bridge_response || {};
      setConnectionText('Status: ' + (r.summary || 'scan done'));
      setStatusText(JSON.stringify(r, null, 2));
    } catch (e) {
      setConnectionText('Status: Scan error - ' + e.message);
    }
  }

  async function stopAll() {
    try {
      var data = await apiRequest('/api/robot-arm/stop', { method: 'POST' });
      setConnectionText(data.success ? 'Status: Stop command sent' : 'Status: Stop failed');
    } catch (e) {
      setConnectionText('Status: Stop error - ' + e.message);
    }
  }

  async function pollStatus() {
    try {
      var data = await apiRequest('/api/robot-arm/status');
      setStatusText(JSON.stringify(data, null, 2));
      if (data.connected) setConnectionText('Status: Connected');
    } catch (e) {
      setStatusText('Status read error: ' + e.message);
    }
  }

  // ── debug handlers ────────────────────────────────────────────────────────

  async function dbgEcho() {
    try {
      var d = await cmd({ command: 'echo' });
      var r = d.bridge_response || d;
      dbgOut('dbgHealthOut', r);
    } catch (e) {
      dbgOut('dbgHealthOut', { error: e.message });
    }
  }

  async function dbgPortInfo() {
    try {
      var d = await cmd({ command: 'getPortInfo' });
      dbgOut('dbgHealthOut', d.bridge_response || d);
    } catch (e) {
      dbgOut('dbgHealthOut', { error: e.message });
    }
  }

  async function dbgGetLogs() {
    try {
      var d = await cmd({ command: 'getLogs', count: 50 });
      var r = d.bridge_response || d;
      var entries = r.entries || [];
      var text = entries.map(function (e) {
        return '[' + e.level.toUpperCase() + '] ' + new Date(e.t).toISOString().slice(11, 23) + ' ' + e.msg;
      }).join('\n');
      document.getElementById('dbgHealthOut').textContent = text || '(no logs)';
    } catch (e) {
      dbgOut('dbgHealthOut', { error: e.message });
    }
  }

  async function dbgSetDebug(enabled) {
    try {
      var d = await cmd({ command: 'setDebug', enabled: enabled });
      dbgOut('dbgHealthOut', d.bridge_response || d);
    } catch (e) {
      dbgOut('dbgHealthOut', { error: e.message });
    }
  }

  async function dbgScanServos(maxId) {
    try {
      document.getElementById('dbgDiscoveryOut').textContent = 'Scanning IDs 1-' + maxId + '...';
      var timeout = maxId > 20 ? 180 : 15;
      var d = await cmd({
        command: 'scanServos',
        maxId: maxId,
        baudRates: [1000000],
        timeout: 100,
        _recvTimeout: timeout
      }, timeout);
      dbgOut('dbgDiscoveryOut', d.bridge_response || d);
    } catch (e) {
      dbgOut('dbgDiscoveryOut', { error: e.message });
    }
  }

  async function dbgRawPing() {
    try {
      var id = Number(document.getElementById('dbgPingId').value) || 1;
      var d = await cmd({ command: 'rawPing', id: id });
      dbgOut('dbgDiscoveryOut', d.bridge_response || d);
    } catch (e) {
      dbgOut('dbgDiscoveryOut', { error: e.message });
    }
  }

  async function dbgReadRegister() {
    try {
      var id   = Number(document.getElementById('dbgRegId').value)   || 1;
      var addr = Number(document.getElementById('dbgRegAddr').value) || 56;
      var len  = Number(document.getElementById('dbgRegLen').value)  || 2;
      var d = await cmd({ command: 'readRegister', id: id, register: addr, length: len });
      var r = d.bridge_response || d;
      // Decode some known registers
      if (r.success && r.bytes) {
        var notes = '';
        if (addr === 56 && len >= 2) {
          var pos = r.bytes[0] | (r.bytes[1] << 8);
          var deg = ((pos - 2048) / (2048 / 180)).toFixed(1);
          notes = '  →  pos=' + pos + ' steps (' + deg + '°)';
        } else if (addr === 62) {
          notes = '  →  voltage=' + (r.bytes[0] / 10).toFixed(1) + 'V';
          if (r.bytes[1] !== undefined) notes += '  temp=' + r.bytes[1] + '°C';
        }
        r._decoded = notes.trim();
      }
      dbgOut('dbgRegOut', r);
    } catch (e) {
      dbgOut('dbgRegOut', { error: e.message });
    }
  }

  async function dbgHomeAll() {
    try {
      document.getElementById('dbgMotionOut').textContent = 'Homing all joints…';
      var d = await cmd({ command: 'homeAll' }, 15);
      dbgOut('dbgMotionOut', d.bridge_response || d);
    } catch (e) {
      dbgOut('dbgMotionOut', { error: e.message });
    }
  }

  async function dbgTorque(enabled) {
    try {
      var d = await cmd({ command: 'setTorqueAll', enabled: enabled });
      dbgOut('dbgMotionOut', d.bridge_response || d);
    } catch (e) {
      dbgOut('dbgMotionOut', { error: e.message });
    }
  }

  async function dbgMoveOne() {
    try {
      var joint = Number(document.getElementById('dbgTestJoint').value) || 1;
      var angle = Number(document.getElementById('dbgTestAngle').value);
      var d = await apiRequest('/api/robot-arm/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joint: joint, angle: angle })
      });
      dbgOut('dbgMotionOut', d.bridge_response || d);
    } catch (e) {
      dbgOut('dbgMotionOut', { error: e.message });
    }
  }

  async function dbgBusTest() {
    try {
      var reps = Math.min(Number(document.getElementById('dbgBusReps').value) || 5, 50);
      var out = document.getElementById('dbgBusOut');
      out.textContent = 'Running ' + reps + ' echo(s)…';
      var times = [];
      for (var i = 0; i < reps; i++) {
        var t0 = Date.now();
        await cmd({ command: 'echo' });
        times.push(Date.now() - t0);
      }
      var avg = (times.reduce(function (a, b) { return a + b; }, 0) / times.length).toFixed(1);
      var max = Math.max.apply(null, times);
      var min = Math.min.apply(null, times);
      out.textContent = 'Reps: ' + reps + '\nMin: ' + min + 'ms  Avg: ' + avg + 'ms  Max: ' + max + 'ms\nAll: ' + times.join(', ') + 'ms';
    } catch (e) {
      dbgOut('dbgBusOut', { error: e.message });
    }
  }

  async function dbgJointConfigs() {
    try {
      var d = await cmd({ command: 'getJointConfigs' });
      dbgOut('dbgJointOut', d.bridge_response || d);
    } catch (e) {
      dbgOut('dbgJointOut', { error: e.message });
    }
  }

  async function dbgGetStatusNow() {
    try {
      var d = await cmd({ command: 'getStatus' });
      dbgOut('dbgJointOut', d.bridge_response || d);
    } catch (e) {
      dbgOut('dbgJointOut', { error: e.message });
    }
  }

  function dbgClearAll() {
    ['dbgHealthOut', 'dbgDiscoveryOut', 'dbgRegOut', 'dbgMotionOut', 'dbgBusOut', 'dbgJointOut'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
  }

  // ── polling ───────────────────────────────────────────────────────────────

  function startPolling() {
    stopPolling();
    state.pollTimer = window.setInterval(pollStatus, POLL_INTERVAL_MS);
    pollStatus();
  }

  function stopPolling() {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  // ── event bindings ────────────────────────────────────────────────────────

  function bindEvents() {
    elements.connectBtn.addEventListener('click', connectRobotArm);
    elements.disconnectBtn.addEventListener('click', disconnectRobotArm);
    if (elements.scanBtn)     elements.scanBtn.addEventListener('click', function () { scanServos(20); });
    if (elements.scanFullBtn) elements.scanFullBtn.addEventListener('click', function () { scanServos(253); });
    elements.moveBtn.addEventListener('click', moveJoint);
    elements.stopBtn.addEventListener('click', stopAll);
    if (elements.copyStatusBtn) elements.copyStatusBtn.addEventListener('click', copyStatusToClipboard);

    // debug — service health
    var b;
    if ((b = document.getElementById('dbgEchoBtn')))      b.addEventListener('click', function () { withBtn(b, dbgEcho); });
    if ((b = document.getElementById('dbgPortBtn')))      b.addEventListener('click', function () { withBtn(b, dbgPortInfo); });
    if ((b = document.getElementById('dbgLogsBtn')))      b.addEventListener('click', function () { withBtn(b, dbgGetLogs); });
    if ((b = document.getElementById('dbgDebugOnBtn')))   b.addEventListener('click', function () { withBtn(b, function () { return dbgSetDebug(true); }); });
    if ((b = document.getElementById('dbgDebugOffBtn')))  b.addEventListener('click', function () { withBtn(b, function () { return dbgSetDebug(false); }); });

    // debug — discovery
    if ((b = document.getElementById('dbgScan20Btn')))    b.addEventListener('click', function () { withBtn(b, function () { return dbgScanServos(20); }); });
    if ((b = document.getElementById('dbgScanAllBtn')))   b.addEventListener('click', function () { withBtn(b, function () { return dbgScanServos(253); }); });
    if ((b = document.getElementById('dbgRawPingBtn')))   b.addEventListener('click', function () { withBtn(b, dbgRawPing); });

    // debug — register inspector
    if ((b = document.getElementById('dbgReadRegBtn')))   b.addEventListener('click', function () { withBtn(b, dbgReadRegister); });
    if ((b = document.getElementById('dbgReadPosBtn'))) {
      b.addEventListener('click', function () {
        document.getElementById('dbgRegAddr').value = '56';
        document.getElementById('dbgRegLen').value  = '2';
        withBtn(b, dbgReadRegister);
      });
    }
    if ((b = document.getElementById('dbgReadVoltBtn'))) {
      b.addEventListener('click', function () {
        document.getElementById('dbgRegAddr').value = '62';
        document.getElementById('dbgRegLen').value  = '2';
        withBtn(b, dbgReadRegister);
      });
    }

    // debug — motion
    if ((b = document.getElementById('dbgHomeAllBtn')))   b.addEventListener('click', function () { withBtn(b, dbgHomeAll); });
    if ((b = document.getElementById('dbgTorqueOnBtn')))  b.addEventListener('click', function () { withBtn(b, function () { return dbgTorque(true); }); });
    if ((b = document.getElementById('dbgTorqueOffBtn'))) b.addEventListener('click', function () { withBtn(b, function () { return dbgTorque(false); }); });
    if ((b = document.getElementById('dbgStopAllBtn')))   b.addEventListener('click', function () { withBtn(b, stopAll); });
    if ((b = document.getElementById('dbgMoveOneBtn')))   b.addEventListener('click', function () { withBtn(b, dbgMoveOne); });

    // debug — bus timing
    if ((b = document.getElementById('dbgBusTestBtn')))   b.addEventListener('click', function () { withBtn(b, dbgBusTest); });

    // debug — joint configs
    if ((b = document.getElementById('dbgJointCfgBtn')))  b.addEventListener('click', function () { withBtn(b, dbgJointConfigs); });
    if ((b = document.getElementById('dbgGetStatusBtn'))) b.addEventListener('click', function () { withBtn(b, dbgGetStatusNow); });

    // debug — clear
    if ((b = document.getElementById('debugClearAllBtn'))) b.addEventListener('click', dbgClearAll);
  }

  function init() {
    bindEvents();
    startPolling();
  }

  window.addEventListener('beforeunload', stopPolling);
  document.addEventListener('DOMContentLoaded', init);
})();
