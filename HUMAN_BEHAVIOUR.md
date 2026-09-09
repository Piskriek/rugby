# HUMAN BEHAVIOUR — making every shirt feel like a man on a rugby pitch

*Status: design/implementation spec. Authored against the real engine and its
own authored behaviour dataset (`src/game/behaviour/pos-01.ts … pos-15.ts`, and
`src/game/intelligence.ts`). This is the "extensive HUMAN behaviour document"
for each position the project asked for. It does three things:*

1. *Names the felt defects the eye reports (the launch-day list), each anchored
   to the subsystem that owns it.*
2. *Specifies per-position HUMAN movement/decision rules so the model's body
   language reads natural instead of robotic.*
3. *Tells a future coding session exactly where each rule lands, what is
   probe-verifiable and what only a human eye can pass.*

**Honest framing:** the engine already carries a genuinely deep per-position
dataset (fifteen shirts × twenty situations × five beats, ~1,500 authored
points with human-written instructions). So "make it feel HUMAN" is **not** a
content problem — the *where-to-stand* and *what-decision-to-make* logic is
there and is richer than most rugby games. The gap is **how a point in the
dataset is turned into continuous body motion on screen.** That is a movement,
stamina and rendering-feel problem, and it is exactly where every felt bug on
the launch list lives. This doc is about that layer.

---

## 1. The felt defects and where they live

| # | What the eye reports | Owning subsystem | Class |
|---|---|---|---|
| 1 | Starts in the "wrong" camera; must press V | `ui/MatchView.tsx` rig arming + `director` cam seed | fixed this round |
| 2 | Asked to take a kick I'm not the kicker for | `engine/kick.ts` human-drive gating | fixed this round |
| 3 | Own chasers field the kick too easily / defenders don't shape up | `kick.ts` landing spread + `defence.ts` line shape | code (needs numbers) |
| 4 | FPV: my model's head/neck clips the camera, worse on sprint | `render/ThreePlayerManager.ts` local-body hiding + eye point | eye-only |
| 5 | Tackles "disconnect" — two men fall apart; bodies don't bind; ragdolls bounce/slide on the whistle | `engine/breakdown*.ts`, `breakdownChoreo.ts`, `render` ragdoll get-up | eye-only, big |
| 6 | Ball not put into the scrum; ball not live at rucks/mauls | `engine/setpieces.ts` feed, `ball.live` gating | code (probe-able) |
| 7 | Men move slow but their models turn frantically (churn/circling) | `intelligence.ts` steer + `animation`/facing | code + eye |
| 8 | Want: stand in one spot and **shuffle-turn to face the ball**, keep stamina so they **walk** normally and only **sprint to break a gap** | `intelligence.ts` move budget + stamina | code + eye |

§3–§5 are largely numbers/rendering an eye must tune; §1–§2 are fixed; §6–§8 are
the code-and-feel core of this spec and get the most detail below.

---

## 2. The HUMAN movement rules (the heart of §7–§8)

A rugby player is almost never running at top speed and almost always facing
something. The single behaviour that makes a crowd of CPU men read as "team"
instead of "swarm" is:

> **A man should spend most of his time nearly stationary, and all of that time
> with his shoulders pointed at the ball or his assignment — moving his feet in
> small shuffle steps, not full-speed lunges.**

Concrete per-second rules (the numbers a future session tunes):

- **Idle-shuffle, not idle-float.** When a player is inside his dataset slot
  and the ball is >6 m away and not coming to him, his target velocity is
  ~0 and his body stays planted on the slot. What *moves* is his facing and a
  low-amplitude feet shuffle (±0.3 m/s), so he visibly tracks the ball without
  drifting off his mark. This is the "stand and face the ball" ask.
- **Face beats feet.** Facing update rate is the thing people notice. A man who
  needs to turn 120° to face the ball should *turn in place first* (a 90° turn
  ≈ 0.25–0.4 s), then commit to movement. Never rotate while already travelling
  at speed with no heading change — that reads as "circling/churning."
- **Walk is the default commute; sprint is a decision.** Between set-piece
  re-sets and when repositioning >8 m, players use a working jog/walk that
  costs little stamina. Full sprint (~SHIFT for the human; `urgency` for the
  AI) is reserved for (a) chasing a loose ball in play, (b) an attacking line
  break, (c) covering a break in defence, (d) the very first 2–3 steps of a
  chase/carry burst. Everything else is a walk.
- **Sprint must cost and must be scarce.** Stamina is the governor that makes
  men pick their moments. A man at full gas should have visibly shorter,
  choppier strides and a forward lean (the engine already has fatigue-drift
  ideas in `animation.ts` T-09) so the player *reads* when someone is gassed.
- **No two men chase the same point.** The authored fallbacks already say
  "if X owns the slot, do Y." The churn complaint is often two men steering to
  the *same* target and orbiting each other. The slot-ownership must be
  honoured at the *movement* level, not just the dataset level.

### Where these land in code

- `src/game/intelligence.ts` is the CPU brain and owns `think()`/steering and
  the stamina budget (see its comment at ~line 267 "scoring pass — stamina that
  breathes"). **This is the primary file** for §7/§8. Add a movement *mode*
  (`HOLD`/`SHUFFLE`/`WALK`/`SPRINT`) chosen from ball distance + situation +
  own urgency, and gate `maxSpeed` by it so idle players don't burn sprint
  stamina.
- **Do not** reintroduce an off-ball "calm" dead-zone in
  `engine/ballAwareness.ts`. Two attempts were made and reverted because they
  broke the passing/backline/defence probes. The right gate is the mover's
  `steer`/movement-mode decision (where a man who is *already on his mark* can
  safely go near-idle), not a blanket suppression of travelling men. See
  `AUDIT_RUGBY_ENGINE.md §10`.
- Facing/turn smoothness: `src/game/animation.ts` and the render-facing in
  `ThreePlayerManager`/`facingDebug`. Add turn-in-place as its own state so the
  model pivots before it strides.

---

## 3. Per-position HUMAN behaviour briefs

What "feels human" is different for every shirt. These briefs are the readable
statement of intent; each is already encoded in the matching `pos-NN.ts`
dataset, so a future session should treat the brief as *what to tune the motion
to*, not authoring new positions.

> Reading these, keep the §2 rules in mind: **stand on the slot, face the ball,
> walk to reposition, sprint only for a reason.** Every brief below is that
> principle specialised for the shirt's job.

### Forwards — the engine room (1–8)
The scrum/lineout/ruck men. Their human signature is **short explosive bursts
from a low, settled posture**, not long running. Between set pieces and
breakdowns they *walk* to the next ruck, shoulders dropped, because a front-row
man who jogs everywhere is a man out of gas by the 60th minute.

- **1 Loosehead prop, 3 Tighthead prop.** Anchor men. Near-stationary at the
  scrum/maul; when not bound they shuffle-square to the ball and hold. Their
  movement is the shortest walk on the team — they are paid to stand up a
  scrum and hit a ruck, not to run support lines. Face the ball always; never
  chase more than a metre off the ball.
- **2 Hooker.** The team's first support runner and its most mobile front-rower.
  Hits every ruck in the opening minutes; shows fatigue fastest — his shuffle
  visibly slows and his lean deepens as the half wears on. At the scrum he is
  the one who turns to *watch the feed* and the touchline before it's put in —
  a lovely human tell that reads instantly.
- **4/5 Locks.** The jumpers and the engine at the set piece. Between lineouts
  they **walk** (never jog) to the next throw; they jump, land, and *re-set*
  with a half-turn to face the ball. Their long bodies make slow, deliberate
  turns read best — never spin them at winger speed.
- **6 Blindside flanker, 7 Openside flanker.** The breakdown predators. Their
  signature is *burst-then-hold*: a 3–4 m burst to a ruck or a tackle, then a
  crouched scan of the ball before the next decision. 7 especially will
  *shuffle-round the far side of a ruck* to hunt a jackal — feet quick, hips
  low, facing the tackled ball the whole time.
- **8 Number eight.** The most "back-like" forward: picks at the base, runs
  hard support lines off 9, and carries off the back of the scrum. He is the
  forward who is *allowed* to sprint a clean line — but he still walks back to
  the next set piece, conserving gas for the carry.

### Half-backs (9, 10) — the decision spine
The two men whose *standing and facing* carry the most information, because
everyone else moves off them.

- **9 Scrum-half.** The fastest hands and the most *repositioning* of anyone —
  but always as quick shuffle steps around the base of the ruck, never big
  detours. His tells: crouches, points, looks both ways before every pass, and
  when the ball's slow he *bounces on the spot* to keep his feet live. Face the
  ball but keep peripheral eyes on the openside every pass.
- **10 Fly-half.** The pocket. Human 10s are almost still between phases — they
  stand at depth, *walk forward to take the ball flat*, then are gone. He is the
  clearest case of §2: a 10 who jogs back to the pocket after every ruck looks
  frantic; a 10 who *walks* to the pocket and *settles* is a 10 running the game.
  His sprint is reserved for a line-break or chasing his own chip.

### The back three (11, 14, 15)
Their human signature is the opposite of the forwards: **they stand deep and
still, then explode.** A winger hovering and shuffle-turning is a winger
waiting for the ball to reach the wide channel; the moment it does he is the
fastest thing on the pitch.

- **11/14 Wings.** Idle on the touchline, bodies open to the field, tracking the
  ball with their chests. They walk forward only as the ball comes their way and
  *explode* off the mark to finish a break or chase a kick. Their face-toward
  the play must be unmistakable — a winger facing upfield with his back to the
  ball is a catastrophic read.
- **15 Fullback.** The sweeper and last line. Stands deepest, almost always
  square to the whole field so he can read both an up-and-under and a kick
  behind. He *walks up* as the ball comes forward and *drops* the instant a kick
  goes over his head — his repositioning is the most measured on the team
  because his job is to never be beaten for pace when it matters.

### The centres (12, 13) — the seam
The crash/width bridge. Their signature is **hitting a hard line from a
standstill**: stand in the line, then commit to a flat, fast carry or a tackle.
12 is the heavier crash option — his burst is shorter and more violent. 13 the
strike runner — he shows late and sprints through. Both walk back to the line
and *re-face* the ball before the next phase, never drifting wide of their mark.

---

## 4. Priorities for the coding pass (what to change, in order)

1. **§6 (scrum feed / live ball) first** — the only one on the list that is
   cleanly probe-verifiable and therefore safe to fix blind. Inspect
   `engine/setpieces.ts` for the feed putting the ball into the pack and the
   `ball.live` gate at ruck/maul; add/adjust the probe coverage. Do this before
   anything the eye has to judge.
2. **§7/§8 movement mode in `intelligence.ts`** — stand/shuffle/walk/sprint
   budgeted by stamina, honouring slot ownership at the *motion* level. Keep
   the canonical probes green (see `AUDIT §`); do not touch `ballAwareness`.
3. **§4 FPV clipping** — hide more of the local body below the chest and/or move
   the eye point in `ThreePlayerManager`; **needs the player watching frames.**
4. **§3 kick/chase tuning** — a flatter landing spread and a shaped defensive
   line in `defence.ts`; verify by watching a few kick-offs.
5. **§5 tackle binding / whistle get-up** — the physical pile. High risk to the
   passing/tackle probes; only attempt with frame-by-frame eyes. Documented, not
   shipped blind.

---

## 5. Acceptance checklist (a human eye on each)

- A re-set sees forwards *walking* to position while backs *settle into their
  line*, none of them running flat-out.
- Pick a player mid-phase: he is nearly stationary and **shuffle-turning to
  face the ball**, not circling it.
- Shift-sprinting drains stamina and visibly shortens strides; a gassed player
  jogs and leans.
- The scrum's ball is actually in the pack and comes out on the 9 side.
- In first person your own shoulders/chest are visible but your head/neck never
  fill the frame, even at a sprint.
- A tackle shows two bodies meeting and one clearly going down to ground where
  the hit happened.
