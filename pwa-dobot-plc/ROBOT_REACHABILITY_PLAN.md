# Robot Reachability Plan

## Summary

Add a reachability and fallback-planning layer between PLC target XYZ input and robot motion so the app can:

- decide whether a PLC target is achievable before moving
- find the nearest reachable alternative when the exact target fails
- report back to the PLC whether the target was accepted exactly, adjusted, or rejected
- write the final commanded position back into DB125 so the PLC always knows what happened

This is handled entirely in the app — the PLC sends coordinates, the app is responsible for making them safe.

---

## Problem

The PLC sends arbitrary `target_x`, `target_y`, `target_z` values into DB125.

Inverse kinematics is working, so valid targets move correctly. The issue is that many XYZ coordinates fall outside the arm's reachable workspace. When that happens:

- the IK solver returns null and the move is silently dropped
- the PLC auto-move loop retries the same bad target every 100ms indefinitely
- the PLC has no feedback about what actually happened

The arm's reachable workspace is a roughly cylindrical shell:
- **Horizontal reach** (radial distance from the base): ~50mm to ~529mm
- **Height**: bounded by the URDF geometry
- The constraint is **radial**, not per-axis — `X=200, Y=150` gives `sqrt(200²+150²) = 250mm` horizontal, which is fine in isolation, but combined with a high Z it may push the TCP outside the reachable shell

This means searching Y-only or X-only in fixed steps does not model the constraint correctly. An incremental grid search is also too slow at 100ms polling (400 IK iterations per attempt × potentially 200 candidates = unacceptable).

---

## Goal

Build a planning layer that:

1. Pre-checks the PLC target analytically before calling IK
2. Projects or retreats the target to the nearest valid point if needed
3. Moves only when a valid point is confirmed
4. Writes the outcome back to the PLC (exact / adjusted / rejected)
5. Does not retry the same bad target on every poll cycle

---

## Fallback Strategy (Three Layers)

### Layer 1 — Analytic Workspace Projection (O(1), runs always)

Before calling IK, check the target analytically against the known workspace envelope:

- Compute `horizontal_reach = sqrt(x² + y²)`
- If `horizontal_reach > REACH_MAX`: scale the XY vector to `REACH_MAX`
- If `horizontal_reach < REACH_MIN`: scale the XY vector out to `REACH_MIN`
- If `z < Z_MIN`: clamp to `Z_MIN`
- If `z > Z_MAX`: clamp to `Z_MAX`

If the point was modified, the result is a candidate adjusted position — run IK on this projected point.

This handles the majority of failures (target too far, too close, out of height range) with no iteration.

### Layer 2 — Directional Retreat (max 8 IK calls, runs if Layer 1 IK still fails)

If the projected point still fails IK (singularity or complex geometry near workspace boundary), retreat along the straight line from the target toward a known-safe reference point (the arm's rest position, e.g. `x=300, y=0, z=260`):

```
candidate = target
for step in [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]:
    candidate = lerp(target, rest_position, step)
    if IK(candidate) succeeds → use this point, mark as adjusted
reject if all 8 steps fail
```

Maximum 8 IK calls. Finds the nearest achievable point along a physically meaningful path (toward a known-safe configuration) rather than an arbitrary grid direction.

### Layer 3 — Local Spiral Search (last resort, bounded)

Only runs if Layers 1 and 2 both fail (edge case: target is near the workspace boundary in a way that retreat overshoots into another unreachable zone).

Search candidates in expanding radius from the original target:
- Steps: 5, 10, 15, 20, 25, 30, 35, 40mm
- At each radius, try 8 angular directions (N/NE/E/SE/S/SW/W/NW in the XY plane), then ±step in Z
- Maximum 200 candidate checks total
- Use the candidate with the smallest 3D distance from the original target

This is the fallback the user originally described (±5mm increments) but structured directionally so it terminates quickly.

---

## Where the Planning Logic Lives

**In `server.js` (Node.js, Pi-side), not in the Python backend.**

Reasons:
- The IK solver (`kinematics.js`) already runs in Node.js
- Adding Python wrappers that call through the bridge adds a round-trip and a failure mode
- The `moveToXYZ` WebSocket handler is the right place — it already calls `robotKinematics.inverseKinematics()`
- The Flask backend remains a pass-through; it does not need to understand reachability

New functions to add to `server.js` (or a new `reachabilityPlanner.js`):

```
clampToWorkspaceEnvelope(x, y, z)
  → returns { x, y, z, clamped: bool }

findNearestReachable(targetPose, restPose, robotKinematics)
  → runs Layer 1 → Layer 2 → Layer 3 in order
  → returns { x, y, z, angles, status: 'exact'|'adjusted'|'rejected', distanceMm }

planAndMove(x, y, z, speed)
  → calls findNearestReachable
  → if adjusted or exact: moves the arm, writes feedback
  → if rejected: does not move, writes rejected status
```

The existing `moveToXYZ` handler becomes a thin wrapper around `planAndMove`.

---

## Anti-Spam Rules

The PLC auto-move loop fires every 100ms. Without guards, a single unreachable target causes:
- 3 layers of IK search every 100ms
- Continuous log spam
- Potentially continuous rejected move attempts

Rules:

1. **Only trigger a new plan when the target changes** — store `lastPlannedTarget { x, y, z }` and skip if unchanged
2. **Cache the last outcome** — if the last outcome was `rejected`, do not re-plan until the target changes
3. **Rate-limit adjusted moves** — if the outcome is `adjusted`, re-plan only when the target changes (not every 100ms)
4. **Allow manual reset** — a new `resetReachabilityCache` WS command clears the cache and forces re-evaluation

---

## PLC Feedback Design

DB125 currently ends at byte 20 (target_z). Add feedback fields starting at byte 22.

### New DB125 Fields

| Tag | Type | Byte | Description |
|---|---|---|---|
| `commanded_x` | Int | 22 | Actual X the arm was commanded to (may differ from target_x) |
| `commanded_y` | Int | 24 | Actual Y the arm was commanded to |
| `commanded_z` | Int | 26 | Actual Z the arm was commanded to |
| `reachability_status` | Int | 28 | Status code (see below) |
| `target_adjusted` | Bool | 30, bit 0 | True when a nearby fallback was used instead of exact target |

DB125 total size: 20 → **32 bytes** (update `total_size` in config.json).

### `reachability_status` Values

| Code | Meaning |
|---|---|
| `0` | Idle — no move attempted yet |
| `1` | Exact target accepted and commanded |
| `2` | Adjusted target used (fallback succeeded) |
| `3` | Target rejected — no reachable point found |
| `4` | Moving to target |
| `5` | Error |

### PLC Feedback Flow

```
PLC writes target_x/y/z
→ app detects target change
→ app runs planner
  → exact: commanded = target, status = 1, adjusted = false
  → adjusted: commanded = fallback, status = 2, adjusted = true
  → rejected: commanded = last known good, status = 3, adjusted = false
→ app writes commanded_x/y/z + reachability_status + target_adjusted to DB125
→ PLC reads outcome
```

---

## DB125 Config Changes

Update `config.json` db125 section:

```json
"commanded_x":         { "byte": 22 },
"commanded_y":         { "byte": 24 },
"commanded_z":         { "byte": 26 },
"reachability_status": { "byte": 28 },
"target_adjusted":     { "byte": 30, "bit": 0 }
```

And update `"total_size": 32`.

---

## Workspace Soft Limits Config

Express as cylindrical shell + Z band, not per-axis rectangles. The arm's constraint is radial.

```json
"robot_planner": {
  "workspace": {
    "reach_min_mm": 50,
    "reach_max_mm": 510,
    "z_min_mm": -50,
    "z_max_mm": 400
  },
  "fallback": {
    "rest_x": 300,
    "rest_y": 0,
    "rest_z": 260,
    "retreat_steps": 8,
    "spiral_step_mm": 5,
    "spiral_max_radius_mm": 40,
    "max_candidates": 200
  }
}
```

Note: `reach_max_mm` is set to 510 (conservative), not 529 (theoretical max from URDF). The last ~20mm near max reach is geometrically reachable but mechanically strained.

---

## Files to Change

| File | Change |
|---|---|
| `server.js` | Add `clampToWorkspaceEnvelope()`, `findNearestReachable()`, `planAndMove()`. Update `moveToXYZ` handler to use planner. Add anti-spam target cache. Add `resetReachabilityCache` WS command. |
| `config.json` | Add `robot_planner` section. Add 5 new DB125 tags. Update `total_size` to 32. |
| `plc_worker.py` | Add cache keys for `db125_commanded_x/y/z`, `db125_reachability_status`, `db125_target_adjusted`. Decode them from DB125 read. Write them back to PLC. |
| `app.py` | Add new tags to `/api/plc/db125/read` response. |
| `robot-arm.html` | Show `reachability_status` and `target_adjusted` in the PLC auto-move section. Highlight when adjusted or rejected. |
| `robot-arm-v3-page.js` | Update PLC target display to show commanded vs requested when they differ. Add status badge for exact/adjusted/rejected. |
| `plc_integration.py` | Handle writing `commanded_x/y/z` and `reachability_status` back to PLC in the robot DB write path. |

---

## Implementation Phases

### Phase 1 — Planner Core (no hardware needed, testable offline)

- Implement `clampToWorkspaceEnvelope()` in `server.js`
- Implement `findNearestReachable()` with Layers 1, 2, 3
- Write unit tests against known reachable/unreachable points using the URDF
- No PLC feedback, no DB125 changes yet

### Phase 2 — Wire into moveToXYZ

- Replace direct IK call in `moveToXYZ` handler with `planAndMove()`
- Add anti-spam target cache to PLC auto-move loop
- Log exact/adjusted/rejected outcome to console
- Verify offline with test coordinates

### Phase 3 — PLC Feedback

- Add 5 new DB125 tags to `config.json` (bytes 22–30)
- Update `plc_worker.py` to cache and write back commanded XYZ + status
- Update `app.py` `/api/plc/db125/read` to include new fields
- Update `plc_integration.py` to write feedback bits back to PLC

### Phase 4 — UI

- Show `reachability_status` label in PLC auto-move section of `robot-arm.html`
- Highlight in orange when `target_adjusted = true`
- Highlight in red when `reachability_status = 3` (rejected)
- Show commanded XYZ alongside PLC target XYZ when they differ

### Phase 5 (Optional) — Named Target Mode

If the process only needs a fixed set of destinations, replace arbitrary PLC XYZ with target IDs:

| ID | Position |
|---|---|
| `1` | Home |
| `2` | Pickup |
| `3` | Pallet |
| `4` | Quarantine |

The app maps each ID to a known-good reachable XYZ. No IK planning needed. Simpler, safer, and faster than freeform coordinates. The current IK approach is needed for arbitrary positioning; if destinations are fixed, this is the better long-term design.

---

## Test Set (Offline)

Build before touching hardware:

| Test | X | Y | Z | Expected |
|---|---|---|---|---|
| Known reachable | 300 | 0 | 260 | exact |
| Known reachable | 200 | 100 | 150 | exact |
| Slightly too far | 500 | 200 | 100 | adjusted (Layer 1 projects in) |
| Well beyond reach | 800 | 0 | 200 | adjusted or rejected |
| Below Z_MIN | 300 | 0 | -200 | adjusted (Layer 1 clamps Z) |
| Dead zone | 10 | 0 | 100 | adjusted (Layer 1 scales out) |
| Completely unreachable | 600 | 600 | 600 | rejected |

For each adjusted case, verify: `distanceMm` from original target is minimised, commanded XYZ is valid (IK returns angles), angles are within joint limits.

---

## Safety Rules

- Never command the arm to a position whose IK has not been verified in the same planning call
- Never search outside the configured workspace soft limits
- If all three fallback layers fail, do not move — hold last position
- Log every planning decision: requested, commanded, status, distance
- The planner is stateless per-call — no accumulated drift from repeated adjustments
