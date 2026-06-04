# Frontend Cleanup Plan

## Why This Feels Fragile

The backend is not the problem. The current stress comes from the frontend being tightly coupled to its own HTML structure:

- page logic is embedded directly inside HTML files
- many controls use inline `onclick` handlers
- lots of scripts depend on exact DOM ids and card structure
- styling, layout, and behavior are mixed together per page

That makes visual replacement risky, because changing markup can accidentally break working controls even when the backend is unchanged.

## What We Should Fix

We should turn the frontend into a safer multi-page system in phases:

1. Keep all existing backend routes and payloads unchanged.
2. Move page logic out of inline `<script>` blocks into dedicated JS files.
3. Preserve current DOM ids while refactoring page markup.
4. Replace old layout/theme structures with template-driven components incrementally.
5. Retire duplicated per-page sidebar/topbar logic in favor of the shared shell.

## Migration Order

### Phase 1: De-risk behavior

- Extract `robot-arm.html` logic into `frontend/assets/js/robot-arm-page.js`
- Extract `vision-system-new.html` logic into `frontend/assets/js/vision-system-new-page.js`
- Extract `plc-diagnostics.html` logic into `frontend/assets/js/plc-diagnostics-page.js`

Goal:
- page behavior survives markup changes because logic is no longer trapped inside the HTML file

### Phase 2: Normalize page structure

- replace legacy row/card wrappers with shared shell-compatible sections
- preserve IDs for controls, outputs, and status blocks
- remove page-specific duplicated navigation markup over time

Goal:
- each page can adopt the new template visually without breaking fetch handlers

### Phase 3: Final template pass

- rewrite page interiors into true shared component sections
- remove leftover Material-specific visual assumptions
- standardize utility pages separately from production pages

Goal:
- frontend becomes easier to maintain and future UI changes stop being risky

## Immediate Status

- Shared shell and template-style theme are already in place.
- `robot-arm.html` is the first page being converted from inline behavior to a dedicated JS module.

## Definition Of Done

A page is considered fully cleaned up when:

- layout uses the shared shell cleanly
- all main behavior lives in a dedicated page JS file
- there are no large inline script blocks left in the HTML page
- backend endpoints and payloads are unchanged
- primary controls still work against the existing backend
