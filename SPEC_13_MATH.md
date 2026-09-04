# SPEC_13 — Law 11: the throw-forward vector test

**Status: DESIGN, HALTED FOR REVIEW.** No engine code has been written for the
forward pass. What exists is the probe (`scripts/spec13probe.ts`), which is
read-only, and this document.

**Report:** *"The game currently allows violently forward passes. We need strict
vector checking to kill these."*

---

## 0. What the probe measured first

House rule 2 says no threshold fiddling before measurement, so the baseline
came first. Seeded runs, 200 s × 3 seeds, per difficulty:

| | passes | forward at release | STRICT (tol 0) | LENIENT (tol 1.5) | naive absolute test | flight-manufactured |
|---|---|---|---|---|---|---|
| diff 1 | 156 | 9 (5.8%) | 9 | 9 | 16 | 8 (worst 2.85 m) |
| diff 3 | 132 | 9 (6.8%) | 9 | 5 | 17 | 6 (worst 2.46 m) |
| diff 5 | 135 | 7 (5.2%) | 7 | 5 | 12 | 6 (worst 2.47 m) |

Distribution of `rel` (m/s forward relative to the thrower), difficulty 3:

```
min −19.66   p50 −10.55   p90 −5.26   p99 +4.23   max +4.33
thrower's own forward speed     p50 5.92   p90 7.04
receiver ahead of thrower       p50 −2.77 m   p90 +0.41 m
```

Four things fall out of this, and the last two are the design:

1. **~6 forward passes per match.** Real rugby calls one to three. The report
   is real.
2. **Most passes are thrown sharply backward** (p50 −10.5 m/s). The engine is
   not indiscriminately forward; a specific population is.
3. **A naive absolute test would whistle roughly twice as many passes as the
   law does** — 17 against 9 at difficulty 3. Eight passes per 600 s travel
   forward over the ground and are *legal*, because the thrower's legs carried
   them. This is the momentum defence, and it is why the relative test is not
   a nicety. It is the difference between killing 6% of passes and killing 13%.
4. **Six to eight passes per 600 s are released legally and arrive forward**
   (worst ~2.9 m). The flight itself manufactures forward travel. A test that
   only examines the release will not fix the report, because the thing the
   player sees is where the ball ended up.

---

## 1. Phase 1 — the vector math

### 1.1 The question Law 11 actually asks

Not *"did the ball move forward over the ground?"* but *"did the ball leave the
thrower's hands forward relative to him?"* A flat pass by a man running at
7 m/s is legal; the same pass by a stationary man is not. The absolute
trajectory is the wrong frame, and it is the frame a naive test uses.

### 1.2 The frames

The pitch's attack axis is `z`, with goals at ±59. Define the attacking sign:

```
σ(team) = +1 for A (attacks +z),  −1 for B (attacks −z)
```

This is the same `sigmaOf` the offside engine uses, so the two laws agree on
which way is forward. Forward is always *toward the opposition dead-ball line*,
never toward a screen edge and never toward the camera.

### 1.3 Isolating the relative release vector

Two world-frame velocities, both taken **at the instant of release**:

```
v_ball  — the ball's velocity in world coordinates   (m/s)
v_man   — the thrower's velocity in world coordinates (m/s)
```

The relative velocity is a plain vector subtraction:

```
v_rel = v_ball − v_man
```

Then project onto the attack axis and sign it so that positive means forward:

```
rel = (v_rel · ẑ) · σ          [ m/s ]
    = ((v_ball.z − v_man.z)) · σ
```

**What is deliberately discarded, and why:**

- **`v_rel · x̂` — the lateral component.** Law 11 is about travel toward the
  opposing dead-ball line. A pass thrown square across the pitch at 13 m/s is
  not forward at any speed, however violent it looks. Keeping the lateral term
  would whistle every cut-out pass in the game.
- **`v_rel · ŷ` — the vertical component.** The ball's arc is not direction. A
  lofted pass and a flat one are subject to the same test.
- **Everything after release.** The law judges the hands, not the pursuit
  curve. Section 1.6 deals with the flight separately, because it is a
  separate defect.

### 1.4 Where `v_ball` comes from in this engine

There is no ball velocity state. `doPass` puts the ball on the carrier and sets
`s.ball.live = true`; `upOpen` then flies it at a **constant 13 m/s ground
speed towards the receiver's current position**, recomputed every frame. So the
release velocity is reconstructed rather than read:

```
v_ball = PASS_SPEED · unit(p_receiver − p_release)          PASS_SPEED = 13
```

and therefore, in full:

```
dz      = rec.z − car.z
dx      = rec.x − car.x
len     = hypot(dx, dz)                      // ≥ 0.01, never divide by zero
v_ball  = (13 / len) · (dx, dz)
rel     = (v_ball.z − car.vz) · σ
```

`car.vz` is the thrower's world vz **at the launch frame**. This is the whole
test. It is four subtractions and a divide.

### 1.5 Why not the landing point — and why I am proposing a change to the spec

Section 3.2 of the queue specifies the *geometric* form:

```
allowed = max(0, v_thrower · dir) · flightTime
forward = ((tz − from.z) · dir) − allowed  >  tol · flightTime
```

That form is correct **for a ballistic flight to a fixed point**, and I want to
show the equivalence rather than just assert it, because the choice matters. If
the ball flies in a straight line to a fixed target over time `T`, then

```
v_ball = (p_target − p_release) / T
```

and substituting into the velocity form:

```
rel > tol
⟺ ((p_target − p_release)/T · ẑ · σ) − (v_man · ẑ · σ) > tol
⟺ ((p_target − p_release) · ẑ · σ) − (v_man · ẑ · σ) · T > tol · T
```

which is the geometric form with `allowed = (v_man · ẑ · σ) · T`. **One law,
two instantiations.** The velocity form is the primitive; the geometric form is
what it collapses to when the flight is straight.

But this engine's flight is **not straight and has no fixed target**:

- `solvePassTarget`, the function section 3.2's fix is written against, **is
  dead code — it is never called.** (Its lead logic was inlined into
  `passOptions` at intelligence.ts:626, which is where the fix has to land.)
- `upOpen` flies the ball at the receiver's *current* position every frame — a
  pursuit curve. The landing point does not exist until the catch.
- Worse, while the ball chases the receiver, the receiver is being steered to
  `rec.tz = ball.z + σ · 1.0` — a point **one metre ahead of the ball**, every
  frame. The ball is dragged forward by the man it is chasing. That is the
  mechanism behind the 6–8 manufactured passes the probe found.

So a landing-point test here would measure the pursuit, attribute the
flight's own manufactured travel to the thrower, and whistle men who released
the ball legally. **The velocity form at the release frame is the honest
instrument in this engine**, and it is also the literal wording of the law.

### 1.6 The momentum allowance

```
allowed = max(0, v_man · ẑ · σ)
rel     = (v_ball · ẑ · σ) − allowed
```

`max(0, …)` matters: a thrower backpedalling gets **no** allowance. Momentum
only excuses travel in the direction he is already going.

Measured: the thrower's own forward speed is p50 5.92 m/s, p90 7.04 m/s. So the
allowance is not a rounding error — it is worth 3–5 metres on a 0.6 s pass.
That is the difference between the 9 the law calls and the 17 a naive test
calls.

### 1.7 The tolerance

Tolerances are in **m/s along the attack axis**, per section 3.2:

```
STRICT  0.0     NORMAL  0.5     LENIENT  1.5
```

I recommend testing the velocity, not `tol · flightTime`, because the flight
time is itself an estimate (`opt.time = clamp(dist / 14, 0.18, 1.5)`) and a
whistle should not depend on an estimate it does not need. The metres form is
still the right thing to *show* — `rel × flightTime` is "metres forward",
which is what a player understands.

### 1.8 Sampling discipline

The release must be sampled **in `doPass`, on the launch frame**, where
`s.ball.x/z` is the release point and `s.carrierNum` is still the thrower. One
frame later the ball has moved ~0.22 m and the receiver has moved too; measured
a frame late, the test drifts by a few percent of direction, which at these
tolerances is the difference between a whistle and play on.

---

## 2. Phase 2 — the enforcement design

### 2.1 Where it bites

Section 3.2 names three call sites. One of them does not exist any more, so the
three are:

1. **Selection** — `passOptions` (intelligence.ts:577). Never *offer* a
   candidate whose release vector is forward. If no legal candidate exists on a
   side, offer none; the UI already has the vocabulary for this
   (`NO RECEIVER ON THAT SIDE`), and section 3.2 asks for
   `NO BACKWARD OPTION — TAKE IT IN`.
   The test belongs at the candidate push (~line 632), against the receiver's
   **current** position, which is the direction the ball will actually leave
   the hand.
2. **The lead** — the inlined lead at intelligence.ts:626 replaces
   `solvePassTarget`'s `+dir*0.4` floor. That floor guaranteed ≥ 0.4 m of
   forward travel on every short pass. It goes, replaced by a backward floor:
   the projected target may not finish ahead of the release point in the
   thrower's frame.
3. **Execution** — `doPass` (open.ts:512). Anything that still gets thrown
   forward — a human override, a cut-out — is whistled:
   `lawCall('FWD_PASS', …)` then `startScrum(defending, throwX, throwZ)`.
   The scrum is taken **where the pass was thrown**, not where it was caught,
   which is what the law book says and what the existing error branch already
   does (`startScrum(d.defending(), car.x, car.z)`).

**Plus a fourth the spec implies and the probe proves necessary:**

4. **The flight bias** — `rec.tz = clamp(s.ball.z + s.dir * 1.0, …)`
   (open.ts). This is the 6–8 manufactured passes. It is not a referee problem
   and must not be solved with a whistle: the release was legal. The receiver
   should run to meet the ball, not to a point a metre in front of it.
   Proposal: drop the `+ σ·1.0` bias and re-measure completion; if the
   completion rate drops, the fix is an intercept prediction, not a forward
   bias.

### 2.2 The spill path stops borrowing the name

Today, `doPass` rolls one `errorChance` for a *spill*, and inside that branch
only, calls `lawCall('FWD_PASS', …)` when `strict < 2 && R() < 0.5`. So
"forward pass" is currently a coin flip performed on a handling error, and a
perfectly thrown 20 m forward pass is never examined at all.

After the change:

- a **spill** is a spill — `commentate('MISSED')` / knock-on, its own call;
- a **forward pass** is a direction test, evaluated on every pass, and is the
  only thing that ever produces `FWD_PASS`.

One more distinction the law draws and the code should too: a forward pass that
is **caught by a team-mate** is a scrum for a throw-forward; a ball that goes
forward off the hands and **is not caught** is a knock-on. Same test, different
call, decided at the catch.

### 2.3 Toggles — this is a decision I need from you

The author's question was whether this uses the same Strict/Lenient/Off system
SPEC_12 built. It does not today, and I can see three honest options:

- **(a) Keep the existing `fwdPass` option** (`STRICT | NORMAL | LENIENT`,
  default NORMAL). Zero migration cost, and section 3.2's tolerances name
  exactly these three values. But there is no OFF, so there is no way to
  measure the rate without blowing — and "measure it before you enforce it" is
  the thing that found the inverted retreat grace and the `OBSERVE` break in
  SPEC_12.
- **(b) Mirror SPEC_12: `STRICT | LENIENT | OFF`** (default LENIENT), with the
  same semantics — OFF observes, counts and grades, and never blows. The two
  laws then behave identically at the menu, in the trace and in the audit, and
  the forward-pass rate stays measurable forever. Cost: `fwdPass` is read in
  `doPass` (`strict < 2`) and defined in `data.ts`; both move.
- **(c) Both axes** — a tolerance axis and a separate "count but don't blow"
  switch. More knobs than this law deserves.

**I recommend (b).** Not for symmetry's sake: because 3.3's own gate is
*"0 forward passes at STRICT over 3 seeds × 3 difficulties"*, and a gate like
that is only meaningful if the instrument can also tell you how many there
*would* have been with no referee. That is precisely the argument that made the
offside harness worth building.

### 2.4 The CPU gate

A forward candidate offered to the CPU is a **gate failure**, not a silent
event. `passOptions` already has a reporter (`reportGate`) and a family of
`forwardAttackPassCandidateFailures` checks; the forward-pass test joins that
family, as `forwardPassCandidateFailures`. So the CPU cannot quietly throw
one — it shows up in the gate report the same frame.

### 2.5 The audit

- Add `forwardRelativePass` to the trace, mirroring `forwardRelativeKick`
  (trace.ts:390) — a signed number, in m/s, per pass.
- Extend `LAW-63` (today it only checks distance ≤ 26 m).
- New rule: **no offered or executed pass is forward relative to the thrower.**
  Gate it on the CPU side over 3 seeds × 3 difficulties, and on the human side
  as a stat, not a gate.

### 2.6 Gates (from 3.3, with the measurement attached)

| Gate | Target | Baseline |
|---|---|---|
| Forward passes at STRICT, CPU, 3 seeds × 3 diffs | 0 | 25 per 1800 s |
| Pass count / completion inside the realism band | unchanged or better | 423 per 1800 s |
| Watchdog trips | 0 | 0 |
| **The momentum regression**: a human can still pass to a man running onto the ball | must hold | 8 passes per 600 s are legal *only* because of the allowance — a naive test breaks them |

That last row is the one I would write the unit test for first. It is the
failure mode of this whole spec: a direction test that is too eager kills the
passing game, and it kills it in a way that looks like success, because the
forward-pass count goes to zero.

---

## 3. What I need from you

1. **Toggle shape** — (a), (b) or (c) above. I recommend (b).
2. **The flight bias** (`rec.tz = ball.z + σ·1.0`). Fixing it changes how
   receivers run onto the ball, which is a feel change, not a law change. I
   propose fixing it in the same pass (it is half the report), but it is your
   call whether SPEC_13 owns it or it becomes a ticket.
3. **The knock-on / throw-forward split at the catch** — do it in SPEC_13, or
   leave the spill path alone for now?
4. **Whether the STRICT gate is `rel > 0` exactly.** At STRICT the tolerance is
   zero, which means a pass released 0.01 m/s forward is a scrum. That is the
   law. It is also 6 whistles a match until the selection filter removes them,
   which is the point — but say the word if you want STRICT to carry a small
   tolerance instead.

Everything above is measurement and design. No pass code has been touched.
