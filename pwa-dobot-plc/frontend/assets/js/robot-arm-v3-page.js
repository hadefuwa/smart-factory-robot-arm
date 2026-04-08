(function () {
  var POLL_INTERVAL_MS = 500;

  var elements = {
    piHost: document.getElementById('piHost'),
    piPort: document.getElementById('piPort'),
    connectBtn: document.getElementById('connectBtn'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    jointNumber: document.getElementById('jointNumber'),
    jointAngle: document.getElementById('jointAngle'),
    moveBtn: document.getElementById('moveBtn'),
    stopBtn: document.getElementById('stopBtn'),
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

  async function apiRequest(url, options) {
    var response = await fetch(url, options || {});
    var data = await response.json();
    if (!response.ok) {
      var errorMessage = data && data.error ? data.error : 'Request failed';
      throw new Error(errorMessage);
    }
    return data;
  }

  async function connectRobotArm() {
    try {
      var host = elements.piHost.value.trim() || 'robot-arm.local';
      var port = Number(elements.piPort.value || 8080);
      var body = JSON.stringify({ host: host, port: port });

      var data = await apiRequest('/api/robot-arm/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body
      });

      if (data.success) {
        setConnectionText('Status: Connected to ' + host + ':' + port);
      } else {
        setConnectionText('Status: Connect failed');
      }
    } catch (error) {
      setConnectionText('Status: Connect error - ' + error.message);
    }
  }

  async function disconnectRobotArm() {
    try {
      await apiRequest('/api/robot-arm/disconnect', { method: 'POST' });
      setConnectionText('Status: Not connected');
    } catch (error) {
      setConnectionText('Status: Disconnect error - ' + error.message);
    }
  }

  async function moveJoint() {
    try {
      var joint = Number(elements.jointNumber.value);
      var angle = Number(elements.jointAngle.value);
      var body = JSON.stringify({ joint: joint, angle: angle });

      var data = await apiRequest('/api/robot-arm/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body
      });

      if (data.success) {
        setConnectionText('Status: Move command sent');
      } else {
        setConnectionText('Status: Move failed');
      }
    } catch (error) {
      setConnectionText('Status: Move error - ' + error.message);
    }
  }

  async function stopAll() {
    try {
      var data = await apiRequest('/api/robot-arm/stop', { method: 'POST' });
      if (data.success) {
        setConnectionText('Status: Stop command sent');
      } else {
        setConnectionText('Status: Stop failed');
      }
    } catch (error) {
      setConnectionText('Status: Stop error - ' + error.message);
    }
  }

  async function pollStatus() {
    try {
      var data = await apiRequest('/api/robot-arm/status');
      var pretty = JSON.stringify(data, null, 2);
      setStatusText(pretty);
      if (data.connected) {
        setConnectionText('Status: Connected');
      }
    } catch (error) {
      setStatusText('Status read error: ' + error.message);
    }
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = window.setInterval(function () {
      pollStatus();
    }, POLL_INTERVAL_MS);
    pollStatus();
  }

  function stopPolling() {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function bindEvents() {
    elements.connectBtn.addEventListener('click', connectRobotArm);
    elements.disconnectBtn.addEventListener('click', disconnectRobotArm);
    elements.moveBtn.addEventListener('click', moveJoint);
    elements.stopBtn.addEventListener('click', stopAll);
  }

  function init() {
    bindEvents();
    startPolling();
  }

  window.addEventListener('beforeunload', stopPolling);
  document.addEventListener('DOMContentLoaded', init);
})();
