# Matrix Frontend Progress

## Goal

Make the Smart Factory app visually and structurally fit with the other Matrix apps while preserving the current backend routes and API payloads.

## Current State

### Completed

- `ui-template/` has been kept as the source template folder.
- The real compiled Matrix stylesheet has been copied into the live app at:
  - [matrix-ui-template.css](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/assets/css/matrix-ui-template.css)
- The Matrix logo has been copied into the live app at:
  - [matrix.png](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/assets/img/matrix.png)
- Shared shell migration is in progress via:
  - [app-shell.js](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/assets/js/app-shell.js)
- Dashboard shell has been aligned to the Matrix-style header, sidebar, and footer in:
  - [index.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/index.html)
- The dashboard home page no longer loads the Material Dashboard CSS/JS stack and now runs on the Matrix shell plus native dashboard script only:
  - [index.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/index.html)
- The dashboard home page has started converging on template-native Daisy component markup too, with the hero chips now rebuilt on `stat` blocks and the KPI/actions/alerts/quality sections now using Daisy-flavoured cards, tabs, alerts, and stat panels while keeping the same bindings and action handlers:
  - [index.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/index.html)
- A page-by-page migration tracker now exists in:
  - [MATRIX_PAGE_MIGRATION_PLAN.md](C:/Users/HamedA/Documents/sf2/Documentation/MATRIX_PAGE_MIGRATION_PLAN.md)
- `robot-arm.html` now has a real Matrix-native body layout for its main live controls in:
  - [robot-arm.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/robot-arm.html)
- `vision-system-new.html` now also has a real Matrix-native shell and main page sections for status, actions, media, results, debug, and the settings container in:
  - [vision-system-new.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/vision-system-new.html)
- `robot-arm.html`, `rfid.html`, `io-link.html`, `edge-device-stats.html`, `hotspot-status.html`, `color-voting-test.html`, and `vision-system.html` no longer load the old Material Dashboard CSS/JS stack or the `dark-edition` body treatment:
  - [robot-arm.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/robot-arm.html)
  - [rfid.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/rfid.html)
  - [io-link.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/io-link.html)
  - [edge-device-stats.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/edge-device-stats.html)
  - [hotspot-status.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/hotspot-status.html)
  - [color-voting-test.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/color-voting-test.html)
  - [vision-system.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/vision-system.html)
- `io-link.html` now also has real Matrix-native sections for the page hero, device identity, master status, polling actions, tables, trends, and port details container in:
  - [io-link.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/io-link.html)
- `plc-diagnostics.html` now also has a native Matrix page hero and cleaner engineering section layout around the DB editors, live status, controls, stats, and activity log in:
  - [plc-diagnostics.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/plc-diagnostics.html)
- `edge-device-stats.html` now also has a Matrix-native hero and telemetry panel layout in:
  - [edge-device-stats.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/edge-device-stats.html)
- `rfid.html` now also has a Matrix-native hero and cleaner data-table layout in:
  - [rfid.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/rfid.html)
- `hotspot-status.html` now also has a Matrix-native hero, cleaner utility layout, and Matrix-native status summary/table badges in:
  - [hotspot-status.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/hotspot-status.html)
- `color-voting-test.html` now also has a Matrix-native hero and cleaner utility/test controls layout in:
  - [color-voting-test.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/color-voting-test.html)
- `vision-system.html` now also sits inside the real Matrix shell with native page framing, while still retaining its legacy inner content in:
  - [vision-system.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/vision-system.html)
- Subpages now load a shared Matrix-style shell at runtime through:
  - [app-shell.js](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/assets/js/app-shell.js)
- Production and utility HTML pages are being updated to reference the live Matrix stylesheet directly, not only via runtime injection.

### In Progress

- Converting legacy page bodies so existing controls sit inside Matrix-style cards, forms, tables, and layout sections.
- Preserving all current IDs and button handlers while improving the body layout.
- Keeping user changes in [plc-diagnostics.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/plc-diagnostics.html) intact while continuing the migration.
- `vision-system-new.html` now runs without the old Material Dashboard CSS/JS stack and no longer depends on the `dark-edition` body treatment.
- `rfid.html` now initializes through `DOMContentLoaded` instead of a jQuery-ready wrapper, which keeps its existing demo behavior while removing the last obvious hard jQuery dependency on that page.
- `vision-system-new.html` now routes cycle summaries, loading/errors, voting results, detection results, camera error placeholders, and most settings visibility containers through Matrix-native helper classes and theme tokens instead of legacy inline color blocks.
- `vision-system-new.html` is much closer to the finish line now; the remaining work is mainly browser polish plus a small amount of text/encoding cleanup in a few retained legacy strings.
- `io-link.html` now renders active port detail internals through Matrix-native cards, metric blocks, and badge rows, though a final browser polish pass is still needed.
- `plc-diagnostics.html` now has Matrix-native DB editor row rendering and action controls, though a final browser polish pass is still needed on the diagnostics/editor internals.
- `vision-system.html` is no longer an untouched wrapper-based page, but it still retains the largest block of legacy inner markup and needs either a deeper rebuild or formal retirement.
- The robot settings modal is now being brought into the Matrix styling path without changing its IDs or save/restart behavior.
- Vision placeholders, debug surfaces, and the collapsed settings toggle are now being brought closer to the Matrix visual system.
- `plc-diagnostics.html` is now under active migration ownership, with DB123/DB124 editors, quick controls, stats, and log surfaces being brought into the Matrix styling path while preserving current mapping values and page behavior.
- `rfid.html`, `io-link.html`, and `edge-device-stats.html` are now under active body migration, with Matrix/Daisy classes being layered onto conveyors, tables, badges, control rows, charts, telemetry tables, and status surfaces.
- Utility and legacy pages are now also being pulled into the Matrix styling path, including hotspot status, color voting, and the retained legacy vision page.
- Additional interior polish is being applied to the largest holdout surfaces, especially IO-Link port detail cards, robot settings surfaces, and the retained legacy vision panels.
- Secondary headings, subcopy, and dense detail cards on the biggest pages are also being normalized so the interiors feel less like legacy Material panels and more like Matrix app screens.
- Common legacy UI pieces such as alerts, badges, list groups, status rows, and dense control/detail areas are now also being normalized into the Matrix visual system.
- Dynamic content that is rendered after page load is now also being pulled into the Matrix styling path, especially IO-Link port details/tables and the PLC camera DB editor rows.
- Shared Matrix hooks now cover more interior primitives such as code/debug blocks, field labels, KPI value emphasis, details summaries, inline helper notices, and nested metric grids on production pages.
- Major production pages now also receive section-level Matrix accents so status, media, controls, diagnostics, and settings read as distinct Matrix workspace panels rather than generic legacy cards.
- Repeated inner-body structures are now being normalized too, including stacked field groups, action stacks, note panels, mini section titles, and live-updated result/detail tables.
- The biggest production pages now also have section-aware treatment applied, so robot control groups, vision media/results panels, and IO-Link device/trend areas read more like purpose-built Matrix workspaces.
- Dense engineering/detail surfaces are continuing to move over as well, with stronger status label/value hierarchy, table header treatment, settings panels, and live result row normalization.
- Utility and support pages are now also receiving section-aware Matrix treatment, so RFID, edge stats, hotspot, color voting, and legacy vision sit closer to the same overall visual system.
- The shared Matrix shell is continuing to tighten too, with stronger pagehead chips, sidebar metadata panels, and clearer navigation text hierarchy so the whole app reads more like a single Matrix product.

### Not Done Yet

- Full page-by-page body rebuild into clean Matrix-native markup.
- Remove the remaining runtime body reshaping dependency from the pages that are still partial migrations.
- Remaining page-specific work is now mainly:
  - `vision-system-new.html` browser polish and minor text/encoding cleanup
  - `io-link.html` browser polish on dynamic port details
  - `plc-diagnostics.html` browser polish on diagnostics/editor internals
  - `hotspot-status.html` final text/encoding cleanup
  - `vision-system.html` rebuild or retirement decision
- Final browser QA of all production pages.
- Frontend folder reorganisation into a cleaner long-term structure.

## Live Frontend Source Of Truth

The live app frontend is here:

- [frontend](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend)

The template source is here:

- [ui-template](C:/Users/HamedA/Documents/sf2/ui-template)

## Working Rules

- Backend API contracts stay unchanged unless explicitly approved.
- `ui-template/` should remain a source/reference folder, not the live served app.
- User edits to page logic or mappings should be preserved.
- The next safest migration path is:
  1. finish shared shell parity
  2. migrate page bodies
  3. then reorganise the frontend structure
