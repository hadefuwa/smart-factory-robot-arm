"""Rewrite the topbar header and sidebar aside in every frontend page to one canonical block."""
from __future__ import annotations
import sys
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent / "pwa-dobot-plc" / "frontend"

CANONICAL_TOPBAR = '''<header class="sf-topbar sf-template-headerbar navbar bg-base-200 px-4 border-b border-base-300">
      <div class="sf-template-header-left flex-none flex items-center gap-2">
        <button class="sf-icon-btn btn btn-ghost btn-sm btn-square" id="sfMenuToggle" type="button" aria-label="Open navigation">
          <i class="material-icons">menu</i>
        </button>
        <a href="/index.html" class="sf-template-logo-link flex items-center gap-2">
          <img src="/assets/img/matrix2.png" alt="Matrix Logo" class="h-8 w-auto" />
          <span class="sf-brand-text">Smart Factory</span>
        </a>
      </div>
      <div class="sf-template-header-center flex-1 flex justify-center">
        <span class="sf-template-shell-title">Smart Factory 2</span>
      </div>
      <div class="sf-template-header-right flex-none flex items-center gap-4">
        <button class="sf-theme-toggle" type="button" data-sf-theme-toggle aria-label="Toggle theme" title="Toggle theme">
          <span class="sf-theme-toggle-icon-wrap">
            <i class="material-icons sf-theme-icon-sun">light_mode</i>
            <i class="material-icons sf-theme-icon-moon">dark_mode</i>
          </span>
        </button>
      </div>
    </header>'''

NAV_ITEMS = [
    ("primary", "/index.html", "dashboard", "Dashboard"),
    ("primary", "/robot-arm.html", "precision_manufacturing", "Robot Arm"),
    ("primary", "/vision-system-new.html", "visibility", "Vision System"),
    ("primary", "/rfid.html", "nfc", "RFID Tracking"),
    ("primary", "/plc-setup.html", "analytics", "PLC Setup"),
    ("primary", "/io-link.html", "settings_input_component", "IO-Link Master"),
    ("primary", "/edge-device-stats.html", "memory", "Edge Device Stats"),
    ("utility", "/hotspot-status.html", "wifi", "Hotspot Status"),
    ("utility", "/color-voting-test.html", "palette", "Color Voting Test"),
    ("utility", "/vision-system.html", "history", "Vision Legacy"),
]


def build_sidebar(active_href: str) -> str:
    primary_lines, utility_lines = [], []
    for section, href, icon, label in NAV_ITEMS:
        active_cls = " active" if href == active_href else ""
        line = (
            f'              <li><a class="sf-nav-item{active_cls} flex items-center gap-3 rounded-lg" href="{href}">'
            f'<i class="material-icons">{icon}</i>'
            f'<span class="sf-nav-text">{label}</span></a></li>'
        )
        (primary_lines if section == "primary" else utility_lines).append(line)
    primary_block = "\n".join(primary_lines)
    utility_block = "\n".join(utility_lines)

    return f'''<aside class="sf-sidebar sf-template-sidebar fixed md:static inset-y-0 left-0 z-50 w-72 border-r border-base-300 bg-base-200 transition-all duration-300 ease-in-out transform -translate-x-full md:translate-x-0 md:block flex flex-col overflow-hidden" id="sfSidebar">
        <div class="sf-template-sidebar-head flex items-start justify-between gap-3 p-4 border-b border-base-300 flex-shrink-0">
          <div>
            <p class="sf-template-sidebar-kicker">Workspace</p>
            <strong>Smart Factory</strong>
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
            <li class="sf-menu-title"><span>Production</span></li>
{primary_block}
            <li class="sf-menu-title sf-menu-gap"><span>Utilities</span></li>
{utility_block}
          </ul>
        </nav>
      </aside>'''


def replace_element(content: str, open_marker: str, close_tag: str, replacement: str, label: str) -> tuple[str, bool]:
    start = content.find(open_marker)
    if start == -1:
        print(f"  [skip] no {label}")
        return content, False
    end = content.find(close_tag, start)
    if end == -1:
        raise RuntimeError(f"unclosed {label}")
    end += len(close_tag)
    return content[:start] + replacement + content[end:], True


PAGES = {
    "color-voting-test.html": "/color-voting-test.html",
    "dobot.html": "",
    "edge-device-stats.html": "/edge-device-stats.html",
    "hotspot-status.html": "/hotspot-status.html",
    "index.html": "/index.html",
    "io-link.html": "/io-link.html",
    "plc-setup.html": "/plc-setup.html",
    "rfid.html": "/rfid.html",
    "robot-arm.html": "/robot-arm.html",
    "vision-system-new.html": "/vision-system-new.html",
    "vision-system.html": "/vision-system.html",
}

HEADER_OPEN = '<header class="sf-topbar sf-template-headerbar'
ASIDE_OPEN = '<aside class="sf-sidebar sf-template-sidebar'


def main() -> int:
    for filename, active_href in PAGES.items():
        path = FRONTEND / filename
        if not path.exists():
            print(f"{filename}: not found")
            continue
        print(f"{filename}:")
        text = path.read_text(encoding="utf-8")
        text, _ = replace_element(text, HEADER_OPEN, "</header>", CANONICAL_TOPBAR, "topbar")
        text, _ = replace_element(text, ASIDE_OPEN, "</aside>", build_sidebar(active_href), "sidebar")
        path.write_text(text, encoding="utf-8")
        print("  [ok] rewritten")
    return 0


if __name__ == "__main__":
    sys.exit(main())
