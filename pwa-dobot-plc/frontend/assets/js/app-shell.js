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

  function buildNav(items) {
    return items.map((item) => `
      <a class="sf-nav-item" href="${item.href}">
        <i class="material-icons">${item.icon}</i>
        <span>${escapeHtml(item.label)}</span>
      </a>
    `).join('');
  }

  function buildUtilityLinks() {
    const items = NAV_ITEMS.filter((item) => item.section === 'utility');
    return items.map((item) => `
      <a class="sf-utility-link" href="${item.href}">
        <i class="material-icons">${item.icon}</i>
        <span>${escapeHtml(item.label)}</span>
      </a>
    `).join('');
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
      <div class="sf-shell">
        <aside class="sf-sidebar" id="sfSidebar">
          <div class="sidebar-animated-bg" id="sidebarAnimatedBg"></div>
          <div class="sf-sidebar-brand">
            <button class="sf-icon-btn sf-mobile-only" id="sfSidebarClose" type="button" aria-label="Close navigation">
              <i class="material-icons">close</i>
            </button>
            <a href="/index.html" class="sf-brand-link">
              <span class="sf-brand-mark"><i class="material-icons">factory</i></span>
              <span class="sf-brand-text">Smart Factory</span>
            </a>
          </div>
          <nav class="sf-nav" aria-label="Primary navigation">
            ${buildNav(NAV_ITEMS.filter((item) => item.section === 'primary'))}
          </nav>
          <div class="sf-sidebar-footer">
            <div class="sf-sidebar-chip">
              <span>Workspace</span>
              <strong>${pageKind === 'primary' ? 'PRODUCTION' : pageKind.toUpperCase()}</strong>
            </div>
            <div class="sf-sidebar-chip">
              <span>Tools</span>
              <strong>${pageKind === 'primary' ? 'SECONDARY' : 'VISIBLE'}</strong>
            </div>
            <div class="sf-utility-links">
              <p>Secondary Pages</p>
              ${buildUtilityLinks()}
            </div>
          </div>
        </aside>

        <div class="sf-backdrop" id="sfBackdrop"></div>

        <div class="sf-main">
          <header class="sf-topbar">
            <div class="sf-topbar-left">
              <button class="sf-icon-btn sf-mobile-only" id="sfMenuToggle" type="button" aria-label="Open navigation">
                <i class="material-icons">menu</i>
              </button>
              <button class="sf-icon-btn sf-desktop-only" id="sfCollapseBtn" type="button" aria-label="Toggle sidebar width">
                <i class="material-icons">left_panel_open</i>
              </button>
              <div class="sf-topbar-title-wrap">
                <p class="sf-eyebrow">${escapeHtml(pageSubtitle)}</p>
                <h1 class="sf-topbar-title">${escapeHtml(pageTitle)}</h1>
              </div>
            </div>
            <div class="sf-topbar-right">
              <a class="sf-btn sf-btn-ghost" href="/index.html">
                <i class="material-icons">dashboard</i>
                Dashboard
              </a>
            </div>
          </header>

          <main class="sf-content">
            ${buildHero()}
            ${buildNotice()}
            <div class="sf-page-content">${innerContent}</div>
            <footer class="sf-footer-meta">
              <span>&copy; ${new Date().getFullYear()} Smart Factory Control System</span>
              <a href="/index.html">Return to dashboard</a>
            </footer>
          </main>
        </div>
      </div>
    `;

    wrapper.outerHTML = shellMarkup;
  }

  function bootstrap() {
    transformLegacySubpage();
    initShellInteractions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
