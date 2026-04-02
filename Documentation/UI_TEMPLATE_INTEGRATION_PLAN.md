# UI Template Integration Plan

## Summary
Adopt the boss's `ui-template` as a design/component source, not as a live demo app. Keep the backend and all existing API routes unchanged, keep `ui-template/` untouched, and build a new multi-page frontend layer that recreates the current HTML pages using duplicated template-derived layouts/components.

## Key Changes
- Create a new app-facing frontend implementation separate from `ui-template/`.
- Do not serve the template's demo SPA, demo navigation, placeholder pages, stub connection logic, or sample content.
- Extract and duplicate only the template pieces we need into a shared frontend shell:
  - common sidebar/topbar shell
  - shared page header and hero blocks
  - KPI and status cards
  - action button groups
  - tables, forms, and chart wrappers
  - alert, toast, modal, and status-pill patterns
- Preserve the current backend contract:
  - no Flask route changes required
  - no API payload changes by default
  - current static-page serving model remains valid
- Standardize the current pages around one navigation model and one visual system so each page stops carrying its own sidebar/topbar copy.

## Page Plan
- `index.html`
  - Rebuild as the primary operations dashboard using the template shell plus KPI cards, quick actions, alerts, and chart/table sections.
  - Keep current dashboard actions wired to existing endpoints like robot home, pick/place, vision start, and PLC connect/read.
  - Use this page as the source of truth for the shared layout and navigation patterns.
- `robot-arm.html`
  - Rebuild on the shared shell using control-focused template sections.
  - Keep current live status cards, target/current position panels, jog/move controls, tool controls, settings, and emergency actions.
  - Favor template control cards and form groups, but preserve every current robot endpoint and validation flow.
- `vision-system-new.html`
  - Treat as the main production vision page.
  - Rebuild using the shared shell plus custom panels for live camera, annotated result, cycle status, ROI/crop controls, config editors, and debug/status areas.
  - Remove page-local styling that only exists to compensate for the old dashboard theme.
  - Keep all current vision/camera/PLC polling and actions intact.
- `rfid.html`
  - Rebuild as a lighter status/data page using template tables, information cards, and process-visualization sections.
  - Keep the conveyor/tag/product info layout concept, but restyle it to match the shared shell.
  - Confirm later whether it should remain demo/static or be wired to live backend data.
- `plc-diagnostics.html`
  - Rebuild using template table/form/admin-style sections.
  - Preserve the DB123/DB124 mapping editor, save flows, PLC start controls, and diagnostics-heavy content.
  - Use this page as the shared pattern for engineering/admin screens with denser forms and tables.
- `io-link.html`
  - Rebuild with the shared shell plus I/O/status/graphs/tables components from the template.
  - Preserve the product image, port cards, supervision history, refresh controls, and polling intervals.
  - Replace current bespoke chart containers with template-style chart wrappers where practical.
- `edge-device-stats.html`
  - Rebuild as a compact telemetry page using template KPI cards and a slim stats table.
  - Keep the same `/api/edge-device-stats` polling behavior.
- `hotspot-status.html`
  - Keep as a utility/support page rather than a primary nav destination.
  - Rebuild with the shared shell and simple status panels.
  - Preserve `/api/hotspot/status` behavior and clean up user-facing copy.
- `vision-system.html`
  - Treat as legacy.
  - Keep visual consistency if it still needs to exist, otherwise guide users toward `vision-system-new.html`.
- `color-voting-test.html`
  - Treat as a test/engineering utility, not a production page.
  - Keep it available while visually grouping it with the rest of the app.

## Public Interfaces / Types
- Backend APIs: no intentional changes.
- Frontend structure additions:
  - shared app shell and layout behavior
  - shared component styling for cards, tables, charts, actions, and status chips
  - per-page scripts continue to own their existing endpoint wiring
- Navigation contract:
  - primary production nav includes `index`, `robot-arm`, `vision-system-new`, `rfid`, `plc-diagnostics`, `io-link`, and `edge-device-stats`
  - utility and legacy pages remain secondary or hidden

## Test Plan
- Verify every current page route still loads through Flask static serving.
- Verify shared navigation works across rebuilt pages without serving any template demo page.
- Verify no duplicated template stub logic remains active:
  - no fake connection state
  - no sample charts/data
  - no template admin password/demo content
- Regression-test each page against its current backend endpoints:
  - dashboard actions
  - robot control actions
  - vision camera/ROI/config/actions
  - PLC diagnostics config save/read
  - IO-Link polling and detail views
  - edge stats polling
  - hotspot status polling
- Confirm mobile/sidebar behavior still works on the Raspberry Pi/browser target.
- Confirm PWA manifest/service-worker behavior still only covers the real app pages and not template-only assets/pages.

## Assumptions
- Use a multi-page build/integration approach instead of keeping the template SPA live.
- `ui-template/` remains untouched as the original source folder.
- All current HTML pages are in scope, with `vision-system.html` and `color-voting-test.html` treated as legacy/utility unless product needs change.
- The backend remains authoritative and unchanged; frontend work is presentation/integration only.
