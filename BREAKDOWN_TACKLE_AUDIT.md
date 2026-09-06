# Breakdown / Tackle Audit — Engine Pass

The target: *"spend an absurd amount of time auditing and editing the breakdown,
the tackle and what happens around the tackle, how players behave, how they
clean out, how the ball comes out, presimulated so its optimised."*

This pass kept the live physics/runtime cheap by pushing geometry and behaviour
into **precomputed choreography** and **offline-solved playback**:

- The ruck is now authored as one pure choreography table
  (`src/game/engine/breakdownChoreo.ts`) — slots, the clearout drive, the jackal
  dig, the tackler roll, the nine's base and the release mark. Call sites read
  one table, so the shape cannot drift between the tackle frame and the ball-out.
- The tackle ragdoll is **not solved on the field**. `src/render/ragdoll.ts` is
  the offline baker; `src/render/tackleTrajectory.ts` + `src/render/ThreePlayerManager.ts`
  play back a baked trajectory (bank lookup + 1 lerp + 1 slerp per joint).
  `public/assets/tackles/tackles.bin` is the 3.46 MiB recorded bank.

---

## What the audit measured

Run the harness and the gate board:

```sh
npx tsc --noEmit
npx vite-node scripts/breakdownAudit.ts 5     # ruck / clearout / release
npx vite-node scripts/tackleAudit.ts 5 100 3  # latch-and-drag / teleport audit
npx vite-node scripts/gates.ts 100            # 9/9 regression board
npx vite-node scripts/spec05probe.ts 90 3 1   # teleport oracle
npm run build
```

Latest headline numbers (seed 5, diff 3):

| metric | run 1 | after edits |
|---|---:|---:|
| breakdowns | 203 | 235 |
| down-cleaner frames | 0 | 0 |
| cleaner clip while driving | 57% `cleanout` | 53% `cleanout`, 47% `ruck` |
| clearout closure | 791.8 m | 849.6 m |
| slow-ball releases | 0/193 | 91/219 (real split) |
| release off-mark >3.5 m | 8/193 (max 67 m) | 4/219 (max 10.6 m) |
| breakdown duration p50/p90 | 2.33 / 3.02 s | 1.43 / 2.17 s |
| tackle latch duration p50 | — | 0.45 s |
| tackle drag mean | — | 1.90 m |
| max tackler step in latch | — | 0.091 m (teleport line 0.80) |
| bystander >0.8 m jank steps | — | 0 |

Gate board: **9/9 pass** at 60 s and 100 s. `spec05` teleport oracle: PASS.
`npm run build`: OK.

---

## Defects found and fixed

### 1. The first clearer was a second grounded body (get-up lock every ruck)
`startBreakdown` set `p.down = i < 1`, so the first clearout player began the
ruck on the floor and picked up a 1.53 s get-up lock on every release.

**Fixed:** clearers/counters are `down:false`; only the carrier and the tackler
start grounded. The `down` value now comes from the choreography table, not a
`i < 1` accident. Result: down-cleaner frames stay 0.

### 2. A won ruck had no clearout — the cleaner's target was a frozen slot
Slots were authored as absolute positions and then pinned for the whole phase,
so the clearout looked like men walking into a pile, not driving through a
jackal.

**Fixed:** `breakdownDriveTarget()` moves roles along the choreography lane:
first clearer angles onto the jackal's shoulder, later cleaners drive through,
the jackal digs in, the tackler rolls clear. The drive is time-based and
precomputed — no runtime AI/allocation. Clearout closure is now measurable
(~850 m of accumulated closure per 30 s sample).

### 3. The ruck read as a maul
Bound clearers/jackal/counter were handed `maulBind`, which the renderer maps
to the **maul push** clip. A ruck is not a maul.

**Fixed:** once the drive completes, the choreography returns `ruck` (the
renderer already had a `ruck` clip mapped from `'jackal'`/`'cleanout'`).
Clip histogram is now `cleanout → ruck`, with no `maulBind` in the phase.

### 4. Slow ball was dead code, and every ruck released at the same pitch
`s.window` was clamped to 0.12–0.28 s while `RECYCLE` tested `> 0.9` for
`slowBall`. So the statistic could never fire and the release time was a roof.

**Fixed:** the presentation window now keys on the **dominance of the winning
force** at the crossing frame — a clearout that shoves the jackal off releases
inside ~0.3 s, a scrape takes ~0.4 s. Slow ball is instead read off the
**contest** length (`contestT > 1.0`), which is what a slow ruck actually means.
Result: a real quick/slow split (91/219 slow) without stalling the match
(breakdown p50 fell 2.33 → 1.43 s).

### 5. The ball jumped to a man who never walked to the base
`RECYCLE` asked `ruckDistributor` *at the release frame*, so the ball could go
to a different forward than the one `placeBound` had been walking to the base
— measured as an off-mark release (up to 67 m in the first harness, 10.6 m
after the identity fix).

**Fixed:**
- The receiver is picked **once** in `startBreakdown` (`distNum`) and that same
  man is walked to the nine's base all phase.
- `ruckDistributor`'s last-resort path no longer hands the ball to a *down*
  player or a distant back.
- At release, if the walked receiver is still >3 m from the base, the ball goes
  to the nearest on-feet attacker **within 3 m** of the base instead of jumping
  to a man ten metres back.

### 6. Crew members were assigned from absurd distances
11 of 1613 crew members started more than 10 m from the contact (one at 19 m),
so a "cleaner" spent the whole ruck sprinting from the other side of the field.

**Fixed:** `startBreakdown` only puts a player in the ruck roster if he is
within reach of the contact (12 m). A man too far simply does not join that
ruck; the crew is whoever is actually close enough to be a body over the ball.
(It is still a hard fall-back to the nearest man when *nobody* is within reach,
because a contest should never be an empty pile.)

### 7. Broadcast lens lost a deep kick out of the top of frame
While auditing what happens after the ball leaves the tackle, the 100 s gate
caught a punt from the dead-ball end where the ball rode out the top of the
frame (sy < 0).

**Fixed** in the cable rig:
- aim the tilt at the ball's *actual* height while it is in flight (clamped
  1.2–12 m), not at 1.2 m of turf twenty metres away;
- let the lead collapse fully as the ball comes down, so a grounded roll is not
  aimed six metres ahead of itself;
- widen the in-flight lens a touch more.
Ball-on-screen at 100 s: 121 → 11 frames (gate threshold 60).

---

## The tackle episode itself (latch-and-drag)

`scripts/tackleAudit.ts` measures the drag before the ruck. Seed 5, diff 3,
100 s:

- 14 latches, mean 0.44 s (0.6 s cap), p50 0.45 s.
- Mean drag 1.90 m — a real carry through contact, not a 4–7 m piggyback.
- Max carrier/tackler/bystander single-frame step 0.061 / 0.091 / 0.145 m —
  all far below the 0.80 m teleport line.
- **0** bystander jank steps (>0.8 m) and **0** carrier direction reversals
  while held.

So the "janking out" no longer shows up as body teleports in the engine. The
remaining visual seam is the transition from procedural pose into the baked
tackle pose, which the bank playback handles with a 0.14 s blend-in and a
0.16 s cool-out.

---

## How it stays optimised

- No physics engine, no runtime verlet. `RagdollSim` runs only in
  `scripts/bakeTackles.ts`.
- Runtime tackle = static bank `pick()` + one `lerp` (positions) + one `slerp`
  (quaternions) per joint, with optional reflection. No per-frame allocations.
- Breakdown geometry is one pure table; no AI decisions or allocations on the
  field, just an arithmetic `driveTarget()` read.
- Baked bank is 3.46 MiB and served as `assets/tackles/tackles.bin` (verified
  HTTP 200, Content-Length 3629388).

## Known residual

- A tiny fraction of ruck releases (4/219) still hand over >3.5 m from the
  release mark when *no* attacker is within 3 m of the base at the instant of
  the call; the release then plays from where the nearest man actually stands
  rather than teleporting him. It is the correct no-teleport trade-off and is
  bounded to ~10 m (down from ~67 m).
- The T-02 dev warnings still fire on a handful of phase hand-off frames; they
  are displacement warnings, not gate failures — the NO-TELEPORT / teleport
  oracle boards remain green.
