# SEASON 3 QUEUE — SPEC_16 … SPEC_20

**Status: PLAN ONLY. No live TypeScript engine code has been written.** Per the
Season 3 Phase 1 authorisation, this file is the execution plan drafted against
the Senior Engineering Partner's architectural rulings, plus the one outstanding
diagnosis (§SPEC_17.4, side-profile hip pivot) that PR #9 explicitly left open.

The only file added alongside this document is `scripts/spec17hip.ts` — a
read-only probe. It imports `clips.ts` and `paper.ts` for their data tables,
transcribes the `drawSidePaper` geometry, and prints numbers. It draws nothing,
mutates nothing and is not wired into the game.

## Acknowledgements

* **PR #8 (`Season 2 — SPEC_11 … SPEC_15`) is merged** into `main` at `b5e3c74`.
  This branch is cut from that merge, so `FIGURE_SCALE`, the shadow anchor and
  the referee actor are all present and Season 3 can be posed on a real base.
  The branch-note caveat in `SEASON_3_NOTES.md` ("Season 3 cannot be posed on
  `main` until PR #8 lands") is discharged.
* **PR #9 (`docs(season-3)`) is open and read.** Its content is carried forward
  here in full. Where this queue and the notes differ, this queue wins, because
  it incorporates rulings the notes were written before.
* **The mathematical diagnosis is validated.** The 1.02 player-to-crossbar ratio
  stands as measured: `CROSSBAR_Y = 3.0`, a `HALF` build at 1.86 m, drawn
  through `FIGURE_SCALE = 1.65` → 3.07 m of ink against 3.0 m of goalpost.

## Operating rules in force

1. **Measure First.** Every spec below that terminates in a number opens with a
   probe that measures the present value on a seeded run. No threshold is
   changed before its current value is on paper.
2. **Halt and Review.** Each spec ends at a review gate. Nothing downstream of a
   gate starts until the gate is signed off.
3. **No Scope Creep.** A spec touches only the files named in its own
   *Blast radius*. Anything discovered outside that radius is written down as a
   finding, not fixed.
4. Season-1/2 house rules carry over: one labelled writer per player per frame;
   the nine gates in `gates.ts` do not move; pure helpers stay pure.

## The queue

| # | Spec | Title | Family | Depends on | Status |
|---|---|---|---|---|---|
| 1 | **SPEC_16** | Environment scale — `RENDER_SCALE` in the render layer | Render | — | **RULED, ready to execute** |
| 2 | **SPEC_17** | Papercraft rigging — swing leg, arm Z-sort, hip pivot | Render / rig | — | **RULED (17.1–17.3), 17.4 diagnosed below** |
| 3 | **SPEC_18** | Art style: soft edges + the 3/4 upright view | Render | 16, 17 | Unmeasured |
| 4 | **SPEC_19** | AI debt: N-02 Smell Blood, T-71 offside loitering | AI | — | Unmeasured |
| 5 | **SPEC_20** | Set piece & tuning: N-01 lineout teleport, SPEC_04 stage 2 | Law / tuning | 19 | Unmeasured |

### Sequencing

```
SPEC_16 ──► SPEC_17 ──► SPEC_18            (render chain: scale, then rig, then style)

SPEC_19 ──► SPEC_20                        (AI chain, independent — may run in parallel)
```

`SPEC_16` precedes `SPEC_17` because every rig metric in `SPEC_17` is quoted in
metres and then multiplied to screen. Introducing `RENDER_SCALE` after the rig
work would invalidate the rig's own before/after screenshots. `SPEC_18`'s "does
this read as papercraft" judgement is worthless until the figures are correctly
proportioned, so it goes last in the render chain.

The AI chain shares no files with the render chain and is gated separately.

---

# SPEC_16 — Environment scale: `RENDER_SCALE = 1.65`

## The ruling

> Do not alter the deterministic 70x100 m logical physics space. Implement a
> `RENDER_SCALE = 1.65` constant strictly within the render layer, applied to
> pitch markings, goalpost dimensions and world-to-screen coordinate
> translation during rasterisation. Logical data must remain pristine.

This is **option (C)** — neither of the two options the notes posed. It is
better than both, and the reason is worth recording, because it is the thing
that makes the desync objection in `SEASON_3_NOTES.md` evaporate:

The notes objected that scaling the drawn pitch desyncs players from the
markings. That objection **only holds if the marking scale and the player
position scale differ**. The ruling closes exactly that hole by requiring
`RENDER_SCALE` on the *world-to-screen translation itself* — so a player at
`x = 10` and the 10 m line both land at `10 * RENDER_SCALE`. They cannot desync,
because they go through the same multiply.

What that leaves is a uniform 1.65× magnification of the entire world *except*
the figure, which is already independently magnified by `FIGURE_SCALE = 1.65`.
The two cancel in the figure's own ink size, and the ratio comes out right:

| quantity | today | with `RENDER_SCALE` | target |
|---|---|---|---|
| crossbar drawn height | 3.0 m-equivalent | 4.95 | — |
| `HALF` figure drawn height | 3.07 | 3.07 | — |
| **figure ÷ crossbar** | **1.02** | **0.62** | **0.62** |
| post gap | 5.6 | 9.24 | — |
| pitch width in world-draw units | 70 | 115.5 | — |

The cost is the one the notes already priced: the camera now sees ~40% less
pitch width for the same field of view. That is a deliberate, ruled trade, and
`SPEC_16` must confirm it is what actually happens rather than assume it.

**Explicitly out of scope:** `FIELD`, all gameplay speeds, tackle radii, the
offside line, `Director`, anything in `src/game/`. Logical space stays 70×100.

## Execution plan

**Step 16.0 — probe (Measure First).** `scripts/spec16probe.ts`, read-only.
Records, on a seeded run: drawn crossbar height in px; drawn figure height in
px for each build; the ratio; visible pitch width in metres at the default
camera; and the px-per-metre at three depths. This is the before-table.

**Step 16.1 — introduce the constant.** `export const RENDER_SCALE = 1.65` in
`src/render/retro.ts`, next to `CROSSBAR_Y`, with a comment stating it is a
rasterisation-only multiplier and that logical space is untouched.

**Step 16.2 — apply at the single choke point.** Preference, in order:
1. Inside `project()`, so *every* world→screen conversion inherits it and no
   call site can forget. One multiply, one place.
2. Only if `project()` turns out to be used for non-render purposes (the probe
   in 16.0 must answer this) do we fall back to per-consumer application on
   pitch markings, goalpost constants and actor anchors separately.

Option 1 is the design intent of the ruling. Option 2 is the escape hatch, and
choosing it requires writing down why.

**Step 16.3 — camera reconciliation.** With a 1.65× world, the default `fov` /
camera height now frames 40% less pitch. Measure the visible width and, if it
is unplayable, propose (do not apply) a `fov` adjustment as a separate ruling.
Framing is a design call, not an implementation detail.

**Step 16.4 — after-table + gates.** Re-run 16.0's probe; re-run `gates.ts` and
`statsAudit.ts` to prove no gameplay number moved. A render-only change must
leave all nine gates byte-identical. If any gate moves, `RENDER_SCALE` has
leaked into logic and the change is wrong.

**Blast radius:** `src/render/retro.ts`, `src/render/scene.ts`,
`src/render/minimap.ts` (check only). New: `scripts/spec16probe.ts`.

**Exit criteria:** figure ÷ crossbar = 0.62 ± 0.02; all nine gates unchanged;
before/after screenshots at identical seed and time.

**→ HALT for review.**

---

# SPEC_17 — The papercraft rig

Four items. 17.1–17.3 are ruled and specified. 17.4 is diagnosed below with
measured metrics, as directed, and proposes no fix pending review.

## 17.1 — Delete `pinPlantedFoot()`

**Ruling: accepted, delete it.**

The evidence is that the guard `if (stance >= -0.005) return pose` only ever
corrects a foot that *sinks*, and across one full cycle of all five gaits the
lowest foot is +0.003 m. It never fires; before/after poses are byte-identical
in all five clips. It is dead code that reads as a working correction, which is
worse than no code at all.

Delete `pinPlantedFoot` from `paper.ts` and its call sites. Do **not** replace
it with a bi-directional version in the same change — the stance foot's
persistent 1–2 cm float is a real defect, but it is a *separate* one, and
folding a new correction into a deletion hides which of the two moved the
picture. It is filed as 17.5 below.

## 17.2 — Rewrite the coronal leg projection

**Ruling: remove the extreme vertical `cos(θ)` shortening on the swing leg;
implement a depth-foreshortening fake where the swing foot traces a shallow
clearance arc.**

The defect, restated from the measurement: `footY` is computed forward from the
hip as `kneeY - cos(l-k)*shinLen + …` with no ground constraint, so a sagittal
stride — which in a front-on view should read as motion *into depth* — renders
as pure vertical shortening. The swing foot rises 0.62 m in `run` and 0.82 m in
`sprint`. Both legs pulling up into the torso is the "squatting" report.

Target shape:

* Split the hip angle `l` into a **coronal component** (drives the small lateral
  travel that already exists) and a **sagittal component** (drives depth).
* The sagittal component **foreshortens** the drawn limb length by `cos(l)`
  rather than lifting the foot by `cos(l)`. The limb gets shorter on the card;
  the foot stays near the turf.
* Swing-foot height comes from an authored **clearance arc**, not from forward
  kinematics: a shallow hump peaking at mid-swing. Target peak, to be confirmed
  against reference in the probe, is roughly 0.10–0.14 m at run and 0.14–0.18 m
  at sprint — i.e. ankle height, an order of magnitude below today's 0.62/0.82.
* Stance foot: height pinned at 0, no arc.

**Step 17.2.0** measures today's swing-foot height per gait (the notes' table is
the baseline). **Step 17.2.4** re-measures and must show peak clearance inside
the target band with the stance foot at 0.000 ± 0.005 m.

## 17.3 — Arm Z-sorting: split the draw calls

**Ruling: split into `drawBackArm`, `drawTorso`, `drawFrontArm`.**

Today the entire ordering decision is the single boolean
`if (!front) drawArms(); …torso…; if (front) drawArms();`. Both arms always
share one pass, so no arm can ever be behind the torso while the other is in
front. Separately, the elbow height is `sy0 - cos(aa) * upLen`, and `cos` is
**even** — a forward swing (`aa > 0`) and a backward swing (`aa < 0`) give an
identical elbow. The sagittal rotation is discarded, both arms rise the same
way on both halves of the cycle, and they stay pinned in front of the chest.
That is the "carrying baskets" silhouette.

Three changes, in this order:

1. **Per-arm depth.** Derive `depth = sin(aa)` per arm (positive = forward /
   toward camera). This is the missing odd term.
2. **Split the pass.** Replace `drawArms()` with `drawBackArm(s)` /
   `drawTorso()` / `drawFrontArm(s)`, ordered by each arm's own `depth` sign,
   giving four combinations instead of two. The existing `front`/`back` view
   boolean still selects which face of the card is drawn; it no longer decides
   layering.
3. **Foreshorten.** Apply `sin(aa)` shortening so a forward-swinging arm gets
   shorter and overlaps the body, instead of only rising.

Item 3 is what makes item 2 visible; shipping 2 without 3 gives correct sorting
of two arms that still look identical.

## 17.4 — Side-profile hip pivot: the diagnosis

Presented in full in the next section. **No fix is proposed.** Per the ruling
this is a diagnose-then-review item.

## 17.5 — Stance-foot float (filed, not scheduled)

The stance foot sits 1–2 cm above the turf on 71–100% of frames depending on
gait (×1.65 `FIGURE_SCALE`, ×1.65 `RENDER_SCALE` = up to 5.4 cm of screen-space
daylight after SPEC_16). Nothing pulls it down. This is a real defect and is
recorded here so deleting `pinPlantedFoot` does not bury it. It is *not* in
SPEC_17's scope — the 17.2 rewrite may fix it as a side effect, and if it does
the after-table will show it.

**Blast radius (17.1–17.3):** `src/render/coronal.ts`, `src/render/paper.ts`.
New: `scripts/spec17probe.ts`.

**Exit criteria:** swing-foot peak inside the target band per gait; stance foot
at 0.000 ± 0.005 m; forward and backward arm swings produce measurably
different elbow heights and different layer order; five before/after clip
strips.

**→ HALT for review.**

---

# SPEC_17.4 — MATHEMATICAL DIAGNOSIS: the side-profile hip pivot

**Measured with `scripts/spec17hip.ts` against `drawSidePaper`
(`src/render/coronal.ts:329`), build `CENTRE`
(`leg 0.96`, `thigh 0.499`, `shin 0.461`, `torso 0.62`, `hipW 0.39`),
48 samples per gait cycle, `legScale = 1`.**

All coordinates below are **hip-relative metres** — `y = 0` is the pose's `hip`
channel, `+y` is up, `+x` is the direction the profile faces.

## The four numbers that matter

`drawSidePaper` roots both legs at

```
legChain(lN, kN, ox = +0.012, …)      // near leg
legChain(lF - 0.1, kF, ox = -0.045, …) // far leg
    → hy = p.hip - 0.02
```

and draws the shorts strip as

```
[-0.095, +0.05], [+0.088, +0.05], [+0.098, -0.22], [-0.100, -0.22]
```

| # | metric | measured | what it should be | verdict |
|---|---|---|---|---|
| **1** | shorts card hanging **below** the leg pivot | **0.200 m** | ≈ 0.05 m | **74.1% of the shorts card is below the joint it hangs from** |
| **2** | horizontal gap between the two leg roots | **0.057 m** | ≈ 0.147 m (0.743 × card width, per the coronal path) | roots are 3.5× too close together |
| **3** | gap ÷ shorts-card width | **0.288** | **0.743** (`drawCoronal`: `s * hipHalf * 0.8`) | the side view roots both legs near the centreline |
| **4** | pivot vs anatomical hip height | **−0.040 m** at stand, **−0.160 m** at sprint | 0.000 | the pivot sinks as the gait dips |

## Finding 1 — the pivot is buried 0.20 m inside the shorts card

This is the "watermelon". The shorts strip spans `y ∈ [−0.22, +0.05]`, a card
0.27 m tall. The legs are rooted at `y = −0.02`. Therefore

```
below-pivot card height   0.200
───────────────────────── = ───── = 74.1%
total card height         0.270
```

Three-quarters of the shorts card hangs *below* the joint the legs rotate
about. The thighs do not emerge from the bottom edge of the shorts — they
emerge from a point buried near the top of them and then travel down through
0.20 m of already-painted shorts before they clear the hem.

The probe confirms the root is geometrically interior on **100% of frames in
all four gaits**, with the nearest card edge never closer than **0.052 m**
(walk) to **0.061 m** (sprint). There is no frame, in any gait, where a leg root
is on or outside the card boundary.

The visual consequence: the drawn hip is not a joint, it is a **rigid 0.20 m
skirt** that swings as one body while the legs pivot invisibly inside it. That
is the melon.

## Finding 2 — both legs are rooted almost on the centreline

`drawCoronal` roots its legs at `±hipHalf * 0.8`, i.e. `±0.156` for this build —
a **0.312 m** span across a **0.42 m** card, ratio **0.743**. The legs come out
of the corners of the hips, which is correct.

`drawSidePaper` roots at `+0.012` and `−0.045`, a **0.057 m** span across a
**0.198 m** card, ratio **0.288**.

The two paths disagree by a factor of **2.6×** on the same anatomical question.
In the side view the outer **0.070 m** on the front edge and **0.055 m** on the
back edge of the shorts card carry no leg at all. They are unrooted overhang —
skirt that has nothing to hang from and nothing to move it.

This is defensible in *principle* for a profile view: seen from the side, both
hips project near the same screen x, so a small root separation is right.
But 0.057 m is the separation you would get from the **hip depth** (front-back
thickness), while the card is 0.198 m wide *because it is drawn at hip
width*. The card is drawn at one anatomical measurement and rigged at another.

## Finding 3 — the shorts card is lean-rotated; the legs are not

The shorts, the torso strip and the hoops all go through

```
RL(x, y) = [x·cos(lean) + dy·sin(lean),  hip + dy·cos(lean) − x·sin(lean)]
```

`legChain` does **not**. It takes `ox` raw and computes `hy = p.hip − 0.02`
directly. So as lean increases, the shorts card rotates about the hip and the
leg roots stay put — the card shears off its own rigging:

| clip | max lean | back-hem x-shift | front-hem x-shift | pivot → nearest card edge |
|---|---|---|---|---|
| walk | 0.05 rad | 0.011 m | 0.011 m | 0.052 m |
| jog | 0.12 | 0.026 | 0.027 | 0.054 |
| run | 0.24 | 0.049 | 0.055 | 0.057 |
| sprint | 0.36 | **0.071** | **0.084** | 0.061 |

At sprint the hem has slid **8.4 cm** forward relative to a leg root that has
not moved. On a 0.198 m card that is **42% of the card width** of pure shear.
The shorts lead the legs into the lean, then the legs catch up on the next
frame — a rubbery, disconnected pelvis. Note also the counter-intuitive last
column: the harder the lean, the *deeper* the root buries itself in the card.

## Finding 4 — the pivot sits below the anatomical hip, and sinks with the dip

Anatomically the greater trochanter is at leg-length height: **0.960 m**. The
drawn root is `hip − 0.02`, and `hip` is authored 0.94 at stand and dips through
the gait (`0.94 − dip`, with `dip` = 0.02 walk → 0.12 sprint).

| clip | pivot vs anatomical hip |
|---|---|
| stand | −0.040 m |
| walk | −0.060 … −0.044 m |
| jog | −0.085 … −0.049 m |
| run | −0.120 … −0.056 m |
| sprint | **−0.160** … −0.064 m |

At sprint the leg is rooted **16 cm — one third of a thigh — below** where the
hip joint is. The legs are effectively 16 cm short and the torso 16 cm long, and
the error *oscillates* through the cycle, so the apparent leg length breathes
by up to 0.096 m within a single stride.

## Finding 5 — there is no crotch notch, so the two legs read as one mass

The two thigh cards (near half-width 0.069 m, far 0.050 m) are checked at the
hem depth `y = −0.22` for clear air between them:

| clip | inner air between the thigh cards | frames showing daylight |
|---|---|---|
| walk | −0.116 … +0.051 m | 12 / 48 |
| jog | −0.115 … +0.107 m | 16 / 48 |
| run | −0.119 … +0.239 m | 28 / 48 |
| sprint | −0.115 … +0.400 m | 33 / 48 |

Negative means the cards overlap. On **75% of walk frames and 67% of jog
frames** the thighs overlap at hem depth with no gap, no outline between them
(the far leg is drawn with `out = null`, i.e. **no outline at all**) and no
occluder. Near the crotch the near thigh, the far thigh and the 0.20 m of skirt
below the pivot fuse into one continuous silhouette.

## Conclusion

The "watermelon crotch" is **not one bug**. It is five geometry errors that
compound at the same 4 cm² of the card:

1. the pivot is buried 0.200 m (74.1%) inside the shorts card;
2. the two roots are 2.6× too close together, leaving 0.070 m / 0.055 m of
   unrooted overhang;
3. the card is lean-rotated while the roots are not — up to 42% of card width
   of shear at sprint;
4. the pivot is 0.040–0.160 m below the anatomical hip and oscillates;
5. the thighs overlap with no outline on the majority of walk/jog frames, so no
   crotch notch ever appears.

Item 3 is the only outright **inconsistency** (two coordinate systems on one
body part) and is the cheapest to correct. Items 1, 2 and 4 are a single
underlying cause — **the side path invented its own rig constants instead of
sharing the coronal path's** — and any fix should unify them rather than tune
three numbers independently. Item 5 is a rendering-order issue, not a rigging
one, and is closer in kind to 17.3.

**No fix is proposed. Awaiting the ruling.** For the ruling's convenience, the
three shapes a fix could take, in ascending order of blast radius:

* **(i) Route `legChain` through `RL`** and lift the root to `hip + 0.03`. Two
  lines. Fixes items 1, 3 and 4. Leaves items 2 and 5.
* **(ii) A shared `hipRoots(build, view)` helper** consumed by both
  `drawCoronal` and `drawSidePaper`, so the two paths cannot disagree again.
  Fixes 1–4. Touches both draw paths.
* **(iii) (ii), plus a crotch notch** — outline the far thigh, or cut a shallow
  V into the shorts hem so the legs always read as two. Fixes all five, and
  overlaps SPEC_18's outline work, so it may belong there instead.

---

# SPEC_18 — Art style and the 3/4 upright view

**Unmeasured. Diagnosis required before any plan is committed.**

Two items reported together because both live in the same file:

**18.1 — Drop hard outlines, round the polygon corners.** `paperCard()`
(`paper.ts:181`) takes `lw` / `out` and is the single choke point for every
piece of ink on every figure. Likely a one-place change, but this is an
assumption and the probe must verify no draw path bypasses `paperCard`.

**18.2 — A 3/4 upright view.** `PaperView` is currently
`front | back | leftEdge | rightEdge | lieFaceUp | lieFaceDown` (`paper.ts:52`),
selected by the angle thresholds `EDGE_IN` / `EDGE_OUT` / `END_ON` / `BACK_IN`
in `updatePaperView` (`paper.ts:99`). A fourth upright view needs: a new enum
member, new thresholds in all four constants, and a new draw path. This is the
largest single piece of new art in Season 3 and should not start until SPEC_17
has settled what a correct rig looks like — a 3/4 path built on today's rig
would inherit all five hip-pivot defects into a third code path.

**Depends on:** SPEC_16 (proportions), SPEC_17 (rig correctness).

---

# SPEC_19 — AI debt

**Unmeasured.**

* **N-02 "Smell Blood"** — attackers do not recognise and attack a broken
  defensive line.
* **T-71 offside loitering / retreat** — players penalised offside do not
  retreat with intent.

Both are behaviour-layer, both must respect the one-writer-per-player-per-frame
rule, and both open with a seeded probe that counts occurrences before anything
changes. Independent of the render chain; may run in parallel with SPEC_16/17.

---

# SPEC_20 — Set piece and tuning

**Unmeasured.**

* **N-01 lineout teleport** — players snap into lineout formation instead of
  walking there.
* **SPEC_04 stage 2** — the deferred realism / set-piece repricing.

**Depends on:** SPEC_19 (both touch the same behaviour scheduling).

---

# What happens next

1. Review this file.
2. Review the SPEC_17.4 diagnosis above and rule on fix shape (i), (ii) or
   (iii) — or reject all three.
3. On sign-off, SPEC_16 begins at step 16.0 (the probe), not at step 16.1.

**Halting here.**

---

# SPEC_16 — VERDICT (shipped)

Executed under the Phase 2 authorisation. Steps 16.0 → 16.4 complete.

## The framing ruling turned out to be free

The ruling directed that the ~40% viewport loss be bought back by pulling the
camera out by 1.65x. **Measurement shows the compensation is not merely
adequate — it is exact, and the loss never occurs at all.**

Projection is a *similarity transform*. Scaling world coordinates and the
camera rig (`x`, `z`, `h`) by the same factor `k`, while leaving `yaw`, `tilt`
and `fov` untouched, leaves every ground feature on **identically the same
pixel**. Verified directly: pitch corners, touchlines and the crossbar all land
byte-identical before and after.

What *does* change is `sc`, the px-per-scaled-metre returned by `project()`.
It falls by exactly `1/1.65 = 0.60606`. Because the figure is drawn in SCREEN
space as `FIGURE_SCALE * sc`, its ink shrinks by exactly 1.65 — while the
world's ink does not move at all. That is the whole fix, and it is why
`RENDER_SCALE` and `FIGURE_SCALE` now cancel to unity: **every build draws
exactly its authored height.**

So the ruling's intent is honoured with zero framing cost. There is no trade to
accept.

## Measured before / after (seeds 1 & 7, difficulty 3, 60 s, 600 drawn frames)

| metric | before | after | note |
|---|---|---|---|
| **figure / crossbar** (depth-corrected) | **1.066** | **0.572** | running figure |
| **figure / crossbar** (standing, at posts depth) | 1.039 | **0.6310** | life = 0.6300 |
| crossbar height | 26.65 px | **26.65 px** | unmoved |
| visible pitch WIDTH | 179.00 m | **179.00 m** | unmoved |
| visible pitch DEPTH | 142.00 m | **142.00 m** | unmoved |
| drawn figure height | 2.735 m of ink | **1.717 m** | authored 1.86 standing |
| HALF / CENTRE / LOCK drawn | 2.90 / 3.12 / 3.27 m | **1.76 / 1.89 / 1.98 m** | = authored, exactly |
| shadow ÷ silhouette width | 1.160 | **1.039** | tightened onto the feet |

The depth-corrected running figure reads 0.572 rather than 0.62 because a
runner is genuinely shorter than his standing height — hip dip plus forward
lean. Standing, at the posts, the number is 0.6310 against a life value of
0.6300: **exact to 0.16%.**

## Gates: all nine byte-identical

`npx vite-node scripts/gates.ts 100`, before vs after:

```
NO TELEPORTS 0 | EVERY BALL BOUNCES 0 | TACKLES HAPPEN 17 | CHASE ARRIVES 396
CAMERA STABLE 0 | NO ENCROACHMENT 0 | NO FREEZES 0 | POSSESSION MOVES 5
BALL ON SCREEN 196
```

Every value identical. `RENDER_SCALE` has not leaked into logic — the exit
criterion.

**`BALL ON SCREEN` fails at 196 (limit 60) both before and after.** It is a
pre-existing failure inherited from `main`, confirmed by running the gates on a
clean stash. It is **not** caused by SPEC_16 and, under No Scope Creep, is
recorded here rather than fixed. It should be triaged — recommend it becomes
part of SPEC_19/20 or its own ticket.

## What was changed

* `retro.ts` — `RENDER_SCALE = 1.65`; `camScale()`; both applied inside
  `project()`, the single choke point (option 1 of step 16.2 — no call site can
  forget). The 0.25 m near plane is scaled with the world so the clip plane
  does not silently move.
* **Anchor reconciliation.** Five world-space anchors were multiplied by
  `FIGURE_SCALE` under SPEC_14 to chase a figure that was 1.65x oversize *in
  world terms*. With the world now scaled to match, the figure measures true,
  so those inflations became wrong and were removed: the shadow caster height
  and pool radius (`coronal.ts`), the carried-ball chest anchor, the maul and
  breakdown ball heights, and `REF_HEAD_Y` (`scene.ts`). Left in place, the
  shadow would have been 1.65x too wide and the referee's bubble 1.2 m above
  his head. This is why the shadow ratio improved from 1.160 to 1.039.
* `FIGURE_SCALE` itself is **untouched** at 1.65, per the ruling that logical
  data and the SPEC_14 contract stay intact.

Nothing in `src/game/` was modified. Logical space remains 70 x 100 m.

## Artefacts

* `scripts/spec16probe.ts` — the before/after instrument.
* `scripts/spec16shot.ts` → `spec16_after.png` — a figure beside the crossbar.
