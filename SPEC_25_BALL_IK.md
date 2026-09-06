# SPEC_25 — the catch, the secure, the drop and the boot (2026-09-06)

> T0 — THE RULE THAT DECIDES EVERYTHING ELSE IN THIS DOCUMENT
> A mouse is a trigger, not a law. The engine's `kick.ts` law says the boot swings at a
> **stationary ball**, and it is right, because its kicker is walking up to a ball waiting
> on the ground for a conversion. The same words spoken by a human at full sprint are a
> different sport: the punt in flight is what the state machine is for, so the module
> **implements its own impulse** rather than reaching for `startKick` and getting an
> eight-second ritual with a tee in it. It borrows the *formula* the law approves
> (`J = m_ball · v_kick · u_camera`) and applies it on its own contact, at the instant the
> foot arrives.
>
> And the other half of T0, the one this feature was nearly built on the wrong side of:
> **a two-bone IK solve is the cheap, correct, frame-live thing.** One `acos`, one `sqrt`,
> per arm, per frame — no bake, no curve, no lookup table. The presimulate-first rule is
> for contested physics with a hundred candidate outcomes; a hand reaching for a known
> point is not that, and inventing a curve set for it would have been the same mistake as
> a runtime CCD: expensive in the wrong place.

## 1. The verbs, and why the mouse was free

`[IDLE/RUNNING] → hold RMB → [HANDS_READY] → ball within 0.70 m of the chest + LMB →
[BALL_SECURED] → release LMB → [DROP_BALL] (300 ms window) → Space → [PUNT_KICK]`,
RMB released at any point returns to idle. The two-bone arm solve is live while the right
button is held, and during the boot's arc.

Nothing in the engine consumed mouse input on either branch: `Input` was WASD plus six
keys plus gamepad. So RMB is hands-up, LMB is secure, and Space is the punt **edge inside
the drop window only** — outside it Space is exactly what it was, sprint/action, because
the state machine answers for the key only while it owns it. `n` and `m` are the keyboard's version of the same two holds (`m` is held and released,
so the grip and the drop both have a keyboard shape); `v` was the obvious third letter and
the first/third-person rig claimed it during this work's merge, which is the right winner
— a camera mode outranks an alias for a mouse button.

First and third person are not two features here. They are the two `CamMode`s this engine
already has: `SHOULDER` is first person (`eyeY 1.62`, the man's own head), `CABLE` and
`BROADCAST` read the same solve from outside, and `CHASE` sits behind. The IK therefore
publishes **world-space joint targets** and never asks which lens is looking; the punt
aims along `d.cam`'s look vector for all of them, which is the one thing about a punt that
*must* differ by mode: where the player is looking is where the man is kicking, and the
2D-on-pitch branch of the camera has no yaw at all, so there the lens is the facing.

## 2. The solver (`src/game/engine/ballcraft.ts`)

Analytical two-bone, `l1 = 0.30·size` (upper arm) and `l2 = 0.28·size` (forearm), root at
the shoulder line (`y = 1.24·size + 0.06`, ±`0.20·size` lateral along the facing).

```
d  = clamp(|t − root|, |l1 − l2| + 0.02, l1 + l2 − 0.008)
a  = (l1² − d² + l2²) / 2d          h = √(l1² − a²)
elbow = root + û·d ... no: root + û·a + n̂·h        hand = root + û·d
n̂ = normalise(pole − û(û·pole))                       (pole = down and slightly back)
```

Three decisions in those lines are load-bearing:

* **the clamp on `d` is the mechanic, not a guard.** Out of reach the hands strain toward
  the ball along the straight line and stop on the reach sphere, and `reach` returns the
  shortfall, which the rig multiplies into its own reach blend — so a miss *looks* like a
  miss. Reaching in a game that can fake it is a decision about what the player is allowed
  to learn, and the answer here is: what is actually possible.
* **`n̂` orthogonalised against `û` by construction** means `elbow` lies in the
  root–target–pole plane exactly, and the `0.008` short of full extension is what keeps
  `acos` inside its domain at every input the soak can produce. `ballikprobe` proves the
  consequence: over 4 000 random targets, every solution has
  `|l1 − l2| ≤ d ≤ l1 + l2`, `|elbow − hand| ≤ l2 + 1e-6`, no hyperextension, no broken
  limb, and `elbow.y > shoulder.y` on the two-bone arc.
* **palms face the ball, and that is why the pole is down-and-out.** The two arms are
  solved at one point with a ±9 cm lateral offset (the ball is 0.28 m long; two hands on
  the same pixel is a magic trick), each with its own pole, which is what makes the catch
  read as two hands arriving rather than a T-posing slide.

The same `solveTwoBone` is what `applyArmReach` in the rig has been doing approximately for
an era (slerping both segments toward a world direction, no plane, no clamp). The engine's
answer is exact and costs one `acos`; the rig keeps its own blend because it owns how much
of the pose to apply.

## 3. What "secured" is

* the ball is socketed: `BALL_SECURED` writes the chest point every frame —
  `y = 1.02·size`, `0.16·size` along the facing — and the free body is nulled, so
  **gravity is not turned off, it is no longer applicable**: there is no integrated object
  to integrate. The rig draws the secured ball parented to the hand bone. That is a truer
  statement of the same rule and it cannot drift a frame behind.
* **the open-play ball's authoritative position is the carrier's hands.** `open.ts:811`
  writes `s.ball.x/z` *inside `doPass`* — it is not a per-frame attach. Measuring against
  `s.ball` while a man holds the ball measures the grass where a pass last started. The
  state machine answers the question instead: `ballPoint()` returns the free body when
  there is one, the in-flight pass when `s.ball.live`, and the carrier's own hands
  otherwise.
* **holding LMB is ball care.** `Director.bcGrip` is published from `input.secure` for the
  frame — deliberately *not* read off `bc.state`, because the grip has to survive the phase
  that ended the possession — and it multiplies the strip chance by `0.12`. A grip that
  does nothing is a control that gets released, and the mechanic must be better than that.
* **ball security is enforced in the window where it matters**: a defender within 1.15 m
  in the first 0.55 s after the catch can strip it (`AGG` vs `SKL`, seeded `R()`), and
  being stripped, or knocking the ball on by releasing it too late, puts the ball loose on
  `bc.free`.

## 4. The drop and the boot

Releasing LMB is **a release, not a throw**: `v = carrier·v·0.35` plus a 0.55 m/s hop, so
a dropped ball stays near the man who dropped it instead of sailing like a clearance. The
300 ms window counts down and is printed in the HUD — a window nobody can feel is a
missing feature.

Space in the window starts `PUNT_KICK`: a `SWING_S = 0.20 s` arc, with the strike gated on
**contact with the ball**, not on the arc's end. The foot is a sphere of `BALL_R + 0.06`
swept against the ball's *predicted* position over the remaining arc, and the prediction is
anchored so the arc ends level with where the ball will be — otherwise the strike depends
on where the ball happened to fall relative to a fixed leg, which is exactly the bug the
first version of the check exposed. On contact:

```
v_kick = 21.5 · (0.72 + 0.38·SKL/78) · (0.52 + 0.48·swing)
J      = M_BALL · v_kick ;   b.v = u_camera · (J / M_BALL),  b.vy = max(6.4, ...)
```

`J/m` is applied **exactly** along `u_camera` and *replaces* the horizontal velocity rather
than adding to it — adding to a drop that inherited the carrier's sprint would leave the
ball 30-odd degrees off the lens, and `THE IMPULSE IS m·v·u, AND u IS THE LENS` is the
check that catches that. A boot that misses is a miss: the state expires and the ball is
`LOOSE`. A punt that lands unclaimed is resolved through `startOpen` as a restart or a
scrum, never left as a loose ball at the end of a phase, and a boot that catches a man's
shins gives him `stun` and a word (`d.say`).

## 5. Cost, measured

`ballikprobe`'s cost check times and heap-profiles the machine: **2.05–2.10 µs/frame** for
the whole state machine, the solved poses, the free-ball integration and the punt contact,
and **0 B/frame** in the frame path. Getting to zero was a real change, not a relabelled
measurement: the solver, the pose objects, the shoulder anchors, the aim scratch point and
the foot point all started as fresh object literals per arm per frame — 30 objects a frame
in a 180-frame window — and were rewritten to write into holders the state owns
(`solveTwoBone`'s optional `out`, `bc.l`/`bc.r`/`bc.chest`/`bc.shoulderL/R`/`bc.foot`
mutated in place). The refusal message that explains a failed catch is rate limited to two
a second for the same reason *and* because a ledger is for transitions: sixty refusals a
second would evict the states that mattered.

Two instrument lessons, both recorded because they were wrong before they were right:

* a heap delta across one loop attributes every earlier fixture allocation to that loop —
  the check reported "2.4 kB/frame of mechanic" while the mechanic allocated nothing.
  The fix is the **slope** across two runs of different length. What remains is ~150
  B/frame, and the honest comment says why: this loop re-kicks a loose ball every few
  frames and the strike's resolution goes through `startOpen`, which builds a new phase
  object. That is a phase restart amortised over a third of a second, not the IK.
* the camera is **engine-owned**: `Director.update` rewrites `d.cam` every frame, so a
  fixture that sets `cam.yaw` once and expects it at the strike is testing a hope. Pin it
  per frame — and take the useful property on the way past: the punt follows whatever the
  lens is doing at the instant of contact.

## 6. Files

```
src/game/engine/ballcraft.ts     NEW the machine, the solver, the free-ball physics (296 lines)
src/game/director.ts             Input.handsUp/secure/punt + NO_INPUT; the bc field, created
                                 with the match, ticked after the phase switch; bcGrip
src/render/ThreePlayerManager.ts d.bc?.free drives the mesh; syncHands' craft block;
                                 applyCatchElbow; the elbow pass in applyProcedural
src/ui/MatchView.tsx             mousedown/contextmenu/mouseup, the punt edge off action,
                                 the KEYMAP entries, the HUD line with the window in ms
scripts/ballikprobe.ts           NEW 12 checks — 3 solved-arm, 2 secure/refuse, drop,
                                 window, impulse, whiff, resolution, cost, 5-seed soak, spec numbers
scripts/gatecheck.ts             ballikprobe wired into the verdict
```

Accepted by: `tsc` clean; `ballikprobe` ALL PASS on seeds 1–5; `gatecheck` **21 gates ALL
GREEN** — audit at baseline `PASS 5324 · WARN 4 · FAIL 5` (all LAW-66), `handsprobe`,
`sceneaudit`, `teleprobe` 0 teleports, `build` green — measured on the tree **after merging
the remote's first/third-person camera and locomotion rig** (`src/render/camera.ts`,
`pointerLock.ts`), because the punt aims along the lens and the lens moved under it. The
merged tree is what the probe passed on, and `cameraverify`, `viewprobe` and `healthverify`
were wired into the verdict as part of that merge so their work is guarded too.

## 7. What this deliberately does not do

No finger bones (SPEC_24 §6 still owns that); no `BallCraft` in `serialize.ts` — a catch is
a 180-frame window, and the only reason to persist it would be to be able to resume a punt
across a save, which is not a thing anyone is owed. No IK on the kick leg beyond the swing
arc's own contact test. No second loose-ball subsystem: `bc.free` exists only while the
phase is not already moving the ball, and any recovery goes through the existing
gather/restart path. And no pretence that the 2D fallback has hands: outside `ENV_3D` the
verbs still work and the HUD says so, because the state machine is not a renderer feature.
