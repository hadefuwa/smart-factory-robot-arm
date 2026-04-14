(function () {
  'use strict';

  var POLL_INTERVAL_MS = 500;

  var state = {
    pollTimer: null,
    lastJoints: [],
    bridgeConnected: false
  };

  var xyzGraph = {
    maxPoints: 60,
    labels: [],
    xSeries: [],
    ySeries: [],
    zSeries: [],
    canvas: null
  };

  var jointGraph = {
    maxPoints: 60,
    labels: [],
    joint1: [],
    joint2: [],
    joint3: [],
    joint4: [],
    joint5: [],
    joint6: [],
    canvas: null
  };

  // PLC auto-move: continuously sends PLC target XYZ to the arm every intervalMs
  var plcAuto = {
    intervalMs: 300,
    timer: null,
    manualOverride: false,
    overrideSecsLeft: 0,
    overrideCountdownTimer: null,
    latestPlcData: null,    // cache updated by every status poll
    moveRequestInFlight: false,
    lastSentTargetKey: null
  };

  // Groups: 'Robot State' = robot→PLC status flags, 'Position' = live XYZ readback,
  //         'PLC Commands' = PLC→robot command bits and target coordinates
  var PLC_DB125_FIELDS = [
    { key: 'connected',             label: 'Connected',       type: 'bool', group: 'Robot State' },
    { key: 'busy',                  label: 'Busy',            type: 'bool', group: 'Robot State' },
    { key: 'move_complete',         label: 'Move Complete',   type: 'bool', group: 'Robot State' },
    { key: 'at_home',               label: 'At Home',         type: 'bool', group: 'Robot State' },
    { key: 'at_pickup_position',    label: 'At Pickup',       type: 'bool', group: 'Robot State' },
    { key: 'at_pallet_position',    label: 'At Pallet',       type: 'bool', group: 'Robot State' },
    { key: 'at_quarantine_position',label: 'At Quarantine',   type: 'bool', group: 'Robot State' },
    { key: 'gripper_active',        label: 'Gripper Active',  type: 'bool', group: 'Robot State' },
    { key: 'cycle_complete',        label: 'Cycle Complete',  type: 'bool', group: 'Robot State' },
    { key: 'invalid_target',        label: 'Invalid Target',  type: 'bool', group: 'Robot State' },
    { key: 'any_moving',            label: 'Any Moving',      type: 'bool', group: 'Servo Faults' },
    { key: 'any_overload',          label: 'Any Overload',    type: 'bool', group: 'Servo Faults' },
    { key: 'any_undervoltage',      label: 'Any Undervoltage',type: 'bool', group: 'Servo Faults' },
    { key: 'any_overtemp',          label: 'Any Overtemp',    type: 'bool', group: 'Servo Faults' },
    { key: 'max_temperature',       label: 'Max Temp',        type: 'real', unit: 'C', group: 'Servo Faults' },
    { key: 'min_voltage',           label: 'Min Volt',        type: 'real', unit: 'V', group: 'Servo Faults' },
    { key: 'max_load_pct',          label: 'Max Load',        type: 'real', unit: '%', group: 'Servo Faults' },
    { key: 'x_position',            label: 'X Position',      type: 'int',  unit: 'mm', group: 'Position' },
    { key: 'y_position',            label: 'Y Position',      type: 'int',  unit: 'mm', group: 'Position' },
    { key: 'z_position',            label: 'Z Position',      type: 'int',  unit: 'mm', group: 'Position' },
    { key: 'home_command',          label: 'Home Cmd',        type: 'bool', group: 'PLC Commands' },
    { key: 'pickup_command',        label: 'Pickup Cmd',      type: 'bool', group: 'PLC Commands' },
    { key: 'pallet_command',        label: 'Pallet Cmd',      type: 'bool', group: 'PLC Commands' },
    { key: 'quarantine_command',    label: 'Quarantine Cmd',  type: 'bool', group: 'PLC Commands' },
    { key: 'end_effector_command',  label: 'End Effector Cmd',type: 'bool', group: 'PLC Commands' },
    { key: 'speed',                 label: 'Speed',           type: 'int',  group: 'PLC Commands' },
    { key: 'target_x',              label: 'Target X',        type: 'int',  unit: 'mm', group: 'PLC Commands' },
    { key: 'target_y',              label: 'Target Y',        type: 'int',  unit: 'mm', group: 'PLC Commands' },
    { key: 'target_z',              label: 'Target Z',        type: 'int',  unit: 'mm', group: 'PLC Commands' }
  ];

  // ── helpers ──────────────────────────────────────────────────────────────

  function el(id) { return document.getElementById(id); }

  async function apiRequest(url, options) {
    var response = await fetch(url, options || {});
    var rawText = await response.text();
    var data = null;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (_) {
      var snippet = (rawText || '').trim().slice(0, 120);
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' from ' + url + ': ' + (snippet || 'non-JSON response'));
      }
      throw new Error('Invalid JSON response from ' + url + ': ' + (snippet || 'empty response'));
    }
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
    ['jointCtrlMsg', 'posToolsMsg'].forEach(function (id) {
      var e = el(id);
      if (!e) return;
      e.textContent = msg;
      e.style.color = isError ? 'var(--status-danger)' : 'var(--status-success)';
      clearTimeout(e._t);
      e._t = setTimeout(function () { e.textContent = ''; }, 4000);
    });
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
        slider.disabled = !plcAuto.manualOverride;
        input.disabled = !plcAuto.manualOverride;
        el('jgo-' + j.joint).disabled = !plcAuto.manualOverride;
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

  function showStallAlert(show) {
    var alertEl = el('stallAlert');
    if (!alertEl) return;
    alertEl.style.display = show ? 'flex' : 'none';
  }

  // ── Event log (torque / stall debug) ─────────────────────────────────────
  var eventLog = [];
  var MAX_EVENT_LOG = 200;

  function logEvent(level, msg) {
    var ts = new Date().toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    var ms = String(new Date().getMilliseconds()).padStart(3, '0');
    var entry = '[' + ts + '.' + ms + '] [' + level.toUpperCase() + '] ' + msg;
    eventLog.push(entry);
    if (eventLog.length > MAX_EVENT_LOG) eventLog.shift();
    var box = el('eventLogOut');
    if (box) {
      box.textContent = eventLog.slice().reverse().join('\n');
    }
  }

  function clearEventLog() {
    eventLog = [];
    var box = el('eventLogOut');
    if (box) box.textContent = 'Log cleared.';
  }

  async function moveXYZ() {
    var x = Number((el('targetX') && el('targetX').value) || 0);
    var y = Number((el('targetY') && el('targetY').value) || 0);
    var z = Number((el('targetZ') && el('targetZ').value) || 0);
    var speed = Number((el('xyzSpeed') && el('xyzSpeed').value) || 1500);
    var msgEl = el('xyzMsg');
    showStallAlert(false);
    logEvent('info', 'moveXYZ → X=' + x + ' Y=' + y + ' Z=' + z + ' spd=' + speed);
    try {
      var data = await apiRequest('/api/robot-arm/move-xyz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: x, y: y, z: z, speed: speed })
      });
      var resp = data.bridge_response || {};
      if (data.stalled || resp.type === 'stall') {
        var cause = resp.cause ? (' | ' + resp.cause) : '';
        logEvent('error', 'STALL DETECTED' + cause);
        showStallAlert(true);
        if (msgEl) { msgEl.textContent = resp.message || 'Stall detected — motors stopped'; msgEl.style.color = 'var(--status-danger)'; }
      } else if (data.success) {
        var angles = (resp.angles || []).map(function (a) { return a.toFixed(1) + '\u00b0'; }).join(', ');
        logEvent('info', 'Move done → [' + angles + ']');
        if (msgEl) { msgEl.textContent = 'Done \u2192 [' + angles + ']'; msgEl.style.color = 'var(--status-success)'; }
      } else {
        logEvent('warn', 'Move failed: ' + (resp.message || JSON.stringify(resp)));
        if (msgEl) { msgEl.textContent = resp.message || 'Move failed'; msgEl.style.color = 'var(--status-danger)'; }
      }
    } catch (e) {
      logEvent('error', 'moveXYZ exception: ' + e.message);
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
    setVal('posCurX', xyz ? xyz.x : null);
    setVal('posCurY', xyz ? xyz.y : null);
    setVal('posCurZ', xyz ? xyz.z : null);
  }

  function initXyzGraphCanvas() {
    xyzGraph.canvas = el('xyzGraphCanvas');
    renderXyzGraphCanvas();
    jointGraph.canvas = el('jointGraphCanvas');
    renderJointGraphCanvas();
  }

  function addXyzPointToGraph(xyz) {
    if (!xyz) return;
    var xVal = Number(xyz.x);
    var yVal = Number(xyz.y);
    var zVal = Number(xyz.z);
    if (!Number.isFinite(xVal) || !Number.isFinite(yVal) || !Number.isFinite(zVal)) return;

    var now = new Date();
    var label = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');

    xyzGraph.labels.push(label);
    xyzGraph.xSeries.push(xVal);
    xyzGraph.ySeries.push(yVal);
    xyzGraph.zSeries.push(zVal);

    while (xyzGraph.labels.length > xyzGraph.maxPoints) xyzGraph.labels.shift();
    while (xyzGraph.xSeries.length > xyzGraph.maxPoints) xyzGraph.xSeries.shift();
    while (xyzGraph.ySeries.length > xyzGraph.maxPoints) xyzGraph.ySeries.shift();
    while (xyzGraph.zSeries.length > xyzGraph.maxPoints) xyzGraph.zSeries.shift();
  }

  function clearXyzGraphData() {
    xyzGraph.labels = [];
    xyzGraph.xSeries = [];
    xyzGraph.ySeries = [];
    xyzGraph.zSeries = [];
    setGraphXyzReadout(null);
    renderXyzGraphCanvas();
  }

  function clearJointGraphData() {
    jointGraph.labels = [];
    jointGraph.joint1 = [];
    jointGraph.joint2 = [];
    jointGraph.joint3 = [];
    jointGraph.joint4 = [];
    jointGraph.joint5 = [];
    jointGraph.joint6 = [];
    setGraphJointReadout(null);
    renderJointGraphCanvas();
  }

  function clearAllGraphData() {
    clearXyzGraphData();
    clearJointGraphData();
  }

  function exportXyzGraphCsv() {
    if (!xyzGraph.labels.length) {
      showMsg('No graph data to export', true);
      return;
    }

    var rows = ['time,x_mm,y_mm,z_mm'];
    for (var i = 0; i < xyzGraph.labels.length; i++) {
      var row = [
        xyzGraph.labels[i],
        xyzGraph.xSeries[i],
        xyzGraph.ySeries[i],
        xyzGraph.zSeries[i]
      ];
      rows.push(row.join(','));
    }

    var csvText = rows.join('\n');
    var csvBlob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    var csvUrl = URL.createObjectURL(csvBlob);
    var link = document.createElement('a');
    link.href = csvUrl;
    link.download = 'robot-arm-xyz-graph.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(csvUrl);

    showMsg('CSV exported (' + xyzGraph.labels.length + ' points)');
  }

  function renderXyzGraphCanvas() {
    var canvas = xyzGraph.canvas || el('xyzGraphCanvas');
    if (!canvas) return;
    xyzGraph.canvas = canvas;

    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var width = canvas.width;
    var height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Chart area with margins for labels.
    var left = 56;
    var right = width - 16;
    var top = 16;
    var bottom = height - 30;
    var chartWidth = right - left;
    var chartHeight = bottom - top;

    ctx.fillStyle = 'rgba(5, 12, 28, 0.65)';
    ctx.fillRect(left, top, chartWidth, chartHeight);
    ctx.strokeStyle = 'rgba(140, 170, 210, 0.35)';
    ctx.strokeRect(left, top, chartWidth, chartHeight);

    var allValues = xyzGraph.xSeries.concat(xyzGraph.ySeries, xyzGraph.zSeries);
    if (!allValues.length) {
      ctx.fillStyle = '#a8b7d1';
      ctx.font = '14px sans-serif';
      ctx.fillText('Waiting for XYZ samples...', left + 14, top + 24);
      return;
    }

    var minVal = Math.min.apply(null, allValues);
    var maxVal = Math.max.apply(null, allValues);
    if (minVal === maxVal) {
      minVal = minVal - 1;
      maxVal = maxVal + 1;
    }

    function valueToY(v) {
      var ratio = (v - minVal) / (maxVal - minVal);
      return bottom - (ratio * chartHeight);
    }

    function indexToX(index, total) {
      if (total <= 1) return left;
      return left + (index * chartWidth / (total - 1));
    }

    // Y axis labels.
    ctx.fillStyle = '#c8d5ea';
    ctx.font = '12px monospace';
    var yTopLabel = maxVal.toFixed(1) + ' mm';
    var yMidLabel = ((maxVal + minVal) / 2).toFixed(1) + ' mm';
    var yBotLabel = minVal.toFixed(1) + ' mm';
    ctx.fillText(yTopLabel, 6, top + 4);
    ctx.fillText(yMidLabel, 6, top + chartHeight / 2 + 4);
    ctx.fillText(yBotLabel, 6, bottom + 4);

    // Guide lines.
    ctx.strokeStyle = 'rgba(180, 200, 230, 0.2)';
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(right, top);
    ctx.moveTo(left, top + chartHeight / 2);
    ctx.lineTo(right, top + chartHeight / 2);
    ctx.moveTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    function drawSeries(values, color) {
      if (!values.length) return;
      ctx.beginPath();
      for (var i = 0; i < values.length; i++) {
        var x = indexToX(i, values.length);
        var y = valueToY(values[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    drawSeries(xyzGraph.xSeries, '#42a5f5');
    drawSeries(xyzGraph.ySeries, '#66bb6a');
    drawSeries(xyzGraph.zSeries, '#ef5350');

    // Simple legend.
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#42a5f5';
    ctx.fillText('X', right - 86, top + 14);
    ctx.fillStyle = '#66bb6a';
    ctx.fillText('Y', right - 64, top + 14);
    ctx.fillStyle = '#ef5350';
    ctx.fillText('Z', right - 42, top + 14);

    // Time labels for first and latest point.
    var firstLabel = xyzGraph.labels[0] || '';
    var lastLabel = xyzGraph.labels[xyzGraph.labels.length - 1] || '';
    ctx.fillStyle = '#a8b7d1';
    ctx.font = '11px monospace';
    ctx.fillText(firstLabel, left, height - 8);
    var lastWidth = ctx.measureText(lastLabel).width;
    ctx.fillText(lastLabel, right - lastWidth, height - 8);
  }

  function updateXyzGraph(xyz) {
    addXyzPointToGraph(xyz);
    setGraphXyzReadout(xyz);
    renderXyzGraphCanvas();
  }

  function setGraphXyzReadout(xyz) {
    function setValue(id, value, unit) {
      var node = el(id);
      if (!node) return;
      if (!Number.isFinite(value)) {
        node.textContent = '— ' + unit;
        return;
      }
      node.textContent = value.toFixed(1) + ' ' + unit;
    }

    var xVal = xyz ? Number(xyz.x) : NaN;
    var yVal = xyz ? Number(xyz.y) : NaN;
    var zVal = xyz ? Number(xyz.z) : NaN;
    setValue('graphXValue', xVal, 'mm');
    setValue('graphYValue', yVal, 'mm');
    setValue('graphZValue', zVal, 'mm');
  }

  function addJointPointToGraph(joints) {
    if (!joints || !joints.length) return;

    var byJoint = {};
    joints.forEach(function (j) {
      byJoint[j.joint] = j;
    });

    var now = new Date();
    var label = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
    jointGraph.labels.push(label);

    function pushJointValue(jointNumber, seriesKey) {
      var jointData = byJoint[jointNumber];
      var angle = jointData ? Number(jointData.angleDegrees) : NaN;
      jointGraph[seriesKey].push(Number.isFinite(angle) ? angle : NaN);
    }

    pushJointValue(1, 'joint1');
    pushJointValue(2, 'joint2');
    pushJointValue(3, 'joint3');
    pushJointValue(4, 'joint4');
    pushJointValue(5, 'joint5');
    pushJointValue(6, 'joint6');

    while (jointGraph.labels.length > jointGraph.maxPoints) jointGraph.labels.shift();
    while (jointGraph.joint1.length > jointGraph.maxPoints) jointGraph.joint1.shift();
    while (jointGraph.joint2.length > jointGraph.maxPoints) jointGraph.joint2.shift();
    while (jointGraph.joint3.length > jointGraph.maxPoints) jointGraph.joint3.shift();
    while (jointGraph.joint4.length > jointGraph.maxPoints) jointGraph.joint4.shift();
    while (jointGraph.joint5.length > jointGraph.maxPoints) jointGraph.joint5.shift();
    while (jointGraph.joint6.length > jointGraph.maxPoints) jointGraph.joint6.shift();
  }

  function renderJointGraphCanvas() {
    var canvas = jointGraph.canvas || el('jointGraphCanvas');
    if (!canvas) return;
    jointGraph.canvas = canvas;

    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var width = canvas.width;
    var height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    var left = 56;
    var right = width - 16;
    var top = 16;
    var bottom = height - 30;
    var chartWidth = right - left;
    var chartHeight = bottom - top;

    ctx.fillStyle = 'rgba(5, 12, 28, 0.65)';
    ctx.fillRect(left, top, chartWidth, chartHeight);
    ctx.strokeStyle = 'rgba(140, 170, 210, 0.35)';
    ctx.strokeRect(left, top, chartWidth, chartHeight);

    var allSeries = [
      jointGraph.joint1, jointGraph.joint2, jointGraph.joint3,
      jointGraph.joint4, jointGraph.joint5, jointGraph.joint6
    ];
    var allValues = [];
    allSeries.forEach(function (series) {
      series.forEach(function (val) {
        if (Number.isFinite(val)) allValues.push(val);
      });
    });

    if (!allValues.length) {
      ctx.fillStyle = '#a8b7d1';
      ctx.font = '14px sans-serif';
      ctx.fillText('Waiting for joint samples...', left + 14, top + 24);
      return;
    }

    var minVal = Math.min.apply(null, allValues);
    var maxVal = Math.max.apply(null, allValues);
    if (minVal === maxVal) {
      minVal = minVal - 1;
      maxVal = maxVal + 1;
    }

    function valueToY(v) {
      var ratio = (v - minVal) / (maxVal - minVal);
      return bottom - (ratio * chartHeight);
    }

    function indexToX(index, total) {
      if (total <= 1) return left;
      return left + (index * chartWidth / (total - 1));
    }

    ctx.fillStyle = '#c8d5ea';
    ctx.font = '12px monospace';
    ctx.fillText(maxVal.toFixed(1) + ' deg', 6, top + 4);
    ctx.fillText(((maxVal + minVal) / 2).toFixed(1) + ' deg', 6, top + chartHeight / 2 + 4);
    ctx.fillText(minVal.toFixed(1) + ' deg', 6, bottom + 4);

    ctx.strokeStyle = 'rgba(180, 200, 230, 0.2)';
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(right, top);
    ctx.moveTo(left, top + chartHeight / 2);
    ctx.lineTo(right, top + chartHeight / 2);
    ctx.moveTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    function drawSeries(values, color) {
      if (!values.length) return;
      ctx.beginPath();
      var started = false;
      for (var i = 0; i < values.length; i++) {
        var value = values[i];
        if (!Number.isFinite(value)) {
          started = false;
          continue;
        }
        var x = indexToX(i, values.length);
        var y = valueToY(value);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    drawSeries(jointGraph.joint1, '#42a5f5');
    drawSeries(jointGraph.joint2, '#66bb6a');
    drawSeries(jointGraph.joint3, '#ef5350');
    drawSeries(jointGraph.joint4, '#ffca28');
    drawSeries(jointGraph.joint5, '#ab47bc');
    drawSeries(jointGraph.joint6, '#26c6da');

    ctx.font = '11px sans-serif';
    var legend = [
      { label: 'J1', color: '#42a5f5' },
      { label: 'J2', color: '#66bb6a' },
      { label: 'J3', color: '#ef5350' },
      { label: 'J4', color: '#ffca28' },
      { label: 'J5', color: '#ab47bc' },
      { label: 'J6', color: '#26c6da' }
    ];
    var legendX = right - 168;
    var legendY = top + 12;
    legend.forEach(function (item, index) {
      var col = index % 3;
      var row = Math.floor(index / 3);
      ctx.fillStyle = item.color;
      ctx.fillText(item.label, legendX + (col * 56), legendY + (row * 14));
    });

    var firstLabel = jointGraph.labels[0] || '';
    var lastLabel = jointGraph.labels[jointGraph.labels.length - 1] || '';
    ctx.fillStyle = '#a8b7d1';
    ctx.font = '11px monospace';
    ctx.fillText(firstLabel, left, height - 8);
    var lastWidth = ctx.measureText(lastLabel).width;
    ctx.fillText(lastLabel, right - lastWidth, height - 8);
  }

  function updateJointGraph(joints) {
    addJointPointToGraph(joints);
    setGraphJointReadout(joints);
    renderJointGraphCanvas();
  }

  function setGraphJointReadout(joints) {
    var byJoint = {};
    (joints || []).forEach(function (joint) {
      byJoint[joint.joint] = joint;
    });

    function setJointValue(id, jointNumber) {
      var node = el(id);
      if (!node) return;
      var jointData = byJoint[jointNumber];
      var angle = jointData ? Number(jointData.angleDegrees) : NaN;
      if (!Number.isFinite(angle)) {
        node.textContent = '— deg';
        return;
      }
      node.textContent = angle.toFixed(1) + ' deg';
    }

    setJointValue('graphJ1Value', 1);
    setJointValue('graphJ2Value', 2);
    setJointValue('graphJ3Value', 3);
    setJointValue('graphJ4Value', 4);
    setJointValue('graphJ5Value', 5);
    setJointValue('graphJ6Value', 6);
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
    if (plcAuto.moveRequestInFlight) return;
    var plcData = plcAuto.latestPlcData;
    if (!plcData || !plcData.plc_connected) return;
    if (!state.bridgeConnected) return;
    var tags = plcData.tags || {};
    var x = tags.target_x, y = tags.target_y, z = tags.target_z;
    var speed = tags.speed || 1500;
    if (x === undefined || y === undefined || z === undefined) return;
    var targetKey = [x, y, z, speed].join('|');
    if (plcAuto.lastSentTargetKey === targetKey) return;
    plcAuto.moveRequestInFlight = true;
    try {
      await apiRequest('/api/robot-arm/move-xyz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: x, y: y, z: z, speed: speed })
      });
      plcAuto.lastSentTargetKey = targetKey;
    } catch (_) {}
    plcAuto.moveRequestInFlight = false;
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

  function setManualMoveEnabled(enabled) {
    ['targetX', 'targetY', 'targetZ', 'xyzSpeed', 'moveXYZBtn'].forEach(function (id) {
      var e = el(id);
      if (e) e.disabled = !enabled;
    });
    for (var joint = 1; joint <= 6; joint++) {
      ['jslider-', 'jinput-', 'jgo-'].forEach(function (prefix) {
        var ctrl = el(prefix + joint);
        if (ctrl) ctrl.disabled = !enabled;
      });
    }
    var lock = el('manualMoveLock');
    if (lock) lock.style.display = enabled ? 'none' : '';
  }

  function enableManualOverride() {
    plcAuto.manualOverride = true;
    plcAuto.overrideSecsLeft = 600; // 10 min
    if (plcAuto.overrideCountdownTimer) window.clearInterval(plcAuto.overrideCountdownTimer);
    plcAuto.overrideCountdownTimer = window.setInterval(tickOverrideCountdown, 1000);
    var cdEl = el('overrideCountdown');
    if (cdEl) { cdEl.textContent = '10:00'; cdEl.style.display = ''; }
    setManualMoveEnabled(true);
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
    setManualMoveEnabled(false);
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
    logEvent('warn', 'E-STOP triggered — user action');
    try {
      await cmd({ command: 'stopAllJoints' });
      logEvent('warn', 'E-STOP: stopAllJoints sent OK');
      showMsg('E-STOP sent');
    } catch (e) {
      try {
        await apiRequest('/api/robot-arm/stop', { method: 'POST' });
        logEvent('warn', 'E-STOP: fallback REST stop sent OK');
        showMsg('E-STOP sent');
      } catch (e2) {
        logEvent('error', 'E-STOP failed: ' + e2.message);
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
    logEvent('info', 'setTorqueAll(' + (enabled ? 'ON' : 'OFF') + ') — user action');
    try {
      if (enabled) {
        // Hold at current physical position — reads present position and writes it
        // back as goal before enabling torque, so joints don't snap to a stale angle.
        await cmd({ command: 'holdAllJoints' });
        logEvent('info', 'Torque ON — all joints held at current position');
        showMsg('Holding all joints at current position');
      } else {
        for (var i = 1; i <= 6; i++) {
          try { await cmd({ command: 'stopJoint', joint: i }); } catch (_) {}
        }
        logEvent('warn', 'Torque OFF — all joints free');
        showMsg('Torque disabled — joints free to move');
      }
    } catch (e) {
      logEvent('error', 'setTorqueAll error: ' + e.message);
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
    // Poll arm bridge and PLC data independently so a bridge failure
    // never wipes the PLC target display.
    var armData = null;
    var plcDb125 = null;

    try {
      armData = await apiRequest('/api/robot-arm/status');
    } catch (_) {}

    try {
      plcDb125 = await apiRequest('/api/plc/db125/read');
    } catch (_) {}

    // ── PLC data (always update, regardless of bridge state) ──
    plcAuto.latestPlcData = plcDb125;
    var plcConnected = !!(plcDb125 && plcDb125.plc_connected);
    var db125Tags = plcDb125 ? plcDb125.tags : null;
    renderPlcDb125(plcDb125);
    renderPlcTargetXYZ(db125Tags, plcConnected);

    // Update at-position badges on the Positions tab
    if (db125Tags) {
      POSITIONS.forEach(function (p) {
        var atEl = el(p.atId);
        if (atEl) atEl.classList.toggle('visible', !!(db125Tags[p.atKey]));
      });
    }

    // ── Live status box ──
    var tEl = el('lastPollTime');
    if (tEl) tEl.textContent = 'Last: ' + new Date().toLocaleTimeString();

    // ── Robot arm bridge ──
    if (armData) {
      var box = el('statusBox');
      if (box) box.textContent = JSON.stringify(armData, null, 2);
      if (armData.connected) {
        state.bridgeConnected = true;
        setConnected(true, 'Online');
        var joints = (armData.status && armData.status.joints) || [];
        if (joints.length) renderJointGrid(joints);
        updateJointGraph(joints);
        var currentXYZ = (armData.status && armData.status.currentXYZ) || null;
        renderCurrentXYZ(currentXYZ);
        updateXyzGraph(currentXYZ);
        renderFaults(joints);
      } else {
        state.bridgeConnected = false;
        setConnected(false, 'Offline');
        renderCurrentXYZ(null);
        setGraphXyzReadout(null);
        setGraphJointReadout(null);
        renderFaults([]);
      }
    } else {
      state.bridgeConnected = false;
      setConnected(false, 'Error');
      renderCurrentXYZ(null);
      setGraphXyzReadout(null);
      setGraphJointReadout(null);
      renderFaults(null);
    }

    updatePlcAutoBadge();
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

  // ── Named positions ───────────────────────────────────────────────────────

  var POSITIONS = [
    { id: 'pickup',     label: 'Pickup',    xId: 'posPickupX',     yId: 'posPickupY',     zId: 'posPickupZ',     msgId: 'posPickupMsg',     atId: 'posAtPickup',     atKey: 'at_pickup_position',     saveBtn: 'posSavePickupBtn',     moveBtn: 'posMovePickupBtn',     wX: 'pickup_x',     wY: 'pickup_y',     wZ: 'pickup_z' },
    { id: 'quarantine', label: 'Quarantine',xId: 'posQuarantineX', yId: 'posQuarantineY', zId: 'posQuarantineZ', msgId: 'posQuarantineMsg', atId: 'posAtQuarantine', atKey: 'at_quarantine_position',  saveBtn: 'posSaveQuarantineBtn', moveBtn: 'posMoveQuarantineBtn', wX: 'quarantine_x', wY: 'quarantine_y', wZ: 'quarantine_z' },
    { id: 'pallet',     label: 'Pallet',    xId: 'posPalletX',     yId: 'posPalletY',     zId: 'posPalletZ',     msgId: 'posPalletMsg',     atId: 'posAtPallet',     atKey: 'at_pallet_position',     saveBtn: 'posSavePalletBtn',     moveBtn: 'posMovePalletBtn',     wX: 'pallet_x',     wY: 'pallet_y',     wZ: 'pallet_z' }
  ];

  function posMsg(msgId, text, isError) {
    var e = el(msgId);
    if (!e) return;
    e.textContent = text;
    e.style.color = isError ? 'var(--status-danger)' : 'var(--status-success)';
    clearTimeout(e._t);
    e._t = setTimeout(function () { e.textContent = ''; }, 4000);
  }

  function renderPositions(posData, db125Tags) {
    var badge = el('posBadge');
    var plcConn = !!(posData && posData.plc_connected);
    if (badge) {
      badge.textContent = plcConn ? 'PLC Online' : 'PLC Offline';
      badge.className = 'plc-pill' + (plcConn ? ' online' : '');
    }
    if (!posData || !posData.positions) return;
    var pos = posData.positions;
    var db125 = db125Tags || {};
    POSITIONS.forEach(function (p) {
      var coord = pos[p.id] || {};
      // Fill inputs only when user is not focused on them
      ['x','y','z'].forEach(function (ax) {
        var inp = el(p[ax + 'Id']);
        if (inp && document.activeElement !== inp) inp.value = coord[ax] !== undefined ? coord[ax] : '';
      });
      // At-position badge
      var atEl = el(p.atId);
      if (atEl) atEl.classList.toggle('visible', !!(db125[p.atKey]));
    });
  }

  async function loadPositions() {
    try {
      var d = await apiRequest('/api/plc/positions/read');
      renderPositions(d, plcAuto.latestPlcData ? plcAuto.latestPlcData.tags : null);
    } catch (e) {
      var badge = el('posBadge');
      if (badge) { badge.textContent = 'Load Error'; badge.className = 'plc-pill'; }
    }
  }

  async function savePosition(pos) {
    var x = Number(el(pos.xId) && el(pos.xId).value);
    var y = Number(el(pos.yId) && el(pos.yId).value);
    var z = Number(el(pos.zId) && el(pos.zId).value);
    var payload = {};
    payload[pos.wX] = x; payload[pos.wY] = y; payload[pos.wZ] = z;
    try {
      var d = await apiRequest('/api/plc/positions/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (d.success) {
        posMsg(pos.msgId, 'Saved to PLC', false);
      } else {
        posMsg(pos.msgId, (d.errors || ['Write failed']).join(', '), true);
      }
    } catch (e) {
      posMsg(pos.msgId, 'Error: ' + e.message, true);
    }
  }

  async function moveToPosition(pos) {
    var x = Number(el(pos.xId) && el(pos.xId).value);
    var y = Number(el(pos.yId) && el(pos.yId).value);
    var z = Number(el(pos.zId) && el(pos.zId).value);
    try {
      var d = await apiRequest('/api/robot-arm/move-xyz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: x, y: y, z: z, speed: 1500 })
      });
      var resp = d.bridge_response || {};
      if (d.success) {
        posMsg(pos.msgId, 'Moving to ' + pos.label + ' position', false);
      } else {
        posMsg(pos.msgId, resp.message || 'Move failed', true);
      }
    } catch (e) {
      posMsg(pos.msgId, 'Error: ' + e.message, true);
    }
  }

  // ── fault thresholds (loaded once, updated on save) ──────────────────────
  var faultThresholds = { temp_max_c: 60, voltage_min_v: 7.0, load_max_pct: 80 };

  async function loadFaultConfig() {
    try {
      var d = await apiRequest('/api/robot-arm/fault-config');
      if (d.success) {
        faultThresholds = { temp_max_c: d.temp_max_c, voltage_min_v: d.voltage_min_v, load_max_pct: d.load_max_pct };
        var ti = el('faultCfgTemp'); if (ti) ti.value = d.temp_max_c;
        var vi = el('faultCfgVolt'); if (vi) vi.value = d.voltage_min_v;
        var li = el('faultCfgLoad'); if (li) li.value = d.load_max_pct;
      }
    } catch (_) {}
  }

  async function saveFaultConfig() {
    var tempVal = parseFloat((el('faultCfgTemp') && el('faultCfgTemp').value) || faultThresholds.temp_max_c);
    var voltVal = parseFloat((el('faultCfgVolt') && el('faultCfgVolt').value) || faultThresholds.voltage_min_v);
    var loadVal = parseFloat((el('faultCfgLoad') && el('faultCfgLoad').value) || faultThresholds.load_max_pct);
    var msgEl = el('faultCfgMsg');
    try {
      var d = await apiRequest('/api/robot-arm/fault-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temp_max_c: tempVal, voltage_min_v: voltVal, load_max_pct: loadVal })
      });
      if (d.success) {
        faultThresholds = { temp_max_c: tempVal, voltage_min_v: voltVal, load_max_pct: loadVal };
        if (msgEl) { msgEl.textContent = 'Saved'; msgEl.style.color = 'var(--status-success)'; setTimeout(function () { msgEl.textContent = ''; }, 2500); }
      } else {
        if (msgEl) { msgEl.textContent = 'Error: ' + (d.error || 'failed'); msgEl.style.color = 'var(--status-danger)'; }
      }
    } catch (e) {
      if (msgEl) { msgEl.textContent = 'Error: ' + e.message; msgEl.style.color = 'var(--status-danger)'; }
    }
  }

  function renderFaults(joints) {
    var t = faultThresholds;
    var available = (joints || []).filter(function (j) { return j.available; });
    var anyMoving    = available.some(function (j) { return j.isMoving; });
    var anyOvertemp  = available.some(function (j) { return j.temperature > t.temp_max_c; });
    var anyUnderVolt = available.some(function (j) { return j.voltage < t.voltage_min_v; });
    var anyOverload  = available.some(function (j) { return j.load > t.load_max_pct; });
    var offline      = available.length === 0;

    function setBadge(id, active, offlineState) {
      var el2 = el(id);
      if (!el2) return;
      el2.className = 'fault-badge ' + (offlineState ? 'offline' : active ? 'fault' : 'ok');
    }
    setBadge('faultBadgeMoving',    anyMoving,    offline);
    setBadge('faultBadgeOverload',  anyOverload,  offline);
    setBadge('faultBadgeUnderVolt', anyUnderVolt, offline);
    setBadge('faultBadgeOvertemp',  anyOvertemp,  offline);

    // Per-servo table
    var tbody = el('faultServoBody');
    if (!tbody) return;
    if (!joints || joints.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="color:var(--text-muted);text-align:center;padding:1.5rem">No data — arm not connected</td></tr>';
      return;
    }

    var rows = joints.map(function (j) {
      var avail = j.available;
      var tempHi   = avail && j.temperature > t.temp_max_c;
      var voltLow  = avail && j.voltage < t.voltage_min_v;
      var loadHi   = avail && j.load > t.load_max_pct;
      var hasFault = tempHi || voltLow || loadHi;

      function fmt(val, decimals) {
        return (typeof val === 'number' && Number.isFinite(val)) ? val.toFixed(decimals) : '—';
      }

      function fval(val, isBad, unit) {
        if (!avail) return '<span class="fval na">—</span>';
        var cls = isBad ? 'fval hi' : 'fval ok';
        return '<span class="' + cls + '">' + val + (unit || '') + '</span>';
      }

      return '<tr class="' + (hasFault ? 'fault-row' : '') + '">' +
        '<td><b>J' + j.joint + '</b></td>' +
        '<td>' + (avail ? '<span style="color:var(--status-success);font-size:0.75rem;font-weight:700">OK</span>' : '<span style="color:var(--status-danger);font-size:0.75rem;font-weight:700">N/A</span>') + '</td>' +
        '<td>' + (avail ? (j.isMoving ? '<span class="fval warn">YES</span>' : '<span class="fval ok">No</span>') : '<span class="fval na">—</span>') + '</td>' +
        '<td><span class="fval' + (avail ? '' : ' na') + '">' + (avail ? fmt(j.angleDegrees, 1) : '—') + '</span></td>' +
        '<td>' + fval(fmt(j.temperature, 1) + ' °C', tempHi) + '</td>' +
        '<td>' + fval(fmt(j.voltage, 1) + ' V', voltLow) + '</td>' +
        '<td>' + fval(fmt(j.load, 1) + '%', loadHi) + '</td>' +
        '<td>' + (avail ? (j.torqueEnabled ? '<span class="fval ok">ON</span>' : '<span class="fval na">OFF</span>') : '<span class="fval na">—</span>') + '</td>' +
        '</tr>';
    });
    tbody.innerHTML = rows.join('');
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

    // Settings tab — torque limit slider live display
    var sliderEl = el('torqueLimitSlider');
    if (sliderEl) {
      sliderEl.addEventListener('input', function () {
        var disp = el('torqueLimitDisplay');
        if (disp) disp.textContent = sliderEl.value + '%';
      });
    }

    // Settings tab — apply torque limit
    if ((b = el('applyTorqueLimitBtn'))) {
      b.addEventListener('click', function () {
        withBtn(b, async function () {
          var pct = Number((el('torqueLimitSlider') && el('torqueLimitSlider').value) || 50);
          var msgEl = el('torqueLimitMsg');
          try {
            await cmd({ command: 'setTorqueLimit', percent: pct });
            logEvent('info', 'Torque limit set to ' + pct + '%');
            if (msgEl) { msgEl.style.color = 'var(--status-success)'; msgEl.textContent = 'Applied — all motors limited to ' + pct + '%'; }
          } catch (e) {
            logEvent('error', 'setTorqueLimit error: ' + e.message);
            if (msgEl) { msgEl.style.color = 'var(--status-danger)'; msgEl.textContent = 'Error: ' + e.message; }
          }
        });
      });
    }

    // Settings tab — stall detection config (client-side storage only; updates summary text)
    function updateStallSummary() {
      var polls   = Number((el('stallPolls')      && el('stallPolls').value)      || 4);
      var pollMs  = Number((el('stallPollMs')      && el('stallPollMs').value)      || 200);
      var timeout = Number((el('stallTimeoutSec') && el('stallTimeoutSec').value) || 8);
      var sumEl   = el('stallTimeSummary');
      var toEl    = el('stallTimeoutSummary');
      if (sumEl) sumEl.textContent = polls + ' \u00d7 ' + pollMs + 'ms = ' + (polls * pollMs) + 'ms';
      if (toEl)  toEl.textContent  = timeout + 's';
    }
    ['stallPolls', 'stallPollMs', 'stallTimeoutSec', 'stallDelta'].forEach(function (id) {
      var inp = el(id);
      if (inp) inp.addEventListener('input', updateStallSummary);
    });
    updateStallSummary();

    if ((b = el('applyStallConfigBtn'))) {
      b.addEventListener('click', function () {
        withBtn(b, async function () {
          var cfg = {
            delta:      Number((el('stallDelta')      && el('stallDelta').value)      || 5),
            polls:      Number((el('stallPolls')      && el('stallPolls').value)      || 4),
            pollMs:     Number((el('stallPollMs')      && el('stallPollMs').value)      || 200),
            timeoutSec: Number((el('stallTimeoutSec') && el('stallTimeoutSec').value) || 8)
          };
          var msgEl = el('stallConfigMsg');
          try {
            await cmd({ command: 'setStallConfig', config: cfg });
            logEvent('info', 'Stall config: delta=' + cfg.delta + ' polls=' + cfg.polls + ' pollMs=' + cfg.pollMs + ' timeout=' + cfg.timeoutSec + 's');
            if (msgEl) { msgEl.style.color = 'var(--status-success)'; msgEl.textContent = 'Stall config applied'; }
            updateStallSummary();
          } catch (e) {
            // Server may not support this command yet — show the values locally
            if (msgEl) { msgEl.style.color = 'var(--status-warning)'; msgEl.textContent = 'Saved locally (server restart needed to persist)'; }
            updateStallSummary();
          }
        });
      });
    }

    // Joint control tab — quick actions
    if ((b = el('homeAllBtn')))   b.addEventListener('click', function () { withBtn(b, homeAll); });
    if ((b = el('torqueOnBtn')))  b.addEventListener('click', function () { withBtn(b, function () { return setTorqueAll(true); }); });
    if ((b = el('torqueOffBtn'))) b.addEventListener('click', function () { withBtn(b, function () { return setTorqueAll(false); }); });
    if ((b = el('stopAllBtn')))   b.addEventListener('click', function () { withBtn(b, stopAll); });

    // Joint control tab — XYZ move
    if ((b = el('moveXYZBtn')))     b.addEventListener('click', function () { withBtn(b, moveXYZ); });
    if ((b = el('dismissStallBtn'))) b.addEventListener('click', function () { showStallAlert(false); });

    // Joint control tab — manual move
    if ((b = el('moveBtn')))      b.addEventListener('click', function () { withBtn(b, moveJoint); });
    if ((b = el('setSpeedBtn')))  b.addEventListener('click', function () { withBtn(b, setSpeed); });
    if ((b = el('setAccelBtn')))  b.addEventListener('click', function () { withBtn(b, setAccel); });

    // Header
    if ((b = el('eStopBtn')))     b.addEventListener('click', function () { withBtn(b, eStop); });

    // Live status tab
    if ((b = el('copyStatusBtn')))    b.addEventListener('click', copyStatusToClipboard);
    if ((b = el('refreshStatusBtn'))) b.addEventListener('click', pollStatus);
    if ((b = el('clearGraphBtn'))) b.addEventListener('click', clearAllGraphData);
    if ((b = el('exportGraphCsvBtn'))) b.addEventListener('click', exportXyzGraphCsv);

    // Debug tab
    if ((b = el('dbgEchoBtn')))      b.addEventListener('click', function () { withBtn(b, dbgEcho); });
    if ((b = el('dbgPortInfoBtn')))  b.addEventListener('click', function () { withBtn(b, dbgPortInfo); });
    if ((b = el('dbgLogsBtn')))      b.addEventListener('click', function () { withBtn(b, dbgGetLogs); });
    if ((b = el('dbgDebugOnBtn')))   b.addEventListener('click', function () { withBtn(b, function () { return dbgSetDebug(true); }); });
    if ((b = el('dbgDebugOffBtn')))  b.addEventListener('click', function () { withBtn(b, function () { return dbgSetDebug(false); }); });
    if ((b = el('dbgPingBtn')))      b.addEventListener('click', function () { withBtn(b, dbgRawPing); });
    if ((b = el('dbgRegBtn')))       b.addEventListener('click', function () { withBtn(b, dbgReadRegister); });
    if ((b = el('dbgClearBtn')))     b.addEventListener('click', dbgClearAll);
    if ((b = el('clearEventLogBtn'))) b.addEventListener('click', clearEventLog);

    // Faults tab
    if ((b = el('faultCfgSaveBtn'))) b.addEventListener('click', function () { withBtn(b, saveFaultConfig); });

    // Positions tab
    if ((b = el('posRefreshBtn')))   b.addEventListener('click', function () { withBtn(b, loadPositions); });
    if ((b = el('posTorqueOnBtn')))  b.addEventListener('click', function () { withBtn(b, function () { return setTorqueAll(true); }); });
    if ((b = el('posTorqueOffBtn'))) b.addEventListener('click', function () { withBtn(b, function () { return setTorqueAll(false); }); });
    POSITIONS.forEach(function (pos) {
      var sb = el(pos.saveBtn);
      var mb = el(pos.moveBtn);
      if (sb) sb.addEventListener('click', (function (p) { return function () { withBtn(sb, function () { return savePosition(p); }); }; })(pos));
      if (mb) mb.addEventListener('click', (function (p) { return function () { withBtn(mb, function () { return moveToPosition(p); }); }; })(pos));
    });

    // PLC auto-move — interval input (apply on change, no button needed)
    var intervalInput = el('plcMoveInterval');
    if (intervalInput) {
      intervalInput.addEventListener('change', function () {
        var v = Math.max(50, Math.min(5000, Number(intervalInput.value) || 300));
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
    initXyzGraphCanvas();
    startPolling();
    startPlcAutoMove();
    loadPositions();
    loadFaultConfig();
  }

  window.addEventListener('beforeunload', function () {
    stopPolling();
    stopPlcAutoMove();
    if (plcAuto.overrideCountdownTimer) window.clearInterval(plcAuto.overrideCountdownTimer);
  });
  document.addEventListener('DOMContentLoaded', init);
})();
