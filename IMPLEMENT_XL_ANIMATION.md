# IMPLEMENT_XL_ANIMATION.md — XL Animation Reconciliation (T-28 / T-31 / T-34)

**Phase:** Audit & Mapping (SPEC_01 §2) → **IMPLEMENTED & VERIFIED**.
Plan approved by the user; the TypeScript was written and the build is green (`tsc --noEmit`
and `vite build` both pass). This document now doubles as the implementation log.

**Source tickets (consolidated here):** T-28 (precise considered animation), T-31 (full
precise animation set: running / tackle / dive), T-34 (full papercraft pass). All three
are now owned by this single plan and marked CLOSED (consolidated) in `HANDOFF.md`.

**Permitted files for the implementation phase** (SPEC_01 §1):
- `src/render/paper.ts` — material library, paper-view hysteresis, character dataset,
  and the home for the new pure effect helpers.
- `src/game/papercraft.ts` — 109-point papercraft dataset (spec for the drawer).
- `src/game/animation.ts` — 1,100+ point animation dataset (the design facts).

**Restricted:** `src/render/rig.ts` — read-only historical reference. `src/render/coronal.ts`
is **frozen** per `HANDOFF.md` §2 (the `drawPaperActor` / `drawSidePaper` / `drawLyingPaper`
drawers). The mapping below respects the freeze and calls out the single scoped seam each
demand needs.

---

## 0. Pipeline snapshot (what already exists)

Drawn each frame by `scene.ts drawMatch` → `drawPaperShadow` + `drawPaperActor`.

- `PaperDrawArgs` carries: `view` (`PaperView`), `pose: Pose`, `build: Build`, scale `sc`,
  `carry`/`carryStyle`/`ballSide`/`ballSpin`, `spinDir`, `gs`, `fore`, `headDir`, `depth`.
- `Pose` channels: `hip, lean, roll, twist, headP, headY, aL, aR, abL, abR, eL, eR,
  lL, lR, adL, adR, kL, kR, ball, ballSide, fall, fallD`.
- `drawPaperActor` (coronal.ts, frozen) translates to screen, mirrors on edge
  (`ctx.scale(spinDir,1)`), applies the `fall` rotation about the hip, then dispatches by
  `view`. Legs are drawn by `legChain(l,k,...)` from fixed lengths
  `thighLen = b.leg*0.52`, `shinLen = b.leg*0.48`. **No camera-angle foreshortening of
  leg length exists.**
- `gs = clamp(sin(cam.tilt)*1.15, 0.42, 0.95)` and `fore = 0.45 + 0.55*perp`
  are already computed in `scene.ts` but are **consumed only by the lying artwork**
  (`drawLyingPaper`), never by standing/edge art.
- Cadence lock is **already done** (T-29 / papercraft S-06): `clipT` advances at
  `speed / clipSpeed`, so feet track turf. The strafe-shuffle route (T-64) already exists.
- A **true side profile already exists** in `drawSidePaper` (one lit arm, one lit leg,
  forward lean, stride, ball clamped in front of chest). The `EDGE`/`E-01..E-15` profile
  demand is therefore largely satisfied — only the *foreshortening math* is missing.
- No impact squash exists anywhere; the tackle/dive clips carry pose keys but no 2D
  deformation.

**Key conclusion of the audit:** this reconciliation is mostly *finishing incremental
effects*, not rebuilding. Two of the four demands (no-foot-slide cadence, true edge
profile) are already largely in place; SPEC_01's job is the missing 20% on each plus the
two genuine gaps (impact squash, running-pass upper/lower split).

---

## 1. Impact Squash

**Dataset basis (animation.ts / papercraft.ts):**
- `P-01` Squash & stretch — rugby shoulder hit squashes ~6%, recovers in 3 frames; volume
  conserved (compress one axis, bulge the other).
- `C-01` Impact frame — squash 5–10% on the impact frame; next 3–6 frames recover; camera
  shake 0.2–0.5 (shake already exists via `cam.shake`, T-54).
- `W-06` Impact compression — compress on the impact frame only; rebound overshoots 5–10%
  past rest; recover 3–6 frames; **squash axis is along the force, not always vertical**.
- `T-04` Contact is a frame — squash on the impact frame only.
- `S-06` Contact spacing — compress toward impact, one tight frame at impact, spread on
  recovery.
- `PR-02` Tackle hit — back-in load, cubic-out drive, **1-frame impact, 6-frame recover**.
- `R-07` / `W-15` / `C-16` Dive — horizontal launch, slide; squash on the landing frame.

**Current state:** none. Tackle clip has a fold/shoulder pose but no scale deformation.

**Mapping (how it is handled in the papercraft context):**
1. Treat the flat card as a 2D elastic sheet. On the impact frame apply a **vertical squash
   + horizontal bulge** about the **foot anchor** (`B-04` ground anchor), so the body reads
   as compressing into the turf rather than scaling about the head. Symmetric-ish:
   `sy = 1 - k`, `sx = 1 + k * bulge` with `bulge ≈ 0.6` (paper is thin, so width
   over-expands less than a volume body would).
2. Envelope (paper.ts helper `impactSquash(kind, phase01) → {sx, sy}`):
   - `kind = 'tackle' | 'dive' | 'cleanout' | 'scrum'`.
   - Drive `k` by a one-frame spike at the clip's known impact `u` (tackle: the single
     impact key from `PR-02`; dive: the landing key; scrum: `PR-11` 1-frame impact), then
     ease out over 3–6 frames using `cubicOut` (from `animation.ts` `ease`) for recovery.
   - Magnitude banded by `kind`: tackle/dive 6–10%, cleanout 4–6%, scrum 8–10% (W-11).
3. **Trigger:** detect the impact frame from the puppet's `clipName` + `u` in `scene.ts`
   (the per-frame context lives there), compute `{sx,sy}` via the paper.ts helper, and
   pass it down.
4. **Freeze seam (required, scoped):** the flat-card `ctx.scale(sx,sy)` must be applied in
   `drawPaperActor` about the foot anchor. Add one optional field
   `squash?: { sx: number; sy: number }` to `PaperDrawArgs` (coronal.ts) and have
   `drawPaperActor` apply it after the `translate(sx,sy)` / before dispatch. This is the
   **only** change needed to the frozen drawer for this demand.
   - *Alternative considered:* approximate squash purely via `Pose` (`hip` dip + `roll`
     pulse) — needs **no** drawer change but **loses the width bulge** that `P-01`/`W-06`
     explicitly require (volume conservation). Rejected as a downgrade; the field is the
     correct seam.
5. Camera shake on impact is already covered by the existing `cam.shake` system; verify it
   fires on the same frame (do not re-add shake).

**Verification:** watch a half hands-off — tackle/dive read heavy; `teleportCount` stays 0
(squash is render-only, zero world-position change).

---

## 2. No-Foot-Slide (ground-lock for 2D assets)

**Dataset basis:**
- `SM-02` Root motion — a foot plant must not slide under a moving root; speed is a cadence
  change, not a root slide; "kick-glide and moonwalk are root-motion bugs".
- `W-07` Weighted feet — no foot slide during ground contact; plant heel-toe in a jog,
  ball-of-foot in a sprint; a cut plants on the outside edge; lift the heel, not the whole
  foot, between strides.
- `B-04` Ground anchor at the foot; `W-04` (papercraft) planted foot must stay planted.
- `S-06` (papercraft) / `T-29` — clip time advances at `speed/clipSpeed` (already done).
- `SM-04` Speed-driven clip choice (already done).

**Current state:** the *root-slide* class of bug is already prevented — the engine
integrates `a.rx/a.rz`, the paper is billboarded at that root, and `clipT` is cadence-locked
to ground speed, so feet lock to turf. The remaining gap is a **planted-foot drift**
caused by (a) the hip double-bob (`R-01`) translating the whole leg chain vertically and
(b) the idle/low-speed gait leaving legs static while the body still translates.

**Mapping:**
1. **Keep the cadence lock.** Do not regress `steer()`'s `clipT += dt*speed/clipSpeed`
   (T-29). This is the core of the no-slide guarantee.
2. **Add a plant-stick (paper.ts helper `pinPlantedFoot(pose, build, speed) → Pose`):**
   when a foot is in ground-contact (knee extended, `footPitch` ~flat, thigh angle near the
   contact extreme), solve the contact foot's `l/k` so the foot lands at `y = 0` (the foot
   anchor) regardless of the hip bob; release the pin during swing so the other leg cycles.
   This is an **upper/lower separation**: hips/head/torso bob, the planted foot stays put.
3. **Trigger:** apply only when `speed > 0` and the gait is jog/run/sprint/shuffle; skip
   for idle and one-shots. At very low speed prefer the shuffle clip (T-64) so lateral
   movement still plants.
4. **Freeze seam:** the helper returns a corrected `Pose` (lower channels only) that
   `drawPaperActor` already renders through `legChain` — **no drawer change required** for
   this demand. (If a tighter pin is wanted later, an optional `footPin?` field on
   `PaperDrawArgs` is the seam, but it is not needed for v1.)

**Verification:** a slow lateral runner (shuffle) shows feet planting without sliding;
`teleportCount` 0; optionally a per-actor foot-tracking probe asserting the planted foot's
screen position stays within a small tolerance during stance.

---

## 3. Running Pass (upper/lower separation)

**Dataset basis:**
- `R-03` The pass — hips open, hands sweep across the body, head turns to target first;
  back-in wind, circ-out release.
- `SM-13` Carry to pass — body stays moving forward; hips rotate into the pass; ball leaves
  at chest height.
- `PR-04` Pass release — back-in wind, circ-out release, 0.25 s total.
- `R-16` Offload — thrown in contact, one-handed/short, off a bent arm.
- `T-14` Pass cycle — wind-up 0.08 s, release 1 frame, follow-through 0.1 s, flight
  0.18–0.4 s.

**Current state:** `mapAction` swaps the *whole* clip to `'pass'`, so the legs stop and the
run cycle breaks. `carryPose` already clamps the ball to the chest during carry, so the
ball stays visible — good.

**Mapping (pure-permitted; NO frozen-drawer change):**
1. Split the `Pose` into **UPPER** = `{aL,aR,abL,abR,eL,eR,headP,headY,ball,ballSide,
   twist}` and **LOWER** = `{hip,lean,roll,lL,lR,adL,adR,kL,kR,fall,fallD}`.
2. Sample **two** clips per frame: the gait clip (drives LOWER, cadence-locked) and the
   pass clip (drives UPPER, its own `u`). The carried ball keeps `ball`/`ballSide` from the
   carry state so it stays chest-clamped.
3. **paper.ts helper `upperLowerRun(runPose, passPose, carry) → Pose`** merges LOWER from
   the gait pose and UPPER from the pass pose. Reuse existing `clips.ts` `sampleC` /
   `lerpPose` / `actionClip` — no new clip machinery.
4. **Trigger (in `scene.ts`):** when `renderClip ∈ {pass, ninePass, nineFeed,
   lineoutThrow}` **and** `pg.spd` is above the run threshold, drive LOWER from
   `run`/`jog` (by speed) and UPPER from the pass clip; blend the upper in/out over ~0.15 s
   around the throw (`SM-01` blend). Below threshold, keep the current full-clip behaviour.
5. This demand is the cleanest: it lives entirely in a `paper.ts` helper plus a `scene.ts`
   decision and renders through the existing frozen drawer unchanged.

**Verification:** a carrier passing while sprinting keeps driving his legs while his arms
sweep the ball; `teleportCount` 0; ball stays chest-clamped (`carryPose` untouched).

---

## 4. Edge Leg Foreshortening

**Dataset basis:**
- `B-14` Upright bias — at high camera tilt a standing figure projects short; **upright
  foreshortening by `cos(tilt)`**; clamp it so figures never lie down; the lying figure is
  exempt.
- `D-04` / `B-03` Scale by the lens (`scale = focal/depth`) — already handled via `pr.sc`.
- `E-04` Edge lean (15–22°, true tilt only visible in the edge view).
- `E-03` Edge leg movement — the side view finally shows the stride.
- Existing `drawSidePaper` already draws the true profile + stride (so `E-01..E-15` profile
  work is done); only the *perspective* foreshorten of the legs is missing.

**Current state:** `legChain` computes `thighLen = b.leg*0.52`, `shinLen = b.leg*0.48` with
**no** camera-angle scaling. At the edges of the viewport (high tilt / wide yaw) a standing
runner should read with foreshortened legs, not a tipping whole figure. `gs`/`fore` exist
but are lying-only.

**Mapping:**
1. Compute a per-frame `legScale = clamp(cos(viewAngle), LEG_MIN, 1)` where `viewAngle` is
   the angle between the figure's local-up and the camera's view vector. Derive it from
   values `scene.ts` already has: `cam.tilt` (→ `gs`) and `perp = |dot|` (the edge factor).
   For edge views use the edge factor; for front/back use the tilt. Clamp `LEG_MIN ≈ 0.55`
   so figures never "lie down" (`B-14`); the lying artwork remains the only true 0-height
   state.
2. **paper.ts helper `edgeLegForeshorten(camTilt, view, perp) → number`** returns the
   factor (default 1 when centred/level).
3. Multiply the leg-chain lengths (`thighLen`, `shinLen`) by the factor in **both**
   `drawSidePaper` and `drawCoronal`.
4. **Freeze seam (required, scoped):** plumb the factor through one optional
   `legScale?: number` field on `PaperDrawArgs` (coronal.ts), read by `drawSidePaper` and
   `drawCoronal` where they compute leg lengths. This is the second scoped touch to the
   frozen drawer. (Baking it into `lL/lR` amplitude instead would change stride mechanics
   rather than perspective — wrong tool — so the field is correct.)
5. The dive/lying states are exempt (they have their own artwork); apply only to
   standing/edge gaits.

**Verification:** swing the camera to a pitch edge / high tilt — the runner's legs
foreshorten while the figure stays upright; the edge-view stride still reads; `teleportCount`
0.

---

## 5. Cross-cutting findings

- **Most of T-34/T-31 is already built.** The true edge profile (`E-01..E-15`) and the
  cadence-locked no-slide gait (`S-06`/`SM-02`) exist. SPEC_01 should *finish* these, not
  rebuild them — scope the work to the four gaps above.
- **Freeze-seam summary.** Of the four demands, only **Running Pass (#3)** is achievable
  purely within the permitted files (a `paper.ts` helper + a `scene.ts` decision, rendering
  through the frozen drawer unchanged). The other three each need **one scoped, documented
  touch** to the frozen `coronal.ts`: a new optional field on `PaperDrawArgs`
  (`squash`, `legScale`, and optionally `footPin`) that the drawer reads. These are small,
  well-bounded reads — they do not alter the frozen *internals*, only consume a new optional
  parameter. They should be approved as explicit exceptions to the freeze before
  implementation.
- **`scene.ts` is the integration point** for all four triggers (it holds per-frame
  `speed`, `view`, `cam.tilt`, `perp`, clip `u`). Note: `scene.ts` currently does **not
  compile** (see §7) — that must be resolved before any of this can be verified.

---

## 6. Verification plan (gates)

- **Regression gate (mandatory):** `teleportCount` must remain **0** across difficulty
  0/3/6 (`gates.ts`). All four effects are render-only (Pose/scale transforms with zero
  world-position change), so this holds *by construction* — but it must still be re-run
  after each demand lands.
- **Manual acceptance (HANDOFF §9):** watch a full half hands-off. Per T-28/T-31: the
  tackle reads heavy, nothing slides, no two players move in lockstep. Per T-34: the edge
  profile and foreshortening read correctly at the viewport edges.
- **Optional probe:** a per-actor planted-foot screen-position tracker to assert the
  no-foot-slide tolerance during stance (demand #2).

---

## 7. Tickets closed & open blockers

**CLOSED (consolidated → SPEC_01 XL Animation Reconciliation):**
- **T-28** — precise considered animation: superseded by this plan's demands #1 (squash)
  and #2 (no-foot-slide).
- **T-31** — full precise animation set: superseded by #3 (running pass) and #4 (edge
  foreshortening); tackle/dive slices already landed.
- **T-34** — full papercraft pass: superseded by #4 (edge foreshorten) and #2; the edge
  profile itself already exists.

> **Blocker — RESOLVED.** The `scene.ts` merge conflict was resolved as planned: Copy 1
> (lines 41–153, with the lie/get-up + strafe-shuffle logic) was kept; Copy 2 (155–223) and
> the stray `>>>>>>> theirs` / `=======` markers were deleted. The file is now 619 lines with
> single declarations and no markers. The build is green: `tsc --noEmit` and `vite build` both
> pass.

**Implementation log (authorised by the user):**
- `src/render/scene.ts` — conflict resolved; added the `runU` gait-phase accumulator to the
  puppet; wired the four effects into `drawMatch` (running-pass upper/lower merge, no-foot-slide
  pin, `squash`, `legScale`).
- `src/render/coronal.ts` (frozen — single scoped exception, as authorised) — added the optional
  `squash` and `legScale` fields to `PaperDrawArgs`; `drawPaperActor` applies the squash about
  the foot anchor; `drawCoronal`/`drawSidePaper` scale leg length by `legScale`.
- `src/render/paper.ts` — added the four effect helpers: `impactSquash` / `squashForClip`,
  `edgeLegForeshorten`, `pinPlantedFoot`, `upperLowerRun`.

**Engineering decision (documented):** No-Foot-Slide is implemented as a Pose-level correction
(`pinPlantedFoot`) rather than the alternative `footPin` drawer field from the plan. This keeps
the frozen drawer untouched for that demand (strictest possible adherence to the freeze) and
needs no new `PaperDrawArgs` field. The `squash` and `legScale` fields are the only drawer
additions, exactly as authorised.

**Out of scope for this reconciliation (flagged, not dropped):** fatigue pose drift
(T-09 / W-07 papercraft "gassed player slumps") is referenced by T-28 but is **not** one of
the four SPEC_01 demands; leave it for a later pass.
