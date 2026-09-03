# INVESTIGATION TICKETS — brief for an outside analyst AI

Hand this file to an AI for deep analysis. Each ticket lists what is OBSERVED,
what is ALREADY MEASURED (do not re-derive), what is NOT KNOWN, and the
specific QUESTIONS worth insight. Full history: `HANDOFF.md` in the repo root.

---

## CONTEXT (read first — constraints that bind any recommendation)

**The game.** A 30-player rugby union simulation in TypeScript. A `Director`
runs phases (`OPEN_PLAY`, `BREAKDOWN`, `MAUL`, `SCRUM`, `LINEOUT`, `KICK`,
plus `_REPLAY` variants) through per-phase updaters in `src/game/engine/`
(`open.ts`, `breakdown.ts`, `setpieces.ts`, `kick.ts`, `laws.ts`, `clock.ts`).
Player targeting/steering lives in `src/game/intelligence.ts` (`steer`,
shapes, marks); global per-frame brain in `Director.think()`; formation
placement in `Director.placeBound()`. Rendering is a papercraft system
(`src/render/{clips,paper,coronal,scene}.ts`) — per-actor 2D cutouts with
posed joints (Pose: hip/lean/arms/legs/fall), driven by a per-actor puppet
state. Cameras: `src/game/camera.ts` + `src/game/engine/camera.ts`
(touchline/end-on/cable rigs, zoom = dolly-first since T-55).

**Hard constraints (user-set, not negotiable):**
- No renderer rewrite — the papercraft files are copied verbatim from an
  outside spec (`animationBuild/handoff.md`); only approved pose edits.
- No physics scaling for difficulty — only reaction/errorRate/readRate.
- Every new law needs an audit rule (src/game/gates.ts has 9 gates).
- Never raise `PHASE_LIMIT` to silence watchdog trips
  ({SCRUM 14, LINEOUT 12, BREAKDOWN 9, MAUL 18, KICK 15, OPEN_PLAY 45, REPLAY 6}).
- Per-frame ownership contract (T-02): steps 2/3/4 must never move the same
  player twice in one frame; every writer tags `movedBy`.
- The clock is COMPRESSED: `clockScale = clamp(halfLength/150, 1, 8)` — game
  seconds run up to ~9x faster than animation seconds. Every real-time
  calibration predating the compressor needs re-pricing (this is the root of
  the re-price ticket below).
- User playtests at difficulty maxed, assists 0, and hands-on.
- Replays (R key) must never trigger for non-try events (T-43 family).

**Data sources that already exist:**
- `npx vite-node scripts/stats.ts <matches> <diff>` — box score vs pro ranges
  (floors/ceilings in `src/game/statsAudit.ts`).
- `scripts/gates.ts` — 9 regression gates. UNSEEDED: known to flicker
  (BALL-ON-SCREEN, NO-TELEPORTS, CHASE-ARRIVALS) — rerun before believing.
- `src/game/trace.ts` `runDeep(cfg, seconds)` — diagnostics: teleports,
  pulse, phase histograms, camera stability.
- Targeted probes: `scripts/t69probe.ts`/`t69probe2.ts` (kickoff contest),
  `t66probe.ts` (post-try states), `t43check.ts` (replay freeze),
  `chain.ts` (pass-chain histogram), `maulprobe.ts`, `phasetime.ts`,
  `deadair.ts`, `endzones.ts`, `camprobe.ts`/`camprobe2.ts`.
- `Director.watchdogLog` — every trip names its phase and age.

---

## T-41 · MAUL PICK-LOOP (engine)
**Observed:** CPU-driven mauls end in one of two ways: driven over for a try,
or the ball is punted away; the maul never produces picked-and-gone strikes
or executed moves off the back. Separately measured: the CPU wins mauls with
no user input ~90% of the time (maul contest model is lopsided vs humans).
**Known:** `upMaul` (engine/setpieces.ts) advances a 1D `z` with force
differential (`forceA-forceD)/1400`; stall at |speed|<0.12 warns at 3 s,
whistles at 5 s (maulLaw=2 loops it instead); exit at t>8 → `startOpen` at
the maul spot. No "move" vocabulary exists (wheel, peel, transfer).
**Not known:** what a human-fair maul power curve looks like (the ~90% is
CPU-v-CPU); whether maul exits should feed `cpuCallPlay` with maul-specific
calls or just `startOpen` with better intent; whether the 1D drive model can
support peel/transfer at all without a 2D rebuild.
**Questions:** (1) Design a minimal maul-exit vocabulary (e.g. PICK_AND_GO,
WHEEL_AND_PEEL, TRANSFER_TO_9) that fits the existing 1D model — what state
does each need? (2) How should maul contest power be re-gated so a human
committing inputs (SPACE waggle exists) wins 40-60% on even packs without
scaling physics (only readRate/commit windows)? (3) Does the 8 s exit beat
the 18 s PHASE_LIMIT leave enough room for one call + one strike?

## T-49 · BACKWARD POD LOOP (attack structure)
**Observed:** CPU attacks pass backwards into pods endlessly; wings only get
ball via the wide-call sort; phases go nowhere. Baseline measured:
`chain.ts` at diff 3 → carrier-changes 302, pass chains {1: 156, 2: 1}.
**Known:** `cpuCallPlay` picks from a call list; the wide sort
(WIDE_SWEEP/MISS_PASS/LOOPL_PASS/SWITCH → uncovered-first, then |x-carX|)
lands on wings but the ROLL then runs pods flat/backwards; support marks sit
BEHIND the carrier by construction (attack-depth rule absent). Pass speed is
true 13 m/s since T-62; receiver runs onto the ball.
**Not known:** whether the fix is (a) a FORWARD-variation rule in the
receiver/pod target selection (flat or crossing runners, pod carry target =
gain-line break point), (b) a depth model change (support arrives ON the
line, not behind it), or (c) call-selection bias (POD_CARRY share too high
when phasesGained==0). Measure with `chain.ts` + a new mean-gain-per-phase
metric on unbroken possessions.
**Questions:** (1) Which single change most increases mean gain per phase
without breaking the honest-pressure tackle economy? (2) What pod-spacing
model (interval, depth offset vs carrier) keeps offload lanes alive? (3) How
to keep the wide-call sort and a forward rule from fighting (priority order)?

## T-65 · LINEOUT→SCRUM "SUDDENLY" (law presentation)
**Observed:** user sees a lineout "suddenly become a scrum on the
opposition 22". The award itself is lawful: a maul from the lineout stalls →
warn at 3 s (`USE IT — THE MAUL HAS STOPPED` hint) → whistle at 5 s →
`startScrum(def, stall spot)`. Complaint is the READ, not the law.
**Known:** the warn is a one-shot 2.4 s hint; maulLaw=2 (endless shove
option) loops the stall instead of whistling. `showHint` vs `lawCall` vs
banner are three different visual channels.
**Questions:** (1) Best presentation for a stall countdown (persistent ref
call + on-pitch mark? reuse the ruck countdown channel?). (2) Is maulLaw=2
worth keeping given T-41, or should stall→scrum always fire? (3) Any audit
rule to add for "stall warnings surfaced" so the read is testable?

## T-66 · TRY ANIMATION REPEATS WHILE EVERYONE FROZEN (render/ritual)
**Observed once, human-side only.** After a try, the scorer's animation
appears to repeat while the rest stand frozen. CPU probes (10 matches,
`t66probe.ts`) show phase-after-try is ALWAYS the conversion KICK; dive clip
sets once.
**Known suspects:** (a) the papercraft lie-breathing hold after the dive
(lieF loop) reads as a "repeat"; (b) a human-side FANFARE path re-arming
`clip='dive'` (the dive is re-set in `scoreTry` only once, but the try
REPLAY/W-011 TMO window re-renders); (c) hysteresis in the paper-view map
flipping the scorer's card mid-hold (view flip can look like a re-animation).
**Not known:** which. Needs a human repro or a targeted render-side probe
(log clip/clipT/view per frame for the scorer through FANFARE+WALKUP).
**Questions:** (1) Which of the three mechanisms fits "repeats while frozen"
best, given the puppet pipeline (blend 0.12/0.16, lie hold, view
hysteresis)? (2) Design the cheapest probe that discriminates.

## T-67 · DOUBLE TRY (score → "scrum" reset → score again → conversion)
**Observed once, human-side.** Try awarded, points on the board, then a
"scrum" reset near the goal line, second score, then the conversion.
Structurally illegal (a try is followed by the conversion, never a scrum).
CPU probe clean x10 (zero double-scores, zero scrum frames within 8 s of a
try).
**Known structural suspects:** (a) a watchdog `trip()` near the goal line —
reset `startOpen` at focusPoint ≈ 2 m out, immediate second grounding; (b)
the user's "scrum" may be the kickoff-formation pack rows; (c) the TMO
corner-check window (4.2 s) interacting with a manual replay (now frozen
safely since T-43). If (a), `watchdogLog` will name the trip — the log must
be visible in the pause/stats UI to catch it in a human session.
**Questions:** (1) Rank the mechanisms; is there any path where `scoreTry`
fires twice without a watchdog trip in between? (2) Propose the minimal UI
change (surface `watchdogLog` entries + phase label in the pause panel?) to
catch a human repro. (3) Should `scoreTry` be idempotence-guarded per
possession episode as a hard backstop regardless?

## T-68 · GATE MARGIN + UNSEEDED HARNESS (tooling)
**Observed:** legitimate placements ride at maxDisp 1.17-1.30 m against the
1.4 m teleport gate (measured on HEAD too — pre-existing), so unseeded gate
runs flicker NO-TELEPORTS / BALL-ON-SCREEN / CHASE-ARRIVALS failures.
**Known:** gates run 100 s per difficulty, unseeded; `R()` (rng.ts) is the
single stream; the ~1.3 m placements are startOpen's close-place guard +
breakdown eases, all sanctioned and animated.
**Questions:** (1) Seed the harness (per-run seed log + retry-on-fail) —
what's the minimal change to gates.ts that kills the flake without hiding
real regressions? (2) Which of the ~1.3 m writes should be tightened to buy
margin (ease caps?), and which are fine? (3) Should the teleport gate scale
with dt (a speed test) instead of a fixed 1.4 m frame displacement?

## STAGE-2 RE-PRICE · THE BOX SCORE vs THE COMPRESSED CLOCK (balance meta)
**Observed (20-match batches, diff 3):** the realism score swings 43-71%
batch to batch on the SAME code family. Currently LOW: tackles ~70 (floor
90), rucks ~110 (floor 120), lineouts ~9-11 (floor 14), turnovers ~6 (floor
10), scrums 7.5-8.2 (floor 8, flickering), kicks ~29 (floor 30, new),
possession 37-42 (floor 40, new).
**Known:** floors come from `statsAudit.ts` (professional ranges for REAL
80-minute matches). The sim compresses the clock (`clockScale` up to ~9x on
some configs) — events per REAL second are inflated, so per-80-min totals
should be reachable, but phase economy (decision cadences in game-seconds)
was tuned before the compressor. Tackles floor needs contact volume; the
numbers-gated jackal (playtest 3) intentionally suppresses turnovers to ~6
vs a floor of 10 — accepted as the honest cost, re-price pending. Kickoffs
now resolve as a real contest (T-69) — if kicks stay <30, suspect the
contest eating kick-phase economy.
**Not known:** which floors are WRONG for this sim's ruleset vs which stats
are genuinely starved. 20+ matches per verdict is the standing rule; batch
variance at n=20 is ±7% of score.
**Questions:** (1) For each LOW stat, is the floor defensible under a
compressed clock, and if not, what's the principled re-derivation? (2) What
sample size actually resolves a 7% score delta (run variance math on the
existing batches)? (3) Which single stat, if fixed, cascades into the others
(e.g. rucks→tackles→turnovers)? (4) Is the ±7% batch swing itself a bug
(match-length tail events dominating) — propose a diagnostic.

## AUDIT FAMILIES · INTENT REVIEW (static analysis backlog)
From an earlier automated audit (counts are historical):
- **LOG-19 pod channel (x58)** — pod shapes re-forming in the same lateral
  channel repeatedly. Overlaps T-49.
- **LAW-71 (x31)** — offside enforcement edge: rule is "ok iff
  offsideLinesDrawn || stage ∈ [CONTACT,PLACE,SET,CARRY,ASSEMBLE,OVER]".
  Audit wants the intent re-checked.
- **LAW-66 line holes (x25)** — gaps in the defensive line at lineout time.
- **LOG-119 (x40)** — ball sits at ruck bases long; check whether the
  use-it window semantics (nine owns it once secured) match the rule's
  intent.
- **UX-28 (x29)** — control-list noise (verbs shown that are dead in
  context).
**Questions:** (1) For each family: real bug, audit-rule miscalibration, or
by-design? (2) Which have user-visible symptoms worth a playtest probe?
(3) Propose the audit-rule wording for any that become new laws.

---

## PRIORITY ORDER (my read — challenge it)
1. STAGE-2 RE-PRICE (it gates every future verdict — measurement first)
2. T-49 backward pods (the on-pitch feel of attack)
3. T-41 maul exits + contest fairness
4. T-67 double try (legality; needs the watchdog surfacing)
5. T-66 try-repeat (render read)
6. T-68 harness seeding (cheap, unblocks clean CI)
7. T-65 stall presentation
8. Audit families (batch review)
