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
- Subpages now load a shared Matrix-style shell at runtime through:
  - [app-shell.js](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/assets/js/app-shell.js)
- Production and utility HTML pages are being updated to reference the live Matrix stylesheet directly, not only via runtime injection.

### In Progress

- Converting legacy page bodies so existing controls sit inside Matrix-style cards, forms, tables, and layout sections.
- Preserving all current IDs and button handlers while improving the body layout.
- Keeping user changes in [plc-diagnostics.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/plc-diagnostics.html) intact while continuing the migration.
- `robot-arm.html` is now being migrated with Matrix/Daisy classes layered onto live controls, status cards, inputs, settings fields, and action buttons.
- `vision-system-new.html` is now being migrated with Matrix/Daisy classes layered onto status tiles, action rows, media cards, debug surfaces, settings details, and sliders.
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
