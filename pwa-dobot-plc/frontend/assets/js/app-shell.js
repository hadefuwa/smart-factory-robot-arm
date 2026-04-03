(() => {
  const path = window.location.pathname || '/';
  const normalizedPath = path === '/' ? '/index.html' : path;

  const NAV_ITEMS = [
    { href: '/index.html', label: 'Dashboard', icon: 'dashboard', section: 'primary' },
    { href: '/robot-arm.html', label: 'Robot Arm', icon: 'precision_manufacturing', section: 'primary' },
    { href: '/vision-system-new.html', label: 'Vision System', icon: 'visibility', section: 'primary' },
    { href: '/rfid.html', label: 'RFID Tracking', icon: 'nfc', section: 'primary' },
    { href: '/plc-diagnostics.html', label: 'PLC Diagnostics', icon: 'analytics', section: 'primary' },
    { href: '/io-link.html', label: 'IO-Link Master', icon: 'settings_input_component', section: 'primary' },
    { href: '/edge-device-stats.html', label: 'Edge Device Stats', icon: 'memory', section: 'primary' },
    { href: '/hotspot-status.html', label: 'Hotspot Status', icon: 'wifi', section: 'utility' },
    { href: '/color-voting-test.html', label: 'Color Voting Test', icon: 'palette', section: 'utility' },
    { href: '/vision-system.html', label: 'Vision Legacy', icon: 'history', section: 'utility' },
  ];

  const PAGE_META = {
    '/index.html': { kind: 'primary' },
    '/robot-arm.html': { kind: 'primary' },
    '/vision-system-new.html': { kind: 'primary' },
    '/rfid.html': { kind: 'primary' },
    '/plc-diagnostics.html': { kind: 'primary' },
    '/io-link.html': { kind: 'primary' },
    '/edge-device-stats.html': { kind: 'primary' },
    '/hotspot-status.html': { kind: 'utility' },
    '/color-voting-test.html': { kind: 'utility' },
    '/vision-system.html': {
      kind: 'legacy',
      ctaHref: '/vision-system-new.html',
      ctaLabel: 'Open Production Vision',
      notice: 'This is a retained legacy interface. Use the production vision page for normal operations.',
    },
  };

  const HERO_CONFIG = {
    '/robot-arm.html': {
      kicker: 'Robot Control',
      title: 'Operate, home, and diagnose the Dobot from one control surface.',
      description: 'Keep the existing motion, tool, settings, and emergency-stop flows, now presented in the unified Matrix shell.',
      variant: 'robot',
      chips: [
        ['Mode', 'Direct Control'],
        ['Backend', 'Live API'],
        ['Safety', 'E-Stop Ready'],
      ],
    },
    '/vision-system-new.html': {
      kicker: 'Vision Control',
      title: 'Run the production vision workflow with live camera, ROI, and PLC-trigger status.',
      description: 'This remains the primary vision page and keeps the existing capture, analyze, voting, and config behavior intact.',
      variant: 'vision',
      chips: [
        ['Role', 'Production Vision'],
        ['Camera', 'Streaming'],
        ['PLC', 'Integrated'],
      ],
    },
    '/rfid.html': {
      kicker: 'Tracking Surface',
      title: 'Monitor RFID movement, tag metadata, and line context in the shared app shell.',
      description: 'This page keeps its conveyor and metadata presentation while adopting the same navigation and visual language as the rest of the app.',
      variant: 'rfid',
      chips: [
        ['Subsystem', 'RFID'],
        ['Use Case', 'Tracking'],
        ['Status', 'Static / Demo'],
      ],
    },
    '/plc-diagnostics.html': {
      kicker: 'Engineering Tools',
      title: 'Inspect and edit PLC mappings, runtime config, and camera start behavior.',
      description: 'Dense diagnostics and admin workflows stay intact, but now sit inside the same operations shell as the rest of the application.',
      variant: 'plc',
      chips: [
        ['Focus', 'Diagnostics'],
        ['Config', 'Editable'],
        ['Target', 'S7-1200'],
      ],
    },
    '/io-link.html': {
      kicker: 'I/O Supervision',
      title: 'Track IO-Link ports, supervision history, and device health in a unified interface.',
      description: 'The existing polling, history, and device detail flows remain unchanged while the page adopts the new shell.',
      variant: 'iolink',
      chips: [
        ['Master', 'AL1300'],
        ['Polling', 'Live'],
        ['Data', 'Port Details'],
      ],
    },
    '/edge-device-stats.html': {
      kicker: 'Edge Telemetry',
      title: 'Read CPU, memory, temperature, and uptime metrics from the Raspberry Pi node.',
      description: 'A compact diagnostics page upgraded into the shared shell without changing its endpoint contract.',
      variant: 'twin',
      chips: [
        ['Source', 'Edge Node'],
        ['Refresh', '2 Seconds'],
        ['Contract', '/api/edge-device-stats'],
      ],
    },
    '/hotspot-status.html': {
      kicker: 'Support Utility',
      title: 'Check hotspot health and give operators a clean path to reconnect to the Pi.',
      description: 'This remains a support page, but it now lives inside the same shell and uses cleaned-up copy and status presentation.',
      variant: 'twin',
      chips: [
        ['Category', 'Utility'],
        ['Network', 'Wi-Fi AP'],
        ['Contract', '/api/hotspot/status'],
      ],
    },
    '/color-voting-test.html': {
      kicker: 'Engineering Utility',
      title: 'Run the color voting tool without exposing it as a primary production page.',
      description: 'The functionality stays available for testing while being visually grouped with the rest of the application.',
      variant: 'vision',
      chips: [
        ['Category', 'Test Tool'],
        ['Vision', 'Voting'],
        ['Audience', 'Engineering'],
      ],
    },
    '/vision-system.html': {
      kicker: 'Legacy View',
      title: 'Keep the legacy vision page visually aligned while production users move to the new interface.',
      description: 'This page is treated as a legacy utility view and remains accessible without becoming part of the main production navigation.',
      variant: 'vision',
      chips: [
        ['Category', 'Legacy'],
        ['Status', 'Secondary'],
        ['Successor', 'vision-system-new'],
      ],
    },
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ensureMatrixAssets() {
    const head = document.head;
    if (!head) return;

    if (!document.querySelector('link[data-matrix-template-css="true"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/assets/css/matrix-ui-template.css';
      link.setAttribute('data-matrix-template-css', 'true');
      head.insertBefore(link, head.querySelector('link[href*="professional-theme.css"]') || null);
    }
  }

  function initParticles(container) {
    if (!container || container.dataset.initialized === 'true') return;
    container.dataset.initialized = 'true';

    for (let i = 0; i < 15; i += 1) {
      const particle = document.createElement('div');
      particle.className = 'factory-particle';
      particle.style.width = `${Math.random() * 4 + 2}px`;
      particle.style.height = particle.style.width;
      particle.style.left = `${Math.random() * 100}%`;
      particle.style.animationDuration = `${Math.random() * 10 + 8}s`;
      particle.style.animationDelay = `${Math.random() * 5}s`;
      container.appendChild(particle);
    }

    for (let i = 0; i < 8; i += 1) {
      const line = document.createElement('div');
      line.className = 'circuit-line';
      line.style.top = `${Math.random() * 100}%`;
      line.style.width = `${Math.random() * 150 + 100}px`;
      line.style.animationDuration = `${Math.random() * 6 + 4}s`;
      line.style.animationDelay = `${Math.random() * 3}s`;
      container.appendChild(line);
    }
  }

  function markNavActive(sidebar) {
    if (!sidebar) return;
    sidebar.querySelectorAll('.sf-nav-item').forEach((link) => {
      const href = link.getAttribute('href');
      const active = href === normalizedPath;
      link.classList.toggle('active', active);
      link.classList.toggle('menu-active', active);
      if (active) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  function initShellInteractions() {
    const menuToggle = document.getElementById('sfMenuToggle');
    const sidebarClose = document.getElementById('sfSidebarClose');
    const collapseBtn = document.getElementById('sfCollapseBtn');
    const backdrop = document.getElementById('sfBackdrop');
    const sidebar = document.getElementById('sfSidebar');
    const body = document.body;

    if (!sidebar || body.dataset.appShellBound === 'true') return;
    body.dataset.appShellBound = 'true';

    const closeMobileNav = () => body.classList.remove('sf-mobile-nav-open');
    const openMobileNav = () => body.classList.add('sf-mobile-nav-open');

    if (menuToggle) {
      menuToggle.addEventListener('click', () => {
        if (window.innerWidth < 768) {
          body.classList.contains('sf-mobile-nav-open') ? closeMobileNav() : openMobileNav();
        }
      });
    }

    if (sidebarClose) {
      sidebarClose.addEventListener('click', closeMobileNav);
    }

    if (backdrop) {
      backdrop.addEventListener('click', closeMobileNav);
    }

    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        if (window.innerWidth >= 768) {
          body.classList.toggle('sf-sidebar-collapsed');
        }
      });
    }

    window.addEventListener('resize', () => {
      if (window.innerWidth >= 768) {
        closeMobileNav();
      }
    });

    markNavActive(sidebar);
    initParticles(document.getElementById('sidebarAnimatedBg'));

    requestAnimationFrame(() => {
      body.classList.add('sf-stage-1-ready');
      setTimeout(() => body.classList.add('sf-stage-2-ready'), 80);
      setTimeout(() => body.classList.add('sf-stage-3-ready'), 160);
    });
  }

  function applyTheme(theme) {
    const normalized = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', normalized);
    localStorage.setItem('sf-template-theme', normalized);
    document.querySelectorAll('[data-sf-theme-select]').forEach((select) => {
      select.value = normalized;
    });
  }

  function initThemeControls() {
    const savedTheme = localStorage.getItem('sf-template-theme') || document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(savedTheme);

    document.querySelectorAll('[data-sf-theme-select]').forEach((select) => {
      if (select.dataset.boundTheme === 'true') return;
      select.dataset.boundTheme = 'true';
      select.addEventListener('change', () => applyTheme(select.value));
    });
  }

  function buildNavItems(items) {
    return items.map((item) => `
      <li>
        <a class="sf-nav-item flex items-center gap-3 rounded-lg" href="${item.href}">
          <i class="material-icons">${item.icon}</i>
          <span class="sf-nav-text">${escapeHtml(item.label)}</span>
        </a>
      </li>
    `).join('');
  }

  function buildSidebarSections() {
    const primary = NAV_ITEMS.filter((item) => item.section === 'primary');
    const utility = NAV_ITEMS.filter((item) => item.section === 'utility');

    return `
      <li class="sf-menu-title"><span>Production</span></li>
      ${buildNavItems(primary)}
      <li class="sf-menu-title sf-menu-gap"><span>Utilities</span></li>
      ${buildNavItems(utility)}
    `;
  }

  function buildHero() {
    const config = HERO_CONFIG[normalizedPath];
    if (!config) return '';

    const chips = config.chips.map(([label, value]) => `
      <div>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `).join('');

    return `
      <section class="sf-page-hero sf-page-hero--${config.variant}">
        <div class="sf-page-hero-copy">
          <p class="sf-page-kicker">${escapeHtml(config.kicker)}</p>
          <h2>${escapeHtml(config.title)}</h2>
          <p>${escapeHtml(config.description)}</p>
        </div>
        <div class="sf-page-hero-chips">${chips}</div>
      </section>
    `;
  }

  function buildNotice() {
    const meta = PAGE_META[normalizedPath];
    if (!meta || !meta.notice) return '';

    const cta = meta.ctaHref && meta.ctaLabel
      ? `<a class="sf-btn sf-btn-primary sf-notice-cta" href="${meta.ctaHref}">
          <i class="material-icons">arrow_forward</i>
          ${escapeHtml(meta.ctaLabel)}
        </a>`
      : '';

    return `
      <section class="sf-page-notice ${meta.kind === 'legacy' ? 'is-legacy' : 'is-utility'}">
        <div>
          <p class="sf-page-notice-kicker">${meta.kind === 'legacy' ? 'Legacy Screen' : 'Utility Screen'}</p>
          <strong>${escapeHtml(meta.notice)}</strong>
        </div>
        ${cta}
      </section>
    `;
  }

  function transformLegacySubpage() {
    const wrapper = document.querySelector('.wrapper');
    const content = wrapper && wrapper.querySelector('.main-panel .content');
    if (!wrapper || !content || document.querySelector('.sf-shell')) return;

    document.body.classList.add('dashboard-v2', 'sf-subpage-v2');

    const titleText = (
      document.querySelector('.navbar .navbar-brand') ||
      document.querySelector('title')
    );
    const pageTitle = titleText ? titleText.textContent.trim() : 'Smart Factory';
    const pageKind = (PAGE_META[normalizedPath] && PAGE_META[normalizedPath].kind) || 'primary';
    const pageSubtitle = pageKind === 'legacy'
      ? 'Legacy operations surface'
      : pageKind === 'utility'
        ? 'Utility and support tools'
        : 'Operations workspace';

    const innerContent = content.innerHTML;
    const shellMarkup = `
      <div class="sf-shell sf-template-shell min-h-screen flex flex-col bg-base-100 text-base-content">
        <header class="sf-topbar sf-template-headerbar navbar bg-base-200 px-4 border-b border-base-300">
          <div class="sf-template-header-left flex-none flex items-center gap-2">
            <button class="sf-icon-btn btn btn-ghost btn-sm btn-square" id="sfMenuToggle" type="button" aria-label="Open navigation">
              <i class="material-icons">menu</i>
            </button>
            <a href="/index.html" class="sf-template-logo-link flex items-center gap-2">
              <img src="/assets/img/matrix.png" alt="Matrix Logo" class="h-8 w-auto" />
              <span class="sf-brand-mark"><i class="material-icons">factory</i></span>
              <span class="sf-brand-text">Smart Factory</span>
            </a>
          </div>
          <div class="sf-template-header-center flex-1 flex justify-center">
            <span class="sf-template-shell-title">Smart Factory 2</span>
          </div>
          <div class="sf-template-header-right flex-none flex items-center gap-4">
            <label class="sf-theme-wrap label cursor-pointer gap-2">
              <span>Theme</span>
              <select class="sf-theme-select select select-bordered select-sm" data-sf-theme-select>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <a class="sf-btn sf-btn-ghost btn btn-outline btn-sm" href="/index.html">
              <i class="material-icons">dashboard</i>
              Dashboard
            </a>
          </div>
        </header>

        <div class="sf-template-body flex flex-1 bg-base-100 relative">
          <div class="sf-backdrop fixed inset-0 bg-black/50 z-40 hidden transition-opacity duration-300 md:hidden" id="sfBackdrop"></div>

          <aside class="sf-sidebar sf-template-sidebar fixed md:static inset-y-0 left-0 z-50 w-72 border-r border-base-300 bg-base-200 transition-all duration-300 ease-in-out transform -translate-x-full md:translate-x-0 md:block flex flex-col overflow-hidden" id="sfSidebar">
            <div class="sf-template-sidebar-head flex items-start justify-between gap-3 p-4 border-b border-base-300 flex-shrink-0">
              <div>
                <p class="sf-template-sidebar-kicker">Workspace</p>
                <strong>${pageKind === 'primary' ? 'Production Pages' : pageKind === 'legacy' ? 'Legacy Access' : 'Utility Pages'}</strong>
              </div>
              <div class="sf-template-sidebar-actions flex items-center gap-2">
                <button class="sf-icon-btn sf-mobile-only btn btn-ghost btn-sm btn-square md:hidden" id="sfSidebarClose" type="button" aria-label="Close navigation">
                  <i class="material-icons">close</i>
                </button>
                <button class="sf-icon-btn sf-desktop-only btn btn-ghost btn-sm btn-square hidden md:inline-flex" id="sfCollapseBtn" type="button" aria-label="Toggle sidebar width">
                  <i class="material-icons">left_panel_open</i>
                </button>
              </div>
            </div>
            <nav class="sf-nav sf-template-nav flex-1 overflow-y-auto overscroll-contain p-4" aria-label="Primary navigation">
              <ul class="sf-template-menu menu gap-1" id="sidebar-menu">
                ${buildSidebarSections()}
              </ul>
            </nav>
            <div class="sf-template-sidebar-foot">
              <div class="sf-sidebar-meta-chip">
                <span>UI</span>
                <strong>Matrix</strong>
              </div>
              <div class="sf-sidebar-meta-chip">
                <span>Mode</span>
                <strong>${pageKind === 'primary' ? 'Production' : pageKind === 'legacy' ? 'Legacy' : 'Utility'}</strong>
              </div>
            </div>
          </aside>

          <div class="sf-main">
            <div class="sf-template-pagehead">
              <div class="sf-topbar-title-wrap">
                <p class="sf-eyebrow">${escapeHtml(pageSubtitle)}</p>
                <h1 class="sf-topbar-title">${escapeHtml(pageTitle)}</h1>
              </div>
              <div class="sf-pagehead-chip-row">
                <span class="sf-pagehead-chip">${pageKind === 'primary' ? 'Live Operations' : pageKind === 'legacy' ? 'Legacy Access' : 'Support Tool'}</span>
                <span class="sf-pagehead-chip">${escapeHtml(pageTitle)}</span>
              </div>
            </div>

            <main class="sf-content">
            ${buildHero()}
            ${buildNotice()}
            <div class="sf-page-content">${innerContent}</div>
            </main>
          </div>
        </div>

        <footer class="sf-footer-meta sf-template-footer footer footer-center p-4 bg-base-200 text-base-content border-t border-base-300">
          <span>Matrix TSL ${new Date().getFullYear()}</span>
          <a href="/index.html">Return to dashboard</a>
        </footer>
      </div>
    `;

    wrapper.outerHTML = shellMarkup;
  }

  function upgradeCommonContent() {
    const pageContent = document.querySelector('.sf-page-content');
    if (!pageContent) return;

    pageContent.querySelectorAll('.card').forEach((card) => {
      card.classList.add('sf-template-card');
      card.classList.add('card', 'bg-base-100', 'shadow-sm', 'border', 'border-base-300');
    });

    pageContent.querySelectorAll('pre, code').forEach((block) => {
      block.classList.add('sf-template-code');
    });

    pageContent.querySelectorAll('details').forEach((details) => {
      details.classList.add('sf-template-details');
    });

    pageContent.querySelectorAll('table').forEach((table) => {
      table.classList.add('sf-template-table');
      table.classList.add('table', 'table-zebra');
    });

    pageContent.querySelectorAll('.btn, button').forEach((button) => {
      button.classList.add('sf-template-btn');
      button.classList.add('btn', 'btn-sm');
    });

    pageContent.querySelectorAll('.form-group').forEach((group) => {
      group.classList.add('sf-template-field');
    });

    pageContent.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="range"])').forEach((input) => {
      input.classList.add('input', 'input-bordered', 'w-full');
    });

    pageContent.querySelectorAll('select').forEach((select) => {
      select.classList.add('select', 'select-bordered', 'w-full');
    });

    pageContent.querySelectorAll('textarea').forEach((textarea) => {
      textarea.classList.add('textarea', 'textarea-bordered', 'w-full');
    });

    pageContent.querySelectorAll('.alert').forEach((alert) => {
      alert.classList.add('rounded-box');
    });

    pageContent.querySelectorAll('.badge, .badge-pill, .status-badge').forEach((badge) => {
      badge.classList.add('badge');
    });

    pageContent.querySelectorAll('.list-group').forEach((list) => {
      list.classList.add('rounded-box', 'border', 'border-base-300', 'overflow-hidden');
    });

    pageContent.querySelectorAll('.list-group-item').forEach((item) => {
      item.classList.add('bg-base-100');
    });

    pageContent.querySelectorAll('.card-body > .row').forEach((row) => {
      row.classList.add('sf-inner-grid');
    });
  }

  function normalizeLegacyLayout() {
    const pageContent = document.querySelector('.sf-page-content');
    if (!pageContent) return;

    pageContent.querySelectorAll('.container-fluid').forEach((container) => {
      container.classList.add('sf-template-container');
    });

    pageContent.querySelectorAll('.row').forEach((row) => {
      row.classList.add('sf-template-row');
      const directCols = Array.from(row.children).filter((child) => /(^|\s)col[-\w]*/.test(child.className));
      const colCount = Math.max(1, directCols.length);
      row.dataset.sfCols = String(Math.min(colCount, 4));
      directCols.forEach((col) => col.classList.add('sf-template-col'));
    });

    pageContent.querySelectorAll('.card-header').forEach((header) => {
      header.classList.add('sf-template-header');
      Array.from(header.classList)
        .filter((cls) => cls.startsWith('card-header-'))
        .forEach((cls) => header.classList.remove(cls));

      const icon = header.querySelector('.card-icon');
      if (icon) {
        header.classList.add('has-template-icon');
      }
    });

    pageContent.querySelectorAll('.card-body').forEach((body) => body.classList.add('sf-template-body'));
    pageContent.querySelectorAll('.card-footer').forEach((footer) => footer.classList.add('sf-template-footer'));
    pageContent.querySelectorAll('.table-responsive').forEach((wrap) => wrap.classList.add('sf-template-table-wrap'));

    pageContent.querySelectorAll('.btn').forEach((button) => {
      if (button.classList.contains('btn-primary')) button.dataset.sfVariant = 'primary';
      else if (button.classList.contains('btn-success')) button.dataset.sfVariant = 'success';
      else if (button.classList.contains('btn-danger') || button.classList.contains('btn-error')) button.dataset.sfVariant = 'danger';
      else if (button.classList.contains('btn-warning')) button.dataset.sfVariant = 'warning';
      else if (button.classList.contains('btn-info')) button.dataset.sfVariant = 'info';
      else if (button.classList.contains('btn-outline')) button.dataset.sfVariant = 'outline';
      else button.dataset.sfVariant = button.dataset.sfVariant || 'neutral';
    });

    pageContent.querySelectorAll('.status-panel, .controls, .camera-viewer, .conveyor-container, .chart-container, .panel, .stat-card, .stat-box').forEach((block) => {
      block.classList.add('sf-surface-block');
      block.classList.add('rounded-box', 'border', 'border-base-300', 'bg-base-100');
    });

    pageContent.querySelectorAll('.status-row').forEach((row) => {
      row.classList.add('sf-status-row');
    });

    pageContent.querySelectorAll('.status-label').forEach((label) => {
      label.classList.add('sf-status-label');
    });

    pageContent.querySelectorAll('.status-value').forEach((value) => {
      value.classList.add('sf-status-value');
    });

    pageContent.querySelectorAll('.controls').forEach((controls) => {
      controls.classList.add('sf-action-row');
    });

    pageContent.querySelectorAll('thead.text-primary').forEach((head) => {
      head.classList.add('sf-table-head');
    });
  }

  function enhanceRobotPage() {
    const rows = Array.from(document.querySelectorAll('.sf-page-content .container-fluid > .row'));
    if (rows[0]) rows[0].classList.add('sf-robot-status-row');
    if (rows[1]) rows[1].classList.add('sf-robot-position-row');
    if (rows[2]) rows[2].classList.add('sf-robot-control-row');
    if (rows[3]) rows[3].classList.add('sf-robot-tool-row');
    rows.forEach((row) => row.classList.add('gap-4'));

    const controlCards = rows[2] ? Array.from(rows[2].querySelectorAll('.card')) : [];
    if (controlCards[0]) controlCards[0].classList.add('sf-robot-bits-card');
    if (controlCards[1]) controlCards[1].classList.add('sf-robot-manual-card');
    if (controlCards[2]) controlCards[2].classList.add('sf-robot-quick-card');

    const toolCards = rows[3] ? Array.from(rows[3].querySelectorAll('.card')) : [];
    if (toolCards[0]) toolCards[0].classList.add('sf-robot-effector-card');
    if (toolCards[1]) toolCards[1].classList.add('sf-robot-system-card');

    document.querySelectorAll('.sf-robot-status-row .card').forEach((card) => {
      card.classList.add('sf-stat-card', 'sf-card-accent-primary', 'bg-base-100', 'shadow-sm');
    });
    document.querySelectorAll('.sf-robot-position-row .card').forEach((card) => {
      card.classList.add('sf-data-card', 'sf-card-accent-info', 'bg-base-100', 'shadow-sm');
    });
    document.querySelectorAll('.sf-robot-control-row .card').forEach((card) => {
      card.classList.add('sf-action-card', 'sf-card-accent-warning', 'bg-base-100', 'shadow-sm');
    });
    document.querySelectorAll('.sf-page-robot .card:has(#debugLog), .sf-page-robot .card:has(#settingsModal)').forEach((card) => {
      card.classList.add('sf-card-accent-danger');
    });
    document.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.classList.add('sf-action-btn-block', 'w-full', 'justify-start');
    });
    document.querySelectorAll('#manualX, #manualY, #manualZ, #manualR').forEach((input) => input.classList.add('sf-robot-input'));
    document.querySelectorAll('.sf-robot-status-row .card-title, .sf-robot-position-row .card-title').forEach((title) => {
      title.classList.add('text-2xl', 'font-bold');
    });
    document.querySelectorAll('.sf-robot-control-row .table td:last-child').forEach((cell) => {
      cell.classList.add('font-semibold');
    });
    document.querySelectorAll('.sf-page-robot .card-category').forEach((text) => {
      text.classList.add('text-sm', 'text-base-content/60');
    });
    document.querySelectorAll('.sf-page-robot .card-body h5').forEach((heading) => {
      heading.classList.add('text-sm', 'font-semibold', 'uppercase', 'tracking-wide');
    });
    document.querySelectorAll('.sf-page-robot .card-header .card-title').forEach((title) => {
      title.classList.add('text-lg', 'font-semibold');
    });
    document.querySelectorAll('.sf-page-robot .btn-block').forEach((button) => {
      button.classList.add('w-full');
    });
    document.querySelectorAll('.sf-page-robot .settings-input').forEach((input) => {
      input.classList.add('input', 'input-bordered', 'w-full');
    });
    document.querySelectorAll('.sf-page-robot .settings-actions .btn').forEach((button) => {
      button.classList.add('btn', 'btn-sm');
    });
    document.querySelectorAll('.sf-page-robot .settings-grid-4, .sf-page-robot .settings-grid-2').forEach((grid) => {
      grid.classList.add('gap-3');
    });
    document.querySelectorAll('.sf-page-robot .status-dot').forEach((dot) => {
      dot.classList.add('sf-status-indicator');
    });
    document.querySelectorAll('.sf-page-robot .card-footer .stats').forEach((stats) => {
      stats.classList.add('sf-card-meta');
    });
    document.querySelectorAll('.sf-page-robot .form-group label').forEach((label) => {
      label.classList.add('sf-field-label');
    });
    document.querySelectorAll('.sf-page-robot #debugLog, .sf-page-robot .log-placeholder').forEach((entry) => {
      entry.classList.add('sf-template-code');
    });
    document.querySelectorAll('.sf-page-robot .card-body .row').forEach((row) => {
      row.classList.add('sf-metric-grid');
    });
    document.querySelectorAll('.sf-page-robot .form-group').forEach((group) => {
      group.classList.add('sf-stack-fields');
    });
    document.querySelectorAll('.sf-page-robot .preset-btn').forEach((button) => {
      button.classList.add('justify-start');
    });
    document.querySelectorAll('.sf-page-robot .preset-btn').forEach((button) => {
      button.parentElement && button.parentElement.classList.add('sf-action-stack');
    });
    document.querySelectorAll('.sf-page-robot .card-body > .row > [class*="col-"]').forEach((col) => {
      col.classList.add('sf-split-action');
    });
  }

  function enhanceVisionPage() {
    const rows = Array.from(document.querySelectorAll('.sf-page-content .container-fluid > .row'));
    if (rows[0]) rows[0].classList.add('sf-vision-status-row');
    if (rows[1]) rows[1].classList.add('sf-vision-actions-row');
    if (rows[2]) rows[2].classList.add('sf-vision-media-row');
    if (rows[3]) rows[3].classList.add('sf-vision-results-row');
    if (rows[5]) rows[5].classList.add('sf-vision-settings-row');

    rows.forEach((row) => row.classList.add('gap-4'));

    const mediaCards = rows[2] ? Array.from(rows[2].querySelectorAll('.card')) : [];
    if (mediaCards[0]) mediaCards[0].classList.add('sf-vision-camera-card');
    if (mediaCards[1]) mediaCards[1].classList.add('sf-vision-result-card');

    const actionCard = rows[1] && rows[1].querySelector('.card');
    if (actionCard) actionCard.classList.add('sf-vision-primary-action-card');

    document.querySelectorAll('.sf-vision-status-row .card').forEach((card) => {
      card.classList.add('sf-status-strip-card', 'sf-card-accent-info', 'bg-base-100', 'shadow-sm');
    });
    document.querySelectorAll('.sf-vision-status-row [id$="Card"]').forEach((item) => {
      item.classList.add('sf-inline-status-card', 'rounded-box', 'border', 'border-base-300', 'bg-base-100');
    });
    document.querySelectorAll('.sf-vision-actions-row .card').forEach((card) => {
      card.classList.add('sf-action-strip-card', 'bg-base-100', 'shadow-sm');
    });
    document.querySelectorAll('.sf-vision-media-row .card').forEach((card) => {
      card.classList.add('sf-media-card', 'sf-card-accent-primary', 'bg-base-100', 'shadow-sm');
    });
    document.querySelectorAll('.sf-vision-results-row .card').forEach((card) => {
      card.classList.add('sf-results-card', 'sf-card-accent-warning', 'bg-base-100', 'shadow-sm');
    });
    document.querySelectorAll('.sf-page-vision .card:has(#debugLog), .sf-page-vision .card:has(#settingsBody)').forEach((card) => {
      card.classList.add('sf-card-accent-success');
    });
    document.querySelectorAll('#settingsBody details').forEach((details) => {
      details.classList.add('sf-template-details', 'rounded-box', 'border', 'border-base-300', 'bg-base-100');
    });
    document.querySelectorAll('.sf-vision-actions-row .btn').forEach((button) => {
      button.classList.add('btn', 'btn-sm');
    });
    document.querySelectorAll('.sf-vision-media-row img').forEach((image) => {
      image.classList.add('rounded-box', 'border', 'border-base-300');
    });
    document.querySelectorAll('.sf-page-vision .card-category').forEach((text) => {
      text.classList.add('text-sm', 'text-base-content/60');
    });
    document.querySelectorAll('.sf-page-vision .card-title').forEach((title) => {
      title.classList.add('font-semibold');
    });
    document.querySelectorAll('.sf-page-vision .card-header .card-title').forEach((title) => {
      title.classList.add('text-lg');
    });
    document.querySelectorAll('.sf-page-vision #resultsContent').forEach((content) => {
      content.classList.add('text-sm', 'text-base-content/80');
    });
    document.querySelectorAll('.sf-page-vision #debugLog').forEach((log) => {
      log.classList.add('rounded-box', 'border', 'border-base-300', 'bg-base-100');
    });
    document.querySelectorAll('.sf-page-vision input[type="range"]').forEach((slider) => {
      slider.classList.add('range', 'range-primary');
    });
    document.querySelectorAll('.sf-page-vision .camera-viewer').forEach((viewer) => {
      viewer.classList.add('rounded-box', 'border', 'border-base-300', 'bg-base-100');
    });
    document.querySelectorAll('.sf-page-vision #oldButtons .btn').forEach((button) => {
      button.classList.add('btn', 'btn-sm');
    });
    document.querySelectorAll('.sf-page-vision [id$="Placeholder"]').forEach((placeholder) => {
      placeholder.classList.add('sf-vision-placeholder');
    });
    document.querySelectorAll('.sf-page-vision [id^="status"][id$="Card"]').forEach((card) => {
      card.classList.add('sf-kpi-card');
    });
    document.querySelectorAll('.sf-page-vision .card-body > div[style*="display: grid"]').forEach((grid) => {
      grid.classList.add('sf-status-kpi-grid');
    });
    document.querySelectorAll('.sf-page-vision summary').forEach((summary) => {
      summary.classList.add('sf-details-summary');
    });
    document.querySelectorAll('.sf-page-vision #debugSummary').forEach((summary) => {
      summary.classList.add('sf-inline-helper');
    });
    document.querySelectorAll('.sf-page-vision #settingsBody > div[style*="margin-bottom"]').forEach((block) => {
      block.classList.add('sf-panel-note');
    });
    document.querySelectorAll('.sf-page-vision #settingsBody > div[style*="display: flex"], .sf-page-vision #settingsBody > div[style*="display: grid"]').forEach((block) => {
      block.classList.add('sf-settings-layout-block');
    });
    document.querySelectorAll('.sf-page-vision #settingsBody h5').forEach((title) => {
      title.classList.add('sf-mini-title');
    });
    document.querySelectorAll('.sf-page-vision #settingsBody label').forEach((label) => {
      label.classList.add('sf-field-label');
    });
    applyVisionDynamicEnhancements();
  }

  function enhancePlcPage() {
    const firstCard = document.querySelector('.sf-page-content .container-fluid > .row .card');
    if (firstCard) firstCard.classList.add('sf-plc-admin-card');

    document.querySelectorAll('.db-map-panel').forEach((panel) => panel.classList.add('sf-plc-map-panel'));
    document.querySelectorAll('.db-map-controls').forEach((controls) => controls.classList.add('sf-plc-control-grid'));
    document.querySelectorAll('.db-map-actions').forEach((actions) => actions.classList.add('sf-plc-action-row'));
    document.querySelectorAll('.status-panel').forEach((panel) => panel.classList.add('sf-plc-status-panel'));
    document.querySelectorAll('.controls').forEach((controls) => controls.classList.add('sf-plc-quick-controls'));
    document.querySelectorAll('.db-map-panel input').forEach((input) => {
      input.classList.add('input', 'input-bordered', 'w-full');
    });
    document.querySelectorAll('.db-map-panel select').forEach((select) => {
      select.classList.add('select', 'select-bordered', 'w-full');
    });
    document.querySelectorAll('.db-map-actions .btn').forEach((button) => {
      button.classList.add('btn', 'btn-sm');
    });
    document.querySelectorAll('.btn-control').forEach((button) => {
      button.classList.add('btn', 'btn-sm', 'btn-outline');
    });
    document.querySelectorAll('.db-map-table thead, .db-map-table tbody').forEach((section) => {
      section.classList.add('sf-plc-table-section');
    });
    document.querySelectorAll('.stat-box').forEach((box) => {
      box.classList.add('rounded-box', 'border', 'border-base-300', 'bg-base-100');
    });
    const logPanel = document.getElementById('logPanel');
    if (logPanel) {
      logPanel.classList.add('rounded-box', 'border', 'border-base-300', 'bg-base-100');
    }
  }

  function enhanceRobotModal() {
    const modal = document.getElementById('settingsModal');
    const content = modal && modal.querySelector('.settings-content');
    if (!modal || !content) return;

    modal.classList.add('sf-matrix-modal');
    content.classList.add('card', 'bg-base-100', 'border', 'border-base-300', 'shadow-xl');

    content.querySelectorAll('.settings-group').forEach((group) => {
      group.classList.add('sf-matrix-settings-group');
    });

    content.querySelectorAll('.settings-input').forEach((input) => {
      if (input.tagName === 'SELECT') {
        input.classList.add('select', 'select-bordered', 'w-full');
      } else {
        input.classList.add('input', 'input-bordered', 'w-full');
      }
    });

    content.querySelectorAll('.settings-actions .btn').forEach((button) => {
      button.classList.add('btn', 'btn-sm');
    });
  }

  function enhanceVisionSettingsPanel() {
    const toggleButton = document.getElementById('settingsToggleBtn');
    if (toggleButton) {
      toggleButton.classList.add('btn', 'btn-ghost', 'w-full', 'justify-between');
    }

    const settingsBody = document.getElementById('settingsBody');
    if (settingsBody) {
      settingsBody.classList.add('space-y-4');
      settingsBody.querySelectorAll('input[type="hidden"] + div, div[style*="padding: 16px"], div[style*="padding: 12px"]').forEach((panel) => {
        panel.classList.add('sf-settings-panel');
      });
    }
  }

  function enhanceRfidPage() {
    const rows = Array.from(document.querySelectorAll('.sf-page-content .container-fluid > .row'));
    rows.forEach((row) => row.classList.add('gap-4'));

    const cards = Array.from(document.querySelectorAll('.sf-page-rfid .card'));
    cards.forEach((card, index) => {
      card.classList.add(index === 0 ? 'sf-rfid-hero-card' : 'sf-rfid-data-card');
    });

    document.querySelectorAll('.conveyor-container').forEach((container) => {
      container.classList.add('rounded-box', 'border', 'border-base-300', 'bg-base-100');
    });

    document.querySelectorAll('.status-badge').forEach((badge) => {
      badge.classList.add('badge');
    });

    document.querySelectorAll('.info-value-highlight').forEach((value) => {
      value.classList.add('font-semibold');
    });

    document.querySelectorAll('.sf-page-content .table-hover').forEach((table) => {
      table.classList.add('table-zebra');
    });
    document.querySelectorAll('.sf-page-rfid .card-header .card-title').forEach((title) => {
      title.classList.add('text-lg', 'font-semibold');
    });
    document.querySelectorAll('.sf-page-rfid .card-category').forEach((text) => {
      text.classList.add('text-sm', 'text-base-content/60');
    });
  }

  function enhanceIoLinkPage() {
    const rows = Array.from(document.querySelectorAll('.sf-page-content .container-fluid > .row'));
    rows.forEach((row) => row.classList.add('gap-4'));

    const heroCards = rows[0] ? Array.from(rows[0].querySelectorAll('.card')) : [];
    if (heroCards[0]) heroCards[0].classList.add('sf-iolink-device-card');
    if (heroCards[1]) heroCards[1].classList.add('sf-iolink-status-card');

    const trendCard = rows[2] && rows[2].querySelector('.card');
    if (trendCard) trendCard.classList.add('sf-iolink-trends-card');

    document.querySelectorAll('.status-panel').forEach((panel) => {
      panel.classList.add('rounded-box', 'border', 'border-base-300', 'bg-base-100');
    });
    document.querySelectorAll('.sf-page-iolink .card').forEach((card, index) => {
      card.classList.add(index < 2 ? 'sf-card-accent-info' : 'sf-card-accent-primary');
    });

    document.querySelectorAll('.status-panel .status-value').forEach((value) => {
      value.classList.add('sf-kpi-value');
    });

    document.querySelectorAll('.controls').forEach((controls) => {
      controls.classList.add('sf-iolink-controls');
    });

    document.querySelectorAll('.btn-control').forEach((button) => {
      button.classList.add('btn', 'btn-sm', 'btn-outline');
    });

    document.querySelectorAll('.chart-container').forEach((container) => {
      container.classList.add('rounded-box', 'border', 'border-base-300', 'bg-base-100');
    });
    document.querySelectorAll('#portDetailsContainer .port-detail-card').forEach((card) => {
      card.classList.add('rounded-box', 'border', 'border-base-300', 'bg-base-100');
    });
    document.querySelectorAll('#portTableBody tr').forEach((row) => {
      row.classList.add('sf-port-row');
    });
    document.querySelectorAll('.sf-page-iolink .card-header .card-title').forEach((title) => {
      title.classList.add('text-lg', 'font-semibold');
    });
    document.querySelectorAll('.sf-page-iolink .card-category').forEach((text) => {
      text.classList.add('text-sm', 'text-base-content/60');
    });
    document.querySelectorAll('.sf-page-iolink .chart-container h6').forEach((title) => {
      title.classList.add('sf-mini-title');
    });
    document.querySelectorAll('.sf-page-iolink .chart-container').forEach((container) => {
      container.classList.add('sf-chart-panel');
    });
    document.querySelectorAll('#supervisionTableBody, #softwareTableBody').forEach((body) => {
      body.classList.add('sf-stat-table');
    });

    const productImage = document.getElementById('productImage');
    if (productImage) {
      productImage.classList.add('rounded-box', 'border', 'border-base-300');
    }

    const productPlaceholder = document.getElementById('productImagePlaceholder');
    if (productPlaceholder) {
      productPlaceholder.classList.add('sf-vision-placeholder');
    }

    applyIoLinkDynamicEnhancements();
  }

  function applyRobotDynamicEnhancements() {
    const log = document.getElementById('debugLog');
    if (log) {
      log.classList.add('sf-template-code');
    }
  }

  function applyVisionDynamicEnhancements() {
    const resultsContent = document.getElementById('resultsContent');
    if (resultsContent) {
      resultsContent.querySelectorAll('table').forEach((table) => {
        table.classList.add('table', 'table-zebra');
      });
      resultsContent.querySelectorAll('tr').forEach((row) => {
        row.classList.add('sf-port-row');
      });
      resultsContent.querySelectorAll('pre, code').forEach((block) => {
        block.classList.add('sf-template-code');
      });
      resultsContent.querySelectorAll('h1, h2, h3, h4, h5, h6, strong').forEach((heading) => {
        heading.classList.add('sf-mini-title');
      });
      resultsContent.querySelectorAll('p, li, div').forEach((node) => {
        if (node.children.length === 0 && node.textContent.trim()) {
          node.classList.add('sf-result-line');
        }
      });
    }
  }

  function applyIoLinkDynamicEnhancements() {
    document.querySelectorAll('#portDetailsContainer > *').forEach((card) => {
      card.classList.add('port-detail-card', 'sf-dynamic-card', 'rounded-box', 'border', 'border-base-300', 'bg-base-100');
    });
    document.querySelectorAll('#portDetailsContainer code').forEach((code) => {
      code.classList.add('sf-template-code');
    });
    document.querySelectorAll('#portTableBody tr').forEach((row) => {
      row.classList.add('sf-port-row');
    });
    document.querySelectorAll('#supervisionTableBody tr, #softwareTableBody tr').forEach((row) => {
      row.classList.add('sf-port-row');
    });
    document.querySelectorAll('#portDetailsContainer p.text-center, #supervisionTableBody .text-center, #softwareTableBody .text-center').forEach((item) => {
      item.classList.add('sf-inline-helper');
    });
  }

  function applyPlcDynamicEnhancements() {
    document.querySelectorAll('#cameraDbEditorBody input').forEach((input) => {
      input.classList.add('input', 'input-bordered', 'input-sm', 'w-full');
    });
    document.querySelectorAll('#cameraDbEditorBody select').forEach((select) => {
      select.classList.add('select', 'select-bordered', 'select-sm', 'w-full');
    });
    document.querySelectorAll('#cameraDbEditorBody tr').forEach((row) => {
      row.classList.add('sf-port-row');
    });
  }

  function observeDynamicContent(selector, callback) {
    const target = document.querySelector(selector);
    if (!target || target.dataset.sfObserved === 'true') return;
    target.dataset.sfObserved = 'true';

    const observer = new MutationObserver(() => {
      callback();
    });

    observer.observe(target, { childList: true, subtree: true });
    callback();
  }

  function enhanceEdgePage() {
    const table = document.querySelector('.edge-stats-table');
    if (table) {
      table.classList.add('table', 'table-zebra');
    }

    document.querySelectorAll('.sf-page-edge .card').forEach((card, index) => {
      card.classList.add(index === 0 ? 'sf-edge-summary-card' : 'sf-edge-data-card');
    });

    const updated = document.getElementById('lastUpdated');
    if (updated) {
      updated.classList.add('text-sm', 'text-base-content/60');
    }

    const error = document.getElementById('errorMessage');
    if (error) {
      error.classList.add('text-sm');
    }
  }

  function enhanceHotspotPage() {
    document.querySelectorAll('.sf-page-hotspot .card').forEach((card, index) => {
      card.classList.add(index === 0 ? 'sf-hotspot-status-card' : 'sf-hotspot-help-card');
    });

    document.querySelectorAll('.list-group').forEach((list) => {
      list.classList.add('rounded-box', 'border', 'border-base-300', 'overflow-hidden');
    });

    document.querySelectorAll('.list-group-item').forEach((item) => {
      item.classList.add('bg-base-100', 'border-base-300');
    });

    document.querySelectorAll('.badge-pill').forEach((badge) => {
      badge.classList.add('badge');
    });

    const refreshButton = document.getElementById('refreshButton');
    if (refreshButton) {
      refreshButton.classList.add('btn', 'btn-primary', 'btn-sm');
    }
    document.querySelectorAll('.sf-page-hotspot ol').forEach((list) => {
      list.classList.add('list-decimal', 'list-inside', 'space-y-2');
    });
    document.querySelectorAll('.sf-page-hotspot .card-header .card-title').forEach((title) => {
      title.classList.add('text-lg', 'font-semibold');
    });
  }

  function enhanceColorVotingPage() {
    document.querySelectorAll('.sf-page-color-voting .card').forEach((card, index) => {
      card.classList.add(index === 0 ? 'sf-voting-main-card' : 'sf-voting-side-card');
    });

    document.querySelectorAll('.result-box').forEach((box) => {
      box.classList.add('rounded-box', 'border', 'shadow-sm');
    });

    document.querySelectorAll('.confidence-bar').forEach((bar) => {
      bar.classList.add('rounded-box', 'border', 'border-base-300', 'bg-base-100');
    });

    document.querySelectorAll('input[type="range"]').forEach((slider) => {
      slider.classList.add('range', 'range-primary');
    });
    const testButton = document.getElementById('testBtn');
    if (testButton) {
      testButton.classList.add('btn', 'btn-success');
    }
    document.querySelectorAll('.sf-page-color-voting .card-header .card-title').forEach((title) => {
      title.classList.add('text-lg', 'font-semibold');
    });
  }

  function enhanceLegacyVisionPage() {
    document.querySelectorAll('.sf-page-vision-legacy .panel').forEach((panel, index) => {
      panel.classList.add(index === 0 ? 'sf-legacy-primary-panel' : 'sf-legacy-secondary-panel');
    });

    document.querySelectorAll('.camera-controls .btn').forEach((button) => {
      button.classList.add('btn', 'btn-sm');
    });

    document.querySelectorAll('.panel').forEach((panel) => {
      panel.classList.add('rounded-box', 'border', 'border-base-300', 'bg-base-100');
    });

    document.querySelectorAll('input[type="range"]').forEach((slider) => {
      slider.classList.add('range', 'range-primary');
    });
    document.querySelectorAll('.sf-page-vision-legacy h4, .sf-page-vision-legacy h5').forEach((heading) => {
      heading.classList.add('sf-mini-title');
    });
  }

  function enhancePageContent() {
    normalizeLegacyLayout();
    upgradeCommonContent();

    if (normalizedPath === '/robot-arm.html') {
      document.body.classList.add('sf-page-robot');
      enhanceRobotPage();
      enhanceRobotModal();
      applyRobotDynamicEnhancements();
    } else if (normalizedPath === '/vision-system-new.html') {
      document.body.classList.add('sf-page-vision');
      enhanceVisionPage();
      enhanceVisionSettingsPanel();
      observeDynamicContent('#resultsContent', applyVisionDynamicEnhancements);
    } else if (normalizedPath === '/rfid.html') {
      document.body.classList.add('sf-page-rfid');
      enhanceRfidPage();
    } else if (normalizedPath === '/io-link.html') {
      document.body.classList.add('sf-page-iolink');
      enhanceIoLinkPage();
      observeDynamicContent('#portDetailsContainer', applyIoLinkDynamicEnhancements);
      observeDynamicContent('#portTableBody', applyIoLinkDynamicEnhancements);
      observeDynamicContent('#supervisionTableBody', applyIoLinkDynamicEnhancements);
      observeDynamicContent('#softwareTableBody', applyIoLinkDynamicEnhancements);
    } else if (normalizedPath === '/edge-device-stats.html') {
      document.body.classList.add('sf-page-edge');
      enhanceEdgePage();
    } else if (normalizedPath === '/hotspot-status.html') {
      document.body.classList.add('sf-page-hotspot');
      enhanceHotspotPage();
    } else if (normalizedPath === '/color-voting-test.html') {
      document.body.classList.add('sf-page-color-voting');
      enhanceColorVotingPage();
    } else if (normalizedPath === '/vision-system.html') {
      document.body.classList.add('sf-page-vision-legacy');
      enhanceLegacyVisionPage();
    } else if (normalizedPath === '/plc-diagnostics.html') {
      document.body.classList.add('sf-page-plc');
      enhancePlcPage();
      observeDynamicContent('#cameraDbEditorBody', applyPlcDynamicEnhancements);
    }
  }

  function bootstrap() {
    ensureMatrixAssets();
    transformLegacySubpage();
    initThemeControls();
    initShellInteractions();
    enhancePageContent();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
