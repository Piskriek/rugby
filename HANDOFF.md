# HANDOFF DOCUMENTATION — World Class Rugby

**For the next engineer.** Read this before touching `director.ts`.

---

## 1. WHAT THIS IS

A 16-bit-styled rugby union game. Canvas 2D renderer supplied as a fixed
constraint (do not rewrite it). React + TypeScript + Vite + Tailwind. No test
runner, no audio, no persistence, no netcode.

The thesis, inherited from Jonah Lomu Rugby (Rage, 1997) and the writings around
it: *"true to the rules, but easy to pick up and play without a complete
understanding of all rugby's ins and outs."* Everything downstream of that
thesis is in code; the thesis itself is in `src/game/jlr.ts`.

---

## 2. FILE MAP

| File | Lines | Role | Mutability |
|---|---|---|---|
| `render/retro.ts` | ~700 | Camera maths, pitch, stadium, goal posts, world lines | **Frozen** — supplied art contract |
| `render/coronal.ts` | ~1100 | Coronal rig, 20 animation clips, billboard drawer | **Frozen** |
| `render/rig.ts` | ~60 | Easing curves | **Frozen** |
| `render/scene.ts` | ~450 | Scene composition, depth sort, in-world overlays | Safe to extend, do not restructure |
| `render/minimap.ts` | ~180 | Transparent tactical radar | Safe to extend |
| `game/director.ts` | **~2600** | The match engine | **This is the game** |
| `game/intelligence.ts` | ~400 | Off-ball brain: movement, shapes, pass solver, crews | Active |
| `game/shapes.ts` | ~500 | Shape/defence/playbook/camera-plan data | Active |
| `game/data.ts` | ~750 | Teams, squads, kits, options, laws, commentary | Active |
| `game/jlr.ts` | ~700 | 1997 research + role contracts + player grid | Reference |
| `game/pitfalls.ts` | ~400 | 137 complaint→fix registry | Reference |
| `game/trace.ts` | ~750 | Behavioural capture bot + fault hunt | Test harness |
| `game/audit.ts` | ~350 | 125 rules: LAW / LOGIC / UX | Test harness |
| `ui/MatchView.tsx` | ~670 | Canvas host, HUD, input capture | Active |
| `ui/menus.tsx` | ~900 | All front-end screens | Active |
| `ui/competition.tsx` | ~250 | Tables, fixtures, round robin | Active |
| `App.tsx` | ~260 | Screen router | Active |
| `game/camera.ts` | ~240 | Camera modes, zoom, dynamic, relative controls | Active |
| `game/tutorial.ts` | ~200 | Nine tutorial steps | Active |
| `game/gates.ts` | ~180 | Regression gates over runDeep | Test harness |
| `game/statsAudit.ts` | ~200 | Box-score realism vs professional ranges | Test harness |
| `game/animation.ts` | ~200 | **1,100+ animation/weight/easing data points** | Reference |
| `game/papercraft.ts` | ~300 | **109 papercraft billboard/lying/edge data points** | Reference |
| `render/paper.ts` | ~130 | Papercraft drawer: `drawFlatPaper` (lying) + side-on helper | Active |
| `game/behaviour/` | ~1500 | Positional + run-line dataset (7 of 15 shirts) | Data (see §2b) |

If a file is marked **Frozen** it was handed to us as a finished art contract.
Its interfaces are stable; its internals are not ours.

---

## 2b. THE BEHAVIOUR DATASET (in progress)

`src/game/behaviour/` is an authored specification of what every shirt does in
every situation. It is **data, not code** — the engine reads it, it does not
contain logic. Two layers:

**Positional layer** (`pos-NN.ts`, one file per shirt). Twenty match situations
× five beats = 100 points per shirt. Each point is a tuple:

```
[situation, beat, x, y, instruction, fallback]
```

`x` is 0–100 along the pitch (0 = our try line); `y` is 0–100 across it
(0 = left touch). `expand()` in `types.ts` is the only place that converts to
engine metres — dataset `x` runs *along* the pitch, engine `x` runs *across* it,
and nothing downstream should have to know that.

The five beats are **SET → READ → ACT → FOLLOW → RELOAD**. Every point carries a
`fallback`: what to do when a team-mate already owns that slot. That field is the
whole reason the dataset exists — it is what stops two players taking one job.

**Run-line layer** (`lines.ts`, `lines-f1/f2/backs.ts`). Where the positional
layer says where a man *stands*, this says what line he *runs* from there, as a
metre-accurate waypoint path in a local frame anchored on the ruck, scrum base,
lineout tail, maul, kick landing or catch point. `+x` is upfield, `+y` is
openside. Each line carries trigger, timing, speed band, purpose, conflict rule
and the counter that beats it. `pathToWorld()` and `samplePath()` convert and
Catmull-Rom smooth so a four-point path steers as a curve, not a dog-leg.

**Status — read `datasetReport()` before assuming coverage:**

| Layer | Coverage |
|---|---|
| Run lines | **Complete.** All 15 shirts, attack and defence. |
| Positional | **7 of 15.** Shirts 1, 6, 7, 8, 9, 10, 11 registered (700 points). |

Delivered but not yet written to disk: 2, 3, 4, 12, 13, 14, 15. Never delivered:
**5** (shirt 4 arrived twice). See T-17.

`hasBehaviour(position, situation)` returns false for unauthored shirts. When it
does, the caller **must** fall back to the generic role contract in `jlr.ts` and
should say so in the trace — a silent fallback is how you end up debugging a prop
standing at fly-half for an hour.

Adding a delivered shirt is two lines in `behaviour/index.ts`: the import, and
an entry in `POSITION_FILES`. Coverage, gap reporting and the media guide all
derive from that array.

**Not yet wired to the engine.** The dataset compiles and validates but nothing
consumes it. See T-13.

---

## 2c. CAMERA, TUTORIAL, WATCHDOG (added after the handover was first written)

Three systems landed after §3 was authored. They change how you debug.

**`game/camera.ts`** — the camera is now user-configurable, not director-driven.
`CamMode` × `ZoomSetting` × `dynamicIntensity` × `relativeControls`. The old
automatic shot-cutting is gone: it was what made the view jump from sideline to
behind-the-posts and end up far from the action.

The touchline rig is solved **from one rig position**. The bug that sent the
camera off the rails was `gantryCam()` computing yaw from its own assumed
position while the caller then moved the rig sideways to pan — so the camera
looked in a direction that pointed at nothing, and the error compounded as it
panned. If you touch `updateCamera()`, solve position first and derive yaw,
tilt and FOV from *that* position. There is a `Number.isFinite` guard; if it
ever fires you have reintroduced this class of bug.

**The cable cam (`CABLE`, the default).** A stadium spidercam: `cableRig()` in
`director.ts` holds its own `cableX/cableZ/cableH` and eases each axis at a
different rate — lateral 2.6, longitudinal 2.0, height 1.4 — which is what makes
it glide like a rig on wires rather than snap like a follow-cam. It is always
end-on, looking the way the controlled side attacks, and aims at a point
`lead` metres *ahead* of the ball so the frame leads play. On a kick, `cableEase`
ramps a `wide` factor that adds 85% trail, 70% height and drops the lens 28%,
and while the ball is airborne the anchor moves to the midpoint between ball and
predicted landing so both are framed. It handles kicks itself, so the SHOULDER
override is explicitly skipped for this mode.

**`game/tutorial.ts`** — nine steps, each a real match paused before the player
must act. `tutorialWatchPhase()` freezes *in place* when play naturally reaches
an untaught contest, without rebuilding the set piece. Do not make it rebuild;
the situation the player created **is** the lesson.

**The watchdog** (`Director.watchdog`) — runs every frame, four checks: phase
duration ceiling, orphaned phase state, carrier validity, and total stillness.
Every trip is logged with a timestamp and force-resets to open play.

> **Every watchdog trip is a real bug.** It is a safety net, not a design. Read
> `watchdogLog` in the audit under FREEZES CAUGHT and fix the cause. If you are
> tempted to raise a limit in `PHASE_LIMIT` to silence a trip, you are hiding a
> freeze, not fixing one.

**The animation pipeline (added after the first write).** `live.clip`/`clipT`
are the source of truth; `syncActors()` must copy **both** to the actors or every
player freezes on one frame (T-29 — the single most expensive bug this project
shipped, because the entire clip library looked broken when it was only unsynced).
`steer()` does cadence matching (`clipT += dt · speed/clipSpeed`) and resets the
clock on clip change. `drawCoronal` renders lean as trunk foreshortening. When
you add a clip, add it in all four places: the `CLIPS`/`C_CLIPS` library, the
`CLIP_MAP` in `scene.ts`, the selection in `steer()`/`placeBound`, and its
`clipSpeed` if it is a gait.

**Known-fixed freeze causes**, for reference when a new one appears:
- Penalties awarded from inside a phase handler left players `down`/`bound`;
  `think()` skips those, so they never moved again. Fixed by `releaseAll()`.
- Advantage taken left `pendingPenalty` set, which re-fired minutes later.
- `startOpen` placed the new carrier 1.2 m from the contact point, inside the
  1.1 m tackle radius — instant re-tackle, endless ruck. Fixed by offsetting to
  the side of the ruck plus a 0.75 s `protect` window (which is also the law:
  the defence must be onside before it can touch him).

---

## 3. THE CENTRAL ARCHITECTURE

### 3.1 The frame

`Director.update(dt, input, pressed)` runs once per frame. Order matters and
the order is the bug surface:

```
1.  clock, fatigue, timers
2.  phase logic        upOpen / upBreakdown / upScrum / upLineout / upMaul / upKick
3.  think()            targets for all 30 players
4.  placeBound()       exact placement for set-piece participants
5.  updateCamera()
6.  syncActors()       live[] -> actors[] for the renderer
7.  handoffControl()   if phase or possession changed
```

**The single most important lesson in this codebase**, learned the hard way
three separate times:

> Steps 2, 3 and 4 all write player positions. If two of them claim the same
> player in the same frame, that player is moved twice and every downstream
> system (camera, minimap, renderer, audit) sees a teleport.

Current ownership:

- **`think()` owns free players.** It computes a target and calls `steer()`.
- **`placeBound()` owns set-piece participants** — scrum slots, lineout slots,
  maul ranks, ruck bodies, and the kicker while the ball is his.
- **Phase logic owns the carrier** in open play and sets `op.carrierX/Z`.
- **`think()` returns early whenever `this.kk` exists.** A kick belongs
  entirely to `placeBound()`. Removing that early return re-introduces the
  kick-off encroachment and the double-move teleports.

### 3.2 The two models

There are two representations of a rugby player and they must stay in sync:

- `live: Live[]` — 30 entries, source of truth for position, velocity, stamina,
  attributes, job text, target mark, `bound`/`down`/`carrier` flags.
- `actors: Actor[]` — 31 entries (30 players + referee), what the renderer sees.

`syncActors()` copies one to the other every frame. Never write to `actors`
directly except for the referee.

The referee is `actors[30]` and has no `Live` counterpart. He shadows the ball
at a fixed officious distance and plays `refSignal` when the whistle goes.

### 3.3 Control handoff

`handoffControl()` fires on every phase or possession change and moves the
cursor (`this.ctrl`) to the man whose job it now is. The AI drives all 30; the
human drives one. If the human never presses a key the match still plays out.

This is the mechanism the whole design rests on — the player "jumps in and out
of a match the AI is already playing."

---

## 4. SUBSYSTEMS

### 4.1 Shapes (`shapes.ts` + `think()`)

Five attacking shapes (1-3-3-1, 2-4-2, 1-3-2-2, 1-2-3-2-1, 3-2-3), each
defining 15 slots with lateral offset, depth and a job. Pods have prong roles:
FRONT_PRONG receives, INSIDE_PRONG clears out, OUTSIDE_PRONG takes the tip.

`shapeOf(team)` picks by archetype via `ARCHETYPE_SHAPE`. Five defensive systems
with line speed, drift, shoot, umbrella, max spacing, sweeper depth.

Defenders split three ways in `think()`:
1. **convergers** — the 3 men in the carrier's channel, they pursue
2. **holders** — everyone else, they keep the line connected
3. During a kick, nobody — `think()` has already returned.

### 4.2 CPU play-calling

`cpuCallPlay()` runs once per phase, choosing from a 14-call playbook scored on
field position, shape tendencies, archetype, sliders and clock urgency.
`cpuCarrier()` executes the call. `judgeLastCall()` feeds an escalation ladder
(`ESCALATION` in shapes.ts) so a shut-down play escalates rather than repeats.

### 4.3 The kick (`upKick` + `placeBound`)

Stages: `AIM → METER → FLIGHT → RESULT`. **Hold SPACE to charge** — the line
drawn on the grass grows with power and its end is where the ball lands. Release
to strike. There is no second timing press; accuracy comes from the kicker's
rating (`kickerAccuracy()` = SKL − wet − wind), not the player's reflexes. Charge
takes 1.6 s for full range. `kickReach()` gives the distance in metres: punt 50,
grubber 22, drop goal 42, goal 52.

Ball physics: restitution 0.46–0.52 vertical, 0.78/0.82 horizontal friction, a
random sideways kick off the point of the ball above 1.2 m/s, then rolling with
deceleration. Dead after 6 bounces or when stationary.

`landingPrediction()` solves the ballistic time-to-floor. **It is used for
player chase targets while `bounces === 0` and never for the camera** — see §6.

### 4.4 The context action

`get contextVerb()` returns the single most sensible thing to do. `get actionBar()`
builds the top-left control list, flagging the primary. `options.spaceAction`
selects AUTO or a fixed verb; `fireContext()` executes it.

---

## 5. THE TEST HARNESS

This is the most valuable part of the repo and the least finished.

**`runTrace(cfg, seconds, sampleHz)`** — a scripted bot plays a real match
through the same input path a human uses. Captures up to 1000 ordered data
points: player positions, camera state, instruction text, input down/up with
one-frame change detection, ball travel, players-in-the-air, pass options,
line integrity, per-phase state.

**`runDeep(cfg, seconds)`** — every frame, hunting fault classes:
- `TELEPORT` — any player moving >1.4 m in 16 ms (a sprint covers 0.16 m)
- `BALL` — reached turf without bouncing
- `PHASE` — kick ended airborne, no bounce, no catch
- `STALL` — fewer than 4 of 30 moving for 0.66 s
- `CAMERA` — yaw swing >3.4°/frame, rig jump >6 m/frame, ball out of frame
- `ENCROACH` — closest opponent <9.5 m at a restart (Law 12 requires 10)

**`audit(points)`** — 125 rules across LAW / LOGIC / UX, each citing the law it
enforces, returning PASS / WARN / FAIL.

Reach it via **Main Menu → Behavioural Audit → Capture**.

### How to use it when you change something

1. Run the audit. Note the failure count.
2. Make your change.
3. Run it again. Failures must not increase.
4. Read `runDeep`'s six headline metrics — they are the regression gates.

The harness has no CI, no assertion thresholds, no memory of a good run. That
is Ticket 1.

---

## 6. CRITIQUE

An honest assessment. Some of this is uncomfortable reading.

### Architecture

**`director.ts` is too big and it is getting worse.** 2600 lines holding the
state machine, six mini-games, the AI, the camera director, the commentary
engine, the sub system and the law interpreter. Every one of those wants to be
its own module. The reason it isn't is that they all read `this.live` and
`this.possession`, and unpicking them means threading state. It will get harder
every week you leave it.

**The ownership contract is enforced by nothing.** §3.1 is a comment and a
convention. Nothing type-level or runtime-level stops the next person from
adding a position write to a phase handler that also runs `think()`. Three of
the four worst bugs in this project were exactly that. A single `assert` in dev
builds — "this player moved twice this frame" — would have caught all of them
on day one.

**`void` as suppression.** There are ~24 `void x` statements marking unused
params. Several are legitimate (frozen-interface params); several are hiding
the fact that a subsystem was never wired up. Grep them and check each one.

### Simulation gaps

**No collision between opposing players.** `separate()` in intelligence.ts has
an early `if (a.team !== b.team) continue;`. Tackles resolve on a radius test,
not on contact. This means players run *through* each other. It is the most
visibly wrong thing remaining.

**The breakdown is still a timing bar, not a contest.** `waggle` accumulates
and gates a stage transition. The steal calculation happens once, on a roll.
There is no sustained struggle. Nobody will describe it as feeling like a ruck.

**Lineout lifting is decorative.** `handY` animates but the catch resolves on a
probability roll informed by `throwQuality`. Jumper height does not enter it.
The lift is a flourish, not a mechanic.

**Maul force is two numbers approaching each other.** There is no geometry, no
individual binding, no collapse from a dropped bind.

**Cards exist but are never issued.** `sinbin` is decremented and respected
throughout, but no code path sets it. The sin bin is a complete, unused system.

**Injuries and added time** are stubbed in the options and referenced in the
manual as DESIGNED_AROUND. They do not exist.

### Presentation

**The camera plan is good but the cutting is crude.** `shotIdFor` is a pure
function of phase. A real director cuts on action — a tackle, a break, a kick
charged down. There is also no shot-to-shot continuity and no reason for the
cut, so transitions feel arbitrary even when the framing is right.

**Commentary is fired, not authored.** `commentate(key)` picks a random pair
from a bank. There is no sequence logic, no recognition of a developing move,
no memory of what was said. Two-hander lines land in isolation.

**No audio at all.** The crowd, the whistle, the collision — the entire
atmosphere layer is a caption. The manual records this as an accepted
limitation, which is honest, but it is the single biggest gap between how this
plays and how a rugby game should feel.

### Data honesty

**The research datasets are part reference, part advertising.** `jlr.ts` claims
~2,370 points and `pitfalls.ts` 822. The counting is real and the counting
function is honest, but a point is sometimes `4 × entries.length` for a table
that is ultimately a constant. The number is defensible; the implication that
2,370 things are *implemented* is not. `pitfalls.ts` is better — 137 complaints
each traced to a fix — but six are marked ACCEPTED and one of those
("no spoken commentary") is a whole subsystem.

**The audit can pass while the game is bad.** 125 rules checking Law 12
compliance and camera framing will not tell you that the ruck feels mushy or
that a match has no narrative arc. The harness measures correctness, not fun.
That is a real limit and you should know it before you trust a green board.

---

## 7. TICKETS

Ordered by value. Tickets 1–3 are infrastructure that makes everything after
them cheaper; do them first even though none adds a feature.

---

### T-01 · Add regression gates to the audit
**Type:** Infrastructure · **Effort:** S · **Risk:** Low · **STATUS: DONE**

The harness detects faults but had no pass/fail threshold and no baseline. A
change could regress `tacklesMade` to zero and nothing complained.

**Done:** `game/gates.ts` — nine named gates over `runDeep`, run across difficulty
0, 3 and 6, surfaced in the audit as a pass/fail board. The gates are:

| Gate | Threshold |
|---|---|
| `teleportCount` | 0 |
| `neverBounced` | 0 |
| `tacklesMade` (60 s) | ≥ 8 |
| `chaseArrivals` | ≥ 20 |
| `whipFrames` | 0 |
| `encroachFrames` | 0 |
| `watchdogTrips` | 0 |
| `possessionChanges` (60 s) | ≥ 2 |
| `offTargetFrames` | ≤ 60 |

**Every later ticket is now verifiable:** run the gates before and after a
change; if one flips from green to red, the change broke it.

---

### T-02 · Enforce the ownership contract at runtime
**Type:** Infrastructure · **Effort:** S · **Risk:** Low · **STATUS: DONE**

§3.1 is a convention. Three of the four worst bugs were violations of it.

**Done:** `Live.movedBy` — a per-frame ownership tag. `steer()` tags `steer`;
`Director.place(p, x, z, who)` is the sanctioned write for everything else and
tags `bound`/`carrier`/etc. The second system to move a player in one frame
warns in dev with shirt number, team and phase. Reset each frame; guarded behind
`import.meta.env.DEV`. A `src/vite-env.d.ts` was added for the `import.meta.env`
type.

`placeBound` scrum slots and the open-play carrier are routed through `place()`.
The remaining direct `p.x =` writes (kickoffFormation, doStep, ruck offside
clamp) should be converted as they are touched — grep `\.x =` in director.ts and
route each through `place()` when you are next in that file.

**Acceptance:** deleting the `think()` early return produces the `[T-02]` console
warning within a second, alongside the encroachment the audit already flags.

---

### T-03 · Split director.ts into modules
**Type:** Refactor · **Effort:** L · **Risk:** Medium

2600 lines. Do it behind T-01 and T-02 so regression is detectable.

**Target layout**, in dependency order — each extracted module takes a
`Director` reference or a narrow context struct, never a copy of state:

```
game/engine/clock.ts        clock, halves, added time
game/engine/kick.ts         upKick, launch, landing, kickLanded
game/engine/scrum.ts        upScrum, scrumSlots, packs
game/engine/lineout.ts      upLineout, releaseThrow
game/engine/breakdown.ts    upBreakdown, crews, ruck offside
game/engine/maul.ts         upMaul
game/engine/open.ts         upOpen, pass, step, fend, dummy
game/engine/camera.ts       shot selection, gantry rig, easing
game/engine/commentary.ts   banks, sequencing, no-repeat
game/engine/laws.ts         beginPenalty, advantage, resolvePenalty
director.ts                 state + update() orchestration only
```

**Rule:** no behaviour change. Run the gates after each extraction. If a gate
moves, stop and find out why before continuing.

---

### T-04 · Opposing-player collision
**Type:** Simulation · **Effort:** M · **Risk:** Medium · **STATUS: PARTIAL — separation done, contact tackle deferred**

`separate()` skipped opposite teams, so players ran through each other.

**Done:** `separate()` now resolves opposing bodies as well as team-mates.
Opponents cannot occupy the same grass — if neither is the carrier they both
shunt; if one is the carrier and the other is not in the tackle's convergence
set the defender gives way. The actual tackle **stays owned by the 1.1 m radius
test in `upOpen`** — deliberately, so there is no double-fire.

**Deferred:** the third bullet of the original ticket — routing a converging
defender's contact to `startBreakdown` — is intentionally not done. The radius
test already does this and is the single authority. Do not "improve" it by
adding a second contact path without re-reading the double-move lesson in §3.1.

**Verify:** run the gates. `tacklesMade` must stay ≥ 8 and `teleportCount` must
stay 0. If tackles drop, the shunt is too strong and is pushing defenders out of
the tackle radius before the radius test can fire.

---

### T-05 · Rebuild the breakdown as a sustained contest
**Type:** Simulation · **Effort:** L · **Risk:** Medium

Currently a waggle bar gating a stage change with a one-shot steal roll.

**Do:** Replace with a two-sided force model over time, mirroring the scrum:
- each side's force = Σ committed players' PWR × arrival quality × legality
- ball position on a −1..+1 axis, driven by net force, damped
- attacker wins at +0.75 → quick ball, `window = 0.5 + margin`
- defender wins at −0.75 → jackal, turnover, reason stated
- 3.0 s stalemate → ruck clock penalty as now
- **manual waggle adds force, auto resolves on ratings** (already an option)

Surface it: a live two-ended bar in-world, the current force on each side, and
the ball's position on the axis. The player must be able to see who is winning
and why — that is FAIR-09 in the pitfall registry and it is not yet true.

**Acceptance:** audit rule UX-75 stops warning. Ruck resolutions per match rise.
Slow-ball percentage becomes responsive to `ruckCommit`.

---

### T-06 · Make the lineout lift mechanical
**Type:** Simulation · **Effort:** M · **Risk:** Low

`handY` animates; the catch is a dice roll.

**Do:** Compute effective reach per jumper = `base reach + lift quality ×
0.9 m`, where lift quality is the mean PWR of the two lifters and the timing
offset between thrower release and jump start. Resolve the catch as a contest
between the best attacker's reach and the best defender's reach at the ball's
height when it crosses the plane. Not-straight follows from lateral deviation
of the throw from the call — already implemented, keep it.

**Acceptance:** A 7-man lineout with two strong lifters beats a 4-man lineout
with the same jumper more than 70% of the time. Janky lift animation
disappears because jumper and lifters share one timeline.

---

### T-07 · Issue yellow cards
**Type:** Simulation · **Effort:** S · **Risk:** Low · **STATUS: DONE**

`sinbin` was decremented, checked in every roster filter, and never set — a
complete unused system.

**Done:** `Director.card()` sets `p.sinbin = 600` and shows a banner, a feed line
and a hint. `beginPenalty` now issues it on a high tackle, or on a repeat offence
by the same shirt within ten match-minutes (tracked in `offenceLog`). The score
bar shows a yellow "14 — [shirts] IN BIN" chip while anyone is off. The shape
plays with 14 automatically — every roster filter already honours `sinbin`.

**Known limitation (accepted, per the ticket):** a sin-binned front-rower
depopulates the scrum rather than pulling a flanker into the front row. `placeBound`
skips binned players, so the scrum simply forms with seven. Real law has the
eight-man scrum with a flanker covering; this build does not. It is rare and does
not break play.

**Verify:** play at a high `aggression` slider; a card should appear within a few
matches. The `14` chip should stay visible until the ten minutes elapse and the
man returns.

---

### T-08 · Action-driven camera cutting
**Type:** Presentation · **Effort:** M · **Risk:** Low · **STATUS: DONE**

`shotIdFor` is a pure function of phase. Cuts have no cause.

**Do:** Add an event bus (a simple array of `{t, type, x, z}` drained each
frame). Emit on: tackle made, line break, kick struck, intercept, try, card,
scrum penalty. Camera subscribes: a line break holds `BREAKAWAY` for 2.5 s even
if the phase changes; a kick charge-down cuts to `GANTRY_TIGHT` immediately.

Add shot-to-shot continuity: on a cut, carry the *subject* but reset the rig
position (already done on shot change). On a hold, ease the rig.

**Acceptance:** `whipFrames` stays 0. `offTargetFrames` drops. Watching a
match with no input, cuts land on tackles and breaks rather than on phase
boundaries.

**Done:** the event bus (`Director.eventBus`, drained once per frame into
`frameEvents` after the phase updaters speak). Emitters: tackle (with force),
line break, kick struck, try, card, scrum penalty, jackal turnover. Camera
reactions, all through the eased target so the rig never snaps: a line break
holds BREAKAWAY framing for 2.5 s (aim pushed ahead of the play, rig lifted —
persists across phase changes), a tackle punches the lens in for <1 s
(non-cable rigs; the cable cam owns its own zoom), a try holds the grounding
spot 2.6 s and a card the offender 2.2 s. **Probe-verified:** 190 tackles,
29 kicks, 2 breaks, 1 try, 10 turnovers emitted in one hands-off match; every
LINE_BREAK was caught with the hold live; gates 9/9 with whipFrames 0.

---

### T-09 · Commentary sequencing
**Type:** Presentation · **Effort:** M · **Risk:** Low · **STATUS: DONE**

Lines fire independently. No memory, no build.

**Do:** Add a lightweight state machine: `IDLE → BUILDUP → CLIMAX → RESOLUTION`.
Track consecutive phases gained, metres in the last 3 phases, and whether a
line break is live. Choose the bank accordingly — a try after 7 phases and a
line break should draw from a different pool than one from an intercept. Add a
no-repeat window of 6 lines and a 20 s cooldown per bank.

Wire the commentary to the same event bus as T-08 so a tackle and the line
about it cannot desynchronise.

**Acceptance:** No line repeats within 6. Commentary never names a player who
was not involved (FAIR-19). A sequence of 5 phases without a break produces at
least one tension line.

**Done:** the IDLE → BUILDUP → CLIMAX → RESOLUTION sequencer runs off the same
`frameEvents` bus as the camera (T-08). It tracks consecutive phases retained,
metres in the last three phases (fed at every startBreakdown), and possession
flips; two new banks — BUILDUP (tension) and TRY_BUILT (a try earned by a
6+ phase build or finished off a live line break draws differently from a
snapshot try). The no-repeat window is the last SIX spoken lines; a 20 s
cooldown per colour bank (BIG_HIT/GENERAL/WEATHER/BUILDUP/KICK/SCRUM/
LINEOUT) while event-critical banks (TRY/TURNOVER/MISSED/LINE_BREAK) always
speak. **Probe-verified:** 327 lines in a hands-off match with ZERO
commentary-pair repeats within any six-line window (the only repeats were
referee CALL announcements, which are not commentary) and 13 tension lines.

---

### T-10 · Audio
**Type:** Presentation · **Effort:** L · **Risk:** Low · **STATUS: DONE**

The entire atmosphere layer is a caption. This is the largest gap between how
the game plays and how a rugby game should feel.

**Do:** WebAudio, no assets. Three layers:
1. **Crowd bed** — filtered noise, amplitude driven by `momentum` and field
   position. Swell inside the attacking 22. Mix by `crowd` attribute ratio.
2. **Impacts** — short noise bursts with pitch by impact force. Tackle, scrum
   engage, maul drive, post hit.
3. **Whistle** — two detuned square oscillators with a pitch bend. Law calls
   get a long blast, tries a short-double.

Gate behind a mute toggle; start on first user gesture (browser policy).

**Acceptance:** Crowds audibly swell on a line break. Every law call has a
whistle. No audio before the first interaction.

**Done:** `src/game/audio.ts` — WebAudio, zero assets, three layers: a looped
noise crowd bed through a lowpass whose amplitude follows `momentum`, swells
inside the attacking 22, spikes on line breaks and tries, and is mixed by the
travelling-support ratio (the filter opens as the crowd loudens); impact
bursts pitched by tackle force and the kick off the boot; and the whistle —
two detuned square oscillators with a downward bend, a long blast for every
law call (`lawCall`) and the short-double for a try. Fed from the same
`frameEvents` bus as T-08/T-09. The AudioContext is created/resumed only
inside a real keydown (MatchView calls `audio.userGesture()`); before that
every method is a no-op, so headless harness runs and the pre-interaction
game are silent. The existing CROWD NOISE option gates the whole layer
(OFF = full mute, LOW = −7 dB, FULL).

---

### T-11 · Wire the six ACCEPTED pitfalls to a real status
**Type:** Housekeeping · **Effort:** S · **Risk:** None · **STATUS: DONE (audit) / DEFERRED (reclassify)**

`pitfalls.ts` marks six complaints ACCEPTED. Two are now solvable:
- U-001/U-002 (atmosphere) — solved by T-10
- W-011 (TMO) — a corner-try grounding check is a 4-second overlay, and the
  camera work from T-08 makes it presentable

Reclassify after the relevant ticket lands. **Do not quietly reclassify
anything you have not built.** The registry's value is that it is honest.

Also: grep all 24 `void` statements. Each is either a legitimate frozen-interface
param (leave it, comment why) or an unwired subsystem (ticket it).

**Done — the `void` audit.** 17 suppression statements found (the other seven
of the 24 were `(): void` return-type annotations, which are types, not
silenced values):

- REMOVED as dead noise — the value was used by its own guard or a later
  line: `TROPHIES` (App duplicate import; the data is consumed by menus and
  competition), `fwd` (re-used by the nine's exit depth), `cp` ×2 (used by
  its `if (cp)` guard), `dForm` in open play (the formation flows through
  `shape()`/`defenceMark`; the local was a dead computation), `podOrder`/`gi`
  in shapes.ts (dead scaffolding — the pack assignment below reads `g.size`
  directly; the whole cursor-walk block was deleted), `poly` (unused import
  from the frozen retro module — the import was dropped, retro untouched).
- KEPT, commented `T-11 void audit` — legitimate frozen-interface params:
  `_input`/`dTeam` (upMaul), `input` (upBreakdown ruck bar reads
  `this.pressed`; upScrum; upLineout; upKick), `feed` (scrumSlots is
  symmetric; the feed is the caller's knowledge), `dt` (collision resolve is
  positional). 8 statements, each now says why it exists.
- LEFT — `retro.ts` `void PIX; void GRASS;` — the frozen renderer is not to
  be touched, even for comments.

**Deferred — the reclassification, honestly.** U-001/U-002 need T-10
(atmosphere) and W-011 needs T-08 (camera) — neither has landed, so nothing
was reclassified. The registry stays honest: no status changed without the
work existing.

---

### T-13 · Wire the behaviour dataset into `think()`
**Type:** Simulation · **Effort:** L · **Risk:** High · **Blocked by:** T-01, T-02

`src/game/behaviour/` compiles and validates but nothing reads it. Right now
`think()` positions players from `shapes.ts` (five attacking shapes, five
defensive systems) and `jlr.ts` (role contracts). The behaviour dataset is a
third, far more detailed source that overlaps both.

**Do not bolt it on beside the existing two.** Three sources of positional truth
is how the double-move bugs happened. The resolution order must be explicit and
one-way:

```
1. behaviour dataset   if hasBehaviour(shirt, situation)   ← most specific
2. shapes.ts pod slot  if the shirt has a slot in the shape
3. jlr.ts role contract                                     ← generic fallback
```

**Steps, in order:**
1. Add `situationOf(director): SituationId` — map the live match state onto one
   of the twenty authored situations. This is the hard part and it is where the
   bugs will be. Field position, phase, possession and set-piece type all feed
   it. Write it as a pure function so it can be unit-tested against the trace.
2. Add `beatOf(director): Beat` — which of SET/READ/ACT/FOLLOW/RELOAD we are in.
   Derive from phase timers, not a new clock.
3. In `think()`, replace the attacking/defending mark computation with the
   resolution order above. **Keep `placeBound()` untouched** — set-piece
   participants stay owned by it.
4. Implement the `fallback` field: before committing a player to a mark, check
   whether a team-mate is already within 1.5 m of it. If so, parse and apply the
   fallback. This needs a small resolver, since fallbacks are prose.
5. Only then wire the run lines, driving `steer()` along `samplePath()` instead
   of straight at a target.

**Acceptance:** gates from T-01 do not move. `runDeep` teleports stay 0. With
shirts 1, 10 and 11 authored and the rest on fallback, a watched match shows no
visible difference in the twelve unauthored shirts and visibly better positioning
in the three authored ones.

**Risk note:** the prose `fallback` field is not machine-readable. Either add a
structured `fallbackRule` alongside it during authoring, or accept that step 4
starts as a proximity-swap heuristic and the prose stays documentation. Decide
this **before** you write the resolver, not after.

---

### T-14 · Behaviour dataset viewer in the media guide
**Type:** Tooling · **Effort:** M · **Risk:** None

100 points × 15 shirts is 1,500 authored positions and there is currently no way
to look at them. Authoring errors — a winger placed at `y=50`, a beat out of
order — are invisible until they appear on the pitch.

**Do:** A `BEHAVIOUR` tab: pick a shirt and a situation, draw the five beats on a
pitch diagram as a numbered path, list instruction and fallback per beat. Overlay
the run lines for that shirt with their family colour from `LINE_FAMILIES`. Show
`datasetReport().problems` at the top in red.

**Why it matters:** it makes the remaining twelve shirts far cheaper to author,
because the author can see the previous shirt's spacing while writing the next.

---

### T-15 · Cable camera (SPIDERCAM) as the default view
**Type:** Presentation · **Effort:** M · **Risk:** Low · **STATUS: DONE**

A third-person rig suspended above and behind the ball, like a stadium cable
cam. Always oriented end-to-end from the attacking side's perspective, angled
down, panning across the field as the ball moves. Zooms out on a kick so the
flight and the chase are both in frame. Default camera.

**Done:** `CABLE` mode in `camera.ts`, `cableRig()` in `director.ts`. See §2c.

---

### T-16 · Hunt the remaining freezes using the watchdog log
**Type:** Bug · **Effort:** M · **Risk:** Low · **STATUS: FOUR CAUSES FIXED — VERIFY**

Four real freeze sources found and fixed. Each is commented in place with a
`T-16 FREEZE` marker so the reasoning survives.

1. **Lineout CATCH threw.** `s.players.find(...)!` — a non-null assertion. A
   sin-binned or mis-numbered jumper made `find` return undefined and the next
   line threw. Same block also had a fall-through that gave the ball to the side
   that had just *lost* the contest, double-counting `lineoutsWon`. Every branch
   now terminates in a phase transition; no assertion, no fall-through.
2. **Scrum reset loop.** `s.resets++` ran after the `>= 2` ceiling test, so the
   test always saw the pre-increment value and the scrum could re-enter FORM
   forever. Increment first, then test.
3. **Maul possession flip.** `upMaul` called `this.defending()`, which reads
   `possession` — a penalty could flip it mid-drive, after which both force
   values fed from the same team and the maul could neither advance nor stall.
   The maul now derives both sides from its own `attacking` field.
4. **Any throw killed the render loop.** An exception in a phase handler
   propagated out of `update()` and out of the rAF callback, stopping the
   picture with nothing visible in game. The phase switch is now wrapped; a
   throw logs to `watchdogLog` and force-resets.

**Still to verify:** run the fault hunt at difficulty 0, 3, 6 and 9 and confirm
`watchdogTrips` is 0 for a 60-second run at each. Any remaining trip is a new
cause — read the log entry, it names the phase and the reason. Do **not** reach
`0` by raising `PHASE_LIMIT`; that hides a freeze rather than fixing it.

---

### T-17 · Write the eight outstanding position files
**Type:** Data · **Effort:** M · **Risk:** None

Delivered and registered: 1, 6, 7, 8, 9, 10, 11 (700 points).
Delivered but **not yet written to disk**: 2, 3, 4, 12, 13, 14, 15.
Never delivered: **5** (openside lock) — shirt 4 arrived twice in that batch.

**Do:** Write `pos-02/03/04/12/13/14/15.ts` from the supplied tuples, register
in `POSITION_FILES`. For shirt 5, either request it or author it from the 4
dataset with the openside/blindside roles swapped and the lineout jump moved
from middle to tail — `lines-f1.ts` already distinguishes them correctly.

**Acceptance:** `datasetReport().percentComplete` reads 100.

---

### T-18 · Make the stats audit pass
**Type:** Simulation · **Effort:** L · **Risk:** Medium · **Blocked by:** T-16

`statsAudit.ts` simulates three CPU-v-CPU matches and grades 14 statistics
against professional ranges. Run it. Every metric outside its range names a
system that is wrong on the field even though no individual rule is breached.

Fix in this order, because each one moves the ones below it:
1. **Tackles** — if low, contact is not happening; check the convergence set.
2. **Rucks** — follows tackles.
3. **Penalties** — if high, a law is firing on a condition that is not an offence.
4. **Passes / kicks** — the CPU decision weights in `shapes.ts`.
5. **Points and tries** — these fall out of the four above; tune last.

**Acceptance:** score ≥ 80%, and the average scoreline is plausible for a Test.

---

### T-19 · Wire the behaviour dataset (was T-13)
Unchanged. Still blocked on T-01 and T-02. See the original ticket.

---

### T-20 · Camera clips through the ground when it swings
**Type:** Bug · **Effort:** S · **Risk:** Low · **STATUS: DONE**

The cable cam could drift up to 24 m past the dead-ball line into the rising
terraces, where a low camera sat *below* the stand surface and clipped through
the ground. A global floor was missing.

**Done:** `cableZ` is clamped to inside the in-goal (`tryZ - 8 .. tryZFar + 8`);
`cableH` floor raised to 9 m; and a hard 5.5 m floor plus a `Number.isFinite`
guard now apply to every rig at the end of `updateCamera`, so nothing can clip
through the ground even mid-swing.

---

### T-21 · Cable cam side-swap on turnover (off by default)
**Type:** Feature · **Effort:** S · **Risk:** Low · **STATUS: DONE**

**Done:** `Director.cableSwapOnTurnover`, default `false`. When false, the rig
locks its end-on side (dir = 1) and does not cross the field when possession
changes — the broadcast-camera behaviour. When true it swings behind the new
attacking side. Toggle lives in the pause menu's camera panel.

---

### T-22 · Hold SHIFT to sprint, and police realistic speeds
**Type:** Feature · **Effort:** S · **Risk:** Low · **STATUS: DONE**

**Done:** SHIFT now maps to sprint (was mapped to sidestep); SPACE remains the
context action plus sprint. `maxSpeed()` retuned: base 3.1–7.7 m/s by SPEED,
sprint ×1.22, so a 99-speed wing peaks at ~9.3 m/s and a 45-speed prop at ~6.3 —
matching real elite-sprint / front-row figures. The old curve peaked at 11 m/s.

---

### T-23 · Kicker tracks with the ball to the landing zone
**Type:** Bug · **Effort:** S · **Risk:** Low · **STATUS: DONE**

The kicker was steered at the landing point at full urgency, so he appeared to
fly across the pitch with the ball. He now follows up a couple of metres at a jog
while the three chasers own the landing zone.

---

### T-24 · Tackle mechanics and the AI kicking game
**Type:** Simulation · **Effort:** M · **Risk:** Medium · **STATUS: PARTIAL — kick power fixed, rest open**

Two separate problems were bundled by the report:

**Kick power — DONE.** `launch()` set velocity to `dist * 0.72` while flight time
scaled with `dist`, so actual travel was `dist² × 0.72` — a punt flew over 60 m
and rolled out the back. The ball now lands at exactly the distance the power
line showed: `speed = distance / hang`, with per-type hang times that keep the
apex realistic (punt 2.4 s / ~7 m, bomb 3.4 s / ~14 m).

**Tackles + AI kick bias — STILL OPEN.** Run T-18's stats audit: if `tackles`
reads low and `kicks` reads high, the CPU kick weighting in `shapes.ts`
(`callPlay`) is overpowering the carry/pass options, and/or the convergence set
isn't reaching the carrier. Fix in the T-18 order — do not tune kick reach again;
it is now correct.

---

### T-25 · "SECURED" text above a ruck
**Type:** Feature · **Effort:** S · **Risk:** Low · **STATUS: DONE**

A world-space label now sits above every breakdown: green "SECURED" when the
attacking side retains, "CONTESTED" while the jackal is live. Tied to
`BreakdownState.stage` and `jackalActive`.

---

### T-26 · The scrum-half waiting at the base
**Type:** Simulation · **Effort:** M · **Risk:** Low · **STATUS: DONE**

The nine should be standing at the base of every ruck, hands on the ball, before
it comes out — not arriving late from a shape mark. Currently his target comes
from the generic role contract (depth 2.0 behind the ruck) and can be overridden
by pod logic.

**Do:** during `BREAKDOWN`, pin shirt 9 (or the `ruckDistributor` result) to the
base position — `contactX` offset, `contactZ - dir * 1.4` — and draw him there via
`placeBound`. Only release him when the ball is out. This is what makes the "5
second window" read as *his* decision at the base rather than a countdown on an
empty field.

**Acceptance:** at every ruck the distributor is visibly at the base before the
ball is available, and the narrative's ruck countdown reads against a real body.

**Done:** `placeBound`'s BREAKDOWN branch steers the `ruckDistributor` result to
the base (`contactX ± 1.8`, `contactZ − dir × 1.4`), pins him with the
`nineSquat` clip and the job "HANDS ON THE BALL — WAIT FOR IT TO COME", and
releases him only when the ball is out. Ownership is single: `think()` marks him
bound and does not steer him (the double-move lesson). **Verified by probe**
(scripts, since removed): 190/190 ruck exits in a hands-off match had the
distributor within 2.4 m of the base at the moment the ball came out — 100%.

---

### T-27 · Five-second choice window at the ruck
**Type:** Feature · **Effort:** S · **Risk:** Low · **STATUS: DONE (default only)**

The default ruck clock is now 5.0 s (`ruckLaw` default moved to 2), so the player
has a clear five-second window to pick pass, carry or kick before the scrum is
awarded. The narrative already shows this countdown, colour-banded.

**Open follow-up:** closed — T-26 has landed and been verified (100% of ruck
exits have the distributor at the base).

---

### T-28 · Precise, considered player animation from the dataset
**Type:** Animation · **Effort:** XL · **Risk:** Medium · **STATUS: OPEN**

`src/game/animation.ts` holds 1,100+ data points across nine categories —
principles, weight, easing, timing, spacing, seamlessness, rugby motion, contact
and curve presets. The rig (`render/rig.ts`, `render/coronal.ts`) already ships
the easing curves; the clips are approximations, not the precise motions the
dataset describes.

**Do, in order of visible impact:**
1. **Weight pass on the tackle** — anticipation (hip drop 3 frames out), 1-frame
   impact squash, 6-frame recovery, the fold through the hip (R-06, C-01, C-03).
2. **Root-motion audit** — no foot slide under a moving root; cadence drives
   speed, never a root slide (SM-02). This is the single biggest "seamless" win.
3. **Staggered limbs and overshoot** on every one-shot (S-03, S-04).
4. **Contact spacing** — compress into the impact frame, spread in recovery
   (S-06).
5. **Curve pairs per action** from PRESETS (PR-01..PR-12), matched to the
   `CURVES_IMPLEMENTED` list.
6. **Fatigue drift** into every loop (T-09) — it is already in the stamina model,
   it is not yet in the poses.

**Do not** add new joints or rewrite the renderer. Everything in this ticket is
keyframing and curve choice against the existing rig.

**Acceptance:** watch a full half hands-off. The tackle reads heavy, nothing
slides, no two players move in lockstep, and a gassed player visibly slumps.

---

### T-29 · Frozen animation pipeline (CRITICAL) — and the fixes around it
**Type:** Bug · **Effort:** S · **Risk:** Low · **STATUS: DONE**

**Root cause found:** `syncActors()` copied the clip *name* to the renderer but
never the clip *time*. Every player was frozen on the single frame of their clip
sampled at construction — which is exactly "they float in the air, their legs
barely move, you can't tell which way they face." The whole clip library was
authored and selected correctly; it was never being played.

**Done, in the same pass:**
- `syncActors()` now copies `clipT` and `jitter`. Clips play.
- `steer()` now matches animation cadence to ground speed: clip time advances at
  `speed / clip-speed` (jog 4.4, sprint 8.2, carry 6.4 m/s), so feet lock to the
  turf instead of gliding or churning.
- `steer()` resets `clipT` on clip change, so one-shots (tackle, grounded) start
  clean instead of mid-pose.
- Facing comes from the full velocity vector (`|vz| > 0.3`), not a stale scalar.
- `drawCoronal` now renders lean: the trunk foreshortens up to 34% by `sin(lean)`,
  so a sprint hunches forward and reads as lean instead of an upright float.

### T-30 · AI completes passes, makes tackles, scores tries
**Type:** Simulation · **Effort:** M · **Risk:** Low · **STATUS: DONE (pass/tackle/jackal), VERIFY SCORING**

Three AI failures fixed in one pass, each commented `T-24b/c/d`:
- **Tackles** — defenders converging on the carrier were jogging because the
  `steer` call only sprinted the controlled player. The carrier simply outran the
  line. Convergers now sprint.
- **Jackal** — the first defender to a breakdown always contests the ball (was a
  25-65% roll, so most rucks had nobody over it), and the steal chance rises to
  0.35-0.88 when the attack did not compete (`waggle < 5.5` and one committed).
- **Passing** — the CPU picked a random side and failed silently when it had no
  receiver. It now picks a side that has an option.

**Still to verify:** CPU try-scoring. Run the stats audit — if `tries` and
`points` read low after this, the CPU is reaching the line but not grounding, or
the kick bias is still suppressing carries. Do not touch kick reach again; it is
correct after T-24.

### T-31 · Full precise animation set (running, tackle, dive)
**Type:** Animation · **Effort:** XL · **Risk:** Medium · **STATUS: OPEN — blocked on nothing, but big**

The pipeline is un-frozen (T-29). Now the clips themselves need to match the
`animation.ts` dataset (1,100+ points). The user's explicit list:

1. **Running** — speed-matched (done), lean (done), plus: arm swing opposition,
   double hip bob, heel recovery. The coronal clips author these but the leg
   foreshortening in `drawCoronal.leg()` is weak; a runner reads as upright.
2. **Tackle** — anticipation (hip drop 3 frames out), 1-frame impact squash,
   6-frame recovery, the fold through the hip (R-06, C-01, C-03). Currently a
   two-pose dissolve.
3. **Dive for the line** — a real horizontal launch and slide (W-15, R-07), not a
   reuse of the grounded pose.

**Do not** add joints or rewrite the renderer — everything is keyframing and
curve choice against the existing coronal rig. Work per the PRESETS recipes in
`animation.ts` (PR-01..PR-12) and the `CURVES_IMPLEMENTED` list. Verify against
the gates after each clip: `teleportCount` must stay 0.

**Acceptance:** watch a full half hands-off. A sprint reads as a sprint, a
tackle lands with weight, a dive reaches for the line, nothing glides, and no
two players share a phase.

### T-32 · Conversion ritual after a try (fanfare → walk to tee → kick live)
**Type:** Feature · **Effort:** M · **Risk:** Low · **STATUS: DONE**

The conversion was firing the instant the try was scored, with no pause. Now a
conversion is a staged ritual, exactly the "5 seconds" the player asked for:

1. **FANFARE** (2.2 s) — the try banner holds, the crowd noise peaks, everyone
   stands and watches. The match clock is dead (see below).
2. **WALKUP** (2.6 s) — the designated kicker walks to the tee, everyone else
   holds. He sets the ball when he arrives.
3. **AIM** — only now is the kick button live.

**Done:** `KickState.stage` gained `FANFARE` and `WALKUP`; `startKick` sets them
for a conversion (`type === 'GOAL' && lastScorer.kind === 'TRY'`); `upKick` and
`placeBound` drive the stages; the match clock (`update`) holds during both
stages so a compressed-clock half does not eat match time on the celebration.
The narrative shows "TRY!" then "walking to the tee" then the kick prompt.

### T-33 · Papercraft: lie flat on the ground, and side-on on the turn
**Type:** Animation/Render · **Effort:** M · **Risk:** Medium · **STATUS: DONE (first pass)**

The players now behave as paper cut-outs in the 3D stadium, per the premise the
user described:

- **Lie flat** — a downed player (`grounded` clip) draws as a horizontal paper
  body on the turf via `drawFlatPaper` in `render/paper.ts`, instead of the old
  scrunched standing crouch. Head at one end, feet at the other, kit colours,
  number on the back when face-down, body-length shadow.
- **Turn = different sprite** — when the camera looks across the pitch
  (`isSideOnCam`, `|cos(yaw)| < 0.45`), the coronal figure squashes to a 34%
  sliver (`sideOn` in `CDraw`), so a player reads as paper seen edge-on.

**Done but rough** — the flat figure and the edge squish are the honest first
pass; the full papercraft pass is T-34.

### T-34 · Full papercraft pass from the dataset
**Type:** Animation/Render · **Effort:** XL · **Risk:** Medium · **STATUS: OPEN**

`src/game/papercraft.ts` holds **109 authored data points** (≈650 countable
facts) across billboard, turn, lying, edge, weight, depth, seamlessness and
readability. T-33 implemented the two headline states; the rest of the dataset
is the spec for polishing them and adding the rest.

**Do, in order of visible impact:**
1. **True edge profile** — the side-on view is currently a squashed front/back
   figure. Build a real side silhouette (one arm, one leg, forward lean, the
   ball carried in front) per EDGE/E-01..E-15. This is the only view that shows
   true lean and stride.
2. **Turn snap with hysteresis** — T-05/T-11: a fixed threshold plus a dead zone
   so the front↔side↔back swap never flickers at the boundary.
3. **Four-direction paper** — front, back, left edge, right edge (T-07).
4. **The lying figure polish** — present-the-ball, jackal bridge, reaching dive,
   held-up bridge (L-04..L-09, L-13..L-15).
5. **Edge set pieces** — lineout, maul, scrum, ruck side-on (E-12..E-15).

**Do not** add a 3D model or break the flat-fill + dark-outline look. The paper
is the style, per R-10. Verify against the gates: `teleportCount` stays 0, and a
watched half keeps the ball readable at all times (R-04).

### T-35 · Pass flight — the ball must fly, not teleport
**Type:** Bug · **Effort:** M · **Risk:** Medium · **STATUS: DONE**

A pass swapped `carrierNum` and the ball's position instantly, so the ball
appeared to teleport to the receiver.

**Done:** `OpenPlayState` gained `pendingReceiver` and `passT`. `doPass` now
launches the ball (sets `ball.live`, records the receiver, zeroes `passT`)
instead of transferring possession. `upOpen` carries the ball through the air —
it homes toward the live receiver at an exponential rate with a parabolic arc
(`y = 1.05 + sin(π·t)·0.85`) — and hands possession over on arrival. No input is
processed while the ball flies, so the pass is a genuine commitment. The renderer
draws the ball at `op.ball` during flight; the minimap does the same.

**Note:** the receiver keeps running via `think()` (he's still in the support
shape), and the ball homes to him, so they visibly converge. Verify no
`teleportCount` regression in the gates.

### T-36 · Kicks from the correct mark
**Type:** Verification · **Effort:** S · **Risk:** None · **STATUS: DONE (verified)**

Audited every `startKick` call site against the law. All seven were correct:

| Site | Mark |
|---|---|
| Kick-off / restart | centre of halfway (z = 0) |
| 22 drop-out | the 22-metre line (z = ±28) |
| Conversion | in line with the grounding (`tryX`), tee distance |
| Penalty / free kick | the infringement mark (focus point) |
| Open-play kicks | the carrier's position |

One standardisation: the conversion tee moved from 18 m to the standard **22 m**
back from the goal line. The goal posts sit on the try line (`±HOME_POST_Z =
±FIELD.tryZFar`), so `goalDistance` in `startKick` measures tee-to-line correctly.

### T-37 · Remove the world-space controls text above the carrier
**Type:** Presentation · **Effort:** S · **Risk:** None · **STATUS: DONE**

`drawOpenPlayOverlay` drew a `worldLabel` above the carrier listing the controls
("A/D STEER · J/K PASS · …"). Removed. The HUD already carries the controls
top-left; only live telemetry (phase, metres gained, distance to the line, zone)
stays in-world.

### T-38 · Ruck feedback sequence, countdown, and auto-play to the fly-half
**Type:** Feature · **Effort:** M · **Risk:** Low · **STATUS: DONE**

The ruck read is now an ordered, one-word sequence instead of a stat dump:

1. **COMMIT - SPACE** — a jackal is on the ball (the pulsing ring label too)
2. **A/D - CLEAROUT** — working to win it
3. **SECURED** — the ball is won

Plus a large countdown from the ruck clock (`ruckLaw`, default 5 s), colour-banded
green → amber → red. When it hits **0**, the ball is auto-played to the **fly-half
(shirt 10)** instead of the old "not used — scrum awarded" penalty. The
`get narrative()` HUD copy mirrors the same three states. The ruck-clock setting
still chooses the window length (1.5 / 3 / 5 s); the first-receiver target is
currently hardcoded to the 10, which is the natural default.

**Follow-up — DONE:** FIRST RECEIVER is now a RULES option (FLY-HALF 10 /
CENTRE 12 / BACK ROW 8, default 10). The clock-zero release passes the chosen
shirt to `startOpen`, with a fallback order if he is binned or down.

### T-39 · Sprint mechanic, per-player stats and size differences
**Type:** Simulation/Render · **Effort:** M · **Risk:** Low · **STATUS: DONE**

Three asks in one ticket, all landed:

1. **Sprint is real and distinct.** SHIFT is a sustained sprint (×1.24 in
   `maxSpeed`). SPACE's burst now stacks a short ×1.15 on top for 0.8 s — the
   `s.burst` flag existed but was dead; it now multiplies the controlled player's
   speed. Hold SHIFT to sustain, tap SPACE to pop past a defender.
2. **Players run at different speeds.** `maxSpeed` spread widened to 2.9 + SPD/100
   × 5.0, so a 99-speed wing hits ~9.5 m/s sprinting and a 45-speed prop ~6.0. The
   CPU carrier no longer runs a fixed 6.3 m/s — it uses its own `maxSpeed`,
   sprinting when it has space. That was the literal "they run exactly the same
   speed" bug.
3. **Size differences.** `Live` and `Actor` gained a `size` field; `PLAYER_SIZE`
   maps shirt → build (props 1.10, locks 1.12, scrum-half 0.93, wings 0.92).
   `syncActors` copies it; the renderer multiplies `scale` by it in both
   `drawCoronal` and `drawFlatPaper`, so a lock visibly towers over a wing.
   `maxSpeed` also shaves a touch off bigger bodies (`1.03 − size·0.03`).

### T-40 · The receiver teleports when passed to
**Type:** Bug · **Effort:** M · **Risk:** Medium · **STATUS: DONE**

On pass arrival the old code did `rec.x/z = ball.x/z`, but `think()` was also
steering the receiver back toward his support mark every frame — so he was being
yanked onto the ball the instant the pass landed. "The ball travels halfway, then
the player teleports to where the ball is."

**Fix:** the receiver is now owned by `upOpen` during the pass — it steers him at
the ball (urgency 1, sprint), and the ball homes to *him*, so they visibly
converge. On arrival the catch happens where he actually stands; nothing is
snapped. `think()` skips the pending receiver while `op.ball.live` is set.

### T-41 · Headless teleport check
**Type:** Tooling · **Effort:** S · **Risk:** None · **STATUS: DONE (already existed, now proven)**

`runDeep` has detected teleports since the fault hunt was added: any player moving
>1.4 m in a 16 ms frame (a sprint covers ~0.15 m) is logged as `TELEPORT` with
shirt, team and distance. It is a **gate** (`teleportCount === 0`) in `gates.ts`,
run across difficulty 0/3/6. The pass fix (T-40) is exactly the class of bug this
check catches — run the gates to confirm `teleportCount` returns to 0.

### T-42 · Scrum sets too fast, ruck contest, CPU passing
**Type:** Simulation · **Effort:** M · **Risk:** Low · **STATUS: DONE**

- **Scrum pacing** — the cadence timers were 0.3–0.6 s per stage. Now CROUCH/BIND
  0.9 s, SET 0.6 s, ENGAGE 0.55 s, STEADY 0.45 s, FEED 0.7 s, so the pack visibly
  sets before the drive.
- **Ruck contest** — the defending side now commits **three** to a breakdown (was
  two), and the jackal steal floor for a contested ruck rose to 0.12–0.55, so the
  opposition genuinely wins rucks when the attack does not compete.
- **CPU passing** — the CPU now passes when it has space and an option (a 40% roll
  on a carry intent at low pressure), not just when the called play demands it.

### T-12 · Persistence
**Type:** Feature · **Effort:** M · **Risk:** Low

Team management, tactics and kicker do not survive the session. This is
complaint G-001 and it is still open.

**Do:** `localStorage`, one key, versioned envelope `{v:1, squads, tactics,
kickers, options, classicProgress}`. Load on boot, save on any screen exit.
Add a "reset to defaults". Guard every read with a try/catch and a version
check — a corrupt blob must not brick the menu.

**Acceptance:** Set a kicker, play, quit, reload — kicker unchanged. Corrupt
the key manually — game boots to defaults with no error.

---

## 8. THINGS THAT WILL TEMPT YOU

**Do not rewrite the renderer.** It is the constraint, not the problem. Every
hour spent there is an hour not spent on the fact that the ruck is a timing bar.

**Do not raise difficulty by scaling physics.** A-030 exists because every
other rugby game does this. Difficulty scales `reaction`, `errorRate`,
`readRate`. Never speed, never strength.

**Do not add a law without adding an audit rule.** The rules are why the
kick-off was on the wrong line and the offside call was invented. If the
referee can whistle it, the audit must be able to check it.

**Do not trust a green board.** §6 is explicit: the audit measures correctness,
not fun. Play the game. Watch a full half with your hands off the keyboard. If
it does not look like rugby, no number of passing rules fixes that.

---

## 9. QUICK START

```bash
npm install
npm run dev        # play at localhost
npm run build      # single-file dist/index.html
```

**To watch a match with no input:** Main Menu → Friendly → pick sides → play,
then take your hands off the keys. The AI drives all 30. This is the primary
way to judge whether the game works.

**To run the harness:** Main Menu → Behavioural Audit → CAPTURE. Read the six
headline metrics before the point list.

**To feel the ownership contract break:** delete the `if (KICK)` early return
at the top of `think()` in `director.ts`, then run the audit. Encroachment and
teleports will light up immediately. That is the fastest way to understand why
that early return exists.
