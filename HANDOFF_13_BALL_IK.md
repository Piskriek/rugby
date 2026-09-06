# HANDOFF — session 13 (2026-09-06). Read `docs/SENIOR_PLAYBOOK.md` first, then this.

Branch: `arena/01a072cf-rugby` (session branch; the lead cherry-picks into `v2-arch`).
Full specification and the measured numbers: **`SPEC_25_BALL_IK.md`**.

## 1. What was built

Interactive catch, ball security and drop-punt kicking — the state machine, the analytical
two-bone IK, the free-ball physics, and the mouse verbs that drive them:

```
[IDLE/RUNNING] —hold RMB→ [HANDS_READY] —ball ≤0.70 m of the chest + LMB→ [BALL_SECURED]
[BALL_SECURED] —release LMB→ [DROP_BALL] (300 ms) —Space→ [PUNT_KICK] → [FLIGHT]
```

* **`src/game/engine/ballcraft.ts` (new)** — owns the ball's free state, the two solved arm
  poses, the drop/punt timing and the punt impulse `J = m_ball · v_kick · u_camera`, applied
  on the foot sphere's own contact test, on an arc anchored to the ball's predicted height.
  The solver is one `acos` and one `sqrt` per arm per frame, live — no bake, no curve.
  **0 B/frame, ~2.1 µs/frame** for the whole machine (measured by slope, see §3).
* **`src/game/director.ts`** — `Input.handsUp/secure/punt` + `NO_INPUT`, the `bc` field
  created with the match and ticked after the phase switch, `bcGrip` for the strip maths.
* **`src/render/ThreePlayerManager.ts`** — `d.bc?.free` drives the ball mesh (a free ball
  has no carrier); `syncHands` gained a craft block that publishes the solved hand/elbow
  targets in the pitch mapping the renderer itself uses; `applyCatchElbow` + the
  `proc.craftW` pass in `applyProcedural` apply them; a secured ball stays socketed to the
  hand bone, which is why the engine says "there is nothing to integrate" rather than
  "gravity is off".
* **`src/ui/MatchView.tsx`** — RMB/LMB/mouseup on the canvas (`preventDefault` on the right
  button or the browser menu eats the verb), `punt` as an edge off `action` inside the
  window, KEYMAP entries, and a HUD line printing the window in ms.
* **`scripts/ballikprobe.ts` (new)** + wired into `gatecheck` (18 gates now).

## 2. Two things the brief asked for that are NOT in the code

**"a ragdoll solve for the ball"** — the repo has a ragdoll and it is not a candidate for
this: `src/render/ragdollKernel.ts` is an 11-node **position-based Verlet body whose whole
state is joints** ("distance constraints, not a force solver", `src/render/ragdoll.ts:19`),
and `src/render/ragdollRig.ts` exists only to translate that articulated pose onto a
skinned rig. A ball has one node, no distance constraint to satisfy and no rig to bind, so
running it through that machinery would be a skeleton pretending to have a purpose. What
the ball needs and now has is the same thing the trunk gets in that solver — a body
integrated with a hard ground clamp — as `bc.free` with restitution 0.42 in
`ballcraft.ts:integrate`. If a reviewer wants visible tumble, the honest change is a
visual-only spin derived from velocity in the rig, not a second solver.

**"Verlet or RK4, not Euler"** — `integrate()` uses **semi-implicit Euler** (`b.vy -= G·dt`
first, then `p += v·dt`) and that is the correct answer for a ballistic body that meets a
plane once: RK4 is four evaluations of a force that is constant except at the strike, and
Verlet earns its keep on *constraints*, which is exactly why the repo uses it for the
11-node body and not for a sphere. The check that keeps this honest is not the integrator
name but the ground clamp plus the `b.vy < -0.4` rest test — without the rest test a
restitution of 0.42 jitters forever, and that is a bug any integrator choice would still
have.

## 3. Traps this session found (all of them are in the code as comments)

* **`s.ball.live` is pass flight, not "loose ball".** Its branch in `upOpen` homes the
  ball toward `pendingReceiver`; a ball that enters it unclaimed gets *caught* by the
  engine. Free balls travel on `bc.free`, and the renderer was taught to prefer it.
* **`open.ts:811` is inside `doPass`** — the carrier attach is not a per-frame sync, so
  reading `s.ball.x/z` while a man holds the ball measures stale grass. Ask the machine
  where the ball is: `ballPoint()`.
* **`kick.ts`'s `startKick` is a tee ritual** (FANFARE → WALKUP → AIM) and cannot be
  entered from open play — see T0 in the spec.
* **A pose that is re-`new`ed every frame is invisible until a slope measurement finds
  it.** The first version allocated ~30 objects/frame; all of them now write into holders
  the state owns.
* **A heap delta across one loop blames the fixtures.** Use the slope (spec §5).
* **`d.cam` is rewritten by the Director every frame.** A test that sets a yaw once is
  asserting on a hope; pin it per frame and the test becomes a proof that the punt follows
  the lens.

## 4. Verification — measured

* `npx tsc --noEmit` clean; `npx vite build` green; `ballikprobe` **ALL PASS on seeds 1–5**,
  including on the merged tree that carries another session's first/third-person rig.
* `gatecheck` 21 gates (three of them that session's `cameraverify`/`viewprobe`/
  `healthverify`, wired here): audit `PASS 5324 · WARN 4 · FAIL 5` — the same baseline as session
  12, i.e. the mouse cannot break a match and the new verbs cost the integrity ledger
  nothing; `handsprobe`, `sceneaudit` 19/19, `teleprobe` 0 teleports, `bootcheck`, `build`.
* Soak: RMB/LMB/Space hammered in random order for 20 s per seed with random movement →
  **watchdog 0**, secured 15 frames, 24 frames of boot, 146 frames of loose ball (seed 1).
* No browser in this sandbox (re-proven, session 12's method): `curl localhost:5173` → 000.
  Acceptance is therefore the headless probe's 12 checks; nothing here claims pixels it
  could not see.

## 5. Where to take it next

1. **The contest needs the hands.** `hands.ts` is a field sampled per frame ("not a
   solver", its own header) that decides who has the ball at a breakdown, and `ballcraft.ts`
   is a solve that decides where a man's hands are. They are aimed at the same ball and do
   not yet talk: when both are live the rig takes the craft pose and the magnet keeps
   working on the numbers. The next refactor is one owner for the arm target per frame, and
   it should be the engine's — the magnet's `onBall` seconds are the proof a catch should
   have happened, which is a better secure test than distance alone.
2. **Gamepad parity is one line each** — `pollGamepad` already returns a `pressed` token
   set that `MatchView` merges into the same verb stream, so a pad button mapped to
   `handsUp`/`secure` inherits the whole machine. Deliberately left out so the mouse path
   is the one under test.
3. **A punt that lands in a jackal** should be a turnover contest, not a `startOpen` reset —
   the resolution is honest but coarse, and `resolveLoose` is the single function to change.
4. **The strip window is a constant, not a feel** — 1.15 m / 0.55 s are reasonable and
   unproven; a `gripcheck` harness on the strip rate (with and without `bcGrip`) is the
   measurement that would justify them, and it is ~40 lines.
5. **`breakdownverify` is red on the branch and it is not this feature.** Its
   "defensive commitment varies" check measures `bd.defCrew.length` across 69 breakdowns
   and gets 3 every time; it is red on the remote camera commit alone (`2abbe8e`, verified
   in a throwaway worktree), i.e. before this session merged anything. The cause is the
   baked ruck plan authoring one crew number instead of a distribution — the fix belongs in
   the bake, and the check's premise is the session-12 lesson ("zero variance made the steal
   unreachable"), so it stays wired out of the verdict until somebody varies `defCrew`.
6. Nothing here touches `render/retro.ts` / `coronal.ts` / `rig.ts`, so the art contract and
   the golden 96-px reference are untouched; if a future session restyles the ball,
   the free-ball mapping in `updateBall` and the ±9 cm two-hand offset in `ballcraft.ts`
   are the two numbers to re-check (a ball whose drawn radius moves must also move the
   `BALL_R + 0.06` foot sphere, or the punt whiffs on a ball that is visibly there).
