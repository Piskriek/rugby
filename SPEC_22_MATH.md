# SPEC_22 — SILHOUETTE BREATHING & ARM FLARING

Diagnosis and mathematical proposal. **No live engine code written.**
Probes: `/tmp/s22probe.ts`, `/tmp/s22sil.ts`, `/tmp/s22px.ts`, `/tmp/s22design.ts`,
`/tmp/s22phase.ts`.

---

## 1. DIAGNOSIS

### 1.1 The root cause is a constant, not a tuning value

`abL` / `abR` (per-side abduction) are authored in `clips.ts` as **`0.08`, flat,
in every keyframe of `walk`, `jog`, `run` and `sprint`.** The run cycle at
`clips.ts:163-165` sets `abL: 0.72, abR: 0.78` … but those are the **shuffle**
clip. The straight-line gaits inherit `STAND`'s `abL: 0.08, abR: 0.08` and
**never modulate it**.

So the elbows have no gait-driven lateral component whatsoever. The only lateral
motion the elbow currently gets is the incidental `dep * 0.055 * s` depth term
and the foreshortening of `upD`. The Lead Designer's "dead, unchanging
silhouette" is therefore **structurally exact, not a matter of degree**: there is
no oscillating lateral term in the arm rig at all outside SPEC_18.5's turn flare,
which is zero in a straight line by construction.

### 1.2 Measured lateral daylight — there is none

Daylight measured as *inner edge of the upper-arm card* minus *torso edge at the
elbow's height* (`+` would be a real hole; build `CENTRE`, upper-arm card
half-width 0.061 m):

| gait | daylight min | daylight max | frames with ANY daylight |
|---|---|---|---|
| walk | −0.0416 m | −0.0238 m | **0 / 240** |
| jog | −0.0474 m | −0.0199 m | **0 / 240** |
| run | −0.0596 m | −0.0316 m | **0 / 240** |
| sprint | −0.0707 m | −0.0307 m | **0 / 240** |

**The arm card never separates from the torso on any frame of any gait.** The
best case is still 1.9 cm of overlap. The requested measurement — "lateral
daylight between elbow and torso edge" — is, precisely, **zero pixels at every
scale**, because the value is negative throughout.

In pixels, `px = m × sc × FIGURE_SCALE(1.65)`:

| gait | best daylight @ sc 12 (far) | @ sc 20 (mid) | @ sc 34 (near) |
|---|---|---|---|
| run | −0.63 px | −1.04 px | −1.78 px |
| sprint | −0.61 px | −1.01 px | −1.72 px |

### 1.3 Silhouette breath is sub-pixel

The arm *does* define the outer silhouette on **240/240 frames** (arm outer
0.331 m vs torso half 0.255 m), so the outline is arm-driven — it simply does
not *move*:

| gait | silhouette half-width min → max | breath | @ sc 20 | @ sc 34 |
|---|---|---|---|---|
| walk | 0.3126 → 0.3202 m | 7.6 mm | 0.25 px | 0.43 px |
| jog | 0.3128 → 0.3243 m | 11.5 mm | 0.38 px | 0.64 px |
| run | 0.3128 → 0.3309 m | **18.1 mm** | **0.60 px** | **1.02 px** |
| sprint | 0.3130 → 0.3351 m | 22.1 mm | 0.73 px | 1.24 px |

**At mid distance the entire silhouette varies by 0.60 px over a full stride.**
That is below the quantisation of the renderer — the outline is, to the pixel
grid, *literally constant*. The diagnosis is confirmed in the strongest possible
terms.

---

## 2. DESIGN

### 2.1 Where the term belongs

**In the draw path, as an addition to `ab`, not in the IK.** Three reasons:

1. The coronal arm is **not** IK-solved. Unlike the leg (which uses `solveKnee`),
   `drawOneArm` is straight forward-kinematics: `elX = sx0 + s*(ab + abBias)*upD*0.85`.
   There is no IK to modify.
2. `ab` is already the correct channel. SPEC_18.5's turn flare (`abBias`) enters
   at exactly this point and is proven. A gait term is the same kind of quantity
   and should compose additively with it.
3. It keeps the change inside the drawer. `clips.ts` keyframes stay untouched, so
   no clip needs re-authoring and the reference clips in `refClips.ts` stay valid.

### 2.2 Proposed mathematics

Add a gait-phase abduction to each arm:

```
  swing_s   = |sin(a_s)|                       // a_s = that arm's sagittal angle
  gaitFlare = (AB_BASE + AB_SWING · swing_s) · speedGate · carryWeight_s
  ab_eff_s  = ab_s + gaitFlare + abBias_s      // abBias_s = SPEC_18.5 turn term
```

**Why `|sin(a)|` and not a free-running phase clock.** The flare must be driven
by the arm's *own authored angle*, exactly as SPEC_18.1's shading is driven by
`sin(l)` and SPEC_18.3a's footfall is read from the rig's clearance helper. A
separate `u`-based oscillator could drift out of sync with the clip, and the
codebase has an explicit rule against that (SPEC_18.3a: "read from the rig's own
clearance helper, not from a hardcoded phase table"). `|sin(a)|` peaks at maximum
swing in *either* direction, which is anatomically right: the shoulder abducts
most at the extremes of the swing and tucks at the neutral pass.

**Frequency.** Because `|sin|` is even, this oscillates at **twice** the stride
frequency — two breaths per stride, one per arm extreme. That is the "continuously
breathing" read the brief asks for, and it emerges from the anatomy rather than
being imposed by a magic constant.

**`speedGate`** reuses the SPEC_18.5 pattern — `smoothstep(1.5 → 3.5 m/s)` — so a
stationary player does not stand with his elbows flared. The standing constraint
"no bias when stationary" is already a ruled constant of this codebase and must
carry over.

**`carryWeight_s = 1 − carryLock_s`** reuses SPEC_18.5's existing suppression so a
ball-carrying arm cannot flare away from the ball. This is a ruled constraint
already in force for the turn flare; the gait flare must respect it identically.

### 2.3 Constant sweep (measured, build `CENTRE`, `run`)

| `AB_BASE` | `AB_SWING` | daylight @20 (min..max) | breath @20 | breath @34 | max total abduction |
|---|---|---|---|---|---|
| 0.10 | 0.10 | −0.70 .. 0.82 px | 1.24 px | 2.11 px | 0.233 |
| 0.18 | 0.20 | 0.39 .. 1.95 px | 1.45 px | 2.46 px | 0.366 |
| 0.18 | 0.30 | 0.57 .. 2.40 px | 1.89 px | 3.21 px | 0.420 |
| 0.26 | 0.20 | 1.08 .. 2.63 px | 1.40 px | 2.38 px | 0.446 |
| **0.26** | **0.30** | **1.29 .. 3.08 px** | **1.84 px** | **3.13 px** | **0.500** |

`AB_BASE` buys **daylight** (a constant push-off from the torso); `AB_SWING` buys
**breath** (the oscillation). They are close to independent, which makes them
tunable separately.

**Recommendation: `AB_BASE = 0.26`, `AB_SWING = 0.30`.** Across all four gaits:

| gait | worst daylight @20 | breath @20 | breath @34 |
|---|---|---|---|
| walk | 1.28 px | 0.81 px | 1.38 px |
| jog | 1.28 px | 1.22 px | 2.07 px |
| run | 1.29 px | 1.84 px | 3.13 px |
| sprint | 1.31 px | 2.17 px | 3.69 px |

Daylight goes from **negative on 100% of frames to ≥1.28 px positive on every
frame of every gait**, and breath scales naturally with gait energy — walk barely
breathes, sprint breathes most.

### 2.4 Honest limits of this proposal

Two things I want on the record rather than discovered later.

**(a) Breath is modest in absolute terms.** Even at the recommended constants the
outline moves ~1.8 px at mid distance and ~3.1 px near camera. That is a real,
visible change against the current 0.60 px, but it is not dramatic. Pushing
`AB_SWING` past ~0.30 starts to look like a chicken-wing at the swing extremes.
If the Lead Designer wants a stronger read, the honest lever is **`AB_BASE`
combined with a torso-width or shoulder-roll term**, not more `AB_SWING` — but
that is a larger change and outside what I would do under No Scope Creep without
a ruling.

**(b) A probe of mine printed a wrong conclusion, and I am flagging it.** An
intermediate run of `/tmp/s22phase.ts` printed *"antiphase arms CANCEL … a
per-arm `|sin|` flare therefore CANNOT breathe the outline"*. **That conclusion
is false and I retract it.** The same probe's own data contradicts it:
`max(|sin aL|, |sin aR|)` ranges **0.005 → 0.532** over a cycle, i.e. the
outermost arm varies a great deal. The text was a hasty read of the summary line;
the numeric sweep in §2.3 is the authority and it shows the per-arm term working.
I would rather show the retraction than quietly delete the probe.

### 2.5 Interaction with SPEC_18.5

The gait flare adds to the turn flare. Worst case, outside arm, `|turn| = 1`:

| `|turn|` | max total abduction |
|---|---|
| 0 | 0.500 |
| 0.5 | 0.570 |
| 1 | **0.640** |

For reference the `shuffle` clip authors `abL/abR ≈ 0.72–0.80` deliberately, so
0.640 stays **inside the range the art already uses** and is not an anatomically
novel pose. No clamp is strictly required, but I would add
`ab_eff = min(ab_eff, AB_MAX = 0.72)` as a cheap guarantee that a future
`ELBOW_GAIN` change cannot push the arm into a pose no clip ever authored.

---

## 3. PROPOSED VERIFICATION

1. **Daylight gate** — inner arm edge vs torso edge > 0 on **100%** of frames,
   all four gaits, all ten builds. Currently 0%.
2. **Breath gate** — silhouette half-width variation ≥ **1.5 px @ sc 20** on
   `run` and `sprint`. Currently 0.60 / 0.73 px.
3. **No-flare-when-stationary** — `gaitFlare == 0` exactly at speed 0.
4. **Carry suppression** — a ball-locked arm's `gaitFlare` is 0, reusing the
   SPEC_18.5 `carryLock` weight.
5. **Regression** — 9/9 Season 3 gates, 15/15 seed × difficulty, SPEC_06
   hysteresis, and the SPEC_21 gates (the arm term must not perturb the
   transform stack).
6. **Shot sheet** — a new SPEC_22 row on `spec21_shot.png`'s successor, four
   points across the run cycle, so the breathing can be judged by eye and the
   silhouettes confirmed not to fuse (standing SPEC_18.1 requirement).

---

## 4. HALT

Awaiting ruling on:

- **`AB_BASE` / `AB_SWING`** — recommended `0.26` / `0.30`.
- **`AB_MAX` clamp** at 0.72 — recommended, cheap insurance.
- **§2.4(a)** — whether ~1.8 px breath @ mid is sufficient, or whether you want a
  larger silhouette change (which needs a wider ruling than the arm rig alone).
