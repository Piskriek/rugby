# SEASON 3 — working notes (investigation only, no code written)

**Status: measurement and diagnosis only.** Per the halt, no live TypeScript has
been written. This file exists so the next session does not re-derive what is
below. Everything here was read or measured against `4205385`.

Branch note: this session is pinned to `arena/01a0682b-rugby`, which is 15
commits ahead of `main`. `main` sits at `d8da46a` and does **not** contain
`FIGURE_SCALE`, so Season 3 cannot even be posed on `main` until PR #8 lands.

---

## SPEC_16 — Environment scale: the premise is inverted

The brief says the goalposts and pitch are "heavily miniaturized" and asks for
multipliers to scale them up. **Measurement says otherwise: the environment is
authored true. The figures are the thing that is 1.65× oversize.**

`src/render/retro.ts:151-154`:

| constant | value | real-world | verdict |
|---|---|---|---|
| `CROSSBAR_Y` | 3.0 m | 3.0 m (World Rugby) | **correct** |
| `POST_HALF` | 2.8 m | 5.6 m apart | **correct** |
| `POST_TOP` | 11.0 m | ≥ 6.4 m, commonly ~8.3 m | tall but legal |
| `POST_R` | 0.16 m | posts are ~10-12 cm diameter | thick, but reads as deliberate papercraft |

`FIELD` (`retro.ts:282`): `minX/maxX ±35` → 70 m wide; `tryZ ±50` → 100 m
between try lines; `deadZ ±62` → 12 m in-goal. All true. Line widths run
0.16–0.30 m against a real 0.10 m — the one place the environment genuinely is
oversize, and it is decoration only.

Meanwhile `FIGURE_SCALE = 1.65` (`paper.ts:341`, SPEC_14) is a **draw-time**
multiplier on the figure alone. A HALF authored at 1.86 m therefore draws as
3.07 m. Against a 3.0 m crossbar that is a ratio of 1.02 — *"players are as
tall as the crossbar"*, reproduced exactly. The true ratio should be 0.62.

### The multiplier, and why it is not a free win

If you want the crossbar to read as 3.0 m against the current figures, the
multiplier is **1.65×**: crossbar 3.0 → 4.95 m, post gap 5.6 → 9.24 m, post top
11.0 → 18.15 m, post radius 0.16 → 0.264 m. Line widths × 1.65 as well — those
are pure decoration and cost nothing.

**But the pitch positions cannot be scaled in art alone.** If the drawn pitch
grows 1.65× while players stay in unscaled world coordinates, players desync
from the markings: a man 10 m from halfway is drawn 10 m out, but the drawn
10 m line is now 16.5 m out, so every player appears to cover 40% less ground
than he does. Scaling player *positions* at draw time too is just a camera zoom,
which scales the goalposts back down and undoes the whole exercise.

So there are only two coherent resolutions, and this needs a ruling:

* **(A) Keep the world true, revert the figure toward 1.0, buy the viewport
  share back from the camera.** SPEC_14 wanted the carrier at 8-12% of viewport;
  it was 5.7% at scale 1.0 and 9.3% at 1.65. Raising px-per-metre by 1.65
  (camera 1.65× closer, or `fov` 0.42 → 0.255) gives *identical* viewport share
  with correct proportions. The cost: you see ~40% less of the pitch width.
  That is the real trade SPEC_14's cheat was buying, and it should be a
  deliberate decision rather than an accident.
* **(B) Grow `FIELD` itself** so the world is 1.65× larger in gameplay units
  (pitch 115.5 × 165 m). Not viable without re-tuning every speed and distance
  in the engine, and it would make the pitch physically absurd.

Recommendation: (A), with the camera doing the work `FIGURE_SCALE` is currently
doing.

---

## SPEC_17 — The papercraft rig

### Arms fail to Z-sort (`coronal.ts:216-247`)

There is **no per-arm depth at all.** The entire ordering decision is one
boolean:

```
if (!front)  drawArms();     // back view: arms first, torso paints over them
...torso...
if (front)   drawArms();     // front view: arms last, painted on top
```

Both arms are always drawn in the same pass, at the same layer, with nothing
depending on swing phase. Worse, the elbow height is

```
const elY = sy0 - Math.cos(aa) * upLen;
```

`cos` is **even**, so a forward swing (`aa > 0`) and a backward swing
(`aa < 0`) produce the *identical* elbow height. The sagittal rotation is thrown
away — there is no `sin(aa)` depth term anywhere in the coronal arm path (the
leg gets a small `Math.sin(l)` nudge; the arm gets nothing). So on the backswing
the arm rises exactly as it does on the forward swing and stays pinned in front
of the torso. Hence "carrying baskets".

Fix shape: derive a per-arm depth from `sin(aa)` and split `drawArms()` into
before-torso and after-torso passes (four combinations, not two), plus apply
`sin(aa)` foreshortening so a forward-swinging arm shortens and overlaps the
body instead of only rising.

### Squatting gait / floating — the planted-foot correction is dead code

`paper.ts:443` `pinPlantedFoot()` raises the hip when a foot sinks below ground.
Measured across one cycle of every gait at speed 8 (**before** vs **after** are
byte-identical in all five clips):

| clip | lowest foot | highest foot (swing) | frames with stance foot >1 cm off ground |
|---|---|---|---|
| walk | 0.013 m | 0.201 m | 100% |
| jog | 0.004 m | 0.328 m | 82% |
| run | 0.004 m | 0.625 m | 90% |
| sprint | 0.003 m | 0.820 m | 92% |
| idle | 0.006 m | 0.028 m | 71% |

Three separate findings:

1. **`pinPlantedFoot` never fires.** Its guard is `if (stance >= -0.005) return
   pose` — it only corrects *sinking*. The foot never sinks (lowest is +0.003
   m), so the correction is unreachable in every gait. It is dead code today.
2. **The stance foot floats a persistent 1-2 cm** (× 1.65 = 1.7-3.3 cm on
   screen) and nothing ever pulls it down.
3. **The real "squatting upward" is the swing leg.** Foot height is computed
   *forward* from the hip with no ground constraint:
   `footY = kneeY - cos(l-k)*shinLen + ...`. A sagittal stride therefore renders
   as vertical shortening, so the swing foot rises **0.62 m in run and 0.82 m in
   sprint**. Viewed front-on, a runner's swing leg should foreshorten in depth
   and stay low, passing under the body — not lift most of a metre. Both legs
   pulling up into the torso is precisely the "squatting upwards, disconnected
   from the shadow" report.

Fix shape: (a) make the correction bi-directional and un-capped so the stance
foot is held at y = 0 rather than merely not sinking; (b) in the coronal view,
treat the sagittal swing as depth (foreshorten the limb, keep the foot low)
rather than as vertical shortening; (c) drive hip height from the planted leg
instead of letting the authored `hip` channel and the leg angles disagree.

### Side-profile hip pivot — not yet measured

`drawCoronal` pivots the leg at `RP(s * hipHalf * 0.8, p.hip - 0.02)`. The side
path (`drawSidePaper`, `coronal.ts:329`) has not been read yet. **This diagnosis
is incomplete** — the "watermelon crotch" pivot height needs its own measurement
before any claim is made about it.

---

## Not started

* SPEC_18 (art style: drop hard outlines, round polygon corners) — `paperCard()`
  in `paper.ts:181` takes `lw`/`out` and is the single choke point; likely a
  one-place change, but unmeasured.
* SPEC_18 (3/4 perspective) — `PaperView` is only
  `front | back | leftEdge | rightEdge | lieFaceUp | lieFaceDown`
  (`paper.ts:52`), selected by angle thresholds in `updatePaperView`
  (`paper.ts:99`: `EDGE_IN`, `EDGE_OUT`, `END_ON`, `BACK_IN`). A fourth upright
  view needs adding to all three of those plus a new draw path.
* SPEC_19 (N-02 Smell Blood, T-71 offside loitering/retreat).
* SPEC_20 (N-01 lineout teleport, SPEC_04 stage 2 realism/set-piece tuning).
* `SEASON_3_QUEUE.md` itself — **not yet written.** The grouping was drafted but
  never committed: SPEC_16 environment (isolated), SPEC_17 rig (squat/float,
  arm Z-sort, hip pivot), SPEC_18 art + 3/4 view, SPEC_19 AI debt (N-02, T-71),
  SPEC_20 set-piece/tuning (N-01, SPEC_04 stage 2).
