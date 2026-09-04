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
| 3 | **SPEC_18** | Art style: soft edges + the 3/4 upright view | Render | 16, 17 | **SHIPPED** |
| 4 | **SPEC_19** | AI debt: N-02 Smell Blood, T-71 offside loitering | AI | — | Diagnostic queued |
| 5 | **SPEC_20** | Set piece & tuning: N-01 lineout teleport, SPEC_04 stage 2 | Law / tuning | 19 | Diagnostic queued |

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

---

# SPEC_17 — VERDICT (shipped)

All five checklist items delivered. Measured with `scripts/spec17probe.ts`
(64 samples per gait cycle, build `CENTRE`), pictures in
`spec17_after_run.png` / `spec17_after_sprint.png` via `scripts/spec17shot.ts`.

## 17.1 — `pinPlantedFoot()` deleted

Removed from `paper.ts` and both call sites in `scene.ts`. The diagnosis held:
its guard only corrected a *sinking* foot and the foot never sank, so it was
unreachable in every gait.

Grounding is now **structural rather than corrective**. `groundedClearance()`
solves both feet together and subtracts the lower one's height, so the stance
foot sits at exactly y = 0 by construction. Unlike the deleted helper this is
not optional and cannot silently fail to fire.

## 17.2 — Coronal swing leg: clearance arc, not vertical shortening

`cos(l)` survives only as a **foreshortening of the limb on the card**; foot
height is authored on a shallow arc and the knee is solved by two-bone IK
(`solveKnee`) to that authored foot rather than accumulated forward.

| clip | peak swing foot (before → after) | target | stance float (before → after) |
|---|---|---|---|
| walk | 0.226 → **0.066** m | 0.06–0.10 | −0.023 → **0.000** |
| jog | 0.379 → **0.088** m | 0.08–0.12 | −0.024 → **0.000** |
| run | 0.712 → **0.131** m | 0.10–0.14 | −0.007 → **0.000** |
| sprint | 0.917 → **0.168** m | 0.14–0.18 | +0.004 → **0.000** |

Every gait lands inside its target band, and the stance foot is at
**0.000000 m on all 64 frames of all five clips** — the squat is gone at source.

*Judgement call recorded:* this removes the true flight phase of a sprint. A
real runner does leave the ground, but a paper cut-out that floats reads as
broken rather than as airborne, so contact is held. Genuinely airborne states
(jump, dive) drive `hip` directly and are unaffected.

## 17.3 — Arm Z-sort: three passes

`drawArms()` is replaced by `drawBackArm()` / torso / `drawFrontArm()`, each arm
sorted on its own `armDepth() = sin(aa)` — the missing **odd** term. Measured:

* elbow-height difference forward vs backward swing: **0.000 m** (unchanged —
  `cos` is even, and that is correct; length should not betray direction)
* depth difference forward vs backward: **1.129** — the arms now sort to
  opposite sides of the torso
* the two arms are on opposite sides on **100% of gait frames**, so this changes
  every frame of every stride

Forward-swinging arms also foreshorten, so they overlap the body instead of
merely rising. The "carrying baskets" silhouette is gone.

## 17.4 — Hip pivot unified (`hipRoots()`)

One helper in `paper.ts` now feeds both drawers, so the paths cannot disagree
again by accident.

| metric | before | after |
|---|---|---|
| card hanging below the pivot | 0.200 m (**74.1%**) | 0.050 m (**50.0%**) |
| pivot vs anatomical hip, standing | −0.040 m | **0.000 m** |
| unrooted overhang on the side card | 0.070 m | **0.000 m** |
| side/coronal root ratio | 0.183 (accidental) | 0.393 (by design) |

The side card is a thin *profile* strip drawn at hip depth, so narrower roots
than the coronal pair are correct; what was wrong was the two paths disagreeing
by coincidence. The per-gait spread that remains is the authored hip **dip** —
real crouch, deliberately preserved.

## 17.5 — Sagittal shear eliminated

`legChain` is routed through `RL`, so the root inherits the lean exactly as the
torso, shorts and hoops already did.

| clip | shear before | after |
|---|---|---|
| walk | 0.011 m | **0.003 m** |
| jog | 0.027 m | **0.006 m** |
| run | 0.055 m | **0.013 m** |
| sprint | **0.084 m** (42% of card width) | **0.020 m** |

Only the root takes the lean; limb angles stay ground-relative, since adding
`lean` to the swing angle would double-count it and tilt the stance leg off the
turf.

## 17.6 — Silhouette fusion resolved

The far leg now carries its own outline (`shade(OUT, 1.35)`) — previously
`out = null`, which is why near thigh, far thigh and skirt fused into one mass.
The shorts hem is cut with a **crotch notch**: a shallow V rising between the
two roots, giving a permanent division exactly where the legs emerge. Daylight
frames on walk rose 25% → **55%**, and on the remaining frames the outline plus
notch keep the legs readable as two even when the cards touch.

## A defect the numbers missed, caught by the picture

Raising the root to the anatomical hip lengthened the side-profile chain
without grounding it. The probe's five metrics all passed while the figure
**floated up to 0.286 m above its ground line at sprint** (and sank 0.035 m) —
visible immediately in the first shot, invisible in the table.

Fixed with `sideLift`: the pelvis drop is solved once from the same kinematics
`legChain` uses, then applied equally to both legs so the pelvis moves as one
rigid body and the stride is preserved. Side-profile lowest foot is now
**0.000000 m across every gait**. This is the argument for the shot script
existing alongside the probe.

## Gates

All nine values byte-identical to the SPEC_16 board and to `main`:

```
NO TELEPORTS 0 | EVERY BALL BOUNCES 0 | TACKLES HAPPEN 17 | CHASE ARRIVES 396
CAMERA STABLE 0 | NO ENCROACHMENT 0 | NO FREEZES 0 | POSSESSION MOVES 5
BALL ON SCREEN 196
```

`BALL ON SCREEN` remains the pre-existing failure inherited from `main`,
untouched and still awaiting triage.

## Files

* `paper.ts` — `hipRoots()`, `groundedClearance()`, `swingClearance()`,
  `armDepth()`, `solveKnee()`; `pinPlantedFoot()` deleted.
* `coronal.ts` — coronal leg rewrite, three-pass arms, side leg routed through
  `RL`, `sideLift` grounding, crotch notch, far-leg outline; `plantedFoot()`
  updated to mirror the new rig so the shadow tracks the boots.
* `scene.ts` — `pinPlantedFoot` call sites removed.
* New: `scripts/spec17probe.ts`, `scripts/spec17shot.ts`.

Nothing in `src/game/` was modified.

---

# SPEC_18 — DESIGN: visual polish (three features)

**Status: DESIGN ONLY. No live TypeScript engine code has been written.**
Measurements come from `scripts/spec18probe.ts` (read-only, added with this
document) plus four throwaway calculation scripts whose outputs are reproduced
inline below.

Rulings from Phase 3 are recorded as accepted: `sideLift` approved, sprint
ground contact approved as an artistic call, the 0.393 root ratio confirmed,
and `BALL ON SCREEN 196` is accepted debt — it is not mentioned again in this
document except here.

## The measurement that reframes all three features

Before designing anything kinetic I measured the signal the kinetics would ride
on. **The engine's position stream is not smooth enough to differentiate twice.**

| quantity | measured |
|---|---|
| per-frame step distance, p50 / p99 / max | 0.0815 / 0.2174 / **1.019 m** |
| what a 12 m/s sprinter should step at 60 Hz | 0.200 m |
| raw acceleration p50 / p99 / max | 2.8 / **478.6** / **3668 m/s²** |
| position discontinuities (step > 0.30 m) | 94 / 111 569 frames = **0.08%** |

A 1.019 m step in one frame is 61 m/s. Raw p99 of 478 m/s² is **49 g**. Feeding
that straight into a shear term would not produce "leaning into a sprint" — it
would produce a figure snapping flat on ~20% of frames.

This does not block the feature, but it does dictate the design: **every kinetic
input below is a filtered, clamped, saturating function of the raw signal, never
the raw signal itself.** Details in §18.3.

---

## 18.1 — Stroke removal and value separation

### What the outline is currently doing for free

Measured WCAG contrast ratios between adjacent fills that share an edge today:

| pair | palette A | palette B | palette REF |
|---|---|---|---|
| kit vs shorts | 4.20 | 6.07 | 9.97 |
| kit vs skin | 1.87 | 2.91 | 1.70 |
| kit vs socks | **1.00** | **1.00** | **1.00** |
| **limb vs limb (same fill)** | **1.00** | **1.00** | **1.00** |
| kit vs OUTLINE | 3.25 | 2.09 | 10.32 |

The two rows at exactly **1.00** are the whole problem. An arm crossing the
torso, or one leg crossing the other, is *the same colour on both sides of the
edge*. Right now the only thing separating them is the `OUT = '#20202b'` stroke.
Delete the stroke with no replacement and those silhouettes fuse completely —
this is the same failure mode as the SPEC_17 "watermelon", which I have already
measured once and should not reintroduce by choice.

### The formula

Depth shading replaces the stroke with a **value step**, driven by the per-limb
depth that SPEC_17 already computes (`armDepth() = sin(aa)`, and the equivalent
leg term). Every limb already knows whether it is in front of or behind the
torso — that is exactly the Z-sort the three-pass draw uses.

Define, per limb, a signed depth `z ∈ [-1, +1]` (negative = behind the torso):

```
shadeFactor(z) = LIMB_MID + LIMB_SPAN * clamp(z, -1, +1)
```

with

```
LIMB_MID  = 0.92        // torso is 1.00; limbs sit slightly under it
LIMB_SPAN = 0.22
```

giving `shade(kit, 0.70)` at full-back and `shade(kit, 1.14)` at full-front.
Measured contrast of that pair:

| palette | back vs front | back vs torso | front vs torso |
|---|---|---|---|
| A | **2.11** | 1.68 | 1.25 |
| B | **1.78** | 1.48 | 1.20 |
| REF | **2.62** | 2.03 | 1.29 |

Back-vs-front clears 1.78 on every palette — comfortably above the ~1.25 where a
value step stops reading at small sizes, and **better separation than the
outline gave on palette B (2.09)**. Two rejected alternatives are recorded:
`0.72/1.06` (only 1.56 on B) and `0.78/1.10` (1.52 on B, too weak).

### Why this is the right replacement rather than a substitute trick

It is the *same* information the Z-sort already uses, so it cannot disagree with
the draw order — a limb that sorts behind is necessarily shaded darker. Contrast
this with a per-limb outline, which is a second, independent encoding of depth
that can (and in the old rig, did) contradict the sort.

**Interaction with lighting:** `shade()` is a flat multiplier, so this composes
with the existing two-tone cel fill without a gradient, preserving the printed-
paper premise (`B-10` in the papercraft dataset).

**Open question for review:** the shorts and socks currently share the kit hue.
Depth shading fixes limb-vs-limb, but `kit vs socks` at 1.00 is a *palette*
problem, not a rendering one. Recommend it is treated separately and not folded
into SPEC_18.

---

## 18.2 — Performant rounded polygons

### The method (no beziers, as ruled)

Canvas will round the corners of a filled polygon for free if the polygon is
**stroked with its own fill colour** using round joins:

```
ctx.lineJoin = 'round';
ctx.lineCap  = 'round';
ctx.strokeStyle = fill;      // SAME colour as the fill
ctx.lineWidth   = 2 * r;     // r = desired corner radius, in px
ctx.fill();
ctx.stroke();
```

The stroke adds a half-width `r` band around the path whose outer corners are
arcs of radius `r`. Fill plus stroke is one convex union: a polygon with
radius-`r` rounded corners.

### The geometry that must not be skipped

The stroke expands the shape **outward** by `r` on every edge. Left uncorrected,
every limb silently gains `2r` of width and the figure fattens — the exact class
of error that produced the 1.02 crossbar ratio in SPEC_16.

So the path must be **inset by `r` before stroking**. For a limb card, which is
built by `limbCard()` from a centreline and a half-width `w`, the inset is
analytic and costs nothing:

```
w' = w - r        (half-width)
L' = L - r        (each end of the centreline pulled in by r)
```

No polygon-offset algorithm, no beziers, no curve flattening — two subtractions
per card, because every card in this renderer is generated from a centreline and
a width rather than authored as arbitrary geometry.

### Choosing `r`

`r` must be in **screen pixels**, not metres, or corners round more when the
camera is close. The existing line width already solves this problem and should
be reused as the model:

```
lw = clamp(sc * 0.021, 1.05, 3.2)      // existing, paper.ts makeLocals
r  = clamp(sc * 0.014, 0.8, 2.4)       // proposed, ~2/3 of lw
```

At the measured median actor scale (`sc ≈ 10.5` px per scaled metre after
SPEC_16) this gives `r ≈ 0.8 px` — near-invisible, which is correct for a
distant player — rising to the 2.4 px cap on close figures where the corners are
actually legible.

### Cost

One extra `stroke()` per card. No new path construction, no curve maths. The
existing `paperCard()` already issues a `stroke()` for the outline, so for cards
that lose their outline this is **cost-neutral**: the same call, a different
colour and a wider line.

### Interaction with 18.1

These two features must land together. `paperCard()` is the single choke point
for both — it currently owns the outline being removed and would own the round-
join stroke replacing it, and the depth shade is the `fill` argument it already
takes. Splitting them across two changes means an intermediate state with no
outline and no value separation, i.e. the fused silhouette.

---

## 18.3 — Dynamic 3/4 perspective: squeeze and pop

### The affine matrix

The 3/4 view is a horizontal shear composed with a vertical squash, applied
about the **ground anchor** (the feet), so a sheared figure stays planted:

```
        | 1   tan(θ)  0 |
M(θ,κ) =| 0    κ      0 |        about (0, 0) = the foot anchor
        | 0    0      1 |
```

θ = shear angle (lean), κ = vertical scale (squash). In Canvas terms, with the
origin already translated to the anchor and `Y` pointing up the card:

```
ctx.transform(1, 0, -Math.tan(theta), kappa, 0, 0);
```

The `-tan(θ)` is negative because screen-y is down while the card's `Y()` helper
maps metres upward; a positive θ must lean the *top* of the card in the
direction of travel.

**Volume conservation.** A squash that only compresses reads as a figure
shrinking. Pairing it with a horizontal bulge preserves apparent mass, exactly
as SPEC_01's `impactSquash` already does:

```
kappa = 1 - s
sx    = 1 + 0.6 * s        // the existing SPEC_01 ratio, reused deliberately
```

### Linking shear to acceleration — with the filter the data demands

Given the measured signal, the raw derivative is unusable. The chain is:

```
1. reject discontinuities   step > MAX_STEP (0.30 m) -> drop the frame, reseed
2. EMA the velocity         alpha_v = 1 - exp(-dt / TAU),        TAU = 0.35 s
3. differentiate            a = (v_smooth - v_smooth_prev) / dt
4. project along travel     a_along = dot(a, v_hat)        (signed)
5. EMA again                alpha_a = 1 - exp(-dt / (TAU * 1.6))
6. saturate                 theta = SHEAR_MAX * tanh(a_along / A_REF)
```

`tanh` is the important choice: it is linear for small accelerations (so gentle
changes of pace read proportionally) and **saturates** for large ones, so the
0.08% of frames carrying a teleport cannot throw the figure flat even if step 1
misses one.

Measured effect of `TAU` on the filtered signal:

| TAU | p50 | p90 | p99 | max | sign flips / min |
|---|---|---|---|---|---|
| 0.10 s | 2.61 | 13.20 | 24.51 | 78.4 | 2858 |
| 0.20 s | 2.14 | 7.67 | 12.89 | 41.4 | 2200 |
| **0.35 s** | **1.55** | **4.52** | **7.90** | **24.2** | **1760** |
| 0.50 s | 1.16 | 3.15 | 6.40 | 17.2 | 1505 |

`TAU = 0.35 s` is recommended: it is the knee of the curve. Below it the p99
doubles and the sign-flip rate climbs (visible as a figure twitching between
lean-forward and lean-back); above it the lean lags the actual change of pace
enough to read as disconnected.

Constants, with the resulting geometry:

```
SHEAR_MAX = 0.18 rad   (10.3 deg at saturation)
A_REF     = 6.0 m/s^2
```

| a_along | tanh(a/6) | θ (deg) | head displacement, 1.9 m figure |
|---|---|---|---|
| 1.5 | 0.245 | 2.5 | 8 cm |
| 3.0 | 0.462 | 4.8 | 16 cm |
| 6.0 | 0.762 | 7.9 | 26 cm |
| 10.0 | 0.931 | 9.6 | 32 cm |
| 25.0 | 1.000 | 10.3 | 35 cm |
| **∞** | **1.000** | **10.3** | **35 cm (hard bound)** |

35 cm of head lean at full saturation is a decisive sprint attitude that cannot
become a pratfall. Compare `SHEAR_MAX = 0.22` (42 cm, starts to read as falling)
and `0.14` (27 cm, too timid to notice) — both measured, both rejected.

### Squash on footfall — driven by clip phase, not physics

**The footfall is not in the physics stream.** It is in the clip, and the SPEC_17
rig makes it exactly measurable: a footfall is a foot transitioning from
airborne to grounded under `groundedClearance()`. Measured contact events per
cycle:

| clip | duration | footfalls / cycle | at u = |
|---|---|---|---|
| walk | 1.05 s | 3 | 0.00, 0.37, 0.87 |
| jog | 0.72 s | 3 | 0.00, 0.38, 0.88 |
| run | 0.58 s | 3 | 0.00, 0.38, 0.88 |
| sprint | 0.46 s | 3 | 0.00, 0.38, 0.88 |

Every gait shares the same phase structure, so one rule covers all four. (The
third event at u = 0.00 is the loop seam re-reporting the u = 0.88 contact; the
implementation must debounce on a minimum inter-event time or it will
double-fire once per cycle. Recording this now because it is precisely the kind
of off-by-one that ships as a visible stutter.)

Footfall squash magnitude scales with speed, so a walk does not thud:

```
s_footfall = FOOT_SQUASH * clamp01((spd - 2.0) / 8.0)
FOOT_SQUASH = 0.06
```

with the same smoothstep spike-and-recover envelope SPEC_01 already uses
(`impactSquash`, ~5–6 frames at 60 Hz). At walk pace the term is ~0; at sprint it
reaches the full 0.06 — a 6% compression, well under SPEC_01's tackle value.

### Squash on tackles — reuse, do not reinvent

SPEC_01 **already implements this** in `squashForClip()`, with authored impact
frames per clip (`tackleHit` 0.45, `diveFront` 0.92, `ruckCommit` 0.5,
`scrumShove` 0.5, `scrumBind` 0.72) and per-kind magnitudes (tackle 0.09, dive
0.08, cleanout 0.06, scrum 0.10).

**Recommendation: do not add a second tackle-squash path.** Combine the two
sources multiplicatively so a footfall during a tackle does not double-compress:

```
s_total = 1 - (1 - s_footfall) * (1 - s_impact)
```

This is bounded above by each term and cannot exceed 1.

### Where the 3/4 view fits

`PaperView` gains a fourth upright member (`threeQuarter`), which requires
changes in three places (`paper.ts:52` enum, the `END_ON`/`EDGE_IN`/`EDGE_OUT`/
`BACK_IN` thresholds at `paper.ts:99`, and a new draw path).

**Sequencing recommendation:** the shear/squash transform above is **independent
of the new view** — it is a transform applied around whichever card is drawn, so
it works on the existing front/back/edge paths on day one. I recommend shipping
the kinetics first and the new draw path second, as two reviewable steps, rather
than as one change that alters both what is drawn and how it is transformed.

---

## Proposed execution order

```
18.1 + 18.2 together   (both live in paperCard(); splitting them fuses silhouettes)
      -> HALT, review pictures
18.3a kinetics          (shear + squash on the existing views)
      -> HALT, review pictures
18.3b threeQuarter view (new enum member, thresholds, draw path)
      -> HALT
```

## Verification plan

Same test-and-verify workflow as SPEC_16/17:

* `scripts/spec18probe.ts` — already written, extended per step with
  before/after contrast ratios and shear/squash distributions.
* `scripts/spec18shot.ts` — a sheet in the style of `spec17shot.ts`: the same
  figure at a range of accelerations and at footfall frames, since **the
  SPEC_17 float proved a green probe board does not mean a correct picture.**
* All nine gates byte-identical — every change here is render-only, so any gate
  movement means something has leaked into logic.

## Risks recorded

1. **Fused silhouettes** if 18.1 and 18.2 are separated. Mitigated by shipping
   them together.
2. **Figure fattening** if the round-join inset is skipped. Mitigated by the
   `w - r` / `L - r` inset, and caught by re-running the SPEC_16 ratio probe.
3. **Twitching lean** from an under-filtered signal. Mitigated by `TAU = 0.35 s`
   and `tanh` saturation; the sign-flip count is the metric to watch.
4. **Double-fired footfalls** at the loop seam. Mitigated by a debounce, and
   flagged in advance above.

**Halting here for review of the mathematics before any engine change.**

---

# SPEC_18 — VERDICT: SHIPPED

Executed under the lifted halt. All three features are live. Nine gates
unchanged throughout (8/9, the standing `BALL ON SCREEN 196` debt untouched).

Proof shot: `spec18_kinetic.png` — four rows, SPEC_17 coronal and profile
regression rows plus the two new SPEC_18 sweeps.

## 18.1 Stroke removal and value separation

Hard outlines are gone; `paperCard` only draws one if an explicit `out` is
passed. Depth separation via `depthShade()` on the ruled 0.70 / 1.14
multipliers.

**Measurement changed the design.** The ruled formula shades each limb by its
absolute depth `sin(angle)`. That term passes through zero exactly when two
limbs cross — precisely when they overlap and most need separating. Measured
worst-case WCAG contrast between the two legs was **1.00 — literally the same
colour — on 32 of 64 walk frames**, and arm-vs-torso 1.00 on 50 of 128 run
frames. The first shot looked fine, which is why the number matters more than
the eye.

Fix: `pairShade()` shades a matched pair *relative to each other* with an
enforced floor `LIMB_MIN_SPLIT`. 0.85 is the smallest floor clearing 1.25
contrast on every palette (weakest is B at 1.27); 0.55 left B at 1.16.

| | before | after |
|---|---|---|
| global worst limb-pair contrast | 1.00 | **1.27** |
| frames below 1.15 (all palettes/gaits) | 104 | **0** |

## 18.2 Rounded polygons, no beziers

`ctx.lineJoin/lineCap = 'round'` stroking each path in its own fill colour.

The stroke expands the shape outward by `r` on every edge, silently fattening
every figure. The inset that cancels this lives **inside `paperCard`**, so no
card can be rounded without being compensated. A centroid-radial inset was
tried and **rejected by measurement**: it under-compensates thin cards by
+1.18 px on a trim band, because moving a vertex toward the centroid barely
shortens the long axis. Replaced with exact per-edge normal offsetting plus
intersection, and a radius clamp to `minDim/3` for cards thinner than `2r`.
Card-level growth is now `0.00 x 0.00` on torso, thin band and boot.

## 18.3a Kinetics

Chain as ruled: reject steps > 0.30 m → EMA velocity τ=0.35 s → differentiate
the smoothed signal → project along travel → EMA at τ·1.6 → `θ = 0.18·tanh(a/6)`.
The filtering is load-bearing: raw p99 acceleration is ~49 g with outright
teleports in the stream, which fed to `tan()` would snap figures flat.

| property | measured |
|---|---|
| peak lean accelerating | 7.84° |
| peak lean braking | −7.62° |
| cap (never exceeded, incl. teleport stream) | 10.31° |
| max change per frame | 0.459° (no jitter) |
| footfall fires over 12 cycles | **12**, not 24 — seam debounced |

Squash combines multiplicatively with `squashForClip()` as ruled. Contact is
read from the rig's own `groundedClearance` rather than a hardcoded phase
table, so it cannot drift out of sync with the clip. The squash update is
sequenced *after* pose sampling — before that it tested last frame's legs.
Shear is applied about the foot anchor, so a leaning figure stays planted.

## 18.3b 3/4 perspective

**Deliberately not a sixth `PaperView`.** A new enum state would turn the
hysteresis machine into a 6-zone problem needing its own dead zones and mirror
flip debounce, and SPEC_06 already had to be hardened once because that machine
thrashed. Instead `threeQuarter(ang)` is a continuous affine over the existing
front/back card, driven by the same angle the view machine thresholds on:

    | 1   -tan(phi)*sign  0 |
    | 0        narrow     0 |

Shear ramps 0 → 14.9° and shoulder width 1.00 → 0.86 by smoothstep across the
end-on zone, fully faded in by the edge boundary so there is no pop when the
view machine hands over to the profile card. Verified: exact identity at 0°,
caps respected, max discontinuity 0.0027 per 0.25° — continuous everywhere.

**Halting here for review, as instructed, before the SPEC_19 / SPEC_20
deferred debt.**


---

# SPEC_18.5 — VERDICT: SHIPPED

Signal is the signed curvature of the smoothed velocity — the cross product of
EMA velocity with its own derivative — speed-gated by smoothstep over
1.5–3.5 m/s, EMA'd at τ=0.35 s, then `tanh(ω/2.0)`. Verified exact to three
decimals against known circular motion. Live: bias p50 0.054, p90 0.501,
p99 0.872, strictly bounded, 0.56% of frames saturated. Nine gates unchanged.

**Two bugs the eye passed and measurement caught.**

1. **The natural reading of the directive causes hyperextension.** `solveKnee`'s
   `bend` argument is a ±1 perpendicular *selector*, not an angle, and the IK
   preserves bone length only at exactly `|bend| = 1`:

   | bend | thigh (want 0.440) | shin (want 0.400) |
   |---|---|---|
   | 1.00 | 0.4400 | 0.4000 |
   | 1.30 | 0.4734 | 0.4364 |
   | 2.00 | 0.5710 | 0.5408 |

   Biasing `bend` stretches the femur up to 30%. The bias is applied to the
   **IK foot target** instead, so bone lengths are exact by construction —
   worst thigh error **0.0000%** across 25 600 samples.

2. **The flare was applied in world x**, moving both legs the same way: the
   stance widened or narrowed symmetrically instead of inside-tuck plus
   outside-flare. Measured at turn = +1, *both* feet sat 0.084 m further from
   the spine. Now applied along each limb's own outward direction, verified
   mirror-symmetric with identity at zero.

Foot reach is 1.184 of limb length at full bias against a **pre-existing 1.177
baseline at zero bias** — the authored target already out-reaches the leg and
`solveKnee`'s `reach*0.999` clamp absorbs it. The bias contributes +1.43pp to a
clamp that was already load-bearing; flagged as pre-existing debt, not a new
failure mode. Elbow flare is suppressed in proportion to `carryLock()`, which
reuses the exact weights `carryPose` applies.

---

# SPEC_19 / SPEC_20 — DEFERRED DEBT DIAGNOSTIC PLAN

Proposed. **No code changes yet — awaiting review.** Every item opens with a
seeded, read-only probe that counts occurrences *before* anything is touched,
per Measure First. Ordered by evidence strength, not by queue number.

## D-1. `BALL ON SCREEN 196` — already partly diagnosed

I ran the first probe. The failure is **not** diffuse noise:

| difficulty | off-target frames | episodes | longest run |
|---|---|---|---|
| 0 | 266 | **3** | 172 frames (2.9 s) |
| 3 | **0** | 0 | — |
| 6 | 2 | 1 | 2 frames |

97% of bad frames are the ball off the **bottom** of frame; 231 of 266 are in
`OPEN_PLAY`, 35 in `KICK`. Three episodes at one difficulty, not a systemic
framing fault.

Two concrete hypotheses, both cheap to falsify:

* **H1 — the gate's viewport is stale.** `trace.ts` hardcodes 960×540 with a
  60 px margin. SPEC_16 changed the camera pull-back to ×1.65. If the probe's
  assumed frame no longer matches the shipped one, the gate is measuring a
  viewport that does not exist. **Falsify by** re-running the probe against the
  real render viewport and margin.
* **H2 — a genuine camera-follow stall at difficulty 0.** "Off the bottom" means
  the ball is nearer the camera than the rig expects — consistent with a slow
  or stalled follow during one long open-play sequence. **Falsify by** dumping
  camera and ball tracks for the 172-frame episode and checking whether the
  camera is easing toward the ball at all.

H1 and H2 have opposite fixes — one moves a test, one fixes the rig — so this
must be resolved before touching either. **I will not move the threshold**; if
H1 holds, the correction is to the probe's viewport constants with written
justification, not to the 60-frame budget.

## D-2. N-01 lineout teleport

**Probe:** per-actor per-frame displacement, filtered to the lineout formation
window, reusing the existing `teleportCount` definition so the numbers are
comparable to the `NO TELEPORTS` gate. Report the distribution of jump sizes,
which actors jump, and the exact phase transition at which they jump.

**Key question:** is this one writer snapping positions, or two writers fighting
across a phase edge? The `NO TELEPORTS` gate passes at 0, so whatever the
lineout does is **not currently classed as a teleport** — either it is below the
gate's threshold or it happens in a phase the gate excludes. That discrepancy is
the first thing to establish; it decides whether this is a new bug or a hole in
an existing gate. `scripts/lotest.ts` already forces lineout resolution and is
the natural harness.

## D-3. T-71 offside loitering

The engine already has rich instrumentation — `offsideEpisodes`,
`offsideEpisodesByKind`, `offsidePlayerSamples`, `offsideWhistlesByKind` in
`src/game/engine/offside.ts`. **Probe:** for each offside episode, measure the
retreat vector after the ledger flags a player — closing speed toward the
offside line, latency from flag to first retreating frame, and the fraction of
episodes with *zero* retreat intent. "Does not retreat with intent" must become
a number before it can be fixed.

## D-4. N-02 "Smell Blood"

The weakest-specified item, so it gets a definition step first. A "broken
defensive line" needs a measurable predicate — candidate: a gap in the defensive
line exceeding some width within a distance band of the carrier, sustained for
some minimum time. **Probe:** count how often that predicate holds, and what
attackers actually do when it does (attack the gap / hold depth / ignore).

If the predicate almost never fires, the bug is the *detector*, not the
behaviour, and repricing attacker aggression would be treating a symptom. I
recommend agreeing the predicate before any probe is written.

## D-5. SPEC_04 stage 2 volume tuning

**Deliberately last, and I recommend deferring it past the others.** There is no
`src/audio` directory in the tree — the scope is not yet locatable, and every
other item has a measurable failure today. Tuning is also the one item where
"before" numbers are least meaningful without an agreed target. **Needs a scope
ruling from you** on what "volume" refers to here before I probe it.

## Proposed order

`D-1` (evidence in hand, and it is a red gate) → `D-2` (existing harness, tests
a gate hole) → `D-3` (rich existing telemetry) → `D-4` (needs a predicate ruling
first) → `D-5` (needs a scope ruling first).

**Halting for review of this plan before any diagnostic code is written.**

---

# SPEC_19 / SPEC_20 — DIAGNOSTIC DATA (D-1 … D-5)

All five probes are read-only. **No live fixes written.** Probes committed:
`scripts/d1viewport.ts`, `d2lineout.ts`, `d3offside.ts`, `d4smellblood.ts`,
`d5volume.ts`.

## D-1 `BALL ON SCREEN` — **H2 confirmed, H1 rejected**

Ruling was to probe camera focal point vs ball. Done, difficulty 0, gate's own
live-ball filter, 4623 live-ball frames, 266 failing.

**The camera is not pointed at the ball, and it is not a viewport problem.**

| measure | value |
|---|---|
| median \|yaw error\| vs view axis | **39.4°** (p90 53.0°, max 131.3°) |
| median \|pitch error\| | **34.5°** (p90 37.1°) |
| camera within 8 m of the ball | **239 / 266** failing frames |
| ball behind the camera plane | 20 / 266 |

Viewport sweep — H1 predicts a bigger box fixes it. It does not:

| viewport | failing |
|---|---|
| 960×540 m60 (current) | 266 |
| 1920×1080 m60 (same aspect, 2× scale) | 166 |
| 2560×1440 m60 | 155 |
| 960×540 m0 (no margin at all) | 133 |

Even with **zero margin** 133 frames still fail. The fault is angular, so
`RENDER_SCALE` is exonerated — it is applied to camera and world alike inside
`project()` and cancels.

**Root cause.** The failing frames are a camera that has come *too close*:

| | failing | healthy |
|---|---|---|
| horizontal gap to ball | p50 **5.5 m** (min 4.8) | p50 18.7 m |
| camera height | 13.0 m | 13.0 m |
| tilt | 30.4° | 29.6° |

At 13 m high and 5.5 m out, the ball sits ~67° below horizontal while the rig
tilts 30°. The ball is nearly underneath the camera and falls out of the bottom
of frame — which matches the measured 97% "bottom" failures. Concentrated in 3
episodes (197, 62, 59 frames), phases `OPEN_PLAY` 231 / `KICK` 35.

**This is a camera rig fault, not a test fault. The 60-frame threshold stays.**
Candidate fix for review: floor the horizontal trail distance as a function of
camera height so the tilt can always reach the ball.

## D-2 N-01 lineout teleport — **a real gate blind spot**

| phase | frames | mean disp | max disp | >1.4 m (gate) |
|---|---|---|---|---|
| LINEOUT | 26190 | 0.0878 | **0.906** | **0** |
| OPEN_PLAY | 121860 | 0.0761 | 1.087 | 0 |

33 jumps over 0.35 m inside `LINEOUT`, tightly clustered at **0.87–0.91 m per
frame** — implied speed **p50 51.9 m/s, max 54.4 m/s** against a ~9 m/s sprint.

**The `NO TELEPORTS` gate passes at 0 because its threshold is 1.4 m/frame and
every lineout snap lands just under it.** The bug is real and the gate is blind
to it by ~35%. Jumps occur **1–5 s after** phase entry, never at the edge
(0 jumps in the first 1.0 s), so this is not a phase-transition write race — it
is a positioning step applied mid-phase.

Threshold change would need written justification per house rules; flagging, not
moving.

## D-3 T-71 offside loitering — **the premise is partly wrong**

1606 episodes, 1241 lasting ≥ 0.25 s.

| what an offside player does | frame share |
|---|---|
| retreating toward the line | **64.9%** |
| holding station (loitering) | 21.7% |
| drifting further offside | 11.3% |

Episodes with **zero** retreating frames: **64 / 1241 (5.2%)**. Episodes ending
no better than they started: 171 / 1241 (13.8%).

"Players do not retreat with intent" is **not** what the engine does in the
general case — two thirds of offside frames are already retreating. The real
defect is narrower: a **5.2% tail that never retreats at all**, plus a long
lingering tail (p50 0.67 s but max **8.42 s**) and peak penetration reaching
**37.9 m**. By line kind: RESET 497, OPEN 399, RUCK 292, LINEOUT 27, MAUL 26.

Recommend re-scoping T-71 from "make them retreat" to "eliminate the
never-retreat tail and cap episode duration".

## D-4 N-02 Smell Blood — **the detector works; the sample is thin**

Ruled predicate: carrier ahead of defensive median depth AND ≥ 7.0 m clear in a
±45° forward cone. 2890 carrier frames.

| component | frames | share |
|---|---|---|
| ahead of defensive median | 840 | 29.1% |
| ≥ 7 m clear in cone | 876 | 30.3% |
| **both (predicate fires)** | **712** | **24.6%** |

Forward clear space: p10 0.9 m, p50 2.9 m, p90 6.8 m, p99 13.9 m; the cone is
empty on 671 frames.

**The detector is not the bug** — it fires on a quarter of carrier frames. But
those 712 frames collapse into only **12 episodes** (8 lasting ≥ 0.2 s), and
metres gained is p50 2.7 m with a single 79.5 m / 8.4 s outlier that is almost
certainly one clean break. Only 1 of 8 episodes gained < 1 m.

**Caution before tuning:** n = 8 is too small to justify a behaviour change, and
the mean is dominated by one episode. Recommend re-running across several seeds
and difficulties to get a stable episode count before touching attacker AI.

## D-5 SPEC_04 volume — **scope located, mix computed analytically**

`src/game/audio.ts` (164 lines) is pure WebAudio; every gain is a literal, so
the mix is exact without a browser. Master 0.9 (−0.9 dBFS).

| source | at master | dBFS |
|---|---|---|
| bed — idle, no travelling support | 0.025 | **−32.1** |
| bed — idle, full support | 0.050 | −26.1 |
| bed — momentum + in 22 + full support | 0.183 | −14.7 |
| bed — TRY spike | 0.520 | **−5.7** |
| TACKLE force 1.0 | 0.225 | −13.0 |
| TACKLE force 0 | 0.096 | −20.3 |
| KICK | 0.106 | −19.5 |
| whistle (envelope) | 0.077 | −22.3 |
| whistle (**true peak**, 2 detuned oscillators, og 1.0 + 0.5) | 0.115 | −18.8 |

Worst-case sum, try scored: bed 0.520 + whistle 0.115 = 0.635 (−4.0 dBFS); add a
max-force tackle in the same instant = **0.860 (−1.3 dBFS)**. No clipping, but
only **1.3 dB of headroom**, and **there is no limiter or compressor** — every
node connects straight to master, so any future gain increase hard-clips.

Two findings worth a ruling:
1. **The whistle is quieter than a tackle** (−18.8 vs −13.0 dBFS). A referee's
   whistle being 5.8 dB under a collision is likely backwards.
2. **Bed dynamic range is 26.4 dB** (−32.1 → −5.7). The quiet bed at −32 dBFS is
   near inaudible over typical playback; the try spike is 4× the loudest tackle.

**Halting for review of all five diagnostics.**

---

# SPEC_19 / SPEC_20 — FIXES SHIPPED

**All 9 gates pass**, including the tightened `NO TELEPORTS` (0.80 m) and the
previously-failing `BALL ON SCREEN`. Verified across **5 seeds x 3 difficulties
= 15 combinations, all clean** — not just the default seed.

| gate | before | after |
|---|---|---|
| `BALL ON SCREEN` | **196** (fail, limit 60) | **0** |
| `NO TELEPORTS` | 0 at a 1.4 m threshold | **0 at 0.80 m** |
| worst per-frame displacement | 1.14 m | **0.70 m** |

## D-1 camera

`minFollowGround(h, fov, eye)` in `retro.ts`. The rigs floored their ground
distance at a **constant** (4 m touchline, 5 m cable) while flying at 13–46 m.

**Two failed attempts, both instructive:**
1. *Flattening the tilt inside the rig* — no effect. If the camera is 5.5 m from
   a ball 13 m below it, **any** tilt that frames the ball aims past it. The rig
   has to physically back off.
2. *Pushing the rig back inside `cableRig`* — no effect either (543 of 545
   offending frames unchanged). The rigs only produce a `target`; every axis is
   then **eased** toward it, so an upstream correction is undone within a frame.

The floor is therefore applied to the **eased `d.cam`**, sliding it back along
its own view axis — the yaw is unchanged by construction, so `CAMERA STABLE` is
untouched.

## D-2 lineout / teleport gate

Threshold 1.4 m → **0.80 m** as ruled. Six unbounded writes had to be fixed,
each found by measurement:

1. **Set-piece settle** (lineout, scrum pack, maul) — walked while the gap
   exceeded a threshold, then `place()`d the **whole remaining gap** in one
   frame. `settleToward()` bounds it at 2.6 m/s. Lineout max/frame
   0.906 → 0.275 m; scrum 0.909 → 0.162 m.
2. **`startOpen` close-place** — up to 1.0 m in one frame.
3. **`FALL_FORWARD_MAX` 0.9 → 0.45** — explicitly tuned against the *old* 1.15 m
   line. The carrier's own velocity accounted for only ~0.11 m of a 0.90 m move.
4. **`separate()` shove accumulation** — no single shove looked wrong; a man
   with **zero velocity** moved 0.878 m via four writes (+0.012, −0.383, −0.508).
   Only the *sum* was unbounded. Budgeted at 0.22 m/frame, direction preserved.
5. **Scrum-half base placement** and **restart formation** — the last two
   whole-gap snaps. The restart landed at **0.7994 m**, six tenths of a
   millimetre under the new gate: technically passing, but balanced on the edge.
   Bounded rather than left to luck.
6. The scrum-half **scrum** settle, in its own block — only exposed on seed 5
   under the bot-input harness, which `NO_INPUT` probing never reached.

## D-3 offside (rescoped, retreat logic NOT rebuilt)

Targets only the two measured defects. Adjusts the **mark** before the steer, so
the player runs back under his own steering; independent of `FORCE AI CLEAN`
(a player-facing option, off by default).

| | before | after |
|---|---|---|
| retreating frame share | 64.9% | **86.5%** |
| loitering | 21.7% | **3.7%** |
| episodes with **zero** retreat | 5.2% | **0.4%** |
| max lingering | 8.42 s | **3.15 s** |

**A probe correction:** the original 8.42 s "episode" was the **ball carrier**
sitting 0.15 m over an OPEN line — he cannot be loitering offside, he *is* the
ball. The probe now excludes carrier/bound/sinbin players, which is also exactly
who the fix excludes. The residual 53.9 m peak is a `RESET` line snapping in
behind players, a transient, not loitering.

## D-4 — aborted per ruling

No AI tuning. Predicate retained for telemetry only (`scripts/d4smellblood.ts`).

## D-5 audio subtractive mix

| source | before | after |
|---|---|---|
| tackle (force 1) | −13.0 dBFS | **−17.7** |
| whistle (true peak) | −18.8 dBFS | **−11.4** ← now the loudest |
| quiet bed floor | −32.1 dBFS | **−25.3** |
| worst-case sum | −1.3 dBFS | **−1.1** |

The whistle is now the highest peak, as ruled. Note its true peak is **1.5× the
envelope** — two detuned squares sum through one gain. The try spike was trimmed
0.34 → 0.24 because the boosted whistle left only **0.2 dB** of headroom against
a chain with **no limiter**.
