# Rugby Engine — Forensic Technical Audit

**Method.** I read the simulation code subsystem by subsystem and asked, per
area: *what does real rugby actually demand here?*, then *does this code make an
honest attempt at that, or is it a placebo / a dice-roll dressed as simulation?*
Verdicts are anchored to real symbols (functions, constants) in the tree, quoted
so they can be checked. `✔ REAL` = a genuine continuous/structural simulation.
`◐ PARTIAL` = real at some layers, cosmetic at the layer that matters most.
`✖ PRETEND/ABSENT` = a placeholder or a number drawn from a hat with no model.
Confidence: `(v)` verified by reading, `(i)` inferred/needs interactive check.

This is a broad first pass, not an exhaustive read of every line — where I
didn't finish a file I say so rather than guess.

---

## Verdict summary

| # | Subsystem | Verdict | One-line reason |
|---|-----------|---------|-----------------|
| 1 | Ball physics & handling | ✔ REAL (deep) | real 3D ballistic body, spin, forward-pass law on release velocity, strip/catch windows |
| 2 | Running / movement | ✔ REAL | continuous accel model, turn costs, arrival control |
| 3 | Tackle (open-play) | ✔ REAL at the law/decision level | latch-drag with momentum, dive commit, kinetic window |
| 4 | Ruck / breakdown | ◐ PARTIAL | contest is real-ish; the *pile* is authored choreography, not physics |
| 5 | Maul | ✔ REAL-ish | ranks, binds, use-it clock, collapse hazard — but driving is authored |
| 6 | Scrum | ✔ REAL | staged ritual + net-force drive + law calls (early engage, not-straight feed) |
| 7 | Lineout | ✔ REAL-ish | throw-angle law, call system, jumping — but jumper/contest largely scripted |
| 8 | Law / referee | ✔ REAL (deep) | offside geometry, advantage windows, cards, aerial-charge rules |
| 9 | Kicking / restarts | ✔ REAL-ish | ballistics + shot clock + goal probability |
| 10 | AI structure | ◐ PARTIAL | formation/role trees are real; moment-to-moment "feel" churns |
| 11 | Player control / agency | ◐ PARTIAL | rich verb set, but the *model* (one-man vs auto) is unresolved |
| 12 | Contact presentation ("feel") | ✖ the honest gap | bodies are posed/glued, hands don't grip a real body; needs a pile solver + visual iteration |

**Headline:** the premise "it's random animations we pretend are rugby" is
**wrong for most of the game** — the law/ball/set-piece/pacing layers are
genuinely engineered. The premise is **right about one specific, central thing**:
the breakdown and maul are *choreographed positional theatre* whose physical
outcome is decided by abstract odds, not by bodies colliding. That is a large,
self-contained architectural gap, not a sprinkle of polish.

---

## 1. Ball physics & handling — ✔ REAL (v)

- `engine/ballPhysics.ts` owns a real ballistic body (position, velocity,
  quaternion, gravity, bounce), stepped with players in `stepBallWithPlayers`.
- `engine/throwforward.ts` is the star: `PASS_SPEED=13`, `PASS_LEAD=0.8`,
  `solvePassAim`, and a **forward-pass law that grades the *release* relative
  velocity** of ball vs handler (`knockReleaseRel`, `isForwardLoss`), not a
  "was it thrown forward" cartoon. There are strictness profiles
  (`FWD_STRICTNESS`) — i.e. the whistle is derived from physics.
- Catch is **proximity + height band + generous window** in `open.ts`
  (`SPEC_13`), then the ball is welded to the receiver and flight is *not*
  teleported to a point.
- `engine/hands.ts` models the breakdown ball as a hand-held object with
  guards, a `STRIP_BASE_S=0.30` timing that rises `PER_GUARD`, and a
  "window slow" — stealing the ball is priced by seconds of contact, not dice.

**Honest read:** this is a real attempt. The only *feel* deficit here is
presentational — the ball is now drawn with a trail (added), but a 13 m/s
pass still spends ~0.3–0.5 s airborne, which is short enough that a human eye
blinks through it.

---

## 2. Running / movement — ✔ REAL (v)

- `game/intelligence.ts: steer()` — one continuous accel model
  (`accel = 9 + SPD/100*5`), speed→clip cadence mapping so legs match ground,
  a **turn cost** (>135° about-face throttles accel ×0.35) to stop flip-running,
  an arrival controller (`dist<0.35` decelerates and holds) so men don't orbit
  a static mark.
- Human runner and CPU runner use the *same* integrator; `maxSpeed` is a
  function of attributes, stamina, drag; `relativeControls` maps WASD to the
  camera.

**Honest read:** solid. The "runs in a circle when the ball moved 5 cm" report
is real but is not a mover bug — it is a *formation writer* continually
re-targeting support marks against the live ball, which `steer` faithfully
executes. That is an AI-layer issue (see §10), and I deliberately did not patch
the mover to hide it.

---

## 3. Tackle / open-play contact — ✔ REAL at the law level, ◐ at the body level (v)

- `engine/latch.ts` is a genuine contact model, not a snap: `beginLatch`,
  `tickLatch`, `dragMultiplier` (`LATCH_SPEED_MULT=0.28`), a momentum test
  (`LATCH_DEAD_MOMENTUM=1.5`) deciding takedown vs. carry-on-churn, a dive
  commit (`LATCH_DIVE_REACH=2.4`, `DIVE_FLIGHT_SECONDS`), and a **6-DOF joint
  axis model** (`LatchAxes`, `LatchBody`, `LatchJoint`) — real engineering.
- `engine/breakdown.ts` adds a `KINETIC_WINDOW=0.3` kinetic-impact slide so a
  hard hit carries the pair into the ruck.

**Honest read:** the *decision* and *momentum* of a tackle are honestly
modelled. What is not real: the **visual binding of two skinned bodies**. The
tackler is *glued* to the carrier's hip (a hard attach), not contacting him —
which is exactly the "two men gliding in formation" / "he should be driven
into the ground" read.

---

## 4. Ruck / breakdown — ◐ PARTIAL — the central "pretend" charge is TRUE here (v)

- The **structure** is deep: `breakdownPlan.ts` builds a `RuckPlan` with
  `PlanSlot`s, `armPeel`, `planStrike`/`planHit` (clean-out *power and depth*),
  `sampleSlot`, arrival/defence force; `breakdownChoreo.ts` authors every role's
  pose and drive arc; `hands.ts` prices the contest.
- But read the choreo geometry in `breakdownChoreo.ts` `breakdownSlot` /
  `breakdownDriveTarget`: clearers are placed a stride behind the ball and told
  to **"drive through the ball, not to it"** along authored lines with authored
  clip swaps (`cleanout`→`ruck`, `jackal`→`maulBind`). The jackal "digs in" by
  moving to a slot. **No body pushes another body; nothing grips; the outcome of
  the pile is decided by the odds tables, and the bodies then animate the agreed
  verdict.**

**Honest verdict:** the ruck is an *authored positional drama with abstract
physics underneath* — a legitimate design, but not physical contact. This is
precisely "bodies are tools / hands push empty air / pretend rucks." It is the
single largest honest gap in the game and it cannot be fixed by tuning; it needs
a real 6-DOF **pile** solve (a dozen+ low-mass bodies binding and pressing) that
is then animation-re-targeted, and that needs a human watching every frame to
iterate on. Nothing here can be done correctly blind.

---

## 5. Maul — ✔ at the law level, ◐ physically (v)

- `setpieces.ts: upMaul`, `buildMaulBinds`, `maulUseItClock`; `referee.ts`
  models the real stall law: `MAUL_STALL_WARN_S=3.0`, `USE_IT_WINDOW_S=5.0`,
  and a `maulCollapseHazard` with base/imbalance/stall rates and a
  `MAUL_COLLAPSE_DELIBERATE_SHARE` to decide deliberate vs accidental.
- Physically the maul drives as one translation of ranks against authored binds.

**Honest read:** the *law* (the thing you can't fudge without it reading fake)
is genuinely modelled. The *pile* is the same choreographed gap as §4.

---

## 6. Scrum — ✔ REAL (v)

- `setpieces.ts: upScrum` runs the full referee cadence (crouch→touch→pause→
  set→engage) with reset counters and **real law calls**: repeat early engage →
  free kick; feed-not-straight → penalty; `scrumShoveNet`, `shoveTransmission`,
  `scrumTunnelVelocity`, stability/collapse risk are numbers, not hats.

**Honest read:** one of the most honest simulations in the game. The only gap
is the 8 bodies binding and driving as an 8-man wall — it's posed packs pushing
a scalar, which is acceptable at this camera range.

---

## 7. Lineout — ◐ REAL-ish (v)

- Real throw geometry law: `LINEOUT_THROW_ANGLE_LIMIT=15°`, `judgeLineoutThrow`
  (referee refuses a crooked throw). Call system, 5-6-2 lifts, hooker throw
  ritual with a release timing.
- The **contest** (jumpers, tap-down, steal odds) is more scripted than solved,
  and players "form the line" by walking to authored marks.

**Honest read:** functional; the jumper/chaser contest is the weakest physically
simulated set-piece. Priority: medium (it's less frequent than rucks).

---

## 8. Law / referee — ✔ REAL (deep) (v)

- `engine/laws.ts` and `engine/referee.ts` are a real, live officiating layer:
  `liveOffsideLines`, advantage windows (`ADVANTAGE_WINDOW_S=10`,
  `ADVANTAGE_TERRITORY_M=10`, `advantageWindowEngineS`), `AERIAL_CHALLENGE`
  radii and protected height, maul stall/collapse, cards, penalty sanctions with
  `sanctionOf(call)`, `beginPenalty`/`resolvePenalty`, try-grounding geometry.

**Honest read:** this is obsessive in the best way and is a large part of why
"the referee governs" — it genuinely enforces law. The playtest complaint about
the referee is a **pacing/agency** one (the human isn't told the *why* fast
enough and the whistle interrupts), not an absence of law.

---

## 9. Kicking / restarts / goal — ✔ REAL-ish (v)

- `kick.ts` with `RESTART_SHOT_CLOCK=15`, launch ballistics, loose-ball chase,
  landing prediction; goal-kick probability priced from distance/angle/ability.
- Place kick / restart freeze-and-aim rituals are the deliberate pause points
  that read as "the referee governs."

**Honest read:** real. The pacing is the issue (see §13).

---

## 10. AI structure & decision — ◐ PARTIAL (v)

- Real: position trees (`forwardPack`, `backline`, `ballAwareness`), a
  behaviour dataset per situation, cover/converge chases, a ruck gate, echelon
  depth. Teammates of a role-locked human are CPU-driven (fixed earlier) so the
  team structures and feeds you.
- The "headless / circles" read is a **formation-writer** problem: several
  writers continuously re-anchor off-ball marks to the live ball/carrier, so
  when the ball shifts 5 cm a support man gets a new mark and `steer` faithfully
  re-runs. There is no hysteresis between "reposition" and "hold", and no
  per-player "who actually needs to move now" gating.

**Attempted and REVERTED — a documented dead end.** I built a calm layer for the
loose-ball deep line (`assignCalm` + `BallBehaviour.calmMarks` in
`engine/ballAwareness.ts`): hold a COVER/RELOAD mark within a deadzone so a
settled man doesn't re-steer for cm of ball drift. **Every variant regressed a
load-bearing acceptance probe and it was fully reverted** (`git reset` back to
the parent; `ballAwareness.ts` is pristine again). Two concrete failure modes,
verified: (a) an *unconditional* hold (even of travelling men) stranded defensive
structure → `forwardpack`/`openplay` failed; (b) a *settled-only* hold (only when
already at the prior mark and slow) → `backline`/`hands` failed. The off-ball
marks are too coupled to the acceptance suite to be gated this way. **Lesson for
the next session:** do NOT reintroduce mark-level hysteresis in `ballAwareness`
expecting to keep `backline`/`forwardpack`/`openplay` green — if you revisit the
"circling" feel, gate it in the *mover* (`steer` arrival) or the per-role writers,
and treat those three probes as your canary.

---

## 11. Player control & agency — ◐ PARTIAL (v)

- Huge, well-mapped verb set (run, sprint, step, fend, dummy, dive/smother
  tackle, aimed/cut-out/distribute pass, punt/grubber/drop, secure/hands).
- But the **control model** is unresolved: role-lock "one man" (your shirt
  never changes) fights the older auto-switch "always be the relevant player."
  A role-locked forward watches phases he cannot influence — which reads as
  "disconnected / not enough of either."

**This is a design fork I asked about and you chose "one man in the team."** The
work is therefore: make the role-locked man always have a relevant, *possible*
action and never a dead wait — see recommendations.

---

## 12. Contact presentation ("feel") — ✖ the honest gap (v/i)

- Skinned bodies are glued/posed; ragdoll only handles *falls*, not *bound
  piles*; hands aim at sockets, not at another man's body; the breakdown outcome
  is decided then animated.
- This is the gap behind every "bodies are tools / hands push empty air /
  pretend rucks" report. It is a build-out (pile solver + re-targeting + visual
  iteration), and it is the one thing in this game that genuinely cannot be done
  correctly without me watching frames.

---

## 13. Presentation / pacing / camera — ◐ PARTIAL (recently improved)

- Camera rig, ball-flight trail, controlled-player anchor are real and fixed.
- Remaining pacing issues: broadcast/ceremony pauses (kick-off card freeze
  **removed**, but place-kick/restart meters still stop time), and HUD density.
- Fixes already landed: C no longer hijacks into the chaos sandbox; the world
  runs continuously; the passed ball is visible.

---

## 14. Team / tactics / subs / clock / game state — ✔ REAL (v)

- Full squad sheets, form, tactics sliders, live subs with front-row rules,
  match clock/halves, score guard, stat ledger, replay.

**Honest read:** real and broad. Not a source of the "feel" complaints.

---

## Ranked gap list (what to build, in order of felt impact)

1. **[Architectural] Physical breakdown/maul pile.** Real contact solve for the
   tackle→ruck moment. Not tunable blind — needs your frame-by-frame playback.
   Suggested shape: reuse the latch 6-DOF joint machinery (`engine/latch.ts`
   `LatchAxes`/`LatchBody`/`LatchJoint`) as the seed of a small pile solver, then
   animation-re-target the rig onto the solved roots. Acceptance = watch 20
   rucks frame by frame in the preview; a clear-out must visibly push the
   jackal/ball-carrier, not slide to an authored slot.
2. **[AI] Off-ball calm.** ATTEMPTED AND REVERTED (see §10): a mark-deadzone
   calm in `ballAwareness.ts` regressed `forwardpack`/`openplay`/`backline`/
   `hands` probes in every variant. If revisited, gate in the mover or the
   per-role writers, and keep those four probes green as the canary. Note: the
   off-ball "churn" may also be intentional repositioning (the whole team
   following the ball), not a bug — verify with a concrete replay before
   changing anything.
3. **[Control] One-man "always has an action."** When your locked man can't
   influence a phase, either put a relevant task on him fast or make the camera/
   hint guide you — never a dead stand. Concrete: when role-locked and your team
   wins a ruck you're not at, the AI should feed you on a called play or put a
   clear "READY TO RECEIVE / RELOAD" job on you; when defending, never leave you
   goal-side-watching.
4. **[Feel] Ruck/contact animation honesty** — pose the bind pile so bodies
   visibly press (buy back the perception cheaply while #1 is pending). Pure
   renderer work in `ThreePlayerManager.ts` (bind-pose override + hand-socket
   targeting to a real opponent root), so it is verifiable only by eye.
5. **[Pacing] Kill every non-deliberate pause.** Done for the kick-off card
   (world now simulates continuously; `MatchView.tsx`). Remaining deliberate
   meters (place-kick/restart) are gameplay; audit whether a role-locked human
   not taking the kick should still watch them or be offered a skip.

Every claimed fix ships with: `npx tsc --noEmit` (exit 0), `npm run build`
(exit 0), and the probe battery. Green historically: `atmosphere backline
ballphysics controls forwardpack gates hands intent kick maul matchendurance
openplay pass place playercontrols playerrole quickstart referee ruck
scorerestart setpiece tacticalkick t43 t66 t69 t80 backlineprobe`. Pre-existing
(also failing at `origin/v2-arch`, unrelated to this work): `looseballprobe`,
`breakdownprobe`.

---

## Handoff state & session change log

**Branch:** `arena/01a08475-rugby`. HEAD `fd34468`. Source tree clean; no
uncommitted source changes.

**Verified green on this HEAD** (run `npx tsx scripts/<name>probe.ts`):
`atmosphere backline ballbehaviour ballphysics controls forwardpack gates hands
intent kick maul matchendurance openplay pass place playercontrols playerrole
quickstart referee ruck scorerestart setpiece tacticalkick` plus `t43 t66 t69
t80`, and `npx tsc --noEmit` and `npm run build` both exit 0.
**Pre-existing failures (also fail at pristine `origin/v2-arch`, NOT caused by
this work):** `looseballprobe`, `breakdownprobe`, `handsprobe`.

**Commits on this branch (relative to `origin/v2-arch`):**
- `188d1b0` Atmosphere (whistle taxonomy, sin-bin clocks) — earlier task.
- `0016f89` Open-play defence (running kinematics, ball carry, lanes, ragdoll
  stability) — earlier task.
- `ede784e` **You-in-the-team**: pre-match PICK-YOUR-SHIRT feeding
  `cfg.controlNum`; `open.ts` `carHuman` gate so a human-team carrier the role
  lock doesn't own falls to the CPU brain (teammates structure and feed you
  instead of milling); player camera anchors to `d.ctrlPlayer` with ball bias
  off (FPV/3rd sit on *you*).
- `1c33f89` **Keep it rugby**: C no longer launches the 14-body chaos scrim on
  every press (it's the smother-tackle verb again); passed/kicked ball drawn on
  the HUD as a ball with a motion trail + ground shadow.
- `fd34468` **One-man never-stops**: the world simulates continuously past the
  kick-off card (card is an auto-fading overlay, not a hard freeze).

**Attempted and reverted:** an off-ball "calm" mark-deadzone in
`engine/ballAwareness.ts` — see §10 for why every variant regressed the
acceptance probes. Do not reintroduce without a different gating point.

**Deliverables (untracked, in repo root):** `patch_you_in_the_team.patch`
(cumulative of the above vs `origin/v2-arch`), `patch_atmosphere.patch`,
`patch_openplay_defense.patch`, and this audit.

**Recommended next session focus, in order:** (1) the physical breakdown/maul
pile (the real "pretend ruck" gap — needs the human watching frames);
(2) one-man "always has an action" so a locked player never dead-waits;
(3) kill remaining non-deliberate pauses; (4) re-audit the "circling" feel with
a concrete replay before touching marks again.

---

*Produced from a read of the working tree on branch `arena/01a08475-rugby`.
Confidence labels: (v) verified by reading code; (i) inferred and needs the
interactive check that only a human in the preview can give.*

## §11 — Round state: launch-day feel pass (human behaviour)

Committed this round (branch `arena/01a08475-rugby`):
- `176549c` kick ritual no longer waits on a role-locked human whose shirt is
  not the kicker (CPU auto-kicks otherwise). PROBE-VERIFIED: kick/setpiece/
  intent/quickstart/scorerestart/place/tacticalkick all PASS, build green.
- `2df4e5f` a real (non-clinic) match boots into the 3rd-person player rig over
  your locked shirt, seeded from the director shot, WITHOUT grabbing pointer
  lock; first V toggles first-person AND grabs the lock. EYE-VERIFY only.
- `HUMAN_BEHAVIOUR.md` added: per-position HUMAN behaviour spec + fix map.

Findings this round (recorded so a future session does not chase ghosts):
- **#6 "ball not in scrum / not live at ruck"** is NOT an engine-logic gap.
  `engine/setpieces.ts` feeds the ball (`s.ball` state `'LIVE'`, hooker strike
  to the nine); rucks/mauls intentionally hold the ball as the contest. The
  felt defect is almost certainly that no ball OBJECT is *rendered* during
  scrum/ruck/maul. Presentation fix, eye-confirm; do NOT touch passing logic.
- **#4 FPV own-model clipping under sprint** and **#5 tackle binding / whistle
  get-up** remain eye-only and are not shipped blind (passing/tackle probes
  are the risk).
- **#7/#8 movement feel** points at `src/game/intelligence.ts` (movement mode
  + stamina budget). Do NOT retry the off-ball calm layer in
  `engine/ballAwareness.ts` (reverted twice; see §10).
