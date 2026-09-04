# SEASON 4 — PREVIEW RELEASE POLISH

Opened after Season 3 shipped 9/9 gates (PR #10). Operating rules unchanged:
**Measure First**, **Halt and Review**, **No Scope Creep**.

Status: **DRAFT — awaiting human review. No live engine code written.**

---

## SPEC_21 — PREVIEW ANIMATION POLISH

Four defects raised from visual QA. All four have been **measured before
planning**, per Measure First. Three diagnoses are confirmed. **One (Item 3) is
partially falsified and carries a pushback.**

### Summary of measured findings

| # | Defect | Diagnosis as ruled | Measurement verdict |
|---|---|---|---|
| 1 | Leaning Tower skew | 2D shear slants players | **CONFIRMED** — 14.90° apparent tilt at max |
| 2 | Missing side crotch | Draw path fails to connect leg roots | **CONFIRMED, but different cause** — the notch apex overshoots 5 mm *above* the root |
| 3 | Flat Puddle dive | `squashForClip()` interaction | **PARTIALLY FALSIFIED** — squash max is 14.5%, cannot make a puddle. See pushback |
| 4 | Kickoff debug text | Debug text over kicker | **CONFIRMED**, and it is not debug text — it is live gameplay UI. See note |

---

### Item 1 — the 3/4 "Leaning Tower" skew

**Site:** `src/render/coronal.ts:816-819`, `src/render/paper.ts:799-804`.

**Confirmed.** The transform applied is

```js
ctx.transform(a.tq.narrow, 0, -Math.tan(a.tq.shear) * sg, 1, 0, 0);
```

The third argument is the `c` term of the affine matrix — an **x-shear
proportional to y**. Every point is displaced sideways in proportion to its
height, so the figure leans. Measured:

| facing angle | shear (rad) | head lateral offset @1.8 m | apparent tilt |
|---|---|---|---|
| 10° | 0.0227 | 0.041 m | 1.30° |
| 30° | 0.1477 | 0.268 m | 8.46° |
| 45° | 0.2373 | 0.435 m | **13.60°** |
| ≥55° | 0.2600 | 0.479 m | **14.90°** (saturated) |

At the 55° edge-in threshold the head is displaced **0.479 m** — most of a body
width — off the vertical through the feet. That is the Leaning Tower exactly as
the Lead Designer reports. The existing comment at `paper.ts:780` even
acknowledges *"the shear alone only skews"*, so the narrowing term was added as
a partial compensation, but the shear was never removed.

**Ruling accepted in full.** Mathematical proposal in the section below.

---

### Item 2 — the missing side-profile crotch

**Site:** `src/render/coronal.ts:588-604` (the `sqp` shorts card).

**Confirmed as a defect, but the mechanism is not "failing to connect".** The
bridging polygon the ruling asks for **already exists** — the `sqp` card spans
from `-rtS.sideHalf` to `+rtS.sideHalf` and does connect both roots. The gap
comes from the **SPEC_17 crotch notch cutting too deep**:

```
rootY 0.9400   hem 0.8900   notch apex 0.9450
```

The notch apex sits **5.0 mm ABOVE the leg-root line**, identical across all ten
builds (the side card uses a fixed `sideHalf = 0.099`, so the figure is not
build-dependent here). SPEC_17 introduced that V deliberately to stop the skirt
bridging the legs into one "melon" mass. It over-corrected: the V now rises past
the roots and bites a wedge out of the pelvis, so the two legs are visually
severed at exactly the point they should join.

This matters for the fix. Adding a *second* bridging polygon on top of the
existing card, as the literal ruling implies, would re-create the SPEC_17 melon
that the notch was introduced to solve. The correct fix is to **clamp the notch
apex to sit strictly below the root line**, preserving the division while
restoring continuity.

**Proposed:** `notchY = min(hemS + 0.055, rtS.y - CROTCH_MIN_DEPTH)` with
`CROTCH_MIN_DEPTH ≈ 0.012 m`, i.e. the apex is guaranteed 12 mm below the roots.
This keeps a visible notch (the anti-melon property) while closing the sever.

**Verification:** re-run the SPEC_18.1 silhouette-fusion shot sheet. The pass
condition is two-sided — the legs must **neither fuse (SPEC_17) nor sever
(SPEC_21)**.

---

### Item 3 — the "Flat Puddle" dive & tackle — ⚠️ PUSHBACK

**The squash diagnosis does not survive measurement.** Measured worst-case
squash on every impact clip, including the maximum footfall squash stacked
multiplicatively on top:

| clip | worst `sy` | with max footfall | height loss |
|---|---|---|---|
| `diveFront` | 0.9200 | 0.8648 | 13.5% |
| `tackleHit` | 0.9100 | 0.8554 | **14.5%** |
| `ruckCommit` | 0.9400 | 0.8836 | 11.6% |
| `scrumShove` / `scrumBind` | 0.9000 | 0.8460 | 15.4% |

The absolute worst compression available anywhere in the system is **15.4%**,
and on the two clips actually named in the ruling it is **13.5% and 14.5%**. A
figure retaining 86% of its height is not a puddle. `combineSquash` is also
already doing its job — it is a Season 3 mechanism specifically built to stop
double-compression, and it holds.

**A 14.5% squash cannot produce the reported defect. Something else is
flattening the figure.** Modelling the full `ctx` transform stack as matrices
and measuring a 1.8 m spine through it:

| state | spine length | shoulder width |
|---|---|---|
| upright, no squash | 1.800 (nominal) | 0.500 (nominal) |
| upright, squash | 1.557 | 0.541 |
| mid-fall 0.5, squash | 1.762 | 0.489 |
| **full fall (lying), squash** | **1.946** | **0.432** |
| full fall, squash + 3/4 | 1.697 | 0.452 |

The figure does not lose length when it falls — it *gains* it (1.946). The
volume loss is in **width**: 0.500 → 0.432, a **13.6% narrowing**, and → 0.452
with the 3/4 term. This is the signature of a **non-commuting transform order**
at `coronal.ts:803-830`. The stack is

```
scale(FIGURE_SCALE) → scale(squash.sx, squash.sy) → shear(lean) → shear/narrow(tq) → rotate(fall)
```

The `rotate(spin)` for the dive is applied **last, inside an already
non-uniformly scaled frame**. A rotation composed with a preceding anisotropic
scale is not a rotation — it is a rotation *plus* a shear, and the figure's
Y-axis extent is not preserved through it. The squash was authored to act about
a *vertical* axis on an *upright* figure; once `fall` rotates the card toward
horizontal, the squash's y-compression is acting along what is now the figure's
**length**, and its x-expansion along the figure's **thickness**. The axes have
swapped underneath it.

So the ruling's instinct — "unintended interaction between horizontal rotation
and `squashForClip()`" — **is directionally right, but the fix as specified
(disable the squash) treats the symptom.** Disabling squash on dive/tackle
removes at most 14.5%; the order-of-composition error would remain and the
figure would still deform when rotated.

**Two candidate fixes, for your ruling:**

- **(3a) Order correction — preferred.** Apply `rotate(fall)` **before** the
  squash, or equivalently apply the squash in the figure's *own* rotated frame,
  so y-compression always acts along the figure's true vertical. Preserves the
  impact squash on dives (an airborne player hitting the ground *should* squash)
  and fixes the actual cause. Larger blast radius: the transform stack is shared
  by all six views.
- **(3b) Ruling as written — narrow.** Gate the squash off when
  `q.fall > threshold`. Small, safe, and removes the 14.5%. Does **not** fix the
  0.500 → 0.432 width loss, which is the larger term.

**Recommendation: 3a, with 3b as fallback if 3a destabilises the lying-art
seam.** I have not written either. Awaiting your call.

---

### Item 4 — kickoff on-pitch text

**Site:** `src/ui/MatchView.tsx:766` and `:772-774` — not the render layer.

**Confirmed present**, with one correction to the diagnosis: **this is not debug
text.** It is deliberate, styled gameplay UI:

- `` `${reach} m · ${power}% POWER` `` — the kick-power readout at the landing ellipse
- `HOLD SPACE TO BUILD POWER` — the control prompt during the `AIM` stage

Both sit inside the documented "KICK AIM LINE" block whose comment reads *"The
line drawn on the grass IS the kick"*. They are the player's only numeric
feedback on kick power, and the second is the only on-screen instruction for the
kick control.

The separate `HANG … · APEX … · … m` string the QA note quotes is at
`src/render/scene.ts:558-559`, in `drawKickOverlay` — a **different file and
subsystem** from the POWER text. The ruling treats them as one item; they are
two.

**This is a design decision, not a bug fix, so I am not making it unilaterally.**
Options:

- **(4a)** Remove all three strings, as ruled. Cleanest for a preview trailer;
  loses the kick tutorialisation and the power readout.
- **(4b)** Remove the post-kick telemetry (`HANG/APEX/distance`, `scene.ts:558`)
  which *is* analytical readout, and keep the two live control strings.
- **(4c)** Keep all, gate behind an existing debug/telemetry flag.

**Recommendation: 4b** — it removes what reads as debug (flight telemetry) and
keeps what the player needs to operate the kick. If the preview is a
non-interactive capture, 4a is correct instead. **Please confirm whether the
preview is played or recorded**, as that decides this item.

---

## Sequencing

1. **Item 4** — text (trivial, zero risk, unblocks capture) — *pending 4a/4b/4c ruling*
2. **Item 2** — notch clamp (one-line, bounded) — *ruling accepted, mechanism corrected*
3. **Item 1** — shear → foreshorten (contained, one transform) — *ruling accepted*
4. **Item 3** — transform order (largest blast radius, do last) — *pending 3a/3b ruling*

## Gate policy

All **9 Season 3 gates must still pass** at 100 frames, across the 5 seeds × 3
difficulties sweep established in Season 3. No gate threshold moves in Season 4.
Items 1 and 3 touch the transform stack that `CAMERA STABLE` and the SPEC_18.1
fusion shot sheet observe, so both must be re-run, not assumed.

Additional SPEC_21 verification:

- **Verticality:** max apparent tilt of the spine across the facing sweep must be **0.00°** (Item 1).
- **Volume:** spine length and shoulder width through the full `fall` sweep must stay within **±5%** of nominal (Item 3).
- **Silhouette:** legs neither fuse nor sever across all gaits and builds (Item 2).

---

## SPEC_21 — SHIPPED

All four items executed live. `tsc --noEmit` clean. **9/9 Season 3 gates pass**,
**15/15 seed x difficulty combinations clean**, SPEC_06 hysteresis intact, and a
new `scripts/spec21verify.ts` adds four SPEC_21-specific gates. Shot sheet:
`spec21_shot.png` (six rows; rows 3 and 6 are the new evidence).

### Item 1 — 3/4 foreshortening (shear removed)

`paper.ts`: `ThreeQuarter` is now `{ narrow }`; `TQ_SHEAR_MAX` **deleted**
(not zeroed, so it cannot be mistaken for a knob). `coronal.ts` applies
`ctx.scale(a.tq.narrow, 1)` — a pure horizontal foreshortening.
`tqSign` deleted throughout: a symmetric scale has no side to pick.

| facing | before (tilt) | after |
|---|---|---|
| 30° | 8.46° | **0.00°** |
| 45° | 13.60° | **0.00°** |
| ≥55° | 14.90°, head 0.479 m off | **0.00°** |

Measured max tilt over the full 0–180° sweep: **0.000000°**. The spine maps to
itself exactly, so verticality is structural, not tuned. `TQ_NARROW = 0.86`
floor retained as ruled. Kinetic lean shear retained.

### Item 2 — crotch notch clamp

`notchY = min(hemS + 0.055, rtS.y - CROTCH_MIN_DEPTH)`, `CROTCH_MIN_DEPTH =
0.012`. Apex moves 0.9450 → 0.9280, from **5 mm above** the roots to **12 mm
below**. Verified on all ten builds: notch still visible (anti-melon holds) and
no longer severing. No new polygon, as ruled.

### Item 3 — transform reorder

Stack changed from `FIG · SQUASH · LEAN · TQ · MIRROR · ROT(fall)` to
**`FIG · MIRROR · ROT(fall) · SQUASH · LEAN · TQ`**, so squash/lean/tq evaluate
inside the figure's own rotated frame. The mirror moved outermost, so the lean
shear is multiplied by `mirror` to preserve its on-screen direction.

Spine / width through the fall sweep at max tackle squash:

| fall | OLD spine | OLD width | NEW spine | NEW width |
|---|---|---|---|---|
| 0.00 | 1.540 | 0.543 | 1.540 | 0.543 |
| 0.50 | 1.760 | 0.489 | 1.540 | 0.543 |
| 0.98 | 1.956 | 0.428 | **1.540** | **0.543** |

Drift from the figure-frame expectation is **0.0000%** at every angle, across
both views, both mirrors and four facing angles. The squash still fires on
impact — it was never the cause, and removing it (option 3b) would have left
the 13.6% width loss untouched.

### Item 4 — flight telemetry removed

`scene.ts:558` `HANG … · APEX … · … m` deleted. Kick-type label kept (it names
the player's chosen kick). `MatchView.tsx` power readout and control prompt
untouched, as ruled.

### Verification note

The first draft of the SPEC_21 volume gate was **wrong and was corrected**: it
compared the squashed figure against unsquashed nominal, so it reported 14.46%
"failure" that was simply the tackle squash doing its job. The gate now asserts
the correct property — that measured proportions match the figure-frame
expectation *invariantly with fall angle*.

### Pre-existing, not introduced

The T-16 sweep row `diff 3 teleport = 1` is **pre-existing**: `git stash` +
re-run produced a byte-identical table. It sits in the unseeded fault-hunt
sweep, not the seeded gate run, and all 15 seeded combinations are clean.

---

## SPEC_22 — SILHOUETTE BREATHING & ARM FLARING (DRAFT, awaiting review)

Diagnosis complete, math proposed, **no live engine code written**. Full detail
in `SPEC_22_MATH.md`.

**Root cause found: `abL`/`abR` are the constant `0.08` in every keyframe of
`walk`/`jog`/`run`/`sprint`.** The straight-line gaits inherit `STAND` and never
modulate abduction, so there is no oscillating lateral elbow term in the rig at
all. The stiffness is structural, not a tuning shortfall.

Measured, build `CENTRE`:

| metric | measured |
|---|---|
| frames with ANY elbow/torso daylight | **0 / 240**, all four gaits |
| best case (run) | **−0.0316 m** — still 3 cm of overlap |
| silhouette breath, run @ sc 20 | **0.60 px** over a full stride |
| frames where the arm defines the outline | 240 / 240 |

So the outline is arm-driven but frozen: at mid distance it varies by 0.60 px,
below the renderer's own quantisation.

**Proposal:** add `gaitFlare = (AB_BASE + AB_SWING·|sin(a_s)|) · speedGate ·
carryWeight_s` to `ab` in the coronal draw path — not the IK, because the coronal
arm is forward-kinematic and has none. Driven by the arm's own authored angle so
it cannot desync from the clip; `|sin|` is even, so it breathes twice per stride.
Reuses SPEC_18.5's speed gate and `carryLock` suppression.

Recommended `AB_BASE = 0.26`, `AB_SWING = 0.30`: daylight goes to **≥1.28 px on
every frame of every gait**, breath to **1.84 px @ sc 20 / 3.13 px @ sc 34** on
run. Worst-case total abduction 0.640 with the turn flare, inside the 0.72–0.80
the `shuffle` clip already authors.

Two caveats carried into the review deliberately: breath is real but **modest**
(§2.4a), and an intermediate probe of mine printed a **wrong "antiphase arms
cancel" conclusion which is retracted** in §2.4b — its own data contradicts it.

---

## SPEC_22 — SHIPPED

Live. `tsc --noEmit` clean. **9/9 Season 3 gates**, **15/15 seeds**, SPEC_21
gates, SPEC_06 hysteresis all still pass. New `scripts/spec22verify.ts` adds
seven SPEC_22 gates. Shot sheet: `spec22_shot.png` (eight rows; the last two are
FLARE ON vs FLARE OFF over the same four frames).

### Implementation

`paper.ts` gains the pure helper and three constants:

```
gaitFlare(aa, spd, carryW) = (AB_BASE + AB_SWING·|sin(aa)|) · smoothstep(spd; 1.5→3.5) · carryW
AB_BASE = 0.26   AB_SWING = 0.30   AB_MAX = 0.72
```

`coronal.ts` `drawOneArm` composes it additively with the SPEC_18.5 turn bias on
the same `ab` channel, then clamps: `abEff = min(AB_MAX, ab + abGait + abBias)`.
Both terms share the same `flareW = 1 − carryLock`, so a ball-locked arm is
suppressed identically by both. `scene.ts` passes `spd: pg.spd` — the same speed
the gait chooser and footfall squash already read, so flare, clip and thud
cannot disagree.

### Measured result (real drawn ink extent, not a re-modelled probe)

| gait | breath before | breath after @20 | @34 |
|---|---|---|---|
| walk | 0.25 px | 3.83 px | 6.51 px |
| jog | 0.38 px | 2.91 px | 4.95 px |
| run | **0.60 px** | **4.50 px** | **7.66 px** |
| sprint | 0.73 px | 5.69 px | 9.68 px |

Lateral daylight, the headline defect:

| gait | before | after | frames with daylight |
|---|---|---|---|
| jog | −0.0199 m | **+0.0388 m** | 480/480 |
| run | −0.0316 m | **+0.0391 m** | 480/480 |
| sprint | −0.0307 m | **+0.0398 m** | 480/480 |

From **0/240 frames with any daylight** to **100% of frames on every gait above
the speed gate**.

### Two corrections to my own SPEC_22 spec

**(1) The breath is 2.4x larger than I predicted.** I forecast 1.84 px @20 on
run; measured 4.50 px. The design-sweep probe modelled only the upper-arm card's
own outer edge, whereas the shipped gate measures the true ink extent of every
polygon the drawer emits — which includes the forearm and hand, both carried
further out by the flared elbow. The prediction was conservative because the
probe was narrower than the drawing. My §2.4(a) caveat that the effect might be
too subtle is therefore **withdrawn**: the delivered effect is comfortably
visible, and notably it did NOT require raising the constants past the approved
values.

**(2) Two of my own proposed gates were mis-specified and were corrected, not
worked around.**

- *Smoothness.* My first Gate 5 compared raw per-frame silhouette change against
  a flat 1.0 px budget and "failed" at 44 mm/frame. Measuring the same figure
  with the flare DISABLED gave **53.9 mm on run and 49.3 mm on sprint — larger**.
  The threshold was measuring limb cadence at 60 fps, not a pop. The gate now
  asserts the property that matters: the flare must not increase the worst
  per-frame change (it does not), plus C0/C1 continuity of `gaitFlare` in both
  inputs (3.0e-5 and 3.8e-5 per 1e-4 step) and zero discontinuity across the
  clip loop seam (0.0000 mm).
- *Daylight scope.* §3.1 asked for daylight on "all four gaits". Walk is 1.6 m/s,
  barely above `W_GATE_LO = 1.5`, so the **ruled** speed gate holds the flare at
  ~0 there by design. Asserting daylight at walking pace would mean defeating
  the ruling. The gate now asserts only where the speed gate is engaged and
  reports walk for information.

### Constants

`AB_BASE = 0.26`, `AB_SWING = 0.30`, `AB_MAX = 0.72` — all exactly as approved.
Worst-case total abduction with the turn flare stacked is **0.7200**, held by the
clamp, inside the 0.72–0.80 the `shuffle` clip already authors.

---

## RC2 HOTFIXES — SHIPPED

Five QA defects. `tsc --noEmit` clean; **9/9 Season 3 gates**, **15/15 seeds**,
SPEC_21, SPEC_22 and SPEC_06 hysteresis all still pass. Shot sheets:
`rc2_shot.png` (run), `rc2_sprint.png` (sprint — the worst case for #1).

Per the directive, **no new automated gates were written for the visual fixes**;
each rests on structural mathematics, verified by one-shot measurement.

### 1. Side-view crotch gap — cause was NOT the notch

The ruling assumed the SPEC_21 clamp left the polygon short of the roots. It was
larger than that: `legChain` roots each leg at `hy = hy0 - lift`, where
`sideLift` drops the pelvis to keep the lower foot on the turf. **The shorts card
never applied that lift.** Measured gap between the notch apex and the *drawn*
root:

| gait | gap |
|---|---|
| walk | 0.049 m |
| jog | 0.082 m |
| run | 0.174 m |
| **sprint** | **0.279 m** |

At sprint the drawn hip sat 28 cm below the fabric — the legs walked out of
their own shorts. Both hem and notch now hang from `rootS = rtS.y - sideLift`,
and the card is pushed a further `CROTCH_OVERLAP = 0.045` below it so it
positively overlaps the thigh tops. Verified across 10 builds x 4 gaits: worst
case the card reaches **0.095 m BELOW** the root — zero daylight everywhere. The
V survives, so SPEC_17's anti-melon property is intact.

### 2. Arm clipping and z-sort popping — two discontinuities on one frame

Both halves confirmed and both fixed.

- **Anchor.** `shHalf * 0.9` rooted the arm **0.0225–0.0290 m inside** the torso
  edge on every build, so the card straddled the outline. `SHOULDER_ANCHOR = 1.0`
  puts the joint on the edge; the arm swings beside the body.
- **Shade.** The real pop was in `pairShade`. Its `sign` term is a step function
  and the 0.85 floor holds right up to the crossing, so the two arms **jumped
  past each other** — measured `#a42121 <-> #c92929` swapping in a single frame,
  landing on the same frame as the layer swap. Replaced the step with a smooth
  odd ramp across a tight `LIMB_FADE_BAND = 0.06`; the shades now converge
  continuously (to `#b62525` at the crossing) instead of leaping.

**SPEC_18.1 regression checked, because this trades against it.** Inside the band
the limbs do converge — but the fade only applies where they are at the same
depth. Arms sit on opposite sides of the torso and cannot fuse. For the legs,
which genuinely do cross, I measured colour-fusion AND spatial overlap together:
**0 frames** where legs both fuse in colour and overlap in space. The anti-fusion
intent holds.

### 3. Kickoff delay of game

Confirmed: `AIM`/`METER` had **no timeout on the human path** — every other stage
is bounded (FANFARE 2.2/4.2 s, WALKUP 5.0 s), so this was the one open end and
`s.t` accrued forever. Added `RESTART_SHOT_CLOCK = 15 s`, scoped to
`RESTART`/`DROP_OUT`, sanctioned as `FREE KICK — TIME WASTING AT THE RESTART`
through the existing `beginPenalty(..., free = true)` path.

Two deliberate constraints: the clock **does not run while the kicker is lawfully
blocked** (opposition not back ten, formation not set), and 15 s leaves **7.4 s
of headroom** over the 7.6 s a maximum aim sweep plus full charge actually needs.

### 4. Referee ruck warning — DIAGNOSIS CORRECTED

**The ruck warning never blew a whistle.** It is a silent `showHint` at
`breakdown.ts:47` and always has been. There are exactly five whistle call sites
in the game; four are genuine stoppages (try, card, law call, TMO). The only
non-stoppage whistle was the **maul USE IT cue** in `setpieces.ts` — that is the
one that breaks immersion, and it is what the ruling describes.

So I applied the ruling's *intent* to the real site and the ruling's *letter* to
the named one:

- Added `audio.shout()` — a band-passed noise bark sweeping 900 -> 420 Hz,
  deliberately unlike the 2093/2333 Hz whistle. At −22.3 dBFS it sits **11.0 dB
  below** the whistle, so D-5's "whistle is the peak" ruling is preserved and the
  worst-case sum stays at −5.6 dBFS with no clipping.
- The maul USE IT cue now shouts instead of whistling. Play does not halt.
- The ruck warning text is now **"NO MORE HANDS!"** as ruled, spoken by the
  referee, and it **gains audio it never had** — previously a defender could be
  penalised on a second attempt with no audible warning of the first.

### 5. Anti-skating

The divisors were already correct: above the floor, stride length is **exactly
constant** (walk 1.300 m/cycle, jog 2.100, run 2.900, sprint 3.600). The skating
came from the `Math.max(...)` **floors**, which kept the clock running when the
ground was not moving — at `v = 0` every gait still cycled at 0.30–0.60 cycles/s,
and sprint was floored all the way up to 2.16 m/s.

Any non-zero floor breaks `du/dt ∝ |v|` by construction, so they were removed
rather than lowered. Also fixed two the brief did not mention: **`shuffle` ran at
a fixed 1.0 cycles/s** — identical at `v = 0` and `v = 9`, the purest skate in
the table — and `strafe` carried its own 0.5 floor.

Verified structurally: stride length now invariant at every speed for every
gait; `rate(0) === 0` exactly for all seven moving clips; and
`rate(2v) === 2·rate(v)` to `0.0e+0`.

---

## SPEC_23 — SIDE-PROFILE RE-SEGMENTATION (RC3) — SHIPPED

`tsc --noEmit` clean. **9/9 Season 3 gates**, **15/15 seeds**, SPEC_21, SPEC_22
and SPEC_06 hysteresis all still pass. New `scripts/spec23verify.ts` adds five
gates. Shot sheets: `rc3_sprint.png` (worst case), `rc3_run.png`.

### Root cause: my own RC2-1 fix. The card STRETCHED instead of TRANSLATING.

RC2-1 lifted the shorts card's BOTTOM onto the lifted root but left its TOP at
the unlifted `rtS.y + 0.07`, so the height grew 1:1 with `sideLift`:

```
cardH = 0.165 + sideLift
```

| gait | drawn shorts block | shorts / (shorts + thigh) |
|---|---|---|
| walk | 0.154 m | 28% |
| run | 0.349 m | 50% |
| **sprint** | **0.459 m** | **60%** |

A 2.98x range on a block that should be rigid — that elongated white rectangle
IS the "long crotch". A pelvis is a rigid body: when the hips drop, the whole
garment drops. Both edges now take the lift and the height is **exactly constant
(0.1650 m, 0.000 mm variation)** at every gait.

### Second, independent cause: the thigh had no value of its own.

The thigh `limbCard` was `depthShade(pal.shorts, 1)` — byte-identical to the
shorts card beside it (palette A shorts are `#f0ece0`). Waist-to-knee was **one
unbroken white mass**, so the only edge in it was the stretched card bottom
floating at mid-thigh. That is precisely the "artificial seam at mid-thigh" QA
described, and it explains why the seam sat nowhere near a joint.

`thighShade()` now steps the thigh off the garment, so the hem reads where cloth
ends and the geometry's only other break is the knee — which `legChain` already
computes from the same `thighLen` the kinematics use, so seam and joint coincide
by construction (ruling 4) rather than by tuning.

### A trap this fix had to avoid

Making the card rigid re-opened the defect at the other end: with the top no
longer stretching, a constant height left the **waist** bare once `sideLift`
exceeded 0.145 m — measured **0.186 m of daylight at PROP/sprint**. Fixing one
edge of a garment while leaving the other pinned is exactly the mistake that
produced this ticket. The jersey hem now follows the waistband too (shoulders
stay anchored; cloth hangs), with `JERSEY_OVERLAP` so it overlaps rather than
butts. Verified: **−0.020 m worst case, i.e. always overlapping.**

### Results

| gate | result |
|---|---|
| 1 — card height constant | 0.1650 m, **0.000 mm** variation, all gaits |
| 2 — anatomical ratio vs true thigh | **25%** flat (ref ~27%; was 60%) |
| 3 — RC2-1 not regressed (crotch daylight) | −0.095 m worst — still zero daylight |
| 4 — no new waist gap | −0.020 m worst — jersey always overlaps |
| 5 — thigh distinct from shorts | 1.32 / 1.32 / **1.31** contrast (A / B / REF) |

Ruling 1 verified **structurally, not by inspection**: a diff-range check
confirms **zero changed lines inside `drawCoronal`** (lines 231-523). Every edit
is inside `drawSidePaper` or a module-level constant.

### Two corrections to my own work

1. **`PELVIS_H` 0.165 -> 0.12.** The card also carries `CROTCH_OVERLAP` (0.045)
   below the hem, so the drawn block is `PELVIS_H + 0.045`. My first value
   reproduced RC2-1's rest height and left sprint at 49%.
2. **`THIGH_STEP` constant -> `thighShade()`.** `shade()` is multiplicative, so
   one factor cannot serve every kit: 0.88 gave 1.32 contrast on white shorts
   but only **1.068** on the referee's near-black `#23232c` — you cannot darken
   black. The step is now chosen by the garment's own luminance (new pure
   helper `relLuminance` in `paper.ts`), landing all three palettes at ~1.31.

### A third mis-specified gate, corrected

My first Gate 2 divided the rigid card by the **projected** thigh and failed
sprint at 43%. Bad comparison: at u = 0.50 the near thigh is swung **51°** out
of the drawing plane, so `cos(51°) = 0.624` shortens it to 62% of its length. A
thigh pointing at the camera *must* draw shorter — that is SPEC_17 depth
foreshortening working correctly. Measuring a rigid card against a foreshortened
limb makes correct perspective look like a defect. The gate now compares against
the thigh's true length and reports the projected figure for information.
