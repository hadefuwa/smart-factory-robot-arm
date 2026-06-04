# Matrix Page Migration Plan

## Goal

Track the frontend migration page by page so it is clear which screens are truly rebuilt into Matrix-native markup and which still rely on legacy body structures or runtime reshaping.

## Status Key

- `Complete`: shared shell and main page body are rebuilt in live app markup.
- `Partial`: shell is migrated, but the page body still depends on legacy structures or runtime normalization.
- `Legacy`: page is retained for compatibility and is not yet fully rebuilt.

## Page Plan

### `index.html`

- Status: `Complete`
- Shared shell is live in page markup.
- Dashboard body is already Matrix-native.
- Continue browser QA and trim any compatibility-only styles later.

### `robot-arm.html`

- Status: `Complete`
- Shared shell is live in page markup.
- Body has been rebuilt around Matrix-native sections for status, position, manual control, quick actions, tool control, system management, and debug log.
- Existing IDs, handlers, and settings modal behavior are preserved.

### `vision-system-new.html`

- Status: `Partial`
- Keep as the primary production vision page.
- Shared shell plus live status, action, media, result, debug, and top-level settings sections are now rebuilt in native Matrix markup.
- The settings internals have had a second pass on the ROI, crop, and manual-parameter panels, but nested helper/instruction content is still not fully normalized.
- Remove dependence on runtime DOM reshaping for the page body while preserving current capture, ROI, crop, analysis, and PLC-trigger flows.

### `rfid.html`

- Status: `Partial`
- Keep current conveyor, tag, and metadata workflow.
- The page now has native Matrix hero and page-section structure.
- The content is still largely simulated/demo-style data, but the live page layout is now aligned to the Matrix shell.
- Remove remaining legacy card/table scaffolding from the live markup.

### `plc-diagnostics.html`

- Status: `Partial`
- Preserve DB123/DB124 editors, save flows, quick controls, and diagnostics behavior.
- The dense admin body now has native Matrix page-level structure around the editors, status panel, controls, stats, and log.
- The DB editor internals now render through Matrix-native row inputs, badges, and preview chips instead of legacy inline-heavy fragments.
- A final browser polish pass is still needed on the diagnostics/editor internals.
- Keep current mapping values and field IDs unchanged.

### `io-link.html`

- Status: `Partial`
- Preserve polling, port detail rendering, charts, and supervision/software tables.
- Main body sections are now rebuilt into native Matrix device, trend, and diagnostics panels.
- Active port detail internals now render through Matrix-native cards and badges instead of legacy row-heavy fragments.
- A final browser polish pass is still needed on the generated detail surfaces.
- Reduce dynamic class patching for generated content once the base markup is native.

### `edge-device-stats.html`

- Status: `Partial`
- Keep `/api/edge-device-stats` polling unchanged.
- The page now has native Matrix hero and telemetry-panel structure.
- A second pass can still replace the remaining custom table styling with shared page-level patterns if needed.

### `hotspot-status.html`

- Status: `Partial`
- Keep `/api/hotspot/status` behavior unchanged.
- The page now has native Matrix hero and utility-panel structure.
- The service-status table, badges, and summary alerts are now largely normalized to Matrix-native utility markup.
- A small final cleanup pass is still needed for leftover text/encoding polish.

### `color-voting-test.html`

- Status: `Partial`
- Keep available as an engineering utility, not a primary production screen.
- The page now has native Matrix hero and cleaner test-control structure.
- Result internals still use custom utility markup, but the live page layout is now aligned to the Matrix shell.

### `vision-system.html`

- Status: `Legacy`
- Retain for compatibility while `vision-system-new.html` remains the production target.
- The page now sits inside the Matrix shell and page framing.
- It is still the largest remaining legacy-inner-markup holdout.
- Either rebuild into native Matrix markup or formally retire after product approval.

## Shared Follow-Up

- Keep `ui-template/` untouched as the reference source.
- Avoid backend route or payload changes unless explicitly approved.
- Update this file and `MATRIX_FRONTEND_PROGRESS.md` whenever a page moves from `Partial` to `Complete`.
