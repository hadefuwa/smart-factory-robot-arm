(function () {
  'use strict';

  var POLL_INTERVAL_MS = 500;

  var state = {
    pollTimer: null,
    lastJoints: []
  };

  // ── helpers ──────────────────────────────────────────────────────────────

  function el(id) { return document.getElementById(id); }

  async function apiRequest(url, options) {
    var response = await fetch(url, options || {});
    var data = await response.json();
    if (!response.ok) {
      var msg = 'Request failed';
      if (data) {
        if (data.error) msg = data.error;
        else if (data.bridge_response && data.bridge_response.message) msg = data.bridge_response.message;
      }
      throw new Error(msg);
    }
    return data;
  }

  async function cmd(payload, recvTimeout) {
    var body = Object.assign({}, payload);
    if (recvTimeout) body._recvTimeout = recvTimeout;
    return apiRequest('/api/robot-arm/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function dbgOut(elId, data) {
    var e = el(elId);
    if (e) e.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  }

  async function withBtn(btn, fn) {
    if (!btn) return;
    var orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';
    try { await fn(); } catch (_) {}
    btn.textContent = orig;
    btn.disabled = false;
  }

  function showMsg(msg, isError) {
    var e = el('jointCtrlMsg');
    if (!e) return;
    e.textContent = msg;
    e.style.color = isError ? 'var(--status-danger)' : 'var(--status-success)';
    clearTimeout(e._t);
    e._t = setTimeout(function () { e.textContent = ''; }, 4000);
  }

  // ── connection badge ──────────────────────────────────────────────────────

  function setConnected(online, text) {
    var badge = el('connBadge');
    var dot   = el('connDot');
    var txt   = el('connText');
    if (badge) { badge.className = 'ra-conn-badge ' + (online ? 'online' : 'offline'); }
    if (dot)   { dot.className = 'ra-dot' + (online ? ' pulse' : ''); }
    if (txt)   { txt.textContent = text || (online ? 'Online' : 'Offline'); }
  }

  // ── joint grid ────────────────────────────────────────────────────────────

  function renderJointGrid(joints) {
    var grid = el('jointGrid');
    if (!grid) return;

    joints.forEach(function (j) {
      var cardId = 'jcard-' + j.joint;
      var card = el(cardId);
      if (!card) {
        card = document.createElement('div');
        card.className = 'joint-card';
        card.id = cardId;
        card.innerHTML =
          '<div class="joint-card-header">' +
            '<span class="joint-num">Joint ' + j.joint + '</span>' +
            '<span class="joint-avail" id="javail-' + j.joint + '"></span>' +
          '</div>' +
          '<div class="joint-angle" id="jangle-' + j.joint + '">—<span>°</span></div>' +
          '<div class="joint-pos-row">' +
            '<span>Steps: <b id="jsteps-' + j.joint + '">—</b></span>' +
            '<span id="jmoving-' + j.joint + '"></span>' +
          '</div>' +
          '<div class="joint-move-bar">' +
            '<input type="range" min="-180" max="180" value="0" id="jslider-' + j.joint + '">' +
            '<input type="number" class="joint-angle-input" min="-180" max="180" value="0" id="jinput-' + j.joint + '">' +
            '<button class="joint-btn-go" id="jgo-' + j.joint + '">Go</button>' +
          '</div>';
        grid.appendChild(card);

        // Sync slider → input
        var slider = el('jslider-' + j.joint);
        var input  = el('jinput-' + j.joint);
        slider.addEventListener('input', function () { input.value = slider.value; });
        input.addEventListener('input', function () { slider.value = input.value; });

        // Go button
        (function (jointNum, sliderEl, inputEl) {
          el('jgo-' + jointNum).addEventListener('click', function () {
            var angle = Number(inputEl.value) || 0;
            apiRequest('/api/robot-arm/move', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ joint: jointNum, angle: angle, speed: 1500 })
            }).then(function () {
              showMsg('Joint ' + jointNum + ' moving to ' + angle + '°');
            }).catch(function (e) {
              showMsg('Move error: ' + e.message, true);
            });
          });
        })(j.joint, slider, input);
      }

      var avail = j.available;
      var eavail = el('javail-' + j.joint);
      if (eavail) {
        eavail.textContent = avail ? 'Online' : 'Offline';
        eavail.className = 'joint-avail ' + (avail ? 'ok' : 'fail');
      }
      var eangle = el('jangle-' + j.joint);
      if (eangle && avail) {
        eangle.innerHTML = (j.angleDegrees !== undefined ? j.angleDegrees.toFixed(1) : '—') + '<span>°</span>';
      }
      var esteps = el('jsteps-' + j.joint);
      if (esteps) esteps.textContent = avail ? (j.stepPosition || j.position || 0) : '—';
      var emov = el('jmoving-' + j.joint);
      if (emov) emov.textContent = j.isMoving ? 'Moving…' : '';
    });

    state.lastJoints = joints;
  }

  // ── API calls ─────────────────────────────────────────────────────────────

  async function connectRobotArm() {
    try {
      var host = (el('piHost') && el('piHost').value.trim()) || 'localhost';
      var port = Number((el('piPort') && el('piPort').value) || 8090);
      var data = await apiRequest('/api/robot-arm/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: host, port: port })
      });
      var txt = el('connectionText');
      if (txt) txt.textContent = data.success ? ('Connected to ' + host + ':' + port) : 'Connect failed';
    } catch (e) {
      var txt2 = el('connectionText');
      if (txt2) txt2.textContent = 'Error: ' + e.message;
    }
  }

  async function disconnectRobotArm() {
    try {
      await apiRequest('/api/robot-arm/disconnect', { method: 'POST' });
      var txt = el('connectionText');
      if (txt) txt.textContent = 'Disconnected';
    } catch (e) {
      var txt2 = el('connectionText');
      if (txt2) txt2.textContent = 'Error: ' + e.message;
    }
  }

  async function moveJoint() {
    try {
      var joint = Number((el('jointNumber') && el('jointNumber').value) || 1);
      var angle = Number((el('jointAngle')  && el('jointAngle').value)  || 0);
      var speed = Number((el('moveSpeed')   && el('moveSpeed').value)   || 1500);
      var data = await apiRequest('/api/robot-arm/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joint: joint, angle: angle, speed: speed })
      });
      showMsg(data.success ? ('Joint ' + joint + ' moving to ' + angle + '°') : 'Move failed');
    } catch (e) {
      showMsg('Move error: ' + e.message, true);
    }
  }

  async function stopAll() {
    try {
      await apiRequest('/api/robot-arm/stop', { method: 'POST' });
      showMsg('Stop command sent');
    } catch (e) {
      showMsg('Stop error: ' + e.message, true);
    }
  }

  async function eStop() {
    try {
      await cmd({ command: 'stopAllJoints' });
      showMsg('E-STOP sent');
    } catch (e) {
      try {
        await apiRequest('/api/robot-arm/stop', { method: 'POST' });
        showMsg('E-STOP sent');
      } catch (e2) {
        showMsg('E-STOP error: ' + e2.message, true);
      }
    }
  }

  async function homeAll() {
    try {
      await cmd({ command: 'homeAll' });
      showMsg('Homing all joints…');
    } catch (e) {
      showMsg('Home error: ' + e.message, true);
    }
  }

  async function setTorqueAll(enabled) {
    try {
      for (var i = 1; i <= 6; i++) {
        try {
          await cmd({ command: enabled ? 'startServo' : 'stopJoint', joint: i });
        } catch (_) {}
      }
      showMsg('Torque ' + (enabled ? 'enabled' : 'disabled') + ' for all joints');
    } catch (e) {
      showMsg('Torque error: ' + e.message, true);
    }
  }

  async function setSpeed() {
    try {
      var joint = Number((el('speedJoint') && el('speedJoint').value) || 1);
      var speed = Number((el('speedValue') && el('speedValue').value) || 1500);
      await cmd({ command: 'setSpeed', joint: joint, speed: speed });
      showMsg('Speed set for joint ' + joint);
    } catch (e) {
      showMsg('Speed error: ' + e.message, true);
    }
  }

  async function setAccel() {
    try {
      var joint = Number((el('speedJoint') && el('speedJoint').value) || 1);
      var accel = Number((el('accelValue') && el('accelValue').value) || 50);
      await cmd({ command: 'setAcceleration', joint: joint, acceleration: accel });
      showMsg('Acceleration set for joint ' + joint);
    } catch (e) {
      showMsg('Accel error: ' + e.message, true);
    }
  }

  async function scanServos(maxId) {
    var outId = maxId > 20 ? 'dbgScanOut' : 'scanOut';
    dbgOut(outId, 'Scanning IDs 1-' + maxId + '…');
    try {
      var timeout = maxId > 20 ? 180 : 15;
      var d = await cmd({ command: 'scanServos', maxId: maxId, baudRates: [1000000], timeout: 100, _recvTimeout: timeout }, timeout);
      dbgOut(outId, d.bridge_response || d);
    } catch (e) {
      dbgOut(outId, { error: e.message });
    }
  }

  async function copyStatusToClipboard() {
    var box = el('statusBox');
    if (!box || !box.textContent) return;
    try { await navigator.clipboard.writeText(box.textContent); } catch (_) {
      var ta = document.createElement('textarea');
      ta.value = box.textContent;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    showMsg('Status JSON copied');
  }

  // ── polling ───────────────────────────────────────────────────────────────

  async function pollStatus() {
    try {
      var data = await apiRequest('/api/robot-arm/status');
      var box = el('statusBox');
      if (box) box.textContent = JSON.stringify(data, null, 2);
      var tEl = el('lastPollTime');
      if (tEl) tEl.textContent = 'Last: ' + new Date().toLocaleTimeString();

      if (data.connected) {
        setConnected(true, 'Online');
        var joints = (data.status && data.status.joints) || [];
        if (joints.length) renderJointGrid(joints);
      } else {
        setConnected(false, 'Offline');
      }
    } catch (e) {
      setConnected(false, 'Error');
      var box2 = el('statusBox');
      if (box2) box2.textContent = 'Poll error: ' + e.message;
    }
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = window.setInterval(pollStatus, POLL_INTERVAL_MS);
    pollStatus();
  }

  function stopPolling() {
    if (state.pollTimer) { window.clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  // ── debug handlers ────────────────────────────────────────────────────────

  async function dbgEcho() {
    try { dbgOut('dbgEchoOut', (await cmd({ command: 'echo' })).bridge_response); }
    catch (e) { dbgOut('dbgEchoOut', { error: e.message }); }
  }

  async function dbgPortInfo() {
    try { dbgOut('dbgPortOut', (await cmd({ command: 'getPortInfo' })).bridge_response); }
    catch (e) { dbgOut('dbgPortOut', { error: e.message }); }
  }

  async function dbgGetLogs() {
    try {
      var d = await cmd({ command: 'getLogs', count: 60 });
      var r = d.bridge_response || d;
      var entries = r.entries || [];
      var text = entries.map(function (e) {
        return '[' + (e.level || 'LOG').toUpperCase() + '] ' + new Date(e.t).toISOString().slice(11, 23) + ' ' + e.msg;
      }).join('\n');
      dbgOut('dbgLogsOut', text || '(no logs)');
    } catch (e) { dbgOut('dbgLogsOut', { error: e.message }); }
  }

  async function dbgSetDebug(enabled) {
    try { dbgOut('dbgEchoOut', (await cmd({ command: 'setDebug', enabled: enabled })).bridge_response); }
    catch (e) { dbgOut('dbgEchoOut', { error: e.message }); }
  }

  async function dbgRawPing() {
    try {
      var id = Number((el('pingId') && el('pingId').value) || 1);
      dbgOut('dbgPingOut', (await cmd({ command: 'rawPing', id: id })).bridge_response);
    } catch (e) { dbgOut('dbgPingOut', { error: e.message }); }
  }

  async function dbgReadRegister() {
    try {
      var id   = Number((el('regId')   && el('regId').value)   || 1);
      var addr = Number((el('regAddr') && el('regAddr').value) || 56);
      var len  = Number((el('regLen')  && el('regLen').value)  || 2);
      var d = await cmd({ command: 'readRegister', id: id, register: addr, length: len });
      var r = d.bridge_response || d;
      if (r.success && r.bytes) {
        var extra = '';
        if (addr === 56 && len >= 2) {
          var pos = r.bytes[0] | (r.bytes[1] << 8);
          extra = '\n→ pos=' + pos + ' (' + ((pos - 2048) / (2048 / 180)).toFixed(1) + '°)';
        }
        dbgOut('dbgRegOut', JSON.stringify(r, null, 2) + extra);
      } else {
        dbgOut('dbgRegOut', r);
      }
    } catch (e) { dbgOut('dbgRegOut', { error: e.message }); }
  }

  function dbgClearAll() {
    ['dbgEchoOut','dbgPortOut','dbgLogsOut','dbgPingOut','dbgRegOut','dbgScanOut','scanOut'].forEach(function (id) {
      var e = el(id); if (e) e.textContent = '—';
    });
  }

  // ── tab system ────────────────────────────────────────────────────────────

  function initTabs() {
    var tabs = document.querySelectorAll('.ra-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.getAttribute('data-tab');
        tabs.forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.ra-panel').forEach(function (p) { p.classList.remove('active'); });
        tab.classList.add('active');
        var panel = el('tab-' + target);
        if (panel) panel.classList.add('active');
      });
    });
  }

  // ── event bindings ────────────────────────────────────────────────────────

  function bindEvents() {
    // Settings tab — connection
    var b;
    if ((b = el('connectBtn')))    b.addEventListener('click', function () { withBtn(b, connectRobotArm); });
    if ((b = el('disconnectBtn'))) b.addEventListener('click', function () { withBtn(b, disconnectRobotArm); });

    // Settings tab — scan
    if ((b = el('scanBtn')))     b.addEventListener('click', function () { withBtn(b, function () { return scanServos(6); }); });
    if ((b = el('scanFullBtn'))) b.addEventListener('click', function () { withBtn(b, function () { return scanServos(253); }); });

    // Settings tab — poll interval
    if ((b = el('setPollBtn'))) {
      b.addEventListener('click', function () {
        var v = Number((el('pollInterval') && el('pollInterval').value) || 500);
        POLL_INTERVAL_MS = Math.max(200, Math.min(5000, v));
        startPolling();
        showMsg('Poll interval set to ' + POLL_INTERVAL_MS + 'ms');
      });
    }

    // Joint control tab — quick actions
    if ((b = el('homeAllBtn')))   b.addEventListener('click', function () { withBtn(b, homeAll); });
    if ((b = el('torqueOnBtn')))  b.addEventListener('click', function () { withBtn(b, function () { return setTorqueAll(true); }); });
    if ((b = el('torqueOffBtn'))) b.addEventListener('click', function () { withBtn(b, function () { return setTorqueAll(false); }); });
    if ((b = el('stopAllBtn')))   b.addEventListener('click', function () { withBtn(b, stopAll); });

    // Joint control tab — manual move
    if ((b = el('moveBtn')))      b.addEventListener('click', function () { withBtn(b, moveJoint); });
    if ((b = el('setSpeedBtn')))  b.addEventListener('click', function () { withBtn(b, setSpeed); });
    if ((b = el('setAccelBtn')))  b.addEventListener('click', function () { withBtn(b, setAccel); });

    // Header
    if ((b = el('eStopBtn')))     b.addEventListener('click', function () { withBtn(b, eStop); });

    // Live status tab
    if ((b = el('copyStatusBtn')))    b.addEventListener('click', copyStatusToClipboard);
    if ((b = el('refreshStatusBtn'))) b.addEventListener('click', pollStatus);

    // Debug tab
    if ((b = el('dbgEchoBtn')))      b.addEventListener('click', function () { withBtn(b, dbgEcho); });
    if ((b = el('dbgPortInfoBtn')))  b.addEventListener('click', function () { withBtn(b, dbgPortInfo); });
    if ((b = el('dbgLogsBtn')))      b.addEventListener('click', function () { withBtn(b, dbgGetLogs); });
    if ((b = el('dbgDebugOnBtn')))   b.addEventListener('click', function () { withBtn(b, function () { return dbgSetDebug(true); }); });
    if ((b = el('dbgDebugOffBtn')))  b.addEventListener('click', function () { withBtn(b, function () { return dbgSetDebug(false); }); });
    if ((b = el('dbgPingBtn')))      b.addEventListener('click', function () { withBtn(b, dbgRawPing); });
    if ((b = el('dbgRegBtn')))       b.addEventListener('click', function () { withBtn(b, dbgReadRegister); });
    if ((b = el('dbgClearBtn')))     b.addEventListener('click', dbgClearAll);
  }

  function init() {
    initTabs();
    bindEvents();
    startPolling();
  }

  window.addEventListener('beforeunload', stopPolling);
  document.addEventListener('DOMContentLoaded', init);
})();
