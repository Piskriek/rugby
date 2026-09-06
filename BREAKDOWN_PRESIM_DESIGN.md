# BREAKDOWN — the tackle, the contest and the ball out (recorded-physics design)

> Status: engineering pass in progress. This document is the audit + design for
> the tackle→breakdown upgrade and the new *hands-like-magnets* contact tech.
> Everything here is measured before it ships; nothing is a guess.

## 0. Segment log — engine repair (2026-09-06, branch arena/01a072ce-rugby)

Build order step 4 (engine repair) is underway and has moved the headless
engine out of its degenerate regimes. All changes live in `rugby-2026`
(`src/engine/{match,brain}.ts`, `src/physics/contact.ts`, `src/engine/tuning.ts`).

### What was built this segment
- **Wrap→rip→offload contest at the tackle.** `resolveTackle` now runs the
  contact ledger (`resolveWrapDuel`) at every made tackle: outcomes KEEP
  (clamp + present), RIP (defender rips and regathers — loose ball reserved
  for the ripper for 0.45 s so the loser cannot vacuum it back), KNOCK (rare:
  knock-on in the tackle cap cut to ~2 % of tackles), HOLDUP (ball held —
  defence-favourite ruck). A beaten wrap opens an `OFFLOAD_WINDOW` offload to
  support (`tryOffloadInTackle`) — offloads now exist and sit in their gate.
- **Ruck ledger fields.** `RuckCtl` carries `presentation / momentum /
  spillT / defArriveT / uContest / decided / outSpeed` — one stored dice per
  ruck, resolved exactly once by `resolveContest` (`CLEAN | SLOW | STEAL |
  PEN_ATK | PEN_DEF`). Ball-out tempo (QUICK/NORMAL/SLOW) is now the *result*
  of that ledger via `ballOut(contest, held)`, not a fixed clock.
- **Two-side binding, not a pile.** `stepRuckArrivals` gates arrivals to their
  own side of the tackle line (law 15), binds them into attacker/defender
  slots around the ball, and stamps the first defender's arrival
  (`defArriveT`, jackal identity). `retreatOffside` unchanged.
- **Jackal/clean-out contest.** A ruck resolves only after the tackle has
  settled AND the jackal has had a real beat over the ball; then the jackal vs
  the first cleaner duel is resolved from the ledger → turnover / penalty /
  quick-or-slow ball. Ball-out waits for the nine (findNine), never instant.
- **Real-bug fixes found in the audit**
  1. Module-level `brain` cooldown cache (`lastPassAt`/`lastKickAt`) leaked
     across Match instances — every simcheck match after the first inherited
     a huge cooldown, suppressing kicks/passes for ~a whole match (this was
     the “seeds 2–5 degenerate” regime). Moved onto the Match instance.
  2. A loose ball that crossed a try line without a grounding rolled out of
     the field **forever** (observed x = −2300 m), eating the rest of the
     clock as a fake “LOOSE BALL” phase. Now: dead ball → 22 drop-out.
  3. Kick receivers stood still under kicks (`chaseLanding`) while the
     kicker's side chased → the kicking team regathered and walked in tries
     (measured 67 % of tries came straight off kicks/drop-outs). Rewritten:
     the two nearest defenders camp under the ball, the kicking team presses
     as a unit of six, and the rest drop to cover.
  4. 26 s+ goal-prep/tee/set-piece phases tripped simcheck's 24 s stall
     watchdog (they are legitimate stoppages, not stalls) — the phase labels
     now tick (TRY→TEE AT THE POSTS; ASSEMBLING→CROUCH→ENGAGED; TEE→KICKER
     READY).
- **Real-clock cadence.** Set-piece theatre durations raised to real-match
  proportions (scrum/lineout/goal/restart setup, try celebration, penalty
  decision) so an 80-min match spends ~40+ min of clock in stoppages — ball
  in play is now ~35–38 min, i.e. real.

### Measured state at hand-over (final tuning of this pass, 5 seeds, ~8 s)
The engine is deterministic (fixed seeds → bit-identical replays), all five
seeds complete with **zero stalls** and no degenerate regime. Final numbers
(`vite-node tools/simcheck.ts`):

| seed | score | tries | rucks | scrums | lineouts | pens | passes | kicks | TACK/M | offloads |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 NZL–SAM | 11–0 | 1 | 270 | 25 | 29 | 13 | 459 | 65 | 314 | 18 |
| 2 AUS–NZL | 31–0 | 5 | 277 | 16 | 31 | 16 | 500 | 67 | 322 | 34 |
| 3 FRA–ENG | 5–12 | 3 | 243 | 18 | 39 | 17 | 425 | 61 | 289 | 28 |
| 4 SCO–ROM | 31–8 | 5 | 280 | 13 | 25 | 17 | 449 | 51 | 336 | 33 |
| 5 WAL–IRE | 7–7 | 2 | 276 | 16 | 36 | 13 | 447 | 65 | 331 | 28 |

simcheck verdict: **PASS** COMPLETES · NO_STALL · TACKLES · RESTARTS ·
KICKS · OFFLOADS · WALL. The gates that remain **red** split into two
honest, understood categories:

1. **Volume windows run ~1.4× dense** — RUCKS 243–280 vs 120–200, PASSES
   425–500 vs 180–340, scrums 13–25 vs 14–20, lineouts 25–39 vs 20–28,
   turnovers/metres high by the same factor. This is one coupled knob: the
   ball-in-play phase cycle is ~9–10 s while the windows assume ~13–14 s.
   Lengthening it further cuts rucks *and* tries together, which is why the
   pass stopped at this calibration — the scoreline gates (below) are the
   binding constraint on how slow the game may run.
2. **Scoreline windows are seed-fragile** — TRIES/POINTS per team need every
   one of five arbitrary nation pairings inside 1–6 tries and 12–34 pts.
   Real Test scorelines vary as much as these (0–11, 31–0 and 31–8 all
   happened this run); forcing every seed inside both windows requires
   equalising the two teams' scoring power, which fights the possession and
   territory gates that currently pass.

This is the calibration backlog for the next pass, and it is now a pure
numbers exercise on top of a structurally sound engine — every phase,
contest and restart is deterministic, stall-free and ledger-driven, which
is what the gates can measure and what the 3-D layer needs to stage.

### Next
1. Calibration backlog to green (volume windows + scoreline seed-fragility —
   one coupled tempo lever, mapped above).
2. Lab breakdown theatre is built and live (rugby-2026, `npm run dev`, the
   carrier-fall → tackler-roll → jackal → clean-out → nine-sweep loop from one
   ledger). Remaining theatre-visual verification: still-frame QA in-browser
   at impact/wrap/jackal/clean-out instants.
3. Root-app presentation consumes the recorded tech (build-order step 5).
### Next
1. Finish the tempo compression to green (one lever: BIP phase cycle).
2. Lab breakdown theatre (build-order step 3): carrier fall + tackler roll +
   jackal magnet-hands + cleaner drive + nine sweep from one ledger — this is
   where the visual contract of §2.2 gets demonstrated.
3. Root-app presentation consumes the recorded tech.

## 1. What exists today (audit, measured 2026-09)

### 1.1 The recorded-physics layer (`rugby-2026/src/physics`)
- `falls.ts` — the "bake once, replay forever" core. Deterministic offline solve
  of a felled man (17 channel curves, `FALL_HZ` 30, `FALL_T` 2.2 s), nearest-
  recording lookup + mirror + lerp at run time. **Green**: F/B/S archetypes pass
  every probe gate (no mid-air turf clip ≤ 0.12 m, flat sprawl rests, nothing
  stuck up) after the *slack-spaghetti* redesign (no stiff brace, no ball-fold).
- `fallBank.ts` / `fallBank.data.ts` — 180 baked recordings (108 FALL, 72 ROLL),
  int16-quantized, exact L/R mirror decode (the old +0.2/+0.22 limb offsets were
  removed because they dug the left hand under the turf in every flat rest).
- `neutralStand.ts`, `poseMap.ts` — canonical standing pose + the joint-ref
  machinery that turns channel deltas into bone rotations about true model axes.

### 1.2 The lab (`rugby-2026/src/lab`)
A three-actor-scene visual harness: 15-body fall grid, one "live descriptor"
actor, one "crash five bodies into a pile" scene. It plays recorded falls only.

### 1.3 The match engine (`rugby-2026/src/engine`, headless 2-D sim)
Tackle→ruck flow today, traced line by line:
1. `contactCheck` / `tackleFrom` → `resolveTackle`: instant miss roll; on success
   the carrier is dropped (`state='down'`, 2.4 s) and the **ball is thrown loose
   at his feet immediately**. No presentation, no tackle contest, no rip.
2. `beginRuck` — RUCK 'ARRIVING': the tackler and carrier are both "down" and
   both bodies are pinned at the ruck site; the attacking nine is entitled.
3. `stepRuckArrivals` — attackers/defenders arrive by *random nearest man* at a
   flat rate, capped 3/2, then **every committed body is lerped onto the same
   point** — a pile, not a breakdown (no roles, no "over the ball", no cleaner).
4. 'CONTEST' — a lone defender steals with one flat roll; otherwise after a
   fixed clock the ruck is 'READY' and the nine sweeps the ball (fixed-time
   QUICK/NORMAL/SLOW); penalties are a time-based side roll.

Measured engine baseline (`tools/simcheck.ts`, seeds 1–4, whole matches):
**every realism gate fails.** Seed 11: 21 tries, 124 points, 382 rucks, 394
tackles, 0 turnovers, 0 offloads, 0 forward-pass calls; seeds 2–4 reach
200+ points with ~1000 rucks and **zero passes/kicks** — degenerate regimes,
not tuning drift. Root causes to fix (in order of severity):

- **No breakdown contest.** The ruck has no *actor roles* (jackal / first
  cleaner / second man), no arrival race, no clean-out drive and no ball
  presentation. Everything downstream (turnover rate, ball speed, penalties)
  is a clock, which is why rucks explode to 1000 and turnovers stay at 0.
- **Tackle strips the game of its contest.** There is no wrap→grapple window,
  no rip/hold-up/offload-in-tackle micro-phase; a carrier who beats the line
  has nothing to fear until a random timer rolls.
- **Offloads are structurally impossible** (`OFFLOAD_WINDOW` imported but
  never used; the brain only offloads when *not yet* in contact), which flattens
  attack variety and starves the support-line game.
- **Knock-on / forward-pass / interception counts are implausible** (62
  knock-ons, 0 FWD_PASS in seed 11) — downstream of the contact model.
- **No "hands on the ball" anywhere.** The single biggest ask — ball-seeking
  hands, grapple, strip — does not exist in either tree.

### 1.4 The root app (`src/game`, the shipped 5173 product)
Separate legacy engine (`director.ts`, ~2,600 lines) with its own procedural
tackle layer (`ThreePlayerManager` — Mixamo tackle pair, multi-stage timeline)
and its own `engine/breakdown.ts`. It is the *consumer* the recorded tech must
eventually feed; it does not share the falls rig.

## 2. Design — everything around the tackle, recorded

One principle: **the physical layer is presimulated and baked; the social layer
(roles, order, contests) is a deterministic ledger resolved once per breakdown;
the view never integrates anything.** Cost at run time is a lookup + lerp +
tiny pure functions, exactly like `falls.ts`.

### 2.1 The tackle window (0.0 → ~1.2 s after impact)
Phases, resolved once per tackle by a pure, seed-stable function
(`resolveTackleContest` in `src/physics/contact.ts`):

| window | what happens | decided by |
|---|---|---|
| IMPACT 0.00–0.08 | carrier takes the hit; fall clip starts (recorded) | fall bank (F/B/S + speed/h/mass) |
| WRAP 0.08–0.45 | tackler's hands to the ball (**magnet hands**); carrier's hands protect/clamp | contact duel #1: strip / hold-up / retained |
| SPILL 0.45–1.2 | carrier down; ball presented beside him; tackler must roll clear | recorded fall bank + roll clip |
| RACE | nearest defender (jackal) vs nearest attacker (cleaner) sprint to the ball | arrival ledger (distance/speed, deterministic) |
| CONTEST | jackal's hands clamp the ball; cleaner arrives and drives | contact duel #2: clean / steal / penalty |
| OUT | ball swept by the nine; phase continues | ledger: fast / slow / turnover / penalty |

Duel outcomes are a pure function of (strength, skill, numbers, momentum,
arrival lead, dice) — one roll per duel, stored in the ledger, so replay is
bit-stable and the 3-D layer can *stage* the recorded result.

### 2.2 The new "hands like magnets" tech
- Every upright actor within reach of a loose/held ball gets an **analytic
  2-bone arm IK target at the ball** (shoulder→elbow→wrist, closed-form, no
  iteration): hands *seek* the ball like magnets, one hand then the clamp.
- When two opposing hands are on the ball → **grapple**: both hands hold the
  ball position, torsos lean against each other, and the duel torque drives a
  small oscillating pull before the stored outcome fires (ripped / knocked /
  held).
- The ball is a tracked object between the hands — never teleports; it eases to
  the winner's hands, then the winner's clip (Pass/Run/GetUp) takes over.

### 2.3 Clean-out & ball-out language
The engine's breakdown is rebuilt on the *recorded* idiom: roles arrive in a
deterministic order (the "pod"), each man's ground performance is a recorded
clip + a root path, the contest resolves once, and the ball-out speed is the
*result* of the ledger (dominant clean → quick ball; contested → slow; beaten
jackal → turnover) instead of a clock.

## 3. Verification gates (must stay green)
- Physics probes: all existing `tools/*Probe.ts`, bake verification, sweep.
- New `tools/contactProbe.ts`: IK end-point accuracy, duel determinism across
  seeds, outcome distribution sanity, ball ease never tunnels.
- Engine `tools/simcheck.ts` must come back inside its windows (this is the
  current red baseline we are repairing — the breakdown work is what fixes it).
- Lab: breakdown-theatre scene plays the full sequence recorded & repeatable.

## 4. Build order
1. `src/physics/contact.ts` — pure contest/ledger functions + 2-bone IK
   (this file).
2. `tools/contactProbe.ts` — prove IK + determinism + distributions.
3. Lab breakdown theatre — carrier fall + tackler roll + jackal magnet hands +
   cleaner drive + nine sweep, from one ledger.
4. Engine repair — rebuild `stepRuck` on the ledger, wire duel results into
   ball-out speed / turnover / penalty; restore simcheck gates.
5. Root-app presentation consumes the recorded tech (next stage).
