(function () {
  'use strict';

  var POLL_INTERVAL_MS = 500;

  var state = {
    pollTimer: null,
    lastJoints: [],
    bridgeConnected: false
  };

  // PLC auto-move: continuously sends PLC target XYZ to the arm every intervalMs
  var plcAuto = {
    intervalMs: 100,
    timer: null,
    manualOverride: false,
    overrideSecsLeft: 0,
    overrideCountdownTimer: null,
    latestPlcData: null     // cache updated by every status poll
  };

  // Groups: 'Robot State' = robot→PLC status flags, 'Position' = live XYZ readback,
  //         'PLC Commands' = PLC→robot command bits and target coordinates
  var PLC_DB125_FIELDS = [
    { key: 'connected',             label: 'Connected',      type: 'bool', group: 'Robot State' },
    { key: 'busy',                  label: 'Busy',           type: 'bool', group: 'Robot State' },
    { key: 'move_complete',         label: 'Move Complete',  type: 'bool', group: 'Robot State' },
    { key: 'at_home',               label: 'At Home',        type: 'bool', group: 'Robot State' },
    { key: 'at_pickup_position',    label: 'At Pickup',      type: 'bool', group: 'Robot State' },
    { key: 'at_pallet_position',    label: 'At Pallet',      type: 'bool', group: 'Robot State' },
    { key: 'at_quarantine_position',label: 'At Quarantine',  type: 'bool', group: 'Robot State' },
    { key: 'gripper_active',        label: 'Gripper Active', type: 'bool', group: 'Robot State' },
    { key: 'cycle_complete',        label: 'Cycle Complete', type: 'bool', group: 'Robot State' },
    { key: 'robot_status_code',     label: 'Status Code',    type: 'int',  group: 'Robot State' },
    { key: 'error_code',            label: 'Error Code',     type: 'int',  group: 'Robot State' },
    { key: 'x_position',            label: 'X Position',     type: 'int',  unit: 'mm', group: 'Position' },
    { key: 'y_position',            label: 'Y Position',     type: 'int',  unit: 'mm', group: 'Position' },
    { key: 'z_position',            label: 'Z Position',     type: 'int',  unit: 'mm', group: 'Position' },
    { key: 'home_command',          label: 'Home Cmd',       type: 'bool', group: 'PLC Commands' },
    { key: 'pickup_command',        label: 'Pickup Cmd',     type: 'bool', group: 'PLC Commands' },
    { key: 'speed',                 label: 'Speed',          type: 'int',  group: 'PLC Commands' },
    { key: 'target_x',              label: 'Target X',       type: 'int',  unit: 'mm', group: 'PLC Commands' },
    { key: 'target_y',              label: 'Target Y',       type: 'int',  unit: 'mm', group: 'PLC Commands' },
    { key: 'target_z',              label: 'Target Z',       type: 'int',  unit: 'mm', group: 'PLC Commands' }
  ];

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

  function formatPlcValue(field, value, plcConnected) {
    if (!plcConnected || value === null || value === undefined) return '—';
    if (field.type === 'bool') return value ? 'TRUE' : 'FALSE';
    return String(value) + (field.unit ? ' ' + field.unit : '');
  }

  function renderPlcDb125(payload) {
    var grid = el('plcVarGrid');
    var badge = el('plcDb125Badge');
    if (!grid) return;

    var tags = (payload && payload.tags) || {};
    var mapping = (payload && payload.mapping) || {};
    var dbNumber = (payload && payload.db_number) || 125;
    var plcConnected = !!(payload && payload.plc_connected);

    if (badge) {
      badge.textContent = 'DB' + dbNumber + (plcConnected ? ' \u2022 Online' : ' \u2022 Offline');
      badge.className = 'plc-pill' + (plcConnected ? ' online' : '');
    }

    // Build grouped output
    var groupOrder = ['Robot State', 'Position', 'PLC Commands'];
    var grouped = {};
    PLC_DB125_FIELDS.forEach(function (f) {
      var g = f.group || 'Other';
      if (!grouped[g]) grouped[g] = [];
      grouped[g].push(f);
    });

    var html = '';
    groupOrder.forEach(function (groupName) {
      var fields = grouped[groupName];
      if (!fields || !fields.length) return;
      html += '<div class="plc-group">';
      html += '<div class="plc-group-title">' + groupName + '</div>';
      html += '<div class="plc-var-grid">';
      fields.forEach(function (field) {
        var value = tags[field.key];
        var mappingInfo = mapping[field.key] || {};
        var address = field.type === 'bool'
          ? ('DB' + dbNumber + '.DBX' + (mappingInfo.byte !== undefined ? mappingInfo.byte : 0) + '.' + (mappingInfo.bit !== undefined ? mappingInfo.bit : 0))
          : ('DB' + dbNumber + '.DBW' + (mappingInfo.byte !== undefined ? mappingInfo.byte : 0));
        var displayVal = formatPlcValue(field, value, plcConnected);
        var valClass = !plcConnected
          ? ' offline'
          : (field.type === 'bool' ? (value ? ' bool-true' : ' bool-false') : '');
        html +=
          '<div class="plc-var-card">' +
            '<div class="plc-var-label">' + field.label + '</div>' +
            '<div class="plc-var-value' + valClass + '">' + displayVal + '</div>' +
            '<div class="plc-var-meta">' + address + '</div>' +
          '</div>';
      });
      html += '</div></div>';
    });

    grid.innerHTML = html;
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

  async function moveXYZ() {
    var x = Number((el('targetX') && el('targetX').value) || 0);
    var y = Number((el('targetY') && el('targetY').value) || 0);
    var z = Number((el('targetZ') && el('targetZ').value) || 0);
    var speed = Number((el('xyzSpeed') && el('xyzSpeed').value) || 1500);
    var msgEl = el('xyzMsg');
    try {
      var data = await apiRequest('/api/robot-arm/move-xyz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: x, y: y, z: z, speed: speed })
      });
      var resp = data.bridge_response || {};
      if (data.success) {
        var angles = (resp.angles || []).map(function (a) { return a.toFixed(1) + '°'; }).join(', ');
        if (msgEl) { msgEl.textContent = 'Moving → [' + angles + ']'; msgEl.style.color = 'var(--status-success)'; }
      } else {
        if (msgEl) { msgEl.textContent = resp.message || 'Move failed'; msgEl.style.color = 'var(--status-danger)'; }
      }
    } catch (e) {
      if (msgEl) { msgEl.textContent = 'Error: ' + e.message; msgEl.style.color = 'var(--status-danger)'; }
    }
  }

  function renderCurrentXYZ(xyz) {
    function setVal(id, v) {
      var e = el(id);
      if (!e) return;
      if (v === null || v === undefined) { e.innerHTML = '—<span>mm</span>'; return; }
      e.innerHTML = v.toFixed(1) + '<span>mm</span>';
    }
    setVal('curX', xyz ? xyz.x : null);
    setVal('curY', xyz ? xyz.y : null);
    setVal('curZ', xyz ? xyz.z : null);
  }

  // ── PLC auto-move ─────────────────────────────────────────────────────────

  function renderPlcTargetXYZ(tags, plcConnected) {
    function setTargetVal(id, v, unit) {
      var e = el(id);
      if (!e) return;
      if (!plcConnected || v === null || v === undefined) { e.innerHTML = '—<span>' + unit + '</span>'; return; }
      e.innerHTML = v + '<span>' + unit + '</span>';
    }
    setTargetVal('plcTargetX',     tags ? tags.target_x : null, 'mm');
    setTargetVal('plcTargetY',     tags ? tags.target_y : null, 'mm');
    setTargetVal('plcTargetZ',     tags ? tags.target_z : null, 'mm');
    setTargetVal('plcTargetSpeed', tags ? tags.speed    : null, 'steps/s');
  }

  function updatePlcAutoBadge() {
    var badge = el('plcAutoBadge');
    if (!badge) return;
    var plcData = plcAuto.latestPlcData;
    var plcConn = !!(plcData && plcData.plc_connected);
    if (!plcConn) {
      badge.textContent = 'PLC Offline';
      badge.className = 'plc-auto-badge offline';
    } else if (plcAuto.manualOverride) {
      badge.textContent = 'Paused — Manual Override';
      badge.className = 'plc-auto-badge paused';
    } else if (!state.bridgeConnected) {
      badge.textContent = 'Bridge Offline';
      badge.className = 'plc-auto-badge offline';
    } else {
      badge.textContent = 'Active — ' + plcAuto.intervalMs + 'ms';
      badge.className = 'plc-auto-badge active';
    }
  }

  async function plcAutoTick() {
    if (plcAuto.manualOverride) return;
    var plcData = plcAuto.latestPlcData;
    if (!plcData || !plcData.plc_connected) return;
    if (!state.bridgeConnected) return;
    var tags = plcData.tags || {};
    var x = tags.target_x, y = tags.target_y, z = tags.target_z;
    var speed = tags.speed || 1500;
    if (x === undefined || y === undefined || z === undefined) return;
    try {
      await apiRequest('/api/robot-arm/move-xyz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: x, y: y, z: z, speed: speed })
      });
    } catch (_) {}
  }

  function startPlcAutoMove() {
    if (plcAuto.timer) window.clearInterval(plcAuto.timer);
    plcAuto.timer = window.setInterval(plcAutoTick, plcAuto.intervalMs);
  }

  function stopPlcAutoMove() {
    if (plcAuto.timer) { window.clearInterval(plcAuto.timer); plcAuto.timer = null; }
  }

  function tickOverrideCountdown() {
    plcAuto.overrideSecsLeft -= 1;
    var cdEl = el('overrideCountdown');
    if (plcAuto.overrideSecsLeft <= 0) {
      disableManualOverride();
    } else {
      var m = Math.floor(plcAuto.overrideSecsLeft / 60);
      var s = plcAuto.overrideSecsLeft % 60;
      if (cdEl) cdEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }
  }

  function enableManualOverride() {
    plcAuto.manualOverride = true;
    plcAuto.overrideSecsLeft = 600; // 10 min
    if (plcAuto.overrideCountdownTimer) window.clearInterval(plcAuto.overrideCountdownTimer);
    plcAuto.overrideCountdownTimer = window.setInterval(tickOverrideCountdown, 1000);
    var cdEl = el('overrideCountdown');
    if (cdEl) { cdEl.textContent = '10:00'; cdEl.style.display = ''; }
    updatePlcAutoBadge();
    showMsg('Manual override ON — PLC auto-move paused for 10 min');
  }

  function disableManualOverride() {
    plcAuto.manualOverride = false;
    plcAuto.overrideSecsLeft = 0;
    if (plcAuto.overrideCountdownTimer) { window.clearInterval(plcAuto.overrideCountdownTimer); plcAuto.overrideCountdownTimer = null; }
    var cdEl = el('overrideCountdown');
    if (cdEl) cdEl.style.display = 'none';
    var tog = el('manualOverrideToggle');
    if (tog) tog.checked = false;
    updatePlcAutoBadge();
    showMsg('Manual override OFF — PLC auto-move resumed');
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
      if (enabled) {
        // Hold at current physical position — reads present position and writes it
        // back as goal before enabling torque, so joints don't snap to a stale angle.
        await cmd({ command: 'holdAllJoints' });
        showMsg('Holding all joints at current position');
      } else {
        for (var i = 1; i <= 6; i++) {
          try { await cmd({ command: 'stopJoint', joint: i }); } catch (_) {}
        }
        showMsg('Torque disabled — joints free to move');
      }
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
      var results = await Promise.all([
        apiRequest('/api/robot-arm/status'),
        apiRequest('/api/plc/db125/read').catch(function () { return null; })
      ]);
      var data = results[0];
      var plcDb125 = results[1];
      var box = el('statusBox');
      if (box) box.textContent = JSON.stringify(data, null, 2);
      var tEl = el('lastPollTime');
      if (tEl) tEl.textContent = 'Last: ' + new Date().toLocaleTimeString();
      renderPlcDb125(plcDb125);

      // Cache latest PLC data for the auto-move tick
      plcAuto.latestPlcData = plcDb125;
      var plcConnected = !!(plcDb125 && plcDb125.plc_connected);
      renderPlcTargetXYZ(plcDb125 ? plcDb125.tags : null, plcConnected);

      if (data.connected) {
        state.bridgeConnected = true;
        setConnected(true, 'Online');
        var joints = (data.status && data.status.joints) || [];
        if (joints.length) renderJointGrid(joints);
        renderCurrentXYZ((data.status && data.status.currentXYZ) || null);
      } else {
        state.bridgeConnected = false;
        setConnected(false, 'Offline');
        renderCurrentXYZ(null);
      }
      updatePlcAutoBadge();
    } catch (e) {
      state.bridgeConnected = false;
      setConnected(false, 'Error');
      var box2 = el('statusBox');
      if (box2) box2.textContent = 'Poll error: ' + e.message;
      renderPlcDb125(null);
      renderPlcTargetXYZ(null, false);
      updatePlcAutoBadge();
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

    // Joint control tab — XYZ move
    if ((b = el('moveXYZBtn')))   b.addEventListener('click', function () { withBtn(b, moveXYZ); });

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

    // PLC auto-move — interval input (apply on change, no button needed)
    var intervalInput = el('plcMoveInterval');
    if (intervalInput) {
      intervalInput.addEventListener('change', function () {
        var v = Math.max(50, Math.min(5000, Number(intervalInput.value) || 100));
        intervalInput.value = v;
        plcAuto.intervalMs = v;
        startPlcAutoMove();           // restart timer with new interval
        updatePlcAutoBadge();
        showMsg('PLC auto-move interval set to ' + v + 'ms');
      });
    }

    // Manual override toggle
    var tog = el('manualOverrideToggle');
    if (tog) {
      tog.addEventListener('change', function () {
        if (tog.checked) {
          enableManualOverride();
        } else {
          disableManualOverride();
        }
      });
    }
  }

  function init() {
    initTabs();
    bindEvents();
    startPolling();
    startPlcAutoMove();
  }

  window.addEventListener('beforeunload', function () {
    stopPolling();
    stopPlcAutoMove();
    if (plcAuto.overrideCountdownTimer) window.clearInterval(plcAuto.overrideCountdownTimer);
  });
  document.addEventListener('DOMContentLoaded', init);
})();
