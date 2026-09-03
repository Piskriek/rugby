# SEASON 2 QUEUE — SPEC_11 … SPEC_15

**Status: DRAFT — HALTED FOR HUMAN REVIEW. No live TypeScript has been written.**

Season 1 (`SPEC_01 … SPEC_10`) is closed. Live playtesting produced six new
reports; they group into five specifications below. `SPEC_11` carries a full
read-only diagnosis (§1.2) because it is the only one of the five that is a
*correctness* bug rather than a missing feature — and because everything in
`SPEC_12`/`SPEC_13` is unmeasurable until the players are standing in the right
places.

| # | Playtest report | Spec | Title | Family |
|---|---|---|---|---|
| 1 | Defence drifts through the offence, ends up behind it, faces the wrong way; attackers freeze and recycle instead of going forward | **SPEC_11** | Formation anchoring — the ball-relative target contract | AI / positioning |
| 2 | Offsides are not enforced; wants Off / Enforce / Force-AI-clean toggles | **SPEC_12** | The offside line: observation → enforcement → prevention | Law |
| 3 | Violently forward passes are allowed | **SPEC_13** | Law 11 — the throw-forward vector test | Law |
| 4 | Players are too big for the pitch; tackle visuals lie | **SPEC_14** | Figure scale and contact truth (issue 4) | Render / physics |
| 5 | Shadows do not anchor to the feet | **SPEC_14** | Ground truth: the shadow anchor (issue 5) | Render |
| 6 | The referee does not animate; floating UI text should become in-world bubbles and referee animation | **SPEC_15** | The referee: an actor, a voice, a bubble | Presentation |

Issues 4 and 5 are one specification because they are the same defect class —
**the paper figure's relationship to the turf it stands on** — and both are
fixed by one new piece of shared truth (a body radius / ground anchor), not by
two independent tunings.

### Sequencing

```
SPEC_11  ──► SPEC_12 ──► SPEC_13        (law work is unmeasurable before 11)
   │
   └──────► SPEC_14 ──► SPEC_15          (presentation work, independent of law)
```

`SPEC_11` first and alone: until the defensive line is anchored to the ball,
the offside line of `SPEC_12` is being measured against players who are 25 m
from where they should be, and any penalty count is noise.

### House rules carried over from Season 1

1. **One labelled writer per player per frame** (`T-02`). Any new target writer
   goes through `writeThinkPlayer(...)` / `steer(..., gate, label)` and is
   attributable in the gate report.
2. **No threshold fiddling before measurement.** Every spec below that ends in
   a number starts with a probe that measures the current value on a seeded run.
3. **Gates do not move.** `gates.ts` (9 gates) and `statsAudit.ts` stay the
   guard rails; a spec that moves a gate must explain why in its own file.
4. **Pure helpers stay pure.** `forwardAttackDepth`, `passOptions` and friends
   take scalars and return plans; they may not move a player or read `Director`.

---

# SPEC_11 — Formation anchoring: the ball-relative target contract

**Report:** *"The defensive AI is drifting completely through the offensive
line, ending up behind them and facing the wrong way. Attackers are freezing
and passing the ball around instead of pushing for the try line."*

## 1.1 Objective

Restore a single invariant: **every target `think()` writes is an offset from
the live ball, never an absolute place on the pitch.** Then make the two
direction bugs that fall out of the repair impossible by construction, and give
the defensive line a facing rule so a retreating defender cannot show his back
to the play.

## 1.2 DIAGNOSIS (read-only; no code changed)

### The resolution order in `think()`

`think()` (`director.ts`) assigns each of the thirty a target in a strict,
one-way order, documented at the top of `engine/behaviour.ts`:

```
1. behaviour dataset  (datasetMark)      ← most specific
2. shapes.ts pod slot (attackMark / defenceMark)
3. jlr.ts role contract
```

Defence takes the dataset branch at `think:defence-dataset`; attack takes it at
`think:dataset-mark`.

### Finding A — the dataset is an ABSOLUTE map, and it wins every frame

`behaviour/types.ts` defines the dataset frame and the only conversion out of
it:

```
dataset x : 0..100 along the pitch, 0 = OUR try line, 100 = THEIR try line
dataset y : 0..100 across the pitch, 0 = LEFT touch,  100 = RIGHT touch
world  z  = -50 + x            (FIELD.tryZ -50 .. tryZFar +50)
world  x  = -35 + y * 0.70     (FIELD.minX -35 .. maxX +35)
```

`datasetMark()` returns that world point verbatim, mirrored for team B by a
point reflection through the middle of the park (`x → -x, z → -z`).

**The point is absolute.** It is where the shirt stands *in the authored
situation*, and each situation was authored with the ball in one fixed place.
Read off the data (`pos-01 … pos-15`, 100 points each — 15 shirts × 20
situations × 5 beats, so `hasBehaviour()` is true for every shirt in every
situation and the dataset branch is taken **every open-play frame, for both
sides**):

| situation | beat-1 dataset x across the 15 shirts | implied ball position β (dataset x) |
|---|---|---|
| `def-line-mid` | 28 … 44 (median 44) | ≈ **50** — halfway |
| `att-phase-mid` | 38 … 55 (median 53; shirt 9 at 55, the base) | ≈ **55** |
| `red-zone-22` | 72 … 82 (shirt 9 at 82, the base) | ≈ **82** |
| `goal-line-def` | 3 … 10 | ≈ **5** |
| `wide-edge` | 48 … 60 | ≈ **55** |
| `broken-field-def` | 30 … 42 | ≈ **42** |

`think()` writes the mark with **no translation to the live ball**:

```ts
// think:defence-dataset  (defence — both teams, raw absolute)
p.tx = clamp(dsm.x, -33, 33);
p.tz = clamp(dsm.z, -59, 59);
```

The live ball is at `focusPoint()`. The target error is therefore
`|ball − β_world|`, which is up to ~40 m and is only near zero when play
happens to be where the situation was authored.

**Worked example (this is the reported bug, exact numbers).** Shirt 15,
`def-line-mid`, beat 1 is authored `['def-line-mid', 1, 28, 50, 'THE LAST LINE:
hold at 18-20m depth, centred behind the ruck.']` → world **(x 0, z −22)**.
Team A is defending; team B is attacking toward `FIELD.tryZ = −50` with a ruck
at **z = −30**. Shirt 15's mark is **z = −22**: that is 8 m *behind the
attacking line*, on the far side of the ball from his own try line, where he is
supposed to be at ≈ −50. He runs to it — straight through the tackle
contest, the ruck and the whole attacking line.

Now the facing. `steer()` derives facing from velocity alone:

```ts
if (Math.abs(p.vz) > 0.3) p.face = p.vz > 0 ? 1 : -1;
```

He ran from −30 to −22, so `vz > 0`, so `face = +1` — facing **+z**, while the
team he is defending against is going **−z**. He is behind the offence, facing
away from it. That is the report, end to end.

**The same anchor error produces the attacking half of the report.** Shirts
10/12/13 in `att-phase-mid` are marked at world z ≈ −2 … +3 (midfield). An
attack at z = +35 has its entire backline marked ~30 m *behind* the carrier.
The carrier's pass options are computed from where his support actually is, so
every option is a man behind him: the attack spins and recycles and never
advances. Note the asymmetry that makes this worse for the human:

* **human** attacking team, dataset branch → `p.tx = dsm.x` / `p.tz = dsm.z`
  written **raw** (absolute lane *and* absolute depth);
* **CPU** attacking team, dataset branch → lateral is salvaged
  (`lateralOffsetMetres: dsm.x - f.x`) but depth goes into
  `forwardAttackDepth` as `nominalSupportDepthMetres = (f.z − targetZ) * dir`,
  which is the absolute error (35 m in the example) and is then clamped to the
  8 m ceiling of `FORWARD_ATTACK_DEPTH_LIMITS`.

So the CPU attack is depth-clamped and the human attack is not; both are
laterally wrong whenever the ball is near a touchline (the authored lane is a
world x, not an offset from the ball).

**Why Season 1's drift metric did not catch this.** `observeTargetSlot()` discards
any sample where the player is closing on his target:

```ts
const closing = distT > 0.35 ? (dxT * p.vx + dzT * p.vz) / distT : 0;
if (closing > 0.3) return;    // "executing the shape, not drifting from it"
```

A defender running 7 m/s at a stable-but-wrong mark is *closing* at 7 m/s, so he
is never sampled. The SPEC_10 P90 drift figure (15.9 m → 0.3 m) is therefore
blind by construction to a systematic anchor error of any size: **the metric
measures "not running toward your target", and this bug is "running hard toward
the wrong target".** Expect the SPEC_10 `[MISCALIBRATION]` verdict on LAW-66
(defensive-line holes, measured 7.4–8.3 m against a designed 3.8–4.0 m
`maxSpacing`) to be partly re-classified as `[BUG]` once this is fixed: a
defender 22 m up-pitch from his line-mates *is* the hole the audit found.

### Finding B — the direction is applied twice in the ball-relative fallback

```ts
// think:defence-line
const m  = defenceMark(p.num, s);              // m.z = s.ballZ + s.dir * dep * (1.35 - speed*0.55)
const tz = f.z + dir * (m.z - f.z) * 0.9 + dir * umb;
```

`m.z − f.z` is a **world-space signed offset that already carries `s.dir`**.
Multiplying by `dir` again is `dir · (dir · D) = D`, because `dir² = 1`. The
depth offset is now invariant to the direction of attack:

| attack | `m.z − f.z` | `tz` | correct |
|---|---|---|---|
| A, `dir = +1` | `+D` | `f.z + 0.9D + umb` | ✅ |
| B, `dir = −1` | `−D` | `f.z + 0.9D − umb` | ❌ should be `f.z − 0.9D − umb` |

The umbrella term (`+ dir * umb`, "metres behind the previous man, deepest at
the edge", `shapes.ts`) is correctly signed in both cases — the line curves
*back toward the defending team's own line*, which is the attack direction.
Only the depth term is wrong. **When team B attacks, the entire defensive line
is mirrored to the wrong side of the ball**, which is the same failure as
Finding A by a different route. This branch is currently unreachable in open
play (the dataset always wins), so it must be fixed as part of the repair —
otherwise fixing A simply hands the bug to this code path.

### Finding C — the openside mirror is a no-op

```ts
const flip = this.op && this.op.open < 0 ? -1 : 1;
targetX = clamp(f.x + lateral * s.open * flip, -33, 33);
```

`op.open` is `±1` only (`startOpen`: `Math.abs(x) > 8 ? -Math.sign(x) : Math.sign(x) || 1`).
So `s.open * flip` is `(+1)(+1)` or `(−1)(−1)` — **identically +1**. The
attacking shape is never mirrored to the openside. Same product is fed to
`planCpuForwardAttack` as `openside: s.open * flip < 0 ? -1 : 1`, which is
therefore always `+1`. This is a dead term, not a tuning.

### Finding D — the "beaten" predicate fires half a metre early

```ts
if ((q.z - carC.z) * dir < 0.5 && Math.hypot(...) < 16) coverChase.add(q.num);
```

That is `(carC.z − q.z) · dir > −0.5`: it is true for a defender level with the
carrier and up to half a metre *in front* of him. Intent was "the carrier has
gone past him", i.e. `(carC.z − q.z) · dir > +0.5`.

### Finding E — facing is velocity-only

`p.face` is set from `vz` alone in `steer()`. A defender back-pedalling in front
of a carrier (velocity along the attack direction) is drawn facing the same way
the attack is running: back to the play. Even with correct targets, a
back-pedalling line needs a facing rule.

## 1.3 The fix (mathematical)

**A. Anchor table.** Add the ball position each situation was authored around,
in dataset space, next to `SITUATION_META` (`behaviour/types.ts`):
`ball: { x, y }` per `SituationId` — the β column in the table above, verified
against the authored instruction text ("8-10 m behind the ruck", "18-20 m
depth", "hold the left corner on our goal line"). This is a **data-only**
change; nothing reads it yet.

**B. One conversion function.** Replace the absolute world point with a
ball-relative offset, computed once in `engine/behaviour.ts`. For team `T` with
attack direction `σ_T = +1` (A) / `−1` (B) and own try line `ownLine_T = −50·σ_T`:

```
along_T  = σ_T · (X_point − β_x)              // metres along the pitch
across   = (Y_point − β_y) · 0.70             // metres across the pitch

target.z = F.z + along_T                      // F = focusPoint()
target.x = F.x + openSign · across
```

`along_T` is exactly the existing mirror (`σ_T` scaling of the A-frame point)
with the authored anchor subtracted *before* the mirror instead of never. Checks:

* shirt 15, `def-line-mid`, A defending a ruck at −30: `σ_A·(28−50) = −22` →
  `target.z = −52` → 22 m behind the ruck, toward his own line ✅ (today: −22).
* shirts 10/12/13, `att-phase-mid`, carrier at +35: `σ_A·(48−55) = −7` →
  7 m behind the ball ✅ (today: ≈ 0).
* team B defending (σ = −1) mirrors correctly because `σ_T` is applied once.

**C. Feed the planner the true depth.** With B in place,
`nominalSupportDepthMetres = max(0.5, (F.z − targetZ)·σ_T)` becomes the real
depth automatically, the `[0.5, 8]` clamp stops doing the work of a missing
translation, and the pure `forwardAttackDepth` helper is unchanged.

**D. Fix the dead direction terms.** `tz = f.z + (m.z − f.z) * 0.9 + dir * umb`
(one `dir`); repair `s.open * flip` into a single live openside sign; correct
the cover-chase predicate to `(carC.z − q.z)·dir > 0.5`.

**E. Facing rule.** For a player whose job is `DEFENCE_LINE` (or, generally,
any defender not chasing and not the carrier), face the ball:
`if (Math.abs(F.z − p.z) > 0.4) p.face = Math.sign(F.z − p.z)` — with the
existing `lastFace`/`turnT` hysteresis so he cannot flap. Attackers keep the
velocity-derived facing.

**F. Depth compression at the dead-ball line** (`FIELD.deadZ ±62`). A mark
22 m behind a ruck 20 m from your own line lands in-goal. Clamp: a defender's
depth may not exceed the distance to his own dead-ball line minus 2 m.

## 1.4 Tasks

| id | task | kind |
|---|---|---|
| 11-a | Probe script: for a seeded 90 s run, log per defender per sample `dsm.z − (F.z + along)` (today: `dsm.z − F.z`) and the signed depth `(tz − F.z)·dir`. Do not change behaviour. | measurement |
| 11-b | Add `ball: {x,y}` to `SITUATION_META` for all 20 situations; verify each against its authored instructions. | data |
| 11-c | `datasetOffset()` — the pure ball-relative conversion; keep `datasetMark()` for tooling. | engine |
| 11-d | Point `think:dataset-mark` and `think:defence-dataset` at it (both teams, both axes). | engine |
| 11-e | Fix the double `dir`, the dead `s.open * flip`, the cover-chase predicate. | engine |
| 11-f | Defender facing rule + hysteresis. | engine |
| 11-g | Dead-ball depth compression. | engine |
| 11-h | Audit: signed-depth rule (a line defender's mark must satisfy `(tz − F.z)·dir ≥ −1.5`), and re-window LAW-66 once the line is anchored. | audit |

## 1.5 Gates

* 9/9 `gates.ts` gates unchanged (no teleports, no watchdog trips, tackles ≥ 8/60 s).
* P90 target-slot drift ≤ 2.5 m, and **signed** depth of every open-play
  defender's mark ≥ −1.5 m (today, unbounded positive error).
* LAW-66 line holes ≤ 4.5 m; if LAW-66 moves, the SPEC_10 verdict for
  `DEFENSIVE_LINE` is re-opened and re-verdicted.
* Attack: metres per entry into the 22 and red-zone conversion measured before
  and after on the same seeds (this is the "attackers freeze" report).
* 11-a's probe re-run: the anchor-error column is zero by construction.

## 1.6 Open decisions for review

* **D11-a — the across-pitch convention.** The dataset's `y` is authored
  left-touch/right-touch and the current B mirror negates it (a 180° rotation).
  Recommend: keep the along-pitch mirror as `σ_T`, and express across-pitch as
  a signed offset multiplied by the single live openside sign, so the two
  resolution paths (dataset and shape) finally agree. Consequence: shirts 11/14
  follow the live openside instead of their authored side.
* **D11-b — depth compression** (F) at the dead-ball line: clamp the mark, or
  let the fullback stand in-goal as the authored depth says?

---

# SPEC_12 — The offside line: observation → enforcement → prevention

**Report:** *"Offsides are not being enforced. We need an enforcement system
with user toggles (Off / Enforce / Force AI to never infringe)."*

## 2.1 What already exists (and is good)

The enforcement machinery is built and pinned by SPEC_04:

* `OFFSIDE_EPSILON_METRES = 0.35`, `OFFSIDE_SUSTAINED_SECONDS = 0.30`,
  `FORMATION_RESET_SETTLE_SECONDS = 0.75` (`director.ts`).
* `OffsideWindow` with per-shirt `OffsideTrack`s, one whistle per window
  (`penalised`), and a half-plane test `(z − line)·dir ≥ 0`.
* Two live hooks: `sampleFormedRuckOffside` (called from `breakdown.ts`, line is
  the hindmost defending ruck slot) and `sampleDefensiveLineResetOffside`
  (from `open.ts`, line is the contact mark during the release beat).
* Diagnostics: `formationIntegrity` already exposes `offsidePlayerSamples`,
  `offsideEpisodes`, `recoveryEpisodes`.

## 2.2 What is missing

1. **The option is binary and the write is gated to one value.**
   `data.ts`: `{ id: 'offside', values: ['ON','OFF'], def: 0 }`, and
   `evaluateOffsideWindow` ends with
   `if ((this.options.offside ?? 0) !== 0) return false;` — i.e. only mode `0`
   ("ON") writes a penalty; every other value is observation-only. Anything the
   user sets that is not `0` silently disables the whistle. That is the report.
2. **Coverage is two windows.** RUCK (formed) and RESET (the 0.9 s release
   beat). There is no line at the lineout (line of touch / 10 m), none at the
   scrum or maul (hindmost foot), and no open-play offside at all.
3. **One-sided.** Only the defending team is ever penalised.
4. **No prevention.** Nothing stops an AI from walking into an offside
   position; the whistle is the only tool.

## 2.3 The fix

**Mode enum** (`0 | 1 | 2`, numeric to honour the `Record<string, number>`
option contract), checked by an explicit switch — not by `!== 0`:

| mode | label | behaviour |
|---|---|---|
| 0 | `OFF` | Observe and count only. No whistle (Law 12 off, as the 1991 original allowed). |
| 1 | `ENFORCE` | Whistle. Extend coverage to the missing lines; apply to **both** sides; the human is subject to it. |
| 2 | `AI CLEAN` | Mode 1, **plus** the preventive constraint below: the AI never infringes, so the AI whistle never sounds. |

**Preventive constraint (mode 2).** After `think()` assigns targets and before
`steer()` integrates, project every offside-eligible AI player's mark onto the
legal half-plane for the live line:

```
if (mode === 2 && !isHuman(p.team) && isFormationEligible(p))
    tz = clampOntoLegalSide(tz, legalLineZ, dir, OFFSIDE_EPSILON_METRES);
```

and make the line an input to `separate()`, so a separation shove can never
push a man across it (the shove is the usual way a "clean" AI infringes).
The retreat when the line moves (ball out of the ruck, put-in, throw) stays
owned by the existing release beat.

**Line registry** — one table, one owner, so a new line is a data row:

| line | where | z origin | eligible |
|---|---|---|---|
| RUCK | hindmost defending ruck slot | `sampleFormedRuckOffside` | defending, unbound |
| RESET | contact mark | `releaseBeat.z` | defending |
| SCRUM | hindmost foot of the defending pack | `scrim` | backs + unbound forwards |
| MAUL | hindmost foot | `ml` | unbound |
| LINEOUT | line of touch, 10 m gap | `lo.markZ` | both |
| OPEN | the ball itself (ahead of the ball at a ruck/maul, both sides) | `focusPoint()` | attacking too |

## 2.4 Tasks / gates

* 12-a: name the mode enum, replace `!== 0`, extend the option to three values.
* 12-b: line registry + the four missing lines.
* 12-c: both-sides enforcement; the human is not exempt.
* 12-d: mode 2 projection + `separate()` line awareness.
* 12-e: trace field `offsideLineKind`; one audit rule per line family.
* Gates: mode 1 → episode counts in the observed band; **mode 2 → 0 AI
  episodes** over 3 seeds × 3 difficulties with the human's episodes still
  counted; mode 0 → counts unchanged; `encroach` gate stays 0; tackles ≥ 8/60 s.

---

# SPEC_13 — Law 11: the throw-forward vector test

**Report:** *"The game currently allows violently forward passes. We need
strict vector checking to kill these."*

## 3.1 Evidence

There is **no direction test anywhere in the pass path**.

* `doPass` (`engine/open.ts`) calls `passOptions(...)`, rolls a single
  `errorChance` (a *spill*), and inside that error branch only, calls
  `lawCall('FWD_PASS', ...)` when `strict < 2 && R() < 0.5`. A perfectly thrown
  20 m forward pass is never examined — the "forward pass" is today a random
  name given to a handling error.
* `solvePassTarget` (`intelligence.ts`) **manufactures** forward travel:
  ```ts
  if ((tz - from.z) * dir < 0.3) tz = from.z + dir * 0.4;   // never solve a target behind the passer
  ```
  Every short pass is guaranteed ≥ 0.4 m of forward travel, and the lead
  projection `tz = r.z + dir * lead` adds up to `1.5 s × 0.8 × maxSpeed ≈ 10 m`
  on top.
* `passOptions` admits a receiver up to 10 m behind the carrier
  (`(m.z − carrier.z) * atkDir < −10` → skip), so late in the shot clock the
  solver can throw to a trailing man and land it in front of the thrower.
* The audit's only Law 11 rule is `LAW-63`, which checks *distance* ≤ 26 m.
  (`LAW-41` already does this properly for kicks via `forwardRelativeKick`.)

## 3.2 The fix

**Test.** Law 11 asks whether the ball left the thrower's hands forward
*relative to him* — a flat pass thrown by a man running forward is legal. So
the test is on the ball's velocity relative to the thrower:

```
rel      = (v_ball − v_thrower) · dir          // m/s along the attack axis
forward  = rel > tol                            // tol: STRICT 0 · NORMAL 0.5 · LENIENT 1.5
```

Because the game solves a landing point rather than a velocity, the equivalent
geometric form (applied in `solvePassTarget`) is:

```
allowed  = max(0, v_thrower · dir) · flightTime        // momentum the thrower carries into the pass
forward  = ((tz − from.z) · dir) − allowed  >  tol · flightTime
```

**Where it bites, in order:**

1. **Selection** (`passOptions`) — never *offer* a pass whose solved vector is
   forward. If no legal candidate exists on a side, offer none; the UI shows
   `NO BACKWARD OPTION — TAKE IT IN`.
2. **Solve** (`solvePassTarget`) — delete the `+dir*0.4` floor; replace it with
   a backward floor (the ball may not finish ahead of the release point in the
   thrower's frame) and clamp the lead to `allowed`.
3. **Execution** (`doPass`) — if a pass is thrown forward anyway (a human
   override, a cut-out), whistle it: `lawCall('FWD_PASS', ...)` +
   `startScrum(defending, throwX, throwZ)` — scrum **where the pass was
   thrown**, per the law book. The spill path keeps its own call (knock-on /
   missed) and stops borrowing the forward-pass name.
4. **CPU** — a forward offered candidate is a *gate failure*
   (`forwardAttackPassCandidateFailures`), so it can never silently happen.
5. **Audit** — add `forwardRelativePass` to the trace (mirroring
   `forwardRelativeKick`), extend `LAW-63`, and add a new rule:
   "no offered or executed pass is forward relative to the thrower".

## 3.3 Tasks / gates

* 13-a probe: count, on seeded runs, executed passes with `rel > 0` and the
  worst `rel` (expect a large, non-trivial number).
* 13-b the test + the three call sites; 13-c gate; 13-d audit.
* Gates: **0 forward passes** at `STRICT` over 3 seeds × 3 difficulties; pass
  count and completion rate inside the `statsAudit` realism band (the point is
  to kill illegal passes, not all passes); no watchdog trips; the human can
  still complete a pass to a man running onto the ball (the momentum allowance
  is what makes that legal — regression-test it explicitly).

---

# SPEC_14 — Figure scale and ground truth

**Reports 4 and 5.** One defect class: the paper figure's relationship to the
turf. Fixed by one new piece of shared truth, not two tunings.

## 4.1 Scale and contact (report 4)

**Where the truth currently lives, and where it does not.**

* The builds are authored at real heights — `BUILDS` (`render/paper.ts`):
  `h 1.76 … 1.98 m`, shoulders `0.45 … 0.58 m`, head radius `0.135 … 0.145 m`
  (a real head is ~0.11 m radius: the head is deliberately oversized for the
  papercraft read). Drawing is in metres: `X(m) = m · sc`, with
  `sc = focal / depth` px-per-metre (`retro.ts`). So the silhouette is
  *nominally* true.
* The **drawn** silhouette is not: head ≈ 0.28 m across, `bulk` up to `1.28`
  (props), every limb card stroked with `lw = clamp(sc·0.021, 1.05, 3.2)` px of
  outline on both sides, plus fold tabs and the number badge. At the standard
  cable rig (h ≈ 13 m, fov 0.42) a player at ~25 m depth is ~120–130 px tall
  in a 720-px viewport — ~18% of frame height, against a broadcast reference of
  8–12%. **Two bodies drawn that wide read as touching at a separation where
  they are legally 0.8 m apart.**
* The physics radii are a different set of numbers again: tackle contact is a
  1.1 m centre-to-centre test (`nearest.d < 1.1`, `engine/open.ts`);
  `separate()` holds opponents at 0.82 m and team-mates at 1.05 m.
* **A third scale channel exists and is dead.** `PLAYER_SIZE` (`director.ts`,
  documented as *"T-39. Per-shirt build, as a visual scale multiplier"*,
  0.92 … 1.12) is copied to `Actor.size` by `syncActors()` — and **nothing in
  `src/render/` reads it**. The renderer takes `build` from `BUILDS` by shirt
  number instead. It does reach physics, as `sizeMul` in `maxSpeed()`. So the
  engine has a build scale the art cannot see, and the art has one the engine
  cannot see. Pick one (see 14-b).

**The "looks close enough to touch but no tackle" part is not the radius — it
is the selection.** `upOpen` takes `const nearest = dists[0]` and then
`if (tackler.beatenT <= 0 && …)`. **Only the nearest defender is ever tested
for a tackle.** If the nearest man has been beaten (`beatenT > 0`, the slipped
tackle from T-18), the block returns and *nobody* can tackle the carrier until
that timer expires — a beaten man is a shield. Post-ruck `s.protect` suppresses
all contact the same way.

**Fix**

1. One constant: `BODY_RADIUS` per build (half shoulder width + a small reach
   allowance), exported from `paper.ts` and consumed by the engine. Art and
   physics then disagree only by choice, never by accident. Retire one of the
   two build scales while doing it: either `Actor.size` reaches the draw call
   (recommended — the T-39 intent) or `PLAYER_SIZE` is deleted and `BUILDS`
   is the only source.
2. Contact derived from it: `contact = r_carrier + r_tackler + reach(≈0.45)`,
   replacing the bare 1.1 m literal, and `separate()` uses the same radii.
3. **Nearest *eligible* defender**: iterate `dists` in order and take the first
   defender who is not beaten, not down, not sin-binned and not in the release
   retreat.
4. Framing: calibrate the default zoom so a player at the ball occupies
   10–12% of viewport height (a camera change, not a lie about the figure's
   height). Measure first (14-a), do not guess.

## 4.2 The shadow anchor (report 5)

`drawPaperShadow` (`render/coronal.ts`):

```ts
const down  = p.fall > 0.6;
const air   = Math.max(0, p.hip - 0.94);
const rx    = down ? 0.95 * sc : (0.3 + a.build.shW * 0.32) * sc * (1 + air * 0.9);
const ry    = down ? 0.34 * sc : rx * 0.3;
ctx.ellipse(a.sx + sc * 0.06, a.sy + sc * 0.02, rx, ry, 0, 0, 2π);
```

Four independent reasons it floats:

1. **The offset is a fraction of projected scale**, not a projected ground
   offset. `+sc·0.06` right and `+sc·0.02` down means the light is a
   *screen-space* light: the shadow slides off the feet as you zoom.
2. **It never follows the planted foot.** `pinPlantedFoot()` pins the planted
   foot for every gait (SM-02/W-07/B-04) — the shadow is still drawn at the
   actor's root, so during a stride the feet and the shadow disagree.
3. **The lying predicate differs from the actor's.** The shadow uses
   `p.fall > 0.6`; the actor's view is chosen from `pg.lie`. During a fall the
   standing ellipse is drawn under a tipping body. The papercraft contract
   (`papercraft.ts` B-04/L-03/D-03/L-11) says: *the shadow sits exactly under
   the anchor; a lying figure anchors at its centre; airborne = lighter and
   wider*.
4. **`ry` is fixed at `0.3·rx` regardless of camera tilt.** A ground ellipse
   seen from a steep camera is nearly circular; drawn flat, it detaches.

**Fix**

* `groundAnchor(pose, view)` → the planted foot, or the body centre when
  `lie`, or the hip when airborne. One function, used by the shadow only.
* Project a **world** light offset: `project(cam, v, rx + LIGHT.x·h, 0, rz + LIGHT.z·h)`
  for a single stadium light direction, instead of `sc`-fraction nudges.
* `ry = max(1.5, rx · sin(tilt))`; size and alpha from `air` (already present).
* Use the actor's own `lie` predicate; body-length ellipse when lying.
* Dev assertion: |shadow centre − projected anchor| ≤ 2 px at any zoom/tilt,
  plus a debug overlay dot.

## 4.3 Tasks / gates

* 14-a probe: on-screen player height as a fraction of viewport at the default
  rig; drawn silhouette width (px) vs `BODY_RADIUS`; per-frame count of
  "eligible tackler exists but nearest is beaten".
* 14-b `BODY_RADIUS` + derived contact/separation radii; 14-c nearest-eligible
  selection; 14-d framing calibration; 14-e/f/g shadow anchor.
* Gates: 9/9 gates with tackles **rising** (nearest-eligible unblocks real
  tackles) and no teleports; `separate()` still holds bodies apart at the new
  radii (no overlap); shadow-anchor assertion 0 failures across a seeded run at
  three zoom levels; before/after screenshots for human sign-off on scale
  (**halt**).

---

# SPEC_15 — The referee: an actor, a voice, a bubble

**Report:** *"The ref doesn't animate. Remove the floating UI text above
rucks/game events and replace it with in-world, above-the-head speech bubbles
and animations for the Referee to organically control the game."*

## 5.1 Evidence

* **He does not animate — by construction.** `mapAction` in `render/scene.ts`:
  ```ts
  case 'ready': case 'nineSquat': case 'refReady': return 'idle';
  …
  case 'refSignal': return 'idle';
  ```
  His only two clips are `refReady` and `refSignal` (`syncActors`), and both
  resolve to the static `idle` pose. There is no ref clip in `CLIPS`
  (`render/clips.ts`) beyond the idle mapping.
* **He does not walk; he is placed.** `syncActors()` sets him by assignment
  every frame: `ref.rx = f.x*0.4 + 8; ref.rz = f.z − dir*11;`. There is no
  steering and no `movedBy` tag, so `puppetFor()` derives his velocity from a
  teleport — whenever the focus jumps (turnover, kick) his derived speed spikes
  and his facing whips. `ref.rf` is never written at all (it stays at the
  constructor's `1`).
* **The floating text is everywhere.** In-world `worldLabel` calls in
  `render/scene.ts` carry the game's instructions: `USE IT`, `SECURED`,
  `COMMIT — SPACE`, `A/D — CLEAROUT`, plus kick/maul/scrum labels; the referee's
  own call is a HUD strip (`REFEREE: {d.refSignalText}` in `ui/MatchView.tsx`),
  and `showHint`/`banner_` duplicate the rest.

## 5.2 The fix

1. **Make him a player.** Give the referee a `tx/tz` per phase (behind the ball,
   8–12 m, blind side; his law position at each set piece), steer him with the
   same `steer()` the thirty use, and tag him `movedBy = 'ref'` so the T-02
   ownership contract covers him. Facing: the ball.
2. **Give him clips.** Author/enable, and map in `mapAction`:
   `refWalk` / `refJog` / `refSprint` (gait library, `BUILDS.REF`), plus
   one-shots `refWhistle` (0.6 s), `refSignalPenalty` (1.0 s, arm at 45°),
   `refSignalAdvantage` (both arms), `refSignalScrum`, `refSignalTry`,
   `refCard` (reach to the pocket). Delete the two dead `case … 'idle'` lines.
3. **Speech bubbles.** An in-world paper-card bubble anchored ~2.4 m above his
   head (projected like `worldLabel`, drawn as a filled card with a tail toward
   his head), fed by a small priority queue `ref.say(text, kind, ttl)` —
   penalty > card > law call > narrative > nudge — so a big call preempts a
   nudge and the queue drains in order.
4. **Remove the floating text.** Every `worldLabel` that is an *instruction*
   (`USE IT`, `SECURED`, `COMMIT — SPACE`, `A/D — CLEAROUT`, the set-piece
   prompts) becomes a referee bubble + the existing HUD narrative panel. Keep
   in-world only true telemetry: the gain line, timers, landing markers.
5. **Personality.** The existing `referee` option (THE WHISTLER / THE BALANCED /
   LET IT FLOW / THE TECHNICAL) drives bubble wording and animation timing, not
   just penalty frequency.

## 5.3 Tasks / gates

* 15-a: ref steering + facing + ownership tag; 15-b: clip mapping and the two
  dead cases; 15-c: bubble queue and renderer; 15-d: delete the instructional
  `worldLabel` calls; 15-e: personality wiring; 15-f: trace field `refBubble`.
* Gates: audit rule "every `lawCall` produced a bubble within 0.2 s" — 0
  failures over 3 seeds; the `HINT` / `BANNER` / `CONTEXT` audit families do not
  regress (they are the families that consumed the removed text); no watchdog
  trips; **halt for human sign-off on the bubble art and on the text deletion
  list** (removing HUD text is a UX change the reviewer owns).

---

# 6. Verification harness (shared)

Every spec above is closed with the same three runs, seeded (`scripts/audit-cli.ts`,
`scripts/stats.ts`, `runGates`):

```
seed 1, 7, 13  ×  difficulty 0, 3, 6  ×  90 s
```

and reported as: 9/9 gates · rule audit PASS/WARN/FAIL counts · the
`statsAudit` realism bands · the spec's own probe numbers (before → after).

# 7. The halt

**This document is the halt.** No live TypeScript has been written. Awaiting
your review of:

1. the **grouping** — issues 4 + 5 merged into `SPEC_14`;
2. the **sequencing** — `SPEC_11` alone, before any law work;
3. the **SPEC_11 diagnosis** (§1.2): Finding A (absolute dataset anchor) as the
   primary cause, B/C/D/E as secondary;
4. the **fix shape** (§1.3) — an authored per-situation ball anchor plus one
   ball-relative conversion, rather than re-authoring 1,500 dataset points;
5. **decisions D11-a** (across-pitch convention) and **D11-b** (dead-ball
   depth compression).

Say the word and I start on 11-a (the measurement probe) — or on whichever
spec you want first.
