# Frontend Structure

## Live App Frontend

The live HTML frontend for the app is here:

- [frontend](C:/Users/HamedA/Documents/sf2/app/frontend)

Main production pages:

- [index.html](C:/Users/HamedA/Documents/sf2/app/frontend/index.html)
- [robot-arm.html](C:/Users/HamedA/Documents/sf2/app/frontend/robot-arm.html)
- [vision-system-new.html](C:/Users/HamedA/Documents/sf2/app/frontend/vision-system-new.html)
- [rfid.html](C:/Users/HamedA/Documents/sf2/app/frontend/rfid.html)
- [plc-diagnostics.html](C:/Users/HamedA/Documents/sf2/app/frontend/plc-diagnostics.html)
- [io-link.html](C:/Users/HamedA/Documents/sf2/app/frontend/io-link.html)
- [edge-device-stats.html](C:/Users/HamedA/Documents/sf2/app/frontend/edge-device-stats.html)

Secondary and legacy pages:

- [hotspot-status.html](C:/Users/HamedA/Documents/sf2/app/frontend/hotspot-status.html)
- [color-voting-test.html](C:/Users/HamedA/Documents/sf2/app/frontend/color-voting-test.html)
- [vision-system.html](C:/Users/HamedA/Documents/sf2/app/frontend/vision-system.html)

Shared frontend assets:

- [assets/js](C:/Users/HamedA/Documents/sf2/app/frontend/assets/js)
- [assets/css](C:/Users/HamedA/Documents/sf2/app/frontend/assets/css)

## Template Source

The boss template source is separate and should stay untouched:

- [ui-template](C:/Users/HamedA/Documents/sf2/ui-template)

That folder is a Vite + Tailwind + DaisyUI source project. It is not the live frontend served by Flask today.

## Current Integration Direction

The current plan is:

1. keep `ui-template/` unchanged
2. adopt its shell and component patterns in `app/frontend`
3. move app controls and text from existing pages into template-style layouts
4. keep backend routes and API contracts unchanged
