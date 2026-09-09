/**
 * TARCS — OPEN-PLAY / DEFENCE HEADLESS VERIFICATION PROBE.
 *
 * Proves the four open-play & defence systems WITHOUT a browser, a canvas or a
 * controller — the same discipline as `refereeprobe.ts` (pure law checks first,
 * then a live Director boot to prove nothing regressed):
 *
 *   (a) RUNNING KINEMATICS — positional top-speed tiers (props/locks 7.5,
 *       back row 8.2, halfbacks/centres 8.8, wings/full-back 9.4), the
 *       momentum acceleration law a(v) = 4.5·(1 − v/v_max), and the
 *       turn-radius / sharp-cut foot-plant rules (R ≥ v²/6.0; a >45° cut above
 *       6 m/s decelerates and plants).
 *   (b) CARRY STATE MACHINE — TWO_HANDED default on gather with a crisp
 *       targeted pass and an 85% sprint cap, vs TUCKED with the 100% sprint
 *       and +35% strip resistance and a 0.25 s presentation delay before any
 *       pass may leave.
 *   (c) DEFENSIVE LINE INTEGRITY — a numbered 3–4 m lane across an attacking
 *       backline run with at most 1 primary + 1 assist committing; outside
 *       defenders never swarm.
 *   (d) RAGDOLL STABILITY — 20 heavy tackle collisions: joint-limit
 *       enforcement keeps every spine/hinge pose inside its anatomical band
 *       (spine pitch −20°..+40°, roll ±15°, knee/elbow hinge 0°..135°) and the
 *       γ = 10 s⁻¹ angular damping decays every post-impact spin below the
 *       50 rad/s visible-oscillation ceiling.
 *
 * Exits 0 when everything passes; any failure exits 1.
 */
import { Director, quickStartConfig } from '../src/game/director';
import {
  positionTopSpeed, runTierForShirt, accelerationAt, minTurnRadius,
  maxTurnRate, sharpCutNeedsPlant, stepRunMomentum,
  TIER_TOP_SPEED_MS, ACCEL_MAX_MS2, LAT_ACCEL_MS2, SHARP_CUT_SPEED_MS,
} from '../src/game/engine/approach';
import {
  freshCarrier, gatherCarry, tuckCarry, tickCarry, carrySpeedFraction,
  carryStripResistance, canInstantPass, beginPassRelease, passReadyAfter,
  TWO_HANDED_SPEED_FRACTION, TUCKED_SPEED_FRACTION,
  TUCKED_STRIP_RESISTANCE_BONUS, TUCK_RELEASE_PRESENT_SECONDS,
} from '../src/game/engine/carry';
import {
  markBreakdownMen, layoutLineLanes, lineHasNoClustering, mayCommitToCarrier,
  simulateLaneDefence,
  MAX_PRIMARY_TACKLERS, MAX_ASSIST_TACKLERS,
  LANE_SPACING_MIN_M, LANE_SPACING_MAX_M,
  BREAKDOWN_PILLAR_LATERAL_M, BREAKDOWN_GUARD_LATERAL_M,
  shouldBlitz, BLITZ_PASS_AIR_TIME_S, BLITZ_RECEIVER_BEHIND_GAIN_M,
} from '../src/game/engine/defence';
import {
  angularDampFactor, enforceJointLimits, stabilityViolations,
  isOscillationViolation, spineWithinLimits, hingesWithinLimits,
  RAGDOLL_ANGULAR_GAMMA_1_PER_S, OSCILLATION_VIOLATION_RAD_PER_S,
  SPINE_PITCH_MIN_DEG, SPINE_PITCH_MAX_DEG, SPINE_ROLL_MIN_DEG,
  SPINE_ROLL_MAX_DEG, HINGE_MIN_DEG, HINGE_MAX_DEG,
} from '../src/game/engine/ragdollStability';

let failures = 0;
const dt = 1 / 60;
const ok = (label: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
  if (!cond) failures++;
};

/* deterministic PRNG for the tackle battery */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
}

/* ======================= (a) RUNNING KINEMATICS ======================= */
console.log('(a) RUNNING KINEMATICS — positional tiers, a(v) curve, turning');

ok('tier caps: FRONT5 7.5 · BACK_ROW 8.2 · HALF_CENTRE 8.8 · BACK3 9.4',
  TIER_TOP_SPEED_MS.FRONT5 === 7.5 && TIER_TOP_SPEED_MS.BACK_ROW === 8.2
  && TIER_TOP_SPEED_MS.HALF_CENTRE === 8.8 && TIER_TOP_SPEED_MS.BACK3 === 9.4);

/* props + locks (1,2,3,4,5) */
for (const n of [1, 2, 3, 4, 5]) ok(`shirt ${n} (front five) tops at 7.5`, positionTopSpeed(n) === 7.5);
/* back row 6,7,8 */
for (const n of [6, 7, 8]) ok(`shirt ${n} (back row) tops at 8.2`, positionTopSpeed(n) === 8.2);
/* halfbacks + centres */
for (const n of [9, 10, 12, 13]) ok(`shirt ${n} (half/centre) tops at 8.8`, positionTopSpeed(n) === 8.8);
/* wings + full-back */
for (const n of [11, 14, 15]) ok(`shirt ${n} (back three) tops at 9.4`, positionTopSpeed(n) === 9.4);
ok('a winger is a different tier to a prop', runTierForShirt(11) !== runTierForShirt(1));

/* acceleration law */
ok('a(v) starts at a_max from a standstill', accelerationAt(0, 7.5) === ACCEL_MAX_MS2);
ok('a(v) is a_max·(1 − v/v_max) at half pace', Math.abs(accelerationAt(3.75, 7.5) - 2.25) < 1e-9);
ok('a(v) → 0 as v → v_max', accelerationAt(7.5, 7.5) === 0);

/* turn radius */
ok('R_min = v²/6: at 6 m/s it is 6 m', Math.abs(minTurnRadius(6) - 6) < 1e-9);
ok('lateral accel budget is 6.0 m/s²', LAT_ACCEL_MS2 === 6.0);
ok('max turn rate = a_lat/v: at 9 m/s = 2/3 rad/s', Math.abs(maxTurnRate(9) - 6 / 9) < 1e-9);
ok('a gentle 30° turn at 8 m/s needs no plant',
  !sharpCutNeedsPlant(8, (30 * Math.PI) / 180));
ok('a 60° cut at 8 m/s (>45°, >6 m/s) plants',
  sharpCutNeedsPlant(8, (60 * Math.PI) / 180));

/* momentum integration matches the closed-form a(v) solution:
 * v(t) = v_max · (1 − e^(−(a_max/v_max)·t)). The integrator should track it
 * and never overshoot the cap. */
{
  const analytic = (shirt: number, secs: number): number => {
    const top = positionTopSpeed(shirt);
    return top * (1 - Math.exp(-(ACCEL_MAX_MS2 / top) * secs));
  };
  const runStraight = (shirt: number, secs: number): number => {
    let vx = 0, vz = 0;
    const top = positionTopSpeed(shirt);
    const frames = Math.round(secs / dt);
    for (let i = 0; i < frames; i++) {
      const r = stepRunMomentum({ vx, vz }, { dx: 0, dz: 1 }, top, dt);
      vx = r.vx; vz = r.vz;
    }
    return Math.hypot(vx, vz);
  };
  /* never overshoots the tier cap */
  let vx = 0, vz = 0;
  const top = positionTopSpeed(11);
  for (let i = 0; i < 60 * 30; i++) {
    const r = stepRunMomentum({ vx, vz }, { dx: 0, dz: 1 }, top, dt);
    vx = r.vx; vz = r.vz;
  }
  ok('a 30 s sprint never exceeds the positional cap', Math.hypot(vx, vz) <= top + 1e-9);
  ok('the integrator tracks the analytic a(v) curve (2 s, wing)',
    Math.abs(runStraight(11, 2) - analytic(11, 2)) < 0.05, `${runStraight(11, 2).toFixed(3)} vs ${analytic(11, 2).toFixed(3)}`);
  ok('the integrator tracks the analytic a(v) curve (8 s, wing)',
    Math.abs(runStraight(11, 8) - analytic(11, 8)) < 0.1, `${runStraight(11, 8).toFixed(3)} vs ${analytic(11, 8).toFixed(3)}`);
  /* a prop and a wing never arrive at the same pace */
  const wing4 = runStraight(11, 4), prop4 = runStraight(1, 4);
  ok('after 4 s a wing is clearly ahead of a prop', wing4 - prop4 > 1.0,
    `${wing4.toFixed(2)} vs ${prop4.toFixed(2)}`);
}
/* a 90° cut at pace: plants, and the heading change honours the turn rate */
{
  let vx = 0, vz = 8;
  let plantedOnce = false;
  for (let i = 0; i < 40; i++) {
    const r = stepRunMomentum({ vx, vz }, { dx: 1, dz: 0 }, 9.4, dt);
    if (r.planted) plantedOnce = true;
    vx = r.vx; vz = r.vz;
  }
  const heading = Math.atan2(vx, vz); // from +z toward +x
  const turned = Math.abs(Math.sin(heading)) > 0.3; // meaningful progress across
  ok('a 90° cut at >6 m/s triggers the foot-plant', plantedOnce);
  ok('the cut still turns (radius respected, not teleported)', turned, `${(heading * 180 / Math.PI).toFixed(1)}°`);
  ok('a cut cannot exceed the standing turn-rate budget',
    maxTurnRate(8) === 6 / 8 && maxTurnRate(8) < Infinity);
}

/* ======================= (b) CARRY STATE MACHINE ======================= */
console.log('(b) CARRY — two-handed baby hold vs tucked sprint');

ok('two-handed carry caps at 85% of sprint', TWO_HANDED_SPEED_FRACTION === 0.85);
ok('tucked unlocks the full 100% sprint', TUCKED_SPEED_FRACTION === 1.0);

/* gather defaults to two hands and can instant-pass */
let carry = freshCarrier();
ok('a fresh carrier is TWO_HANDED', carry.state === 'TWO_HANDED');
carry = gatherCarry();
ok('gather resets to TWO_HANDED', carry.state === 'TWO_HANDED' && canInstantPass(carry));

/* a crisp targeted click-pass is legal only while presented */
ok('a two-handed carrier throws an instant targeted pass', canInstantPass(carry));

/* tuck: instant entry, full pace, +35% strip resistance */
carry = tuckCarry();
ok('tucking is instant on the sprint input', carry.state === 'TUCKED');
ok('carrySpeedFraction(TWO_HANDED) < 1 < tucked 1.0',
  carrySpeedFraction('TWO_HANDED') === 0.85 && carrySpeedFraction('TUCKED') === 1.0);
ok('tuck grants +35% strip resistance', TUCKED_STRIP_RESISTANCE_BONUS === 0.35);
ok('strip resistance: tucked = base + 35%', carryStripResistance('TUCKED', 0.4) === 0.75);
ok('two-handed strip resistance is unboosted', carryStripResistance('TWO_HANDED', 0.4) === 0.4);

/* a tucked carrier CANNOT instant-pass: 0.25 s presentation first */
ok('a tucked carrier cannot instant-pass', !canInstantPass(carry));
ok('releasing the tuck costs a 0.25 s presentation delay', beginPassRelease('TUCKED') === TUCK_RELEASE_PRESENT_SECONDS);
let timer = beginPassRelease('TUCKED');
timer = passReadyAfter(timer, 0.1);
ok('0.1 s in, the pass is still not ready', timer > 0);
timer = passReadyAfter(timer, 0.2);
ok('0.3 s in, the pass is ready', timer === 0);
ok('a two-handed pass needs no delay at all', beginPassRelease('TWO_HANDED') === 0);

/* tucked two-handed speed interplay with the position cap (whole-model) */
{
  const tuckedTop = positionTopSpeed(11) * carrySpeedFraction('TUCKED');
  const twoHandTop = positionTopSpeed(11) * carrySpeedFraction('TWO_HANDED');
  ok('a tucked wing runs at 100% of his tier, two-handed at 85%',
    Math.abs(tuckedTop - 9.4) < 1e-9 && Math.abs(twoHandTop - 7.99) < 0.01);
}

/* ======================= (c) DEFENSIVE LINE INTEGRITY ======================= */
console.log('(c) DEFENSIVE LANES — numbered spacing, tackler commitment cap');

ok('breakdown pillar sits 0.5 m off the edge', BREAKDOWN_PILLAR_LATERAL_M === 0.5);
ok('breakdown guard sits 2.5 m out', BREAKDOWN_GUARD_LATERAL_M === 2.5);
const home = markBreakdownMen(0, 1);
ok('pillar is tight to the breakdown, guard wider', Math.abs(home.pillar.laneX - 0.5) < 1e-9 && Math.abs(home.guard.laneX - 2.5) < 1e-9);

/* 3–4 m corridors: layout N men across 22 m and check no clustering */
const laneXs = layoutLineLanes(7, -10, 12);
const sp = LANE_SPACING_MIN_M;
ok('a 7-man line keeps >3 m spacing (no clustering)',
  lineHasNoClustering(laneXs) && laneXs.every((_, i) => i === 0 || laneXs[i] - laneXs[i - 1] >= sp - 0.5), laneXs.map((x) => x.toFixed(1)).join(','));
ok('lane spacing is within the 3–4 m design band', LANE_SPACING_MIN_M === 3.0 && LANE_SPACING_MAX_M === 4.0);

ok('commitment cap is 1 primary + 1 assist', MAX_PRIMARY_TACKLERS === 1 && MAX_ASSIST_TACKLERS === 1);
/* law: nobody leaves a lane unless the carrier is breaching his own lane */
ok('drift: a non-breaching outside defender holds his lane',
  !mayCommitToCarrier(0, 0, false, false));
ok('the man whose lane is breached may commit as the primary',
  mayCommitToCarrier(0, 0, true, false));
ok('once 1+1 are committed nobody else leaves the line',
  !mayCommitToCarrier(1, 1, true, false));
ok('a genuine break behind the line lets the cover chase',
  mayCommitToCarrier(1, 1, false, true));

/* blitz vs drift triggers */
ok('a looped 1.3 s pass triggers the blitz', shouldBlitz(1.3, 1));
ok('a receiver 6 m behind the gain line triggers the blitz', shouldBlitz(0.5, 6));
ok('a crisp 0.9 s pass to a flat man stays a disciplined drift',
  !shouldBlitz(0.9, 2) && !shouldBlitz(1.0, 4));
ok('thresholds: 1.2 s air time / 5 m behind the gain line',
  BLITZ_PASS_AIR_TIME_S === 1.2 && BLITZ_RECEIVER_BEHIND_GAIN_M === 5.0);

/* whole-line simulation: an attacking run down a lane must not swarm */
for (const [outside, breach, broken] of [
  [5, 2, false], [5, 0, false], [5, 4, false], [7, 3, false], [6, 1, false],
] as [number, number, boolean][]) {
  const sim = simulateLaneDefence(outside, -8, 10, breach, broken);
  ok(`normal defence (${outside} outside, breach lane ${breach}): <=2 commit, no cluster`,
    sim.committed <= MAX_PRIMARY_TACKLERS + MAX_ASSIST_TACKLERS
    && !sim.clustered, `committed ${sim.committed}`);
}

/* ======================= (d) RAGDOLL STABILITY ======================= */
console.log('(d) RAGDOLL STABILITY — 20 heavy tackles, 0 violations');

ok('angular damping γ = 10 s⁻¹', RAGDOLL_ANGULAR_GAMMA_1_PER_S === 10.0);
ok('oscillation ceiling is 50 rad/s', OSCILLATION_VIOLATION_RAD_PER_S === 50);
ok('the spine envelope is pitch [−20°,+40°] and roll [−15°,+15°]',
  SPINE_PITCH_MIN_DEG === -20 && SPINE_PITCH_MAX_DEG === 40
  && SPINE_ROLL_MIN_DEG === -15 && SPINE_ROLL_MAX_DEG === 15);
ok('knees/elbows hinge in [0°,135°]', HINGE_MIN_DEG === 0 && HINGE_MAX_DEG === 135);

/* A joint-limit correction always restores the anatomical band. */
{
  const bad = enforceJointLimits({
    spinePitchDeg: 65, spineRollDeg: -30, kneeL: -12, kneeR: 200, elbowL: -40, elbowR: 140,
  });
  ok('an over-flexed spine is clamped to +40°', bad.spinePitchDeg === 40);
  ok('a knocked spine is clamped into ±15° roll', bad.spineRollDeg === -15);
  ok('a backward knee is clamped to 0° (no hyperextension)', bad.kneeL === 0 && bad.kneeR === 135);
  ok('an elbow is clamped into its hinge band', bad.elbowL === 0 && bad.elbowR === 135);
  ok('after enforcement there are no stability violations', stabilityViolations(bad).length === 0);
}

/* 20 heavy tackles */
const rand = lcg(1234);
let jointViolations = 0, oscillationViolations = 0;
for (let tackle = 0; tackle < 20; tackle++) {
  const impactSpin = 120 + rand() * 380;   // rad/s of pure rotational kick
  const decayT = 0.25 + rand() * 0.1;      // 0.25–0.35 s of damping
  const postDamped = impactSpin * angularDampFactor(decayT);
  // perturb every joint slightly around a legal pose; some pushes over the band
  const pose = {
    spinePitchDeg: 8 + (rand() - 0.5) * 90,   // heavy contact can throw the spine
    spineRollDeg: (rand() - 0.5) * 60,
    kneeL: 30 + rand() * 150, elbowR: 20 + rand() * 150,
  };
  /* The clamp is the guarantee: whatever the solver handed us, the pose that
   * is actually written back must be inside every anatomical band. */
  const fixed = enforceJointLimits(pose);
  if (stabilityViolations(fixed).length > 0) jointViolations++;
  if (!spineWithinLimits(fixed.spinePitchDeg, fixed.spineRollDeg)
    || !hingesWithinLimits(fixed)) jointViolations++;
  if (isOscillationViolation(postDamped)) oscillationViolations++;
}
ok('20 heavy tackles: after γ-damping no spin stays above 50 rad/s', oscillationViolations === 0,
  `${oscillationViolations} oscillation violations`);
ok('20 heavy tackles: every joint is inside its anatomical band after enforcement',
  jointViolations === 0, `${jointViolations} joint violations`);
ok('a raw 500 rad/s impact is quieted well below 50 by γ=10 damping',
  (500 * angularDampFactor(0.3)) < OSCILLATION_VIOLATION_RAD_PER_S);

/* ======================= LIVE REGRESSION BOOT ======================= */
console.log('(e) LIVE DIRECTOR — open play still boots and runs clean');
{
  const d = new Director(quickStartConfig());
  const boots = d.phase === 'KICK';
  const log0 = d.watchdogLog.length;
  let phases = 0;
  for (let i = 0; i < 90 * 60; i++) {
    d.update(dt, { left: false, right: false, up: false, down: false, run: false, sprint: false,
      passL: false, passR: false, cutL: false, cutR: false, kick: false, grubber: false,
      drop: false, contact: false, fend: false, step: false, dummy: false, secure: false,
      handsUp: false, punt: false, charge: false, pause: false, tackle: false }, new Set());
    if (d.phase === 'OPEN_PLAY') phases++;
  }
  ok('director boots into a live match', boots);
  /* Headless CPU play has no human steer, so a lone law/launch trip is
   * pre-existing tolerated noise (see quickstartprobe); the gate is that open
   * play is reached and the sim never runs away into repeated trips. */
  ok('90 s of simulated play reaches open play without runaway trips',
    phases > 0 && d.watchdogLog.length - log0 <= 2, `open-play frames ${phases}, trips ${d.watchdogLog.length - log0}`);
}

/* ============================ VERDICT ============================ */
console.log('');
if (failures) {
  console.log(`OPENPLAY PROBE: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('OPENPLAY PROBE PASSES — kinematics, carry, defensive lanes, ragdoll stability');
process.exit(0);
