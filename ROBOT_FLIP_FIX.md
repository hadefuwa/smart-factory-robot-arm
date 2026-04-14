# Robot Arm Backflip — Root Cause & Fix

## The Problem

Any time a Cartesian XYZ move crossed the X=0 boundary (positive X to negative X or
vice versa), the robot would violently snap through a large arc rather than making the
small incremental movement that was actually needed.

---

## Root Cause — Multiple Valid IK Solutions

Inverse Kinematics (IK) converts a desired tool position (X mm, Y mm, Z mm) into a
set of joint angles. For almost any point in the workspace there are **two valid joint
configurations** that place the tool at exactly the same location:

| Name | Joint 1 (base yaw) | Shoulder / elbow |
|---|---|---|
| **Front** | Points the base toward the target | Arm extends forward |
| **Back** | Points the base 180° away from the target | Shoulder wraps around backward |

Both are geometrically correct. Live logs from the Pi confirmed the robot was sitting
in the back configuration with `joint1 = -86.9°`, while the front solution for the
same target is `+93.1°` — exactly 180° apart.

The IK solver had no way of knowing which configuration to use. As the target crossed
X=0, it kept switching between them. Each switch was a full 180° base rotation — the
backflip.

---

## The Fix — Pick the Nearest Candidate

**File:** `kinematics.js` — `inverseKinematics()`  
**File:** `server.js` — `moveToXYZ` and `inverseKinematics` handlers

For any target, two valid base yaw angles exist:

```
front = atan2(target_y, target_x)
back  = atan2(target_y, target_x) ± 180°
```

Before the iterative solver runs, the current servo angles are read from hardware and
passed in as the starting seed. The fix then computes both candidates and picks
whichever is **closest to the servo's current angle**, keeping the robot in whatever
configuration it is already in:

```js
const useFront = angularDist(frontYaw, currentYaw) <= angularDist(backYaw, currentYaw);
angles[0] = useFront ? frontYaw : backYaw;
```

Joint 1 is then locked for the rest of the solver so the gradient iterations cannot
drift it away from the chosen value while finding solutions for joints 2–5.

---

## Why This Works

| Scenario | Current joint 1 | Front candidate | Back candidate | Chosen |
|---|---|---|---|---|
| Robot in back config, move slightly negative X | -86.9° | +93.1° (180° away) | -88.1° (1.2° away) | **Back** ✓ |
| Robot in back config, move slightly positive X | -86.9° | +80.5° (167° away) | -99.5° (13° away) | **Back** ✓ |
| Robot in front config, cross X=0 | +88° | +91.9° (4° away) | -88.1° (176° away) | **Front** ✓ |

In every case the robot stays in its current configuration and only rotates the small
amount actually required. The 180° snap is eliminated.
