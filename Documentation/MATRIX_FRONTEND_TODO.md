# Matrix Frontend Todo

## Goal

Finish the Smart Factory frontend migration so the app genuinely fits with other Matrix apps, while preserving the current backend routes and frontend behavior.

## Current Reality

- Shared Matrix shell is in place.
- Matrix assets are in the live app.
- Most pages now have real Matrix page-level structure in live markup.
- The main remaining work is deeper cleanup inside partial pages plus the legacy `vision-system.html` holdout.

## Priority 1: Main Production Pages

- [x] Rebuild [robot-arm.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/robot-arm.html) into Matrix-native body markup.
- [ ] Finish the remaining nested settings/help cleanup in [vision-system-new.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/vision-system-new.html).
- [ ] Finish the remaining dynamic port-detail cleanup in [io-link.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/io-link.html).

## Priority 2: Remaining Production/Support Pages

- [x] Rebuild [rfid.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/rfid.html) into Matrix-native page structure.
- [ ] Finish the DB editor/internal cleanup in [plc-diagnostics.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/plc-diagnostics.html) while preserving DB editor values and behavior.
- [x] Rebuild [edge-device-stats.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/edge-device-stats.html) into Matrix-native page structure.
- [ ] Finish the final text/encoding cleanup in [hotspot-status.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/hotspot-status.html).

## Priority 3: Utility and Legacy Pages

- [x] Rebuild [color-voting-test.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/color-voting-test.html) into Matrix-native page structure.
- [ ] Rebuild [vision-system.html](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/vision-system.html) into Matrix-native body markup or formally retire it.

## Shared Frontend Work

- [ ] Extract repeated page sections into reusable shared frontend patterns.
- [ ] Reduce reliance on runtime DOM reshaping in [app-shell.js](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/assets/js/app-shell.js).
- [ ] Remove styling rules in [professional-theme.css](C:/Users/HamedA/Documents/sf2/pwa-dobot-plc/frontend/assets/css/professional-theme.css) that only exist to prop up old Material-style markup.
- [ ] Replace inline page styles with shared Matrix-compatible classes where possible.
- [ ] Keep `ui-template/` untouched as the source/reference template folder.

## What Is Left

- [ ] Finish `vision-system-new.html` nested settings/help internals.
- [ ] Finish `io-link.html` dynamic detail internals.
- [ ] Finish `plc-diagnostics.html` DB editor internals.
- [ ] Finish `hotspot-status.html` text/encoding cleanup.
- [ ] Rebuild deeper `vision-system.html` internals or retire the page.
- [ ] Run browser QA and regression checks.

## Verification

- [ ] Browser-test all primary pages on the Pi.
- [ ] Verify all main controls still work.
- [ ] Robot actions and status.
- [ ] Vision live status, camera feed, ROI/crop controls, and analysis flows.
- [ ] PLC diagnostics DB editor save/update flows.
- [ ] IO-Link polling, tables, and port detail rendering.
- [ ] Edge stats polling.
- [ ] Hotspot status polling.
- [ ] Compare the visual result against the other Matrix apps and close any obvious gaps.

## Cleanup

- [ ] Reorganize the frontend structure once the page rewrites are complete.
- [ ] Keep [MATRIX_FRONTEND_PROGRESS.md](C:/Users/HamedA/Documents/sf2/Documentation/MATRIX_FRONTEND_PROGRESS.md) updated as items are closed.
- [ ] Remove obsolete compatibility code once Matrix-native markup is in place.
