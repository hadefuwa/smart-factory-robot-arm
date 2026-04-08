(() => {
  const API_BASE = window.location.origin;
  const POLL_INTERVAL_MS = 2000;
  const SEGMENT_ANIMATION_MS = 220;
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stateStore = {
    snapshot: null,
    timer: null,
    bindMap: {},
    activeSegmentId: 'segment-robot',
  };

  const domRefs = {
    body: document.body,
    menuToggle: document.getElementById('sfMenuToggle'),
    collapseBtn: document.getElementById('sfCollapseBtn'),
    sidebarClose: document.getElementById('sfSidebarClose'),
    backdrop: document.getElementById('sfBackdrop'),
    loadingOverlay: document.getElementById('loading-overlay'),
    segmentedButtons: Array.from(document.querySelectorAll('[data-segment-target]')),
    actionButtons: Array.from(document.querySelectorAll('[data-action]')),
    actionGroups: Array.from(document.querySelectorAll('.sf-action-group')),
    softWarning: document.getElementById('sfSoftWarning'),
    alertsTimeline: document.getElementById('alertsTimeline'),
    faultList: document.getElementById('faultList'),
    backendChip: document.getElementById('sfBackendChip'),
    connectionBadge: document.getElementById('sfConnectionBadge'),
    kpiTiles: Array.from(document.querySelectorAll('.sf-kpi-tile')),
    toastHost: null,
    progress: {
      uptime: document.getElementById('uptimeFill'),
      efficiency: document.getElementById('efficiencyFill'),
      quality: document.getElementById('qualityFill'),
    },
  };

  const apiClient = {
    async getRobotStatus() {
      const data = await fetchJSON(`${API_BASE}/api/data`);
      const dobot = data.dobot || {};
      return {
        connected: !!(dobot.status && dobot.status.connected),
        status: (dobot.status && dobot.status.connected) ? 'READY' : 'OFFLINE',
        position: dobot.pose || { x: 0, y: 0, z: 0, r: 0 },
        last_error: (dobot.status && dobot.status.last_error) || '',
      };
    },
    async getPLCStatus() {
      return fetchJSON(`${API_BASE}/api/plc/status`);
    },
    async getVisionStatus() {
      const data = await fetchJSON(`${API_BASE}/api/camera/status`);
      const connected = !!data.connected;
      const hasFrames = !!data.can_read;
      let fps = 0;
      if (data.last_frame_time) {
        const age = Math.max(0, (Date.now() / 1000) - Number(data.last_frame_time));
        fps = age > 0 ? Number((1 / age).toFixed(1)) : 0;
      }
      return {
        active: connected && hasFrames,
        status: connected ? (hasFrames ? 'ACTIVE' : 'IDLE') : 'OFFLINE',
        fps,
      };
    },
    async getSmartFactory() {
      return fetchJSON(`${API_BASE}/api/smart-factory`);
    },
    async homeRobot() {
      return fetchJSON(`${API_BASE}/api/robot/home`, { method: 'POST' });
    },
    async pickPlace() {
      return fetchJSON(`${API_BASE}/api/robot/pick-place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickX: 200,
          pickY: 0,
          pickZ: 50,
          placeX: 200,
          placeY: 100,
          placeZ: 50,
        }),
      });
    },
    async emergencyStop() {
      return fetchJSON(`${API_BASE}/api/robot/emergency-stop`, { method: 'POST' });
    },
    async startVision() {
      return fetchJSON(`${API_BASE}/api/vision/start`, { method: 'POST' });
    },
    async captureImage() {
      return fetchJSON(`${API_BASE}/api/vision/capture`);
    },
    async runInspection() {
      return fetchJSON(`${API_BASE}/api/vision/inspect`);
    },
    async connectPLC() {
      return fetchJSON(`${API_BASE}/api/plc/connect`, { method: 'POST' });
    },
    async readPLC() {
      return fetchJSON(`${API_BASE}/api/plc/read`);
    },
    async writePLC() {
      return fetchJSON(`${API_BASE}/api/plc/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: 'DB1.DBW0', value: 100 }),
      });
    },
  };

  const actions = {
    async homeRobot() {
      await withLoading(() => apiClient.homeRobot());
      notify('Robot homing...', 'info');
    },
    async pickPlace() {
      await withLoading(() => apiClient.pickPlace());
      notify('Pick and place operation started', 'success');
    },
    async emergencyStop() {
      await apiClient.emergencyStop();
      notify('EMERGENCY STOP ACTIVATED', 'danger');
    },
    async startVision() {
      await withLoading(() => apiClient.startVision());
      notify('Vision system started', 'success');
    },
    async captureImage() {
      await withLoading(() => apiClient.captureImage());
      notify('Image captured', 'success');
    },
    async runInspection() {
      const result = await withLoading(() => apiClient.runInspection());
      const message = result && result.result ? `Inspection complete: ${result.result}` : 'Inspection complete';
      notify(message, 'info');
    },
    async connectPLC() {
      await withLoading(() => apiClient.connectPLC());
      notify('PLC connected', 'success');
    },
    async readPLC() {
      await withLoading(() => apiClient.readPLC());
      notify('PLC data read successfully', 'success');
    },
    async writePLC() {
      await withLoading(() => apiClient.writePLC());
      notify('Data written to PLC', 'success');
    },
    openRobot() {
      window.location.href = '/dobot.html';
    },
    openVision() {
      window.location.href = '/vision-system-new.html';
    },
    openPLC() {
      window.location.href = '/plc-diagnostics.html';
    },
    refreshNow() {
      void scheduler.refresh();
    },
  };

  const scheduler = {
    async refresh() {
      try {
        const snapshot = await getDashboardSnapshot();
        requestAnimationFrame(() => renderers.renderSnapshot(snapshot));
        stateStore.snapshot = snapshot;
        renderers.clearWarning();
      } catch (error) {
        console.error('Dashboard refresh failed:', error);
        renderers.setWarning('Some services are unreachable. Showing latest available values.');
        renderers.renderBackendHealth('DEGRADED', 'warning');
      }
    },
    start() {
      this.stop();
      this.refresh();
      stateStore.timer = setInterval(() => this.refresh(), POLL_INTERVAL_MS);
    },
    stop() {
      if (stateStore.timer) {
        clearInterval(stateStore.timer);
        stateStore.timer = null;
      }
    },
  };

  const renderers = {
    renderSnapshot(snapshot) {
      this.renderBoundValues(snapshot);
      this.renderStatusDots(snapshot);
      this.renderProgress(snapshot);
      this.renderFaults(snapshot);
      this.renderBackendHealth(snapshot.meta.backendHealth, snapshot.meta.backendHealthState);
      this.renderAlerts(snapshot);
    },

    renderBoundValues(snapshot) {
      setBound('meta.mode', snapshot.meta.mode);
      setBound('meta.lastRefresh', snapshot.meta.lastRefresh);
      setBound('meta.backendHealth', snapshot.meta.backendHealth);

      setBound('robot.status', snapshot.robot.status);
      setBound('robot.positionText', snapshot.robot.positionText);

      setBound('vision.status', snapshot.vision.status);
      setBound('vision.fps', snapshot.vision.fps);

      setBound('plc.status', snapshot.plc.status);
      setBound('plc.ip', snapshot.plc.ip);

      animateNumberPath('production.counter', snapshot.production.counter, 0);
      animateNumberPath('production.rfidCount', snapshot.production.rfidCount, 0);
      setBound('production.rfidLast', snapshot.production.rfidLast);

      setBound('line.conveyorStatus', snapshot.line.conveyorStatus);
      setBound('line.conveyorLabel', snapshot.line.conveyorLabel);
      setBound('line.gantryStatus', snapshot.line.gantryStatus);
      setBound('line.gantryLabel', snapshot.line.gantryLabel);

      animateNumberPath('uptime.percent', snapshot.uptime.percent, 1);
      setBound('uptime.duration', snapshot.uptime.duration);

      animateNumberPath('faults.total', snapshot.faults.total, 0);
      animateNumberPath('faults.active', snapshot.faults.active, 0);
      setBound('faults.summary', snapshot.faults.summary);

      animateNumberPath('efficiency.percent', snapshot.efficiency.percent, 1);
      animateNumberPath('quality.percent', snapshot.quality.percent, 1);
      setBound('quality.subtitle', snapshot.quality.subtitle);
    },

    renderStatusDots(snapshot) {
      setBoundState('robot.connectedState', snapshot.robot.connected ? 'online' : 'offline');
      setBoundState('vision.activeState', snapshot.vision.active ? 'online' : 'warning');
      setBoundState('plc.connectedState', snapshot.plc.connected ? 'online' : 'offline');

      setTileState(0, snapshot.robot.connected ? 'online' : 'offline');
      setTileState(1, snapshot.vision.active ? 'online' : 'warning');
      setTileState(2, snapshot.plc.connected ? 'online' : 'offline');
      setTileState(5, snapshot.line.conveyorStatus === 'RUNNING' ? 'online' : 'warning');
      setTileState(6, snapshot.line.gantryStatus === 'RUNNING' ? 'online' : 'warning');
    },

    renderProgress(snapshot) {
      setProgress(domRefs.progress.uptime, snapshot.uptime.percent);
      setProgress(domRefs.progress.efficiency, snapshot.efficiency.percent);
      setProgress(domRefs.progress.quality, snapshot.quality.percent);
    },

    renderFaults(snapshot) {
      const list = domRefs.faultList;
      if (!list) return;
      if (snapshot.faults.list.length === 0) {
        list.innerHTML = '<div class="sf-fault-item clear alert alert-success shadow-sm">No active faults</div>';
        return;
      }

      list.innerHTML = '';
      snapshot.faults.list.forEach((fault, idx) => {
        const item = document.createElement('div');
        item.className = 'sf-fault-item critical alert alert-error shadow-sm';
        item.style.animationDelay = `${idx * 60}ms`;
        item.innerHTML = `<span class="sf-pulse-ring"></span><span>${fault}</span>`;
        list.appendChild(item);
      });
    },

    renderAlerts(snapshot) {
      const prev = stateStore.snapshot;
      if (!prev) {
        addAlert('info', 'Dashboard connected to telemetry streams');
        return;
      }

      if (prev.plc.connected !== snapshot.plc.connected) {
        addAlert(snapshot.plc.connected ? 'success' : 'danger', snapshot.plc.connected ? 'PLC reconnected' : 'PLC disconnected');
      }
      if (prev.robot.connected !== snapshot.robot.connected) {
        addAlert(snapshot.robot.connected ? 'success' : 'warning', snapshot.robot.connected ? 'Robot connection restored' : 'Robot status degraded');
      }
      if (prev.faults.active !== snapshot.faults.active) {
        addAlert(snapshot.faults.active > 0 ? 'danger' : 'success', snapshot.faults.active > 0 ? 'New active fault detected' : 'All active faults cleared');
      }
    },

    renderBackendHealth(label, state) {
      if (!domRefs.backendChip) return;
      domRefs.backendChip.classList.remove('is-online', 'is-warning', 'is-offline');
      domRefs.backendChip.classList.add(`is-${state}`);
      if (domRefs.connectionBadge) {
        domRefs.connectionBadge.classList.remove('badge-success', 'badge-warning', 'badge-error', 'badge-neutral');
        domRefs.connectionBadge.classList.add(state === 'online' ? 'badge-success' : state === 'warning' ? 'badge-warning' : 'badge-error');
      }
      setBound('meta.backendHealth', label);
    },

    setWarning(message) {
      if (!domRefs.softWarning) return;
      domRefs.softWarning.textContent = message;
      domRefs.softWarning.classList.remove('hidden');
      domRefs.softWarning.classList.add('active');
    },

    clearWarning() {
      if (!domRefs.softWarning) return;
      domRefs.softWarning.classList.remove('active');
      domRefs.softWarning.classList.add('hidden');
      domRefs.softWarning.textContent = '';
    },
  };

  async function fetchJSON(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async function getDashboardSnapshot() {
    const [robot, plc, vision, smart] = await Promise.all([
      apiClient.getRobotStatus(),
      apiClient.getPLCStatus(),
      apiClient.getVisionStatus(),
      apiClient.getSmartFactory(),
    ]);

    return normalizeSnapshot({ robot, plc, vision, smart });
  }

  function normalizeSnapshot(raw) {
    const smart = raw.smart && raw.smart.success ? raw.smart : {};
    const smartFaults = smart.faults || {};
    const activeFaults = Number(smartFaults.active || 0);
    const totalFaults = Number(smartFaults.detected || 0);

    const uptimePercent = clampPercent(Number((smart.uptime && smart.uptime.percent) || 0));
    const efficiencyPercent = clampPercent(Number(smart.efficiency || 0));
    const qualityPercent = clampPercent(Number(smart.quality || 0));

    const robotConnected = !!raw.robot.connected;
    const visionActive = !!raw.vision.active;
    const plcConnected = !!raw.plc.connected;

    const robotStatus = raw.robot.status || (robotConnected ? 'READY' : 'OFFLINE');
    const visionStatus = raw.vision.status || (visionActive ? 'ACTIVE' : 'IDLE');
    const plcStatus = plcConnected ? 'CONNECTED' : 'DISCONNECTED';

    const faultList = [];
    if (activeFaults > 0 || smartFaults.fault_detected) {
      faultList.push('Defect detected in production line');
    }

    return {
      robot: {
        status: String(robotStatus).toUpperCase(),
        connected: robotConnected,
        positionText: formatPosition(raw.robot.position),
      },
      vision: {
        status: String(visionStatus).toUpperCase(),
        active: visionActive,
        fps: Number(raw.vision.fps || 0),
      },
      plc: {
        status: plcStatus,
        connected: plcConnected,
        ip: raw.plc.ip || '192.168.0.1',
      },
      production: {
        counter: Number(smart.production_counter || 0),
        rfidCount: Number(smart.rfid_count || 0),
        rfidLast: smart.rfid_last || 'Never',
      },
      line: {
        conveyorStatus: ((smart.conveyor && smart.conveyor.status) || 'UNKNOWN').toUpperCase(),
        conveyorLabel: smart.conveyor && smart.conveyor.running ? 'System active' : 'System stopped',
        gantryStatus: ((smart.gantry && smart.gantry.status) || 'UNKNOWN').toUpperCase(),
        gantryLabel: smart.gantry && smart.gantry.running ? 'Cycle active' : (smart.gantry && smart.gantry.connected ? 'Standby' : 'Not connected'),
      },
      faults: {
        total: totalFaults,
        active: activeFaults,
        list: faultList,
        summary: totalFaults > 0 ? `Total defects: ${totalFaults}` : 'No defects detected',
      },
      efficiency: {
        percent: efficiencyPercent,
      },
      quality: {
        percent: qualityPercent,
        subtitle: `Defects: ${totalFaults} items`,
      },
      uptime: {
        percent: uptimePercent,
        duration: (smart.uptime && smart.uptime.duration) || '0h 0m',
      },
      meta: {
        mode: 'AUTONOMOUS',
        backendHealth: 'ONLINE',
        backendHealthState: 'online',
        lastRefresh: new Date().toLocaleTimeString(),
      },
    };
  }

  function formatPosition(position) {
    if (!position) return 'Position: (0, 0, 0)';
    const x = Number(position.x || 0).toFixed(1);
    const y = Number(position.y || 0).toFixed(1);
    const z = Number(position.z || 0).toFixed(1);
    return `Position: (${x}, ${y}, ${z})`;
  }

  function clampPercent(value) {
    if (Number.isNaN(value)) return 0;
    return Math.max(0, Math.min(100, value));
  }

  function setProgress(el, percent) {
    if (!el) return;
    el.style.width = `${clampPercent(percent).toFixed(1)}%`;
  }

  function buildBindMap() {
    stateStore.bindMap = {};
    document.querySelectorAll('[data-bind]').forEach((el) => {
      const key = el.getAttribute('data-bind');
      if (!stateStore.bindMap[key]) stateStore.bindMap[key] = [];
      stateStore.bindMap[key].push(el);
    });
  }

  function setBound(path, value) {
    const nodes = stateStore.bindMap[path] || [];
    nodes.forEach((node) => {
      if (node.textContent !== String(value)) {
        pulseNode(node);
      }
      node.textContent = value;
    });
  }

  function setBoundState(path, state) {
    const nodes = stateStore.bindMap[path] || [];
    nodes.forEach((node) => {
      node.classList.remove('online', 'offline', 'warning');
      node.classList.add(state);
    });
  }

  function animateNumberPath(path, value, decimals) {
    const nodes = stateStore.bindMap[path] || [];
    nodes.forEach((node) => animateNumber(node, value, decimals));
  }

  function animateNumber(node, targetValue, decimals) {
    const previousRaw = node.dataset.prevValue;
    const previous = previousRaw !== undefined ? Number(previousRaw) : Number(targetValue);
    const target = Number(targetValue);
    if (Number.isNaN(previous) || Number.isNaN(target)) {
      node.textContent = targetValue;
      return;
    }

    if (Math.abs(previous - target) < (decimals === 0 ? 1 : 0.1)) {
      node.textContent = target.toFixed(decimals);
      node.dataset.prevValue = String(target);
      return;
    }

    const start = performance.now();
    const duration = 420;

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = previous + (target - previous) * eased;
      node.textContent = current.toFixed(decimals);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        node.dataset.prevValue = String(target);
        pulseNode(node);
      }
    };

    requestAnimationFrame(step);
  }

  function addAlert(level, message) {
    if (!domRefs.alertsTimeline) return;

    const iconMap = {
      success: 'check_circle',
      info: 'info',
      warning: 'warning',
      danger: 'error',
    };

    const item = document.createElement('div');
    item.className = `sf-alert-item ${level} alert shadow-sm ${level === 'success' ? 'alert-success' : level === 'warning' ? 'alert-warning' : level === 'danger' ? 'alert-error' : 'alert-info'}`;
    item.innerHTML = `
      <i class="material-icons">${iconMap[level] || 'notifications'}</i>
      <div>
        <strong>${message}</strong>
        <small>${new Date().toLocaleTimeString()}</small>
      </div>
    `;

    domRefs.alertsTimeline.prepend(item);
    while (domRefs.alertsTimeline.children.length > 10) {
      domRefs.alertsTimeline.removeChild(domRefs.alertsTimeline.lastElementChild);
    }
  }

  function notify(message, type) {
    if (window.$ && $.notify) {
      $.notify({ icon: 'notifications', message }, {
        type,
        timer: 3000,
        placement: { from: 'top', align: 'right' },
      });
      return;
    }
    const palette = {
      success: 'alert-success',
      danger: 'alert-error',
      warning: 'alert-warning',
      info: 'alert-info',
    };
    const iconMap = {
      success: 'check_circle',
      danger: 'error',
      warning: 'warning',
      info: 'info',
    };

    if (!domRefs.toastHost) {
      const host = document.createElement('div');
      host.className = 'toast toast-top toast-end z-[100]';
      document.body.appendChild(host);
      domRefs.toastHost = host;
    }

    const toast = document.createElement('div');
    toast.className = `alert ${palette[type] || 'alert-info'} shadow-lg`;
    toast.innerHTML = `
      <i class="material-icons">${iconMap[type] || 'notifications'}</i>
      <span>${message}</span>
    `;

    domRefs.toastHost.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
      if (domRefs.toastHost && domRefs.toastHost.children.length === 0) {
        domRefs.toastHost.remove();
        domRefs.toastHost = null;
      }
    }, 3200);
  }

  async function withLoading(fn) {
    showLoading();
    try {
      return await fn();
    } catch (error) {
      console.error(error);
      notify('Action failed. Check connectivity and try again.', 'danger');
      throw error;
    } finally {
      hideLoading();
    }
  }

  function showLoading() {
    if (domRefs.loadingOverlay) domRefs.loadingOverlay.classList.add('active');
  }

  function hideLoading() {
    if (domRefs.loadingOverlay) domRefs.loadingOverlay.classList.remove('active');
  }

  function initSegmentedControls() {
    domRefs.segmentedButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.getAttribute('data-segment-target');
        if (!target || target === stateStore.activeSegmentId) return;

        const previous = document.getElementById(stateStore.activeSegmentId);
        const next = document.getElementById(target);

        if (previous) {
          previous.classList.remove('active');
          previous.classList.add('leaving');
        }

        domRefs.segmentedButtons.forEach((item) => {
          const active = item === button;
          item.classList.toggle('active', active);
          item.classList.toggle('tab-active', active);
          item.setAttribute('aria-selected', String(active));
        });

        window.setTimeout(() => {
          domRefs.actionGroups.forEach((group) => {
            group.classList.remove('active', 'leaving');
          });
          if (next) next.classList.add('active');
          stateStore.activeSegmentId = target;
        }, REDUCED_MOTION ? 0 : SEGMENT_ANIMATION_MS);
      });
    });
  }

  function initActions() {
    domRefs.actionButtons.forEach((button) => {
      button.addEventListener('click', async () => {
        const name = button.getAttribute('data-action');
        const action = actions[name];
        if (!action) return;
        try {
          await action();
        } catch (error) {
          console.error(`Action failed: ${name}`, error);
        }
      });
    });
  }

  function initNavigation() {
    const openMobile = () => domRefs.body.classList.add('sf-mobile-nav-open');
    const closeMobile = () => domRefs.body.classList.remove('sf-mobile-nav-open');

    if (domRefs.menuToggle) {
      domRefs.menuToggle.addEventListener('click', openMobile);
    }
    if (domRefs.sidebarClose) {
      domRefs.sidebarClose.addEventListener('click', closeMobile);
    }
    if (domRefs.backdrop) {
      domRefs.backdrop.addEventListener('click', closeMobile);
    }
    if (domRefs.collapseBtn) {
      domRefs.collapseBtn.addEventListener('click', () => {
        domRefs.body.classList.toggle('sf-sidebar-collapsed');
      });
    }
  }

  function startEntranceSequence() {
    domRefs.body.classList.add('sf-stage-1-ready');
    setTimeout(() => domRefs.body.classList.add('sf-stage-2-ready'), REDUCED_MOTION ? 0 : 140);
    setTimeout(() => domRefs.body.classList.add('sf-stage-3-ready'), REDUCED_MOTION ? 0 : 320);
  }

  function initTileStagger() {
    domRefs.kpiTiles.forEach((tile, index) => {
      tile.style.setProperty('--sf-stagger-index', String(index));
    });
  }

  function setTileState(index, state) {
    const tile = domRefs.kpiTiles[index];
    if (!tile) return;
    if (tile.dataset.state !== state) {
      tile.dataset.state = state;
      pulseNode(tile);
    }
  }

  function pulseNode(node) {
    if (!node || REDUCED_MOTION) return;
    node.classList.remove('sf-live-update');
    void node.offsetWidth;
    node.classList.add('sf-live-update');
    setTimeout(() => node.classList.remove('sf-live-update'), 520);
  }

  async function init() {
    buildBindMap();
    initNavigation();
    initSegmentedControls();
    initActions();
    initTileStagger();
    startEntranceSequence();

    scheduler.start();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.log('ServiceWorker registration failed:', err);
      });
    }

    addAlert('success', 'System initialized successfully');
  }

  window.addEventListener('beforeunload', () => {
    scheduler.stop();
  });

  document.addEventListener('DOMContentLoaded', init);
})();
