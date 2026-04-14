# Robot Arm Flip Debugging

## The Problem

The robot does a large, violent movement (backflip) any time a target position crosses
the X=0 boundary — i.e. going from X positive to X negative or vice versa — even when
the intended move is small (e.g. X=5 to X=-5 with Y=300, Z=200 unchanged).

---

## Root Cause: Multiple IK Solutions

For any Cartesian target (X, Y, Z) there are usually **multiple valid joint configurations**
that place the tool at that exact point. The most common ones:

| Configuration | Joint 1 (base yaw) | Joints 2-3 (shoulder/elbow) |
|---|---|---|
| **Normal** | ~91° (small rotation) | "elbow forward" |
| **Mirror/flipped** | ~-89° (same physical direction, opposite encoder value) | "elbow back" |

When the Jacobian-transpose IK solver starts from **all-zeros** it may converge to
*either* solution. Crossing X=0 is the worst case because the two solutions are
exactly symmetric about the Y-axis.

---

## What Was Attempted

### Fix 1 — Warm-Start the Solver (`server.js`)

**File:** `pwa-dobot-plc/robotarmv3-pi-service/server.js`  
**Cases:** `moveToXYZ` and `inverseKinematics` command handlers

**Before:** Both handlers called `inverseKinematics(pose, null)` — passing `null` as
the initial guess. The solver always started from joint angles = `[0, 0, 0, 0, 0]`
(arm pointing straight up) and searched for a solution from scratch.

**After:** Before calling IK, the handler now reads the actual current servo angles via
`getAllServoStatus()` and passes them as the seed:

```js
const xyzStatuses = await getAllServoStatus();
const xyzCurrentAngles = xyzStatuses.filter(s => s.available).map(s => s.angleDegrees);
if (xyzCurrentAngles.length === robotKinematics.getJointCount()) {
    xyzInitialAngles = xyzCurrentAngles;
}
const xyzAngles = robotKinematics.inverseKinematics(xyzPose, xyzInitialAngles);
```

**Why this alone isn't enough:** The Jacobian-transpose method is a gradient descent
solver. Even starting near the correct solution, a poorly-scaled gradient step can
overshoot and fall into the mirror-image basin of attraction. Joint 1 in particular has
two equally valid angles for any horizontal target direction — the solver is not
guaranteed to stay near the starting point.

---

### Fix 2 — Analytical Base Yaw (`kinematics.js`)

**File:** `pwa-dobot-plc/robotarmv3-pi-service/kinematics.js`  
**Function:** `inverseKinematics()`

**The insight:** Joint 1 is a pure **base yaw** (URDF axis = `{0, 0, 1}`). For any
target `(X, Y, Z)`, its correct angle is *always and uniquely*:

```
joint1 = atan2(Y, X)   (in degrees)
```

There is no second solution. No solver is needed. Computing this analytically and
**locking it** prevents the gradient step from ever choosing the wrong side.

**What was added:**

1. **Pre-computation block** (before the iteration loop): detects if joint 0 has a
   Z-axis, then sets `angles[0] = atan2(target_y, target_x)`.

2. **Skip in gradient loop**: adds `if (j === analyticalBaseYawIndex) continue;` so
   the Jacobian update can never drift joint 0 away from its correct value.

---

## Why It May Still Not Be Working

Despite both fixes, the following issues can still cause large movements:

### 1. Code Not Running on the Pi

**Check:** After `git pull` and service restart, verify the new code is live:

```bash
ssh pi@rpi "grep -n 'analyticalBaseYawIndex' ~/sf2/pwa-dobot-plc/robotarmv3-pi-service/kinematics.js | head -3"
ssh pi@rpi "grep -n 'xyzInitialAngles' ~/sf2/pwa-dobot-plc/robotarmv3-pi-service/server.js | head -3"
```

If either returns nothing, the files on the Pi do not have the fixes.

---

### 2. Elbow/Shoulder Flip (Joints 2–5) — The Remaining Problem

Even if joint 1 is correctly pinned, **joints 2–5 can still flip**. For a given base
yaw angle and target distance/height, the elbow can be "up" or "down" (two valid
solutions). The warm start (Fix 1) is supposed to prevent this, but only if the servo
read returns accurate current angles.

**Check:** Add a temporary `console.log` to the `moveToXYZ` handler in `server.js`
immediately after reading servo status:

```js
console.log('[IK SEED] initial angles:', xyzInitialAngles);
```

Then trigger the move that causes the flip and check the Pi's service logs:

```bash
ssh pi@rpi "journalctl -u smart-factory.service -n 50 --no-pager"
```

If the logged angles are `null` or `[0, 0, 0, 0, 0]`, the servo read is failing and
the warm start is not actually working — the solver is still starting from zero.

---

### 3. Servo Read Returns Mid-Motion Angles

The `moveToAngle` command returns **immediately** without waiting for the servo to
finish moving. If the user sends a second XYZ command before the first motion
completes, `getAllServoStatus()` reads mid-motion positions. The warm start seed is
then inaccurate.

**Check:** Add a deliberate pause or use the `isMoving` field from `readQuickStatus()`
to wait for motion to complete before solving the next IK.

---

### 4. Physical Servo Zero ≠ Software Zero

If the servo's physical "center" position (2048 steps) does not match what the URDF
expects as 0°, all computed angles are offset by a constant amount. The IK produces
correct *relative* angles but the *absolute* position is wrong.

**Check:** Command joint 1 to exactly 0° (`moveJoint` with `joint=1, angle=0`).
Observe which physical direction the arm points. According to the URDF, at 0° the arm
should point in the +X direction of the world frame (toward the "front" of the robot).
If it points elsewhere, there is a calibration offset that needs to be added as a
`zero_offset_degrees` to `joint1_base_yaw` in the URDF.

---

### 5. Large Target Jumps — This Is Working As Intended

If the user jumps from e.g. `X=200, Y=0` to `X=-200, Y=0`, the base joint **must**
rotate ~180° and the shoulder/elbow must fully reconfigure. This is geometrically
unavoidable — the robot cannot teleport. The motion will always look large for large
Cartesian jumps.

The fix only prevents *unnecessary* flips for *small* target changes near X=0.

---

## Suggested Next Diagnostic Step

Add logging in `server.js` to trace exactly what the IK receives and returns:

```js
case 'moveToXYZ': {
    // ... existing code ...
    console.log(`[moveToXYZ] target=(${Number(mX)}, ${Number(mY)}, ${Number(mZ)})`);
    console.log(`[moveToXYZ] IK seed=`, xyzInitialAngles);
    const xyzAngles = robotKinematics.inverseKinematics(xyzPose, xyzInitialAngles);
    console.log(`[moveToXYZ] IK result=`, xyzAngles);
    // ...
}
```

Run two consecutive moves — one to positive X, one to negative X — and compare the
seed angles and result angles. The flip will be visible as a large delta on one or more
joints in the result.

---

## Summary Table

| Fix | File | Status | What It Does |
|---|---|---|---|
| Warm-start seed | `server.js` | Applied | Reads real servo angles before each IK call |
| Analytical base yaw | `kinematics.js` | Applied | Locks joint 1 to `atan2(Y,X)` — no solver ambiguity |
| Elbow-flip prevention | Not yet applied | Pending | Needs servo-read verification first |
| Motion-complete wait | Not yet applied | Pending | Wait for servos to stop before next IK seed read |
