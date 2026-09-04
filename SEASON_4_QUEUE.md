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
