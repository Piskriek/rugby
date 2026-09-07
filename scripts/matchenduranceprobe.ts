/**
 * scripts/matchenduranceprobe.ts — THE 5-MINUTE MATCH ENDURANCE HARNESS.
 *
 * The gate probes each exercise one fault class in a short, aimed run. This
 * one does the opposite: it plays an UNATTENDED 15 v 15 match for a full five
 * simulated minutes at a fixed 60 Hz tick, exactly the way the view loop
 * would, and refuses to let the fault classes the whole season hunted come
 * home in a long match:
 *
 *   - the physics EXPLOSION  — a NaN position vector, a body faster than the
 *     solver's integration budget, or a body that leaves the world;
 *   - the KINEMATIC LOCK     — a latch that never releases, a weld that
 *     survives the ruck it was wound into, a ruck that deadlocks on its
 *     clock. The engine's own watchdog trips on the last of these and
 *     force-resets the match; here a trip is a failure, not a recovery.
 *
 * WHAT IS ASSERTED (the spec):
 *   1. >= 15 DISTINCT PHASE TRANSITIONS — kickoff -> open play -> tackle ->
 *      ruck -> pass -> tackle and on. Counted as (phase, breakdown-stage)
 *      changes; five unattended minutes produce dozens, and the trial must
 *      also contain complete tackle->ruck cycles with a pass chain between.
 *   2. 0 OUT-OF-BOUNDS PLAYER POSITIONS. The spec line is `y < -5 ||
 *      |x| > 60`, stated in the probe's world frame: the engine's lateral
 *      axis (`x`) runs +/-34.5 m and its depth axis (`z`) to the dead-ball
 *      lines at +/-62 m. The check applies the spec's 60 m world bound to
 *      the lateral axis literally (`|x| > 60`) and to the depth axis with
 *      the 5 m dead-ball margin (`|z| > 65`) — a player on the dead-ball
 *      line is in the stadium, not out of the world.
 *   3. 0 NaN COORDINATES — every live player's x/z/vx/vz, every latch
 *      body's full state vector, the open-play carrier state, and the
 *      breakdown ball (its `y` only exists once the heel arc starts),
 *      every single tick.
 *   4. 0 DEADLOCK FREEZES — no watchdog trip, and no live phase in which
 *      the coarse world (phase, stage, ball, every player) is bit-identical
 *      for 20 straight seconds.
 *   5. 0 LEAKED CONSTRAINTS (the kinematic-lock audit) — the moment the
 *      phase leaves a breakdown, every lattice joint must be released and
 *      no body may still be `bound`; and outside OPEN PLAY no live player
 *      may carry an open-play latch link (a latched man is a man at 28%
 *      pace with a phantom defender on his hip, forever).
 *   6. 0 SOLVER INSTABILITY RESETS — the lattice's own NaN guard resets a
 *      corrupted body to the field CENTRE; that is a teleport the fault
 *      hunt exists to make unreachable, so any fire is a failure.
 *   7. No unhandled exception escapes `Director.update()` for the whole run.
 *
 * MATCH CLOCK. `gateConfig` defaults a half to 40 match-minutes; at the
 * director's 8x clock scale that is a 5-minute HALF, and the second half
 * would run off the budget. This harness sizes the match to the window:
 * 10 match-minute halves at 4x scale are 150 real seconds apiece, so the
 * five-minute tick budget contains BOTH halves and the half-time restart —
 * a full match, kickoff to kickoff.
 *
 * Exit 0 when every assert holds on every trial, 1 otherwise. The metrics
 * block at the end of each trial is the trial log the spec asks for.
 */
import { Director, NO_INPUT, type MatchConfig } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { LATCH_MAX_V, LATCH_MAX_YAW_V } from '../src/game/engine/latch';

const DT = 1 / 60;                 // fixed engine tick, seconds
const SECONDS = 300;               // the five-minute budget
const TICKS = SECONDS * 60;        // 18 000 ticks at 60 Hz
const STALL_FREEZE_S = 20;         // 20 s of an identical live world = frozen
const OOB_X = 60;                  // spec bound, lateral axis (field is +/-34.5)
const OOB_Z = 60 + 5;              // spec bound + dead-ball margin (line at 62)
const MIN_TRANSITIONS = 15;

/* -------------------------------------------------------------- helpers --- */

const isFiniteVec = (xs: number[]): boolean => xs.every(Number.isFinite);

/** One trial of the endurance run. Pure function of the difficulty: the
 *  engine is its own RNG source, so two trials are two different matches. */
function runTrial(trial: number, difficulty: number): {
  pass: boolean;
  metrics: Record<string, number | string>;
} {
  const cfg: MatchConfig = { ...gateConfig(difficulty), halfLength: 10 };
  const d = new Director(cfg);

  /* ---- trial state -------------------------------------------------- */
  let prevFp = '';
  let transitions = 0;
  let tackles = 0;        // OPEN_PLAY -> BREAKDOWN entries
  let ruckFormations = 0; // PLACE -> RUCK
  let passes = 0;         // carrier changes inside open play
  let possessionSwaps = 0;
  let halfTimes = 0;
  let nanViolations = 0;
  let oobViolations = 0;
  let leakedJoints = 0;       // joints surviving a breakdown teardown
  let leakedBounds = 0;       // bodies still `bound` after a teardown
  let openLatchLeaks = 0;     // latch links alive outside OPEN PLAY
  let stallFreezes = 0;
  let exceptions: string[] = [];
  let maxAbsX = 0;
  let maxAbsZ = 0;
  let maxPlayerSpeed = 0;
  let maxBodySpeed = 0;       // lattice bodies, against LATCH_MAX_V
  let maxBodyYawSpeed = 0;    // lattice angular, against LATCH_MAX_YAW_V
  let solverResets = 0;       // the lattice's NaN-guard fire count
  let tick = 0;
  let lastPossession: 'A' | 'B' | '' = '';
  let lastCarrierNum = -1;
  let lastStage = '';
  let lastPhase = d.phase;
  let stallTicks = 0;
  let lastHalf = d.half;
  /* the metrics object is rebuilt by every latchMount reset(); flush the
   * previous mount's cumulative instability count when the identity changes */
  let mountedMetrics = d.latches.metrics;

  const fp = (): string => {
    /* coarse world fingerprint: positions at 0.5 m so a 3 cm shimmy does
     * not count as movement, a metre of drift absolutely does */
    let s = `${d.phase}|${d.bd?.stage ?? ''}|`;
    const ball = d.bd ? { x: d.bd.ball.x, z: d.bd.ball.z } : { x: 0, z: 0 };
    s += `${Math.round(ball.x * 2)},${Math.round(ball.z * 2)}|`;
    for (const p of d.live) s += `${Math.round(p.x * 2)},${Math.round(p.z * 2)}|`;
    return s;
  };

  /* ---- the run ------------------------------------------------------ */
  for (; tick < TICKS; tick++) {
    const t = tick * DT;
    try {
      d.update(DT, NO_INPUT, new Set(), new Set());
    } catch (e) {
      exceptions.push(`t=${t.toFixed(1)}s phase=${d.phase}: ${e instanceof Error ? e.message : String(e)}`);
      if (exceptions.length > 5) break;   // a throwing loop is already lost
    }

    /* phase + stage transitions */
    const stage = d.bd?.stage ?? '';
    if (d.phase !== lastPhase || stage !== lastStage) {
      transitions++;
      if (d.phase === 'BREAKDOWN' && lastPhase === 'OPEN_PLAY') tackles++;
      if (d.phase === 'BREAKDOWN' && lastStage === 'PLACE' && stage === 'RUCK') ruckFormations++;
      lastPhase = d.phase;
      lastStage = stage;
    }
    if (d.half !== lastHalf) { halfTimes++; lastHalf = d.half; }

    /* open-play carrier changes = the pass chain (hand-to-hand, the phase
     * that sits between the ruck and the next tackle) */
    if (d.phase === 'OPEN_PLAY' && d.op) {
      const poss = d.possession;
      if (lastPossession && poss !== lastPossession) possessionSwaps++;
      lastPossession = poss;
      if (d.op.carrierNum !== lastCarrierNum) {
        if (lastCarrierNum >= 0) passes++;
        lastCarrierNum = d.op.carrierNum;
      }
    }

    /* ---- KINEMATIC-LOCK AUDIT ---------------------------------------
     * A breakdown ends by releasing every bind: the RECYCLE clear, the
     * whistle clear, the kick clear. Anything still jointed or bound after
     * the phase leaves is a constraint the episode forgot to release — the
     * man stays welded (or still pushing a dead contest) until the next
     * mount's reset, which is the freeze class this harness exists for.
     * The open-play latch links are the same class on the other side of
     * the episode: a latch is legal ONLY inside a live OPEN_PLAY drag, so
     * the moment the phase leaves OPEN PLAY (takedown, try, kick, whistle)
     * both links must be gone — a latched man outside the drag is a man at
     * 28% pace with a phantom defender on his hip, forever. */
    /* lattice joints/bounds are live INSIDE a breakdown — that is the pile —
     * so the audit asks only about frames outside it */
    if (d.phase !== 'BREAKDOWN' && d.phase !== 'BREAKDOWN_REPLAY') {
      for (const j of d.latches.joints) if (!j.broken) leakedJoints++;
      for (const b of d.latches.bodies) if (b.bound) leakedBounds++;
    }
    /* drag links are live INSIDE open play — that is the tackle — so the
     * audit asks about every other phase */
    if (d.phase !== 'OPEN_PLAY') {
      for (const p of d.live) if (p.latchedBy || p.latchingOnto) openLatchLeaks++;
    }

    /* ---- physics invariants — every tick, not every frame batch ------ */
    for (const p of d.live) {
      if (!isFiniteVec([p.x, p.z, p.vx, p.vz])) {
        nanViolations++;
        if (nanViolations > 20) break;
      }
      if (Number.isFinite(p.x) && Number.isFinite(p.z)) {
        maxAbsX = Math.max(maxAbsX, Math.abs(p.x));
        maxAbsZ = Math.max(maxAbsZ, Math.abs(p.z));
        if (Math.abs(p.x) > OOB_X || Math.abs(p.z) > OOB_Z) oobViolations++;
      }
      maxPlayerSpeed = Math.max(maxPlayerSpeed, Math.hypot(p.vx, p.vz));
    }
    if (d.bd) {
      const ballChecks = d.bd.ball.y !== undefined
        ? [d.bd.ball.x, d.bd.ball.z, d.bd.ball.y]
        : [d.bd.ball.x, d.bd.ball.z];
      if (!isFiniteVec(ballChecks)) nanViolations++;
      if (!Number.isFinite(d.bd.axis) || !Number.isFinite(d.bd.axisVel) || !Number.isFinite(d.bd.contestMeter)) nanViolations++;
    }
    for (const b of d.latches.bodies) {
      if (!isFiniteVec([b.x, b.y, b.z, b.vx, b.vy, b.vz, b.yaw, b.yawVel, b.roll, b.upright])) nanViolations++;
      else {
        maxBodySpeed = Math.max(maxBodySpeed, Math.hypot(b.vx, b.vz));
        maxBodyYawSpeed = Math.max(maxBodyYawSpeed, Math.max(Math.abs(b.yawVel), Math.abs(b.rollVel)));
        if (Math.abs(b.x) > OOB_X || Math.abs(b.z) > OOB_Z) oobViolations++;
      }
    }
    if (d.op && !isFiniteVec([d.op.carrierX, d.op.carrierZ, d.op.vx, d.op.vz])) nanViolations++;

    /* ---- SOLVER INSTABILITY — the NaN guard fires by resetting the body
     * to the field centre; the counter is cumulative per mount and a new
     * mount gets a fresh metrics object, so flush on identity change ----- */
    if (d.latches.metrics !== mountedMetrics) {
      solverResets += mountedMetrics.instabilityFrames;
      mountedMetrics = d.latches.metrics;
    }

    /* ---- deadlock: a LIVE phase whose world has not changed for 20 s --
     * Paused (half-time), over and the instant replay are freezes BY
     * DESIGN and are excluded. */
    const live = !d.paused && !d.over && d.phase !== 'REPLAY';
    if (live) {
      const now = fp();
      stallTicks = now === prevFp ? stallTicks + 1 : 0;
      if (stallTicks === Math.floor(STALL_FREEZE_S * 60)) {
        stallFreezes++;
        console.log(`  [freeze] t=${t.toFixed(1)}s phase=${d.phase} stage=${stage || '-'} held ${STALL_FREEZE_S}s — ${d.watchdogLog[d.watchdogLog.length - 1] ?? 'no watchdog note'}`);
      }
      prevFp = now;
    } else {
      stallTicks = 0;
      prevFp = '';
    }

    if (d.over) break;   // full time inside the budget: the rest is quiet
  }
  solverResets += d.latches.metrics.instabilityFrames;   // the final mount

  /* ---- the asserts (the spec) --------------------------------------- */
  const okTransitions = transitions >= MIN_TRANSITIONS;
  const okCycles = tackles >= 3 && ruckFormations >= 3 && passes >= 3;
  const okNan = nanViolations === 0;
  const okOob = oobViolations === 0;
  const okFreeze = stallFreezes === 0 && d.watchdogTrips === 0;
  const okConstraints = leakedJoints === 0 && leakedBounds === 0 && openLatchLeaks === 0;
  const okSolver = solverResets === 0 && maxBodySpeed <= LATCH_MAX_V + 1e-6
    && maxBodyYawSpeed <= LATCH_MAX_YAW_V + 1e-6;
  const okExceptions = exceptions.length === 0;
  const pass = okTransitions && okCycles && okNan && okOob && okFreeze
    && okConstraints && okSolver && okExceptions;

  const metrics: Record<string, number | string> = {
    trial,
    difficulty,
    ticks: tick,
    simSeconds: (tick * DT).toFixed(1),
    halfReached: d.half,
    halfTimes,
    over: d.over,
    score: `${d.teams.A.nation.short} ${d.teams.A.score} - ${d.teams.B.score} ${d.teams.B.nation.short}`,
    transitions,
    tackles,
    ruckFormations,
    passes,
    possessionSwaps,
    nanViolations,
    oobViolations,
    maxAbsX: +maxAbsX.toFixed(2),
    maxAbsZ: +maxAbsZ.toFixed(2),
    maxPlayerSpeed: +maxPlayerSpeed.toFixed(2),
    maxBodySpeed: +maxBodySpeed.toFixed(2),
    bodySpeedBudget: LATCH_MAX_V,
    maxBodyYawSpeed: +maxBodyYawSpeed.toFixed(2),
    yawBudget: LATCH_MAX_YAW_V,
    solverResets,
    leakedJoints,
    leakedBounds,
    openLatchLeaks,
    stallFreezes,
    watchdogTrips: d.watchdogTrips,
    exceptions: exceptions.length,
  };
  if (exceptions.length) metrics.exceptionFirst = exceptions[0];
  return { pass, metrics };
}

/* --------------------------------------------------------------- main --- */

console.log('TARCS match endurance probe — 5 min headless 15 v 15 @ 60 Hz\n');
const trials = [
  { difficulty: 6, label: 'standard (diff 6)' },
  { difficulty: 9, label: 'high-density (diff 9)' },
];

let allPass = true;
trials.forEach((tr, i) => {
  const t0 = Date.now();
  console.log(`trial ${tr.label}:`);
  const { pass, metrics } = runTrial(i, tr.difficulty);
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  for (const [k, v] of Object.entries(metrics)) console.log(`  ${k.padEnd(18)} ${v}`);
  const checks: [string, boolean][] = [
    [`transitions ${metrics.transitions} >= ${MIN_TRANSITIONS}`, metrics.transitions >= MIN_TRANSITIONS],
    ['tackle -> ruck -> pass cycles present', metrics.tackles >= 3 && metrics.ruckFormations >= 3 && metrics.passes >= 3],
    ['NaN coordinates = 0', metrics.nanViolations === 0],
    ['out-of-bounds positions = 0', metrics.oobViolations === 0],
    ['body speed inside solver budget (linear + angular)', metrics.maxBodySpeed <= LATCH_MAX_V + 1e-6 && metrics.maxBodyYawSpeed <= LATCH_MAX_YAW_V + 1e-6],
    ['solver NaN resets = 0', metrics.solverResets === 0],
    ['leaked constraints = 0 (joints + bounds + open latches)', metrics.leakedJoints === 0 && metrics.leakedBounds === 0 && metrics.openLatchLeaks === 0],
    ['deadlock freezes = 0 (stall + watchdog)', metrics.stallFreezes === 0 && metrics.watchdogTrips === 0],
    ['unhandled exceptions = 0', metrics.exceptions === 0],
  ];
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) allPass = false;
  }
  console.log(`  [wall ${wall}s] ${pass ? 'PASS' : 'FAIL'}\n`);
});

console.log(allPass
  ? 'MATCH ENDURANCE PROBE PASSES — 5 minutes, no explosion, no freeze, no NaN, no leaked latch, play never stopped.'
  : 'MATCH ENDURANCE PROBE FAILED');
process.exit(allPass ? 0 : 1);
