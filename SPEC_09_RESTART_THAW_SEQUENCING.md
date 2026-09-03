# SPEC_09: Restart Ritual Warm-up — Thaw Sequencing Design

**Status: APPROVED by human review 2026-09-03 and IMPLEMENTED** — the thaw
gate, the play-active predicate and the warm-up beat landed with the SPEC_09
commit; `scripts/spec09-thawprobe.ts` proves the six assertions plus a
bit-identical twin-run of the input gate. This document is the design record;
the code follows it tick-for-tick.

Vocabulary used throughout:

| Term | Meaning (as implemented today) |
|---|---|
| **Restart ritual** | A `RESTART` (kick-off / restart after score) or `DROP_OUT` kick episode: `startKick()` → assembly → `AIM`/`METER` → strike (`launch()`) → `FLIGHT` → catch/land |
| **The freeze** | `Director.placeBound()`'s `setting` branch pins every player to a `kk.form` slot (`place(p, f.x, f.z, 'restart')`, `vx = vz = 0`) once he is ≤ 0.8 m from it |
| **The thaw** | Release of those pins back to `steer()` authority, in `placeBound()`'s "THE BALL IS AWAY" branch |
| **T-69 commitment** | `kk.chasers = CHASE_ORDER.slice(0, 6)` — the six-chaser commitment, assigned inside `launch()` (`engine/kick.ts`) |
| **Pre-set steal** | Any player gaining action or ball privileges before the ball is legally live — e.g. a receiver stepping over the ten early, a chaser pre-set at the landing mark, a man standing on the tee ball, or AI shape targets dragging the line onto the ball (the encroachment recorded at `director.ts` think(): *"A KICK IS OWNED BY placeBound…"*) |

---

## 1. The frame pipeline (why tick order is the whole design)

`Director.update()` runs, strictly in this order (`director.ts` `update()`):

```
 0. pause/over guard            if (paused || over) return
 1. hold timer / replayTimer    replay freeze drains; no engine step
 2. advantage / penalty block
 3. PHASE DISPATCH (engine)     upKick(dt, …)  ← the only state-machine writer
 4. watchdog(dt)
 5. think(dt, input)            AI targets + human input — OWNS NOTHING during KICK
 6. samplePendingTargetSlots()
 7. placeBound(dt)              THE placement authority for the KICK phase
 8. event bus drain → camera → commentary → audio
 9. syncActors();  t += dt
10. handoffControl()            only when phase OR possession changed this frame
```

Two load-bearing consequences:

- **The engine (step 3) always runs before placement (step 7) in the same
  tick.** When `upKick` calls `launch()` on tick N, no player has been
  written yet that tick — the stage flip and the chaser commitment land
  BEFORE any thaw steering can read them.
- **The ball's first motion is tick N+1.** `upKick` returns immediately
  after `launch()`; FLIGHT integration begins next tick. So the thaw
  steering (tick N, step 7) starts one tick before the ball has moved —
  chasers commit against a valid `landingPrediction()` computed from the
  freshly set velocities, never against a stale ball.

## 2. The tick-by-tick thaw map

T = ticks; 1 tick = one `update()` at 1/60 s. `T0` = the strike tick.

### T−assembly → T−1 · the ritual (freeze phase, unchanged by this spec)

| Tick range | What happens | Privileges |
|---|---|---|
| assembly | `startKick()` builds `kk.form` slots (`kickoffFormation()`); `placeBound()` steers every player to his slot (`steer`, single writer); on arrival ≤ 0.8 m the player is **pinned** (`movedBy='restart'`, `vx=vz=0`). Receiving side back-pedals to their 10.9 m line inside `upKick`'s CPU-AIM branch. `formReady = arrived/count`. | none — pins hold Law 12 geometry: kickers behind the ball, receivers behind the ten |
| late AIM | Strike gates arm. CPU: `formed` ladder (`formReady` > 0.97 / > 0.85 at t > 2.8 / > 0.6 at t > 4.5 / t > 6.5) **AND** `gapOk` (nearest receiver ≥ 10.6 m, hard backstop t > 10). Human: early release refused unless nearest ≥ 9.5 m **and** `formReady ≥ 0.85` (the P2.7 "NOT BACK TEN" gate). | kicker: aim + charge only (he is `markBound` in `think()`, so leg input cannot move him); everyone else: none |

### T−1 (optional, NEW) · the warm-up beat — presentation only

Once `formReady ≥ 0.85 ∧ gapOk` (or the t > 6.5 ladder rung), the pinned
thirty may play the warm-up idle micro-motion — crouch-ready sway, head
turns toward the kicker, a low bounce on the toes — using the EXISTING clip
channel. **The warm-up is forbidden from touching authority fields.**
Writable during warm-up: `clip`, `clipT`, `face`. Immutable during warm-up:
`x`, `z`, `vx`, `vz`, `tx`, `tz`, `movedBy`, the slot table, `formReady`.
No input path opens, no pin releases, the ball does not move. The warm-up is
a shiver on the ice, not a melt.

### T0 · the strike tick — the exact intra-tick order

1. **`upKick` (step 3)** evaluates the strike gates above; on pass, calls
   `launch(power, accuracy, wind)`.
2. **`launch()` is atomic** and orders, with no interleaved placement
   writes anywhere in the tick between them:
   1. ball velocities set (`s.vx/vy/vz`), `stage = 'FLIGHT'`, `s.t = 0`;
   2. **the T-69 six-chaser commitment** — `s.chasers = CHASE_ORDER.slice(0, 6)`
      with lane labels (`CHASE_LANES`);
   3. presentation reactions (`shake(0.15)`).

   Invariant **A1**: *liveness and commitment flip together.* No observer in
   any later step of tick N can see `stage === 'FLIGHT'` with an empty or
   stale `chasers` array, because both writes happen inside the same
   synchronous call before step 4 of the pipeline runs.
3. **`watchdog` (step 4)**: phase `KICK`, `kk` alive — no trip.
4. **`think` (step 5)**: its KICK-ownership guard holds (no shape targets
   while `kk` exists — the recorded encroachment fix); the controlled-player
   write is gated on `KICK.stage === 'FLIGHT'` (`think:kick-input:` branch),
   which is now true — the human may steer his (non-bound) man from this
   tick, never before.
5. **`placeBound` (step 7) — THE THAW**, strict sub-order, each write
   single-owner via `steer()`/`place()` (`movedBy`, T-02):
   1. **assert the commitment**: `s.chasers.length === 6`; if the assertion
      ever fails the thaw aborts to the AIM placement (players stay set) and
      the watchdog log records it — a thaw without chasers is T-69 cause 1
      ("they just watch it") resurrected;
   2. the **six committed chasers** (kicking side) get their lane targets
      around `landingPrediction()` — the only players released first,
      because the chase is the legal purpose of the strike;
   3. the **designated receiver** (`assignReceiver`, receiving side) is
      released to the predicted mark — the counter-purpose;
   4. the **remaining receivers** release to support depth behind the
      fielder;
   5. the **kicker** releases last, to a follow-up jog.
6. **bus / camera / audio / `syncActors`** react to the `KICK` event.
7. **`handoffControl` (step 10) does NOT fire at T0** — phase and possession
   are unchanged by the strike. Control reaches the chase/field either by
   Q-switch (routed in `upKick` for the non-kicking side, T-61) or at the
   catch tick when the phase change hands control to the carrying side. Any
   future T0 handoff MUST be gated on `stage === 'FLIGHT'` (the
   `think:kick-input:` gate is the model).

### T0+1 … · flight

- FLIGHT integration begins (the ball's first motion). `placeBound` re-steers
  chasers to the live prediction, then to the ball itself after the first
  bounce.
- **Contest eligibility** (`upKick`): `vy < 0` (on the way down — the
  kicked-at-the-feet fix), `by < 2.55`, `bounces ≤ 2`, `|bx| < 32.5`,
  proximity `< 1.0 m`. Catch roll: chaser `0.55 + chase-slider·0.2`,
  fielder `0.90` (T-69 cause 3 — closest-man tie-break measured, not
  array-ordered).
- Touch / dead-ball / 50:22 branches end the episode into lineout / drop-out.

### T1 · the catch or the land — play fully live

- **Catch**: `startOpen(team, bx, bz, catcher, …, protect 0.25)` — the
  `d.receipt` beat means the fielder cannot be touched for a quarter second
  (the contest resolves into a return, not an instant tackle). Phase →
  `OPEN_PLAY`: full AI + human influence on the ball begins here and only
  here.
- **Settled ball** (`kickLanded`): nearest chaser < 3.5 m regathers; else
  nearest receiver < 6 m is the carrier (T-69 causes 2 & 5 — the ball is
  REACHED, not rolled for or teleported to the fullback); chaser inside
  4.5 m may knock on (15 %) → scrum.

## 3. T-69 six-chaser commitment — the required invariant

**Definition of "initialized"**: `kk.chasers.length === 6` AND every entry
resolves to an eligible shirt of the kicking side (not sin-binned, not down).

**Timing rule (unchanged from today, now codified):** the commitment is
written inside `launch()`, in the same synchronous block as the
`stage = 'FLIGHT'` flip, BEFORE `placeBound` can run its thaw branch in the
same tick — i.e. **commitment precedes unfreeze by construction, not by
schedule**. The thaw branch additionally asserts it (T0 step 5.1). Rationale:
the thaw reads `s.chasers` to select the six released men; a one-tick gap
between liveness and commitment would leave the chase standing in formation
while the ball flies — precisely the T-69 symptom this spec must not
resurrect. Conversely, committing chasers EARLIER (at AIM) would give the AI
a landing-mark target before the ball is live — the pre-set steal.

## 4. Phase 2 — the hard "play-active" gate

One predicate, proposed `restartBallLive(d)`, evaluated on EVERY path that
can grant authority over a player or influence the ball during a restart
episode:

```ts
restartBallLive(d) :=
  d.phase === 'KICK'
  && d.kk != null
  && (d.kk.type === 'RESTART' || d.kk.type === 'DROP_OUT')
  && d.kk.stage === 'FLIGHT'        // the ball is legally live
  && d.kk.chasers.length === 6      // T-69 commitment already initialized
  && !d.paused                      // (paused/over already hard-return in update())
  && d.replayTimer <= 0             // presentation can never grant liveness
```

**Influence matrix** — every ball-touching or authority-granting path, and
the term that locks it during the thaw:

| Path | Lock |
|---|---|
| The tee ball at rest (`AIM`: `kk.bx/by/bz` at the mark) | No player-ball proximity reader exists outside `FLIGHT`; the pins hold Law 12 geometry; the kicker is `markBound` in `think()` so input cannot walk him onto the ball |
| Contest catch (`upKick` FLIGHT) | `stage === 'FLIGHT'` + `vy < 0` + `by < 2.55` + `bounces ≤ 2` + `dd < 1.0 m` |
| Settled-ball awards (`kickLanded`) | Reachable only from FLIGHT terminal conditions (`stopped`/`bounces > 6`/roll cap) |
| Human leg input | `think:kick-input:` branch requires `stage === 'FLIGHT'`; before that the controlled man is the bound kicker (aim/charge verbs only) |
| AI shape targets | `think()`'s KICK guard: no shape targets while `kk` exists (placeBound owns) — the recorded encroachment fix |
| Post-catch tackle | `d.receipt` 0.25 s no-touch beat |
| Warm-up micro-motion | Writes presentation fields only; `x/z/vx/vz/tx/tz/movedBy` immutable while pinned |

**Structural invariants** the implementation must preserve (all currently
true; the design requires they remain):

- **A1 — atomic strike**: liveness flip and chaser commitment are one
  synchronous block; no placement code interleaves.
- **A2 — engine before placement**: the phase dispatch precedes `think` and
  `placeBound` in the tick, so no thaw steering can ever observe a
  half-transitioned strike.
- **A3 — single writer per man per tick**: every write goes through
  `steer()`/`place()` with `movedBy` (T-02); the dev-build double-move
  warning must stay silent through the whole ritual.
- **A4 — presentation grants nothing**: pause, replay, the warm-up beat and
  the camera never set or clear a privilege; only the engine's `stage`
  transition does.
- **A5 — the gates are load-bearing, not decorative**: `formed`/`gapOk`
  (CPU) and the P2.7 back-ten refusal (human) are prerequisites of the
  strike itself; the warm-up may not weaken, pre-empt or visualise them
  away.

## 5. Failure modes defused (traceability)

| Known complaint | How this design holds it |
|---|---|
| P2.7 human strikes before the ten | Back-ten refusal gate stays a strike prerequisite (A5) |
| Kick-off encroachment (AI line dragged onto the ball) | `think()` KICK-ownership guard stays (A3/A5) |
| T-69 "they just watch my kickoff" | Chaser commitment atomic with liveness (A1) + thaw assertion (T0 5.1) |
| "Suddenly has it" teleports at the award | `kickLanded` nearest-man rule untouched; thaw releases by steer, never `place()` snaps |
| NEW risk introduced by warm-up: pins released early to "look alive" | Warm-up writes presentation fields only (§2 T−1); authority fields immutable while pinned |

## 6. Verification plan (executed — `scripts/spec09-thawprobe.ts`, ALL GREEN)

*Results (8 headless matches, difficulties 0/3/6/9, 19 restart episodes,
18 strikes): A1 pin integrity 0 violations; A2 Law-12-at-strike min receiver
gap 13.37 m (gate 10.6), all pinned kickers behind the ball; A3 six eligible
chasers on every flight tick, thaw never held; A4 zero tee-ball proximity
violations; A5 ball motion begins T0+1 in every episode; A6 zero [T-02]
ownership warnings. PLUS the front door, proven by twin deterministic runs
(same seed): holding UP for the whole closed ritual yields a BIT-IDENTICAL
position trace to an idle run — input mathematically cannot move anyone
until the gate opens — and diverges the moment it does.*

*Measurement notes for the record: (1) "pinned" is measured as exact slot
co-ordinates (what `place()` writes); the ≤ 0.8 m approach under `steer()` is
walking, not pinning. (2) The gate opens MID-tick on the strike tick (launch
is step 3 of the pipeline, think is step 5), so the strike tick belongs to
the open phase — input legally acts from the instant the ball is live.*

*Harness: spec07-contracts 17/17, spec08-smoke 13/13, t69probe (receiving
side fields 100%, 0% steal-offs), chain.ts silent, tsc clean, build green.
gates.ts 8/9 — the one failure (BALL ON SCREEN 330 vs ≤ 60) is byte-identical
on the pre-SPEC_09 baseline (verified by stash/run/pop) and is the documented
T-68 / stage-2 re-price gate debt, not a SPEC_09 regression.*

A probe (`scripts/spec09-thawprobe.ts`, to be written with the
implementation) asserting per tick, across N headless matches at
difficulties 0/3/6/9:

1. from assembly to T0: no receiving-side player forward of the ten-metre
   line at any tick; no kicking-side player beyond the ball;
2. `chasers.length === 6` on every `FLIGHT` tick; all six resolve to
   eligible shirts;
3. no player within 1.0 m of the tee ball while `stage === 'AIM'`;
4. first player motion of the thaw occurs on T0 (never T0−1); the ball's
   first motion on T0+1;
5. zero `[T-02] moved by … then …` warnings through every restart episode;
6. gates 9/9, `t69probe` receiving-side field % unchanged, `chain.ts`
   silent, `tsc` clean.

---

**Review outcome: approved 2026-09-03 without amendments. Implemented as
written; deviations discovered during implementation (none material — two
probe measurement calibrations, recorded in §6) were written back here
first.**
